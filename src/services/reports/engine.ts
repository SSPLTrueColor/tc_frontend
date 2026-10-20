/**
 * Report engine: runs a view's rows, then derives everything else from those rows —
 * footer totals, KPI cards (with the change vs the previous period) and the primary chart —
 * so the table, the cards and the chart can never disagree.
 */
import { L } from '../../constants/labels';
import { formatCell } from './format';
import { previousPeriod } from './periods';
import type { ChartOut, ChartPoint, ChartSpec, Dataset, KpiOut, KpiSpec, ReportColumn, ReportContext, ReportFilters, ReportOutput, ReportRow, ReportViewDef } from './types';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Footer figures for the columns that define one, over the given rows. */
export function totalsFor(columns: ReportColumn[], rows: ReportRow[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  columns.forEach((c) => {
    if (!c.total) return;
    if (c.total === 'sum') {
      out[c.key] = rows.reduce((t, r) => {
        const x = Number(r[c.key]);
        return t + (Number.isFinite(x) ? x : 0);
      }, 0);
    } else {
      const v = c.total(rows);
      out[c.key] = v !== null && Number.isFinite(v) ? v : null;
    }
  });
  return out;
}

function kpiValues(specs: KpiSpec[], rows: ReportRow[]): (number | null)[] {
  return specs.map((k) => {
    const v = k.value(rows);
    return v !== null && Number.isFinite(v) ? v : null;
  });
}

function change(cur: number | null, prev: number | null | undefined, fmt: KpiSpec['fmt']): Pick<KpiOut, 'delta' | 'deltaKind'> {
  if (cur === null || prev === null || prev === undefined) return { delta: null, deltaKind: fmt === 'pct' ? 'pp' : 'rel' };
  if (fmt === 'pct') return { delta: Math.round((cur - prev) * 1000) / 10, deltaKind: 'pp' };
  if (prev === 0) return { delta: cur === 0 ? 0 : null, deltaKind: 'rel' };
  return { delta: Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10, deltaKind: 'rel' };
}

const DEFAULT_LIMIT: Record<ChartSpec['type'], number> = { line: 400, area: 400, bar: 12, hbar: 10, donut: 6, funnel: 8 };
/** Counts and ₹ add up, so the tail can fold into "Others"; rates and averages cannot. */
const additive = (fmt: ChartSpec['fmt']) => fmt === 'money' || fmt === 'number';

export function chartFrom(spec: ChartSpec, columns: ReportColumn[], rows: ReportRow[], given?: ChartPoint[]): ChartOut {
  const col = columns.find((c) => c.key === spec.x);
  let pts: ChartPoint[] =
    given ??
    rows
      .filter((r) => finite(Number(r[spec.y])) && r[spec.y] !== null && r[spec.y] !== '')
      .map((r) => ({ key: r._key, label: col ? formatCell(col, r[spec.x]) || String(r[spec.x] ?? '') : String(r[spec.x] ?? ''), value: Number(r[spec.y]) }));
  if (spec.type === 'donut') pts = pts.filter((p) => p.value > 0);
  const limit = spec.limit ?? DEFAULT_LIMIT[spec.type];
  const ordered = !spec.keepOrder && (spec.type === 'bar' || spec.type === 'hbar' || spec.type === 'donut') ? [...pts].sort((a, b) => b.value - a.value) : pts;
  if (ordered.length <= limit) return { spec, points: ordered, hiddenCount: 0 };
  if (spec.type === 'line' || spec.type === 'area') return { spec, points: ordered, hiddenCount: 0 };
  const head = ordered.slice(0, limit - 1);
  const tail = ordered.slice(limit - 1);
  if (additive(spec.fmt) || spec.sumOthers) {
    return { spec, points: [...head, { key: '_others', label: L.reports.page.others(tail.length), value: tail.reduce((t, p) => t + p.value, 0), others: true }], hiddenCount: 0 };
  }
  return { spec, points: ordered.slice(0, limit), hiddenCount: ordered.length - limit };
}

export interface RunInput {
  view: ReportViewDef;
  ds: Dataset;
  filters: ReportFilters;
  ctx: ReportContext;
}

export function runView({ view, ds, filters, ctx }: RunInput): ReportOutput {
  const { columns, rows, points } = view.compute(ds, filters, ctx);
  const totals = totalsFor(columns, rows);
  const cur = kpiValues(view.kpis, rows);

  // Same figures over the period just before — only for bounded past-looking ranges.
  let prevVals: (number | null)[] | undefined;
  let compared: ReportOutput['compared'];
  const prevRange = view.filters.date === 'past' ? previousPeriod(filters) : null;
  if (prevRange) {
    prevVals = kpiValues(view.kpis, view.compute(ds, { ...filters, ...prevRange }, ctx).rows);
    compared = prevRange;
  }

  const kpis: KpiOut[] = view.kpis.map((k, i) => ({
    label: k.label,
    fmt: k.fmt,
    value: cur[i],
    prev: prevVals ? prevVals[i] : undefined,
    ...change(cur[i], prevVals?.[i], k.fmt),
    better: k.better ?? 'up',
    hint: k.hint,
    to: k.to,
  }));

  return { columns, rows, totals, kpis, chart: view.chart ? chartFrom(typeof view.chart === 'function' ? view.chart(filters) : view.chart, columns, rows, points) : undefined, compared };
}
