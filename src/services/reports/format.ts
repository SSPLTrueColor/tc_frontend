/** Cell / KPI value formatting shared by the report viewer and CSV export. */
import { L } from '../../constants/labels';
import { formatDate } from '../../lib/dates';
import { formatMoney, formatNumber } from '../../lib/format';
import { masterLabel } from '../registry';
import type { ReportColumn } from './types';

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));
const round1 = (x: number) => Math.round(x * 10) / 10;

export function formatCell(col: ReportColumn, v: unknown): string {
  if (isEmpty(v)) return '';
  switch (col.type) {
    case 'money':
      return formatMoney(Number(v));
    case 'number':
      return formatNumber(round1(Number(v)));
    case 'pct':
      return `${round1(Number(v) * 100)}%`;
    case 'hours':
      return L.reports.common.hours(round1(Number(v)));
    case 'days':
      return L.reports.common.days(round1(Number(v)));
    case 'date':
      return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? formatDate(String(v).slice(0, 10)) : String(v);
    case 'status':
      return col.master ? masterLabel(col.master, v) || String(v) : String(v);
    case 'kpi':
      return formatKpi(String(v));
    default:
      return String(v);
  }
}

/** KPI strings carry an optional type prefix ("money:123", "pct:0.42"). */
export function formatKpi(value: string, opts: { compact?: boolean } = {}): string {
  const m = /^(money|pct|hours|days):(.*)$/.exec(value);
  if (!m) return value;
  if (m[2] === '') return '';
  if (m[1] === 'money' && opts.compact) return compactInr(Number(m[2]));
  return formatCell({ key: 'k', label: '', type: m[1] as ReportColumn['type'] }, Number(m[2]));
}

/** Compact ₹ for chart axes and tiles: ₹1.2 Cr, ₹34.5 L, ₹12.3 K. */
export function compactInr(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${round1(v / 1e7)} Cr`;
  if (a >= 1e5) return `₹${round1(v / 1e5)} L`;
  if (a >= 1e3) return `₹${round1(v / 1e3)} K`;
  return `₹${Math.round(v)}`;
}
