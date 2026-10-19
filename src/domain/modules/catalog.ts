/**
 * Product & Price Master (QUO-02, QUO-05, ADM-03 — FR-036, FR-039) and Notification Templates (ADM-06, FR-124).
 * Both live in the Administration sidebar group (src/domain/sidebar.ts); this pack only contributes
 * resources, masters, permissions and capabilities.
 */
import { L } from '../../constants/labels';
import type { MasterDefinition, MasterValue, ResourceDefinition, Tone } from '../../metadata/types';
import { ALL, cols, cond, field, FORM_ONLY, group, NO_SEARCH, views } from '../helpers';
import { p, type ModulePack } from './types';

const v = (key: string, label: string, tone: Tone = 'neutral'): Omit<MasterValue, 'order'> => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[]): MasterDefinition => ({ id: `mst_${key}`, key, label, version: 1, values: values.map((x, i) => ({ ...x, order: i })) });

const M = L.catalog.masters;
const vals = <K extends string>(m: { values: Record<K, string> }, tones: Partial<Record<K, Tone>> = {}) =>
  (Object.keys(m.values) as K[]).map((k) => v(k, m.values[k], tones[k] ?? 'neutral'));

const masters: MasterDefinition[] = [
  master('productStatus', M.productStatus.label, vals(M.productStatus, { active: 'success' })),
  master('priceListStatus', M.priceListStatus.label, vals(M.priceListStatus, { draft: 'info', active: 'success' })),
  master('gstRate', M.gstRate.label, vals(M.gstRate)),
  master('uom', M.uom.label, vals(M.uom)),
  master('notificationChannel', M.notificationChannel.label, vals(M.notificationChannel, { email: 'info', whatsapp: 'success', in_app: 'accent' })),
  master('notificationEvent', M.notificationEvent.label, vals(M.notificationEvent)),
  master('templateStatus', M.templateStatus.label, vals(M.templateStatus, { active: 'success' })),
];

const R = L.catalog.records;
const F = L.catalog.fields;
const S = L.catalog.sections;
const V = L.catalog.views;
const D = L.catalog.descriptions;

const fp = (key: keyof typeof F.products, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('products', key, F.products[key], type, extra);
const fl = (key: keyof typeof F.priceLists, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('priceLists', key, F.priceLists[key], type, extra);
const fi = (key: keyof typeof F.priceListItems, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('priceListItems', key, F.priceListItems[key], type, extra);
const fn = (key: keyof typeof F.notificationTemplates, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('notificationTemplates', key, F.notificationTemplates[key], type, extra);

export const products: ResourceDefinition = {
  id: 'res_products',
  key: 'products',
  module: 'catalog',
  label: R.products.one,
  // The list page is titled "Product & Price Master" (GLOSSARY G-B1); singular stays "Product".
  labelPlural: R.products.listTitle,
  icon: 'blocks',
  version: 1,
  idPrefix: 'PRD',
  titleField: 'name',
  subtitleFields: ['sku', 'status'],
  divisionField: 'divisionId',
  description: D.products,
  status: 'published',
  fields: [
    fp('name', 'text', { required: true, maxLength: 120, capabilities: ALL, width: 280, subFields: ['model'] }),
    fp('sku', 'identifier', { required: true, maxLength: 30, capabilities: ALL, width: 150, pattern: { regex: '^[A-Z0-9][A-Z0-9-/]{2,29}$', message: F.products.skuPattern } }),
    fp('divisionId', 'master', { master: 'division', required: true, width: 160 }),
    fp('productType', 'master', { master: 'productType', required: true, width: 130 }),
    fp('subType', 'master', { master: 'productSubType', width: 110 }),
    fp('model', 'text', { maxLength: 60, capabilities: ALL }),
    fp('hsnSac', 'identifier', { required: true, format: 'hsnSac', width: 110 }),
    fp('gstRate', 'number', { required: true, min: 0, max: 28, unit: L.catalog.units.pct, defaultValue: 18, width: 90, help: F.products.gstRateHelp }),
    fp('uom', 'master', { master: 'uom', defaultValue: 'nos', width: 90 }),
    fp('warrantyMonths', 'number', { min: 0, max: 60, unit: L.catalog.units.months, help: F.products.warrantyMonthsHelp }),
    fp('printWidth', 'text', { maxLength: 30, visibleWhen: { field: 'productType', op: 'eq', value: 'machine' } }),
    fp('printHeads', 'text', { maxLength: 60, visibleWhen: { field: 'productType', op: 'eq', value: 'machine' } }),
    fp('specs', 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
    fp('status', 'master', { master: 'productStatus', required: true, defaultValue: 'active', width: 110 }),
  ],
  relationships: [{ id: 'rel_product_prices', label: L.catalog.relationships.productPrices, resource: 'priceListItems', foreignKey: 'productId' }],
  form: {
    quickCreate: ['name', 'sku', 'divisionId', 'productType', 'subType', 'hsnSac', 'gstRate'],
    sections: [
      { id: 'main', title: S.products.main, fields: ['name', 'sku', 'divisionId', 'productType', 'subType', 'model', 'status'], columns: 2 },
      { id: 'tax', title: S.products.tax, fields: ['hsnSac', 'gstRate', 'uom', 'warrantyMonths'], columns: 2 },
      { id: 'spec', title: S.products.spec, fields: ['printWidth', 'printHeads', 'specs'], columns: 2 },
    ],
  },
  views: views([
    { id: 'v_prd_all', resource: 'products', name: V.products.all, type: 'table', filter: group('and', [cond('status', 'eq', 'active')]), sort: [{ field: 'name', dir: 'asc' }], columns: cols('name', 'sku', 'divisionId', 'productType', 'subType', 'hsnSac', 'gstRate', 'status') },
    { id: 'v_prd_machines', resource: 'products', name: V.products.machines, type: 'table', filter: group('and', [cond('productType', 'eq', 'machine')]), sort: [{ field: 'name', dir: 'asc' }], columns: cols('name', 'model', 'divisionId', 'printWidth', 'printHeads', 'warrantyMonths', 'status') },
    { id: 'v_prd_by_division', resource: 'products', name: V.products.byDivision, type: 'table', filter: group('and'), sort: [{ field: 'name', dir: 'asc' }], groupBy: 'divisionId', columns: cols('name', 'sku', 'productType', 'hsnSac', 'gstRate', 'status') },
  ]),
};

export const priceLists: ResourceDefinition = {
  id: 'res_priceLists',
  key: 'priceLists',
  module: 'catalog',
  label: R.priceLists.one,
  labelPlural: R.priceLists.many,
  icon: 'receipt',
  version: 1,
  idPrefix: 'PL',
  titleField: 'name',
  subtitleFields: ['divisionId', 'status'],
  divisionField: 'divisionId',
  description: D.priceLists,
  status: 'published',
  fields: [
    fl('name', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 260 }),
    fl('divisionId', 'master', { master: 'division', required: true, width: 170 }),
    fl('validFrom', 'date', { required: true }),
    fl('validTo', 'date', { required: true, compare: { op: 'gte', field: 'validFrom', message: F.priceLists.validToCompare } }),
    fl('status', 'master', { master: 'priceListStatus', readOnly: true, width: 110 }),
    fl('notes', 'longtext', { maxLength: 500, capabilities: FORM_ONLY }),
  ],
  relationships: [{ id: 'rel_pl_items', label: L.catalog.relationships.priceListItems, resource: 'priceListItems', foreignKey: 'priceListId' }],
  lifecycle: {
    field: 'status',
    initial: 'draft',
    terminal: [],
    transitions: [
      { from: ['draft'], to: 'active', action: L.catalog.lifecycle.activate, confirm: L.catalog.lifecycle.activateConfirm },
      { from: ['active'], to: 'expired', action: L.catalog.lifecycle.expire, confirm: L.catalog.lifecycle.expireConfirm },
      { from: ['expired'], to: 'draft', action: L.catalog.lifecycle.reopen },
    ],
  },
  form: {
    quickCreate: ['name', 'divisionId', 'validFrom', 'validTo'],
    sections: [{ id: 'main', title: S.priceLists.main, fields: ['name', 'divisionId', 'validFrom', 'validTo', 'notes'], columns: 2 }],
  },
  views: views([
    { id: 'v_pl_current', resource: 'priceLists', name: V.priceLists.current, type: 'table', filter: group('and', [cond('status', 'in', ['draft', 'active'])]), sort: [{ field: 'validFrom', dir: 'desc' }], columns: cols('name', 'divisionId', 'validFrom', 'validTo', 'status') },
    { id: 'v_pl_all', resource: 'priceLists', name: V.priceLists.all, type: 'table', filter: group('and'), sort: [{ field: 'validFrom', dir: 'desc' }], columns: cols('name', 'divisionId', 'validFrom', 'validTo', 'status') },
  ]),
};

export const priceListItems: ResourceDefinition = {
  id: 'res_priceListItems',
  key: 'priceListItems',
  module: 'catalog',
  label: R.priceListItems.one,
  labelPlural: R.priceListItems.many,
  icon: 'receipt',
  version: 1,
  idPrefix: 'PLI',
  titleField: 'productId',
  subtitleFields: ['priceListId', 'listPrice'],
  divisionField: 'divisionId',
  description: D.priceListItems,
  status: 'published',
  fields: [
    fi('priceListId', 'relation', { relation: { resource: 'priceLists' }, required: true, width: 220, capabilities: ALL }),
    fi('productId', 'relation', { relation: { resource: 'products', where: { field: 'status', op: 'eq', value: 'active' } }, required: true, width: 280, capabilities: ALL }),
    fi('listPrice', 'money', { required: true, min: 0, currency: 'INR', width: 140 }),
    fi('landedCost', 'money', { min: 0, currency: 'INR', sensitivity: 'financial', width: 140 }),
    fi('marginPct', 'number', {
      readOnly: true,
      unit: L.catalog.units.pct,
      sensitivity: 'financial',
      computed: (r) => (Number(r.listPrice) > 0 && r.landedCost !== undefined && r.landedCost !== null && r.landedCost !== '' ? Math.round(((Number(r.listPrice) - Number(r.landedCost)) / Number(r.listPrice)) * 1000) / 10 : null),
      capabilities: { list: true, export: true },
    }),
    fi('divisionId', 'master', { master: 'division', readOnly: true, system: true, capabilities: { list: true, filter: true, sort: true } }),
  ],
  relationships: [],
  form: {
    quickCreate: ['priceListId', 'productId', 'listPrice', 'landedCost'],
    sections: [{ id: 'main', title: S.priceListItems.main, fields: ['priceListId', 'productId', 'listPrice', 'landedCost'], columns: 2 }],
  },
  views: views([
    { id: 'v_pli_all', resource: 'priceListItems', name: V.priceListItems.all, type: 'table', filter: group('and'), sort: [{ field: 'productId', dir: 'asc' }], columns: cols('productId', 'priceListId', 'divisionId', 'listPrice', 'landedCost', 'marginPct') },
  ]),
};

export const notificationTemplates: ResourceDefinition = {
  id: 'res_notificationTemplates',
  key: 'notificationTemplates',
  module: 'admin',
  label: R.notificationTemplates.one,
  labelPlural: R.notificationTemplates.many,
  icon: 'send',
  version: 1,
  idPrefix: 'NT',
  titleField: 'name',
  subtitleFields: ['channel', 'event'],
  description: D.notificationTemplates,
  status: 'published',
  fields: [
    fn('name', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 260 }),
    fn('event', 'master', { master: 'notificationEvent', required: true, width: 220 }),
    fn('channel', 'master', { master: 'notificationChannel', required: true, width: 130 }),
    fn('subject', 'text', { maxLength: 140, requiredWhen: { field: 'channel', op: 'eq', value: 'email' }, visibleWhen: { field: 'channel', op: 'eq', value: 'email' }, capabilities: NO_SEARCH }),
    fn('body', 'longtext', { required: true, maxLength: 1000, capabilities: { ...FORM_ONLY, search: true }, help: F.notificationTemplates.bodyHelp }),
    fn('status', 'master', { master: 'templateStatus', required: true, defaultValue: 'active', width: 110 }),
  ],
  relationships: [],
  form: {
    quickCreate: ['name', 'event', 'channel', 'subject', 'body'],
    sections: [{ id: 'main', title: S.notificationTemplates.main, fields: ['name', 'event', 'channel', 'status', 'subject', 'body'], columns: 2 }],
  },
  views: views([
    { id: 'v_nt_all', resource: 'notificationTemplates', name: V.notificationTemplates.all, type: 'table', filter: group('and'), sort: [{ field: 'event', dir: 'asc' }], columns: cols('name', 'event', 'channel', 'status') },
    { id: 'v_nt_by_event', resource: 'notificationTemplates', name: V.notificationTemplates.byEvent, type: 'table', filter: group('and'), sort: [{ field: 'name', dir: 'asc' }], groupBy: 'event', columns: cols('name', 'channel', 'status') },
  ]),
};

const READ = p('all');
const readCatalog = { products: READ, priceLists: READ, priceListItems: READ };

export const catalogPack: ModulePack = {
  id: 'catalog',
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
    // access.manage: edit Roles & Permissions (ADM-02).
    admin: ['data.import', 'data.export', 'integrations.manage', 'org.view', 'access.manage'],
    management: ['org.view', 'data.export'],
    division_head: ['org.view'],
  },
};
