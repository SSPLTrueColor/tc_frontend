/**
 * Spare Parts (4.9) and Consumables (4.10) behaviour (SPR-03…06, CON-02/05/06, BR-38/41): Spares
 * Requisition defaults, service ticket waiting-for-parts hand-off, approval type, minimum-level
 * alerts, rate-contract overlap rule, sample trial guards and dealer order rules.
 * Registered once from src/domain/extensions/index.ts.
 */
import { L } from '../../constants/labels';
import { nowIso } from '../../lib/clock';
import { todayKey } from '../../lib/dates';
import { coverageFor } from '../../services/lookups';
import { registerResourceHooks } from '../../services/resourceHooks';
import { patchRecordIn } from '../../services/runtime';
import { findOverlap, prepareDealerOrder } from '../../services/spares/consumables';
import { alertIfBelowMin, closePendingApproval, notifyRoles, notifyStaff, releaseTicketIfDone, ticketsAvailable } from '../../services/spares/requisitions';
import { ServiceError } from '../../services/types';
import { registerApprovalType, requestApprovalIn } from '../../services/workflow';
import { registerRecordActions, registerRecordBanner, registerRecordTab } from '../../components/resource/extensions';
import { RequisitionActions } from '../../modules/spares/components/RequisitionActions';
import { CustomerConsumablesTab, RateContractBanner, RequisitionBanner, SparePartBanner, TicketPartsTab } from '../../modules/spares/components/RecordExtras';

const invalid = (field: string, message: string) => new ServiceError('validation', message, { fieldErrors: { [field]: message } });
const TICKET_WORKING = ['assigned', 'accepted', 'in_progress', 'reopened'];
const TICKET_CLOSED = ['resolved', 'customer_confirmation', 'closed'];
const SE = L.spares.errors;
const SG = L.spares.log;
const CE = L.consumables.errors;

// ---------------------------------------------------------------- Spares Requisitions

registerResourceHooks('requisitions', {
  beforeCreate: ({ d, actor }, c) => {
    if (!c.engineerId) c.engineerId = actor.staffId;
    const ticket = d.records.tickets?.find((t) => t.id === c.ticketId);
    if (ticket && TICKET_CLOSED.includes(String(ticket.status))) throw invalid('ticketId', SE.ticketClosed);
    const part = d.records.spareParts?.find((p) => p.id === c.partId);
    if (part && part.status === 'inactive') throw invalid('partId', SE.partDiscontinued);
    const engineer = d.records.employees?.find((e) => e.id === c.engineerId);
    c.machineId = ticket?.machineId ?? null;
    c.customerId = ticket?.customerId ?? null;
    c.divisionId = ticket?.divisionId ?? ((engineer?.divisionIds as string[] | undefined) ?? [])[0] ?? null;
    c.unitPrice = Number(part?.price ?? 0);
    c.stockWarning = !!part && Number(c.qty ?? 0) > Number(part.stockMain ?? 0);
    // Suggested basis: parts are covered under warranty and CMC, chargeable under AMC (labour only) or no contract.
    const cov = c.machineId ? coverageFor(String(c.machineId), todayKey(), d.records) : 'none';
    c.basis = part?.warrantyApplicable !== false && (cov === 'warranty' || cov === 'cmc') ? 'warranty' : 'chargeable';
    c.defectiveReturn = 'not_required';
  },
  afterCreate: (ctx, r) => {
    const { d, actor } = ctx;
    const ticket = d.records.tickets?.find((t) => t.id === r.ticketId);
    if (ticket && ticketsAvailable() && TICKET_WORKING.includes(String(ticket.status))) patchRecordIn(ctx, 'tickets', ticket.id, { status: 'waiting_parts' }, SG.waitingParts(r.id));
    const part = d.records.spareParts?.find((p) => p.id === r.partId);
    if (r.stockWarning && part) notifyRoles(d, actor, ['scm', 'store'], SG.importNeed(part.partNo, r.qty, r.ticketId, part.stockMain ?? 0), { resource: 'spareParts', recordId: part.id });
    requestApprovalIn(ctx, {
      type: 'spares.requisition',
      resource: 'requisitions',
      recordId: r.id,
      reason: String(r.reason ?? ''),
      summary: SG.approvalSummary(r.id, String(part?.partNo ?? L.spares.dialogs.part), r.qty, r.ticketId, r.urgency === 'urgent'),
      amount: Number(r.qty) * Number(r.unitPrice ?? 0),
      divisionIds: r.divisionId ? [String(r.divisionId)] : undefined,
      levels: [{ capability: 'approve.service', label: L.spares.approvals.serviceLeadership }],
    });
  },
  beforeUpdate: ({ d }, before, c) => {
    const locked = ['ticketId', 'partId', 'qty'].filter((k) => JSON.stringify(c[k] ?? null) !== JSON.stringify(before[k] ?? null));
    if (locked.length && before.status !== 'requested') throw new ServiceError('invalid_state', SE.lockedFields);
    if (locked.length) {
      const part = d.records.spareParts?.find((p) => p.id === c.partId);
      c.unitPrice = Number(part?.price ?? 0);
      c.stockWarning = !!part && Number(c.qty ?? 0) > Number(part.stockMain ?? 0);
    }
  },
  beforeTransition: (_ctx, c, to) => {
    if (to === 'received') c.receivedAt = nowIso();
  },
  afterTransition: (ctx, before, after) => {
    if (after.status === 'approved') {
      closePendingApproval(ctx, after.id, 'approved', SG.approvedFromRecord);
      notifyRoles(ctx.d, ctx.actor, ['store'], SG.issueFor(after.id, after.ticketId), { resource: 'requisitions', recordId: after.id });
      notifyStaff(ctx.d, ctx.actor, after.engineerId, SG.approvedNotice(after.id), { resource: 'requisitions', recordId: after.id });
    }
    if (after.status === 'received' && before.status === 'issued') releaseTicketIfDone(ctx, after.ticketId);
  },
});

registerApprovalType('spares.requisition', {
  label: L.spares.approvals.requisition,
  onApproved: (ctx, a) => {
    const r = ctx.d.records.requisitions?.find((x) => x.id === a.recordId);
    if (!r || r.status !== 'requested') return;
    patchRecordIn(ctx, 'requisitions', r.id, { status: 'approved' }, SG.approvedVia(a.id));
    notifyRoles(ctx.d, ctx.actor, ['store'], SG.issueFor(r.id, r.ticketId), { resource: 'requisitions', recordId: r.id });
  },
  onRejected: (ctx, a) => {
    const r = ctx.d.records.requisitions?.find((x) => x.id === a.recordId);
    if (!r || r.status !== 'requested') return;
    patchRecordIn(ctx, 'requisitions', r.id, { status: 'rejected', rejectReason: a.decisionNote ?? '' }, SG.rejectedVia(a.id));
    releaseTicketIfDone(ctx, r.ticketId, r.id);
  },
});

// ---------------------------------------------------------------- Spare Parts Master / Warranty Claims (OEM)

registerResourceHooks('spareParts', {
  beforeCreate: ({ d }, c) => {
    c.partNo = String(c.partNo ?? '').trim().toUpperCase();
    if ((d.records.spareParts ?? []).some((p) => p.partNo === c.partNo)) throw invalid('partNo', SE.duplicatePartNo);
  },
  beforeUpdate: ({ d }, before, c) => {
    if (c.partNo !== before.partNo && (d.records.spareParts ?? []).some((p) => p.id !== before.id && p.partNo === String(c.partNo).toUpperCase())) throw invalid('partNo', SE.duplicatePartNo);
  },
  afterUpdate: (ctx, before, after) => {
    if (before.minLevel !== after.minLevel) alertIfBelowMin(ctx, after);
  },
});

registerResourceHooks('warrantyClaims', {
  beforeCreate: ({ d }, c) => {
    if (c.requisitionId) {
      const r = d.records.requisitions?.find((x) => x.id === c.requisitionId);
      if (r && r.partId !== c.partId) throw invalid('partId', SE.claimPartMismatch);
    }
  },
  beforeTransition: (_ctx, c, to) => {
    if (to === 'accepted' && !String(c.claimNo ?? '').trim()) throw invalid('claimNo', SE.claimNoFirst);
    if (to === 'credited' && !String(c.creditNoteNo ?? '').trim()) throw invalid('creditNoteNo', SE.creditNoteFirst);
  },
});

// ---------------------------------------------------------------- Rate Contracts (BR-41)

function rcDefaults(d: Parameters<NonNullable<Parameters<typeof registerResourceHooks>[1]['beforeCreate']>>[0]['d'], c: Record<string, unknown>) {
  const product = d.records.products?.find((x) => x.id === c.productId);
  const customer = d.records.customers?.find((x) => x.id === c.customerId);
  c.divisionId = product?.divisionId ?? ((customer?.divisionIds as string[] | undefined) ?? [])[0] ?? c.divisionId ?? null;
}

registerResourceHooks('rateContracts', {
  beforeCreate: ({ d, actor }, c) => {
    if (!c.ownerId) c.ownerId = actor.staffId;
    rcDefaults(d, c);
    const clash = findOverlap(d, c);
    if (clash) throw invalid('validFrom', CE.overlap(clash.id, clash.validFrom, clash.validTo));
  },
  beforeUpdate: ({ d }, before, c) => {
    if (c.productId !== before.productId) rcDefaults(d, c);
    const clash = findOverlap(d, c, before.id);
    if (clash) throw invalid('validFrom', CE.overlap(clash.id, clash.validFrom, clash.validTo));
  },
});

// ---------------------------------------------------------------- Sample / Trial Dispatch (CON-05)

registerResourceHooks('sampleDispatches', {
  beforeCreate: ({ d, actor }, c) => {
    if (!c.ownerId) c.ownerId = actor.staffId;
    const product = d.records.products?.find((x) => x.id === c.productId);
    c.divisionId = product?.divisionId ?? null;
  },
  beforeTransition: (_ctx, c, to) => {
    if (to === 'dispatched' && !c.dispatchedOn) c.dispatchedOn = todayKey();
    if (to === 'trial' && !c.trialDate) c.trialDate = todayKey();
    if (to === 'results' && !c.trialResult) throw invalid('trialResult', CE.trialResultFirst);
  },
  afterTransition: (ctx, _before, after) => {
    if (after.status === 'results' && after.trialResult !== 'positive') notifyStaff(ctx.d, ctx.actor, after.ownerId, L.consumables.log.trialNotice(after.id, after.trialResult === 'negative'), { resource: 'sampleDispatches', recordId: after.id }, 'exception');
  },
});

// ---------------------------------------------------------------- Dealer / Distributor Orders (CON-06)

registerResourceHooks('dealerOrders', {
  beforeCreate: ({ d }, c) => prepareDealerOrder(d, c),
  beforeUpdate: ({ d }, before, c) => prepareDealerOrder(d, c, before.id),
});

// ---------------------------------------------------------------- record extensions

registerRecordActions('requisitions', RequisitionActions);
registerRecordBanner('requisitions', RequisitionBanner);
registerRecordBanner('rateContracts', RateContractBanner);
registerRecordBanner('spareParts', SparePartBanner);
// Service Ticket tab order (GLOSSARY §1.2): SLA 10, Site Visits 20, Remote Support 30, Parts Used 35, Chargeable Service 40, Feedback 50.
registerRecordTab('tickets', { id: 'spares-parts', label: L.spares.tabs.partsUsed, order: 35, component: TicketPartsTab });
registerRecordTab('customers', { id: 'spares-consumables', label: L.consumables.tabs.consumables, component: CustomerConsumablesTab });
