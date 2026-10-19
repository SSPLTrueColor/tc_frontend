/**
 * Workflow Runtime (simulated): owns formal approval decisions.
 * - An approval has one or more levels (e.g. Sales manager → Division head → MD); each level
 *   is decided by someone holding that level's capability.
 * - Separation of duties: a requester can never decide their own request.
 * - Reading a notification or completing a task never decides an approval.
 * - Modules register what happens on the final decision (registerApprovalType); the outcome
 *   runs in the same commit as the decision.
 */
import { appRoles, demoUsers } from '../domain/pack';
import { nowIso } from '../lib/clock';
import { uid } from '../lib/ids';
import { type Actor, actorFor, can, canReadRecord } from './authz';
import { commit, getDb } from './db';
import { appendAudit, emitEvent, notify } from './ledger';
import { getResource } from './registry';
import type { HookContext } from './resourceHooks';
import { type Approval, type ApprovalLevel, ServiceError } from './types';

export interface ApprovalType {
  label: string;
  onApproved?: (ctx: HookContext, approval: Approval) => void;
  onRejected?: (ctx: HookContext, approval: Approval) => void;
}

const types = new Map<string, ApprovalType>();

export function registerApprovalType(type: string, def: ApprovalType) {
  types.set(type, def);
}

export const approvalTypeLabel = (type: string) => types.get(type)?.label ?? type;

/** Capabilities that decide approvals, with the role labels that hold them (for UI copy). */
export function levelHolders(capability: string) {
  return appRoles.filter((r) => r.capabilities.includes(capability)).map((r) => r.label);
}

/** Who may decide this approval at its current level (capability + division + not the requester). */
export function canDecide(actor: Actor, a: Approval) {
  if (a.status !== 'pending') return false;
  const level = a.levels[a.currentLevel];
  if (!level) return false;
  if (a.requestedBy === actor.user.id) return false;
  // A named approver (e.g. reporting manager) decides regardless of role capability.
  if (level.approverStaffId) return level.approverStaffId === actor.staffId;
  if (!can(actor, level.capability)) return false;
  if (a.divisionIds?.length && !actor.divisionIds.some((d) => a.divisionIds!.includes(d))) return false;
  return true;
}

export function listApprovals(actor: Actor): Approval[] {
  return getDb().approvals.filter((a) => a.workspaceId === actor.workspaceId && (a.requestedBy === actor.user.id || canDecide(actor, a) || a.decisions.some((x) => x.by === actor.user.id)));
}

export function pendingApprovalFor(recordId: string, type?: string) {
  return getDb().approvals.find((a) => a.recordId === recordId && a.status === 'pending' && (!type || a.type === type));
}

function notifyApprovers(ctx: HookContext, a: Approval) {
  const level = a.levels[a.currentLevel];
  demoUsers
    .map((u) => actorFor(u.id, a.workspaceId))
    .filter((x) => canDecide(x, a))
    .forEach((x) => notify(ctx.d, { userId: x.user.id, workspaceId: a.workspaceId, kind: 'approval_request', title: `${level.label} approval needed: ${a.summary}`, link: { page: 'inbox' } }));
}

export interface ApprovalRequest {
  type: string;
  resource: string;
  recordId: string;
  reason: string;
  summary: string;
  levels: ApprovalLevel[];
  amount?: number;
  divisionIds?: string[];
}

/**
 * Starts an approval. Call inside a module's own commit (pass ctx) or standalone.
 * Throws if a request of the same type is already pending for the record.
 */
export function requestApprovalIn(ctx: HookContext, req: ApprovalRequest): Approval {
  const { d, actor } = ctx;
  if (!req.levels.length) throw new ServiceError('invalid_state', 'No approval level is configured for this request.');
  if (d.approvals.some((a) => a.recordId === req.recordId && a.type === req.type && a.status === 'pending')) throw new ServiceError('invalid_state', `An approval is already pending for ${req.recordId}.`);
  d.counters.approvals = (d.counters.approvals ?? 1000) + 1;
  const approval: Approval = {
    id: `APR-${d.counters.approvals}`,
    type: req.type,
    workspaceId: actor.workspaceId,
    resource: req.resource,
    recordId: req.recordId,
    requestedBy: actor.user.id,
    requestedAt: nowIso(),
    reason: req.reason.trim(),
    summary: req.summary,
    amount: req.amount,
    divisionIds: req.divisionIds,
    levels: req.levels,
    currentLevel: 0,
    decisions: [],
    status: 'pending',
    version: 1,
  };
  d.approvals.unshift(approval);
  appendAudit(d, actor, { action: 'approval.requested', resource: req.resource, recordId: req.recordId, summary: `Requested ${approvalTypeLabel(req.type).toLowerCase()} (${approval.id}): ${req.summary}`, correlationId: ctx.correlationId });
  emitEvent(d, actor, { eventType: 'approval.requested', recordId: req.recordId, correlationId: ctx.correlationId, payload: { approvalId: approval.id, type: req.type } });
  notifyApprovers(ctx, approval);
  return approval;
}

export function requestApproval(actor: Actor, req: ApprovalRequest): Approval {
  const res = getResource(req.resource);
  return commit((d) => {
    const rec = d.records[req.resource]?.find((r) => r.id === req.recordId);
    if (!rec || !canReadRecord(actor, res, rec)) throw new ServiceError('not_found', `${res.label} ${req.recordId} was not found.`);
    return requestApprovalIn({ d, actor, correlationId: uid('cor') }, req);
  });
}

export function decideApproval(actor: Actor, approvalId: string, decision: 'approved' | 'rejected', note: string, expectedVersion: number): Approval {
  return commit((d) => {
    const a = d.approvals.find((x) => x.id === approvalId && x.workspaceId === actor.workspaceId);
    if (!a) throw new ServiceError('not_found', 'Approval not found.');
    if (a.version !== expectedVersion) throw new ServiceError('version_conflict', 'This approval changed since you opened it. Reload and try again.');
    if (a.status !== 'pending') throw new ServiceError('invalid_state', `This request was already ${a.status}.`);
    if (a.requestedBy === actor.user.id) throw new ServiceError('forbidden', 'Separation of duties: you cannot decide your own request.');
    if (!canDecide(actor, a)) {
      const lv = a.levels[a.currentLevel];
      throw new ServiceError('forbidden', lv.approverStaffId ? `Only the named approver (${lv.label}) can decide this level.` : `Only ${levelHolders(lv.capability).join(' / ')} can decide this level.`);
    }
    if (decision === 'rejected' && note.trim().length < 5) throw new ServiceError('validation', 'Add a note explaining the rejection.', { fieldErrors: { note: 'Required when rejecting' } });
    const at = nowIso();
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    a.decisions.push({ level: a.currentLevel, by: actor.user.id, at, decision, note: note.trim() });
    a.version++;
    const levelLabel = a.levels[a.currentLevel].label;
    const def = types.get(a.type);
    if (decision === 'approved' && a.currentLevel < a.levels.length - 1) {
      a.currentLevel++;
      appendAudit(d, actor, { action: 'approval.level_approved', resource: a.resource, recordId: a.recordId, summary: `${levelLabel} approved ${a.id}; sent to ${a.levels[a.currentLevel].label}`, correlationId: ctx.correlationId });
      notifyApprovers(ctx, a);
      return { ...a };
    }
    a.status = decision;
    a.decidedBy = actor.user.id;
    a.decidedAt = at;
    a.decisionNote = note.trim();
    if (decision === 'approved') def?.onApproved?.(ctx, a);
    else def?.onRejected?.(ctx, a);
    appendAudit(d, actor, { action: 'approval.decided', resource: a.resource, recordId: a.recordId, summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} ${a.id} at ${levelLabel} level${note ? ` — ${note}` : ''}`, correlationId: ctx.correlationId });
    emitEvent(d, actor, { eventType: 'approval.decided', recordId: a.recordId, correlationId: ctx.correlationId, payload: { approvalId: a.id, decision } });
    notify(d, { userId: a.requestedBy, workspaceId: a.workspaceId, kind: 'approval_decision', title: `${a.summary} — ${decision}`, link: { resource: a.resource, recordId: a.recordId } });
    return { ...a };
  });
}

/** Requester withdraws a pending request (e.g. after revising the quotation). */
export function withdrawApproval(actor: Actor, approvalId: string) {
  commit((d) => {
    const a = d.approvals.find((x) => x.id === approvalId && x.workspaceId === actor.workspaceId);
    if (!a || a.status !== 'pending') throw new ServiceError('invalid_state', 'Only pending requests can be withdrawn.');
    if (a.requestedBy !== actor.user.id) throw new ServiceError('forbidden', 'Only the requester can withdraw a request.');
    a.status = 'withdrawn';
    a.version++;
    appendAudit(d, actor, { action: 'approval.withdrawn', resource: a.resource, recordId: a.recordId, summary: `Withdrew ${a.id}`, correlationId: uid('cor') });
  });
}
