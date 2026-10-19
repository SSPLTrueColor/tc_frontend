import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '../../lib/format';
import { Icon } from './Icon';
import { OverflowChips } from './OverflowChips';
import { Popover } from './overlay';

export interface MultiOption {
  value: string;
  label: string;
}

/**
 * Multi-select dropdown (shared): trigger like SelectMenu; the popover has a search box at the top,
 * then a "Select all" row with its own checkbox (checked / partial dash / empty), then a CHECKBOX per
 * option. It stays open while toggling.
 * Trigger text: empty → `emptyLabel`; one → its label; several → "A, B" or "N selected".
 * Keyboard: ↑/↓ move, Space/Enter toggle, Esc close.
 */
export function MultiSelectMenu({
  values,
  options,
  onChange,
  label,
  id,
  emptyLabel = 'Select…',
  block,
  invalid,
  describedBy,
  disabled,
}: {
  values: string[];
  options: MultiOption[];
  onChange: (v: string[]) => void;
  label: string;
  id?: string;
  emptyLabel?: string;
  block?: boolean;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = new Set(values);
  const shown = useMemo(() => (q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options), [q, options]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    // keep option order stable
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
  };
  // "Select all" acts on the options currently shown (respects the search).
  const shownOn = shown.filter((o) => selected.has(o.value)).length;
  const allState = !shown.length || shownOn === 0 ? 'none' : shownOn === shown.length ? 'all' : 'some';
  const toggleAll = () => {
    const next = new Set(selected);
    if (allState === 'all') shown.forEach((o) => next.delete(o.value));
    else shown.forEach((o) => next.add(o.value));
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(shown.length, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active === 0) toggleAll();
      else if (shown[active - 1]) toggle(shown[active - 1].value);
    } else if (e.key === 'Tab') setOpen(false);
  };

  const labels = options.filter((o) => selected.has(o.value)).map((o) => o.label);
  const text = !labels.length ? emptyLabel : labels.length <= 2 ? labels.join(', ') : `${labels.length} selected`;

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        className={cx('select-menu-trigger', block && 'is-block', open && 'is-open', !labels.length && 'is-placeholder')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${labels.length ? labels.join(', ') : emptyLabel}`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => {
          setQ('');
          setActive(0);
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {labels.length ? (
          <span className="multi-chips" aria-hidden="true">
            <OverflowChips items={labels} label={label} tone="accent" interactive={false} />
          </span>
        ) : (
          <span className="select-menu-value">{text}</span>
        )}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={trigger} label={label} align="start" className="select-menu-pop" width={block ? trigger.current?.offsetWidth : 240}>
        <div className="multi-search">
          <Icon name="search" size={14} />
          <input
            placeholder="Search…"
            aria-label={`Search ${label}`}
            value={q}
            data-autofocus
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
          />
        </div>
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          aria-activedescendant={`${listId}-${active}`}
          tabIndex={-1}
          className="select-menu-list"
          onKeyDown={onKey}
          // Clicking options keeps the cursor in the search box, so you can keep typing.
          onMouseDown={(e) => e.preventDefault()}
        >
          {shown.length > 0 && (
            <li
              id={`${listId}-0`}
              data-index={0}
              role="option"
              aria-selected={allState === 'all'}
              aria-checked={allState === 'some' ? 'mixed' : allState === 'all'}
              className={cx('select-menu-option multi-option multi-all', active === 0 && 'is-active')}
              onMouseEnter={() => setActive(0)}
              onClick={toggleAll}
            >
              <span className={cx('multi-box', allState !== 'none' && 'is-on')} aria-hidden="true">
                {allState === 'all' && <Icon name="check" size={12} />}
                {allState === 'some' && <span className="multi-dash" />}
              </span>
              <span>{allState === 'all' ? 'Deselect all' : 'Select all'}</span>
            </li>
          )}
          {shown.length > 0 && <li className="multi-divider" role="presentation" />}
          {shown.map((o, i) => {
            const on = selected.has(o.value);
            const idx = i + 1;
            return (
              <li
                key={o.value}
                id={`${listId}-${idx}`}
                data-index={idx}
                role="option"
                aria-selected={on}
                className={cx('select-menu-option multi-option', on && 'is-checked', idx === active && 'is-active')}
                onMouseEnter={() => setActive(idx)}
                onClick={() => toggle(o.value)}
              >
                <span className={cx('multi-box', on && 'is-on')} aria-hidden="true">
                  {on && <Icon name="check" size={12} />}
                </span>
                <span>{o.label}</span>
              </li>
            );
          })}
          {!shown.length && <li className="select-menu-empty muted">No matches</li>}
        </ul>
        {values.length > 0 && (
          <div className="multi-foot">
            <span className="muted">{values.length} selected</span>
            <button type="button" className="multi-clear" onClick={() => onChange([])}>
              Clear all
            </button>
          </div>
        )}
      </Popover>
    </>
  );
}
