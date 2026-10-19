import { useEffect, useRef, useState } from 'react';
import { addDays, formatDate, parseLocal, todayKey } from '../../lib/dates';
import { cx } from '../../lib/format';
import { PHONE, useMedia } from '../../lib/useMedia';
import { IconButton } from './Button';
import { Icon } from './Icon';
import { Popover } from './overlay';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS_SUN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export interface DateRange {
  from?: string;
  to?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** "YYYY-MM" shifted by n months. */
export const shiftMonthKey = (ym: string, n: number) => {
  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
/** Sunday-first weeks covering the month — only as many rows as the month needs. */
export function monthWeeks(ym: string): string[] {
  const first = parseLocal(`${ym}-01`);
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = first.getDay();
  const rows = Math.ceil((lead + daysIn) / 7);
  const start = addDays(`${ym}-01`, -lead);
  return Array.from({ length: rows * 7 }, (_, i) => addDays(start, i));
}
export const monthTitle = (ym: string) => `${MONTHS_SHORT[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/**
 * Date range picker (shared): two months side by side (one on phones), « ‹ on the left, › » on
 * the right (month / year steps), Sunday-first weeks, round day cells, today ringed.
 * First click sets the start, second click the end (swapped if earlier); hover previews the range.
 */
export function DateRangePicker({ value, onChange, label, id }: { value: DateRange; onChange: (v: DateRange) => void; label: string; id?: string }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [left, setLeft] = useState(() => (value.from || todayKey()).slice(0, 7));
  const trigger = useRef<HTMLButtonElement>(null);
  const phone = useMedia(PHONE);
  useEffect(() => {
    if (open) setLeft((value.from || todayKey()).slice(0, 7));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayKey();
  const picking = value.from && !value.to;
  const endPreview = picking ? hover ?? undefined : value.to;
  const lo = value.from && endPreview ? (value.from < endPreview ? value.from : endPreview) : value.from;
  const hi = value.from && endPreview ? (value.from < endPreview ? endPreview : value.from) : undefined;

  const pick = (d: string) => {
    if (!value.from || value.to) onChange({ from: d, to: undefined });
    else {
      const [a, b] = d < value.from ? [d, value.from] : [value.from, d];
      onChange({ from: a, to: b });
      setOpen(false);
      trigger.current?.focus();
    }
  };

  const months = phone ? [left] : [left, shiftMonthKey(left, 1)];
  const text = value.from ? `${formatDate(value.from)} – ${value.to ? formatDate(value.to) : '…'}` : 'Select date range';

  // plain render function (not a component) so hover re-renders don't remount the day buttons
  const renderMonth = (ym: string, first: boolean, last: boolean) => (
    <div key={ym} className="dr-month">
      <div className="dr-head">
        <span className="dr-nav">
          {first && (
            <>
              <IconButton icon="chevrons-left" label="Previous year" onClick={() => setLeft(shiftMonthKey(left, -12))} />
              <IconButton icon="chevron-left" label="Previous month" onClick={() => setLeft(shiftMonthKey(left, -1))} />
            </>
          )}
        </span>
        <strong aria-live="polite">{monthTitle(ym)}</strong>
        <span className="dr-nav dr-nav-end">
          {last && (
            <>
              <IconButton icon="chevron-right" label="Next month" onClick={() => setLeft(shiftMonthKey(left, 1))} />
              <IconButton icon="chevrons-right" label="Next year" onClick={() => setLeft(shiftMonthKey(left, 12))} />
            </>
          )}
        </span>
      </div>
      <div className="dr-grid dr-weekdays" aria-hidden="true">
        {WEEKDAYS_SUN.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="dr-grid" role="grid" aria-label={monthTitle(ym)}>
        {monthWeeks(ym).map((d) => {
          const outside = d.slice(0, 7) !== ym;
          const inRange = !outside && lo && hi && d > lo && d < hi;
          const edge = !outside && (d === lo || d === hi || d === value.from);
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              aria-selected={!!(inRange || edge)}
              aria-label={formatDate(d)}
              aria-current={d === today ? 'date' : undefined}
              className={cx('dr-day', outside && 'is-outside', d === today && 'is-today', inRange && 'is-in-range', edge && 'is-edge', edge && d === lo && hi && 'is-start', edge && d === hi && 'is-end')}
              onMouseEnter={() => setHover(d)}
              onFocus={() => setHover(d)}
              onClick={() => pick(d)}
            >
              <span>{Number(d.slice(8, 10))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        className={cx('select-menu-trigger date-trigger is-block', open && 'is-open', !value.from && 'is-placeholder')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${value.from ? text : 'any date'}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="calendar" size={14} />
        <span className="select-menu-value">{text}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={trigger} label={`${label} range`} width={phone ? 300 : 600} className="dr-pop">
        <div className="dr-months" onMouseLeave={() => setHover(null)}>
          {months.map((ym, i) => renderMonth(ym, i === 0, i === months.length - 1))}
        </div>
        {value.from && (
          <div className="dr-foot">
            <span className="muted">{picking ? 'Pick the end date' : text}</span>
            <button
              type="button"
              className="multi-clear"
              onClick={() => {
                onChange({});
                setOpen(false);
              }}
            >
              Clear
            </button>
          </div>
        )}
      </Popover>
    </>
  );
}
