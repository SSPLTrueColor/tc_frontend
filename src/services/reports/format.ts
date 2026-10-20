/** Cell / KPI value formatting shared by the report viewer and CSV export. */
import { L } from '../../constants/labels';
import { toDate } from '../../lib/dates';
import { formatNumber } from '../../lib/format';
import { masterLabel } from '../registry';
import type { Fmt, ReportColumn } from './types';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
/** ₹ with Indian digit grouping and no paise: ₹1,00,000 (negatives as -₹1,200). */
export const formatInr = (v: number) => (v < 0 ? `-${inr.format(Math.abs(v))}` : inr.format(v));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Reports write dates as DD MMM YYYY ("20 Oct 2026"). */
export function formatReportDate(day: string): string {
  const d = toDate(day);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));
const round1 = (x: number) => Math.round(x * 10) / 10;

export function formatCell(col: ReportColumn, v: unknown): string {
  if (isEmpty(v)) return '';
  switch (col.type) {
    case 'money':
      return formatInr(Number(v));
    case 'number':
      return formatNumber(round1(Number(v)));
    case 'pct':
      return `${round1(Number(v) * 100)}%`;
    case 'hours':
      return L.reports.common.hours(round1(Number(v)));
    case 'days':
      return L.reports.common.days(round1(Number(v)));
    case 'date':
      return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? formatReportDate(String(v).slice(0, 10)) : String(v);
    case 'month':
      return /^\d{4}-\d{2}/.test(String(v)) ? `${MONTHS[Number(String(v).slice(5, 7)) - 1]} ${String(v).slice(0, 4)}` : String(v);
    case 'status':
      return col.master ? masterLabel(col.master, v) || String(v) : String(v);
    case 'kpi':
      return formatKpi(String(v));
    default:
      return String(v);
  }
}

/** KPI strings carry a type prefix ("money:123", "pct:0.42", "rating:4.2"). */
export function formatKpi(value: string, opts: { compact?: boolean } = {}): string {
  const m = /^(money|pct|hours|days|rating|number):(.*)$/.exec(value);
  if (!m) return value;
  if (m[2] === '') return '';
  return formatMetric(Number(m[2]), m[1] as Fmt, { compact: opts.compact });
}

/** Compact ₹ for chart axes and tiles: ₹1.2 Cr, ₹34.5 L, ₹12.3 K (negatives as -₹1.2 L). */
export function compactInr(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${Number(round1(a / 1e7)).toLocaleString('en-IN')} Cr`;
  if (a >= 1e5) return `${sign}₹${round1(a / 1e5)} L`;
  if (a >= 1e3) return `${sign}₹${round1(a / 1e3)} K`;
  return `${sign}₹${Math.round(a)}`;
}

/** One figure in its own unit. `compact` shortens ₹ for tiles and axes; tooltips and tables use the full form. */
export function formatMetric(v: number | null | undefined, fmt: Fmt, opts: { compact?: boolean; unit?: string } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  switch (fmt) {
    case 'money':
      return opts.compact ? compactInr(v) : formatInr(v);
    case 'pct':
      return `${round1(v * 100)}%`;
    case 'hours':
      return L.reports.common.hours(round1(v));
    case 'days':
      return L.reports.common.days(round1(v));
    case 'rating':
      return `${v.toFixed(1)} / 5`;
    default:
      return `${formatNumber(round1(v))}${opts.unit ? ` ${opts.unit}` : ''}`;
  }
}

/** "2026-10" → "Oct 2026" (for chart marks built outside a table column). */
export const monthName = (ym: string) => formatCell({ key: 'm', label: '', type: 'month' }, ym);
