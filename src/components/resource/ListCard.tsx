import type { ReactNode } from 'react';
import '../../modules/dashboard/dashboard.css';
import '../../modules/reports/reports.css';
import { cx } from '../../lib/format';
import { IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';

/**
 * The app's standard KPI cards (Dashboard / Reports `kpi-card`) as a clickable filter strip:
 * the pressed card is the active filter.
 */
export interface KpiItem {
  key: string;
  label: string;
  value: ReactNode;
  sub: string;
  active?: boolean;
  onClick?: () => void;
}

export function KpiStrip({ items, label }: { items: KpiItem[]; label: string }) {
  return (
    <section className="rp-kpis" aria-label={label} style={{ ['--n' as string]: items.length }}>
      {items.map((k) => {
        const body = (
          <>
            <div className="kpi-top">
              <span className="kpi-label" data-tooltip={k.label}>
                {k.label}
              </span>
            </div>
            <div className="kpi-mid">
              <span className="kpi-value">{k.value}</span>
            </div>
            <span className="kpi-sub">{k.sub}</span>
          </>
        );
        return k.onClick ? (
          <button key={k.key} type="button" className={cx('kpi-card', 'is-action', k.active && 'is-active')} aria-pressed={!!k.active} onClick={k.onClick}>
            {body}
          </button>
        ) : (
          <div key={k.key} className="kpi-card">
            {body}
          </div>
        );
      })}
    </section>
  );
}

/** The report-style table card: title + tools on top, scrollable table, footer. */
export function TableCard({ title, tools, children }: { title: string; tools?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel rp-tablecard" aria-label={title}>
      <div className="rp-tablebar">
        <h2 className="panel-title">{title}</h2>
        {tools && <div className="rp-tabletools">{tools}</div>}
      </div>
      {children}
    </section>
  );
}

export function SortTh({ label, active, dir, onSort, num }: { label: string; active: boolean; dir: 1 | -1; onSort: () => void; num?: boolean }) {
  return (
    <th scope="col" className={cx(num && 'num')} aria-sort={active ? (dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="th-btn" onClick={onSort}>
        <span className="th-label">{label}</span>
        <Icon name={active ? (dir === 1 ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down'} size={12} className={cx(!active && 'th-sort-idle')} />
      </button>
    </th>
  );
}

export function TableFooter({
  range,
  page,
  pageCount,
  onPage,
  labels,
}: {
  range: string;
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
  labels: { nav: string; prev: string; next: string; first: string; last: string; page: (p: number, n: number) => string };
}) {
  return (
    <div className="grid-footer rp-footer">
      <span className="grid-footer-range" aria-live="polite">
        {range}
      </span>
      <nav className="grid-pages" aria-label={labels.nav}>
        <IconButton icon="chevron-left" label={labels.prev} disabledReason={page === 0 ? labels.first : undefined} onClick={() => onPage(page - 1)} />
        <span className="muted small">{labels.page(page + 1, pageCount)}</span>
        <IconButton icon="chevron-right" label={labels.next} disabledReason={page >= pageCount - 1 ? labels.last : undefined} onClick={() => onPage(page + 1)} />
      </nav>
    </div>
  );
}
