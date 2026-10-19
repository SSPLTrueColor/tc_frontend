/** True Color domain behaviour registered with the shared runtime (hooks, approval types). */
import { demoUsers } from '../pack';
import { notify } from '../../services/ledger';
import { registerResourceHooks } from '../../services/resourceHooks';
import { getResource } from '../../services/registry';
import { patchRecordIn } from '../../services/runtime';
import { L } from '../../constants/labels';

const userOfStaff = (staffId: unknown, ws: string) => demoUsers.find((u) => u.staffIds[ws] === staffId);

// Tasks: tell the assignee when someone else gives them work.
registerResourceHooks('tasks', {
  beforeCreate: (_ctx, c) => {
    if (!c.relatedLabel) c.relatedLabel = '';
  },
  afterCreate: ({ d, actor }, r) => {
    const u = userOfStaff(r.assigneeId, actor.workspaceId);
    if (u && u.id !== actor.user.id) notify(d, { userId: u.id, workspaceId: actor.workspaceId, kind: 'assignment', title: L.common.notify.assigned(actor.user.name, r.id, String(r.title)), link: { resource: 'tasks', recordId: r.id } });
  },
  afterUpdate: ({ d, actor }, before, after) => {
    if (before.assigneeId === after.assigneeId) return;
    const u = userOfStaff(after.assigneeId, actor.workspaceId);
    if (u && u.id !== actor.user.id) notify(d, { userId: u.id, workspaceId: actor.workspaceId, kind: 'assignment', title: L.common.notify.assigned(actor.user.name, after.id, String(after.title)), link: { resource: 'tasks', recordId: after.id } });
  },
});

// Activities: keep the parent record's lastActivityAt / nextFollowUpAt current (when it has those fields).
registerResourceHooks('activities', {
  afterCreate: (ctx, a) => {
    const resKey = String(a.parentResource ?? '');
    if (!resKey || !ctx.d.records[resKey]) return;
    const res = getResource(resKey);
    const has = (k: string) => res.fields.some((f) => f.key === k);
    const patch: Record<string, unknown> = {};
    if (has('lastActivityAt')) patch.lastActivityAt = a.at;
    if (has('nextFollowUpAt') && a.nextFollowUpAt) patch.nextFollowUpAt = a.nextFollowUpAt;
    if (Object.keys(patch).length) patchRecordIn(ctx, resKey, String(a.parentId), patch, L.common.audit.activityLogged(a.id));
  },
});
