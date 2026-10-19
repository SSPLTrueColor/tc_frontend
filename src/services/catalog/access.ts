/**
 * Roles & Permissions editing (ADM-02, FR-120). Reads the effective matrix (shipped roles + stored
 * overrides), validates and saves one role at a time, and resets a role to the shipped default.
 * Every change is audited with before/after values and emitted as a system event.
 */
import { L } from '../../constants/labels';
import { appRoles, NO_ACCESS } from '../../domain/pack';
import { nowIso } from '../../lib/clock';
import { uid } from '../../lib/ids';
import type { FieldAccess, ResourcePermission, RoleDefinition, RowScope } from '../../metadata/types';
import { type Actor, can } from '../authz';
import { commit } from '../db';
import { appendAudit, emitEvent } from '../ledger';
import { getResource } from '../registry';
import { ServiceError } from '../types';
import { applyRoleOverrides, type ConfigWithRoles, roleOverrides, type RoleOverrides } from './roleOverrides';

export const SCOPES: RowScope[] = ['none', 'own', 'team', 'division', 'all'];
const rank = (s: RowScope) => SCOPES.indexOf(s);

/** The System Administrator role cannot be edited, so someone can always manage access. */
export const LOCKED_ROLES = ['admin'];

export interface RoleMatrix {
  /** Effective roles (shipped + overrides), in shipped order. */
  roles: RoleDefinition[];
  /** Shipped roles (for "Role Default" and Reset). */
  shipped: RoleDefinition[];
  /** Stored overrides per role id (only customised roles appear). */
  overrides: RoleOverrides;
}

export function getRoleMatrix(actor: Actor): RoleMatrix {
  if (!can(actor, 'access.view')) throw new ServiceError('forbidden', L.admin.access.errors.forbidden);
  const o = roleOverrides();
  return { roles: appRoles.map((r) => applyRoleOverrides(r, o)), shipped: appRoles, overrides: o };
}

const shipped = (roleId: string) => appRoles.find((r) => r.id === roleId);

/** Row-level errors for a role's resource permissions: resource key → message. */
export function validateRolePermissions(resources: Record<string, ResourcePermission>): Record<string, string> {
  const e: Record<string, string> = {};
  for (const [k, p] of Object.entries(resources)) {
    if (rank(p.update) > rank(p.read)) e[k] = L.admin.access.errors.updateWiderThanRead;
    else if (p.read === 'none' && (p.create || p.delete || p.export)) e[k] = L.admin.access.errors.flagsNeedRead;
  }
  return e;
}

const same = (a: ResourcePermission, b: ResourcePermission) =>
  a.read === b.read && a.update === b.update && a.create === b.create && a.delete === b.delete && a.export === b.export && !!a.sensitive_data === !!b.sensitive_data;

const describe = (p: ResourcePermission) => {
  const S = L.admin.scopes;
  const C = L.admin.access.columns;
  const flags = [p.create && C.create, p.delete && C.delete, p.export && C.export, p.sensitive_data && C.contact].filter(Boolean).join(', ');
  return `${C.read}: ${S[p.read].short} · ${C.update}: ${S[p.update].short}${flags ? ` · ${flags}` : ''}`;
};

export interface RoleChanges {
  /** Complete permission per resource for this role (unchanged rows may be included). */
  resources: Record<string, ResourcePermission>;
  /** `${resource}.${field}` → access, or null for the role default. */
  fieldOverrides: Record<string, FieldAccess | null>;
}

function requireManager(actor: Actor, roleId: string) {
  if (!can(actor, 'access.manage')) throw new ServiceError('forbidden', L.admin.access.errors.forbidden);
  if (LOCKED_ROLES.includes(roleId)) throw new ServiceError('forbidden', L.admin.access.errors.adminLocked);
  if (!shipped(roleId)) throw new ServiceError('not_found', L.admin.access.errors.unknownRole);
}

/** Saves one role. Only differences from the shipped role are stored; returns the number of changes. */
export function saveRolePermissions(actor: Actor, roleId: string, changes: RoleChanges): number {
  requireManager(actor, roleId);
  const errors = validateRolePermissions(changes.resources);
  const first = Object.entries(errors)[0];
  if (first) throw new ServiceError('validation', `${getResource(first[0]).labelPlural}: ${first[1]}`);
  const base = shipped(roleId)!;
  return commit((d) => {
    const cfg = d.config as ConfigWithRoles;
    const all = { ...(cfg.rolePermissions ?? {}) };
    const before = applyRoleOverrides(base, all);
    const resources: Record<string, ResourcePermission> = { ...(all[roleId]?.resources ?? {}) };
    const fieldOverrides: Record<string, FieldAccess> = { ...(all[roleId]?.fieldOverrides ?? {}) };
    const audit: { field: string; label: string; before: string; after: string }[] = [];

    for (const [k, next] of Object.entries(changes.resources)) {
      const was = before.resources[k] ?? NO_ACCESS;
      if (same(was, next)) continue;
      audit.push({ field: k, label: getResource(k).labelPlural, before: describe(was), after: describe(next) });
      if (same(base.resources[k] ?? NO_ACCESS, next)) delete resources[k];
      else resources[k] = { ...next };
    }
    for (const [key, next] of Object.entries(changes.fieldOverrides)) {
      // null = role default (the shipped role's rule for this field).
      const was = all[roleId]?.fieldOverrides[key] ?? null;
      if (was === next) continue;
      const [resKey, fieldKey] = key.split('.');
      const res = getResource(resKey);
      const label = `${res.labelPlural} › ${res.fields.find((f) => f.key === fieldKey)?.label ?? fieldKey}`;
      const name = (a: FieldAccess | null) => (a ? L.admin.fieldAccess[a] : L.admin.fieldAccess.default);
      audit.push({ field: key, label, before: name(was), after: name(next) });
      if (next === null) delete fieldOverrides[key];
      else fieldOverrides[key] = next;
    }
    if (!audit.length) return 0;
    if (Object.keys(resources).length || Object.keys(fieldOverrides).length) all[roleId] = { resources, fieldOverrides, updatedAt: nowIso(), updatedBy: actor.user.id };
    else delete all[roleId];
    cfg.rolePermissions = all;
    const correlationId = uid('cor');
    appendAudit(d, actor, { action: 'access.role_changed', summary: L.admin.access.auditSummary(base.label, audit.length), changes: audit, correlationId });
    emitEvent(d, actor, { eventType: 'access.role_changed', correlationId, payload: { roleId, changes: audit.length } });
    return audit.length;
  });
}

/** Removes every override of a role (back to the shipped matrix). */
export function resetRolePermissions(actor: Actor, roleId: string) {
  requireManager(actor, roleId);
  const base = shipped(roleId)!;
  commit((d) => {
    const cfg = d.config as ConfigWithRoles;
    const all = { ...(cfg.rolePermissions ?? {}) };
    delete all[roleId];
    cfg.rolePermissions = all;
    const correlationId = uid('cor');
    appendAudit(d, actor, { action: 'access.role_reset', summary: L.admin.access.auditReset(base.label), correlationId });
    emitEvent(d, actor, { eventType: 'access.role_reset', correlationId, payload: { roleId } });
  });
}
