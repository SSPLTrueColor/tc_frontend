/** Shared UI for Field Force and Targets & Recognition pages: location source, offline toggle, stat tiles, merged list pages, small formatters. */
import { useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, UNSAFE_RouteContext } from 'react-router-dom';
import { L } from '../../constants/labels';
import { slugOf } from '../../constants/routes';
import { ResourcePage } from '../../pages/ResourcePage';
import { cx, formatMoney } from '../../lib/format';
import { simulatedPoint, type LocationSource } from '../../services/field/field';
import type { Point } from '../../services/field/rules';
import { isOffline, pendingWrites, setOffline, subscribeOffline } from '../../services/offline';
import { useToast } from '../../components/primitives/feedback';
import { InfoTip } from '../../components/primitives/InfoTip';
import { IconButton } from '../../components/primitives/Button';

const SOURCE_KEY = 'tc.field.locationSource';

const readSource = (): LocationSource => {
  try {
    const v = localStorage.getItem(SOURCE_KEY);
    return v === 'device' || v === 'mock_app' ? v : 'simulated';
  } catch {
    return 'simulated';
  }
};

export function useLocationSource(): [LocationSource, (s: LocationSource) => void] {
  const [s, set] = useState<LocationSource>(readSource);
  return [
    s,
    (v) => {
      set(v);
      try {
        localStorage.setItem(SOURCE_KEY, v);
      } catch {
        /* per-viewer convenience only */
      }
    },
  ];
}

/** Resolves the current position for a source. Device GPS uses the browser API (asks permission). */
export function getLocation(source: LocationSource, staffId: string): Promise<{ point: Point; place: string }> {
  const sim = simulatedPoint(staffId);
  if (source === 'simulated') return Promise.resolve({ point: sim, place: sim.label });
  if (source === 'mock_app') return Promise.resolve({ point: sim, place: L.field.location.mockPlace });
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error(L.field.errors.noBrowserGeo));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ point: { lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 }, place: L.field.location.devicePlace(Math.round(p.coords.accuracy)) }),
      () => reject(new Error(L.field.errors.geoDenied)),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60_000 },
    );
  });
}

export function LocationSourcePicker({ value, onChange }: { value: LocationSource; onChange: (s: LocationSource) => void }) {
  const LOC = L.field.location;
  const opts: [LocationSource, string][] = [
    ['simulated', LOC.sources.simulated],
    ['device', LOC.sources.device],
    ['mock_app', LOC.sources.mock_app],
  ];
  return (
    <div className="field-loc">
      <span className="field-label-row">
        <span className="field-label">{LOC.label}</span>
        <InfoTip text={LOC.help} label={LOC.helpLabel} />
      </span>
      <div className="segmented" role="radiogroup" aria-label={LOC.groupLabel}>
        {opts.map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} className={cx('seg-btn', value === k && 'is-on')} onClick={() => onChange(k)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Offline state (NFR-15) as a hook. */
export function useOfflineState() {
  const offline = useSyncExternalStore(subscribeOffline, isOffline, isOffline);
  const pending = useSyncExternalStore(subscribeOffline, () => pendingWrites().length, () => 0);
  return { offline, pending };
}

/** Demo switch: work offline; writes queue and sync when switched back on. */
export function OfflineSwitch() {
  const { offline, pending } = useOfflineState();
  const toast = useToast();
  return (
    <label className="switch">
      <input
        type="checkbox"
        role="switch"
        checked={offline}
        onChange={(e) => {
          const r = setOffline(e.target.checked);
          if (r) {
            if (r.synced.length) toast(L.field.offline.synced(r.synced.length));
            r.conflicts.forEach((c) => toast(L.field.offline.notSynced(c.label, c.message), 'danger'));
            if (!r.synced.length && !r.conflicts.length) toast(L.field.offline.backOnline, 'info');
          } else toast(L.field.offline.nowOffline, 'info');
        }}
        aria-label={L.field.offline.switchLabel}
      />
      <span className="switch-track" aria-hidden="true" />
      <span className="small">{offline ? L.field.offline.offline(pending) : L.field.offline.online}</span>
    </label>
  );
}

export function Stat({ label, value, sub, to }: { label: string; value: ReactNode; sub?: string; to?: string }) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </>
  );
  return to ? (
    <Link className="stat" to={to}>
      {body}
    </Link>
  ) : (
    <div className="stat">{body}</div>
  );
}

export const fmtMinutes = (m: unknown) => (m === null || m === undefined || m === '' ? '' : `${Math.floor(Number(m) / 60)}h ${String(Number(m) % 60).padStart(2, '0')}m`);
export const time12 = (local: unknown) => {
  if (!local) return '';
  const [h, m] = String(local).slice(11, 16).split(':').map(Number);
  return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export function metricValue(metric: unknown, v: number) {
  return metric === 'order_value' || metric === 'collections' ? formatMoney(v) : v.toLocaleString('en-IN');
}

/** Percentage meter (text + bar, never colour alone). */
export function Meter({ pct, label }: { pct: number; label: string }) {
  return (
    <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pct)} aria-label={label}>
      <span className="meter-track">
        <span className="meter-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </span>
      <span className="meter-text">{pct}%</span>
    </span>
  );
}

/**
 * Renders the generic resource list (views, search, filters, sort, pagination, export, peek) for a
 * resource whose list URL is served by a module page. ResourcePage reads the resource from the
 * route params, so the `:resource` param is supplied here.
 */
export function EmbeddedResourceList({ resKey }: { resKey: string }) {
  const ctx = useContext(UNSAFE_RouteContext);
  const last = ctx.matches[ctx.matches.length - 1];
  const value = last ? { ...ctx, matches: [...ctx.matches.slice(0, -1), { ...last, params: { ...last.params, resource: slugOf(resKey) } }] } : ctx;
  return (
    <UNSAFE_RouteContext.Provider value={value}>
      <ResourcePage key={resKey} />
    </UNSAFE_RouteContext.Provider>
  );
}

/** Two-way switch between a page's working view and its full record list (merged pages). */
export function ModeSwitch<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="field-mode">
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={cx('seg-btn', value === o.id && 'is-on')} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Search box in the template's list style. */
export function SearchBox({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  return (
    <div className="search-field">
      <span className="search-icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.14">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </span>
      <input type="search" className="input input-compact" placeholder={placeholder} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export const PAGE_SIZE = 25;

/** Simple pager for the module's own tables (25 rows a page). */
export function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) return null;
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(total, from + PAGE_SIZE - 1);
  return (
    <div className="toolbar field-pager">
      <span className="spacer" />
      <span className="muted small">{L.field.common.showing(from, to, total)}</span>
      <IconButton icon="chevron-left" label={L.field.common.previousPage} onClick={() => onPage(page - 1)} disabled={page <= 0} />
      <IconButton icon="chevron-right" label={L.field.common.nextPage} onClick={() => onPage(page + 1)} disabled={page >= pages - 1} />
    </div>
  );
}
