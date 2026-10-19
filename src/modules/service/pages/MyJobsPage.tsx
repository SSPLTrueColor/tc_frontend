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
import { L } from '../../../constants/labels';
import { ROUTES, toPath } from '../../../constants/routes';

const S = L.service;
const P = S.pages.myJobs;

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Offline switch + pending count shared by the field pages (NFR-15). */
export function OfflineBar() {
  const { offline, pending } = useOffline();
  const toast = useToast();
  return (
    <div className="row-gap no-print" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
      {offline ? (
        <InlineAlert tone="warning" title={P.offlineTitle}>
          {P.offlineBody(pending)}
        </InlineAlert>
      ) : null}
      <Button
        icon={offline ? 'reset' : 'eye-off'}
        onClick={() => {
          const r = setOffline(!offline);
          if (r) toast(r.conflicts.length ? S.toasts.syncConflicts(r.synced.length, r.conflicts.length, r.conflicts.map((c) => c.message).join(' ')) : S.toasts.synced(r.synced.length), r.conflicts.length ? 'danger' : 'success');
          else toast(S.toasts.offlineOn, 'info');
        }}
      >
        {offline ? S.actions.goOnline : S.actions.simulateOffline}
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
      <PageHeader title={L.nav.pages.myJobs.title} description={P.description} />
      <OfflineBar />
      {q.error ? (
        <ErrorState title={P.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={6} />
      ) : !q.data.tickets.length && !q.data.pm.length ? (
        <EmptyState icon="check-square" title={P.empty}>
          {P.emptyBody}
        </EmptyState>
      ) : (
        <div className="svc-jobs">
          {q.data.tickets.map((t) => {
            const pr = masterValue('ticketPriority', t.priority);
            const st = masterValue('ticketStatus', t.status);
            const next = clockStates(t, nowLocal()).find((c) => c.status !== 'met' && c.status !== 'breached_met' && c.status !== 'not_applicable');
            const machine = byId('machines', t.machineId);
            return (
              <Link key={t.id} to={toPath(ROUTES.myJob, { recordId: t.id })} className="svc-job">
                <span className="svc-job-top">
                  {pr && <StatusChip label={pr.label.replace(' (machine down)', '')} tone={pr.tone} />}
                  {st && <StatusChip label={st.label} tone={st.tone} />}
                  <span className="mono small muted">{t.id}</span>
                </span>
                <strong>{customerName(t.customerId)}</strong>
                <span className="small">{s(t.description).slice(0, 120)}</span>
                <span className={`small ${next && (next.status === 'breached' || next.status === 'at_risk') ? 'text-danger' : 'muted'}`}>
                  {machine ? `${s(machine.serialNo)} · ${s(machine.model)} · ` : ''}
                  {next ? `${next.clock === 'resolution' ? P.resolveBy : next.clock === 'arrival' ? P.reachSite : P.respond}: ${clockText(next)}` : P.awaitingConfirmation}
                </span>
              </Link>
            );
          })}
          {q.data.pm.length > 0 && <h2 className="panel-title">{P.pmHeading}</h2>}
          {q.data.pm.map((p) => (
            <Link key={p.id} to={toPath(ROUTES.pmSchedule, {}, { tab: 'all', q: p.id })} className="svc-job">
              <span className="svc-job-top">
                <StatusChip label={masterValue('pmStatus', p.status)?.label ?? s(p.status)} tone={masterValue('pmStatus', p.status)?.tone} />
                <span className="mono small muted">{p.id}</span>
              </span>
              <strong>{customerName(p.customerId)}</strong>
              <span className="small muted">
                {s(byId('machines', p.machineId)?.serialNo)} · {P.due(formatDate(s(p.dueDate)))}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
