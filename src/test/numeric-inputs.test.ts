/** Plan 1.8 (COM-05): numbers are rejected, never silently changed; sensible bounds with sentence-case messages. */
import { createElement, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { createDb, __setDb } from '../services/db';
import { NUMBER_LIMITS, numberRangeError, parseNumberText, validateField } from '../services/validation';
import { validateLines, type QuoteLine } from '../services/quotations/pricing';
import { getResource } from '../services/registry';
import { NumberInput } from '../components/primitives/NumberInput';
import { L } from '../constants/labels';
import '../domain/extensions/index';

const V = L.common.form.v;
const line = (p: Partial<QuoteLine>): QuoteLine => ({ productId: null, description: 'Ink', lineType: 'ink', qty: 1, listPrice: 1000, discountPct: 0, discountAmt: 0, hsnSac: '3215', gstRate: 18, landedCost: null, priceLocked: false, ...p });

describe('parseNumberText', () => {
  it('rejects minus signs, exponents, plus signs and letters instead of stripping them', () => {
    expect(parseNumberText('-2', NUMBER_LIMITS.qty)).toMatchObject({ error: V.noNegative });
    expect(Number.isNaN(parseNumberText('-2', NUMBER_LIMITS.qty).value)).toBe(true);
    for (const bad of ['1e6', '1E6', '+5', '-', '12abc', '1.2.3']) expect(parseNumberText(bad).error, bad).toBe(V.digitsOnly);
  });

  it('accepts plain numbers and Indian grouping; empty is null', () => {
    expect(parseNumberText('42')).toEqual({ value: 42, error: undefined });
    expect(parseNumberText('1,00,000', NUMBER_LIMITS.amount).value).toBe(100000);
    expect(parseNumberText('  ')).toEqual({ value: null });
  });

  it('allows negatives only when the rule permits them (min < 0)', () => {
    expect(parseNumberText('-12.5', { min: -90, max: 90 })).toEqual({ value: -12.5, error: undefined });
  });

  it('enforces quantity 1–9,999, discount 0–100 % and amounts up to ₹99,99,99,999', () => {
    expect(parseNumberText('0', NUMBER_LIMITS.qty).error).toBe(V.between('1', '9,999'));
    expect(parseNumberText('10000', NUMBER_LIMITS.qty).error).toBe(V.between('1', '9,999'));
    expect(parseNumberText('2.5', NUMBER_LIMITS.qty).error).toBe(V.wholeNumber);
    expect(parseNumberText('101', NUMBER_LIMITS.discountPct).error).toBeTruthy();
    expect(parseNumberText('100', NUMBER_LIMITS.discountPct).error).toBeUndefined();
    expect(parseNumberText('1000000000', NUMBER_LIMITS.amount).error).toMatch(/99,99,99,999/);
    expect(numberRangeError(NaN)).toBe(V.digitsOnly);
  });

  it('messages are sentence case', () => {
    for (const m of [V.noNegative, V.digitsOnly, V.wholeNumber, V.between(1, 2)]) expect(m[0]).toBe(m[0].toUpperCase());
  });
});

describe('form fields and quotation lines', () => {
  beforeEach(() => __setDb(createDb(new Date())));

  it('money and number fields refuse negatives and typed exponents', () => {
    const budget = getResource('leads').fields.find((f) => f.key === 'budget')!;
    expect(validateField(budget, -500, {})).toBe(V.noNegative);
    expect(validateField(budget, '1e6', {})).toBe(V.digitsOnly);
    expect(validateField(budget, 1_000_000_000, {})).toMatch(/99,99,99,999/);
    expect(validateField(budget, 2_500_000, {})).toBeUndefined();
  });

  it('quotation lines reject quantities above 9,999 and NaN quantities', () => {
    expect(validateLines([line({ qty: 10_000 })]).join()).toMatch(/9,999/);
    expect(validateLines([line({ qty: NaN })]).length).toBe(1);
    expect(validateLines([line({ discountPct: 150 })]).length).toBe(1);
    expect(validateLines([line({ qty: 5, discountPct: 10 })])).toEqual([]);
  });
});

describe('NumberInput', () => {
  function Harness() {
    const [v, setV] = useState<number | null>(2);
    return createElement('div', null, createElement(NumberInput, { 'aria-label': 'Quantity', rule: NUMBER_LIMITS.qty, value: v, onValueChange: (n: number | null) => setV(n) }), createElement('output', { 'data-testid': 'value' }, String(v)));
  }

  it('keeps "-2" visible with an inline error and reports NaN (not 2)', () => {
    render(createElement(Harness));
    const input = screen.getByLabelText('Quantity') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-2' } });
    expect(input.value).toBe('-2');
    expect(screen.getByRole('alert').textContent).toBe(V.noNegative);
    expect(screen.getByTestId('value').textContent).toBe('NaN');
    fireEvent.change(input, { target: { value: '1e6' } });
    expect(input.value).toBe('1e6');
    expect(screen.getByRole('alert').textContent).toBe(V.digitsOnly);
    fireEvent.change(input, { target: { value: '12' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('value').textContent).toBe('12');
  });
});
