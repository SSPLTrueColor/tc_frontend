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
import { EmptyState, ErrorState, Skeleton, Tabs } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { LogActivityDialog } from '../../components/crm/LogActivityDialog';
import { PageHeader } from '../../components/shell/PageHeader';
import { L } from '../../constants/labels';

const T = L.leads.pages.followUps;

type Bucket = 'overdue' | 'today' | 'upcoming';
const BUCKET_LABEL: Record<Bucket, string> = T.buckets;

/** LEAD-09: every open follow-up the user can see (leads, opportunities, customers …), overdue first. */
export function FollowUpsPage() {
  const actor = useActor();
  const [bucket, setBucket] = useState<Bucket>('overdue');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [logFor, setLogFor] = useState<FollowUpItem | null>(null);
  const query = useServiceQuery(() => leadsQueries.followUps(actor, 7), [actor.user.id]);
  const all = query.data ?? [];
  const types = [...new Map(all.map((i) => [i.resource, i.resourceLabel])).entries()];
  const rows = all.filter((i) => i.bucket === bucket && (!type || i.resource === type) && (!q || `${i.record.id} ${i.title}`.toLowerCase().includes(q.toLowerCase())));
  const counts = (b: Bucket) => all.filter((i) => i.bucket === b && (!type || i.resource === type)).length;

  return (
    <div className="page">
      <PageHeader title={L.nav.pages.followUps.title} description={T.description} />
      <Tabs<Bucket> label={T.periodLabel} value={bucket} onChange={setBucket} tabs={(['overdue', 'today', 'upcoming'] as Bucket[]).map((b) => ({ id: b, label: BUCKET_LABEL[b], count: query.data ? counts(b) : undefined }))} />
      <div className="toolbar">
        <input type="search" className="input input-compact" placeholder={T.searchPlaceholder} aria-label={T.searchLabel} value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectMenu label={T.recordType} value={type} options={[{ value: '', label: T.allRecordTypes }, ...types.map(([value, label]) => ({ value, label }))]} onChange={setType} />
        <span className="toolbar-count muted">{T.count(rows.length)}</span>
      </div>
      <div className="content-surface">
        {query.error ? (
          <ErrorState title={T.loadError} onRetry={query.retry}>
            {query.error}
          </ErrorState>
        ) : !query.data ? (
          <Skeleton rows={6} />
        ) : rows.length ? (
          <ul className="flow-list">
            {rows.map((i) => {
              const owner = i.ownerId ? byId('employees', i.ownerId) : undefined;
              const company = i.customerId && i.resource !== 'customers' ? safeTitle('customers', i.customerId, actor) : '';
              return (
                <li key={`${i.resource}:${i.record.id}`} className="flow-item">
                  <span className={`tag tone-${i.bucket === 'overdue' ? 'danger' : i.bucket === 'today' ? 'warning' : 'neutral'}`}>{formatDate(i.due)}</span>
                  <Link to={recordPeekPath(actor.workspaceId, i.resource, i.record.id)} className="flow-main">
                    <span className="flow-title">
                      {i.record.id} · {i.title}
                    </span>
                    <span className="muted small">
                      {i.resourceLabel}
                      {company && company !== i.title ? ` · ${company}` : ''}
                      {owner ? ` · ${String(owner.fullName)}` : ''}
                    </span>
                  </Link>
                  <Button icon="message" onClick={() => setLogFor(i)}>
                    {L.leads.actions.logFollowUp}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon="calendar-clock" title={bucket === 'overdue' ? T.emptyOverdue : bucket === 'today' ? T.emptyToday : T.emptyUpcoming}>
            {bucket === 'overdue' ? T.emptyOverdueBody : T.emptyBody}
          </EmptyState>
        )}
      </div>
      {logFor && (
        <LogActivityDialog
          open
          onClose={() => setLogFor(null)}
          requireNextFollowUp
          parent={{ parentResource: logFor.resource, parentId: logFor.record.id, parentLabel: `${logFor.record.id} · ${logFor.title}`, customerId: logFor.resource === 'customers' ? logFor.record.id : logFor.customerId }}
        />
      )}
    </div>
  );
}
