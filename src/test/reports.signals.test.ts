import { signalBars } from '../modules/reports/components';

const bars = [10, 20, 30, 60].map((v, i) => ({ key: `k${i}`, label: `L${i}`, value: v })); // average 30

describe('chart signal colours', () => {
  it('higher is better: at/above average green, below amber', () => {
    expect(signalBars(bars, 'higher').data.map((d) => d.tone)).toEqual(['warning', 'warning', 'success', 'success']);
  });
  it('lower is better: ≤ average green, above amber, ≥ 1.5× red', () => {
    expect(signalBars(bars, 'lower').data.map((d) => d.tone)).toEqual(['success', 'success', 'success', 'danger']);
  });
  it('ageing: newest green, middle amber, oldest red', () => {
    expect(signalBars(bars, 'ageing').data.map((d) => d.tone)).toEqual(['success', 'warning', 'warning', 'danger']);
  });
  it('neutral: one colour and no legend', () => {
    const r = signalBars(bars, 'neutral');
    expect(new Set(r.data.map((d) => d.tone))).toEqual(new Set(['info']));
    expect(r.legend).toBeUndefined();
  });
});
