import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatDate } from '../../lib/dates';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { useActor } from '../../services/hooks';
import { byId } from '../../services/lookups';
import { getPolicies } from '../../services/policies';
import { masterLabel } from '../../services/registry';
import { computeTotals } from '../../services/quotations/pricing';
import { getQuote } from '../../services/quotations/workflow';
import { formatMoney } from '../../lib/format';
import { Button } from '../../components/primitives/Button';
import { ErrorState, Skeleton } from '../../components/primitives/feedback';
import { PageHeader } from '../../components/shell/PageHeader';
import { LinesTable, TotalsBlock } from './LinesTable';

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

/** /quotations/:recordId/print — branded A4 quotation (FR-042). Print or "Save as PDF" from the browser. */
export function QuotePrintPage() {
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
        <PageHeader title="Print quotation" />
        <ErrorState title="Could not load the quotation" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </div>
    );
  if (!q.data)
    return (
      <div className="page">
        <PageHeader title="Print quotation" />
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
        title={`Print ${r.quoteNo}`}
        description="A4 layout. Use Print, then “Save as PDF” to attach it to an email."
        actions={
          <>
            <Link className="btn btn-secondary" to={`/quotations?peek=${r.id}`}>
              <span className="btn-label">Back</span>
            </Link>
            <Button variant="primary" icon="download" onClick={() => window.print()}>
              Print / save PDF
            </Button>
          </>
        }
      />
      <article className="qt-doc" style={{ ['--qt-accent' as string]: brand.accent }}>
        {draft && <div className="qt-watermark">DRAFT — NOT VALID</div>}
        <header className="qt-doc-head">
          <div>
            <div className="qt-doc-company">{COMPANY.name}</div>
            <div className="qt-doc-sub">{brand.heading}</div>
            <div className="qt-doc-small">
              {COMPANY.address} · GSTIN {COMPANY.gstin}
              <br />
              {COMPANY.phone} · {COMPANY.email}
            </div>
          </div>
          <div className="qt-doc-meta">
            <div className="qt-doc-title">QUOTATION</div>
            <table>
              <tbody>
                <tr>
                  <th>No.</th>
                  <td>{String(r.quoteNo)}</td>
                </tr>
                <tr>
                  <th>Date</th>
                  <td>{formatDate(String(r.quoteDate))}</td>
                </tr>
                <tr>
                  <th>Valid until</th>
                  <td>{formatDate(String(r.validUntil))}</td>
                </tr>
                <tr>
                  <th>Division</th>
                  <td>{masterLabel('division', r.divisionId)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </header>
        <section className="qt-doc-parties">
          <div>
            <div className="qt-doc-label">To</div>
            <strong>{String(customer?.legalName || customer?.name || r.customerId)}</strong>
            {customer?.gstin ? <div>GSTIN {String(customer.gstin)}</div> : null}
            {contact ? (
              <div>
                Kind attn: {String(contact.name)}
                {contact.designation ? `, ${contact.designation}` : ''}
              </div>
            ) : null}
            <div>Place of supply: {masterLabel('state', r.placeOfSupply)} ({String(r.placeOfSupply)})</div>
          </div>
          <div>
            <div className="qt-doc-label">Your contact at True Colors</div>
            <strong>{String(owner?.fullName ?? '')}</strong>
            <div>{String(owner?.designation ?? '')}</div>
            <div>{String(owner?.email ?? '')}</div>
          </div>
        </section>
        <LinesTable lines={q.data.lines} />
        <section className="qt-doc-bottom">
          <table className="mini-table qt-doc-tax">
            <thead>
              <tr>
                <th scope="col">GST rate</th>
                <th scope="col" className="num">
                  Taxable
                </th>
                {totals.igst ? (
                  <th scope="col" className="num">
                    IGST
                  </th>
                ) : (
                  <>
                    <th scope="col" className="num">
                      CGST
                    </th>
                    <th scope="col" className="num">
                      SGST
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {totals.taxByRate.map((t) => (
                <tr key={t.rate}>
                  <td>{t.rate}%</td>
                  <td className="num">{formatMoney(t.taxable)}</td>
                  {totals.igst ? (
                    <td className="num">{formatMoney(t.igst)}</td>
                  ) : (
                    <>
                      <td className="num">{formatMoney(t.cgst)}</td>
                      <td className="num">{formatMoney(t.sgst)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <TotalsBlock t={totals} />
        </section>
        <section className="qt-doc-terms">
          <div className="qt-doc-label">Terms & conditions</div>
          <dl>
            {(
              [
                ['Payment', r.paymentTerms],
                ['Delivery', r.deliveryTerms],
                ['Warranty', r.warrantyTerms],
                ['Installation', r.installationTerms],
                ['Validity', `This quotation is valid until ${formatDate(String(r.validUntil))}.`],
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
            For {COMPANY.name}
            <div className="qt-doc-signline">Authorised signatory</div>
          </div>
          <div className="qt-doc-small">Computer-generated quotation from the True Colors CRM prototype — demo data, not a commercial offer.</div>
        </footer>
      </article>
    </div>
  );
}
