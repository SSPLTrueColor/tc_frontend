import { L } from '../../constants/labels';
import { formatMoney } from '../../lib/format';
import { masterLabel } from '../../services/registry';
import { lineAmounts, type QuoteLine, type QuoteTotals } from '../../services/quotations/pricing';
import { EmptyValue } from '../../components/primitives/display';
import { Table } from '../../components/primitives/Table';

const T = L.quotations;
const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

/** Read-only line items (Line Items tab, Quotation PDF). Landed cost only when `showMargin`. */
export function LinesTable({ lines, showMargin, compact }: { lines: QuoteLine[]; showMargin?: boolean; compact?: boolean }) {
  const H = T.lineTable;
  if (!lines.length) return <p className="muted">{H.empty}</p>;
  return (
    
      <Table className="qt-lines">
        <thead>
          <tr>
            <th scope="col" className="col-n">
              #
            </th>
            <th scope="col">{H.item}</th>
            {!compact && <th scope="col">{H.hsnSac}</th>}
            <th scope="col" className="num">
              {H.qty}
            </th>
            <th scope="col" className="num">
              {H.listPrice}
            </th>
            <th scope="col" className="num">
              {H.discount}
            </th>
            <th scope="col" className="num">
              {H.net}
            </th>
            <th scope="col" className="num">
              {H.gst}
            </th>
            {showMargin && (
              <th scope="col" className="num">
                {H.landedCost}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const a = lineAmounts(l);
            return (
              <tr key={i}>
                <td className="col-n">{i + 1}</td>
                <td>
                  <strong>{l.description || <EmptyValue />}</strong>
                  <div className="muted small">{masterLabel('quoteLineType', l.lineType)}</div>
                </td>
                {!compact && <td className="mono">{l.hsnSac}</td>}
                <td className="num">{l.qty}</td>
                <td className="num">{formatMoney(l.listPrice)}</td>
                <td className="num">{a.discount ? `${formatMoney(a.discount)} (${pct(a.effectivePct)})` : formatMoney(0)}</td>
                <td className="num">{formatMoney(a.net)}</td>
                <td className="num">{l.gstRate}%</td>
                {showMargin && <td className="num">{l.landedCost !== null && l.landedCost !== undefined ? formatMoney(l.landedCost * l.qty) : <EmptyValue />}</td>}
              </tr>
            );
          })}
        </tbody>
      </Table>
    
  );
}

type TotalsInput = Pick<QuoteTotals, 'subtotal' | 'discountTotal' | 'freight' | 'insurance' | 'taxable' | 'cgst' | 'sgst' | 'igst' | 'grandTotal' | 'amountInWords' | 'landedCostTotal' | 'marginPct'>;

/** Totals block: list value, discount, freight, insurance, taxable, CGST/SGST or IGST, total, words. */
/** `interState` (place of supply ≠ company GST state) picks IGST vs CGST + SGST even when the tax is ₹0. */
export function TotalsBlock({ t, showMargin, interState }: { t: TotalsInput; showMargin?: boolean; interState?: boolean }) {
  const X = T.totals;
  const row = (label: string, value: number | null | undefined, strong = false) => (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd className="num">{strong ? <strong>{formatMoney(Number(value) || 0)}</strong> : formatMoney(Number(value) || 0)}</dd>
    </div>
  );
  return (
    <dl className="detail-list qt-totals">
      {row(X.listValue, t.subtotal)}
      {Number(t.discountTotal) > 0 && row(X.discount, -Number(t.discountTotal))}
      {Number(t.freight) > 0 && row(X.freight, t.freight)}
      {Number(t.insurance) > 0 && row(X.insurance, t.insurance)}
      {row(X.taxable, t.taxable)}
      {(interState ?? Number(t.igst) > 0) ? (
        row(X.igst, t.igst)
      ) : (
        <>
          {row(X.cgst, t.cgst)}
          {row(X.sgst, t.sgst)}
        </>
      )}
      {row(X.total, t.grandTotal, true)}
      <div className="detail-row">
        <dt>{X.inWords}</dt>
        <dd>{t.amountInWords}</dd>
      </div>
      {showMargin && t.landedCostTotal !== null && t.landedCostTotal !== undefined && (
        <>
          {row(X.landedCost, t.landedCostTotal)}
          <div className="detail-row">
            <dt>{X.margin}</dt>
            <dd className="num">{t.marginPct === null || t.marginPct === undefined ? <EmptyValue /> : pct(Number(t.marginPct))}</dd>
          </div>
        </>
      )}
    </dl>
  );
}

/** GST summary by rate (Pricing & GST tab, Quotation PDF). */
export function TaxSummary({ totals, className = '', interState }: { totals: Pick<QuoteTotals, 'taxByRate' | 'igst'>; className?: string; interState?: boolean }) {
  const C = T.tabContent;
  const igst = interState ?? Number(totals.igst) > 0;
  return (
    <div className="table-scroll">
      <table className={`mini-table ${className}`.trim()}>
        <thead>
          <tr>
            <th scope="col">{C.gstRate}</th>
            <th scope="col" className="num">
              {C.taxableCol}
            </th>
            {igst ? (
              <th scope="col" className="num">
                {T.totals.igst}
              </th>
            ) : (
              <>
                <th scope="col" className="num">
                  {T.totals.cgst}
                </th>
                <th scope="col" className="num">
                  {T.totals.sgst}
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
              {igst ? (
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
    </div>
  );
}
