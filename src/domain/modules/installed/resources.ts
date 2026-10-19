/**
 * Installed base resources (BRD 4.6 / 4.7): installation jobs, machines, warranties, AMC/CMC
 * contracts, training records, plus machine components, readings and ownership moves.
 * Definitions only — no service imports here (domain packs load before the store).
 */
import type { FieldDefinition, ResourceDefinition } from '../../../metadata/types';
import { addDays, todayKey } from '../../../lib/dates';
import { ALL, cols, cond, field, FORM_ONLY, group, views } from '../../helpers';

type Extra = Partial<FieldDefinition>;
const mk = (res: string) => (key: string, label: string, type: FieldDefinition['type'], extra?: Extra) => field(res, key, label, type, extra);
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
const SERIAL = { regex: '^[A-Z0-9][A-Z0-9/-]{3,29}$', message: 'Use 4–30 capital letters, digits, "-" or "/"' };

/** Readiness checklist items (INS-03). Order = display order. */
export const READINESS_FIELDS: [string, string][] = [
  ['rdPower', 'Power supply (3-phase, stable)'],
  ['rdEarthing', 'Earthing'],
  ['rdUps', 'UPS / stabiliser'],
  ['rdClimate', 'Temperature & humidity'],
  ['rdSpace', 'Floor space & access'],
  ['rdAir', 'Compressed air'],
  ['rdNetwork', 'Network / RIP PC'],
];

export const installations: ResourceDefinition = {
  id: 'res_installations',
  key: 'installations',
  module: 'installed',
  label: 'Installation job',
  labelPlural: 'Installation jobs',
  icon: 'calendar-clock',
  version: 1,
  idPrefix: 'INS',
  idFormat: 'fy',
  titleField: 'customerId',
  subtitleFields: ['status', 'scheduledAt'],
  ownerField: 'engineerId',
  divisionField: 'divisionId',
  description: 'Delivery to sign-off: site readiness, sales-to-service handover, installation job card, training and customer sign-off. Sign-off creates the machine, warranty and PM schedule.',
  status: 'published',
  fields: [
    fi('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220, subFields: ['productId'] }),
    fi('salesOrderId', 'Sales order', 'relation', { relation: { resource: 'salesOrders', filterBy: { field: 'customerId', fromField: 'customerId' } }, required: true, capabilities: ALL, width: 170 }),
    fi('productId', 'Machine model', 'relation', { relation: { resource: 'products', where: { field: 'productType', op: 'eq', value: 'machine' } }, width: 200 }),
    fi('siteAddressId', 'Installation site', 'relation', { relation: { resource: 'addresses', filterBy: { field: 'customerId', fromField: 'customerId' } }, width: 200 }),
    fi('divisionId', 'Division', 'master', { master: 'division', width: 140 }),
    fi('engineerId', 'Engineer', 'relation', { relation: { resource: 'employees', where: ENGINEERS }, width: 170, display: 'person', personSubtitle: 'designation' }),
    fi('scheduledAt', 'Scheduled for', 'datetime', { width: 160 }),
    fi('status', 'Status', 'master', { master: 'installationStatus', readOnly: true, width: 140 }),
    // Site readiness (INS-03)
    ...READINESS_FIELDS.map(([k, l]) => fi(k, l, 'boolean', { capabilities: FORM_ONLY })),
    fi('readinessSharedAt', 'Checklist shared with customer', 'datetime', { readOnly: true, capabilities: { form: true, export: true } }),
    fi('readinessVerifiedAt', 'Readiness verified', 'datetime', { readOnly: true, capabilities: { list: true, form: true, export: true } }),
    // Handover (INS-04)
    fi('hoExpectations', 'Customer expectations', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fi('hoCommitments', 'Special commitments made during the sale', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fi('hoKeyContacts', 'Key contacts at site', 'longtext', { maxLength: 500, capabilities: FORM_ONLY }),
    fi('handoverAt', 'Handover completed', 'datetime', { readOnly: true, capabilities: { form: true, export: true } }),
    // Job card (INS-06)
    fi('jcSteps', 'Steps completed', 'multimaster', { master: 'installStep', capabilities: FORM_ONLY }),
    fi('trialResults', 'Trial printing results', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fi('parameters', 'Parameters (head voltage, temperatures, profiles)', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fi('mediaFiles', 'Photos / videos', 'text', { readOnly: true, capabilities: { form: true, export: true }, help: 'Attach with “Add photo / video” — file names only in this prototype.' }),
    fi('trainingTopics', 'Training given', 'multimaster', { master: 'trainingTopic', capabilities: FORM_ONLY }),
    fi('trainees', 'Trainees (names)', 'text', { maxLength: 300, capabilities: FORM_ONLY }),
    // Sign-off (INS-06 / INS-07)
    fi('serialNo', 'Machine serial no.', 'identifier', { pattern: SERIAL, maxLength: 30, capabilities: ALL, width: 150 }),
    fi('printHeads', 'Print heads', 'number', { min: 1, max: 64, capabilities: FORM_ONLY }),
    fi('printWidth', 'Printing width', 'number', { min: 0.3, max: 6, unit: 'm', capabilities: FORM_ONLY }),
    fi('softwareVersion', 'RIP / firmware version', 'text', { maxLength: 40, capabilities: FORM_ONLY }),
    fi('signOffMethod', 'Sign-off method', 'master', { master: 'installSignOffMethod', readOnly: true, capabilities: { form: true, export: true } }),
    fi('signedOffBy', 'Signed off by (customer)', 'text', { readOnly: true, capabilities: { form: true, export: true } }),
    fi('signatureData', 'Customer signature', 'image', { readOnly: true, capabilities: { form: true } }),
    fi('signedOffAt', 'Signed off', 'datetime', { readOnly: true, capabilities: { list: true, sort: true, filter: true, form: true, export: true } }),
    fi('machineId', 'Machine created', 'relation', { relation: { resource: 'machines' }, readOnly: true, capabilities: { list: true, form: true, export: true } }),
  ],
  relationships: [{ id: 'rel_ins_training', label: 'Training records', resource: 'trainingRecords', foreignKey: 'installationId' }],
  lifecycle: {
    field: 'status',
    initial: 'scheduled',
    terminal: ['signed_off'],
    transitions: [
      { from: ['scheduled'], to: 'site_ready', action: 'Verify site readiness' },
      { from: ['site_ready'], to: 'in_progress', action: 'Start installation' },
      { from: ['in_progress'], to: 'trial_training', action: 'Move to trial & training' },
      { from: ['site_ready'], to: 'scheduled', action: 'Reopen readiness check', confirm: 'Move the job back to Scheduled? Readiness must be verified again.' },
      // "Signed off" is reached only through the sign-off dialog (OTP / signature) — see installed services.
    ],
  },
  form: {
    quickCreate: ['customerId', 'salesOrderId', 'productId', 'siteAddressId', 'engineerId', 'scheduledAt'],
    sections: [
      { id: 'job', title: 'Job', fields: ['customerId', 'salesOrderId', 'productId', 'siteAddressId', 'divisionId', 'engineerId', 'scheduledAt'], columns: 2 },
      { id: 'readiness', title: 'Site readiness', description: 'Every item must be verified by the engineer before installation starts.', fields: READINESS_FIELDS.map(([k]) => k), columns: 2 },
      { id: 'handover', title: 'Sales-to-service handover', fields: ['hoExpectations', 'hoCommitments', 'hoKeyContacts'], columns: 1 },
      { id: 'jobcard', title: 'Job card', fields: ['jcSteps', 'trialResults', 'parameters', 'trainingTopics', 'trainees'], columns: 1 },
      { id: 'machine', title: 'Machine details (for sign-off)', fields: ['serialNo', 'printHeads', 'printWidth', 'softwareVersion'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_ins_open',
      resource: 'installations',
      name: 'Open jobs',
      type: 'table',
      filter: group('and', [cond('status', 'neq', 'signed_off')]),
      sort: [{ field: 'scheduledAt', dir: 'asc' }],
      columns: cols('customerId', 'id', 'productId', 'engineerId', 'scheduledAt', 'status', 'readinessVerifiedAt', 'salesOrderId'),
    },
    {
      id: 'v_ins_board',
      resource: 'installations',
      name: 'Board',
      type: 'board',
      boardField: 'status',
      filter: group('and'),
      sort: [{ field: 'scheduledAt', dir: 'asc' }],
      columns: cols('customerId', 'productId', 'engineerId', 'scheduledAt'),
    },
    {
      id: 'v_ins_signed',
      resource: 'installations',
      name: 'Signed off',
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'signed_off')]),
      sort: [{ field: 'signedOffAt', dir: 'desc' }],
      columns: cols('customerId', 'id', 'productId', 'serialNo', 'machineId', 'engineerId', 'signedOffAt'),
    },
    {
      id: 'v_ins_all',
      resource: 'installations',
      name: 'All',
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
  label: 'Machine',
  labelPlural: 'Machines',
  icon: 'blocks',
  version: 1,
  idPrefix: 'M',
  titleField: 'serialNo',
  subtitleFields: ['model', 'customerId'],
  divisionField: 'divisionId',
  description: 'Installed base: every machine in the field with its configuration, owner, site, warranty and contract.',
  status: 'published',
  fields: [
    fm('serialNo', 'Serial no.', 'identifier', { required: true, pattern: SERIAL, maxLength: 30, capabilities: ALL, width: 150, subFields: ['model'] }),
    fm('productId', 'Product', 'relation', { relation: { resource: 'products', where: { field: 'productType', op: 'eq', value: 'machine' } }, required: true, width: 200 }),
    fm('model', 'Model', 'text', { maxLength: 80, capabilities: ALL, width: 180 }),
    fm('customerId', 'Current owner', 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220 }),
    fm('siteAddressId', 'Site', 'relation', { relation: { resource: 'addresses', filterBy: { field: 'customerId', fromField: 'customerId' } }, width: 200 }),
    fm('divisionId', 'Division', 'master', { master: 'division', required: true, width: 140 }),
    fm('coverage', 'Coverage today', 'master', { master: 'coverage', readOnly: true, capabilities: { list: true, form: false, export: true }, width: 150 }),
    fm('printHeads', 'Print heads', 'number', { min: 1, max: 64 }),
    fm('printWidth', 'Printing width', 'number', { min: 0.3, max: 6, unit: 'm' }),
    fm('softwareVersion', 'RIP / firmware version', 'text', { maxLength: 40 }),
    fm('installDate', 'Installed on', 'date', { required: true, dateRule: 'past', width: 120 }),
    fm('purchaseDate', 'Purchased on', 'date', { dateRule: 'past' }),
    fm('salesOrderId', 'Sales order', 'relation', { relation: { resource: 'salesOrders' }, readOnly: true }),
    fm('installationId', 'Installation job', 'relation', { relation: { resource: 'installations' }, readOnly: true }),
    fm('status', 'Status', 'master', { master: 'machineStatus', required: true, defaultValue: 'active', width: 110 }),
  ],
  relationships: [
    { id: 'rel_m_warranty', label: 'Warranty', resource: 'warranties', foreignKey: 'machineId' },
    { id: 'rel_m_contracts', label: 'AMC / CMC contracts', resource: 'amcContracts', foreignKey: 'machineId' },
    { id: 'rel_m_training', label: 'Training records', resource: 'trainingRecords', foreignKey: 'machineId' },
  ],
  form: {
    quickCreate: ['serialNo', 'productId', 'customerId', 'siteAddressId', 'installDate'],
    sections: [
      { id: 'machine', title: 'Machine', fields: ['serialNo', 'productId', 'model', 'divisionId', 'status'], columns: 2 },
      { id: 'config', title: 'Configuration', fields: ['printHeads', 'printWidth', 'softwareVersion'], columns: 2 },
      { id: 'site', title: 'Owner & site', fields: ['customerId', 'siteAddressId', 'installDate', 'purchaseDate'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_m_all',
      resource: 'machines',
      name: 'Installed base',
      type: 'table',
      filter: group('and', [cond('status', 'neq', 'scrapped')]),
      sort: [{ field: 'installDate', dir: 'desc' }],
      columns: cols('serialNo', 'model', 'customerId', 'divisionId', 'coverage', 'installDate', 'printHeads', 'status'),
    },
    {
      id: 'v_m_uncovered',
      resource: 'machines',
      name: 'No contract (upsell)',
      type: 'table',
      filter: group('and', [cond('coverage', 'eq', 'none'), cond('status', 'neq', 'scrapped')]),
      sort: [{ field: 'installDate', dir: 'asc' }],
      columns: cols('serialNo', 'model', 'customerId', 'divisionId', 'installDate'),
    },
    {
      id: 'v_m_by_model',
      resource: 'machines',
      name: 'By model',
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
  label: 'Warranty',
  labelPlural: 'Warranties',
  icon: 'shield',
  version: 1,
  idPrefix: 'W',
  titleField: 'machineId',
  subtitleFields: ['endDate', 'warrantyStatus'],
  divisionField: 'divisionId',
  description: 'Manufacturer warranty per machine. Ticket logging checks it automatically.',
  status: 'published',
  fields: [
    fw('machineId', 'Machine', 'relation', { relation: { resource: 'machines' }, required: true, capabilities: ALL, width: 170 }),
    fw('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, readOnly: true, capabilities: ALL, width: 220 }),
    fw('coverageType', 'Coverage', 'master', { master: 'warrantyCoverage', required: true, defaultValue: 'parts_labour', width: 140 }),
    fw('startDate', 'Starts', 'date', { required: true, width: 120 }),
    fw('endDate', 'Ends', 'date', { required: true, compare: { op: 'gte', field: 'startDate', message: 'End date must be after the start date' }, width: 120 }),
    fw('warrantyStatus', 'Status', 'master', { master: 'warrantyStatus', readOnly: true, computed: warrantyStatus, capabilities: { list: true, export: true }, width: 150 }),
    fw('exclusions', 'Exclusions', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fw('divisionId', 'Division', 'master', { master: 'division', readOnly: true }),
  ],
  relationships: [],
  form: {
    quickCreate: ['machineId', 'coverageType', 'startDate', 'endDate'],
    sections: [{ id: 'main', title: 'Warranty', fields: ['machineId', 'coverageType', 'startDate', 'endDate', 'exclusions'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_w_expiring',
      resource: 'warranties',
      name: 'Expiring ≤ 90 days',
      type: 'table',
      filter: group('and', [cond('warrantyStatus', 'eq', 'expiring')]),
      sort: [{ field: 'endDate', dir: 'asc' }],
      columns: cols('machineId', 'customerId', 'coverageType', 'endDate', 'warrantyStatus'),
    },
    {
      id: 'v_w_all',
      resource: 'warranties',
      name: 'All',
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
  label: 'AMC / CMC contract',
  labelPlural: 'AMC / CMC contracts',
  icon: 'receipt',
  version: 1,
  idPrefix: 'AMC',
  idFormat: 'fy',
  titleField: 'contractNo',
  subtitleFields: ['customerId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: 'Annual (labour) and comprehensive maintenance contracts. Renewal reminders go out 90 / 60 / 30 days before expiry.',
  status: 'published',
  fields: [
    fc('contractNo', 'Contract no.', 'text', { readOnly: true, capabilities: ALL, width: 170, subFields: ['customerId'] }),
    fc('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220 }),
    fc('machineId', 'Machine', 'relation', { relation: { resource: 'machines', filterBy: { field: 'customerId', fromField: 'customerId' } }, required: true, capabilities: ALL, width: 160 }),
    fc('contractType', 'Type', 'master', { master: 'amcType', required: true, defaultValue: 'amc', width: 170 }),
    fc('startDate', 'Starts', 'date', { required: true, width: 120 }),
    fc('endDate', 'Ends', 'date', { required: true, compare: { op: 'gte', field: 'startDate', message: 'End date must be after the start date' }, width: 120 }),
    fc('pmVisitsPerYear', 'PM visits / year', 'number', { required: true, min: 0, max: 12, defaultValue: 2, width: 120 }),
    fc('value', 'Contract value', 'money', { required: true, min: 1, width: 140 }),
    fc('billingFrequency', 'Billing', 'master', { master: 'amcBilling', required: true, defaultValue: 'annual' }),
    fc('slaTerms', 'SLA terms', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY, help: 'Response / on-site / resolution commitments. Defaults follow the SLA policy for the contract type.' }),
    fc('status', 'Status', 'master', { master: 'amcStatus', readOnly: true, width: 150 }),
    fc('ownerId', 'Sales owner', 'relation', { relation: { resource: 'employees', where: ACTIVE_EMP }, required: true, width: 170, display: 'person', personSubtitle: 'designation' }),
    fc('serviceOwnerId', 'Service owner', 'relation', { relation: { resource: 'employees', where: { field: 'roleId', op: 'in', value: ['service_head', 'coordinator', 'engineer'] } }, width: 170, display: 'person', personSubtitle: 'designation' }),
    fc('divisionId', 'Division', 'master', { master: 'division', readOnly: true, width: 140 }),
    fc('lostReason', 'Lost reason', 'master', { master: 'lostReason', readOnly: true }),
    fc('renewalOfId', 'Renewal of', 'relation', { relation: { resource: 'amcContracts' }, readOnly: true }),
    fc('renewedById', 'Renewed by', 'relation', { relation: { resource: 'amcContracts' }, readOnly: true }),
    fc('renewalOpportunityId', 'Renewal opportunity', 'relation', { relation: { resource: 'opportunities' }, readOnly: true }),
    fc('remindersSent', 'Reminders sent (days before)', 'text', { system: true, readOnly: true, capabilities: { form: true } }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'draft',
    terminal: ['renewed', 'expired', 'lost'],
    transitions: [
      { from: ['draft'], to: 'active', action: 'Activate contract' },
      { from: ['active'], to: 'due_for_renewal', action: 'Mark due for renewal' },
      { from: ['active', 'due_for_renewal'], to: 'expired', action: 'Mark expired', confirm: 'Mark this contract expired? Its machine will show no contract coverage after the end date.' },
      // Renewed and Lost need extra input — use the Renew / Mark lost actions.
    ],
  },
  form: {
    quickCreate: ['customerId', 'machineId', 'contractType', 'startDate', 'endDate', 'pmVisitsPerYear', 'value', 'ownerId'],
    sections: [
      { id: 'contract', title: 'Contract', fields: ['customerId', 'machineId', 'contractType', 'startDate', 'endDate', 'pmVisitsPerYear'], columns: 2 },
      { id: 'commercial', title: 'Commercial', fields: ['value', 'billingFrequency', 'ownerId', 'serviceOwnerId', 'slaTerms'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_amc_active',
      resource: 'amcContracts',
      name: 'Active',
      type: 'table',
      filter: group('and', [cond('status', 'in', ['active', 'due_for_renewal'])]),
      sort: [{ field: 'endDate', dir: 'asc' }],
      columns: cols('contractNo', 'customerId', 'machineId', 'contractType', 'endDate', 'value', 'status', 'ownerId'),
    },
    {
      id: 'v_amc_due',
      resource: 'amcContracts',
      name: 'Due for renewal',
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'due_for_renewal')]),
      sort: [{ field: 'endDate', dir: 'asc' }],
      columns: cols('contractNo', 'customerId', 'machineId', 'contractType', 'endDate', 'value', 'ownerId', 'serviceOwnerId'),
    },
    {
      id: 'v_amc_board',
      resource: 'amcContracts',
      name: 'Board',
      type: 'board',
      boardField: 'status',
      filter: group('and'),
      sort: [{ field: 'endDate', dir: 'asc' }],
      columns: cols('contractNo', 'customerId', 'endDate', 'value'),
    },
    {
      id: 'v_amc_all',
      resource: 'amcContracts',
      name: 'All',
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
  label: 'Training record',
  labelPlural: 'Training records',
  icon: 'id-card',
  version: 1,
  idPrefix: 'TR',
  titleField: 'customerId',
  subtitleFields: ['date', 'retrainingStatus'],
  ownerField: 'trainerId',
  divisionField: 'divisionId',
  description: 'Operator training given at installation and later, plus customer re-training requests.',
  status: 'published',
  fields: [
    ft('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220 }),
    ft('machineId', 'Machine', 'relation', { relation: { resource: 'machines', filterBy: { field: 'customerId', fromField: 'customerId' } }, width: 160 }),
    ft('date', 'Trained on', 'date', { required: true, dateRule: 'past', width: 120 }),
    ft('topics', 'Topics', 'multimaster', { master: 'trainingTopic', required: true, width: 240 }),
    ft('trainees', 'Trainees', 'text', { required: true, maxLength: 300, capabilities: ALL, width: 220 }),
    ft('trainerId', 'Trainer', 'relation', { relation: { resource: 'employees', where: ENGINEERS }, required: true, width: 170, display: 'person', personSubtitle: 'designation' }),
    ft('retrainingStatus', 'Re-training', 'master', { master: 'retrainingStatus', required: true, defaultValue: 'none', width: 130 }),
    ft('retrainingNotes', 'Re-training request', 'longtext', { maxLength: 1000, requiredWhen: { field: 'retrainingStatus', op: 'eq', value: 'requested' }, capabilities: FORM_ONLY }),
    ft('installationId', 'Installation job', 'relation', { relation: { resource: 'installations' }, readOnly: true }),
    ft('divisionId', 'Division', 'master', { master: 'division', readOnly: true }),
  ],
  relationships: [],
  form: {
    quickCreate: ['customerId', 'machineId', 'date', 'topics', 'trainees', 'trainerId'],
    sections: [
      { id: 'training', title: 'Training', fields: ['customerId', 'machineId', 'date', 'trainerId', 'topics', 'trainees'], columns: 2 },
      { id: 'retraining', title: 'Re-training', fields: ['retrainingStatus', 'retrainingNotes'], columns: 1 },
    ],
  },
  views: views([
    {
      id: 'v_tr_all',
      resource: 'trainingRecords',
      name: 'All training',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'date', dir: 'desc' }],
      columns: cols('customerId', 'machineId', 'date', 'topics', 'trainees', 'trainerId', 'retrainingStatus'),
    },
    {
      id: 'v_tr_requests',
      resource: 'trainingRecords',
      name: 'Re-training requests',
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
  label: 'Machine component',
  labelPlural: 'Machine components',
  icon: 'blocks',
  version: 1,
  idPrefix: 'MC',
  titleField: 'serialNo',
  subtitleFields: ['componentType', 'status'],
  divisionField: 'divisionId',
  description: 'Serial-numbered components (print heads, boards) with replacement history.',
  status: 'published',
  fields: [
    fco('machineId', 'Machine', 'relation', { relation: { resource: 'machines' }, required: true, capabilities: ALL, width: 160 }),
    fco('componentType', 'Component', 'master', { master: 'machineComponentType', required: true, defaultValue: 'print_head', width: 130 }),
    fco('position', 'Position / slot', 'text', { maxLength: 20, width: 100 }),
    fco('serialNo', 'Serial no.', 'identifier', { required: true, pattern: SERIAL, maxLength: 30, capabilities: ALL, width: 150 }),
    fco('installedAt', 'Fitted on', 'date', { required: true, dateRule: 'past', width: 120 }),
    fco('status', 'Status', 'master', { master: 'machineComponentStatus', required: true, defaultValue: 'in_service', width: 110 }),
    fco('replacedAt', 'Replaced on', 'date', { readOnly: true, width: 120 }),
    fco('replacedById', 'Replaced by', 'relation', { relation: { resource: 'machineComponents' }, readOnly: true }),
    fco('replacementReason', 'Replacement reason', 'text', { readOnly: true, maxLength: 200 }),
    fco('divisionId', 'Division', 'master', { master: 'division', readOnly: true }),
  ],
  relationships: [],
  form: {
    quickCreate: ['machineId', 'componentType', 'position', 'serialNo', 'installedAt'],
    sections: [{ id: 'main', title: 'Component', fields: ['machineId', 'componentType', 'position', 'serialNo', 'installedAt', 'status'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_mc_all',
      resource: 'machineComponents',
      name: 'All components',
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
  label: 'Usage reading',
  labelPlural: 'Usage readings',
  icon: 'activity',
  version: 1,
  idPrefix: 'MR',
  titleField: 'machineId',
  subtitleFields: ['readingDate', 'printCounter'],
  ownerField: 'recordedById',
  divisionField: 'divisionId',
  description: 'Print counters and ink consumption recorded during visits — input to consumables forecasting.',
  status: 'published',
  fields: [
    fr('machineId', 'Machine', 'relation', { relation: { resource: 'machines' }, required: true, capabilities: ALL, width: 160 }),
    fr('readingDate', 'Reading date', 'date', { required: true, dateRule: 'past', width: 120 }),
    fr('printCounter', 'Print counter', 'number', { required: true, min: 0, unit: 'm²', width: 140 }),
    fr('inkConsumptionMl', 'Ink used since last reading', 'number', { min: 0, unit: 'ml', width: 170 }),
    fr('source', 'Source', 'master', { master: 'machineReadingSource', required: true, defaultValue: 'visit', width: 140 }),
    fr('recordedById', 'Recorded by', 'relation', { relation: { resource: 'employees' }, required: true, width: 170 }),
    fr('notes', 'Notes', 'longtext', { maxLength: 500, capabilities: FORM_ONLY }),
    fr('divisionId', 'Division', 'master', { master: 'division', readOnly: true }),
  ],
  relationships: [],
  form: {
    quickCreate: ['machineId', 'readingDate', 'printCounter', 'inkConsumptionMl', 'source', 'recordedById'],
    sections: [{ id: 'main', title: 'Reading', fields: ['machineId', 'readingDate', 'printCounter', 'inkConsumptionMl', 'source', 'recordedById', 'notes'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_mr_recent',
      resource: 'machineReadings',
      name: 'Recent readings',
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
  label: 'Ownership / site change',
  labelPlural: 'Ownership & site history',
  icon: 'reset',
  version: 1,
  idPrefix: 'MV',
  titleField: 'machineId',
  subtitleFields: ['moveType', 'moveDate'],
  divisionField: 'divisionId',
  description: 'Resale and relocation history of machines (IB-01). Written by the Relocate / transfer action.',
  status: 'published',
  fields: [
    fmv('machineId', 'Machine', 'relation', { relation: { resource: 'machines' }, required: true, readOnly: true, capabilities: ALL, width: 160 }),
    fmv('moveType', 'Change', 'master', { master: 'machineMoveType', required: true, readOnly: true, width: 180 }),
    fmv('moveDate', 'Effective', 'date', { required: true, readOnly: true, width: 120 }),
    fmv('fromCustomerId', 'From owner', 'relation', { relation: { resource: 'customers' }, readOnly: true, width: 200 }),
    fmv('toCustomerId', 'To owner', 'relation', { relation: { resource: 'customers' }, readOnly: true, width: 200 }),
    fmv('fromSiteAddressId', 'From site', 'relation', { relation: { resource: 'addresses' }, readOnly: true }),
    fmv('toSiteAddressId', 'To site', 'relation', { relation: { resource: 'addresses' }, readOnly: true }),
    fmv('reason', 'Reason', 'text', { readOnly: true, maxLength: 300, capabilities: { list: true, search: true, form: true } }),
    fmv('divisionId', 'Division', 'master', { master: 'division', readOnly: true }),
  ],
  relationships: [],
  form: { quickCreate: [], sections: [{ id: 'main', title: 'Change', fields: ['machineId', 'moveType', 'moveDate', 'fromCustomerId', 'toCustomerId', 'fromSiteAddressId', 'toSiteAddressId', 'reason'], columns: 2 }] },
  views: views([
    {
      id: 'v_mv_all',
      resource: 'machineMoves',
      name: 'History',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'moveDate', dir: 'desc' }],
      columns: cols('machineId', 'moveType', 'moveDate', 'fromCustomerId', 'toCustomerId', 'reason'),
    },
  ]),
};

export const installedResources = [installations, machines, warranties, amcContracts, trainingRecords, machineComponents, machineReadings, machineMoves];
