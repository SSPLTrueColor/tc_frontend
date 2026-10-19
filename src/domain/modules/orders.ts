/**
 * Sales Orders & Contracts pack (BRD 4.5, FR-049 – FR-061): sales orders, payment schedule
 * (payment milestones), sales contracts, plus the Dispatch record of 4.6 (INS-01 / INS-02).
 * Status changes that need captured data (approval, hold, cancel, dispatch, delivery, payments)
 * run through src/services/orders; the lifecycle below only lists the plain button steps so the
 * generic UI never bypasses a guard. Sidebar placement lives in src/domain/sidebar.ts.
 */
import type { FieldAccess, MasterDefinition, MasterValue, ResourceDefinition, Tone } from '../../metadata/types';
import { L } from '../../constants/labels';
import { todayKey } from '../../lib/dates';
import { ALL, cols, cond, field, FORM_ONLY, group, views } from '../helpers';
import { p, type ModulePack } from './types';

const O = L.orders;
const D = L.dispatch;

type Values = Record<string, string>;
const master = (key: string, def: { label: string; values: Values }, tones: Record<string, Tone>): MasterDefinition => ({
  id: `mst_${key}`,
  key,
  label: def.label,
  version: 1,
  values: Object.entries(def.values).map(([k, label], order): MasterValue => ({ key: k, label, tone: tones[k] ?? 'neutral', active: true, order })),
});

export const SO_STATUSES = ['pending_approval', 'confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch', 'dispatched', 'delivered', 'installation', 'completed', 'on_hold', 'cancelled'] as const;
/** Statuses in which hold / cancel / line edits are still possible (before dispatch). */
export const SO_BEFORE_DISPATCH = ['pending_approval', 'confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch'];
/** Statuses listed on the Order Processing page (SO-08): approved, not yet dispatched (plus Hold). */
export const SO_PROCESSING_STATUSES = ['confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch', 'on_hold'];
export const CUSTOMS_STATUSES = ['not_applicable', 'pending', 'filed', 'cleared'] as const;

const masters: MasterDefinition[] = [
  master('soStatus', O.masters.soStatus, {
    pending_approval: 'warning',
    confirmed: 'info',
    payment_pending: 'warning',
    payment_received: 'success',
    processing: 'info',
    ready_for_dispatch: 'accent',
    dispatched: 'accent',
    delivered: 'success',
    installation: 'info',
    completed: 'success',
    on_hold: 'danger',
    cancelled: 'neutral',
  }),
  master('orderKind', O.masters.orderKind, { machine: 'accent', consumables: 'info' }),
  master('milestoneStatus', O.masters.milestoneStatus, { due: 'info', partly_received: 'warning', received: 'success', overdue: 'danger' }),
  master('contractStatus', O.masters.contractStatus, { draft: 'info', sent_for_signature: 'warning', signed: 'success', superseded: 'neutral' }),
  master('dispatchStatus', D.masters.dispatchStatus, { in_transit: 'info', delivered: 'success' }),
  master('customsStatus', O.masters.customsStatus, { pending: 'warning', filed: 'info', cleared: 'success' }),
];

// ---------------------------------------------------------------- salesOrders

const F = O.fields.salesOrders;
const fs = (key: keyof typeof F, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('salesOrders', key, F[key], type, extra);
const RO = { readOnly: true };

/** Order Processing fields: editable only by Import / SCM and admin (SO-08 / FR-056). */
export const PROCESSING_FIELDS = ['poToPrincipalNo', 'poToPrincipalDate', 'shipmentEta', 'customsStatus', 'machineReady', 'pdiDone', 'processingNotes'];
/** Commercial fields frozen once the order is approved (changes go through "Edit Lines" + re-approval). */
export const COMMERCIAL_FIELDS = ['customerId', 'quotationId', 'divisionId', 'orderKind', 'orderDate', 'customerPoNo', 'customerPoDate', 'poFileName', 'placeOfSupply'];

const salesOrders: ResourceDefinition = {
  id: 'res_salesOrders',
  key: 'salesOrders',
  module: 'orders',
  label: O.records.salesOrders.one,
  labelPlural: O.records.salesOrders.many,
  icon: 'receipt',
  version: 1,
  idPrefix: 'SO',
  idFormat: 'fy',
  titleField: 'orderNo',
  subtitleFields: ['customerId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: O.descriptions.salesOrders,
  status: 'published',
  fields: [
    fs('orderNo', 'text', { readOnly: true, capabilities: ALL, width: 170, subFields: ['customerId'] }),
    fs('customerId', 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220 }),
    fs('orderKind', 'master', { master: 'orderKind', required: true, defaultValue: 'machine', width: 130 }),
    fs('divisionId', 'master', { master: 'division', required: true, width: 150 }),
    fs('ownerId', 'relation', { relation: { resource: 'employees' }, required: true, width: 170, display: 'person', personSubtitle: 'designation' }),
    fs('status', 'master', { master: 'soStatus', readOnly: true, width: 160 }),
    fs('orderDate', 'date', { required: true, dateRule: 'past' }),
    fs('grandTotal', 'money', { required: true, readOnly: true, currency: 'INR', width: 150 }),
    fs('quotationId', 'relation', { relation: { resource: 'quotations' }, width: 170 }),
    fs('opportunityId', 'relation', { relation: { resource: 'opportunities' }, readOnly: true, capabilities: { list: true, filter: true, export: true } }),
    fs('repeatOfId', 'relation', { relation: { resource: 'salesOrders' }, readOnly: true, capabilities: { list: true, export: true } }),
    fs('customerPoNo', 'text', { required: true, maxLength: 40, capabilities: ALL }),
    fs('customerPoDate', 'date', { required: true, dateRule: 'past' }),
    fs('poFileName', 'text', { required: true, maxLength: 120, help: F.poFileNameHelp }),
    fs('productId', 'relation', { relation: { resource: 'products' }, readOnly: true, width: 200 }),
    fs('siteAddressId', 'relation', { relation: { resource: 'addresses', filterBy: { field: 'customerId', fromField: 'customerId' } }, help: F.siteAddressIdHelp }),
    fs('placeOfSupply', 'master', { master: 'state', required: true }),
    fs('subtotal', 'money', { ...RO, currency: 'INR', capabilities: { list: true, export: true } }),
    fs('discountTotal', 'money', { ...RO, currency: 'INR', capabilities: { list: true, export: true } }),
    fs('freight', 'money', { ...RO, currency: 'INR', capabilities: { export: true } }),
    fs('insurance', 'money', { ...RO, currency: 'INR', capabilities: { export: true } }),
    fs('taxable', 'money', { ...RO, currency: 'INR', capabilities: { export: true } }),
    fs('cgst', 'money', { ...RO, currency: 'INR', capabilities: { export: true } }),
    fs('sgst', 'money', { ...RO, currency: 'INR', capabilities: { export: true } }),
    fs('igst', 'money', { ...RO, currency: 'INR', capabilities: { export: true } }),
    fs('maxDiscountPct', 'number', { ...RO, unit: '%', capabilities: { list: true, filter: true, export: true } }),
    fs('changeSummary', 'text', { ...RO, capabilities: { list: true, export: true }, width: 240 }),
    fs('paymentTerms', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fs('deliveryTerms', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fs('warrantyTerms', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fs('installationTerms', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fs('financeCheck', 'boolean', { ...RO, capabilities: { list: true, filter: true } }),
    fs('erpPushedAt', 'datetime', { ...RO, capabilities: { list: true, filter: true, export: true } }),
    fs('invoiceNo', 'text', { ...RO, capabilities: { list: true, search: true, export: true } }),
    fs('invoiceDate', 'date', { ...RO }),
    fs('ewayBill', 'text', { ...RO, capabilities: { list: true, search: true, export: true } }),
    // Order Processing (Import / SCM) — SO-08
    fs('poToPrincipalNo', 'text', { maxLength: 40, capabilities: { list: true, search: true, form: true, export: true } }),
    fs('poToPrincipalDate', 'date', { dateRule: 'past' }),
    fs('shipmentEta', 'date', { capabilities: { list: true, sort: true, filter: true, form: true, export: true } }),
    fs('customsStatus', 'master', { master: 'customsStatus', defaultValue: 'not_applicable' }),
    fs('machineReady', 'boolean', { defaultValue: false }),
    fs('pdiDone', 'boolean', { defaultValue: false }),
    fs('processingNotes', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fs('holdReason', 'text', { ...RO, capabilities: { list: true, export: true } }),
    fs('cancelReason', 'text', { ...RO, capabilities: { list: true, export: true } }),
    fs('deliveredAt', 'date', { ...RO, capabilities: { list: true, sort: true, filter: true, export: true } }),
    fs('completedAt', 'date', { ...RO, capabilities: { list: true, sort: true, filter: true, export: true } }),
    fs('statusBeforeHold', 'text', { system: true, readOnly: true, capabilities: {} }),
  ],
  relationships: [
    { id: 'rel_so_milestones', label: O.tabs.paymentSchedule, resource: 'paymentMilestones', foreignKey: 'salesOrderId' },
    { id: 'rel_so_dispatches', label: D.records.dispatches.many, resource: 'dispatches', foreignKey: 'salesOrderId' },
    { id: 'rel_so_contracts', label: O.records.salesContracts.many, resource: 'salesContracts', foreignKey: 'salesOrderId' },
  ],
  lifecycle: {
    field: 'status',
    initial: 'pending_approval',
    terminal: ['completed', 'cancelled'],
    // Plain steps only; approval, payment, hold/cancel, dispatch and delivery use the order actions.
    transitions: [
      { from: ['confirmed', 'payment_received'], to: 'processing', action: O.transitions.startProcessing, capability: 'orders.process' },
      { from: ['processing'], to: 'ready_for_dispatch', action: O.transitions.readyForDispatch, capability: 'orders.process' },
      { from: ['delivered'], to: 'installation', action: O.transitions.startInstallation, capability: 'orders.installation' },
      { from: ['delivered'], to: 'completed', action: O.transitions.completeOrder, capability: 'orders.complete.consumables' },
      { from: ['installation'], to: 'completed', action: O.transitions.markCompleted, capability: 'orders.complete', confirm: O.transitions.markCompletedConfirm },
    ],
  },
  form: {
    fullPage: true,
    primaryLabel: O.actions.newSalesOrder,
    quickCreate: ['customerPoNo', 'customerPoDate', 'poFileName'],
    sections: [
      { id: 'order', title: O.sections.salesOrders.order, fields: ['orderNo', 'customerId', 'orderKind', 'divisionId', 'ownerId', 'orderDate', 'quotationId', 'opportunityId', 'repeatOfId', 'productId', 'siteAddressId', 'placeOfSupply'], columns: 2 },
      { id: 'po', title: O.sections.salesOrders.po, fields: ['customerPoNo', 'customerPoDate', 'poFileName'], columns: 2 },
      { id: 'value', title: O.sections.salesOrders.value, fields: ['subtotal', 'discountTotal', 'freight', 'insurance', 'taxable', 'cgst', 'sgst', 'igst', 'grandTotal', 'maxDiscountPct', 'changeSummary'], columns: 2 },
      { id: 'terms', title: O.sections.salesOrders.terms, fields: ['paymentTerms', 'deliveryTerms', 'warrantyTerms', 'installationTerms'], columns: 1 },
      { id: 'processing', title: O.sections.salesOrders.processing, fields: PROCESSING_FIELDS, columns: 2 },
      { id: 'erp', title: O.sections.salesOrders.erp, fields: ['financeCheck', 'erpPushedAt', 'invoiceNo', 'invoiceDate', 'ewayBill'], columns: 2 },
      { id: 'status', title: O.sections.salesOrders.status, fields: ['holdReason', 'cancelReason', 'deliveredAt', 'completedAt'], columns: 2 },
    ],
  },
  // Order Processing (SCM) is its own page (ROUTES.orderProcessing), not a saved view.
  views: views([
    {
      id: 'v_so_open',
      resource: 'salesOrders',
      name: O.views.salesOrders.open,
      type: 'table',
      filter: group('and', [cond('status', 'in', ['pending_approval', 'confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch', 'dispatched', 'delivered', 'installation', 'on_hold'])]),
      sort: [{ field: 'orderDate', dir: 'desc' }],
      columns: cols('orderNo', 'customerId', 'orderKind', 'divisionId', 'grandTotal', 'status', 'orderDate', 'ownerId'),
    },
    {
      id: 'v_so_approval',
      resource: 'salesOrders',
      name: O.views.salesOrders.approval,
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'pending_approval')]),
      sort: [{ field: 'orderDate', dir: 'asc' }],
      columns: cols('orderNo', 'customerId', 'grandTotal', 'maxDiscountPct', 'changeSummary', 'financeCheck', 'ownerId'),
    },
    {
      id: 'v_so_backlog',
      resource: 'salesOrders',
      name: O.views.salesOrders.backlog,
      type: 'table',
      filter: group('and', [cond('status', 'in', ['confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch', 'dispatched', 'delivered', 'installation'])]),
      sort: [{ field: 'orderDate', dir: 'asc' }],
      columns: cols('orderNo', 'customerId', 'grandTotal', 'status', 'shipmentEta', 'machineReady', 'pdiDone', 'orderDate'),
    },
    {
      id: 'v_so_board',
      resource: 'salesOrders',
      name: O.views.salesOrders.board,
      type: 'board',
      boardField: 'status',
      filter: group('and', [cond('status', 'neq', 'cancelled')]),
      sort: [{ field: 'orderDate', dir: 'desc' }],
      columns: cols('orderNo', 'customerId', 'grandTotal', 'ownerId'),
    },
    {
      id: 'v_so_all',
      resource: 'salesOrders',
      name: O.views.salesOrders.all,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'orderDate', dir: 'desc' }],
      columns: cols('orderNo', 'customerId', 'orderKind', 'divisionId', 'grandTotal', 'status', 'orderDate', 'invoiceNo', 'ownerId'),
    },
  ]),
};

// ---------------------------------------------------------------- paymentMilestones (Payment Schedule, SO-07)

const FM = O.fields.paymentMilestones;
const fm = (key: keyof typeof FM, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('paymentMilestones', key, FM[key], type, extra);

const paymentMilestones: ResourceDefinition = {
  id: 'res_paymentMilestones',
  key: 'paymentMilestones',
  module: 'orders',
  label: O.records.paymentMilestones.one,
  labelPlural: O.records.paymentMilestones.many,
  icon: 'calendar-clock',
  version: 1,
  idPrefix: 'PM',
  titleField: 'label',
  subtitleFields: ['salesOrderId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: O.descriptions.paymentMilestones,
  status: 'published',
  fields: [
    fm('label', 'text', { required: true, maxLength: 60, capabilities: ALL, width: 200, subFields: ['salesOrderId'] }),
    fm('salesOrderId', 'relation', { relation: { resource: 'salesOrders' }, required: true, readOnly: true, capabilities: ALL, width: 170 }),
    fm('customerId', 'relation', { relation: { resource: 'customers' }, readOnly: true, capabilities: ALL, width: 200 }),
    fm('percent', 'number', { readOnly: true, unit: '%', width: 90 }),
    fm('amount', 'money', { required: true, readOnly: true, currency: 'INR', width: 140 }),
    fm('dueDate', 'date', { required: true, readOnly: true, width: 120 }),
    fm('receivedAmount', 'money', { readOnly: true, currency: 'INR', width: 140 }),
    fm('receivedAt', 'date', { readOnly: true }),
    fm('status', 'master', { master: 'milestoneStatus', readOnly: true, width: 140 }),
    fm('ownerId', 'relation', { relation: { resource: 'employees' }, readOnly: true, width: 170 }),
    fm('divisionId', 'master', { master: 'division', readOnly: true }),
    fm('lastReminderAt', 'datetime', { readOnly: true }),
  ],
  relationships: [],
  form: { quickCreate: [], sections: [{ id: 'main', title: O.sections.paymentMilestones.main, fields: ['label', 'salesOrderId', 'customerId', 'percent', 'amount', 'dueDate', 'receivedAmount', 'receivedAt', 'status', 'ownerId', 'divisionId', 'lastReminderAt'], columns: 2 }] },
  views: views([
    {
      id: 'v_pm_open',
      resource: 'paymentMilestones',
      name: O.views.paymentMilestones.open,
      type: 'table',
      filter: group('and', [cond('status', 'in', ['due', 'partly_received', 'overdue'])]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: cols('label', 'salesOrderId', 'customerId', 'amount', 'receivedAmount', 'dueDate', 'status', 'ownerId'),
    },
    {
      id: 'v_pm_overdue',
      resource: 'paymentMilestones',
      name: O.views.paymentMilestones.overdue,
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'overdue')]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: cols('label', 'salesOrderId', 'customerId', 'amount', 'receivedAmount', 'dueDate', 'ownerId', 'lastReminderAt'),
    },
    {
      id: 'v_pm_all',
      resource: 'paymentMilestones',
      name: O.views.paymentMilestones.all,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'dueDate', dir: 'desc' }],
      columns: cols('label', 'salesOrderId', 'customerId', 'percent', 'amount', 'receivedAmount', 'dueDate', 'status'),
    },
  ]),
};

// ---------------------------------------------------------------- salesContracts (SO-05 / SO-06)

const FC = O.fields.salesContracts;
const fc = (key: keyof typeof FC, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('salesContracts', key, FC[key], type, extra);

const salesContracts: ResourceDefinition = {
  id: 'res_salesContracts',
  key: 'salesContracts',
  module: 'orders',
  label: O.records.salesContracts.one,
  labelPlural: O.records.salesContracts.many,
  icon: 'scroll-text',
  version: 1,
  idPrefix: 'SC',
  titleField: 'contractNo',
  subtitleFields: ['salesOrderId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: O.descriptions.salesContracts,
  status: 'published',
  fields: [
    fc('contractNo', 'text', { readOnly: true, capabilities: ALL, width: 190, subFields: ['customerId'] }),
    fc('salesOrderId', 'relation', { relation: { resource: 'salesOrders' }, required: true, readOnly: true, capabilities: ALL, width: 170 }),
    fc('customerId', 'relation', { relation: { resource: 'customers' }, readOnly: true, capabilities: ALL, width: 200 }),
    fc('version', 'number', { readOnly: true, width: 80 }),
    fc('status', 'master', { master: 'contractStatus', readOnly: true, width: 160 }),
    fc('contractValue', 'money', { readOnly: true, currency: 'INR', width: 150 }),
    fc('paymentTerms', 'longtext', { required: true, maxLength: 1500, capabilities: FORM_ONLY }),
    fc('deliveryTerms', 'longtext', { required: true, maxLength: 1500, capabilities: FORM_ONLY }),
    fc('loadingTerms', 'longtext', { maxLength: 1500, capabilities: FORM_ONLY }),
    fc('installationTerms', 'longtext', { maxLength: 1500, capabilities: FORM_ONLY }),
    fc('warrantyTerms', 'longtext', { maxLength: 1500, capabilities: FORM_ONLY }),
    fc('sparesTerms', 'longtext', { maxLength: 1500, capabilities: FORM_ONLY }),
    fc('inkCommitment', 'longtext', { maxLength: 1500, capabilities: FORM_ONLY }),
    fc('amcTerms', 'longtext', { maxLength: 1500, capabilities: FORM_ONLY }),
    fc('sentAt', 'datetime', { readOnly: true }),
    fc('signedAt', 'datetime', { readOnly: true, capabilities: { list: true, sort: true, filter: true, export: true } }),
    fc('signedBy', 'text', { readOnly: true }),
    fc('ownerId', 'relation', { relation: { resource: 'employees' }, readOnly: true, width: 170 }),
    fc('divisionId', 'master', { master: 'division', readOnly: true }),
  ],
  relationships: [],
  form: {
    quickCreate: [],
    sections: [
      { id: 'main', title: O.sections.salesContracts.main, fields: ['contractNo', 'salesOrderId', 'customerId', 'version', 'status', 'contractValue', 'ownerId', 'divisionId'], columns: 2 },
      { id: 'terms', title: O.sections.salesContracts.terms, fields: ['paymentTerms', 'deliveryTerms', 'loadingTerms', 'installationTerms', 'warrantyTerms', 'sparesTerms', 'inkCommitment', 'amcTerms'], columns: 1 },
      { id: 'sign', title: O.sections.salesContracts.sign, fields: ['sentAt', 'signedAt', 'signedBy'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_sc_all',
      resource: 'salesContracts',
      name: O.views.salesContracts.current,
      type: 'table',
      filter: group('and', [cond('status', 'neq', 'superseded')]),
      sort: [{ field: 'contractNo', dir: 'desc' }],
      columns: cols('contractNo', 'salesOrderId', 'customerId', 'version', 'contractValue', 'status', 'signedAt'),
    },
    {
      id: 'v_sc_unsigned',
      resource: 'salesContracts',
      name: O.views.salesContracts.unsigned,
      type: 'table',
      filter: group('and', [cond('status', 'in', ['draft', 'sent_for_signature'])]),
      sort: [{ field: 'contractNo', dir: 'asc' }],
      columns: cols('contractNo', 'salesOrderId', 'customerId', 'status', 'sentAt', 'ownerId'),
    },
  ]),
};

// ---------------------------------------------------------------- dispatches (Dispatch & Delivery, INS-01 / INS-02)

const FD = D.fields.dispatches;
const fd = (key: keyof typeof FD, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('dispatches', key, FD[key], type, extra);

const dispatches: ResourceDefinition = {
  id: 'res_dispatches',
  key: 'dispatches',
  module: 'dispatch',
  label: D.records.dispatches.one,
  labelPlural: D.records.dispatches.many,
  icon: 'send',
  version: 1,
  idPrefix: 'DSP',
  titleField: 'lrNumber',
  subtitleFields: ['salesOrderId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: D.descriptions.dispatches,
  status: 'published',
  fields: [
    fd('salesOrderId', 'relation', { relation: { resource: 'salesOrders' }, required: true, readOnly: true, capabilities: ALL, width: 170, subFields: ['customerId'] }),
    fd('customerId', 'relation', { relation: { resource: 'customers' }, readOnly: true, capabilities: ALL, width: 200 }),
    fd('dispatchDate', 'date', { required: true, dateRule: 'past', width: 130 }),
    fd('transporter', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 170 }),
    fd('lrNumber', 'text', { required: true, maxLength: 40, capabilities: ALL, width: 140 }),
    fd('challanNo', 'text', { maxLength: 40, capabilities: ALL }),
    fd('invoiceRef', 'text', { maxLength: 40, capabilities: ALL }),
    fd('ewayBill', 'text', { maxLength: 20, pattern: { regex: '^[0-9]{12}$', message: FD.ewayBillPattern }, capabilities: ALL }),
    fd('expectedDelivery', 'date', { required: true, compare: { op: 'gte', field: 'dispatchDate', message: FD.expectedDeliveryCompare }, width: 140 }),
    fd('actualDelivery', 'date', { readOnly: true, width: 130 }),
    fd('podFileName', 'text', { readOnly: true }),
    fd('podPhotoName', 'text', { readOnly: true }),
    fd('status', 'master', { master: 'dispatchStatus', readOnly: true, width: 130 }),
    fd('delayDays', 'number', {
      readOnly: true,
      unit: 'days',
      computed: (r) => {
        const until = (r.actualDelivery as string) || todayKey();
        const d = Math.round((new Date(until).getTime() - new Date(String(r.expectedDelivery)).getTime()) / 86_400_000);
        return r.expectedDelivery && d > 0 ? d : 0;
      },
      capabilities: { list: true, sort: false, export: true },
    }),
    fd('ownerId', 'relation', { relation: { resource: 'employees' }, readOnly: true, width: 170 }),
    fd('divisionId', 'master', { master: 'division', readOnly: true }),
  ],
  relationships: [],
  form: {
    quickCreate: [],
    sections: [
      { id: 'main', title: D.sections.dispatches.main, fields: ['salesOrderId', 'customerId', 'dispatchDate', 'transporter', 'lrNumber', 'challanNo', 'invoiceRef', 'ewayBill', 'expectedDelivery'], columns: 2 },
      { id: 'delivery', title: D.sections.dispatches.delivery, fields: ['status', 'actualDelivery', 'podFileName', 'podPhotoName', 'delayDays'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_dsp_transit',
      resource: 'dispatches',
      name: D.views.dispatches.transit,
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'in_transit')]),
      sort: [{ field: 'expectedDelivery', dir: 'asc' }],
      columns: cols('salesOrderId', 'customerId', 'transporter', 'lrNumber', 'dispatchDate', 'expectedDelivery', 'delayDays'),
    },
    {
      id: 'v_dsp_delayed',
      resource: 'dispatches',
      name: D.views.dispatches.delayed,
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'in_transit'), cond('expectedDelivery', 'past')]),
      sort: [{ field: 'expectedDelivery', dir: 'asc' }],
      columns: cols('salesOrderId', 'customerId', 'transporter', 'lrNumber', 'expectedDelivery', 'delayDays', 'ownerId'),
    },
    {
      id: 'v_dsp_all',
      resource: 'dispatches',
      name: D.views.dispatches.all,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'dispatchDate', dir: 'desc' }],
      columns: cols('salesOrderId', 'customerId', 'transporter', 'lrNumber', 'ewayBill', 'dispatchDate', 'expectedDelivery', 'actualDelivery', 'status'),
    },
  ]),
};

// ---------------------------------------------------------------- permissions (REQUIREMENTS §2.2, Appendix B "Sales Order & Contract" / "Dispatch & Installation")

const ORDER_RES = ['salesOrders', 'paymentMilestones', 'salesContracts', 'dispatches'];
const same = (perm: ReturnType<typeof p>, keys = ORDER_RES) => Object.fromEntries(keys.map((k) => [k, perm]));
/** Generic create is off for milestones / contracts / dispatches — they come from order actions. */
const sales = (scope: 'all' | 'division' | 'team' | 'own', exp: boolean) => ({
  salesOrders: p(scope, scope, true, false, exp),
  paymentMilestones: p(scope, 'none', false, false, exp),
  salesContracts: p(scope, scope, false, false, exp),
  dispatches: p(scope, 'none', false, false, exp),
});

const viewOnly = (keys: string[]): Record<string, FieldAccess> => Object.fromEntries(keys.map((k) => [`salesOrders.${k}`, 'view' as FieldAccess]));
const NON_PROCESSING = salesOrders.fields.map((f) => f.key).filter((k) => !PROCESSING_FIELDS.includes(k));

export const ordersPack: ModulePack = {
  id: 'orders',
  resources: [salesOrders, paymentMilestones, salesContracts, dispatches],
  masters,
  permissions: {
    admin: { ...same(p('all', 'all', true, true, true)), paymentMilestones: p('all', 'none', false, true, true), dispatches: p('all', 'all', false, true, true) },
    management: same(p('all', 'none', false, false, true)),
    division_head: sales('division', true),
    sales_manager: sales('team', true),
    sales_exec: sales('own', false),
    service_head: same(p('all')),
    coordinator: { ...same(p('division')), dispatches: p('division', 'division', false, false, false) },
    scm: { salesOrders: p('all', 'all'), paymentMilestones: p('all'), salesContracts: p('all'), dispatches: p('all', 'all') },
    store: same(p('all')),
    accounts: same(p('all', 'none', false, false, true)),
  },
  capabilities: {
    admin: ['orders.process', 'orders.dispatch', 'orders.erp', 'orders.installation', 'orders.complete', 'orders.complete.consumables', 'orders.contract', 'orders.receipts'],
    scm: ['orders.process', 'orders.dispatch', 'orders.erp'],
    coordinator: ['orders.dispatch', 'orders.installation', 'orders.complete.consumables'],
    service_head: ['orders.installation'],
    accounts: ['orders.erp', 'orders.receipts'],
    sales_manager: ['orders.contract', 'orders.approve.manager', 'orders.complete.consumables'],
    division_head: ['orders.contract', 'orders.complete.consumables'],
    sales_exec: ['orders.contract', 'orders.complete.consumables'],
  },
  fieldOverrides: {
    // SCM edits only Order Processing (SO-08); everyone else sees processing read-only.
    scm: viewOnly(NON_PROCESSING),
    division_head: viewOnly(PROCESSING_FIELDS),
    sales_manager: viewOnly(PROCESSING_FIELDS),
    sales_exec: viewOnly(PROCESSING_FIELDS),
    coordinator: viewOnly(PROCESSING_FIELDS),
  },
};
