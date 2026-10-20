/** Date-range presets for report filters, and the previous period a range is compared with. */
import { L } from '../../constants/labels';
import { addDays, parseLocal, toDateKey } from '../../lib/dates';
import type { DateKind } from './types';

export interface DateRange {
  from?: string;
  to?: string;
}

export interface Preset {
  id: string;
  label: string;
  range: DateRange;
}

const P = L.reports.page.presets;

const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`;
const monthsBack = (day: string, n: number) => {
  const d = parseLocal(firstOfMonth(day));
  d.setMonth(d.getMonth() - n);
  return toDateKey(d);
};
const endOfMonth = (firstDay: string) => {
  const d = parseLocal(firstDay);
  d.setMonth(d.getMonth() + 1, 0);
  return toDateKey(d);
};
/** Quarter start (Jan/Apr/Jul/Oct). */
const quarterStart = (day: string) => {
  const m = Number(day.slice(5, 7));
  return `${day.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
};
/** Indian financial year: 1 Apr – 31 Mar. */
const fyStart = (day: string) => {
  const y = Number(day.slice(0, 4));
  return `${Number(day.slice(5, 7)) >= 4 ? y : y - 1}-04-01`;
};

export function presetsFor(kind: DateKind, today: string): Preset[] {
  if (kind === 'future') {
    return [
      { id: 'next30', label: P.next30, range: { from: today, to: addDays(today, 30) } },
      { id: 'next90', label: P.next90, range: { from: today, to: addDays(today, 90) } },
      { id: 'next180', label: P.next180, range: { from: today, to: addDays(today, 180) } },
      { id: 'next365', label: P.next365, range: { from: today, to: addDays(today, 365) } },
      { id: 'all', label: P.anyTime, range: {} },
    ];
  }
  const lastMonthStart = monthsBack(today, 1);
  return [
    { id: 'today', label: P.today, range: { from: today, to: today } },
    { id: '7d', label: P.last7, range: { from: addDays(today, -6), to: today } },
    { id: '30d', label: P.last30, range: { from: addDays(today, -29), to: today } },
    { id: '90d', label: P.last90, range: { from: addDays(today, -89), to: today } },
    { id: 'mtd', label: P.thisMonth, range: { from: firstOfMonth(today), to: today } },
    { id: 'lastMonth', label: P.lastMonth, range: { from: lastMonthStart, to: endOfMonth(lastMonthStart) } },
    { id: 'qtd', label: P.thisQuarter, range: { from: quarterStart(today), to: today } },
    { id: 'fy', label: P.thisFy, range: { from: fyStart(today), to: today } },
    { id: '12m', label: P.last12, range: { from: addDays(today, -364), to: today } },
    { id: 'all', label: P.allTime, range: {} },
  ];
}

export const defaultPreset = (kind: DateKind) => (kind === 'future' ? 'next90' : '90d');

/** Which preset (if any) a from/to pair equals today — otherwise it is a custom range. */
export function presetOf(kind: DateKind, range: DateRange, today: string): string {
  const hit = presetsFor(kind, today).find((p) => (p.range.from ?? '') === (range.from ?? '') && (p.range.to ?? '') === (range.to ?? ''));
  return hit ? hit.id : 'custom';
}

const dayCount = (from: string, to: string) => Math.round((parseLocal(to).getTime() - parseLocal(from).getTime()) / 86_400_000) + 1;

/** The period of the same length that ends the day before `range` starts. Open or reversed ranges have none. */
export function previousPeriod(range: DateRange): { from: string; to: string } | null {
  if (!range.from || !range.to || range.to < range.from) return null;
  const len = dayCount(range.from, range.to);
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(len - 1)), to };
}
