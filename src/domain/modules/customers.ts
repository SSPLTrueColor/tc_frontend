/**
 * Customers module (BRD 4.1, FR-001 – FR-011): company accounts, their addresses and contacts,
 * and the contact pool (contacts without a company yet).
 */
import type { MasterDefinition, ResourceDefinition, ResourcePermission, RowScope } from '../../metadata/types';
import { ALL, cols, cond, field, FORM_ONLY, group, NO_SEARCH, views } from '../helpers';
import type { ModulePack } from './types';

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
  label: 'Customer',
  labelPlural: 'Customers',
  icon: 'building',
  version: 1,
  idPrefix: 'C',
  titleField: 'name',
  subtitleFields: ['category', 'territoryId'],
  ownerField: 'ownerId',
  divisionField: 'divisionIds',
  description: 'One record per company — customer, prospect, dealer or distributor — shared by every module (COM-02).',
  status: 'published',
  fields: [
    fc('name', 'Company name', 'text', { required: true, maxLength: 120, capabilities: ALL, width: 240, subFields: ['legalName'], leadingImage: 'initials' }),
    fc('legalName', 'Legal name', 'text', { maxLength: 160, capabilities: { ...ALL, list: false } }),
    fc('category', 'Category', 'master', { master: 'customerCategory', required: true, defaultValue: 'prospect', width: 160 }),
    fc('segmentTags', 'Segments', 'multimaster', { master: 'segment', width: 200 }),
    fc('industry', 'Industry', 'master', { master: 'industry', width: 150 }),
    fc('divisionIds', 'Divisions served', 'multimaster', { master: 'division', required: true, width: 190 }),
    fc('territoryId', 'Territory / hub', 'master', { master: 'territory', required: true, width: 140 }),
    fc('billingState', 'Billing state', 'master', { master: 'state', required: true, width: 150, help: 'Decides CGST+SGST vs IGST on quotations and must match the GSTIN state code.' }),
    fc('gstin', 'GSTIN', 'identifier', { format: 'gstin', maxLength: 15, capabilities: ALL, width: 170, help: '15 characters; state code and PAN inside it are checked.' }),
    fc('pan', 'PAN', 'identifier', { format: 'pan', maxLength: 10, capabilities: ALL, width: 120 }),
    fc('website', 'Website', 'text', { format: 'url', maxLength: 200, capabilities: { ...NO_SEARCH, list: false } }),
    fc('ownerId', 'Account owner', 'relation', { relation: { resource: 'employees', where: { field: 'status', op: 'neq', value: 'inactive' } }, required: true, width: 170, display: 'person', personSubtitle: 'designation' }),
    fc('parentId', 'Parent / group company', 'relation', { relation: { resource: 'customers' }, width: 180 }),
    fc('dealerId', 'Through dealer / distributor', 'relation', { relation: { resource: 'customers', where: { field: 'category', op: 'in', value: ['dealer', 'distributor'] } }, width: 180 }),
    fc('keyAccount', 'Key account', 'boolean', { defaultValue: false, width: 110 }),
    fc('status', 'Status', 'master', { master: 'customerStatus', required: true, defaultValue: 'active', width: 110 }),
    fc('creditLimit', 'Credit limit (ERP)', 'money', { readOnly: true, capabilities: READ_ONLY_ERP, width: 140 }),
    fc('outstanding', 'Outstanding (ERP)', 'money', { readOnly: true, capabilities: READ_ONLY_ERP, width: 140 }),
    fc('overdue', 'Overdue (ERP)', 'money', { readOnly: true, capabilities: READ_ONLY_ERP, width: 130 }),
    fc('erpSyncedAt', 'ERP synced', 'datetime', { readOnly: true, capabilities: { list: true, sort: true } }),
    fc('lastActivityAt', 'Last activity', 'datetime', { readOnly: true, capabilities: { list: true, sort: true, filter: true } }),
    // FR-011 account plan (key accounts)
    fc('planObjectives', 'Account objectives', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY, visibleWhen: { field: 'keyAccount', op: 'truthy' } }),
    fc('planKeyContacts', 'Key contacts & relationships', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY, visibleWhen: { field: 'keyAccount', op: 'truthy' } }),
    fc('planRisks', 'Risks', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY, visibleWhen: { field: 'keyAccount', op: 'truthy' } }),
    fc('planNextReview', 'Next plan review', 'date', { dateRule: 'future', visibleWhen: { field: 'keyAccount', op: 'truthy' }, capabilities: { list: true, sort: true, filter: true, form: true, export: true } }),
  ],
  relationships: [
    { id: 'rel_cus_contacts', label: 'Contacts', resource: 'contacts', foreignKey: 'customerId' },
    { id: 'rel_cus_addresses', label: 'Addresses', resource: 'addresses', foreignKey: 'customerId' },
    { id: 'rel_cus_children', label: 'Group companies', resource: 'customers', foreignKey: 'parentId' },
    { id: 'rel_cus_dealer', label: 'End customers (via this dealer)', resource: 'customers', foreignKey: 'dealerId' },
  ],
  form: {
    quickCreate: ['name', 'category', 'divisionIds', 'territoryId', 'billingState', 'gstin', 'ownerId'],
    sections: [
      { id: 'company', title: 'Company', fields: ['name', 'legalName', 'category', 'segmentTags', 'industry', 'status', 'website'], columns: 2 },
      { id: 'tax', title: 'Tax', fields: ['billingState', 'gstin', 'pan'], columns: 2 },
      { id: 'org', title: 'Ownership', fields: ['divisionIds', 'territoryId', 'ownerId', 'parentId', 'dealerId', 'keyAccount'], columns: 2 },
      { id: 'plan', title: 'Account plan', fields: ['planObjectives', 'planKeyContacts', 'planRisks', 'planNextReview'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_cus_all',
      resource: 'customers',
      name: 'All customers',
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'active')]),
      sort: [{ field: 'name', dir: 'asc' }],
      columns: cols('name', 'id', 'category', 'divisionIds', 'territoryId', 'ownerId', 'gstin', 'outstanding', 'lastActivityAt'),
    },
    {
      id: 'v_cus_key',
      resource: 'customers',
      name: 'Key accounts',
      type: 'table',
      filter: group('and', [cond('keyAccount', 'eq', true)]),
      sort: [{ field: 'planNextReview', dir: 'asc' }],
      columns: cols('name', 'category', 'divisionIds', 'ownerId', 'planNextReview', 'outstanding', 'overdue'),
    },
    {
      id: 'v_cus_dealers',
      resource: 'customers',
      name: 'Dealers & distributors',
      type: 'table',
      filter: group('and', [cond('category', 'in', ['dealer', 'distributor'])]),
      sort: [{ field: 'name', dir: 'asc' }],
      columns: cols('name', 'category', 'divisionIds', 'territoryId', 'ownerId'),
    },
    {
      id: 'v_cus_overdue',
      resource: 'customers',
      name: 'Overdue (ERP)',
      type: 'table',
      filter: group('and', [cond('overdue', 'gt', 0)]),
      sort: [{ field: 'overdue', dir: 'desc' }],
      columns: cols('name', 'ownerId', 'creditLimit', 'outstanding', 'overdue', 'erpSyncedAt'),
    },
    {
      id: 'v_cus_by_territory',
      resource: 'customers',
      name: 'By territory',
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
  label: 'Address',
  labelPlural: 'Addresses',
  icon: 'building',
  version: 1,
  idPrefix: 'ADR',
  titleField: 'label',
  subtitleFields: ['addressType', 'city'],
  description: 'Billing, shipping and installation-site addresses. Installation sites need coordinates for engineer routing.',
  status: 'published',
  fields: [
    fa('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220 }),
    fa('label', 'Label', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 200, placeholder: 'e.g. Sachin GIDC plant' }),
    fa('addressType', 'Type', 'master', { master: 'addressType', required: true, defaultValue: 'billing', width: 130 }),
    fa('line1', 'Address', 'text', { required: true, maxLength: 200, capabilities: ALL, width: 260 }),
    fa('city', 'City', 'text', { required: true, maxLength: 60, capabilities: ALL, width: 130 }),
    fa('state', 'State', 'master', { master: 'state', required: true, width: 150 }),
    fa('pincode', 'Pincode', 'text', { required: true, format: 'pincode', maxLength: 6, width: 100 }),
    fa('lat', 'Latitude', 'number', { min: -90, max: 90, width: 110 }),
    fa('lng', 'Longitude', 'number', { min: -180, max: 180, width: 110 }),
  ],
  relationships: [],
  form: {
    quickCreate: ['customerId', 'label', 'addressType', 'line1', 'city', 'state', 'pincode', 'lat', 'lng'],
    sections: [
      { id: 'main', title: 'Address', fields: ['customerId', 'label', 'addressType', 'line1', 'city', 'state', 'pincode'], columns: 2 },
      { id: 'geo', title: 'Location', fields: ['lat', 'lng'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_adr_all',
      resource: 'addresses',
      name: 'All addresses',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'customerId', dir: 'asc' }],
      columns: cols('customerId', 'label', 'addressType', 'city', 'state', 'pincode', 'lat', 'lng'),
    },
    {
      id: 'v_adr_sites',
      resource: 'addresses',
      name: 'Installation sites',
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
  label: 'Contact',
  labelPlural: 'Contacts',
  icon: 'id-card',
  version: 1,
  idPrefix: 'CT',
  titleField: 'name',
  subtitleFields: ['designation', 'customerId'],
  ownerField: 'ownerId',
  divisionField: 'divisionIds',
  description: 'People at customer companies, plus the contact pool — prospects not linked to a company or lead yet.',
  status: 'published',
  fields: [
    fk('name', 'Name', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 190, subFields: ['designation'], leadingImage: 'initials' }),
    fk('customerId', 'Company', 'relation', { relation: { resource: 'customers' }, capabilities: ALL, width: 210, help: 'Leave empty to keep the contact in the pool.' }),
    fk('designation', 'Designation', 'text', { maxLength: 80, capabilities: ALL, width: 160 }),
    fk('department', 'Department', 'text', { maxLength: 60 }),
    fk('mobile', 'Mobile', 'phone', { format: 'mobile', sensitivity: 'contact', capabilities: ALL, width: 130 }),
    fk('whatsapp', 'WhatsApp', 'phone', { format: 'mobile', sensitivity: 'contact', capabilities: ALL, width: 130 }),
    fk('email', 'Email', 'email', { format: 'email', sensitivity: 'contact', capabilities: ALL, width: 220 }),
    fk('buyingRole', 'Buying role', 'master', { master: 'buyingRole', width: 140 }),
    fk('consentWhatsapp', 'WhatsApp consent', 'boolean', { defaultValue: false, width: 120 }),
    fk('consentEmail', 'Email consent', 'boolean', { defaultValue: false, width: 110 }),
    fk('consentSms', 'SMS consent', 'boolean', { defaultValue: false, width: 110 }),
    fk('ownerId', 'Owner', 'relation', { relation: { resource: 'employees', where: { field: 'status', op: 'neq', value: 'inactive' } }, required: true, width: 160, display: 'person', personSubtitle: 'designation' }),
    fk('divisionIds', 'Divisions', 'multimaster', { master: 'division', required: true, width: 160 }),
    fk('source', 'Source', 'master', { master: 'leadSource', width: 150 }),
    fk('poolStatus', 'Pool status', 'master', { master: 'poolStatus', defaultValue: 'new', width: 120 }),
    fk('city', 'City', 'text', { maxLength: 60, capabilities: ALL, width: 120 }),
    fk('notes', 'Notes', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  form: {
    quickCreate: ['name', 'customerId', 'designation', 'mobile', 'email', 'buyingRole', 'ownerId', 'divisionIds'],
    sections: [
      { id: 'who', title: 'Who', fields: ['name', 'customerId', 'designation', 'department', 'buyingRole', 'city'], columns: 2 },
      { id: 'reach', title: 'Reach', fields: ['mobile', 'whatsapp', 'email', 'consentWhatsapp', 'consentEmail', 'consentSms'], columns: 2 },
      { id: 'own', title: 'Ownership', fields: ['ownerId', 'divisionIds', 'source', 'poolStatus', 'notes'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_ct_all',
      resource: 'contacts',
      name: 'All contacts',
      type: 'table',
      filter: group('and', [cond('customerId', 'notEmpty')]),
      sort: [{ field: 'name', dir: 'asc' }],
      columns: cols('name', 'customerId', 'designation', 'buyingRole', 'mobile', 'email', 'consentWhatsapp', 'ownerId'),
    },
    {
      id: 'v_ct_pool',
      resource: 'contacts',
      name: 'Contact pool',
      type: 'table',
      filter: group('and', [cond('customerId', 'empty'), cond('poolStatus', 'neq', 'converted')]),
      sort: [{ field: 'name', dir: 'asc' }],
      columns: cols('name', 'designation', 'city', 'mobile', 'email', 'source', 'poolStatus', 'ownerId'),
    },
    {
      id: 'v_ct_decision',
      resource: 'contacts',
      name: 'Decision makers',
      type: 'table',
      filter: group('and', [cond('buyingRole', 'eq', 'decision_maker')]),
      sort: [{ field: 'name', dir: 'asc' }],
      columns: cols('name', 'customerId', 'designation', 'mobile', 'email', 'ownerId'),
    },
    {
      id: 'v_ct_converted',
      resource: 'contacts',
      name: 'Converted pool',
      type: 'table',
      filter: group('and', [cond('poolStatus', 'eq', 'converted')]),
      sort: [{ field: 'name', dir: 'asc' }],
      columns: cols('name', 'customerId', 'source', 'ownerId'),
    },
  ]),
};

const v = (key: string, label: string, tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent' = 'neutral') => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: ReturnType<typeof v>[]): MasterDefinition => ({ id: `mst_${key}`, key, label, version: 1, values: values.map((x, i) => ({ ...x, order: i })) });

const masters: MasterDefinition[] = [
  master('addressType', 'Address type', [v('billing', 'Billing', 'info'), v('shipping', 'Shipping'), v('installation', 'Installation site', 'accent')]),
  master('poolStatus', 'Pool status', [v('new', 'New', 'info'), v('contacted', 'Contacted', 'warning'), v('converted', 'Converted to lead', 'success')]),
  master('customerStatus', 'Customer status', [v('active', 'Active', 'success'), v('inactive', 'Inactive')]),
];

/** REQUIREMENTS §2.2 — customers & contacts column. */
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
  nav: {
    id: 'customers',
    label: 'Customers',
    icon: 'building',
    resources: ['customers', 'contacts', 'addresses'],
    pages: [{ id: 'contacts-import', label: 'Import contacts', icon: 'arrow-up', path: 'contacts/import' }],
  },
  resources: [customers, addresses, contacts],
  masters,
  permissions,
  capabilities: { admin: ['customers.merge', 'customers.transfer'], management: ['customers.transfer'], division_head: ['customers.transfer'] },
  extend: {
    admin: {
      pages: [
        { id: 'duplicates', label: 'Duplicates & merge', icon: 'copy', path: 'duplicates', capability: 'customers.merge' },
        { id: 'transfer', label: 'Ownership transfer', icon: 'users', path: 'transfer', capability: 'customers.transfer' },
      ],
    },
  },
};
