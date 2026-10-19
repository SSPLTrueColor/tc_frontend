import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../../lib/format';
import { compactInr, formatCell, formatKpi } from '../../services/reports/format';
import type { ReportColumn, ReportRow } from '../../services/reports/types';
import type { Tile } from '../../services/reports/dashboard';
import { IconButton } from '../../components/primitives/Button';
import { EmptyValue } from '../../components/primitives/display';
import { Icon } from '../../components/primitives/Icon';
import { SelectMenu } from '../../components/primitives/SelectMenu';

export const fmtValue = (v: number, unit: string, money?: boolean) => (money ? compactInr(v) : unit === '%' ? `${v}%` : `${Math.round(v * 10) / 10} ${unit}`);

/**
 * Single-series ranked bar chart (dataviz: one series = slot-1 colour, no legend; thin bars with a
 * rounded data end anchored to the baseline; recessive axis; hover tooltip via the global tooltip
 * layer; table alternative). Horizontal so long category names stay readable at any width.
 */
export function RankBars({ data, label, unit, money, to }: { data: { key: string; label: string; value: number }[]; label: string; unit: string; money?: boolean; to?: string }) {
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(0, ...data.map((d) => d.value));
  const scale = max > 0 ? max : 1;
  return (
    <figure className="chart">
      <div className="chart-head">
        <figcaption className="chart-title">{label}</figcaption>
        {to && (
          <Link to={to} className="link small">
            Details
          </Link>
        )}
        <button type="button" className="link small" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable}>
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {!data.length || max === 0 ? (
        <p className="muted small">No data for this selection.</p>
      ) : asTable ? (
        <table className="mini-table rep-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="num">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td className="num">{fmtValue(d.value, unit, money)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="rb-rows" role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${fmtValue(d.value, unit, money)}`).join(', ')}`}>
            {data.map((d) => (
              <div key={d.key} className="rb-row" data-tooltip={`${d.label}: ${fmtValue(d.value, unit, money)}`}>
                <span className="rb-label">{d.label}</span>
                <span className="rb-track">
                  <span className="rb-bar" style={{ width: `${Math.max(0, (d.value / scale) * 100)}%` }} />
                </span>
              </div>
            ))}
          </div>
          <div className="rb-axis" aria-hidden="true">
            <span />
            <span className="rb-ticks">
              <span>{fmtValue(0, unit, money)}</span>
              <span>{fmtValue(max / 2, unit, money)}</span>
              <span>{fmtValue(max, unit, money)}</span>
            </span>
          </div>
        </>
      )}
    </figure>
  );
}

/** KPI tiles; empty values render the shared N/A. */
export function KpiTiles({ tiles, label }: { tiles: Tile[]; label: string }) {
  if (!tiles.length) return null;
  return (
    <section className="stats" aria-label={label}>
      {tiles.map((t) => {
        const v = formatKpi(t.value, { compact: true });
        const body = (
          <>
            <span className="stat-label">{t.label}</span>
            <span className="stat-value">{v ? v : <EmptyValue />}</span>
            {t.sub && <span className="stat-sub">{t.sub}</span>}
          </>
        );
        return t.to ? (
          <Link key={t.label} className="stat" to={t.to}>
            {body}
          </Link>
        ) : (
          <div key={t.label} className="stat">
            {body}
          </div>
        );
      })}
    </section>
  );
}

const PAGE_SIZES = [25, 50, 100];

/** Sortable, searchable, paginated report table. */
export function ReportTable({ columns, rows, search, caption, footer }: { columns: ReportColumn[]; rows: ReportRow[]; search: string; caption: string; footer?: ReactNode }) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = q ? rows.filter((r) => columns.some((c) => formatCell(c, r[c.key]).toLowerCase().includes(q))) : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      out = [...out].sort((a, b) => {
        const av = a[sort.key];
        const bv = b[sort.key];
        const empty = (v: unknown) => v === null || v === undefined || v === '';
        if (empty(av) && empty(bv)) return 0;
        if (empty(av)) return 1;
        if (empty(bv)) return -1;
        const cmp = col && ['money', 'number', 'pct', 'hours', 'days'].includes(col.type ?? '') ? Number(av) - Number(bv) : String(col ? formatCell(col, av) : av).localeCompare(String(col ? formatCell(col, bv) : bv), undefined, { numeric: true });
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, columns, search, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  const p = Math.min(page, pageCount - 1);
  const shown = filtered.slice(p * size, p * size + size);
  const numeric = (c: ReportColumn) => ['money', 'number', 'pct', 'hours', 'days'].includes(c.type ?? '');
  return (
    <>
      <div className="table-scroll">
        <table className="mini-table rep-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => {
                const on = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" className={cx(numeric(c) && 'num')} aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button
                      type="button"
                      className="th-btn"
                      onClick={() => {
                        setSort(on && sort!.dir === 'desc' ? { key: c.key, dir: 'asc' } : { key: c.key, dir: on ? 'desc' : numeric(c) ? 'desc' : 'asc' });
                        setPage(0);
                      }}
                    >
                      <span className="th-label">{c.label}</span>
                      <Icon name={on ? (sort!.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down'} size={12} className={cx(!on && 'th-sort-idle')} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r._key}>
                {columns.map((c, i) => {
                  const text = formatCell(c, r[c.key]);
                  const href = c.link?.(r);
                  const cell = text ? text : <EmptyValue />;
                  return (
                    <td key={c.key} className={cx(numeric(c) && 'num')}>
                      {href && text ? (
                        <Link to={href} className={i === 0 ? 'rel-link' : 'link'}>
                          {cell}
                        </Link>
                      ) : (
                        cell
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-footer">
        <span className="grid-footer-range" aria-live="polite">
          <strong>
            {filtered.length ? p * size + 1 : 0}–{Math.min(filtered.length, (p + 1) * size)}
          </strong>{' '}
          of {filtered.length.toLocaleString('en-IN')} rows
        </span>
        {footer}
        <nav className="grid-pages" aria-label="Pagination">
          <IconButton icon="chevron-left" label="Previous page" disabledReason={p === 0 ? 'First page' : undefined} onClick={() => setPage(p - 1)} />
          <span className="muted small">
            Page {p + 1} of {pageCount}
          </span>
          <IconButton icon="chevron-right" label="Next page" disabledReason={p >= pageCount - 1 ? 'Last page' : undefined} onClick={() => setPage(p + 1)} />
        </nav>
        <SelectMenu
          label="Rows per page"
          value={size}
          options={PAGE_SIZES.map((x) => ({ value: x, label: `${x} / page` }))}
          onChange={(x) => {
            setSize(x);
            setPage(0);
          }}
        />
      </div>
    </>
  );
}
