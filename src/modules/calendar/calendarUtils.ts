import type { EventInput } from '@fullcalendar/core';
import { addDays } from '../../lib/dates';
import type { CalItem } from '../../services/calendar/events';

export type ViewId = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'agenda';

const FREQ = { daily: 'daily', weekly: 'weekly', monthly: 'monthly' } as const;

/** With a named time zone and no zone plugin, FullCalendar Dates are "UTC-coerced": their UTC fields are the IST wall clock. */
export const wall = (d: Date | null, allDay: boolean) => (d ? d.toISOString().slice(0, allDay ? 10 : 16) : '');
export const minutes = (a: string, b: string) => (Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60_000;
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Template time format "02:30 PM" (FullCalendar hands over IST wall-clock parts). */
export const clock12 = (a: { date: { hour: number; minute: number } }) => `${String(a.date.hour % 12 || 12).padStart(2, '0')}:${String(a.date.minute).padStart(2, '0')} ${a.date.hour < 12 ? 'AM' : 'PM'}`;
/** Compact time for event chips: "11 AM", "2:30 PM". */
export const clockShort = (a: { date: { hour: number; minute: number } }) => `${a.date.hour % 12 || 12}${a.date.minute ? `:${String(a.date.minute).padStart(2, '0')}` : ''} ${a.date.hour < 12 ? 'AM' : 'PM'}`;

export function toFc(i: CalItem): EventInput {
  const base: EventInput = {
    id: i.id,
    title: i.title,
    allDay: i.allDay,
    editable: i.editable && i.status !== 'cancelled',
    classNames: [`ev-${i.type}`, `is-${i.status}`, i.editable ? 'is-editable' : 'is-readonly', // all-day or across midnight → drawn as a bar in the month grid
      ...(i.allDay || i.start.slice(0, 10) !== i.end.slice(0, 10) ? ['is-bar'] : [])],
    extendedProps: { item: i, rank: i.source !== 'event' ? 1 : i.recurrence === 'daily' ? 2 : 0 },
  };
  if (i.recurrence === 'none') return { ...base, start: i.start, end: i.allDay ? addDays(i.end, 1) : i.end };
  const days = i.allDay ? minutes(`${i.start}T00:00`, `${i.end}T00:00`) / 1440 + 1 : 0;
  return {
    ...base,
    rrule: { freq: FREQ[i.recurrence], dtstart: i.allDay ? i.start : `${i.start}:00`, until: i.recurrenceUntil ?? undefined },
    duration: i.allDay ? { days } : hhmm(minutes(i.start, i.end)),
    exdate: i.exdates.map((x) => (i.allDay ? x.slice(0, 10) : `${x.slice(0, 16)}:00`)),
  };
}

/** Full text for tooltips / screen readers: title, linked record when not already in the title. */
export const fullText = (i: CalItem) => (i.linkLabel && !i.title.includes(i.linkLabel.split(' · ').pop() ?? '') ? `${i.title} · ${i.linkLabel}` : i.title);

/** Case-insensitive match over the text a user would search for. */
export const matches = (i: CalItem, q: string) => {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return [i.title, i.linkLabel, i.location, i.notes, i.id].some((x) => !!x && x.toLowerCase().includes(n));
};
