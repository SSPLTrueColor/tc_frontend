/** View Registry: saved views with personal/team/org scope. */
import type { ViewDefinition, ViewScope } from '../metadata/types';
import { uid } from '../lib/ids';
import { type Actor, can, queryableField } from './authz';
import { commit, getDb } from './db';
import { collectFields } from './filter';
import { appendAudit } from './ledger';
import { getResource } from './registry';
import { ServiceError } from './types';

export function systemViews(resource: string): ViewDefinition[] {
  const res = getResource(resource);
  return res.views.map((v) => ({ ...v, resourceVersion: res.version }));
}

export function listViews(actor: Actor, resource: string): ViewDefinition[] {
  const own = getDb().views.filter(
    (v) =>
      v.resource === resource &&
      ((v.scope === 'personal' && v.ownerId === actor.user.id) ||
        (v.scope === 'team' && v.workspaceId === actor.workspaceId) ||
        v.scope === 'org'),
  );
  const rank: Record<ViewScope, number> = { org: 0, team: 1, personal: 2 };
  return [...systemViews(resource), ...own.sort((a, b) => rank[a.scope] - rank[b.scope] || a.order - b.order)];
}

export const isSystemView = (v: ViewDefinition) => v.ownerId === 'system';

export function canManageView(actor: Actor, v: ViewDefinition) {
  if (isSystemView(v)) return false;
  if (v.scope === 'personal') return v.ownerId === actor.user.id;
  if (v.scope === 'team') return can(actor, 'views.share.team') || v.ownerId === actor.user.id;
  return can(actor, 'views.share.org');
}

export function canCreateScope(actor: Actor, scope: ViewScope) {
  if (scope === 'personal') return true;
  return can(actor, scope === 'team' ? 'views.share.team' : 'views.share.org');
}

/** Fields referenced by a view that this actor may not query (shown as a warning, ignored). */
export function unavailableViewFields(actor: Actor, v: ViewDefinition): string[] {
  const res = getResource(v.resource);
  return collectFields(v.filter).filter((k) => {
    if (k === 'id') return false;
    const f = res.fields.find((x) => x.key === k);
    return !f || !queryableField(actor, res, f);
  });
}

export function saveView(actor: Actor, input: Omit<ViewDefinition, 'id' | 'ownerId' | 'order' | 'resourceVersion'> & { id?: string }): ViewDefinition {
  if (!input.name.trim()) throw new ServiceError('validation', 'Name the view.');
  if (!canCreateScope(actor, input.scope)) throw new ServiceError('forbidden', `Your role cannot share views with the ${input.scope === 'org' ? 'organization' : 'team'}.`);
  const res = getResource(input.resource);
  return commit((d) => {
    if (input.id) {
      const idx = d.views.findIndex((v) => v.id === input.id);
      if (idx < 0) throw new ServiceError('not_found', 'View not found.');
      if (!canManageView(actor, d.views[idx])) throw new ServiceError('forbidden', 'You cannot modify this view.');
      d.views[idx] = { ...d.views[idx], ...input, id: d.views[idx].id, resourceVersion: res.version };
      return d.views[idx];
    }
    const order = d.views.filter((v) => v.resource === input.resource).length;
    const view: ViewDefinition = { ...input, id: uid('view'), ownerId: actor.user.id, order, resourceVersion: res.version, workspaceId: actor.workspaceId };
    d.views.push(view);
    if (view.scope !== 'personal') {
      appendAudit(d, actor, { action: 'view.shared', resource: input.resource, summary: `Shared view "${view.name}" with ${view.scope}`, correlationId: uid('cor') });
    }
    return view;
  });
}

export function deleteView(actor: Actor, id: string) {
  commit((d) => {
    const v = d.views.find((x) => x.id === id);
    if (!v) return;
    if (!canManageView(actor, v)) throw new ServiceError('forbidden', 'You cannot delete this view.');
    d.views = d.views.filter((x) => x.id !== id);
    Object.values(d.settings).forEach((s) => {
      Object.entries(s.defaultViews).forEach(([r, vid]) => vid === id && delete s.defaultViews[r]);
    });
  });
}

export function moveView(actor: Actor, id: string, dir: -1 | 1) {
  commit((d) => {
    const v = d.views.find((x) => x.id === id);
    if (!v || !canManageView(actor, v)) return;
    const peers = d.views.filter((x) => x.resource === v.resource && x.scope === v.scope).sort((a, b) => a.order - b.order);
    const i = peers.indexOf(v);
    const j = i + dir;
    if (j < 0 || j >= peers.length) return;
    [peers[i].order, peers[j].order] = [peers[j].order, peers[i].order];
  });
}
