/**
 * Metadata Registry: effective (published) resource and master definitions.
 * Pack definitions + published Configuration Studio overlays.
 */
import { appPack, type DemoUser, demoUsers, workspaces } from '../domain/pack';
import type { FieldDefinition, MasterDefinition, MasterValue, ResourceDefinition } from '../metadata/types';
import { getDb } from './db';
import { L } from '../constants/labels';

const resourceCache = new Map<string, { key: string; def: ResourceDefinition }>();

export function getMaster(key: string): MasterDefinition {
  const overlay = getDb().config.masters[key];
  if (overlay) return overlay;
  const m = appPack.masters.find((x) => x.key === key);
  if (!m) throw new Error(`Unknown master ${key}`);
  return m;
}

export function allMasters(): MasterDefinition[] {
  return appPack.masters.map((m) => getMaster(m.key));
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
  const base = appPack.resources.find((r) => r.key === key);
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
            { id: 'custom', title: L.common.form.additionalFields, description: L.common.form.additionalFieldsDescription, fields: custom.map((c) => c.key), columns: 2 },
          ],
        },
      }
    : { ...base, version };
  resourceCache.set(key, { key: cacheKey, def });
  return def;
}

export function allResources(): ResourceDefinition[] {
  return appPack.resources.map((r) => getResource(r.key));
}

export function getField(resource: ResourceDefinition, key: string): FieldDefinition | undefined {
  return resource.fields.find((f) => f.key === key);
}

const initialsOf = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((x) => x[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** Sign-in id of the person behind a user record (Administration › Users): the shipped demo user, else `u_<staff id>`. */
export function userIdForStaff(staffId: unknown, workspaceId = 'tc'): string {
  const id = String(staffId ?? '');
  return demoUsers.find((u) => u.staffIds[workspaceId] === id)?.id ?? `u_${id}`;
}

/** ADM-08: a person added in Administration › Users gets a sign-in identity derived from the user record. */
function userFromEmployee(e: Record<string, unknown>): DemoUser {
  const ws = String(e.workspaceId ?? 'tc');
  const name = String(e.fullName ?? e.id);
  return {
    id: `u_${String(e.id)}`,
    name,
    roleId: String(e.roleId ?? 'sales_exec'),
    staffIds: { [ws]: String(e.id) },
    initials: initialsOf(name),
    title: String(e.designation ?? ''),
    divisions: Array.isArray(e.divisionIds) ? (e.divisionIds as string[]) : [],
    managerId: e.managerId ? userIdForStaff(e.managerId, ws) : undefined,
    territories: Array.isArray(e.territoryIds) ? (e.territoryIds as string[]) : [],
  };
}

export const getUser = (id: string): DemoUser | undefined => {
  const shipped = demoUsers.find((u) => u.id === id);
  if (shipped || !id?.startsWith('u_')) return shipped;
  const e = (getDb().records.employees ?? []).find((x) => x.id === id.slice(2));
  return e && !demoUsers.some((u) => Object.values(u.staffIds).includes(String(e.id))) ? userFromEmployee(e) : undefined;
};

/**
 * People who can sign in or be switched to (login screen, role switcher): every active user record,
 * with the role, name and title as they are now in Administration › Users.
 */
export function signInUsers(workspaceId = 'tc'): DemoUser[] {
  const employees = (getDb().records.employees ?? []).filter((e) => (e.workspaceId ?? workspaceId) === workspaceId);
  const byStaff = new Map(employees.map((e) => [String(e.id), e]));
  const shipped = demoUsers
    .filter((u) => byStaff.get(u.staffIds[workspaceId])?.status !== 'inactive')
    .map((u) => {
      const e = byStaff.get(u.staffIds[workspaceId]);
      return e ? { ...u, roleId: String(e.roleId ?? u.roleId), title: String(e.designation ?? u.title) } : u;
    });
  const known = new Set(demoUsers.map((u) => u.staffIds[workspaceId]));
  const added = employees.filter((e) => !known.has(String(e.id)) && e.status !== 'inactive').map(userFromEmployee);
  return [...shipped, ...added];
}
export const getRole = (id: string) => {
  const role = appPack.roles.find((r) => r.id === id);
  if (!role) throw new Error(`Unknown role ${id}`);
  return role;
};
export const getWorkspace = (idOrSlug: string) => workspaces.find((w) => w.id === idOrSlug || w.slug === idOrSlug);
