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
import { LostDialog, RenewDialog } from './components';

const BUCKETS: { id: RenewalBucket; label: string }[] = [
  { id: 'due', label: 'Due for renewal' },
  { id: 'upcoming', label: 'Coming up' },
  { id: 'lapsed', label: 'Lapsed' },
  { id: 'renewed', label: 'Renewed' },
  { id: 'lost', label: 'Lost' },
];
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

/** IB-05 renewal pipeline: due / coming up / lapsed / renewed / lost, with renew and lost actions. */
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

  if (!canReadResource(actor, 'amcContracts')) return <NoAccess what="AMC / CMC renewals" />;

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
        title="Renewals"
        description={`AMC / CMC renewal pipeline. Reminders go to sales and service owners ${days.join(' / ')} days before expiry; contracts move to “Due for renewal” and a renewal opportunity is created automatically.`}
      />
      {q.error ? (
        <ErrorState title="Could not load renewals" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <section className="stats" aria-label="Renewal figures">
            {days.map((d) => (
              <Stat key={d} label={`Expiring ≤ ${d} days`} value={open.filter((r) => r.daysLeft <= d).length} sub={formatMoney(open.filter((r) => r.daysLeft <= d).reduce((s, r) => s + Number(r.contract.value), 0))} />
            ))}
            <Stat label="Renewal rate (decided)" value={closedRate} sub={`${count('renewed')} renewed · ${count('lost')} lost · ${count('lapsed')} lapsed`} />
          </section>
          <Tabs<RenewalBucket>
            label="Renewal stages"
            value={tab}
            onChange={(t) => {
              setTab(t);
              setPage(0);
            }}
            tabs={BUCKETS.map((b) => ({ ...b, count: count(b.id) }))}
          />
          <div className="toolbar">
            <input type="search" className="input input-compact" placeholder="Search contract, customer or serial" aria-label="Search renewals" value={search} onChange={(e) => (setSearch(e.target.value), setPage(0))} />
            <SelectMenu label="Filter by division" value={division} options={[{ value: '', label: 'All divisions' }, ...activeMasterValues('division').map((v) => ({ value: v.key, label: v.label }))]} onChange={(v) => (setDivision(v), setPage(0))} />
            <span className="spacer" />
            <Link className="link small" to={resourcePath('tc', 'amcContracts', { view: 'v_amc_all' })}>
              All contracts
            </Link>
          </div>
          <div className="content-surface">
            {rows.length === 0 ? (
              <EmptyState icon="reset" title={search || division ? 'No matching contracts' : 'Nothing in this stage'}>
                {tab === 'due' ? 'Contracts enter this list automatically when they reach the reminder window.' : 'Try another stage or clear the filters.'}
              </EmptyState>
            ) : (
              <>
                <div className="table-scroll">
                  <table className="mini-table">
                    <thead>
                      <tr>
                        <th scope="col">Contract</th>
                        <th scope="col">{sortBtn('customer', 'Customer')}</th>
                        <th scope="col">Machine</th>
                        <th scope="col">Type</th>
                        <th scope="col">{sortBtn('endDate', 'Ends')}</th>
                        <th scope="col" className="th-num">
                          {sortBtn('value', 'Value')}
                        </th>
                        <th scope="col">Owner</th>
                        <th scope="col">Status</th>
                        <th scope="col">Actions</th>
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
                              <div className={`small ${daysLeft < 0 ? 'text-danger' : daysLeft <= 30 ? 'text-danger' : 'muted'}`}>{daysLeft < 0 ? `${-daysLeft} days ago` : `${daysLeft} days left`}</div>
                            </td>
                            <td className="td-num">{formatMoney(Number(c.value))}</td>
                            <td>{recordTitle('employees', c.ownerId, actor)}</td>
                            <td>{st && <StatusChip label={st.label} tone={st.tone} />}</td>
                            <td className="nowrap">
                              {actionable && canAct ? (
                                <>
                                  <Button size="compact" onClick={() => setRenewing(c)}>
                                    Renew
                                  </Button>{' '}
                                  <Button size="compact" variant="ghost" onClick={() => setLosing(c)}>
                                    Lost
                                  </Button>
                                </>
                              ) : (
                                <Link className="link small" to={recordPeekPath('tc', 'amcContracts', c.id)}>
                                  Open
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
                    <strong>
                      {current * PAGE + 1}–{Math.min(rows.length, (current + 1) * PAGE)}
                    </strong>{' '}
                    of {rows.length} contracts
                  </span>
                  <nav className="grid-pages" aria-label="Pagination">
                    <IconButton icon="chevron-left" label="Previous page" disabledReason={current === 0 ? 'First page' : undefined} onClick={() => setPage(current - 1)} />
                    <span className="muted small">
                      Page {current + 1} of {pageCount}
                    </span>
                    <IconButton icon="chevron-right" label="Next page" disabledReason={current >= pageCount - 1 ? 'Last page' : undefined} onClick={() => setPage(current + 1)} />
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
