import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { addDays, todayKey } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { errorMessage } from '../../services/api/client';
import { sendPaymentReminders } from '../../services/api/orders';
import { can, canReadResource } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { masterValue } from '../../services/registry';
import { queryRecords, recordTitle } from '../../services/runtime';
import { getPolicies } from '../../services/policies';
import { Button } from '../../components/primitives/Button';
import { DateText } from '../../components/primitives/display';
import { EmptyState, ErrorState, NoAccess, Skeleton, StatusChip, useToast } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';
import { ReceiptDialog } from './OrderTabs';

type Range = 'overdue' | 'week' | 'month' | 'all';

/** FR-055 / BR-25: due and overdue payments in the actor's scope, with the reminder sweep. */
export function PaymentsDuePage() {
  const actor = useActor();
  const toast = useToast();
  const [range, setRange] = useState<Range>('overdue');
  const [q, setQ] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const today = todayKey();
  const data = useServiceQuery(() => queryRecords(actor, 'paymentMilestones', { sort: [{ field: 'dueDate', dir: 'asc' }] }).rows.filter((m) => m.status !== 'received'), [actor.user.id]);

  // Run the reminder sweep once per visit (idempotent: reminded milestones are stamped).
  useEffect(() => {
    if (!canReadResource(actor, 'paymentMilestones')) return;
    sendPaymentReminders(actor).catch(() => undefined);
  }, [actor.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const all = data.data ?? [];
    const end = range === 'week' ? addDays(today, 7) : range === 'month' ? addDays(today, 30) : '9999-12-31';
    return all.filter((m) => (range === 'overdue' ? String(m.dueDate) < today : String(m.dueDate) <= end) && (!q || `${recordTitle('customers', m.customerId, actor)} ${recordTitle('salesOrders', m.salesOrderId, actor)} ${m.label}`.toLowerCase().includes(q.toLowerCase())));
  }, [data.data, range, q, today]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canReadResource(actor, 'paymentMilestones')) return <NoAccess what="payment schedules" />;
  const all = data.data ?? [];
  const outstanding = (list: typeof all) => list.reduce((t, m) => t + Number(m.amount) - (Number(m.receivedAmount) || 0), 0);
  const overdue = all.filter((m) => String(m.dueDate) < today);
  const week = all.filter((m) => String(m.dueDate) >= today && String(m.dueDate) <= addDays(today, 7));

  return (
    <div className="page">
      <PageHeader
        title="Payments due"
        description={`Advance, milestone and balance payments you can see. Reminders go to the sales owner ${getPolicies().paymentReminderDaysBefore} days before a due date and weekly once overdue (with the manager and, if they consented, the customer).`}
        actions={
          <Button
            icon="bell"
            loading={sending}
            onClick={async () => {
              setSending(true);
              try {
                const r = await sendPaymentReminders(actor);
                toast(r.reminded ? `${r.reminded} reminder(s) sent` : 'Everyone has already been reminded', 'info');
              } catch (e) {
                toast(errorMessage(e), 'danger');
              } finally {
                setSending(false);
              }
            }}
          >
            Send reminders now
          </Button>
        }
      />
      {data.error ? (
        <ErrorState title="Could not load payments" onRetry={data.retry}>
          {data.error}
        </ErrorState>
      ) : !data.data ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <section className="stats" aria-label="Key figures">
            <button type="button" className="stat" onClick={() => setRange('overdue')}>
              <span className="stat-label">Overdue</span>
              <span className="stat-value">{formatMoney(outstanding(overdue))}</span>
              <span className="stat-sub">{overdue.length} milestone(s)</span>
            </button>
            <button type="button" className="stat" onClick={() => setRange('week')}>
              <span className="stat-label">Due in 7 days</span>
              <span className="stat-value">{formatMoney(outstanding(week))}</span>
              <span className="stat-sub">{week.length} milestone(s)</span>
            </button>
            <button type="button" className="stat" onClick={() => setRange('all')}>
              <span className="stat-label">All outstanding</span>
              <span className="stat-value">{formatMoney(outstanding(all))}</span>
              <span className="stat-sub">{all.length} milestone(s)</span>
            </button>
          </section>
          <div className="toolbar">
            <input type="search" className="input input-compact" placeholder="Search customer or order" aria-label="Search payments" value={q} onChange={(e) => setQ(e.target.value)} />
            <SelectMenu<Range>
              label="Due range"
              value={range}
              options={[
                { value: 'overdue', label: 'Overdue' },
                { value: 'week', label: 'Due in 7 days (and overdue)' },
                { value: 'month', label: 'Due in 30 days (and overdue)' },
                { value: 'all', label: 'All outstanding' },
              ]}
              onChange={setRange}
            />
            <span className="toolbar-count muted">{rows.length} milestones</span>
          </div>
          <div className="content-surface">
            {rows.length ? (
              <div className="table-scroll">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th scope="col">Due</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Order</th>
                      <th scope="col">Milestone</th>
                      <th scope="col" className="th-num">
                        Outstanding
                      </th>
                      <th scope="col">Status</th>
                      <th scope="col">Owner</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 200).map((m) => {
                      const st = masterValue('milestoneStatus', String(m.dueDate) < today ? 'overdue' : m.status);
                      return (
                        <tr key={m.id}>
                          <td className="nowrap">
                            <DateText value={String(m.dueDate)} />
                          </td>
                          <td>{recordTitle('customers', m.customerId, actor)}</td>
                          <td>
                            <Link to={`/salesOrders?peek=${encodeURIComponent(String(m.salesOrderId))}`}>{recordTitle('salesOrders', m.salesOrderId, actor)}</Link>
                          </td>
                          <td>{String(m.label)}</td>
                          <td className="num">{formatMoney(Number(m.amount) - (Number(m.receivedAmount) || 0))}</td>
                          <td>{st && <StatusChip label={st.label} tone={st.tone} />}</td>
                          <td>{recordTitle('employees', m.ownerId, actor)}</td>
                          <td>{can(actor, 'orders.receipts') && <Button onClick={() => setReceipt(m.id)}>Record receipt</Button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="check" title={range === 'overdue' ? 'Nothing overdue' : 'Nothing due in this range'}>
                Payments from your orders appear here when they fall due.
              </EmptyState>
            )}
          </div>
        </>
      )}
      {receipt && <ReceiptDialog milestone={(data.data ?? []).find((m) => m.id === receipt)!} onClose={() => setReceipt(null)} />}
    </div>
  );
}
