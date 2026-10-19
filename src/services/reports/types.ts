import type { RecordData } from '../../metadata/types';
import type { Actor } from '../authz';

export type ChartPolarity = 'higher' | 'lower' | 'ageing' | 'neutral';

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
export type ColumnType = 'text' | 'money' | 'number' | 'pct' | 'date' | 'hours' | 'days' | 'status' | 'kpi';

export interface ReportColumn {
  key: string;
  label: string;
  type?: ColumnType;
  /** Master key for status/label columns. */
  master?: string;
  /** Where a row's cell links to (record side panel or list). */
  link?: (row: ReportRow) => string | undefined;
}

export type ReportRow = Record<string, unknown> & { _key: string };

export interface ReportResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  /**
   * Single-series bar chart. `polarity` decides the bar colours: higher/lower is better (compared with the
   * series average), ageing (older buckets worse) or neutral (one colour, no legend).
   */
  chart?: { label: string; unit: string; money?: boolean; polarity: ChartPolarity; data: { key: string; label: string; value: number }[] };
  /** Headline numbers shown above the table. */
  kpis?: { label: string; value: string; hint?: string }[];
}

export interface ReportContext {
  actor: Actor;
  today: string;
  nowMs: number;
}

export type ReportGroup = 'customers' | 'leads' | 'quotations' | 'orders' | 'installed' | 'service' | 'field' | 'kpis';

export interface ReportDef {
  id: string;
  title: string;
  group: ReportGroup;
  /** Requirement ids this report satisfies (traceability). */
  fr: string[];
  description: string;
  /** Resources the report reads (the catalogue hides reports whose base resource the role cannot read). */
  needs: string[];
  filters: { date?: 'past' | 'future' | false; division?: boolean; owner?: boolean };
  dateLabel?: string;
  groupOptions?: { value: string; label: string }[];
  compute: (ds: Dataset, f: ReportFilters, ctx: ReportContext) => ReportResult;
}
