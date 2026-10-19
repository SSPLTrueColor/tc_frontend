import { formatMoney } from '../../lib/format';
import { masterLabel } from '../../services/registry';
import { lineAmounts, type QuoteLine, type QuoteTotals } from '../../services/quotations/pricing';
import { EmptyValue } from '../../components/primitives/display';

const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

/** Read-only line items (Lines tab, print view). Landed cost only when `showMargin`. */
export function LinesTable({ lines, showMargin, compact }: { lines: QuoteLine[]; showMargin?: boolean; compact?: boolean }) {
  if (!lines.length) return <p className="muted">No line items.</p>;
  return (
    <div className="table-scroll">
      <table className="mini-table qt-lines">
        <thead>
          <tr>
            <th scope="col" className="col-n">
              #
            </th>
            <th scope="col">Item</th>
            {!compact && <th scope="col">HSN / SAC</th>}
            <th scope="col" className="num">
              Qty
            </th>
            <th scope="col" className="num">
              List price
            </th>
            <th scope="col" className="num">
              Discount
            </th>
            <th scope="col" className="num">
              Net
            </th>
            <th scope="col" className="num">
              GST
            </th>
            {showMargin && (
              <th scope="col" className="num">
                Landed cost
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
      </table>
    </div>
  );
}

/** Totals block: gross, discount, freight, insurance, taxable, CGST/SGST or IGST, total, words. */
export function TotalsBlock({ t, showMargin }: { t: Pick<QuoteTotals, 'subtotal' | 'discountTotal' | 'freight' | 'insurance' | 'taxable' | 'cgst' | 'sgst' | 'igst' | 'grandTotal' | 'amountInWords' | 'landedCostTotal' | 'marginPct'>; showMargin?: boolean }) {
  const row = (label: string, value: number | null | undefined, strong = false) => (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd className="num">{strong ? <strong>{formatMoney(Number(value) || 0)}</strong> : formatMoney(Number(value) || 0)}</dd>
    </div>
  );
  return (
    <dl className="detail-list qt-totals">
      {row('Gross value', t.subtotal)}
      {Number(t.discountTotal) > 0 && row('Discount', -Number(t.discountTotal))}
      {Number(t.freight) > 0 && row('Freight', t.freight)}
      {Number(t.insurance) > 0 && row('Insurance', t.insurance)}
      {row('Taxable value', t.taxable)}
      {Number(t.igst) > 0 ? row('IGST', t.igst) : (
        <>
          {row('CGST', t.cgst)}
          {row('SGST', t.sgst)}
        </>
      )}
      {row('Total', t.grandTotal, true)}
      <div className="detail-row">
        <dt>In words</dt>
        <dd>{t.amountInWords}</dd>
      </div>
      {showMargin && t.landedCostTotal !== null && t.landedCostTotal !== undefined && (
        <>
          {row('Landed cost', t.landedCostTotal)}
          <div className="detail-row">
            <dt>Margin</dt>
            <dd className="num">{t.marginPct === null || t.marginPct === undefined ? <EmptyValue /> : pct(Number(t.marginPct))}</dd>
          </div>
        </>
      )}
    </dl>
  );
}
