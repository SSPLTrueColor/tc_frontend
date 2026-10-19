import { Link } from 'react-router-dom';
import { useServiceQuery } from '../../../hooks/useServiceQuery';
import { formatDate, nowLocal } from '../../../lib/dates';
import { loaders } from '../../../services/api/service';
import { useActor } from '../../../services/hooks';
import { setOffline } from '../../../services/offline';
import { masterValue } from '../../../services/registry';
import { byId } from '../../../services/lookups';
import { clockStates } from '../../../services/service/sla';
import { customerName } from '../../../services/service/tickets';
import { Button } from '../../../components/primitives/Button';
import { EmptyState, ErrorState, InlineAlert, Skeleton, StatusChip, useToast } from '../../../components/primitives/feedback';
import { PageHeader } from '../../../components/shell/PageHeader';
import { clockText } from '../components/TicketExtensions';
import { useOffline } from './useStep';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Offline switch + pending count shared by the field pages (NFR-15). */
export function OfflineBar() {
  const { offline, pending } = useOffline();
  const toast = useToast();
  return (
    <div className="row-gap no-print" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
      {offline ? (
        <InlineAlert tone="warning" title="Offline (simulated)">
          Job-card updates are saved on this device{pending ? ` — ${pending} waiting to sync` : ''}.
        </InlineAlert>
      ) : null}
      <Button
        icon={offline ? 'reset' : 'eye-off'}
        onClick={() => {
          const r = setOffline(!offline);
          if (r) toast(r.conflicts.length ? `Synced ${r.synced.length}; ${r.conflicts.length} need attention: ${r.conflicts.map((c) => c.message).join(' ')}` : `Back online — ${r.synced.length} update(s) synced`, r.conflicts.length ? 'danger' : 'success');
          else toast('Offline mode: updates will be queued on this device', 'info');
        }}
      >
        {offline ? 'Go online and sync' : 'Simulate offline'}
      </Button>
    </div>
  );
}

/** FR-080: the engineer's jobs, most urgent first (mobile-first). */
export function MyJobsPage() {
  const actor = useActor();
  const q = useServiceQuery(loaders.myJobs(actor), [actor.user.id]);
  return (
    <div className="page">
      <PageHeader title="My jobs" description="Your assigned tickets and preventive-maintenance visits. Tap a job to accept, travel, check in, record work and get the customer’s sign-off." />
      <OfflineBar />
      {q.error ? (
        <ErrorState title="Could not load your jobs" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={6} />
      ) : !q.data.tickets.length && !q.data.pm.length ? (
        <EmptyState icon="check-square" title="No jobs assigned to you">
          New assignments appear here and in your notifications.
        </EmptyState>
      ) : (
        <div className="svc-jobs">
          {q.data.tickets.map((t) => {
            const pr = masterValue('ticketPriority', t.priority);
            const st = masterValue('ticketStatus', t.status);
            const next = clockStates(t, nowLocal()).find((c) => c.status !== 'met' && c.status !== 'breached_met' && c.status !== 'not_applicable');
            const machine = byId('machines', t.machineId);
            return (
              <Link key={t.id} to={`/my-jobs/${t.id}`} className="svc-job">
                <span className="svc-job-top">
                  {pr && <StatusChip label={pr.label.replace(' (machine down)', '')} tone={pr.tone} />}
                  {st && <StatusChip label={st.label} tone={st.tone} />}
                  <span className="mono small muted">{t.id}</span>
                </span>
                <strong>{customerName(t.customerId)}</strong>
                <span className="small">{s(t.description).slice(0, 120)}</span>
                <span className={`small ${next && (next.status === 'breached' || next.status === 'at_risk') ? 'text-danger' : 'muted'}`}>
                  {machine ? `${s(machine.serialNo)} · ${s(machine.model)} · ` : ''}
                  {next ? `${next.clock === 'resolution' ? 'Resolve' : next.clock === 'arrival' ? 'Reach site' : 'Respond'}: ${clockText(next)}` : 'Waiting for customer confirmation'}
                </span>
              </Link>
            );
          })}
          {q.data.pm.length > 0 && <h2 className="panel-title">Preventive maintenance</h2>}
          {q.data.pm.map((p) => (
            <Link key={p.id} to={`/pm-schedule?q=${encodeURIComponent(p.id)}`} className="svc-job">
              <span className="svc-job-top">
                <StatusChip label={masterValue('pmStatus', p.status)?.label ?? s(p.status)} tone={masterValue('pmStatus', p.status)?.tone} />
                <span className="mono small muted">{p.id}</span>
              </span>
              <strong>{customerName(p.customerId)}</strong>
              <span className="small muted">
                {s(byId('machines', p.machineId)?.serialNo)} · due {formatDate(s(p.dueDate))}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
