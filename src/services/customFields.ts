/**
 * Custom fields on bespoke create pages (ADM-05): the Quote editor and New Order page build their records
 * through workflow services that only accept their own fields. These helpers validate and store the published
 * custom-field values on the record right after it is created / saved, with an audit entry.
 */
import type { RecordData, ResourceDefinition } from '../metadata/types';
import { uid } from '../lib/ids';
import { type Actor, canReadRecord, canUpdateRecord, fieldAccessMap } from './authz';
import { call } from './api/client';
import { commit, getDb } from './db';
import { divisionOf, applyFormLayout } from './formLayouts';
import { getResource } from './registry';
import { patchRecordIn } from './runtime';
import { ServiceError } from './types';
import { validateValues } from './validation';
import { L } from '../constants/labels';

/** Keys of the published custom fields the actor may edit on this resource. */
export function customFieldKeys(actor: Actor, res: ResourceDefinition, mode: 'create' | 'update' = 'create'): string[] {
  const access = fieldAccessMap(actor, res, mode);
  return res.fields.filter((f) => f.custom && access[f.key] === 'edit').map((f) => f.key);
}

/** The resource as laid out for a division, reduced to its custom-field section (empty when none is published). */
export function customSection(res: ResourceDefinition, values: Record<string, unknown>) {
  return applyFormLayout(res, divisionOf(res, values)).form.sections.filter((s) => s.id === 'custom');
}

/** Published default values of a resource's custom fields (what a create stores when the key is not sent). */
export function customDefaults(res: ResourceDefinition): Record<string, unknown> {
  return Object.fromEntries(res.fields.filter((f) => f.custom && f.defaultValue !== undefined).map((f) => [f.key, f.defaultValue]));
}

/** Client and service check of the custom values only (required, formats, ranges). */
export function validateCustomValues(actor: Actor, resKey: string, values: Record<string, unknown>): Record<string, string> {
  const res = getResource(resKey);
  return validateValues(res, values, new Set(customFieldKeys(actor, res)));
}

/** Stores custom values on a record (only published custom fields; nothing else can be changed this way). */
export function saveCustomValues(actor: Actor, resKey: string, id: string, values: Record<string, unknown>): RecordData {
  const res = getResource(resKey);
  const keys = customFieldKeys(actor, res, 'update').filter((k) => k in values);
  const current = (getDb().records[resKey] ?? []).find((r) => r.id === id);
  if (!current || !canReadRecord(actor, res, current)) throw new ServiceError('not_found', L.common.errors.notFoundOrNoAccess(res.label, id));
  if (!keys.length) return current;
  if (!canUpdateRecord(actor, res, current)) throw new ServiceError('forbidden', L.common.errors.cannotChange(res.label.toLowerCase()));
  const errors = validateCustomValues(actor, resKey, { ...current, ...values });
  if (Object.keys(errors).length) throw new ServiceError('validation', L.common.form.fixHighlighted, { fieldErrors: errors });
  const patch = Object.fromEntries(keys.map((k) => [k, values[k] ?? null]));
  return commit((d) => patchRecordIn({ d, actor, correlationId: uid('cor') }, resKey, id, patch));
}

export const customFieldsApi = {
  save: (actor: Actor, resKey: string, id: string, values: Record<string, unknown>) => call(() => saveCustomValues(actor, resKey, id, values), { fast: true }),
};
