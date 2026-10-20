/**
 * DataTable — the table for computed (non-resource) lists: sortable headers, optional search, one pagination,
 * and the same loading / error / empty / no-match states everywhere. Resource lists use DataGrid (views, bulk actions).
 * Use `Table` for small static tables that need no sorting or paging.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { L } from '../../constants/labels';
import { cx } from '../../lib/format';
import { SearchInput } from './controls';
import { EmptyState, ErrorState, Skeleton } from './feedback';
import { Icon } from './Icon';
import { Pagination } from './Pagination';

const T = L.common.table;

export interface Column<R> {
  key: string;
  label: string;
  render: (row: R) => ReactNode;
  /** Sort value; omit for an unsortable column. */
  sort?: (row: R) => string | number;
  /** Right-aligned numbers. */
  num?: boolean;
  className?: string;
}
export type SortState = { key: string; dir: 'asc' | 'desc' };

export interface DataTableProps<R> {
  rows: R[];
  columns: Column<R>[];
  rowKey: (r: R) => string;
  /** Accessible name of the table. */
  label: string;
  /** What a row is, plural ("leads"); used in the footer and search placeholder. */
  noun?: string;
  initialSort?: SortState;
  pageSize?: number;
  /** Provide to show a search box; return the text a row is searched by. */
  search?: (r: R) => string;
  /** Filters / summary on the toolbar line after the search box. */
  tools?: ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Shown when there are no rows at all (before any search). */
  empty?: { icon?: string; title: string; body?: ReactNode; action?: ReactNode };
  onRowClick?: (r: R) => void;
  /** Text of the row shown when filters leave nothing (default: "Nothing to show"). */
  emptyText?: string;
}

export function DataTable<R>({ rows, columns, rowKey, label, noun = T.rows, initialSort, pageSize = 25, search, tools, loading, error, onRetry, empty, onRowClick, emptyText }: DataTableProps<R>) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(pageSize);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle && search ? rows.filter((r) => search(r).toLowerCase().includes(needle)) : rows;
    const col = sort && columns.find((c) => c.key === sort.key);
    if (col?.sort) {
      const f = col.sort;
      out = [...out].sort((a, b) => {
        const x = f(a);
        const y = f(b);
        const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
        return sort!.dir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, q, sort, columns, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const p = Math.min(page, pages - 1);
  const shown = filtered.slice(p * size, (p + 1) * size);

  const toolbar = (search || tools) && (
    <div className="toolbar">
      {search && (
        <SearchInput
          placeholder={T.search}
          aria-label={T.searchAria(label)}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
      )}
      {tools}
    </div>
  );
  if (error)
    return (
      <>
        {toolbar}
        <ErrorState onRetry={onRetry}>{error}</ErrorState>
      </>
    );
  if (loading)
    return (
      <>
        {toolbar}
        <Skeleton rows={6} />
      </>
    );
  if (!rows.length && empty)
    return (
      <>
        {toolbar}
        <EmptyState icon={empty.icon} title={empty.title} action={empty.action}>
          {empty.body}
        </EmptyState>
      </>
    );
  return (
    <>
      {toolbar}
      <div className="table-scroll">
        <table className={cx('mini-table', onRowClick && 'is-clickable')} aria-label={label}>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" className={cx(c.num && 'num', c.className)} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sort ? (
                      <button type="button" className="th-btn" onClick={() => setSort(active && sort!.dir === 'asc' ? { key: c.key, dir: 'desc' } : { key: c.key, dir: 'asc' })}>
                        <span className="th-label">{c.label}</span>
                        <Icon name={active ? (sort!.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down'} size={12} />
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={cx(c.num && 'num', c.className)}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={columns.length} className="muted">
                  {q.trim() ? T.noMatch(q) : (emptyText ?? T.noRows)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        page={p}
        pageSize={size}
        total={filtered.length}
        noun={noun}
        onPage={setPage}
        onSize={(n) => {
          setSize(n);
          setPage(0);
        }}
      />
    </>
  );
}
