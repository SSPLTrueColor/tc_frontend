import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { L } from '../../constants/labels';
import { recordPeekPath, resourcePath } from '../../lib/routes';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { addDays, formatDate, startOfWeek, todayKey } from '../../lib/dates';
import { cx, formatMoney } from '../../lib/format';
import { errorMessage } from '../../services/api/client';
import { fieldApi } from '../../services/api/field';
import { can, perm } from '../../services/authz';
import { downloadText } from '../../services/exporter';
import { periodLabel, periodRange, periodStartFor } from '../../services/field/rules';
import type { AchievementRow } from '../../services/field/field';
import { useActor } from '../../services/hooks';
import { activeMasterValues, masterLabel } from '../../services/registry';
import { Button, IconButton } from '../../components/primitives/Button';
import { Badge, EmptyState, ErrorState, NoAccess, Skeleton, useToast } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { Popover, confirmDelete } from '../../components/primitives/overlay';
import { PageHeader } from '../../components/shell/PageHeader';
import { ListPage } from '../../components/shell/ListPage';
import { DataTable, type Column } from '../../components/primitives/DataTable';
import { KpiStrip } from '../../components/resource/ListCard';
import { InfoTip } from '../../components/primitives/InfoTip';
import { Meter, metricValue } from './common';
import { LinkButton } from '../../components/primitives/controls';

const T = L.nav.pages;

// ---------------------------------------------------------------- Payroll export (ATT-08)

export function PayrollExportPage() {
  const P = L.field.pages.payrollExport;
  const actor = useActor();
  const toast = useToast();
  const q = useServiceQuery(() => fieldApi.approvedClaims(actor), [actor.user.id]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  if (!can(actor, 'expense.export')) return <NoAccess what={P.noAccess} />;
  const rows = q.data ?? [];
  const chosen = rows.filter((r) => selected.has(r.id));
  const total = chosen.reduce((s, r) => s + Number(r.amount), 0);
  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'claim',
      label: P.claim,
      sort: (r) => r.id,
      render: (r) => (
        <>
          <Link to={recordPeekPath(actor.workspaceId, 'expenseClaims', r.id)}>{r.id}</Link>
          <div className="muted small">{String(r.description)}</div>
        </>
      ),
    },
    { key: 'date', label: P.date, sort: (r) => String(r.claimDate), render: (r) => <span className="nowrap">{formatDate(String(r.claimDate))}</span> },
    { key: 'user', label: P.user, sort: (r) => String(r.employeeName ?? ''), render: (r) => String(r.employeeName ?? '') },
    { key: 'type', label: P.type, sort: (r) => masterLabel('expenseType', r.expenseType), render: (r) => masterLabel('expenseType', r.expenseType) },
    { key: 'km', label: P.km, num: true, sort: (r) => Number(r.km ?? 0), render: (r) => (r.km ? String(r.km) : '') },
    { key: 'amount', label: P.amount, num: true, sort: (r) => Number(r.amount), render: (r) => formatMoney(Number(r.amount)) },
  ];
  return (
    <ListPage
      title={T.payrollExport.title}
      description={P.description}
      actions={
        <Button
          variant="primary"
          icon="download"
          loading={busy}
          disabledReason={!selected.size ? P.selectFirst : undefined}
          onClick={() =>
            confirmDelete({
              title: L.field.confirms.exportTitle,
              message: L.field.confirms.exportBody(selected.size, formatMoney(total)),
              confirmLabel: L.field.actions.exportToPayroll,
              onConfirm: async () => {
                setBusy(true);
                try {
                  const csv = await fieldApi.exportClaims(actor, [...selected]);
                  downloadText(P.fileName(todayKey()), csv);
                  toast(P.exported(selected.size));
                  setSelected(new Set());
                } catch (e) {
                  toast(errorMessage(e), 'danger');
                } finally {
                  setBusy(false);
                }
              },
            })
          }
        >
          {L.field.actions.exportToPayroll}
        </Button>
      }
    >
      <DataTable
        label={P.tableLabel}
        noun={P.noun}
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        loading={!q.data && !q.error}
        error={q.error}
        onRetry={q.retry}
        initialSort={{ key: 'date', dir: 'asc' }}
        search={(r) => `${r.id} ${String(r.description)} ${String(r.employeeName ?? '')}`}
        summary={P.selected(selected.size, formatMoney(total))}
        empty={q.data && !rows.length ? { icon: 'receipt', title: P.emptyTitle, body: P.emptyBody } : undefined}
        selection={{
          keys: selected,
          onChange: setSelected,
          selectAllLabel: P.selectAll,
          rowLabel: (r) => P.selectOne(r.id),
          actions: (
            <>
              {P.selected(selected.size, formatMoney(total))}{' '}
              <button type="button" className="link small" onClick={() => setSelected(new Set())}>
                {L.common.table.clearSelection}
              </button>
            </>
          ),
        }}
      />
    </ListPage>
  );
}

// ---------------------------------------------------------------- Target vs Actual (TGT-02, TGT-05)

function shiftPeriod(type: string, start: string, n: number) {
  const months = type === 'year' ? 12 : type === 'quarter' ? 3 : 1;
  const [y, m] = start.split('-').map(Number);
  const t = y * 12 + (m - 1) + n * months;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
}


/** "3 people" button: opens each member's contribution to a team / division target. */
function MembersPopover({ row }: { row: AchievementRow }) {
  const P = L.targets.pages.targetVsActual;
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!row.members.length) return null;
  return (
    <>
      <Button ref={ref} variant="ghost" aria-expanded={open} aria-haspopup="dialog" iconRight={open ? 'chevron-up' : 'chevron-down'} onClick={() => setOpen((o) => !o)}>
        {P.people(row.members.length)}
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label={P.drillDown} width={320} align="end">
        <ul className="change-list">
          {row.members.map((m) => (
            <li key={m.employee.id}>
              {String(m.employee.fullName)}: <strong>{metricValue(row.target.metric, m.actual)}</strong>
              {Number(row.target.targetValue) > 0 && <span className="muted">{P.memberShare(Math.round((m.actual / Number(row.target.targetValue)) * 100), masterLabel('targetScope', row.target.scopeType).toLowerCase())}</span>}
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}

export function TargetVsActualPage() {
  const P = L.targets.pages.targetVsActual;
  const actor = useActor();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const type = params.get('period') ?? 'quarter';
  const start = periodStartFor(type, params.get('start') ?? todayKey());
  const [metric, setMetric] = useState('all');
  const q = useServiceQuery(() => fieldApi.achievement(actor, type, start), [actor.user.id, type, start]);
  if (perm(actor, 'targets').read === 'none') return <NoAccess what={L.targets.records.targets.many} />;
  const all = q.data ?? [];
  const rows = all.filter((r) => metric === 'all' || r.target.metric === metric);
  const avg = all.length ? Math.round(all.reduce((s, r) => s + r.pct, 0) / all.length) : 0;
  const { to } = periodRange(type, start);
  const elapsed = Math.min(100, Math.max(0, Math.round(((Date.parse(todayKey()) - Date.parse(start)) / (Date.parse(to) - Date.parse(start))) * 100)));
  const periods = (['month', 'quarter', 'year'] as const).map((value) => ({ value, label: P.periods[value] }));
  const columns: Column<AchievementRow>[] = [
    { key: 'target', label: P.colTarget, sort: (r) => String(r.target.name), render: (r) => <Link to={recordPeekPath(actor.workspaceId, 'targets', r.target.id)}>{String(r.target.name)}</Link> },
    { key: 'metric', label: P.colMetric, sort: (r) => masterLabel('targetMetric', r.target.metric), render: (r) => masterLabel('targetMetric', r.target.metric) },
    { key: 'value', label: P.colValue, num: true, sort: (r) => Number(r.target.targetValue), render: (r) => metricValue(r.target.metric, Number(r.target.targetValue)) },
    { key: 'actual', label: P.colActual, num: true, sort: (r) => r.actual, render: (r) => metricValue(r.target.metric, r.actual) },
    { key: 'pct', label: P.colPct, sort: (r) => r.pct, render: (r) => <Meter pct={r.pct} label={P.achievementAria(String(r.target.name))} /> },
    { key: 'act', label: P.drillDown, render: (r) => <MembersPopover row={r} /> },
  ];
  return (
    <ListPage
      title={T.targetVsActual.title}
      description={P.description}
      actions={
        <Button
          icon="download"
          disabledReason={!all.length ? P.noRows : !perm(actor, 'targets').export ? P.noExport : undefined}
          onClick={async () => {
            try {
              downloadText(P.fileName(start), await fieldApi.exportAchievement(actor, rows, periodLabel(type, start)));
            } catch (e) {
              toast(errorMessage(e), 'danger');
            }
          }}
        >
          {P.export}
        </Button>
      }
      kpis={
        q.data ? (
          <KpiStrip
            label={P.summaryAria}
            items={[
              { key: 'targets', label: P.targets, value: all.length, sub: periodLabel(type, start) },
              { key: 'avg', label: P.average, value: `${avg}%`, sub: P.elapsed(elapsed) },
              { key: 'achieved', label: P.achieved, value: all.filter((r) => r.pct >= 100).length, sub: P.colPct },
              { key: 'behind', label: P.behind, value: all.filter((r) => r.pct < elapsed).length, sub: P.behindSub },
            ]}
          />
        ) : undefined
      }
    >
      <DataTable
        label={P.tableLabel}
        noun={P.noun}
        rows={rows}
        rowKey={(r) => r.target.id}
        columns={columns}
        loading={!q.data && !q.error}
        error={q.error}
        onRetry={q.retry}
        initialSort={{ key: 'pct', dir: 'asc' }}
        search={(r) => String(r.target.name)}
        activeFilters={metric === 'all' ? 0 : 1}
        onClearFilters={() => setMetric('all')}
        selectable={false}
        tools={
          <>
            <SelectMenu label={P.periodType} value={type} options={periods} onChange={(v) => setParams({ period: v, start: periodStartFor(v, todayKey()) })} />
            <IconButton icon="chevron-left" label={P.previous} onClick={() => setParams({ period: type, start: shiftPeriod(type, start, -1) })} />
            <strong>{periodLabel(type, start)}</strong>
            <IconButton icon="chevron-right" label={P.next} onClick={() => setParams({ period: type, start: shiftPeriod(type, start, 1) })} />
          </>
        }
        filters={<SelectMenu label={P.metricFilter} value={metric} options={[{ value: 'all', label: P.allMetrics }, ...activeMasterValues('targetMetric').map((v) => ({ value: v.key, label: v.label }))]} onChange={setMetric} />}
        empty={
          q.data && !all.length
            ? { icon: 'activity', title: P.emptyTitle, body: P.emptyBody(periodLabel(type, start)), action: perm(actor, 'targets').create ? <LinkButton variant="primary" to={resourcePath(actor.workspaceId, 'targets')}>{P.setTargets}</LinkButton> : undefined }
            : undefined
        }
        emptyText={P.noMatchTitle}
      />
    </ListPage>
  );
}

// ---------------------------------------------------------------- Weekly Activity Scorecard (TGT-03)

export function ActivityScorecardPage() {
  const P = L.targets.pages.activityScorecard;
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const week = startOfWeek(params.get('week') ?? todayKey());
  const [role, setRole] = useState('all');
  const q = useServiceQuery(() => fieldApi.scorecard(actor, week), [actor.user.id, week]);
  const all = q.data ?? [];
  if (perm(actor, 'targets').read === 'none') return <NoAccess what={T.activityScorecard.title} />;
  const rows = all.filter((r) => role === 'all' || r.employee.roleId === role);
  const max = Math.max(1, ...all.map((r) => r.total));
  const roles = [...new Set(all.map((r) => String(r.employee.roleId)))];
  type Row = (typeof all)[number];
  const columns: Column<Row>[] = [
    { key: 'person', label: P.person, sort: (r) => String(r.employee.fullName), render: (r) => String(r.employee.fullName) },
    { key: 'role', label: P.role, sort: (r) => masterLabel('role', r.employee.roleId), render: (r) => masterLabel('role', r.employee.roleId) },
    ...(['calls', 'visits', 'demos', 'quotations', 'referrals'] as const).map((k): Column<Row> => ({ key: k, label: P.cols[k], num: true, sort: (r) => r[k], render: (r) => r[k] })),
    {
      key: 'total',
      label: P.total,
      sort: (r) => r.total,
      render: (r) => (
        <>
          <Meter pct={Math.round((r.total / max) * 100)} label={P.activityAria(String(r.employee.fullName))} />
          <span className="sr-only">{P.activities(r.total)}</span>
        </>
      ),
    },
  ];
  return (
    <ListPage title={T.activityScorecard.title} description={P.description}>
      <DataTable
        label={P.tableLabel}
        noun={P.noun}
        rows={rows}
        rowKey={(r) => String(r.employee.id)}
        columns={columns}
        loading={!q.data && !q.error}
        error={q.error}
        onRetry={q.retry}
        initialSort={{ key: 'total', dir: 'desc' }}
        search={(r) => String(r.employee.fullName)}
        activeFilters={role === 'all' ? 0 : 1}
        onClearFilters={() => setRole('all')}
        selectable={false}
        tools={
          <>
            <IconButton icon="chevron-left" label={P.previous} onClick={() => setParams({ week: addDays(week, -7) })} />
            <strong>{L.field.common.weekOf(formatDate(week))}</strong>
            <IconButton icon="chevron-right" label={P.next} onClick={() => setParams({ week: addDays(week, 7) })} disabledReason={addDays(week, 7) > todayKey() ? P.futureWeek : undefined} />
          </>
        }
        filters={<SelectMenu label={P.roleFilter} value={role} options={[{ value: 'all', label: P.allRoles }, ...roles.map((r) => ({ value: r, label: masterLabel('role', r) }))]} onChange={setRole} />}
        empty={q.data && !all.length ? { icon: 'check-square', title: P.emptyTitle, body: P.emptyBody } : undefined}
        emptyText={P.noMatchTitle}
      />
    </ListPage>
  );
}

// ---------------------------------------------------------------- Leaderboards & Recognition (TGT-04)

export function LeaderboardsPage() {
  const P = L.targets.pages.leaderboards;
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const month = periodStartFor('month', params.get('month') ?? todayKey());
  const division = params.get('division');
  const q = useServiceQuery(() => fieldApi.leaderboard(actor, division, month), [actor.user.id, division, month]);
  const d = q.data;
  if (perm(actor, 'targets').read === 'none') return <NoAccess what={T.leaderboards.title} />;
  return (
    <div className="page">
      <PageHeader title={T.leaderboards.title} description={P.description} />
      <div className="toolbar field-toolbar">
        {d && d.divisions.length > 1 && <SelectMenu label={P.division} value={d.division} options={d.divisions.map((x) => ({ value: x, label: masterLabel('division', x) }))} onChange={(v) => setParams({ division: v, month })} />}
        <IconButton icon="chevron-left" label={P.previous} onClick={() => setParams({ ...(division ? { division } : {}), month: shiftPeriod('month', month, -1) })} />
        <strong>{periodLabel('month', month)}</strong>
        <IconButton icon="chevron-right" label={P.next} onClick={() => setParams({ ...(division ? { division } : {}), month: shiftPeriod('month', month, 1) })} disabledReason={shiftPeriod('month', month, 1) > todayKey() ? P.futureMonth : undefined} />
      </div>
      {q.error ? (
        <ErrorState title={P.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !d ? (
        <Skeleton rows={8} />
      ) : (
        <div className="dash-grid">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title dialog-title-row">
                {P.dealOfTheMonth}
                <InfoTip text={P.dealHelp} label={P.dealHelpLabel} />
              </h2>
            </div>
            {d.dealOfTheMonth ? (
              <div className="stat">
                <span className="stat-label">{d.dealOfTheMonth.customer}</span>
                <span className="stat-value">{formatMoney(d.dealOfTheMonth.value)}</span>
                <span className="stat-sub">
                  <Link to={recordPeekPath(actor.workspaceId, 'salesOrders', d.dealOfTheMonth.orderId)}>{d.dealOfTheMonth.orderNo}</Link> · {String(d.dealOfTheMonth.owner?.fullName ?? '')}
                </span>
              </div>
            ) : (
              <EmptyState icon="star" title={P.noDeal} />
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">{P.ranking(masterLabel('division', d.division))}</h2>
            </div>
            {d.ranking.length ? (
              <ol className="flow-list">
                {d.ranking.map((r, i) => (
                  <li key={r.employee.id} className={cx('flow-item', r.employee.id === actor.staffId && 'is-selected')}>
                    <span className={`tag tone-${i === 0 ? 'accent' : i < 3 ? 'info' : 'neutral'}`}>#{i + 1}</span>
                    <span className="flow-main">
                      <span className="flow-title">{String(r.employee.fullName)}</span>
                      <span className="muted small">{P.rankLine(formatMoney(r.orderValue), r.orders, r.targetPct)}</span>
                    </span>
                    {r.badges.map((b) => (
                      <Badge key={b} tone={b === 'topPerformer' || b === 'targetAchieved' ? 'success' : 'accent'}>
                        {L.targets.badges[b]}
                      </Badge>
                    ))}
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState icon="users" title={P.emptyRanking} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
