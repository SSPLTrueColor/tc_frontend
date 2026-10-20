/** Building blocks for KPI specs and column totals — every figure is computed from the report's rows. */
import type { Metric, ReportRow } from './types';

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};

export const rowNum = num;

/** Rows in the report. */
export const count: Metric = (rows) => rows.length;

/** Rows matching a condition. */
export const countIf =
  (test: (r: ReportRow) => boolean): Metric =>
  (rows) =>
    rows.filter(test).length;

/** Sum of a column (blank cells count as nothing). */
const addUp = (rows: ReportRow[], key: string) => rows.reduce((t, r) => t + (num(r[key]) ?? 0), 0);
export const sum =
  (key: string): Metric =>
  (rows) =>
    addUp(rows, key);

/** Σ numerator ÷ Σ denominator; null when the denominator is zero. */
export const ratio =
  (numKey: string, denKey: string): Metric =>
  (rows) => {
    const d = addUp(rows, denKey);
    return d ? addUp(rows, numKey) / d : null;
  };

/** Mean of a column weighted by another (e.g. MTTR weighted by resolved tickets); skips blank cells. */
export const weighted =
  (key: string, weightKey: string): Metric =>
  (rows) => {
    let w = 0;
    let t = 0;
    rows.forEach((r) => {
      const v = num(r[key]);
      const x = num(r[weightKey]);
      if (v === null || x === null || !x) return;
      w += x;
      t += v * x;
    });
    return w ? t / w : null;
  };

/** Plain mean of the non-blank cells of a column. */
export const mean =
  (key: string): Metric =>
  (rows) => {
    const xs = rows.map((r) => num(r[key])).filter((x): x is number => x !== null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };

export const maxOf =
  (key: string): Metric =>
  (rows) => {
    const xs = rows.map((r) => num(r[key])).filter((x): x is number => x !== null);
    return xs.length ? Math.max(...xs) : null;
  };

/** Sum of a column over rows matching a condition. */
export const sumIf =
  (key: string, test: (r: ReportRow) => boolean): Metric =>
  (rows) =>
    addUp(rows.filter(test), key);

/** Value of a column on the row with this key (for one-row-per-figure reports like the scorecard). */
export const cell =
  (rowKey: string, key: string): Metric =>
  (rows) => {
    const r = rows.find((x) => x._key === rowKey);
    return r ? num(r[key]) : null;
  };
