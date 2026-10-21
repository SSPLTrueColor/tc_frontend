import { PageHeader } from '../shell/PageHeader';
import { pageTitleForPath } from '../../lib/pageTitle';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import type { Tone } from '../../metadata/types';
import { cx } from '../../lib/format';
import { isMasked, maskSensitive, type SensitiveFieldType } from '../../lib/phiMask';
import { Button } from './Button';
import { Icon } from './Icon';
import { Menu } from './overlay';
import { EmptyValue } from './display';
import { L } from '../../constants/labels';

// ---------------------------------------------------------------- status chip (text + dot; never color-only)

export function StatusChip({ label, tone = 'neutral', className }: { label: string; tone?: Tone; className?: string }) {
  if (!label) return null;
  return (
    // Attio-style soft pill: tinted background + coloured text, no dot (owner rule)
    <span className={cx('chip', `tone-${tone}`, className)}>
      <span className="chip-label">{label}</span>
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={cx('badge', `tone-${tone}`)}>{children}</span>;
}

export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');
  const hue = [...name].reduce((h, c) => (h + c.charCodeAt(0) * 7) % 360, 0);
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: 'var(--fs-supportive)', ['--avatar-h' as string]: hue }} aria-hidden="true">
      {initials}
    </span>
  );
}

// ---------------------------------------------------------------- states

export function EmptyState({ icon = 'inbox', title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state">
      <span className="state-icon">
        <Icon name={icon} size={20} />
      </span>
      <p className="state-title">{title}</p>
      {children && <p className="state-text">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = L.common.states.somethingWrong, children, onRetry }: { title?: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <span className="state-icon tone-danger">
        <Icon name="alert" size={20} />
      </span>
      <p className="state-title">{title}</p>
      {children && <p className="state-text">{children}</p>}
      {onRetry && (
        <Button icon="reset" onClick={onRetry}>
          {L.common.actions.retry}
        </Button>
      )}
    </div>
  );
}

/** A page the role cannot open: still a normal page (title in the top bar), then the reason. */
export function NoAccess({ what }: { what: string }) {
  const { pathname } = useLocation();
  return (
    <div className="page">
      <PageHeader title={pageTitleForPath(pathname) ?? L.common.states.noAccessTitle} />
      <div className="state">
        <span className="state-icon">
          <Icon name="lock" size={20} />
        </span>
        <p className="state-title">{L.common.states.noAccess(what)}</p>
        <p className="state-text">{L.common.states.noAccessBody}</p>
      </div>
    </div>
  );
}

export { Skeleton } from './Skeleton';

export function InlineAlert({ tone = 'info', children, title }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: string; children: ReactNode }) {
  const icon = tone === 'danger' || tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : 'info';
  return (
    <div className={cx('inline-alert', `tone-${tone}`)} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <div>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- masked field (phi-masking contract)

export function MaskedField({ value, type, canReveal }: { value: unknown; type: SensitiveFieldType; canReveal: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const raw = value === null || value === undefined ? '' : String(value).trim();
  if (!raw) return <EmptyValue />;
  const already = isMasked(raw);
  const showReveal = canReveal && !already;
  const display = revealed && showReveal ? raw : already ? raw : maskSensitive(raw, type);
  return (
    <span className="masked" data-kind={type}>
      {/* phone / email icon wherever a contact value is shown */}
      <Icon name={type === 'phone' ? 'f-phone' : 'f-email'} size={14} className="masked-kind" />
      <span className="masked-value">{display}</span>
      {showReveal ? (
        <button
          type="button"
          className="masked-toggle"
          onClick={(e) => {
            e.stopPropagation();
            setRevealed((v) => !v);
          }}
          aria-label={revealed ? L.common.states.hideSensitive : L.common.states.revealSensitive}
          data-tooltip={revealed ? L.common.states.hide : L.common.states.reveal}
        >
          <Icon name={revealed ? 'eye-off' : 'eye'} size={14} />
        </button>
      ) : (
        <span className="masked-lock" data-tooltip={L.common.states.maskedForRole} aria-label={L.common.states.maskedForRole}>
          <Icon name="lock" size={12} />
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- toasts

interface Toast {
  id: number;
  tone: 'success' | 'danger' | 'info';
  message: string;
  /** Optional inline action (e.g. Undo, Retry); the toast stays a little longer so it can be used. */
  action?: { label: string; onClick: () => void };
}
const ToastCtx = createContext<(message: string, tone?: Toast['tone'], action?: Toast['action']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast['tone'] = 'success', action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, message, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 8000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={cx('toast', `tone-${t.tone}`)}>
              <Icon name={t.tone === 'danger' ? 'alert' : t.tone === 'info' ? 'info' : 'check'} />
              <span>{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    setToasts((x) => x.filter((y) => y.id !== t.id));
                    t.action?.onClick();
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button type="button" className="toast-close" aria-label={L.common.states.dismiss} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------- tabs

/**
 * Tab strip. Tabs that do not fit go into a "More ▾" menu instead of being cut off; the active tab is always
 * on the strip (it takes the last visible place when it would otherwise be hidden).
 */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [fit, setFit] = useState(tabs.length);
  const [menuOpen, setMenuOpen] = useState(false);
  const [, setWidth] = useState(0);
  useEffect(() => {
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Runs after every render (labels and counts change the widths); it only sets state when the fit changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const ghost = ghostRef.current;
    if (!strip || !ghost || !strip.clientWidth) return;
    const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
    const pad = parseFloat(getComputedStyle(strip).paddingLeft) + parseFloat(getComputedStyle(strip).paddingRight);
    const items = [...ghost.querySelectorAll<HTMLElement>('[data-ghost-tab]')];
    const ws = items.map((x) => x.offsetWidth);
    const moreW = ghost.querySelector<HTMLElement>('[data-ghost-more]')?.offsetWidth ?? 80;
    const room = strip.clientWidth - pad;
    const total = ws.reduce((a, w) => a + w + gap, -gap);
    let k = ws.length;
    if (total > room) {
      let used = 0;
      for (k = 0; k < ws.length; k++) {
        if (used + ws[k] + gap + moreW > room) break;
        used += ws[k] + gap;
      }
      k = Math.max(1, k);
    }
    if (k !== fit) setFit(k);
  });
  const activeIndex = tabs.findIndex((t) => t.id === value);
  let shown = tabs.slice(0, fit);
  if (fit < tabs.length && activeIndex >= fit) shown = [...tabs.slice(0, Math.max(0, fit - 1)), tabs[activeIndex]];
  const hidden = tabs.filter((t) => !shown.includes(t));
  const renderInner = (t: { label: string; count?: number }) => (
    <>
      {t.label}
      {t.count !== undefined && <span className="tab-count">{t.count}</span>}
    </>
  );
  return (
    <div ref={stripRef} role="tablist" aria-label={label} className={cx('tabs', hidden.length > 0 && 'has-more')}>
      {/* Hidden copies, only to measure how many tabs fit */}
      <div ref={ghostRef} className="tabs-ghost" aria-hidden="true">
        {tabs.map((t) => (
          <span key={t.id} data-ghost-tab className="tab">
            {renderInner(t)}
          </span>
        ))}
        <span data-ghost-more className="tab tab-more">
          {L.common.actions.moreTabs} <Icon name="chevron-down" size={12} />
        </span>
      </div>
      {shown.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          id={`tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          className={cx('tab', value === t.id && 'is-active')}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              const i = tabs.indexOf(t);
              const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
              onChange(next.id);
              const strip = e.currentTarget.parentElement;
              requestAnimationFrame(() => (strip?.querySelector(`#tab-${next.id}`) as HTMLElement | null)?.focus());
            }
          }}
        >
          {renderInner(t)}
        </button>
      ))}
      {hidden.length > 0 && (
        <>
          <button ref={moreRef} type="button" className={cx('tab tab-more', menuOpen && 'is-open')} aria-haspopup="menu" aria-expanded={menuOpen} aria-label={L.common.actions.moreTabsLabel} onClick={() => setMenuOpen((o) => !o)}>
            {L.common.actions.moreTabs}
            <Icon name="chevron-down" size={12} />
          </button>
          <Menu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchor={moreRef}
            label={L.common.actions.moreTabsLabel}
            items={hidden.map((t) => ({ id: t.id, label: t.count !== undefined ? `${t.label} (${t.count})` : t.label, onSelect: () => onChange(t.id) }))}
          />
        </>
      )}
    </div>
  );
}

/** Small helper so pages can read query params without repeating the hook. */
export function useQuery() {
  return new URLSearchParams(useLocation().search);
}
