/**
 * Spares & consumables module pack (FR-092 – FR-103): spare parts master and main-store stock,
 * part requisitions from tickets, OEM warranty claims, customer rate contracts and sample /
 * trial dispatches. Leakage and reorder lists are pages (src/modules/spares).
 */
import type { MasterDefinition, MasterValue, ResourceDefinition, Tone } from '../../metadata/types';
import { todayKey } from '../../lib/dates';
import { ALL, cols, cond, field, FORM_ONLY, group, views } from '../helpers';
import { type ModulePack, p } from './types';


const mv = (key: string, label: string, tone: Tone = 'neutral'): Omit<MasterValue, 'order'> => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[]): MasterDefinition => ({ id: `mst_${key}`, key, label, version: 1, values: values.map((x, i) => ({ ...x, order: i })) });

const masters: MasterDefinition[] = [
  master('spareCategory', 'Spare category', [
    mv('print_head', 'Print head', 'accent'),
    mv('damper', 'Damper'),
    mv('encoder', 'Encoder strip / sensor'),
    mv('pump', 'Pump / ink system'),
    mv('capping', 'Capping station'),
    mv('belt', 'Belt / drive'),
    mv('board', 'Electronic board', 'info'),
    mv('heater', 'Heater / dryer'),
    mv('wiper', 'Wiper / cleaning'),
    mv('other', 'Other'),
  ]),
  master('partStatus', 'Part status', [mv('active', 'Active', 'success'), mv('inactive', 'Discontinued')]),
  master('requisitionStatus', 'Requisition status', [
    mv('requested', 'Requested', 'info'),
    mv('approved', 'Approved', 'accent'),
    mv('rejected', 'Rejected', 'danger'),
    mv('issued', 'Issued / dispatched', 'warning'),
    mv('received', 'Received', 'info'),
    mv('consumed', 'Consumed', 'success'),
    mv('returned', 'Returned', 'neutral'),
  ]),
  master('partBasis', 'Consumption basis', [mv('warranty', 'Warranty / contract', 'success'), mv('chargeable', 'Chargeable', 'warning')]),
  master('defectiveReturn', 'Defective part return', [mv('not_required', 'Not required'), mv('pending', 'Pending return', 'warning'), mv('received', 'Received at store', 'success')]),
  master('requisitionUrgency', 'Urgency', [mv('normal', 'Normal'), mv('urgent', 'Urgent – machine down', 'danger')]),
  master('claimStatus', 'Claim status', [mv('raised', 'Raised', 'info'), mv('accepted', 'Accepted', 'success'), mv('rejected', 'Rejected', 'danger'), mv('credited', 'Credited', 'success')]),
  master('oem', 'OEM / principal', [mv('epson', 'Epson (print heads)'), mv('kyocera', 'Kyocera'), mv('ricoh', 'Ricoh'), mv('konica', 'Konica Minolta'), mv('principal', 'Machine principal (OEM)')]),
  master('rcStatus', 'Rate contract status', [mv('active', 'Active', 'success'), mv('inactive', 'Inactive')]),
  master('rcValidity', 'Validity', [mv('upcoming', 'Upcoming', 'info'), mv('valid', 'Valid', 'success'), mv('expired', 'Expired', 'neutral')]),
  master('sampleDispatchStatus', 'Sample dispatch status', [
    mv('requested', 'Requested', 'info'),
    mv('dispatched', 'Dispatched', 'warning'),
    mv('trial', 'Trial in progress', 'accent'),
    mv('results', 'Results received', 'success'),
    mv('cancelled', 'Cancelled'),
  ]),
  master('trialResult', 'Trial result', [mv('positive', 'Positive – customer satisfied', 'success'), mv('adjust', 'Needs adjustment', 'warning'), mv('negative', 'Negative', 'danger')]),
];

// ---------------------------------------------------------------- spare parts

const fp = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('spareParts', key, label, type, extra);

export const spareParts: ResourceDefinition = {
  id: 'res_spareParts',
  key: 'spareParts',
  module: 'spares',
  label: 'Spare part',
  labelPlural: 'Spare parts',
  icon: 'blocks',
  version: 1,
  idPrefix: 'SP',
  titleField: 'description',
  subtitleFields: ['partNo', 'category'],
  description: 'Spare parts master and main-store stock, synced from the ERP (simulated). Stores and SCM maintain minimum levels.',
  status: 'published',
  fields: [
    fp('partNo', 'Part no.', 'identifier', { required: true, maxLength: 30, capabilities: ALL, width: 150 }),
    fp('description', 'Description', 'text', { required: true, maxLength: 120, capabilities: ALL, width: 280, subFields: ['partNo'] }),
    fp('category', 'Category', 'master', { master: 'spareCategory', required: true, width: 150 }),
    fp('compatibleModels', 'Compatible models', 'text', { maxLength: 200, capabilities: ALL, width: 220 }),
    fp('hsn', 'HSN', 'text', { required: true, format: 'hsn', width: 100 }),
    fp('price', 'Price', 'money', { required: true, min: 0, width: 120 }),
    fp('uom', 'Unit', 'text', { defaultValue: 'Nos', maxLength: 10, width: 80 }),
    fp('warrantyApplicable', 'Covered by warranty', 'boolean', { defaultValue: true, width: 110 }),
    fp('returnable', 'Defective return required', 'boolean', { defaultValue: false, help: 'Failed parts must come back to the store (e.g. for an OEM warranty claim).' }),
    fp('stockMain', 'Main-store stock', 'number', { readOnly: true, defaultValue: 0, min: 0, width: 120, help: 'Synced from the ERP (simulated). Changes with issues and returns.' }),
    fp('minLevel', 'Minimum level', 'number', { min: 0, max: 10000, defaultValue: 0, width: 110 }),
    fp('critical', 'Critical part', 'boolean', { defaultValue: false, width: 90 }),
    fp('belowMin', 'Below minimum', 'boolean', {
      readOnly: true,
      computed: (r) => Number(r.stockMain ?? 0) < Number(r.minLevel ?? 0),
      capabilities: { list: true, filter: true, sort: true, export: true },
      width: 110,
    }),
    fp('suggestedOrderQty', 'Suggested import qty', 'number', {
      readOnly: true,
      computed: (r) => Math.max(0, Number(r.minLevel ?? 0) * 2 - Number(r.stockMain ?? 0)),
      capabilities: { list: true, sort: true, export: true },
      help: 'Twice the minimum level minus current stock.',
    }),
    fp('erpSyncedAt', 'ERP synced', 'datetime', { readOnly: true, capabilities: { list: true, sort: true } }),
    fp('status', 'Status', 'master', { master: 'partStatus', required: true, defaultValue: 'active', width: 110 }),
  ],
  relationships: [
    { id: 'rel_part_reqs', label: 'Requisitions', resource: 'requisitions', foreignKey: 'partId' },
    { id: 'rel_part_claims', label: 'Warranty claims', resource: 'warrantyClaims', foreignKey: 'partId' },
  ],
  form: {
    quickCreate: ['partNo', 'description', 'category', 'hsn', 'price', 'minLevel'],
    sections: [
      { id: 'part', title: 'Part', fields: ['partNo', 'description', 'category', 'compatibleModels', 'hsn', 'price', 'uom', 'status'], columns: 2 },
      { id: 'stock', title: 'Stock & policy', fields: ['stockMain', 'minLevel', 'critical', 'warrantyApplicable', 'returnable'], columns: 2 },
    ],
  },
  views: views([
    { id: 'v_sp_all', resource: 'spareParts', name: 'All parts', type: 'table', filter: group('and', [cond('status', 'eq', 'active')]), sort: [{ field: 'partNo', dir: 'asc' }], columns: cols('partNo', 'description', 'category', 'compatibleModels', 'stockMain', 'minLevel', 'belowMin', 'price', 'hsn') },
    {
      id: 'v_sp_below',
      resource: 'spareParts',
      name: 'Below minimum',
      type: 'table',
      filter: group('and', [cond('belowMin', 'eq', true), cond('status', 'eq', 'active')]),
      sort: [{ field: 'critical', dir: 'desc' }],
      columns: cols('partNo', 'description', 'critical', 'stockMain', 'minLevel', 'suggestedOrderQty', 'compatibleModels'),
    },
    { id: 'v_sp_by_cat', resource: 'spareParts', name: 'By category', type: 'table', filter: group('and'), sort: [{ field: 'partNo', dir: 'asc' }], groupBy: 'category', columns: cols('partNo', 'description', 'stockMain', 'minLevel', 'price') },
  ]),
};

// ---------------------------------------------------------------- requisitions

const fr = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('requisitions', key, label, type, extra);

export const requisitions: ResourceDefinition = {
  id: 'res_requisitions',
  key: 'requisitions',
  module: 'spares',
  label: 'Part requisition',
  labelPlural: 'Part requisitions',
  icon: 'receipt',
  version: 1,
  idPrefix: 'REQ',
  idFormat: 'fy',
  titleField: 'id',
  subtitleFields: ['partId', 'status'],
  ownerField: 'engineerId',
  divisionField: 'divisionId',
  description: 'Spare parts requested from a service ticket: approval → issue by the store → receipt by the engineer → consumption or return.',
  status: 'published',
  fields: [
    fr('ticketId', 'Ticket', 'relation', { required: true, relation: { resource: 'tickets' }, capabilities: ALL, width: 160 }),
    fr('partId', 'Part', 'relation', { required: true, relation: { resource: 'spareParts', where: { field: 'status', op: 'eq', value: 'active' } }, capabilities: ALL, width: 240 }),
    fr('qty', 'Quantity', 'number', { required: true, min: 1, max: 50, defaultValue: 1, width: 90 }),
    fr('urgency', 'Urgency', 'master', { master: 'requisitionUrgency', required: true, defaultValue: 'normal', width: 140 }),
    fr('engineerId', 'Engineer', 'relation', { relation: { resource: 'employees', where: { field: 'roleId', op: 'in', value: ['engineer', 'service_head', 'coordinator'] } }, width: 170, display: 'person', personSubtitle: 'designation', help: 'Defaults to you.' }),
    fr('reason', 'Reason / diagnosis', 'longtext', { maxLength: 500, capabilities: { ...FORM_ONLY, search: true } }),
    fr('status', 'Status', 'master', { master: 'requisitionStatus', readOnly: true, width: 150 }),
    fr('machineId', 'Machine', 'relation', { relation: { resource: 'machines' }, readOnly: true, width: 150 }),
    fr('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, readOnly: true, width: 200 }),
    fr('divisionId', 'Division', 'master', { master: 'division', readOnly: true, width: 110 }),
    fr('unitPrice', 'Unit price', 'money', { readOnly: true }),
    fr('value', 'Value', 'money', { readOnly: true, computed: (r) => Number(r.qty ?? 0) * Number(r.unitPrice ?? 0), capabilities: { list: true, sort: true, export: true }, width: 110 }),
    fr('stockWarning', 'Short at store', 'boolean', { readOnly: true, help: 'Main-store stock was below the requested quantity when raised; SCM was notified.', width: 110 }),
    fr('basis', 'Basis', 'master', { master: 'partBasis', readOnly: true, width: 150, help: 'Suggested from the machine’s warranty / contract; confirmed at consumption.' }),
    fr('issuedQty', 'Issued qty', 'number', { readOnly: true }),
    fr('courier', 'Courier', 'text', { readOnly: true }),
    fr('docketNo', 'Docket no.', 'text', { readOnly: true }),
    fr('issuedAt', 'Issued', 'datetime', { readOnly: true }),
    fr('receivedAt', 'Received', 'datetime', { readOnly: true }),
    fr('consumedQty', 'Consumed qty', 'number', { readOnly: true }),
    fr('consumedAt', 'Consumed', 'datetime', { readOnly: true }),
    fr('defectiveReturn', 'Defective return', 'master', { master: 'defectiveReturn', readOnly: true, width: 150 }),
    fr('defectiveReceivedAt', 'Defective part received', 'datetime', { readOnly: true }),
    fr('returnReason', 'Return reason', 'text', { readOnly: true }),
    fr('returnedAt', 'Returned', 'datetime', { readOnly: true }),
    fr('rejectReason', 'Rejection reason', 'text', { readOnly: true }),
  ],
  relationships: [{ id: 'rel_req_claims', label: 'Warranty claims', resource: 'warrantyClaims', foreignKey: 'requisitionId' }],
  lifecycle: {
    field: 'status',
    initial: 'requested',
    terminal: ['rejected', 'consumed', 'returned'],
    // Actions that capture data (reject, issue, consume, return) are record actions with dialogs.
    transitions: [
      { from: ['requested'], to: 'approved', action: 'Approve', capability: 'approve.service' },
      { from: ['issued'], to: 'received', action: 'Acknowledge receipt' },
    ],
  },
  form: {
    quickCreate: ['ticketId', 'partId', 'qty', 'urgency', 'reason'],
    sections: [{ id: 'req', title: 'Requisition', fields: ['ticketId', 'partId', 'qty', 'urgency', 'engineerId', 'reason'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_req_open',
      resource: 'requisitions',
      name: 'Open',
      type: 'table',
      filter: group('and', [cond('status', 'in', ['requested', 'approved', 'issued', 'received'])]),
      sort: [{ field: 'urgency', dir: 'desc' }],
      columns: cols('id', 'ticketId', 'partId', 'qty', 'urgency', 'engineerId', 'status', 'stockWarning', 'value'),
    },
    { id: 'v_req_board', resource: 'requisitions', name: 'Board', type: 'board', boardField: 'status', filter: group('and', [cond('status', 'in', ['requested', 'approved', 'issued', 'received'])]), sort: [{ field: 'urgency', dir: 'desc' }], columns: cols('partId', 'ticketId', 'engineerId', 'qty') },
    {
      id: 'v_req_returns',
      resource: 'requisitions',
      name: 'Defective returns',
      type: 'table',
      filter: group('and', [cond('defectiveReturn', 'eq', 'pending')]),
      sort: [{ field: 'consumedAt', dir: 'asc' }],
      columns: cols('id', 'partId', 'ticketId', 'engineerId', 'consumedAt', 'defectiveReturn', 'basis'),
    },
    { id: 'v_req_all', resource: 'requisitions', name: 'All', type: 'table', filter: group('and'), sort: [{ field: 'id', dir: 'desc' }], columns: cols('id', 'ticketId', 'partId', 'qty', 'engineerId', 'status', 'basis', 'value', 'customerId') },
  ]),
};

// ---------------------------------------------------------------- warranty claims

const fw = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('warrantyClaims', key, label, type, extra);

export const warrantyClaims: ResourceDefinition = {
  id: 'res_warrantyClaims',
  key: 'warrantyClaims',
  module: 'spares',
  label: 'Warranty claim',
  labelPlural: 'OEM warranty claims',
  icon: 'shield',
  version: 1,
  idPrefix: 'WC',
  titleField: 'id',
  subtitleFields: ['partId', 'status'],
  description: 'Claims to the principal / OEM for failed parts (SPR-05).',
  status: 'published',
  fields: [
    fw('partId', 'Part', 'relation', { required: true, relation: { resource: 'spareParts' }, capabilities: ALL, width: 240 }),
    fw('requisitionId', 'Requisition', 'relation', { relation: { resource: 'requisitions' }, width: 150 }),
    fw('oem', 'OEM / principal', 'master', { master: 'oem', required: true, width: 170 }),
    fw('claimNo', 'OEM claim no.', 'identifier', { maxLength: 30, capabilities: ALL, help: 'Filled in when the OEM acknowledges the claim.', width: 140 }),
    fw('raisedOn', 'Raised on', 'date', { required: true, dateRule: 'past', width: 110 }),
    fw('qty', 'Quantity', 'number', { required: true, min: 1, defaultValue: 1, width: 90 }),
    fw('amount', 'Claim value', 'money', { min: 0, width: 120 }),
    fw('status', 'Status', 'master', { master: 'claimStatus', readOnly: true, width: 120 }),
    fw('creditNoteNo', 'Credit note no.', 'text', { maxLength: 30 }),
    fw('notes', 'Failure details', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'raised',
    terminal: ['rejected', 'credited'],
    transitions: [
      { from: ['raised'], to: 'accepted', action: 'Mark accepted by OEM' },
      { from: ['raised'], to: 'rejected', action: 'Mark rejected by OEM', confirm: 'Mark this claim as rejected by the OEM? It will be closed.' },
      { from: ['accepted'], to: 'credited', action: 'Mark credited' },
    ],
  },
  form: {
    quickCreate: ['partId', 'oem', 'raisedOn', 'qty', 'amount'],
    sections: [{ id: 'claim', title: 'Claim', fields: ['partId', 'requisitionId', 'oem', 'claimNo', 'raisedOn', 'qty', 'amount', 'creditNoteNo', 'notes'], columns: 2 }],
  },
  views: views([
    { id: 'v_wc_open', resource: 'warrantyClaims', name: 'Open', type: 'table', filter: group('and', [cond('status', 'in', ['raised', 'accepted'])]), sort: [{ field: 'raisedOn', dir: 'asc' }], columns: cols('id', 'partId', 'oem', 'claimNo', 'raisedOn', 'qty', 'amount', 'status') },
    { id: 'v_wc_all', resource: 'warrantyClaims', name: 'All', type: 'table', filter: group('and'), sort: [{ field: 'raisedOn', dir: 'desc' }], columns: cols('id', 'partId', 'oem', 'claimNo', 'raisedOn', 'amount', 'status', 'creditNoteNo') },
  ]),
};

// ---------------------------------------------------------------- rate contracts

const fc = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('rateContracts', key, label, type, extra);

export const rateContracts: ResourceDefinition = {
  id: 'res_rateContracts',
  key: 'rateContracts',
  module: 'spares',
  label: 'Rate contract',
  labelPlural: 'Rate contracts',
  icon: 'scroll-text',
  version: 1,
  idPrefix: 'RC',
  titleField: 'id',
  subtitleFields: ['customerId', 'validity'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: 'Customer-specific consumables rates with validity. While valid they replace the price list (BR-41).',
  status: 'published',
  fields: [
    fc('customerId', 'Customer', 'relation', { required: true, relation: { resource: 'customers' }, capabilities: ALL, width: 220 }),
    fc('productId', 'Product', 'relation', { required: true, relation: { resource: 'products', where: { field: 'productType', op: 'in', value: ['ink', 'paper', 'fabric', 'spares'] } }, capabilities: ALL, width: 220 }),
    fc('rate', 'Contract rate', 'money', { required: true, min: 0, width: 120 }),
    fc('validFrom', 'Valid from', 'date', { required: true, width: 110 }),
    fc('validTo', 'Valid to', 'date', { required: true, compare: { op: 'gte', field: 'validFrom', message: 'Must be on or after “Valid from”' }, width: 110 }),
    fc('validity', 'Validity', 'master', { master: 'rcValidity', readOnly: true, computed: (r) => rcValidity(r), capabilities: { list: true, filter: true, export: true }, width: 110 }),
    fc('minQty', 'Minimum order qty', 'number', { min: 0 }),
    fc('divisionId', 'Division', 'master', { master: 'division', readOnly: true, width: 110 }),
    fc('ownerId', 'Owner', 'relation', { relation: { resource: 'employees' }, width: 170, display: 'person', personSubtitle: 'designation', help: 'Defaults to you.' }),
    fc('status', 'Status', 'master', { master: 'rcStatus', required: true, defaultValue: 'active', width: 100 }),
    fc('notes', 'Notes', 'longtext', { maxLength: 500, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  form: {
    quickCreate: ['customerId', 'productId', 'rate', 'validFrom', 'validTo'],
    sections: [{ id: 'rc', title: 'Rate contract', fields: ['customerId', 'productId', 'rate', 'minQty', 'validFrom', 'validTo', 'ownerId', 'status', 'notes'], columns: 2 }],
  },
  views: views([
    { id: 'v_rc_valid', resource: 'rateContracts', name: 'Valid', type: 'table', filter: group('and', [cond('validity', 'eq', 'valid'), cond('status', 'eq', 'active')]), sort: [{ field: 'validTo', dir: 'asc' }], columns: cols('id', 'customerId', 'productId', 'rate', 'minQty', 'validFrom', 'validTo', 'ownerId') },
    { id: 'v_rc_all', resource: 'rateContracts', name: 'All', type: 'table', filter: group('and'), sort: [{ field: 'validTo', dir: 'desc' }], columns: cols('id', 'customerId', 'productId', 'rate', 'validFrom', 'validTo', 'validity', 'status') },
  ]),
};

// ---------------------------------------------------------------- sample / trial dispatches

const fs = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('sampleDispatches', key, label, type, extra);

export const sampleDispatches: ResourceDefinition = {
  id: 'res_sampleDispatches',
  key: 'sampleDispatches',
  module: 'spares',
  label: 'Sample dispatch',
  labelPlural: 'Samples & trials',
  icon: 'send',
  version: 1,
  idPrefix: 'SD',
  titleField: 'id',
  subtitleFields: ['customerId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: 'Ink, paper and fabric samples sent for trial, with the trial result and customer feedback (CON-05).',
  status: 'published',
  fields: [
    fs('customerId', 'Customer', 'relation', { required: true, relation: { resource: 'customers' }, capabilities: ALL, width: 220 }),
    fs('productId', 'Product', 'relation', { required: true, relation: { resource: 'products', where: { field: 'productType', op: 'in', value: ['ink', 'paper', 'fabric'] } }, capabilities: ALL, width: 220 }),
    fs('qty', 'Quantity', 'number', { required: true, min: 1, max: 1000, defaultValue: 1, width: 90 }),
    fs('uom', 'Unit', 'text', { defaultValue: 'L', maxLength: 10, width: 70, help: 'e.g. L, kg, m, roll' }),
    fs('opportunityId', 'Opportunity', 'relation', { relation: { resource: 'opportunities' }, width: 180 }),
    fs('status', 'Status', 'master', { master: 'sampleDispatchStatus', readOnly: true, width: 140 }),
    fs('dispatchedOn', 'Dispatched on', 'date', { dateRule: 'past', width: 110 }),
    fs('courier', 'Courier / docket', 'text', { maxLength: 60 }),
    fs('trialDate', 'Trial date', 'date', { width: 110 }),
    fs('trialResult', 'Trial result', 'master', { master: 'trialResult', width: 180 }),
    fs('feedback', 'Customer feedback', 'longtext', { maxLength: 1000, capabilities: { ...FORM_ONLY, search: true } }),
    fs('followUpOn', 'Follow up on', 'date', { dateRule: 'future' }),
    fs('divisionId', 'Division', 'master', { master: 'division', readOnly: true, width: 110 }),
    fs('ownerId', 'Owner', 'relation', { relation: { resource: 'employees' }, width: 170, display: 'person', personSubtitle: 'designation', help: 'Defaults to you.' }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'requested',
    terminal: ['results', 'cancelled'],
    transitions: [
      { from: ['requested'], to: 'dispatched', action: 'Mark dispatched' },
      { from: ['dispatched'], to: 'trial', action: 'Start trial' },
      { from: ['dispatched', 'trial'], to: 'results', action: 'Record results' },
      { from: ['requested', 'dispatched'], to: 'cancelled', action: 'Cancel sample', confirm: 'Cancel this sample dispatch?' },
    ],
  },
  form: {
    quickCreate: ['customerId', 'productId', 'qty', 'uom', 'opportunityId'],
    sections: [
      { id: 'sample', title: 'Sample', fields: ['customerId', 'productId', 'qty', 'uom', 'opportunityId', 'ownerId'], columns: 2 },
      { id: 'trial', title: 'Dispatch & trial', fields: ['dispatchedOn', 'courier', 'trialDate', 'trialResult', 'followUpOn', 'feedback'], columns: 2 },
    ],
  },
  views: views([
    { id: 'v_sd_open', resource: 'sampleDispatches', name: 'Open', type: 'table', filter: group('and', [cond('status', 'in', ['requested', 'dispatched', 'trial'])]), sort: [{ field: 'dispatchedOn', dir: 'asc' }], columns: cols('id', 'customerId', 'productId', 'qty', 'status', 'dispatchedOn', 'trialDate', 'ownerId') },
    { id: 'v_sd_board', resource: 'sampleDispatches', name: 'Board', type: 'board', boardField: 'status', filter: group('and'), sort: [{ field: 'dispatchedOn', dir: 'desc' }], columns: cols('customerId', 'productId', 'ownerId') },
    { id: 'v_sd_results', resource: 'sampleDispatches', name: 'Results', type: 'table', filter: group('and', [cond('status', 'eq', 'results')]), sort: [{ field: 'trialDate', dir: 'desc' }], groupBy: 'trialResult', columns: cols('id', 'customerId', 'productId', 'trialDate', 'trialResult', 'ownerId') },
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
const consumablesAll = { rateContracts: p('all', 'all', true, true, true), sampleDispatches: p('all', 'all', true, true, true) };
const consumablesView = { rateContracts: p('all'), sampleDispatches: p('all') };

export const sparesPack: ModulePack = {
  id: 'spares',
  nav: {
    id: 'spares',
    label: 'Spares & consumables',
    icon: 'package',
    resources: ['requisitions', 'spareParts', 'warrantyClaims', 'rateContracts', 'sampleDispatches'],
    pages: [
      { id: 'stock-alerts', label: 'Stock alerts', icon: 'alert', path: 'spares/stock-alerts', capability: 'spares.stock' },
      { id: 'leakage', label: 'Consumables leakage', icon: 'activity', path: 'consumables/leakage', capability: 'consumables.view' },
      { id: 'reorders', label: 'Reorders due', icon: 'calendar-clock', path: 'consumables/reorders', capability: 'consumables.view' },
    ],
  },
  resources: [requisitions, spareParts, warrantyClaims, rateContracts, sampleDispatches],
  masters,
  permissions: {
    admin: { spareParts: p('all', 'all', true, true, true), requisitions: p('all', 'all', true, true, true), warrantyClaims: p('all', 'all', true, true, true), ...consumablesAll },
    management: { spareParts: p('all', 'none', false, false, true), requisitions: p('all', 'none', false, false, true), warrantyClaims: p('all', 'none', false, false, true), rateContracts: p('all', 'none', false, false, true), sampleDispatches: p('all', 'none', false, false, true) },
    division_head: { spareParts: none, requisitions: none, warrantyClaims: none, rateContracts: p('division', 'division', true, false, true), sampleDispatches: p('division', 'division', true, false, true) },
    sales_manager: { rateContracts: p('team', 'team', true), sampleDispatches: p('team', 'team', true) },
    sales_exec: { rateContracts: p('own', 'own', true), sampleDispatches: p('own', 'own', true) },
    service_head: { spareParts: p('all', 'none', false, false, true), requisitions: p('all', 'all', true, false, true), warrantyClaims: p('all', 'all', true, false, true), ...consumablesView },
    engineer: { spareParts: p('all'), requisitions: p('own', 'own', true) },
    coordinator: { spareParts: p('all'), requisitions: p('division', 'none', true), rateContracts: p('division', 'division', true), sampleDispatches: p('division', 'division', true) },
    scm: { spareParts: p('all', 'all', false, false, true), requisitions: p('all'), warrantyClaims: p('all', 'all', true, false, true) },
    store: { spareParts: p('all', 'all', false, false, true), requisitions: p('all', 'all', false, false, true), warrantyClaims: p('all', 'all', true) },
    accounts: { spareParts: p('all', 'none', false, false, true), requisitions: p('all', 'none', false, false, true), warrantyClaims: p('all'), ...consumablesView },
    profiling: { sampleDispatches: p('all', 'all') },
  },
  capabilities: {
    admin: ['spares.issue', 'spares.stock', 'spares.erpSync', 'consumables.view'],
    management: ['spares.stock', 'consumables.view'],
    division_head: ['consumables.view'],
    sales_manager: ['consumables.view'],
    sales_exec: ['consumables.view'],
    service_head: ['spares.stock', 'consumables.view'],
    coordinator: ['consumables.view'],
    scm: ['spares.stock', 'spares.erpSync'],
    store: ['spares.issue', 'spares.stock', 'spares.erpSync'],
    accounts: ['spares.stock', 'consumables.view'],
  },
  // Store and SCM maintain minimum levels only; the rest of the part master comes from the ERP.
  fieldOverrides: Object.fromEntries(
    ['store', 'scm'].map((role) => [role, Object.fromEntries(['partNo', 'description', 'category', 'compatibleModels', 'hsn', 'price', 'uom', 'warrantyApplicable', 'returnable', 'status'].map((k) => [`spareParts.${k}`, 'view' as const]))]),
  ),
};

