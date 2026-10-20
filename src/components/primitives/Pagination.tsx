/**
 * The one list footer: "1–25 of 140 leads", numbered pages, rows per page.
 * Used by every table and list (resource lists, computed lists, reports, Settings). Labels come from L.common.list.
 */
import { useState } from 'react';
import { L } from '../../constants/labels';
import { cx } from '../../lib/format';
import { IconButton } from './Button';
import { SelectMenu } from './SelectMenu';

const LS = L.common.list;
export const PAGE_SIZES = [25, 50, 100];

/** All pages when there are 7 or fewer, else 1 … p-1 p p+1 … N */
export function pageList(page: number, count: number): (number | 'gap')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const set = new Set([0, count - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < count));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

export interface PaginationProps {
  /** Zero-based current page. */
  page: number;
  pageSize: number;
  total: number;
  /** What the rows are, plural: "leads". */
  noun: string;
  onPage: (p: number) => void;
  /** Omit to hide "rows per page" (fixed page size). */
  onSize?: (n: number) => void;
  sizes?: number[];
  className?: string;
}

export function Pagination({ page, pageSize, total, noun, onPage, onSize, sizes = PAGE_SIZES, className }: PaginationProps) {
  if (!total) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(page, pageCount - 1);
  const from = p * pageSize + 1;
  const to = Math.min(total, (p + 1) * pageSize);
  return (
    <div className={cx('grid-footer', className)}>
      <span className="grid-footer-range" aria-live="polite">
        <strong>
          {from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')}
        </strong>{' '}
        {LS.ofTotal(total.toLocaleString('en-IN'), noun)}
      </span>
      {pageCount > 1 && (
        <nav className="grid-pages" aria-label={LS.pagination}>
          <IconButton icon="chevron-left" label={LS.previousPage} disabledReason={p === 0 ? LS.firstPage : undefined} onClick={() => onPage(p - 1)} />
          {pageList(p, pageCount).map((n, i) =>
            n === 'gap' ? (
              <span key={`g${i}`} className="grid-page-gap" aria-hidden="true">
                …
              </span>
            ) : (
              <button key={n} type="button" className={cx('grid-page', n === p && 'is-current')} aria-current={n === p ? 'page' : undefined} aria-label={LS.page(n + 1)} onClick={() => onPage(n)}>
                {n + 1}
              </button>
            ),
          )}
          <IconButton icon="chevron-right" label={LS.nextPage} disabledReason={p >= pageCount - 1 ? LS.lastPage : undefined} onClick={() => onPage(p + 1)} />
        </nav>
      )}
      {onSize && <SelectMenu label={LS.rowsPerPage} value={pageSize} options={sizes.map((n) => ({ value: n, label: LS.perPage(n) }))} onChange={onSize} />}
    </div>
  );
}

/** Client-side paging for an array: `shown` is the current page, `footer(noun)` renders the Pagination. */
export function usePaged<T>(rows: T[], initialSize = 25) {
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(initialSize);
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(page, pageCount - 1);
  return {
    shown: rows.slice(p * size, (p + 1) * size),
    page: p,
    size,
    footer: (noun: string) => (
      <Pagination
        page={p}
        pageSize={size}
        total={rows.length}
        noun={noun}
        onPage={setPage}
        onSize={(n) => {
          setSize(n);
          setPage(0);
        }}
      />
    ),
    reset: () => setPage(0),
  };
}
