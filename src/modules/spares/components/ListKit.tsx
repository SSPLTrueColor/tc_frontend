import { useMemo, useState, type ReactNode } from 'react';
import { IconButton } from '../../../components/primitives/Button';
import { Icon } from '../../../components/primitives/Icon';
import { SelectMenu } from '../../../components/primitives/SelectMenu';
import { cx } from '../../../lib/format';

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** Sort value; omit for unsortable columns. */
  sort?: (row: T) => string | number;
  num?: boolean;
}

const PAGE_SIZES = [25, 50, 100];

/**
 * Computed (non-resource) lists: client-side search, sortable headers and pagination with the
 * template's table classes. Filters are passed in already applied by the page.
 */
export function SimpleTable<T>({ rows, columns, rowKey, search, initialSort, label }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; search: (r: T) => string; initialSort?: { key: string; dir: 'asc' | 'desc' }; label: string }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(PAGE_SIZES[0]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle ? rows.filter((r) => search(r).toLowerCase().includes(needle)) : rows;
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
  const shown = filtered.slice(p * size, p * size + size);
  return (
    <>
      <div className="toolbar">
        <div className="search-field">
          <span className="search-icon" aria-hidden="true">
            <Icon name="search" size={14} />
          </span>
          <input
            type="search"
            className="input input-compact"
            placeholder="Search"
            aria-label={`Search ${label}`}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
          />
        </div>
      </div>
      <div className="sp-table-wrap">
        <table className="mini-table" aria-label={label}>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" className={cx(c.num && 'num')} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
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
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={cx(c.num && 'num')}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={columns.length} className="muted">
                  No rows match “{q}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="grid-footer">
        <span className="grid-footer-range" aria-live="polite">
          <strong>
            {filtered.length ? p * size + 1 : 0}–{Math.min(filtered.length, (p + 1) * size)}
          </strong>{' '}
          of {filtered.length}
        </span>
        <nav className="grid-pages" aria-label="Pagination">
          <IconButton icon="chevron-left" label="Previous page" disabledReason={p === 0 ? 'First page' : undefined} onClick={() => setPage(p - 1)} />
          <span className="muted small">
            Page {p + 1} of {pages}
          </span>
          <IconButton icon="chevron-right" label="Next page" disabledReason={p >= pages - 1 ? 'Last page' : undefined} onClick={() => setPage(p + 1)} />
        </nav>
        <SelectMenu
          label="Rows per page"
          value={size}
          options={PAGE_SIZES.map((n) => ({ value: n, label: `${n} / page` }))}
          onChange={(n) => {
            setSize(n);
            setPage(0);
          }}
        />
      </div>
    </>
  );
}
