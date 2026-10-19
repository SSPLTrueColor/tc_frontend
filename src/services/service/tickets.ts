/**
 * Service ticket domain logic (FR-075 – FR-090). Hooks registered in domain/extensions/service.tsx
 * call the functions here; pages call the actions through services/api/service.ts.
 * All writes go through commit / runtime helpers so they are audited and permission-checked.
 */
import { appPack } from '../../domain/pack';
import { addDays, addMinutes, nowLocal, parseLocal, todayKey } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { uid } from '../../lib/ids';
import { validateMobile, normaliseMobile } from '../../lib/validators';
import type { RecordData } from '../../metadata/types';
import { type Actor, actorFor, can, canReadRecord, canUpdateRecord, currentActor } from '../authz';
import { commit, getDb } from '../db';
import { appendAudit, emitEvent, notify } from '../ledger';
import { byId, coverageFor, employeesWithRole, userOfStaff } from '../lookups';
import { queueMessage } from '../outbox';
import { getPolicies } from '../policies';
import { getResource } from '../registry';
import type { HookContext } from '../resourceHooks';
import { insertRecordIn, patchRecordIn } from '../runtime';
import { ServiceError } from '../types';
import { clockStates, computeDues, hoursSinceBreach, isBreached, resumePatch } from './sla';
import { L } from '../../constants/labels';

const E = L.service.errors;
const A = L.service.audit;
const N = L.service.notify;
const O = L.service.outbox;

export const OPEN_STATUSES = ['open', 'assigned', 'accepted', 'in_progress', 'waiting_parts', 'waiting_customer', 'reopened'];
/** Divisions whose complaints may have no machine (Q-13). */
export const NO_MACHINE_DIVISIONS = ['INK', 'PPR', 'FAB'];
/** Ticket types that never need a chargeable quote (BR-36). */
const NEVER_CHARGEABLE = ['installation', 'pm', 'training'];

const ws = 'tc';
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const resourceExists = (key: string) => appPack.resources.some((r) => r.key === key);

// ---------------------------------------------------------------- notifications

export function notifyStaff(ctx: HookContext, staffId: unknown, title: string, link: { resource: string; recordId: string } | { page: string }, kind: 'assignment' | 'escalation' | 'reminder' | 'info' | 'exception' = 'info') {
  const u = userOfStaff(staffId);
  if (u) notify(ctx.d, { userId: u.id, workspaceId: ws, kind, title, link });
}

/** Coordinators and service leadership for a division (who triage and assign). */
export function serviceDesk(divisionId: unknown, store = getDb().records): RecordData[] {
  const div = s(divisionId) || undefined;
  return [...employeesWithRole('coordinator', div, store), ...employeesWithRole('service_head', div, store)];
}

/** SLA escalation level → role name (SRV-09: Service Manager → Service Head → GM → MD). */
export const escalationRole = (level: number, fallback = '') => L.roles.escalationLevels[level as keyof typeof L.roles.escalationLevels] ?? fallback;

export const customerName = (customerId: unknown, store = getDb().records) => s(byId('customers', customerId, store)?.name) || s(customerId) || L.service.titles.unknownCustomer;

// ---------------------------------------------------------------- creation defaults (beforeCreate)

/**
 * Fills reported time, machine-derived customer/division, coverage (BR-29), SLA due times (BR-30),
 * repeat-complaint flag (BR-33) and the feedback token. Validates Q-13 (machine optional only for
 * Ink / Paper / Fabric).
 */
export function applyTicketDefaults(ctx: HookContext, c: Record<string, unknown>) {
  const store = ctx.d.records;
  const now = nowLocal();
  c.reportedAt = c.reportedAt || now;
  const machine = c.machineId ? byId('machines', c.machineId, store) : undefined;
  if (machine) {
    c.customerId = c.customerId || machine.customerId;
    c.divisionId = c.divisionId || machine.divisionId;
  }
  if (!c.divisionId && c.customerId) c.divisionId = ((byId('customers', c.customerId, store)?.divisionIds as string[] | undefined) ?? [])[0] ?? null;
  if (!c.machineId && !NO_MACHINE_DIVISIONS.includes(s(c.divisionId)) && c.ticketType !== 'spare_only') {
    throw new ServiceError('validation', E.machineRequired, { fieldErrors: { machineId: E.machineRequiredField } });
  }
  if (!c.divisionId) throw new ServiceError('validation', E.divisionRequired, { fieldErrors: { divisionId: E.divisionRequiredField } });
  c.coverage = c.machineId ? coverageFor(s(c.machineId), s(c.reportedAt).slice(0, 10), store) : 'none';
  Object.assign(c, computeDues(getPolicies(), s(c.reportedAt), s(c.priority || 'medium'), s(c.coverage)));
  // BR-33 repeat complaint: same machine + category within the policy window.
  if (c.machineId && c.category) {
    const since = addDays(s(c.reportedAt).slice(0, 10), -getPolicies().repeatComplaintDays);
    const prior = (store.tickets ?? [])
      .filter((t) => t.machineId === c.machineId && t.category === c.category && s(t.reportedAt).slice(0, 10) >= since)
      .sort((a, b) => s(b.reportedAt).localeCompare(s(a.reportedAt)))[0];
    c.repeatOfId = prior?.id ?? null;
  }
  // Engineers logging from the field own the ticket they create.
  if (!c.assigneeId && ctx.actor.role.id === 'engineer') c.assigneeId = ctx.actor.staffId;
  if (c.assigneeId) {
    c.status = 'assigned';
    c.respondedAt = now;
  }
  c.feedbackToken = c.feedbackToken || uid('fb').replace(/^fb_/, '');
  c.chargeableStatus = c.chargeableStatus || 'none';
  c.reopenCount = c.reopenCount ?? 0;
  c.pausedMinutes = c.pausedMinutes ?? 0;
  c.escalationLevel = c.escalationLevel ?? 0;
  c.slaBreached = false;
}

export function afterTicketCreated(ctx: HookContext, t: RecordData) {
  const title = N.newTicket(s(t.priority) === 'critical', t.id, customerName(t.customerId, ctx.d.records));
  if (t.assigneeId && t.assigneeId !== ctx.actor.staffId) notifyStaff(ctx, t.assigneeId, N.assignedToYou(title), { resource: 'tickets', recordId: t.id }, 'assignment');
  if (!t.assigneeId) serviceDesk(t.divisionId, ctx.d.records).forEach((e) => e.id !== ctx.actor.staffId && notifyStaff(ctx, e.id, N.needsEngineer(title), { resource: 'tickets', recordId: t.id }, 'assignment'));
  if (t.repeatOfId) serviceDesk(t.divisionId, ctx.d.records).forEach((e) => notifyStaff(ctx, e.id, N.repeat(t.id, s(t.repeatOfId)), { resource: 'tickets', recordId: t.id }, 'exception'));
}

// ---------------------------------------------------------------- edits and transitions

export function guardTicketUpdate(ctx: HookContext, before: RecordData, c: Record<string, unknown>) {
  if (c.assigneeId !== before.assigneeId && !can(ctx.actor, 'ticket.assign')) throw new ServiceError('forbidden', E.changeEngineer);
  if (c.priority !== before.priority && OPEN_STATUSES.includes(s(before.status))) {
    // Priority change re-targets the clocks that are still running.
    const dues = computeDues(getPolicies(), s(before.reportedAt), s(c.priority), s(before.coverage));
    if (!before.respondedAt) c.responseDueAt = addMinutes(dues.responseDueAt, Number(before.pausedMinutes ?? 0));
    if (!before.arrivedAt) c.arrivalDueAt = addMinutes(dues.arrivalDueAt, Number(before.pausedMinutes ?? 0));
    if (!before.resolvedAt) c.resolutionDueAt = addMinutes(dues.resolutionDueAt, Number(before.pausedMinutes ?? 0));
  }
  if (c.assigneeId && c.assigneeId !== before.assigneeId && ['open', 'reopened'].includes(s(before.status))) {
    c.status = 'assigned';
    c.respondedAt = before.respondedAt || nowLocal();
  }
}

export function afterTicketUpdated(ctx: HookContext, before: RecordData, after: RecordData) {
  if (after.assigneeId && after.assigneeId !== before.assigneeId && after.assigneeId !== ctx.actor.staffId) {
    notifyStaff(ctx, after.assigneeId, N.assignedShort(after.id, customerName(after.customerId, ctx.d.records)), { resource: 'tickets', recordId: after.id }, 'assignment');
  }
}

export function chargeableBlocker(t: RecordData): string | null {
  if (t.coverage !== 'none' || NEVER_CHARGEABLE.includes(s(t.ticketType))) return null;
  if (['approved', 'billing_requested', 'waived'].includes(s(t.chargeableStatus))) return null;
  return E.chargeableBlocker;
}

export function guardTicketTransition(ctx: HookContext, t: RecordData, to: string) {
  const isAssignee = t.assigneeId === ctx.actor.staffId;
  const from = s((ctx.d.records.tickets ?? []).find((x) => x.id === t.id)?.status);
  if (to === 'assigned' && !t.assigneeId) throw new ServiceError('invalid_state', E.chooseEngineerFirst);
  if ((to === 'accepted' || (from === 'assigned' && to === 'open')) && !isAssignee && !can(ctx.actor, 'ticket.assign')) throw new ServiceError('forbidden', E.onlyAssigneeAccept);
  if (to === 'resolved') {
    if (!s(t.resolution).trim()) throw new ServiceError('validation', E.workDoneRequired, { fieldErrors: { resolution: E.requiredToResolve } });
    const block = chargeableBlocker(t);
    if (block) throw new ServiceError('invalid_state', block);
  }
  if (to === 'closed' && t.repeatOfId && !s(t.rootCause).trim()) throw new ServiceError('validation', E.rootCauseRequired(s(t.repeatOfId)), { fieldErrors: { rootCause: E.rootCauseField } });
  if (to === 'reopened') {
    const closed = s(t.closedAt).slice(0, 10);
    if (closed && addDays(closed, getPolicies().reopenWindowDays) < todayKey()) throw new ServiceError('invalid_state', E.reopenWindow(getPolicies().reopenWindowDays));
  }
}

/** Status side effects: SLA timestamps, pause/resume, feedback link, re-open reset. */
export function afterTicketTransition(ctx: HookContext, before: RecordData, after: RecordData) {
  const now = nowLocal();
  const from = s(before.status);
  const to = s(after.status);
  const patch: Record<string, unknown> = {};
  if (from === 'waiting_customer' && to !== 'waiting_customer') Object.assign(patch, resumePatch(after, now));
  if (to === 'waiting_customer') patch.pausedSince = now;
  if (to === 'assigned' && !after.respondedAt) patch.respondedAt = now;
  if (to === 'in_progress' && !after.arrivedAt) patch.arrivedAt = now;
  if (from === 'assigned' && to === 'open') {
    patch.assigneeId = null;
    serviceDesk(after.divisionId, ctx.d.records).forEach((e) => notifyStaff(ctx, e.id, N.rejected(ctx.actor.user.name, after.id), { resource: 'tickets', recordId: after.id }, 'assignment'));
  }
  if (to === 'resolved') {
    patch.resolvedAt = now;
    patch.status = 'customer_confirmation';
  }
  if (to === 'customer_confirmation' && from !== 'resolved') patch.resolvedAt = after.resolvedAt || now;
  if (from === 'customer_confirmation' && to === 'in_progress') {
    patch.resolvedAt = null;
    if (after.assigneeId) notifyStaff(ctx, after.assigneeId, N.notResolved(after.id), { resource: 'tickets', recordId: after.id }, 'exception');
  }
  if (to === 'closed') patch.closedAt = now;
  if (to === 'reopened') {
    Object.assign(patch, computeDues(getPolicies(), now, s(after.priority), s(after.coverage)), {
      reopenCount: Number(after.reopenCount ?? 0) + 1,
      closedAt: null,
      resolvedAt: null,
      arrivedAt: null,
      respondedAt: after.assigneeId ? now : null,
      slaBreached: false,
      escalationLevel: 0,
      pausedMinutes: 0,
      feedbackToken: uid('fb').replace(/^fb_/, ''),
    });
    [after.assigneeId, ...serviceDesk(after.divisionId, ctx.d.records).map((e) => e.id)].filter(Boolean).forEach((id) => notifyStaff(ctx, id, N.reopened(after.id), { resource: 'tickets', recordId: after.id }, 'exception'));
  }
  if (Object.keys(patch).length) {
    const next = patchRecordIn(ctx, 'tickets', after.id, patch, to === 'resolved' ? A.resolvedWaiting : undefined);
    if (to === 'resolved') sendClosurePack(ctx, next);
  }
}

/** FR-082 + FR-086: job card and feedback link go to the customer contact (simulated). */
export function sendClosurePack(ctx: HookContext, t: RecordData) {
  const contact = byId('contacts', t.contactId, ctx.d.records) ?? (ctx.d.records.contacts ?? []).find((c) => c.customerId === t.customerId);
  const to = s(contact?.whatsapp || contact?.mobile) || customerName(t.customerId, ctx.d.records);
  const link = `${location.origin}/feedback/${s(t.feedbackToken)}`;
  queueMessage(ctx, {
    channel: 'whatsapp',
    to,
    templateId: 'ticket.resolved',
    body: O.resolved(t.id, link),
    related: { resource: 'tickets', recordId: t.id },
  });
  if (contact?.email) {
    queueMessage(ctx, {
      channel: 'email',
      to: s(contact.email),
      subject: O.jobCardSubject(t.id),
      templateId: 'ticket.jobcard',
      body: O.jobCard(t.id, customerName(t.customerId, ctx.d.records), s(t.resolution).slice(0, 160), link),
      related: { resource: 'tickets', recordId: t.id },
    });
  }
}

// ---------------------------------------------------------------- actions (own commits)

/** Runs a ticket mutation with read + update permission checks and returns the patched record. */
function mutateTicket(actor: Actor, id: string, opts: { allow?: (t: RecordData) => boolean; denied?: string }, fn: (ctx: HookContext, t: RecordData) => Record<string, unknown> | void, summary?: string) {
  const res = getResource('tickets');
  return commit((d) => {
    const t = (d.records.tickets ?? []).find((x) => x.id === id);
    if (!t || !canReadRecord(actor, res, t)) throw new ServiceError('not_found', E.notFoundOrNoAccess(id));
    const allowed = opts.allow ? opts.allow(t) : canUpdateRecord(actor, res, t);
    if (!allowed) throw new ServiceError('forbidden', opts.denied ?? E.roleCannotChange(actor.role.label));
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    const patch = fn(ctx, t);
    return patch && Object.keys(patch).length ? patchRecordIn(ctx, 'tickets', id, patch, summary) : t;
  });
}

const deskOrAssignee = (actor: Actor) => (t: RecordData) => can(actor, 'ticket.assign') || t.assigneeId === actor.staffId;

/** Assign (or re-assign) an engineer; open tickets move to Assigned and the response clock stops. */
export function assignTicket(actor: Actor, id: string, staffId: string) {
  if (!can(actor, 'ticket.assign')) throw new ServiceError('forbidden', E.onlyDeskAssigns);
  const eng = byId('employees', staffId);
  if (!eng || eng.status === 'inactive') throw new ServiceError('validation', E.activeEngineer);
  return mutateTicket(
    actor,
    id,
    { allow: () => true },
    (ctx, t) => {
      if (!OPEN_STATUSES.includes(s(t.status))) throw new ServiceError('invalid_state', E.onlyOpenAssign);
      const now = nowLocal();
      notifyStaff(ctx, staffId, N.assignedWithPriority(t.id, customerName(t.customerId, ctx.d.records), L.service.masters.ticketPriority.values[s(t.priority) as keyof typeof L.service.masters.ticketPriority.values] ?? s(t.priority)), { resource: 'tickets', recordId: t.id }, 'assignment');
      return { assigneeId: staffId, status: ['open', 'reopened'].includes(s(t.status)) ? 'assigned' : t.status, respondedAt: t.respondedAt || now };
    },
    A.assignedTo(s(eng.fullName)),
  );
}

/** FR-081: remote support record; optionally resolves the call or converts it to a site visit. */
export function recordRemoteSession(actor: Actor, id: string, input: { steps: string; durationMin: number; sessionRef: string; outcome: 'resolved' | 'site_visit' | 'continue' }) {
  if (!input.steps.trim()) throw new ServiceError('validation', E.stepsRequired, { fieldErrors: { steps: E.required } });
  if (!(input.durationMin > 0)) throw new ServiceError('validation', E.durationRequired, { fieldErrors: { durationMin: E.moreThanZero } });
  return mutateTicket(
    actor,
    id,
    { allow: deskOrAssignee(actor), denied: E.remoteDenied },
    (ctx, t) => {
      const now = nowLocal();
      insertRecordIn(ctx, 'serviceVisits', { ticketId: t.id, engineerId: t.assigneeId || actor.staffId, visitType: 'remote', status: 'completed', checkInAt: now, checkOutAt: now, diagnosis: input.steps, workDone: input.outcome === 'resolved' ? input.steps : '' });
      const patch: Record<string, unknown> = {
        remoteSteps: [s(t.remoteSteps), input.steps.trim()].filter(Boolean).join('\n---\n'),
        remoteDurationMin: Number(t.remoteDurationMin ?? 0) + input.durationMin,
        remoteSessionRef: input.sessionRef.trim() || t.remoteSessionRef,
        respondedAt: t.respondedAt || now,
      };
      if (input.outcome === 'site_visit') {
        patch.ticketType = t.ticketType === 'remote_support' ? 'breakdown' : t.ticketType;
        serviceDesk(t.divisionId, ctx.d.records).forEach((e) => notifyStaff(ctx, e.id, N.remoteToSite(t.id), { resource: 'tickets', recordId: t.id }, 'assignment'));
      }
      if (input.outcome === 'resolved') {
        patch.resolution = [s(t.resolution), A.resolvedRemotely(input.steps.trim())].filter(Boolean).join('\n');
        patch.arrivedAt = t.arrivedAt || now;
      }
      return patch;
    },
    input.outcome === 'site_visit' ? A.remoteToSite : A.remoteRecorded,
  );
}

/** FR-084 / BR-36 chargeable service. */
export function quoteChargeable(actor: Actor, id: string, amount: number, note: string) {
  if (!(amount > 0)) throw new ServiceError('validation', E.amountRequired, { fieldErrors: { amount: E.moreThanZero } });
  if (!note.trim()) throw new ServiceError('validation', E.noteRequired, { fieldErrors: { note: E.required } });
  return mutateTicket(
    actor,
    id,
    { allow: (t) => can(actor, 'ticket.chargeable') || t.assigneeId === actor.staffId, denied: E.quoteDenied },
    (ctx, t) => {
      if (['billing_requested'].includes(s(t.chargeableStatus))) throw new ServiceError('invalid_state', E.billingAlready);
      const contact = byId('contacts', t.contactId, ctx.d.records);
      queueMessage(ctx, { channel: 'whatsapp', to: s(contact?.whatsapp || contact?.mobile) || customerName(t.customerId, ctx.d.records), templateId: 'ticket.chargeable_quote', body: O.quote(t.id, formatMoney(amount), note.trim()), related: { resource: 'tickets', recordId: t.id } });
      return { chargeableStatus: 'quoted', chargeableAmount: amount, chargeableNote: note.trim() };
    },
    A.quoteSent(formatMoney(amount)),
  );
}

export function recordChargeableDecision(actor: Actor, id: string, approved: boolean) {
  return mutateTicket(
    actor,
    id,
    { allow: () => can(actor, 'ticket.chargeable'), denied: E.decisionDenied },
    (_ctx, t) => {
      if (t.chargeableStatus !== 'quoted') throw new ServiceError('invalid_state', E.quoteFirst);
      return { chargeableStatus: approved ? 'approved' : 'rejected' };
    },
    approved ? A.customerApproved : A.customerDeclined,
  );
}

export function requestBilling(actor: Actor, id: string) {
  return mutateTicket(
    actor,
    id,
    { allow: () => can(actor, 'ticket.chargeable'), denied: E.billingDenied },
    (ctx, t) => {
      if (t.chargeableStatus !== 'approved') throw new ServiceError('invalid_state', E.billingNeedsApproval);
      emitEvent(ctx.d, actor, { eventType: 'erp.billing_requested', resourceId: 'res_tickets', recordId: t.id, correlationId: ctx.correlationId, payload: { amount: t.chargeableAmount }, classification: 'financial' });
      appendAudit(ctx.d, actor, { action: 'erp.billing_request', resource: 'tickets', recordId: t.id, summary: A.billingRequest(formatMoney(Number(t.chargeableAmount))), correlationId: ctx.correlationId });
      return { chargeableStatus: 'billing_requested' };
    },
  );
}

export function waiveCharges(actor: Actor, id: string, reason: string) {
  if (!can(actor, 'approve.service')) throw new ServiceError('forbidden', E.waiveDenied);
  if (reason.trim().length < 5) throw new ServiceError('validation', E.waiveReason, { fieldErrors: { reason: E.atLeast5 } });
  return mutateTicket(actor, id, { allow: () => true }, () => ({ chargeableStatus: 'waived', chargeableNote: A.waivedNote(reason.trim()) }), A.waived(reason.trim()));
}

const INTEREST_PRODUCT: Record<string, string> = { new_machine: 'machine', upgrade: 'machine', amc: 'service', consumables: 'ink' };
const CONSUMABLE_BY_DIVISION: Record<string, string> = { INK: 'ink', PPR: 'paper', FAB: 'fabric' };

/** FR-088 / BR-37: engineer flags a sales opportunity → lead with the engineer as referrer. */
export function opportunitySpotted(actor: Actor, id: string, input: { interest: string; note: string }) {
  if (!resourceExists('leads')) throw new ServiceError('invalid_state', E.leadsUnavailable);
  if (!input.note.trim()) throw new ServiceError('validation', E.describeNeed, { fieldErrors: { note: E.required } });
  return mutateTicket(
    actor,
    id,
    { allow: (t) => t.assigneeId === actor.staffId || can(actor, 'ticket.assign') },
    (ctx, t) => {
      const customer = byId('customers', t.customerId, ctx.d.records);
      const contact = byId('contacts', t.contactId, ctx.d.records) ?? (ctx.d.records.contacts ?? []).find((c) => c.customerId === t.customerId);
      if (!contact) throw new ServiceError('validation', E.noContact);
      const productType = input.interest === 'consumables' ? CONSUMABLE_BY_DIVISION[s(t.divisionId)] ?? 'ink' : INTEREST_PRODUCT[input.interest] ?? 'machine';
      const lead = insertRecordIn(ctx, 'leads', {
        customerId: t.customerId,
        contactId: contact.id,
        divisionId: t.divisionId,
        sourceId: 'referral',
        referrerType: 'engineer',
        referrerEmployeeId: actor.staffId,
        productType,
        requirement: A.spottedRequirement(actor.user.name, t.id, input.note.trim()),
        ownerId: customer?.ownerId ?? actor.staffId,
        nextFollowUpAt: addDays(todayKey(), 1),
      });
      if (customer?.ownerId) notifyStaff(ctx, customer.ownerId, N.spotted(actor.user.name, s(customer.name), lead.id), { resource: 'leads', recordId: lead.id }, 'assignment');
      return { spottedLeadId: lead.id };
    },
    A.spotted,
  );
}

/** Re-sends the job card + feedback link (FR-082). */
export function resendJobCard(actor: Actor, id: string) {
  return mutateTicket(actor, id, { allow: (t) => canReadRecord(actor, getResource('tickets'), t) }, (ctx, t) => {
    if (!t.resolvedAt) throw new ServiceError('invalid_state', E.jobCardAfterResolve);
    sendClosurePack(ctx, t);
  });
}

// ---------------------------------------------------------------- public: customer feedback (FR-086)

const system = () => actorFor('u_rahul', ws);

export function feedbackLookup(token: string) {
  const t = (getDb().records.tickets ?? []).find((x) => x.feedbackToken === token);
  if (!t) return null;
  return {
    id: t.id,
    customer: customerName(t.customerId),
    machine: s(byId('machines', t.machineId)?.serialNo),
    description: s(t.description),
    resolution: s(t.resolution),
    status: s(t.status),
    rating: t.rating ? Number(t.rating) : null,
    canRespond: t.status === 'customer_confirmation' && !t.rating,
  };
}

/** Customer confirms (closes) or says "not resolved"; rating ≤ threshold alerts service leadership (BR-35). */
export function submitFeedback(token: string, input: { rating: number; comment: string; resolved: boolean }) {
  if (!(input.rating >= 1 && input.rating <= 5)) throw new ServiceError('validation', E.chooseRating, { fieldErrors: { rating: E.required } });
  const actor = system();
  return commit((d) => {
    const t = (d.records.tickets ?? []).find((x) => x.feedbackToken === token);
    if (!t) throw new ServiceError('not_found', E.feedbackInvalid);
    if (t.status !== 'customer_confirmation' || t.rating) throw new ServiceError('invalid_state', E.feedbackAlready);
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    const now = nowLocal();
    const patch: Record<string, unknown> = { rating: input.rating, feedbackComment: input.comment.trim() };
    if (!input.resolved) {
      Object.assign(patch, { status: 'in_progress', resolvedAt: null, rating: null, feedbackComment: A.notResolvedComment(input.rating, input.comment.trim()) });
      if (t.assigneeId) notifyStaff(ctx, t.assigneeId, N.notResolved(t.id), { resource: 'tickets', recordId: t.id }, 'exception');
    } else if (t.repeatOfId && !s(t.rootCause).trim()) {
      serviceDesk(t.divisionId, d.records).forEach((e) => notifyStaff(ctx, e.id, N.confirmAddRootCause(t.id), { resource: 'tickets', recordId: t.id }, 'reminder'));
    } else {
      Object.assign(patch, { status: 'closed', closedAt: now });
    }
    if (input.rating <= getPolicies().lowRatingThreshold) {
      employeesWithRole('service_head', s(t.divisionId), d.records).forEach((e) => notifyStaff(ctx, e.id, N.lowRating(input.rating, t.id, customerName(t.customerId, d.records)), { resource: 'tickets', recordId: t.id }, 'escalation'));
    }
    appendAudit(d, actor, { action: 'feedback.received', actorType: 'system', resource: 'tickets', recordId: t.id, summary: A.feedback(input.rating, input.resolved), correlationId: ctx.correlationId });
    return patchRecordIn(ctx, 'tickets', t.id, patch, A.feedbackReceived);
  });
}

// ---------------------------------------------------------------- public: customer portal + incoming messages (FR-075)

export interface PortalMatch {
  customerId: string;
  customerName: string;
  contactId?: string;
  machines: { id: string; serialNo: string; model: string; divisionId: string }[];
  divisionIds: string[];
}

/** Identify a customer by registered mobile number or machine serial number. */
export function portalIdentify(query: string): PortalMatch | null {
  const q = query.trim();
  if (!q) return null;
  const db = getDb().records;
  let customerId: string | undefined;
  let contactId: string | undefined;
  const machine = (db.machines ?? []).find((m) => s(m.serialNo).toUpperCase() === q.toUpperCase());
  if (machine) customerId = s(machine.customerId);
  else if (!validateMobile(q)) {
    const mob = normaliseMobile(q);
    const c = (db.contacts ?? []).find((x) => x.customerId && (normaliseMobile(s(x.mobile)) === mob || normaliseMobile(s(x.whatsapp)) === mob));
    customerId = c ? s(c.customerId) : undefined;
    contactId = c?.id;
  }
  if (!customerId) return null;
  const customer = byId('customers', customerId, db);
  return {
    customerId,
    customerName: s(customer?.name) || customerId,
    contactId: contactId ?? (db.contacts ?? []).find((x) => x.customerId === customerId)?.id,
    machines: (db.machines ?? []).filter((m) => m.customerId === customerId).map((m) => ({ id: m.id, serialNo: s(m.serialNo), model: s(m.model), divisionId: s(m.divisionId) })),
    divisionIds: (customer?.divisionIds as string[] | undefined) ?? [],
  };
}

export interface NewTicketInput {
  customerId: string;
  contactId?: string;
  machineId?: string;
  divisionId?: string;
  description: string;
  category: string;
  priority: string;
  channel: 'portal' | 'whatsapp' | 'email';
}

/** Creates a ticket on behalf of a customer (portal) or from an incoming message (simulated). */
export function createTicketFromChannel(input: NewTicketInput, actor: Actor = system()) {
  if (input.description.trim().length < 10) throw new ServiceError('validation', E.describeProblem, { fieldErrors: { description: E.atLeast10 } });
  return commit((d) => {
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    const t = insertRecordIn(ctx, 'tickets', {
      customerId: input.customerId,
      contactId: input.contactId ?? null,
      machineId: input.machineId || null,
      divisionId: input.divisionId || null,
      description: input.description.trim(),
      category: input.category,
      ticketType: 'breakdown',
      priority: input.priority,
      channel: input.channel,
    });
    const contact = byId('contacts', input.contactId, d.records);
    if (contact) queueMessage(ctx, { channel: input.channel === 'email' ? 'email' : 'whatsapp', to: s(input.channel === 'email' ? contact.email : contact.whatsapp || contact.mobile), templateId: 'ticket.acknowledged', body: O.acknowledged(t.id), related: { resource: 'tickets', recordId: t.id } });
    return t;
  });
}

/** Simulated incoming WhatsApp / email (desk): identify the sender, then log the ticket. */
export function simulateIncoming(actor: Actor, input: { channel: 'whatsapp' | 'email'; from: string; message: string }) {
  if (!can(actor, 'ticket.assign')) throw new ServiceError('forbidden', E.incomingDenied);
  const db = getDb().records;
  let match: PortalMatch | null = null;
  if (input.channel === 'email') {
    const c = (db.contacts ?? []).find((x) => s(x.email).toLowerCase() === input.from.trim().toLowerCase() && x.customerId);
    match = c ? portalIdentify(s(c.mobile)) ?? { customerId: s(c.customerId), customerName: customerName(c.customerId), contactId: c.id, machines: [], divisionIds: [] } : null;
    if (match && c) match.contactId = c.id;
  } else match = portalIdentify(input.from);
  if (!match) throw new ServiceError('not_found', E.noCustomerFor(input.from), { fieldErrors: { from: E.notRegistered } });
  const machine = match.machines[0];
  return createTicketFromChannel(
    {
      customerId: match.customerId,
      contactId: match.contactId,
      machineId: machine?.id,
      divisionId: machine?.divisionId ?? match.divisionIds[0],
      description: input.message,
      category: 'other',
      priority: /down|stopped|not working|urgent/i.test(input.message) ? 'critical' : 'medium',
      channel: input.channel,
    },
    actor,
  );
}

// ---------------------------------------------------------------- SLA sweep (breach, escalation, auto-close, PM status)

/**
 * Idempotent sweep on the simulated clock (BR-32, auto-close, PM due/overdue/missed). Writes only
 * when something changes, so it is safe to run on every page load and on a timer.
 */
export function sweepService(actor: Actor = currentActor()): number {
  const db = getDb();
  const now = nowLocal();
  const today = todayKey();
  const policies = getPolicies();
  type Change = { key: string; id: string; patch: Record<string, unknown>; notes: ((ctx: HookContext) => void)[]; summary: string };
  const changes: Change[] = [];

  for (const t of db.records.tickets ?? []) {
    const notes: Change['notes'] = [];
    const patch: Record<string, unknown> = {};
    const status = s(t.status);
    if (OPEN_STATUSES.includes(status) || status === 'resolved') {
      const states = clockStates(t, now);
      if (isBreached(states) && !t.slaBreached) patch.slaBreached = true;
      const h = hoursSinceBreach(states, now);
      if (h !== null && status !== 'waiting_customer') {
        const level = policies.escalation.filter((e) => h >= e.afterHours).length;
        if (level > Number(t.escalationLevel ?? 0)) {
          patch.escalationLevel = level;
          const step = policies.escalation[level - 1];
          notes.push((ctx) => {
            const div = s(t.divisionId);
            const who = level <= 2 ? employeesWithRole('service_head', div, ctx.d.records) : level === 3 ? employeesWithRole('division_head', div, ctx.d.records) : employeesWithRole('management', undefined, ctx.d.records);
            who.forEach((e) => notifyStaff(ctx, e.id, N.escalated(escalationRole(level, step.to), t.id, customerName(t.customerId, ctx.d.records)), { resource: 'tickets', recordId: t.id }, 'escalation'));
          });
        }
      }
    }
    if (status === 'customer_confirmation' && t.resolvedAt && addDays(s(t.resolvedAt).slice(0, 10), policies.autoCloseDays) < today && !(t.repeatOfId && !s(t.rootCause).trim())) {
      Object.assign(patch, { status: 'closed', closedAt: now });
    }
    if (Object.keys(patch).length) changes.push({ key: 'tickets', id: t.id, patch, notes, summary: patch.status === 'closed' ? A.autoClosed(policies.autoCloseDays) : patch.escalationLevel ? A.escalation(escalationRole(Number(patch.escalationLevel), s(policies.escalation[Number(patch.escalationLevel) - 1]?.to))) : A.breached });
  }
  for (const pm of db.records.pmVisits ?? []) {
    if (['done'].includes(s(pm.status))) continue;
    const due = s(pm.dueDate);
    const next = due < addDays(today, -30) ? 'missed' : due < today ? 'overdue' : 'due';
    if (next !== pm.status) changes.push({ key: 'pmVisits', id: pm.id, patch: { status: next }, notes: [], summary: A.pmStatus(L.service.masters.pmStatus.values[next]) });
  }
  if (!changes.length) return 0;
  commit((d) => {
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    changes.forEach((c) => {
      patchRecordIn(ctx, c.key, c.id, c.patch, c.summary);
      c.notes.forEach((n) => n(ctx));
    });
  });
  return changes.length;
}

/** Hours between two local times (for reports and the Engineer Calendar & Map). */
export const hoursBetween = (a: string, b: string) => (parseLocal(b).getTime() - parseLocal(a).getTime()) / 3_600_000;
