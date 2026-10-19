import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { addDays, formatDate, formatTime, parseLocal, toDateKey, todayKey } from '../../lib/dates';
import { cx } from '../../lib/format';
import { Button, IconButton } from './Button';
import { Icon } from './Icon';
import { Popover } from './overlay';
import { SelectMenu } from './SelectMenu';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * THE date picker for the whole project (owner rule: no native date/datetime inputs).
 * Value: "YYYY-MM-DD" or, with `withTime`, "YYYY-MM-DDTHH:mm" (clinic local time).
 * Calendar popover: ‹ month › navigation, Monday-first grid, today ring, selected accent fill.
 * Keyboard: ←/→ day, ↑/↓ week, PageUp/PageDown month, Home/End week start/end, Enter select, Esc close.
 */
export function DatePicker({
  value,
  onChange,
  label,
  id,
  withTime = false,
  placeholder,
  invalid,
  describedBy,
  disabled,
  block,
  clearable = true,
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  label: string;
  id?: string;
  withTime?: boolean;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  block?: boolean;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dateKey = value ? value.slice(0, 10) : '';
  const time = value && withTime ? value.slice(11, 16) || '09:00' : '09:00';
  const [focusKey, setFocusKey] = useState(dateKey || todayKey());
  const [month, setMonth] = useState(() => (dateKey || todayKey()).slice(0, 7)); // "YYYY-MM"

  useEffect(() => {
    if (!open) return;
    const k = dateKey || todayKey();
    setFocusKey(k);
    setMonth(k.slice(0, 7));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) gridRef.current?.querySelector<HTMLElement>(`[data-day="${focusKey}"]`)?.focus();
  }, [focusKey, open, month]);

  const emit = (d: string, t = time) => onChange(withTime ? `${d}T${t}` : d);
  const pick = (d: string) => {
    emit(d);
    if (!withTime) {
      setOpen(false);
      trigger.current?.focus();
    }
  };
  const moveFocus = (k: string) => {
    setFocusKey(k);
    setMonth(k.slice(0, 7));
  };
  const shiftMonth = (k: string, n: number) => {
    const d = parseLocal(k);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return toDateKey(d);
  };
  const onGridKey = (e: KeyboardEvent) => {
    const map: Record<string, () => string> = {
      ArrowLeft: () => addDays(focusKey, -1),
      ArrowRight: () => addDays(focusKey, 1),
      ArrowUp: () => addDays(focusKey, -7),
      ArrowDown: () => addDays(focusKey, 7),
      PageUp: () => shiftMonth(focusKey, -1),
      PageDown: () => shiftMonth(focusKey, 1),
      Home: () => addDays(focusKey, -parseLocal(focusKey).getDay()),
      End: () => addDays(focusKey, 6 - parseLocal(focusKey).getDay()),
    };
    if (map[e.key]) {
      e.preventDefault();
      moveFocus(map[e.key]());
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(focusKey);
    }
  };

  // 6-week, Sunday-first grid for the visible month
  const first = parseLocal(`${month}-01`);
  const start = addDays(`${month}-01`, -first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = todayKey();

  const [hh, mm] = time.split(':').map(Number);
  const h12 = hh % 12 || 12;
  const ampm = hh < 12 ? 'AM' : 'PM';
  const setTime = (h: number, m: number, ap: string) => {
    const H = (h % 12) + (ap === 'PM' ? 12 : 0);
    emit(dateKey || today, `${pad(H)}:${pad(m)}`);
  };

  const display = value ? (withTime ? `${formatDate(value)} ${formatTime(value)}` : formatDate(value)) : placeholder ?? (withTime ? 'Select date & time' : 'Select date');

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        className={cx('select-menu-trigger date-trigger', block && 'is-block', open && 'is-open', !value && 'is-placeholder')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${value ? display : 'not set'}`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="calendar" size={14} />
        <span className="select-menu-value">{display}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={trigger} label={`${label} calendar`} width={withTime ? 300 : 280} className="date-pop">
        <div className="dp-head">
          <IconButton icon="chevron-left" label="Previous month" onClick={() => moveFocus(shiftMonth(focusKey, -1))} />
          <strong aria-live="polite">
            {MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}
          </strong>
          <IconButton icon="chevron-right" label="Next month" onClick={() => moveFocus(shiftMonth(focusKey, 1))} />
        </div>
        <div className="dp-weekdays" aria-hidden="true">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div ref={gridRef} className="dp-days" role="grid" aria-label={`${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`} onKeyDown={onGridKey}>
          {days.map((d) => (
            <button
              key={d}
              type="button"
              role="gridcell"
              data-day={d}
              tabIndex={d === focusKey ? 0 : -1}
              aria-selected={d === dateKey}
              aria-label={formatDate(d)}
              aria-current={d === today ? 'date' : undefined}
              className={cx('dp-day', d.slice(0, 7) !== month && 'is-outside', d === today && 'is-today', d === dateKey && 'is-selected')}
              onClick={() => pick(d)}
            >
              {Number(d.slice(8, 10))}
            </button>
          ))}
        </div>
        {withTime && (
          <div className="dp-time">
            <span className="field-label">Time</span>
            <SelectMenu label="Hour" value={String(h12)} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: pad(i + 1) }))} onChange={(v) => setTime(Number(v), mm, ampm)} searchable={false} />
            <SelectMenu label="Minute" value={String(mm - (mm % 5))} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i * 5), label: pad(i * 5) }))} onChange={(v) => setTime(h12, Number(v), ampm)} searchable={false} />
            <SelectMenu label="AM or PM" value={ampm} options={[{ value: 'AM', label: 'AM' }, { value: 'PM', label: 'PM' }]} onChange={(v) => setTime(h12, mm, v)} />
          </div>
        )}
        <div className="dp-foot">
          <Button variant="ghost" onClick={() => pick(today)}>
            Today
          </Button>
          <span className="spacer" />
          {clearable && value && (
            <Button
              variant="ghost"
              onClick={() => {
                onChange(null);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              Clear
            </Button>
          )}
          {withTime && (
            <Button
              variant="primary"
              onClick={() => {
                if (!value) emit(focusKey);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              Done
            </Button>
          )}
        </div>
      </Popover>
    </>
  );
}
