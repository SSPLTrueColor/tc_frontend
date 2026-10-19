import type { MasterDefinition, MasterValue, ResourceDefinition, Tone } from '../../metadata/types';
import { ALL, cols, cond, field, FORM_ONLY, group, NO_SEARCH, views } from '../helpers';
import { leadComputed } from './leads/computed';
import { p, type ModulePack } from './types';

const mv = (key: string, label: string, tone: Tone = 'neutral'): Omit<MasterValue, 'order'> => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[]): MasterDefinition => ({ id: `mst_${key}`, key, label, version: 1, values: values.map((x, i) => ({ ...x, order: i })) });

const leadMasters: MasterDefinition[] = [
  master('leadStatus', 'Lead status', [mv('new', 'New', 'info'), mv('contacted', 'Contacted', 'accent'), mv('qualified', 'Qualified', 'success'), mv('nurture', 'Nurture', 'warning'), mv('disqualified', 'Disqualified', 'neutral')]),
  master('purchaseTimeline', 'Purchase timeline', [mv('immediate', 'Immediate (< 1 month)', 'danger'), mv('1_3m', '1–3 months', 'warning'), mv('3_6m', '3–6 months', 'info'), mv('6_12m', '6–12 months'), mv('12m_plus', 'More than 12 months')]),
  master('printHeadConfig', 'Print-head configuration', [mv('4h', '4 heads'), mv('8h', '8 heads'), mv('16h', '16 heads'), mv('32h', '32 heads'), mv('64h', '64 heads')]),
  master('fabricType', 'Fabric type', [mv('polyester', 'Polyester'), mv('cotton', 'Cotton'), mv('silk', 'Silk'), mv('viscose', 'Viscose / rayon'), mv('blend', 'Blends'), mv('nylon', 'Nylon / lycra')]),
  master('scoringFactor', 'Scoring factor', [mv('source', 'Lead source'), mv('segment', 'Segment'), mv('budget', 'Budget at least (₹)'), mv('timeline', 'Purchase timeline'), mv('engagement', 'Activities logged at least')]),
];

const fl = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('leads', key, label, type, extra);
const TEXTILE = { field: 'subType', op: 'eq' as const, value: 'textile' };
const POD = { field: 'subType', op: 'eq' as const, value: 'pod' };
const LABEL = { field: 'subType', op: 'eq' as const, value: 'label' };
const OTHER = { field: 'subType', op: 'eq' as const, value: 'other' };

/** LEAD-01…14. Status changes to Qualified / Nurture / Disqualified run through dialogs (they capture data). */
export const leads: ResourceDefinition = {
  id: 'res_leads',
  key: 'leads',
  module: 'leads',
  label: 'Lead',
  labelPlural: 'Leads',
  icon: 'activity',
  version: 1,
  idPrefix: 'LD',
  idFormat: 'fy',
  titleField: 'customerId',
  subtitleFields: ['status', 'ownerId'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: 'Potential customers from every source. Log every contact with a next follow-up date; qualify a lead to create an opportunity.',
  status: 'published',
  fields: [
    fl('customerId', 'Company', 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220, subFields: ['contactId'] }),
    fl('contactId', 'Contact person', 'relation', { relation: { resource: 'contacts', filterBy: { field: 'customerId', fromField: 'customerId' } }, required: true, width: 180 }),
    fl('divisionId', 'Division', 'master', { master: 'division', required: true, width: 150 }),
    fl('ownerId', 'Owner', 'relation', { relation: { resource: 'employees', where: { field: 'status', op: 'neq', value: 'inactive' } }, width: 170, display: 'person', personSubtitle: 'designation', help: 'Leave empty to assign automatically (your own lead for sales users; assignment rules for coordinators, imports and web leads). The owner must work in the lead’s division.' }),
    fl('sourceId', 'Source', 'master', { master: 'leadSource', required: true, width: 170 }),
    fl('campaign', 'Campaign', 'text', { maxLength: 80, capabilities: ALL }),
    fl('eventName', 'Exhibition / event', 'text', { maxLength: 80, requiredWhen: { field: 'sourceId', op: 'eq', value: 'exhibition' }, visibleWhen: { field: 'sourceId', op: 'eq', value: 'exhibition' }, clearWhenHidden: true, capabilities: ALL }),
    fl('referrerType', 'Referred by', 'master', { master: 'referrerType', requiredWhen: { field: 'sourceId', op: 'eq', value: 'referral' }, visibleWhen: { field: 'sourceId', op: 'eq', value: 'referral' }, clearWhenHidden: true }),
    fl('referrerEmployeeId', 'Referrer (employee)', 'relation', {
      relation: { resource: 'employees' },
      requiredWhen: { field: 'referrerType', op: 'in', value: ['engineer', 'employee'] },
      visibleWhen: { field: 'referrerType', op: 'in', value: ['engineer', 'employee'] },
      clearWhenHidden: true,
    }),
    fl('referrerCustomerId', 'Referrer (customer / dealer)', 'relation', {
      relation: { resource: 'customers' },
      requiredWhen: { field: 'referrerType', op: 'in', value: ['customer', 'dealer'] },
      visibleWhen: { field: 'referrerType', op: 'in', value: ['customer', 'dealer'] },
      clearWhenHidden: true,
    }),
    fl('productType', 'Product interest', 'master', { master: 'productType', required: true, width: 140 }),
    fl('subType', 'Sub-type', 'master', { master: 'productSubType', width: 110 }),
    // Dynamic specification fields per sub-type (LEAD-06). Non-textile fields are placeholders until TC confirms them (Q-11).
    fl('specPrintWidth', 'Printing width', 'number', { unit: 'mm', min: 300, max: 5200, visibleWhen: TEXTILE, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specPrintHeads', 'Print-head configuration', 'master', { master: 'printHeadConfig', visibleWhen: TEXTILE, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specFabricType', 'Fabric type', 'master', { master: 'fabricType', visibleWhen: TEXTILE, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specCapacity', 'Production capacity', 'number', { unit: 'm/day', min: 0, max: 200000, visibleWhen: TEXTILE, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specPodVolume', 'Monthly print volume', 'number', { unit: 'prints', min: 0, visibleWhen: POD, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specPodMedia', 'Media / substrates', 'text', { maxLength: 80, visibleWhen: POD, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specPodFinishing', 'Finishing needed', 'text', { maxLength: 80, visibleWhen: POD, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specLabelWidth', 'Web width', 'number', { unit: 'mm', min: 0, max: 1000, visibleWhen: LABEL, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specLabelSubstrate', 'Label substrate', 'text', { maxLength: 80, visibleWhen: LABEL, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specLabelColours', 'Colours', 'number', { min: 1, max: 12, visibleWhen: LABEL, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specOther', 'Specification notes', 'longtext', { maxLength: 500, visibleWhen: OTHER, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('requirement', 'Customer requirement (need)', 'longtext', { maxLength: 2000, capabilities: { ...FORM_ONLY, search: true } }),
    fl('budget', 'Budget', 'money', { min: 0, width: 130 }),
    fl('decisionMaker', 'Decision maker', 'text', { maxLength: 80 }),
    fl('timeline', 'Purchase timeline', 'master', { master: 'purchaseTimeline' }),
    fl('currentSetup', 'Current set-up / competitor machine', 'text', { maxLength: 120 }),
    fl('city', 'City', 'text', { maxLength: 60, capabilities: ALL, width: 120 }),
    fl('state', 'State', 'master', { master: 'state', width: 140 }),
    fl('industry', 'Industry', 'master', { master: 'industry' }),
    fl('segment', 'Segment', 'master', { master: 'segment' }),
    fl('status', 'Status', 'master', { master: 'leadStatus', readOnly: true, defaultValue: 'new', width: 120 }),
    fl('nextFollowUpAt', 'Next follow-up', 'date', {
      dateRule: 'future',
      requiredWhen: { field: 'status', op: 'in', value: ['new', 'contacted', 'nurture'] },
      width: 130,
      help: 'Mandatory on every update while the lead is open (BR-07).',
    }),
    fl('nurtureUntil', 'Re-contact on', 'date', { readOnly: true, visibleWhen: { field: 'status', op: 'eq', value: 'nurture' } }),
    fl('disqualifyReason', 'Disqualify reason', 'master', { master: 'lostReason', readOnly: true, visibleWhen: { field: 'status', op: 'eq', value: 'disqualified' } }),
    fl('statusNote', 'Status note', 'text', { readOnly: true, capabilities: { list: false, export: true } }),
    fl('opportunityId', 'Opportunity', 'relation', { relation: { resource: 'opportunities' }, readOnly: true, visibleWhen: { field: 'status', op: 'eq', value: 'qualified' } }),
    fl('score', 'Score', 'number', { readOnly: true, computed: leadComputed.score, capabilities: { list: true, sort: true, filter: true, export: true }, width: 80, help: 'Rule-based score 0–100 (Administration → Lead scoring).' }),
    fl('notAttended', 'Not attended', 'boolean', { readOnly: true, computed: leadComputed.notAttended, capabilities: { list: true, filter: true, sort: true }, width: 110 }),
    fl('followUpDue', 'Follow-up due', 'boolean', { readOnly: true, computed: leadComputed.followUpDue, capabilities: { list: true, filter: true, sort: true }, width: 110 }),
    fl('firstContactAt', 'First contacted', 'datetime', { readOnly: true, capabilities: { list: true, sort: true, filter: true, export: true } }),
    fl('lastActivityAt', 'Last activity', 'datetime', { readOnly: true, capabilities: { list: true, sort: true, filter: true, export: true } }),
    fl('escalatedAt', 'Escalated (first-contact SLA)', 'datetime', { readOnly: true, capabilities: { list: false, export: true } }),
  ],
  relationships: [{ id: 'rel_lead_activities', label: 'Activities', resource: 'activities', foreignKey: 'parentId' }],
  lifecycle: {
    field: 'status',
    initial: 'new',
    terminal: ['qualified'],
    // Qualify / Nurture / Disqualify capture data, so they are record actions (dialogs), not plain transitions.
    transitions: [
      { from: ['new'], to: 'contacted', action: 'Mark contacted' },
      { from: ['nurture'], to: 'contacted', action: 'Reactivate' },
      { from: ['disqualified'], to: 'contacted', action: 'Reactivate', capability: 'leads.reactivate', confirm: 'Reactivate this disqualified lead? It goes back to Contacted and needs a next follow-up date.' },
    ],
  },
  form: {
    fullPage: true,
    quickCreate: ['customerId', 'contactId', 'divisionId', 'sourceId', 'productType', 'nextFollowUpAt'],
    sections: [
      { id: 'who', title: 'Who', fields: ['customerId', 'contactId', 'divisionId', 'ownerId'], columns: 2 },
      { id: 'source', title: 'Source', fields: ['sourceId', 'campaign', 'eventName', 'referrerType', 'referrerEmployeeId', 'referrerCustomerId'], columns: 2 },
      { id: 'need', title: 'Requirement', fields: ['productType', 'subType', 'specPrintWidth', 'specPrintHeads', 'specFabricType', 'specCapacity', 'specPodVolume', 'specPodMedia', 'specPodFinishing', 'specLabelWidth', 'specLabelSubstrate', 'specLabelColours', 'specOther', 'requirement'], columns: 2 },
      { id: 'bant', title: 'Qualification', fields: ['budget', 'decisionMaker', 'timeline', 'currentSetup'], columns: 2 },
      { id: 'where', title: 'Location & segment', fields: ['city', 'state', 'industry', 'segment'], columns: 2 },
      { id: 'follow', title: 'Follow-up', fields: ['nextFollowUpAt', 'nurtureUntil', 'disqualifyReason', 'opportunityId'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_leads_open',
      resource: 'leads',
      name: 'Open',
      type: 'table',
      filter: group('and', [cond('status', 'in', ['new', 'contacted', 'nurture'])]),
      sort: [{ field: 'nextFollowUpAt', dir: 'asc' }],
      columns: cols('customerId', 'id', 'divisionId', 'productType', 'sourceId', 'ownerId', 'status', 'nextFollowUpAt', 'score'),
    },
    {
      id: 'v_leads_not_attended',
      resource: 'leads',
      name: 'Not attended',
      type: 'table',
      filter: group('and', [cond('notAttended', 'eq', true)]),
      sort: [{ field: 'createdAt', dir: 'asc' }],
      columns: cols('customerId', 'id', 'divisionId', 'sourceId', 'ownerId', 'status', 'score'),
    },
    {
      id: 'v_leads_followups',
      resource: 'leads',
      name: 'Follow-ups due',
      type: 'table',
      filter: group('and', [cond('followUpDue', 'eq', true)]),
      sort: [{ field: 'nextFollowUpAt', dir: 'asc' }],
      columns: cols('customerId', 'id', 'ownerId', 'status', 'nextFollowUpAt', 'lastActivityAt', 'score'),
    },
    {
      id: 'v_leads_board',
      resource: 'leads',
      name: 'Board',
      type: 'board',
      boardField: 'status',
      filter: group('and'),
      sort: [{ field: 'nextFollowUpAt', dir: 'asc' }],
      columns: cols('customerId', 'ownerId', 'productType', 'nextFollowUpAt'),
    },
    {
      id: 'v_leads_by_source',
      resource: 'leads',
      name: 'By source',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'createdAt', dir: 'desc' }],
      groupBy: 'sourceId',
      columns: cols('customerId', 'id', 'campaign', 'eventName', 'divisionId', 'ownerId', 'status'),
    },
    {
      id: 'v_leads_all',
      resource: 'leads',
      name: 'All',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'createdAt', dir: 'desc' }],
      columns: cols('customerId', 'id', 'divisionId', 'productType', 'sourceId', 'ownerId', 'status', 'disqualifyReason', 'opportunityId', 'score'),
    },
  ]),
};

const fa = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('assignmentRules', key, label, type, extra);

/** BR-09: division + product + territory → team, round-robin inside the team. */
export const assignmentRules: ResourceDefinition = {
  id: 'res_assignmentRules',
  key: 'assignmentRules',
  module: 'admin',
  label: 'Assignment rule',
  labelPlural: 'Lead assignment rules',
  icon: 'users',
  version: 1,
  idPrefix: 'AR',
  titleField: 'name',
  subtitleFields: ['divisionId', 'active'],
  divisionField: 'divisionId',
  description: 'Auto-assignment for web, API, imported and coordinator-entered leads. The first active matching rule (lowest priority number) wins; leads rotate round-robin inside the team. No match → the division head.',
  status: 'published',
  fields: [
    fa('name', 'Rule name', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 240 }),
    fa('priority', 'Priority', 'number', { required: true, min: 1, max: 999, defaultValue: 10, width: 90, help: 'Lower numbers are checked first.' }),
    fa('divisionId', 'Division', 'master', { master: 'division', required: true, width: 150 }),
    fa('productType', 'Product type', 'master', { master: 'productType', help: 'Empty = any product.', width: 130 }),
    fa('territoryId', 'Territory / hub', 'master', { master: 'territory', help: 'Empty = any territory. Matched against the territory whose state equals the lead’s state.', width: 130 }),
    fa('assigneeIds', 'Team (round-robin)', 'people', { relation: { resource: 'employees' }, required: true, width: 180, capabilities: { list: true, form: true, export: true } }),
    fa('active', 'Active', 'boolean', { defaultValue: true, width: 80 }),
    fa('rrPointer', 'Next in rotation', 'number', { readOnly: true, defaultValue: 0, capabilities: { export: true } }),
  ],
  relationships: [],
  form: {
    quickCreate: ['name', 'priority', 'divisionId', 'productType', 'territoryId', 'assigneeIds', 'active'],
    sections: [{ id: 'main', title: 'Rule', fields: ['name', 'priority', 'divisionId', 'productType', 'territoryId', 'assigneeIds', 'active'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_ar_all',
      resource: 'assignmentRules',
      name: 'All rules',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'priority', dir: 'asc' }],
      columns: cols('priority', 'name', 'divisionId', 'productType', 'territoryId', 'assigneeIds', 'active'),
    },
  ]),
};

const fs = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('leadScoringRules', key, label, type, extra);

/** LEAD-13 rule-based scoring: matching rules add points; the score is clamped to 0–100. */
export const leadScoringRules: ResourceDefinition = {
  id: 'res_leadScoringRules',
  key: 'leadScoringRules',
  module: 'admin',
  label: 'Scoring rule',
  labelPlural: 'Lead scoring rules',
  icon: 'star',
  version: 1,
  idPrefix: 'LSR',
  titleField: 'label',
  subtitleFields: ['factor', 'points'],
  description: 'Points added to a lead’s score when it matches. Source, segment and timeline match a value key; budget and engagement match “at least”.',
  status: 'published',
  fields: [
    fs('label', 'Rule', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 240 }),
    fs('factor', 'Factor', 'master', { master: 'scoringFactor', required: true, width: 170 }),
    fs('matchValue', 'Matches', 'text', { required: true, maxLength: 40, capabilities: NO_SEARCH, help: 'Source / segment / timeline: the value key (e.g. referral, mill, immediate). Budget: minimum amount in ₹. Engagement: minimum number of logged activities.' }),
    fs('points', 'Points', 'number', { required: true, min: -50, max: 100, width: 90 }),
    fs('active', 'Active', 'boolean', { defaultValue: true, width: 80 }),
  ],
  relationships: [],
  form: { quickCreate: ['label', 'factor', 'matchValue', 'points', 'active'], sections: [{ id: 'main', title: 'Rule', fields: ['label', 'factor', 'matchValue', 'points', 'active'], columns: 2 }] },
  views: views([
    { id: 'v_lsr_all', resource: 'leadScoringRules', name: 'All rules', type: 'table', filter: group('and'), sort: [{ field: 'factor', dir: 'asc' }], columns: cols('label', 'factor', 'matchValue', 'points', 'active') },
  ]),
};

const RULES_VIEW = p('all');
const RULES_EDIT = p('all', 'all', true, true, true);

export const leadsPack: ModulePack = {
  id: 'leads',
  nav: { id: 'leads', label: 'Sales', icon: 'activity', resources: ['leads'], pages: [{ id: 'follow-ups', label: 'Follow-ups', icon: 'calendar-clock', path: 'follow-ups' }, { id: 'leads-import', label: 'Import leads', icon: 'download', path: 'leads/import' }] },
  resources: [leads, assignmentRules, leadScoringRules],
  masters: leadMasters,
  // REQUIREMENTS §2.2 "Leads & opps" column.
  permissions: {
    admin: { leads: p('all', 'all', true, true, true), assignmentRules: RULES_EDIT, leadScoringRules: RULES_EDIT },
    management: { leads: p('all', 'none', false, false, true), assignmentRules: RULES_VIEW, leadScoringRules: RULES_VIEW },
    division_head: { leads: p('division', 'division', true, false, true), assignmentRules: p('division', 'division', true, true, false), leadScoringRules: RULES_VIEW },
    sales_manager: { leads: p('team', 'team', true), assignmentRules: RULES_VIEW },
    sales_exec: { leads: p('own', 'own', true) },
    service_head: { leads: p('all') },
    engineer: { leads: p('own', 'none', true) },
    coordinator: { leads: p('division', 'division', true) },
  },
  capabilities: {
    admin: ['leads.reactivate', 'leads.import'],
    management: ['leads.reactivate'],
    division_head: ['leads.reactivate', 'leads.import'],
    sales_manager: ['leads.reactivate', 'leads.import'],
    coordinator: ['leads.import'],
  },
  // Sales executives cannot hand their leads to someone else (LEAD-07 manual assignment is a manager action).
  fieldOverrides: { sales_exec: { 'leads.ownerId': 'view' } },
  extend: { admin: { resources: ['assignmentRules', 'leadScoringRules'] } },
};
