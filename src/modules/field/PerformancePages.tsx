import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { addDays, formatDate, startOfWeek, todayKey } from '../../lib/dates';
import { cx, formatMoney } from '../../lib/format';
import { errorMessage } from '../../services/api/client';
import { fieldApi } from '../../services/api/field';
import { can, perm } from '../../services/authz';
import { downloadText } from '../../services/exporter';
import { periodLabel, periodRange, periodStartFor } from '../../services/field/rules';
import { useActor } from '../../services/hooks';
import { masterLabel } from '../../services/registry';
import { Button, IconButton } from '../../components/primitives/Button';
import { Badge, EmptyState, ErrorState, NoAccess, Skeleton, useToast } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';
import { InfoTip } from '../../components/primitives/InfoTip';
import { Meter, metricValue, Stat } from './common';

// ---------------------------------------------------------------- Payroll export (ATT-08)

export function PayrollExportPage() {
  const actor = useActor();
  const toast = useToast();
  const q = useServiceQuery(() => fieldApi.approvedClaims(actor), [actor.user.id]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  if (!can(actor, 'expense.export')) return <NoAccess what="the payroll export" />;
  const rows = q.data ?? [];
  const chosen = rows.filter((r) => selected.has(r.id));
  const total = chosen.reduce((s, r) => s + Number(r.amount), 0);
  return (
    <div className="page">
      <PageHeader title="Payroll export" description="Approved expense claims ready for payroll. Exporting downloads a CSV and marks the claims “Exported to payroll” (logged in the audit trail)." />
      <div className="toolbar">
        <span className="toolbar-count muted">
          {selected.size} selected · {formatMoney(total)}
        </span>
        <span className="spacer" />
        <Button
          variant="primary"
          icon="download"
          loading={busy}
          disabledReason={!selected.size ? 'Select approved claims first' : undefined}
          onClick={async () => {
            setBusy(true);
            try {
              const csv = await fieldApi.exportClaims(actor, [...selected]);
              downloadText(`payroll-expenses-${todayKey()}.csv`, csv);
              toast(`${selected.size} claim(s) exported to payroll`);
              setSelected(new Set());
            } catch (e) {
              toast(errorMessage(e), 'danger');
            } finally {
              setBusy(false);
            }
          }}
        >
          Export to payroll
        </Button>
      </div>
      <div className="content-surface">
        {q.error ? (
          <ErrorState title="Could not load approved claims" onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={6} />
        ) : rows.length ? (
          <div className="table-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">
                    <input type="checkbox" aria-label="Select all" checked={selected.size === rows.length} onChange={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))} />
                  </th>
                  <th scope="col">Claim</th>
                  <th scope="col">Date</th>
                  <th scope="col">Employee</th>
                  <th scope="col">Type</th>
                  <th scope="col">Km</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.id}`}
                        checked={selected.has(r.id)}
                        onChange={() => {
                          const n = new Set(selected);
                          if (n.has(r.id)) n.delete(r.id);
                          else n.add(r.id);
                          setSelected(n);
                        }}
                      />
                    </td>
                    <td>
                      <Link to={`/expenseClaims?peek=${r.id}`}>{r.id}</Link>
                      <div className="muted small">{String(r.description)}</div>
                    </td>
                    <td className="nowrap">{formatDate(String(r.claimDate))}</td>
                    <td>{String(r.employeeName ?? '')}</td>
                    <td>{masterLabel('expenseType', r.expenseType)}</td>
                    <td>{r.km ? String(r.km) : ''}</td>
                    <td className="num">{formatMoney(Number(r.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="receipt" title="Nothing to export">
            Claims appear here after the manager and Accounts approve them.
          </EmptyState>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Achievement (TGT-02, TGT-05)

const PERIODS = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Financial year' },
];

function shiftPeriod(type: string, start: string, n: number) {
  const months = type === 'year' ? 12 : type === 'quarter' ? 3 : 1;
  const [y, m] = start.split('-').map(Number);
  const t = y * 12 + (m - 1) + n * months;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
}

export function AchievementPage() {
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const type = params.get('period') ?? 'quarter';
  const start = periodStartFor(type, params.get('start') ?? todayKey());
  const [open, setOpen] = useState<string | null>(null);
  const q = useServiceQuery(() => fieldApi.achievement(actor, type, start), [actor.user.id, type, start]);
  if (perm(actor, 'targets').read === 'none') return <NoAccess what="targets" />;
  const rows = q.data ?? [];
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.pct, 0) / rows.length) : 0;
  const { to } = periodRange(type, start);
  const elapsed = Math.min(100, Math.max(0, Math.round(((Date.parse(todayKey()) - Date.parse(start)) / (Date.parse(to) - Date.parse(start))) * 100)));
  return (
    <div className="page">
      <PageHeader title="Target achievement" description="Target vs actual, calculated automatically: order value and quantity from confirmed sales orders (by order date), collections from payments received, new customers from first orders, activities from the activity log." />
      <div className="toolbar">
        <SelectMenu label="Period type" value={type} options={PERIODS} onChange={(v) => setParams({ period: v, start: periodStartFor(v, todayKey()) })} />
        <IconButton icon="chevron-left" label="Previous period" onClick={() => setParams({ period: type, start: shiftPeriod(type, start, -1) })} />
        <strong>{periodLabel(type, start)}</strong>
        <IconButton icon="chevron-right" label="Next period" onClick={() => setParams({ period: type, start: shiftPeriod(type, start, 1) })} />
        <span className="spacer" />
        <Button icon="download" disabledReason={!rows.length ? 'No targets to export' : !perm(actor, 'targets').export ? 'Your role cannot export targets' : undefined} onClick={() => downloadText(`target-achievement-${start}.csv`, fieldApi.achievementCsv(rows))}>
          Export for incentives
        </Button>
      </div>
      {q.error ? (
        <ErrorState title="Could not calculate achievement" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <section className="stats" aria-label="Summary">
            <Stat label="Targets" value={rows.length} />
            <Stat label="Average achievement" value={`${avg}%`} sub={`${elapsed}% of the period elapsed`} />
            <Stat label="Achieved (≥ 100%)" value={rows.filter((r) => r.pct >= 100).length} />
            <Stat label="Behind pace" value={rows.filter((r) => r.pct < elapsed).length} sub="Below the share of the period elapsed" />
          </section>
          <div className="content-surface">
            {rows.length ? (
              <div className="table-scroll">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th scope="col">Target</th>
                      <th scope="col">Metric</th>
                      <th scope="col">Target</th>
                      <th scope="col">Actual</th>
                      <th scope="col">Achievement</th>
                      <th scope="col">
                        <span className="sr-only">Drill-down</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <Fragment key={r.target.id}>
                        <tr>
                          <td>
                            <Link to={`/targets?peek=${r.target.id}`}>{String(r.target.name)}</Link>
                          </td>
                          <td>{masterLabel('targetMetric', r.target.metric)}</td>
                          <td className="num">{metricValue(r.target.metric, Number(r.target.targetValue))}</td>
                          <td className="num">{metricValue(r.target.metric, r.actual)}</td>
                          <td>
                            <Meter pct={r.pct} label={`${String(r.target.name)} achievement`} />
                          </td>
                          <td>{r.members.length > 0 && <Button variant="ghost" onClick={() => setOpen(open === r.target.id ? null : r.target.id)} aria-expanded={open === r.target.id}>{open === r.target.id ? 'Hide people' : `${r.members.length} ${r.members.length === 1 ? "person" : "people"}`}</Button>}</td>
                        </tr>
                        {open === r.target.id && (
                          <tr>
                            <td colSpan={6}>
                              <ul className="change-list">
                                {r.members.map((m) => (
                                  <li key={m.employee.id}>
                                    {String(m.employee.fullName)}: <strong>{metricValue(r.target.metric, m.actual)}</strong>
                                    {Number(r.target.targetValue) > 0 && <span className="muted"> · {Math.round((m.actual / Number(r.target.targetValue)) * 100)}% of the {String(r.target.scopeType)} target</span>}
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="activity" title="No targets for this period" action={perm(actor, 'targets').create ? <Link className="btn btn-primary" to="/targets"><span className="btn-label">Set targets</span></Link> : undefined}>
                Targets set for {periodLabel(type, start)} appear here with their achievement.
              </EmptyState>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Weekly scorecard (TGT-03)

export function ScorecardPage() {
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const week = startOfWeek(params.get('week') ?? todayKey());
  const q = useServiceQuery(() => fieldApi.scorecard(actor, week), [actor.user.id, week]);
  const rows = q.data ?? [];
  const max = Math.max(1, ...rows.map((r) => r.total));
  const cols: [keyof (typeof rows)[number], string][] = [
    ['calls', 'Calls'],
    ['visits', 'Visits'],
    ['demos', 'Demos'],
    ['quotations', 'Quotations'],
    ['referrals', 'Referrals'],
  ];
  return (
    <div className="page">
      <PageHeader title="Weekly scorecard" description="Calls, visits, demos, quotations and referrals per person for the week (Monday–Sunday), generated from CRM data — no manual reporting." />
      <div className="toolbar">
        <IconButton icon="chevron-left" label="Previous week" onClick={() => setParams({ week: addDays(week, -7) })} />
        <strong>Week of {formatDate(week)}</strong>
        <IconButton icon="chevron-right" label="Next week" onClick={() => setParams({ week: addDays(week, 7) })} disabledReason={addDays(week, 7) > todayKey() ? 'Future week' : undefined} />
      </div>
      <div className="content-surface">
        {q.error ? (
          <ErrorState title="Could not build the scorecard" onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={8} />
        ) : rows.length ? (
          <div className="table-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                  {cols.map(([, l]) => (
                    <th key={l} scope="col" className="num">
                      {l}
                    </th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employee.id} className={cx(r.employee.id === actor.staffId && 'is-selected')}>
                    <td>{String(r.employee.fullName)}</td>
                    <td>{masterLabel('role', r.employee.roleId)}</td>
                    {cols.map(([k, l]) => (
                      <td key={l} className="num">
                        {r[k] as number}
                      </td>
                    ))}
                    <td>
                      <Meter pct={Math.round((r.total / max) * 100)} label={`${String(r.employee.fullName)} activity`} />
                      <span className="sr-only">{r.total} activities</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="check-square" title="No one to score">
            The scorecard covers you and the people in your scope.
          </EmptyState>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Leaderboard (TGT-04)

export function LeaderboardPage() {
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const month = periodStartFor('month', params.get('month') ?? todayKey());
  const division = params.get('division');
  const q = useServiceQuery(() => fieldApi.leaderboard(actor, division, month), [actor.user.id, division, month]);
  const d = q.data;
  return (
    <div className="page">
      <PageHeader title="Leaderboard" description="Monthly ranking within the division by booked order value, with target achievement, Deal of the Month and recognition badges." />
      <div className="toolbar">
        {d && d.divisions.length > 1 && <SelectMenu label="Division" value={d.division} options={d.divisions.map((x) => ({ value: x, label: masterLabel('division', x) }))} onChange={(v) => setParams({ division: v, month })} />}
        <IconButton icon="chevron-left" label="Previous month" onClick={() => setParams({ ...(division ? { division } : {}), month: shiftPeriod('month', month, -1) })} />
        <strong>{periodLabel('month', month)}</strong>
        <IconButton icon="chevron-right" label="Next month" onClick={() => setParams({ ...(division ? { division } : {}), month: shiftPeriod('month', month, 1) })} disabledReason={shiftPeriod('month', month, 1) > todayKey() ? 'Future month' : undefined} />
      </div>
      {q.error ? (
        <ErrorState title="Could not load the leaderboard" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !d ? (
        <Skeleton rows={8} />
      ) : (
        <div className="dash-grid">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title dialog-title-row">
                Deal of the Month
                <InfoTip text="Largest confirmed sales order in the division this month." label="About Deal of the Month" />
              </h2>
            </div>
            {d.dealOfTheMonth ? (
              <div className="stat">
                <span className="stat-label">{d.dealOfTheMonth.customer}</span>
                <span className="stat-value">{formatMoney(d.dealOfTheMonth.value)}</span>
                <span className="stat-sub">
                  <Link to={`/salesOrders?peek=${d.dealOfTheMonth.orderId}`}>{d.dealOfTheMonth.orderNo}</Link> · {String(d.dealOfTheMonth.owner?.fullName ?? '')}
                </span>
              </div>
            ) : (
              <EmptyState icon="star" title="No confirmed orders yet this month" />
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">{masterLabel('division', d.division)} ranking</h2>
            </div>
            {d.ranking.length ? (
              <ol className="flow-list">
                {d.ranking.map((r, i) => (
                  <li key={r.employee.id} className={cx('flow-item', r.employee.id === actor.staffId && 'is-selected')}>
                    <span className={`tag tone-${i === 0 ? 'accent' : i < 3 ? 'info' : 'neutral'}`}>#{i + 1}</span>
                    <span className="flow-main">
                      <span className="flow-title">{String(r.employee.fullName)}</span>
                      <span className="muted small">
                        {formatMoney(r.orderValue)} · {r.orders} order(s){r.targetPct !== null ? ` · ${r.targetPct}% of target` : ''}
                      </span>
                    </span>
                    {r.badges.map((b) => (
                      <Badge key={b} tone={b === 'Top performer' || b === 'Target achieved' ? 'success' : 'accent'}>
                        {b}
                      </Badge>
                    ))}
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState icon="users" title="No sales people in this division" />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
