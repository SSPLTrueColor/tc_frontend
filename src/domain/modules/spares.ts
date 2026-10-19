/**
 * Spare Parts (BRD 4.9, FR-092 – FR-097) and Consumables (BRD 4.10, FR-098 – FR-103) module pack:
 * Spare Parts Master and main store stock, Spares Requisitions from service tickets, Warranty
 * Claims (OEM), customer Rate Contracts, Sample / Trial Dispatch and Dealer / Distributor Orders.
 * Stock, engineer stock, leakage, reorder and repeat-order lists are pages (src/modules/spares).
 * Every label comes from L.spares / L.consumables (docs/GLOSSARY.md).
 */
import type { MasterDefinition, MasterValue, ResourceDefinition, Tone } from '../../metadata/types';
import { L } from '../../constants/labels';
import { todayKey } from '../../lib/dates';
import { ALL, cols, cond, field, FORM_ONLY, group, views } from '../helpers';
import { type ModulePack, p } from './types';

const S = L.spares;
const C = L.consumables;

const mv = (key: string, label: string, tone: Tone = 'neutral'): Omit<MasterValue, 'order'> => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[]): MasterDefinition => ({ id: `mst_${key}`, key, label, version: 1, values: values.map((x, i) => ({ ...x, order: i })) });

const cat = S.masters.spareCategory.values;
const rq = S.masters.requisitionStatus.values;
const sd = C.masters.sampleDispatchStatus.values;

const masters: MasterDefinition[] = [
  master('spareCategory', S.masters.spareCategory.label, [
    mv('print_head', cat.print_head, 'accent'),
    mv('damper', cat.damper),
    mv('encoder', cat.encoder),
    mv('pump', cat.pump),
    mv('capping', cat.capping),
    mv('belt', cat.belt),
    mv('board', cat.board, 'info'),
    mv('heater', cat.heater),
    mv('wiper', cat.wiper),
    mv('other', cat.other),
  ]),
  master('partStatus', S.masters.partStatus.label, [mv('active', S.masters.partStatus.values.active, 'success'), mv('inactive', S.masters.partStatus.values.inactive)]),
  master('requisitionStatus', S.masters.requisitionStatus.label, [
    mv('requested', rq.requested, 'info'),
    mv('approved', rq.approved, 'accent'),
    mv('rejected', rq.rejected, 'danger'),
    mv('issued', rq.issued, 'warning'),
    mv('received', rq.received, 'info'),
    mv('consumed', rq.consumed, 'success'),
    mv('returned', rq.returned, 'neutral'),
  ]),
  master('partBasis', S.masters.partBasis.label, [mv('warranty', S.masters.partBasis.values.warranty, 'success'), mv('chargeable', S.masters.partBasis.values.chargeable, 'warning')]),
  master('defectiveReturn', S.masters.defectiveReturn.label, [
    mv('not_required', S.masters.defectiveReturn.values.not_required),
    mv('pending', S.masters.defectiveReturn.values.pending, 'warning'),
    mv('received', S.masters.defectiveReturn.values.received, 'success'),
  ]),
  master('requisitionUrgency', S.masters.requisitionUrgency.label, [mv('normal', S.masters.requisitionUrgency.values.normal), mv('urgent', S.masters.requisitionUrgency.values.urgent, 'danger')]),
  master('claimStatus', S.masters.claimStatus.label, [
    mv('raised', S.masters.claimStatus.values.raised, 'info'),
    mv('accepted', S.masters.claimStatus.values.accepted, 'success'),
    mv('rejected', S.masters.claimStatus.values.rejected, 'danger'),
    mv('credited', S.masters.claimStatus.values.credited, 'success'),
  ]),
  master('oem', S.masters.oem.label, [
    mv('epson', S.masters.oem.values.epson),
    mv('kyocera', S.masters.oem.values.kyocera),
    mv('ricoh', S.masters.oem.values.ricoh),
    mv('konica', S.masters.oem.values.konica),
    mv('principal', S.masters.oem.values.principal),
  ]),
  master('rcStatus', C.masters.rcStatus.label, [mv('active', C.masters.rcStatus.values.active, 'success'), mv('inactive', C.masters.rcStatus.values.inactive)]),
  master('rcValidity', C.masters.rcValidity.label, [mv('upcoming', C.masters.rcValidity.values.upcoming, 'info'), mv('valid', C.masters.rcValidity.values.valid, 'success'), mv('expired', C.masters.rcValidity.values.expired, 'neutral')]),
  master('sampleDispatchStatus', C.masters.sampleDispatchStatus.label, [
    mv('requested', sd.requested, 'info'),
    mv('dispatched', sd.dispatched, 'warning'),
    mv('trial', sd.trial, 'accent'),
    mv('results', sd.results, 'success'),
    mv('cancelled', sd.cancelled),
  ]),
  master('trialResult', C.masters.trialResult.label, [
    mv('positive', C.masters.trialResult.values.positive, 'success'),
    mv('adjust', C.masters.trialResult.values.adjust, 'warning'),
    mv('negative', C.masters.trialResult.values.negative, 'danger'),
  ]),
  master('dealerOrderStatus', C.masters.dealerOrderStatus.label, [
    mv('booked', C.masters.dealerOrderStatus.values.booked, 'info'),
    mv('delivered', C.masters.dealerOrderStatus.values.delivered, 'success'),
    mv('cancelled', C.masters.dealerOrderStatus.values.cancelled),
  ]),
];

// ---------------------------------------------------------------- Spare Parts Master (SPR-01/02)

const SP = S.fields.spareParts;
const fp = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('spareParts', key, label, type, extra);

export const spareParts: ResourceDefinition = {
  id: 'res_spareParts',
  key: 'spareParts',
  module: 'spares',
  label: S.records.spareParts.one,
  labelPlural: S.records.spareParts.many,
  icon: 'blocks',
  version: 1,
  idPrefix: 'SP',
  titleField: 'description',
  subtitleFields: ['partNo', 'category'],
  description: S.descriptions.spareParts,
  status: 'published',
  fields: [
    fp('partNo', SP.partNo, 'identifier', { required: true, maxLength: 30, capabilities: ALL, width: 150 }),
    fp('description', SP.description, 'text', { required: true, maxLength: 120, capabilities: ALL, width: 280, subFields: ['partNo'] }),
    fp('category', SP.category, 'master', { master: 'spareCategory', required: true, width: 150 }),
    fp('compatibleModels', SP.compatibleModels, 'text', { maxLength: 200, capabilities: ALL, width: 220 }),
    fp('hsn', SP.hsn, 'text', { required: true, format: 'hsn', width: 100 }),
    fp('price', SP.price, 'money', { required: true, min: 0, width: 120 }),
    fp('uom', SP.uom, 'text', { defaultValue: 'Nos', maxLength: 10, width: 80 }),
    fp('warrantyApplicable', SP.warrantyApplicable, 'boolean', { defaultValue: true, width: 110 }),
    fp('returnable', SP.returnable, 'boolean', { defaultValue: false, help: SP.returnableHelp }),
    fp('stockMain', SP.stockMain, 'number', { readOnly: true, defaultValue: 0, min: 0, width: 120, help: SP.stockMainHelp }),
    fp('minLevel', SP.minLevel, 'number', { min: 0, max: 10000, defaultValue: 0, width: 110 }),
    fp('critical', SP.critical, 'boolean', { defaultValue: false, width: 90 }),
    fp('belowMin', SP.belowMin, 'boolean', {
      readOnly: true,
      computed: (r) => Number(r.stockMain ?? 0) < Number(r.minLevel ?? 0),
      capabilities: { list: true, filter: true, sort: true, export: true },
      width: 110,
    }),
    fp('suggestedOrderQty', SP.suggestedOrderQty, 'number', {
      readOnly: true,
      computed: (r) => Math.max(0, Number(r.minLevel ?? 0) * 2 - Number(r.stockMain ?? 0)),
      capabilities: { list: true, sort: true, export: true },
      help: SP.suggestedOrderQtyHelp,
    }),
    fp('erpSyncedAt', SP.erpSyncedAt, 'datetime', { readOnly: true, capabilities: { list: true, sort: true } }),
    fp('status', SP.status, 'master', { master: 'partStatus', required: true, defaultValue: 'active', width: 110 }),
  ],
  relationships: [
    { id: 'rel_part_reqs', label: S.relationships.requisitions, resource: 'requisitions', foreignKey: 'partId' },
    { id: 'rel_part_claims', label: S.relationships.warrantyClaims, resource: 'warrantyClaims', foreignKey: 'partId' },
  ],
  form: {
    quickCreate: ['partNo', 'description', 'category', 'hsn', 'price', 'minLevel'],
    sections: [
      { id: 'part', title: S.sections.spareParts.part, fields: ['partNo', 'description', 'category', 'compatibleModels', 'hsn', 'price', 'uom', 'status'], columns: 2 },
      { id: 'stock', title: S.sections.spareParts.stock, fields: ['stockMain', 'minLevel', 'critical', 'warrantyApplicable', 'returnable'], columns: 2 },
    ],
  },
  views: views([
    { id: 'v_sp_all', resource: 'spareParts', name: S.views.spareParts.all, type: 'table', filter: group('and', [cond('status', 'eq', 'active')]), sort: [{ field: 'partNo', dir: 'asc' }], columns: cols('partNo', 'description', 'category', 'compatibleModels', 'stockMain', 'minLevel', 'belowMin', 'price', 'hsn') },
    {
      id: 'v_sp_below',
      resource: 'spareParts',
      name: S.views.spareParts.below,
      type: 'table',
      filter: group('and', [cond('belowMin', 'eq', true), cond('status', 'eq', 'active')]),
      sort: [{ field: 'critical', dir: 'desc' }],
      columns: cols('partNo', 'description', 'critical', 'stockMain', 'minLevel', 'suggestedOrderQty', 'compatibleModels'),
    },
    { id: 'v_sp_by_cat', resource: 'spareParts', name: S.views.spareParts.byCategory, type: 'table', filter: group('and'), sort: [{ field: 'partNo', dir: 'asc' }], groupBy: 'category', columns: cols('partNo', 'description', 'stockMain', 'minLevel', 'price') },
  ]),
};

// ---------------------------------------------------------------- Spares Requisitions (SPR-03/04)

const RQ = S.fields.requisitions;
const fr = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('requisitions', key, label, type, extra);

export const requisitions: ResourceDefinition = {
  id: 'res_requisitions',
  key: 'requisitions',
  module: 'spares',
  label: S.records.requisitions.one,
  labelPlural: S.records.requisitions.many,
  icon: 'receipt',
  version: 1,
  idPrefix: 'REQ',
  idFormat: 'fy',
  titleField: 'id',
  subtitleFields: ['partId', 'status'],
  ownerField: 'engineerId',
  divisionField: 'divisionId',
  description: S.descriptions.requisitions,
  status: 'published',
  fields: [
    fr('ticketId', RQ.ticketId, 'relation', { required: true, relation: { resource: 'tickets' }, capabilities: ALL, width: 160 }),
    fr('partId', RQ.partId, 'relation', { required: true, relation: { resource: 'spareParts', where: { field: 'status', op: 'eq', value: 'active' } }, capabilities: ALL, width: 240 }),
    fr('qty', RQ.qty, 'number', { required: true, min: 1, max: 50, defaultValue: 1, width: 90 }),
    fr('urgency', RQ.urgency, 'master', { master: 'requisitionUrgency', required: true, defaultValue: 'normal', width: 140 }),
    fr('engineerId', RQ.engineerId, 'relation', { relation: { resource: 'employees', where: { field: 'roleId', op: 'in', value: ['engineer', 'service_head', 'coordinator'] } }, width: 170, display: 'person', personSubtitle: 'designation', help: RQ.engineerIdHelp }),
    fr('reason', RQ.reason, 'longtext', { maxLength: 500, capabilities: { ...FORM_ONLY, search: true } }),
    fr('status', RQ.status, 'master', { master: 'requisitionStatus', readOnly: true, width: 150 }),
    fr('machineId', RQ.machineId, 'relation', { relation: { resource: 'machines' }, readOnly: true, width: 150 }),
    fr('customerId', RQ.customerId, 'relation', { relation: { resource: 'customers' }, readOnly: true, width: 200 }),
    fr('divisionId', RQ.divisionId, 'master', { master: 'division', readOnly: true, width: 110 }),
    fr('unitPrice', RQ.unitPrice, 'money', { readOnly: true }),
    fr('value', RQ.value, 'money', { readOnly: true, computed: (r) => Number(r.qty ?? 0) * Number(r.unitPrice ?? 0), capabilities: { list: true, sort: true, export: true }, width: 110 }),
    fr('stockWarning', RQ.stockWarning, 'boolean', { readOnly: true, help: RQ.stockWarningHelp, width: 110 }),
    fr('basis', RQ.basis, 'master', { master: 'partBasis', readOnly: true, width: 150, help: RQ.basisHelp }),
    fr('issuedQty', RQ.issuedQty, 'number', { readOnly: true }),
    fr('courier', RQ.courier, 'text', { readOnly: true }),
    fr('docketNo', RQ.docketNo, 'text', { readOnly: true }),
    fr('issuedAt', RQ.issuedAt, 'datetime', { readOnly: true }),
    fr('receivedAt', RQ.receivedAt, 'datetime', { readOnly: true }),
    fr('consumedQty', RQ.consumedQty, 'number', { readOnly: true }),
    fr('consumedAt', RQ.consumedAt, 'datetime', { readOnly: true }),
    fr('defectiveReturn', RQ.defectiveReturn, 'master', { master: 'defectiveReturn', readOnly: true, width: 150 }),
    fr('defectiveReceivedAt', RQ.defectiveReceivedAt, 'datetime', { readOnly: true }),
    fr('returnReason', RQ.returnReason, 'text', { readOnly: true }),
    fr('returnedAt', RQ.returnedAt, 'datetime', { readOnly: true }),
    fr('rejectReason', RQ.rejectReason, 'text', { readOnly: true }),
  ],
  relationships: [{ id: 'rel_req_claims', label: S.relationships.warrantyClaims, resource: 'warrantyClaims', foreignKey: 'requisitionId' }],
  lifecycle: {
    field: 'status',
    initial: 'requested',
    terminal: ['rejected', 'consumed', 'returned'],
    // Actions that capture data (reject, issue, consume, return) are record actions with dialogs.
    transitions: [
      { from: ['requested'], to: 'approved', action: S.actions.approve, capability: 'approve.service' },
      { from: ['issued'], to: 'received', action: S.actions.acknowledgeReceipt },
    ],
  },
  form: {
    quickCreate: ['ticketId', 'partId', 'qty', 'urgency', 'reason'],
    sections: [{ id: 'req', title: S.sections.requisitions.req, fields: ['ticketId', 'partId', 'qty', 'urgency', 'engineerId', 'reason'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_req_open',
      resource: 'requisitions',
      name: S.views.requisitions.open,
      type: 'table',
      filter: group('and', [cond('status', 'in', ['requested', 'approved', 'issued', 'received'])]),
      sort: [{ field: 'urgency', dir: 'desc' }],
      columns: cols('id', 'ticketId', 'partId', 'qty', 'urgency', 'engineerId', 'status', 'stockWarning', 'value'),
    },
    { id: 'v_req_board', resource: 'requisitions', name: S.views.requisitions.board, type: 'board', boardField: 'status', filter: group('and', [cond('status', 'in', ['requested', 'approved', 'issued', 'received'])]), sort: [{ field: 'urgency', dir: 'desc' }], columns: cols('partId', 'ticketId', 'engineerId', 'qty') },
    {
      id: 'v_req_returns',
      resource: 'requisitions',
      name: S.views.requisitions.returns,
      type: 'table',
      filter: group('and', [cond('defectiveReturn', 'eq', 'pending')]),
      sort: [{ field: 'consumedAt', dir: 'asc' }],
      columns: cols('id', 'partId', 'ticketId', 'engineerId', 'consumedAt', 'defectiveReturn', 'basis'),
    },
    { id: 'v_req_all', resource: 'requisitions', name: S.views.requisitions.all, type: 'table', filter: group('and'), sort: [{ field: 'id', dir: 'desc' }], columns: cols('id', 'ticketId', 'partId', 'qty', 'engineerId', 'status', 'basis', 'value', 'customerId') },
  ]),
};

// ---------------------------------------------------------------- Warranty Claims (OEM) (SPR-05)

const WC = S.fields.warrantyClaims;
const fw = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('warrantyClaims', key, label, type, extra);

export const warrantyClaims: ResourceDefinition = {
  id: 'res_warrantyClaims',
  key: 'warrantyClaims',
  module: 'spares',
  label: S.records.warrantyClaims.one,
  labelPlural: S.records.warrantyClaims.many,
  icon: 'shield',
  version: 1,
  idPrefix: 'WC',
  titleField: 'id',
  subtitleFields: ['partId', 'status'],
  description: S.descriptions.warrantyClaims,
  status: 'published',
  fields: [
    fw('partId', WC.partId, 'relation', { required: true, relation: { resource: 'spareParts' }, capabilities: ALL, width: 240 }),
    fw('requisitionId', WC.requisitionId, 'relation', { relation: { resource: 'requisitions' }, width: 150 }),
    fw('oem', WC.oem, 'master', { master: 'oem', required: true, width: 170 }),
    fw('claimNo', WC.claimNo, 'identifier', { maxLength: 30, capabilities: ALL, help: WC.claimNoHelp, width: 140 }),
    fw('raisedOn', WC.raisedOn, 'date', { required: true, dateRule: 'past', width: 110 }),
    fw('qty', WC.qty, 'number', { required: true, min: 1, defaultValue: 1, width: 90 }),
    fw('amount', WC.amount, 'money', { min: 0, width: 120 }),
    fw('status', WC.status, 'master', { master: 'claimStatus', readOnly: true, width: 120 }),
    fw('creditNoteNo', WC.creditNoteNo, 'text', { maxLength: 30 }),
    fw('notes', WC.notes, 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'raised',
    terminal: ['rejected', 'credited'],
    transitions: [
      { from: ['raised'], to: 'accepted', action: S.actions.markAccepted },
      { from: ['raised'], to: 'rejected', action: S.actions.markRejected, confirm: S.confirms.claimRejected },
      { from: ['accepted'], to: 'credited', action: S.actions.markCredited },
    ],
  },
  form: {
    quickCreate: ['partId', 'oem', 'raisedOn', 'qty', 'amount'],
    sections: [{ id: 'claim', title: S.sections.warrantyClaims.claim, fields: ['partId', 'requisitionId', 'oem', 'claimNo', 'raisedOn', 'qty', 'amount', 'creditNoteNo', 'notes'], columns: 2 }],
  },
  views: views([
    { id: 'v_wc_open', resource: 'warrantyClaims', name: S.views.warrantyClaims.open, type: 'table', filter: group('and', [cond('status', 'in', ['raised', 'accepted'])]), sort: [{ field: 'raisedOn', dir: 'asc' }], columns: cols('id', 'partId', 'oem', 'claimNo', 'raisedOn', 'qty', 'amount', 'status') },
    { id: 'v_wc_all', resource: 'warrantyClaims', name: S.views.warrantyClaims.all, type: 'table', filter: group('and'), sort: [{ field: 'raisedOn', dir: 'desc' }], columns: cols('id', 'partId', 'oem', 'claimNo', 'raisedOn', 'amount', 'status', 'creditNoteNo') },
  ]),
};

// ---------------------------------------------------------------- Rate Contracts (CON-02, BR-41)

const RC = C.fields.rateContracts;
const fc = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('rateContracts', key, label, type, extra);

export const rateContracts: ResourceDefinition = {
  id: 'res_rateContracts',
  key: 'rateContracts',
  module: 'spares',
  label: C.records.rateContracts.one,
  labelPlural: C.records.rateContracts.many,
  icon: 'scroll-text',
  version: 1,
  idPrefix: 'RC',
  titleField: 'id',
  subtitleFields: ['customerId', 'validity'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: C.descriptions.rateContracts,
  status: 'published',
  fields: [
    fc('customerId', RC.customerId, 'relation', { required: true, relation: { resource: 'customers' }, capabilities: ALL, width: 220 }),
    fc('productId', RC.productId, 'relation', { required: true, relation: { resource: 'products', where: { field: 'productType', op: 'in', value: ['ink', 'paper', 'fabric', 'spares'] } }, capabilities: ALL, width: 220 }),
    fc('rate', RC.rate, 'money', { required: true, min: 0, width: 120 }),
    fc('validFrom', RC.validFrom, 'date', { required: true, width: 110 }),
    fc('validTo', RC.validTo, 'date', { required: true, compare: { op: 'gte', field: 'validFrom', message: RC.validToCompare }, width: 110 }),
    fc('validity', RC.validity, 'master', { master: 'rcValidity', readOnly: true, computed: (r) => rcValidity(r), capabilities: { list: true, filter: true, export: true }, width: 110 }),
    fc('minQty', RC.minQty, 'number', { min: 0 }),
    fc('divisionId', RC.divisionId, 'master', { master: 'division', readOnly: true, width: 110 }),
    fc('ownerId', RC.ownerId, 'relation', { relation: { resource: 'employees' }, width: 170, display: 'person', personSubtitle: 'designation', help: RC.ownerIdHelp }),
    fc('status', RC.status, 'master', { master: 'rcStatus', required: true, defaultValue: 'active', width: 100 }),
    fc('notes', RC.notes, 'longtext', { maxLength: 500, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  form: {
    quickCreate: ['customerId', 'productId', 'rate', 'validFrom', 'validTo'],
    sections: [{ id: 'rc', title: C.sections.rateContracts.rc, fields: ['customerId', 'productId', 'rate', 'minQty', 'validFrom', 'validTo', 'ownerId', 'status', 'notes'], columns: 2 }],
  },
  views: views([
    { id: 'v_rc_valid', resource: 'rateContracts', name: C.views.rateContracts.valid, type: 'table', filter: group('and', [cond('validity', 'eq', 'valid'), cond('status', 'eq', 'active')]), sort: [{ field: 'validTo', dir: 'asc' }], columns: cols('id', 'customerId', 'productId', 'rate', 'minQty', 'validFrom', 'validTo', 'ownerId') },
    { id: 'v_rc_all', resource: 'rateContracts', name: C.views.rateContracts.all, type: 'table', filter: group('and'), sort: [{ field: 'validTo', dir: 'desc' }], columns: cols('id', 'customerId', 'productId', 'rate', 'validFrom', 'validTo', 'validity', 'status') },
  ]),
};

// ---------------------------------------------------------------- Sample / Trial Dispatch (CON-05)

const SDF = C.fields.sampleDispatches;
const fs = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('sampleDispatches', key, label, type, extra);

export const sampleDispatches: ResourceDefinition = {
  id: 'res_sampleDispatches',
  key: 'sampleDispatches',
  module: 'spares',
  label: C.records.sampleDispatches.one,
  labelPlural: C.records.sampleDispatches.many,
  icon: 'send',
  version: 1,
  idPrefix: 'SD',
  titleField: 'id',
  subtitleFields: ['customerId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: C.descriptions.sampleDispatches,
  status: 'published',
  fields: [
    fs('customerId', SDF.customerId, 'relation', { required: true, relation: { resource: 'customers' }, capabilities: ALL, width: 220 }),
    fs('productId', SDF.productId, 'relation', { required: true, relation: { resource: 'products', where: { field: 'productType', op: 'in', value: ['ink', 'paper', 'fabric'] } }, capabilities: ALL, width: 220 }),
    fs('qty', SDF.qty, 'number', { required: true, min: 1, max: 1000, defaultValue: 1, width: 90 }),
    fs('uom', SDF.uom, 'text', { defaultValue: 'L', maxLength: 10, width: 70, help: SDF.uomHelp }),
    fs('opportunityId', SDF.opportunityId, 'relation', { relation: { resource: 'opportunities' }, width: 180 }),
    fs('status', SDF.status, 'master', { master: 'sampleDispatchStatus', readOnly: true, width: 140 }),
    fs('dispatchedOn', SDF.dispatchedOn, 'date', { dateRule: 'past', width: 110 }),
    fs('courier', SDF.courier, 'text', { maxLength: 60 }),
    fs('trialDate', SDF.trialDate, 'date', { compare: { op: 'gte', field: 'dispatchedOn', message: C.errors.trialBeforeDispatch }, width: 110 }),
    fs('trialResult', SDF.trialResult, 'master', { master: 'trialResult', width: 180 }),
    fs('feedback', SDF.feedback, 'longtext', { maxLength: 1000, capabilities: { ...FORM_ONLY, search: true } }),
    fs('followUpOn', SDF.followUpOn, 'date', { dateRule: 'future' }),
    fs('divisionId', SDF.divisionId, 'master', { master: 'division', readOnly: true, width: 110 }),
    fs('ownerId', SDF.ownerId, 'relation', { relation: { resource: 'employees' }, width: 170, display: 'person', personSubtitle: 'designation', help: SDF.ownerIdHelp }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'requested',
    terminal: ['results', 'cancelled'],
    transitions: [
      { from: ['requested'], to: 'dispatched', action: C.actions.markDispatched },
      { from: ['dispatched'], to: 'trial', action: C.actions.startTrial },
      { from: ['dispatched', 'trial'], to: 'results', action: C.actions.recordResults },
      { from: ['requested', 'dispatched'], to: 'cancelled', action: C.actions.cancelSample, confirm: C.confirms.cancelSample },
    ],
  },
  form: {
    quickCreate: ['customerId', 'productId', 'qty', 'uom', 'opportunityId'],
    sections: [
      { id: 'sample', title: C.sections.sampleDispatches.sample, fields: ['customerId', 'productId', 'qty', 'uom', 'opportunityId', 'ownerId'], columns: 2 },
      { id: 'trial', title: C.sections.sampleDispatches.trial, fields: ['dispatchedOn', 'courier', 'trialDate', 'trialResult', 'followUpOn', 'feedback'], columns: 2 },
    ],
  },
  views: views([
    { id: 'v_sd_open', resource: 'sampleDispatches', name: C.views.sampleDispatches.open, type: 'table', filter: group('and', [cond('status', 'in', ['requested', 'dispatched', 'trial'])]), sort: [{ field: 'dispatchedOn', dir: 'asc' }], columns: cols('id', 'customerId', 'productId', 'qty', 'status', 'dispatchedOn', 'trialDate', 'ownerId') },
    { id: 'v_sd_board', resource: 'sampleDispatches', name: C.views.sampleDispatches.board, type: 'board', boardField: 'status', filter: group('and'), sort: [{ field: 'dispatchedOn', dir: 'desc' }], columns: cols('customerId', 'productId', 'ownerId') },
    { id: 'v_sd_results', resource: 'sampleDispatches', name: C.views.sampleDispatches.results, type: 'table', filter: group('and', [cond('status', 'eq', 'results')]), sort: [{ field: 'trialDate', dir: 'desc' }], groupBy: 'trialResult', columns: cols('id', 'customerId', 'productId', 'trialDate', 'trialResult', 'ownerId') },
  ]),
};

// ---------------------------------------------------------------- Dealer / Distributor Orders (CON-06, simulated)

const DO = C.fields.dealerOrders;
const fd = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('dealerOrders', key, label, type, extra);

/** Customer categories that act as dealers / distributors (CUS-04). */
export const DEALER_CATEGORIES = ['dealer', 'distributor'];
/** Product types a dealer sells on (consumables and spares). */
export const DEALER_PRODUCT_TYPES = ['ink', 'paper', 'fabric', 'spares'];

export const dealerOrders: ResourceDefinition = {
  id: 'res_dealerOrders',
  key: 'dealerOrders',
  module: 'spares',
  label: C.records.dealerOrders.one,
  labelPlural: C.records.dealerOrders.many,
  icon: 'building',
  version: 1,
  idPrefix: 'DO',
  titleField: 'id',
  subtitleFields: ['dealerId', 'endCustomer'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: C.descriptions.dealerOrders,
  status: 'published',
  fields: [
    fd('dealerId', DO.dealerId, 'relation', { required: true, relation: { resource: 'customers', where: { field: 'category', op: 'in', value: DEALER_CATEGORIES } }, capabilities: ALL, width: 220, help: DO.dealerIdHelp }),
    fd('endCustomer', DO.endCustomer, 'text', { required: true, maxLength: 120, capabilities: ALL, width: 220 }),
    fd('endCustomerCity', DO.endCustomerCity, 'text', { maxLength: 60, capabilities: ALL, width: 140 }),
    fd('productId', DO.productId, 'relation', { required: true, relation: { resource: 'products', where: { field: 'productType', op: 'in', value: DEALER_PRODUCT_TYPES } }, capabilities: ALL, width: 220 }),
    fd('qty', DO.qty, 'number', { required: true, min: 1, max: 100000, defaultValue: 1, width: 90 }),
    fd('uom', DO.uom, 'text', { defaultValue: 'L', maxLength: 10, width: 70 }),
    fd('rate', DO.rate, 'money', { required: true, min: 1, width: 120 }),
    fd('value', DO.value, 'money', { readOnly: true, computed: (r) => Number(r.qty ?? 0) * Number(r.rate ?? 0), capabilities: { list: true, sort: true, export: true }, width: 130 }),
    fd('orderDate', DO.orderDate, 'date', { required: true, dateRule: 'past', width: 110 }),
    fd('invoiceNo', DO.invoiceNo, 'text', { maxLength: 30, capabilities: ALL, width: 140 }),
    fd('status', DO.status, 'master', { master: 'dealerOrderStatus', required: true, defaultValue: 'booked', width: 110 }),
    fd('divisionId', DO.divisionId, 'master', { master: 'division', readOnly: true, width: 110 }),
    fd('ownerId', DO.ownerId, 'relation', { relation: { resource: 'employees' }, readOnly: true, width: 170, display: 'person', personSubtitle: 'designation' }),
    fd('notes', DO.notes, 'longtext', { maxLength: 500, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  form: {
    quickCreate: ['dealerId', 'endCustomer', 'productId', 'qty', 'rate', 'orderDate'],
    sections: [{ id: 'order', title: C.sections.dealerOrders.order, fields: ['dealerId', 'endCustomer', 'endCustomerCity', 'productId', 'qty', 'uom', 'rate', 'orderDate', 'invoiceNo', 'status', 'notes'], columns: 2 }],
  },
  views: views([
    { id: 'v_do_all', resource: 'dealerOrders', name: C.views.dealerOrders.all, type: 'table', filter: group('and'), sort: [{ field: 'orderDate', dir: 'desc' }], columns: cols('id', 'orderDate', 'dealerId', 'endCustomer', 'productId', 'qty', 'value', 'status') },
  ]),
};

/** Validity of a rate contract on today's (simulated) date. */
function rcValidity(r: Record<string, unknown>) {
  const t = todayKey();
  if (!r.validFrom || !r.validTo) return null;
  return String(r.validFrom) > t ? 'upcoming' : String(r.validTo) < t ? 'expired' : 'valid';
}

// ---------------------------------------------------------------- permissions (REQUIREMENTS §2.2)

const none = p('none');
const consumablesAll = { rateContracts: p('all', 'all', true, true, true), sampleDispatches: p('all', 'all', true, true, true), dealerOrders: p('all', 'all', true, true, true) };
const consumablesView = { rateContracts: p('all'), sampleDispatches: p('all'), dealerOrders: p('all') };

export const sparesPack: ModulePack = {
  id: 'spares',
  resources: [requisitions, spareParts, warrantyClaims, rateContracts, sampleDispatches, dealerOrders],
  masters,
  permissions: {
    admin: { spareParts: p('all', 'all', true, true, true), requisitions: p('all', 'all', true, true, true), warrantyClaims: p('all', 'all', true, true, true), ...consumablesAll },
    management: {
      spareParts: p('all', 'none', false, false, true),
      requisitions: p('all', 'none', false, false, true),
      warrantyClaims: p('all', 'none', false, false, true),
      rateContracts: p('all', 'none', false, false, true),
      sampleDispatches: p('all', 'none', false, false, true),
      dealerOrders: p('all', 'none', false, false, true),
    },
    division_head: { spareParts: none, requisitions: none, warrantyClaims: none, rateContracts: p('division', 'division', true, false, true), sampleDispatches: p('division', 'division', true, false, true), dealerOrders: p('division', 'division', true, true, true) },
    sales_manager: { rateContracts: p('team', 'team', true), sampleDispatches: p('team', 'team', true), dealerOrders: p('team', 'team', true, true) },
    sales_exec: { rateContracts: p('own', 'own', true), sampleDispatches: p('own', 'own', true), dealerOrders: p('own', 'own', true) },
    service_head: { spareParts: p('all', 'none', false, false, true), requisitions: p('all', 'all', true, false, true), warrantyClaims: p('all', 'all', true, false, true), ...consumablesView },
    engineer: { spareParts: p('all'), requisitions: p('own', 'own', true) },
    coordinator: { spareParts: p('all'), requisitions: p('division', 'none', true), rateContracts: p('division', 'division', true), sampleDispatches: p('division', 'division', true), dealerOrders: p('division', 'division', true) },
    scm: { spareParts: p('all', 'all', false, false, true), requisitions: p('all'), warrantyClaims: p('all', 'all', true, false, true) },
    store: { spareParts: p('all', 'all', false, false, true), requisitions: p('all', 'all', false, false, true), warrantyClaims: p('all', 'all', true) },
    accounts: { spareParts: p('all', 'none', false, false, true), requisitions: p('all', 'none', false, false, true), warrantyClaims: p('all'), ...consumablesView },
    profiling: { sampleDispatches: p('all', 'all') },
  },
  capabilities: {
    admin: ['spares.issue', 'spares.stock', 'spares.erpSync', 'spares.engineerStockAll', 'spares.engineerStock', 'consumables.view'],
    management: ['spares.stock', 'spares.engineerStockAll', 'spares.engineerStock', 'consumables.view'],
    division_head: ['consumables.view'],
    sales_manager: ['consumables.view'],
    sales_exec: ['consumables.view'],
    service_head: ['spares.stock', 'spares.engineerStockAll', 'spares.engineerStock', 'consumables.view'],
    // Engineer Stock page (sidebar gate): engineers see their own figures only.
    engineer: ['spares.engineerStock'],
    coordinator: ['consumables.view'],
    scm: ['spares.stock', 'spares.erpSync'],
    store: ['spares.issue', 'spares.stock', 'spares.erpSync', 'spares.engineerStockAll', 'spares.engineerStock'],
    accounts: ['spares.stock', 'consumables.view'],
  },
  // Store and SCM maintain minimum levels only; the rest of the part master comes from the ERP.
  fieldOverrides: Object.fromEntries(
    ['store', 'scm'].map((role) => [role, Object.fromEntries(['partNo', 'description', 'category', 'compatibleModels', 'hsn', 'price', 'uom', 'warrantyApplicable', 'returnable', 'status'].map((k) => [`spareParts.${k}`, 'view' as const]))]),
  ),
};
