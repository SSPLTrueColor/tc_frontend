import { useParams } from 'react-router-dom';
import { organization } from '../../domain/pack';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { formatDate } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { recordPeekPath } from '../../lib/routes';
import { orderView, printableContract } from '../../services/api/orders';
import { useActor } from '../../services/hooks';
import { amountInWords } from '../../services/lookups';
import { masterLabel } from '../../services/registry';
import { Button } from '../../components/primitives/Button';
import { ErrorState, Skeleton } from '../../components/primitives/feedback';
import { PageHeader } from '../../components/shell/PageHeader';
import { LinesTable } from './components';
import { LinkButton } from '../../components/primitives/controls';

const O = L.orders;
const P = O.pages.contractPdf;
const FC = O.fields.salesContracts;
const TITLE = L.nav.pages.salesContractPdf.title;

const TERMS = ['paymentTerms', 'deliveryTerms', 'loadingTerms', 'installationTerms', 'warrantyTerms', 'sparesTerms', 'inkCommitment', 'amcTerms'] as const;

/** SO-05: Sales Contract PDF (browser "Save as PDF"). Route: ROUTES.salesContractPdf (/sales-orders/:recordId/contract/pdf). */
export function SalesContractPdfPage() {
  const { recordId: id = '' } = useParams();
  const actor = useActor();
  const q = useServiceQuery(() => ({ ...printableContract(actor, id), view: orderView(actor, id) }), [id, actor.user.id]);
  const back = (
    <LinkButton to={recordPeekPath(actor.workspaceId, 'salesOrders', id)}>{O.actions.backToOrder}</LinkButton>
  );
  if (q.error)
    return (
      <div className="page">
        <PageHeader title={TITLE} actions={back} />
        <ErrorState title={P.unavailable} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </div>
    );
  if (!q.data)
    return (
      <div className="page">
        <PageHeader title={TITLE} />
        <Skeleton rows={10} />
      </div>
    );
  const { order, contract, customer, site, view } = q.data;
  return (
    <div className="page">
      <PageHeader
        title={TITLE}
        description={P.title(String(contract.contractNo))}
        actions={
          <>
            {back}
            <Button variant="primary" icon="download" onClick={() => window.print()}>
              {O.actions.savePdf}
            </Button>
          </>
        }
      />
      <article className="panel orders-print">
        <header className="orders-print-head">
          <div>
            <h1 className="orders-print-title">{organization.name}</h1>
            <p className="muted small">{P.division(masterLabel('division', order.divisionId))}</p>
          </div>
          <dl className="detail-list">
            <div className="detail-row">
              <dt>{P.contract}</dt>
              <dd>{P.versionOf(String(contract.contractNo), String(contract.contractVersion))}</dd>
            </div>
            <div className="detail-row">
              <dt>{P.salesOrder}</dt>
              <dd>
                {String(order.orderNo)} · {formatDate(String(order.orderDate))}
              </dd>
            </div>
            <div className="detail-row">
              <dt>{P.customerPo}</dt>
              <dd>
                {String(order.customerPoNo)} · {formatDate(String(order.customerPoDate))}
              </dd>
            </div>
          </dl>
        </header>
        <section>
          <h2 className="panel-title">{P.customer}</h2>
          <p>
            <strong>{String(customer?.legalName || customer?.name || order.customerId)}</strong>
            {customer?.gstin ? <span className="muted">{P.gstin(String(customer.gstin))}</span> : null}
          </p>
          {site && <p className="muted">{P.site(`${String(site.line1)}, ${String(site.city)} ${String(site.pincode ?? '')}`.trim())}</p>}
        </section>
        <section>
          <h2 className="panel-title">{P.scope}</h2>
          <LinesTable lines={view.lines} />
          <p>
            <strong>{P.value(formatMoney(Number(contract.contractValue)))}</strong>
            {P.inclGst(amountInWords(Number(contract.contractValue)))}
          </p>
        </section>
        <section>
          <h2 className="panel-title">{P.schedule}</h2>
          <ul className="plain-list bullets">
            {view.milestones.map((m) => (
              <li key={m.id}>{P.milestone(String(m.label), String(m.percent), formatMoney(Number(m.amount)), formatDate(String(m.dueDate)))}</li>
            ))}
          </ul>
        </section>
        {TERMS.filter((k) => contract[k] && contract[k] !== P.notApplicable).map((k) => (
          <section key={k}>
            <h2 className="panel-title">{FC[k]}</h2>
            <p>{String(contract[k])}</p>
          </section>
        ))}
        <footer className="orders-print-sign">
          <div>
            <p className="muted small">{P.forCompany(organization.name)}</p>
            <p>{P.signatory}</p>
          </div>
          <div>
            <p className="muted small">{P.forCustomer}</p>
            <p>{contract.signedAt ? P.signed(String(contract.signedBy), formatDate(String(contract.signedAt))) : P.pending}</p>
          </div>
        </footer>
      </article>
    </div>
  );
}
