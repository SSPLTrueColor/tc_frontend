import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import type { Tone } from '../../metadata/types';
import { cx } from '../../lib/format';
import { isMasked, maskSensitive, type SensitiveFieldType } from '../../lib/phiMask';
import { Button } from './Button';
import { Icon } from './Icon';
import { EmptyValue } from './display';

// ---------------------------------------------------------------- status chip (text + dot; never color-only)

export function StatusChip({ label, tone = 'neutral', className }: { label: string; tone?: Tone; className?: string }) {
  if (!label) return null;
  return (
    <span className={cx('chip', `tone-${tone}`, className)}>
      <span className="chip-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={cx('badge', `tone-${tone}`)}>{children}</span>;
}

export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const initials = name
    .replace('Dr. ', '')
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

export function ErrorState({ title = 'Something went wrong', children, onRetry }: { title?: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <span className="state-icon tone-danger">
        <Icon name="alert" size={20} />
      </span>
      <p className="state-title">{title}</p>
      {children && <p className="state-text">{children}</p>}
      {onRetry && (
        <Button icon="reset" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function NoAccess({ what }: { what: string }) {
  return (
    <div className="state">
      <span className="state-icon">
        <Icon name="lock" size={20} />
      </span>
      <p className="state-title">No access to {what}</p>
      <p className="state-text">Your current role does not include this area. Switch role from the account menu to explore other permissions.</p>
    </div>
  );
}

export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <span key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

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
    <span className="masked">
      <span className="masked-value">{display}</span>
      {showReveal ? (
        <button
          type="button"
          className="masked-toggle"
          onClick={(e) => {
            e.stopPropagation();
            setRevealed((v) => !v);
          }}
          aria-label={revealed ? 'Hide sensitive value' : 'Reveal sensitive value'}
          data-tooltip={revealed ? 'Hide' : 'Reveal'}
        >
          <Icon name={revealed ? 'eye-off' : 'eye'} size={14} />
        </button>
      ) : (
        <span className="masked-lock" data-tooltip="Masked for your role" aria-label="Masked for your role">
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
}
const ToastCtx = createContext<(message: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
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
              <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
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

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="tabs">
      {tabs.map((t, i) => (
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
              const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
              onChange(next.id);
              (e.currentTarget.parentElement?.querySelector(`#tab-${next.id}`) as HTMLElement | null)?.focus();
            }
          }}
        >
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Small helper so pages can read query params without repeating the hook. */
export function useQuery() {
  return new URLSearchParams(useLocation().search);
}
