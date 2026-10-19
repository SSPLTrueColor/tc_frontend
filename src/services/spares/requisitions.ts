/**
 * Spares Requisition workflow (SPR-03/04/06, BR-38) and stock (SPR-01/02/06).
 * Actions that capture data run here inside one commit: permission → state → rule checks →
 * write → audit → notifications. Generic status buttons (Approve, Acknowledge Receipt) use the
 * lifecycle; their side effects live in the domain hooks (src/domain/extensions/spares.tsx).
 */
import type { RecordData } from '../../metadata/types';
import { L } from '../../constants/labels';
import { nowIso, nowMs } from '../../lib/clock';
import { todayKey } from '../../lib/dates';
import { uid } from '../../lib/ids';
import { type Actor, can, canReadRecord, canUpdateRecord } from '../authz';
import { commit, getDb } from '../db';
import { appendAudit, notify } from '../ledger';
import { employeesWithRole, userOfStaff } from '../lookups';
import { allResources, getResource } from '../registry';
import type { HookContext } from '../resourceHooks';
import { insertRecordIn, patchRecordIn } from '../runtime';
import { type Db, ServiceError } from '../types';

const OPEN = ['requested', 'approved', 'issued'];
const E = L.spares.errors;
const G = L.spares.log;

/** Ticket hand-offs only run once the service module's `tickets` resource is registered. */
export const ticketsAvailable = () => allResources().some((r) => r.key === 'tickets');

function load(d: Db, actor: Actor, id: string, version: number) {
  const res = getResource('requisitions');
  const r = d.records.requisitions?.find((x) => x.id === id);
  if (!r || !canReadRecord(actor, res, r)) throw new ServiceError('not_found', E.notFound(id));
  if (r.version !== version) throw new ServiceError('version_conflict', E.conflict(id));
  return r;
}

const ctxOf = (d: Db, actor: Actor): HookContext => ({ d, actor, correlationId: uid('cor') });
const part = (d: Db, id: unknown) => d.records.spareParts?.find((x) => x.id === id);
const fieldErr = (key: string, message: string) => new ServiceError('validation', message, { fieldErrors: { [key]: message } });

/** Users holding a role (for notifications), e.g. store in-charge and SCM. */
export function notifyRoles(d: Db, actor: Actor, roles: string[], title: string, link: { resource: string; recordId: string }) {
  const seen = new Set<string>();
  roles.forEach((role) =>
    employeesWithRole(role, undefined, d.records).forEach((e) => {
      const u = userOfStaff(e.id);
      if (!u || seen.has(u.id) || u.id === actor.user.id) return;
      seen.add(u.id);
      notify(d, { userId: u.id, workspaceId: actor.workspaceId, kind: 'exception', title, link });
    }),
  );
}

export function notifyStaff(d: Db, actor: Actor, staffId: unknown, title: string, link: { resource: string; recordId: string }, kind: 'assignment' | 'info' | 'exception' = 'info') {
  const u = userOfStaff(staffId);
  if (u && u.id !== actor.user.id) notify(d, { userId: u.id, workspaceId: actor.workspaceId, kind, title, link });
}

/** FR-097 / BR-38: alert store + SCM when a part is (still) below its minimum level. */
export function alertIfBelowMin(ctx: HookContext, p: RecordData) {
  if (Number(p.stockMain ?? 0) >= Number(p.minLevel ?? 0) || !Number(p.minLevel)) return;
  notifyRoles(ctx.d, ctx.actor, ['store', 'scm'], G.belowMin(p.partNo, p.description, p.stockMain, p.minLevel, !!p.critical), { resource: 'spareParts', recordId: p.id });
}

/** Moves the ticket back to "In progress" when none of its requisitions is still open. */
export function releaseTicketIfDone(ctx: HookContext, ticketId: unknown, exceptReqId?: string) {
  if (!ticketsAvailable()) return;
  const t = ctx.d.records.tickets?.find((x) => x.id === ticketId);
  if (!t || t.status !== 'waiting_parts') return;
  const stillOpen = (ctx.d.records.requisitions ?? []).some((r) => r.ticketId === ticketId && r.id !== exceptReqId && OPEN.includes(String(r.status)));
  if (!stillOpen) patchRecordIn(ctx, 'tickets', String(ticketId), { status: 'in_progress' }, G.ticketBack);
}

/** Closes a pending requisition approval when the decision is taken by a direct status action. */
export function closePendingApproval(ctx: HookContext, reqId: string, decision: 'approved' | 'rejected', note: string) {
  const a = ctx.d.approvals.find((x) => x.recordId === reqId && x.type === 'spares.requisition' && x.status === 'pending');
  if (!a) return;
  a.status = decision;
  a.decidedBy = ctx.actor.user.id;
  a.decidedAt = nowIso();
  a.decisionNote = note;
  a.decisions.push({ level: a.currentLevel, by: ctx.actor.user.id, at: a.decidedAt, decision, note });
  a.version++;
}

export function rejectRequisition(actor: Actor, id: string, reason: string, version: number) {
  if (!can(actor, 'approve.service')) throw new ServiceError('forbidden', E.rejectForbidden);
  if (reason.trim().length < 5) throw fieldErr('reason', E.reasonMin);
  return commit((d) => {
    const r = load(d, actor, id, version);
    if (r.status !== 'requested') throw new ServiceError('invalid_state', E.onlyRequestedReject);
    if (r.engineerId === actor.staffId) throw new ServiceError('forbidden', E.ownReject);
    const ctx = ctxOf(d, actor);
    const next = patchRecordIn(ctx, 'requisitions', id, { status: 'rejected', rejectReason: reason.trim() }, G.rejected(reason.trim()));
    closePendingApproval(ctx, id, 'rejected', reason.trim());
    releaseTicketIfDone(ctx, r.ticketId, id);
    notifyStaff(d, actor, r.engineerId, G.rejectedNotice(id, reason.trim()), { resource: 'requisitions', recordId: id }, 'exception');
    return next;
  });
}

/** SPR-03 issue by the store with courier details. BR-38: issued ≤ requested ≤ main-store stock. */
export function issueRequisition(actor: Actor, id: string, input: { issuedQty: number; courier: string; docketNo: string }, version: number) {
  if (!can(actor, 'spares.issue')) throw new ServiceError('forbidden', E.issueForbidden);
  const qty = Math.floor(Number(input.issuedQty));
  const missing: Record<string, string> = {};
  if (!input.courier.trim()) missing.courier = E.courierRequired;
  if (!input.docketNo.trim()) missing.docketNo = E.docketRequired;
  if (Object.keys(missing).length) throw new ServiceError('validation', Object.values(missing)[0], { fieldErrors: missing });
  return commit((d) => {
    const r = load(d, actor, id, version);
    if (!canUpdateRecord(actor, getResource('requisitions'), r)) throw new ServiceError('forbidden', E.updateForbidden);
    if (r.status !== 'approved') throw new ServiceError('invalid_state', E.onlyApprovedIssue);
    const p = part(d, r.partId);
    if (!p) throw new ServiceError('not_found', E.partGone);
    if (!(qty >= 1)) throw fieldErr('issuedQty', E.issueMin);
    if (qty > Number(r.qty)) throw fieldErr('issuedQty', E.issueMax(r.qty));
    if (qty > Number(p.stockMain ?? 0)) throw fieldErr('issuedQty', E.issueStock(p.stockMain ?? 0));
    const ctx = ctxOf(d, actor);
    const stock = Number(p.stockMain) - qty;
    const np = patchRecordIn(ctx, 'spareParts', String(p.id), { stockMain: stock }, G.issuedStock(qty, id, p.stockMain, stock));
    const next = patchRecordIn(ctx, 'requisitions', id, { status: 'issued', issuedQty: qty, courier: input.courier.trim(), docketNo: input.docketNo.trim(), issuedAt: nowIso() }, G.issuedVia(qty, input.courier.trim(), input.docketNo.trim()));
    notifyStaff(d, actor, r.engineerId, G.dispatchedNotice(p.partNo, qty, r.ticketId, input.courier.trim(), input.docketNo.trim()), { resource: 'requisitions', recordId: id }, 'assignment');
    alertIfBelowMin(ctx, np);
    return next;
  });
}

/** SPR-04 consumption against ticket + machine as warranty or chargeable; defective return when required. */
export function recordConsumption(actor: Actor, id: string, input: { consumedQty: number; basis: string; defectiveReturned: boolean }, version: number) {
  return commit((d) => {
    const r = load(d, actor, id, version);
    if (!canUpdateRecord(actor, getResource('requisitions'), r)) throw new ServiceError('forbidden', E.consumeForbidden);
    if (r.status !== 'received') throw new ServiceError('invalid_state', E.receiveFirst);
    const qty = Math.floor(Number(input.consumedQty));
    if (!(qty >= 1)) throw fieldErr('consumedQty', E.consumeMin);
    if (qty > Number(r.issuedQty ?? r.qty)) throw fieldErr('consumedQty', E.consumeMax(r.issuedQty ?? r.qty));
    if (!['warranty', 'chargeable'].includes(input.basis)) throw fieldErr('basis', E.chooseBasis);
    const p = part(d, r.partId);
    if (input.basis === 'warranty' && p && p.warrantyApplicable === false) throw fieldErr('basis', E.notWarranty(p.partNo));
    const ctx = ctxOf(d, actor);
    const unused = Number(r.issuedQty ?? r.qty) - qty;
    let stockNote = '';
    if (unused > 0 && p) {
      patchRecordIn(ctx, 'spareParts', String(p.id), { stockMain: Number(p.stockMain ?? 0) + unused }, G.unusedBack(unused, id));
      stockNote = G.unusedNote(unused);
    }
    const defective = p?.returnable ? (input.defectiveReturned ? 'received' : 'pending') : 'not_required';
    const next = patchRecordIn(
      ctx,
      'requisitions',
      id,
      { status: 'consumed', consumedQty: qty, basis: input.basis, consumedAt: nowIso(), defectiveReturn: defective, defectiveReceivedAt: defective === 'received' ? nowIso() : null },
      G.consumedAs(qty, L.spares.masters.partBasis.values[input.basis as 'warranty' | 'chargeable'], stockNote),
    );
    if (defective === 'pending') notifyRoles(d, actor, ['store'], G.defectivePending(p?.partNo, id), { resource: 'requisitions', recordId: id });
    return next;
  });
}

/** Unused part goes back to the store (status Returned, stock restored). */
export function returnRequisition(actor: Actor, id: string, reason: string, version: number) {
  if (reason.trim().length < 3) throw fieldErr('reason', E.returnReason);
  return commit((d) => {
    const r = load(d, actor, id, version);
    if (!canUpdateRecord(actor, getResource('requisitions'), r)) throw new ServiceError('forbidden', E.returnForbidden);
    if (r.status !== 'received') throw new ServiceError('invalid_state', E.onlyReceivedReturn);
    const ctx = ctxOf(d, actor);
    const p = part(d, r.partId);
    const qty = Number(r.issuedQty ?? r.qty);
    if (p) patchRecordIn(ctx, 'spareParts', String(p.id), { stockMain: Number(p.stockMain ?? 0) + qty }, G.returnedStock(qty, id));
    const next = patchRecordIn(ctx, 'requisitions', id, { status: 'returned', returnReason: reason.trim(), returnedAt: nowIso() }, G.returnedUnused(reason.trim()));
    releaseTicketIfDone(ctx, r.ticketId, id);
    return next;
  });
}

/** Store confirms the failed part arrived (enables a Warranty Claim (OEM)). */
export function receiveDefective(actor: Actor, id: string, version: number) {
  if (!can(actor, 'spares.issue')) throw new ServiceError('forbidden', E.defectiveForbidden);
  return commit((d) => {
    const r = load(d, actor, id, version);
    if (r.defectiveReturn !== 'pending') throw new ServiceError('invalid_state', E.noDefective);
    return patchRecordIn(ctxOf(d, actor), 'requisitions', id, { defectiveReturn: 'received', defectiveReceivedAt: nowIso() }, G.defectiveReceived);
  });
}

/** SPR-05: OEM claim prefilled from a consumed warranty requisition. */
export function raiseClaimFromRequisition(actor: Actor, id: string, oem: string) {
  const res = getResource('warrantyClaims');
  if (!actor.role.resources.warrantyClaims?.create) throw new ServiceError('forbidden', E.claimForbidden);
  if (!oem) throw fieldErr('oem', E.chooseOem);
  return commit((d) => {
    const r = d.records.requisitions?.find((x) => x.id === id);
    if (!r || !canReadRecord(actor, getResource('requisitions'), r)) throw new ServiceError('not_found', E.reqNotFound(id));
    if (r.status !== 'consumed' || r.basis !== 'warranty') throw new ServiceError('invalid_state', E.claimOnlyWarranty);
    if ((d.records.warrantyClaims ?? []).some((c) => c.requisitionId === id && c.status !== 'rejected')) throw new ServiceError('conflict', E.claimExists(id));
    const p = part(d, r.partId);
    const ctx = ctxOf(d, actor);
    const claim = insertRecordIn(ctx, res.key, { partId: r.partId, requisitionId: id, oem, raisedOn: todayKey(), qty: Number(r.consumedQty ?? r.qty), amount: Number(p?.price ?? 0) * Number(r.consumedQty ?? r.qty), notes: String(r.reason ?? '') });
    return claim;
  });
}

/** SPR-01/02 simulated ERP sync: refreshes main-store stock (small random receipts) and stamps the time. */
export function syncStockFromErp(actor: Actor): { updated: number; belowMin: number } {
  if (!can(actor, 'spares.erpSync')) throw new ServiceError('forbidden', E.syncForbidden);
  return commit((d) => {
    const ctx = ctxOf(d, actor);
    let updated = 0;
    const at = nowIso();
    const parts = d.records.spareParts ?? [];
    parts.forEach((p, i) => {
      // Deterministic per day: some below-minimum parts receive an import consignment.
      const seed = (i * 7919 + Math.floor(nowMs() / 86_400_000)) % 5;
      const receipt = Number(p.stockMain ?? 0) < Number(p.minLevel ?? 0) && seed === 0 ? Number(p.minLevel) * 2 : 0;
      if (receipt) updated++;
      patchRecordIn(ctx, 'spareParts', p.id, { stockMain: Number(p.stockMain ?? 0) + receipt, erpSyncedAt: at }, receipt ? G.erpReceipt(receipt) : G.erpSync);
    });
    appendAudit(d, actor, { action: 'erp.sync', resource: 'spareParts', summary: G.erpAudit(updated), correlationId: ctx.correlationId });
    return { updated, belowMin: parts.filter((p) => Number(p.stockMain ?? 0) < Number(p.minLevel ?? 0)).length };
  });
}

/** FR-097: notify store + SCM about every active part below its minimum level. */
export function sweepMinLevels(actor: Actor): number {
  if (!can(actor, 'spares.stock')) throw new ServiceError('forbidden', E.alertForbidden);
  return commit((d) => {
    const ctx = ctxOf(d, actor);
    const below = (d.records.spareParts ?? []).filter((p) => p.status !== 'inactive' && Number(p.stockMain ?? 0) < Number(p.minLevel ?? 0));
    below.forEach((p) => alertIfBelowMin(ctx, p));
    appendAudit(d, actor, { action: 'spares.min_alert', resource: 'spareParts', summary: G.minAudit(below.length), correlationId: ctx.correlationId });
    return below.length;
  });
}

/** Minimum-Level Alerts page (SPR-06): below-minimum parts (critical first) with the import suggestion. */
export function minimumLevelAlerts(actor: Actor) {
  if (!can(actor, 'spares.stock')) throw new ServiceError('forbidden', E.stockForbidden);
  const parts = (getDb().records.spareParts ?? []).filter((p) => p.status !== 'inactive');
  const below = parts
    .filter((p) => Number(p.stockMain ?? 0) < Number(p.minLevel ?? 0))
    .map((p) => ({
      id: p.id,
      partNo: String(p.partNo ?? ''),
      description: String(p.description ?? ''),
      category: String(p.category ?? ''),
      critical: !!p.critical,
      stockMain: Number(p.stockMain ?? 0),
      minLevel: Number(p.minLevel ?? 0),
      shortBy: Number(p.minLevel) - Number(p.stockMain ?? 0),
      suggested: Math.max(0, Number(p.minLevel) * 2 - Number(p.stockMain ?? 0)),
    }))
    .sort((a, b) => Number(b.critical) - Number(a.critical) || b.shortBy - a.shortBy);
  const openDemand = (getDb().records.requisitions ?? []).filter((r) => r.status === 'requested' || r.status === 'approved');
  const demandByPart = new Map<string, number>();
  openDemand.forEach((r) => demandByPart.set(String(r.partId), (demandByPart.get(String(r.partId)) ?? 0) + Number(r.qty)));
  const lastSync = parts.map((p) => String(p.erpSyncedAt ?? '')).sort().pop() || null;
  return { below: below.map((p) => ({ ...p, openDemand: demandByPart.get(p.id) ?? 0 })), totalParts: parts.length, lastSync };
}

/** Requisitions raised for one ticket (ticket "Parts" tab). */
export function requisitionsForTicket(actor: Actor, ticketId: string) {
  const res = getResource('requisitions');
  return (getDb().records.requisitions ?? []).filter((r) => r.ticketId === ticketId && canReadRecord(actor, res, r)).sort((a, b) => b.id.localeCompare(a.id));
}
