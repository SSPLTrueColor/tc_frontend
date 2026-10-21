import { REORDER_TONE } from '../../domain/statusTones';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/primitives/Button';
import { DateText, EmptyValue } from '../../components/primitives/display';
import { Badge, EmptyState, ErrorState, InlineAlert, NoAccess, Skeleton } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { ListPage } from '../../components/shell/ListPage';
import { LogActivityDialog } from '../../components/crm/LogActivityDialog';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { formatDate } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { recordPeekPath, resourcePath } from '../../lib/routes';
import * as api from '../../services/api/spares';
import { can } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { getPolicies } from '../../services/policies';
import { recordTitle } from '../../services/runtime';
import type { LeakageRow, ReorderRow } from '../../services/spares/consumables';
import { DataTable } from '../../components/primitives/DataTable';
import { RepeatOrderDialog } from './components/RepeatOrderDialog';
import { useBusy } from './components/useBusy';

// ---------------------------------------------------------------- Minimum-Level Alerts (SPR-06, FR-097)

export function MinimumLevelAlertsPage() {
  const actor = useActor();
  const P = L.spares.pages.minimumLevelAlerts;
  const q = useServiceQuery(() => api.minimumLevelAlerts(actor), [actor.user.id]);
  const sync = useBusy();
  const alert = useBusy();
  const [critOnly, setCritOnly] = useState<'all' | 'critical'>('all');
  if (!can(actor, 'spares.stock')) return <NoAccess what={P.noAccess} />;
  const rows = (q.data?.below ?? []).filter((r) => critOnly === 'all' || r.critical);
  return (
    <ListPage
        title={L.nav.pages.minimumLevelAlerts.title}
        description={P.description}
        actions={
          <div className="sp-page-actions">
            {can(actor, 'spares.erpSync') && (
              <Button
                icon="reset"
                loading={sync.busy}
                onClick={() =>
                  sync.run(async () => {
                    const r = await api.syncStockFromErp(actor);
                    return L.spares.pages.mainStoreStock.synced(r.updated, r.belowMin);
                  })
                }
              >
                {L.spares.actions.syncStock}
              </Button>
            )}
            <Button icon="bell" loading={alert.busy} disabledReason={q.data && !q.data.below.length ? P.nothingBelow : undefined} onClick={() => alert.run(async () => P.alerted(await api.sweepMinLevels(actor)))}>
              {L.spares.actions.notifyStore}
            </Button>
          </div>
        }
      >
        {q.error ? (
          <ErrorState title={P.loadError} onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={8} />
        ) : !q.data.below.length ? (
          <EmptyState icon="check" title={P.allOk}>
            {P.checked(q.data.totalParts)}
            {q.data.lastSync ? P.lastSync(formatDate(q.data.lastSync)) : ''}.
          </EmptyState>
        ) : (
          <DataTable exportResource="spareParts"
            label={P.tableLabel}
            rows={rows}
            rowKey={(r) => r.id}
            search={(r) => `${r.partNo} ${r.description}`}
            initialSort={{ key: 'short', dir: 'desc' }}
            summary={
              <>
                {P.summary(q.data.below.length, q.data.totalParts)}
                {q.data.lastSync ? P.lastSyncPrefix : ''}
                {q.data.lastSync && <DateText value={q.data.lastSync} />}
              </>
            }
            activeFilters={critOnly === 'all' ? 0 : 1}
            onClearFilters={() => setCritOnly('all')}
            filters={<SelectMenu label={L.spares.common.show} value={critOnly} options={[{ value: 'all', label: P.critOptions.all }, { value: 'critical', label: P.critOptions.critical }]} onChange={setCritOnly} />}
            columns={[
              { key: 'part', label: P.cols.part, sort: (r) => r.partNo, render: (r) => <Link to={recordPeekPath(actor.workspaceId, 'spareParts', r.id)}>{r.partNo}</Link> },
              { key: 'desc', label: P.cols.description, sort: (r) => r.description, render: (r) => r.description },
              { key: 'crit', label: P.cols.critical, sort: (r) => Number(r.critical), render: (r) => (r.critical ? <Badge tone="danger">{L.spares.common.critical}</Badge> : <span className="muted">{L.spares.common.no}</span>) },
              { key: 'stock', label: P.cols.stock, num: true, sort: (r) => r.stockMain, render: (r) => r.stockMain },
              { key: 'min', label: P.cols.min, num: true, sort: (r) => r.minLevel, render: (r) => r.minLevel },
              { key: 'short', label: P.cols.short, num: true, sort: (r) => r.shortBy, render: (r) => r.shortBy },
              { key: 'demand', label: P.cols.demand, num: true, sort: (r) => r.openDemand, render: (r) => r.openDemand },
              { key: 'sugg', label: P.cols.suggested, num: true, sort: (r) => r.suggested, render: (r) => <strong>{r.suggested}</strong> },
            ]}
          />
        )}
    </ListPage>
  );
}

// ---------------------------------------------------------------- Leakage List (CON-03, FR-100 / BR-39)

export function LeakageListPage() {
  const actor = useActor();
  const P = L.consumables.pages.leakageList;
  const q = useServiceQuery(() => api.leakageList(actor), [actor.user.id]);
  const [kind, setKind] = useState<'all' | 'never' | 'lapsed'>('all');
  const [logFor, setLogFor] = useState<LeakageRow | null>(null);
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => kind === 'all' || (kind === 'never' ? !r.lastOrderDate : !!r.lastOrderDate)), [q.data, kind]);
  if (!can(actor, 'consumables.view')) return <NoAccess what={P.noAccess} />;
  return (
    <ListPage title={L.nav.pages.leakageList.title} description={P.description(getPolicies().leakageDays)}
      >
        {q.error ? (
          <ErrorState title={P.loadError} onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={8} />
        ) : (
          <>
            {q.data.sourcesMissing.length > 0 && <InlineAlert tone="info">{P.waiting(q.data.sourcesMissing.join(', '))}</InlineAlert>}
            {!q.data.rows.length ? (
              <EmptyState icon="check" title={P.none}>
                {P.noneBody(q.data.machineCustomers, q.data.days)}
              </EmptyState>
            ) : (
              <DataTable
                label={P.tableLabel}
                rows={rows}
                rowKey={(r) => r.customerId}
                search={(r) => `${r.customerName} ${r.models}`}
                initialSort={{ key: 'since', dir: 'desc' }}
                summary={P.summary(q.data.rows.length, q.data.machineCustomers)}
                activeFilters={kind === 'all' ? 0 : 1}
                onClearFilters={() => setKind('all')}
                filters={<SelectMenu label={L.consumables.common.show} value={kind} options={[{ value: 'all', label: P.kindOptions.all }, { value: 'never', label: P.kindOptions.never }, { value: 'lapsed', label: P.kindOptions.lapsed }]} onChange={setKind} />}
                columns={[
                  { key: 'cust', label: P.cols.customer, sort: (r) => r.customerName, render: (r) => <Link to={recordPeekPath(actor.workspaceId, 'customers', r.customerId)}>{r.customerName}</Link> },
                  { key: 'mach', label: P.cols.machines, num: true, sort: (r) => r.machines, render: (r) => r.machines },
                  { key: 'models', label: P.cols.models, render: (r) => r.models || <EmptyValue /> },
                  { key: 'last', label: P.cols.last, sort: (r) => r.lastOrderDate ?? '', render: (r) => (r.lastOrderDate ? <DateText value={r.lastOrderDate} /> : <Badge tone="danger">{P.never}</Badge>) },
                  { key: 'since', label: P.cols.since, num: true, sort: (r) => r.daysSince ?? 99999, render: (r) => r.daysSince ?? <EmptyValue /> },
                  { key: 'owner', label: P.cols.owner, sort: (r) => recordTitle('employees', r.ownerId, actor), render: (r) => (r.ownerId ? recordTitle('employees', r.ownerId, actor) : <EmptyValue />) },
                  { key: 'act', label: P.cols.actions, render: (r) => <Button size="compact" onClick={() => setLogFor(r)}>{L.consumables.actions.logFollowUp}</Button> },
                ]}
              />
            )}
          </>
        )}
      
      {logFor && <LogActivityDialog open onClose={() => setLogFor(null)} requireNextFollowUp parent={{ parentResource: 'customers', parentId: logFor.customerId, parentLabel: `${logFor.customerId} · ${logFor.customerName}`, customerId: logFor.customerId }} />}
    </ListPage>
  );
}

// ---------------------------------------------------------------- Reorder Prediction (CON-04, FR-101 / BR-40)

const STATE_TONE = REORDER_TONE;

export function ReorderPredictionPage() {
  const actor = useActor();
  const P = L.consumables.pages.reorderPrediction;
  const q = useServiceQuery(() => api.reorderList(actor), [actor.user.id]);
  const [state, setState] = useState<'open' | ReorderRow['state'] | 'all'>('open');
  const [repeat, setRepeat] = useState<{ id: string; label: string } | null>(null);
  const remind = useBusy();
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => state === 'all' || (state === 'open' ? r.state !== 'upcoming' : r.state === state)), [q.data, state]);
  if (!can(actor, 'consumables.view')) return <NoAccess what={P.noAccess} />;
  const counts = (q.data?.rows ?? []).reduce((m, r) => ({ ...m, [r.state]: (m[r.state] ?? 0) + 1 }), {} as Record<string, number>);
  const canRepeat = !!actor.role.resources.salesOrders?.create;
  return (
    <ListPage
        title={L.nav.pages.reorderPrediction.title}
        description={P.description(getPolicies().missedReorderDays)}
        actions={
          <Button icon="bell" loading={remind.busy} disabledReason={!counts.due && !counts.missed ? P.noReminders : undefined} onClick={() => remind.run(async () => P.reminded(await api.sendReorderReminders(actor)))}>
            {L.consumables.actions.sendReminders}
          </Button>
        }
      >
        {q.error ? (
          <ErrorState title={P.loadError} onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={8} />
        ) : (
          <>
            {q.data.sourcesMissing.length > 0 && <InlineAlert tone="info">{P.waiting(q.data.sourcesMissing.join(', '))}</InlineAlert>}
            {!q.data.rows.length ? (
              <EmptyState icon="calendar-clock" title={P.none}>
                {P.noneBody}
              </EmptyState>
            ) : (
              <DataTable
                label={P.tableLabel}
                rows={rows}
                rowKey={(r) => r.customerId}
                search={(r) => r.customerName}
                initialSort={{ key: 'due', dir: 'asc' }}
                summary={P.summary(counts.missed ?? 0, counts.due ?? 0, counts.upcoming ?? 0)}
                activeFilters={state === 'open' ? 0 : 1}
                onClearFilters={() => setState('open')}
                filters={
                    <SelectMenu
                      label={L.consumables.common.show}
                      value={state}
                      options={[
                        { value: 'open', label: P.stateOptions.open },
                        { value: 'missed', label: P.stateOptions.missed },
                        { value: 'due', label: P.stateOptions.due },
                        { value: 'upcoming', label: P.stateOptions.upcoming },
                        { value: 'all', label: P.stateOptions.all },
                      ]}
                      onChange={setState}
                    />
                }
                columns={[
                  { key: 'cust', label: P.cols.customer, sort: (r) => r.customerName, render: (r) => <Link to={recordPeekPath(actor.workspaceId, 'customers', r.customerId)}>{r.customerName}</Link> },
                  { key: 'state', label: P.cols.state, sort: (r) => r.state, render: (r) => <Badge tone={STATE_TONE[r.state]}>{P.states[r.state]}</Badge> },
                  { key: 'due', label: P.cols.due, sort: (r) => r.dueDate, render: (r) => <DateText value={r.dueDate} /> },
                  { key: 'late', label: P.cols.late, num: true, sort: (r) => r.daysLate, render: (r) => r.daysLate },
                  { key: 'every', label: P.cols.every, num: true, sort: (r) => r.avgIntervalDays, render: (r) => P.everyDays(r.avgIntervalDays) },
                  { key: 'last', label: P.cols.last, sort: (r) => r.lastOrderDate, render: (r) => <Link to={recordPeekPath(actor.workspaceId, 'salesOrders', r.lastOrderId)}>{formatDate(r.lastOrderDate)}</Link> },
                  { key: 'value', label: P.cols.value, num: true, sort: (r) => r.lastOrderValue, render: (r) => formatMoney(r.lastOrderValue) },
                  { key: 'owner', label: P.cols.owner, sort: (r) => recordTitle('employees', r.ownerId, actor), render: (r) => (r.ownerId ? recordTitle('employees', r.ownerId, actor) : <EmptyValue />) },
                  {
                    key: 'act',
                    label: P.cols.actions,
                    render: (r) => (
                      <Button size="compact" icon="reset" disabledReason={canRepeat ? undefined : L.consumables.pages.repeatOrders.noCreate} onClick={() => setRepeat({ id: r.lastOrderId, label: r.lastOrderId })}>
                        {L.consumables.actions.repeatOrder}
                      </Button>
                    ),
                  },
                ]}
              />
            )}
          </>
        )}
      
      <p className="muted small">
        {P.rateContractsNote} <Link to={resourcePath(actor.workspaceId, 'rateContracts', { view: 'v_rc_valid' })}>{P.rateContractsLink}</Link>
      </p>
      {repeat && <RepeatOrderDialog orderId={repeat.id} orderLabel={repeat.label} onClose={() => setRepeat(null)} />}
    </ListPage>
  );
}
