import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { L } from '../../constants/labels';
import { recordPeekPath } from '../../lib/routes';
import { formatDate } from '../../lib/dates';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { useActor } from '../../services/hooks';
import { byId } from '../../services/lookups';
import { getPolicies } from '../../services/policies';
import { masterLabel } from '../../services/registry';
import { computeTotals } from '../../services/quotations/pricing';
import { getQuote } from '../../services/quotations/workflow';
import { Button } from '../../components/primitives/Button';
import { ErrorState, Skeleton } from '../../components/primitives/feedback';
import { PageHeader } from '../../components/shell/PageHeader';
import { LinesTable, TaxSummary, TotalsBlock } from './LinesTable';

const P = L.quotations.pdf;

/** Fictional company identity for the printed document (demo only). */
const COMPANY = { name: 'True Colors Limited', gstin: '27AAACT2468K1Z2', address: 'Andheri (East), Mumbai, Maharashtra 400093', phone: '+91 22 0000 0000', email: 'sales@truecolors.example' };
/** Per-division branding (QUO-08): accent colour and document heading. */
const BRAND: Record<string, { accent: string; heading: string }> = {
  TX: { accent: '#6d28d9', heading: 'Digital Textile Printing Solutions' },
  INK: { accent: '#0369a1', heading: 'Inks for Digital Printing' },
  POD: { accent: '#b45309', heading: 'Print-on-Demand Systems' },
  LBL: { accent: '#b91c1c', heading: 'Label Printing Systems' },
  PPR: { accent: '#4b5563', heading: 'Printing Papers' },
  FAB: { accent: '#047857', heading: 'Fabric Printing & Processing' },
};

/** ROUTES.quotationPdf — branded A4 Quotation PDF (FR-042). Print or "Save as PDF" from the browser. */
export function QuotationPdfPage() {
  const { recordId = '' } = useParams();
  const actor = useActor();
  const q = useServiceQuery(() => getQuote(actor, recordId), [recordId, actor.user.id]);
  useEffect(() => {
    document.body.classList.add('qt-printing');
    return () => document.body.classList.remove('qt-printing');
  }, []);
  if (q.error)
    return (
      <div className="page">
        <PageHeader title={L.nav.pages.quotationPdf.title} />
        <ErrorState title={P.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </div>
    );
  if (!q.data)
    return (
      <div className="page">
        <PageHeader title={L.nav.pages.quotationPdf.title} />
        <Skeleton rows={10} />
      </div>
    );
  const r = q.data.record;
  const brand = BRAND[String(r.divisionId)] ?? BRAND.TX;
  const customer = byId('customers', r.customerId);
  const contact = byId('contacts', r.contactId);
  const owner = byId('employees', r.ownerId);
  const totals = computeTotals(q.data.lines, String(r.placeOfSupply), Number(r.freight) || 0, Number(r.insurance) || 0, getPolicies().companyGstState);
  const draft = ['draft', 'pending_approval'].includes(String(r.status));
  return (
    <div className="page">
      <PageHeader
        title={P.title(String(r.quoteNo))}
        description={P.description}
        actions={
          <>
            <Link className="btn btn-secondary" to={recordPeekPath('tc', 'quotations', r.id)}>
              <span className="btn-label">{L.quotations.actions.back}</span>
            </Link>
            <Button variant="primary" icon="download" onClick={() => window.print()}>
              {L.quotations.actions.printPdf}
            </Button>
          </>
        }
      />
      <article className="qt-doc" style={{ ['--qt-accent' as string]: brand.accent }}>
        {draft && <div className="qt-watermark">{P.watermark}</div>}
        <header className="qt-doc-head">
          <div>
            <div className="qt-doc-company">{COMPANY.name}</div>
            <div className="qt-doc-sub">{brand.heading}</div>
            <div className="qt-doc-small">
              {COMPANY.address} · {P.gstin(COMPANY.gstin)}
              <br />
              {COMPANY.phone} · {COMPANY.email}
            </div>
          </div>
          <div className="qt-doc-meta">
            <div className="qt-doc-title">{P.heading}</div>
            <table>
              <tbody>
                <tr>
                  <th>{P.no}</th>
                  <td>{String(r.quoteNo)}</td>
                </tr>
                <tr>
                  <th>{P.date}</th>
                  <td>{formatDate(String(r.quoteDate))}</td>
                </tr>
                <tr>
                  <th>{P.validity}</th>
                  <td>{formatDate(String(r.validUntil))}</td>
                </tr>
                <tr>
                  <th>{P.division}</th>
                  <td>{masterLabel('division', r.divisionId)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </header>
        <section className="qt-doc-parties">
          <div>
            <div className="qt-doc-label">{P.to}</div>
            <strong>{String(customer?.legalName || customer?.name || r.customerId)}</strong>
            {customer?.gstin ? <div>{P.gstin(String(customer.gstin))}</div> : null}
            {contact ? (
              <div>{P.kindAttn(`${String(contact.name)}${contact.designation ? `, ${contact.designation}` : ''}`)}</div>
            ) : null}
            <div>{L.quotations.tabContent.placeOfSupply(masterLabel('state', r.placeOfSupply), String(r.placeOfSupply))}</div>
          </div>
          <div>
            <div className="qt-doc-label">{P.yourContact}</div>
            <strong>{String(owner?.fullName ?? '')}</strong>
            <div>{String(owner?.designation ?? '')}</div>
            <div>{String(owner?.email ?? '')}</div>
          </div>
        </section>
        <LinesTable lines={q.data.lines} />
        <section className="qt-doc-bottom">
          <TaxSummary totals={totals} className="qt-doc-tax" />
          <TotalsBlock t={totals} />
        </section>
        <section className="qt-doc-terms">
          <div className="qt-doc-label">{P.termsTitle}</div>
          <dl>
            {(
              [
                [P.payment, r.paymentTerms],
                [P.delivery, r.deliveryTerms],
                [P.warranty, r.warrantyTerms],
                [P.installation, r.installationTerms],
                [P.validity, P.validityTerm(formatDate(String(r.validUntil)))],
              ] as const
            )
              .filter(([, t]) => !!t)
              .map(([k, t]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{String(t)}</dd>
                </div>
              ))}
          </dl>
        </section>
        <footer className="qt-doc-sign">
          <div>
            {P.forCompany(COMPANY.name)}
            <div className="qt-doc-signline">{P.signatory}</div>
          </div>
          <div className="qt-doc-small">{P.footer}</div>
        </footer>
      </article>
    </div>
  );
}
