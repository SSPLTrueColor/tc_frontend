/** Order line maths (QuoteLine shape from docs/CONTRACTS.md) — shared by quotations-to-order and repeat orders. */
import { L } from '../../constants/labels';
import { gstSplit } from '../lookups';

export interface QuoteLine {
  productId: string;
  description: string;
  lineType?: string;
  qty: number;
  listPrice: number;
  discountPct?: number;
  discountAmt?: number;
  hsnSac?: string;
  gstRate: number;
  landedCost?: number;
}

export interface OrderTotals {
  subtotal: number;
  discountTotal: number;
  freight: number;
  insurance: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  grandTotal: number;
  maxDiscountPct: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export const lineGross = (l: QuoteLine) => r2((Number(l.qty) || 0) * (Number(l.listPrice) || 0));
/** Discount in rupees: an explicit amount wins over a percentage. */
export const lineDiscount = (l: QuoteLine) => r2(Number(l.discountAmt) > 0 ? Number(l.discountAmt) : (lineGross(l) * (Number(l.discountPct) || 0)) / 100);
export const lineNet = (l: QuoteLine) => r2(lineGross(l) - lineDiscount(l));
export const lineDiscountPct = (l: QuoteLine) => (lineGross(l) > 0 ? r2((lineDiscount(l) / lineGross(l)) * 100) : 0);

/**
 * BR-16: GST per line by place of supply; freight and insurance are taxed at the main supply's
 * rate (the highest-value line). Rounded to paise.
 */
export function computeTotals(lines: QuoteLine[], placeOfSupply: string, freight = 0, insurance = 0): OrderTotals {
  let subtotal = 0;
  let discountTotal = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let mainRate = 0;
  let mainNet = -1;
  for (const l of lines) {
    const net = lineNet(l);
    subtotal += lineGross(l);
    discountTotal += lineDiscount(l);
    const t = gstSplit(placeOfSupply, net, Number(l.gstRate) || 0);
    cgst += t.cgst;
    sgst += t.sgst;
    igst += t.igst;
    if (net > mainNet) {
      mainNet = net;
      mainRate = Number(l.gstRate) || 0;
    }
  }
  const extras = (Number(freight) || 0) + (Number(insurance) || 0);
  if (extras > 0) {
    const t = gstSplit(placeOfSupply, extras, mainRate);
    cgst += t.cgst;
    sgst += t.sgst;
    igst += t.igst;
  }
  const taxable = r2(subtotal - discountTotal + extras);
  return {
    subtotal: r2(subtotal),
    discountTotal: r2(discountTotal),
    freight: r2(Number(freight) || 0),
    insurance: r2(Number(insurance) || 0),
    taxable,
    cgst: r2(cgst),
    sgst: r2(sgst),
    igst: r2(igst),
    grandTotal: r2(taxable + cgst + sgst + igst),
    maxDiscountPct: lines.reduce((m, l) => Math.max(m, lineDiscountPct(l)), 0),
  };
}

export interface LineDiff {
  added: QuoteLine[];
  removed: QuoteLine[];
  changed: { productId: string; description: string; fields: string[] }[];
  valueChangePct: number;
  discountIncreased: boolean;
}

/** BR-22 differences between the order lines and the reference (accepted quotation or previous version). */
export function diffLines(order: QuoteLine[], reference: QuoteLine[], orderTotal: number, referenceTotal: number): LineDiff {
  const refBy = new Map(reference.map((l) => [l.productId, l]));
  const ordBy = new Map(order.map((l) => [l.productId, l]));
  const added = order.filter((l) => !refBy.has(l.productId));
  const removed = reference.filter((l) => !ordBy.has(l.productId));
  const changed = order
    .filter((l) => refBy.has(l.productId))
    .map((l) => {
      const ref = refBy.get(l.productId)!;
      const fields: string[] = [];
      if (Number(l.qty) !== Number(ref.qty)) fields.push('quantity');
      if (Number(l.listPrice) !== Number(ref.listPrice)) fields.push('price');
      if (lineDiscount(l) !== lineDiscount(ref)) fields.push('discount');
      return { productId: l.productId, description: l.description, fields };
    })
    .filter((c) => c.fields.length);
  const maxOrder = order.reduce((m, l) => Math.max(m, lineDiscountPct(l)), 0);
  const maxRef = reference.reduce((m, l) => Math.max(m, lineDiscountPct(l)), 0);
  return {
    added,
    removed,
    changed,
    valueChangePct: referenceTotal > 0 ? r2(((orderTotal - referenceTotal) / referenceTotal) * 100) : 0,
    discountIncreased: maxOrder > maxRef + 0.001,
  };
}

export function describeDiff(d: LineDiff): string {
  const T = L.orders.diff;
  const parts: string[] = [];
  if (d.added.length) parts.push(T.summaryAdded(d.added.length));
  if (d.removed.length) parts.push(T.summaryRemoved(d.removed.length));
  if (d.changed.length) parts.push(T.summaryChanged(d.changed.length));
  if (d.valueChangePct) parts.push(T.summaryValue(d.valueChangePct));
  if (d.discountIncreased) parts.push(T.summaryDiscount);
  return parts.length ? parts.join(' · ') : T.same;
}
