/**
 * Spare Parts (4.9) and Consumables (4.10) behaviour (SPR-03…06, CON-02/05/06, BR-38/41): Spares
 * Requisition defaults, service ticket waiting-for-parts hand-off, approval type, minimum-level
 * alerts, rate-contract overlap rule, sample trial guards and dealer order rules.
 * Registered once from src/domain/extensions/index.ts.
 */
import { L } from '../../constants/labels';
import { nowIso } from '../../lib/clock';
import { todayKey } from '../../lib/dates';
import { can, canReadRecord } from '../../services/authz';
import { coverageFor } from '../../services/lookups';
import { getResource, masterValue } from '../../services/registry';
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
const REQ_TERMINAL = ['rejected', 'consumed', 'returned'];
const SE = L.spares.errors;
const SG = L.spares.log;
const CE = L.consumables.errors;

// ---------------------------------------------------------------- Spares Requisitions

registerResourceHooks('requisitions', {
  beforeCreate: ({ d, actor }, c) => {
    // Own-scope roles (service engineers) raise requisitions for themselves only (REQUIREMENTS §2.2).
    const ownOnly = (actor.role.resources.requisitions?.read ?? 'none') === 'own';
    if (ownOnly && c.engineerId && c.engineerId !== actor.staffId) throw invalid('engineerId', SE.engineerSelfOnly);
    if (!c.engineerId) c.engineerId = actor.staffId;
    if (c.qty !== undefined && c.qty !== null && c.qty !== '' && !Number.isInteger(Number(c.qty))) throw invalid('qty', SE.wholeQty);
    const ticket = d.records.tickets?.find((t) => t.id === c.ticketId);
    if (ticket && ticketsAvailable() && !canReadRecord(actor, getResource('tickets'), ticket)) throw invalid('ticketId', SE.ticketNotVisible);
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
  beforeUpdate: ({ d, actor }, before, c) => {
    // Appendix A: Rejected, Consumed and Returned are terminal — the record is locked.
    if (REQ_TERMINAL.includes(String(before.status))) throw new ServiceError('invalid_state', SE.closedLocked(masterValue('requisitionStatus', before.status)?.label ?? String(before.status)));
    const changed = (k: string) => JSON.stringify(c[k] ?? null) !== JSON.stringify(before[k] ?? null);
    const locked = ['ticketId', 'partId', 'qty'].filter(changed);
    if (locked.length && before.status !== 'requested') throw new ServiceError('invalid_state', SE.lockedFields);
    if (changed('engineerId') && before.status !== 'requested') throw new ServiceError('invalid_state', SE.engineerLocked);
    // The store issues and receives; it does not rewrite what the engineer asked for.
    if ((locked.length || changed('engineerId')) && !actor.role.resources.requisitions?.create) throw new ServiceError('forbidden', SE.lockedEditForbidden);
    if (changed('qty') && !Number.isInteger(Number(c.qty))) throw invalid('qty', SE.wholeQty);
    if (locked.length) {
      const part = d.records.spareParts?.find((p) => p.id === c.partId);
      c.unitPrice = Number(part?.price ?? 0);
      c.stockWarning = !!part && Number(c.qty ?? 0) > Number(part.stockMain ?? 0);
    }
  },
  beforeTransition: ({ actor }, c, to) => {
    // Separation of duties, as for Reject and the approval inbox.
    if (to === 'approved' && c.engineerId === actor.staffId) throw new ServiceError('forbidden', SE.ownApprove);
    // SPR-03 receipt acknowledgement is the receiving engineer's (or someone raising on their behalf), not the store's.
    if (to === 'received' && c.engineerId !== actor.staffId && !actor.role.resources.requisitions?.create) throw new ServiceError('forbidden', SE.receiptForbidden);
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
    c.description = String(c.description ?? '').trim();
    if (!c.description) throw invalid('description', SE.descriptionRequired);
    if ((d.records.spareParts ?? []).some((p) => p.partNo === c.partNo)) throw invalid('partNo', SE.duplicatePartNo);
  },
  beforeUpdate: ({ d }, before, c) => {
    if (c.partNo !== before.partNo) c.partNo = String(c.partNo ?? '').trim().toUpperCase();
    if (c.partNo !== before.partNo && (d.records.spareParts ?? []).some((p) => p.id !== before.id && p.partNo === c.partNo)) throw invalid('partNo', SE.duplicatePartNo);
    if (c.description !== before.description) {
      c.description = String(c.description ?? '').trim();
      if (!c.description) throw invalid('description', SE.descriptionRequired);
    }
  },
  afterUpdate: (ctx, before, after) => {
    if (before.minLevel !== after.minLevel) alertIfBelowMin(ctx, after);
  },
});

registerResourceHooks('warrantyClaims', {
  beforeCreate: ({ d }, c) => {
    if (!Number.isInteger(Number(c.qty))) throw invalid('qty', SE.wholeQty);
    const part = d.records.spareParts?.find((p) => p.id === c.partId);
    if (part && part.warrantyApplicable === false) throw invalid('partId', SE.claimPartNotWarranty(part.partNo));
    if (c.requisitionId) {
      const r = d.records.requisitions?.find((x) => x.id === c.requisitionId);
      if (r && r.partId !== c.partId) throw invalid('partId', SE.claimPartMismatch);
      // SPR-05: a claim follows a warranty consumption, once per requisition, for at most the consumed quantity.
      if (r && (r.status !== 'consumed' || r.basis !== 'warranty')) throw invalid('requisitionId', SE.claimOnlyWarranty);
      if ((d.records.warrantyClaims ?? []).some((x) => x.requisitionId === c.requisitionId && x.status !== 'rejected')) throw invalid('requisitionId', SE.claimExists(String(c.requisitionId)));
      if (r && Number(c.qty) > Number(r.consumedQty ?? r.qty)) throw invalid('qty', SE.claimQtyMax(r.consumedQty ?? r.qty));
    }
  },
  beforeTransition: (_ctx, c, to) => {
    if (to === 'accepted' && !String(c.claimNo ?? '').trim()) throw invalid('claimNo', SE.claimNoFirst);
    if (to === 'credited' && !String(c.creditNoteNo ?? '').trim()) throw invalid('creditNoteNo', SE.creditNoteFirst);
  },
});

// ---------------------------------------------------------------- Rate Contracts (BR-41)

const RC_TYPES = ['ink', 'paper', 'fabric', 'spares'];
const SAMPLE_TYPES = ['ink', 'paper', 'fabric'];

/** Customer must be inside the actor's scope; product must be of the allowed types (relation `where` is only a picker filter). */
function checkCustomerProduct(d: Parameters<typeof rcDefaults>[0], actor: Parameters<typeof can>[0], c: Record<string, unknown>, types: string[], typeMessage: string, customerKey = 'customerId') {
  const customer = d.records.customers?.find((x) => x.id === c[customerKey]);
  if (customer && actor.role.resources.customers && !canReadRecord(actor, getResource('customers'), customer)) throw invalid(customerKey, CE.customerOutOfScope);
  const product = d.records.products?.find((x) => x.id === c.productId);
  if (product && !types.includes(String(product.productType))) throw invalid('productId', typeMessage);
}

function rcDefaults(d: Parameters<NonNullable<Parameters<typeof registerResourceHooks>[1]['beforeCreate']>>[0]['d'], c: Record<string, unknown>) {
  const product = d.records.products?.find((x) => x.id === c.productId);
  const customer = d.records.customers?.find((x) => x.id === c.customerId);
  c.divisionId = product?.divisionId ?? ((customer?.divisionIds as string[] | undefined) ?? [])[0] ?? c.divisionId ?? null;
}

registerResourceHooks('rateContracts', {
  beforeCreate: ({ d, actor }, c) => {
    if (!c.ownerId) c.ownerId = actor.staffId;
    checkCustomerProduct(d, actor, c, RC_TYPES, CE.rcProductType);
    if (!(Number(c.rate) > 0)) throw invalid('rate', CE.rateAboveZero);
    rcDefaults(d, c);
    const clash = findOverlap(d, c);
    if (clash) throw invalid('validFrom', CE.overlap(clash.id, clash.validFrom, clash.validTo));
  },
  beforeUpdate: ({ d, actor }, before, c) => {
    if (c.customerId !== before.customerId || c.productId !== before.productId) checkCustomerProduct(d, actor, c, RC_TYPES, CE.rcProductType);
    if (c.rate !== before.rate && !(Number(c.rate) > 0)) throw invalid('rate', CE.rateAboveZero);
    if (c.productId !== before.productId) rcDefaults(d, c);
    const clash = findOverlap(d, c, before.id);
    if (clash) throw invalid('validFrom', CE.overlap(clash.id, clash.validFrom, clash.validTo));
  },
});

// ---------------------------------------------------------------- Sample / Trial Dispatch (CON-05)

registerResourceHooks('sampleDispatches', {
  beforeCreate: ({ d, actor }, c) => {
    if (!c.ownerId) c.ownerId = actor.staffId;
    checkCustomerProduct(d, actor, c, SAMPLE_TYPES, CE.sampleProductType);
    const product = d.records.products?.find((x) => x.id === c.productId);
    c.divisionId = product?.divisionId ?? null;
  },
  beforeUpdate: ({ d, actor }, before, c) => {
    if (c.customerId !== before.customerId || c.productId !== before.productId) checkCustomerProduct(d, actor, c, SAMPLE_TYPES, CE.sampleProductType);
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
  beforeCreate: ({ d, actor }, c) => prepareDealerOrder(d, c, undefined, actor),
  beforeUpdate: ({ d, actor }, before, c) => prepareDealerOrder(d, c, before.id, actor),
});

// ---------------------------------------------------------------- record extensions

registerRecordActions('requisitions', RequisitionActions);
registerRecordBanner('requisitions', RequisitionBanner);
registerRecordBanner('rateContracts', RateContractBanner);
registerRecordBanner('spareParts', SparePartBanner);
// Service Ticket tab order (GLOSSARY §1.2): SLA 10, Site Visits 20, Remote Support 30, Parts Used 35, Chargeable Service 40, Feedback 50.
registerRecordTab('tickets', { id: 'spares-parts', label: L.spares.tabs.partsUsed, order: 35, component: TicketPartsTab });
registerRecordTab('customers', { id: 'spares-consumables', label: L.consumables.tabs.consumables, component: CustomerConsumablesTab });
