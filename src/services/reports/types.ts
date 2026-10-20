import type { RecordData } from '../../metadata/types';
import type { Actor } from '../authz';

/** Role-scoped records for reports, keyed by resource. Missing / unreadable resources are empty. */
export interface Dataset {
  get: (resKey: string) => RecordData[];
  /** Display helpers over scoped + reference data. */
  name: (resKey: string, id: unknown) => string;
}

export interface ReportFilters {
  from?: string;
  to?: string;
  division?: string;
  owner?: string;
  group?: string;
}

/** `kpi` cells hold typed KPI strings ("money:…", "pct:…") formatted like tiles. */
/** `month` cells hold "YYYY-MM" and read "Oct 2026". */
export type ColumnType = 'text' | 'money' | 'number' | 'pct' | 'date' | 'month' | 'hours' | 'days' | 'status' | 'kpi';

/** How a figure is written: tiles, tooltips and the chart axis all go through one formatter. */
export type Fmt = 'number' | 'money' | 'pct' | 'hours' | 'days' | 'rating';

export type ReportRow = Record<string, unknown> & { _key: string };

/** A figure computed from the report's own rows, so KPI cards, chart and table footer always agree. */
export type Metric = (rows: ReportRow[]) => number | null;

export interface ReportColumn {
  key: string;
  label: string;
  type?: ColumnType;
  /** Master key for status/label columns. */
  master?: string;
  /** Where a row's cell links to (record side panel or list). The first link on a row is its drill-down. */
  link?: (row: ReportRow) => string | undefined;
  /** Footer figure: 'sum' adds the column up, or a Metric (ratio of two columns, weighted mean…). */
  total?: 'sum' | Metric;
  /** Hidden until switched on in "Columns" (at most 7 columns show by default). */
  optional?: boolean;
}

export interface KpiSpec {
  label: string;
  fmt: Fmt;
  value: Metric;
  /** Which direction is good; decides the green/red of the change chip. Default: up. */
  better?: 'up' | 'down' | 'none';
  /** One-line definition shown in the tooltip. */
  hint?: string;
  to?: string;
}

/** trend → line/area · comparison → bar/hbar · share → donut · stages → funnel. */
export type ChartType = 'line' | 'area' | 'bar' | 'hbar' | 'donut' | 'funnel';

export interface ChartSpec {
  type: ChartType;
  title: string;
  /** Column holding each mark's label / the value it plots. */
  x: string;
  y: string;
  fmt: Fmt;
  /** Unit word for tooltips when fmt is 'number' ("leads", "tickets"). */
  unit?: string;
  /** Most marks before the rest folds into "Others" (sums) or is cut with a note (rates). */
  limit?: number;
  /** Marks are in a meaningful order (ageing bands, stages): do not re-rank them by value. */
  keepOrder?: boolean;
  /** The values add up (e.g. downtime hours), so the tail may fold into "Others" even though the unit is not a count or ₹. */
  sumOthers?: boolean;
}

export interface ChartPoint {
  key: string;
  label: string;
  value: number;
  /** Folded "Others" mark. */
  others?: boolean;
}

/** What a view's `compute` returns: just the table. KPIs, chart and totals are derived from it. */
export interface ViewRows {
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Stage / bucket marks that are not one-per-row (e.g. a funnel built from several counts). */
  points?: ChartPoint[];
}

export interface ReportContext {
  actor: Actor;
  today: string;
  nowMs: number;
}

/** Category id = URL segment under /reports (GLOSSARY §1.2). */
export type ReportGroup = 'kpis' | 'customers' | 'leads' | 'quotations' | 'sales-orders' | 'installed-base' | 'service' | 'field-force';

export type DateKind = 'past' | 'future';

export interface ReportViewDef {
  id: string;
  label: string;
  filters: { date?: DateKind; division?: boolean; owner?: boolean };
  /** Which date the range applies to ("Created", "Order date", "Expiry") — shown beside the range. */
  dateLabel?: string;
  groupOptions?: { value: string; label: string }[];
  compute: (ds: Dataset, f: ReportFilters, ctx: ReportContext) => ViewRows;
  /** 3–5 headline figures derived from the rows. */
  kpis: KpiSpec[];
  /** A trend by month reads as a line, the same figure by owner as ranked bars — so it may depend on the group-by. */
  chart?: ChartSpec | ((f: ReportFilters) => ChartSpec);
}

export interface ReportDef {
  id: string;
  title: string;
  group: ReportGroup;
  icon: string;
  /** Requirement ids this report satisfies (traceability). */
  fr: string[];
  /** One line: what decision this report supports. */
  description: string;
  /** Resources the report reads (the catalogue hides reports whose base resource the role cannot read). */
  needs: string[];
  views: ReportViewDef[];
}

// ---------------------------------------------------------------- engine output

export interface KpiOut {
  label: string;
  fmt: Fmt;
  value: number | null;
  /** Same figure over the previous period; undefined = no comparison for this report/range. */
  prev?: number | null;
  /** Relative % change, or percentage points for 'pct' figures; null when it cannot be computed. */
  delta: number | null;
  deltaKind: 'rel' | 'pp';
  better: 'up' | 'down' | 'none';
  hint?: string;
  to?: string;
}

export interface ChartOut {
  spec: ChartSpec;
  points: ChartPoint[];
  /** Marks cut from a rate chart because there were more than the limit. */
  hiddenCount: number;
}

export interface ReportOutput {
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: Record<string, number | null>;
  kpis: KpiOut[];
  chart?: ChartOut;
  /** The previous period the KPI changes compare against. */
  compared?: { from: string; to: string };
}
