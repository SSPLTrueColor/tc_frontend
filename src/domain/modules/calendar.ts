/**
 * Calendar module pack (Tasks & Calendar, OPP-08): user-scheduled events (meetings, demos, follow-ups,
 * field visits, service visits, internal — GLOSSARY C-15) with recurrence, attendees and a link to any
 * CRM record. Tasks, demos, PM visits, installation jobs and lead/opportunity follow-ups are shown
 * read-only from their own modules (services/calendar).
 */
import { L } from '../../constants/labels';
import type { MasterDefinition, MasterValue, ResourceDefinition, Tone } from '../../metadata/types';
import { ALL, cols, cond, field, FORM_ONLY, group, views } from '../helpers';
import { p, type ModulePack } from './types';

const mv = (key: string, label: string, tone: Tone = 'neutral'): Omit<MasterValue, 'order'> => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[]): MasterDefinition => ({ id: `mst_${key}`, key, label, version: 1, values: values.map((x, i) => ({ ...x, order: i })) });

/** Six event types — one template palette colour each (see calendar.css `.ev-<type>`). */
export const EVENT_TYPES = ['meeting', 'demo', 'follow_up', 'field_visit', 'service_visit', 'internal'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const M = L.calendar.masters;
const FL = L.calendar.fields.calendarEvents;
const masters: MasterDefinition[] = [
  master('calEventType', M.eventType.label, [
    mv('meeting', M.eventType.values.meeting, 'accent'),
    mv('demo', M.eventType.values.demo, 'info'),
    mv('follow_up', M.eventType.values.follow_up, 'warning'),
    mv('field_visit', M.eventType.values.field_visit, 'success'),
    mv('service_visit', M.eventType.values.service_visit, 'danger'),
    mv('internal', M.eventType.values.internal, 'neutral'),
  ]),
  master('calEventStatus', M.eventStatus.label, [mv('scheduled', M.eventStatus.values.scheduled, 'info'), mv('completed', M.eventStatus.values.completed, 'success'), mv('cancelled', M.eventStatus.values.cancelled, 'neutral')]),
  master('calRecurrence', M.recurrence.label, [mv('none', M.recurrence.values.none), mv('daily', M.recurrence.values.daily), mv('weekly', M.recurrence.values.weekly), mv('monthly', M.recurrence.values.monthly)]),
  master('calLinkType', M.linkType.label, [
    mv('customers', M.linkType.values.customers),
    mv('leads', M.linkType.values.leads),
    mv('opportunities', M.linkType.values.opportunities),
    mv('quotations', M.linkType.values.quotations),
    mv('salesOrders', M.linkType.values.salesOrders),
    mv('tickets', M.linkType.values.tickets),
    mv('installations', M.linkType.values.installations),
  ]),
];

const f = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('calendarEvents', key, label, type, extra);

export const calendarEvents: ResourceDefinition = {
  id: 'res_calendarEvents',
  key: 'calendarEvents',
  module: 'home',
  label: L.calendar.records.calendarEvents.one,
  labelPlural: L.calendar.records.calendarEvents.many,
  icon: 'calendar',
  version: 1,
  idPrefix: 'EV',
  titleField: 'title',
  subtitleFields: ['start', 'eventType'],
  ownerField: 'assigneeId',
  description: L.calendar.description,
  status: 'published',
  fields: [
    f('title', FL.title, 'text', { required: true, maxLength: 120, capabilities: ALL, width: 280, subFields: ['linkLabel'] }),
    f('eventType', FL.eventType, 'master', { master: 'calEventType', required: true, defaultValue: 'meeting', width: 150 }),
    f('allDay', FL.allDay, 'boolean', { defaultValue: false, width: 80 }),
    // Wall-clock IST: "YYYY-MM-DDTHH:mm" (timed) or "YYYY-MM-DD" (all day; end inclusive).
    f('start', FL.start, 'datetime', { required: true, width: 160 }),
    f('end', FL.end, 'datetime', { required: true, width: 160 }),
    f('recurrence', FL.recurrence, 'master', { master: 'calRecurrence', defaultValue: 'none', width: 130 }),
    f('recurrenceUntil', FL.recurrenceUntil, 'date', { visibleWhen: { field: 'recurrence', op: 'neq', value: 'none' } }),
    f('assigneeId', FL.assigneeId, 'relation', { relation: { resource: 'employees', where: { field: 'status', op: 'neq', value: 'inactive' } }, required: true, width: 170, display: 'person', personSubtitle: 'designation' }),
    f('attendeeIds', FL.attendeeIds, 'people', { relation: { resource: 'employees' }, width: 150, capabilities: { list: true, form: true, export: true } }),
    f('linkResource', FL.linkResource, 'master', { master: 'calLinkType' }),
    f('linkId', FL.linkId, 'text', { capabilities: { filter: true, search: true } }),
    f('linkLabel', FL.linkLabel, 'text', { capabilities: { list: true, search: true, sort: true }, width: 220 }),
    f('customerId', FL.customerId, 'relation', { relation: { resource: 'customers' }, width: 200 }),
    f('location', FL.location, 'text', { maxLength: 160, capabilities: ALL }),
    f('status', FL.status, 'master', { master: 'calEventStatus', defaultValue: 'scheduled', width: 120 }),
    f('notes', FL.notes, 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
    // Recurrence bookkeeping: occurrences removed or moved individually ("this event" edits).
    f('exdates', FL.exdates, 'text', { capabilities: {} }),
    f('seriesId', FL.seriesId, 'text', { capabilities: { filter: true } }),
  ],
  relationships: [],
  form: {
    quickCreate: ['title', 'eventType', 'start', 'end', 'assigneeId'],
    sections: [{ id: 'main', title: L.calendar.sections.main, fields: ['title', 'eventType', 'allDay', 'start', 'end', 'recurrence', 'recurrenceUntil', 'assigneeId', 'attendeeIds', 'location', 'status', 'notes'], columns: 2 }],
  },
  views: views([
    { id: 'v_cal_upcoming', resource: 'calendarEvents', name: L.calendar.views.upcoming, type: 'table', filter: group('and', [cond('status', 'eq', 'scheduled')]), sort: [{ field: 'start', dir: 'asc' }], columns: cols('start', 'title', 'eventType', 'assigneeId', 'linkLabel', 'recurrence', 'status') },
    { id: 'v_cal_recurring', resource: 'calendarEvents', name: L.calendar.views.recurring, type: 'table', filter: group('and', [cond('recurrence', 'neq', 'none')]), sort: [{ field: 'start', dir: 'asc' }], columns: cols('title', 'recurrence', 'start', 'recurrenceUntil', 'assigneeId', 'attendeeIds') },
    { id: 'v_cal_all', resource: 'calendarEvents', name: L.calendar.views.all, type: 'table', filter: group('and'), sort: [{ field: 'start', dir: 'desc' }], columns: cols('start', 'end', 'title', 'eventType', 'assigneeId', 'status') },
  ]),
};

/** Everyone keeps their own calendar; managers see and plan for their team, heads for their division. */
export const calendarPack: ModulePack = {
  id: 'calendar',
  resources: [calendarEvents],
  masters,
  permissions: {
    admin: { calendarEvents: p('all', 'all', true, true, true) },
    management: { calendarEvents: p('all', 'all', true, true, true) },
    division_head: { calendarEvents: p('division', 'division', true, true, true) },
    sales_manager: { calendarEvents: p('team', 'team', true, true, true) },
    sales_exec: { calendarEvents: p('own', 'own', true, true) },
    service_head: { calendarEvents: p('team', 'team', true, true, true) },
    engineer: { calendarEvents: p('own', 'own', true, true) },
    coordinator: { calendarEvents: p('division', 'division', true, true) },
    scm: { calendarEvents: p('own', 'own', true, true) },
    store: { calendarEvents: p('own') },
    accounts: { calendarEvents: p('own', 'own', true, true) },
    profiling: { calendarEvents: p('own', 'own', true, true) },
  },
};
