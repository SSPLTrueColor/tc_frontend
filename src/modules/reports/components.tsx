import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../../lib/format';
import { compactInr, formatCell, formatKpi } from '../../services/reports/format';
import type { ChartPolarity, ReportColumn, ReportRow } from '../../services/reports/types';
import type { ChartBar, Signal, Tile } from '../../services/reports/dashboard';
import { IconButton } from '../../components/primitives/Button';
import { EmptyValue } from '../../components/primitives/display';
import { Icon } from '../../components/primitives/Icon';
import { SelectMenu } from '../../components/primitives/SelectMenu';

/** "1 ticket" / "3 tickets"; money compact (₹1.2 Cr); percentages as "42%". */
export const fmtValue = (v: number, unit: string, money?: boolean) => {
  if (money) return compactInr(v);
  if (unit === '%') return `${v}%`;
  const n = Math.round(v * 10) / 10;
  return `${n} ${n === 1 && unit.endsWith('s') ? unit.slice(0, -1) : unit}`;
};

const SIGNAL_TEXT: Record<Signal, string> = { success: 'good', warning: 'needs attention', danger: 'act now', info: 'information', neutral: '' };

/**
 * Ranked bar chart. Bars are coloured by meaning (green good, amber needs attention, red act now,
 * blue in progress, grey neutral) with a legend; each bar prints its value so the chart reads
 * without an axis. Horizontal so long names stay readable; "Show table" is the accessible alternative.
 */
export function RankBars({ data: raw, label, unit, money, to, legend: given, compact, polarity }: { data: ChartBar[]; label: string; unit: string; money?: boolean; to?: string; legend?: { tone: Signal; label: string }[]; compact?: boolean; polarity?: ChartPolarity }) {
  const [asTable, setAsTable] = useState(false);
  const { data, legend } = raw.some((d) => d.tone) || !polarity ? { data: raw, legend: given } : signalBars(raw, polarity);
  const max = Math.max(0, ...data.map((d) => d.value));
  const scale = max > 0 ? max : 1;
  const used = new Set(data.map((d) => d.tone ?? 'accent'));
  const shownLegend = (legend ?? []).filter((l) => used.has(l.tone));
  return (
    <figure className={cx('chart', compact && 'chart-compact')}>
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
              {shownLegend.length > 0 && <th scope="col">Status</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td className="num">{fmtValue(d.value, unit, money)}</td>
                {shownLegend.length > 0 && <td>{legend?.find((l) => l.tone === d.tone)?.label ?? ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="rb-rows" role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${fmtValue(d.value, unit, money)}${d.tone ? ` (${legend?.find((l) => l.tone === d.tone)?.label ?? SIGNAL_TEXT[d.tone]})` : ''}`).join(', ')}`}>
            {data.map((d) => (
              <div key={d.key} className="rb-row" data-tooltip={`${d.label}: ${fmtValue(d.value, unit, money)}${d.tone && legend ? ` · ${legend.find((l) => l.tone === d.tone)?.label ?? ''}` : ''}`}>
                <span className="rb-label">{d.label}</span>
                <span className="rb-track">
                  <span className={cx('rb-bar', d.tone && `tone-${d.tone}`)} style={{ width: `${Math.max(0, (d.value / scale) * 100)}%` }} />
                </span>
                <span className="rb-value">{fmtValue(d.value, unit, money)}</span>
              </div>
            ))}
          </div>
          {shownLegend.length > 0 && (
            <ul className="rb-legend" aria-label="Colour meaning">
              {shownLegend.map((l) => (
                <li key={l.tone} className={`tone-${l.tone}`}>
                  <span className="rb-swatch" aria-hidden="true" />
                  {l.label}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </figure>
  );
}

/**
 * Colours bars by meaning when a report gives only a direction:
 * higher/lower is better → compared with the series average; ageing → older buckets are worse;
 * neutral → one calm colour, no legend.
 */
export function signalBars(data: ChartBar[], polarity: ChartPolarity): { data: ChartBar[]; legend?: { tone: Signal; label: string }[] } {
  if (polarity === 'neutral') return { data: data.map((d) => ({ ...d, tone: 'info' })) };
  if (polarity === 'ageing') {
    const last = data.length - 1;
    return {
      data: data.map((d, i) => ({ ...d, tone: i === 0 ? 'success' : i === last && last > 1 ? 'danger' : 'warning' })),
      legend: [
        { tone: 'success', label: 'Recent' },
        { tone: 'warning', label: 'Getting old' },
        { tone: 'danger', label: 'Oldest — act first' },
      ],
    };
  }
  const avg = data.length ? data.reduce((t, d) => t + d.value, 0) / data.length : 0;
  if (polarity === 'higher')
    return {
      data: data.map((d) => ({ ...d, tone: d.value >= avg ? 'success' : 'warning' })),
      legend: [
        { tone: 'success', label: 'At or above average' },
        { tone: 'warning', label: 'Below average' },
      ],
    };
  return {
    data: data.map((d) => ({ ...d, tone: avg && d.value >= avg * 1.5 ? 'danger' : d.value > avg ? 'warning' : 'success' })),
    legend: [
      { tone: 'success', label: 'At or below average' },
      { tone: 'warning', label: 'Above average' },
      { tone: 'danger', label: 'Far above average (1.5×)' },
    ],
  };
}

/** KPI tiles; empty values render the shared N/A. */
export function KpiTiles({ tiles, label }: { tiles: Tile[]; label: string }) {
  if (!tiles.length) return null;
  return (
    <section className="stats" aria-label={label}>
      {tiles.map((t) => {
        const v = formatKpi(t.value, { compact: true });
        const tone = v && t.tone && t.tone !== 'neutral' ? t.tone : undefined;
        const body = (
          <>
            <span className="stat-label">{t.label}</span>
            <span className={cx('stat-value', tone && `tone-${tone} has-signal`)}>
              {tone && <span className="stat-dot" aria-hidden="true" />}
              {v ? v : <EmptyValue />}
              {tone && SIGNAL_TEXT[tone] && <span className="sr-only"> ({SIGNAL_TEXT[tone]})</span>}
            </span>
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
