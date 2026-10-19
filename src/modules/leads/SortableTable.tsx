import { useMemo, useState, type ReactNode } from 'react';
import { IconButton } from '../../components/primitives/Button';
import { Icon } from '../../components/primitives/Icon';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { L } from '../../constants/labels';
import { cx } from '../../lib/format';

const T = L.leads.table;

export interface Column<R> {
  key: string;
  label: string;
  render: (row: R) => ReactNode;
  /** Sort value; omit for unsortable columns. */
  sort?: (row: R) => string | number;
  num?: boolean;
}

export type SortState = { key: string; dir: 'asc' | 'desc' };

const PAGE_SIZES = [25, 50, 100];

/** Computed (non-resource) list with sortable headers and pagination, in the template's table style. Rows arrive already searched/filtered. */
export function SortableTable<R>({ rows, columns, rowKey, label, initialSort }: { rows: R[]; columns: Column<R>[]; rowKey: (r: R) => string; label: string; initialSort?: SortState }) {
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(PAGE_SIZES[0]);
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const f = col.sort;
    return [...rows].sort((a, b) => {
      const x = f(a);
      const y = f(b);
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, columns]);
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const p = Math.min(page, pages - 1);
  const shown = sorted.slice(p * size, p * size + size);
  return (
    <>
      <div className="table-scroll">
        <table className="mini-table" aria-label={label}>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" className={cx(c.num && 'num')} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sort ? (
                      <button type="button" className="th-btn" onClick={() => setSort(active && sort.dir === 'asc' ? { key: c.key, dir: 'desc' } : { key: c.key, dir: 'asc' })}>
                        <span className="th-label">{c.label}</span>
                        <Icon name={active ? (sort.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down'} size={12} />
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
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={cx(c.num && 'num')}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-footer">
        <span className="grid-footer-range" aria-live="polite">
          <strong>{T.range(sorted.length ? p * size + 1 : 0, Math.min(sorted.length, (p + 1) * size))}</strong> {T.of(sorted.length)}
        </span>
        <nav className="grid-pages" aria-label={T.pagination}>
          <IconButton icon="chevron-left" label={T.prev} disabledReason={p === 0 ? T.first : undefined} onClick={() => setPage(p - 1)} />
          <span className="muted small">{T.page(p + 1, pages)}</span>
          <IconButton icon="chevron-right" label={T.next} disabledReason={p >= pages - 1 ? T.last : undefined} onClick={() => setPage(p + 1)} />
        </nav>
        <SelectMenu
          label={T.rowsPerPage}
          value={size}
          options={PAGE_SIZES.map((n) => ({ value: n, label: T.perPage(n) }))}
          onChange={(n) => {
            setSize(n);
            setPage(0);
          }}
        />
      </div>
    </>
  );
}
