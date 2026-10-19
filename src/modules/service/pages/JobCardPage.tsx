import { Link, useParams } from 'react-router-dom';
import { useServiceQuery } from '../../../hooks/useServiceQuery';
import { formatDateTime } from '../../../lib/dates';
import { formatMoney } from '../../../lib/format';
import { errorMessage } from '../../../services/api/client';
import { loaders, serviceApi } from '../../../services/api/service';
import { useActor } from '../../../services/hooks';
import { byId } from '../../../services/lookups';
import { masterLabel } from '../../../services/registry';
import { recordTitle } from '../../../services/runtime';
import { visitsOf } from '../../../services/service/jobs';
import { customerName } from '../../../services/service/tickets';
import { Button } from '../../../components/primitives/Button';
import { ErrorState, Skeleton, useToast } from '../../../components/primitives/feedback';
import { PageHeader } from '../../../components/shell/PageHeader';
import { organization } from '../../../domain/pack';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dt = (v: unknown) => (v ? formatDateTime(s(v)) : 'N/A');

/** FR-082: printable service job card (browser "Save as PDF"). */
export function JobCardPage() {
  const { recordId = '' } = useParams();
  const actor = useActor();
  const toast = useToast();
  const q = useServiceQuery(loaders.job(actor, recordId), [actor.user.id, recordId]);
  if (q.error)
    return (
      <div className="page">
        <PageHeader title="Job card" />
        <ErrorState title="Job card not available" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </div>
    );
  if (!q.data)
    return (
      <div className="page">
        <PageHeader title="Job card" />
        <Skeleton rows={10} />
      </div>
    );
  const t = q.data;
  const machine = byId('machines', t.machineId);
  const visits = visitsOf(t.id).slice().reverse();
  return (
    <div className="page">
      <PageHeader
        title={`Job card ${t.id}`}
        description="Generated automatically when the ticket is resolved and sent to the customer with the feedback link. Use Print → Save as PDF for a copy."
        actions={
          <span className="row-gap no-print">
            <Link className="btn btn-secondary" to={`/tickets?peek=${t.id}`}>
              <span className="btn-label">Back to ticket</span>
            </Link>
            <Button
              icon="send"
              disabledReason={t.resolvedAt ? undefined : 'Sent once the ticket is resolved'}
              onClick={() =>
                serviceApi
                  .resendJobCard(actor, t.id)
                  .then(() => toast('Job card sent to the customer (see Message outbox)'))
                  .catch((e) => toast(errorMessage(e), 'danger'))
              }
            >
              Send to customer
            </Button>
            <Button variant="primary" icon="download" onClick={() => window.print()}>
              Print / PDF
            </Button>
          </span>
        }
      />
      <article className="panel svc-print">
        <header className="row-gap" style={{ justifyContent: 'space-between' }}>
          <div>
            <strong>{organization.name}</strong>
            <div className="muted small">Service job card</div>
          </div>
          <div className="mono">{t.id}</div>
        </header>
        <h2>Customer & machine</h2>
        <dl className="detail-list">
          <div className="detail-row">
            <dt>Customer</dt>
            <dd>{customerName(t.customerId)}</dd>
          </div>
          <div className="detail-row">
            <dt>Contact</dt>
            <dd>{t.contactId ? recordTitle('contacts', t.contactId) : 'N/A'}</dd>
          </div>
          <div className="detail-row">
            <dt>Machine</dt>
            <dd>{machine ? `${s(machine.serialNo)} · ${s(machine.model)}` : 'N/A'}</dd>
          </div>
          <div className="detail-row">
            <dt>Coverage</dt>
            <dd>{masterLabel('coverage', t.coverage)}</dd>
          </div>
        </dl>
        <h2>Complaint</h2>
        <dl className="detail-list">
          <div className="detail-row">
            <dt>Reported</dt>
            <dd>
              {dt(t.reportedAt)} via {masterLabel('ticketChannel', t.channel)}
            </dd>
          </div>
          <div className="detail-row">
            <dt>Category</dt>
            <dd>
              {masterLabel('complaintCategory', t.category)}
              {t.subCategory ? ` / ${masterLabel('complaintSubCategory', t.subCategory)}` : ''} · {masterLabel('ticketType', t.ticketType)} · {masterLabel('ticketPriority', t.priority)}
            </dd>
          </div>
          <div className="detail-row">
            <dt>Description</dt>
            <dd>{s(t.description)}</dd>
          </div>
        </dl>
        <h2>Visits</h2>
        {visits.length ? (
          <table className="mini-table">
            <thead>
              <tr>
                <th scope="col">Engineer</th>
                <th scope="col">Check-in / out</th>
                <th scope="col">Diagnosis & work</th>
                <th scope="col">Parts & readings</th>
                <th scope="col">Sign-off</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <tr key={v.id}>
                  <td>
                    {recordTitle('employees', v.engineerId)}
                    <div className="muted small">{masterLabel('visitType', v.visitType)}</div>
                  </td>
                  <td className="small">
                    {dt(v.checkInAt)}
                    <br />
                    {dt(v.checkOutAt)}
                  </td>
                  <td className="small">
                    {s(v.diagnosis)}
                    {v.workDone ? (
                      <>
                        <br />
                        <strong>Work:</strong> {s(v.workDone)}
                      </>
                    ) : null}
                  </td>
                  <td className="small">
                    {s(v.partsUsed) || 'None'}
                    {v.printCounter ? ` · counter ${s(v.printCounter)} m²` : ''}
                    {v.inkUsedMl ? ` · ink ${s(v.inkUsedMl)} ml` : ''}
                  </td>
                  <td className="small">{v.signedOffAt ? `${masterLabel('signOffMethod', v.signOffMethod)} · ${dt(v.signedOffAt)}` : 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No visits recorded.</p>
        )}
        <h2>Resolution</h2>
        <p>{s(t.resolution) || 'Not resolved yet.'}</p>
        {t.chargeableStatus && t.chargeableStatus !== 'none' ? (
          <p>
            Chargeable: {masterLabel('chargeableStatus', t.chargeableStatus)}
            {t.chargeableAmount ? ` · ${formatMoney(Number(t.chargeableAmount))} + GST` : ''}
          </p>
        ) : null}
        <p className="muted small">
          Responded {dt(t.respondedAt)} · on site {dt(t.arrivedAt)} · resolved {dt(t.resolvedAt)}
        </p>
      </article>
    </div>
  );
}
