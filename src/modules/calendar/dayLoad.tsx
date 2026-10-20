import type { DayCellContentArg, DayHeaderContentArg } from '@fullcalendar/core';
import { L } from '../../constants/labels';
import { addDays } from '../../lib/dates';
import { cx } from '../../lib/format';
import { wall } from './calendarUtils';

const D = L.calendar.load;
const MONTHS = L.calendar.miniMonth.months;

/** Planned activities per day ("YYYY-MM-DD" → count). Shared by Tasks & Calendar and the Demo Machine Calendar. */
export type DayCounts = Map<string, number>;

/** 0 = nothing, 1 = light (1–2), 2 = busy (3–5), 3 = packed (6+). Drives the cell tint and the badge colour. */
export const loadTier = (n: number) => (n >= 6 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0);

/** Counts every day an item touches within [from, to]; a multi-day item counts once on each day. */
export function countDays(spans: { start: string; end: string }[], from: string, to: string): DayCounts {
  const m: DayCounts = new Map();
  spans.forEach((s) => {
    const last = s.end.slice(0, 10) < s.start.slice(0, 10) ? s.start.slice(0, 10) : s.end.slice(0, 10);
    for (let d = s.start.slice(0, 10) > from ? s.start.slice(0, 10) : from; d <= last && d <= to; d = addDays(d, 1)) m.set(d, (m.get(d) ?? 0) + 1);
  });
  return m;
}

/** Total and busiest day of a month ("YYYY-MM"). */
export function monthSummary(counts: DayCounts, month: string) {
  let total = 0;
  let busiest: { day: string; n: number } | null = null;
  counts.forEach((n, day) => {
    if (!day.startsWith(month)) return;
    total += n;
    if (!busiest || n > busiest.n || (n === busiest.n && day < busiest.day)) busiest = { day, n };
  });
  return { total, busiest: busiest as { day: string; n: number } | null };
}

export const dayLabel = (day: string) => `${+day.slice(8, 10)} ${MONTHS[+day.slice(5, 7) - 1].slice(0, 3)}`;

/** Count badge: a number in the day's corner, light / busy / packed. */
export function CountBadge({ n, className }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span className={cx('cal-daycount', `tier-${loadTier(n)}`, className)} aria-label={D.activities(n)}>
      {n}
    </span>
  );
}

const P = L.calendar.page;
/** FullCalendar Dates carry the IST wall clock in their UTC fields; Monday = 0. */
const weekday = (d: Date) => (d.getUTCDay() + 6) % 7;

/**
 * FullCalendar options for every calendar: quiet month cells (day number only; the 1st also names the month),
 * Google-style week / day headers (small weekday over a large date, today in an accent circle) and
 * agenda date rows (large date, weekday and month, a Today tag). The day number / header links to that day.
 */
export function dayLoadOptions(counts: DayCounts) {
  const countOf = (d: Date) => counts.get(wall(d, true)) ?? 0;
  return {
    navLinks: true,
    dayCellClassNames: (a: DayCellContentArg) => (a.view.type === 'dayGridMonth' ? [`cal-load-${loadTier(countOf(a.date))}`] : []),
    dayCellContent: (a: DayCellContentArg) =>
      a.view.type === 'dayGridMonth' ? (
        <span className="cal-daycell">
          <span className="cal-daynum">{a.date.getUTCDate() === 1 ? `${P.monthsShort[a.date.getUTCMonth()]} 1` : a.dayNumberText}</span>
        </span>
      ) : undefined,
    dayHeaderContent: (a: DayHeaderContentArg) => {
      if (a.view.type.startsWith('timeGrid'))
        return (
          <span className={cx('cal-dh', a.isToday && 'is-today')} aria-label={`${a.text}${countOf(a.date) ? `, ${D.activities(countOf(a.date))}` : ''}`}>
            <span className="cal-dh-dow">{(a.view.type === 'timeGridDay' ? P.weekdaysLong : P.weekdaysShort)[weekday(a.date)]}</span>
            <span className="cal-dh-num">{a.date.getUTCDate()}</span>
          </span>
        );
      if (a.view.type === 'list' || a.view.type === 'agenda')
        return (
          <span className={cx('cal-ad', a.isToday && 'is-today')} id={(a as { textId?: string }).textId}>
            <span className="cal-ad-num">{a.date.getUTCDate()}</span>
            <span className="cal-ad-text">
              <span className="cal-ad-dow">{P.weekdaysLong[weekday(a.date)]}</span>
              <span className="cal-ad-month">
                {MONTHS[a.date.getUTCMonth()]} {a.date.getUTCFullYear()}
              </span>
            </span>
            {a.isToday && <span className="cal-ad-tag">{P.todayTag}</span>}
            {countOf(a.date) > 0 && <span className="cal-ad-count">{D.activities(countOf(a.date))}</span>}
          </span>
        );
      return a.text;
    },
  };
}
