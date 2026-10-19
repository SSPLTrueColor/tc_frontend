/**
 * Installed Base resources (BRD 4.6 / 4.7): installation jobs, machines, warranties, AMC / CMC
 * contracts, training records, plus component serial numbers, usage readings and resale / relocation history.
 * Definitions only — no service imports here (domain packs load before the store). Labels: L.installed.
 */
import type { FieldDefinition, ResourceDefinition } from '../../../metadata/types';
import { addDays, todayKey } from '../../../lib/dates';
import { ALL, cols, cond, field, FORM_ONLY, group, views } from '../../helpers';
import { L } from '../../../constants/labels';

const T = L.installed;

type Extra = Partial<FieldDefinition>;
type ResKey = keyof typeof T.fields;
/** Field builder: the label comes from L.installed.fields.<resource>.<key>. */
const mk =
  <R extends ResKey>(res: R) =>
  (key: keyof (typeof T.fields)[R] & string, type: FieldDefinition['type'], extra?: Extra) =>
    field(res, key, (T.fields[res] as Record<string, string>)[key], type, extra);
const fi = mk('installations');
const fm = mk('machines');
const fw = mk('warranties');
const fc = mk('amcContracts');
const ft = mk('trainingRecords');
const fco = mk('machineComponents');
const fr = mk('machineReadings');
const fmv = mk('machineMoves');

const ENGINEERS = { field: 'roleId', op: 'in' as const, value: ['engineer', 'service_head'] };
const ACTIVE_EMP = { field: 'status', op: 'neq' as const, value: 'inactive' };
// Case-insensitive on input; hooks store serial numbers in capitals.
const SERIAL = { regex: '^[A-Za-z0-9][A-Za-z0-9/-]{3,29}$', message: T.validation.serial };
const END_AFTER_START = { op: 'gte' as const, field: 'startDate', message: T.validation.endAfterStart };

/** Site readiness checklist items (INS-03). Order = display order. */
export const READINESS_FIELDS: [string, string][] = Object.entries(T.readiness);

export const installations: ResourceDefinition = {
  id: 'res_installations',
  key: 'installations',
  module: 'installed',
  label: T.records.installations.one,
  labelPlural: T.records.installations.many,
  icon: 'calendar-clock',
  version: 1,
  idPrefix: 'INS',
  idFormat: 'fy',
  titleField: 'customerId',
  subtitleFields: ['status', 'scheduledAt'],
  ownerField: 'engineerId',
  divisionField: 'divisionId',
  description: T.descriptions.installations,
  status: 'published',
  fields: [
    fi('customerId', 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220, subFields: ['productId'] }),
    fi('salesOrderId', 'relation', { relation: { resource: 'salesOrders', filterBy: { field: 'customerId', fromField: 'customerId' } }, required: true, capabilities: ALL, width: 170 }),
    fi('productId', 'relation', { relation: { resource: 'products', where: { field: 'productType', op: 'eq', value: 'machine' } }, width: 200 }),
    fi('siteAddressId', 'relation', { relation: { resource: 'addresses', filterBy: { field: 'customerId', fromField: 'customerId' } }, width: 200 }),
    fi('divisionId', 'master', { master: 'division', width: 140 }),
    fi('engineerId', 'relation', { relation: { resource: 'employees', where: ENGINEERS }, width: 170, display: 'person', personSubtitle: 'designation' }),
    fi('scheduledAt', 'datetime', { width: 160 }),
    fi('status', 'master', { master: 'installationStatus', readOnly: true, width: 140 }),
    // Site readiness (INS-03)
    ...READINESS_FIELDS.map(([k, l]) => field('installations', k, l, 'boolean', { capabilities: FORM_ONLY })),
    fi('readinessSharedAt', 'datetime', { readOnly: true, capabilities: { form: true, export: true } }),
    fi('readinessVerifiedAt', 'datetime', { readOnly: true, capabilities: { list: true, form: true, export: true } }),
    // Handover (INS-04)
    fi('hoExpectations', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fi('hoCommitments', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fi('hoKeyContacts', 'longtext', { maxLength: 500, capabilities: FORM_ONLY }),
    fi('handoverAt', 'datetime', { readOnly: true, capabilities: { form: true, export: true } }),
    // Job card (INS-06)
    fi('jcSteps', 'multimaster', { master: 'installStep', capabilities: FORM_ONLY }),
    fi('trialResults', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fi('parameters', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fi('mediaFiles', 'text', { readOnly: true, capabilities: { form: true, export: true }, help: T.fields.installations.mediaFilesHelp }),
    fi('trainingTopics', 'multimaster', { master: 'trainingTopic', capabilities: FORM_ONLY }),
    fi('trainees', 'text', { maxLength: 300, capabilities: FORM_ONLY }),
    // Sign-off (INS-06 / INS-07)
    fi('serialNo', 'identifier', { pattern: SERIAL, maxLength: 30, capabilities: ALL, width: 150 }),
    fi('printHeads', 'number', { min: 1, max: 64, capabilities: FORM_ONLY }),
    fi('printWidth', 'number', { min: 0.3, max: 6, unit: 'm', capabilities: FORM_ONLY }),
    fi('softwareVersion', 'text', { maxLength: 40, capabilities: FORM_ONLY }),
    fi('signOffMethod', 'master', { master: 'installSignOffMethod', readOnly: true, capabilities: { form: true, export: true } }),
    fi('signedOffBy', 'text', { readOnly: true, capabilities: { form: true, export: true } }),
    fi('signatureData', 'image', { readOnly: true, capabilities: { form: true } }),
    fi('signedOffAt', 'datetime', { readOnly: true, capabilities: { list: true, sort: true, filter: true, form: true, export: true } }),
    fi('machineId', 'relation', { relation: { resource: 'machines' }, readOnly: true, capabilities: { list: true, form: true, export: true } }),
  ],
  relationships: [{ id: 'rel_ins_training', label: T.relationships.trainingRecords, resource: 'trainingRecords', foreignKey: 'installationId' }],
  lifecycle: {
    field: 'status',
    initial: 'scheduled',
    terminal: ['signed_off'],
    transitions: [
      { from: ['scheduled'], to: 'site_ready', action: T.transitions.verifySiteReadiness },
      { from: ['site_ready'], to: 'in_progress', action: T.transitions.startInstallation },
      { from: ['in_progress'], to: 'trial_training', action: T.transitions.moveToTrial },
      { from: ['site_ready'], to: 'scheduled', action: T.transitions.reopenReadiness, confirm: T.transitions.reopenReadinessConfirm },
      // "Signed off" is reached only through the sign-off dialog (OTP / signature) — see installed services.
    ],
  },
  form: {
    quickCreate: ['customerId', 'salesOrderId', 'productId', 'siteAddressId', 'engineerId', 'scheduledAt'],
    sections: [
      { id: 'job', title: T.sections.installations.job, fields: ['customerId', 'salesOrderId', 'productId', 'siteAddressId', 'divisionId', 'engineerId', 'scheduledAt'], columns: 2 },
      { id: 'readiness', title: T.sections.installations.readiness, description: T.sections.installations.readinessHelp, fields: READINESS_FIELDS.map(([k]) => k), columns: 2 },
      { id: 'handover', title: T.sections.installations.handover, fields: ['hoExpectations', 'hoCommitments', 'hoKeyContacts'], columns: 1 },
      { id: 'jobcard', title: T.sections.installations.jobcard, fields: ['jcSteps', 'trialResults', 'parameters', 'trainingTopics', 'trainees'], columns: 1 },
      { id: 'machine', title: T.sections.installations.signoff, fields: ['serialNo', 'printHeads', 'printWidth', 'softwareVersion'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_ins_open',
      resource: 'installations',
      name: T.views.installations.open,
      type: 'table',
      filter: group('and', [cond('status', 'neq', 'signed_off')]),
      sort: [{ field: 'scheduledAt', dir: 'asc' }],
      columns: cols('customerId', 'id', 'productId', 'engineerId', 'scheduledAt', 'status', 'readinessVerifiedAt', 'salesOrderId'),
    },
    {
      id: 'v_ins_board',
      resource: 'installations',
      name: T.views.installations.board,
      type: 'board',
      boardField: 'status',
      filter: group('and'),
      sort: [{ field: 'scheduledAt', dir: 'asc' }],
      columns: cols('customerId', 'productId', 'engineerId', 'scheduledAt'),
    },
    {
      id: 'v_ins_signed',
      resource: 'installations',
      name: T.views.installations.signedOff,
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'signed_off')]),
      sort: [{ field: 'signedOffAt', dir: 'desc' }],
      columns: cols('customerId', 'id', 'productId', 'serialNo', 'machineId', 'engineerId', 'signedOffAt'),
    },
    {
      id: 'v_ins_all',
      resource: 'installations',
      name: T.views.installations.all,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'scheduledAt', dir: 'desc' }],
      columns: cols('customerId', 'id', 'productId', 'divisionId', 'engineerId', 'scheduledAt', 'status', 'salesOrderId'),
    },
  ]),
};

export const machines: ResourceDefinition = {
  id: 'res_machines',
  key: 'machines',
  module: 'installed',
  label: T.records.machines.one,
  labelPlural: T.records.machines.many,
  icon: 'blocks',
  version: 1,
  idPrefix: 'M',
  titleField: 'serialNo',
  subtitleFields: ['model', 'customerId'],
  divisionField: 'divisionId',
  description: T.descriptions.machines,
  status: 'published',
  fields: [
    fm('serialNo', 'identifier', { required: true, pattern: SERIAL, maxLength: 30, capabilities: ALL, width: 150, subFields: ['model'] }),
    fm('productId', 'relation', { relation: { resource: 'products', where: { field: 'productType', op: 'eq', value: 'machine' } }, required: true, width: 200 }),
    fm('model', 'text', { maxLength: 80, capabilities: ALL, width: 180 }),
    fm('customerId', 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220 }),
    fm('siteAddressId', 'relation', { relation: { resource: 'addresses', filterBy: { field: 'customerId', fromField: 'customerId' } }, width: 200 }),
    fm('divisionId', 'master', { master: 'division', required: true, width: 140 }),
    fm('coverage', 'master', { master: 'coverage', readOnly: true, capabilities: { list: true, form: false, export: true }, width: 150 }),
    fm('printHeads', 'number', { min: 1, max: 64 }),
    fm('printWidth', 'number', { min: 0.3, max: 6, unit: 'm' }),
    fm('softwareVersion', 'text', { maxLength: 40 }),
    fm('installDate', 'date', { required: true, dateRule: 'past', width: 120 }),
    fm('purchaseDate', 'date', { dateRule: 'past' }),
    fm('salesOrderId', 'relation', { relation: { resource: 'salesOrders' }, readOnly: true }),
    fm('installationId', 'relation', { relation: { resource: 'installations' }, readOnly: true }),
    fm('status', 'master', { master: 'machineStatus', required: true, defaultValue: 'active', width: 110 }),
  ],
  relationships: [
    { id: 'rel_m_warranty', label: T.relationships.warranty, resource: 'warranties', foreignKey: 'machineId' },
    { id: 'rel_m_contracts', label: T.relationships.amcContracts, resource: 'amcContracts', foreignKey: 'machineId' },
    { id: 'rel_m_training', label: T.relationships.trainingRecords, resource: 'trainingRecords', foreignKey: 'machineId' },
  ],
  form: {
    quickCreate: ['serialNo', 'productId', 'customerId', 'siteAddressId', 'installDate'],
    sections: [
      { id: 'machine', title: T.sections.machines.machine, fields: ['serialNo', 'productId', 'model', 'divisionId', 'status'], columns: 2 },
      { id: 'config', title: T.sections.machines.config, fields: ['printHeads', 'printWidth', 'softwareVersion'], columns: 2 },
      { id: 'site', title: T.sections.machines.site, fields: ['customerId', 'siteAddressId', 'installDate', 'purchaseDate'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_m_all',
      resource: 'machines',
      name: T.views.machines.all,
      type: 'table',
      filter: group('and', [cond('status', 'neq', 'scrapped')]),
      sort: [{ field: 'installDate', dir: 'desc' }],
      columns: cols('serialNo', 'model', 'customerId', 'divisionId', 'coverage', 'installDate', 'printHeads', 'status'),
    },
    {
      id: 'v_m_uncovered',
      resource: 'machines',
      name: T.views.machines.uncovered,
      type: 'table',
      filter: group('and', [cond('coverage', 'eq', 'none'), cond('status', 'neq', 'scrapped')]),
      sort: [{ field: 'installDate', dir: 'asc' }],
      columns: cols('serialNo', 'model', 'customerId', 'divisionId', 'installDate'),
    },
    {
      id: 'v_m_by_model',
      resource: 'machines',
      name: T.views.machines.byModel,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'serialNo', dir: 'asc' }],
      groupBy: 'model',
      columns: cols('serialNo', 'customerId', 'coverage', 'installDate', 'status'),
    },
  ]),
};

/** Warranty status from dates (no store access). */
function warrantyStatus(r: Record<string, unknown>) {
  const t = todayKey();
  if (!r.startDate || !r.endDate) return null;
  if (String(r.startDate) > t) return 'future';
  if (String(r.endDate) < t) return 'expired';
  return String(r.endDate) <= addDays(t, 90) ? 'expiring' : 'active';
}

export const warranties: ResourceDefinition = {
  id: 'res_warranties',
  key: 'warranties',
  module: 'installed',
  label: T.records.warranties.one,
  labelPlural: T.records.warranties.many,
  icon: 'shield',
  version: 1,
  idPrefix: 'W',
  titleField: 'machineId',
  subtitleFields: ['endDate', 'warrantyStatus'],
  divisionField: 'divisionId',
  description: T.descriptions.warranties,
  status: 'published',
  fields: [
    fw('machineId', 'relation', { relation: { resource: 'machines' }, required: true, capabilities: ALL, width: 170 }),
    fw('customerId', 'relation', { relation: { resource: 'customers' }, readOnly: true, capabilities: ALL, width: 220 }),
    fw('coverageType', 'master', { master: 'warrantyCoverage', required: true, defaultValue: 'parts_labour', width: 140 }),
    fw('startDate', 'date', { required: true, width: 120 }),
    fw('endDate', 'date', { required: true, compare: END_AFTER_START, width: 120 }),
    fw('warrantyStatus', 'master', { master: 'warrantyStatus', readOnly: true, computed: warrantyStatus, capabilities: { list: true, export: true }, width: 150 }),
    fw('exclusions', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fw('divisionId', 'master', { master: 'division', readOnly: true }),
    fw('renewalOpportunityId', 'relation', { relation: { resource: 'opportunities' }, readOnly: true }),
    fw('remindersSent', 'text', { system: true, readOnly: true, capabilities: { form: true } }),
  ],
  relationships: [],
  form: {
    quickCreate: ['machineId', 'coverageType', 'startDate', 'endDate'],
    sections: [{ id: 'main', title: T.sections.warranties.main, fields: ['machineId', 'coverageType', 'startDate', 'endDate', 'exclusions'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_w_expiring',
      resource: 'warranties',
      name: T.views.warranties.expiring,
      type: 'table',
      filter: group('and', [cond('warrantyStatus', 'eq', 'expiring')]),
      sort: [{ field: 'endDate', dir: 'asc' }],
      columns: cols('machineId', 'customerId', 'coverageType', 'endDate', 'warrantyStatus'),
    },
    {
      id: 'v_w_all',
      resource: 'warranties',
      name: T.views.warranties.all,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'endDate', dir: 'asc' }],
      columns: cols('machineId', 'customerId', 'coverageType', 'startDate', 'endDate', 'warrantyStatus'),
    },
  ]),
};

export const amcContracts: ResourceDefinition = {
  id: 'res_amcContracts',
  key: 'amcContracts',
  module: 'installed',
  label: T.records.amcContracts.one,
  labelPlural: T.records.amcContracts.many,
  icon: 'receipt',
  version: 1,
  idPrefix: 'AMC',
  idFormat: 'fy',
  titleField: 'contractNo',
  subtitleFields: ['customerId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: T.descriptions.amcContracts,
  status: 'published',
  fields: [
    fc('contractNo', 'text', { readOnly: true, capabilities: ALL, width: 170, subFields: ['customerId'] }),
    fc('customerId', 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220 }),
    fc('machineId', 'relation', { relation: { resource: 'machines', filterBy: { field: 'customerId', fromField: 'customerId' } }, required: true, capabilities: ALL, width: 160 }),
    fc('contractType', 'master', { master: 'amcType', required: true, defaultValue: 'amc', width: 170 }),
    fc('startDate', 'date', { required: true, width: 120 }),
    fc('endDate', 'date', { required: true, compare: END_AFTER_START, width: 120 }),
    fc('pmVisitsPerYear', 'number', { required: true, min: 0, max: 12, defaultValue: 2, width: 120, help: T.fields.amcContracts.pmVisitsPerYearHelp }),
    fc('value', 'money', { required: true, min: 1, width: 140 }),
    fc('billingFrequency', 'master', { master: 'amcBilling', required: true, defaultValue: 'annual' }),
    fc('slaTerms', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY, help: T.fields.amcContracts.slaTermsHelp }),
    fc('status', 'master', { master: 'amcStatus', readOnly: true, width: 150 }),
    fc('ownerId', 'relation', { relation: { resource: 'employees', where: ACTIVE_EMP }, required: true, width: 170, display: 'person', personSubtitle: 'designation' }),
    fc('serviceOwnerId', 'relation', { relation: { resource: 'employees', where: { field: 'roleId', op: 'in', value: ['service_head', 'coordinator', 'engineer'] } }, width: 170, display: 'person', personSubtitle: 'designation' }),
    fc('divisionId', 'master', { master: 'division', readOnly: true, width: 140 }),
    fc('lostReason', 'master', { master: 'lostReason', readOnly: true }),
    fc('renewalOfId', 'relation', { relation: { resource: 'amcContracts' }, readOnly: true }),
    fc('renewedById', 'relation', { relation: { resource: 'amcContracts' }, readOnly: true }),
    fc('renewalOpportunityId', 'relation', { relation: { resource: 'opportunities' }, readOnly: true }),
    fc('remindersSent', 'text', { system: true, readOnly: true, capabilities: { form: true } }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'draft',
    terminal: ['renewed', 'expired', 'lost'],
    transitions: [
      { from: ['draft'], to: 'active', action: T.transitions.activateContract },
      { from: ['active'], to: 'due_for_renewal', action: T.transitions.markDue },
      { from: ['active', 'due_for_renewal'], to: 'expired', action: T.transitions.markExpired, confirm: T.transitions.markExpiredConfirm },
      // Renewed and Lost need extra input — use the Renew / Mark lost actions.
    ],
  },
  form: {
    quickCreate: ['customerId', 'machineId', 'contractType', 'startDate', 'endDate', 'pmVisitsPerYear', 'value', 'ownerId'],
    sections: [
      { id: 'contract', title: T.sections.amcContracts.contract, fields: ['customerId', 'machineId', 'contractType', 'startDate', 'endDate', 'pmVisitsPerYear'], columns: 2 },
      { id: 'commercial', title: T.sections.amcContracts.commercial, fields: ['value', 'billingFrequency', 'ownerId', 'serviceOwnerId', 'slaTerms'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_amc_active',
      resource: 'amcContracts',
      name: T.views.amcContracts.active,
      type: 'table',
      filter: group('and', [cond('status', 'in', ['active', 'due_for_renewal'])]),
      sort: [{ field: 'endDate', dir: 'asc' }],
      columns: cols('contractNo', 'customerId', 'machineId', 'contractType', 'endDate', 'value', 'status', 'ownerId'),
    },
    {
      id: 'v_amc_due',
      resource: 'amcContracts',
      name: T.views.amcContracts.due,
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'due_for_renewal')]),
      sort: [{ field: 'endDate', dir: 'asc' }],
      columns: cols('contractNo', 'customerId', 'machineId', 'contractType', 'endDate', 'value', 'ownerId', 'serviceOwnerId'),
    },
    {
      id: 'v_amc_board',
      resource: 'amcContracts',
      name: T.views.amcContracts.board,
      type: 'board',
      boardField: 'status',
      filter: group('and'),
      sort: [{ field: 'endDate', dir: 'asc' }],
      columns: cols('contractNo', 'customerId', 'endDate', 'value'),
    },
    {
      id: 'v_amc_all',
      resource: 'amcContracts',
      name: T.views.amcContracts.all,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'endDate', dir: 'desc' }],
      columns: cols('contractNo', 'customerId', 'machineId', 'contractType', 'startDate', 'endDate', 'value', 'status', 'lostReason'),
    },
  ]),
};

export const trainingRecords: ResourceDefinition = {
  id: 'res_trainingRecords',
  key: 'trainingRecords',
  module: 'installed',
  label: T.records.trainingRecords.one,
  labelPlural: T.records.trainingRecords.many,
  icon: 'id-card',
  version: 1,
  idPrefix: 'TR',
  titleField: 'customerId',
  subtitleFields: ['date', 'retrainingStatus'],
  ownerField: 'trainerId',
  divisionField: 'divisionId',
  description: T.descriptions.trainingRecords,
  status: 'published',
  fields: [
    ft('customerId', 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220 }),
    ft('machineId', 'relation', { relation: { resource: 'machines', filterBy: { field: 'customerId', fromField: 'customerId' } }, width: 160 }),
    ft('date', 'date', { required: true, dateRule: 'past', width: 120 }),
    ft('topics', 'multimaster', { master: 'trainingTopic', required: true, width: 240 }),
    ft('trainees', 'text', { required: true, maxLength: 300, capabilities: ALL, width: 220 }),
    ft('trainerId', 'relation', { relation: { resource: 'employees', where: ENGINEERS }, required: true, width: 170, display: 'person', personSubtitle: 'designation' }),
    ft('retrainingStatus', 'master', { master: 'retrainingStatus', required: true, defaultValue: 'none', width: 130 }),
    ft('retrainingNotes', 'longtext', { maxLength: 1000, requiredWhen: { field: 'retrainingStatus', op: 'eq', value: 'requested' }, capabilities: FORM_ONLY }),
    ft('installationId', 'relation', { relation: { resource: 'installations' }, readOnly: true }),
    ft('divisionId', 'master', { master: 'division', readOnly: true }),
  ],
  relationships: [],
  form: {
    quickCreate: ['customerId', 'machineId', 'date', 'topics', 'trainees', 'trainerId'],
    sections: [
      { id: 'training', title: T.sections.trainingRecords.training, fields: ['customerId', 'machineId', 'date', 'trainerId', 'topics', 'trainees'], columns: 2 },
      { id: 'retraining', title: T.sections.trainingRecords.retraining, fields: ['retrainingStatus', 'retrainingNotes'], columns: 1 },
    ],
  },
  views: views([
    {
      id: 'v_tr_all',
      resource: 'trainingRecords',
      name: T.views.trainingRecords.all,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'date', dir: 'desc' }],
      columns: cols('customerId', 'machineId', 'date', 'topics', 'trainees', 'trainerId', 'retrainingStatus'),
    },
    {
      id: 'v_tr_requests',
      resource: 'trainingRecords',
      name: T.views.trainingRecords.requests,
      type: 'table',
      filter: group('and', [cond('retrainingStatus', 'in', ['requested', 'scheduled'])]),
      sort: [{ field: 'date', dir: 'asc' }],
      columns: cols('customerId', 'machineId', 'retrainingStatus', 'trainerId', 'date'),
    },
  ]),
};

export const machineComponents: ResourceDefinition = {
  id: 'res_machineComponents',
  key: 'machineComponents',
  module: 'installed',
  label: T.records.machineComponents.one,
  labelPlural: T.records.machineComponents.many,
  icon: 'blocks',
  version: 1,
  idPrefix: 'MC',
  titleField: 'serialNo',
  subtitleFields: ['componentType', 'status'],
  divisionField: 'divisionId',
  description: T.descriptions.machineComponents,
  status: 'published',
  fields: [
    fco('machineId', 'relation', { relation: { resource: 'machines' }, required: true, capabilities: ALL, width: 160 }),
    fco('componentType', 'master', { master: 'machineComponentType', required: true, defaultValue: 'print_head', width: 130 }),
    fco('position', 'text', { maxLength: 20, width: 100 }),
    fco('serialNo', 'identifier', { required: true, pattern: SERIAL, maxLength: 30, capabilities: ALL, width: 150 }),
    fco('installedAt', 'date', { required: true, dateRule: 'past', width: 120 }),
    fco('status', 'master', { master: 'machineComponentStatus', required: true, defaultValue: 'in_service', width: 110 }),
    fco('replacedAt', 'date', { readOnly: true, width: 120 }),
    fco('replacedById', 'relation', { relation: { resource: 'machineComponents' }, readOnly: true }),
    fco('replacementReason', 'text', { readOnly: true, maxLength: 200 }),
    fco('divisionId', 'master', { master: 'division', readOnly: true }),
  ],
  relationships: [],
  form: {
    quickCreate: ['machineId', 'componentType', 'position', 'serialNo', 'installedAt'],
    sections: [{ id: 'main', title: T.sections.machineComponents.main, fields: ['machineId', 'componentType', 'position', 'serialNo', 'installedAt', 'status'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_mc_all',
      resource: 'machineComponents',
      name: T.views.machineComponents.all,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'installedAt', dir: 'desc' }],
      columns: cols('machineId', 'componentType', 'position', 'serialNo', 'installedAt', 'status', 'replacedAt'),
    },
  ]),
};

export const machineReadings: ResourceDefinition = {
  id: 'res_machineReadings',
  key: 'machineReadings',
  module: 'installed',
  label: T.records.machineReadings.one,
  labelPlural: T.records.machineReadings.many,
  icon: 'activity',
  version: 1,
  idPrefix: 'MR',
  titleField: 'machineId',
  subtitleFields: ['readingDate', 'printCounter'],
  ownerField: 'recordedById',
  divisionField: 'divisionId',
  description: T.descriptions.machineReadings,
  status: 'published',
  fields: [
    fr('machineId', 'relation', { relation: { resource: 'machines' }, required: true, capabilities: ALL, width: 160 }),
    fr('readingDate', 'date', { required: true, dateRule: 'past', width: 120 }),
    fr('printCounter', 'number', { required: true, min: 0, unit: 'm²', width: 140 }),
    fr('inkConsumptionMl', 'number', { min: 0, unit: 'ml', width: 170 }),
    fr('source', 'master', { master: 'machineReadingSource', required: true, defaultValue: 'visit', width: 140 }),
    fr('recordedById', 'relation', { relation: { resource: 'employees' }, required: true, width: 170 }),
    fr('notes', 'longtext', { maxLength: 500, capabilities: FORM_ONLY }),
    fr('divisionId', 'master', { master: 'division', readOnly: true }),
  ],
  relationships: [],
  form: {
    quickCreate: ['machineId', 'readingDate', 'printCounter', 'inkConsumptionMl', 'source', 'recordedById'],
    sections: [{ id: 'main', title: T.sections.machineReadings.main, fields: ['machineId', 'readingDate', 'printCounter', 'inkConsumptionMl', 'source', 'recordedById', 'notes'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_mr_recent',
      resource: 'machineReadings',
      name: T.views.machineReadings.recent,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'readingDate', dir: 'desc' }],
      columns: cols('machineId', 'readingDate', 'printCounter', 'inkConsumptionMl', 'source', 'recordedById'),
    },
  ]),
};

export const machineMoves: ResourceDefinition = {
  id: 'res_machineMoves',
  key: 'machineMoves',
  module: 'installed',
  label: T.records.machineMoves.one,
  labelPlural: T.records.machineMoves.many,
  icon: 'reset',
  version: 1,
  idPrefix: 'MV',
  titleField: 'machineId',
  subtitleFields: ['moveType', 'moveDate'],
  divisionField: 'divisionId',
  description: T.descriptions.machineMoves,
  status: 'published',
  fields: [
    fmv('machineId', 'relation', { relation: { resource: 'machines' }, required: true, readOnly: true, capabilities: ALL, width: 160 }),
    fmv('moveType', 'master', { master: 'machineMoveType', required: true, readOnly: true, width: 180 }),
    fmv('moveDate', 'date', { required: true, readOnly: true, width: 120 }),
    fmv('fromCustomerId', 'relation', { relation: { resource: 'customers' }, readOnly: true, width: 200 }),
    fmv('toCustomerId', 'relation', { relation: { resource: 'customers' }, readOnly: true, width: 200 }),
    fmv('fromSiteAddressId', 'relation', { relation: { resource: 'addresses' }, readOnly: true }),
    fmv('toSiteAddressId', 'relation', { relation: { resource: 'addresses' }, readOnly: true }),
    fmv('reason', 'text', { readOnly: true, maxLength: 300, capabilities: { list: true, search: true, form: true } }),
    fmv('divisionId', 'master', { master: 'division', readOnly: true }),
  ],
  relationships: [],
  form: { quickCreate: [], sections: [{ id: 'main', title: T.sections.machineMoves.main, fields: ['machineId', 'moveType', 'moveDate', 'fromCustomerId', 'toCustomerId', 'fromSiteAddressId', 'toSiteAddressId', 'reason'], columns: 2 }] },
  views: views([
    {
      id: 'v_mv_all',
      resource: 'machineMoves',
      name: T.views.machineMoves.all,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'moveDate', dir: 'desc' }],
      columns: cols('machineId', 'moveType', 'moveDate', 'fromCustomerId', 'toCustomerId', 'reason'),
    },
  ]),
};

export const installedResources = [installations, machines, warranties, amcContracts, trainingRecords, machineComponents, machineReadings, machineMoves];
