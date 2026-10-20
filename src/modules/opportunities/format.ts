import { formatMoney } from '../../lib/format';

/** Compact Indian money for dense tables: ₹12.4 L, ₹1.25 Cr; small values in full. */
export function moneyShort(n: number): string {
  // Crores keep Indian digit grouping (₹1,250.50 Cr), never a bare ₹125050.00 Cr.
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return formatMoney(Math.round(n));
}
