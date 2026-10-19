import { Fragment, useState } from 'react';
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
import { useActor } from '../../services/hooks';
import { activeMasterValues, masterLabel } from '../../services/registry';
import { Button, IconButton } from '../../components/primitives/Button';
import { Badge, EmptyState, ErrorState, NoAccess, Skeleton, useToast } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { confirmDelete } from '../../components/primitives/overlay';
import { PageHeader } from '../../components/shell/PageHeader';
import { InfoTip } from '../../components/primitives/InfoTip';
import { Meter, metricValue, PAGE_SIZE, Pager, SearchBox, Stat } from './common';

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
  return (
    <div className="page">
      <PageHeader title={T.payrollExport.title} description={P.description} />
      <div className="toolbar">
        <span className="toolbar-count muted">
          {P.selected(selected.size, formatMoney(total))}
        </span>
        <span className="spacer" />
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
      </div>
      <div className="content-surface">
        {q.error ? (
          <ErrorState title={P.loadError} onRetry={q.retry}>
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
                    <input type="checkbox" aria-label={P.selectAll} checked={selected.size === rows.length} onChange={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))} />
                  </th>
                  <th scope="col">{P.claim}</th>
                  <th scope="col">{P.date}</th>
                  <th scope="col">{P.user}</th>
                  <th scope="col">{P.type}</th>
                  <th scope="col">{P.km}</th>
                  <th scope="col">{P.amount}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={P.selectOne(r.id)}
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
                      <Link to={recordPeekPath(actor.workspaceId, 'expenseClaims', r.id)}>{r.id}</Link>
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
          <EmptyState icon="receipt" title={P.emptyTitle}>
            {P.emptyBody}
          </EmptyState>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Target vs Actual (TGT-02, TGT-05)

function shiftPeriod(type: string, start: string, n: number) {
  const months = type === 'year' ? 12 : type === 'quarter' ? 3 : 1;
  const [y, m] = start.split('-').map(Number);
  const t = y * 12 + (m - 1) + n * months;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
}

type TvaSort = 'pct_asc' | 'pct_desc' | 'name';

export function TargetVsActualPage() {
  const P = L.targets.pages.targetVsActual;
  const actor = useActor();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const type = params.get('period') ?? 'quarter';
  const start = periodStartFor(type, params.get('start') ?? todayKey());
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [metric, setMetric] = useState('all');
  const [sort, setSort] = useState<TvaSort>('pct_asc');
  const [page, setPage] = useState(0);
  const q = useServiceQuery(() => fieldApi.achievement(actor, type, start), [actor.user.id, type, start]);
  if (perm(actor, 'targets').read === 'none') return <NoAccess what={L.targets.records.targets.many} />;
  const all = q.data ?? [];
  const needle = search.trim().toLowerCase();
  const rows = all
    .filter((r) => (!needle || String(r.target.name).toLowerCase().includes(needle)) && (metric === 'all' || r.target.metric === metric))
    .sort((a, b) => (sort === 'name' ? String(a.target.name).localeCompare(String(b.target.name)) : sort === 'pct_desc' ? b.pct - a.pct : a.pct - b.pct));
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const avg = all.length ? Math.round(all.reduce((s, r) => s + r.pct, 0) / all.length) : 0;
  const { to } = periodRange(type, start);
  const elapsed = Math.min(100, Math.max(0, Math.round(((Date.parse(todayKey()) - Date.parse(start)) / (Date.parse(to) - Date.parse(start))) * 100)));
  const periods = (['month', 'quarter', 'year'] as const).map((value) => ({ value, label: P.periods[value] }));
  const resetPage = <V,>(fn: (v: V) => void) => (v: V) => {
    fn(v);
    setPage(0);
  };
  return (
    <div className="page">
      <PageHeader title={T.targetVsActual.title} description={P.description} />
      <div className="toolbar field-toolbar">
        <SelectMenu label={P.periodType} value={type} options={periods} onChange={(v) => setParams({ period: v, start: periodStartFor(v, todayKey()) })} />
        <IconButton icon="chevron-left" label={P.previous} onClick={() => setParams({ period: type, start: shiftPeriod(type, start, -1) })} />
        <strong>{periodLabel(type, start)}</strong>
        <IconButton icon="chevron-right" label={P.next} onClick={() => setParams({ period: type, start: shiftPeriod(type, start, 1) })} />
        <span className="spacer" />
        <Button icon="download" disabledReason={!all.length ? P.noRows : !perm(actor, 'targets').export ? P.noExport : undefined} onClick={async () => {
            try {
              downloadText(P.fileName(start), await fieldApi.exportAchievement(actor, rows, periodLabel(type, start)));
            } catch (e) {
              toast(errorMessage(e), 'danger');
            }
          }}
        >
          {P.export}
        </Button>
      </div>
      {q.error ? (
        <ErrorState title={P.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <section className="stats" aria-label={P.summaryAria}>
            <Stat label={P.targets} value={all.length} />
            <Stat label={P.average} value={`${avg}%`} sub={P.elapsed(elapsed)} />
            <Stat label={P.achieved} value={all.filter((r) => r.pct >= 100).length} />
            <Stat label={P.behind} value={all.filter((r) => r.pct < elapsed).length} sub={P.behindSub} />
          </section>
          <div className="toolbar field-toolbar">
            <SearchBox value={search} onChange={resetPage(setSearch)} label={P.search} placeholder={P.searchPlaceholder} />
            <SelectMenu label={P.metricFilter} value={metric} options={[{ value: 'all', label: P.allMetrics }, ...activeMasterValues('targetMetric').map((v) => ({ value: v.key, label: v.label }))]} onChange={resetPage(setMetric)} />
            <SelectMenu
              label={P.sortLabel}
              value={sort}
              options={[
                { value: 'pct_asc', label: P.sortPctAsc },
                { value: 'pct_desc', label: P.sortPctDesc },
                { value: 'name', label: P.sortName },
              ]}
              onChange={(v) => setSort(v as TvaSort)}
            />
          </div>
          <div className="content-surface">
            {!all.length ? (
              <EmptyState
                icon="activity"
                title={P.emptyTitle}
                action={
                  perm(actor, 'targets').create ? (
                    <Link className="btn btn-primary" to={resourcePath(actor.workspaceId, 'targets')}>
                      <span className="btn-label">{P.setTargets}</span>
                    </Link>
                  ) : undefined
                }
              >
                {P.emptyBody(periodLabel(type, start))}
              </EmptyState>
            ) : !rows.length ? (
              <EmptyState icon="search" title={P.noMatchTitle}>
                {P.noMatchBody}
              </EmptyState>
            ) : (
              <div className="table-scroll">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th scope="col">{P.colTarget}</th>
                      <th scope="col">{P.colMetric}</th>
                      <th scope="col" className="num">
                        {P.colValue}
                      </th>
                      <th scope="col" className="num">
                        {P.colActual}
                      </th>
                      <th scope="col">{P.colPct}</th>
                      <th scope="col">
                        <span className="sr-only">{P.drillDown}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => (
                      <Fragment key={r.target.id}>
                        <tr>
                          <td>
                            <Link to={recordPeekPath(actor.workspaceId, 'targets', r.target.id)}>{String(r.target.name)}</Link>
                          </td>
                          <td>{masterLabel('targetMetric', r.target.metric)}</td>
                          <td className="num">{metricValue(r.target.metric, Number(r.target.targetValue))}</td>
                          <td className="num">{metricValue(r.target.metric, r.actual)}</td>
                          <td>
                            <Meter pct={r.pct} label={P.achievementAria(String(r.target.name))} />
                          </td>
                          <td>
                            {r.members.length > 0 && (
                              <Button variant="ghost" onClick={() => setOpen(open === r.target.id ? null : r.target.id)} aria-expanded={open === r.target.id}>
                                {open === r.target.id ? P.hidePeople : P.people(r.members.length)}
                              </Button>
                            )}
                          </td>
                        </tr>
                        {open === r.target.id && (
                          <tr>
                            <td colSpan={6}>
                              <ul className="change-list">
                                {r.members.map((m) => (
                                  <li key={m.employee.id}>
                                    {String(m.employee.fullName)}: <strong>{metricValue(r.target.metric, m.actual)}</strong>
                                    {Number(r.target.targetValue) > 0 && <span className="muted">{P.memberShare(Math.round((m.actual / Number(r.target.targetValue)) * 100), masterLabel('targetScope', r.target.scopeType).toLowerCase())}</span>}
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
            )}
          </div>
          <Pager page={page} total={rows.length} onPage={setPage} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Weekly Activity Scorecard (TGT-03)

export function ActivityScorecardPage() {
  const P = L.targets.pages.activityScorecard;
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const week = startOfWeek(params.get('week') ?? todayKey());
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [page, setPage] = useState(0);
  const q = useServiceQuery(() => fieldApi.scorecard(actor, week), [actor.user.id, week]);
  const all = q.data ?? [];
  if (perm(actor, 'targets').read === 'none') return <NoAccess what={T.activityScorecard.title} />;
  const needle = search.trim().toLowerCase();
  const rows = all.filter((r) => (!needle || String(r.employee.fullName).toLowerCase().includes(needle)) && (role === 'all' || r.employee.roleId === role));
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const max = Math.max(1, ...all.map((r) => r.total));
  const cols = (['calls', 'visits', 'demos', 'quotations', 'referrals'] as const).map((k) => [k, P.cols[k]] as const);
  const roles = [...new Set(all.map((r) => String(r.employee.roleId)))];
  return (
    <div className="page">
      <PageHeader title={T.activityScorecard.title} description={P.description} />
      <div className="toolbar field-toolbar">
        <IconButton icon="chevron-left" label={P.previous} onClick={() => setParams({ week: addDays(week, -7) })} />
        <strong>{L.field.common.weekOf(formatDate(week))}</strong>
        <IconButton icon="chevron-right" label={P.next} onClick={() => setParams({ week: addDays(week, 7) })} disabledReason={addDays(week, 7) > todayKey() ? P.futureWeek : undefined} />
        <span className="spacer" />
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          label={P.search}
          placeholder={P.searchPlaceholder}
        />
        <SelectMenu
          label={P.roleFilter}
          value={role}
          options={[{ value: 'all', label: P.allRoles }, ...roles.map((r) => ({ value: r, label: masterLabel('role', r) }))]}
          onChange={(v) => {
            setRole(v);
            setPage(0);
          }}
        />
      </div>
      <div className="content-surface">
        {q.error ? (
          <ErrorState title={P.loadError} onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={8} />
        ) : !all.length ? (
          <EmptyState icon="check-square" title={P.emptyTitle}>
            {P.emptyBody}
          </EmptyState>
        ) : !rows.length ? (
          <EmptyState icon="search" title={P.noMatchTitle}>
            {P.noMatchBody}
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">{P.person}</th>
                  <th scope="col">{P.role}</th>
                  {cols.map(([k, l]) => (
                    <th key={k} scope="col" className="num">
                      {l}
                    </th>
                  ))}
                  <th scope="col">{P.total}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.employee.id} className={cx(r.employee.id === actor.staffId && 'is-selected')}>
                    <td>{String(r.employee.fullName)}</td>
                    <td>{masterLabel('role', r.employee.roleId)}</td>
                    {cols.map(([k]) => (
                      <td key={k} className="num">
                        {r[k]}
                      </td>
                    ))}
                    <td>
                      <Meter pct={Math.round((r.total / max) * 100)} label={P.activityAria(String(r.employee.fullName))} />
                      <span className="sr-only">{P.activities(r.total)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Pager page={page} total={rows.length} onPage={setPage} />
    </div>
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
