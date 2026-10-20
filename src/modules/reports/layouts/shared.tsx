import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { L } from '../../../constants/labels';
import { Button } from '../../../components/primitives/Button';
import { cx } from '../../../lib/format';
import { formatCell, formatKpi, formatMetric } from '../../../services/reports/format';
import type { Fmt, KpiOut, ReportColumn, ReportDef, ReportOutput, ReportRow, ReportViewDef } from '../../../services/reports/types';

const W = L.reports.layouts;

/** What every layout receives: the report, the open view and the engine output (the same rows the table and Excel use). */
export interface LayoutProps {
  def: ReportDef;
  view: ReportViewDef;
  out: ReportOutput;
  busy: boolean;
}

export const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
export const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
export const money = (v: number) => formatMetric(v, 'money', { compact: true });
export const fmtOf = (v: number | null, f: Fmt) => formatMetric(v, f, { compact: true });
export const colOf = (out: ReportOutput, key: string): ReportColumn | undefined => out.columns.find((c) => c.key === key);
export const cellText = (out: ReportOutput, key: string, v: unknown) => {
  const c = colOf(out, key);
  return c ? formatCell(c, v) : text(v);
};
/** A row's drill-down: the first link its table offers. */
export const hrefOf = (out: ReportOutput, r: ReportRow): string | undefined => out.columns.find((c) => c.link)?.link?.(r);
export const kpiText = (v: string) => formatKpi(v, { compact: true }) || '—';

/** One sentence that says what the report found. */
export function Headline({ children }: { children: ReactNode }) {
  return <p className="rl-headline">{children}</p>;
}

/** The headline figures as one quiet line instead of a row of tiles. */
export function KpiInline({ kpis }: { kpis: KpiOut[] }) {
  return (
    <dl className="rl-kpis">
      {kpis.map((k) => (
        <div key={k.label} data-tooltip={k.hint}>
          <dt>{k.label}</dt>
          <dd>{k.value === null ? '—' : fmtOf(k.value, k.fmt)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A name that links to the records behind it when it can. */
export function NameLink({ to, children, className }: { to?: string; children: ReactNode; className?: string }) {
  return to ? (
    <Link to={to} className={cx('rl-link', className)}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

/** The detail table, folded away until asked for: the visual answers the question, the rows stay one click away. */
export function ViewData({ rows, children }: { rows: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rl-data">
      <Button variant="ghost" icon={open ? 'chevron-up' : 'chevron-down'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? W.hideData : W.viewData(rows)}
      </Button>
      {open && <div className="rl-data-body">{children}</div>}
    </section>
  );
}
