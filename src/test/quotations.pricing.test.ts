import { computeTotals, lineAmounts, type QuoteLine, roi, rupeesInWords, validateLines } from '../services/quotations/pricing';
import { amountInWords } from '../services/lookups';
import { DEFAULT_POLICIES } from '../services/policies';

const L = (o: Partial<QuoteLine>): QuoteLine => ({ productId: null, description: 'Item', lineType: 'machine', qty: 1, listPrice: 100000, discountPct: 0, discountAmt: 0, hsnSac: '8443', gstRate: 18, landedCost: null, ...o });
const bandLevels = (pct: number) => (DEFAULT_POLICIES.discountBands.find((b) => pct <= b.upTo) ?? DEFAULT_POLICIES.discountBands[3]).levels.map((l) => l.capability);

describe('quotation pricing', () => {
  it('applies % or amount discounts and reports the effective %', () => {
    expect(lineAmounts(L({ discountPct: 10 }))).toMatchObject({ gross: 100000, discount: 10000, net: 90000, effectivePct: 10 });
    expect(lineAmounts(L({ qty: 2, discountAmt: 5000, discountPct: 50 }))).toMatchObject({ gross: 200000, discount: 5000, net: 195000, effectivePct: 2.5 });
  });

  it('splits CGST+SGST within the company state and IGST outside (BR-16)', () => {
    const intra = computeTotals([L({})], '27', 0, 0, '27');
    expect(intra).toMatchObject({ taxable: 100000, cgst: 9000, sgst: 9000, igst: 0, grandTotal: 118000 });
    const inter = computeTotals([L({})], '24', 0, 0, '27');
    expect(inter).toMatchObject({ cgst: 0, sgst: 0, igst: 18000, grandTotal: 118000 });
  });

  it('taxes freight and insurance at the main line rate and totals multiple rates', () => {
    const t = computeTotals([L({ listPrice: 1000000 }), L({ listPrice: 10000, gstRate: 12, lineType: 'ink' })], '24', 20000, 5000, '27');
    expect(t.taxable).toBe(1035000);
    expect(t.igst).toBe(Math.round((1025000 * 0.18 + 10000 * 0.12) * 100) / 100);
    expect(t.taxByRate.map((x) => x.rate)).toEqual([12, 18]);
  });

  it('computes margin over costed lines only (BR-19) and the highest discount', () => {
    const t = computeTotals([L({ discountPct: 10, landedCost: 60000 }), L({ discountPct: 4 })], '27', 0, 0, '27');
    expect(t.maxDiscountPct).toBe(10);
    expect(t.landedCostTotal).toBe(60000);
    expect(t.marginPct).toBe(33.33);
  });

  it('writes amounts in Indian words, matching the shared helper', () => {
    expect(rupeesInWords(1234567.5)).toBe('Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Fifty Paise Only');
    [0, 99, 100000, 25000001, 118000].forEach((n) => expect(rupeesInWords(n)).toBe(amountInWords(n)));
  });

  it('validates lines', () => {
    expect(validateLines([L({})])).toEqual([]);
    const errs = validateLines([L({ qty: 0, discountPct: 120, gstRate: 7, hsnSac: '12', description: '' })]);
    expect(errs.join(' ')).toMatch(/product or enter a description/);
    expect(errs.join(' ')).toMatch(/quantity/);
    expect(errs.join(' ')).toMatch(/between 0 and 100/);
    expect(errs.join(' ')).toMatch(/GST rate/);
    expect(errs.join(' ')).toMatch(/HSN or SAC/);
    expect(validateLines([L({ discountAmt: 200000 })]).join(' ')).toMatch(/exceed the line value/);
  });

  it('maps discount bands to approval levels (BR-17 defaults)', () => {
    expect(bandLevels(5)).toEqual([]);
    expect(bandLevels(7)).toEqual(['approve.l1']);
    expect(bandLevels(12)).toEqual(['approve.l1', 'approve.l2']);
    expect(bandLevels(20)).toEqual(['approve.l1', 'approve.l2', 'approve.l3']);
  });

  it('computes ROI payback (FR-047)', () => {
    expect(roi({ investment: 1200000, outputPerDay: 500, pricePerUnit: 120, costPerUnit: 40, workingDays: 25 })).toMatchObject({ monthlyContribution: 1000000, paybackMonths: 1.2 });
    expect(roi({ investment: 100, outputPerDay: 10, pricePerUnit: 10, costPerUnit: 20, workingDays: 25 }).paybackMonths).toBeNull();
  });
});
