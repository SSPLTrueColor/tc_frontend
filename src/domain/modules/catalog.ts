/**
 * Catalog module: product master, price lists (FR-036, FR-039) and notification templates (FR-124),
 * plus the administration configuration pages (organisation, policies, import/export, recycle bin,
 * integrations) added to the Administration nav.
 */
import type { MasterDefinition, MasterValue, ResourceDefinition, Tone } from '../../metadata/types';
import { ALL, cols, cond, field, FORM_ONLY, group, NO_SEARCH, views } from '../helpers';
import { p, type ModulePack } from './types';

const v = (key: string, label: string, tone: Tone = 'neutral'): Omit<MasterValue, 'order'> => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[]): MasterDefinition => ({ id: `mst_${key}`, key, label, version: 1, values: values.map((x, i) => ({ ...x, order: i })) });

const masters: MasterDefinition[] = [
  master('productStatus', 'Product status', [v('active', 'Active', 'success'), v('inactive', 'Inactive')]),
  master('priceListStatus', 'Price list status', [v('draft', 'Draft', 'info'), v('active', 'Active', 'success'), v('expired', 'Expired')]),
  master('gstRate', 'GST rate', [v('0', '0%'), v('5', '5%'), v('12', '12%'), v('18', '18%'), v('28', '28%')]),
  master('uom', 'Unit of measure', [v('nos', 'Nos'), v('litre', 'Litre'), v('kg', 'Kg'), v('roll', 'Roll'), v('metre', 'Metre'), v('ream', 'Ream'), v('visit', 'Visit'), v('year', 'Year'), v('licence', 'Licence')]),
  master('notificationChannel', 'Channel', [v('email', 'Email', 'info'), v('whatsapp', 'WhatsApp', 'success'), v('sms', 'SMS'), v('in_app', 'In-app / push', 'accent')]),
  master('notificationEvent', 'Event', [
    v('lead_assigned', 'Lead assigned'),
    v('followup_due', 'Follow-up due'),
    v('lead_not_attended', 'Lead not attended (SLA)'),
    v('approval_requested', 'Approval requested'),
    v('approval_decided', 'Approval decided'),
    v('quotation_sent', 'Quotation sent'),
    v('payment_due', 'Payment due'),
    v('dispatch_intimation', 'Dispatch intimation'),
    v('installation_scheduled', 'Installation scheduled'),
    v('ticket_logged', 'Ticket logged'),
    v('sla_breach', 'SLA breach'),
    v('feedback_request', 'Feedback request'),
    v('renewal_reminder', 'AMC / warranty renewal reminder'),
  ]),
  master('templateStatus', 'Template status', [v('active', 'Active', 'success'), v('inactive', 'Inactive')]),
];

const fp = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('products', key, label, type, extra);
const fl = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('priceLists', key, label, type, extra);
const fi = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('priceListItems', key, label, type, extra);
const fn = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('notificationTemplates', key, label, type, extra);

export const products: ResourceDefinition = {
  id: 'res_products',
  key: 'products',
  module: 'catalog',
  label: 'Product',
  labelPlural: 'Products',
  icon: 'blocks',
  version: 1,
  idPrefix: 'PRD',
  titleField: 'name',
  subtitleFields: ['sku', 'status'],
  divisionField: 'divisionId',
  description: 'Machines, consumables, spares, software and service lines that can be quoted. Prices come from price lists.',
  status: 'published',
  fields: [
    fp('name', 'Product name', 'text', { required: true, maxLength: 120, capabilities: ALL, width: 280, subFields: ['model'] }),
    fp('sku', 'SKU / item code', 'identifier', { required: true, maxLength: 30, capabilities: ALL, width: 150, pattern: { regex: '^[A-Z0-9][A-Z0-9-/]{2,29}$', message: 'Use capitals, digits, - or / (3–30 characters)' } }),
    fp('divisionId', 'Division', 'master', { master: 'division', required: true, width: 160 }),
    fp('productType', 'Product type', 'master', { master: 'productType', required: true, width: 130 }),
    fp('subType', 'Sub-type', 'master', { master: 'productSubType', width: 110 }),
    fp('model', 'Model', 'text', { maxLength: 60, capabilities: ALL }),
    fp('hsnSac', 'HSN / SAC', 'identifier', { required: true, format: 'hsnSac', width: 110 }),
    fp('gstRate', 'GST %', 'number', { required: true, min: 0, max: 28, unit: '%', defaultValue: 18, width: 90, help: 'One of 0, 5, 12, 18 or 28.' }),
    fp('uom', 'Unit', 'master', { master: 'uom', defaultValue: 'nos', width: 90 }),
    fp('warrantyMonths', 'Warranty', 'number', { min: 0, max: 60, unit: 'months', help: 'Used for the warranty created at installation sign-off. Empty = policy default.' }),
    fp('printWidth', 'Printing width', 'text', { maxLength: 30, visibleWhen: { field: 'productType', op: 'eq', value: 'machine' } }),
    fp('printHeads', 'Print-head configuration', 'text', { maxLength: 60, visibleWhen: { field: 'productType', op: 'eq', value: 'machine' } }),
    fp('specs', 'Specifications', 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
    fp('status', 'Status', 'master', { master: 'productStatus', required: true, defaultValue: 'active', width: 110 }),
  ],
  relationships: [{ id: 'rel_product_prices', label: 'Price list items', resource: 'priceListItems', foreignKey: 'productId' }],
  form: {
    quickCreate: ['name', 'sku', 'divisionId', 'productType', 'subType', 'hsnSac', 'gstRate'],
    sections: [
      { id: 'main', title: 'Product', fields: ['name', 'sku', 'divisionId', 'productType', 'subType', 'model', 'status'], columns: 2 },
      { id: 'tax', title: 'Tax & unit', fields: ['hsnSac', 'gstRate', 'uom', 'warrantyMonths'], columns: 2 },
      { id: 'spec', title: 'Specifications', fields: ['printWidth', 'printHeads', 'specs'], columns: 2 },
    ],
  },
  views: views([
    { id: 'v_prd_all', resource: 'products', name: 'All products', type: 'table', filter: group('and', [cond('status', 'eq', 'active')]), sort: [{ field: 'name', dir: 'asc' }], columns: cols('name', 'sku', 'divisionId', 'productType', 'subType', 'hsnSac', 'gstRate', 'status') },
    { id: 'v_prd_machines', resource: 'products', name: 'Machines', type: 'table', filter: group('and', [cond('productType', 'eq', 'machine')]), sort: [{ field: 'name', dir: 'asc' }], columns: cols('name', 'model', 'divisionId', 'printWidth', 'printHeads', 'warrantyMonths', 'status') },
    { id: 'v_prd_by_division', resource: 'products', name: 'By division', type: 'table', filter: group('and'), sort: [{ field: 'name', dir: 'asc' }], groupBy: 'divisionId', columns: cols('name', 'sku', 'productType', 'hsnSac', 'gstRate', 'status') },
  ]),
};

export const priceLists: ResourceDefinition = {
  id: 'res_priceLists',
  key: 'priceLists',
  module: 'catalog',
  label: 'Price list',
  labelPlural: 'Price lists',
  icon: 'receipt',
  version: 1,
  idPrefix: 'PL',
  titleField: 'name',
  subtitleFields: ['divisionId', 'status'],
  divisionField: 'divisionId',
  description: 'Division price lists with validity dates (FR-039). Only administrators and division heads change list prices.',
  status: 'published',
  fields: [
    fl('name', 'Name', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 260 }),
    fl('divisionId', 'Division', 'master', { master: 'division', required: true, width: 170 }),
    fl('validFrom', 'Valid from', 'date', { required: true }),
    fl('validTo', 'Valid to', 'date', { required: true, compare: { op: 'gte', field: 'validFrom', message: 'Must be on or after "Valid from"' } }),
    fl('status', 'Status', 'master', { master: 'priceListStatus', readOnly: true, width: 110 }),
    fl('notes', 'Notes', 'longtext', { maxLength: 500, capabilities: FORM_ONLY }),
  ],
  relationships: [{ id: 'rel_pl_items', label: 'Items', resource: 'priceListItems', foreignKey: 'priceListId' }],
  lifecycle: {
    field: 'status',
    initial: 'draft',
    terminal: [],
    transitions: [
      { from: ['draft'], to: 'active', action: 'Activate', confirm: 'Activate this price list? Its prices become available on quotations within the validity dates.' },
      { from: ['active'], to: 'expired', action: 'Expire now', confirm: 'Expire this price list? Its prices stop being offered on new quotations.' },
      { from: ['expired'], to: 'draft', action: 'Reopen as draft' },
    ],
  },
  form: {
    quickCreate: ['name', 'divisionId', 'validFrom', 'validTo'],
    sections: [{ id: 'main', title: 'Price list', fields: ['name', 'divisionId', 'validFrom', 'validTo', 'notes'], columns: 2 }],
  },
  views: views([
    { id: 'v_pl_current', resource: 'priceLists', name: 'Current', type: 'table', filter: group('and', [cond('status', 'in', ['draft', 'active'])]), sort: [{ field: 'validFrom', dir: 'desc' }], columns: cols('name', 'divisionId', 'validFrom', 'validTo', 'status') },
    { id: 'v_pl_all', resource: 'priceLists', name: 'All', type: 'table', filter: group('and'), sort: [{ field: 'validFrom', dir: 'desc' }], columns: cols('name', 'divisionId', 'validFrom', 'validTo', 'status') },
  ]),
};

export const priceListItems: ResourceDefinition = {
  id: 'res_priceListItems',
  key: 'priceListItems',
  module: 'catalog',
  label: 'Price list item',
  labelPlural: 'Price list items',
  icon: 'receipt',
  version: 1,
  idPrefix: 'PLI',
  titleField: 'productId',
  subtitleFields: ['priceListId', 'listPrice'],
  divisionField: 'divisionId',
  description: 'One product’s list price on a price list. Landed cost is visible to Management, Accounts and Admin only (QUO-12).',
  status: 'published',
  fields: [
    fi('priceListId', 'Price list', 'relation', { relation: { resource: 'priceLists' }, required: true, width: 220, capabilities: ALL }),
    fi('productId', 'Product', 'relation', { relation: { resource: 'products', where: { field: 'status', op: 'eq', value: 'active' } }, required: true, width: 280, capabilities: ALL }),
    fi('listPrice', 'List price', 'money', { required: true, min: 0, currency: 'INR', width: 140 }),
    fi('landedCost', 'Landed cost', 'money', { min: 0, currency: 'INR', sensitivity: 'financial', width: 140 }),
    fi('marginPct', 'Margin', 'number', {
      readOnly: true,
      unit: '%',
      sensitivity: 'financial',
      computed: (r) => (Number(r.listPrice) > 0 && r.landedCost !== undefined && r.landedCost !== null && r.landedCost !== '' ? Math.round(((Number(r.listPrice) - Number(r.landedCost)) / Number(r.listPrice)) * 1000) / 10 : null),
      capabilities: { list: true, export: true },
    }),
    fi('divisionId', 'Division', 'master', { master: 'division', readOnly: true, system: true, capabilities: { list: true, filter: true, sort: true } }),
  ],
  relationships: [],
  form: {
    quickCreate: ['priceListId', 'productId', 'listPrice', 'landedCost'],
    sections: [{ id: 'main', title: 'Price', fields: ['priceListId', 'productId', 'listPrice', 'landedCost'], columns: 2 }],
  },
  views: views([
    { id: 'v_pli_all', resource: 'priceListItems', name: 'All prices', type: 'table', filter: group('and'), sort: [{ field: 'productId', dir: 'asc' }], columns: cols('productId', 'priceListId', 'divisionId', 'listPrice', 'landedCost', 'marginPct') },
  ]),
};

export const notificationTemplates: ResourceDefinition = {
  id: 'res_notificationTemplates',
  key: 'notificationTemplates',
  module: 'admin',
  label: 'Notification template',
  labelPlural: 'Notification templates',
  icon: 'send',
  version: 1,
  idPrefix: 'NT',
  titleField: 'name',
  subtitleFields: ['channel', 'event'],
  description: 'Email, WhatsApp, SMS and in-app message templates (ADM-06). Placeholders like {{customer}} are filled when a message is generated.',
  status: 'published',
  fields: [
    fn('name', 'Name', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 260 }),
    fn('event', 'Event', 'master', { master: 'notificationEvent', required: true, width: 220 }),
    fn('channel', 'Channel', 'master', { master: 'notificationChannel', required: true, width: 130 }),
    fn('subject', 'Subject', 'text', { maxLength: 140, requiredWhen: { field: 'channel', op: 'eq', value: 'email' }, visibleWhen: { field: 'channel', op: 'eq', value: 'email' }, capabilities: NO_SEARCH }),
    fn('body', 'Message', 'longtext', { required: true, maxLength: 1000, capabilities: { ...FORM_ONLY, search: true }, help: 'Placeholders: {{customer}}, {{contact}}, {{record}}, {{owner}}, {{date}}, {{amount}}, {{link}}.' }),
    fn('status', 'Status', 'master', { master: 'templateStatus', required: true, defaultValue: 'active', width: 110 }),
  ],
  relationships: [],
  form: {
    quickCreate: ['name', 'event', 'channel', 'subject', 'body'],
    sections: [{ id: 'main', title: 'Template', fields: ['name', 'event', 'channel', 'status', 'subject', 'body'], columns: 2 }],
  },
  views: views([
    { id: 'v_nt_all', resource: 'notificationTemplates', name: 'All templates', type: 'table', filter: group('and'), sort: [{ field: 'event', dir: 'asc' }], columns: cols('name', 'event', 'channel', 'status') },
    { id: 'v_nt_by_event', resource: 'notificationTemplates', name: 'By event', type: 'table', filter: group('and'), sort: [{ field: 'name', dir: 'asc' }], groupBy: 'event', columns: cols('name', 'channel', 'status') },
  ]),
};

const READ = p('all');
const readCatalog = { products: READ, priceLists: READ, priceListItems: READ };

export const catalogPack: ModulePack = {
  id: 'catalog',
  nav: { id: 'catalog', label: 'Products', icon: 'blocks', resources: ['products', 'priceLists', 'priceListItems'] },
  resources: [products, priceLists, priceListItems, notificationTemplates],
  masters,
  permissions: {
    admin: { products: p('all', 'all', true, true, true), priceLists: p('all', 'all', true, true, true), priceListItems: p('all', 'all', true, true, true), notificationTemplates: p('all', 'all', true, true, true) },
    management: { ...readCatalog, priceListItems: p('all', 'none', false, false, true), notificationTemplates: READ },
    // Division heads maintain their own division's price lists (QUO-05).
    division_head: { products: READ, priceLists: p('all', 'division', true, false, true), priceListItems: p('all', 'division', true, true, true) },
    sales_manager: readCatalog,
    sales_exec: readCatalog,
    service_head: readCatalog,
    engineer: { products: READ },
    coordinator: readCatalog,
    scm: readCatalog,
    store: { products: READ },
    accounts: { ...readCatalog, priceListItems: p('all', 'none', false, false, true) },
    profiling: { products: READ },
  },
  capabilities: {
    admin: ['data.import', 'data.export', 'integrations.manage', 'org.view'],
    management: ['org.view', 'data.export'],
    division_head: ['org.view'],
  },
  extend: {
    admin: {
      resources: ['notificationTemplates'],
      pages: [
        { id: 'organisation', label: 'Organisation', icon: 'building', path: 'organisation', capability: 'org.view' },
        { id: 'policies', label: 'Business policies', icon: 'sliders', path: 'policies', capability: 'config.publish' },
        { id: 'import-export', label: 'Import / export', icon: 'download', path: 'import-export', capability: 'data.export' },
        { id: 'integrations', label: 'Integrations', icon: 'activity', path: 'integrations', capability: 'integrations.manage' },
        { id: 'recycle-bin', label: 'Recycle bin', icon: 'trash', path: 'recycle-bin', capability: 'recycle.manage' },
      ],
    },
  },
};
