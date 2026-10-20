/** Turns what is on screen (visible columns, current rows, totals, filters) into an .xlsx workbook. */
import { L } from '../../constants/labels';
import { buildXlsx, excelSerial, type XCell, type XStyle } from '../../lib/xlsx';
import { totalsFor } from './engine';
import { formatCell } from './format';
import type { ReportColumn, ReportRow } from './types';

export interface ExportInput {
  viewLabel: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Human-readable filters in force, one per line ("Period: 01 Jan 2026 – 20 Oct 2026"). */
  filterLines: string[];
  generatedAt: string;
}

const NUMERIC: Partial<Record<NonNullable<ReportColumn['type']>, XStyle>> = { money: 'money', number: 'number', pct: 'pct', hours: 'hours', days: 'days' };
const TOTAL_STYLE: Partial<Record<XStyle, XStyle>> = { money: 'totalMoney', number: 'totalNumber', pct: 'totalPct', hours: 'totalHours', days: 'totalDays' };

function dataCell(col: ReportColumn, v: unknown): XCell {
  if (v === null || v === undefined || v === '') return { v: null };
  const style = col.type ? NUMERIC[col.type] : undefined;
  if (style && Number.isFinite(Number(v))) return { v: Number(v), style };
  if (col.type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(v))) return { v: excelSerial(String(v)), style: 'date' };
  return { v: formatCell(col, v) };
}

export function buildReportWorkbook(title: string, input: ExportInput): Uint8Array {
  const { columns, rows } = input;
  const head: XCell[][] = [[{ v: title, style: 'title' }], [{ v: input.viewLabel, style: 'muted' }], ...input.filterLines.map((l) => [{ v: l, style: 'muted' as const }]), [{ v: L.reports.page.excel.generated(input.generatedAt, rows.length), style: 'muted' }], []];
  const header: XCell[] = columns.map((c) => ({ v: c.label, style: 'header' }));
  const body = rows.map((r) => columns.map((c) => dataCell(c, r[c.key])));
  const totals = totalsFor(columns, rows);
  const hasTotals = columns.some((c) => c.total);
  const foot: XCell[][] = hasTotals
    ? [
        columns.map((c, i) => {
          if (i === 0) return { v: L.reports.cols.total, style: 'totalText' as const };
          const t = totals[c.key];
          const base = c.type ? NUMERIC[c.type] : undefined;
          return t === undefined || t === null || !base ? { v: null, style: 'totalText' as const } : { v: t, style: TOTAL_STYLE[base] };
        }),
      ]
    : [];
  const widths = columns.map((c, i) => {
    const longest = Math.max(c.label.length, ...rows.slice(0, 200).map((r) => formatCell(c, r[c.key]).length));
    return Math.min(48, Math.max(i === 0 ? 18 : 10, longest + 2));
  });
  return buildXlsx({ sheet: title, rows: [...head, header, ...body, ...foot], widths, freezeRow: head.length + 1 });
}
