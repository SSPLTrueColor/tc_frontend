import { formatMoney } from '../../lib/format';

/** Compact Indian money for dense tables: ₹12.4 L, ₹1.25 Cr; small values in full. */
export function moneyShort(n: number): string {
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return formatMoney(Math.round(n));
}
