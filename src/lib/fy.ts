import { now } from './clock';

/** Indian financial year (April–March) as "2627" for 2026-27. */
export function fyCode(d = now()): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(y).slice(2)}${String(y + 1).slice(2)}`;
}

/** "26-27" style label for document numbers (e.g. QT/TX/26-27/0001). */
export const fyLabel = (d = now()) => `${fyCode(d).slice(0, 2)}-${fyCode(d).slice(2)}`;
