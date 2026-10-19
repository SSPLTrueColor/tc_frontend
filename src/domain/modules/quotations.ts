/**
 * Quotations module pack (FR-035 – FR-047): quotations with revisions, discount approval,
 * terms templates. Line items (`lines`, QuoteLine[]) are stored on the record but hidden from
 * the generic engine — they are edited, priced and shown by the quotations module itself.
 */
import type { MasterDefinition, MasterValue, ResourceDefinition, Tone } from '../../metadata/types';
import { ALL, cols, cond, field, FORM_ONLY, group, views } from '../helpers';
import { type ModulePack, p } from './types';

const v = (key: string, label: string, tone: Tone = 'neutral'): Omit<MasterValue, 'order'> => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[]): MasterDefinition => ({ id: `mst_${key}`, key, label, version: 1, values: values.map((x, i) => ({ ...x, order: i })) });

export const QUOTE_STATUS = ['draft', 'pending_approval', 'approved', 'sent', 'negotiation', 'accepted', 'rejected', 'expired', 'superseded'] as const;
/** Statuses that can still change (BR-18 / FR-044). */
export const OPEN_QUOTE_STATUS = ['draft', 'pending_approval', 'approved', 'sent', 'negotiation'];

const masters: MasterDefinition[] = [
  master('quoteStatus', 'Quotation status', [
    v('draft', 'Draft'),
    v('pending_approval', 'Pending approval', 'warning'),
    v('approved', 'Approved', 'info'),
    v('sent', 'Sent', 'accent'),
    v('negotiation', 'Under negotiation', 'warning'),
    v('accepted', 'Accepted', 'success'),
    v('rejected', 'Rejected', 'danger'),
    v('expired', 'Expired'),
    v('superseded', 'Superseded'),
  ]),
  master('quoteLineType', 'Quotation line type', [
    v('machine', 'Machine', 'accent'),
    v('configuration', 'Configuration / option'),
    v('accessory', 'Accessory'),
    v('software', 'Software (RIP)'),
    v('ink', 'Ink'),
    v('consumable', 'Consumables'),
    v('spares_kit', 'Spare-parts kit'),
    v('installation', 'Installation'),
    v('training', 'Training'),
    v('extended_warranty', 'Extended warranty'),
    v('amc', 'AMC'),
    v('other', 'Other'),
  ]),
  master('acceptanceMethod', 'Acceptance method', [v('po', 'Customer PO upload', 'success'), v('electronic', 'Electronic acceptance', 'info')]),
  master('termsStatus', 'Template status', [v('active', 'Active', 'success'), v('inactive', 'Inactive')]),
];

const fq = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('quotations', key, label, type, extra);
const money = (key: string, label: string, extra?: Parameters<typeof field>[4]) => fq(key, label, 'money', { readOnly: true, currency: 'INR', min: 0, ...extra });
const READ = { list: true, sort: true, filter: true, export: true };

export const quotations: ResourceDefinition = {
  id: 'res_quotations',
  key: 'quotations',
  module: 'quotations',
  label: 'Quotation',
  labelPlural: 'Quotations',
  icon: 'receipt',
  version: 1,
  idPrefix: 'QT',
  idFormat: 'fy',
  titleField: 'quoteNo',
  subtitleFields: ['customerId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: 'Commercial quotations with controlled price lists, discount approval, revisions (R0, R1 …) and customer acceptance.',
  status: 'published',
  fields: [
    fq('quoteNo', 'Quotation no.', 'text', { readOnly: true, capabilities: ALL, width: 190, subFields: ['customerId'] }),
    fq('opportunityId', 'Opportunity', 'relation', { required: true, relation: { resource: 'opportunities' }, capabilities: ALL, width: 200 }),
    fq('customerId', 'Customer', 'relation', { required: true, relation: { resource: 'customers' }, capabilities: ALL, width: 220 }),
    fq('contactId', 'Contact person', 'relation', { relation: { resource: 'contacts', filterBy: { field: 'customerId', fromField: 'customerId' } }, width: 170 }),
    fq('divisionId', 'Division', 'master', { master: 'division', required: true, width: 150 }),
    fq('ownerId', 'Sales executive', 'relation', { required: true, relation: { resource: 'employees', where: { field: 'status', op: 'neq', value: 'inactive' } }, width: 170, display: 'person', personSubtitle: 'designation' }),
    fq('quoteDate', 'Quotation date', 'date', { required: true, width: 120 }),
    fq('validUntil', 'Valid until', 'date', { required: true, width: 120, compare: { op: 'gte', field: 'quoteDate', message: 'Validity must end on or after the quotation date' } }),
    fq('placeOfSupply', 'Place of supply', 'master', { master: 'state', required: true, width: 150, help: 'Same state as True Colors’ GST registration → CGST + SGST; otherwise IGST.' }),
    fq('status', 'Status', 'master', { master: 'quoteStatus', readOnly: true, width: 150 }),
    fq('revision', 'Revision', 'number', { readOnly: true, min: 0, width: 90 }),
    fq('isLatest', 'Latest revision', 'boolean', { readOnly: true, capabilities: { filter: true, export: true } }),
    fq('rootId', 'First revision', 'text', { system: true, readOnly: true, capabilities: { filter: true } }),
    fq('revisionNote', 'Revision note', 'text', { readOnly: true, maxLength: 300, capabilities: { list: true, search: true, export: true } }),
    // Line items: stored here, hidden from the generic engine (fieldOverrides below), shown in the "Lines" tab.
    fq('lines', 'Line items', 'lineitems', { readOnly: true, capabilities: { export: true } }),
    money('subtotal', 'Gross value'),
    money('discountTotal', 'Discount'),
    fq('freight', 'Freight', 'money', { currency: 'INR', min: 0, defaultValue: 0 }),
    fq('insurance', 'Insurance', 'money', { currency: 'INR', min: 0, defaultValue: 0 }),
    money('taxable', 'Taxable value'),
    money('cgst', 'CGST'),
    money('sgst', 'SGST'),
    money('igst', 'IGST'),
    money('grandTotal', 'Total value', { capabilities: { ...READ, list: true }, width: 150 }),
    fq('amountInWords', 'Amount in words', 'text', { readOnly: true, capabilities: { export: true } }),
    fq('maxDiscountPct', 'Highest discount %', 'number', { readOnly: true, unit: '%', width: 110 }),
    money('landedCostTotal', 'Landed cost', { sensitivity: 'financial' }),
    fq('marginPct', 'Margin %', 'number', { readOnly: true, unit: '%', sensitivity: 'financial', width: 100 }),
    fq('termsTemplateId', 'Terms template', 'relation', { relation: { resource: 'termsTemplates', filterBy: { field: 'divisionId', fromField: 'divisionId' } } }),
    fq('paymentTerms', 'Payment terms', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fq('deliveryTerms', 'Delivery timeline', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fq('warrantyTerms', 'Warranty', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fq('installationTerms', 'Installation terms', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fq('sentAt', 'Sent on', 'datetime', { readOnly: true }),
    fq('sentVia', 'Sent via', 'text', { readOnly: true, capabilities: { export: true } }),
    fq('acceptanceMethod', 'Accepted by', 'master', { master: 'acceptanceMethod', readOnly: true }),
    fq('acceptedAt', 'Accepted on', 'datetime', { readOnly: true }),
    fq('acceptedByName', 'Accepted by (customer)', 'text', { readOnly: true }),
    fq('customerPoNo', 'Customer PO no.', 'text', { readOnly: true, capabilities: { list: true, search: true, export: true } }),
    fq('customerPoDate', 'Customer PO date', 'date', { readOnly: true }),
    fq('poFileName', 'PO copy', 'text', { readOnly: true }),
    fq('rejectReason', 'Rejection reason', 'master', { master: 'lostReason', readOnly: true }),
    fq('rejectNote', 'Rejection / approval note', 'text', { readOnly: true }),
    // FR-047 ROI / payback calculator inputs (editable in any status).
    fq('roiOutputPerDay', 'Production per day', 'number', { min: 0, unit: 'm / prints', capabilities: { export: true } }),
    fq('roiPricePerUnit', 'Selling price per unit', 'money', { min: 0, currency: 'INR', capabilities: { export: true } }),
    fq('roiCostPerUnit', 'Running cost per unit', 'money', { min: 0, currency: 'INR', capabilities: { export: true } }),
    fq('roiWorkingDays', 'Working days per month', 'number', { min: 1, max: 31, capabilities: { export: true } }),
  ],
  relationships: [],
  form: {
    fullPage: true,
    quickCreate: ['opportunityId', 'quoteDate', 'validUntil', 'placeOfSupply'],
    sections: [
      { id: 'header', title: 'Quotation', fields: ['quoteNo', 'opportunityId', 'customerId', 'contactId', 'divisionId', 'ownerId', 'quoteDate', 'validUntil', 'placeOfSupply'], columns: 2 },
      { id: 'value', title: 'Value', fields: ['subtotal', 'discountTotal', 'freight', 'insurance', 'taxable', 'cgst', 'sgst', 'igst', 'grandTotal', 'amountInWords', 'maxDiscountPct', 'landedCostTotal', 'marginPct'], columns: 2 },
      { id: 'terms', title: 'Commercial terms', fields: ['termsTemplateId', 'paymentTerms', 'deliveryTerms', 'warrantyTerms', 'installationTerms'], columns: 2 },
      { id: 'outcome', title: 'Outcome', fields: ['sentAt', 'sentVia', 'acceptanceMethod', 'acceptedAt', 'acceptedByName', 'customerPoNo', 'customerPoDate', 'poFileName', 'rejectReason', 'rejectNote'], columns: 2 },
    ],
  },
  lifecycle: {
    field: 'status',
    initial: 'draft',
    terminal: ['accepted', 'rejected', 'expired', 'superseded'],
    // Only the plain step is a lifecycle button; submit/send/accept/reject/revise need data and run through the quotations service.
    transitions: [{ from: ['sent'], to: 'negotiation', action: 'Mark under negotiation' }],
  },
  views: views([
    {
      id: 'v_quotes_open',
      resource: 'quotations',
      name: 'Open',
      type: 'table',
      filter: group('and', [cond('isLatest', 'eq', true), cond('status', 'in', OPEN_QUOTE_STATUS)]),
      sort: [{ field: 'quoteDate', dir: 'desc' }],
      columns: cols('quoteNo', 'customerId', 'divisionId', 'ownerId', 'quoteDate', 'validUntil', 'grandTotal', 'maxDiscountPct', 'status'),
    },
    {
      id: 'v_quotes_approval',
      resource: 'quotations',
      name: 'Pending approval',
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'pending_approval')]),
      sort: [{ field: 'quoteDate', dir: 'asc' }],
      columns: cols('quoteNo', 'customerId', 'ownerId', 'grandTotal', 'maxDiscountPct', 'quoteDate', 'status'),
    },
    {
      id: 'v_quotes_expiring',
      resource: 'quotations',
      name: 'Expiring in 7 days',
      type: 'table',
      filter: group('and', [cond('isLatest', 'eq', true), cond('status', 'in', ['approved', 'sent', 'negotiation']), cond('validUntil', 'next7')]),
      sort: [{ field: 'validUntil', dir: 'asc' }],
      columns: cols('quoteNo', 'customerId', 'ownerId', 'validUntil', 'grandTotal', 'status'),
    },
    {
      id: 'v_quotes_board',
      resource: 'quotations',
      name: 'Board',
      type: 'board',
      boardField: 'status',
      filter: group('and', [cond('isLatest', 'eq', true)]),
      sort: [{ field: 'quoteDate', dir: 'desc' }],
      columns: cols('quoteNo', 'customerId', 'grandTotal', 'validUntil'),
    },
    {
      id: 'v_quotes_all',
      resource: 'quotations',
      name: 'All revisions',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'quoteDate', dir: 'desc' }],
      columns: cols('quoteNo', 'revision', 'customerId', 'divisionId', 'ownerId', 'quoteDate', 'grandTotal', 'status', 'isLatest'),
    },
  ]),
};

const ft = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('termsTemplates', key, label, type, extra);

/** QUO-07: commercial terms templates per division (filled into quotations, editable within permissions). */
export const termsTemplates: ResourceDefinition = {
  id: 'res_termsTemplates',
  key: 'termsTemplates',
  module: 'quotations',
  label: 'Terms template',
  labelPlural: 'Terms templates',
  icon: 'scroll-text',
  version: 1,
  idPrefix: 'TT',
  titleField: 'name',
  subtitleFields: ['divisionId', 'status'],
  divisionField: 'divisionId',
  description: 'Standard payment, delivery, warranty and installation terms per division. Picked when preparing a quotation.',
  status: 'published',
  fields: [
    ft('name', 'Name', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 240 }),
    ft('divisionId', 'Division', 'master', { master: 'division', required: true, width: 160 }),
    ft('isDefault', 'Default for division', 'boolean', { defaultValue: false }),
    ft('status', 'Status', 'master', { master: 'termsStatus', required: true, defaultValue: 'active' }),
    ft('paymentTerms', 'Payment terms', 'longtext', { required: true, maxLength: 1000, capabilities: { ...FORM_ONLY, search: true } }),
    ft('deliveryTerms', 'Delivery timeline', 'longtext', { required: true, maxLength: 1000, capabilities: FORM_ONLY }),
    ft('warrantyTerms', 'Warranty', 'longtext', { required: true, maxLength: 1000, capabilities: FORM_ONLY }),
    ft('installationTerms', 'Installation terms', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
  ],
  relationships: [{ id: 'rel_tt_quotes', label: 'Quotations', resource: 'quotations', foreignKey: 'termsTemplateId' }],
  form: {
    quickCreate: ['name', 'divisionId', 'isDefault', 'paymentTerms', 'deliveryTerms', 'warrantyTerms', 'installationTerms'],
    sections: [
      { id: 'main', title: 'Template', fields: ['name', 'divisionId', 'isDefault', 'status'], columns: 2 },
      { id: 'terms', title: 'Terms', fields: ['paymentTerms', 'deliveryTerms', 'warrantyTerms', 'installationTerms'], columns: 2 },
    ],
  },
  views: views([
    { id: 'v_tt_all', resource: 'termsTemplates', name: 'All templates', type: 'table', filter: group('and'), sort: [{ field: 'divisionId', dir: 'asc' }], columns: cols('name', 'divisionId', 'isDefault', 'status') },
  ]),
};


export const quotationsPack: ModulePack = {
  id: 'quotations',
  nav: { id: 'quotations', label: 'Quotations', icon: 'file-text', resources: ['quotations', 'termsTemplates'] },
  resources: [quotations, termsTemplates],
  masters,
  // REQUIREMENTS §2.2 (proposed matrix). Approvals use capabilities approve.l1/l2/l3.
  permissions: {
    admin: { quotations: p('all', 'all', true, true, true), termsTemplates: p('all', 'all', true, true, true) },
    management: { quotations: p('all', 'none', false, false, true), termsTemplates: p('all') },
    division_head: { quotations: p('division', 'division', true, false, true), termsTemplates: p('division', 'division', true, false, false) },
    sales_manager: { quotations: p('team', 'team', true, false, true), termsTemplates: p('all') },
    sales_exec: { quotations: p('own', 'own', true), termsTemplates: p('all') },
    service_head: { quotations: p('all'), termsTemplates: p('all') },
    coordinator: { quotations: p('division'), termsTemplates: p('all') },
    scm: { quotations: p('all') },
    accounts: { quotations: p('all', 'none', false, false, true), termsTemplates: p('all') },
  },
};
