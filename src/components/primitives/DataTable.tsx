/**
 * DataTable — the table for computed (non-resource) lists: sortable headers, optional search, one pagination,
 * and the same loading / error / empty / no-match states everywhere. Resource lists use DataGrid (views, bulk actions).
 * Use `Table` for small static tables that need no sorting or paging.
 */
import { createContext, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { L } from '../../constants/labels';
import { cx } from '../../lib/format';
import { Button, IconButton } from './Button';
import { Checkbox, SearchInput } from './controls';
import { Popover } from './overlay';
import { csvCell, downloadText } from '../../services/exporter';
import { EmptyState, ErrorState, Skeleton } from './feedback';
import { Icon } from './Icon';
import { Pagination } from './Pagination';
import { FilterPanelButton } from './FilterPanel';

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
  /** Column-type icon at the right end of the header (default: text, or # for numbers). */
  icon?: string;
  /** The row-actions column: pinned to the right edge, like the menu tables. (`key: 'act'` is the same.) */
  actions?: boolean;
}
/** `ListPage` turns this on so every DataTable inside it fills the page (full width, footer pinned to the bottom). */
export const FillContext = createContext(false);

/**
 * Page buttons handed down by ListPage ("Import", "Add Manually" …). The first DataTable on the page claims them and
 * draws them in its filter bar, so the page needs no separate button row; until a table mounts (loading / error /
 * empty screens) the page header keeps showing them.
 */
export const ListActionsContext = createContext<{ actions?: ReactNode; owner: string | null; claim: (id: string) => () => void } | null>(null);
/** Page-controlled row selection (bulk actions): the page owns the set, decides which rows can be picked and supplies the toolbar actions. */
export interface DataTableSelection<R> {
  keys: Set<string>;
  onChange: (keys: Set<string>) => void;
  canSelect?: (r: R) => boolean;
  selectAllLabel: string;
  rowLabel: (r: R) => string;
  /** Shown in the filter bar while something is selected (count, clear, the bulk button). */
  actions: ReactNode;
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
  /** Search term to start with (deep links). */
  initialSearch?: string;
  /** Placed before the search box (e.g. a workspace switcher), so the page needs no extra row above the table. */
  leading?: ReactNode;
  /** Buttons at the far end of the filter bar, after the column and filter buttons (e.g. "New Lead"). */
  actions?: ReactNode;
  /** Filter dropdowns, placed right after the search box (the same order on every list). */
  filters?: ReactNode;
  /** How many filters are applied; with a search term it shows "Clear filters". */
  activeFilters?: number;
  /** Reset the page's filters (the search box is cleared too). */
  onClearFilters?: () => void;
  /** Short count / total shown at the right end of the filter bar ("12 orders · ₹4.2 L"). */
  summary?: ReactNode;
  /** @deprecated use `filters` + `summary`; kept for pages not yet moved. */
  tools?: ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Shown when there are no rows at all (before any search). */
  empty?: {
    icon?: string;
    title: string;
    body?: ReactNode;
    action?: ReactNode;
  };
  onRowClick?: (r: R) => void;
  /** Row checkboxes with "N selected · Export" (default on, like the menu tables). */
  selectable?: boolean;
  /** Replaces the default selection (export) with page-controlled bulk selection. */
  selection?: DataTableSelection<R>;
  /** Page-filling layout used by the menu lists: full width, no radius, footer pinned to the bottom (the page needs `page page-resource` + `page-main`). */
  fill?: boolean;
  /** Text of the row shown when filters leave nothing (default: "Nothing to show"). */
  emptyText?: string;
}

const CK = L.common.table;
const isActions = <R,>(c: Column<R>) => c.actions || c.key === 'act';

export function DataTable<R>({
  rows,
  columns,
  rowKey,
  label,
  noun = T.rows,
  initialSort,
  pageSize = 25,
  search,
  initialSearch = '',
  leading,
  actions,
  filters,
  activeFilters = 0,
  onClearFilters,
  summary,
  tools,
  loading,
  error,
  onRetry,
  empty,
  onRowClick,
  emptyText,
  selectable: selectableProp = true,
  selection,
  fill: fillProp,
}: DataTableProps<R>) {
  const inFillPage = useContext(FillContext);
  const listActions = useContext(ListActionsContext);
  const tableId = useId();
  const claim = listActions?.claim;
  const wantsPageActions = !actions && !!listActions?.actions;
  useLayoutEffect(() => (wantsPageActions && claim ? claim(tableId) : undefined), [wantsPageActions, claim, tableId]);
  const toolbarActions = actions || (listActions?.owner === tableId ? listActions.actions : null);
  const fill = fillProp ?? inFillPage;
  const [q, setQ] = useState(initialSearch);
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(pageSize);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [ownSelected, setOwnSelected] = useState<Set<string>>(new Set());
  const selected = selection ? selection.keys : ownSelected;
  const setSelected = (f: (s: Set<string>) => Set<string>) => (selection ? selection.onChange(f(selection.keys)) : setOwnSelected(f));
  const selectable = !!selection || selectableProp;
  const [colsOpen, setColsOpen] = useState(false);
  const colsRef = useRef<HTMLButtonElement>(null);
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
  const dataCols = columns.filter((c) => !isActions(c));
  const actionCol = columns.find(isActions);
  const visible = dataCols.filter((c) => !hidden.has(c.key));
  const dirty = !!q.trim() || activeFilters > 0;
  const keys = shown.filter((r) => selection?.canSelect?.(r) ?? true).map(rowKey);
  const allSelected = keys.length > 0 && keys.every((k) => selected.has(k));
  const someSelected = keys.some((k) => selected.has(k));

  const exportSelected = () => {
    const cols = visible.filter((c) => c.sort);
    const picked = rows.filter((r) => selected.has(rowKey(r)));
    const lines = [cols.map((c) => csvCell(c.label)).join(','), ...picked.map((r) => cols.map((c) => csvCell(String(c.sort!(r)))).join(','))];
    downloadText(`${label.toLowerCase().replace(/\W+/g, '-')}.csv`, lines.join('\n'));
  };

  const toolbar = (search || tools || filters || summary || leading || toolbarActions) && (
    <div className="toolbar list-filterbar">
      {leading}
      {search && (
        <div className="search-field">
          <span className="search-icon" aria-hidden="true">
            <Icon name="search" size={14} />
          </span>
          <SearchInput
            dense
            placeholder={T.search}
            aria-label={T.searchAria(label)}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
          />
        </div>
      )}
      {tools}
      {dirty && (onClearFilters || q) && (
        <button
          type="button"
          className="link small"
          onClick={() => {
            setQ('');
            setPage(0);
            onClearFilters?.();
          }}
        >
          {T.clearFilters}
        </button>
      )}
      <span className="spacer" />
      {selection && selected.size > 0 ? (
        <span className="toolbar-count">{selection.actions}</span>
      ) : selected.size > 0 ? (
        <span className="toolbar-count">
          {CK.selected(selected.size)} ·{' '}
          <button type="button" className="link small" onClick={exportSelected}>
            {CK.export}
          </button>{' '}
          ·{' '}
          <button type="button" className="link small" onClick={() => setSelected(() => new Set<string>())}>
            {CK.clearSelection}
          </button>
        </span>
      ) : (
        summary && <span className="toolbar-count muted">{summary}</span>
      )}
      {toolbarActions}
      {/* Filters: same funnel button + panel as the main lists, then Columns as the last button */}
      {filters && (
        <FilterPanelButton active={activeFilters} onClear={onClearFilters}>
          {filters}
        </FilterPanelButton>
      )}
      {/* Columns: always the last button, at the right edge (same as the main lists) */}
      {dataCols.length > 1 && (
        <>
          <IconButton
            ref={colsRef}
            icon="columns"
            label={CK.columnsAria}
            aria-expanded={colsOpen}
            aria-haspopup="dialog"
            pressed={colsOpen}
            className={cx('tools-icon-btn', colsOpen && 'is-open')}
            onClick={() => setColsOpen((o) => !o)}
          />
          <Popover open={colsOpen} onClose={() => setColsOpen(false)} anchor={colsRef} label={CK.columns} width={280} align="end">
            <div className="pop-head">
              <strong>{CK.columns}</strong>
              <Button variant="ghost" icon="reset" onClick={() => setHidden(new Set())}>
                {CK.resetColumns}
              </Button>
            </div>
            <ul className="col-list">
              {dataCols.map((c) => (
                <li key={c.key} className="col-item">
                  <label className="check">
                    <Checkbox
                      checked={!hidden.has(c.key)}
                      disabled={!hidden.has(c.key) && visible.length === 1}
                      onChange={() => setHidden((h) => (h.has(c.key) ? new Set([...h].filter((k) => k !== c.key)) : new Set([...h, c.key])))}
                    />
                    {c.label}
                  </label>
                </li>
              ))}
            </ul>
          </Popover>
        </>
      )}
    </div>
  );
  const wrap = (n: ReactNode) => (fill ? <div className="content-surface is-table">{n}</div> : n);
  if (error)
    return (
      <>
        {toolbar}
        {wrap(<ErrorState onRetry={onRetry}>{error}</ErrorState>)}
      </>
    );
  if (loading)
    return (
      <>
        {toolbar}
        {wrap(<Skeleton rows={6} />)}
      </>
    );
  if (!rows.length && empty)
    return (
      <>
        {toolbar}
        {wrap(
          <EmptyState icon={empty.icon} title={empty.title} action={empty.action}>
            {empty.body}
          </EmptyState>,
        )}
      </>
    );
  const span = visible.length + (selectable ? 1 : 0) + (actionCol ? 1 : 0);
  return (
    <>
      {toolbar}
      {wrap(
        <>
          <div className="grid-wrap density-comfortable">
            <table className={cx('grid grid-auto', onRowClick && 'is-clickable')} aria-label={label}>
              <thead>
                <tr>
                  {selectable && (
                    <th className="col-select sticky-left" style={{ left: 0 }} scope="col">
                      <Checkbox
                        aria-label={selection?.selectAllLabel ?? CK.selectAll}
                        disabled={!keys.length}
                        checked={allSelected}
                        ref={(el) => el && (el.indeterminate = !allSelected && someSelected)}
                        onChange={() => setSelected((s) => new Set(allSelected ? [...s].filter((k) => !keys.includes(k)) : [...s, ...keys]))}
                      />
                    </th>
                  )}
                  {visible.map((c) => {
                    const active = sort?.key === c.key;
                    const typeIcon = <Icon name={c.icon ?? (c.num ? 'f-id' : 'f-text')} size={14} className="th-type th-type-right" />;
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        className={cx(c.num && 'th-num', active && 'is-sorted', c.className)}
                        aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      >
                        {c.sort ? (
                          <button type="button" className="th-btn" onClick={() => setSort(active && sort!.dir === 'asc' ? { key: c.key, dir: 'desc' } : { key: c.key, dir: 'asc' })}>
                            <span className="th-label">{c.label}</span>
                            <Icon name={active ? (sort!.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down'} size={12} className={cx(!active && 'th-sort-idle')} />
                            {typeIcon}
                          </button>
                        ) : (
                          <span className="th-label th-static">
                            {c.label}
                            {typeIcon}
                          </span>
                        )}
                      </th>
                    );
                  })}
                  {actionCol && (
                    <th className="col-actions sticky-right" scope="col">
                      {actionCol.label}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const k = rowKey(r);
                  return (
                    <tr key={k} data-row={k} className={cx(selected.has(k) && 'is-selected')} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                      {selectable && (
                        <td className="col-select sticky-left" style={{ left: 0 }} onClick={(e) => e.stopPropagation()}>
                          {(selection?.canSelect?.(r) ?? true) && <Checkbox aria-label={selection ? selection.rowLabel(r) : CK.selectRow} checked={selected.has(k)} onChange={() => setSelected((s) => new Set(s.has(k) ? [...s].filter((x) => x !== k) : [...s, k]))} />}
                        </td>
                      )}
                      {visible.map((c) => (
                        <td key={c.key} className={cx(c.num && 'td-num', c.className)}>
                          {c.render(r)}
                        </td>
                      ))}
                      {actionCol && (
                        <td className="col-actions sticky-right" onClick={(e) => e.stopPropagation()}>
                          {actionCol.render(r)}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr>
                    <td colSpan={span} className="muted">
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
        </>,
      )}
    </>
  );
}
