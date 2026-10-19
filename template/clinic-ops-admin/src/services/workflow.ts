/**
 * Workflow Runtime (simulated): owns formal approval decisions.
 * - Requesting creates an Approval (workflow-owned) plus a review Task (work-owned).
 * - Completing the task or reading the notification never decides the approval.
 * - Separation of duties: a requester cannot decide their own request.
 */
import { demoUsers } from '../domain/clinic/pack';
import { formatMoney } from '../lib/format';
import { uid } from '../lib/ids';
import { todayKey, addDays } from '../lib/dates';
import { type Actor, can, canReadRecord, actorFor } from './authz';
import { commit, getDb } from './db';
import { appendAudit, emitEvent, notify } from './ledger';
import { getResource } from './registry';
import { withComputed } from './runtime';
import { type Approval, ServiceError } from './types';

export function listApprovals(actor: Actor): Approval[] {
  return getDb().approvals.filter(
    (a) => a.workspaceId === actor.workspaceId && (can(actor, 'approve.writeoff') || a.requestedBy === actor.user.id),
  );
}

export function pendingApprovalFor(recordId: string) {
  return getDb().approvals.find((a) => a.recordId === recordId && a.status === 'pending');
}

export function requestWriteOff(actor: Actor, invoiceId: string, reason: string): Approval {
  if (!can(actor, 'billing.writeoff.request')) throw new ServiceError('forbidden', 'Your role cannot request write-offs.');
  if (reason.trim().length < 10) throw new ServiceError('validation', 'Give a reason of at least 10 characters.', { fieldErrors: { reason: 'At least 10 characters' } });
  const res = getResource('invoices');
  return commit((d) => {
    const inv = d.records.invoices.find((r) => r.id === invoiceId);
    if (!inv || !canReadRecord(actor, res, inv)) throw new ServiceError('not_found', `Invoice ${invoiceId} was not found.`);
    if (!['issued', 'partially_paid'].includes(String(inv.status))) throw new ServiceError('invalid_state', 'Only open invoices can be written off.');
    if (d.approvals.some((a) => a.recordId === invoiceId && a.status === 'pending')) throw new ServiceError('invalid_state', 'A write-off request is already pending for this invoice.');
    const balance = Number(withComputed(res, inv).balance);
    const correlationId = uid('cor');
    const approvalId = `APR-${(d.counters.approvals = (d.counters.approvals ?? 1000) + 1)}`;
    const manager = demoUsers.find((u) => u.roleId === 'practice_manager')!;
    const taskId = (() => {
      const nums = d.records.tasks.filter((t) => t.workspaceId === actor.workspaceId).map((t) => Number(t.id.split('-')[1]));
      return `T-${Math.max(actor.workspaceId === 'hillcrest' ? 2000 : 1000, ...nums) + 1}`;
    })();
    const approval: Approval = {
      id: approvalId,
      type: 'invoice.writeoff',
      workspaceId: actor.workspaceId,
      resource: 'invoices',
      recordId: invoiceId,
      requestedBy: actor.user.id,
      requestedAt: new Date().toISOString(),
      reason: reason.trim(),
      amount: balance,
      status: 'pending',
      taskId,
      version: 1,
    };
    d.approvals.unshift(approval);
    const now = new Date().toISOString();
    d.records.tasks.unshift({
      id: taskId,
      workspaceId: actor.workspaceId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: 'workflow',
      title: `Review write-off request for ${invoiceId}`,
      assigneeId: manager.staffIds[actor.workspaceId],
      dueDate: addDays(todayKey(), 2),
      priority: 'high',
      status: 'todo',
      relatedLabel: `${approvalId} · ${invoiceId}`,
      description: 'Completing this task does NOT approve the write-off. Decide in Work inbox → Approvals.',
    });
    appendAudit(d, actor, { action: 'approval.requested', resource: 'invoices', recordId: invoiceId, summary: `Requested write-off of ${formatMoney(balance)} (${approvalId})`, correlationId });
    emitEvent(d, actor, { eventType: 'approval.requested', recordId: invoiceId, correlationId, payload: { approvalId, type: approval.type } });
    demoUsers
      .filter((u) => actorFor(u.id, actor.workspaceId).role.capabilities.includes('approve.writeoff') && u.id !== actor.user.id)
      .forEach((u) => notify(d, { userId: u.id, workspaceId: actor.workspaceId, kind: 'approval_request', title: `Write-off approval requested for ${invoiceId}`, link: { page: 'inbox' } }));
    return approval;
  });
}

export function decideApproval(actor: Actor, approvalId: string, decision: 'approved' | 'rejected', note: string, expectedVersion: number): Approval {
  if (!can(actor, 'approve.writeoff')) throw new ServiceError('forbidden', 'Your role cannot decide write-off approvals.');
  return commit((d) => {
    const a = d.approvals.find((x) => x.id === approvalId && x.workspaceId === actor.workspaceId);
    if (!a) throw new ServiceError('not_found', 'Approval not found.');
    if (a.version !== expectedVersion) throw new ServiceError('version_conflict', 'This approval changed since you opened it.');
    if (a.status !== 'pending') throw new ServiceError('invalid_state', `This request was already ${a.status}.`);
    if (a.requestedBy === actor.user.id) throw new ServiceError('forbidden', 'Separation of duties: you cannot decide your own request.');
    if (decision === 'rejected' && note.trim().length < 5) throw new ServiceError('validation', 'Add a note explaining the rejection.', { fieldErrors: { note: 'Required when rejecting' } });
    a.status = decision;
    a.decidedBy = actor.user.id;
    a.decidedAt = new Date().toISOString();
    a.decisionNote = note.trim();
    a.version++;
    const correlationId = uid('cor');
    if (decision === 'approved') {
      const idx = d.records.invoices.findIndex((r) => r.id === a.recordId);
      const inv = d.records.invoices[idx];
      if (inv && ['issued', 'partially_paid'].includes(String(inv.status))) {
        d.records.invoices[idx] = { ...inv, status: 'written_off', version: inv.version + 1, updatedAt: a.decidedAt };
        appendAudit(d, actor, {
          action: 'transition',
          actorType: 'workflow',
          resource: 'invoices',
          recordId: a.recordId,
          summary: `Written off by workflow after approval ${a.id}`,
          changes: [{ field: 'status', label: 'Status', before: String(inv.status), after: 'Written off' }],
          correlationId,
        });
      }
    }
    appendAudit(d, actor, { action: 'approval.decided', resource: 'invoices', recordId: a.recordId, summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} ${a.id}${note ? ` — ${note}` : ''}`, correlationId });
    emitEvent(d, actor, { eventType: 'approval.decided', recordId: a.recordId, correlationId, payload: { approvalId: a.id, decision } });
    notify(d, { userId: a.requestedBy, workspaceId: a.workspaceId, kind: 'approval_decision', title: `Your write-off request ${a.id} was ${decision}`, link: { resource: 'invoices', recordId: a.recordId } });
    return { ...a };
  });
}
