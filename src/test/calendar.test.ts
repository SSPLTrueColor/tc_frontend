import '../domain/extensions/index';
import { actorFor, perm } from '../services/authz';
import { createDb, __setDb, getDb } from '../services/db';
import { createEvent, deleteEvent, deleteFollowing, deleteOccurrence, findOverlaps, listCalendarItems, occurrences, restoreEvent, shiftSeries, undoOccurrence, updateFollowing, updateOccurrence, validateEvent } from '../services/calendar/events';
import { setClockOffset } from '../lib/clock';
import { istNow } from '../lib/clock';
import { addDays } from '../lib/dates';
import { EVENT_TYPES } from '../domain/modules/calendar';
import { demoUsers } from '../domain/pack';
import { masterLabel } from '../services/registry';

describe('calendar', () => {
  beforeEach(() => {
    setClockOffset(0);
    __setDb(createDb());
  });
  const today = () => istNow().slice(0, 10);
  const rohan = () => actorFor('u_rohan', 'tc');

  it('seeds 40+ events incl. all-day, multi-day, recurring, past and today', () => {
    const ev = getDb().records.calendarEvents;
    expect(ev.length).toBeGreaterThanOrEqual(60);
    expect(ev.some((e) => e.allDay && e.end !== e.start)).toBe(true);
    expect(ev.some((e) => e.recurrence !== 'none')).toBe(true);
    expect(ev.some((e) => String(e.start).slice(0, 10) === today())).toBe(true);
    expect(ev.some((e) => String(e.end) < today())).toBe(true);
  });

  it('validates end after start and blocks past scheduling', () => {
    const t = addDays(today(), 2);
    expect(validateEvent({ title: 'x', start: `${t}T10:00`, end: `${t}T09:00` }, { checkPast: true }).end).toMatch(/after/);
    expect(validateEvent({ title: 'x', start: `${addDays(today(), -1)}T10:00`, end: `${addDays(today(), -1)}T11:00` }, { checkPast: true }).start).toMatch(/past/);
    expect(validateEvent({ title: 'x', start: t, end: t, allDay: true }, { checkPast: true })).toEqual({});
    expect(() => createEvent(rohan(), { title: 'Bad', eventType: 'meeting', start: `${t}T12:00`, end: `${t}T11:00`, assigneeId: rohan().staffId })).toThrow(/after/);
  });

  it('expands weekly recurrence and honours skipped occurrences', () => {
    const start = `${addDays(today(), 1)}T10:00`;
    const ev = { start, end: `${start.slice(0, 11)}11:00`, recurrence: 'weekly' as const, recurrenceUntil: addDays(today(), 30), exdates: [`${addDays(today(), 8)}T10:00`] };
    const occ = occurrences(ev, `${today()}T00:00`, `${addDays(today(), 31)}T23:59`);
    expect(occ.map((o) => o.start)).toEqual([start, `${addDays(today(), 15)}T10:00`, `${addDays(today(), 22)}T10:00`, `${addDays(today(), 29)}T10:00`]);
  });

  it('warns about overlaps for the same person', () => {
    const a = rohan();
    const d = addDays(today(), 3);
    createEvent(a, { title: 'A', eventType: 'meeting', start: `${d}T10:00`, end: `${d}T11:00`, assigneeId: a.staffId });
    expect(findOverlaps(a, { start: `${d}T10:30`, end: `${d}T11:30`, allDay: false, assigneeId: a.staffId }).map((o) => o.title)).toContain('A');
    expect(findOverlaps(a, { start: `${d}T11:00`, end: `${d}T12:00`, allDay: false, assigneeId: a.staffId })).toEqual([]);
  });

  it('edits one occurrence or the whole series', () => {
    const a = rohan();
    const d = addDays(today(), 2);
    const s = createEvent(a, { title: 'Review', eventType: 'meeting', start: `${d}T10:00`, end: `${d}T11:00`, recurrence: 'weekly', recurrenceUntil: addDays(d, 28), assigneeId: a.staffId });
    const occ = `${addDays(d, 7)}T10:00`;
    const single = updateOccurrence(a, s.id, occ, { start: `${addDays(d, 8)}T15:00`, end: `${addDays(d, 8)}T16:00` }, s.version);
    expect(single.seriesId).toBe(s.id);
    let series = getDb().records.calendarEvents.find((x) => x.id === s.id)!;
    expect(String(series.exdates)).toContain(occ);
    shiftSeries(a, s.id, { start: `${d}T10:00`, end: `${d}T11:00` }, { start: `${d}T11:00`, end: `${d}T12:30`, allDay: false }, series.version);
    series = getDb().records.calendarEvents.find((x) => x.id === s.id)!;
    expect(series.start).toBe(`${d}T11:00`);
    expect(series.end).toBe(`${d}T12:30`);
    expect(String(series.exdates)).toContain(`${addDays(d, 7)}T11:00`);
    deleteOccurrence(a, s.id, `${addDays(d, 14)}T11:00`, series.version);
    expect(String(getDb().records.calendarEvents.find((x) => x.id === s.id)!.exdates)).toContain(`${addDays(d, 14)}T11:00`);
  });

  it('respects role scope: a sales executive cannot edit his manager’s events', () => {
    const items = listCalendarItems(actorFor('u_karan', 'tc'));
    const mgr = items.find((i) => i.source === 'event' && i.assigneeId === actorFor('u_rohan', 'tc').staffId);
    if (mgr) expect(mgr.editable).toBe(false);
    const own = items.find((i) => i.source === 'event' && i.assigneeId === actorFor('u_karan', 'tc').staffId);
    expect(own?.editable).toBe(true);
  });

  it('uses the GLOSSARY C-15 event types for seed and derived items', () => {
    expect([...EVENT_TYPES]).toEqual(['meeting', 'demo', 'follow_up', 'field_visit', 'service_visit', 'internal']);
    getDb().records.calendarEvents.forEach((e) => expect(EVENT_TYPES as readonly string[]).toContain(String(e.eventType)));
    listCalendarItems(actorFor('u_rahul', 'tc')).forEach((i) => expect(EVENT_TYPES as readonly string[]).toContain(i.type));
    expect(EVENT_TYPES.map((k) => masterLabel('calEventType', k))).toEqual(['Meeting', 'Demo', 'Follow-up', 'Field Visit', 'Service Visit', 'Internal']);
    expect(masterLabel('calRecurrence', 'none')).toBe('Does Not Repeat');
    expect(masterLabel('calLinkType', 'tickets')).toBe('Service Ticket');
  });

  it('seeds the stress-test shapes: 20+ in a day, 6 at once, midnight crossing, long title, month-boundary span', () => {
    const ev = getDb().records.calendarEvents;
    const perDay = new Map<string, number>();
    ev.filter((e) => e.recurrence === 'none').forEach((e) => perDay.set(String(e.start).slice(0, 10), (perDay.get(String(e.start).slice(0, 10)) ?? 0) + 1));
    expect(Math.max(...perDay.values())).toBeGreaterThanOrEqual(20);
    const same = new Map<string, number>();
    ev.filter((e) => !e.allDay).forEach((e) => same.set(`${e.assigneeId}|${e.start}`, (same.get(`${e.assigneeId}|${e.start}`) ?? 0) + 1));
    expect(Math.max(...same.values())).toBeGreaterThanOrEqual(6);
    expect(ev.some((e) => !e.allDay && String(e.end).slice(0, 10) > String(e.start).slice(0, 10))).toBe(true);
    expect(ev.some((e) => String(e.title).length > 90)).toBe(true);
    expect(ev.some((e) => e.allDay && String(e.start).slice(0, 7) !== String(e.end).slice(0, 7))).toBe(true);
    expect(ev.some((e) => String(e.start).slice(0, 7) > today().slice(0, 7))).toBe(true);
    expect(ev.some((e) => e.allDay) && ev.some((e) => !e.allDay && String(e.start).slice(0, 10) === today())).toBe(true);
  });

  it('rejects end before start, zero duration and over-long titles; accepts midnight crossing and one-day all-day', () => {
    const d = addDays(today(), 3);
    expect(validateEvent({ title: 'x', start: `${d}T10:00`, end: `${d}T09:00` }, { checkPast: true }).end).toBeTruthy();
    expect(validateEvent({ title: 'x', start: `${d}T10:00`, end: `${d}T10:00` }, { checkPast: true }).end).toBeTruthy();
    expect(validateEvent({ title: 'x'.repeat(121), start: `${d}T10:00`, end: `${d}T11:00` }, { checkPast: true }).title).toBeTruthy();
    expect(validateEvent({ title: '   ', start: `${d}T10:00`, end: `${d}T11:00` }, { checkPast: true }).title).toBeTruthy();
    expect(validateEvent({ title: 'x', start: `${d}T22:00`, end: `${addDays(d, 1)}T02:00` }, { checkPast: true })).toEqual({});
    expect(validateEvent({ title: 'x', start: d, end: d, allDay: true }, { checkPast: true })).toEqual({});
    expect(validateEvent({ title: 'x', start: addDays(d, 2), end: d, allDay: true }, { checkPast: true }).end).toBeTruthy();
  });

  it('edits "this and following": the series ends before it and a new series starts at it', () => {
    const a = rohan();
    const d = addDays(today(), 2);
    const s = createEvent(a, { title: 'Review', eventType: 'meeting', start: `${d}T10:00`, end: `${d}T11:00`, recurrence: 'weekly', recurrenceUntil: addDays(d, 35), assigneeId: a.staffId });
    const third = addDays(d, 14);
    const next = updateFollowing(a, s.id, `${third}T10:00`, { title: 'Review (new room)', start: `${third}T14:00`, end: `${third}T15:00`, allDay: false }, s.version);
    const old = getDb().records.calendarEvents.find((x) => x.id === s.id)!;
    expect(old.recurrenceUntil).toBe(addDays(third, -1));
    expect(next.id).not.toBe(s.id);
    expect(next.title).toBe('Review (new room)');
    expect(next.recurrence).toBe('weekly');
    expect(next.seriesId).toBe(s.id);
    expect(next.recurrenceUntil).toBe(addDays(d, 35));
    const items = listCalendarItems(a).filter((i) => i.id === s.id || i.id === next.id);
    const all = items.flatMap((i) => occurrences(i, `${d}T00:00`, `${addDays(d, 40)}T23:59`).map((o) => o.start)).sort();
    expect(all).toEqual([`${d}T10:00`, `${addDays(d, 7)}T10:00`, `${third}T14:00`, `${addDays(d, 21)}T14:00`, `${addDays(d, 28)}T14:00`, `${addDays(d, 35)}T14:00`]);
  });

  it('"this and following" on the first occurrence edits the whole series; delete-following ends it', () => {
    const a = rohan();
    const d = addDays(today(), 2);
    const s = createEvent(a, { title: 'Sync', eventType: 'meeting', start: `${d}T10:00`, end: `${d}T11:00`, recurrence: 'daily', recurrenceUntil: addDays(d, 10), assigneeId: a.staffId });
    const same = updateFollowing(a, s.id, `${d}T10:00`, { title: 'Sync v2' }, s.version);
    expect(same.id).toBe(s.id);
    const cur = getDb().records.calendarEvents.find((x) => x.id === s.id)!;
    deleteFollowing(a, s.id, `${addDays(d, 4)}T10:00`, cur.version);
    expect(getDb().records.calendarEvents.find((x) => x.id === s.id)!.recurrenceUntil).toBe(addDays(d, 3));
    const again = getDb().records.calendarEvents.find((x) => x.id === s.id)!;
    deleteFollowing(a, s.id, `${d}T10:00`, again.version);
    expect(getDb().records.calendarEvents.find((x) => x.id === s.id)).toBeUndefined();
  });

  it('undo puts a dragged event back, even to a time that is already past', () => {
    const a = rohan();
    const d = addDays(today(), 2);
    const e = createEvent(a, { title: 'Drag me', eventType: 'meeting', start: `${d}T10:00`, end: `${d}T11:00`, assigneeId: a.staffId });
    const past = { start: `${addDays(today(), -1)}T10:00`, end: `${addDays(today(), -1)}T11:00`, allDay: false };
    expect(() => restoreEvent(a, e.id, { start: `${d}T12:00`, end: `${d}T13:00` })).not.toThrow();
    expect(() => createEvent(a, { title: 'Past', eventType: 'meeting', ...past, assigneeId: a.staffId })).toThrow(/past/);
    restoreEvent(a, e.id, past);
    expect(getDb().records.calendarEvents.find((x) => x.id === e.id)!.start).toBe(past.start);
  });

  it('undoes a "this event only" change: the single copy goes and the occurrence returns to the series', () => {
    const a = rohan();
    const d = addDays(today(), 2);
    const s = createEvent(a, { title: 'Weekly', eventType: 'meeting', start: `${d}T10:00`, end: `${d}T11:00`, recurrence: 'weekly', recurrenceUntil: addDays(d, 28), assigneeId: a.staffId });
    const occ = `${addDays(d, 7)}T10:00`;
    const single = updateOccurrence(a, s.id, occ, { start: `${addDays(d, 8)}T15:00`, end: `${addDays(d, 8)}T16:00` }, s.version);
    undoOccurrence(a, s.id, single.id, occ);
    expect(getDb().records.calendarEvents.find((x) => x.id === single.id)).toBeUndefined();
    expect(String(getDb().records.calendarEvents.find((x) => x.id === s.id)!.exdates)).not.toContain(occ);
  });

  it('flags six same-person events at one time as overlapping each other', () => {
    const a = rohan();
    const d = addDays(today(), 7);
    const hits = findOverlaps(a, { start: `${d}T14:00`, end: `${d}T15:00`, allDay: false, assigneeId: a.staffId });
    expect(hits.length).toBeGreaterThanOrEqual(6);
  });

  it('a midnight-crossing event appears on both days', () => {
    const a = actorFor('u_ravi', 'tc');
    const night = listCalendarItems(a).find((i) => i.title === 'Night-shift press trial');
    expect(night).toBeTruthy();
    expect(night!.end.slice(0, 10)).toBe(addDays(night!.start.slice(0, 10), 1));
    expect(occurrences(night!, `${night!.end.slice(0, 10)}T00:00`, `${night!.end.slice(0, 10)}T23:59`)).toHaveLength(1);
  });

  it('every role: create / edit / delete follow the role permission, and read-only roles cannot write', () => {
    const roles = new Map<string, string>();
    demoUsers.forEach((u) => roles.set(actorFor(u.id, 'tc').role.id, u.id));
    expect(roles.size).toBeGreaterThanOrEqual(8);
    const d = addDays(today(), 5);
    roles.forEach((uid, roleId) => {
      const a = actorFor(uid, 'tc');
      const p = perm(a, 'calendarEvents');
      const input = { title: `Role check ${roleId}`, eventType: 'meeting', start: `${d}T10:00`, end: `${d}T11:00`, assigneeId: a.staffId };
      if (p.create) {
        const ev = createEvent(a, input);
        const mine = listCalendarItems(a).find((i) => i.id === ev.id);
        expect(mine?.editable, roleId).toBe(true);
        deleteEvent(a, ev.id);
      } else {
        expect(() => createEvent(a, input), roleId).toThrow();
        expect(listCalendarItems(a).filter((i) => i.source === 'event').every((i) => !i.editable), roleId).toBe(true);
      }
    });
    expect(roles.has('store') || [...roles.keys()].some((r) => !perm(actorFor(roles.get(r)!, 'tc'), 'calendarEvents').create)).toBe(true);
  });

  it('reminder defaults to none and is stored', () => {
    const a = rohan();
    const d = addDays(today(), 4);
    const e = createEvent(a, { title: 'R', eventType: 'meeting', start: `${d}T10:00`, end: `${d}T11:00`, assigneeId: a.staffId, reminder: '1h' });
    expect(listCalendarItems(a).find((i) => i.id === e.id)!.reminder).toBe('1h');
    expect(listCalendarItems(a).find((i) => i.source === 'tasks')?.reminder ?? 'none').toBe('none');
  });
});
