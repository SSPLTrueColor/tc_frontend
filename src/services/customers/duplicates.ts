/**
 * Duplicate detection (CUS-06, BR-01): exact GSTIN / mobile / email matches block,
 * fuzzy company-name matches (Dice similarity on normalised names ≥ 0.85) warn.
 */
import type { RecordData } from '../../metadata/types';
import { normaliseMobile } from '../../lib/validators';

export const FUZZY_THRESHOLD = 0.85;

const LEGAL_SUFFIXES = /\b(private|pvt|limited|ltd|llp|co|company|corporation|corp|inc|and|the|&|m\/s|ms)\b/g;

/** Lower-cased company name without legal suffixes and punctuation. */
export function normaliseName(name: unknown): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[.,()'"/-]/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s: string): string[] {
  const t = s.replace(/\s/g, '');
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice coefficient on character bigrams of normalised names (0–1). */
export function nameSimilarity(a: unknown, b: unknown): number {
  const x = normaliseName(a);
  const y = normaliseName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const ax = bigrams(x);
  const by = bigrams(y);
  if (!ax.length || !by.length) return 0;
  const counts = new Map<string, number>();
  ax.forEach((g) => counts.set(g, (counts.get(g) ?? 0) + 1));
  let inter = 0;
  by.forEach((g) => {
    const n = counts.get(g) ?? 0;
    if (n > 0) {
      inter++;
      counts.set(g, n - 1);
    }
  });
  return (2 * inter) / (ax.length + by.length);
}

export interface ExactMatch {
  id: string;
  name: string;
  field: 'gstin' | 'mobile' | 'email';
}

const norm = {
  gstin: (v: unknown) => String(v ?? '').trim().toUpperCase(),
  mobile: (v: unknown) => normaliseMobile(String(v ?? '')),
  email: (v: unknown) => String(v ?? '').trim().toLowerCase(),
};

/** Exact GSTIN match among customers (excluding `selfId`). */
export function exactCustomerMatches(all: RecordData[], candidate: Record<string, unknown>, selfId?: string): ExactMatch[] {
  const g = norm.gstin(candidate.gstin);
  if (!g) return [];
  return all.filter((c) => c.id !== selfId && norm.gstin(c.gstin) === g).map((c) => ({ id: c.id, name: String(c.name), field: 'gstin' as const }));
}

/** Exact mobile / email matches among contacts (excluding `selfId`). */
export function exactContactMatches(all: RecordData[], candidate: Record<string, unknown>, selfId?: string): ExactMatch[] {
  const out: ExactMatch[] = [];
  const m = norm.mobile(candidate.mobile);
  const e = norm.email(candidate.email);
  for (const c of all) {
    if (c.id === selfId) continue;
    if (m && norm.mobile(c.mobile) === m) out.push({ id: c.id, name: String(c.name), field: 'mobile' });
    else if (e && norm.email(c.email) === e) out.push({ id: c.id, name: String(c.name), field: 'email' });
  }
  return out;
}

/** Customers whose names look like `name` (≥ threshold), best first. */
export function fuzzyCustomerMatches(all: RecordData[], name: unknown, selfId?: string, threshold = FUZZY_THRESHOLD) {
  return all
    .filter((c) => c.id !== selfId)
    .map((c) => ({ id: c.id, name: String(c.name), score: nameSimilarity(name, c.name) }))
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

export interface DuplicateGroup {
  kind: 'gstin' | 'name' | 'contact';
  reason: string;
  ids: string[];
  score?: number;
}

/** Every likely duplicate pair/group across customers and contacts (admin review list). */
export function findDuplicateGroups(customers: RecordData[], contacts: RecordData[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const byGstin = new Map<string, string[]>();
  customers.forEach((c) => {
    const g = norm.gstin(c.gstin);
    if (g) byGstin.set(g, [...(byGstin.get(g) ?? []), c.id]);
  });
  byGstin.forEach((ids, g) => ids.length > 1 && groups.push({ kind: 'gstin', reason: `Same GSTIN ${g}`, ids }));
  const seen = new Set<string>();
  for (let i = 0; i < customers.length; i++) {
    for (let j = i + 1; j < customers.length; j++) {
      const a = customers[i];
      const b = customers[j];
      const score = nameSimilarity(a.name, b.name);
      const key = [a.id, b.id].sort().join('|');
      if (score >= FUZZY_THRESHOLD && !seen.has(key) && !(norm.gstin(a.gstin) && norm.gstin(a.gstin) === norm.gstin(b.gstin))) {
        seen.add(key);
        groups.push({ kind: 'name', reason: `Similar names (${Math.round(score * 100)}%)`, ids: [a.id, b.id], score });
      }
    }
  }
  const byPhone = new Map<string, string[]>();
  contacts.forEach((c) => {
    const m = norm.mobile(c.mobile);
    if (m) byPhone.set(m, [...(byPhone.get(m) ?? []), c.id]);
  });
  byPhone.forEach((ids, m) => ids.length > 1 && groups.push({ kind: 'contact', reason: `Contacts share mobile ${m}`, ids }));
  return groups;
}
