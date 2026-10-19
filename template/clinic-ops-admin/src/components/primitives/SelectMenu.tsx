import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '../../lib/format';
import { Icon } from './Icon';
import { Popover } from './overlay';

export interface SelectMenuOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * THE dropdown for the whole project (owner rule: no native <select>).
 * Trigger button + listbox popover; flips up near the bottom; selected option = accent tint + ✓.
 * Keyboard: Enter/Space/↑/↓ open, ↑/↓ move, Enter selects, Esc closes, typing jumps (or searches
 * when the list is long). `block` = full-width form control; otherwise compact toolbar size.
 */
export function SelectMenu<T extends string | number>({
  value,
  options,
  onChange,
  label,
  id,
  placeholder = 'Select…',
  disabled,
  invalid,
  describedBy,
  block,
  className,
  searchable,
}: {
  value: T | '' | null | undefined;
  options: SelectMenuOption<T>[];
  onChange: (v: T) => void;
  /** Accessible name (also used when no visible <label htmlFor>). */
  label: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  block?: boolean;
  className?: string;
  /** Show a search box; defaults to on for lists longer than 8. */
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);
  const withSearch = searchable ?? options.length > 8;
  const shown = useMemo(() => (q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options), [q, options]);

  const openMenu = () => {
    if (disabled) return;
    setQ('');
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (o: SelectMenuOption<T> | undefined) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' || (e.key === ' ' && !withSearch)) {
      e.preventDefault();
      choose(shown[active]);
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (!withSearch && e.key.length === 1) {
      const i = shown.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        className={cx('select-menu-trigger', block && 'is-block', open && 'is-open', !current && 'is-placeholder', className)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${current?.label ?? placeholder}`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        <span className="select-menu-value">{current?.label ?? placeholder}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={trigger} label={label} align="start" className="select-menu-pop" width={block ? trigger.current?.offsetWidth : undefined}>
        {withSearch && (
          <input
            className="input input-compact select-menu-search"
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
        )}
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
          tabIndex={withSearch ? -1 : 0}
          data-autofocus={withSearch ? undefined : true}
          className="select-menu-list"
          onKeyDown={onKey}
        >
          {shown.map((o, i) => (
            <li
              key={String(o.value)}
              id={`${listId}-${i}`}
              data-index={i}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              className={cx('select-menu-option', o.value === value && 'is-selected', i === active && 'is-active', o.disabled && 'is-disabled')}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(o)}
            >
              <span>{o.label}</span>
              {o.value === value && <Icon name="check" size={14} />}
            </li>
          ))}
          {!shown.length && <li className="select-menu-empty muted">No matches</li>}
        </ul>
      </Popover>
    </>
  );
}
