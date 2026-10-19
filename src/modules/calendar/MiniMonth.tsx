import { useState } from 'react';
import { addDays } from '../../lib/dates';
import { cx } from '../../lib/format';
import { IconButton } from '../../components/primitives/Button';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const ym = (d: string) => d.slice(0, 7);
const shiftMonth = (month: string, n: number) => {
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
};

/** Six Monday-first weeks covering a month. */
function weeksOf(month: string): string[][] {
  const first = `${month}-01`;
  const dow = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -dow);
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

/**
 * Mini month (left panel): Monday-first, today ringed, the main calendar's date filled, a dot on days
 * that have events. Clicking a day moves the main calendar there.
 */
export function MiniMonth({ selected, today, marked, onPick }: { selected: string; today: string; marked: Set<string>; onPick: (day: string) => void }) {
  const [month, setMonth] = useState(ym(selected));
  const [lastSelected, setLastSelected] = useState(selected);
  if (lastSelected !== selected) {
    setLastSelected(selected);
    if (ym(selected) !== month) setMonth(ym(selected));
  }
  return (
    <div className="mini-month" aria-label="Pick a date">
      <div className="mini-month-head">
        <strong>
          {MONTHS[+month.slice(5, 7) - 1]} {month.slice(0, 4)}
        </strong>
        <span className="spacer" />
        <IconButton icon="chevron-left" label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} />
        <IconButton icon="chevron-right" label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} />
      </div>
      <div className="mini-month-grid" role="grid">
        {WEEKDAYS.map((d) => (
          <span key={d} className="mini-month-dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {weeksOf(month)
          .flat()
          .map((day) => (
            <button
              key={day}
              type="button"
              className={cx('mini-month-day', ym(day) !== month && 'is-outside', day === today && 'is-today', day === selected && 'is-selected')}
              aria-label={`${+day.slice(8, 10)} ${MONTHS[+day.slice(5, 7) - 1]} ${day.slice(0, 4)}${marked.has(day) ? ', has events' : ''}`}
              aria-current={day === today ? 'date' : undefined}
              onClick={() => onPick(day)}
            >
              {+day.slice(8, 10)}
              {marked.has(day) && <span className="mini-month-dot" aria-hidden="true" />}
            </button>
          ))}
      </div>
    </div>
  );
}
