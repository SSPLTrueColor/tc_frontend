import { quotationLead } from './quotationComputed';
/**
 * Quotations module pack (FR-035 – FR-047): quotations with versions (R0, R1 …), discount approval,
 * Terms & Conditions templates. Line items (`lines`, QuoteLine[]) are stored on the record but hidden from
 * the generic engine — they are edited, priced and shown by the quotations module itself.
 * Sidebar placement lives in src/domain/sidebar.ts; every label comes from L.quotations.
 */
import { L } from '../../constants/labels';
import type { MasterDefinition, MasterValue, ResourceDefinition, Tone } from '../../metadata/types';
import { ALL, cols, cond, field, FORM_ONLY, group, views } from '../helpers';
import { type ModulePack, p } from './types';

const T = L.quotations;
const F = T.fields.quotations;
const FT = T.fields.termsTemplates;
const SEL = T.selection.fields;
const v = (key: string, label: string, tone: Tone = 'neutral'): Omit<MasterValue, 'order'> => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[]): MasterDefinition => ({ id: `mst_${key}`, key, label, version: 1, values: values.map((x, i) => ({ ...x, order: i })) });

export const QUOTE_STATUS = ['draft', 'pending_approval', 'approved', 'sent', 'negotiation', 'accepted', 'rejected', 'expired', 'superseded', 'not_selected'] as const;
/** Statuses that can still change (BR-18 / FR-044). */
export const OPEN_QUOTE_STATUS = ['draft', 'pending_approval', 'approved', 'sent', 'negotiation'];

const S = T.masters.quoteStatus.values;
const LT = T.masters.quoteLineType.values;
const masters: MasterDefinition[] = [
  master('quoteStatus', T.masters.quoteStatus.label, [
    v('draft', S.draft),
    v('pending_approval', S.pending_approval, 'warning'),
    v('approved', S.approved, 'success'),
    v('sent', S.sent, 'accent'),
    v('negotiation', S.negotiation, 'warning'),
    v('accepted', S.accepted, 'success'),
    v('rejected', S.rejected, 'danger'),
    v('expired', S.expired),
    v('superseded', S.superseded),
    v('not_selected', S.not_selected),
  ]),
  master('quoteReviewStage', T.masters.quoteReviewStage.label, [
    v('draft', S.draft), v('under_revision', T.masters.quoteReviewStage.underRevision, 'warning'),
    v('pending_approval', S.pending_approval, 'warning'), v('approved', S.approved, 'success'),
    v('sent', S.sent, 'info'), v('negotiation', S.negotiation, 'warning'),
    v('accepted', S.accepted, 'success'), v('rejected', S.rejected, 'danger'), v('expired', S.expired),
    v('not_selected', S.not_selected),
  ]),
  master('quoteLineType', T.masters.quoteLineType.label, [
    v('machine', LT.machine, 'accent'),
    v('configuration', LT.configuration),
    v('accessory', LT.accessory),
    v('software', LT.software),
    v('ink', LT.ink),
    v('consumable', LT.consumable),
    v('spares_kit', LT.spares_kit),
    v('installation', LT.installation),
    v('training', LT.training),
    v('extended_warranty', LT.extended_warranty),
    v('amc', LT.amc),
    v('other', LT.other),
  ]),
  master('acceptanceMethod', T.masters.acceptanceMethod.label, [v('po', T.masters.acceptanceMethod.values.po, 'success'), v('electronic', T.masters.acceptanceMethod.values.electronic, 'info')]),
  master('termsStatus', T.masters.termsStatus.label, [v('active', T.masters.termsStatus.values.active, 'success'), v('inactive', T.masters.termsStatus.values.inactive)]),
];

const fq = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('quotations', key, label, type, extra);
const money = (key: string, label: string, extra?: Parameters<typeof field>[4]) => fq(key, label, 'money', { readOnly: true, currency: 'INR', min: 0, ...extra });
const READ = { list: true, sort: true, filter: true, export: true };

export const quotations: ResourceDefinition = {
  id: 'res_quotations',
  key: 'quotations',
  module: 'quotations',
  label: T.records.quotations.one,
  labelPlural: T.records.quotations.many,
  icon: 'receipt',
  version: 1,
  idPrefix: 'QT',
  idFormat: 'fy',
  titleField: 'quoteNo',
  subtitleFields: ['customerId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: T.resources.quotations.description,
  status: 'published',
  fields: [
    fq('quoteNo', F.quoteNo, 'text', { readOnly: true, capabilities: ALL, width: 190, subFields: ['customerId'] }),
    fq('opportunityId', F.opportunityId, 'relation', { required: true, relation: { resource: 'opportunities' }, capabilities: ALL, width: 200 }),
    fq('customerId', F.customerId, 'relation', { required: true, relation: { resource: 'customers' }, capabilities: ALL, width: 220 }),
    fq('contactId', F.contactId, 'relation', { relation: { resource: 'contacts', filterBy: { field: 'customerId', fromField: 'customerId' } }, width: 170 }),
    fq('divisionId', F.divisionId, 'master', { master: 'division', required: true, width: 150 }),
    fq('ownerId', F.ownerId, 'relation', { required: true, relation: { resource: 'employees', where: { field: 'status', op: 'neq', value: 'inactive' } }, width: 170, display: 'person', personSubtitle: 'designation' }),
    fq('quoteDate', F.quoteDate, 'date', { required: true, width: 120 }),
    fq('validUntil', F.validUntil, 'date', { required: true, width: 120, compare: { op: 'gte', field: 'quoteDate', message: F.validUntilCompare } }),
    fq('placeOfSupply', F.placeOfSupply, 'master', { master: 'state', required: true, width: 150, help: F.placeOfSupplyHelp }),
    fq('status', F.status, 'master', { master: 'quoteStatus', readOnly: true, width: 150 }),
    fq('reviewStage', T.masters.quoteReviewStage.field, 'master', { master: 'quoteReviewStage', readOnly: true, computed: (r) => r.status === 'draft' && Number(r.revision) > 0 ? 'under_revision' : r.status, width: 170 }),
    fq('leadId', 'Lead', 'relation', { relation: { resource: 'leads' }, readOnly: true, computed: quotationLead, width: 170 }),
    fq('revision', F.revision, 'number', { readOnly: true, min: 0, width: 90 }),
    fq('isLatest', F.isLatest, 'boolean', { readOnly: true, capabilities: { filter: true, export: true } }),
    fq('rootId', F.rootId, 'text', { system: true, readOnly: true, capabilities: { filter: true } }),
    fq('revisionNote', F.revisionNote, 'text', { readOnly: true, maxLength: 300, capabilities: { list: true, search: true, export: true } }),
    // Line items: stored here, hidden from the generic engine, shown in the "Line Items" tab.
    fq('lines', F.lines, 'lineitems', { readOnly: true, capabilities: { export: true } }),
    money('subtotal', F.subtotal),
    money('discountTotal', F.discountTotal),
    fq('freight', F.freight, 'money', { currency: 'INR', min: 0, defaultValue: 0 }),
    fq('insurance', F.insurance, 'money', { currency: 'INR', min: 0, defaultValue: 0 }),
    money('taxable', F.taxable),
    money('cgst', F.cgst),
    money('sgst', F.sgst),
    money('igst', F.igst),
    money('grandTotal', F.grandTotal, { capabilities: { ...READ, list: true }, width: 150 }),
    fq('amountInWords', F.amountInWords, 'text', { readOnly: true, capabilities: { export: true } }),
    fq('maxDiscountPct', F.maxDiscountPct, 'number', { readOnly: true, unit: '%', width: 110 }),
    money('landedCostTotal', F.landedCostTotal, { sensitivity: 'financial' }),
    fq('marginPct', F.marginPct, 'number', { readOnly: true, unit: '%', sensitivity: 'financial', width: 100 }),
    fq('termsTemplateId', F.termsTemplateId, 'relation', { relation: { resource: 'termsTemplates', filterBy: { field: 'divisionId', fromField: 'divisionId' } } }),
    fq('paymentTerms', F.paymentTerms, 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fq('deliveryTerms', F.deliveryTerms, 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fq('warrantyTerms', F.warrantyTerms, 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fq('installationTerms', F.installationTerms, 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fq('sentAt', F.sentAt, 'datetime', { readOnly: true }),
    fq('sentVia', F.sentVia, 'text', { readOnly: true, capabilities: { export: true } }),
    fq('acceptanceMethod', F.acceptanceMethod, 'master', { master: 'acceptanceMethod', readOnly: true }),
    fq('acceptedAt', F.acceptedAt, 'datetime', { readOnly: true }),
    fq('acceptedByName', F.acceptedByName, 'text', { readOnly: true }),
    fq('customerPoNo', F.customerPoNo, 'text', { readOnly: true, capabilities: { list: true, search: true, export: true } }),
    fq('customerPoDate', F.customerPoDate, 'date', { readOnly: true }),
    fq('poFileName', F.poFileName, 'text', { readOnly: true }),
    fq('rejectReason', F.rejectReason, 'master', { master: 'lostReason', readOnly: true }),
    fq('rejectNote', F.rejectNote, 'text', { readOnly: true }),
    // Quotation selection: set when another quotation of the opportunity is accepted / ordered, or the opportunity is lost.
    fq('notSelectedAt', SEL.notSelectedAt, 'datetime', { readOnly: true }),
    fq('notSelectedReason', SEL.notSelectedReason, 'text', { readOnly: true, capabilities: { export: true } }),
    fq('selectedQuotationId', SEL.selectedQuotationId, 'relation', { relation: { resource: 'quotations' }, readOnly: true }),
    fq('previousStatus', SEL.previousStatus, 'master', { master: 'quoteStatus', system: true, readOnly: true }),
    // FR-047 ROI / payback calculator inputs (editable in any status).
    fq('roiOutputPerDay', F.roiOutputPerDay, 'number', { min: 0, unit: F.roiOutputUnit, capabilities: { export: true } }),
    fq('roiPricePerUnit', F.roiPricePerUnit, 'money', { min: 0, currency: 'INR', capabilities: { export: true } }),
    fq('roiCostPerUnit', F.roiCostPerUnit, 'money', { min: 0, currency: 'INR', capabilities: { export: true } }),
    fq('roiWorkingDays', F.roiWorkingDays, 'number', { min: 1, max: 31, capabilities: { export: true } }),
  ],
  relationships: [],
  form: {
    fullPage: true,
    quickCreate: ['opportunityId', 'quoteDate', 'validUntil', 'placeOfSupply'],
    sections: [
      { id: 'header', title: T.sections.quotations.header, fields: ['quoteNo', 'leadId', 'opportunityId', 'customerId', 'contactId', 'divisionId', 'ownerId', 'quoteDate', 'validUntil', 'placeOfSupply'], columns: 2 },
      { id: 'value', title: T.sections.quotations.value, fields: ['subtotal', 'discountTotal', 'freight', 'insurance', 'taxable', 'cgst', 'sgst', 'igst', 'grandTotal', 'amountInWords', 'maxDiscountPct', 'landedCostTotal', 'marginPct'], columns: 2 },
      { id: 'terms', title: T.sections.quotations.terms, fields: ['termsTemplateId', 'paymentTerms', 'deliveryTerms', 'warrantyTerms', 'installationTerms'], columns: 2 },
      { id: 'outcome', title: T.sections.quotations.outcome, fields: ['sentAt', 'sentVia', 'acceptanceMethod', 'acceptedAt', 'acceptedByName', 'customerPoNo', 'customerPoDate', 'poFileName', 'rejectReason', 'rejectNote', 'notSelectedAt', 'notSelectedReason', 'selectedQuotationId'], columns: 2 },
    ],
  },
  lifecycle: {
    field: 'status',
    initial: 'draft',
    terminal: ['accepted', 'rejected', 'expired', 'superseded', 'not_selected'],
    // Only the plain step is a lifecycle button; submit/send/accept/reject/new version need data and run through the quotations service.
    // Mark as Sent records a quotation shared outside the CRM (no message); Send Quotation still sends + logs it.
    transitions: [
      { from: ['approved'], to: 'sent', action: T.lifecycle.markSent },
      { from: ['sent'], to: 'negotiation', action: T.lifecycle.markNegotiation },
    ],
  },
  views: views([
    {
      id: 'v_quotes_open',
      resource: 'quotations',
      name: T.views.open,
      type: 'table',
      filter: group('and', [cond('isLatest', 'eq', true), cond('status', 'in', OPEN_QUOTE_STATUS)]),
      sort: [{ field: 'quoteDate', dir: 'desc' }],
      columns: cols('quoteNo', 'leadId', 'customerId', 'divisionId', 'ownerId', 'quoteDate', 'validUntil', 'grandTotal', 'maxDiscountPct', 'status'),
    },
    {
      id: 'v_quotes_approval',
      resource: 'quotations',
      name: T.views.pendingApproval,
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'pending_approval')]),
      sort: [{ field: 'quoteDate', dir: 'asc' }],
      columns: cols('quoteNo', 'leadId', 'customerId', 'ownerId', 'grandTotal', 'maxDiscountPct', 'quoteDate', 'status'),
    },
    {
      id: 'v_quotes_expiring',
      resource: 'quotations',
      name: T.views.expiring,
      type: 'table',
      filter: group('and', [cond('isLatest', 'eq', true), cond('status', 'in', ['approved', 'sent', 'negotiation']), cond('validUntil', 'next7')]),
      sort: [{ field: 'validUntil', dir: 'asc' }],
      columns: cols('quoteNo', 'leadId', 'customerId', 'ownerId', 'validUntil', 'grandTotal', 'status'),
    },
    {
      id: 'v_quotes_board',
      resource: 'quotations',
      name: T.views.board,
      type: 'board',
      boardField: 'reviewStage',
      filter: group('and', [cond('isLatest', 'eq', true)]),
      sort: [{ field: 'quoteDate', dir: 'desc' }],
      columns: cols('quoteNo', 'leadId', 'customerId', 'grandTotal', 'validUntil'),
    },
    {
      id: 'v_quotes_all',
      resource: 'quotations',
      name: 'All quotations',
      type: 'table',
      filter: group('and', [cond('isLatest', 'eq', true)]),
      sort: [{ field: 'quoteDate', dir: 'desc' }],
      columns: cols('quoteNo', 'revision', 'customerId', 'divisionId', 'ownerId', 'quoteDate', 'grandTotal', 'status', 'isLatest'),
    },
  ]),
};

const ft = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('termsTemplates', key, label, type, extra);

/** QUO-07: Terms & Conditions templates per division (filled into quotations, editable within permissions). */
export const termsTemplates: ResourceDefinition = {
  id: 'res_termsTemplates',
  key: 'termsTemplates',
  module: 'quotations',
  label: T.records.termsTemplates.one,
  labelPlural: T.records.termsTemplates.many,
  icon: 'scroll-text',
  version: 1,
  idPrefix: 'TT',
  titleField: 'name',
  subtitleFields: ['divisionId', 'status'],
  divisionField: 'divisionId',
  description: T.resources.termsTemplates.description,
  status: 'published',
  fields: [
    ft('name', FT.name, 'text', { required: true, maxLength: 80, capabilities: ALL, width: 240 }),
    ft('divisionId', FT.divisionId, 'master', { master: 'division', required: true, width: 160 }),
    ft('isDefault', FT.isDefault, 'boolean', { defaultValue: false }),
    ft('status', FT.status, 'master', { master: 'termsStatus', required: true, defaultValue: 'active' }),
    ft('paymentTerms', FT.paymentTerms, 'longtext', { required: true, maxLength: 1000, capabilities: { ...FORM_ONLY, search: true } }),
    ft('deliveryTerms', FT.deliveryTerms, 'longtext', { required: true, maxLength: 1000, capabilities: FORM_ONLY }),
    ft('warrantyTerms', FT.warrantyTerms, 'longtext', { required: true, maxLength: 1000, capabilities: FORM_ONLY }),
    ft('installationTerms', FT.installationTerms, 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
  ],
  relationships: [{ id: 'rel_tt_quotes', label: T.relationships.quotations, resource: 'quotations', foreignKey: 'termsTemplateId' }],
  form: {
    quickCreate: ['name', 'divisionId', 'isDefault', 'paymentTerms', 'deliveryTerms', 'warrantyTerms', 'installationTerms'],
    sections: [
      { id: 'main', title: T.sections.termsTemplates.main, fields: ['name', 'divisionId', 'isDefault', 'status'], columns: 2 },
      { id: 'terms', title: T.sections.termsTemplates.terms, fields: ['paymentTerms', 'deliveryTerms', 'warrantyTerms', 'installationTerms'], columns: 2 },
    ],
  },
  views: views([
    { id: 'v_tt_all', resource: 'termsTemplates', name: T.views.allTemplates, type: 'table', filter: group('and'), sort: [{ field: 'divisionId', dir: 'asc' }], columns: cols('name', 'divisionId', 'isDefault', 'status') },
  ]),
};


export const quotationsPack: ModulePack = {
  id: 'quotations',
  resources: [quotations, termsTemplates],
  masters,
  // REQUIREMENTS §2.2 (proposed matrix). Approvals use capabilities approve.l1/l2/l3.
  permissions: {
    admin: { quotations: p('all', 'all', true, true, true), termsTemplates: p('all', 'all', true, true, true) },
    management: { quotations: p('all', 'none', false, false, true), termsTemplates: p('all') },
    division_head: { quotations: p('division', 'division', true, false, true), termsTemplates: p('division', 'division', true, false, false) },
    sales_manager: { quotations: p('team', 'team', true, false, true), termsTemplates: p('all') },
    sales_exec: { quotations: p('own', 'own', true), termsTemplates: p('all') },
    service_head: { quotations: p('all', 'own', true), termsTemplates: p('all') }, // App. B: Service Head raises service quotes (CEV)
    coordinator: { quotations: p('division'), termsTemplates: p('all') },
    scm: { quotations: p('all') },
    accounts: { quotations: p('all', 'none', false, false, true), termsTemplates: p('all') },
  },
};
