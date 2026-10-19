/**
 * Orders module pack (FR-049 – FR-061): sales orders, payment milestones, sales contracts and
 * dispatches. Status changes that need captured data (approval, hold, cancel, dispatch,
 * delivery, payments) run through src/services/orders; the lifecycle below only lists the
 * plain button steps so the generic UI never bypasses a guard.
 */
import type { FieldAccess, MasterDefinition, MasterValue, ResourceDefinition, Tone } from '../../metadata/types';
import { todayKey } from '../../lib/dates';
import { ALL, cols, cond, field, FORM_ONLY, group, views } from '../helpers';
import { p, type ModulePack } from './types';

const mv = (key: string, label: string, tone: Tone = 'neutral'): Omit<MasterValue, 'order'> => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[]): MasterDefinition => ({ id: `mst_${key}`, key, label, version: 1, values: values.map((x, i) => ({ ...x, order: i })) });

export const SO_STATUSES = ['pending_approval', 'confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch', 'dispatched', 'delivered', 'installation', 'completed', 'on_hold', 'cancelled'] as const;
/** Statuses in which hold / cancel / line edits are still possible (before dispatch). */
export const SO_BEFORE_DISPATCH = ['pending_approval', 'confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch'];

const masters: MasterDefinition[] = [
  master('soStatus', 'Sales order status', [
    mv('pending_approval', 'Pending approval', 'warning'),
    mv('confirmed', 'Confirmed', 'info'),
    mv('payment_pending', 'Payment pending', 'warning'),
    mv('payment_received', 'Payment received', 'success'),
    mv('processing', 'Processing', 'info'),
    mv('ready_for_dispatch', 'Ready for dispatch', 'accent'),
    mv('dispatched', 'Dispatched', 'accent'),
    mv('delivered', 'Delivered', 'success'),
    mv('installation', 'Installation', 'info'),
    mv('completed', 'Completed', 'success'),
    mv('on_hold', 'On hold', 'danger'),
    mv('cancelled', 'Cancelled', 'neutral'),
  ]),
  master('orderKind', 'Order kind', [mv('machine', 'Machine', 'accent'), mv('consumables', 'Consumables', 'info')]),
  master('milestoneStatus', 'Payment status', [mv('due', 'Due', 'info'), mv('partly_received', 'Partly received', 'warning'), mv('received', 'Received', 'success'), mv('overdue', 'Overdue', 'danger')]),
  master('contractStatus', 'Contract status', [mv('draft', 'Draft', 'info'), mv('sent_for_signature', 'Sent for e-signature', 'warning'), mv('signed', 'Signed', 'success'), mv('superseded', 'Superseded', 'neutral')]),
  master('dispatchStatus', 'Dispatch status', [mv('in_transit', 'In transit', 'info'), mv('delivered', 'Delivered', 'success')]),
  master('customsStatus', 'Customs status', [mv('not_applicable', 'Not applicable'), mv('pending', 'Pending', 'warning'), mv('filed', 'Bill of entry filed', 'info'), mv('cleared', 'Cleared', 'success')]),
];

// ---------------------------------------------------------------- salesOrders

const fs = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('salesOrders', key, label, type, extra);
const RO = { readOnly: true };

/** Processing (SCM) fields — editable only by Import / SCM and admin (FR-056). */
export const PROCESSING_FIELDS = ['poToPrincipalNo', 'poToPrincipalDate', 'shipmentEta', 'customsStatus', 'machineReady', 'pdiDone', 'processingNotes'];
/** Commercial fields frozen once the order is approved (changes go through "Edit lines" + re-approval). */
export const COMMERCIAL_FIELDS = ['customerId', 'quotationId', 'divisionId', 'orderKind', 'orderDate', 'customerPoNo', 'customerPoDate', 'poFileName', 'placeOfSupply'];

const salesOrders: ResourceDefinition = {
  id: 'res_salesOrders',
  key: 'salesOrders',
  module: 'orders',
  label: 'Sales order',
  labelPlural: 'Sales orders',
  icon: 'receipt',
  version: 1,
  idPrefix: 'SO',
  idFormat: 'fy',
  titleField: 'orderNo',
  subtitleFields: ['customerId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: 'Orders generated from accepted quotations (or repeat consumables orders), approved, pushed to ERP and tracked to installation.',
  status: 'published',
  fields: [
    fs('orderNo', 'Order no.', 'text', { readOnly: true, capabilities: ALL, width: 170, subFields: ['customerId'] }),
    fs('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220 }),
    fs('orderKind', 'Kind', 'master', { master: 'orderKind', required: true, defaultValue: 'machine', width: 120 }),
    fs('divisionId', 'Division', 'master', { master: 'division', required: true, width: 150 }),
    fs('ownerId', 'Sales owner', 'relation', { relation: { resource: 'employees' }, required: true, width: 170, display: 'person', personSubtitle: 'designation' }),
    fs('status', 'Status', 'master', { master: 'soStatus', readOnly: true, width: 160 }),
    fs('orderDate', 'Order date', 'date', { required: true, dateRule: 'past' }),
    fs('grandTotal', 'Order value', 'money', { required: true, readOnly: true, currency: 'INR', width: 150 }),
    fs('quotationId', 'Quotation', 'relation', { relation: { resource: 'quotations' }, width: 170 }),
    fs('opportunityId', 'Opportunity', 'relation', { relation: { resource: 'opportunities' }, readOnly: true, capabilities: { list: true, filter: true, export: true } }),
    fs('repeatOfId', 'Repeat of', 'relation', { relation: { resource: 'salesOrders' }, readOnly: true, capabilities: { list: true, export: true } }),
    fs('customerPoNo', 'Customer PO no.', 'text', { required: true, maxLength: 40, capabilities: ALL }),
    fs('customerPoDate', 'Customer PO date', 'date', { required: true, dateRule: 'past' }),
    fs('poFileName', 'PO copy', 'text', { required: true, maxLength: 120, help: 'File name of the uploaded PO copy (simulated upload — the file itself is not stored).' }),
    fs('productId', 'Main product', 'relation', { relation: { resource: 'products' }, readOnly: true, width: 200 }),
    fs('siteAddressId', 'Installation site', 'relation', { relation: { resource: 'addresses', filterBy: { field: 'customerId', fromField: 'customerId' } } }),
    fs('placeOfSupply', 'Place of supply', 'master', { master: 'state', required: true }),
    fs('subtotal', 'Subtotal', 'money', { ...RO, currency: 'INR', capabilities: { list: true, export: true } }),
    fs('discountTotal', 'Discount', 'money', { ...RO, currency: 'INR', capabilities: { list: true, export: true } }),
    fs('freight', 'Freight', 'money', { ...RO, currency: 'INR', capabilities: { export: true } }),
    fs('insurance', 'Insurance', 'money', { ...RO, currency: 'INR', capabilities: { export: true } }),
    fs('taxable', 'Taxable value', 'money', { ...RO, currency: 'INR', capabilities: { export: true } }),
    fs('cgst', 'CGST', 'money', { ...RO, currency: 'INR', capabilities: { export: true } }),
    fs('sgst', 'SGST', 'money', { ...RO, currency: 'INR', capabilities: { export: true } }),
    fs('igst', 'IGST', 'money', { ...RO, currency: 'INR', capabilities: { export: true } }),
    fs('maxDiscountPct', 'Highest discount %', 'number', { ...RO, unit: '%', capabilities: { list: true, filter: true, export: true } }),
    fs('changeSummary', 'Changes vs quotation', 'text', { ...RO, capabilities: { list: true, export: true }, width: 240 }),
    fs('paymentTerms', 'Payment terms', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fs('deliveryTerms', 'Delivery terms', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fs('warrantyTerms', 'Warranty terms', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fs('installationTerms', 'Installation terms', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fs('financeCheck', 'Finance check required', 'boolean', { ...RO, capabilities: { list: true, filter: true } }),
    fs('erpPushedAt', 'Pushed to ERP', 'datetime', { ...RO, capabilities: { list: true, filter: true, export: true } }),
    fs('invoiceNo', 'ERP invoice no.', 'text', { ...RO, capabilities: { list: true, search: true, export: true } }),
    fs('invoiceDate', 'ERP invoice date', 'date', { ...RO }),
    fs('ewayBill', 'E-way bill no.', 'text', { ...RO, capabilities: { list: true, search: true, export: true } }),
    // Processing (SCM) — FR-056
    fs('poToPrincipalNo', 'PO to principal no.', 'text', { maxLength: 40, capabilities: { list: true, search: true, form: true, export: true } }),
    fs('poToPrincipalDate', 'PO to principal date', 'date', { dateRule: 'past' }),
    fs('shipmentEta', 'Shipment ETA', 'date', { capabilities: { list: true, sort: true, filter: true, form: true, export: true } }),
    fs('customsStatus', 'Customs', 'master', { master: 'customsStatus', defaultValue: 'not_applicable' }),
    fs('machineReady', 'Machine ready', 'boolean', { defaultValue: false }),
    fs('pdiDone', 'Pre-dispatch inspection done', 'boolean', { defaultValue: false }),
    fs('processingNotes', 'Processing notes', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fs('holdReason', 'Hold reason', 'text', { ...RO, capabilities: { list: true, export: true } }),
    fs('cancelReason', 'Cancellation reason', 'text', { ...RO, capabilities: { list: true, export: true } }),
    fs('deliveredAt', 'Delivered on', 'date', { ...RO, capabilities: { list: true, sort: true, filter: true, export: true } }),
    fs('completedAt', 'Completed on', 'date', { ...RO, capabilities: { list: true, sort: true, filter: true, export: true } }),
    fs('statusBeforeHold', 'Status before hold', 'text', { system: true, readOnly: true, capabilities: {} }),
  ],
  relationships: [
    { id: 'rel_so_milestones', label: 'Payment milestones', resource: 'paymentMilestones', foreignKey: 'salesOrderId' },
    { id: 'rel_so_dispatches', label: 'Dispatches', resource: 'dispatches', foreignKey: 'salesOrderId' },
    { id: 'rel_so_contracts', label: 'Sales contracts', resource: 'salesContracts', foreignKey: 'salesOrderId' },
  ],
  lifecycle: {
    field: 'status',
    initial: 'pending_approval',
    terminal: ['completed', 'cancelled'],
    // Plain steps only; approval, payment, hold/cancel, dispatch and delivery use the order actions.
    transitions: [
      { from: ['confirmed', 'payment_received'], to: 'processing', action: 'Start processing', capability: 'orders.process' },
      { from: ['processing'], to: 'ready_for_dispatch', action: 'Mark ready for dispatch', capability: 'orders.process' },
      { from: ['delivered'], to: 'installation', action: 'Start installation', capability: 'orders.installation' },
      { from: ['delivered'], to: 'completed', action: 'Complete order', capability: 'orders.complete.consumables' },
      { from: ['installation'], to: 'completed', action: 'Mark completed', capability: 'orders.complete', confirm: 'Mark this order completed? Normally installation sign-off completes it automatically.' },
    ],
  },
  form: {
    fullPage: true,
    primaryLabel: 'New sales order',
    quickCreate: ['customerPoNo', 'customerPoDate', 'poFileName'],
    sections: [
      { id: 'order', title: 'Order', fields: ['orderNo', 'customerId', 'orderKind', 'divisionId', 'ownerId', 'orderDate', 'quotationId', 'opportunityId', 'repeatOfId', 'productId', 'siteAddressId', 'placeOfSupply'], columns: 2 },
      { id: 'po', title: 'Customer PO', fields: ['customerPoNo', 'customerPoDate', 'poFileName'], columns: 2 },
      { id: 'value', title: 'Value', fields: ['subtotal', 'discountTotal', 'freight', 'insurance', 'taxable', 'cgst', 'sgst', 'igst', 'grandTotal', 'maxDiscountPct', 'changeSummary'], columns: 2 },
      { id: 'terms', title: 'Terms', fields: ['paymentTerms', 'deliveryTerms', 'warrantyTerms', 'installationTerms'], columns: 1 },
      { id: 'processing', title: 'Processing (Import / SCM)', fields: PROCESSING_FIELDS, columns: 2 },
      { id: 'erp', title: 'ERP', fields: ['financeCheck', 'erpPushedAt', 'invoiceNo', 'invoiceDate', 'ewayBill'], columns: 2 },
      { id: 'status', title: 'Status', fields: ['holdReason', 'cancelReason', 'deliveredAt', 'completedAt'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_so_open',
      resource: 'salesOrders',
      name: 'Open orders',
      type: 'table',
      filter: group('and', [cond('status', 'in', ['pending_approval', 'confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch', 'dispatched', 'delivered', 'installation', 'on_hold'])]),
      sort: [{ field: 'orderDate', dir: 'desc' }],
      columns: cols('orderNo', 'customerId', 'orderKind', 'divisionId', 'grandTotal', 'status', 'orderDate', 'ownerId'),
    },
    {
      id: 'v_so_approval',
      resource: 'salesOrders',
      name: 'Pending approval',
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'pending_approval')]),
      sort: [{ field: 'orderDate', dir: 'asc' }],
      columns: cols('orderNo', 'customerId', 'grandTotal', 'maxDiscountPct', 'changeSummary', 'financeCheck', 'ownerId'),
    },
    {
      id: 'v_so_backlog',
      resource: 'salesOrders',
      name: 'Backlog',
      type: 'table',
      filter: group('and', [cond('status', 'in', ['confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch', 'dispatched', 'delivered', 'installation'])]),
      sort: [{ field: 'orderDate', dir: 'asc' }],
      columns: cols('orderNo', 'customerId', 'grandTotal', 'status', 'shipmentEta', 'machineReady', 'pdiDone', 'orderDate'),
    },
    {
      id: 'v_so_processing',
      resource: 'salesOrders',
      name: 'Processing (SCM)',
      type: 'table',
      filter: group('and', [cond('status', 'in', ['payment_received', 'processing', 'ready_for_dispatch'])]),
      sort: [{ field: 'shipmentEta', dir: 'asc' }],
      columns: cols('orderNo', 'customerId', 'productId', 'poToPrincipalNo', 'shipmentEta', 'customsStatus', 'machineReady', 'pdiDone', 'status'),
    },
    {
      id: 'v_so_board',
      resource: 'salesOrders',
      name: 'Board',
      type: 'board',
      boardField: 'status',
      filter: group('and', [cond('status', 'neq', 'cancelled')]),
      sort: [{ field: 'orderDate', dir: 'desc' }],
      columns: cols('orderNo', 'customerId', 'grandTotal', 'ownerId'),
    },
    {
      id: 'v_so_all',
      resource: 'salesOrders',
      name: 'All',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'orderDate', dir: 'desc' }],
      columns: cols('orderNo', 'customerId', 'orderKind', 'divisionId', 'grandTotal', 'status', 'orderDate', 'invoiceNo', 'ownerId'),
    },
  ]),
};

// ---------------------------------------------------------------- paymentMilestones

const fm = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('paymentMilestones', key, label, type, extra);

const paymentMilestones: ResourceDefinition = {
  id: 'res_paymentMilestones',
  key: 'paymentMilestones',
  module: 'orders',
  label: 'Payment milestone',
  labelPlural: 'Payment milestones',
  icon: 'calendar-clock',
  version: 1,
  idPrefix: 'PM',
  titleField: 'label',
  subtitleFields: ['salesOrderId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: 'Advance, milestone and balance payments per sales order. Receipts come from the ERP (simulated). Edit the schedule from the order’s Payments tab.',
  status: 'published',
  fields: [
    fm('label', 'Milestone', 'text', { required: true, maxLength: 60, capabilities: ALL, width: 200, subFields: ['salesOrderId'] }),
    fm('salesOrderId', 'Sales order', 'relation', { relation: { resource: 'salesOrders' }, required: true, readOnly: true, capabilities: ALL, width: 170 }),
    fm('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, readOnly: true, capabilities: ALL, width: 200 }),
    fm('percent', 'Share', 'number', { readOnly: true, unit: '%', width: 90 }),
    fm('amount', 'Amount', 'money', { required: true, readOnly: true, currency: 'INR', width: 140 }),
    fm('dueDate', 'Due', 'date', { required: true, readOnly: true, width: 120 }),
    fm('receivedAmount', 'Received', 'money', { readOnly: true, currency: 'INR', width: 140 }),
    fm('receivedAt', 'Received on', 'date', { readOnly: true }),
    fm('status', 'Status', 'master', { master: 'milestoneStatus', readOnly: true, width: 140 }),
    fm('ownerId', 'Sales owner', 'relation', { relation: { resource: 'employees' }, readOnly: true, width: 170 }),
    fm('divisionId', 'Division', 'master', { master: 'division', readOnly: true }),
    fm('lastReminderAt', 'Last reminder', 'datetime', { readOnly: true }),
  ],
  relationships: [],
  form: { quickCreate: [], sections: [{ id: 'main', title: 'Milestone', fields: ['label', 'salesOrderId', 'customerId', 'percent', 'amount', 'dueDate', 'receivedAmount', 'receivedAt', 'status', 'ownerId', 'divisionId', 'lastReminderAt'], columns: 2 }] },
  views: views([
    {
      id: 'v_pm_open',
      resource: 'paymentMilestones',
      name: 'Due & overdue',
      type: 'table',
      filter: group('and', [cond('status', 'in', ['due', 'partly_received', 'overdue'])]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: cols('label', 'salesOrderId', 'customerId', 'amount', 'receivedAmount', 'dueDate', 'status', 'ownerId'),
    },
    {
      id: 'v_pm_overdue',
      resource: 'paymentMilestones',
      name: 'Overdue',
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'overdue')]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: cols('label', 'salesOrderId', 'customerId', 'amount', 'receivedAmount', 'dueDate', 'ownerId', 'lastReminderAt'),
    },
    {
      id: 'v_pm_all',
      resource: 'paymentMilestones',
      name: 'All',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'dueDate', dir: 'desc' }],
      columns: cols('label', 'salesOrderId', 'customerId', 'percent', 'amount', 'receivedAmount', 'dueDate', 'status'),
    },
  ]),
};

// ---------------------------------------------------------------- salesContracts

const fc = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('salesContracts', key, label, type, extra);

const salesContracts: ResourceDefinition = {
  id: 'res_salesContracts',
  key: 'salesContracts',
  module: 'orders',
  label: 'Sales contract',
  labelPlural: 'Sales contracts',
  icon: 'scroll-text',
  version: 1,
  idPrefix: 'SC',
  titleField: 'contractNo',
  subtitleFields: ['salesOrderId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: 'Contracts generated from approved sales orders with division terms. Versioned; customers sign electronically (simulated).',
  status: 'published',
  fields: [
    fc('contractNo', 'Contract no.', 'text', { readOnly: true, capabilities: ALL, width: 190, subFields: ['customerId'] }),
    fc('salesOrderId', 'Sales order', 'relation', { relation: { resource: 'salesOrders' }, required: true, readOnly: true, capabilities: ALL, width: 170 }),
    fc('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, readOnly: true, capabilities: ALL, width: 200 }),
    fc('version', 'Version', 'number', { readOnly: true, width: 80 }),
    fc('status', 'Status', 'master', { master: 'contractStatus', readOnly: true, width: 160 }),
    fc('contractValue', 'Contract value', 'money', { readOnly: true, currency: 'INR', width: 150 }),
    fc('paymentTerms', 'Payment', 'longtext', { required: true, maxLength: 1500, capabilities: FORM_ONLY }),
    fc('deliveryTerms', 'Delivery', 'longtext', { required: true, maxLength: 1500, capabilities: FORM_ONLY }),
    fc('loadingTerms', 'Loading / unloading', 'longtext', { maxLength: 1500, capabilities: FORM_ONLY }),
    fc('installationTerms', 'Installation', 'longtext', { maxLength: 1500, capabilities: FORM_ONLY }),
    fc('warrantyTerms', 'Warranty', 'longtext', { maxLength: 1500, capabilities: FORM_ONLY }),
    fc('sparesTerms', 'Spare parts', 'longtext', { maxLength: 1500, capabilities: FORM_ONLY }),
    fc('inkCommitment', 'Ink purchase commitment & prices', 'longtext', { maxLength: 1500, capabilities: FORM_ONLY }),
    fc('amcTerms', 'AMC', 'longtext', { maxLength: 1500, capabilities: FORM_ONLY }),
    fc('sentAt', 'Sent for signature', 'datetime', { readOnly: true }),
    fc('signedAt', 'Signed on', 'datetime', { readOnly: true, capabilities: { list: true, sort: true, filter: true, export: true } }),
    fc('signedBy', 'Signed by', 'text', { readOnly: true }),
    fc('ownerId', 'Sales owner', 'relation', { relation: { resource: 'employees' }, readOnly: true, width: 170 }),
    fc('divisionId', 'Division', 'master', { master: 'division', readOnly: true }),
  ],
  relationships: [],
  form: {
    quickCreate: [],
    sections: [
      { id: 'main', title: 'Contract', fields: ['contractNo', 'salesOrderId', 'customerId', 'version', 'status', 'contractValue', 'ownerId', 'divisionId'], columns: 2 },
      { id: 'terms', title: 'Terms', fields: ['paymentTerms', 'deliveryTerms', 'loadingTerms', 'installationTerms', 'warrantyTerms', 'sparesTerms', 'inkCommitment', 'amcTerms'], columns: 1 },
      { id: 'sign', title: 'Signature', fields: ['sentAt', 'signedAt', 'signedBy'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_sc_all',
      resource: 'salesContracts',
      name: 'Current',
      type: 'table',
      filter: group('and', [cond('status', 'neq', 'superseded')]),
      sort: [{ field: 'contractNo', dir: 'desc' }],
      columns: cols('contractNo', 'salesOrderId', 'customerId', 'version', 'contractValue', 'status', 'signedAt'),
    },
    {
      id: 'v_sc_unsigned',
      resource: 'salesContracts',
      name: 'Awaiting signature',
      type: 'table',
      filter: group('and', [cond('status', 'in', ['draft', 'sent_for_signature'])]),
      sort: [{ field: 'contractNo', dir: 'asc' }],
      columns: cols('contractNo', 'salesOrderId', 'customerId', 'status', 'sentAt', 'ownerId'),
    },
  ]),
};

// ---------------------------------------------------------------- dispatches

const fd = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('dispatches', key, label, type, extra);

const dispatches: ResourceDefinition = {
  id: 'res_dispatches',
  key: 'dispatches',
  module: 'orders',
  label: 'Dispatch',
  labelPlural: 'Dispatches',
  icon: 'send',
  version: 1,
  idPrefix: 'DSP',
  titleField: 'lrNumber',
  subtitleFields: ['salesOrderId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: 'Dispatch and delivery tracking per sales order: transporter, LR, e-way bill, expected vs actual delivery and proof of delivery.',
  status: 'published',
  fields: [
    fd('salesOrderId', 'Sales order', 'relation', { relation: { resource: 'salesOrders' }, required: true, readOnly: true, capabilities: ALL, width: 170, subFields: ['customerId'] }),
    fd('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, readOnly: true, capabilities: ALL, width: 200 }),
    fd('dispatchDate', 'Dispatched on', 'date', { required: true, dateRule: 'past', width: 130 }),
    fd('transporter', 'Transporter', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 170 }),
    fd('lrNumber', 'LR number', 'text', { required: true, maxLength: 40, capabilities: ALL, width: 140 }),
    fd('challanNo', 'Delivery challan', 'text', { maxLength: 40, capabilities: ALL }),
    fd('invoiceRef', 'Invoice ref.', 'text', { maxLength: 40, capabilities: ALL }),
    fd('ewayBill', 'E-way bill no.', 'text', { maxLength: 20, pattern: { regex: '^[0-9]{12}$', message: 'E-way bill numbers have 12 digits' }, capabilities: ALL }),
    fd('expectedDelivery', 'Expected delivery', 'date', { required: true, compare: { op: 'gte', field: 'dispatchDate', message: 'Expected delivery cannot be before dispatch' }, width: 140 }),
    fd('actualDelivery', 'Delivered on', 'date', { readOnly: true, width: 130 }),
    fd('podFileName', 'Signed POD', 'text', { readOnly: true }),
    fd('podPhotoName', 'Delivery photo', 'text', { readOnly: true }),
    fd('status', 'Status', 'master', { master: 'dispatchStatus', readOnly: true, width: 120 }),
    fd('delayDays', 'Delay (days)', 'number', {
      readOnly: true,
      unit: 'days',
      computed: (r) => {
        const until = (r.actualDelivery as string) || todayKey();
        const d = Math.round((new Date(until).getTime() - new Date(String(r.expectedDelivery)).getTime()) / 86_400_000);
        return r.expectedDelivery && d > 0 ? d : 0;
      },
      capabilities: { list: true, sort: false, export: true },
    }),
    fd('ownerId', 'Sales owner', 'relation', { relation: { resource: 'employees' }, readOnly: true, width: 170 }),
    fd('divisionId', 'Division', 'master', { master: 'division', readOnly: true }),
  ],
  relationships: [],
  form: {
    quickCreate: [],
    sections: [
      { id: 'main', title: 'Dispatch', fields: ['salesOrderId', 'customerId', 'dispatchDate', 'transporter', 'lrNumber', 'challanNo', 'invoiceRef', 'ewayBill', 'expectedDelivery'], columns: 2 },
      { id: 'delivery', title: 'Delivery', fields: ['status', 'actualDelivery', 'podFileName', 'podPhotoName', 'delayDays'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_dsp_transit',
      resource: 'dispatches',
      name: 'In transit',
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'in_transit')]),
      sort: [{ field: 'expectedDelivery', dir: 'asc' }],
      columns: cols('salesOrderId', 'customerId', 'transporter', 'lrNumber', 'dispatchDate', 'expectedDelivery', 'delayDays'),
    },
    {
      id: 'v_dsp_delayed',
      resource: 'dispatches',
      name: 'Delayed',
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'in_transit'), cond('expectedDelivery', 'past')]),
      sort: [{ field: 'expectedDelivery', dir: 'asc' }],
      columns: cols('salesOrderId', 'customerId', 'transporter', 'lrNumber', 'expectedDelivery', 'delayDays', 'ownerId'),
    },
    {
      id: 'v_dsp_all',
      resource: 'dispatches',
      name: 'All',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'dispatchDate', dir: 'desc' }],
      columns: cols('salesOrderId', 'customerId', 'transporter', 'lrNumber', 'ewayBill', 'dispatchDate', 'expectedDelivery', 'actualDelivery', 'status'),
    },
  ]),
};

// ---------------------------------------------------------------- permissions (REQUIREMENTS §2.2, "Orders & contracts" / "Dispatch & install")

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
  nav: {
    id: 'orders',
    label: 'Orders',
    icon: 'receipt',
    resources: ['salesOrders', 'paymentMilestones', 'dispatches', 'salesContracts'],
    pages: [{ id: 'payments', label: 'Payments due', icon: 'calendar-clock', path: 'orders/payments' }],
  },
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
    // SCM edits only the processing tab (FR-056); everyone else sees processing read-only.
    scm: viewOnly(NON_PROCESSING),
    division_head: viewOnly(PROCESSING_FIELDS),
    sales_manager: viewOnly(PROCESSING_FIELDS),
    sales_exec: viewOnly(PROCESSING_FIELDS),
    coordinator: viewOnly(PROCESSING_FIELDS),
  },
};
