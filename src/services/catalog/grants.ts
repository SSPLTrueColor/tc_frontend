/**
 * Roles & Permissions — people and extra access (ADM-02, FR-120). The administrator sees one person at a time:
 * their role, what they can do (role + extra access in plain words), extra access with an end date and reason,
 * and why a given screen is or is not open for them. Every change is audited.
 */
import { L } from '../../constants/labels';
import { addDays, todayKey } from '../../lib/dates';
import { uid } from '../../lib/ids';
import { nowIso } from '../../lib/clock';
import { appRoles, demoUsers } from '../../domain/pack';
import type { ResourcePermission, RowScope } from '../../metadata/types';
import { actorFor, type Actor, can } from '../authz';
import { commit, getDb } from '../db';
import { appendAudit } from '../ledger';
import { allResources, getRole, getUser } from '../registry';
import { type AccessGrant, ServiceError } from '../types';
import { applyGrants, grantStatus, SCOPE_ORDER, widest } from './grantEngine';
import { applyRoleOverrides } from './roleOverrides';

const G = L.grants;
export const MAX_GRANT_DAYS = 180;
export const GRANT_LEVELS = ['view', 'edit', 'export', 'full'] as const;
export const GRANT_SCOPES = ['own', 'team', 'division', 'all'] as const;
export const GRANT_CAPABILITIES = ['approve.l1', 'approve.l2', 'approve.l3', 'approve.finance'] as const;
const HIGH_RISK_CAPS = ['approve.l3', 'approve.finance'];
const HIDDEN_AREAS = ['admin', 'catalog', 'home'];
const NONE: ResourcePermission = { read: 'none', create: false, update: 'none', delete: false, export: false };

export type GrantStatus = ReturnType<typeof grantStatus>;
export interface GrantView extends AccessGrant {
  status: GrantStatus;
  what: string;
  daysLeft: number;
  risky: boolean;
}

const AREA_NAMES: Record<string, string> = { catalog: 'Products & Pricing' };
export const areaLabel = (module: string) => AREA_NAMES[module] ?? (L.nav.modules as Record<string, { nav: string }>)[module]?.nav ?? module;
export const grantableAreas = () => [...new Set(allResources().map((r) => r.module))].filter((m) => !HIDDEN_AREAS.includes(m)).map((m) => ({ module: m, label: areaLabel(m) }));

export const describeGrant = (g: Pick<AccessGrant, 'kind' | 'module' | 'level' | 'capability'>) => (g.kind === 'capability' ? (G.capabilities[g.capability ?? ''] ?? String(g.capability)) : `${G.levels[g.level ?? 'view']} · ${areaLabel(String(g.module))}`);
const isRisky = (g: Pick<AccessGrant, 'kind' | 'level' | 'capability'>) => (g.kind === 'capability' ? HIGH_RISK_CAPS.includes(String(g.capability)) : g.level === 'full' || g.level === 'export');

const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000);
const toView = (g: AccessGrant): GrantView => ({ ...g, status: grantStatus(g), what: describeGrant(g), daysLeft: daysBetween(todayKey(), g.expiresAt), risky: isRisky(g) });

function requireManager(actor: Actor) {
  if (!can(actor, 'access.manage')) throw new ServiceError('forbidden', G.errors.forbidden);
}
const nameOf = (userId: string) => getUser(userId)?.name ?? userId;

// ---------------------------------------------------------------- reads

/** Every extra access that is active or about to matter (ended and removed ones are not listed). */
export function listActiveGrants(actor: Actor, userId?: string): GrantView[] {
  if (!can(actor, 'access.view')) throw new ServiceError('forbidden', G.errors.forbidden);
  return (getDb().accessGrants ?? [])
    .filter((g) => (!userId || g.userId === userId) && grantStatus(g) === 'active')
    .map(toView)
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
}

export interface PersonRow {
  userId: string;
  name: string;
  title: string;
  roleId: string;
  roleLabel: string;
  extras: number;
  inactive: boolean;
}
export function listPeople(actor: Actor): PersonRow[] {
  if (!can(actor, 'access.view')) throw new ServiceError('forbidden', G.errors.forbidden);
  const employees = getDb().records.employees ?? [];
  const counts = new Map<string, number>();
  for (const g of getDb().accessGrants ?? []) if (grantStatus(g) === 'active') counts.set(g.userId, (counts.get(g.userId) ?? 0) + 1);
  return demoUsers.map((u) => {
    const emp = employees.find((e) => e.id === u.staffIds[actor.workspaceId]);
    const roleId = baseRoleId(u.id, actor.workspaceId);
    return { userId: u.id, name: u.name, title: u.title, roleId, roleLabel: getRole(roleId).label, extras: counts.get(u.id) ?? 0, inactive: emp?.status === 'inactive' };
  });
}
function baseRoleId(userId: string, ws: string): string {
  const u = getUser(userId)!;
  const emp = (getDb().records.employees ?? []).find((e) => e.id === u.staffIds[ws]);
  return String(emp?.roleId ?? u.roleId);
}

export interface PersonDetail {
  userId: string;
  name: string;
  title: string;
  roleId: string;
  roleLabel: string;
  managerName: string;
  divisions: string[];
  territories: string[];
  areas: AreaAccess[];
  extras: GrantView[];
}
export interface AreaAccess {
  module: string;
  label: string;
  perm: ResourcePermission;
  /** Differs from what the role alone gives. */
  extra: boolean;
}

/** Widest permission across an area's record types (what "they can … Leads" should say). */
const aggregate = (perms: ResourcePermission[]): ResourcePermission =>
  perms.reduce<ResourcePermission>(
    (a, p) => ({ read: widest(a.read, p.read), update: widest(a.update, p.update), create: a.create || p.create, delete: a.delete || p.delete, export: a.export || p.export }),
    { ...NONE },
  );

function areasFor(roleResources: Record<string, ResourcePermission>): Map<string, ResourcePermission> {
  const byModule = new Map<string, ResourcePermission[]>();
  for (const r of allResources()) if (!HIDDEN_AREAS.includes(r.module) || r.module === 'catalog') byModule.set(r.module, [...(byModule.get(r.module) ?? []), roleResources[r.key] ?? NONE]);
  return new Map([...byModule].map(([m, ps]) => [m, aggregate(ps)]));
}

export function getPerson(actor: Actor, userId: string): PersonDetail {
  if (!can(actor, 'access.view')) throw new ServiceError('forbidden', G.errors.forbidden);
  const u = getUser(userId);
  if (!u) throw new ServiceError('not_found', G.errors.unknownUser);
  const ws = actor.workspaceId;
  const roleId = baseRoleId(userId, ws);
  const base = applyRoleOverrides(getRole(roleId));
  const effective = actorFor(userId, ws).role;
  const baseAreas = areasFor(base.resources);
  const effAreas = areasFor(effective.resources);
  const emps = getDb().records.employees ?? [];
  const me = emps.find((e) => e.id === u.staffIds[ws]);
  const manager = emps.find((e) => e.id === me?.managerId);
  const same = (a: ResourcePermission, b: ResourcePermission) => a.read === b.read && a.update === b.update && a.create === b.create && a.delete === b.delete && a.export === b.export;
  const areas: AreaAccess[] = [...effAreas].map(([module, perm]) => ({ module, label: areaLabel(module), perm, extra: !same(perm, baseAreas.get(module)!) }));
  return {
    userId,
    name: u.name,
    title: u.title,
    roleId,
    roleLabel: getRole(roleId).label,
    managerName: manager ? String(manager.fullName) : '',
    divisions: ((me?.divisionIds as string[]) ?? u.divisions) as string[],
    territories: ((me?.territoryIds as string[]) ?? u.territories) as string[],
    areas,
    extras: listActiveGrants(actor, userId),
  };
}

export interface RoleDiff {
  gains: string[];
  loses: string[];
  changes: string[];
}
/** What changes for a person if they move to another role (extra access is not counted: it stays). */
export function previewRoleChange(actor: Actor, userId: string, roleId: string): RoleDiff {
  if (!can(actor, 'access.view')) throw new ServiceError('forbidden', G.errors.forbidden);
  const from = areasFor(applyRoleOverrides(getRole(baseRoleId(userId, actor.workspaceId))).resources);
  const to = areasFor(applyRoleOverrides(getRole(roleId)).resources);
  const rank = (p: ResourcePermission) => SCOPE_ORDER.indexOf(p.read) * 100 + SCOPE_ORDER.indexOf(p.update) * 10 + (p.create ? 4 : 0) + (p.delete ? 2 : 0) + (p.export ? 1 : 0);
  const out: RoleDiff = { gains: [], loses: [], changes: [] };
  for (const [m, t] of to) {
    const f = from.get(m)!;
    if (rank(f) === rank(t)) continue;
    if (f.read === 'none') out.gains.push(areaLabel(m));
    else if (t.read === 'none') out.loses.push(areaLabel(m));
    else out.changes.push(areaLabel(m));
  }
  return out;
}

export interface WhyResult {
  allowed: boolean;
  /** The person can open it but cannot change it. */
  readOnly: boolean;
  scope: RowScope;
  fromExtra: boolean;
}
/** "Why can't they see X?" — checks the role first, then the extra access. */
export function explainAccess(actor: Actor, userId: string, resourceKey: string): WhyResult {
  if (!can(actor, 'access.view')) throw new ServiceError('forbidden', G.errors.forbidden);
  const base = applyRoleOverrides(getRole(baseRoleId(userId, actor.workspaceId))).resources[resourceKey] ?? NONE;
  const eff = actorFor(userId, actor.workspaceId).role.resources[resourceKey] ?? NONE;
  return { allowed: eff.read !== 'none', readOnly: eff.read !== 'none' && eff.update === 'none' && !eff.create, scope: eff.read, fromExtra: eff.read !== base.read || eff.update !== base.update };
}

// ---------------------------------------------------------------- validation and writes

export interface GrantInput {
  userId: string;
  kind: 'area' | 'capability';
  module?: string;
  level?: AccessGrant['level'];
  capability?: string;
  scope: AccessGrant['scope'];
  expiresAt: string;
  reason: string;
}
export type GrantErrors = Partial<Record<'userId' | 'what' | 'level' | 'scope' | 'expiresAt' | 'reason', string>>;

export function validateGrant(i: GrantInput): GrantErrors {
  const E = G.errors;
  const e: GrantErrors = {};
  const u = getUser(i.userId);
  if (!u) e.userId = E.unknownUser;
  else if (baseRoleId(i.userId, 'tc') === 'admin') e.userId = E.adminTarget;
  if (i.kind === 'area') {
    if (!i.module || !grantableAreas().some((a) => a.module === i.module)) e.what = E.area;
    if (!i.level || !GRANT_LEVELS.includes(i.level)) e.level = E.level;
    if (!GRANT_SCOPES.includes(i.scope)) e.scope = E.scope;
  } else if (!i.capability || !GRANT_CAPABILITIES.includes(i.capability as (typeof GRANT_CAPABILITIES)[number])) e.what = E.area;
  const today = todayKey();
  if (!i.expiresAt) e.expiresAt = E.endRequired;
  else if (i.expiresAt <= today) e.expiresAt = E.endPast;
  else if (i.expiresAt > addDays(today, MAX_GRANT_DAYS)) e.expiresAt = E.endFar(MAX_GRANT_DAYS);
  const reason = i.reason.trim();
  if (!reason) e.reason = E.reasonRequired;
  else if (reason.length < 5) e.reason = E.reasonShort;
  else if (reason.length > 200) e.reason = E.reasonLong;
  else if (!/[\p{L}\p{N}]/u.test(reason)) e.reason = E.reasonLetters;
  if (!e.userId && !e.what && !e.level) {
    const dup = (getDb().accessGrants ?? []).some((g) => grantStatus(g) === 'active' && g.userId === i.userId && g.kind === i.kind && (i.kind === 'capability' ? g.capability === i.capability : g.module === i.module && g.level === i.level && g.scope === i.scope));
    if (dup) e.what = E.duplicate;
  }
  return e;
}

/** True when the person's role already allows everything this grant would add. */
export function isRedundant(i: GrantInput): boolean {
  const role = applyRoleOverrides(getRole(baseRoleId(i.userId, 'tc')));
  if (i.kind === 'capability') return role.capabilities.includes(String(i.capability));
  const lifted = applyGrants(role, [{ id: 'x', userId: i.userId, kind: 'area', module: i.module, level: i.level, scope: i.scope, reason: '', grantedBy: '', grantedAt: '', expiresAt: '' }]);
  return JSON.stringify(lifted.resources) === JSON.stringify(role.resources);
}

export function addGrant(actor: Actor, input: GrantInput): AccessGrant {
  requireManager(actor);
  const errors = validateGrant(input);
  const first = Object.values(errors)[0];
  if (first) throw new ServiceError('validation', first, { fieldErrors: errors as Record<string, string> });
  const g: AccessGrant = {
    id: uid('grant'),
    userId: input.userId,
    kind: input.kind,
    ...(input.kind === 'area' ? { module: input.module, level: input.level } : { capability: input.capability }),
    scope: input.kind === 'area' ? input.scope : 'own',
    reason: input.reason.trim(),
    grantedBy: actor.user.id,
    grantedAt: nowIso(),
    expiresAt: input.expiresAt,
  };
  commit((d) => {
    d.accessGrants = [g, ...(d.accessGrants ?? [])];
    appendAudit(d, actor, { action: 'access.grant', summary: G.audit.granted(nameOf(g.userId), describeGrant(g), g.expiresAt), correlationId: uid('cor') });
  });
  return g;
}

function findActive(id: string): AccessGrant {
  const g = (getDb().accessGrants ?? []).find((x) => x.id === id);
  if (!g) throw new ServiceError('not_found', G.errors.unknownGrant);
  if (grantStatus(g) !== 'active') throw new ServiceError('invalid_state', G.errors.notActive);
  return g;
}

export function revokeGrant(actor: Actor, id: string) {
  requireManager(actor);
  const g = findActive(id);
  commit((d) => {
    d.accessGrants = (d.accessGrants ?? []).map((x) => (x.id === id ? { ...x, revokedAt: nowIso(), revokedBy: actor.user.id } : x));
    appendAudit(d, actor, { action: 'access.revoke', summary: G.audit.removed(nameOf(g.userId), describeGrant(g)), correlationId: uid('cor') });
  });
}

export function extendGrant(actor: Actor, id: string, days = 30): string {
  requireManager(actor);
  const g = findActive(id);
  const limit = addDays(todayKey(), MAX_GRANT_DAYS);
  const next = addDays(g.expiresAt, days) > limit ? limit : addDays(g.expiresAt, days);
  if (next <= g.expiresAt) throw new ServiceError('invalid_state', G.errors.cannotExtend(g.expiresAt));
  commit((d) => {
    d.accessGrants = (d.accessGrants ?? []).map((x) => (x.id === id ? { ...x, expiresAt: next } : x));
    appendAudit(d, actor, { action: 'access.extend', summary: G.audit.extended(nameOf(g.userId), describeGrant(g), next), correlationId: uid('cor') });
  });
  return next;
}

/** Moves a person to another role by updating their user record (never to or from System Administrator). */
export function changeRole(actor: Actor, userId: string, roleId: string) {
  requireManager(actor);
  const u = getUser(userId);
  if (!u) throw new ServiceError('not_found', G.errors.unknownUser);
  const from = baseRoleId(userId, actor.workspaceId);
  if (from === 'admin') throw new ServiceError('forbidden', G.errors.adminTarget);
  if (roleId === 'admin') throw new ServiceError('forbidden', G.errors.adminRole);
  if (!appRoles.some((r) => r.id === roleId)) throw new ServiceError('validation', G.errors.unknownRole);
  if (roleId === from) throw new ServiceError('invalid_state', G.roleSame);
  commit((d) => {
    d.records.employees = (d.records.employees ?? []).map((e) => (e.id === u.staffIds[actor.workspaceId] ? { ...e, roleId, updatedAt: nowIso(), version: Number(e.version ?? 1) + 1 } : e));
    appendAudit(d, actor, { action: 'access.role', summary: G.audit.role(u.name, getRole(from).label, getRole(roleId).label), correlationId: uid('cor') });
  });
}

