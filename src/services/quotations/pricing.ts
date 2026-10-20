/**
 * Quotation pricing (FR-038, BR-16, BR-19). PURE: imports only from src/lib and the label constants, so the editor, the
 * quotation hooks and the seed share one calculation without import cycles. The editor uses it
 * for a live preview and the hooks re-run it on every save, so stored totals never come from the UI.
 * Price-list lookup (BR-15) lives in workflow.ts (`applyPriceList`) because it reads the store.
 */
import { L } from '../../constants/labels';
import { validateHsnSac } from '../../lib/validators';

export interface QuoteLine {
  productId?: string | null;
  description: string;
  lineType: string;
  qty: number;
  listPrice: number;
  /** Discount as a percentage (0–100). Ignored when `discountAmt` > 0. */
  discountPct: number;
  /** Discount as a rupee amount for the whole line (overrides `discountPct`). */
  discountAmt: number;
  /** Which discount input the user chose (QUO-04 "% or amount"); amount mode also applies while the amount is still 0. */
  discountType?: 'pct' | 'amt';
  hsnSac: string;
  gstRate: number;
  /** Unit landed cost, copied from the price list (financial; hidden unless permitted). */
  landedCost?: number | null;
  /** True when listPrice came from a price list (sales cannot change it). */
  priceLocked?: boolean;
}

export const GST_RATES = [0, 5, 12, 18, 28];

/** Round to paise; toPrecision(12) removes binary noise first (10.05 × 50 % = 5.025 → 5.03, not 5.02). */
const r2 = (n: number) => Math.round(Number((n * 100).toPrecision(12))) / 100;

export interface LineAmounts {
  gross: number;
  discount: number;
  net: number;
  /** Effective discount on this line as % of gross (for approval bands). */
  effectivePct: number;
  tax: number;
}

export function lineAmounts(l: QuoteLine): LineAmounts {
  const gross = r2((Number(l.qty) || 0) * (Number(l.listPrice) || 0));
  const amt = Number(l.discountAmt) || 0;
  // QUO-04: the chosen mode wins — amount mode ignores a stale %, % mode ignores a stale amount (same rule as the editor).
  const byAmount = l.discountType === 'amt' || (l.discountType !== 'pct' && amt > 0);
  const discount = r2(byAmount ? Math.min(Math.max(0, amt), gross) : (gross * Math.min(100, Math.max(0, Number(l.discountPct) || 0))) / 100);
  const net = r2(gross - discount);
  // Rounded UP to 0.01 % so an amount discount of e.g. 5.004 % still counts as "above 5 %" for BR-17 bands.
  const effectivePct = gross ? Math.max(0, Math.ceil((discount / gross) * 10000 - 1e-6) / 100) : 0;
  return { gross, discount, net, effectivePct, tax: r2((net * (Number(l.gstRate) || 0)) / 100) };
}

export interface QuoteTotals {
  subtotal: number;
  discountTotal: number;
  freight: number;
  insurance: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  grandTotal: number;
  amountInWords: string;
  maxDiscountPct: number;
  landedCostTotal: number | null;
  marginPct: number | null;
  /** Tax rows grouped by GST rate, for the printed tax summary. */
  taxByRate: { rate: number; taxable: number; cgst: number; sgst: number; igst: number }[];
}

/**
 * BR-16: CGST+SGST when the place of supply is the company's GST state, otherwise IGST.
 * Freight and insurance are taxed at the rate of the highest-value line (Assumption, REQUIREMENTS BR-16).
 */
/**
 * BR-16 split with the company state passed in. Worked in whole paise so binary floating point never
 * tips a half-paisa the wrong way; CGST and SGST are each taxable × rate/2 (always equal).
 */
function split(sameState: boolean, taxable: number, ratePct: number) {
  const paise = Math.round(taxable * 100);
  if (sameState) {
    const half = Math.round((paise * ratePct) / 200) / 100;
    return { cgst: half, sgst: half, igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: Math.round((paise * ratePct) / 100) / 100 };
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const three = (n: number) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${two(n % 100)}` : ''}` : two(n));

/** Indian-system words (same output as lookups.amountInWords; duplicated to keep this file pure). */
export function rupeesInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1000);
  const rest = rupees % 1000;
  if (crore) parts.push(`${crore >= 1000 ? rupeesInWords(crore).replace(/^Rupees | Only$/g, '') : three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  return `Rupees ${parts.join(' ') || 'Zero'}${paise ? ` and ${two(paise)} Paise` : ''} Only`;
}

/** `companyState` = True Colors' GST state (getPolicies().companyGstState at the call site). */
export function computeTotals(lines: QuoteLine[], placeOfSupply: string, freight: number, insurance: number, companyState: string): QuoteTotals {
  const sameState = placeOfSupply === companyState;
  const amounts = lines.map(lineAmounts);
  const subtotal = r2(amounts.reduce((s, a) => s + a.gross, 0));
  const discountTotal = r2(amounts.reduce((s, a) => s + a.discount, 0));
  const net = r2(subtotal - discountTotal);
  const mainIdx = amounts.reduce((best, a, i) => (a.net > (amounts[best]?.net ?? -1) ? i : best), 0);
  const mainRate = lines[mainIdx]?.gstRate ?? 18;
  const extras = r2((Number(freight) || 0) + (Number(insurance) || 0));
  const byRate = new Map<number, number>();
  lines.forEach((l, i) => byRate.set(Number(l.gstRate) || 0, r2((byRate.get(Number(l.gstRate) || 0) ?? 0) + amounts[i].net)));
  if (extras) byRate.set(mainRate, r2((byRate.get(mainRate) ?? 0) + extras));
  const taxByRate = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, taxable]) => ({ rate, taxable, ...split(sameState, taxable, rate) }));
  const cgst = r2(taxByRate.reduce((s, t) => s + t.cgst, 0));
  const sgst = r2(taxByRate.reduce((s, t) => s + t.sgst, 0));
  const igst = r2(taxByRate.reduce((s, t) => s + t.igst, 0));
  const taxable = r2(net + extras);
  const grandTotal = r2(taxable + cgst + sgst + igst);
  const costed = lines.filter((l) => l.landedCost !== null && l.landedCost !== undefined);
  const landedCostTotal = costed.length ? r2(costed.reduce((s, l) => s + (Number(l.qty) || 0) * Number(l.landedCost), 0)) : null;
  const costedNet = r2(lines.reduce((s, l, i) => (l.landedCost !== null && l.landedCost !== undefined ? s + amounts[i].net : s), 0));
  // BR-19: margin = (net price − landed cost) / net price, over lines that have a landed cost.
  const marginPct = landedCostTotal !== null && costedNet > 0 ? r2(((costedNet - landedCostTotal) / costedNet) * 100) : null;
  return {
    subtotal,
    discountTotal,
    freight: r2(Number(freight) || 0),
    insurance: r2(Number(insurance) || 0),
    taxable,
    cgst,
    sgst,
    igst,
    grandTotal,
    amountInWords: rupeesInWords(grandTotal),
    maxDiscountPct: amounts.length ? Math.max(...amounts.map((a) => a.effectivePct)) : 0,
    landedCostTotal,
    marginPct,
    taxByRate,
  };
}

/** Field-level checks for each line (returned as "Line n: …" messages). */
export function validateLines(lines: QuoteLine[]): string[] {
  const errors: string[] = [];
  const M = L.quotations.lineErrors;
  lines.forEach((l, i) => {
    const err = (m: string) => errors.push(`${M.line(i + 1)}: ${m}`);
    if (!l.productId && !String(l.description ?? '').trim()) err(M.productOrDescription);
    if (!Number.isInteger(Number(l.qty)) || Number(l.qty) < 1) err(M.quantity);
    if (!(Number(l.listPrice) >= 0)) err(M.listPrice);
    const pct = Number(l.discountPct) || 0;
    if (pct < 0 || pct > 100) err(M.discountRange);
    const amt = Number(l.discountAmt) || 0;
    if (amt < 0) err(M.discountNegative);
    if (amt > (Number(l.qty) || 0) * (Number(l.listPrice) || 0)) err(M.discountExceeds);
    if (!GST_RATES.includes(Number(l.gstRate))) err(M.gstRate(GST_RATES.join(', ')));
    if (!l.hsnSac || validateHsnSac(String(l.hsnSac))) err(M.hsnSac);
  });
  return errors;
}

/** Normalises numbers coming from forms. */
export function cleanLines(lines: unknown): QuoteLine[] {
  if (!Array.isArray(lines)) return [];
  return lines.map((x) => {
    const l = x as Partial<QuoteLine>;
    return {
      productId: l.productId || null,
      description: String(l.description ?? '').trim(),
      lineType: String(l.lineType || 'other'),
      qty: Number(l.qty) || 0,
      listPrice: Number(l.listPrice) || 0,
      discountPct: Number(l.discountPct) || 0,
      discountAmt: Number(l.discountAmt) || 0,
      ...(l.discountType === 'amt' || l.discountType === 'pct' ? { discountType: l.discountType } : {}),
      hsnSac: String(l.hsnSac ?? '').trim(),
      gstRate: Number(l.gstRate) || 0,
      landedCost: l.landedCost === null || l.landedCost === undefined || (l.landedCost as unknown) === '' ? null : Number(l.landedCost),
      priceLocked: !!l.priceLocked,
    };
  });
}

/** ROI / payback (FR-047): monthly contribution and months to recover the quotation value. */
export function roi(input: { investment: number; outputPerDay: number; pricePerUnit: number; costPerUnit: number; workingDays: number }) {
  const perUnit = (Number(input.pricePerUnit) || 0) - (Number(input.costPerUnit) || 0);
  const monthly = r2(perUnit * (Number(input.outputPerDay) || 0) * (Number(input.workingDays) || 0));
  const months = monthly > 0 ? r2((Number(input.investment) || 0) / monthly) : null;
  return { contributionPerUnit: r2(perUnit), monthlyContribution: monthly, annualContribution: r2(monthly * 12), paybackMonths: months };
}
