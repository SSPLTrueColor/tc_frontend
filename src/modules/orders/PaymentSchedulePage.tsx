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
import { EmptyState, ErrorState, NoAccess, Skeleton, StatusChip, useToast } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { Icon } from '../../components/primitives/Icon';
import { PageHeader } from '../../components/shell/PageHeader';
import { KpiStrip, SortTh, TableCard, TableFooter } from '../../components/resource/ListCard';
import { ReceiptDialog } from './OrderTabs';

const O = L.orders;
const P = O.pages.paymentSchedule;
const FM = O.fields.paymentMilestones;

type Range = 'overdue' | 'week' | 'month' | 'open' | 'received' | 'all';
type SortKey = 'dueDate' | 'outstanding' | 'customer';
const RANGES: Range[] = ['open', 'overdue', 'week', 'month', 'received', 'all'];
/** Saved views of the paymentMilestones resource (sidebar links) open the matching range here. */
const VIEW_RANGE: Record<string, Range> = { v_pm_open: 'open', v_pm_overdue: 'overdue', v_pm_all: 'all' };
const PAGE = 25;

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
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [division, setDivision] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'dueDate', dir: 1 });
  const [page, setPage] = useState(0);
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
    setPage(0);
  };

  const rows = useMemo(() => {
    const all = data.data ?? [];
    const needle = q.trim().toLowerCase();
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
        (!division || m.divisionId === division) &&
        (!needle || `${customerNameOf(m.customerId)} ${recordTitle('salesOrders', m.salesOrderId, actor)} ${m.label}`.toLowerCase().includes(needle)),
    );
    const val = (m: RecordData): string | number => (sort.key === 'outstanding' ? outstandingOf(m) : sort.key === 'customer' ? customerNameOf(m.customerId) : String(m.dueDate));
    return [...list].sort((a, b) => (val(a) < val(b) ? -sort.dir : val(a) > val(b) ? sort.dir : 0));
  }, [data.data, range, q, status, division, sort, today]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed) return <NoAccess what={P.noAccess} />;

  const all = data.data ?? [];
  const open = all.filter((m) => m.status !== 'received');
  const sum = (list: RecordData[]) => list.reduce((t, m) => t + outstandingOf(m), 0);
  const overdue = open.filter((m) => String(m.dueDate) < today);
  const week = open.filter((m) => String(m.dueDate) >= today && String(m.dueDate) <= addDays(today, 7));
  const received = all.filter((m) => Number(m.receivedAmount) > 0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * PAGE, current * PAGE + PAGE);
  const filtered = !!(q || status || division);
  const sortTh = (key: SortKey, label: string, num?: boolean) => (
    <SortTh label={label} num={num} active={sort.key === key} dir={sort.dir} onSort={() => setSort((x) => ({ key, dir: x.key === key ? (x.dir === 1 ? -1 : 1) : 1 }))} />
  );
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
          <TableCard
            title={P.tableTitle}
            tools={
              <>
<div className="search-field">
              <span className="search-icon" aria-hidden="true">
                <Icon name="search" size={14} />
              </span>
              <input type="search" className="input input-compact" placeholder={P.search} aria-label={P.searchAria} value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} />
            </div>
            <SelectMenu<Range> label={P.range} value={range} options={RANGES.map((r) => ({ value: r, label: P.ranges[r] }))} onChange={setRange} />
            <SelectMenu label={P.statusFilter} value={status} options={[{ value: '', label: P.allStatuses }, ...activeMasterValues('milestoneStatus').map((v) => ({ value: v.key, label: v.label }))]} onChange={(v) => (setStatus(v), setPage(0))} />
            <SelectMenu label={P.divisionFilter} value={division} options={[{ value: '', label: P.allDivisions }, ...activeMasterValues('division').map((v) => ({ value: v.key, label: v.label }))]} onChange={(v) => (setDivision(v), setPage(0))} />
              </>
            }
          >
            {rows.length ? (
              <>
                <div className="rp-scroll">
                  <table className="rp-table">
                    <thead>
                      <tr>
                        {sortTh('dueDate', FM.dueDate)}
                        {sortTh('customer', FM.customerId)}
                        <th scope="col">{FM.salesOrderId}</th>
                        <th scope="col">{FM.label}</th>
                        <th scope="col" className="num">
                          {FM.amount}
                        </th>
                        {sortTh('outstanding', FM.outstanding, true)}
                        <th scope="col">{FM.status}</th>
                        <th scope="col">{FM.ownerId}</th>
                        <th scope="col">
                          <span className="sr-only">{O.table.actions}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((m) => {
                        const st = masterValue('milestoneStatus', statusOf(m, today));
                        return (
                          <tr key={m.id}>
                            <td className="nowrap">
                              <DateText value={String(m.dueDate)} />
                            </td>
                            <td className="orders-clamp" data-tooltip={customerNameOf(m.customerId)}>{customerNameOf(m.customerId)}</td>
                            <td className="nowrap">
                              <Link className="rel-link" to={recordPeekPath(actor.workspaceId, 'salesOrders', String(m.salesOrderId))}>
                                {recordTitle('salesOrders', m.salesOrderId, actor)}
                              </Link>
                            </td>
                            <td className="orders-clamp">
                              <Link className="rel-link" to={recordPagePath(actor.workspaceId, 'paymentMilestones', m.id)}>
                                {String(m.label)}
                              </Link>
                            </td>
                            <td className="num">{formatMoney(Number(m.amount))}</td>
                            <td className="num">{formatMoney(outstandingOf(m))}</td>
                            <td className="nowrap">{st && <StatusChip label={st.label} tone={st.tone} />}</td>
                            <td className="orders-clamp" data-tooltip={recordTitle('employees', m.ownerId, actor)}>{recordTitle('employees', m.ownerId, actor)}</td>
                            <td className="nowrap">
                              {can(actor, 'orders.receipts') && m.status !== 'received' && (
                                <Button size="compact" onClick={() => setReceipt(m.id)}>
                                  {O.actions.recordReceipt}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <TableFooter range={P.range_(current * PAGE + 1, Math.min(rows.length, (current + 1) * PAGE), rows.length)} page={current} pageCount={pageCount} onPage={setPage} labels={{ nav: O.pager.nav, prev: O.pager.prev, next: O.pager.next, first: O.pager.first, last: O.pager.last, page: O.pager.page }} />
              </>
            ) : (
              <EmptyState icon="check" title={filtered ? P.emptyFiltered : range === 'overdue' ? P.emptyOverdue : P.empty}>
                {P.emptyBody}
              </EmptyState>
            )}
          </TableCard>
        </>
      )}
      {receipt && <ReceiptDialog milestone={(data.data ?? []).find((m) => m.id === receipt)!} onClose={() => setReceipt(null)} />}
    </div>
  );
}
