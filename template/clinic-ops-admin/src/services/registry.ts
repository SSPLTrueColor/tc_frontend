/**
 * Metadata Registry: effective (published) resource and master definitions.
 * Pack definitions + published Configuration Studio overlays.
 */
import { clinicPack, demoUsers, workspaces } from '../domain/clinic/pack';
import type { FieldDefinition, MasterDefinition, MasterValue, ResourceDefinition } from '../metadata/types';
import { getDb } from './db';

const resourceCache = new Map<string, { key: string; def: ResourceDefinition }>();

export function getMaster(key: string): MasterDefinition {
  const overlay = getDb().config.masters[key];
  if (overlay) return overlay;
  const m = clinicPack.masters.find((x) => x.key === key);
  if (!m) throw new Error(`Unknown master ${key}`);
  return m;
}

export function allMasters(): MasterDefinition[] {
  return clinicPack.masters.map((m) => getMaster(m.key));
}

export function masterValue(masterKey: string, valueKey: unknown): MasterValue | undefined {
  if (valueKey === null || valueKey === undefined || valueKey === '') return undefined;
  return getMaster(masterKey).values.find((v) => v.key === valueKey);
}

export function masterLabel(masterKey: string, valueKey: unknown): string {
  return masterValue(masterKey, valueKey)?.label ?? (valueKey ? String(valueKey) : '');
}

export function activeMasterValues(masterKey: string, parent?: unknown): MasterValue[] {
  return getMaster(masterKey)
    .values.filter((v) => v.active && (parent === undefined || v.parent === parent))
    .sort((a, b) => a.order - b.order);
}

export function getResource(key: string): ResourceDefinition {
  const base = clinicPack.resources.find((r) => r.key === key);
  if (!base) throw new Error(`Unknown resource ${key}`);
  const { customFields, resourceVersions } = getDb().config;
  const custom = customFields[key] ?? [];
  const version = resourceVersions[key] ?? base.version;
  const cacheKey = `${version}:${custom.length}:${custom.map((c) => c.id).join(',')}`;
  const cached = resourceCache.get(key);
  if (cached && cached.key === cacheKey) return cached.def;
  const def: ResourceDefinition = custom.length
    ? {
        ...base,
        version,
        fields: [...base.fields, ...custom],
        form: {
          ...base.form,
          sections: [
            ...base.form.sections,
            { id: 'custom', title: 'Additional fields', description: 'Added in Configuration studio', fields: custom.map((c) => c.key), columns: 2 },
          ],
        },
      }
    : { ...base, version };
  resourceCache.set(key, { key: cacheKey, def });
  return def;
}

export function allResources(): ResourceDefinition[] {
  return clinicPack.resources.map((r) => getResource(r.key));
}

export function getField(resource: ResourceDefinition, key: string): FieldDefinition | undefined {
  return resource.fields.find((f) => f.key === key);
}

export const getUser = (id: string) => demoUsers.find((u) => u.id === id);
export const getRole = (id: string) => {
  const role = clinicPack.roles.find((r) => r.id === id);
  if (!role) throw new Error(`Unknown role ${id}`);
  return role;
};
export const getWorkspace = (idOrSlug: string) => workspaces.find((w) => w.id === idOrSlug || w.slug === idOrSlug);
