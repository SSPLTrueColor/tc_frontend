import '../domain/extensions/index';
import { actorFor } from '../services/authz';
import { createDb, __setDb, getDb } from '../services/db';
import { createEvent, deleteOccurrence, findOverlaps, listCalendarItems, occurrences, shiftSeries, updateOccurrence, validateEvent } from '../services/calendar/events';
import { setClockOffset } from '../lib/clock';
import { istNow } from '../lib/clock';
import { addDays } from '../lib/dates';

describe('calendar', () => {
  beforeEach(() => {
    setClockOffset(0);
    __setDb(createDb());
  });
  const today = () => istNow().slice(0, 10);
  const rohan = () => actorFor('u_rohan', 'tc');

  it('seeds 40+ events incl. all-day, multi-day, recurring, past and today', () => {
    const ev = getDb().records.calendarEvents;
    expect(ev.length).toBeGreaterThanOrEqual(40);
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
});
