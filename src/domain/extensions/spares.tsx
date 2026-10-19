/**
 * Spares & consumables behaviour (SPR-03…06, CON-02/05, BR-38/41): requisition defaults, ticket
 * waiting-for-parts hand-off, approval type, stock alerts, rate-contract overlap rule and
 * sample trial guards. Registered once from src/domain/extensions/index.ts.
 */
import { nowIso } from '../../lib/clock';
import { todayKey } from '../../lib/dates';
import { coverageFor } from '../../services/lookups';
import { registerResourceHooks } from '../../services/resourceHooks';
import { patchRecordIn } from '../../services/runtime';
import { findOverlap } from '../../services/spares/consumables';
import { alertIfBelowMin, closePendingApproval, notifyRoles, notifyStaff, releaseTicketIfDone, ticketsAvailable } from '../../services/spares/requisitions';
import { ServiceError } from '../../services/types';
import { registerApprovalType, requestApprovalIn } from '../../services/workflow';
import { registerRecordActions, registerRecordBanner, registerRecordTab } from '../../components/resource/extensions';
import { RequisitionActions } from '../../modules/spares/components/RequisitionActions';
import { CustomerConsumablesTab, RateContractBanner, RequisitionBanner, SparePartBanner, TicketPartsTab } from '../../modules/spares/components/RecordExtras';

const invalid = (field: string, message: string) => new ServiceError('validation', message, { fieldErrors: { [field]: message } });
const TICKET_WORKING = ['assigned', 'accepted', 'in_progress', 'reopened'];
const TICKET_CLOSED = ['resolved', 'customer_confirmation', 'closed'];

// ---------------------------------------------------------------- requisitions

registerResourceHooks('requisitions', {
  beforeCreate: ({ d, actor }, c) => {
    if (!c.engineerId) c.engineerId = actor.staffId;
    const ticket = d.records.tickets?.find((t) => t.id === c.ticketId);
    if (ticket && TICKET_CLOSED.includes(String(ticket.status))) throw invalid('ticketId', 'Parts can only be requested on an open ticket');
    const part = d.records.spareParts?.find((p) => p.id === c.partId);
    if (part && part.status === 'inactive') throw invalid('partId', 'This part is discontinued');
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
    if (ticket && ticketsAvailable() && TICKET_WORKING.includes(String(ticket.status))) patchRecordIn(ctx, 'tickets', ticket.id, { status: 'waiting_parts' }, `Waiting for parts (${r.id})`);
    const part = d.records.spareParts?.find((p) => p.id === r.partId);
    if (r.stockWarning && part) notifyRoles(d, actor, ['scm', 'store'], `Import requirement: ${part.partNo} short — ${r.qty} requested for ${r.ticketId}, ${part.stockMain ?? 0} in stock`, { resource: 'spareParts', recordId: part.id });
    requestApprovalIn(ctx, {
      type: 'spares.requisition',
      resource: 'requisitions',
      recordId: r.id,
      reason: String(r.reason ?? ''),
      summary: `${r.id}: ${part?.partNo ?? 'part'} ×${r.qty} for ${r.ticketId}${r.urgency === 'urgent' ? ' (urgent)' : ''}`,
      amount: Number(r.qty) * Number(r.unitPrice ?? 0),
      divisionIds: r.divisionId ? [String(r.divisionId)] : undefined,
      levels: [{ capability: 'approve.service', label: 'Service leadership' }],
    });
  },
  beforeUpdate: ({ d }, before, c) => {
    const locked = ['ticketId', 'partId', 'qty'].filter((k) => JSON.stringify(c[k] ?? null) !== JSON.stringify(before[k] ?? null));
    if (locked.length && before.status !== 'requested') throw new ServiceError('invalid_state', 'Ticket, part and quantity can only change while the requisition is still requested.');
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
      closePendingApproval(ctx, after.id, 'approved', 'Approved from the requisition');
      notifyRoles(ctx.d, ctx.actor, ['store'], `Issue part for ${after.id} (${after.ticketId})`, { resource: 'requisitions', recordId: after.id });
      notifyStaff(ctx.d, ctx.actor, after.engineerId, `Requisition ${after.id} approved — the store will dispatch it`, { resource: 'requisitions', recordId: after.id });
    }
    if (after.status === 'received' && before.status === 'issued') releaseTicketIfDone(ctx, after.ticketId);
  },
});

registerApprovalType('spares.requisition', {
  label: 'Part requisition',
  onApproved: (ctx, a) => {
    const r = ctx.d.records.requisitions?.find((x) => x.id === a.recordId);
    if (!r || r.status !== 'requested') return;
    patchRecordIn(ctx, 'requisitions', r.id, { status: 'approved' }, `Approved via ${a.id}`);
    notifyRoles(ctx.d, ctx.actor, ['store'], `Issue part for ${r.id} (${r.ticketId})`, { resource: 'requisitions', recordId: r.id });
  },
  onRejected: (ctx, a) => {
    const r = ctx.d.records.requisitions?.find((x) => x.id === a.recordId);
    if (!r || r.status !== 'requested') return;
    patchRecordIn(ctx, 'requisitions', r.id, { status: 'rejected', rejectReason: a.decisionNote ?? '' }, `Rejected via ${a.id}`);
    releaseTicketIfDone(ctx, r.ticketId, r.id);
  },
});

// ---------------------------------------------------------------- spare parts / claims

registerResourceHooks('spareParts', {
  beforeCreate: ({ d }, c) => {
    c.partNo = String(c.partNo ?? '').trim().toUpperCase();
    if ((d.records.spareParts ?? []).some((p) => p.partNo === c.partNo)) throw invalid('partNo', 'Another part already uses this part number');
  },
  beforeUpdate: ({ d }, before, c) => {
    if (c.partNo !== before.partNo && (d.records.spareParts ?? []).some((p) => p.id !== before.id && p.partNo === String(c.partNo).toUpperCase())) throw invalid('partNo', 'Another part already uses this part number');
  },
  afterUpdate: (ctx, before, after) => {
    if (before.minLevel !== after.minLevel) alertIfBelowMin(ctx, after);
  },
});

registerResourceHooks('warrantyClaims', {
  beforeCreate: ({ d }, c) => {
    if (c.requisitionId) {
      const r = d.records.requisitions?.find((x) => x.id === c.requisitionId);
      if (r && r.partId !== c.partId) throw invalid('partId', 'The part does not match the requisition');
    }
  },
  beforeTransition: (_ctx, c, to) => {
    if (to === 'accepted' && !String(c.claimNo ?? '').trim()) throw invalid('claimNo', 'Enter the OEM claim number first (Edit → OEM claim no.)');
    if (to === 'credited' && !String(c.creditNoteNo ?? '').trim()) throw invalid('creditNoteNo', 'Enter the credit note number first (Edit → Credit note no.)');
  },
});

// ---------------------------------------------------------------- rate contracts (BR-41)

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
    if (clash) throw invalid('validFrom', `Overlaps ${clash.id} (${clash.validFrom} → ${clash.validTo}) for the same customer and product`);
  },
  beforeUpdate: ({ d }, before, c) => {
    if (c.productId !== before.productId) rcDefaults(d, c);
    const clash = findOverlap(d, c, before.id);
    if (clash) throw invalid('validFrom', `Overlaps ${clash.id} (${clash.validFrom} → ${clash.validTo}) for the same customer and product`);
  },
});

// ---------------------------------------------------------------- samples & trials (CON-05)

registerResourceHooks('sampleDispatches', {
  beforeCreate: ({ d, actor }, c) => {
    if (!c.ownerId) c.ownerId = actor.staffId;
    const product = d.records.products?.find((x) => x.id === c.productId);
    c.divisionId = product?.divisionId ?? null;
  },
  beforeTransition: (_ctx, c, to) => {
    if (to === 'dispatched' && !c.dispatchedOn) c.dispatchedOn = todayKey();
    if (to === 'trial' && !c.trialDate) c.trialDate = todayKey();
    if (to === 'results' && !c.trialResult) throw invalid('trialResult', 'Record the trial result first (Edit → Trial result)');
  },
  afterTransition: (ctx, _before, after) => {
    if (after.status === 'results' && after.trialResult !== 'positive') notifyStaff(ctx.d, ctx.actor, after.ownerId, `Sample ${after.id}: trial ${after.trialResult === 'negative' ? 'negative' : 'needs adjustment'} — follow up with the customer`, { resource: 'sampleDispatches', recordId: after.id }, 'exception');
  },
});

// ---------------------------------------------------------------- record extensions

registerRecordActions('requisitions', RequisitionActions);
registerRecordBanner('requisitions', RequisitionBanner);
registerRecordBanner('rateContracts', RateContractBanner);
registerRecordBanner('spareParts', SparePartBanner);
registerRecordTab('tickets', { id: 'spares-parts', label: 'Parts', component: TicketPartsTab });
registerRecordTab('customers', { id: 'spares-consumables', label: 'Consumables', component: CustomerConsumablesTab });
