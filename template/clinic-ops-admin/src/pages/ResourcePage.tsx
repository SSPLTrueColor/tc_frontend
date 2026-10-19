import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ColumnState, FilterCondition, FilterGroup, RecordData, ViewDefinition } from '../metadata/types';
import { cx } from '../lib/format';
import { formatDate } from '../lib/dates';
import { wsBase } from '../lib/routes';
import { canReadRecord, perm } from '../services/authz';
import { getDb } from '../services/db';
import { downloadText, exportCsv } from '../services/exporter';
import { cloneGroup, decodeFilter, encodeFilter, OPERATOR_LABELS, VALUELESS } from '../services/filter';
import { useActor, useRevision } from '../services/hooks';
import { getResource, masterLabel } from '../services/registry';
import { availableTransitions, displayText, queryRecords, transitionRecord } from '../services/runtime';
import { getSettings, pushRecent } from '../services/settings';
import { ServiceError } from '../services/types';
import { listViews, unavailableViewFields } from '../services/views';
import { Button, IconButton } from '../components/primitives/Button';
import { SelectMenu } from '../components/primitives/SelectMenu';
// (kept for the commented-out "All of" chip line) import { FadeScroller } from '../components/primitives/FadeScroller';
import { EmptyState, InlineAlert, NoAccess, useToast } from '../components/primitives/feedback';
import { Menu, type MenuItem } from '../components/primitives/overlay';
import { BoardView } from '../components/resource/BoardView';
import { CalendarView } from '../components/resource/CalendarView';
import { DataGrid } from '../components/resource/DataGrid';
import { FormDrawer, QuickCreateDialog, WizardDialog } from '../components/resource/RecordForm';
import { RecordInspector } from '../components/resource/RecordInspector';
import { ColumnManager, FilterButton, ViewBar } from '../components/resource/ViewControls';
import { PageHeader } from '../components/shell/PageHeader';

const PAGE_SIZES = [25, 50, 100];

interface Working {
  filter: FilterGroup;
  sort: ViewDefinition['sort'];
  columns: ColumnState[];
  groupBy?: string;
  density: ViewDefinition['density'];
  rowLines: 1 | 2 | 3;
}

const fromView = (v: ViewDefinition): Working => ({ filter: cloneGroup(v.filter), sort: [...v.sort], columns: v.columns.map((c) => ({ ...c })), groupBy: v.groupBy, density: v.density, rowLines: v.rowLines ?? 1 });

export function ResourcePage() {
  const { resource = '' } = useParams();
  useRevision();
  const actor = useActor();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const res = getResource(resource);
  const views = listViews(actor, resource);
  const settings = getSettings(actor.user.id);
  const requestedView = params.get('view');
  const view = views.find((v) => v.id === requestedView) ?? views.find((v) => v.id === settings.defaultViews[resource]) ?? views[0];
  const staleView = requestedView && requestedView !== view.id;
  const peek = params.get('peek') ?? undefined;
  const search = params.get('q') ?? '';
  const pageSize = PAGE_SIZES.includes(Number(params.get('size'))) ? Number(params.get('size')) : PAGE_SIZES[0];
  const rawPage = Number(params.get('page') ?? 0);

  const [working, setWorking] = useState<Working>(() => {
    const w = fromView(view);
    const f = params.get('f');
    const decoded = f ? decodeFilter(f) : null;
    return decoded ? { ...w, filter: decoded } : w;
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<null | { mode: 'quick' | 'drawer' | 'wizard'; initial?: Record<string, unknown> }>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const bulkRef = useRef<HTMLButtonElement>(null);
  const [searchText, setSearchText] = useState(search);
  const lastView = useRef(view.id);

  // Switching views resets the working state to the saved definition.
  useEffect(() => {
    if (lastView.current !== view.id) {
      lastView.current = view.id;
      setWorking(fromView(view));
      setSelected(new Set());
    }
  }, [view]);

  useEffect(() => {
    pushRecent(actor, res.labelPlural, `${wsBase(actor.workspaceId)}/${res.module}/${res.key}`);
  }, [res.key, actor.workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search → URL (shareable).
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchText === search) return;
      update({ q: searchText || undefined, page: undefined });
    }, 250);
    return () => clearTimeout(t);
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === undefined ? next.delete(k) : next.set(k, v)));
    setParams(next, { replace: false });
  };

  const setFilter = (g: FilterGroup) => {
    setWorking((w) => ({ ...w, filter: g }));
    update({ f: g.children.length ? encodeFilter(g) : undefined, page: undefined });
  };

  const dirty = JSON.stringify(fromView(view)) !== JSON.stringify(working);

  if (perm(actor, resource).read === 'none') {
    return (
      <div className="page">
        <PageHeader title={res.labelPlural} crumbs={[{ label: res.labelPlural }]} />
        <NoAccess what={res.labelPlural.toLowerCase()} />
      </div>
    );
  }

  const isPaged = view.type === 'table';
  let result: { rows: RecordData[]; total: number; ignoredFields: string[] } = { rows: [], total: 0, ignoredFields: [] };
  let queryError: string | null = null;
  try {
    result = queryRecords(actor, resource, { filter: working.filter, search, sort: working.sort });
  } catch (e) {
    queryError = e instanceof Error ? e.message : 'Query failed';
  }
  const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
  const page = Math.min(Math.max(0, rawPage || 0), pageCount - 1);
  const pageRows = isPaged ? result.rows.slice(page * pageSize, page * pageSize + pageSize) : result.rows;
  const unavailable = unavailableViewFields(actor, { ...view, filter: working.filter });

  const open = (id: string) => update({ peek: id });
  const primary = () => {
    if (res.key === 'patients') setCreating({ mode: 'wizard' });
    else if (res.key === 'invoices') navigate(`${wsBase(actor.workspaceId)}/${res.module}/${res.key}/new`);
    else setCreating({ mode: 'quick' });
  };

  const rowMenu = (r: RecordData): MenuItem[] => {
    const raw = getDb().records[resource].find((x) => x.id === r.id);
    return [
      { id: 'open', label: 'Open in inspector', icon: 'eye', onSelect: () => open(r.id) },
      { id: 'page', label: 'Open full page', icon: 'layout-dashboard', onSelect: () => navigate(`${wsBase(actor.workspaceId)}/${res.module}/${res.key}/${r.id}`) },
      ...availableTransitions(actor, res, r).map((t, i) => ({
        id: `t-${t.to}`,
        label: t.action,
        icon: 'chevron-right',
        separatorBefore: i === 0,
        disabledReason: t.disabledReason ?? (t.confirm ? 'Open the record to confirm this action' : undefined),
        onSelect: () => {
          try {
            transitionRecord(actor, resource, r.id, t.to, raw!.version);
            toast(`${r.id}: ${t.action}`);
          } catch (e) {
            toast(e instanceof ServiceError ? e.message : 'Action failed', 'danger');
          }
        },
      })),
    ];
  };

  const doExport = (rows: RecordData[]) => {
    try {
      const cols = working.columns.filter((c) => !c.hidden).map((c) => c.key);
      const csv = exportCsv(actor, res, rows, cols.includes('id') ? cols : ['id', ...cols]);
      downloadText(`${res.key}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast(`Exported ${rows.length} rows (masked fields stay masked)`);
    } catch (e) {
      toast(e instanceof ServiceError ? e.message : 'Export failed', 'danger');
    }
  };

  // Bulk transitions: only actions valid for every selected row and permitted.
  const selectedRows = result.rows.filter((r) => selected.has(r.id));
  const bulkActions = (() => {
    if (!res.lifecycle || !selectedRows.length) return [];
    const sets = selectedRows.map((r) => availableTransitions(actor, res, r).filter((t) => !t.disabledReason && !t.confirm));
    return sets[0].filter((t) => sets.every((s) => s.some((x) => x.to === t.to)));
  })();

  const exportReason = perm(actor, resource).export ? undefined : `${actor.role.label} cannot export ${res.labelPlural.toLowerCase()}`;

  return (
    <div className={cx('page page-resource', `page-res-${res.key}`, peek && 'has-inspector')}>
      <div className="page-main">
        <PageHeader title={res.labelPlural} description={res.description} />
        {/* Line 1: saved views as underline tabs (+) … Export · primary action — one full-width line under it */}
        <div className="view-toolbar view-tabs-row">
          <ViewBar
            res={res}
            views={views}
            activeId={view.id}
            actor={actor}
            working={{ ...view, ...working }}
            dirty={dirty}
            onReset={() => {
              setWorking(fromView(view));
              update({ f: undefined });
            }}
            onSelect={(id) => update({ view: id, page: undefined, f: undefined })}
          />
          <div className="view-tools view-tools-primary">
            <Button icon="download" onClick={() => doExport(result.rows)} disabledReason={exportReason}>
              Export
            </Button>
            {res.key === 'patients' && perm(actor, resource).create && (
              <Button onClick={() => setCreating({ mode: 'quick' })} icon="plus">
                Quick add
              </Button>
            )}
            <Button variant="primary" icon="plus" onClick={primary} disabledReason={perm(actor, resource).create ? undefined : `${actor.role.label} cannot create ${res.labelPlural.toLowerCase()}`}>
              {res.key === 'patients' ? 'Register patient' : `New ${res.label.toLowerCase()}`}
            </Button>
          </div>
        </div>
        {/* Line 2: search · filters · columns ……… count (non-table views) · bulk actions when rows are selected */}
        <div className="view-tools view-tools-row">
          <div className="search-field">
            <IconSearch />
            <input type="search" className="input input-compact" placeholder="Search" aria-label={`Search ${res.labelPlural.toLowerCase()}`} value={searchText} onChange={(e) => setSearchText(e.target.value)} />
          </div>
          <FilterButton res={res} actor={actor} filter={working.filter} onChange={setFilter} />
          {view.type === 'table' && (
            <ColumnManager
              res={res}
              actor={actor}
              columns={working.columns}
              onChange={(c) => setWorking((w) => ({ ...w, columns: c }))}
              density={working.density}
              onDensity={(d) => setWorking((w) => ({ ...w, density: d }))}
              groupBy={working.groupBy}
              onGroupBy={(g) => setWorking((w) => ({ ...w, groupBy: g }))}
              onReset={() => setWorking((w) => ({ ...w, columns: fromView(view).columns, groupBy: view.groupBy, density: view.density, rowLines: view.rowLines ?? 1 }))}
            />
          )}
          {/* Rich views only (rows with several lines): switch between 2-line and 3-line rows */}
          {view.type === 'table' && (view.rowLines ?? 1) > 1 && (
            <div className="segmented row-lines-toggle" role="radiogroup" aria-label="Lines per row">
              {([2, 3] as const).map((n) => (
                <button key={n} type="button" role="radio" aria-checked={working.rowLines === n} className={cx('seg-btn', working.rowLines === n && 'is-on')} onClick={() => setWorking((w) => ({ ...w, rowLines: n }))}>
                  {n === 2 ? '2 lines' : '3 lines'}
                </button>
              ))}
            </div>
          )}
          <span className="spacer" />
          {!isPaged && !selected.size && (
            <span className="toolbar-count muted" aria-live="polite">
              {result.total} {result.total === 1 ? res.label.toLowerCase() : res.labelPlural.toLowerCase()}
            </span>
          )}
          {selected.size > 0 && (
            <>
              <span className="viewbar-divider" aria-hidden="true" />
              <div className="bulk-tools" role="region" aria-label="Bulk actions">
                <strong className="bulk-count">{selected.size} selected</strong>
                <Button
                  ref={bulkRef}
                  iconRight="chevron-down"
                  onClick={() => setBulkOpen(true)}
                  disabledReason={!res.lifecycle ? 'No bulk status actions for this record type' : !bulkActions.length ? 'No action applies to all selected rows' : undefined}
                >
                  Change status
                </Button>
                <Button icon="download" onClick={() => doExport(selectedRows)} disabledReason={exportReason}>
                  Export selected
                </Button>
              <Menu
                open={bulkOpen}
                onClose={() => setBulkOpen(false)}
                anchor={bulkRef}
                label="Bulk status actions"
                align="start"
                items={bulkActions.map((t) => ({
                  id: t.to,
                  label: `${t.action} (${selectedRows.length})`,
                  onSelect: () => {
                    let ok = 0;
                    const failed: string[] = [];
                    selectedRows.forEach((r) => {
                      try {
                        const raw = getDb().records[resource].find((x) => x.id === r.id)!;
                        transitionRecord(actor, resource, r.id, t.to, raw.version);
                        ok++;
                      } catch {
                        failed.push(r.id);
                      }
                    });
                    toast(`${t.action}: ${ok} updated${failed.length ? `, ${failed.length} skipped (${failed.join(', ')})` : ''}`, failed.length ? 'info' : 'success');
                    setSelected(new Set());
                  },
                }))}
              />
              </div>
            </>
          )}
        </div>
        {staleView && <InlineAlert tone="warning">The requested view is unavailable (deleted or not shared with you). Showing “{view.name}”.</InlineAlert>}
        {/* Owner rule: the "All of: …" filter-chip line is hidden — active filters show as the dot on "Filters";
            the record count and bulk actions moved to the search line.
        {working.filter.children.length > 0 && (
          <div className="subbar">
            <FadeScroller className="subbar-chips" label="Active filters">
              <FilterChips res={res} filter={working.filter} onChange={setFilter} actor={actor} />
            </FadeScroller>
          </div>
        )} */}
        {unavailable.length > 0 && <InlineAlert tone="info">Some conditions in this view use fields your role cannot query; they are ignored.</InlineAlert>}
        <div className={cx('content-surface', isPaged && result.total > 0 && 'is-table')}>
          {queryError ? (
            <InlineAlert tone="danger">{queryError}</InlineAlert>
          ) : view.type === 'board' ? (
            <BoardView res={res} actor={actor} rows={result.rows} boardField={view.boardField ?? res.lifecycle!.field} cardFields={working.columns.filter((c) => !c.hidden).map((c) => c.key)} onOpen={open} activeId={peek} />
          ) : view.type === 'calendar' && res.calendar ? (
            <CalendarView
              res={res}
              actor={actor}
              rows={result.rows}
              onOpen={open}
              activeId={peek}
              onCreateAt={perm(actor, resource).create ? (initial) => setCreating({ mode: 'quick', initial }) : undefined}
            />
          ) : result.total === 0 ? (
            <EmptyState
              icon="search"
              title={search || working.filter.children.length ? 'No matching records' : `No ${res.labelPlural.toLowerCase()} yet`}
              action={
                search || working.filter.children.length ? (
                  <Button
                    onClick={() => {
                      setSearchText('');
                      setFilter({ ...working.filter, children: [] });
                      update({ q: undefined, f: undefined });
                    }}
                  >
                    Clear search and filters
                  </Button>
                ) : undefined
              }
            >
              {search || working.filter.children.length ? 'Try a different search or remove a filter.' : 'Records you create will appear here.'}
            </EmptyState>
          ) : (
            <>
              <DataGrid
                res={res}
                actor={actor}
                rows={pageRows}
                columns={working.columns}
                onColumnsChange={(c) => setWorking((w) => ({ ...w, columns: c }))}
                sort={working.sort}
                onSortChange={(s) => setWorking((w) => ({ ...w, sort: s }))}
                density={working.density}
                rowLines={working.rowLines}
                groupBy={working.groupBy}
                selected={selected}
                onSelectedChange={setSelected}
                activeId={peek}
                onOpen={open}
                onEdit={setEditId}
                rowMenu={rowMenu}
              />
              <GridFooter
                page={page}
                pageCount={pageCount}
                pageSize={pageSize}
                total={result.total}
                noun={result.total === 1 ? res.label.toLowerCase() : res.labelPlural.toLowerCase()}
                onPage={(p) => update({ page: p ? String(p) : undefined })}
                onSize={(n) => update({ size: n === PAGE_SIZES[0] ? undefined : String(n), page: undefined })}
              />
            </>
          )}
        </div>
      </div>
      {peek && (
        <RecordInspector
          key={resource}
          resKey={resource}
          recordId={peek}
          onClose={() => update({ peek: undefined })}
          siblings={(isPaged ? pageRows : result.rows).map((r) => r.id)}
          onNavigate={open}
        />
      )}
      <QuickCreateDialog
        open={creating?.mode === 'quick'}
        resKey={resource}
        initial={creating?.initial}
        onClose={() => setCreating(null)}
        onCreated={(r) => open(r.id)}
        onMoreFields={(values) => setCreating({ mode: 'drawer', initial: values })}
      />
      <FormDrawer open={creating?.mode === 'drawer'} resKey={resource} initial={creating?.initial} onClose={() => setCreating(null)} onSaved={(r) => open(r.id)} />
      <WizardDialog open={creating?.mode === 'wizard'} resKey={resource} onClose={() => setCreating(null)} onCreated={(r) => open(r.id)} />
      <FormDrawer open={!!editId} resKey={resource} recordId={editId ?? undefined} onClose={() => setEditId(null)} />
    </div>
  );
}

function IconSearch() {
  return (
    <span className="search-icon" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
    </span>
  );
}

export function FilterChips({ res, filter, onChange, actor }: { res: ReturnType<typeof getResource>; filter: FilterGroup; onChange: (g: FilterGroup) => void; actor: ReturnType<typeof useActor> }) {
  const conds = filter.children.filter((c): c is FilterCondition => c.kind === 'condition');
  const groups = filter.children.length - conds.length;
  if (!filter.children.length) return null;
  const opText = (c: FilterCondition) => {
    const f = res.fields.find((x) => x.key === c.field);
    const isDate = f && (f.type === 'date' || f.type === 'datetime');
    if (isDate && c.operator === 'gte') return 'from';
    if (isDate && c.operator === 'lte') return 'until';
    return OPERATOR_LABELS[c.operator];
  };
  const valueText = (c: FilterCondition): string => {
    if (VALUELESS.includes(c.operator) || c.value === undefined || c.value === '') return '';
    const f = res.fields.find((x) => x.key === c.field);
    if (!f) return String(c.value);
    if (Array.isArray(c.value)) return c.value.map((v) => valueText({ ...c, operator: 'eq', value: v })).join(', ');
    if (f.type === 'master' || f.type === 'multimaster') return masterLabel(f.master!, c.value);
    if (f.type === 'date' || f.type === 'datetime') return formatDate(String(c.value));
    return displayText(f, c.value, actor);
  };
  return (
    <div className="filter-chips" aria-label="Active filters">
      <span className="muted small">{filter.join === 'and' ? 'All of' : 'Any of'}:</span>
      {conds.map((c) => (
        <span key={c.id} className="filter-chip">
          <span>
            {res.fields.find((f) => f.key === c.field)?.label ?? c.field} {opText(c)} {valueText(c)}
          </span>
          <button type="button" aria-label="Remove filter" onClick={() => onChange({ ...filter, children: filter.children.filter((x) => x.id !== c.id) })}>
            ×
          </button>
        </span>
      ))}
      {groups > 0 && <span className="filter-chip">+ {groups} nested group(s)</span>}
    </div>
  );
}

/** Full-page record detail (deep link /:recordId) — same tabs and composer as the inspector. */
export function RecordPage() {
  const { resource = '', recordId = '' } = useParams();
  const actor = useActor();
  const navigate = useNavigate();
  const res = getResource(resource);
  const raw = getDb().records[resource]?.find((r) => r.id === recordId);
  const visible = !!raw && canReadRecord(actor, res, raw);
  return (
    <div className="page">
      <PageHeader
        title={visible ? `${res.label} ${recordId}` : res.label}
        crumbs={[{ label: res.labelPlural, to: `${wsBase(actor.workspaceId)}/${res.module}/${res.key}` }, { label: recordId }]}
        actions={
          <Button icon="chevron-left" onClick={() => navigate(`${wsBase(actor.workspaceId)}/${res.module}/${res.key}?peek=${recordId}`)}>
            Back to list
          </Button>
        }
      />
      <div className="record-page">
        <RecordInspector resKey={resource} recordId={recordId} onClose={() => navigate(-1)} variant="page" />
      </div>
    </div>
  );
}

/** Frozen table footer: range, sample-data note, rows per page and numbered pages. */
function GridFooter({ page, pageCount, pageSize, total, noun, onPage, onSize }: { page: number; pageCount: number; pageSize: number; total: number; noun: string; onPage: (p: number) => void; onSize: (n: number) => void }) {
  const from = total ? page * pageSize + 1 : 0;
  const to = Math.min(total, (page + 1) * pageSize);
  // 1 … p-1 p p+1 … N
  const pages: (number | 'gap')[] = [];
  for (let i = 0; i < pageCount; i++) {
    if (i === 0 || i === pageCount - 1 || Math.abs(i - page) <= 1) pages.push(i);
    else if (pages[pages.length - 1] !== 'gap') pages.push('gap');
  }
  return (
    <div className="grid-footer">
      <span className="grid-footer-range" aria-live="polite">
        <strong>
          {from}–{to}
        </strong>{' '}
        of {total.toLocaleString()} {noun}
      </span>
      <nav className="grid-pages" aria-label="Pagination">
        <IconButton icon="chevron-left" label="Previous page" disabledReason={page === 0 ? 'First page' : undefined} onClick={() => onPage(page - 1)} />
        {pages.map((p, i) =>
          p === 'gap' ? (
            <span key={`g${i}`} className="grid-page-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button key={p} type="button" className={cx('grid-page', p === page && 'is-current')} aria-current={p === page ? 'page' : undefined} aria-label={`Page ${p + 1}`} onClick={() => onPage(p)}>
              {p + 1}
            </button>
          ),
        )}
        <IconButton icon="chevron-right" label="Next page" disabledReason={page >= pageCount - 1 ? 'Last page' : undefined} onClick={() => onPage(page + 1)} />
      </nav>
      <SelectMenu label="Rows per page" value={pageSize} options={PAGE_SIZES.map((n) => ({ value: n, label: `${n} / page` }))} onChange={onSize} />
    </div>
  );
}
