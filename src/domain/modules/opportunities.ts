/**
 * Opportunities & Pipeline module (BRD 4.3, FR-027 – FR-034): qualified opportunities through stages
 * to Won / Lost, demo bookings on demo-centre machines, sample print requests to Profiling.
 * Sidebar entries come from src/domain/sidebar.ts; every label comes from L.opportunities.
 */
import type { MasterDefinition, MasterValue, ResourceDefinition, ResourcePermission, RowScope, Tone } from '../../metadata/types';
import { todayKey } from '../../lib/dates';
import { nowMs } from '../../lib/clock';
import { L } from '../../constants/labels';
import { ALL, cols, cond, field, FORM_ONLY, group, NO_SEARCH, views } from '../helpers';
import type { ModulePack } from './types';

// Local copy of pack.ts `p` — importing it from ../pack would be circular (pack imports this file).
const p = (read: RowScope, update: RowScope = 'none', create = false, del = false, exp = false): ResourcePermission => ({ read, update, create, delete: del, export: exp, sensitive_data: true });

type FieldType = Parameters<typeof field>[3];
type Extra = Parameters<typeof field>[4];
const F = L.opportunities.fields;
const V = L.opportunities.views;
const A = L.opportunities.actions;
const C = L.opportunities.confirms;
const S = L.opportunities.sections;
const R = L.opportunities.records;
const D = L.opportunities.descriptions;
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

const M = L.opportunities.masters;
const masters: MasterDefinition[] = [
  master('oppStage', M.oppStage.label, [
    mv('needs_assessment', M.oppStage.values.needs_assessment, 'info'),
    mv('demo', M.oppStage.values.demo, 'info'),
    mv('proposal', M.oppStage.values.proposal, 'accent'),
    mv('negotiation', M.oppStage.values.negotiation, 'warning'),
    mv('won', M.oppStage.values.won, 'success'),
    mv('lost', M.oppStage.values.lost, 'danger'),
  ]),
  master('oppType', M.oppType.label, [
    mv('new_machine', M.oppType.values.new_machine, 'accent'),
    mv('additional_machine', M.oppType.values.additional_machine, 'accent'),
    mv('upgrade', M.oppType.values.upgrade, 'info'),
    mv('consumables', M.oppType.values.consumables),
    mv('amc', M.oppType.values.amc),
    mv('renewal', M.oppType.values.renewal, 'warning'),
  ]),
  master('demoLocation', M.demoLocation.label, [mv('centre', M.demoLocation.values.centre, 'accent'), mv('site', M.demoLocation.values.site, 'info')]),
  master('demoStatus', M.demoStatus.label, [mv('requested', M.demoStatus.values.requested, 'info'), mv('scheduled', M.demoStatus.values.scheduled, 'accent'), mv('done', M.demoStatus.values.done, 'success'), mv('cancelled', M.demoStatus.values.cancelled)]),
  master('sampleStatus', M.sampleStatus.label, [mv('requested', M.sampleStatus.values.requested, 'info'), mv('in_progress', M.sampleStatus.values.in_progress, 'warning'), mv('results_shared', M.sampleStatus.values.results_shared, 'success'), mv('cancelled', M.sampleStatus.values.cancelled)]),
  master('demoMachineStatus', M.demoMachineStatus.label, [mv('active', M.demoMachineStatus.values.active, 'success'), mv('maintenance', M.demoMachineStatus.values.maintenance, 'warning'), mv('inactive', M.demoMachineStatus.values.inactive)]),
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
  module: 'opportunities',
  label: R.opportunities.one,
  labelPlural: R.opportunities.many,
  icon: 'activity',
  version: 1,
  idPrefix: 'OPP',
  idFormat: 'fy',
  titleField: 'name',
  subtitleFields: ['customerId', 'stage'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: D.opportunities,
  status: 'published',
  fields: [
    fo('name', F.opportunities.name, 'text', { required: true, maxLength: 120, capabilities: ALL, width: 260, subFields: ['customerId', 'value'] }),
    fo('customerId', F.opportunities.customerId, 'relation', { required: true, relation: { resource: 'customers' }, capabilities: ALL, width: 200 }),
    fo('contactId', F.opportunities.contactId, 'relation', { relation: { resource: 'contacts', filterBy: { field: 'customerId', fromField: 'customerId' } }, width: 170 }),
    fo('divisionId', F.opportunities.divisionId, 'master', { master: 'division', required: true, width: 150 }),
    fo('oppType', F.opportunities.oppType, 'master', { master: 'oppType', required: true, defaultValue: 'new_machine', width: 170 }),
    fo('productType', F.opportunities.productType, 'master', { master: 'productType', width: 140 }),
    fo('productId', F.opportunities.productId, 'relation', { relation: { resource: 'products' }, width: 180 }),
    fo('value', F.opportunities.value, 'money', { required: true, min: 0, max: 10_000_000_000, currency: 'INR', width: 140 }),
    fo('stage', F.opportunities.stage, 'master', { master: 'oppStage', readOnly: true, width: 170 }),
    fo('probability', F.opportunities.probability, 'number', { min: 0, max: 100, unit: L.opportunities.units.percent, width: 100, help: F.opportunities.probabilityHelp }),
    fo('weightedValue', F.opportunities.weightedValue, 'money', {
      readOnly: true,
      computed: (r) => Math.round((Number(r.value) || 0) * (Number(r.probability) || 0)) / 100,
      capabilities: { list: true, sort: true, filter: true, export: true },
      width: 140,
    }),
    fo('expectedCloseDate', F.opportunities.expectedCloseDate, 'date', { required: true, width: 150 }),
    fo('ownerId', F.opportunities.ownerId, 'relation', { required: true, relation: { resource: 'employees', where: { field: 'status', op: 'neq', value: 'inactive' } }, width: 170, display: 'person', personSubtitle: 'designation' }),
    fo('territoryId', F.opportunities.territoryId, 'master', { master: 'territory', width: 140 }),
    fo('competitors', F.opportunities.competitors, 'text', { maxLength: 200, capabilities: { ...NO_SEARCH, search: true } }),
    fo('decisionMakers', F.opportunities.decisionMakers, 'text', { maxLength: 200 }),
    fo('nextFollowUpAt', F.opportunities.nextFollowUpAt, 'date', { dateRule: 'future', width: 130 }),
    fo('stagnant', F.opportunities.stagnant, 'boolean', { readOnly: true, computed: (r) => isStagnant(r), capabilities: { list: true, filter: true }, width: 130 }),
    fo('lostReason', F.opportunities.lostReason, 'master', { master: 'lostReason', readOnly: true }),
    fo('lostToCompetitor', F.opportunities.lostToCompetitor, 'text', { readOnly: true }),
    fo('lostToPrice', F.opportunities.lostToPrice, 'money', { readOnly: true, currency: 'INR' }),
    fo('leadId', F.opportunities.leadId, 'relation', { relation: { resource: 'leads' }, readOnly: true }),
    fo('machineId', F.opportunities.machineId, 'relation', { relation: { resource: 'machines' } }),
    fo('amcContractId', F.opportunities.amcContractId, 'relation', { relation: { resource: 'amcContracts' }, readOnly: true }),
    fo('stageChangedAt', F.opportunities.stageChangedAt, 'datetime', { readOnly: true, capabilities: { list: true, sort: true } }),
    fo('wonAt', F.opportunities.wonAt, 'datetime', { readOnly: true, capabilities: { list: true, sort: true, filter: true } }),
    fo('lastActivityAt', F.opportunities.lastActivityAt, 'datetime', { readOnly: true, capabilities: { list: true, sort: true, filter: true } }),
    fo('notes', F.opportunities.notes, 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
  ],
  relationships: [
    { id: 'rel_opp_demos', label: L.opportunities.relationships.demos, resource: 'demos', foreignKey: 'opportunityId' },
    { id: 'rel_opp_samples', label: L.opportunities.relationships.sampleRequests, resource: 'sampleRequests', foreignKey: 'opportunityId' },
  ],
  lifecycle: {
    field: 'stage',
    initial: 'needs_assessment',
    // Lost is recorded through "Mark Lost" (reason + competitor are mandatory, FR-031).
    terminal: ['won', 'lost'],
    transitions: [
      { from: ['needs_assessment', 'proposal', 'negotiation'], to: 'demo', action: A.moveToDemo },
      { from: ['needs_assessment', 'demo', 'negotiation'], to: 'proposal', action: A.moveToProposal },
      { from: ['needs_assessment', 'demo', 'proposal'], to: 'negotiation', action: A.moveToNegotiation },
      { from: ['proposal', 'negotiation'], to: 'won', action: A.markWon, confirm: C.markWon },
      { from: ['demo', 'proposal', 'negotiation'], to: 'needs_assessment', action: A.backToNeedsAssessment },
      { from: ['won', 'lost'], to: 'needs_assessment', action: A.reopen, capability: 'opportunity.reopen', confirm: C.reopen },
    ],
  },
  form: {
    quickCreate: ['name', 'customerId', 'contactId', 'divisionId', 'oppType', 'value', 'expectedCloseDate', 'ownerId'],
    sections: [
      { id: 'deal', title: S.opportunity, fields: ['name', 'customerId', 'contactId', 'oppType', 'divisionId', 'ownerId'], columns: 2 },
      { id: 'value', title: S.valueTiming, fields: ['productType', 'productId', 'value', 'probability', 'expectedCloseDate', 'nextFollowUpAt'], columns: 2 },
      { id: 'context', title: S.context, fields: ['competitors', 'decisionMakers', 'machineId', 'notes'], columns: 2 },
    ],
    primaryLabel: A.newOpportunity,
  },
  views: views([
    {
      id: 'v_opp_pipeline',
      resource: 'opportunities',
      name: V.kanban,
      type: 'board',
      boardField: 'stage',
      // No filter by default: Won / Lost columns stay visible so cards can be dragged there.
      filter: group('and'),
      sort: [{ field: 'expectedCloseDate', dir: 'asc' }],
      columns: cols('customerId', 'value', 'expectedCloseDate', 'ownerId'),
    },
    {
      id: 'v_opp_open',
      resource: 'opportunities',
      name: V.open,
      type: 'table',
      filter: group('and', [cond('stage', 'in', OPEN_STAGES)]),
      sort: [{ field: 'expectedCloseDate', dir: 'asc' }],
      columns: cols('name', 'id', 'customerId', 'stage', 'value', 'probability', 'weightedValue', 'expectedCloseDate', 'ownerId', 'divisionId', 'territoryId', 'productType'),
    },
    {
      id: 'v_opp_closing',
      resource: 'opportunities',
      name: V.closing,
      type: 'table',
      filter: group('and', [cond('stage', 'in', OPEN_STAGES), cond('expectedCloseDate', 'next7')]),
      sort: [{ field: 'expectedCloseDate', dir: 'asc' }],
      columns: cols('name', 'customerId', 'stage', 'value', 'weightedValue', 'expectedCloseDate', 'ownerId'),
    },
    {
      id: 'v_opp_stagnant',
      resource: 'opportunities',
      name: V.stagnant,
      type: 'table',
      filter: group('and', [cond('stagnant', 'eq', true)]),
      sort: [{ field: 'lastActivityAt', dir: 'asc' }],
      columns: cols('name', 'customerId', 'stage', 'value', 'expectedCloseDate', 'lastActivityAt', 'ownerId'),
    },
    {
      id: 'v_opp_by_owner',
      resource: 'opportunities',
      name: V.byOwner,
      type: 'table',
      filter: group('and', [cond('stage', 'in', OPEN_STAGES)]),
      sort: [{ field: 'value', dir: 'desc' }],
      groupBy: 'ownerId',
      columns: cols('name', 'customerId', 'stage', 'value', 'weightedValue', 'expectedCloseDate'),
    },
    {
      id: 'v_opp_closed',
      resource: 'opportunities',
      name: V.closed,
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
  module: 'opportunities',
  label: R.demoMachines.one,
  labelPlural: R.demoMachines.many,
  icon: 'blocks',
  version: 1,
  idPrefix: 'DMC',
  titleField: 'name',
  subtitleFields: ['location', 'status'],
  divisionField: 'divisionId',
  description: D.demoMachines,
  status: 'published',
  fields: [
    fm('name', F.demoMachines.name, 'text', { required: true, maxLength: 80, capabilities: ALL, width: 260 }),
    fm('location', F.demoMachines.location, 'text', { required: true, maxLength: 80, capabilities: ALL, width: 180 }),
    fm('divisionId', F.demoMachines.divisionId, 'master', { master: 'division', required: true }),
    fm('status', F.demoMachines.status, 'master', { master: 'demoMachineStatus', required: true, defaultValue: 'active' }),
  ],
  relationships: [{ id: 'rel_dmc_demos', label: L.opportunities.relationships.demos, resource: 'demos', foreignKey: 'demoMachineId' }],
  form: { quickCreate: ['name', 'location', 'divisionId', 'status'], sections: [{ id: 'main', title: S.machine, fields: ['name', 'location', 'divisionId', 'status'], columns: 2 }] },
  views: views([{ id: 'v_dmc_all', resource: 'demoMachines', name: V.all, type: 'table', filter: group('and'), sort: [{ field: 'name', dir: 'asc' }], columns: cols('name', 'location', 'divisionId', 'status') }]),
};

export const demos: ResourceDefinition = {
  id: 'res_demos',
  key: 'demos',
  module: 'opportunities',
  label: R.demos.one,
  labelPlural: R.demos.many,
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
      { field: 'demoMachineId', label: L.opportunities.calendarLanes.demoMachines, emptyLaneLabel: L.opportunities.calendarLanes.customerSite },
      { field: 'ownerId', label: L.opportunities.calendarLanes.salesOwner, laneFilter: { field: 'roleId', op: 'in', value: ['sales_manager', 'sales_exec', 'division_head'] } },
    ],
  },
  description: D.demos,
  status: 'published',
  fields: [
    fd('opportunityId', F.demos.opportunityId, 'relation', { required: true, relation: { resource: 'opportunities' }, capabilities: ALL, width: 240 }),
    fd('customerId', F.demos.customerId, 'relation', { relation: { resource: 'customers' }, readOnly: true, width: 200 }),
    fd('location', F.demos.location, 'master', { master: 'demoLocation', required: true, defaultValue: 'centre', width: 140 }),
    fd('demoMachineId', F.demos.demoMachineId, 'relation', {
      relation: { resource: 'demoMachines', where: { field: 'status', op: 'eq', value: 'active' } },
      requiredWhen: { field: 'location', op: 'eq', value: 'centre' },
      visibleWhen: { field: 'location', op: 'eq', value: 'centre' },
      clearWhenHidden: true,
      width: 220,
    }),
    fd('scheduledAt', F.demos.scheduledAt, 'datetime', { required: true, width: 160 }),
    fd('durationMin', F.demos.durationMin, 'number', { required: true, min: 30, max: 480, unit: L.opportunities.units.minutes, defaultValue: 120, width: 100 }),
    fd('status', F.demos.status, 'master', { master: 'demoStatus', readOnly: true, width: 120 }),
    fd('ownerId', F.demos.ownerId, 'relation', { required: true, relation: { resource: 'employees' }, width: 170, display: 'person', personSubtitle: 'designation' }),
    fd('divisionId', F.demos.divisionId, 'master', { master: 'division', readOnly: true }),
    fd('agenda', F.demos.agenda, 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fd('results', F.demos.results, 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
    fd('customerFeedback', F.demos.customerFeedback, 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'requested',
    terminal: ['done', 'cancelled'],
    transitions: [
      { from: ['requested'], to: 'scheduled', action: A.confirmDemo },
      { from: ['requested', 'scheduled'], to: 'done', action: A.markDone },
      { from: ['requested', 'scheduled'], to: 'cancelled', action: A.cancelDemo, confirm: C.cancelDemo },
    ],
  },
  form: {
    quickCreate: ['opportunityId', 'location', 'demoMachineId', 'scheduledAt', 'durationMin', 'ownerId', 'agenda'],
    sections: [
      { id: 'when', title: S.whenWhere, fields: ['opportunityId', 'location', 'demoMachineId', 'scheduledAt', 'durationMin', 'ownerId'], columns: 2 },
      { id: 'outcome', title: S.outcome, fields: ['agenda', 'results', 'customerFeedback'], columns: 1 },
    ],
    primaryLabel: A.bookDemo,
  },
  views: views([
    { id: 'v_demo_calendar', resource: 'demos', name: V.demoCalendar, type: 'calendar', filter: group('and'), sort: [{ field: 'scheduledAt', dir: 'asc' }], columns: cols('scheduledAt', 'opportunityId', 'demoMachineId', 'status') },
    {
      id: 'v_demo_upcoming',
      resource: 'demos',
      name: V.upcoming,
      type: 'table',
      filter: group('and', [cond('status', 'in', ['requested', 'scheduled'])]),
      sort: [{ field: 'scheduledAt', dir: 'asc' }],
      columns: cols('scheduledAt', 'opportunityId', 'customerId', 'location', 'demoMachineId', 'ownerId', 'status'),
    },
    { id: 'v_demo_all', resource: 'demos', name: V.all, type: 'table', filter: group('and'), sort: [{ field: 'scheduledAt', dir: 'desc' }], columns: cols('scheduledAt', 'opportunityId', 'customerId', 'location', 'demoMachineId', 'ownerId', 'status') },
  ]),
};

export const sampleRequests: ResourceDefinition = {
  id: 'res_sampleRequests',
  key: 'sampleRequests',
  module: 'opportunities',
  label: R.sampleRequests.one,
  labelPlural: R.sampleRequests.many,
  icon: 'layout-dashboard',
  version: 1,
  idPrefix: 'SR',
  titleField: 'title',
  subtitleFields: ['opportunityId', 'status'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: D.sampleRequests,
  status: 'published',
  fields: [
    fs('title', F.sampleRequests.title, 'text', { required: true, maxLength: 120, capabilities: ALL, width: 260 }),
    fs('opportunityId', F.sampleRequests.opportunityId, 'relation', { required: true, relation: { resource: 'opportunities' }, capabilities: ALL, width: 220 }),
    fs('customerId', F.sampleRequests.customerId, 'relation', { relation: { resource: 'customers' }, readOnly: true, width: 200 }),
    fs('assigneeId', F.sampleRequests.assigneeId, 'relation', { required: true, relation: { resource: 'employees', where: { field: 'roleId', op: 'eq', value: 'profiling' } }, width: 170, display: 'person' }),
    fs('dueDate', F.sampleRequests.dueDate, 'date', { required: true, dateRule: 'future', width: 120 }),
    fs('status', F.sampleRequests.status, 'master', { master: 'sampleStatus', readOnly: true, width: 130 }),
    fs('ownerId', F.sampleRequests.ownerId, 'relation', { required: true, relation: { resource: 'employees' }, width: 170 }),
    fs('divisionId', F.sampleRequests.divisionId, 'master', { master: 'division', readOnly: true }),
    fs('artwork', F.sampleRequests.artwork, 'longtext', { required: true, maxLength: 1000, capabilities: FORM_ONLY, help: F.sampleRequests.artworkHelp }),
    fs('fabricDetails', F.sampleRequests.fabricDetails, 'longtext', { maxLength: 1000, capabilities: FORM_ONLY }),
    fs('results', F.sampleRequests.results, 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
    fs('customerFeedback', F.sampleRequests.customerFeedback, 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'requested',
    terminal: ['results_shared', 'cancelled'],
    transitions: [
      { from: ['requested'], to: 'in_progress', action: A.startPrinting },
      { from: ['requested', 'in_progress'], to: 'results_shared', action: A.shareResults },
      { from: ['requested', 'in_progress'], to: 'cancelled', action: A.cancelRequest, confirm: C.cancelRequest },
    ],
  },
  form: {
    quickCreate: ['title', 'opportunityId', 'assigneeId', 'dueDate', 'ownerId', 'artwork', 'fabricDetails'],
    sections: [
      { id: 'req', title: S.request, fields: ['title', 'opportunityId', 'assigneeId', 'dueDate', 'ownerId', 'artwork', 'fabricDetails'], columns: 2 },
      { id: 'res', title: S.results, fields: ['results', 'customerFeedback'], columns: 1 },
    ],
    primaryLabel: A.requestSamplePrint,
  },
  views: views([
    {
      id: 'v_sr_open',
      resource: 'sampleRequests',
      name: V.open,
      type: 'table',
      filter: group('and', [cond('status', 'in', ['requested', 'in_progress'])]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: cols('title', 'opportunityId', 'customerId', 'assigneeId', 'dueDate', 'status', 'ownerId'),
    },
    { id: 'v_sr_all', resource: 'sampleRequests', name: V.all, type: 'table', filter: group('and'), sort: [{ field: 'dueDate', dir: 'desc' }], columns: cols('title', 'opportunityId', 'customerId', 'assigneeId', 'dueDate', 'status') },
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
};
