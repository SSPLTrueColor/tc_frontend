/**
 * Settings design kit — one layout for every Settings page:
 *   SettingsPage → description line → SettingsSection cards (heading + help left, controls right) → sticky SaveBar.
 * Spacing uses only the template scale (--sp-1…--sp-6). Toggles save instantly (ToggleRow); forms save explicitly (SaveBar).
 */
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { L } from '../../constants/labels';
import { cx } from '../../lib/format';
import { Button } from '../primitives/Button';
import { Dialog, confirmDelete } from '../primitives/overlay';
import { PageHeader } from '../shell/PageHeader';
import './settings.css';

const K = L.settingsKit;

// ---------------------------------------------------------------- page

export function SettingsPage({ title, description, actions, children }: { title: string; description: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page st-page">
      <PageHeader title={title} description={description} />
      <div className="st-col">
        <header className="st-head">
          <p className="st-desc">{description}</p>
          {actions && <div className="st-head-actions">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  );
}

/** Same silhouette as a loaded page so nothing jumps when data arrives. */
export function SettingsSkeleton({ sections = 2 }: { sections?: number }) {
  return (
    <div className="st-col" aria-busy="true" aria-label={L.common.states.loading}>
      <div className="st-skel st-skel-line" />
      {Array.from({ length: sections }, (_, i) => (
        <div key={i} className="st-card st-skel-card">
          <div className="st-skel st-skel-title" />
          <div className="st-skel st-skel-box" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- sections and fields

/** `wide` puts the heading above the content (tables, lists); otherwise heading + help sit left, controls right. */
export function SettingsSection({ title, help, children, wide, actions, id }: { title: string; help?: string; children: ReactNode; wide?: boolean; actions?: ReactNode; id?: string }) {
  const headId = useId();
  return (
    <section className={cx('st-card', 'st-section', wide && 'is-wide')} aria-labelledby={headId} id={id}>
      <div className="st-section-head">
        <h2 id={headId} className="st-section-title">
          {title}
        </h2>
        {help && <p className="st-help">{help}</p>}
        {actions && <div className="st-section-actions">{actions}</div>}
      </div>
      <div className="st-section-body">{children}</div>
    </section>
  );
}

/** Label → control → helper / error, with one fixed rhythm. */
export function SettingsField({ label, help, error, htmlFor, required, children }: { label: string; help?: string; error?: string; htmlFor?: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="st-field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="req" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <span className="field-error" role="alert" id={htmlFor ? `${htmlFor}-err` : undefined}>
          {error}
        </span>
      ) : (
        help && <span className="field-help">{help}</span>
      )}
    </div>
  );
}

/**
 * A setting that is one on/off switch: saves the moment it is flipped (the caller shows the toast).
 * The switch moves at once and settles on the saved value; if the save fails it springs back.
 */
export function ToggleRow({ label, help, checked, onChange, disabled, busy }: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void | Promise<unknown>; disabled?: boolean; busy?: boolean }) {
  const id = useId();
  const [pending, setPending] = useState<boolean | null>(null);
  const shown = pending ?? checked;
  const flip = (v: boolean) => {
    setPending(v);
    Promise.resolve(onChange(v))
      .catch(() => undefined)
      .finally(() => setPending(null));
  };
  return (
    <div className="st-toggle-row">
      <div className="st-toggle-text">
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        {help && <span className="field-help">{help}</span>}
      </div>
      <label className="switch st-switch">
        <input id={id} type="checkbox" role="switch" checked={shown} disabled={disabled || busy || pending !== null} onChange={(e) => flip(e.target.checked)} />
        <span className="switch-track" aria-hidden="true" />
        <span className="sr-only">{shown ? K.on : K.off}</span>
      </label>
    </div>
  );
}

/** Read-only notice ("Your role can view but not change this") shown at the top of a page. */
export function ReadOnlyNote({ children }: { children?: ReactNode }) {
  return (
    <div className="st-note" role="note">
      {children ?? K.readOnly}
    </div>
  );
}

// ---------------------------------------------------------------- unsaved changes

let dirtyCount = 0;

/**
 * Warns before leaving with unsaved changes: browser refresh / close (beforeunload) and every in-app link
 * (capture-phase click → confirmation). The browser Back button cannot be intercepted by BrowserRouter.
 */
export function useUnsavedGuard(dirty: boolean) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!dirty) return;
    dirtyCount++;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.origin !== window.location.origin) return;
      const to = a.pathname + a.search + a.hash;
      if (to === window.location.pathname + window.location.search + window.location.hash) return;
      e.preventDefault();
      e.stopPropagation();
      confirmDelete({ title: K.leaveTitle, message: K.leaveMessage, confirmLabel: K.leave, onConfirm: () => navigate(to) });
    };
    window.addEventListener('beforeunload', onBefore);
    document.addEventListener('click', onClick, true);
    return () => {
      dirtyCount--;
      window.removeEventListener('beforeunload', onBefore);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, navigate]);
}
export const hasUnsavedSettings = () => dirtyCount > 0;

/** Working copy of saved data: `dirty` is true only while it differs; it resets when the saved value changes. */
export function useDraft<T>(saved: T | undefined): { draft: T | undefined; set: (patch: Partial<T>) => void; replace: (v: T) => void; dirty: boolean; discard: () => void } {
  const key = JSON.stringify(saved ?? null);
  const [state, setState] = useState<{ key: string; value: T | undefined }>({ key, value: saved });
  const draft = state.key === key ? state.value : saved;
  const dirty = saved !== undefined && JSON.stringify(draft) !== key;
  return {
    draft,
    dirty,
    set: (patch) => setState({ key, value: { ...(draft as T), ...patch } }),
    replace: (v) => setState({ key, value: v }),
    discard: () => setState({ key, value: saved }),
  };
}

/** Appears only while there are unsaved changes; guards against double submits. */
export function SaveBar({ dirty, busy, onSave, onCancel, saveLabel, errorCount }: { dirty: boolean; busy?: boolean; onSave: () => void | Promise<void>; onCancel: () => void; saveLabel?: string; errorCount?: number }) {
  useUnsavedGuard(dirty);
  const inFlight = useRef(false);
  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await onSave();
    } finally {
      inFlight.current = false;
    }
  };
  return (
    <div className={cx('st-savebar', dirty && 'is-open')} role="region" aria-label={K.saveBar}>
      <span className="st-savebar-text" aria-live="polite">
        {errorCount ? K.fixErrors(errorCount) : K.unsaved}
      </span>
      <Button onClick={onCancel} disabled={busy}>
        {L.common.actions.cancel}
      </Button>
      <Button variant="primary" loading={busy} onClick={save}>
        {saveLabel ?? L.common.actions.save}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- danger zone

/** Destructive actions live apart from everything else and need the exact word typed to proceed. */
export function DangerZone({ title, description, actionLabel, confirmWord, confirmTitle, confirmBody, onConfirm, disabledReason }: { title: string; description: string; actionLabel: string; confirmWord: string; confirmTitle: string; confirmBody: string; onConfirm: () => void | Promise<void>; disabledReason?: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = typed.trim() === confirmWord;
  const close = () => {
    setOpen(false);
    setTyped('');
  };
  return (
    <section className="st-card st-danger" aria-label={K.dangerZone}>
      <div className="st-danger-text">
        <h2 className="st-section-title">{title}</h2>
        <p className="st-help">{description}</p>
      </div>
      <Button variant="danger" onClick={() => setOpen(true)} disabledReason={disabledReason}>
        {actionLabel}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={confirmTitle}
        size="sm"
        role="alertdialog"
        footer={
          <>
            <Button onClick={close}>{L.common.actions.cancel}</Button>
            <Button
              variant="danger"
              loading={busy}
              disabledReason={ok ? undefined : K.typeToConfirm(confirmWord)}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  close();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {actionLabel}
            </Button>
          </>
        }
      >
        <p>{confirmBody}</p>
        <div className="st-field">
          <label className="field-label" htmlFor="st-danger-input">
            {K.typeToConfirm(confirmWord)}
          </label>
          <input id="st-danger-input" className="input" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
      </Dialog>
    </section>
  );
}

/** Truncates long text to one line and shows the full value on hover / focus. */
export function Clip({ children, text }: { children?: ReactNode; text: string }) {
  return (
    <span className="st-clip" data-tooltip={text} tabIndex={0}>
      {children ?? text}
    </span>
  );
}

export function useSettingsFormId() {
  return useMemo(() => `st-${Math.random().toString(36).slice(2, 8)}`, []);
}
