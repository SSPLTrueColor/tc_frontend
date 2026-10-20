import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate } from '../../lib/dates';
import { recordPeekPath } from '../../lib/routes';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { useActor } from '../../services/hooks';
import { byId } from '../../services/lookups';
import { leadsQueries } from '../../services/api/leads';
import { safeTitle, type FollowUpItem } from '../../services/leads/rules';
import { Button } from '../../components/primitives/Button';
import { Tabs } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { LogActivityDialog } from '../../components/crm/LogActivityDialog';
import { ListPage } from '../../components/shell/ListPage';
import { DataTable, type Column } from '../../components/primitives/DataTable';
import { L } from '../../constants/labels';

const T = L.leads.pages.followUps;

type Bucket = 'overdue' | 'today' | 'upcoming';
const BUCKET_LABEL: Record<Bucket, string> = T.buckets;

/** LEAD-09: every open follow-up the user can see (leads, opportunities, customers …), overdue first. */
export function FollowUpsPage() {
  const actor = useActor();
  const [bucket, setBucket] = useState<Bucket>('overdue');
  const [type, setType] = useState('');
  const [logFor, setLogFor] = useState<FollowUpItem | null>(null);
  const query = useServiceQuery(() => leadsQueries.followUps(actor, 7), [actor.user.id]);
  const all = query.data ?? [];
  const types = [...new Map(all.map((i) => [i.resource, i.resourceLabel])).entries()];
  const rows = all.filter((i) => i.bucket === bucket && (!type || i.resource === type));
  const counts = (b: Bucket) => all.filter((i) => i.bucket === b && (!type || i.resource === type)).length;
  const ownerOf = (i: FollowUpItem) => (i.ownerId ? String(byId('employees', i.ownerId)?.fullName ?? '') : '');

  const columns: Column<FollowUpItem>[] = [
    {
      key: 'due',
      label: T.cols.due,
      sort: (i) => i.due,
      render: (i) => <span className={`tag tone-${i.bucket === 'overdue' ? 'danger' : i.bucket === 'today' ? 'warning' : 'neutral'}`}>{formatDate(i.due)}</span>,
    },
    {
      key: 'record',
      label: T.cols.record,
      sort: (i) => i.record.id,
      render: (i) => {
        const company = i.customerId && i.resource !== 'customers' ? safeTitle('customers', i.customerId, actor) : '';
        return (
          <Link to={recordPeekPath(actor.workspaceId, i.resource, i.record.id)} className="flow-main">
            <span className="flow-title">
              {i.record.id} · {i.title}
            </span>
            {company && company !== i.title && <span className="muted small">{company}</span>}
          </Link>
        );
      },
    },
    { key: 'type', label: T.cols.type, sort: (i) => i.resourceLabel, render: (i) => i.resourceLabel },
    { key: 'owner', label: T.cols.owner, sort: (i) => ownerOf(i), render: (i) => ownerOf(i) || <span className="muted">—</span> },
    {
      key: 'act',
      label: T.cols.action,
      render: (i) => (
        <Button icon="message" onClick={() => setLogFor(i)}>
          {L.leads.actions.logFollowUp}
        </Button>
      ),
    },
  ];

  return (
    <ListPage
      title={L.nav.pages.followUps.title}
      description={T.description}
      kpis={
        <Tabs<Bucket>
          label={T.periodLabel}
          value={bucket}
          onChange={setBucket}
          tabs={(['overdue', 'today', 'upcoming'] as Bucket[]).map((b) => ({ id: b, label: BUCKET_LABEL[b], count: query.data ? counts(b) : undefined }))}
        />
      }
    >
      <DataTable
        key={bucket}
        label={T.tableLabel}
        noun={T.noun}
        rows={rows}
        rowKey={(i) => `${i.resource}:${i.record.id}`}
        columns={columns}
        loading={!query.data && !query.error}
        error={query.error}
        onRetry={query.retry}
        initialSort={{ key: 'due', dir: 'asc' }}
        search={(i) => `${i.record.id} ${i.title} ${i.resourceLabel}`}
        summary={T.count(rows.length)}
        activeFilters={type ? 1 : 0}
        onClearFilters={() => setType('')}
        empty={query.data && !rows.length && !type ? { icon: 'calendar-clock', title: bucket === 'overdue' ? T.emptyOverdue : bucket === 'today' ? T.emptyToday : T.emptyUpcoming, body: bucket === 'overdue' ? T.emptyOverdueBody : T.emptyBody } : undefined}
        filters={<SelectMenu label={T.recordType} value={type} options={[{ value: '', label: T.allRecordTypes }, ...types.map(([value, label]) => ({ value, label }))]} onChange={setType} />}
      />
      {logFor && (
        <LogActivityDialog
          open
          onClose={() => setLogFor(null)}
          requireNextFollowUp
          title={L.leads.actions.logFollowUp}
          parent={{
            parentResource: logFor.resource,
            parentId: logFor.record.id,
            parentLabel: `${logFor.record.id} · ${logFor.title}`,
            customerId: logFor.resource === 'customers' ? logFor.record.id : logFor.customerId,
          }}
        />
      )}
    </ListPage>
  );
}
