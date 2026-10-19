import { Link, useParams } from 'react-router-dom';
import { organization } from '../../domain/pack';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { formatDate } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { orderView, printableContract } from '../../services/api/orders';
import { useActor } from '../../services/hooks';
import { amountInWords } from '../../services/lookups';
import { masterLabel } from '../../services/registry';
import { Button } from '../../components/primitives/Button';
import { ErrorState, Skeleton } from '../../components/primitives/feedback';
import { PageHeader } from '../../components/shell/PageHeader';
import { LinesTable } from './components';

const TERMS: [string, string][] = [
  ['paymentTerms', 'Payment'],
  ['deliveryTerms', 'Delivery'],
  ['loadingTerms', 'Loading / unloading'],
  ['installationTerms', 'Installation'],
  ['warrantyTerms', 'Warranty'],
  ['sparesTerms', 'Spare parts'],
  ['inkCommitment', 'Ink purchase commitment & prices'],
  ['amcTerms', 'AMC'],
];

/** FR-053: printable sales contract (browser "Save as PDF"). */
export function ContractPrintPage() {
  const { id = '' } = useParams();
  const actor = useActor();
  const q = useServiceQuery(() => ({ ...printableContract(actor, id), view: orderView(actor, id) }), [id, actor.user.id]);
  if (q.error)
    return (
      <div className="page">
        <PageHeader title="Sales contract" />
        <ErrorState title="Contract unavailable" onRetry={q.retry}>
          {q.error}
        </ErrorState>
        <p className="center">
          <Link to={`/salesOrders?peek=${encodeURIComponent(id)}`}>Back to the order</Link>
        </p>
      </div>
    );
  if (!q.data)
    return (
      <div className="page">
        <PageHeader title="Sales contract" />
        <Skeleton rows={10} />
      </div>
    );
  const { order, contract, customer, site, view } = q.data;
  return (
    <div className="page">
      <PageHeader
        title={`Contract ${contract.contractNo}`}
        actions={
          <>
            <Link className="btn btn-secondary" to={`/salesOrders?peek=${encodeURIComponent(order.id)}`}>
              <span className="btn-label">Back to order</span>
            </Link>
            <Button variant="primary" icon="download" onClick={() => window.print()}>
              Print / save as PDF
            </Button>
          </>
        }
      />
      <article className="panel orders-print">
        <header className="orders-print-head">
          <div>
            <h1 className="orders-print-title">{organization.name}</h1>
            <p className="muted small">{masterLabel('division', order.divisionId)} division · Sales contract</p>
          </div>
          <dl className="detail-list">
            <div className="detail-row">
              <dt>Contract</dt>
              <dd>
                {String(contract.contractNo)} (version {String(contract.version)})
              </dd>
            </div>
            <div className="detail-row">
              <dt>Sales order</dt>
              <dd>
                {String(order.orderNo)} · {formatDate(String(order.orderDate))}
              </dd>
            </div>
            <div className="detail-row">
              <dt>Customer PO</dt>
              <dd>
                {String(order.customerPoNo)} · {formatDate(String(order.customerPoDate))}
              </dd>
            </div>
          </dl>
        </header>
        <section>
          <h2 className="panel-title">Customer</h2>
          <p>
            <strong>{String(customer?.legalName || customer?.name || order.customerId)}</strong>
            {customer?.gstin ? <span className="muted"> · GSTIN {String(customer.gstin)}</span> : null}
          </p>
          {site && (
            <p className="muted">
              Installation site: {String(site.line1)}, {String(site.city)} {String(site.pincode ?? '')}
            </p>
          )}
        </section>
        <section>
          <h2 className="panel-title">Scope of supply</h2>
          <LinesTable lines={view.lines} />
          <p>
            <strong>Contract value: {formatMoney(Number(contract.contractValue))}</strong> (incl. GST) — {amountInWords(Number(contract.contractValue))}
          </p>
        </section>
        <section>
          <h2 className="panel-title">Payment schedule</h2>
          <ul className="plain-list bullets">
            {view.milestones.map((m) => (
              <li key={m.id}>
                {String(m.label)} — {String(m.percent)}% ({formatMoney(Number(m.amount))}) due {formatDate(String(m.dueDate))}
              </li>
            ))}
          </ul>
        </section>
        {TERMS.filter(([k]) => contract[k] && contract[k] !== 'Not applicable.').map(([k, label]) => (
          <section key={k}>
            <h2 className="panel-title">{label}</h2>
            <p>{String(contract[k])}</p>
          </section>
        ))}
        <footer className="orders-print-sign">
          <div>
            <p className="muted small">For {organization.name}</p>
            <p>Authorised signatory</p>
          </div>
          <div>
            <p className="muted small">For the customer</p>
            <p>{contract.signedAt ? `Signed electronically by ${contract.signedBy} on ${formatDate(String(contract.signedAt))} (simulated)` : 'Signature pending'}</p>
          </div>
        </footer>
      </article>
    </div>
  );
}
