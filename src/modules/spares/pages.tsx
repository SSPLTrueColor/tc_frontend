import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/primitives/Button';
import { DateText, EmptyValue } from '../../components/primitives/display';
import { Badge, EmptyState, ErrorState, InlineAlert, NoAccess, Skeleton, useToast } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';
import { LogActivityDialog } from '../../components/crm/LogActivityDialog';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { formatDate } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { recordPeekPath, resourcePath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import * as api from '../../services/api/spares';
import { can } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { getPolicies } from '../../services/policies';
import { recordTitle } from '../../services/runtime';
import type { LeakageRow, ReorderRow } from '../../services/spares/consumables';
import { SimpleTable } from './components/ListKit';

function useBusy() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const run = async (op: () => Promise<string>) => {
    setBusy(true);
    try {
      toast(await op());
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

// ---------------------------------------------------------------- stock alerts (FR-093 / FR-097)

export function StockAlertsPage() {
  const actor = useActor();
  const q = useServiceQuery(() => api.stockAlerts(actor), [actor.user.id]);
  const sync = useBusy();
  const alert = useBusy();
  const [critOnly, setCritOnly] = useState<'all' | 'critical'>('all');
  if (!can(actor, 'spares.stock')) return <NoAccess what="spare stock alerts" />;
  const rows = (q.data?.below ?? []).filter((r) => critOnly === 'all' || r.critical);
  return (
    <div className="page">
      <PageHeader
        title="Stock alerts"
        description="Main-store parts below their minimum level, with the suggested import quantity (twice the minimum minus stock) and open requisition demand. Stock is synced from the ERP (simulated)."
        actions={
          <div className="sp-page-actions">
            {can(actor, 'spares.erpSync') && (
              <Button icon="reset" loading={sync.busy} onClick={() => sync.run(async () => {
                const r = await api.syncStockFromErp(actor);
                return `ERP sync done: ${r.updated} part(s) received stock, ${r.belowMin} still below minimum`;
              })}>
                Sync stock from ERP
              </Button>
            )}
            <Button icon="bell" loading={alert.busy} disabledReason={q.data && !q.data.below.length ? 'Nothing is below minimum' : undefined} onClick={() => alert.run(async () => `Alert sent to store and SCM for ${await api.sweepMinLevels(actor)} part(s)`)}>
              Notify store & SCM
            </Button>
          </div>
        }
      />
      <div className="content-surface">
        {q.error ? (
          <ErrorState title="Could not load stock alerts" onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={8} />
        ) : !q.data.below.length ? (
          <EmptyState icon="check" title="All parts are at or above minimum">
            {q.data.totalParts} active parts checked{q.data.lastSync ? ` · last ERP sync ${formatDate(q.data.lastSync)}` : ''}.
          </EmptyState>
        ) : (
          <>
            <div className="toolbar">
              <span className="muted small">
                {q.data.below.length} of {q.data.totalParts} parts below minimum{q.data.lastSync ? ` · last ERP sync ` : ''}
                {q.data.lastSync && <DateText value={q.data.lastSync} />}
              </span>
              <span className="spacer" />
              <SelectMenu label="Show" value={critOnly} options={[{ value: 'all', label: 'All parts' }, { value: 'critical', label: 'Critical only' }]} onChange={setCritOnly} />
            </div>
            <SimpleTable
              label="Parts below minimum"
              rows={rows}
              rowKey={(r) => r.id}
              search={(r) => `${r.partNo} ${r.description}`}
              initialSort={{ key: 'short', dir: 'desc' }}
              columns={[
                { key: 'part', label: 'Part', sort: (r) => r.partNo, render: (r) => <Link to={recordPeekPath(actor.workspaceId, 'spareParts', r.id)}>{r.partNo}</Link> },
                { key: 'desc', label: 'Description', sort: (r) => r.description, render: (r) => r.description },
                { key: 'crit', label: 'Critical', sort: (r) => Number(r.critical), render: (r) => (r.critical ? <Badge tone="danger">Critical</Badge> : <span className="muted">No</span>) },
                { key: 'stock', label: 'Stock', num: true, sort: (r) => r.stockMain, render: (r) => r.stockMain },
                { key: 'min', label: 'Minimum', num: true, sort: (r) => r.minLevel, render: (r) => r.minLevel },
                { key: 'short', label: 'Short by', num: true, sort: (r) => r.shortBy, render: (r) => r.shortBy },
                { key: 'demand', label: 'Open demand', num: true, sort: (r) => r.openDemand, render: (r) => r.openDemand },
                { key: 'sugg', label: 'Suggested import', num: true, sort: (r) => r.suggested, render: (r) => <strong>{r.suggested}</strong> },
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- consumables leakage (FR-100 / BR-39)

export function LeakagePage() {
  const actor = useActor();
  const q = useServiceQuery(() => api.leakageList(actor), [actor.user.id]);
  const [kind, setKind] = useState<'all' | 'never' | 'lapsed'>('all');
  const [logFor, setLogFor] = useState<LeakageRow | null>(null);
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => kind === 'all' || (kind === 'never' ? !r.lastOrderDate : !!r.lastOrderDate)), [q.data, kind]);
  if (!can(actor, 'consumables.view')) return <NoAccess what="the consumables leakage list" />;
  return (
    <div className="page">
      <PageHeader title="Consumables leakage" description={`Customers with an installed machine who have not ordered True Colors ink, paper or fabric in the last ${getPolicies().leakageDays} days — follow them up for cross-sell.`} />
      <div className="content-surface">
        {q.error ? (
          <ErrorState title="Could not load the leakage list" onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={8} />
        ) : (
          <>
            {q.data.sourcesMissing.length > 0 && <InlineAlert tone="info">Waiting for {q.data.sourcesMissing.join(', ')} data — the list fills in once those modules have records.</InlineAlert>}
            {!q.data.rows.length ? (
              <EmptyState icon="check" title="No leakage">
                All {q.data.machineCustomers} machine customer(s) you can see ordered consumables in the last {q.data.days} days.
              </EmptyState>
            ) : (
              <>
                <div className="toolbar">
                  <span className="muted small">
                    {q.data.rows.length} of {q.data.machineCustomers} machine customers
                  </span>
                  <span className="spacer" />
                  <SelectMenu label="Show" value={kind} options={[{ value: 'all', label: 'All' }, { value: 'never', label: 'Never ordered' }, { value: 'lapsed', label: 'Lapsed buyers' }]} onChange={setKind} />
                </div>
                <SimpleTable
                  label="Leakage customers"
                  rows={rows}
                  rowKey={(r) => r.customerId}
                  search={(r) => `${r.customerName} ${r.models}`}
                  initialSort={{ key: 'since', dir: 'desc' }}
                  columns={[
                    { key: 'cust', label: 'Customer', sort: (r) => r.customerName, render: (r) => <Link to={recordPeekPath(actor.workspaceId, 'customers', r.customerId)}>{r.customerName}</Link> },
                    { key: 'mach', label: 'Machines', num: true, sort: (r) => r.machines, render: (r) => r.machines },
                    { key: 'models', label: 'Models', render: (r) => r.models || <EmptyValue /> },
                    { key: 'last', label: 'Last consumables order', sort: (r) => r.lastOrderDate ?? '', render: (r) => (r.lastOrderDate ? <DateText value={r.lastOrderDate} /> : <Badge tone="danger">Never</Badge>) },
                    { key: 'since', label: 'Days since', num: true, sort: (r) => r.daysSince ?? 99999, render: (r) => r.daysSince ?? <EmptyValue /> },
                    { key: 'owner', label: 'Account owner', sort: (r) => recordTitle('employees', r.ownerId, actor), render: (r) => (r.ownerId ? recordTitle('employees', r.ownerId, actor) : <EmptyValue />) },
                    { key: 'act', label: 'Actions', render: (r) => <Button onClick={() => setLogFor(r)}>Log follow-up</Button> },
                  ]}
                />
              </>
            )}
          </>
        )}
      </div>
      {logFor && <LogActivityDialog open onClose={() => setLogFor(null)} requireNextFollowUp parent={{ parentResource: 'customers', parentId: logFor.customerId, parentLabel: `${logFor.customerId} · ${logFor.customerName}`, customerId: logFor.customerId }} />}
    </div>
  );
}

// ---------------------------------------------------------------- reorders due (FR-101 / BR-40)

const STATE: Record<ReorderRow['state'], { label: string; tone: 'danger' | 'warning' | 'neutral' }> = { missed: { label: 'Missed', tone: 'danger' }, due: { label: 'Due', tone: 'warning' }, upcoming: { label: 'Upcoming', tone: 'neutral' } };

export function ReordersPage() {
  const actor = useActor();
  const q = useServiceQuery(() => api.reorderList(actor), [actor.user.id]);
  const [state, setState] = useState<'open' | ReorderRow['state'] | 'all'>('open');
  const remind = useBusy();
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => state === 'all' || (state === 'open' ? r.state !== 'upcoming' : r.state === state)), [q.data, state]);
  if (!can(actor, 'consumables.view')) return <NoAccess what="reorder predictions" />;
  const counts = (q.data?.rows ?? []).reduce((m, r) => ({ ...m, [r.state]: (m[r.state] ?? 0) + 1 }), {} as Record<string, number>);
  return (
    <div className="page">
      <PageHeader
        title="Reorders due"
        description={`Predicted next consumables order per customer: last order + average interval of the last three orders. “Missed” once ${getPolicies().missedReorderDays} days past the predicted date.`}
        actions={
          <Button icon="bell" loading={remind.busy} disabledReason={!counts.due && !counts.missed ? 'No reorders are due or missed' : undefined} onClick={() => remind.run(async () => `Reminders sent for ${await api.sendReorderReminders(actor)} customer(s)`)}>
            Send reminders
          </Button>
        }
      />
      <div className="content-surface">
        {q.error ? (
          <ErrorState title="Could not load reorder predictions" onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={8} />
        ) : (
          <>
            {q.data.sourcesMissing.length > 0 && <InlineAlert tone="info">Waiting for {q.data.sourcesMissing.join(', ')} data — predictions appear once there are consumables orders.</InlineAlert>}
            {!q.data.rows.length ? (
              <EmptyState icon="calendar-clock" title="No predictions yet">
                A customer needs at least two consumables orders before a reorder date can be predicted.
              </EmptyState>
            ) : (
              <>
                <div className="toolbar">
                  <span className="muted small">
                    {counts.missed ?? 0} missed · {counts.due ?? 0} due in 7 days · {counts.upcoming ?? 0} upcoming
                  </span>
                  <span className="spacer" />
                  <SelectMenu label="Show" value={state} options={[{ value: 'open', label: 'Due & missed' }, { value: 'missed', label: 'Missed' }, { value: 'due', label: 'Due' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'all', label: 'All' }]} onChange={setState} />
                </div>
                {!rows.length ? (
                  <EmptyState icon="check" title="Nothing in this view">
                    Change “Show” to see other customers.
                  </EmptyState>
                ) : (
                  <SimpleTable
                    label="Reorder predictions"
                    rows={rows}
                    rowKey={(r) => r.customerId}
                    search={(r) => r.customerName}
                    initialSort={{ key: 'due', dir: 'asc' }}
                    columns={[
                      { key: 'cust', label: 'Customer', sort: (r) => r.customerName, render: (r) => <Link to={recordPeekPath(actor.workspaceId, 'customers', r.customerId)}>{r.customerName}</Link> },
                      { key: 'state', label: 'Status', sort: (r) => r.state, render: (r) => <Badge tone={STATE[r.state].tone}>{STATE[r.state].label}</Badge> },
                      { key: 'due', label: 'Predicted reorder', sort: (r) => r.dueDate, render: (r) => <DateText value={r.dueDate} /> },
                      { key: 'late', label: 'Days late', num: true, sort: (r) => r.daysLate, render: (r) => r.daysLate },
                      { key: 'every', label: 'Orders every', num: true, sort: (r) => r.avgIntervalDays, render: (r) => `${r.avgIntervalDays} d` },
                      { key: 'last', label: 'Last order', sort: (r) => r.lastOrderDate, render: (r) => <Link to={recordPeekPath(actor.workspaceId, 'salesOrders', r.lastOrderId)}>{formatDate(r.lastOrderDate)}</Link> },
                      { key: 'value', label: 'Last value', num: true, sort: (r) => r.lastOrderValue, render: (r) => formatMoney(r.lastOrderValue) },
                      { key: 'owner', label: 'Owner', sort: (r) => recordTitle('employees', r.ownerId, actor), render: (r) => (r.ownerId ? recordTitle('employees', r.ownerId, actor) : <EmptyValue />) },
                      { key: 'act', label: 'Actions', render: (r) => <Link className="btn btn-secondary" to={`/orders/new?repeatOf=${encodeURIComponent(r.lastOrderId)}`}><span className="btn-label">Create repeat order</span></Link> },
                    ]}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
      <p className="muted small">
        Rate contracts in force: <Link to={resourcePath(actor.workspaceId, 'rateContracts', { view: 'v_rc_valid' })}>view valid rate contracts</Link>
      </p>
    </div>
  );
}
