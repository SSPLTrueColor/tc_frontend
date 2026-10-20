import { useParams } from 'react-router-dom';
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
import { L } from '../../../constants/labels';
import { resourcePath } from '../../../lib/routes';
import { LinkButton } from '../../../components/primitives/controls';
import { Table } from '../../../components/primitives/Table';

const S = L.service;
const P = S.pages.jobCard;

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dt = (v: unknown) => (v ? formatDateTime(s(v)) : S.sla.chips.not_applicable);

/** Service Job Card (FR-082, SRV-08): printable (browser "Save as PDF"). */
export function JobCardPage() {
  const { recordId = '' } = useParams();
  const actor = useActor();
  const toast = useToast();
  const q = useServiceQuery(loaders.job(actor, recordId), [actor.user.id, recordId]);
  if (q.error)
    return (
      <div className="page">
        <PageHeader title={L.nav.pages.jobCard.title} />
        <ErrorState title={P.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </div>
    );
  if (!q.data)
    return (
      <div className="page">
        <PageHeader title={L.nav.pages.jobCard.title} />
        <Skeleton rows={10} />
      </div>
    );
  const t = q.data;
  const machine = byId('machines', t.machineId);
  const visits = visitsOf(t.id).slice().reverse();
  return (
    <div className="page">
      <PageHeader
        title={P.title(t.id)}
        description={P.description}
        actions={
          <span className="row-gap no-print">
            <LinkButton to={resourcePath(actor.workspaceId, 'tickets', { peek: t.id })}>{S.actions.backToTicket}</LinkButton>
            <Button
              icon="send"
              disabledReason={t.resolvedAt ? undefined : P.sendDisabled}
              onClick={() =>
                serviceApi
                  .resendJobCard(actor, t.id)
                  .then(() => toast(S.toasts.jobCardSent))
                  .catch((e) => toast(errorMessage(e), 'danger'))
              }
            >
              {S.actions.sendToCustomer}
            </Button>
            <Button variant="primary" icon="download" onClick={() => window.print()}>
              {S.actions.printPdf}
            </Button>
          </span>
        }
      />
      <article className="panel svc-print">
        <header className="row-gap" style={{ justifyContent: 'space-between' }}>
          <div>
            <strong>{organization.name}</strong>
            <div className="muted small">{P.docTitle}</div>
          </div>
          <div className="mono">{t.id}</div>
        </header>
        <h2>{P.customerMachine}</h2>
        <dl className="detail-list">
          <div className="detail-row">
            <dt>{S.fields.tickets.customerId}</dt>
            <dd>{customerName(t.customerId)}</dd>
          </div>
          <div className="detail-row">
            <dt>{P.contact}</dt>
            <dd>{t.contactId ? recordTitle('contacts', t.contactId) : S.sla.chips.not_applicable}</dd>
          </div>
          <div className="detail-row">
            <dt>{S.fields.tickets.machineId}</dt>
            <dd>{machine ? `${s(machine.serialNo)} · ${s(machine.model)}` : S.sla.chips.not_applicable}</dd>
          </div>
          <div className="detail-row">
            <dt>{S.fields.tickets.coverage}</dt>
            <dd>{masterLabel('coverage', t.coverage)}</dd>
          </div>
        </dl>
        <h2>{P.complaint}</h2>
        <dl className="detail-list">
          <div className="detail-row">
            <dt>{S.fields.tickets.reportedAt}</dt>
            <dd>{P.reportedVia(dt(t.reportedAt), masterLabel('ticketChannel', t.channel))}</dd>
          </div>
          <div className="detail-row">
            <dt>{P.category}</dt>
            <dd>
              {masterLabel('complaintCategory', t.category)}
              {t.subCategory ? ` / ${masterLabel('complaintSubCategory', t.subCategory)}` : ''}
            </dd>
          </div>
          <div className="detail-row">
            <dt>{P.typePriority}</dt>
            <dd>
              {masterLabel('ticketType', t.ticketType)} · {masterLabel('ticketPriority', t.priority)}
            </dd>
          </div>
          <div className="detail-row">
            <dt>{S.fields.tickets.description}</dt>
            <dd>{s(t.description)}</dd>
          </div>
        </dl>
        <h2>{P.visits}</h2>
        {visits.length ? (
          <Table scroll={false}>
            <thead>
              <tr>
                <th scope="col">{P.colEngineer}</th>
                <th scope="col">{P.colInOut}</th>
                <th scope="col">{P.colWork}</th>
                <th scope="col">{P.colParts}</th>
                <th scope="col">{P.colSignOff}</th>
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
                        <strong>{P.work}</strong> {s(v.workDone)}
                      </>
                    ) : null}
                  </td>
                  <td className="small">
                    {s(v.partsUsed) || P.none}
                    {v.printCounter ? P.counter(s(v.printCounter)) : ''}
                    {v.inkUsedMl ? P.ink(s(v.inkUsedMl)) : ''}
                  </td>
                  <td className="small">{v.signedOffAt ? `${masterLabel('signOffMethod', v.signOffMethod)} · ${dt(v.signedOffAt)}` : S.sla.chips.not_applicable}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="muted">{P.noVisits}</p>
        )}
        <h2>{P.resolution}</h2>
        <p>{s(t.resolution) || P.notResolved}</p>
        {t.chargeableStatus && t.chargeableStatus !== 'none' ? (
          <p>
            {P.chargeable(masterLabel('chargeableStatus', t.chargeableStatus))}
            {t.chargeableAmount ? P.plusGst(formatMoney(Number(t.chargeableAmount))) : ''}
          </p>
        ) : null}
        <p className="muted small">
          {P.timeline(dt(t.respondedAt), dt(t.arrivedAt), dt(t.resolvedAt))}
        </p>
      </article>
    </div>
  );
}
