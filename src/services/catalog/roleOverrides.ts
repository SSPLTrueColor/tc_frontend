/**
 * Roles & Permissions overrides (ADM-02, GLOSSARY G-A14). The shipped role matrix lives in the domain
 * pack; an administrator's edits are stored as a diff in the local store (config.rolePermissions) and
 * merged at runtime by authz.actorFor(). Kept free of authz imports so authz can import it.
 */
import type { FieldAccess, ResourcePermission, RoleDefinition } from '../../metadata/types';
import { getDb } from '../db';
import type { Db } from '../types';

export interface RoleOverride {
  /** Full replacement permission per resource key (only resources that differ from the shipped role). */
  resources: Record<string, ResourcePermission>;
  /** `${resource}.${field}` → access set explicitly by an administrator (absent = role default). */
  fieldOverrides: Record<string, FieldAccess>;
  updatedAt: string;
  updatedBy: string;
}

export type RoleOverrides = Record<string, RoleOverride>;

/** Local-store extension: admin-edited role permissions. */
export type ConfigWithRoles = Db['config'] & { rolePermissions?: RoleOverrides };

export const roleOverrides = (d: Db = getDb()): RoleOverrides => (d.config as ConfigWithRoles).rolePermissions ?? {};

/** Shipped role + stored overrides. Returns the same object when the role has no overrides. */
export function applyRoleOverrides(role: RoleDefinition, overrides: RoleOverrides = roleOverrides()): RoleDefinition {
  const o = overrides[role.id];
  if (!o) return role;
  return {
    ...role,
    resources: { ...role.resources, ...o.resources },
    fieldOverrides: { ...(role.fieldOverrides ?? {}), ...o.fieldOverrides },
  };
}
