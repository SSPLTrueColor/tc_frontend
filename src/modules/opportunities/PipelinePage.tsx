import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ColumnState, RecordData } from '../../metadata/types';
import { L } from '../../constants/labels';
import { cx } from '../../lib/format';
import { recordPagePath } from '../../lib/routes';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { perm } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { periodLabel, pipelineFacets, pipelineRows, pipelineTotals, type PipelineFilter } from '../../services/opportunities';
import { runStagnationSweep } from '../../services/api/opportunities';
import { activeMasterValues, getResource } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { Button, IconButton } from '../../components/primitives/Button';
import { EmptyState, ErrorState, NoAccess, Skeleton } from '../../components/primitives/feedback';
import { Icon } from '../../components/primitives/Icon';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { BoardView } from '../../components/resource/BoardView';
import { DataGrid } from '../../components/resource/DataGrid';
import { FormDrawer, QuickCreateDialog } from '../../components/resource/RecordForm';
import { RecordInspector } from '../../components/resource/RecordInspector';
import { PageHeader } from '../../components/shell/PageHeader';
import { moneyShort } from './format';

const T = L.opportunities.pages.pipeline;
const PAGE_SIZES = [25, 50, 100];
const LIST_COLUMNS = ['name', 'id', 'customerId', 'stage', 'value', 'probability', 'weightedValue', 'expectedCloseDate', 'ownerId', 'divisionId', 'territoryId', 'productType', 'stagnant'];
const CARD_FIELDS = ['customerId', 'value', 'expectedCloseDate', 'ownerId'];
const FILTER_KEYS = ['division', 'owner', 'stage', 'territory', 'type', 'month'] as const;

/**
 * Pipeline (OPP-03): Kanban by stage (drag and drop through the guarded stage transitions) and a list,
 * filterable by division, owner, stage, territory / hub, product type and close month. Filters live in the URL.
 */
export function PipelinePage() {
  const actor = useActor();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const res = getResource('opportunities');
  const mode = params.get('mode') === 'list' ? 'list' : 'kanban';
  const search = params.get('q') ?? '';
  const peek = params.get('peek') ?? undefined;
  const pageSize = PAGE_SIZES.includes(Number(params.get('size'))) ? Number(params.get('size')) : PAGE_SIZES[0];
  const [searchText, setSearchText] = useState(search);
  const [columns, setColumns] = useState<ColumnState[]>(() => LIST_COLUMNS.map((key) => ({ key })));
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' }[]>([{ field: 'expectedCloseDate', dir: 'asc' }]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<null | { mode: 'quick' | 'drawer'; initial?: Record<string, unknown> }>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const filter: PipelineFilter = {
    search: search || undefined,
    divisionId: params.get('division') || undefined,
    ownerId: params.get('owner') || undefined,
    stage: params.get('stage') || undefined,
    territoryId: params.get('territory') || undefined,
    productType: params.get('type') || undefined,
    closeMonth: params.get('month') || undefined,
    sort,
  };
  const readable = perm(actor, 'opportunities').read !== 'none';
  const query = useServiceQuery(() => (readable ? pipelineRows(actor, filter) : []), [actor.user.id, filter]);
  const facets = useServiceQuery(() => (readable ? pipelineFacets(actor) : { ownerIds: [], closeMonths: [] }), [actor.user.id]);

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next);
  };

  // Debounced search → URL (shareable).
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchText !== search) update({ q: searchText || undefined, page: undefined });
    }, 250);
    return () => clearTimeout(t);
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (readable) void runStagnationSweep(actor).catch(() => undefined);
  }, [actor.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ownerOptions = useMemo(
    () => (facets.data?.ownerIds ?? []).map((id) => ({ value: id, label: recordTitle('employees', id, actor) })).sort((a, b) => a.label.localeCompare(b.label)),
    [facets.data, actor],
  );

  if (!readable)
    return (
      <div className="page">
        <PageHeader title={L.nav.pages.pipeline.title} />
        <NoAccess what={L.opportunities.messages.noAccessPipeline} />
      </div>
    );

  const rows = query.data ?? [];
  const totals = pipelineTotals(rows);
  const filtered = !!search || FILTER_KEYS.some((k) => params.get(k));
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(0, Number(params.get('page')) || 0), pageCount - 1);
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  const open = (id: string) => update({ peek: id });
  const canCreate = perm(actor, 'opportunities').create;
  const masterOptions = (master: string, all: string) => [{ value: '', label: all }, ...activeMasterValues(master).map((v) => ({ value: v.key, label: v.label }))];

  const rowMenu = (r: RecordData) => [
    { id: 'open', label: L.opportunities.actions.openInInspector, icon: 'eye', onSelect: () => open(r.id) },
    { id: 'page', label: L.opportunities.actions.openFullPage, icon: 'layout-dashboard', onSelect: () => navigate(recordPagePath(actor.workspaceId, 'opportunities', r.id)) },
  ];

  return (
    <div className={cx('page page-resource', peek && 'has-inspector')}>
      <div className="page-main">
        <PageHeader title={L.nav.pages.pipeline.title} description={T.description} />
        <div className="view-toolbar view-tabs-row">
          <div className="segmented" role="radiogroup" aria-label={T.layout}>
            {(['kanban', 'list'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className={cx('seg-btn', mode === m && 'is-on')} onClick={() => update({ mode: m === 'list' ? 'list' : undefined, page: undefined })}>
                {m === 'kanban' ? T.kanban : T.list}
              </button>
            ))}
          </div>
          <div className="view-tools view-tools-primary">
            <Button icon="plus" onClick={() => setCreating({ mode: 'quick' })} disabledReason={canCreate ? undefined : T.cannotCreate(actor.role.label)}>
              {L.opportunities.actions.newOpportunity}
            </Button>
          </div>
        </div>
        <div className="toolbar">
          <div className="search-field">
            <span className="search-icon" aria-hidden="true">
              <Icon name="search" size={14} />
            </span>
            <input type="search" className="input input-compact" placeholder={T.search} aria-label={T.searchLabel} value={searchText} onChange={(e) => setSearchText(e.target.value)} />
          </div>
          <SelectMenu label={T.division} value={params.get('division') ?? ''} options={masterOptions('division', T.allDivisions)} onChange={(v) => update({ division: v, page: undefined })} />
          <SelectMenu label={T.owner} value={params.get('owner') ?? ''} searchable options={[{ value: '', label: T.allOwners }, ...ownerOptions]} onChange={(v) => update({ owner: v, page: undefined })} />
          <SelectMenu
            label={T.stage}
            value={params.get('stage') ?? ''}
            options={[{ value: '', label: T.openStages }, { value: 'all', label: T.allStages }, ...activeMasterValues('oppStage').map((v) => ({ value: v.key, label: v.label }))]}
            onChange={(v) => update({ stage: v, page: undefined })}
          />
          <SelectMenu label={T.territory} value={params.get('territory') ?? ''} searchable options={masterOptions('territory', T.allTerritories)} onChange={(v) => update({ territory: v, page: undefined })} />
          <SelectMenu label={T.productType} value={params.get('type') ?? ''} options={masterOptions('productType', T.allProductTypes)} onChange={(v) => update({ type: v, page: undefined })} />
          <SelectMenu
            label={T.closeMonth}
            value={params.get('month') ?? ''}
            options={[{ value: '', label: T.anyMonth }, ...(facets.data?.closeMonths ?? []).map((m) => ({ value: m, label: periodLabel(m, 'month') }))]}
            onChange={(v) => update({ month: v, page: undefined })}
          />
          {filtered && (
            <Button
              onClick={() => {
                setSearchText('');
                update({ q: undefined, page: undefined, ...Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])) });
              }}
            >
              {L.opportunities.actions.clearFilters}
            </Button>
          )}
          <span className="toolbar-count muted" aria-live="polite">
            {T.count(rows.length)}
          </span>
        </div>
        {query.data && (
          <section className="stats" aria-label={L.nav.pages.pipeline.title}>
            <div className="stat">
              <span className="stat-label">{T.statOpen}</span>
              <span className="stat-value">{totals.open}</span>
            </div>
            <div className="stat">
              <span className="stat-label">{T.statPipeline}</span>
              <span className="stat-value">{moneyShort(totals.value)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">{T.statWeighted}</span>
              <span className="stat-value">{moneyShort(totals.weighted)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">{T.statStagnant}</span>
              <span className="stat-value">{totals.stagnant}</span>
            </div>
          </section>
        )}
        <div className={cx('content-surface', mode === 'list' && rows.length > 0 && 'is-table')}>
          {query.error ? (
            <ErrorState title={T.errorTitle} onRetry={query.retry}>
              {query.error}
            </ErrorState>
          ) : !query.data ? (
            <Skeleton rows={8} />
          ) : !rows.length ? (
            <EmptyState
              icon="search"
              title={filtered ? T.noMatchTitle : T.emptyTitle}
              action={
                filtered ? (
                  <Button
                    onClick={() => {
                      setSearchText('');
                      update({ q: undefined, page: undefined, ...Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])) });
                    }}
                  >
                    {L.opportunities.actions.clearFilters}
                  </Button>
                ) : undefined
              }
            >
              {filtered ? T.noMatchBody : T.emptyBody}
            </EmptyState>
          ) : mode === 'kanban' ? (
            <BoardView res={res} actor={actor} rows={rows} boardField="stage" cardFields={CARD_FIELDS} onOpen={open} activeId={peek} />
          ) : (
            <>
              <DataGrid
                res={res}
                actor={actor}
                rows={pageRows}
                columns={columns}
                onColumnsChange={setColumns}
                sort={sort}
                onSortChange={(s) => {
                  setSort(s);
                  update({ page: undefined });
                }}
                density="compact"
                selected={selected}
                onSelectedChange={setSelected}
                activeId={peek}
                onOpen={open}
                onEdit={setEditId}
                rowMenu={rowMenu}
              />
              <Pager page={page} pageCount={pageCount} pageSize={pageSize} total={rows.length} onPage={(p) => update({ page: p ? String(p) : undefined })} onSize={(n) => update({ size: n === PAGE_SIZES[0] ? undefined : String(n), page: undefined })} />
            </>
          )}
        </div>
      </div>
      {peek && <RecordInspector key="opportunities" resKey="opportunities" recordId={peek} onClose={() => update({ peek: undefined })} siblings={(mode === 'list' ? pageRows : rows).map((r) => r.id)} onNavigate={open} />}
      <QuickCreateDialog
        open={creating?.mode === 'quick'}
        resKey="opportunities"
        initial={creating?.initial}
        onClose={() => setCreating(null)}
        onCreated={(r) => open(r.id)}
        onMoreFields={(values) => setCreating({ mode: 'drawer', initial: values })}
      />
      <FormDrawer open={creating?.mode === 'drawer'} resKey="opportunities" initial={creating?.initial} onClose={() => setCreating(null)} onSaved={(r) => open(r.id)} />
      <FormDrawer open={!!editId} resKey="opportunities" recordId={editId ?? undefined} onClose={() => setEditId(null)} />
    </div>
  );
}

/** Table footer (same markup as the resource list footer): range, numbered pages, rows per page. */
function Pager({ page, pageCount, pageSize, total, onPage, onSize }: { page: number; pageCount: number; pageSize: number; total: number; onPage: (p: number) => void; onSize: (n: number) => void }) {
  const from = total ? page * pageSize + 1 : 0;
  const to = Math.min(total, (page + 1) * pageSize);
  const pages: (number | 'gap')[] = [];
  for (let i = 0; i < pageCount; i++) {
    if (i === 0 || i === pageCount - 1 || Math.abs(i - page) <= 1) pages.push(i);
    else if (pages[pages.length - 1] !== 'gap') pages.push('gap');
  }
  return (
    <div className="grid-footer">
      <span className="grid-footer-range" aria-live="polite">
        {T.range(from, to, total)}
      </span>
      <nav className="grid-pages" aria-label={T.pagination}>
        <IconButton icon="chevron-left" label={T.previousPage} disabledReason={page === 0 ? T.firstPage : undefined} onClick={() => onPage(page - 1)} />
        {pages.map((p, i) =>
          p === 'gap' ? (
            <span key={`g${i}`} className="grid-page-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button key={p} type="button" className={cx('grid-page', p === page && 'is-current')} aria-current={p === page ? 'page' : undefined} aria-label={T.pageN(p + 1)} onClick={() => onPage(p)}>
              {p + 1}
            </button>
          ),
        )}
        <IconButton icon="chevron-right" label={T.nextPage} disabledReason={page >= pageCount - 1 ? T.lastPage : undefined} onClick={() => onPage(page + 1)} />
      </nav>
      <SelectMenu label={T.rowsPerPage} value={pageSize} options={PAGE_SIZES.map((n) => ({ value: n, label: T.perPage(n) }))} onChange={onSize} />
    </div>
  );
}
