import type { FieldCondition, FieldDefinition, LineItemColumn, ResourceDefinition } from '../metadata/types';
import { todayKey } from '../lib/dates';
import { validateFormat } from '../lib/validators';
import { formatMoney } from '../lib/format';
import { getDb } from './db';
import { activeMasterValues, getMaster } from './registry';
import { L } from '../constants/labels';

const V = L.common.form.v;

// ---------------------------------------------------------------- numbers (COM-05)

/** Sensible bounds for the app's numeric inputs. Values outside are rejected with an inline message, never clamped. */
export const NUMBER_LIMITS = {
  /** Line quantity: whole units, 1 – 9,999. */
  qty: { min: 1, max: 9_999, integer: true },
  /** Discount percentage: 0 – 100 %. */
  discountPct: { min: 0, max: 100 },
  /** Any rupee amount: ₹0 – ₹99,99,99,999. */
  amount: { min: 0, max: 999_999_999, money: true },
  /** Whole-number counts and readings (print counter, ml, minutes, visits): 0 – 99,99,99,999. */
  count: { min: 0, max: 999_999_999, integer: true },
} as const;

export interface NumberRule {
  min?: number;
  max?: number;
  integer?: boolean;
  /** Shows limits as ₹ with Indian grouping. */
  money?: boolean;
}

/**
 * Strict parse of what the user typed. Never sanitises: a minus sign (unless negatives are allowed by `min < 0`),
 * an exponent ("1e6"), a plus sign or any other character is an error, so "-2" can never silently become 2.
 * Indian digit grouping ("1,00,000") is accepted. Empty input is `null` (required-ness is checked elsewhere).
 */
export function parseNumberText(raw: string, rule: NumberRule = {}): { value: number | null; error?: string } {
  const text = String(raw ?? '').trim();
  if (!text) return { value: null };
  const negativeOk = rule.min !== undefined && rule.min < 0;
  const plain = text.replace(/,/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(plain)) return { value: NaN, error: /^-/.test(plain) && !negativeOk && /^-[\d.,]+$/.test(text) ? V.noNegative : V.digitsOnly };
  if (plain.startsWith('-') && !negativeOk) return { value: NaN, error: V.noNegative };
  const value = Number(plain);
  if (!Number.isFinite(value)) return { value: NaN, error: V.digitsOnly };
  return { value, error: numberRangeError(value, rule) };
}

/** Range / whole-number check for an already-parsed value. */
export function numberRangeError(n: number, rule: NumberRule = {}): string | undefined {
  if (!Number.isFinite(n)) return V.digitsOnly;
  if (n < 0 && !(rule.min !== undefined && rule.min < 0)) return V.noNegative;
  if (rule.integer && !Number.isInteger(n)) return V.wholeNumber;
  const show = (x: number) => (rule.money ? formatMoney(x) : x.toLocaleString('en-IN'));
  if (rule.min !== undefined && rule.max !== undefined && (n < rule.min || n > rule.max)) return V.between(show(rule.min), show(rule.max));
  if (rule.min !== undefined && n < rule.min) return V.min(show(rule.min));
  if (rule.max !== undefined && n > rule.max) return V.max(show(rule.max));
  return undefined;
}

/** True when a NumberInput value was typed but cannot be used: unparseable text (NaN) or outside the rule. Empty is not "bad". */
export function isBadNumber(n: number | null | undefined, rule: NumberRule = {}): boolean {
  return n !== null && n !== undefined && (Number.isNaN(n) || !!numberRangeError(n, rule));
}

/** The rule a number / money field definition implies (money defaults to ₹0 – ₹99,99,99,999; negatives only when min < 0). */
export function fieldNumberRule(f: Pick<FieldDefinition, 'type' | 'min' | 'max'>): NumberRule {
  const money = f.type === 'money';
  return { min: f.min ?? 0, max: f.max ?? (money ? NUMBER_LIMITS.amount.max : undefined), money, integer: false };
}

export function isEmpty(v: unknown) {
  // Whitespace-only text counts as empty, so required fields cannot be filled with blanks.
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

export function evalCondition(c: FieldCondition | undefined, values: Record<string, unknown>): boolean {
  if (!c) return true;
  const v = values[c.field];
  switch (c.op) {
    case 'eq':
      return v === c.value;
    case 'neq':
      return v !== c.value;
    case 'in':
      return Array.isArray(c.value) && c.value.includes(v);
    case 'notIn':
      return Array.isArray(c.value) && !c.value.includes(v);
    case 'truthy':
      return !isEmpty(v) && v !== false;
    case 'falsy':
      return isEmpty(v) || v === false;
  }
}

export const isVisible = (f: FieldDefinition, values: Record<string, unknown>) => evalCondition(f.visibleWhen, values);
export const isRequired = (f: FieldDefinition, values: Record<string, unknown>) =>
  isVisible(f, values) && (!!f.required || (!!f.requiredWhen && evalCondition(f.requiredWhen, values)));

function validateLineItems(f: FieldDefinition, value: unknown): string | undefined {
  const rows = (value as Record<string, unknown>[] | undefined) ?? [];
  if (f.required && rows.length === 0) return V.addLine;
  for (let i = 0; i < rows.length; i++) {
    for (const col of f.lineItemColumns ?? []) {
      const msg = validateCell(col, rows[i][col.key]);
      if (msg) return V.lineRow(i + 1, col.label, msg);
    }
  }
  return undefined;
}

function validateCell(col: LineItemColumn, v: unknown): string | undefined {
  if (col.required && isEmpty(v)) return V.lineRequired;
  if ((col.type === 'number' || col.type === 'money') && !isEmpty(v)) {
    const n = Number(v);
    if (Number.isNaN(n)) return V.lineNumber;
    if (col.min !== undefined && n < col.min) return V.lineMin(col.min);
    if (n < 0 && col.min === undefined) return V.noNegative;
  }
  return undefined;
}

/**
 * Validates a candidate record against canonical field definitions.
 * `editable` limits validation to fields the actor can write; hidden/masked
 * fields are never validated client-side (the service re-validates the merge).
 */
export function validateValues(res: ResourceDefinition, values: Record<string, unknown>, editable?: Set<string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of res.fields) {
    if (f.computed || f.system) continue;
    if (editable && !editable.has(f.key)) continue;
    if (!isVisible(f, values)) continue;
    const v = values[f.key];
    if (isRequired(f, values) && isEmpty(v)) {
      errors[f.key] = V.requiredField(f.label);
      continue;
    }
    if (isEmpty(v)) continue;
    const msg = validateField(f, v, values);
    if (msg) errors[f.key] = msg;
  }
  return errors;
}

export function validateField(f: FieldDefinition, v: unknown, values: Record<string, unknown>): string | undefined {
  switch (f.type) {
    case 'text':
    case 'longtext':
    case 'identifier':
    case 'email':
    case 'phone': {
      const s = String(v);
      if (f.maxLength && s.length > f.maxLength) return V.maxChars(f.maxLength);
      if (f.pattern && !new RegExp(f.pattern.regex).test(s)) return f.pattern.message;
      if (f.format) return validateFormat(f.format, s);
      return undefined;
    }
    case 'number':
    case 'money': {
      // Typed text (from a NumberInput that could not parse it) is checked strictly: no signs, no exponents.
      if (typeof v === 'string') return parseNumberText(v, fieldNumberRule(f)).error;
      const n = Number(v);
      if (Number.isNaN(n)) return V.number;
      // Money limits read as ₹ with Indian grouping (₹99,99,99,999), not a bare 999999999.
      return numberRangeError(n, fieldNumberRule(f));
    }
    case 'date':
    case 'datetime': {
      const s = String(v);
      if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return V.date;
      if (f.dateRule === 'past' && s.slice(0, 10) > todayKey()) return V.notFuture;
      if (f.dateRule === 'future' && s.slice(0, 10) < todayKey()) return V.notPast;
      if (f.compare) {
        const other = values[f.compare.field];
        if (!isEmpty(other)) {
          const o = String(other);
          if (f.compare.op === 'gte' && s < o) return f.compare.message;
          if (f.compare.op === 'lte' && s > o) return f.compare.message;
        }
      }
      return undefined;
    }
    case 'master': {
      const parent = f.masterParentField ? values[f.masterParentField] : undefined;
      const exists = getMaster(f.master!).values.find((x) => x.key === v);
      if (!exists) return V.unknownValue;
      if (f.masterParentField && exists.parent !== parent) return V.invalidForParent;
      return undefined;
    }
    case 'multimaster': {
      const keys = new Set(activeMasterValues(f.master!).map((x) => x.key));
      const all = new Set(getMaster(f.master!).values.map((x) => x.key));
      return (v as string[]).every((k) => all.has(k) || keys.has(k)) ? undefined : V.unknownValue;
    }
    case 'people': {
      const ids = new Set((getDb().records[f.relation!.resource] ?? []).map((r) => r.id));
      return Array.isArray(v) && (v as string[]).every((id) => ids.has(id)) ? undefined : V.personGone;
    }
    case 'image':
      return typeof v === 'string' && /^(data:image\/|https?:\/\/)/.test(v) ? undefined : V.image;
    case 'relation': {
      const rows = getDb().records[f.relation!.resource] ?? [];
      const target = rows.find((r) => r.id === v);
      if (!target) return V.recordGone;
      if (f.relation?.filterBy) {
        const expected = values[f.relation.filterBy.fromField];
        if (!isEmpty(expected) && target[f.relation.filterBy.field] !== expected) return V.wrongParent;
      }
      return undefined;
    }
    case 'lineitems':
      return validateLineItems(f, v);
    default:
      return undefined;
  }
}

/** Server-side style check that a newly chosen master value is still active. */
export function inactiveMasterErrors(res: ResourceDefinition, patch: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of res.fields) {
    if (f.type !== 'master' || !(f.key in patch) || isEmpty(patch[f.key])) continue;
    const mv = getMaster(f.master!).values.find((x) => x.key === patch[f.key]);
    if (mv && !mv.active) errors[f.key] = V.deactivated(mv.label);
  }
  return errors;
}
