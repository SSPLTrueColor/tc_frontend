/** Typed filter AST evaluation — shared by grid, saved views, board, calendar, exports and work queues. */
import type { FilterCondition, FilterGroup, FilterOperator, FieldDefinition } from '../metadata/types';
import { addDays, todayKey } from '../lib/dates';
import { uid } from '../lib/ids';

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  gt: 'greater than',
  lt: 'less than',
  gte: 'at least',
  lte: 'at most',
  in: 'is any of',
  empty: 'is empty',
  notEmpty: 'is not empty',
  today: 'is today',
  next7: 'is in next 7 days',
  last30: 'is in last 30 days',
  past: 'is before today',
  future: 'is after today',
};

export const VALUELESS: FilterOperator[] = ['empty', 'notEmpty', 'today', 'next7', 'last30', 'past', 'future'];

export function operatorsFor(f: FieldDefinition): FilterOperator[] {
  switch (f.type) {
    case 'number':
    case 'money':
    case 'progress':
      return ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'empty', 'notEmpty'];
    case 'date':
    case 'datetime':
      return ['today', 'next7', 'last30', 'past', 'future', 'gte', 'lte', 'empty', 'notEmpty'];
    case 'master':
    case 'relation':
      return ['eq', 'neq', 'empty', 'notEmpty'];
    case 'multimaster':
    case 'people':
      return ['contains', 'empty', 'notEmpty'];
    case 'image':
      return ['empty', 'notEmpty'];
    case 'boolean':
      return ['eq'];
    default:
      return ['contains', 'eq', 'neq', 'empty', 'notEmpty'];
  }
}

const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

export function evalFilterCondition(c: FilterCondition, value: unknown, display?: string): boolean {
  const today = todayKey();
  const s = value === null || value === undefined ? '' : String(value);
  const day = s.slice(0, 10);
  switch (c.operator) {
    case 'empty':
      return empty(value);
    case 'notEmpty':
      return !empty(value);
    case 'today':
      return day === today;
    case 'next7':
      return !!day && day >= today && day <= addDays(today, 7);
    case 'last30':
      return !!day && day <= today && day >= addDays(today, -30);
    case 'past':
      return !!day && day < today;
    case 'future':
      return !!day && day > today;
    case 'eq':
      return typeof value === 'number' ? value === Number(c.value) : typeof value === 'boolean' ? value === (c.value === true || c.value === 'true') : s === String(c.value ?? '');
    case 'neq':
      return typeof value === 'number' ? value !== Number(c.value) : s !== String(c.value ?? '');
    case 'contains': {
      const needle = String(c.value ?? '').toLowerCase();
      if (Array.isArray(value)) return value.includes(c.value);
      return (display ?? s).toLowerCase().includes(needle);
    }
    case 'gt':
      return Number(value) > Number(c.value);
    case 'lt':
      return Number(value) < Number(c.value);
    case 'gte':
      return typeof value === 'number' ? value >= Number(c.value) : s.slice(0, String(c.value).length) >= String(c.value);
    case 'lte':
      return typeof value === 'number' ? value <= Number(c.value) : s.slice(0, String(c.value).length) <= String(c.value);
    case 'in':
      return Array.isArray(c.value) && c.value.includes(value);
  }
}

/**
 * Evaluate a group. `resolve` returns the comparable value (and optional display text)
 * for a field, or `undefined` when the field is unavailable to the actor — such
 * conditions are skipped (and reported by `invalidConditions`).
 */
export function evalGroup(
  g: FilterGroup,
  resolve: (field: string) => { value: unknown; display?: string } | undefined,
): boolean {
  const results: boolean[] = [];
  for (const child of g.children) {
    if (child.kind === 'group') {
      if (child.children.length === 0) continue;
      results.push(evalGroup(child, resolve));
    } else {
      const r = resolve(child.field);
      if (!r) continue;
      if (!VALUELESS.includes(child.operator) && (child.value === undefined || child.value === '')) continue;
      results.push(evalFilterCondition(child, r.value, r.display));
    }
  }
  if (results.length === 0) return true;
  return g.join === 'and' ? results.every(Boolean) : results.some(Boolean);
}

export function countConditions(g: FilterGroup): number {
  return g.children.reduce((n, c) => n + (c.kind === 'group' ? countConditions(c) : 1), 0);
}

export function collectFields(g: FilterGroup, out: string[] = []): string[] {
  g.children.forEach((c) => (c.kind === 'group' ? collectFields(c, out) : out.push(c.field)));
  return out;
}

export function cloneGroup(g: FilterGroup): FilterGroup {
  return JSON.parse(JSON.stringify(g));
}

export const newCondition = (field: string, operator: FilterOperator, value?: unknown): FilterCondition => ({
  kind: 'condition',
  id: uid('c'),
  field,
  operator,
  value,
});

export const newGroup = (join: 'and' | 'or' = 'and'): FilterGroup => ({ kind: 'group', id: uid('g'), join, children: [] });

/** URL serialization for shareable filters (`?f=`). Contains no record values beyond filter literals. */
export function encodeFilter(g: FilterGroup): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(g))));
}
export function decodeFilter(s: string): FilterGroup | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(s))));
    return parsed && parsed.kind === 'group' ? parsed : null;
  } catch {
    return null;
  }
}
