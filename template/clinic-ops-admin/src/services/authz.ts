/**
 * SIMULATED Authorization Service. Runs in the browser, so it is a faithful
 * model of the policy — NOT a security boundary. A live deployment must
 * re-evaluate every decision on the server (deny by default).
 */
import type { DemoUser } from '../domain/clinic/pack';
import type { FieldAccess, FieldDefinition, RecordData, ResourceDefinition, ResourcePermission, RoleDefinition } from '../metadata/types';
import { getDb } from './db';
import { getRole, getUser } from './registry';

export interface Actor {
  user: DemoUser;
  role: RoleDefinition;
  workspaceId: string;
  staffId: string;
}

const NONE: ResourcePermission = { read: 'none', create: false, update: 'none', delete: false, export: false };

export function currentActor(): Actor {
  const { userId, workspaceId } = getDb().session;
  return actorFor(userId, workspaceId);
}

export function actorFor(userId: string, workspaceId: string): Actor {
  const user = getUser(userId) ?? getUser('u_morgan')!;
  return { user, role: getRole(user.roleId), workspaceId, staffId: user.staffIds[workspaceId] };
}

export const perm = (actor: Actor, resource: string): ResourcePermission => actor.role.resources[resource] ?? NONE;

export const can = (actor: Actor, capability: string) => actor.role.capabilities.includes(capability);

export function canReadResource(actor: Actor, resource: string) {
  return perm(actor, resource).read !== 'none';
}

function inScope(scope: 'all' | 'own' | 'none', actor: Actor, res: ResourceDefinition, record: RecordData) {
  if (record.workspaceId !== actor.workspaceId) return false; // workspace isolation
  if (scope === 'all') return true;
  if (scope === 'own') return !!res.ownerField && record[res.ownerField] === actor.staffId;
  return false;
}

export const canReadRecord = (actor: Actor, res: ResourceDefinition, record: RecordData) => inScope(perm(actor, res.key).read, actor, res, record);
export const canUpdateRecord = (actor: Actor, res: ResourceDefinition, record: RecordData) => inScope(perm(actor, res.key).update, actor, res, record);

/**
 * Effective field access for an actor. `edit` is only returned when the actor
 * may also write in the given mode. Sensitivity classification is part of the
 * schema; hiding a column in a view never changes it.
 */
export function fieldAccess(actor: Actor, res: ResourceDefinition, field: FieldDefinition, mode: 'read' | 'create' | 'update' = 'read'): FieldAccess {
  const p = perm(actor, res.key);
  if (p.read === 'none') return 'hide';
  const sensitivity = field.sensitivity ?? 'none';
  let access: FieldAccess;
  if (sensitivity === 'none') access = 'edit';
  else if (sensitivity === 'contact') access = p.sensitive_data ? 'edit' : 'mask';
  else access = actor.role.sensitivity[sensitivity];
  const override = actor.role.fieldOverrides?.[`${res.key}.${field.key}`];
  if (override) access = override;
  const writable = !field.readOnly && !field.computed && !field.system && (mode === 'create' ? p.create : mode === 'update' ? p.update !== 'none' : p.update !== 'none' || p.create);
  if (access === 'edit' && !writable) access = 'view';
  return access;
}

export function fieldAccessMap(actor: Actor, res: ResourceDefinition, mode: 'read' | 'create' | 'update' = 'read') {
  const map: Record<string, FieldAccess> = {};
  res.fields.forEach((f) => (map[f.key] = fieldAccess(actor, res, f, mode)));
  return map;
}

/** Fields an actor may filter, sort or search on: only fully visible ones (prevents inference via masked values). */
export const queryableField = (actor: Actor, res: ResourceDefinition, field: FieldDefinition) => {
  const a = fieldAccess(actor, res, field);
  return a === 'edit' || a === 'view';
};
