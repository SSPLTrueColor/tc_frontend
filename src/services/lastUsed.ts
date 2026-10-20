/**
 * "Recognition over recall": the dropdown choices a person makes again and again (lead source, product type, complaint
 * category …) are remembered per resource and pre-filled on the next new record. Only required dropdowns that still
 * exist and are active are remembered; the person can always change them.
 */
import type { RecordData, ResourceDefinition } from '../metadata/types';
import { type Actor } from './authz';
import { defaultSettings, getDb } from './db';
import { activeMasterValues, getResource } from './registry';
import type { Db } from './types';

const eligible = (f: ResourceDefinition['fields'][number]) => f.type === 'master' && !!f.master && !!f.required && !f.system && !f.computed && !f.masterParentField;

/** Called inside the create transaction: remembers the dropdown values of the record just created. */
export function rememberLastUsed(d: Db, actor: Actor, res: ResourceDefinition, record: RecordData) {
  const picked: Record<string, string> = {};
  for (const f of res.fields) if (eligible(f) && typeof record[f.key] === 'string' && record[f.key]) picked[f.key] = String(record[f.key]);
  if (!Object.keys(picked).length) return;
  const cur = { ...defaultSettings(), ...(d.settings[actor.user.id] ?? {}) };
  d.settings[actor.user.id] = { ...cur, lastUsed: { ...cur.lastUsed, [res.key]: { ...(cur.lastUsed[res.key] ?? {}), ...picked } } };
}

/** Values to pre-fill on a new record, limited to ones that are still active. */
export function lastUsedValues(userId: string, resKey: string): Record<string, string> {
  const res = getResource(resKey);
  const saved = (getDb().settings[userId]?.lastUsed ?? {})[resKey] ?? {};
  const out: Record<string, string> = {};
  for (const f of res.fields) if (eligible(f) && saved[f.key] && activeMasterValues(f.master!).some((v) => v.key === saved[f.key])) out[f.key] = saved[f.key];
  return out;
}
