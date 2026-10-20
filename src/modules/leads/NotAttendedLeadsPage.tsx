import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { formatDateTime } from '../../lib/dates';
import { recordPeekPath } from '../../lib/routes';
import { leadsQueries } from '../../services/api/leads';
import { canUpdateRecord, perm } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { getResource, masterLabel } from '../../services/registry';
import type { NotAttendedRow } from '../../services/leads/rules';
import { Button } from '../../components/primitives/Button';
import { NoAccess } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { LogActivityDialog } from '../../components/crm/LogActivityDialog';
import { ListPage } from '../../components/shell/ListPage';
import { KpiStrip } from '../../components/resource/ListCard';
import { L } from '../../constants/labels';
import { DataTable, type Column } from '../../components/primitives/DataTable';

const T = L.leads.pages.notAttended;
type Escalation = '' | 'escalated' | 'pending';

/**
 * LEAD-08 / BR-08: "Not attended leads" dashboard. Open leads past the first-contact SLA with no
 * contact logged, scoped to what the role can see (own / team / division / all).
 */
export function NotAttendedLeadsPage() {
  const actor = useActor();
  const query = useServiceQuery(() => leadsQueries.notAttended(actor), [actor.user.id]);
  const [division, setDivision] = useState('');
  const [owner, setOwner] = useState('');
  const [escalation, setEscalation] = useState<Escalation>('');
  const [logFor, setLogFor] = useState<NotAttendedRow | null>(null);

  const all = useMemo(() => query.data?.rows ?? [], [query.data]);
  const divisions = useMemo(() => [...new Set(all.map((r) => r.divisionId).filter(Boolean))].sort(), [all]);
  const owners = useMemo(() => [...new Map(all.filter((r) => r.ownerId).map((r) => [r.ownerId as string, r.ownerName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [all]);
  const rows = useMemo(
    () =>
      all.filter(
        (r) => (!division || r.divisionId === division) && (!owner || r.ownerId === owner) && (!escalation || (escalation === 'escalated' ? !!r.escalatedAt : !r.escalatedAt)),
      ),
    [all, division, owner, escalation],
  );
  const clear = () => {
    setDivision('');
    setOwner('');
    setEscalation('');
  };

  if (perm(actor, 'leads').read === 'none') return <NoAccess what={L.leads.records.leads.many.toLowerCase()} />;
  const res = getResource('leads');
  const sla = query.data?.slaHours;

  const columns: Column<NotAttendedRow>[] = [
    {
      key: 'lead',
      label: T.cols.lead,
      sort: (r) => r.lead.id,
      render: (r) => (
        <Link to={recordPeekPath(actor.workspaceId, 'leads', r.lead.id)} className="mono nowrap">
          {r.lead.id}
        </Link>
      ),
    },
    {
      key: 'customer',
      label: T.cols.customer,
      sort: (r) => r.customer,
      render: (r) => (
        <>
          <div>{r.customer}</div>
          {r.contact && <div className="muted small">{r.contact}</div>}
        </>
      ),
    },
    { key: 'division', label: T.cols.division, sort: (r) => masterLabel('division', r.divisionId), render: (r) => masterLabel('division', r.divisionId) },
    { key: 'source', label: T.cols.source, sort: (r) => masterLabel('leadSource', r.sourceId), render: (r) => masterLabel('leadSource', r.sourceId) },
    { key: 'owner', label: T.cols.owner, sort: (r) => r.ownerName, render: (r) => r.ownerName || <span className="muted">{T.unassigned}</span> },
    {
      key: 'manager',
      label: T.cols.manager,
      sort: (r) => r.managerName,
      render: (r) => (
        <>
          <div>{r.managerName || <span className="muted">{T.noManager}</span>}</div>
          <div className="muted small">{r.escalatedAt ? formatDateTime(r.escalatedAt) : T.notEscalated}</div>
        </>
      ),
    },
    { key: 'created', label: T.cols.created, sort: (r) => r.createdAt, render: (r) => formatDateTime(r.createdAt) },
    {
      key: 'age',
      label: T.cols.age,
      sort: (r) => r.ageHours,
      render: (r) => (
        <>
          <span className={`tag tone-${r.overHours >= 24 ? 'danger' : 'warning'}`}>{T.age(r.ageHours)}</span>
          <div className="muted small">{T.overBy(T.age(r.overHours))}</div>
        </>
      ),
    },
    { key: 'score', label: T.cols.score, num: true, sort: (r) => r.score, render: (r) => r.score },
    {
      key: 'action',
      label: T.cols.action,
      render: (r) => (
        <Button icon="message" onClick={() => setLogFor(r)} disabledReason={canUpdateRecord(actor, res, r.lead) ? undefined : L.leads.dialogs.readOnlyFor(actor.role.label)}>
          {L.leads.actions.logFollowUp}
        </Button>
      ),
    },
  ];

  const escalatedCount = all.filter((r) => r.escalatedAt).length;
  const oldest = all.reduce((m, r) => Math.max(m, r.overHours), 0);

  return (
    <ListPage
      title={L.nav.pages.notAttendedLeads.title}
      description={T.description(sla ?? 24)}
      kpis={
        query.data && all.length > 0 ? (
          <KpiStrip
            label={L.nav.pages.notAttendedLeads.title}
            items={[
              { key: 'total', label: T.kpis.total, value: all.length, sub: T.count(all.length) },
              { key: 'escalated', label: T.kpis.escalated, value: escalatedCount, sub: T.escalationDone },
              { key: 'oldest', label: T.kpis.oldest, value: T.overBy(T.age(oldest)), sub: T.cols.age },
              { key: 'sla', label: T.kpis.sla, value: T.hours(query.data.slaHours), sub: T.cols.created },
            ]}
          />
        ) : undefined
      }
    >
      <DataTable
        label={T.tableLabel}
        rows={rows}
        rowKey={(r) => r.lead.id}
        columns={columns}
        loading={!query.data && !query.error}
        error={query.error}
        onRetry={query.retry}
        initialSort={{ key: 'age', dir: 'desc' }}
        search={(r) => `${r.lead.id} ${r.customer} ${r.contact} ${r.ownerName}`}
        summary={T.count(rows.length)}
        activeFilters={[division, owner, escalation].filter(Boolean).length}
        onClearFilters={clear}
        empty={query.data && !all.length ? { icon: 'check', title: T.emptyTitle, body: T.emptyBody(query.data.slaHours) } : undefined}
        emptyText={T.noMatchTitle}
        filters={
          <>
            <SelectMenu label={T.division} value={division} options={[{ value: '', label: T.allDivisions }, ...divisions.map((d) => ({ value: d, label: masterLabel('division', d) }))]} onChange={setDivision} />
            <SelectMenu label={T.owner} value={owner} options={[{ value: '', label: T.allOwners }, ...owners.map(([value, label]) => ({ value, label }))]} onChange={setOwner} />
            <SelectMenu<Escalation>
              label={T.escalation}
              value={escalation}
              options={[
                { value: '', label: T.escalationAll },
                { value: 'escalated', label: T.escalationDone },
                { value: 'pending', label: T.escalationPending },
              ]}
              onChange={setEscalation}
            />
          </>
        }
      />
      {logFor && (
        <LogActivityDialog
          open
          onClose={() => setLogFor(null)}
          requireNextFollowUp
          title={L.leads.actions.logFollowUp}
          parent={{ parentResource: 'leads', parentId: logFor.lead.id, parentLabel: `${logFor.lead.id} · ${logFor.customer}`, customerId: logFor.lead.customerId as string | undefined }}
        />
      )}
    </ListPage>
  );
}
