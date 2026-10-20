import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { RecordData } from '../../metadata/types';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { addDays, todayKey } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { recordPagePath, recordPeekPath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import { customerNameOf, sendPaymentReminders } from '../../services/api/orders';
import { can, canReadResource } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { activeMasterValues, masterValue } from '../../services/registry';
import { queryRecords, recordTitle } from '../../services/runtime';
import { getPolicies } from '../../services/policies';
import { Button } from '../../components/primitives/Button';
import { DateText } from '../../components/primitives/display';
import { ErrorState, NoAccess, Skeleton, StatusChip, useToast } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';
import { KpiStrip } from '../../components/resource/ListCard';
import { DataTable } from '../../components/primitives/DataTable';
import { ReceiptDialog } from './OrderTabs';

const O = L.orders;
const P = O.pages.paymentSchedule;
const FM = O.fields.paymentMilestones;

type Range = 'overdue' | 'week' | 'month' | 'open' | 'received' | 'all';
const RANGES: Range[] = ['open', 'overdue', 'week', 'month', 'received', 'all'];
/** Saved views of the paymentMilestones resource (sidebar links) open the matching range here. */
const VIEW_RANGE: Record<string, Range> = { v_pm_open: 'open', v_pm_overdue: 'overdue', v_pm_all: 'all' };

const outstandingOf = (m: RecordData) => Math.max(0, Number(m.amount) - (Number(m.receivedAmount) || 0));
const statusOf = (m: RecordData, today: string) => (m.status !== 'received' && String(m.dueDate) < today ? 'overdue' : String(m.status));

/**
 * SO-07 / BR-25 Payment Schedule: one page for every payment milestone the actor can see
 * (advance, milestones, balance) with due / overdue tracking, ERP receipts and the reminder sweep.
 * Milestone records stay reachable at /payment-schedule/:id.
 */
export function PaymentSchedulePage() {
  const actor = useActor();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const range: Range = (RANGES as string[]).includes(params.get('range') ?? '') ? (params.get('range') as Range) : VIEW_RANGE[params.get('view') ?? ''] ?? 'open';
  const [status, setStatus] = useState('');
  const [division, setDivision] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const today = todayKey();
  const allowed = canReadResource(actor, 'paymentMilestones');
  const data = useServiceQuery(() => (allowed ? queryRecords(actor, 'paymentMilestones', { sort: [{ field: 'dueDate', dir: 'asc' }] }).rows : []), [actor.user.id]);

  // Run the reminder sweep once per visit (idempotent: reminded milestones are stamped).
  useEffect(() => {
    if (!allowed) return;
    sendPaymentReminders(actor).catch(() => undefined);
  }, [actor.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRange = (r: Range) => {
    const next = new URLSearchParams(params);
    next.delete('view');
    next.set('range', r);
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    const all = data.data ?? [];
    const inRange = (m: RecordData) => {
      const due = String(m.dueDate);
      const open = m.status !== 'received';
      if (range === 'all') return true;
      if (range === 'received') return Number(m.receivedAmount) > 0;
      if (!open) return false;
      if (range === 'overdue') return due < today;
      if (range === 'week') return due <= addDays(today, 7);
      if (range === 'month') return due <= addDays(today, 30);
      return true;
    };
    const list = all.filter(
      (m) =>
        inRange(m) &&
        (!status || statusOf(m, today) === status) &&
        (!division || m.divisionId === division),
    );
    return list;
  }, [data.data, range, status, division, today]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed) return <NoAccess what={P.noAccess} />;

  const all = data.data ?? [];
  const open = all.filter((m) => m.status !== 'received');
  const sum = (list: RecordData[]) => list.reduce((t, m) => t + outstandingOf(m), 0);
  const overdue = open.filter((m) => String(m.dueDate) < today);
  const week = open.filter((m) => String(m.dueDate) >= today && String(m.dueDate) <= addDays(today, 7));
  const received = all.filter((m) => Number(m.receivedAmount) > 0);
  const kpi = (r: Range, label: string, value: number, count: number) => ({ key: r, label, value: formatMoney(value), sub: P.milestones(count), active: range === r, onClick: () => setRange(r) });

  return (
    <div className="page orders-page">
      <PageHeader
        title={L.nav.pages.paymentSchedule.title}
        description={P.description(getPolicies().paymentReminderDaysBefore)}
        actions={
          <Button
            icon="bell"
            loading={sending}
            onClick={async () => {
              setSending(true);
              try {
                const r = await sendPaymentReminders(actor);
                toast(r.reminded ? P.reminded(r.reminded) : P.allReminded, 'info');
              } catch (e) {
                toast(errorMessage(e), 'danger');
              } finally {
                setSending(false);
              }
            }}
          >
            {O.actions.sendReminders}
          </Button>
        }
      />
      {data.error ? (
        <ErrorState title={P.loadError} onRetry={data.retry}>
          {data.error}
        </ErrorState>
      ) : !data.data ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <KpiStrip
            label={P.stats}
            items={[
              kpi('overdue', P.overdue, sum(overdue), overdue.length),
              kpi('week', P.dueWeek, sum(week), week.length),
              kpi('open', P.outstanding, sum(open), open.length),
              kpi(
                'received',
                P.received,
                received.reduce((t, m) => t + (Number(m.receivedAmount) || 0), 0),
                received.length,
              ),
            ]}
          />
          <div className="content-surface">
            <DataTable
              label={P.tableTitle}
              rows={rows}
              rowKey={(m) => m.id}
              noun={P.noun}
              initialSort={{ key: 'dueDate', dir: 'asc' }}
              search={(m) => `${customerNameOf(m.customerId)} ${recordTitle('salesOrders', m.salesOrderId, actor)} ${m.label}`}
              activeFilters={(range !== 'open' ? 1 : 0) + (status ? 1 : 0) + (division ? 1 : 0)}
              onClearFilters={() => (setRange('open'), setStatus(''), setDivision(''))}
              summary={P.milestones(rows.length)}
              filters={
                <>
                  <SelectMenu<Range> label={P.range} value={range} options={RANGES.map((r) => ({ value: r, label: P.ranges[r] }))} onChange={setRange} />
                  <SelectMenu label={P.statusFilter} value={status} options={[{ value: '', label: P.allStatuses }, ...activeMasterValues('milestoneStatus').map((v) => ({ value: v.key, label: v.label }))]} onChange={setStatus} />
                  <SelectMenu label={P.divisionFilter} value={division} options={[{ value: '', label: P.allDivisions }, ...activeMasterValues('division').map((v) => ({ value: v.key, label: v.label }))]} onChange={setDivision} />
                </>
              }
              empty={all.length ? undefined : { icon: 'check', title: P.empty, body: P.emptyBody }}
              emptyText={range === 'overdue' ? P.emptyOverdue : P.emptyFiltered}
              columns={[
                { key: 'dueDate', label: FM.dueDate, className: 'nowrap', sort: (m) => String(m.dueDate), render: (m) => <DateText value={String(m.dueDate)} /> },
                { key: 'customer', label: FM.customerId, sort: (m) => customerNameOf(m.customerId), render: (m) => <span className="orders-clamp" data-tooltip={customerNameOf(m.customerId)}>{customerNameOf(m.customerId)}</span> },
                {
                  key: 'order',
                  label: FM.salesOrderId,
                  className: 'nowrap',
                  render: (m) => (
                    <Link className="rel-link" to={recordPeekPath(actor.workspaceId, 'salesOrders', String(m.salesOrderId))}>
                      {recordTitle('salesOrders', m.salesOrderId, actor)}
                    </Link>
                  ),
                },
                {
                  key: 'label',
                  label: FM.label,
                  render: (m) => (
                    <Link className="rel-link" to={recordPagePath(actor.workspaceId, 'paymentMilestones', m.id)}>
                      {String(m.label)}
                    </Link>
                  ),
                },
                { key: 'amount', label: FM.amount, num: true, sort: (m) => Number(m.amount), render: (m) => formatMoney(Number(m.amount)) },
                { key: 'outstanding', label: FM.outstanding, num: true, sort: (m) => outstandingOf(m), render: (m) => formatMoney(outstandingOf(m)) },
                {
                  key: 'status',
                  label: FM.status,
                  className: 'nowrap',
                  sort: (m) => statusOf(m, today),
                  render: (m) => {
                    const st = masterValue('milestoneStatus', statusOf(m, today));
                    return st ? <StatusChip label={st.label} tone={st.tone} /> : null;
                  },
                },
                { key: 'owner', label: FM.ownerId, sort: (m) => recordTitle('employees', m.ownerId, actor), render: (m) => <span className="orders-clamp">{recordTitle('employees', m.ownerId, actor)}</span> },
                {
                  key: 'act',
                  label: O.table.actions,
                  className: 'nowrap',
                  render: (m) =>
                    can(actor, 'orders.receipts') && m.status !== 'received' ? (
                      <Button size="compact" onClick={() => setReceipt(m.id)}>
                        {O.actions.recordReceipt}
                      </Button>
                    ) : null,
                },
              ]}
            />
          </div>
        </>
      )}
      {receipt && <ReceiptDialog milestone={(data.data ?? []).find((m) => m.id === receipt)!} onClose={() => setReceipt(null)} />}
    </div>
  );
}
