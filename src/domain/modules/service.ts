/**
 * Service Ticket Management (BRD 4.8, FR-075 – FR-090): service tickets with SLA clocks, site visits
 * (job cards), Preventive Maintenance (PM) visits and knowledge articles. Labels: L.service.
 */
import type { MasterDefinition, MasterValue, ResourceDefinition, ResourcePermission, Tone } from '../../metadata/types';
import { ALL, cols, cond, field, FORM_ONLY, group, NO_SEARCH, views } from '../helpers';
import { p, type ModulePack } from './types';
import { L } from '../../constants/labels';

const S = L.service;
const F = S.fields;
const M = S.masters;

type FieldType = Parameters<typeof field>[3];
type Extra = Parameters<typeof field>[4];
const ft = (key: string, label: string, type: FieldType, extra?: Extra) => field('tickets', key, label, type, extra);
const fv = (key: string, label: string, type: FieldType, extra?: Extra) => field('serviceVisits', key, label, type, extra);
const fp = (key: string, label: string, type: FieldType, extra?: Extra) => field('pmVisits', key, label, type, extra);
const fk = (key: string, label: string, type: FieldType, extra?: Extra) => field('knowledgeArticles', key, label, type, extra);

const T = S.transitions;
const V = S.views;

const SYS = { list: true, sort: true, filter: true, export: true };
const HIDDEN = { export: true };

// ---------------------------------------------------------------- masters

const v = (key: string, label: string, tone: Tone = 'neutral', parent?: string): Omit<MasterValue, 'order'> => ({ key, label, tone, parent, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[], description?: string): MasterDefinition => ({
  id: `mst_${key}`,
  key,
  label,
  description,
  version: 1,
  values: values.map((x, i) => ({ ...x, order: i })),
});

/** Complaint categories → sub-category keys (§13 #3: final list comes from TC's service data). Labels: L.service.masters. */
export const COMPLAINT_TREE: Record<string, (keyof typeof M.complaintSubCategory.values)[]> = {
  print_quality: ['banding', 'colour_shift', 'streaks'],
  print_head: ['nozzle_missing', 'head_strike', 'head_error'],
  ink_system: ['ink_leak', 'ink_starvation', 'cartridge_error'],
  mechanical: ['belt', 'carriage', 'feed_jam'],
  electrical: ['power_trip', 'board_failure', 'heater'],
  software_rip: ['rip_crash', 'licence', 'driver'],
  media_feed: ['skew', 'wrinkle'],
  consumable_quality: ['ink_quality', 'paper_quality', 'fabric_quality'],
  other: ['other'],
};

const cat = M.complaintCategory.values;
const sub = M.complaintSubCategory.values;

export const serviceMasters: MasterDefinition[] = [
  master('ticketStatus', M.ticketStatus.label, [
    v('open', M.ticketStatus.values.open, 'info'),
    v('assigned', M.ticketStatus.values.assigned, 'info'),
    v('accepted', M.ticketStatus.values.accepted, 'accent'),
    v('in_progress', M.ticketStatus.values.in_progress, 'warning'),
    v('waiting_parts', M.ticketStatus.values.waiting_parts, 'warning'),
    v('waiting_customer', M.ticketStatus.values.waiting_customer, 'neutral'),
    v('resolved', M.ticketStatus.values.resolved, 'success'),
    v('customer_confirmation', M.ticketStatus.values.customer_confirmation, 'info'),
    v('closed', M.ticketStatus.values.closed, 'success'),
    v('reopened', M.ticketStatus.values.reopened, 'danger'),
  ]),
  master('ticketType', M.ticketType.label, [
    v('breakdown', M.ticketType.values.breakdown, 'danger'),
    v('installation', M.ticketType.values.installation),
    v('pm', M.ticketType.values.pm, 'info'),
    v('remote_support', M.ticketType.values.remote_support, 'accent'),
    v('training', M.ticketType.values.training),
    v('relocation', M.ticketType.values.relocation),
    v('chargeable_visit', M.ticketType.values.chargeable_visit, 'warning'),
    v('spare_only', M.ticketType.values.spare_only),
  ]),
  master('ticketPriority', M.ticketPriority.label, [
    v('critical', M.ticketPriority.values.critical, 'danger'),
    v('high', M.ticketPriority.values.high, 'warning'),
    v('medium', M.ticketPriority.values.medium, 'info'),
    v('low', M.ticketPriority.values.low),
  ]),
  master('ticketChannel', M.ticketChannel.label, [
    v('phone', M.ticketChannel.values.phone),
    v('whatsapp', M.ticketChannel.values.whatsapp, 'success'),
    v('email', M.ticketChannel.values.email, 'info'),
    v('portal', M.ticketChannel.values.portal, 'accent'),
    v('engineer_app', M.ticketChannel.values.engineer_app),
  ]),
  master(
    'complaintCategory',
    M.complaintCategory.label,
    Object.keys(COMPLAINT_TREE).map((k) => v(k, cat[k as keyof typeof cat])),
    M.complaintCategory.description,
  ),
  master(
    'complaintSubCategory',
    M.complaintSubCategory.label,
    Object.entries(COMPLAINT_TREE).flatMap(([parent, subs]) => subs.map((k) => v(k, sub[k], 'neutral', parent))),
  ),
  master('chargeableStatus', M.chargeableStatus.label, [
    v('none', M.chargeableStatus.values.none),
    v('quoted', M.chargeableStatus.values.quoted, 'warning'),
    v('approved', M.chargeableStatus.values.approved, 'success'),
    v('rejected', M.chargeableStatus.values.rejected, 'danger'),
    v('billing_requested', M.chargeableStatus.values.billing_requested, 'info'),
    v('waived', M.chargeableStatus.values.waived, 'neutral'),
  ]),
  // Key 'done' is kept (stored data); the label is "Completed" (GLOSSARY §3).
  master('pmStatus', M.pmStatus.label, [v('due', M.pmStatus.values.due, 'info'), v('overdue', M.pmStatus.values.overdue, 'danger'), v('done', M.pmStatus.values.done, 'success'), v('missed', M.pmStatus.values.missed, 'warning')]),
  master('visitStatus', M.visitStatus.label, [v('travelling', M.visitStatus.values.travelling, 'info'), v('on_site', M.visitStatus.values.on_site, 'warning'), v('completed', M.visitStatus.values.completed, 'success')]),
  master('visitType', M.visitType.label, [v('site', M.visitType.values.site), v('remote', M.visitType.values.remote, 'accent')]),
  master('signOffMethod', M.signOffMethod.label, [v('otp', M.signOffMethod.values.otp), v('signature', M.signOffMethod.values.signature)]),
  master('kbStatus', M.kbStatus.label, [v('draft', M.kbStatus.values.draft), v('pending', M.kbStatus.values.pending, 'warning'), v('published', M.kbStatus.values.published, 'success')]),
];

// ---------------------------------------------------------------- tickets

export const tickets: ResourceDefinition = {
  id: 'res_tickets',
  key: 'tickets',
  module: 'service',
  label: S.records.tickets.one,
  labelPlural: S.records.tickets.many,
  icon: 'activity',
  version: 1,
  idPrefix: 'TKT',
  idFormat: 'fy',
  titleField: 'description',
  subtitleFields: ['customerId', 'status'],
  ownerField: 'assigneeId',
  divisionField: 'divisionId',
  description: S.descriptions.tickets,
  status: 'published',
  fields: [
    ft('customerId', F.tickets.customerId, 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220, subFields: ['machineId'] }),
    ft('machineId', F.tickets.machineId, 'relation', {
      relation: { resource: 'machines', filterBy: { field: 'customerId', fromField: 'customerId' } },
      width: 170,
      help: F.tickets.machineIdHelp,
    }),
    ft('contactId', F.tickets.contactId, 'relation', { relation: { resource: 'contacts', filterBy: { field: 'customerId', fromField: 'customerId' } }, width: 170 }),
    ft('channel', F.tickets.channel, 'master', { master: 'ticketChannel', required: true, defaultValue: 'phone', width: 140 }),
    ft('reportedAt', F.tickets.reportedAt, 'datetime', { readOnly: true, width: 150, capabilities: SYS }),
    ft('description', F.tickets.description, 'longtext', { required: true, maxLength: 2000, capabilities: { ...ALL, list: true }, width: 280 }),
    ft('category', F.tickets.category, 'master', { master: 'complaintCategory', required: true, width: 150 }),
    ft('subCategory', F.tickets.subCategory, 'master', { master: 'complaintSubCategory', masterParentField: 'category', width: 160 }),
    ft('ticketType', F.tickets.ticketType, 'master', { master: 'ticketType', required: true, defaultValue: 'breakdown', width: 150 }),
    ft('priority', F.tickets.priority, 'master', { master: 'ticketPriority', required: true, defaultValue: 'medium', width: 160 }),
    ft('coverage', F.tickets.coverage, 'master', { master: 'coverage', readOnly: true, width: 150, capabilities: SYS }),
    ft('divisionId', F.tickets.divisionId, 'master', { master: 'division', width: 130, help: F.tickets.divisionIdHelp }),
    ft('assigneeId', F.tickets.assigneeId, 'relation', {
      relation: { resource: 'employees', where: { field: 'roleId', op: 'in', value: ['engineer', 'service_head'] } },
      width: 170,
      display: 'person',
      personSubtitle: 'designation',
      help: F.tickets.assigneeIdHelp,
    }),
    ft('status', F.tickets.status, 'master', { master: 'ticketStatus', readOnly: true, width: 170 }),
    ft('responseDueAt', F.tickets.responseDueAt, 'datetime', { readOnly: true, capabilities: SYS }),
    ft('arrivalDueAt', F.tickets.arrivalDueAt, 'datetime', { readOnly: true, capabilities: SYS }),
    ft('resolutionDueAt', F.tickets.resolutionDueAt, 'datetime', { readOnly: true, capabilities: SYS, width: 150 }),
    ft('respondedAt', F.tickets.respondedAt, 'datetime', { readOnly: true, capabilities: SYS }),
    ft('arrivedAt', F.tickets.arrivedAt, 'datetime', { readOnly: true, capabilities: SYS }),
    ft('resolvedAt', F.tickets.resolvedAt, 'datetime', { readOnly: true, capabilities: SYS }),
    ft('closedAt', F.tickets.closedAt, 'datetime', { readOnly: true, capabilities: SYS }),
    ft('slaBreached', F.tickets.slaBreached, 'boolean', { readOnly: true, capabilities: SYS, width: 110 }),
    ft('resolution', F.tickets.resolution, 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
    ft('repeatOfId', F.tickets.repeatOfId, 'relation', { relation: { resource: 'tickets' }, readOnly: true, capabilities: SYS }),
    ft('rootCause', F.tickets.rootCause, 'longtext', { maxLength: 1000, capabilities: FORM_ONLY, help: F.tickets.rootCauseHelp }),
    ft('rating', F.tickets.rating, 'number', { readOnly: true, min: 1, max: 5, capabilities: SYS }),
    ft('feedbackComment', F.tickets.feedbackComment, 'longtext', { readOnly: true, capabilities: { export: true } }),
    ft('reopenCount', F.tickets.reopenCount, 'number', { readOnly: true, capabilities: SYS }),
    ft('remoteSteps', F.tickets.remoteSteps, 'longtext', { readOnly: true, capabilities: { export: true } }),
    ft('remoteDurationMin', F.tickets.remoteDurationMin, 'number', { readOnly: true, unit: 'min', capabilities: { export: true } }),
    ft('remoteSessionRef', F.tickets.remoteSessionRef, 'text', { readOnly: true, capabilities: { export: true } }),
    ft('chargeableStatus', F.tickets.chargeableStatus, 'master', { master: 'chargeableStatus', readOnly: true, defaultValue: 'none', capabilities: SYS }),
    ft('chargeableAmount', F.tickets.chargeableAmount, 'money', { readOnly: true, currency: 'INR', capabilities: SYS }),
    ft('chargeableNote', F.tickets.chargeableNote, 'longtext', { readOnly: true, capabilities: { export: true } }),
    ft('spottedLeadId', F.tickets.spottedLeadId, 'text', { readOnly: true, capabilities: { export: true } }),
    // System bookkeeping (not shown in forms)
    ft('pausedSince', F.tickets.pausedSince, 'datetime', { system: true, readOnly: true, capabilities: HIDDEN }),
    ft('pausedMinutes', F.tickets.pausedMinutes, 'number', { system: true, readOnly: true, capabilities: HIDDEN }),
    ft('escalationLevel', F.tickets.escalationLevel, 'number', { system: true, readOnly: true, capabilities: HIDDEN }),
    ft('feedbackToken', F.tickets.feedbackToken, 'text', { system: true, readOnly: true, capabilities: {} }),
    ft('lastActivityAt', F.tickets.lastActivityAt, 'datetime', { system: true, readOnly: true, capabilities: HIDDEN }),
  ],
  relationships: [
    { id: 'rel_ticket_visits', label: S.relationships.ticketVisits, resource: 'serviceVisits', foreignKey: 'ticketId' },
    { id: 'rel_ticket_repeats', label: S.relationships.ticketRepeats, resource: 'tickets', foreignKey: 'repeatOfId' },
  ],
  lifecycle: {
    field: 'status',
    initial: 'open',
    terminal: [],
    transitions: [
      { from: ['open', 'reopened'], to: 'assigned', action: T.assignEngineer, capability: 'ticket.assign' },
      { from: ['assigned'], to: 'accepted', action: T.acceptJob },
      { from: ['assigned'], to: 'open', action: T.rejectJob, confirm: T.rejectJobConfirm },
      { from: ['accepted', 'reopened'], to: 'in_progress', action: T.startWork },
      { from: ['in_progress'], to: 'waiting_parts', action: T.waitingParts },
      { from: ['in_progress'], to: 'waiting_customer', action: T.waitingCustomer },
      { from: ['waiting_parts', 'waiting_customer'], to: 'in_progress', action: T.resumeWork },
      { from: ['in_progress'], to: 'resolved', action: T.resolve },
      { from: ['resolved'], to: 'customer_confirmation', action: T.sendForConfirmation },
      { from: ['customer_confirmation'], to: 'closed', action: T.closeConfirmed },
      { from: ['customer_confirmation'], to: 'in_progress', action: T.notResolved },
      { from: ['closed'], to: 'reopened', action: T.reopen, confirm: T.reopenConfirm },
    ],
  },
  form: {
    quickCreate: ['customerId', 'machineId', 'contactId', 'channel', 'description', 'category', 'subCategory', 'ticketType', 'priority', 'divisionId'],
    sections: [
      { id: 'who', title: S.sections.tickets.who, fields: ['customerId', 'machineId', 'contactId', 'channel', 'divisionId'], columns: 2 },
      { id: 'what', title: S.sections.tickets.what, fields: ['description', 'category', 'subCategory', 'ticketType', 'priority', 'assigneeId'], columns: 2 },
      { id: 'close', title: S.sections.tickets.close, fields: ['resolution', 'rootCause'], columns: 1 },
    ],
    primaryLabel: S.actions.logTicket,
  },
  views: views([
    {
      id: 'v_tkt_open',
      resource: 'tickets',
      name: V.tickets.open,
      type: 'table',
      filter: group('and', [cond('status', 'in', ['open', 'assigned', 'accepted', 'in_progress', 'waiting_parts', 'waiting_customer', 'reopened'])]),
      sort: [{ field: 'resolutionDueAt', dir: 'asc' }],
      columns: cols('id', 'customerId', 'description', 'priority', 'status', 'assigneeId', 'coverage', 'resolutionDueAt', 'slaBreached'),
    },
    {
      id: 'v_tkt_unassigned',
      resource: 'tickets',
      name: V.tickets.unassigned,
      type: 'table',
      filter: group('and', [cond('status', 'in', ['open', 'reopened'])]),
      sort: [{ field: 'reportedAt', dir: 'asc' }],
      columns: cols('id', 'customerId', 'description', 'priority', 'divisionId', 'reportedAt', 'responseDueAt', 'channel'),
    },
    {
      id: 'v_tkt_breached',
      resource: 'tickets',
      name: V.tickets.breached,
      type: 'table',
      filter: group('and', [cond('slaBreached', 'eq', true), cond('status', 'in', ['open', 'assigned', 'accepted', 'in_progress', 'waiting_parts', 'waiting_customer', 'reopened'])]),
      sort: [{ field: 'resolutionDueAt', dir: 'asc' }],
      columns: cols('id', 'customerId', 'priority', 'status', 'assigneeId', 'resolutionDueAt', 'coverage'),
    },
    {
      id: 'v_tkt_repeat',
      resource: 'tickets',
      name: V.tickets.repeat,
      type: 'table',
      filter: group('and', [cond('repeatOfId', 'notEmpty')]),
      sort: [{ field: 'reportedAt', dir: 'desc' }],
      columns: cols('id', 'customerId', 'machineId', 'category', 'repeatOfId', 'status', 'assigneeId'),
    },
    {
      id: 'v_tkt_board',
      resource: 'tickets',
      name: V.tickets.board,
      type: 'board',
      boardField: 'status',
      filter: group('and', [cond('status', 'neq', 'closed')]),
      sort: [{ field: 'resolutionDueAt', dir: 'asc' }],
      columns: cols('customerId', 'priority', 'assigneeId', 'resolutionDueAt'),
    },
    {
      id: 'v_tkt_all',
      resource: 'tickets',
      name: V.tickets.all,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'reportedAt', dir: 'desc' }],
      columns: cols('id', 'reportedAt', 'customerId', 'machineId', 'ticketType', 'category', 'priority', 'status', 'assigneeId', 'rating'),
    },
  ]),
};

// ---------------------------------------------------------------- site visits (job cards; resource key serviceVisits)

export const serviceVisits: ResourceDefinition = {
  id: 'res_serviceVisits',
  key: 'serviceVisits',
  module: 'service',
  label: S.records.serviceVisits.one,
  labelPlural: S.records.serviceVisits.many,
  icon: 'id-card',
  version: 1,
  idPrefix: 'SV',
  titleField: 'ticketId',
  subtitleFields: ['engineerId', 'status'],
  ownerField: 'engineerId',
  description: S.descriptions.serviceVisits,
  status: 'published',
  fields: [
    fv('ticketId', F.serviceVisits.ticketId, 'relation', { relation: { resource: 'tickets' }, required: true, capabilities: ALL, width: 160 }),
    fv('engineerId', F.serviceVisits.engineerId, 'relation', { relation: { resource: 'employees' }, required: true, width: 170, display: 'person' }),
    fv('visitType', F.serviceVisits.visitType, 'master', { master: 'visitType', required: true, defaultValue: 'site' }),
    fv('status', F.serviceVisits.status, 'master', { master: 'visitStatus', readOnly: true, defaultValue: 'travelling' }),
    fv('travelStartAt', F.serviceVisits.travelStartAt, 'datetime', { readOnly: true }),
    fv('checkInAt', F.serviceVisits.checkInAt, 'datetime', { readOnly: true, width: 150 }),
    fv('checkInLat', F.serviceVisits.checkInLat, 'number', { readOnly: true, capabilities: { export: true } }),
    fv('checkInLng', F.serviceVisits.checkInLng, 'number', { readOnly: true, capabilities: { export: true } }),
    fv('checkInMock', F.serviceVisits.checkInMock, 'boolean', { readOnly: true, capabilities: { export: true } }),
    fv('diagnosis', F.serviceVisits.diagnosis, 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
    fv('workDone', F.serviceVisits.workDone, 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
    fv('partsUsed', F.serviceVisits.partsUsed, 'text', { maxLength: 300, capabilities: NO_SEARCH }),
    fv('photosBefore', F.serviceVisits.photosBefore, 'text', { readOnly: true, capabilities: { export: true } }),
    fv('photosAfter', F.serviceVisits.photosAfter, 'text', { readOnly: true, capabilities: { export: true } }),
    fv('printCounter', F.serviceVisits.printCounter, 'number', { min: 0, unit: 'm²' }),
    fv('inkUsedMl', F.serviceVisits.inkUsedMl, 'number', { min: 0, unit: 'ml' }),
    fv('checkOutAt', F.serviceVisits.checkOutAt, 'datetime', { readOnly: true }),
    fv('signOffMethod', F.serviceVisits.signOffMethod, 'master', { master: 'signOffMethod', readOnly: true }),
    fv('signedOffAt', F.serviceVisits.signedOffAt, 'datetime', { readOnly: true }),
  ],
  relationships: [],
  form: {
    quickCreate: ['ticketId', 'engineerId', 'visitType', 'diagnosis', 'workDone'],
    sections: [
      { id: 'main', title: S.sections.serviceVisits.main, fields: ['ticketId', 'engineerId', 'visitType'], columns: 2 },
      { id: 'work', title: S.sections.serviceVisits.work, fields: ['diagnosis', 'workDone', 'partsUsed', 'printCounter', 'inkUsedMl'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_sv_recent',
      resource: 'serviceVisits',
      name: V.serviceVisits.recent,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'checkInAt', dir: 'desc' }],
      columns: cols('id', 'ticketId', 'engineerId', 'visitType', 'status', 'checkInAt', 'checkOutAt', 'signOffMethod'),
    },
  ]),
};

// ---------------------------------------------------------------- PM visits (created by the installed module)

export const pmVisits: ResourceDefinition = {
  id: 'res_pmVisits',
  key: 'pmVisits',
  module: 'service',
  label: S.records.pmVisits.one,
  labelPlural: S.records.pmVisits.many,
  icon: 'calendar-clock',
  version: 1,
  idPrefix: 'PMV',
  titleField: 'machineId',
  subtitleFields: ['dueDate', 'status'],
  ownerField: 'engineerId',
  divisionField: 'divisionId',
  description: S.descriptions.pmVisits,
  status: 'published',
  fields: [
    fp('machineId', F.pmVisits.machineId, 'relation', { relation: { resource: 'machines' }, required: true, capabilities: ALL, width: 170 }),
    fp('customerId', F.pmVisits.customerId, 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 210 }),
    fp('amcContractId', F.pmVisits.amcContractId, 'relation', { relation: { resource: 'amcContracts' }, width: 150 }),
    fp('dueDate', F.pmVisits.dueDate, 'date', { required: true, width: 120 }),
    fp('status', F.pmVisits.status, 'master', { master: 'pmStatus', readOnly: true, defaultValue: 'due', width: 110 }),
    fp('engineerId', F.pmVisits.engineerId, 'relation', { relation: { resource: 'employees', where: { field: 'roleId', op: 'in', value: ['engineer', 'service_head'] } }, width: 170, display: 'person' }),
    fp('divisionId', F.pmVisits.divisionId, 'master', { master: 'division', width: 130 }),
    fp('ticketId', F.pmVisits.ticketId, 'relation', { relation: { resource: 'tickets' }, readOnly: true }),
    fp('completedAt', F.pmVisits.completedAt, 'date', { readOnly: true }),
    fp('checklist', F.pmVisits.checklist, 'longtext', { readOnly: true, capabilities: { export: true } }),
  ],
  relationships: [],
  form: {
    quickCreate: ['machineId', 'customerId', 'dueDate', 'engineerId', 'divisionId'],
    sections: [{ id: 'main', title: S.sections.pmVisits.main, fields: ['machineId', 'customerId', 'amcContractId', 'dueDate', 'engineerId', 'divisionId'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_pm_due',
      resource: 'pmVisits',
      name: V.pmVisits.due,
      type: 'table',
      filter: group('and', [cond('status', 'in', ['due', 'overdue'])]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: cols('dueDate', 'machineId', 'customerId', 'status', 'engineerId', 'amcContractId'),
    },
    {
      id: 'v_pm_all',
      resource: 'pmVisits',
      name: V.pmVisits.all,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'dueDate', dir: 'desc' }],
      columns: cols('dueDate', 'machineId', 'customerId', 'status', 'engineerId', 'completedAt'),
    },
  ]),
};

// ---------------------------------------------------------------- knowledge base

export const knowledgeArticles: ResourceDefinition = {
  id: 'res_knowledgeArticles',
  key: 'knowledgeArticles',
  module: 'service',
  label: S.records.knowledgeArticles.one,
  labelPlural: S.records.knowledgeArticles.many,
  icon: 'scroll-text',
  version: 1,
  idPrefix: 'KB',
  titleField: 'title',
  subtitleFields: ['category', 'status'],
  ownerField: 'authorId',
  description: S.descriptions.knowledgeArticles,
  status: 'published',
  fields: [
    fk('title', F.knowledgeArticles.title, 'text', { required: true, maxLength: 140, capabilities: ALL, width: 320, subFields: ['models'] }),
    fk('models', F.knowledgeArticles.models, 'text', { required: true, maxLength: 200, capabilities: ALL, width: 200, help: F.knowledgeArticles.modelsHelp }),
    fk('errorCodes', F.knowledgeArticles.errorCodes, 'text', { maxLength: 120, capabilities: ALL, width: 140 }),
    fk('category', F.knowledgeArticles.category, 'master', { master: 'complaintCategory', required: true, width: 150 }),
    fk('symptoms', F.knowledgeArticles.symptoms, 'longtext', { required: true, maxLength: 2000, capabilities: { ...FORM_ONLY, search: true } }),
    fk('solution', F.knowledgeArticles.solution, 'longtext', { required: true, maxLength: 4000, capabilities: { ...FORM_ONLY, search: true } }),
    fk('authorId', F.knowledgeArticles.authorId, 'relation', { relation: { resource: 'employees' }, required: true, width: 170, display: 'person' }),
    fk('status', F.knowledgeArticles.status, 'master', { master: 'kbStatus', readOnly: true, width: 140 }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'draft',
    terminal: [],
    transitions: [
      { from: ['draft'], to: 'pending', action: T.submitForApproval },
      { from: ['draft', 'pending'], to: 'published', action: T.publish, capability: 'approve.service' },
      { from: ['published'], to: 'draft', action: T.unpublish, capability: 'approve.service', confirm: T.unpublishConfirm },
    ],
  },
  form: {
    quickCreate: ['title', 'models', 'errorCodes', 'category', 'symptoms', 'solution'],
    sections: [{ id: 'main', title: S.sections.knowledgeArticles.main, fields: ['title', 'models', 'errorCodes', 'category', 'symptoms', 'solution'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_kb_published',
      resource: 'knowledgeArticles',
      name: V.knowledgeArticles.published,
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'published')]),
      sort: [{ field: 'title', dir: 'asc' }],
      columns: cols('title', 'models', 'errorCodes', 'category', 'authorId'),
    },
    {
      id: 'v_kb_review',
      resource: 'knowledgeArticles',
      name: V.knowledgeArticles.review,
      type: 'table',
      filter: group('and', [cond('status', 'in', ['draft', 'pending'])]),
      sort: [{ field: 'title', dir: 'asc' }],
      columns: cols('title', 'models', 'category', 'authorId', 'status'),
    },
  ]),
};

// ---------------------------------------------------------------- permissions (REQUIREMENTS §2.2)

const R = (tickets: ResourcePermission, visits: ResourcePermission, pm: ResourcePermission, kb: ResourcePermission) => ({ tickets, serviceVisits: visits, pmVisits: pm, knowledgeArticles: kb });
const kbRead = p('all');
const kbContribute: ResourcePermission = { ...p('all', 'own', true), read: 'all' };

const permissions: ModulePack['permissions'] = {
  admin: R(p('all', 'all', true, true, true), p('all', 'all', true, true, true), p('all', 'all', true, true, true), p('all', 'all', true, true, true)),
  management: R(p('all', 'none', false, false, true), p('all'), p('all'), kbRead),
  division_head: R(p('division', 'none', false, false, true), p('division'), p('division'), kbRead),
  sales_manager: R(p('division'), p('none'), p('division'), kbRead),
  sales_exec: R(p('division'), p('none'), p('division'), kbRead),
  service_head: R(p('all', 'all', true, false, true), p('all', 'all', true, false, true), p('all', 'all', true, false, true), p('all', 'all', true, false, true)),
  engineer: R(p('own', 'own', true), p('own', 'own', true), p('own', 'own'), kbContribute),
  coordinator: R(p('division', 'division', true, false, true), p('division'), p('division', 'division', true), kbRead),
  scm: R(p('none'), p('none'), p('none'), p('none')),
  store: R(p('all'), p('all'), p('none'), kbRead),
  accounts: R(p('all'), p('none'), p('none'), p('none')),
  profiling: R(p('none'), p('none'), p('none'), p('none')),
};

export const servicePack: ModulePack = {
  id: 'service',
  resources: [tickets, serviceVisits, pmVisits, knowledgeArticles],
  masters: serviceMasters,
  permissions,
  capabilities: {
    admin: ['ticket.assign', 'ticket.chargeable', 'service.field'],
    service_head: ['ticket.assign', 'ticket.chargeable', 'service.field'],
    coordinator: ['ticket.assign', 'ticket.chargeable'],
    engineer: ['service.field'],
  },
};
