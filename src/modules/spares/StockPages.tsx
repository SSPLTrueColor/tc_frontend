import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/primitives/Button';
import { DateText, EmptyValue } from '../../components/primitives/display';
import { Badge, EmptyState, ErrorState, InlineAlert, NoAccess, Skeleton } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { formatMoney } from '../../lib/format';
import { recordPeekPath, resourcePath } from '../../lib/routes';
import * as api from '../../services/api/spares';
import { can } from '../../services/authz';
import { useActor } from '../../services/hooks';
import type { Column } from '../../components/primitives/DataTable';
import { DataTable } from '../../components/primitives/DataTable';
import { useBusy } from './components/useBusy';
import type { EngineerPartRow, EngineerRow, StockFigures } from '../../services/spares/stock';
import { LinkButton } from '../../components/primitives/controls';

// ---------------------------------------------------------------- Main Store Stock (SPR-02, FR-093)

type StockState = 'all' | 'below' | 'ok' | 'critical';

export function MainStoreStockPage() {
  const actor = useActor();
  const P = L.spares.pages.mainStoreStock;
  const q = useServiceQuery(() => api.mainStoreStock(actor), [actor.user.id]);
  const sync = useBusy();
  const [category, setCategory] = useState('');
  const [state, setState] = useState<StockState>('all');
  const rows = useMemo(
    () =>
      (q.data?.rows ?? []).filter(
        (r) => (!category || r.category === category) && (state === 'all' || (state === 'below' ? r.belowMin : state === 'ok' ? !r.belowMin : r.critical)),
      ),
    [q.data, category, state],
  );
  if (!can(actor, 'spares.stock')) return <NoAccess what={P.noAccess} />;
  return (
    <div className="page">
      <PageHeader
        title={L.nav.pages.mainStoreStock.title}
        description={P.description}
        actions={
          can(actor, 'spares.erpSync') ? (
            <Button
              icon="reset"
              loading={sync.busy}
              onClick={() =>
                sync.run(async () => {
                  const r = await api.syncStockFromErp(actor);
                  return P.synced(r.updated, r.belowMin);
                })
              }
            >
              {L.spares.actions.syncStock}
            </Button>
          ) : undefined
        }
      />
      <div className="content-surface">
        {q.error ? (
          <ErrorState title={P.loadError} onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={10} />
        ) : !q.data.rows.length ? (
          <EmptyState icon="archive" title={P.empty}>
            {P.emptyBody}
          </EmptyState>
        ) : (
          <>
            <p className="muted small">
              {P.summary(q.data.rows.length, q.data.below)} · {P.totalValue} <strong>{formatMoney(q.data.totalValue)}</strong>
              {q.data.lastSync && (
                <>
                  {' '}
                  · {P.lastSync} <DateText value={q.data.lastSync} />
                </>
              )}
            </p>
            <DataTable
              label={P.tableLabel}
              rows={rows}
              rowKey={(r) => r.id}
              search={(r) => `${r.partNo} ${r.description} ${r.categoryLabel}`}
              initialSort={{ key: 'part', dir: 'asc' }}
              emptyText={P.noRowsBody}
              tools={
                <>
                  <span className="spacer" />
                  <SelectMenu label={P.filterCategory} value={category} options={[{ value: '', label: P.allCategories }, ...q.data.categories]} onChange={setCategory} />
                  <SelectMenu
                    label={P.filterState}
                    value={state}
                    options={(Object.keys(P.states) as StockState[]).map((k) => ({ value: k, label: P.states[k] }))}
                    onChange={setState}
                  />
                </>
              }
              columns={[
                { key: 'part', label: P.cols.part, sort: (r) => r.partNo, render: (r) => <Link to={recordPeekPath(actor.workspaceId, 'spareParts', r.id)}>{r.partNo}</Link> },
                { key: 'desc', label: P.cols.description, sort: (r) => r.description, render: (r) => r.description },
                { key: 'cat', label: P.cols.category, sort: (r) => r.categoryLabel, render: (r) => r.categoryLabel || <EmptyValue /> },
                { key: 'onHand', label: P.cols.onHand, num: true, sort: (r) => r.stockMain, render: (r) => r.stockMain },
                { key: 'min', label: P.cols.minLevel, num: true, sort: (r) => r.minLevel, render: (r) => r.minLevel },
                { key: 'transit', label: P.cols.inTransit, num: true, sort: (r) => r.inTransit, render: (r) => r.inTransit },
                { key: 'eng', label: P.cols.withEngineers, num: true, sort: (r) => r.withEngineers, render: (r) => r.withEngineers },
                { key: 'value', label: P.cols.value, num: true, sort: (r) => r.value, render: (r) => formatMoney(r.value) },
                {
                  key: 'flag',
                  label: P.cols.flag,
                  sort: (r) => Number(r.belowMin) * 2 + Number(r.critical && r.belowMin),
                  render: (r) =>
                    r.belowMin ? (
                      <Badge tone={r.critical ? 'danger' : 'warning'}>
                        {P.belowFlag}
                        {r.critical ? ` · ${L.spares.common.critical}` : ''}
                      </Badge>
                    ) : (
                      <span className="muted">{P.ok}</span>
                    ),
                },
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Engineer Stock (4.9 title, GLOSSARY G-A1)

function figureColumns<T extends StockFigures>(): Column<T>[] {
  const C = L.spares.pages.engineerStock.cols;
  const n = (key: keyof StockFigures, label: string): Column<T> => ({ key, label, num: true, sort: (r) => Number(r[key] ?? 0), render: (r) => Number(r[key] ?? 0) });
  return [
    n('issued', C.issued),
    n('inTransit', C.inTransit),
    n('received', C.received),
    n('consumed', C.consumed),
    n('returned', C.returned),
    { key: 'inHand', label: C.inHand, num: true, sort: (r) => r.inHand, render: (r) => <strong>{r.inHand}</strong> },
    { key: 'defective', label: C.defective, num: true, sort: (r) => r.defective, render: (r) => (r.defective ? <Badge tone="warning">{r.defective}</Badge> : 0) },
    { key: 'inHandValue', label: C.inHandValue, num: true, sort: (r) => r.inHandValue, render: (r) => formatMoney(r.inHandValue) },
    { key: 'last', label: C.lastMovement, sort: (r) => r.lastMovement ?? '', render: (r) => (r.lastMovement ? <DateText value={r.lastMovement} /> : <EmptyValue />) },
  ];
}

export function EngineerStockPage() {
  const actor = useActor();
  const P = L.spares.pages.engineerStock;
  const scope = api.engineerStockScope(actor);
  const [engineerId, setEngineerId] = useState('');
  const q = useServiceQuery(() => api.engineerStock(actor, scope === 'all' ? engineerId || null : null), [actor.user.id, engineerId, scope]);
  if (scope === 'none') return <NoAccess what={P.noAccess} />;
  const data = q.data;
  const showParts = scope === 'own' || !!engineerId;
  const picker =
    scope === 'all' && data ? (
      <SelectMenu
        label={P.engineer}
        searchable
        value={engineerId}
        options={[{ value: '', label: P.allEngineers }, ...data.engineers.map((e) => ({ value: e.engineerId, label: e.engineerName }))]}
        onChange={setEngineerId}
      />
    ) : null;
  const engineerCols: Column<EngineerRow>[] = [
    {
      key: 'eng',
      label: P.cols.engineer,
      sort: (r) => r.engineerName,
      render: (r) => (
        <button type="button" className="link" onClick={() => setEngineerId(r.engineerId)}>
          {r.engineerName}
        </button>
      ),
    },
    ...figureColumns<EngineerRow>(),
  ];
  const partCols: Column<EngineerPartRow>[] = [
    { key: 'part', label: P.cols.part, sort: (r) => r.partNo, render: (r) => <Link to={recordPeekPath(actor.workspaceId, 'spareParts', r.partId)}>{`${r.partNo} · ${r.description}`}</Link> },
    ...figureColumns<EngineerPartRow>(),
  ];
  return (
    <div className="page">
      <PageHeader title={L.nav.pages.engineerStock.title} description={P.description} />
      <div className="content-surface">
        {q.error ? (
          <ErrorState title={P.loadError} onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !data ? (
          <Skeleton rows={8} />
        ) : showParts ? (
          <>
            {scope === 'own' && <InlineAlert tone="info">{P.viewOwn}</InlineAlert>}
            {!data.parts.length ? (
              <>
                {picker && <div className="toolbar">{picker}</div>}
                <EmptyState icon="archive" title={scope === 'own' ? P.noOwn : P.empty}>
                  {scope === 'own' ? P.noOwnBody : P.emptyBody}
                </EmptyState>
              </>
            ) : (
              <DataTable
                key={data.selected ?? 'own'}
                label={P.tableParts}
                rows={data.parts}
                rowKey={(r) => r.partId}
                search={(r) => `${r.partNo} ${r.description}`}
                initialSort={{ key: 'inHand', dir: 'desc' }}
                tools={
                  <>
                    <span className="spacer" />
                    {picker}
                    <LinkButton to={resourcePath(actor.workspaceId, 'requisitions', { view: 'v_req_all' })}>{P.openRequisitions}</LinkButton>
                  </>
                }
                columns={partCols}
              />
            )}
          </>
        ) : !data.engineers.length ? (
          <EmptyState icon="users" title={P.empty}>
            {P.emptyBody}
          </EmptyState>
        ) : (
          <DataTable
            label={P.tableEngineers}
            rows={data.engineers}
            rowKey={(r) => r.engineerId}
            search={(r) => r.engineerName}
            initialSort={{ key: 'inHand', dir: 'desc' }}
            tools={
              <>
                <span className="spacer" />
                {picker}
              </>
            }
            columns={engineerCols}
          />
        )}
      </div>
    </div>
  );
}
