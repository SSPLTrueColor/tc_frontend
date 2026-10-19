/**
 * Calendar service (engine side, synchronous). Times are Asia/Kolkata wall-clock strings:
 * "YYYY-MM-DDTHH:mm" for timed events, "YYYY-MM-DD" for all-day events (end date inclusive).
 *
 * - Own events: resource `calendarEvents` (create / edit / move / delete, recurrence with exceptions).
 * - Read-only items from other modules: tasks, demos, PM visits, installation jobs and
 *   lead / opportunity follow-ups — rescheduled from their own record.
 */
import { RRule, type Frequency } from 'rrule';
import { L } from '../../constants/labels';
import type { RecordData } from '../../metadata/types';
import { istNow } from '../../lib/clock';
import { addDays } from '../../lib/dates';
import { type Actor, canReadResource, canUpdateRecord } from '../authz';
import { getDb } from '../db';
import { getResource } from '../registry';
import { createRecord, deleteRecord, getRecord, queryRecords, recordTitle, updateRecord } from '../runtime';
import { ServiceError } from '../types';

export type EventType = 'meeting' | 'demo' | 'follow_up' | 'field_visit' | 'service_visit' | 'internal';
export type EventSource = 'event' | 'tasks' | 'demos' | 'pmVisits' | 'installations' | 'leads' | 'opportunities';

export interface CalItem {
  /** Unique id in the calendar: the record id for own events, "<source>:<id>" for module items. */
  id: string;
  recordId: string;
  source: EventSource;
  title: string;
  type: EventType;
  allDay: boolean;
  start: string;
  end: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  assigneeId: string;
  attendeeIds: string[];
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly';
  recurrenceUntil?: string;
  exdates: string[];
  linkResource?: string;
  linkId?: string;
  linkLabel?: string;
  customerId?: string;
  location?: string;
  notes?: string;
  seriesId?: string;
  version: number;
  /** Actor may move, edit and delete it here. */
  editable: boolean;
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const toMinutes = (wall: string) => Date.UTC(+wall.slice(0, 4), +wall.slice(5, 7) - 1, +wall.slice(8, 10), +(wall.slice(11, 13) || 0), +(wall.slice(14, 16) || 0)) / 60_000;
const fromMinutes = (m: number) => new Date(m * 60_000).toISOString().slice(0, 16);
export const splitExdates = (v: unknown) => s(v).split(',').map((x) => x.trim()).filter(Boolean);

// ---------------------------------------------------------------- validation (used by hooks and the dialog)

export interface EventDraft {
  title?: unknown;
  start?: unknown;
  end?: unknown;
  allDay?: unknown;
  recurrence?: unknown;
  recurrenceUntil?: unknown;
  status?: unknown;
}

/**
 * Field errors for a draft. `checkPast`: new events, and edits that change the time, may not start in
 * the past (assumption generalising BR-07 "follow-up dates cannot be in the past"; see REQUIREMENTS Q-33).
 */
export function validateEvent(v: EventDraft, opts: { checkPast: boolean }): Record<string, string> {
  const V = L.calendar.validation;
  const e: Record<string, string> = {};
  const start = s(v.start);
  const end = s(v.end);
  const allDay = !!v.allDay;
  if (!s(v.title).trim()) e.title = V.titleRequired;
  if (!start) e.start = V.startRequired;
  if (!end) e.end = V.endRequired;
  if (start && end) {
    if (allDay ? end.slice(0, 10) < start.slice(0, 10) : end <= start) e.end = allDay ? V.endDateAfter : V.endTimeAfter;
    if (!allDay && (isDate(start) || isDate(end))) e.start = V.pickTimes;
  }
  if (opts.checkPast && start && s(v.status || 'scheduled') === 'scheduled') {
    const nowWall = istNow().slice(0, 16);
    if (allDay ? start.slice(0, 10) < nowWall.slice(0, 10) : start < nowWall) e.start = V.noPast;
  }
  if (s(v.recurrence) && s(v.recurrence) !== 'none' && s(v.recurrenceUntil) && start && s(v.recurrenceUntil) < start.slice(0, 10)) e.recurrenceUntil = V.untilAfterStart;
  return e;
}

// ---------------------------------------------------------------- recurrence

const FREQ: Record<string, Frequency> = { daily: RRule.DAILY, weekly: RRule.WEEKLY, monthly: RRule.MONTHLY };

/** Occurrence starts (wall clock) of an event inside [from, to]. Non-recurring → the event itself if it overlaps. */
export function occurrences(ev: Pick<CalItem, 'start' | 'end' | 'recurrence' | 'recurrenceUntil' | 'exdates'>, from: string, to: string): { start: string; end: string }[] {
  const dur = toMinutes(ev.end) - toMinutes(ev.start);
  if (ev.recurrence === 'none') return ev.start <= to && ev.end >= from ? [{ start: ev.start, end: ev.end }] : [];
  const dtstart = new Date(toMinutes(ev.start) * 60_000);
  const until = ev.recurrenceUntil ? new Date(toMinutes(`${ev.recurrenceUntil}T23:59`) * 60_000) : undefined;
  const rule = new RRule({ freq: FREQ[ev.recurrence], dtstart, until });
  const skip = new Set(ev.exdates.map((x) => x.slice(0, 16)));
  return rule
    .between(new Date((toMinutes(from) - dur) * 60_000), new Date(toMinutes(to) * 60_000), true)
    .map((d) => d.toISOString().slice(0, isDate(ev.start) ? 10 : 16))
    .filter((st) => !skip.has(st.slice(0, 16)))
    .map((st) => ({ start: st, end: isDate(ev.start) ? addDays(st, Math.round(dur / 1440)) : fromMinutes(toMinutes(st) + dur) }));
}

// ---------------------------------------------------------------- reads

/** Event type keys renamed for GLOSSARY C-15 (seed rev 3); records saved before that still read correctly. */
const LEGACY_TYPE: Record<string, EventType> = { customer_visit: 'field_visit', service: 'service_visit' };

function ownItem(actor: Actor, r: RecordData): CalItem {
  const raw = getDb().records.calendarEvents.find((x) => x.id === r.id);
  return {
    id: r.id,
    recordId: r.id,
    source: 'event',
    title: s(r.title),
    type: (LEGACY_TYPE[s(r.eventType)] ?? (s(r.eventType) || 'meeting')) as EventType,
    allDay: !!r.allDay,
    start: s(r.start),
    end: s(r.end),
    status: (s(r.status) || 'scheduled') as CalItem['status'],
    assigneeId: s(r.assigneeId),
    attendeeIds: (r.attendeeIds as string[] | undefined) ?? [],
    recurrence: (s(r.recurrence) || 'none') as CalItem['recurrence'],
    recurrenceUntil: s(r.recurrenceUntil) || undefined,
    exdates: splitExdates(r.exdates),
    linkResource: s(r.linkResource) || undefined,
    linkId: s(r.linkId) || undefined,
    linkLabel: s(r.linkLabel) || undefined,
    customerId: s(r.customerId) || undefined,
    location: s(r.location) || undefined,
    notes: s(r.notes) || undefined,
    seriesId: s(r.seriesId) || undefined,
    version: r.version,
    editable: !!raw && canUpdateRecord(actor, getResource('calendarEvents'), raw),
  };
}

const safeRows = (actor: Actor, resKey: string, where?: Record<string, unknown>) => {
  if (!getDb().records[resKey] || !canReadResource(actor, resKey)) return [];
  try {
    return queryRecords(actor, resKey, { where }).rows;
  } catch {
    return [];
  }
};

/** Task type → calendar event type (GLOSSARY C-15). */
const TASK_TYPE: Record<string, EventType> = { call: 'follow_up', follow_up: 'follow_up', meeting: 'meeting', visit: 'field_visit', demo: 'demo', other: 'internal' };
const DV = L.calendar.derived;
const item = (x: Omit<CalItem, 'attendeeIds' | 'recurrence' | 'exdates' | 'editable' | 'version'>): CalItem => ({ ...x, attendeeIds: [], recurrence: 'none', exdates: [], editable: false, version: 0 });

/** Everything the actor may see on the calendar (scope-filtered by each module's own permissions). */
export function listCalendarItems(actor: Actor): CalItem[] {
  const out: CalItem[] = safeRows(actor, 'calendarEvents').map((r) => ownItem(actor, r));
  safeRows(actor, 'tasks').forEach((t) => {
    if (!s(t.dueDate)) return;
    out.push(item({ id: `tasks:${t.id}`, recordId: t.id, source: 'tasks', title: s(t.title), type: TASK_TYPE[s(t.taskType)] ?? 'internal', allDay: true, start: s(t.dueDate), end: s(t.dueDate), status: t.status === 'done' ? 'completed' : t.status === 'cancelled' ? 'cancelled' : 'scheduled', assigneeId: s(t.assigneeId), linkLabel: s(t.relatedLabel) || undefined }));
  });
  safeRows(actor, 'demos').forEach((d) => {
    if (!s(d.scheduledAt)) return;
    const start = s(d.scheduledAt).slice(0, 16);
    out.push(item({ id: `demos:${d.id}`, recordId: d.id, source: 'demos', title: DV.demo(recordTitle('opportunities', d.opportunityId, actor)), type: 'demo', allDay: false, start, end: fromMinutes(toMinutes(start) + (Number(d.durationMin) || 120)), status: d.status === 'done' ? 'completed' : d.status === 'cancelled' ? 'cancelled' : 'scheduled', assigneeId: s(d.ownerId), linkResource: 'opportunities', linkId: s(d.opportunityId), linkLabel: recordTitle('opportunities', d.opportunityId, actor), customerId: s(d.customerId) || undefined }));
  });
  safeRows(actor, 'installations').forEach((j) => {
    if (!s(j.scheduledAt)) return;
    const start = s(j.scheduledAt).slice(0, 16);
    const timed = start.length > 10;
    out.push(item({ id: `installations:${j.id}`, recordId: j.id, source: 'installations', title: DV.installation(recordTitle('customers', j.customerId, actor)), type: 'service_visit', allDay: !timed, start: timed ? start : start.slice(0, 10), end: timed ? fromMinutes(toMinutes(start) + 240) : start.slice(0, 10), status: j.status === 'signed_off' ? 'completed' : 'scheduled', assigneeId: s(j.engineerId), linkResource: 'installations', linkId: j.id, linkLabel: j.id, customerId: s(j.customerId) || undefined }));
  });
  safeRows(actor, 'pmVisits').forEach((v) => {
    if (!s(v.dueDate)) return;
    out.push(item({ id: `pmVisits:${v.id}`, recordId: v.id, source: 'pmVisits', title: DV.pmVisit(recordTitle('customers', v.customerId, actor)), type: 'service_visit', allDay: true, start: s(v.dueDate).slice(0, 10), end: s(v.dueDate).slice(0, 10), status: v.status === 'done' ? 'completed' : v.status === 'missed' ? 'cancelled' : 'scheduled', assigneeId: s(v.engineerId), customerId: s(v.customerId) || undefined }));
  });
  (['leads', 'opportunities'] as const).forEach((resKey) =>
    safeRows(actor, resKey).forEach((r) => {
      const open = resKey === 'leads' ? ['new', 'contacted', 'nurture'].includes(s(r.status)) : !['won', 'lost'].includes(s(r.stage));
      if (!open || !s(r.nextFollowUpAt)) return;
      const day = s(r.nextFollowUpAt).slice(0, 10);
      out.push(item({ id: `${resKey}:${r.id}`, recordId: r.id, source: resKey, title: DV.followUp(recordTitle(resKey, r.id, actor)), type: 'follow_up', allDay: true, start: day, end: day, status: 'scheduled', assigneeId: s(r.ownerId), linkResource: resKey, linkId: r.id, linkLabel: recordTitle(resKey, r.id, actor), customerId: s(r.customerId) || undefined }));
    }),
  );
  return out;
}

/** People whose calendars the actor can see (filter options): own team / division / everyone by scope. */
export function calendarPeople(actor: Actor): { id: string; name: string }[] {
  const ids = new Set(listCalendarItems(actor).map((i) => i.assigneeId).filter(Boolean));
  ids.add(actor.staffId);
  return [...ids].map((id) => ({ id, name: recordTitle('employees', id, actor) })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- overlap warning

/** Timed items of the same person (assignee or attendee) that overlap the draft. A warning, never a block. */
export function findOverlaps(actor: Actor, draft: { id?: string; start: string; end: string; allDay: boolean; assigneeId: string }, occurrenceOf?: string): { title: string; start: string; end: string }[] {
  if (draft.allDay || !draft.start || !draft.end || draft.end <= draft.start) return [];
  const person = draft.assigneeId;
  return listCalendarItems(actor)
    .filter((i) => !i.allDay && i.status !== 'cancelled' && i.id !== draft.id && i.id !== occurrenceOf && (i.assigneeId === person || i.attendeeIds.includes(person)))
    .flatMap((i) => occurrences(i, draft.start, draft.end).filter((o) => o.start < draft.end && o.end > draft.start).map((o) => ({ title: i.title, start: o.start, end: o.end })));
}

// ---------------------------------------------------------------- writes

export type EventInput = Record<string, unknown>;

export function createEvent(actor: Actor, input: EventInput) {
  return createRecord(actor, 'calendarEvents', input).record;
}

export function updateEvent(actor: Actor, id: string, patch: EventInput, version: number) {
  return updateRecord(actor, 'calendarEvents', id, patch, version).record;
}

/** Drag / resize of a whole (non-recurring) event, or "all events" of a series shifted by the same delta. */
export function moveEvent(actor: Actor, id: string, next: { start: string; end: string; allDay: boolean }, version: number) {
  return updateRecord(actor, 'calendarEvents', id, next, version).record;
}

/** "All events": shift a series by the change made to one occurrence (start delta and duration change). */
export function shiftSeries(actor: Actor, id: string, occurrence: { start: string; end: string }, next: { start: string; end: string; allDay: boolean }, version: number) {
  const r = getRecord(actor, 'calendarEvents', id).record;
  if (!!r.allDay !== next.allDay) throw new ServiceError('validation', L.calendar.validation.seriesAllDay);
  const errors = validateEvent({ title: r.title, start: next.start, end: next.end, allDay: next.allDay }, { checkPast: true });
  if (Object.keys(errors).length) throw new ServiceError('validation', Object.values(errors)[0], { fieldErrors: errors });
  const delta = toMinutes(next.start) - toMinutes(occurrence.start);
  const dur = toMinutes(next.end) - toMinutes(next.start);
  const keep = (v: string) => (next.allDay ? v.slice(0, 10) : v);
  const start = keep(fromMinutes(toMinutes(s(r.start)) + delta));
  const end = keep(fromMinutes(toMinutes(start) + dur));
  const shift = (x: string) => fromMinutes(toMinutes(x) + delta).slice(0, x.length);
  return updateRecord(actor, 'calendarEvents', id, { start, end, exdates: splitExdates(r.exdates).map(shift).join(',') }, version).record;
}

/**
 * "This event only": the occurrence is skipped on the series and saved as its own event
 * (same details + the change). Created first so a failed save leaves the series untouched.
 */
export function updateOccurrence(actor: Actor, id: string, occurrenceStart: string, patch: EventInput, version: number) {
  const r = getRecord(actor, 'calendarEvents', id).record;
  const copy: EventInput = { title: r.title, eventType: r.eventType, allDay: r.allDay, assigneeId: r.assigneeId, attendeeIds: r.attendeeIds, linkResource: r.linkResource, linkId: r.linkId, linkLabel: r.linkLabel, customerId: r.customerId, location: r.location, notes: r.notes, status: r.status };
  const single = createRecord(actor, 'calendarEvents', { ...copy, ...patch, recurrence: 'none', recurrenceUntil: null, seriesId: id }).record;
  try {
    updateRecord(actor, 'calendarEvents', id, { exdates: [...splitExdates(r.exdates), occurrenceStart].join(',') }, version);
  } catch (e) {
    deleteRecord(actor, 'calendarEvents', single.id);
    throw e;
  }
  return single;
}

/** "This event only" delete: skip the occurrence on the series. */
export function deleteOccurrence(actor: Actor, id: string, occurrenceStart: string, version: number) {
  const r = getRecord(actor, 'calendarEvents', id).record;
  return updateRecord(actor, 'calendarEvents', id, { exdates: [...splitExdates(r.exdates), occurrenceStart].join(',') }, version).record;
}

/** Delete an event (or a whole series). Only people who may edit it may delete it; goes to the recycle bin. */
export function deleteEvent(actor: Actor, id: string) {
  const raw = getDb().records.calendarEvents.find((x) => x.id === id);
  if (!raw || !canUpdateRecord(actor, getResource('calendarEvents'), raw)) throw new ServiceError('forbidden', L.calendar.validation.deleteForbidden);
  deleteRecord(actor, 'calendarEvents', id);
}

/** Records a calendar event can link to, for the dialog's record picker. */
export function linkCandidates(actor: Actor, resKey: string): { value: string; label: string; customerId?: string }[] {
  return safeRows(actor, resKey)
    .slice(0, 300)
    .map((r) => ({ value: r.id, label: `${recordTitle(resKey, r.id, actor)}${resKey === 'customers' ? '' : ` · ${r.id}`}`, customerId: resKey === 'customers' ? r.id : s(r.customerId) || undefined }));
}
