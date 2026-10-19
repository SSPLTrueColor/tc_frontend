import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RecordData } from '../../metadata/types';
import { formatMoney } from '../../lib/format';
import { recordPeekPath, resourcePath } from '../../lib/routes';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { loadRenewals, type RenewalBucket, type RenewalRow } from '../../services/api/installed';
import { can, canReadResource, perm } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { activeMasterValues, masterLabel, masterValue } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { getPolicies } from '../../services/policies';
import { Button, IconButton } from '../../components/primitives/Button';
import { DateText } from '../../components/primitives/display';
import { EmptyState, ErrorState, NoAccess, Skeleton, StatusChip, Tabs } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';
import { L } from '../../constants/labels';
import { LostDialog, RenewDialog } from './components';

const P = L.installed.pages.renewalPipeline;
const C = L.installed.columns;
const A = L.installed.actions;
const BUCKETS: { id: RenewalBucket; label: string }[] = (['due', 'upcoming', 'lapsed', 'renewed', 'lost'] as const).map((id) => ({ id, label: P.buckets[id] }));
const PAGE = 25;
type SortKey = 'endDate' | 'value' | 'customer';

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

/** Renewals (IB-05 renewal pipeline): due / coming up / lapsed / renewed / lost, with renew and lost actions. */
export function RenewalsPage() {
  const actor = useActor();
  const q = useServiceQuery(() => loadRenewals(actor), [actor.user.id]);
  const [tab, setTab] = useState<RenewalBucket>('due');
  const [search, setSearch] = useState('');
  const [division, setDivision] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'endDate', dir: 1 });
  const [page, setPage] = useState(0);
  const [renewing, setRenewing] = useState<RecordData | null>(null);
  const [losing, setLosing] = useState<RecordData | null>(null);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (q.data ?? [])
      .filter((r) => r.bucket === tab && (!division || r.contract.divisionId === division))
      .filter((r) => !needle || `${r.contract.contractNo} ${recordTitle('customers', r.contract.customerId, actor)} ${recordTitle('machines', r.contract.machineId, actor)}`.toLowerCase().includes(needle));
    const val = (r: RenewalRow) => (sort.key === 'value' ? Number(r.contract.value) : sort.key === 'customer' ? recordTitle('customers', r.contract.customerId, actor) : String(r.contract.endDate));
    return [...list].sort((a, b) => (val(a) < val(b) ? -sort.dir : val(a) > val(b) ? sort.dir : 0));
  }, [q.data, tab, search, division, sort, actor]);

  if (!canReadResource(actor, 'amcContracts')) return <NoAccess what={P.noAccess} />;

  const all = q.data ?? [];
  const count = (b: RenewalBucket) => all.filter((r) => r.bucket === b).length;
  const open = all.filter((r) => r.bucket === 'due' || r.bucket === 'upcoming');
  const days = [...getPolicies().renewalReminderDays].sort((a, b) => a - b);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * PAGE, current * PAGE + PAGE);
  const closedRate = (() => {
    const renewed = count('renewed');
    const decided = renewed + count('lost') + count('lapsed');
    return decided ? `${Math.round((renewed / decided) * 100)}%` : '—';
  })();
  const canAct = can(actor, 'amc.renew') && perm(actor, 'amcContracts').update !== 'none';
  const sortBtn = (key: SortKey, label: string) => (
    <button type="button" className="th-btn" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <span className="th-label">{label}</span>
      <span aria-hidden="true">{sort.key === key ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span>
    </button>
  );

  return (
    <div className="page">
      <PageHeader
        title={L.nav.pages.renewalPipeline.title}
        description={P.description(days.join(' / '))}
      />
      {q.error ? (
        <ErrorState title={P.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <section className="stats" aria-label={P.statsLabel}>
            {days.map((d) => (
              <Stat key={d} label={P.expiringWithin(d)} value={open.filter((r) => r.daysLeft <= d).length} sub={formatMoney(open.filter((r) => r.daysLeft <= d).reduce((s, r) => s + Number(r.contract.value), 0))} />
            ))}
            <Stat label={P.renewalRate} value={closedRate} sub={P.rateSub(count('renewed'), count('lost'), count('lapsed'))} />
          </section>
          <Tabs<RenewalBucket>
            label={P.bucketsLabel}
            value={tab}
            onChange={(t) => {
              setTab(t);
              setPage(0);
            }}
            tabs={BUCKETS.map((b) => ({ ...b, count: count(b.id) }))}
          />
          <div className="toolbar">
            <input type="search" className="input input-compact" placeholder={P.search} aria-label={P.searchLabel} value={search} onChange={(e) => (setSearch(e.target.value), setPage(0))} />
            <SelectMenu label={P.divisionFilter} value={division} options={[{ value: '', label: P.allDivisions }, ...activeMasterValues('division').map((v) => ({ value: v.key, label: v.label }))]} onChange={(v) => (setDivision(v), setPage(0))} />
            <span className="spacer" />
            <Link className="link small" to={resourcePath('tc', 'amcContracts', { view: 'v_amc_all' })}>
              {A.allContracts}
            </Link>
          </div>
          <div className="content-surface">
            {rows.length === 0 ? (
              <EmptyState icon="reset" title={search || division ? P.noMatch : P.emptyStage}>
                {tab === 'due' ? P.emptyDue : P.emptyOther}
              </EmptyState>
            ) : (
              <>
                <div className="table-scroll">
                  <table className="mini-table">
                    <thead>
                      <tr>
                        <th scope="col">{C.contract}</th>
                        <th scope="col">{sortBtn('customer', C.customer)}</th>
                        <th scope="col">{C.machine}</th>
                        <th scope="col">{C.contractType}</th>
                        <th scope="col">{sortBtn('endDate', C.ends)}</th>
                        <th scope="col" className="th-num">
                          {sortBtn('value', C.value)}
                        </th>
                        <th scope="col">{C.owner}</th>
                        <th scope="col">{C.status}</th>
                        <th scope="col">{C.actions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map(({ contract: c, daysLeft }) => {
                        const st = masterValue('amcStatus', c.status);
                        const actionable = ['active', 'due_for_renewal', 'expired'].includes(String(c.status));
                        return (
                          <tr key={c.id}>
                            <td>
                              <Link className="rel-link" to={recordPeekPath('tc', 'amcContracts', c.id)}>
                                {String(c.contractNo)}
                              </Link>
                            </td>
                            <td>{recordTitle('customers', c.customerId, actor)}</td>
                            <td>{recordTitle('machines', c.machineId, actor)}</td>
                            <td>{masterLabel('amcType', c.contractType)}</td>
                            <td className="nowrap">
                              <DateText value={String(c.endDate)} />
                              <div className={`small ${daysLeft < 0 ? 'text-danger' : daysLeft <= 30 ? 'text-danger' : 'muted'}`}>{daysLeft < 0 ? P.daysAgo(-daysLeft) : P.daysLeft(daysLeft)}</div>
                            </td>
                            <td className="td-num">{formatMoney(Number(c.value))}</td>
                            <td>{recordTitle('employees', c.ownerId, actor)}</td>
                            <td>{st && <StatusChip label={st.label} tone={st.tone} />}</td>
                            <td className="nowrap">
                              {actionable && canAct ? (
                                <>
                                  <Button size="compact" onClick={() => setRenewing(c)}>
                                    {A.renew}
                                  </Button>{' '}
                                  <Button size="compact" variant="ghost" onClick={() => setLosing(c)}>
                                    {A.lost}
                                  </Button>
                                </>
                              ) : (
                                <Link className="link small" to={recordPeekPath('tc', 'amcContracts', c.id)}>
                                  {A.open}
                                </Link>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="grid-footer">
                  <span className="grid-footer-range">
                    <strong>{P.range(current * PAGE + 1, Math.min(rows.length, (current + 1) * PAGE))}</strong>
                    {P.ofTotal(rows.length)}
                  </span>
                  <nav className="grid-pages" aria-label={P.pagination}>
                    <IconButton icon="chevron-left" label={P.prev} disabledReason={current === 0 ? P.firstPage : undefined} onClick={() => setPage(current - 1)} />
                    <span className="muted small">
                      {P.pageOf(current + 1, pageCount)}
                    </span>
                    <IconButton icon="chevron-right" label={P.next} disabledReason={current >= pageCount - 1 ? P.lastPage : undefined} onClick={() => setPage(current + 1)} />
                  </nav>
                </div>
              </>
            )}
          </div>
        </>
      )}
      {renewing && <RenewDialog contract={renewing} onClose={() => setRenewing(null)} />}
      {losing && <LostDialog contract={losing} onClose={() => setLosing(null)} />}
    </div>
  );
}
