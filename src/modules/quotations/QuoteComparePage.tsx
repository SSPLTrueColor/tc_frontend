import { Link, useParams, useSearchParams } from 'react-router-dom';
import { formatDate } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { useActor } from '../../services/hooks';
import { masterLabel } from '../../services/registry';
import { lineAmounts, type QuoteLine } from '../../services/quotations/pricing';
import { compareLines, getQuote } from '../../services/quotations/workflow';
import { cx } from '../../lib/format';
import type { RecordData } from '../../metadata/types';
import { EmptyValue } from '../../components/primitives/display';
import { EmptyState, ErrorState, Skeleton } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';

const HEADER: [string, string, (r: RecordData) => string][] = [
  ['status', 'Status', (r) => masterLabel('quoteStatus', r.status)],
  ['quoteDate', 'Quotation date', (r) => formatDate(String(r.quoteDate))],
  ['validUntil', 'Valid until', (r) => formatDate(String(r.validUntil))],
  ['placeOfSupply', 'Place of supply', (r) => masterLabel('state', r.placeOfSupply)],
  ['subtotal', 'Gross value', (r) => formatMoney(Number(r.subtotal) || 0)],
  ['discountTotal', 'Discount', (r) => formatMoney(Number(r.discountTotal) || 0)],
  ['maxDiscountPct', 'Highest discount', (r) => `${Number(r.maxDiscountPct) || 0}%`],
  ['freight', 'Freight', (r) => formatMoney(Number(r.freight) || 0)],
  ['insurance', 'Insurance', (r) => formatMoney(Number(r.insurance) || 0)],
  ['grandTotal', 'Total', (r) => formatMoney(Number(r.grandTotal) || 0)],
  ['paymentTerms', 'Payment terms', (r) => String(r.paymentTerms ?? '')],
  ['deliveryTerms', 'Delivery', (r) => String(r.deliveryTerms ?? '')],
  ['warrantyTerms', 'Warranty', (r) => String(r.warrantyTerms ?? '')],
];

const lineText = (l?: QuoteLine) => (l ? `${l.qty} × ${formatMoney(l.listPrice)} − ${formatMoney(lineAmounts(l).discount)} = ${formatMoney(lineAmounts(l).net)} · GST ${l.gstRate}%` : '');

/** /quotations/:recordId/compare?with=<id> — side-by-side revisions (FR-043). */
export function QuoteComparePage() {
  const { recordId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const actor = useActor();
  const base = useServiceQuery(() => getQuote(actor, recordId), [recordId, actor.user.id]);
  const revs = base.data?.revisions ?? [];
  const idx = revs.findIndex((r) => r.id === recordId);
  const withId = params.get('with') ?? (idx > 0 ? revs[idx - 1].id : revs.find((r) => r.id !== recordId)?.id ?? '');
  const other = useServiceQuery(() => (withId ? getQuote(actor, withId) : null), [withId, actor.user.id]);
  const title = base.data ? `Compare ${String(base.data.record.quoteNo).replace(/-R\d+$/, '')}` : 'Compare revisions';
  if (base.error || other.error)
    return (
      <div className="page">
        <PageHeader title={title} />
        <ErrorState title="Could not load the revisions" onRetry={() => (base.retry(), other.retry())}>
          {base.error ?? other.error}
        </ErrorState>
      </div>
    );
  if (!base.data || other.data === undefined)
    return (
      <div className="page">
        <PageHeader title={title} />
        <Skeleton rows={8} />
      </div>
    );
  if (!other.data)
    return (
      <div className="page">
        <PageHeader title={title} />
        <EmptyState icon="columns" title="Only one revision">
          Revise the quotation to create R1, then compare. <Link to={`/quotations?peek=${recordId}`}>Back to quotation</Link>
        </EmptyState>
      </div>
    );
  // Older revision on the left.
  const [a, b] = Number(other.data.record.revision) <= Number(base.data.record.revision) ? [other.data, base.data] : [base.data, other.data];
  const diff = compareLines(a.lines, b.lines);
  const opts = revs.filter((r) => r.id !== recordId).map((r) => ({ value: r.id, label: `R${Number(r.revision) || 0} · ${masterLabel('quoteStatus', r.status)}` }));
  return (
    <div className="page">
      <PageHeader title={title} description="Older revision on the left, newer on the right. Changed values are highlighted." />
      <div className="toolbar">
        <span className="muted small">
          Comparing R{Number(base.data.record.revision) || 0} with
        </span>
        <SelectMenu label="Compare with revision" value={withId} options={opts} onChange={(v) => setParams({ with: v })} />
        <span className="spacer" />
        <Link className="link small" to={`/quotations?peek=${recordId}`}>
          Back to quotation
        </Link>
      </div>
      <section className="panel">
        <div className="table-scroll">
          <table className="mini-table qt-compare">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">{String(a.record.quoteNo)}</th>
                <th scope="col">{String(b.record.quoteNo)}</th>
              </tr>
            </thead>
            <tbody>
              {HEADER.map(([k, label, fmt]) => {
                const x = fmt(a.record);
                const y = fmt(b.record);
                return (
                  <tr key={k} className={cx(x !== y && 'qt-changed')}>
                    <th scope="row">{label}</th>
                    <td>{x || <EmptyValue />}</td>
                    <td>{y || <EmptyValue />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h2 className="panel-title">Line items</h2>
        <div className="table-scroll">
          <table className="mini-table qt-compare">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Change</th>
                <th scope="col">{String(a.record.quoteNo)}</th>
                <th scope="col">{String(b.record.quoteNo)}</th>
              </tr>
            </thead>
            <tbody>
              {diff.map((row) => (
                <tr key={row.key} className={cx(row.state !== 'same' && 'qt-changed')}>
                  <th scope="row">{(row.b ?? row.a)?.description}</th>
                  <td>
                    <span className={`tag tone-${row.state === 'added' ? 'success' : row.state === 'removed' ? 'danger' : row.state === 'changed' ? 'warning' : 'neutral'}`}>{row.state === 'same' ? 'Unchanged' : row.state[0].toUpperCase() + row.state.slice(1)}</span>
                  </td>
                  <td>{lineText(row.a) || <EmptyValue />}</td>
                  <td>{lineText(row.b) || <EmptyValue />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {b.record.revisionNote ? <p className="muted small">Revision note: {String(b.record.revisionNote)}</p> : null}
      </section>
    </div>
  );
}
