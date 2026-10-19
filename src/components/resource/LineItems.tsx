import type { RecordData } from '../../metadata/types';
import { formatMoney } from '../../lib/format';
import { masterLabel } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { EmptyValue } from '../primitives/display';

/**
 * Generic line item: commercial documents (quotations, orders) use productId / listPrice /
 * discountPct / discountAmt; simple repeaters use unitPrice. Amount = qty × (unit − discount).
 */
export interface AnyLine {
  productId?: string;
  serviceCode?: string;
  description?: string;
  lineType?: string;
  qty: number;
  unitPrice?: number;
  listPrice?: number;
  discountPct?: number;
  discountAmt?: number;
}

export const unitOf = (li: AnyLine) => Number(li.unitPrice ?? li.listPrice ?? 0);
export const discountOf = (li: AnyLine) => (li.discountAmt !== undefined && li.discountAmt !== null && Number(li.discountAmt) > 0 ? Number(li.discountAmt) : (unitOf(li) * Number(li.discountPct ?? 0)) / 100);
export const amountOf = (li: AnyLine) => Math.round(Number(li.qty || 0) * (unitOf(li) - discountOf(li)) * 100) / 100;
const nameOf = (li: AnyLine) => (li.productId ? recordTitle('products', li.productId) : li.serviceCode ? masterLabel('serviceCode', li.serviceCode) : li.description || 'Item');

/** Plain numbered table (owner rule 20): # first, muted headers, total row when there are several items. */
export function LineItemsTable({ items = [], caption }: { items?: AnyLine[]; caption: string }) {
  if (!items.length) return <EmptyValue />;
  const hasDiscount = items.some((li) => discountOf(li) > 0);
  const total = items.reduce((t, li) => t + amountOf(li), 0);
  return (
    <table className="mini-table detail-items-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="col-n">
            #
          </th>
          <th scope="col">Item</th>
          <th scope="col">Qty</th>
          <th scope="col">Unit price</th>
          {hasDiscount && <th scope="col">Discount</th>}
          <th scope="col">Amount</th>
        </tr>
      </thead>
      <tbody>
        {items.map((li, i) => (
          <tr key={i}>
            <td className="col-n">{i + 1}</td>
            <td>
              {nameOf(li)}
              {li.description && li.productId ? <div className="muted small">{li.description}</div> : null}
            </td>
            <td>{li.qty}</td>
            <td>{formatMoney(unitOf(li))}</td>
            {hasDiscount && <td>{discountOf(li) ? formatMoney(discountOf(li)) : <EmptyValue />}</td>}
            <td>{formatMoney(amountOf(li))}</td>
          </tr>
        ))}
      </tbody>
      {items.length > 1 && (
        <tfoot>
          <tr>
            <td colSpan={hasDiscount ? 5 : 4}>Total before tax</td>
            <td>{formatMoney(total)}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

export const lineItemsOf = (record: RecordData, key: string) => (record[key] as AnyLine[] | undefined) ?? [];
