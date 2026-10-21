import type { MasterDefinition, MasterValue, ResourceDefinition, Tone } from '../../metadata/types';
import { ALL, cols, cond, field, FORM_ONLY, group, NO_SEARCH, views } from '../helpers';
import { leadComputed } from './leads/computed';
import { L } from '../../constants/labels';
import { p, type ModulePack } from './types';

const F = L.leads.fields.leads;
const FA = L.leads.fields.assignmentRules;
const FS = L.leads.fields.leadScoringRules;
const M = L.leads.masters;

const mv = (key: string, label: string, tone: Tone = 'neutral'): Omit<MasterValue, 'order'> => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[]): MasterDefinition => ({ id: `mst_${key}`, key, label, version: 1, values: values.map((x, i) => ({ ...x, order: i })) });

const leadMasters: MasterDefinition[] = [
  master('leadStatus', M.leadStatus.label, [mv('new', M.leadStatus.values.new, 'info'), mv('contacted', M.leadStatus.values.contacted, 'accent'), mv('qualified', M.leadStatus.values.qualified, 'success'), mv('nurture', M.leadStatus.values.nurture, 'warning'), mv('disqualified', M.leadStatus.values.disqualified, 'neutral')]),
  master('purchaseTimeline', M.purchaseTimeline.label, [mv('immediate', M.purchaseTimeline.values.immediate, 'danger'), mv('1_3m', M.purchaseTimeline.values.m1_3, 'warning'), mv('3_6m', M.purchaseTimeline.values.m3_6, 'info'), mv('6_12m', M.purchaseTimeline.values.m6_12), mv('12m_plus', M.purchaseTimeline.values.m12plus)]),
  master('printHeadConfig', M.printHeadConfig.label, [mv('4h', M.printHeadConfig.values.h4), mv('8h', M.printHeadConfig.values.h8), mv('16h', M.printHeadConfig.values.h16), mv('32h', M.printHeadConfig.values.h32), mv('64h', M.printHeadConfig.values.h64)]),
  master('fabricType', M.fabricType.label, [mv('polyester', M.fabricType.values.polyester), mv('cotton', M.fabricType.values.cotton), mv('silk', M.fabricType.values.silk), mv('viscose', M.fabricType.values.viscose), mv('blend', M.fabricType.values.blend), mv('nylon', M.fabricType.values.nylon)]),
  master('scoringFactor', M.scoringFactor.label, [mv('source', M.scoringFactor.values.source), mv('segment', M.scoringFactor.values.segment), mv('budget', M.scoringFactor.values.budget), mv('timeline', M.scoringFactor.values.timeline), mv('engagement', M.scoringFactor.values.engagement)]),
];

const fl = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('leads', key, label, type, extra);
const TEXTILE = { field: 'subType', op: 'eq' as const, value: 'textile' };
const POD = { field: 'subType', op: 'eq' as const, value: 'pod' };
const LABEL = { field: 'subType', op: 'eq' as const, value: 'label' };
const OTHER = { field: 'subType', op: 'eq' as const, value: 'other' };

/** LEAD-01…14. Convert to Opportunity / Nurture / Disqualify run through dialogs (they capture data). */
export const leads: ResourceDefinition = {
  id: 'res_leads',
  key: 'leads',
  module: 'leads',
  label: L.leads.records.leads.one,
  labelPlural: L.leads.records.leads.many,
  icon: 'activity',
  version: 1,
  idPrefix: 'LD',
  idFormat: 'fy',
  titleField: 'customerId',
  subtitleFields: ['status', 'ownerId'],
  ownerField: 'ownerId',
  divisionField: 'divisionId',
  description: L.leads.descriptions.leads,
  status: 'published',
  fields: [
    fl('customerId', F.customerId, 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220, subFields: ['contactId'] }),
    fl('contactId', F.contactId, 'relation', { relation: { resource: 'contacts', filterBy: { field: 'customerId', fromField: 'customerId' } }, required: true, width: 180 }),
    fl('divisionId', F.divisionId, 'master', { master: 'division', required: true, width: 150 }),
    fl('ownerId', F.ownerId, 'relation', { relation: { resource: 'employees', where: { field: 'status', op: 'neq', value: 'inactive' } }, width: 170, display: 'person', personSubtitle: 'designation', help: F.ownerIdHelp }),
    fl('sourceId', F.sourceId, 'master', { master: 'leadSource', required: true, width: 170 }),
    fl('campaign', F.campaign, 'text', { maxLength: 80, capabilities: ALL }),
    fl('eventName', F.eventName, 'text', { maxLength: 80, requiredWhen: { field: 'sourceId', op: 'eq', value: 'exhibition' }, visibleWhen: { field: 'sourceId', op: 'eq', value: 'exhibition' }, clearWhenHidden: true, capabilities: ALL }),
    fl('referrerType', F.referrerType, 'master', { master: 'referrerType', requiredWhen: { field: 'sourceId', op: 'eq', value: 'referral' }, visibleWhen: { field: 'sourceId', op: 'eq', value: 'referral' }, clearWhenHidden: true }),
    fl('referrerEmployeeId', F.referrerEmployeeId, 'relation', {
      relation: { resource: 'employees' },
      requiredWhen: { field: 'referrerType', op: 'in', value: ['engineer', 'employee'] },
      visibleWhen: { field: 'referrerType', op: 'in', value: ['engineer', 'employee'] },
      clearWhenHidden: true,
    }),
    fl('referrerCustomerId', F.referrerCustomerId, 'relation', {
      relation: { resource: 'customers' },
      requiredWhen: { field: 'referrerType', op: 'in', value: ['customer', 'dealer'] },
      visibleWhen: { field: 'referrerType', op: 'in', value: ['customer', 'dealer'] },
      clearWhenHidden: true,
    }),
    fl('productType', F.productType, 'master', { master: 'productType', required: true, width: 140 }),
    fl('subType', F.subType, 'master', { master: 'productSubType', width: 110 }),
    // Dynamic specification fields per sub-type (LEAD-06). Non-textile fields are placeholders until TC confirms them (Q-11).
    fl('specPrintWidth', F.specPrintWidth, 'number', { unit: 'mm', min: 300, max: 5200, visibleWhen: TEXTILE, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specPrintHeads', F.specPrintHeads, 'master', { master: 'printHeadConfig', visibleWhen: TEXTILE, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specFabricType', F.specFabricType, 'master', { master: 'fabricType', visibleWhen: TEXTILE, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specCapacity', F.specCapacity, 'number', { unit: 'm/day', min: 0, max: 200000, visibleWhen: TEXTILE, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specPodVolume', F.specPodVolume, 'number', { unit: 'prints', min: 0, visibleWhen: POD, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specPodMedia', F.specPodMedia, 'text', { maxLength: 80, visibleWhen: POD, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specPodFinishing', F.specPodFinishing, 'text', { maxLength: 80, visibleWhen: POD, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specLabelWidth', F.specLabelWidth, 'number', { unit: 'mm', min: 0, max: 1000, visibleWhen: LABEL, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specLabelSubstrate', F.specLabelSubstrate, 'text', { maxLength: 80, visibleWhen: LABEL, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specLabelColours', F.specLabelColours, 'number', { min: 1, max: 12, visibleWhen: LABEL, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('specOther', F.specOther, 'longtext', { maxLength: 500, visibleWhen: OTHER, clearWhenHidden: true, capabilities: FORM_ONLY }),
    fl('requirement', F.requirement, 'longtext', { maxLength: 2000, capabilities: { ...FORM_ONLY, search: true } }),
    fl('budget', F.budget, 'money', { min: 0, max: 999_999_999, width: 130 }),
    fl('decisionMaker', F.decisionMaker, 'text', { maxLength: 80 }),
    fl('timeline', F.timeline, 'master', { master: 'purchaseTimeline' }),
    fl('currentSetup', F.currentSetup, 'text', { maxLength: 120 }),
    fl('city', F.city, 'text', { maxLength: 60, capabilities: ALL, width: 120 }),
    fl('state', F.state, 'master', { master: 'state', width: 140 }),
    fl('industry', F.industry, 'master', { master: 'industry' }),
    fl('segment', F.segment, 'master', { master: 'segment' }),
    fl('status', F.status, 'master', { master: 'leadStatus', readOnly: true, defaultValue: 'new', width: 120 }),
    fl('nextFollowUpAt', F.nextFollowUpAt, 'date', {
      dateRule: 'future',
      requiredWhen: { field: 'status', op: 'in', value: ['new', 'contacted', 'nurture'] },
      width: 130,
      help: F.nextFollowUpAtHelp,
    }),
    fl('nurtureUntil', F.nurtureUntil, 'date', { readOnly: true, visibleWhen: { field: 'status', op: 'eq', value: 'nurture' } }),
    fl('disqualifyReason', F.disqualifyReason, 'master', { master: 'lostReason', readOnly: true, visibleWhen: { field: 'status', op: 'eq', value: 'disqualified' } }),
    fl('statusNote', F.statusNote, 'text', { readOnly: true, capabilities: { list: false, export: true } }),
    fl('opportunityId', F.opportunityId, 'relation', { relation: { resource: 'opportunities' }, readOnly: true, visibleWhen: { field: 'status', op: 'eq', value: 'qualified' } }),
    fl('score', F.score, 'number', { readOnly: true, computed: leadComputed.score, capabilities: { list: true, sort: true, filter: true, export: true }, width: 80, help: F.scoreHelp }),
    fl('notAttended', F.notAttended, 'boolean', { readOnly: true, computed: leadComputed.notAttended, capabilities: { list: true, filter: true, sort: true }, width: 110 }),
    fl('followUpDue', F.followUpDue, 'boolean', { readOnly: true, computed: leadComputed.followUpDue, capabilities: { list: true, filter: true, sort: true }, width: 110 }),
    fl('firstContactAt', F.firstContactAt, 'datetime', { readOnly: true, capabilities: { list: true, sort: true, filter: true, export: true } }),
    fl('lastActivityAt', F.lastActivityAt, 'datetime', { readOnly: true, capabilities: { list: true, sort: true, filter: true, export: true } }),
    fl('escalatedAt', F.escalatedAt, 'datetime', { readOnly: true, capabilities: { list: false, export: true } }),
  ],
  relationships: [{ id: 'rel_lead_activities', label: L.leads.tabs.activityHistory, resource: 'activities', foreignKey: 'parentId' }],
  lifecycle: {
    field: 'status',
    initial: 'new',
    terminal: ['qualified'],
    // Convert to Opportunity / Nurture / Disqualify capture data, so they are record actions (dialogs), not plain transitions.
    // New → Contacted happens only when the first follow-up is logged (Appendix A guard "first activity logged"),
    // so there is no manual "Mark Contacted" that would stop the first-contact SLA without a logged contact.
    // Nurture → Contacted is the visible "Reactivate" record action (asks for the next follow-up date), or logging a follow-up.
    transitions: [
      { from: ['disqualified'], to: 'contacted', action: L.leads.lifecycle.reactivate, capability: 'leads.reactivate', confirm: L.leads.lifecycle.reactivateConfirm },
    ],
  },
  form: {
    fullPage: true,
    quickCreate: ['customerId', 'contactId', 'divisionId', 'sourceId', 'productType', 'nextFollowUpAt'],
    sections: [
      { id: 'who', title: L.leads.sections.leads.who, fields: ['customerId', 'contactId', 'divisionId', 'ownerId'], columns: 2 },
      { id: 'source', title: L.leads.sections.leads.source, fields: ['sourceId', 'campaign', 'eventName', 'referrerType', 'referrerEmployeeId', 'referrerCustomerId'], columns: 2 },
      { id: 'need', title: L.leads.sections.leads.need, fields: ['productType', 'subType', 'specPrintWidth', 'specPrintHeads', 'specFabricType', 'specCapacity', 'specPodVolume', 'specPodMedia', 'specPodFinishing', 'specLabelWidth', 'specLabelSubstrate', 'specLabelColours', 'specOther', 'requirement'], columns: 2 },
      { id: 'bant', title: L.leads.sections.leads.bant, fields: ['budget', 'decisionMaker', 'timeline', 'currentSetup'], columns: 2 },
      { id: 'where', title: L.leads.sections.leads.where, fields: ['city', 'state', 'industry', 'segment'], columns: 2 },
      { id: 'follow', title: L.leads.sections.leads.follow, fields: ['nextFollowUpAt', 'nurtureUntil', 'disqualifyReason', 'opportunityId'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_leads_open',
      resource: 'leads',
      name: L.leads.views.leads.open,
      type: 'table',
      filter: group('and', [cond('status', 'in', ['new', 'contacted', 'nurture'])]),
      sort: [{ field: 'nextFollowUpAt', dir: 'asc' }],
      columns: cols('customerId', 'id', 'divisionId', 'productType', 'sourceId', 'ownerId', 'status', 'nextFollowUpAt', 'score'),
    },
    {
      id: 'v_leads_not_attended',
      resource: 'leads',
      name: L.leads.views.leads.notAttended,
      type: 'table',
      filter: group('and', [cond('notAttended', 'eq', true)]),
      sort: [{ field: 'createdAt', dir: 'asc' }],
      columns: cols('customerId', 'id', 'divisionId', 'sourceId', 'ownerId', 'status', 'score'),
    },
    {
      id: 'v_leads_followups',
      resource: 'leads',
      name: L.leads.views.leads.followUps,
      type: 'table',
      filter: group('and', [cond('followUpDue', 'eq', true)]),
      sort: [{ field: 'nextFollowUpAt', dir: 'asc' }],
      columns: cols('customerId', 'id', 'ownerId', 'status', 'nextFollowUpAt', 'lastActivityAt', 'score'),
    },
    {
      id: 'v_leads_board',
      resource: 'leads',
      name: L.leads.views.leads.board,
      type: 'board',
      boardField: 'status',
      filter: group('and'),
      sort: [{ field: 'nextFollowUpAt', dir: 'asc' }],
      columns: cols('customerId', 'ownerId', 'productType', 'nextFollowUpAt'),
    },
    {
      id: 'v_leads_by_source',
      resource: 'leads',
      name: L.leads.views.leads.bySource,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'createdAt', dir: 'desc' }],
      groupBy: 'sourceId',
      columns: cols('customerId', 'id', 'campaign', 'eventName', 'divisionId', 'ownerId', 'status'),
    },
    {
      id: 'v_leads_all',
      resource: 'leads',
      name: L.leads.views.leads.all,
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
  label: L.leads.records.assignmentRules.one,
  labelPlural: L.leads.records.assignmentRules.many,
  icon: 'users',
  version: 1,
  idPrefix: 'AR',
  titleField: 'name',
  subtitleFields: ['divisionId', 'active'],
  divisionField: 'divisionId',
  description: L.leads.descriptions.assignmentRules,
  status: 'published',
  fields: [
    fa('name', FA.name, 'text', { required: true, maxLength: 80, capabilities: ALL, width: 240 }),
    fa('priority', FA.priority, 'number', { required: true, min: 1, max: 999, defaultValue: 10, width: 90, help: FA.priorityHelp }),
    fa('divisionId', FA.divisionId, 'master', { master: 'division', required: true, width: 150 }),
    fa('productType', FA.productType, 'master', { master: 'productType', help: FA.productTypeHelp, width: 130 }),
    fa('territoryId', FA.territoryId, 'master', { master: 'territory', help: FA.territoryIdHelp, width: 130 }),
    fa('assigneeIds', FA.assigneeIds, 'people', { relation: { resource: 'employees' }, required: true, width: 180, capabilities: { list: true, form: true, export: true } }),
    fa('active', FA.active, 'boolean', { defaultValue: true, width: 80 }),
    fa('rrPointer', FA.rrPointer, 'number', { readOnly: true, defaultValue: 0, capabilities: { export: true } }),
  ],
  relationships: [],
  form: {
    quickCreate: ['name', 'priority', 'divisionId', 'productType', 'territoryId', 'assigneeIds', 'active'],
    sections: [{ id: 'main', title: L.leads.sections.rule, fields: ['name', 'priority', 'divisionId', 'productType', 'territoryId', 'assigneeIds', 'active'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_ar_all',
      resource: 'assignmentRules',
      name: L.leads.views.rules,
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
  label: L.leads.records.leadScoringRules.one,
  labelPlural: L.leads.records.leadScoringRules.many,
  icon: 'star',
  version: 1,
  idPrefix: 'LSR',
  titleField: 'label',
  subtitleFields: ['factor', 'points'],
  description: L.leads.descriptions.leadScoringRules,
  status: 'published',
  fields: [
    fs('label', FS.label, 'text', { required: true, maxLength: 80, capabilities: ALL, width: 240 }),
    fs('factor', FS.factor, 'master', { master: 'scoringFactor', required: true, width: 170 }),
    fs('matchValue', FS.matchValue, 'text', { required: true, maxLength: 40, capabilities: NO_SEARCH, help: FS.matchValueHelp }),
    fs('points', FS.points, 'number', { required: true, min: -50, max: 100, width: 90 }),
    fs('active', FS.active, 'boolean', { defaultValue: true, width: 80 }),
  ],
  relationships: [],
  form: { quickCreate: ['label', 'factor', 'matchValue', 'points', 'active'], sections: [{ id: 'main', title: L.leads.sections.rule, fields: ['label', 'factor', 'matchValue', 'points', 'active'], columns: 2 }] },
  views: views([
    { id: 'v_lsr_all', resource: 'leadScoringRules', name: L.leads.views.rules, type: 'table', filter: group('and'), sort: [{ field: 'factor', dir: 'asc' }], columns: cols('label', 'factor', 'matchValue', 'points', 'active') },
  ]),
};

const RULES_VIEW = p('all');
const RULES_EDIT = p('all', 'all', true, true, true);

export const leadsPack: ModulePack = {
  id: 'leads',
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
};
