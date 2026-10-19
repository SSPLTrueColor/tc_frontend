/**
 * Opportunities module (BRD 4.3, FR-027 – FR-034): qualified deals through stages to Won / Lost,
 * demo bookings on demo-centre machines, sample print requests to Profiling.
 * Lists live in the "Sales" nav (owned by the leads module) via `extend`.
 */
import type { MasterDefinition, MasterValue, ResourceDefinition, ResourcePermission, RowScope, Tone } from '../../metadata/types';
import { todayKey } from '../../lib/dates';
import { nowMs } from '../../lib/clock';
import { ALL, cols, cond, field, FORM_ONLY, group, NO_SEARCH, views } from '../helpers';
import type { ModulePack } from './types';

// Local copy of pack.ts `p` — importing it from ../pack would be circular (pack imports this file).
const p = (read: RowScope, update: RowScope = 'none', create = false, del = false, exp = false): ResourcePermission => ({ read, update, create, delete: del, export: exp, sensitive_data: true });

type FieldType = Parameters<typeof field>[3];
type Extra = Parameters<typeof field>[4];
const fo = (key: string, label: string, type: FieldType, extra?: Extra) => field('opportunities', key, label, type, extra);
const fd = (key: string, label: string, type: FieldType, extra?: Extra) => field('demos', key, label, type, extra);
const fs = (key: string, label: string, type: FieldType, extra?: Extra) => field('sampleRequests', key, label, type, extra);
const fm = (key: string, label: string, type: FieldType, extra?: Extra) => field('demoMachines', key, label, type, extra);

const mv = (key: string, label: string, tone: Tone = 'neutral'): Omit<MasterValue, 'order'> => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[], description?: string): MasterDefinition => ({
  id: `mst_${key}`,
  key,
  label,
  description,
  version: 1,
  values: values.map((x, i) => ({ ...x, order: i })),
});

export const OPEN_STAGES = ['needs_assessment', 'demo', 'proposal', 'negotiation'];

const masters: MasterDefinition[] = [
  master('oppStage', 'Opportunity stage', [
    mv('needs_assessment', 'Needs assessment', 'info'),
    mv('demo', 'Demo / sample', 'info'),
    mv('proposal', 'Proposal / quotation', 'accent'),
    mv('negotiation', 'Negotiation', 'warning'),
    mv('won', 'Won', 'success'),
    mv('lost', 'Lost', 'danger'),
  ]),
  master('oppType', 'Opportunity type', [mv('new_machine', 'New machine', 'accent'), mv('upgrade', 'Upgrade / additional machine', 'info'), mv('consumables', 'Consumables contract'), mv('amc', 'AMC / CMC'), mv('renewal', 'AMC renewal', 'warning')]),
  master('demoLocation', 'Demo location', [mv('centre', 'Demo centre', 'accent'), mv('site', 'Customer site', 'info')]),
  master('demoStatus', 'Demo status', [mv('requested', 'Requested', 'info'), mv('scheduled', 'Scheduled', 'accent'), mv('done', 'Done', 'success'), mv('cancelled', 'Cancelled')]),
  master('sampleStatus', 'Sample request status', [mv('requested', 'Requested', 'info'), mv('in_progress', 'Printing', 'warning'), mv('results_shared', 'Results shared', 'success'), mv('cancelled', 'Cancelled')]),
  master('demoMachineStatus', 'Demo machine status', [mv('active', 'Available', 'success'), mv('maintenance', 'Under maintenance', 'warning'), mv('inactive', 'Retired')]),
];

// Domain packs must not import services (the store imports the pack while seeding), so the
// configurable stagnation window is injected by src/domain/extensions/opportunities.tsx.
let stagnationDays = () => 14;
export function configureStagnationDays(fn: () => number) {
  stagnationDays = fn;
}

/** BR-12: open, and no activity for N days or past the expected close date. */
export function isStagnant(r: Record<string, unknown>): boolean {
  if (!OPEN_STAGES.includes(String(r.stage))) return false;
  const last = String(r.lastActivityAt || r.updatedAt || r.createdAt || '');
  const idleDays = last ? (nowMs() - new Date(last).getTime()) / 86_400_000 : 0;
  return idleDays > stagnationDays() || (!!r.expectedCloseDate && String(r.expectedCloseDate) < todayKey());
}

export const opportunities: ResourceDefinition = {
  id: 'res_opportunities',
  key: 'opportunities',
  module: 'leads',
  label: 'Opportunity',
  labelPlural: 'Opportunities',
  icon: 'activity',
  version: 1,
  idPrefix: 'OPP',
  idFormat: 'fy',
  titleField: 'name',
  subtitleFields: ['customerId', 'stage'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description:
    'Qualified deals from Needs assessment to Won or Lost. Stage probability drives the weighted forecast. Entry rules: Proposal needs a value; Negotiation needs a quotation; Won needs an accepted quotation; Lost needs a reason and competitor.',
  status: 'published',
  fields: [
    fo('name', 'Opportunity', 'text', { required: true, maxLength: 120, capabilities: ALL, width: 260, subFields: ['customerId', 'value'] }),
    fo('customerId', 'Customer', 'relation', { required: true, relation: { resource: 'customers' }, capabilities: ALL, width: 200 }),
    fo('contactId', 'Contact', 'relation', { relation: { resource: 'contacts', filterBy: { field: 'customerId', fromField: 'customerId' } }, width: 170 }),
    fo('divisionId', 'Division', 'master', { master: 'division', required: true, width: 150 }),
    fo('oppType', 'Type', 'master', { master: 'oppType', required: true, defaultValue: 'new_machine', width: 150 }),
    fo('productType', 'Product category', 'master', { master: 'productType', width: 140 }),
    fo('productId', 'Product', 'relation', { relation: { resource: 'products' }, width: 180 }),
    fo('value', 'Value', 'money', { required: true, min: 0, currency: 'INR', width: 140 }),
    fo('stage', 'Stage', 'master', { master: 'oppStage', readOnly: true, width: 160 }),
    fo('probability', 'Probability', 'number', { min: 0, max: 100, unit: '%', width: 100, help: 'Defaults from the stage (Settings → policies); you can adjust it.' }),
    fo('weightedValue', 'Weighted value', 'money', {
      readOnly: true,
      computed: (r) => Math.round((Number(r.value) || 0) * (Number(r.probability) || 0)) / 100,
      capabilities: { list: true, sort: true, filter: true, export: true },
      width: 140,
    }),
    fo('expectedCloseDate', 'Expected close', 'date', { required: true, width: 130 }),
    fo('ownerId', 'Owner', 'relation', { required: true, relation: { resource: 'employees', where: { field: 'status', op: 'neq', value: 'inactive' } }, width: 170, display: 'person', personSubtitle: 'designation' }),
    fo('territoryId', 'Hub', 'master', { master: 'territory', width: 120 }),
    fo('competitors', 'Competitors', 'text', { maxLength: 200, capabilities: { ...NO_SEARCH, search: true } }),
    fo('decisionMakers', 'Decision makers', 'text', { maxLength: 200 }),
    fo('nextFollowUpAt', 'Next follow-up', 'date', { dateRule: 'future', width: 130 }),
    fo('stagnant', 'Stagnant', 'boolean', { readOnly: true, computed: (r) => isStagnant(r), capabilities: { list: true, filter: true }, width: 100 }),
    fo('lostReason', 'Lost reason', 'master', { master: 'lostReason', readOnly: true }),
    fo('lostToCompetitor', 'Lost to', 'text', { readOnly: true }),
    fo('lostToPrice', 'Competitor price', 'money', { readOnly: true, currency: 'INR' }),
    fo('leadId', 'From lead', 'relation', { relation: { resource: 'leads' }, readOnly: true }),
    fo('machineId', 'Machine', 'relation', { relation: { resource: 'machines' } }),
    fo('amcContractId', 'AMC contract', 'relation', { relation: { resource: 'amcContracts' }, readOnly: true }),
    fo('stageChangedAt', 'Stage since', 'datetime', { readOnly: true, capabilities: { list: true, sort: true } }),
    fo('wonAt', 'Won on', 'datetime', { readOnly: true, capabilities: { list: true, sort: true, filter: true } }),
    fo('lastActivityAt', 'Last activity', 'datetime', { readOnly: true, capabilities: { list: true, sort: true, filter: true } }),
    fo('notes', 'Notes', 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
  ],
  relationships: [
    { id: 'rel_opp_demos', label: 'Demos', resource: 'demos', foreignKey: 'opportunityId' },
    { id: 'rel_opp_samples', label: 'Sample requests', resource: 'sampleRequests', foreignKey: 'opportunityId' },
  ],
  lifecycle: {
    field: 'stage',
    initial: 'needs_assessment',
    // Lost is recorded through "Mark lost…" (reason + competitor are mandatory, FR-031).
    terminal: ['won', 'lost'],
    transitions: [
      { from: ['needs_assessment', 'proposal', 'negotiation'], to: 'demo', action: 'Move to demo / sample' },
      { from: ['needs_assessment', 'demo', 'negotiation'], to: 'proposal', action: 'Move to proposal' },
      { from: ['needs_assessment', 'demo', 'proposal'], to: 'negotiation', action: 'Move to negotiation' },
      { from: ['proposal', 'negotiation'], to: 'won', action: 'Mark won', confirm: 'Mark this opportunity as won? A sales order can then be generated from the accepted quotation.' },
      { from: ['demo', 'proposal', 'negotiation'], to: 'needs_assessment', action: 'Back to needs assessment' },
      { from: ['won', 'lost'], to: 'needs_assessment', action: 'Reopen', capability: 'opportunity.reopen', confirm: 'Reopen this closed opportunity? It returns to Needs assessment.' },
    ],
  },
  form: {
    quickCreate: ['name', 'customerId', 'contactId', 'divisionId', 'oppType', 'value', 'expectedCloseDate', 'ownerId'],
    sections: [
      { id: 'deal', title: 'Deal', fields: ['name', 'customerId', 'contactId', 'oppType', 'divisionId', 'ownerId'], columns: 2 },
      { id: 'value', title: 'Value & timing', fields: ['productType', 'productId', 'value', 'probability', 'expectedCloseDate', 'nextFollowUpAt'], columns: 2 },
      { id: 'context', title: 'Context', fields: ['competitors', 'decisionMakers', 'machineId', 'notes'], columns: 2 },
    ],
    primaryLabel: 'New opportunity',
  },
  views: views([
    {
      id: 'v_opp_pipeline',
      resource: 'opportunities',
      name: 'Pipeline',
      type: 'board',
      boardField: 'stage',
      filter: group('and', [cond('stage', 'in', OPEN_STAGES)]),
      sort: [{ field: 'expectedCloseDate', dir: 'asc' }],
      columns: cols('customerId', 'value', 'expectedCloseDate', 'ownerId'),
    },
    {
      id: 'v_opp_open',
      resource: 'opportunities',
      name: 'Open',
      type: 'table',
      filter: group('and', [cond('stage', 'in', OPEN_STAGES)]),
      sort: [{ field: 'expectedCloseDate', dir: 'asc' }],
      columns: cols('name', 'id', 'customerId', 'stage', 'value', 'probability', 'weightedValue', 'expectedCloseDate', 'ownerId', 'divisionId', 'territoryId', 'productType'),
    },
    {
      id: 'v_opp_closing',
      resource: 'opportunities',
      name: 'Closing in 7 days',
      type: 'table',
      filter: group('and', [cond('stage', 'in', OPEN_STAGES), cond('expectedCloseDate', 'next7')]),
      sort: [{ field: 'expectedCloseDate', dir: 'asc' }],
      columns: cols('name', 'customerId', 'stage', 'value', 'weightedValue', 'expectedCloseDate', 'ownerId'),
    },
    {
      id: 'v_opp_stagnant',
      resource: 'opportunities',
      name: 'Stagnant',
      type: 'table',
      filter: group('and', [cond('stagnant', 'eq', true)]),
      sort: [{ field: 'lastActivityAt', dir: 'asc' }],
      columns: cols('name', 'customerId', 'stage', 'value', 'expectedCloseDate', 'lastActivityAt', 'ownerId'),
    },
    {
      id: 'v_opp_by_owner',
      resource: 'opportunities',
      name: 'By owner',
      type: 'table',
      filter: group('and', [cond('stage', 'in', OPEN_STAGES)]),
      sort: [{ field: 'value', dir: 'desc' }],
      groupBy: 'ownerId',
      columns: cols('name', 'customerId', 'stage', 'value', 'weightedValue', 'expectedCloseDate'),
    },
    {
      id: 'v_opp_closed',
      resource: 'opportunities',
      name: 'Won & lost',
      type: 'table',
      filter: group('and', [cond('stage', 'in', ['won', 'lost'])]),
      sort: [{ field: 'expectedCloseDate', dir: 'desc' }],
      columns: cols('name', 'customerId', 'stage', 'value', 'wonAt', 'lostReason', 'lostToCompetitor', 'ownerId'),
    },
  ]),
};

export const demoMachines: ResourceDefinition = {
  id: 'res_demoMachines',
  key: 'demoMachines',
  module: 'leads',
  label: 'Demo machine',
  labelPlural: 'Demo machines',
  icon: 'blocks',
  version: 1,
  idPrefix: 'DMC',
  titleField: 'name',
  subtitleFields: ['location', 'status'],
  divisionField: 'divisionId',
  description: 'Machines at the demo centres that can be booked for customer demos.',
  status: 'published',
  fields: [
    fm('name', 'Machine', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 260 }),
    fm('location', 'Demo centre', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 180 }),
    fm('divisionId', 'Division', 'master', { master: 'division', required: true }),
    fm('status', 'Status', 'master', { master: 'demoMachineStatus', required: true, defaultValue: 'active' }),
  ],
  relationships: [{ id: 'rel_dmc_demos', label: 'Demos', resource: 'demos', foreignKey: 'demoMachineId' }],
  form: { quickCreate: ['name', 'location', 'divisionId', 'status'], sections: [{ id: 'main', title: 'Machine', fields: ['name', 'location', 'divisionId', 'status'], columns: 2 }] },
  views: views([{ id: 'v_dmc_all', resource: 'demoMachines', name: 'All', type: 'table', filter: group('and'), sort: [{ field: 'name', dir: 'asc' }], columns: cols('name', 'location', 'divisionId', 'status') }]),
};

export const demos: ResourceDefinition = {
  id: 'res_demos',
  key: 'demos',
  module: 'leads',
  label: 'Demo',
  labelPlural: 'Demos',
  icon: 'calendar',
  version: 1,
  idPrefix: 'DEM',
  titleField: 'opportunityId',
  subtitleFields: ['scheduledAt', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  calendar: {
    startField: 'scheduledAt',
    durationField: 'durationMin',
    lanes: [
      { field: 'demoMachineId', label: 'Demo machines', emptyLaneLabel: 'Customer site' },
      { field: 'ownerId', label: 'Sales owner', laneFilter: { field: 'roleId', op: 'in', value: ['sales_manager', 'sales_exec', 'division_head'] } },
    ],
  },
  description: 'Demos at the demo centre or the customer site. A demo machine cannot be double-booked.',
  status: 'published',
  fields: [
    fd('opportunityId', 'Opportunity', 'relation', { required: true, relation: { resource: 'opportunities' }, capabilities: ALL, width: 240 }),
    fd('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, readOnly: true, width: 200 }),
    fd('location', 'Where', 'master', { master: 'demoLocation', required: true, defaultValue: 'centre', width: 130 }),
    fd('demoMachineId', 'Demo machine', 'relation', {
      relation: { resource: 'demoMachines', where: { field: 'status', op: 'eq', value: 'active' } },
      requiredWhen: { field: 'location', op: 'eq', value: 'centre' },
      visibleWhen: { field: 'location', op: 'eq', value: 'centre' },
      clearWhenHidden: true,
      width: 220,
    }),
    fd('scheduledAt', 'When', 'datetime', { required: true, width: 160 }),
    fd('durationMin', 'Duration', 'number', { required: true, min: 30, max: 480, unit: 'min', defaultValue: 120, width: 100 }),
    fd('status', 'Status', 'master', { master: 'demoStatus', readOnly: true, width: 120 }),
    fd('ownerId', 'Sales owner', 'relation', { required: true, relation: { resource: 'employees' }, width: 170, display: 'person', personSubtitle: 'designation' }),
    fd('divisionId', 'Division', 'master', { master: 'division', readOnly: true }),
    fd('agenda', 'Agenda', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fd('results', 'Results', 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
    fd('customerFeedback', 'Customer feedback', 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'requested',
    terminal: ['done', 'cancelled'],
    transitions: [
      { from: ['requested'], to: 'scheduled', action: 'Confirm demo' },
      { from: ['requested', 'scheduled'], to: 'done', action: 'Mark done' },
      { from: ['requested', 'scheduled'], to: 'cancelled', action: 'Cancel demo', confirm: 'Cancel this demo? The demo machine slot is released.' },
    ],
  },
  form: {
    quickCreate: ['opportunityId', 'location', 'demoMachineId', 'scheduledAt', 'durationMin', 'ownerId', 'agenda'],
    sections: [
      { id: 'when', title: 'When & where', fields: ['opportunityId', 'location', 'demoMachineId', 'scheduledAt', 'durationMin', 'ownerId'], columns: 2 },
      { id: 'outcome', title: 'Outcome', fields: ['agenda', 'results', 'customerFeedback'], columns: 1 },
    ],
    primaryLabel: 'Book demo',
  },
  views: views([
    { id: 'v_demo_calendar', resource: 'demos', name: 'Demo calendar', type: 'calendar', filter: group('and'), sort: [{ field: 'scheduledAt', dir: 'asc' }], columns: cols('scheduledAt', 'opportunityId', 'demoMachineId', 'status') },
    {
      id: 'v_demo_upcoming',
      resource: 'demos',
      name: 'Upcoming',
      type: 'table',
      filter: group('and', [cond('status', 'in', ['requested', 'scheduled'])]),
      sort: [{ field: 'scheduledAt', dir: 'asc' }],
      columns: cols('scheduledAt', 'opportunityId', 'customerId', 'location', 'demoMachineId', 'ownerId', 'status'),
    },
    { id: 'v_demo_all', resource: 'demos', name: 'All', type: 'table', filter: group('and'), sort: [{ field: 'scheduledAt', dir: 'desc' }], columns: cols('scheduledAt', 'opportunityId', 'customerId', 'location', 'demoMachineId', 'ownerId', 'status') },
  ]),
};

export const sampleRequests: ResourceDefinition = {
  id: 'res_sampleRequests',
  key: 'sampleRequests',
  module: 'leads',
  label: 'Sample request',
  labelPlural: 'Sample requests',
  icon: 'layout-dashboard',
  version: 1,
  idPrefix: 'SR',
  titleField: 'title',
  subtitleFields: ['opportunityId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: 'Sample prints requested from the Profiling team with the customer’s artwork and fabric details; results and feedback are recorded here.',
  status: 'published',
  fields: [
    fs('title', 'Sample', 'text', { required: true, maxLength: 120, capabilities: ALL, width: 260 }),
    fs('opportunityId', 'Opportunity', 'relation', { required: true, relation: { resource: 'opportunities' }, capabilities: ALL, width: 220 }),
    fs('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, readOnly: true, width: 200 }),
    fs('assigneeId', 'Profiling', 'relation', { required: true, relation: { resource: 'employees', where: { field: 'roleId', op: 'eq', value: 'profiling' } }, width: 170, display: 'person' }),
    fs('dueDate', 'Needed by', 'date', { required: true, dateRule: 'future', width: 120 }),
    fs('status', 'Status', 'master', { master: 'sampleStatus', readOnly: true, width: 130 }),
    fs('ownerId', 'Requested by', 'relation', { required: true, relation: { resource: 'employees' }, width: 170 }),
    fs('divisionId', 'Division', 'master', { master: 'division', readOnly: true }),
    fs('artwork', 'Artwork / design', 'longtext', { required: true, maxLength: 1000, capabilities: FORM_ONLY, help: 'File names or a description of the customer artwork (files are not uploaded in this prototype).' }),
    fs('fabricDetails', 'Fabric / media details', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fs('results', 'Print results', 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
    fs('customerFeedback', 'Customer feedback', 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'requested',
    terminal: ['results_shared', 'cancelled'],
    transitions: [
      { from: ['requested'], to: 'in_progress', action: 'Start printing' },
      { from: ['requested', 'in_progress'], to: 'results_shared', action: 'Share results' },
      { from: ['requested', 'in_progress'], to: 'cancelled', action: 'Cancel request', confirm: 'Cancel this sample request?' },
    ],
  },
  form: {
    quickCreate: ['title', 'opportunityId', 'assigneeId', 'dueDate', 'ownerId', 'artwork', 'fabricDetails'],
    sections: [
      { id: 'req', title: 'Request', fields: ['title', 'opportunityId', 'assigneeId', 'dueDate', 'ownerId', 'artwork', 'fabricDetails'], columns: 2 },
      { id: 'res', title: 'Results', fields: ['results', 'customerFeedback'], columns: 1 },
    ],
    primaryLabel: 'Request sample',
  },
  views: views([
    {
      id: 'v_sr_open',
      resource: 'sampleRequests',
      name: 'Open',
      type: 'table',
      filter: group('and', [cond('status', 'in', ['requested', 'in_progress'])]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: cols('title', 'opportunityId', 'customerId', 'assigneeId', 'dueDate', 'status', 'ownerId'),
    },
    { id: 'v_sr_all', resource: 'sampleRequests', name: 'All', type: 'table', filter: group('and'), sort: [{ field: 'dueDate', dir: 'desc' }], columns: cols('title', 'opportunityId', 'customerId', 'assigneeId', 'dueDate', 'status') },
  ]),
};

const sales = (read: RowScope, create: boolean, exp = false) => ({ opportunities: p(read, read, create, false, exp), demos: p(read, read, create, false, exp), sampleRequests: p(read, read, create, false, exp), demoMachines: p('all') });

export const opportunitiesPack: ModulePack = {
  id: 'opportunities',
  resources: [opportunities, demos, sampleRequests, demoMachines],
  masters,
  // REQUIREMENTS §2.2 "Leads & opps" column.
  permissions: {
    admin: { opportunities: p('all', 'all', true, true, true), demos: p('all', 'all', true, true, true), sampleRequests: p('all', 'all', true, true, true), demoMachines: p('all', 'all', true, true, true) },
    management: { opportunities: p('all', 'none', false, false, true), demos: p('all'), sampleRequests: p('all'), demoMachines: p('all') },
    division_head: { ...sales('division', true, true), demoMachines: p('division', 'division', true) },
    sales_manager: sales('team', true),
    sales_exec: sales('own', true),
    service_head: { opportunities: p('all'), demos: p('all'), sampleRequests: p('all'), demoMachines: p('all') },
    coordinator: sales('division', true),
    profiling: { opportunities: p('all'), demos: p('all'), sampleRequests: p('all', 'all'), demoMachines: p('all') },
  },
  capabilities: { admin: ['opportunity.reopen'] },
  extend: {
    leads: {
      resources: ['opportunities', 'demos', 'sampleRequests', 'demoMachines'],
      pages: [{ id: 'forecast', label: 'Forecast', icon: 'activity', path: 'opportunities/forecast' }],
    },
    home: { pages: [{ id: 'calendar', label: 'Calendar', icon: 'calendar', path: 'calendar' }] },
  },
};
