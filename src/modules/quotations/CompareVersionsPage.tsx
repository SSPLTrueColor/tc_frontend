import { Link, useParams, useSearchParams } from 'react-router-dom';
import { L } from '../../constants/labels';
import { recordPeekPath } from '../../lib/routes';
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

const C = L.quotations.compare;
const F = L.quotations.fields.quotations;
const HEADER: [string, string, (r: RecordData) => string][] = [
  ['status', F.status, (r) => masterLabel('quoteStatus', r.status)],
  ['quoteDate', F.quoteDate, (r) => formatDate(String(r.quoteDate))],
  ['validUntil', F.validUntil, (r) => formatDate(String(r.validUntil))],
  ['placeOfSupply', F.placeOfSupply, (r) => masterLabel('state', r.placeOfSupply)],
  ['subtotal', F.subtotal, (r) => formatMoney(Number(r.subtotal) || 0)],
  ['discountTotal', F.discountTotal, (r) => formatMoney(Number(r.discountTotal) || 0)],
  ['maxDiscountPct', C.highestDiscount, (r) => `${Number(r.maxDiscountPct) || 0}%`],
  ['freight', F.freight, (r) => formatMoney(Number(r.freight) || 0)],
  ['insurance', F.insurance, (r) => formatMoney(Number(r.insurance) || 0)],
  ['grandTotal', C.total, (r) => formatMoney(Number(r.grandTotal) || 0)],
  ['paymentTerms', F.paymentTerms, (r) => String(r.paymentTerms ?? '')],
  ['deliveryTerms', C.delivery, (r) => String(r.deliveryTerms ?? '')],
  ['warrantyTerms', F.warrantyTerms, (r) => String(r.warrantyTerms ?? '')],
];

const lineText = (l?: QuoteLine) => (l ? `${l.qty} × ${formatMoney(l.listPrice)} − ${formatMoney(lineAmounts(l).discount)} = ${formatMoney(lineAmounts(l).net)} · ${L.quotations.lineTable.gst} ${l.gstRate}%` : '');

/** ROUTES.quotationCompare (?with=<id>) — Compare Versions side by side (FR-043). */
export function CompareVersionsPage() {
  const { recordId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const actor = useActor();
  const base = useServiceQuery(() => getQuote(actor, recordId), [recordId, actor.user.id]);
  const revs = base.data?.revisions ?? [];
  const idx = revs.findIndex((r) => r.id === recordId);
  // ?with= must be another version of the same quotation; anything else falls back to the previous version.
  const asked = params.get('with');
  const withId = !base.data ? asked ?? '' : asked && asked !== recordId && revs.some((r) => r.id === asked) ? asked : idx > 0 ? revs[idx - 1].id : revs.find((r) => r.id !== recordId)?.id ?? '';
  const other = useServiceQuery(() => (withId ? getQuote(actor, withId) : null), [withId, actor.user.id]);
  const title = base.data ? C.title(String(base.data.record.quoteNo).replace(/-R\d+$/, '')) : L.nav.pages.quotationCompare.title;
  if (base.error || other.error)
    return (
      <div className="page">
        <PageHeader title={title} />
        <ErrorState title={C.loadError} onRetry={() => (base.retry(), other.retry())}>
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
        <EmptyState icon="columns" title={C.onlyOne}>
          {C.onlyOneBody} <Link to={recordPeekPath('tc', 'quotations', recordId)}>{L.quotations.actions.backToQuotation}</Link>
        </EmptyState>
      </div>
    );
  // Older version on the left.
  const [a, b] = Number(other.data.record.revision) <= Number(base.data.record.revision) ? [other.data, base.data] : [base.data, other.data];
  const diff = compareLines(a.lines, b.lines);
  const opts = revs.filter((r) => r.id !== recordId).map((r) => ({ value: r.id, label: `R${Number(r.revision) || 0} · ${masterLabel('quoteStatus', r.status)}` }));
  return (
    <div className="page">
      <PageHeader title={title} description={C.description} />
      <div className="toolbar">
        <span className="muted small">{C.comparing(Number(base.data.record.revision) || 0)}</span>
        <SelectMenu label={C.compareWith} value={withId} options={opts} onChange={(v) => setParams({ with: v })} />
        <span className="spacer" />
        <Link className="link small" to={recordPeekPath('tc', 'quotations', recordId)}>
          {L.quotations.actions.backToQuotation}
        </Link>
      </div>
      <section className="panel">
        <div className="table-scroll">
          <table className="mini-table qt-compare">
            <thead>
              <tr>
                <th scope="col">{C.field}</th>
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
        <h2 className="panel-title">{C.lineItems}</h2>
        <div className="table-scroll">
          <table className="mini-table qt-compare">
            <thead>
              <tr>
                <th scope="col">{L.quotations.lineTable.item}</th>
                <th scope="col">{C.change}</th>
                <th scope="col">{String(a.record.quoteNo)}</th>
                <th scope="col">{String(b.record.quoteNo)}</th>
              </tr>
            </thead>
            <tbody>
              {diff.map((row) => (
                <tr key={row.key} className={cx(row.state !== 'same' && 'qt-changed')}>
                  <th scope="row">{(row.b ?? row.a)?.description}</th>
                  <td>
                    <span className={`tag tone-${row.state === 'added' ? 'success' : row.state === 'removed' ? 'danger' : row.state === 'changed' ? 'warning' : 'neutral'}`}>{C.state[row.state]}</span>
                  </td>
                  <td>{lineText(row.a) || <EmptyValue />}</td>
                  <td>{lineText(row.b) || <EmptyValue />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {b.record.revisionNote ? <p className="muted small">{C.versionNote(String(b.record.revisionNote))}</p> : null}
      </section>
    </div>
  );
}
