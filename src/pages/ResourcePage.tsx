import { useShortcuts } from '../hooks/useShortcuts';
import { listCrumb } from '../components/shell/crumbs';
import { Pagination } from '../components/primitives/Pagination';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ColumnState, FilterCondition, FilterGroup, RecordData, ViewDefinition } from '../metadata/types';
import { cx } from '../lib/format';
import { recordNewPath, recordPagePath, resourceKeyFromParams, resourcePath } from '../lib/routes';
import { formatDate, todayKey } from '../lib/dates';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { canReadRecord, perm } from '../services/authz';
import { getDb } from '../services/db';
import { downloadText, exportCsv } from '../services/exporter';
import { cloneGroup, decodeFilter, encodeFilter, OPERATOR_LABELS, VALUELESS } from '../services/filter';
import { useActor, useRevision } from '../services/hooks';
import { getResource, masterLabel } from '../services/registry';
import { availableTransitions, displayText, queryRecords, recordTitle, transitionRecord } from '../services/runtime';
import { getSettings, pushRecent, updateSettings } from '../services/settings';
import { ServiceError } from '../services/types';
import { listViews, unavailableViewFields } from '../services/views';
import { Button } from '../components/primitives/Button';
// (kept for the commented-out "All of" chip line) import { FadeScroller } from '../components/primitives/FadeScroller';
import { EmptyState, ErrorState, InlineAlert, NoAccess, Skeleton, useToast } from '../components/primitives/feedback';
import { Menu, type MenuItem } from '../components/primitives/overlay';
import { BoardView } from '../components/resource/BoardView';
import { CalendarView } from '../components/resource/CalendarView';
import { DataGrid } from '../components/resource/DataGrid';
import { FormDrawer, QuickCreateDialog, WizardDialog } from '../components/resource/RecordForm';
import { RecordInspector } from '../components/resource/RecordInspector';
import { ColumnManager, FilterButton, ViewBar } from '../components/resource/ViewControls';
import { PageHeader } from '../components/shell/PageHeader';
import { L } from '../constants/labels';
import { SearchInput } from '../components/primitives/controls';

const C = L.common;
const LS = L.common.list;

const PAGE_SIZES = [25, 50, 100, 250, 500]; // above 100 rows the table virtualizes (renders only visible rows)

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
  const resource = resourceKeyFromParams(useParams());
  useRevision();
  const actor = useActor();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const primaryRef = useRef<(() => void) | undefined>(undefined);
  useShortcuts({ n: () => primaryRef.current?.(), '/': () => searchRef.current?.focus() });
  const res = getResource(resource);
  const views = listViews(actor, resource);
  const settings = getSettings(actor.user.id);
  const requestedView = params.get('view');
  const view = views.find((v) => v.id === requestedView) ?? views.find((v) => v.id === settings.defaultViews[resource]) ?? views.find((v) => v.id === settings.lastViews[resource]) ?? views[0];
  useEffect(() => {
    if (view && getSettings(actor.user.id).lastViews[resource] !== view.id) updateSettings(actor.user.id, { lastViews: { ...getSettings(actor.user.id).lastViews, [resource]: view.id } });
  }, [view?.id]); // eslint-disable-line react-hooks/exhaustive-deps
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
    pushRecent(actor, res.labelPlural, resourcePath(actor.workspaceId, res.key));
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

  // Loaded through the simulated network boundary (loading / error states); store changes refresh silently.
  const query = useServiceQuery(() => queryRecords(actor, resource, { filter: working.filter, search, sort: working.sort }), [resource, actor.user.id, working.filter, search, working.sort]);

  if (perm(actor, resource).read === 'none') {
    return (
      <div className="page">
        <PageHeader title={res.labelPlural} crumbs={[{ label: res.labelPlural }]} />
        <NoAccess what={res.labelPlural} />
      </div>
    );
  }

  const isPaged = view.type === 'table';
  const result: { rows: RecordData[]; total: number; ignoredFields: string[] } = query.data ?? { rows: [], total: 0, ignoredFields: [] };
  const queryError = query.error;
  const firstLoad = !query.data && !query.error;
  const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
  const page = Math.min(Math.max(0, rawPage || 0), pageCount - 1);
  const pageRows = isPaged ? result.rows.slice(page * pageSize, page * pageSize + pageSize) : result.rows;
  const unavailable = unavailableViewFields(actor, { ...view, filter: working.filter });

  const open = (id: string) => update({ peek: id });
  const primary = () => {
    if (res.form.wizard) setCreating({ mode: 'wizard' });
    else if (res.form.fullPage) navigate(recordNewPath(res.key));
    else setCreating({ mode: 'quick' });
  };
  primaryRef.current = perm(actor, resource).create ? primary : undefined;

  const rowMenu = (r: RecordData): MenuItem[] => {
    const raw = getDb().records[resource].find((x) => x.id === r.id);
    return [
      { id: 'open', label: LS.openInInspector, icon: 'eye', onSelect: () => open(r.id) },
      { id: 'page', label: LS.openFullPage, icon: 'layout-dashboard', onSelect: () => navigate(recordPagePath(actor.workspaceId, res.key, r.id)) },
      ...availableTransitions(actor, res, r).map((t, i) => ({
        id: `t-${t.to}`,
        label: t.action,
        icon: 'chevron-right',
        separatorBefore: i === 0,
        disabledReason: t.disabledReason ?? (t.confirm ? C.confirm.openToConfirm : undefined),
        onSelect: () => {
          try {
            transitionRecord(actor, resource, r.id, t.to, raw!.version);
            toast(C.toasts.actionDone(recordTitle(res.key, r.id, actor), t.action));
          } catch (e) {
            toast(e instanceof ServiceError ? e.message : C.toasts.actionFailed, 'danger');
          }
        },
      })),
    ];
  };

  const doExport = (rows: RecordData[]) => {
    try {
      const cols = working.columns.filter((c) => !c.hidden).map((c) => c.key);
      const csv = exportCsv(actor, res, rows, cols.includes('id') ? cols : ['id', ...cols]);
      downloadText(`${res.key}-${todayKey()}.csv`, csv);
      toast(C.toasts.exported(rows.length));
    } catch (e) {
      toast(e instanceof ServiceError ? e.message : C.toasts.exportFailed, 'danger');
    }
  };

  // Bulk transitions: only actions valid for every selected row and permitted.
  const selectedRows = result.rows.filter((r) => selected.has(r.id));
  const bulkActions = (() => {
    if (!res.lifecycle || !selectedRows.length) return [];
    const sets = selectedRows.map((r) => availableTransitions(actor, res, r).filter((t) => !t.disabledReason && !t.confirm));
    return sets[0].filter((t) => sets.every((s) => s.some((x) => x.to === t.to)));
  })();

  const exportReason = perm(actor, resource).export ? undefined : LS.cannotExport(actor.role.label, res.labelPlural.toLowerCase());

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
              {C.actions.export}
            </Button>
            {res.form.wizard && perm(actor, resource).create && (
              <Button onClick={() => setCreating({ mode: 'quick' })} icon="plus">
                {C.actions.quickAdd}
              </Button>
            )}
            <Button variant="primary" icon="plus" onClick={primary} title={LS.shortcutHint('N')} disabledReason={perm(actor, resource).create ? undefined : LS.cannotCreate(actor.role.label, res.labelPlural.toLowerCase())}>
              {res.form.primaryLabel ?? C.actions.newRecord(res.label)}
            </Button>
          </div>
        </div>
        {/* Line 2: search · filters · columns ……… count (non-table views) · bulk actions when rows are selected */}
        <div className="view-tools view-tools-row">
          <div className="search-field">
            <IconSearch />
            <SearchInput ref={searchRef} dense placeholder={`${LS.search} (/)`} aria-label={LS.searchAria(res.labelPlural.toLowerCase())} value={searchText} onChange={(e) => setSearchText(e.target.value)} />
          </div>
          <FilterButton res={res} actor={actor} filter={working.filter} onChange={setFilter} />
          {/* Rich views only (rows with several lines): switch between 2-line and 3-line rows */}
          {view.type === 'table' && (view.rowLines ?? 1) > 1 && (
            <div className="segmented row-lines-toggle" role="radiogroup" aria-label={LS.linesPerRow}>
              {([2, 3] as const).map((n) => (
                <button key={n} type="button" role="radio" aria-checked={working.rowLines === n} className={cx('seg-btn', working.rowLines === n && 'is-on')} onClick={() => setWorking((w) => ({ ...w, rowLines: n }))}>
                  {LS.lines(n)}
                </button>
              ))}
            </div>
          )}
          <span className="spacer" />
          {!isPaged && !selected.size && (
            <span className="toolbar-count muted" aria-live="polite">
              {LS.count(result.total, res.label.toLowerCase(), res.labelPlural.toLowerCase())}
            </span>
          )}
          {selected.size > 0 && (
            <>
              <span className="viewbar-divider" aria-hidden="true" />
              <div className="bulk-tools" role="region" aria-label={LS.bulkActions}>
                <strong className="bulk-count">{LS.selected(selected.size)}</strong>
                <Button
                  ref={bulkRef}
                  iconRight="chevron-down"
                  onClick={() => setBulkOpen((o) => !o)}
                  disabledReason={!res.lifecycle ? LS.noBulkStatus : !bulkActions.length ? LS.noCommonAction : undefined}
                >
                  {C.actions.changeStatus}
                </Button>
                <Button icon="download" onClick={() => doExport(selectedRows)} disabledReason={exportReason}>
                  {C.actions.exportSelected}
                </Button>
              <Menu
                open={bulkOpen}
                onClose={() => setBulkOpen(false)}
                anchor={bulkRef}
                label={LS.bulkStatusActions}
                align="start"
                items={bulkActions.map((t) => ({
                  id: t.to,
                  label: LS.bulkActionCount(t.action, selectedRows.length),
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
                    toast(C.toasts.bulkResult(t.action, ok, failed), failed.length ? 'info' : 'success');
                    setSelected(new Set());
                  },
                }))}
              />
              </div>
            </>
          )}
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
        </div>
        {staleView && <InlineAlert tone="warning">{LS.staleView(view.name)}</InlineAlert>}
        {/* Owner rule: the "All of: …" filter-chip line is hidden — active filters show as the dot on "Filters";
            the record count and bulk actions moved to the search line.
        {working.filter.children.length > 0 && (
          <div className="subbar">
            <FadeScroller className="subbar-chips" label={LS.activeFilters}>
              <FilterChips res={res} filter={working.filter} onChange={setFilter} actor={actor} />
            </FadeScroller>
          </div>
        )} */}
        {unavailable.length > 0 && <InlineAlert tone="info">{LS.ignoredConditions}</InlineAlert>}
        <div className={cx('content-surface', isPaged && result.total > 0 && 'is-table')}>
          {queryError ? (
            <ErrorState title={LS.loadError(res.labelPlural.toLowerCase())} onRetry={query.retry}>
              {queryError}
            </ErrorState>
          ) : firstLoad ? (
            <Skeleton rows={8} />
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
              title={search || working.filter.children.length ? LS.noMatching : LS.noneYet(res.labelPlural.toLowerCase())}
              action={
                search || working.filter.children.length ? (
                  <Button
                    onClick={() => {
                      setSearchText('');
                      setFilter({ ...working.filter, children: [] });
                      update({ q: undefined, f: undefined });
                    }}
                  >
                    {LS.clearSearchFilters}
                  </Button>
                ) : undefined
              }
            >
              {search || working.filter.children.length ? LS.tryDifferent : LS.willAppear}
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
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.14">
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
    if (isDate && c.operator === 'gte') return LS.from;
    if (isDate && c.operator === 'lte') return LS.until;
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
    <div className="filter-chips" aria-label={LS.activeFilters}>
      <span className="muted small">{filter.join === 'and' ? LS.allOfJoin : LS.anyOfJoin}:</span>
      {conds.map((c) => (
        <span key={c.id} className="filter-chip">
          <span>
            {res.fields.find((f) => f.key === c.field)?.label ?? c.field} {opText(c)} {valueText(c)}
          </span>
          <button type="button" aria-label={LS.removeFilter} onClick={() => onChange({ ...filter, children: filter.children.filter((x) => x.id !== c.id) })}>
            ×
          </button>
        </span>
      ))}
      {groups > 0 && <span className="filter-chip">{LS.nestedGroups(groups)}</span>}
    </div>
  );
}

/** Full-page record detail (deep link /:recordId) — same tabs and composer as the inspector. */
export function RecordPage() {
  const params = useParams();
  const resource = resourceKeyFromParams(params);
  const recordId = params.recordId ?? '';
  const actor = useActor();
  const navigate = useNavigate();
  const res = getResource(resource);
  const raw = getDb().records[resource]?.find((r) => r.id === recordId);
  const visible = !!raw && canReadRecord(actor, res, raw);
  return (
    <div className="page">
      <PageHeader
        crumbs={[listCrumb(res.key, actor.workspaceId)]}
        description={res.description}
        title={visible ? (res.recordPageTitle ? `${res.recordPageTitle} · ${recordId}` : `${res.label} ${recordId}`) : res.recordPageTitle ?? res.label}
      />
      <div className="record-page">
        <RecordInspector resKey={resource} recordId={recordId} onClose={() => navigate(-1)} variant="page" />
      </div>
    </div>
  );
}

/** Table footer: the shared Pagination (range, numbered pages, rows per page). */
function GridFooter({ page, pageSize, total, noun, onPage, onSize }: { page: number; pageCount?: number; pageSize: number; total: number; noun: string; onPage: (p: number) => void; onSize: (n: number) => void }) {
  return <Pagination page={page} pageSize={pageSize} total={total} noun={noun} onPage={onPage} onSize={onSize} sizes={PAGE_SIZES} />;
}
