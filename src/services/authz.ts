/**
 * SIMULATED Authorization Service. Runs in the browser, so it is a faithful
 * model of the policy — NOT a security boundary. A live deployment must
 * re-evaluate every decision on the server (deny by default).
 *
 * Row scope follows the reporting hierarchy (BRD §2.1, ADM-01/02):
 *   own      → records whose owner field is the actor
 *   team     → own + everyone reporting to the actor, directly or indirectly
 *   division → records in any of the actor's divisions
 *   all      → company-wide
 */
import type { DemoUser } from '../domain/pack';
import type { FieldAccess, FieldDefinition, RecordData, ResourceDefinition, ResourcePermission, RoleDefinition, RowScope } from '../metadata/types';
import { getDb, getRevision } from './db';
import { getRole, getUser } from './registry';
import { L } from '../constants/labels';
import { applyRoleOverrides } from './catalog/roleOverrides';

export interface Actor {
  user: DemoUser;
  role: RoleDefinition;
  workspaceId: string;
  /** User record id (Administration › Users) of the actor. */
  staffId: string;
  /** User record ids the actor manages: self + all direct and indirect reports. */
  teamStaffIds: string[];
  /** Divisions the actor belongs to (from the employee record). */
  divisionIds: string[];
}

const NONE: ResourcePermission = { read: 'none', create: false, update: 'none', delete: false, export: false };

export function currentActor(): Actor {
  const { userId, workspaceId } = getDb().session;
  return actorFor(userId, workspaceId);
}

const cache = new Map<string, { rev: number; actor: Actor }>();

export function actorFor(userId: string, workspaceId: string): Actor {
  const rev = getRevision();
  const key = `${userId}:${workspaceId}`;
  const hit = cache.get(key);
  if (hit && hit.rev === rev) return hit.actor;
  const user = getUser(userId) ?? getUser('u_rahul')!;
  const staffId = user.staffIds[workspaceId];
  const employees = (getDb().records.employees ?? []).filter((e) => e.workspaceId === workspaceId);
  const me = employees.find((e) => e.id === staffId);
  const actor: Actor = {
    user,
    // Shipped role + admin edits from Roles & Permissions (ADM-02); unchanged when nothing was edited.
    role: applyRoleOverrides(getRole(String(me?.roleId ?? user.roleId))),
    workspaceId,
    staffId,
    teamStaffIds: teamOf(staffId, employees),
    divisionIds: ((me?.divisionIds as string[] | undefined) ?? user.divisions).slice(),
  };
  cache.set(key, { rev, actor });
  return actor;
}

/** Self + transitive reports, cycle-safe. */
function teamOf(staffId: string, employees: RecordData[]): string[] {
  const out = new Set<string>([staffId]);
  const queue = [staffId];
  while (queue.length) {
    const m = queue.shift()!;
    employees.forEach((e) => {
      if (e.managerId === m && !out.has(e.id)) {
        out.add(e.id);
        queue.push(e.id);
      }
    });
  }
  return [...out];
}

export const perm = (actor: Actor, resource: string): ResourcePermission => actor.role.resources[resource] ?? NONE;

export const can = (actor: Actor, capability: string) => actor.role.capabilities.includes(capability);

export function canReadResource(actor: Actor, resource: string) {
  return perm(actor, resource).read !== 'none';
}

const asArray = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : v === null || v === undefined || v === '' ? [] : [String(v)]);

function recordDivisions(res: ResourceDefinition, record: RecordData): string[] {
  if (res.divisionField) return asArray(record[res.divisionField]);
  if (res.ownerField) {
    const owner = getDb().records.employees?.find((e) => e.id === record[res.ownerField!]);
    return asArray(owner?.divisionIds);
  }
  return [];
}

function inScope(scope: RowScope, actor: Actor, res: ResourceDefinition, record: RecordData) {
  if (record.workspaceId !== actor.workspaceId) return false; // workspace isolation
  switch (scope) {
    case 'all':
      return true;
    case 'division': {
      const divs = recordDivisions(res, record);
      // Records with no division (e.g. shared masters) are visible to the whole company.
      return !divs.length || divs.some((d) => actor.divisionIds.includes(d));
    }
    case 'team':
      return !!res.ownerField && actor.teamStaffIds.includes(String(record[res.ownerField]));
    case 'own':
      return !!res.ownerField && record[res.ownerField] === actor.staffId;
    default:
      return false;
  }
}

export const canReadRecord = (actor: Actor, res: ResourceDefinition, record: RecordData) => inScope(perm(actor, res.key).read, actor, res, record);
export const canUpdateRecord = (actor: Actor, res: ResourceDefinition, record: RecordData) => inScope(perm(actor, res.key).update, actor, res, record);

export const SCOPE_LABELS: Record<RowScope, string> = L.common.scopes;

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
