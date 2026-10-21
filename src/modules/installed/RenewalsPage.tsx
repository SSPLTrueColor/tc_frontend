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
import { Button } from '../../components/primitives/Button';
import { DateText } from '../../components/primitives/display';
import { NoAccess, StatusChip, Tabs } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { ListPage } from '../../components/shell/ListPage';
import { DataTable, type Column } from '../../components/primitives/DataTable';
import { L } from '../../constants/labels';
import { LostDialog, RenewDialog } from './components';
import { KpiStrip } from '../../components/resource/ListCard';

const P = L.installed.pages.renewalPipeline;
const C = L.installed.columns;
const A = L.installed.actions;
const BUCKETS: { id: RenewalBucket; label: string }[] = (['due', 'upcoming', 'lapsed', 'renewed', 'lost'] as const).map((id) => ({ id, label: P.buckets[id] }));

/** Renewals (IB-05 renewal pipeline): due / coming up / lapsed / renewed / lost, with renew and lost actions. */
export function RenewalsPage() {
  const actor = useActor();
  const q = useServiceQuery(() => loadRenewals(actor), [actor.user.id]);
  const [tab, setTab] = useState<RenewalBucket>('due');
  const [division, setDivision] = useState('');
  const [renewing, setRenewing] = useState<RecordData | null>(null);
  const [losing, setLosing] = useState<RecordData | null>(null);

  const rows = useMemo(() => (q.data ?? []).filter((r) => r.bucket === tab && (!division || r.contract.divisionId === division)), [q.data, tab, division]);

  if (!canReadResource(actor, 'amcContracts')) return <NoAccess what={P.noAccess} />;

  const all = q.data ?? [];
  const count = (b: RenewalBucket) => all.filter((r) => r.bucket === b).length;
  const open = all.filter((r) => r.bucket === 'due' || r.bucket === 'upcoming');
  const days = [...getPolicies().renewalReminderDays].sort((a, b) => a - b);
  const closedRate = (() => {
    const renewed = count('renewed');
    const decided = renewed + count('lost') + count('lapsed');
    return decided ? `${Math.round((renewed / decided) * 100)}%` : '—';
  })();
  const canAct = can(actor, 'amc.renew') && perm(actor, 'amcContracts').update !== 'none';
  const columns: Column<RenewalRow>[] = [
    { key: 'contract', label: C.contract, sort: ({ contract: c }) => String(c.contractNo), render: ({ contract: c }) => <Link className="rel-link" to={recordPeekPath('tc', 'amcContracts', c.id)}>{String(c.contractNo)}</Link> },
    { key: 'customer', label: C.customer, sort: ({ contract: c }) => recordTitle('customers', c.customerId, actor), render: ({ contract: c }) => recordTitle('customers', c.customerId, actor) },
    { key: 'machine', label: C.machine, render: ({ contract: c }) => recordTitle('machines', c.machineId, actor) },
    { key: 'type', label: C.contractType, render: ({ contract: c }) => masterLabel('amcType', c.contractType) },
    {
      key: 'ends',
      label: C.ends,
      className: 'nowrap',
      sort: ({ contract: c }) => String(c.endDate),
      render: ({ contract: c, daysLeft }) => (
        <>
          <DateText value={String(c.endDate)} />
          <div className={`small ${daysLeft <= 30 ? 'text-danger' : 'muted'}`}>{daysLeft < 0 ? P.daysAgo(-daysLeft) : P.daysLeft(daysLeft)}</div>
        </>
      ),
    },
    { key: 'value', label: C.value, num: true, sort: ({ contract: c }) => Number(c.value), render: ({ contract: c }) => formatMoney(Number(c.value)) },
    { key: 'owner', label: C.owner, sort: ({ contract: c }) => recordTitle('employees', c.ownerId, actor), render: ({ contract: c }) => recordTitle('employees', c.ownerId, actor) },
    {
      key: 'status',
      label: C.status,
      render: ({ contract: c }) => {
        const st = masterValue('amcStatus', c.status);
        return st ? <StatusChip label={st.label} tone={st.tone} /> : null;
      },
    },
    {
      key: 'act',
      label: C.actions,
      className: 'nowrap',
      render: ({ contract: c }) =>
        ['active', 'due_for_renewal', 'expired'].includes(String(c.status)) && canAct ? (
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
        ),
    },
  ];

  const within = (d: number) => open.filter((r) => r.daysLeft <= d);
  const stats = q.data && (
    <KpiStrip
      label={P.statsLabel}
      items={[
        ...days.map((d) => ({ key: `d${d}`, label: P.expiringWithin(d), value: within(d).length, sub: formatMoney(within(d).reduce((t, r) => t + Number(r.contract.value), 0)) })),
        { key: 'rate', label: P.renewalRate, value: closedRate, sub: P.rateSub(count('renewed'), count('lost'), count('lapsed')) },
      ]}
    />
  );
  return (
    <ListPage
      title={L.nav.pages.renewalPipeline.title}
      description={P.description(days.join(' / '))}
      kpis={
        <>
          {stats}
          <Tabs<RenewalBucket> label={P.bucketsLabel} value={tab} onChange={setTab} tabs={BUCKETS.map((b) => ({ ...b, count: q.data ? count(b.id) : undefined }))} />
        </>
      }
    >
      <DataTable exportResource="amcContracts"
        key={tab}
        label={P.tableLabel}
        rows={rows}
        rowKey={(r) => r.contract.id}
        noun={P.noun}
        loading={!q.data && !q.error}
        error={q.error}
        onRetry={q.retry}
        initialSort={{ key: 'ends', dir: 'asc' }}
        search={({ contract: c }) => `${c.contractNo} ${recordTitle('customers', c.customerId, actor)} ${recordTitle('machines', c.machineId, actor)}`}
        summary={
          <Link className="link small" to={resourcePath('tc', 'amcContracts', { view: 'v_amc_all' })}>
            {A.allContracts}
          </Link>
        }
        activeFilters={division ? 1 : 0}
        onClearFilters={() => setDivision('')}
        empty={q.data && !rows.length && !division ? { icon: 'reset', title: P.emptyStage, body: tab === 'due' ? P.emptyDue : P.emptyOther } : undefined}
        emptyText={P.noMatch}
        filters={<SelectMenu label={P.divisionFilter} value={division} options={[{ value: '', label: P.allDivisions }, ...activeMasterValues('division').map((v) => ({ value: v.key, label: v.label }))]} onChange={setDivision} />}
        columns={columns}
      />
      {renewing && <RenewDialog contract={renewing} onClose={() => setRenewing(null)} />}
      {losing && <LostDialog contract={losing} onClose={() => setLosing(null)} />}
    </ListPage>
  );
}
