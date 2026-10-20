/**
 * Extra access (ADM-02): the pure part. A grant lifts a role's permission in one area (module) or adds a
 * capability, never lowers it, and stops working after its end date. Kept free of authz imports so authz can use it.
 */
import type { ResourcePermission, RoleDefinition, RowScope } from '../../metadata/types';
import { todayKey } from '../../lib/dates';
import { getDb } from '../db';
import { allResources } from '../registry';
import type { AccessGrant } from '../types';

export const SCOPE_ORDER: RowScope[] = ['none', 'own', 'team', 'division', 'all'];
export const widest = (a: RowScope, b: RowScope): RowScope => (SCOPE_ORDER.indexOf(a) >= SCOPE_ORDER.indexOf(b) ? a : b);

const NONE: ResourcePermission = { read: 'none', create: false, update: 'none', delete: false, export: false };

/** A grant works through its last day, then stops. */
export const grantStatus = (g: AccessGrant): 'active' | 'expired' | 'revoked' => (g.revokedAt ? 'revoked' : g.expiresAt < todayKey() ? 'expired' : 'active');

export const activeGrantsFor = (userId: string): AccessGrant[] => (getDb().accessGrants ?? []).filter((g) => g.userId === userId && grantStatus(g) === 'active');

/** Permission a level gives on one record type, on top of what the role already has. */
export function liftPermission(cur: ResourcePermission, g: Pick<AccessGrant, 'level' | 'scope'>): ResourcePermission {
  const read = widest(cur.read, g.scope);
  switch (g.level) {
    case 'view':
      return { ...cur, read };
    case 'export':
      return { ...cur, read, export: true };
    case 'edit':
      return { ...cur, read, update: widest(cur.update, g.scope), create: true };
    case 'full':
      return { ...cur, read, update: widest(cur.update, g.scope), create: true, delete: true, export: true };
    default:
      return cur;
  }
}

export function applyGrants(role: RoleDefinition, grants: AccessGrant[]): RoleDefinition {
  if (!grants.length) return role;
  const resources = { ...role.resources };
  const capabilities = new Set(role.capabilities);
  for (const g of grants) {
    if (g.kind === 'capability' && g.capability) capabilities.add(g.capability);
    if (g.kind === 'area') for (const r of allResources()) if (r.module === g.module) resources[r.key] = liftPermission(resources[r.key] ?? NONE, g);
  }
  return { ...role, resources, capabilities: [...capabilities] };
}
