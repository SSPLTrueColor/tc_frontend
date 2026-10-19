/** Small shared helpers for report definitions. */
import type { RecordData } from '../../metadata/types';
import { recordPeekPath, resourcePath } from '../../lib/routes';
import { masterLabel } from '../registry';
import { dayOf, inRange } from './kpis';
import type { Dataset, ReportFilters, ReportRow } from './types';

export const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
export const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

export const peek = (resKey: string, idKey = 'id') => (row: ReportRow) => (row[idKey] ? recordPeekPath('tc', resKey, s(row[idKey])) : undefined);
export const list = (resKey: string, params: Record<string, string | undefined> = {}) => resourcePath('tc', resKey, params);

/** Applies division / owner / date filters to base rows. */
export function applyFilters(rows: RecordData[], f: ReportFilters, opts: { date?: string; owner?: string; division?: string } = {}) {
  const divKey = opts.division ?? 'divisionId';
  return rows.filter((r) => {
    if (f.division) {
      const v = r[divKey] ?? r.divisionIds;
      const vals = Array.isArray(v) ? (v as string[]) : [s(v)];
      if (!vals.includes(f.division)) return false;
    }
    if (f.owner && opts.owner !== undefined && s(r[opts.owner]) !== f.owner) return false;
    if (opts.date && (f.from || f.to) && !inRange(r[opts.date], f.from, f.to)) return false;
    return true;
  });
}

/** Groups rows by a key function into ordered buckets. */
export function groupBy<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T[]>();
  rows.forEach((r) => {
    const k = key(r) || '—';
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  });
  return m;
}

export const monthKey = (v: unknown) => dayOf(v).slice(0, 7);
export const label = (master: string, key: unknown) => masterLabel(master, key) || s(key) || 'Not set';
export const empName = (ds: Dataset, id: unknown) => (id ? ds.name('employees', id) : 'Unassigned');
export const pctOf = (num: number, den: number) => (den ? num / den : null);
export const top = <T extends { value: number }>(rows: T[], k = 10) => [...rows].sort((a, b) => b.value - a.value).slice(0, k);
