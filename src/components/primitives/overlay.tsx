import { TextField } from './controls';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../lib/format';
import { Button } from './Button';
import { Icon } from './Icon';
import { L } from '../../constants/labels';

// ---------------------------------------------------------------- layer stack
// Escape closes only the topmost layer (§1.5).
const stack: string[] = [];
const handlers = new Map<string, () => void>();
let listening = false;

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !stack.length) return;
  const top = stack[stack.length - 1];
  const h = handlers.get(top);
  if (h) {
    e.preventDefault();
    e.stopPropagation();
    h();
  }
}

/** Open popovers in the order they opened (a dropdown inside a panel comes after the panel). */
const openPopovers: RefObject<HTMLDivElement | null>[] = [];

export function useLayer(open: boolean, onClose: () => void) {
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    if (!listening) {
      document.addEventListener('keydown', onKey, true);
      listening = true;
    }
    stack.push(id);
    handlers.set(id, () => closeRef.current());
    return () => {
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
      handlers.delete(id);
    };
  }, [open, id]);
}

/** True when any overlay layer (dialog, drawer, popover) is open. */
export const hasOpenLayer = () => stack.length > 0;

/** Save focus on open; restore it to the invoking control on close. */
export function useFocusReturn(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    return () => {
      if (prev && document.contains(prev)) setTimeout(() => prev.focus(), 0);
    };
  }, [open]);
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap(ref: RefObject<HTMLElement>, open: boolean) {
  useEffect(() => {
    if (!open || !ref.current) return;
    const el = ref.current;
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelectorAll<HTMLElement>(FOCUSABLE)[0];
    (first ?? el).focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const a = items[0];
      const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    el.addEventListener('keydown', trap);
    return () => el.removeEventListener('keydown', trap);
  }, [open, ref]);
}

// ---------------------------------------------------------------- dialog

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  role?: 'dialog' | 'alertdialog';
  /** Controls on the right of the header (e.g. Simple | Canvas, Drawer | Popup). */
  headerExtra?: ReactNode;
}

export function Dialog({ open, onClose, title, description, children, footer, size = 'md', role = 'dialog', headerExtra }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useLayer(open, onClose);
  useFocusReturn(open);
  useFocusTrap(ref, open);
  if (!open) return null;
  return createPortal(
    <div className="overlay-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={cx('dialog', `dialog-${size}`)} role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} tabIndex={-1}>
        <header className="dialog-header">
          <div className="dialog-title-row">
            <h2 id={titleId} className="dialog-title">
              {title}
            </h2>
            {/* no ⓘ next to popup titles (owner rule) — description is screen-reader text */}
            {description && <span className="sr-only">{description}</span>}
            {description && (
              <span id={descId} className="sr-only">
                {description}
              </span>
            )}
          </div>
          {headerExtra}
          {/* Owner rule: popups have no × icon — they close with the footer Cancel button (or Esc / scrim click).
          <IconButton icon="x" label="Close dialog" onClick={onClose} /> */}
        </header>
        <div className="dialog-body">{children}</div>
        <footer className="dialog-footer">{footer ?? <Button onClick={onClose}>{L.common.actions.cancel}</Button>}</footer>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- drawer (modal side sheet for forms)

// ---------------------------------------------------------------- confirm before delete (shared)

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  /** `danger` (default) = red button for deleting / discarding; `primary` = a normal yes / no question. */
  tone?: 'danger' | 'primary';
  /** Irreversible actions: the confirm button stays disabled until this exact word is typed. */
  typedWord?: string;
  /** May be async: the button shows a spinner and the dialog closes when it finishes (it stays open if it throws). */
  onConfirm: () => void | Promise<unknown>;
}
let pushConfirm: ((o: ConfirmOptions) => void) | null = null;

/**
 * The one confirmation dialog. Anything that deletes, removes, discards or cannot be undone asks first:
 * "Cancel" (focused) + a confirm button. Call `confirmDelete({...})` from any click handler.
 * Use `typedWord` for the worst cases (reset all data, sign out everywhere).
 */
export function confirmDelete(o: ConfirmOptions) {
  if (pushConfirm) pushConfirm(o);
  else if (!o.typedWord && window.confirm(`${o.title}\n\n${o.message}`)) void o.onConfirm();
}
export const confirmAction = confirmDelete;

/** Mounted once in App (next to TooltipLayer). */
export function ConfirmHost() {
  const [cur, setCur] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    pushConfirm = (o) => {
      setTyped('');
      setCur(o);
    };
    return () => {
      pushConfirm = null;
    };
  }, []);
  const close = () => {
    if (!inFlight.current) setCur(null);
  };
  const ok = !cur?.typedWord || typed.trim() === cur.typedWord;
  const run = async () => {
    if (!cur || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await cur.onConfirm();
      inFlight.current = false;
      setCur(null);
    } catch {
      /* the caller reports the failure; the dialog stays open so nothing is lost */
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!cur}
      onClose={close}
      title={cur?.title ?? ''}
      size="sm"
      role="alertdialog"
      footer={
        <>
          <Button onClick={close} data-autofocus>
            {L.common.actions.cancel}
          </Button>
          <Button variant={cur?.tone === 'primary' ? 'primary' : 'danger'} loading={busy} disabledReason={ok ? undefined : L.common.confirm.typeToConfirm(cur?.typedWord ?? '')} onClick={run}>
            {cur?.confirmLabel ?? (cur?.tone === 'primary' ? L.common.actions.confirm : L.common.actions.delete)}
          </Button>
        </>
      }
    >
      {cur?.message && <p>{cur.message}</p>}
      {cur?.typedWord && (
        <div className="form-field">
          <label className="field-label" htmlFor="confirm-typed">
            {L.common.confirm.typeToConfirm(cur.typedWord)}
          </label>
          <TextField id="confirm-typed" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
      )}
    </Dialog>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
  headerExtra,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Controls on the right of the drawer header (e.g. the Simple | Canvas layout switch). */
  headerExtra?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useLayer(open, onClose);
  useFocusReturn(open);
  useFocusTrap(ref, open);
  if (!open) return null;
  return createPortal(
    <div className="overlay-scrim overlay-scrim-drawer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={cx('drawer', wide && 'drawer-wide')} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="dialog-header">
          <div className="dialog-title-row">
            <h2 id={titleId} className="dialog-title">
              {title}
            </h2>
            {/* no ⓘ next to popup titles (owner rule) — description is screen-reader text */}
            {description && <span className="sr-only">{description}</span>}
          </div>
          {headerExtra}
          {/* Owner rule: side drawers have no × icon — they close with the footer Cancel button (or Esc / scrim click).
          <IconButton icon="x" label="Close panel" onClick={onClose} /> */}
        </header>
        <div className="drawer-body">{children}</div>
        <footer className="dialog-footer">{footer ?? <Button onClick={onClose}>{L.common.actions.cancel}</Button>}</footer>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- popover (anchored, flips)

export function Popover({
  open,
  onClose,
  anchor,
  children,
  label,
  width,
  align = 'start',
  side = 'bottom',
  className,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement>;
  children: ReactNode;
  label: string;
  width?: number;
  align?: 'start' | 'end';
  /** 'right' opens beside the anchor (used by icon-rail buttons), bottom-aligned to it and kept on screen. */
  side?: 'bottom' | 'right';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  useLayer(open, onClose);
  useFocusReturn(open);

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    const el = ref.current;
    if (!a || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (side === 'right') {
      const top = Math.min(Math.max(8, a.bottom - h), vh - h - 8);
      setPos({ top, left: Math.min(a.right + 8, vw - w - 8), maxH: vh - 16 });
      return;
    }
    const below = vh - a.bottom - 8;
    const above = a.top - 8;
    const flip = h > below && above > below;
    const top = flip ? Math.max(8, a.top - 4 - Math.min(h, above)) : a.bottom + 4;
    let left = align === 'end' ? a.right - w : a.left;
    left = Math.min(Math.max(8, left), vw - w - 8);
    setPos({ top, left, maxH: Math.max(160, (flip ? above : below) - 4) });
  }, [anchor, align, side]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    // Re-place whenever the panel itself changes size (e.g. switching to a wider mode),
    // so it always stays fully inside the viewport.
    const ro = typeof ResizeObserver !== 'undefined' && ref.current ? new ResizeObserver(place) : null;
    if (ro && ref.current) ro.observe(ref.current);
    // …and when the anchor changes size (e.g. a chip control that wraps to a second line while its list is open).
    if (ro && anchor.current) ro.observe(anchor.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      ro?.disconnect();
    };
  }, [open, place, width, anchor]);

  // Keep the latest onClose in a ref: callers usually pass an inline arrow, and re-registering on every render would
  // move this popover to the end of `openPopovers` — then a click inside a child popover (opened from this one)
  // would count as "outside" and close the parent mid-edit.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    openPopovers.push(ref);
    const onClose = () => closeRef.current();
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      // Ignore clicks inside a popover opened *after* this one (e.g. a dropdown opened from this panel).
      // A click in the parent panel or in a sibling dropdown is "outside", so only one dropdown stays open.
      const host = (t as HTMLElement).closest?.('.popover');
      const mine = openPopovers.indexOf(ref);
      if (host && openPopovers.findIndex((r) => r.current === host) > mine) return;
      onClose();
    };
    document.addEventListener('mousedown', down);
    return () => {
      document.removeEventListener('mousedown', down);
      const i = openPopovers.indexOf(ref);
      if (i >= 0) openPopovers.splice(i, 1);
    };
  }, [open, anchor]);

  useEffect(() => {
    if (open && ref.current) {
      const first = ref.current.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={cx('popover', className)}
      role="dialog"
      aria-label={label}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, maxHeight: pos?.maxH }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- menu

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  onSelect: () => void;
  danger?: boolean;
  disabledReason?: string;
  separatorBefore?: boolean;
}

export function Menu({ open, onClose, anchor, items, label, align = 'end' }: { open: boolean; onClose: () => void; anchor: RefObject<HTMLElement>; items: MenuItem[]; label: string; align?: 'start' | 'end' }) {
  const listRef = useRef<HTMLDivElement>(null);
  const move = (dir: 1 | -1) => {
    const els = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    els[(i + dir + els.length) % els.length]?.focus();
  };
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} label={label} align={align} width={220}>
      <div
        ref={listRef}
        role="menu"
        aria-label={label}
        className="menu"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            move(1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            move(-1);
          }
        }}
      >
        {items.map((it) => (
          <div key={it.id}>
            {it.separatorBefore && <div className="menu-sep" role="separator" />}
            <button
              type="button"
              role="menuitem"
              className={cx('menu-item', it.danger && 'is-danger')}
              disabled={!!it.disabledReason}
              data-tooltip={it.disabledReason}
              onClick={() => {
                onClose();
                it.onSelect();
              }}
            >
              {it.icon && <span className="menu-icon"><Icon name={it.icon} /></span>}
              <span className="menu-label">
                {it.label}
                {/* Reason lives in the tooltip only (no duplicate visible text); screen readers still get it. */}
                {it.disabledReason && <span className="sr-only">. Unavailable: {it.disabledReason}</span>}
              </span>
            </button>
          </div>
        ))}
      </div>
    </Popover>
  );
}
