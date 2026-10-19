import type { FieldCondition, FieldDefinition, LineItemColumn, ResourceDefinition } from '../metadata/types';
import { todayKey } from '../lib/dates';
import { validateFormat } from '../lib/validators';
import { getDb } from './db';
import { activeMasterValues, getMaster } from './registry';
import { L } from '../constants/labels';

const V = L.common.form.v;

export function isEmpty(v: unknown) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
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
      const n = Number(v);
      if (Number.isNaN(n)) return V.number;
      if (f.min !== undefined && n < f.min) return V.min(f.min);
      if (f.max !== undefined && n > f.max) return V.max(f.max);
      return undefined;
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
