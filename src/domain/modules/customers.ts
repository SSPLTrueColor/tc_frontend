/**
 * Customers & Contacts module (BRD 4.1, FR-001 – FR-011): customers, their sites and contacts,
 * and the Contact Pool (contacts without a customer yet). Labels: L.customers (GLOSSARY §1.2, §2, §3).
 * Resource key `addresses` is an internal id; the record is called "Site" (C-20).
 */
import type { MasterDefinition, ResourceDefinition, ResourcePermission, RowScope } from '../../metadata/types';
import { ALL, cols, cond, field, FORM_ONLY, group, NO_SEARCH, views } from '../helpers';
import type { ModulePack } from './types';
import { L } from '../../constants/labels';

const LC = L.customers;
const FC = LC.fields.customers;
const FA = LC.fields.addresses;
const FK = LC.fields.contacts;

// Local copy of pack.ts `p` — importing it from ../pack would be a circular import (pack imports this file).
const p = (read: RowScope, update: RowScope = 'none', create = false, del = false, exp = false): ResourcePermission => ({ read, update, create, delete: del, export: exp, sensitive_data: true });

type FieldType = Parameters<typeof field>[3];
type Extra = Parameters<typeof field>[4];
const fc = (key: string, label: string, type: FieldType, extra?: Extra) => field('customers', key, label, type, extra);
const fa = (key: string, label: string, type: FieldType, extra?: Extra) => field('addresses', key, label, type, extra);
const fk = (key: string, label: string, type: FieldType, extra?: Extra) => field('contacts', key, label, type, extra);

const READ_ONLY_ERP = { list: true, sort: true, filter: true, export: true };

export const customers: ResourceDefinition = {
  id: 'res_customers',
  key: 'customers',
  module: 'customers',
  label: LC.records.customers.one,
  labelPlural: LC.records.customers.many,
  recordPageTitle: L.nav.pages.customer360.title,
  icon: 'building',
  version: 1,
  idPrefix: 'C',
  titleField: 'name',
  subtitleFields: ['category', 'territoryId'],
  ownerField: 'ownerId',
  divisionField: 'divisionIds',
  description: LC.descriptions.customers,
  status: 'published',
  fields: [
    fc('name', FC.name, 'text', { required: true, maxLength: 120, capabilities: ALL, width: 240, subFields: ['legalName'], leadingImage: 'initials' }),
    fc('legalName', FC.legalName, 'text', { maxLength: 160, capabilities: { ...ALL, list: false } }),
    fc('category', FC.category, 'master', { master: 'customerCategory', required: true, defaultValue: 'prospect', width: 160 }),
    fc('segmentTags', FC.segmentTags, 'multimaster', { master: 'segment', width: 200 }),
    fc('industry', FC.industry, 'master', { master: 'industry', width: 150 }),
    fc('divisionIds', FC.divisionIds, 'multimaster', { master: 'division', required: true, width: 190 }),
    fc('territoryId', FC.territoryId, 'master', { master: 'territory', required: true, width: 140 }),
    fc('billingState', FC.billingState, 'master', { master: 'state', required: true, width: 150, help: FC.billingStateHelp }),
    fc('gstin', FC.gstin, 'identifier', { format: 'gstin', maxLength: 15, capabilities: ALL, width: 170, help: FC.gstinHelp }),
    fc('pan', FC.pan, 'identifier', { format: 'pan', maxLength: 10, capabilities: ALL, width: 120 }),
    fc('website', FC.website, 'text', { format: 'url', maxLength: 200, capabilities: { ...NO_SEARCH, list: false } }),
    fc('ownerId', FC.ownerId, 'relation', { relation: { resource: 'employees', where: { field: 'status', op: 'neq', value: 'inactive' } }, required: true, width: 170, display: 'person', personSubtitle: 'designation' }),
    fc('parentId', FC.parentId, 'relation', { relation: { resource: 'customers' }, width: 180 }),
    fc('dealerId', FC.dealerId, 'relation', { relation: { resource: 'customers', where: { field: 'category', op: 'in', value: ['dealer', 'distributor'] } }, width: 180 }),
    fc('keyAccount', FC.keyAccount, 'boolean', { defaultValue: false, width: 110 }),
    fc('status', FC.status, 'master', { master: 'customerStatus', required: true, defaultValue: 'active', width: 110 }),
    fc('creditLimit', FC.creditLimit, 'money', { readOnly: true, help: FC.erpHelp, capabilities: READ_ONLY_ERP, width: 140 }),
    fc('outstanding', FC.outstanding, 'money', { readOnly: true, help: FC.erpHelp, capabilities: READ_ONLY_ERP, width: 140 }),
    fc('overdue', FC.overdue, 'money', { readOnly: true, help: FC.erpHelp, capabilities: READ_ONLY_ERP, width: 130 }),
    fc('erpSyncedAt', FC.erpSyncedAt, 'datetime', { readOnly: true, capabilities: { list: true, sort: true } }),
    fc('lastActivityAt', FC.lastActivityAt, 'datetime', { readOnly: true, capabilities: { list: true, sort: true, filter: true } }),
    // FR-011 account plan (key accounts)
    fc('planObjectives', FC.planObjectives, 'longtext', { maxLength: 1000, capabilities: FORM_ONLY, visibleWhen: { field: 'keyAccount', op: 'truthy' } }),
    fc('planKeyContacts', FC.planKeyContacts, 'longtext', { maxLength: 1000, capabilities: FORM_ONLY, visibleWhen: { field: 'keyAccount', op: 'truthy' } }),
    fc('planRisks', FC.planRisks, 'longtext', { maxLength: 1000, capabilities: FORM_ONLY, visibleWhen: { field: 'keyAccount', op: 'truthy' } }),
    fc('planNextReview', FC.planNextReview, 'date', { dateRule: 'future', visibleWhen: { field: 'keyAccount', op: 'truthy' }, capabilities: { list: true, sort: true, filter: true, form: true, export: true } }),
  ],
  relationships: [
    { id: 'rel_cus_contacts', label: LC.relationships.contacts, resource: 'contacts', foreignKey: 'customerId' },
    { id: 'rel_cus_addresses', label: LC.relationships.addresses, resource: 'addresses', foreignKey: 'customerId' },
    { id: 'rel_cus_children', label: LC.relationships.children, resource: 'customers', foreignKey: 'parentId' },
    { id: 'rel_cus_dealer', label: LC.relationships.dealer, resource: 'customers', foreignKey: 'dealerId' },
  ],
  form: {
    quickCreate: ['name', 'category', 'divisionIds', 'territoryId', 'billingState', 'gstin', 'ownerId'],
    sections: [
      { id: 'company', title: LC.sections.customers.company, fields: ['name', 'legalName', 'category', 'segmentTags', 'industry', 'status', 'website'], columns: 2 },
      { id: 'tax', title: LC.sections.customers.tax, fields: ['billingState', 'gstin', 'pan'], columns: 2 },
      { id: 'org', title: LC.sections.customers.org, fields: ['divisionIds', 'territoryId', 'ownerId', 'parentId', 'dealerId', 'keyAccount'], columns: 2 },
      { id: 'plan', title: LC.sections.customers.plan, fields: ['planObjectives', 'planKeyContacts', 'planRisks', 'planNextReview'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_cus_all',
      resource: 'customers',
      name: LC.views.customers.all,
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'active')]),
      sort: [{ field: 'name', dir: 'asc' }],
      columns: cols('name', 'id', 'category', 'divisionIds', 'territoryId', 'ownerId', 'gstin', 'outstanding', 'lastActivityAt'),
    },
    {
      id: 'v_cus_key',
      resource: 'customers',
      name: LC.views.customers.key,
      type: 'table',
      filter: group('and', [cond('keyAccount', 'eq', true)]),
      sort: [{ field: 'planNextReview', dir: 'asc' }],
      columns: cols('name', 'category', 'divisionIds', 'ownerId', 'planNextReview', 'outstanding', 'overdue'),
    },
    {
      id: 'v_cus_dealers',
      resource: 'customers',
      name: LC.views.customers.dealers,
      type: 'table',
      filter: group('and', [cond('category', 'in', ['dealer', 'distributor'])]),
      sort: [{ field: 'name', dir: 'asc' }],
      columns: cols('name', 'category', 'divisionIds', 'territoryId', 'ownerId'),
    },
    {
      id: 'v_cus_overdue',
      resource: 'customers',
      name: LC.views.customers.overdue,
      type: 'table',
      filter: group('and', [cond('overdue', 'gt', 0)]),
      sort: [{ field: 'overdue', dir: 'desc' }],
      columns: cols('name', 'ownerId', 'creditLimit', 'outstanding', 'overdue', 'erpSyncedAt'),
    },
    {
      id: 'v_cus_by_territory',
      resource: 'customers',
      name: LC.views.customers.byTerritory,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'name', dir: 'asc' }],
      groupBy: 'territoryId',
      columns: cols('name', 'category', 'divisionIds', 'ownerId'),
    },
  ]),
};

export const addresses: ResourceDefinition = {
  id: 'res_addresses',
  key: 'addresses',
  module: 'customers',
  label: LC.records.addresses.one,
  labelPlural: LC.records.addresses.many,
  icon: 'building',
  version: 1,
  idPrefix: 'ADR',
  titleField: 'label',
  subtitleFields: ['addressType', 'city'],
  description: LC.descriptions.addresses,
  status: 'published',
  fields: [
    fa('customerId', FA.customerId, 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220 }),
    fa('label', FA.label, 'text', { required: true, maxLength: 80, capabilities: ALL, width: 200, placeholder: FA.labelPlaceholder }),
    fa('addressType', FA.addressType, 'master', { master: 'addressType', required: true, defaultValue: 'billing', width: 130 }),
    fa('line1', FA.line1, 'text', { required: true, maxLength: 200, capabilities: ALL, width: 260 }),
    fa('city', FA.city, 'text', { required: true, maxLength: 60, capabilities: ALL, width: 130 }),
    fa('state', FA.state, 'master', { master: 'state', required: true, width: 150 }),
    fa('pincode', FA.pincode, 'text', { required: true, format: 'pincode', maxLength: 6, width: 100 }),
    fa('lat', FA.lat, 'number', { min: -90, max: 90, width: 110 }),
    fa('lng', FA.lng, 'number', { min: -180, max: 180, width: 110 }),
  ],
  relationships: [],
  form: {
    quickCreate: ['customerId', 'label', 'addressType', 'line1', 'city', 'state', 'pincode', 'lat', 'lng'],
    sections: [
      { id: 'main', title: LC.sections.addresses.main, fields: ['customerId', 'label', 'addressType', 'line1', 'city', 'state', 'pincode'], columns: 2 },
      { id: 'geo', title: LC.sections.addresses.geo, fields: ['lat', 'lng'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_adr_all',
      resource: 'addresses',
      name: LC.views.addresses.all,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'customerId', dir: 'asc' }],
      columns: cols('customerId', 'label', 'addressType', 'city', 'state', 'pincode', 'lat', 'lng'),
    },
    {
      id: 'v_adr_sites',
      resource: 'addresses',
      name: LC.views.addresses.installation,
      type: 'table',
      filter: group('and', [cond('addressType', 'eq', 'installation')]),
      sort: [{ field: 'city', dir: 'asc' }],
      columns: cols('customerId', 'label', 'city', 'state', 'lat', 'lng'),
    },
  ]),
};

export const contacts: ResourceDefinition = {
  id: 'res_contacts',
  key: 'contacts',
  module: 'customers',
  label: LC.records.contacts.one,
  labelPlural: LC.records.contacts.many,
  icon: 'id-card',
  version: 1,
  idPrefix: 'CT',
  titleField: 'name',
  subtitleFields: ['designation', 'customerId'],
  ownerField: 'ownerId',
  divisionField: 'divisionIds',
  description: LC.descriptions.contacts,
  status: 'published',
  fields: [
    fk('name', FK.name, 'text', { required: true, maxLength: 80, capabilities: ALL, width: 190, subFields: ['designation'], leadingImage: 'initials' }),
    fk('customerId', FK.customerId, 'relation', { relation: { resource: 'customers' }, capabilities: ALL, width: 210, help: FK.customerIdHelp }),
    fk('designation', FK.designation, 'text', { maxLength: 80, capabilities: ALL, width: 160 }),
    fk('department', FK.department, 'text', { maxLength: 60 }),
    fk('mobile', FK.mobile, 'phone', { format: 'mobile', sensitivity: 'contact', capabilities: ALL, width: 130 }),
    fk('whatsapp', FK.whatsapp, 'phone', { format: 'mobile', sensitivity: 'contact', capabilities: ALL, width: 130 }),
    fk('email', FK.email, 'email', { format: 'email', sensitivity: 'contact', capabilities: ALL, width: 220 }),
    fk('buyingRole', FK.buyingRole, 'master', { master: 'buyingRole', width: 140 }),
    fk('consentWhatsapp', FK.consentWhatsapp, 'boolean', { defaultValue: false, width: 120 }),
    fk('consentEmail', FK.consentEmail, 'boolean', { defaultValue: false, width: 110 }),
    fk('consentSms', FK.consentSms, 'boolean', { defaultValue: false, width: 110 }),
    fk('ownerId', FK.ownerId, 'relation', { relation: { resource: 'employees', where: { field: 'status', op: 'neq', value: 'inactive' } }, required: true, width: 160, display: 'person', personSubtitle: 'designation' }),
    fk('divisionIds', FK.divisionIds, 'multimaster', { master: 'division', required: true, width: 160 }),
    fk('source', FK.source, 'master', { master: 'leadSource', width: 150 }),
    fk('poolStatus', FK.poolStatus, 'master', { master: 'poolStatus', defaultValue: 'new', width: 120 }),
    fk('city', FK.city, 'text', { maxLength: 60, capabilities: ALL, width: 120 }),
    fk('notes', FK.notes, 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  form: {
    quickCreate: ['name', 'customerId', 'designation', 'mobile', 'email', 'buyingRole', 'ownerId', 'divisionIds'],
    sections: [
      { id: 'who', title: LC.sections.contacts.who, fields: ['name', 'customerId', 'designation', 'department', 'buyingRole', 'city'], columns: 2 },
      { id: 'reach', title: LC.sections.contacts.reach, fields: ['mobile', 'whatsapp', 'email', 'consentWhatsapp', 'consentEmail', 'consentSms'], columns: 2 },
      { id: 'own', title: LC.sections.contacts.own, fields: ['ownerId', 'divisionIds', 'source', 'poolStatus', 'notes'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_ct_all',
      resource: 'contacts',
      name: LC.views.contacts.all,
      type: 'table',
      filter: group('and', [cond('customerId', 'notEmpty')]),
      sort: [{ field: 'name', dir: 'asc' }],
      columns: cols('name', 'customerId', 'designation', 'buyingRole', 'mobile', 'email', 'consentWhatsapp', 'ownerId'),
    },
    {
      id: 'v_ct_decision',
      resource: 'contacts',
      name: LC.views.contacts.decision,
      type: 'table',
      filter: group('and', [cond('buyingRole', 'eq', 'decision_maker')]),
      sort: [{ field: 'name', dir: 'asc' }],
      columns: cols('name', 'customerId', 'designation', 'mobile', 'email', 'ownerId'),
    },
    {
      id: 'v_ct_converted',
      resource: 'contacts',
      name: LC.views.contacts.converted,
      type: 'table',
      filter: group('and', [cond('poolStatus', 'eq', 'converted')]),
      sort: [{ field: 'name', dir: 'asc' }],
      columns: cols('name', 'customerId', 'source', 'ownerId'),
    },
  ]),
};

const v = (key: string, label: string, tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent' = 'neutral') => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: ReturnType<typeof v>[]): MasterDefinition => ({ id: `mst_${key}`, key, label, version: 1, values: values.map((x, i) => ({ ...x, order: i })) });

const M = LC.masters;
const masters: MasterDefinition[] = [
  master('addressType', M.addressType.label, [v('billing', M.addressType.values.billing, 'info'), v('shipping', M.addressType.values.shipping), v('installation', M.addressType.values.installation, 'accent')]),
  master('poolStatus', M.poolStatus.label, [v('new', M.poolStatus.values.new, 'info'), v('contacted', M.poolStatus.values.contacted, 'warning'), v('converted', M.poolStatus.values.converted, 'success')]),
  master('customerStatus', M.customerStatus.label, [v('active', M.customerStatus.values.active, 'success'), v('inactive', M.customerStatus.values.inactive)]),
];

/** Sidebar entries live in src/domain/sidebar.ts (pack `nav` / `extend` are no longer used). REQUIREMENTS §2.2 — customers & contacts column. */
const perms = (c: ResourcePermission, a: ResourcePermission = c, k: ResourcePermission = c) => ({ customers: c, addresses: a, contacts: k });
const viewAll = p('all');
const permissions: ModulePack['permissions'] = {
  admin: perms(p('all', 'all', true, true, true)),
  management: perms(p('all', 'none', false, false, true)),
  division_head: perms(p('division', 'division', true, false, true)),
  sales_manager: perms(p('team', 'team', true), p('all', 'all', true), p('team', 'team', true)),
  sales_exec: perms(p('own', 'own', true), p('all', 'all', true), p('own', 'own', true)),
  service_head: perms(viewAll),
  engineer: perms(viewAll),
  coordinator: perms(p('division', 'division', true), p('all', 'all', true), p('division', 'division', true)),
  scm: perms(viewAll),
  store: perms(p('none')),
  accounts: perms(viewAll),
  profiling: perms(viewAll),
};

export const customersPack: ModulePack = {
  id: 'customers',
  resources: [customers, addresses, contacts],
  masters,
  permissions,
  capabilities: { admin: ['customers.merge', 'customers.transfer'], management: ['customers.transfer'], division_head: ['customers.transfer'] },
};
