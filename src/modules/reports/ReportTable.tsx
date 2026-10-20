import { Skeleton, SkeletonLine } from '../../components/primitives/Skeleton';
import { Pagination, PAGE_SIZES } from '../../components/primitives/Pagination';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { L } from '../../constants/labels';
import { Button } from '../../components/primitives/Button';
import { EmptyState } from '../../components/primitives/feedback';
import { EmptyValue } from '../../components/primitives/display';
import { Icon } from '../../components/primitives/Icon';
import { Table } from '../../components/primitives/Table';
import { Popover } from '../../components/primitives/overlay';
import { cx } from '../../lib/format';
import { totalsFor } from '../../services/reports/engine';
import { formatCell } from '../../services/reports/format';
import type { ReportColumn, ReportRow } from '../../services/reports/types';
import { Checkbox, SearchInput } from '../../components/primitives/controls';

const T = L.reports.page.table;
const MAX_DEFAULT_COLUMNS = 7;
const NUMERIC = new Set(['money', 'number', 'pct', 'hours', 'days']);
const RAW_SORT = new Set(['date', 'month']);

export const isNumericColumn = (c: ReportColumn) => NUMERIC.has(c.type ?? '');

/** Columns shown until the user changes it: the first seven that are not marked optional. */
const defaultVisible = (columns: ReportColumn[]) => columns.filter((c) => !c.optional).slice(0, MAX_DEFAULT_COLUMNS).map((c) => c.key);

interface Persisted {
  key: string;
  search: string;
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  page: number;
  size: number;
  shown: string[] | null;
}

export interface TableModel {
  columns: ReportColumn[];
  visible: ReportColumn[];
  rows: ReportRow[];
  pageRows: ReportRow[];
  page: number;
  pageCount: number;
  size: number;
  search: string;
  sort: Persisted['sort'];
  isDefaultColumns: boolean;
  totals: Record<string, number | null>;
  allTotals: Record<string, number | null>;
  setSearch: (s: string) => void;
  toggleSort: (key: string) => void;
  setPage: (p: number) => void;
  setSize: (n: number) => void;
  toggleColumn: (key: string) => void;
  resetColumns: () => void;
}

/**
 * Search, sort, column choice and paging of one report view. State belongs to `resetKey`
 * (report + view), so switching view starts clean but a background refresh keeps the user's place.
 */
export function useTableModel(columns: ReportColumn[], rows: ReportRow[], resetKey: string): TableModel {
  const [state, setState] = useState<Persisted>({ key: resetKey, search: '', sort: null, page: 0, size: PAGE_SIZES[0], shown: null });
  const cur: Persisted = state.key === resetKey ? state : { key: resetKey, search: '', sort: null, page: 0, size: PAGE_SIZES[0], shown: null };
  const patch = (p: Partial<Persisted>) => setState({ ...cur, ...p });

  const shownKeys = cur.shown ?? defaultVisible(columns);
  const visible = useMemo(() => columns.filter((c) => shownKeys.includes(c.key)), [columns, shownKeys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = cur.search.trim().toLowerCase();
    let out = q ? rows.filter((r) => columns.some((c) => formatCell(c, r[c.key]).toLowerCase().includes(q))) : rows;
    if (cur.sort) {
      const col = columns.find((c) => c.key === cur.sort!.key);
      const dir = cur.sort.dir === 'asc' ? 1 : -1;
      const empty = (v: unknown) => v === null || v === undefined || v === '';
      out = [...out].sort((a, b) => {
        const av = a[cur.sort!.key];
        const bv = b[cur.sort!.key];
        if (empty(av) && empty(bv)) return 0;
        if (empty(av)) return 1;
        if (empty(bv)) return -1;
        if (col && (isNumericColumn(col) || col.type === 'kpi')) {
          const x = Number(av);
          const y = Number(bv);
          if (Number.isFinite(x) && Number.isFinite(y)) return (x - y) * dir;
        }
        const sa = col && !RAW_SORT.has(col.type ?? '') ? formatCell(col, av) : String(av);
        const sb = col && !RAW_SORT.has(col.type ?? '') ? formatCell(col, bv) : String(bv);
        return sa.localeCompare(sb, undefined, { numeric: true }) * dir;
      });
    }
    return out;
  }, [rows, columns, cur.search, cur.sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / cur.size));
  const page = Math.min(cur.page, pageCount - 1);
  const pageRows = filtered.slice(page * cur.size, page * cur.size + cur.size);
  const allTotals = useMemo(() => totalsFor(columns, rows), [columns, rows]);
  const totals = useMemo(() => (cur.search.trim() ? totalsFor(columns, filtered) : allTotals), [columns, filtered, allTotals, cur.search]);

  return {
    columns,
    visible,
    rows: filtered,
    pageRows,
    page,
    pageCount,
    size: cur.size,
    search: cur.search,
    sort: cur.sort,
    isDefaultColumns: cur.shown === null,
    totals,
    allTotals,
    setSearch: (s) => patch({ search: s, page: 0 }),
    toggleSort: (key) => {
      const col = columns.find((c) => c.key === key);
      const first = col && isNumericColumn(col) ? 'desc' : 'asc';
      const next = cur.sort?.key !== key ? { key, dir: first as 'asc' | 'desc' } : cur.sort.dir === first ? { key, dir: (first === 'asc' ? 'desc' : 'asc') as 'asc' | 'desc' } : null;
      patch({ sort: next, page: 0 });
    },
    setPage: (p) => patch({ page: p }),
    setSize: (n) => patch({ size: n, page: 0 }),
    toggleColumn: (key) => {
      const next = shownKeys.includes(key) ? shownKeys.filter((k) => k !== key) : [...shownKeys, key];
      if (next.length) patch({ shown: next });
    },
    resetColumns: () => patch({ shown: null }),
  };
}


function ColumnsMenu({ model }: { model: TableModel }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const shown = new Set(model.visible.map((c) => c.key));
  return (
    <>
      <Button ref={anchor} icon="columns" iconRight={open ? 'chevron-up' : 'chevron-down'} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {T.columns}
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} label={T.columns} width={260} align="end">
        <ul className="rp-colmenu">
          {model.columns.map((c) => (
            <li key={c.key}>
              <label className="rp-check">
                <Checkbox checked={shown.has(c.key)} disabled={shown.has(c.key) && shown.size === 1} onChange={() => model.toggleColumn(c.key)} />
                <span>{c.label}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="rp-colmenu-foot">
          <button type="button" className="link small" disabled={model.isDefaultColumns} onClick={model.resetColumns}>
            {T.resetColumns}
          </button>
        </div>
      </Popover>
    </>
  );
}

function rowHref(columns: ReportColumn[], row: ReportRow): string | undefined {
  for (const c of columns) {
    const href = c.link?.(row);
    if (href) return href;
  }
  return undefined;
}

export function ReportTable({ model, title, busy, onChangeFilters }: { model: TableModel; title: string; busy?: boolean; onChangeFilters?: () => void }) {
  const nav = useNavigate();
  const { visible, columns } = model;
  const hasTotals = visible.some((c) => c.total);
  const searching = model.search.trim().length > 0;
  const total = model.rows.length;

  return (
    <section className={cx('panel rp-tablecard', busy && 'is-busy')} aria-label={title} aria-busy={busy || undefined}>
      <div className="rp-tablebar">
        <h2 className="panel-title">{title}</h2>
        <div className="rp-tabletools">
          <SearchInput dense className="rp-search" placeholder={T.search} aria-label={T.search} value={model.search} onChange={(e) => model.setSearch(e.target.value)} />
          <ColumnsMenu model={model} />
        </div>
      </div>
      {model.rows.length === 0 ? (
        <EmptyState icon="search" title={searching ? T.noMatchTitle : T.emptyTitle} action={searching ? <Button onClick={() => model.setSearch('')}>{T.clearSearch}</Button> : onChangeFilters ? <Button onClick={onChangeFilters}>{T.changeFilters}</Button> : undefined}>
          {searching ? T.noMatchBody : T.emptyBody}
        </EmptyState>
      ) : (
        <>
          <div className="rp-scroll" tabIndex={0} role="region" aria-label={`${title}: ${T.scrollable}`}>
            <Table className="rp-table" scroll={false}>
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>
                  {visible.map((c) => {
                    const on = model.sort?.key === c.key;
                    return (
                      <th key={c.key} scope="col" className={cx(isNumericColumn(c) && 'num')} aria-sort={on ? (model.sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                        <button type="button" className="th-btn" onClick={() => model.toggleSort(c.key)}>
                          <span className="th-label" data-tooltip={c.label}>
                            {c.label}
                          </span>
                          <Icon name={on ? (model.sort!.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down'} size={12} className={cx(!on && 'th-sort-idle')} />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {model.pageRows.map((r) => {
                  const href = rowHref(columns, r);
                  return (
                    <tr
                      key={r._key}
                      className={cx(href && 'is-link')}
                      onClick={href ? (e) => { if (!(e.target as HTMLElement).closest('a,button')) nav(href); } : undefined}
                    >
                      {visible.map((c, i) => {
                        const text = formatCell(c, r[c.key]);
                        const to = c.link?.(r);
                        const neg = isNumericColumn(c) && Number(r[c.key]) < 0;
                        return (
                          <td key={c.key} className={cx(isNumericColumn(c) && 'num', neg && 'is-neg')}>
                            {text ? to ? <Link to={to} className={cx('rp-cell', i === 0 ? 'rel-link' : 'link')}>{text}</Link> : <span className="rp-cell">{text}</span> : <EmptyValue />}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              {hasTotals && (
                <tfoot>
                  <tr>
                    {visible.map((c, i) => {
                      const v = model.totals[c.key];
                      return (
                        <td key={c.key} className={cx(isNumericColumn(c) && 'num')}>
                          {i === 0 ? <span className="rp-total-label">{searching ? T.totalMatching : T.grandTotal}</span> : v !== undefined && v !== null ? formatCell(c, v) : ''}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>
          <Pagination className="rp-footer" page={model.page} pageSize={model.size} total={total} noun={T.rows} onPage={model.setPage} onSize={model.setSize} sizes={PAGE_SIZES} />
        </>
      )}
    </section>
  );
}

export function TableSkeleton() {
  return (
    <section className="panel rp-tablecard" aria-busy="true" aria-label={L.common.states.loading}>
      <div className="rp-tablebar">
        <SkeletonLine size="title" />
      </div>
      <Skeleton rows={8} className="rp-skel-table" />
    </section>
  );
}
