/** Shared UI for field pages: location source, offline toggle, stat tiles, small formatters. */
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx, formatMoney } from '../../lib/format';
import { simulatedPoint, type LocationSource } from '../../services/field/field';
import type { Point } from '../../services/field/rules';
import { isOffline, pendingWrites, setOffline, subscribeOffline } from '../../services/offline';
import { useToast } from '../../components/primitives/feedback';
import { InfoTip } from '../../components/primitives/InfoTip';

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
  if (source === 'mock_app') return Promise.resolve({ point: sim, place: 'Mock-GPS app (demo)' });
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser cannot share its location. Use the simulated location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ point: { lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 }, place: `Device GPS (±${Math.round(p.coords.accuracy)} m)` }),
      () => reject(new Error('Location permission was denied or timed out. Allow location, or use the simulated location.')),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60_000 },
    );
  });
}

export function LocationSourcePicker({ value, onChange }: { value: LocationSource; onChange: (s: LocationSource) => void }) {
  const opts: [LocationSource, string][] = [
    ['simulated', 'Simulated'],
    ['device', 'Device GPS'],
    ['mock_app', 'Mock-GPS app'],
  ];
  return (
    <div className="field-loc">
      <span className="field-label-row">
        <span className="field-label">Location</span>
        <InfoTip text="Simulated places you at your office or territory. Device GPS asks the browser for your real position. “Mock-GPS app” demonstrates fake-location detection: check-in is blocked." label="About location sources" />
      </span>
      <div className="segmented" role="radiogroup" aria-label="Location source">
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
            if (r.synced.length) toast(`Back online: ${r.synced.length} queued change(s) synced`);
            r.conflicts.forEach((c) => toast(`Not synced — ${c.label}: ${c.message}`, 'danger'));
            if (!r.synced.length && !r.conflicts.length) toast('Back online', 'info');
          } else toast('Offline mode: check-ins and visits are saved on this device and sync later', 'info');
        }}
        aria-label="Work offline (demo)"
      />
      <span className="switch-track" aria-hidden="true" />
      <span className="small">{offline ? `Offline${pending ? ` · ${pending} queued` : ''}` : 'Online'}</span>
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
