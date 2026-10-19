/**
 * Service module (BRD 4.8, FR-075 – FR-090): service tickets with SLA clocks, engineer visits
 * (job cards), preventive-maintenance visits and the knowledge base.
 */
import type { MasterDefinition, MasterValue, ResourceDefinition, ResourcePermission, Tone } from '../../metadata/types';
import { ALL, cols, cond, field, FORM_ONLY, group, NO_SEARCH, views } from '../helpers';
import { p, type ModulePack } from './types';

type FieldType = Parameters<typeof field>[3];
type Extra = Parameters<typeof field>[4];
const ft = (key: string, label: string, type: FieldType, extra?: Extra) => field('tickets', key, label, type, extra);
const fv = (key: string, label: string, type: FieldType, extra?: Extra) => field('serviceVisits', key, label, type, extra);
const fp = (key: string, label: string, type: FieldType, extra?: Extra) => field('pmVisits', key, label, type, extra);
const fk = (key: string, label: string, type: FieldType, extra?: Extra) => field('knowledgeArticles', key, label, type, extra);

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

/** Complaint categories and sub-categories (§13 #3: final list comes from TC's service data). */
export const COMPLAINT_TREE: Record<string, [string, string][]> = {
  print_quality: [
    ['banding', 'Banding / lines'],
    ['colour_shift', 'Colour shift'],
    ['streaks', 'Streaks or smudges'],
  ],
  print_head: [
    ['nozzle_missing', 'Missing nozzles'],
    ['head_strike', 'Head strike'],
    ['head_error', 'Head error / not detected'],
  ],
  ink_system: [
    ['ink_leak', 'Ink leakage'],
    ['ink_starvation', 'Ink starvation'],
    ['cartridge_error', 'Cartridge / chip error'],
  ],
  mechanical: [
    ['belt', 'Belt / encoder'],
    ['carriage', 'Carriage movement'],
    ['feed_jam', 'Media / fabric jam'],
  ],
  electrical: [
    ['power_trip', 'Power trip'],
    ['board_failure', 'Board failure'],
    ['heater', 'Heater / dryer'],
  ],
  software_rip: [
    ['rip_crash', 'RIP crash'],
    ['licence', 'Licence / dongle'],
    ['driver', 'Driver / connectivity'],
  ],
  media_feed: [
    ['skew', 'Skew'],
    ['wrinkle', 'Wrinkle / tension'],
  ],
  consumable_quality: [
    ['ink_quality', 'Ink quality'],
    ['paper_quality', 'Paper quality'],
    ['fabric_quality', 'Fabric quality'],
  ],
  other: [['other', 'Other']],
};

const CATEGORY_LABEL: Record<string, string> = {
  print_quality: 'Print quality',
  print_head: 'Print head',
  ink_system: 'Ink system',
  mechanical: 'Mechanical',
  electrical: 'Electrical',
  software_rip: 'Software / RIP',
  media_feed: 'Media feed',
  consumable_quality: 'Consumable quality',
  other: 'Other',
};

export const serviceMasters: MasterDefinition[] = [
  master('ticketStatus', 'Ticket status', [
    v('open', 'Open', 'info'),
    v('assigned', 'Assigned', 'info'),
    v('accepted', 'Accepted', 'accent'),
    v('in_progress', 'In progress', 'warning'),
    v('waiting_parts', 'Waiting for parts', 'warning'),
    v('waiting_customer', 'Waiting for customer', 'neutral'),
    v('resolved', 'Resolved', 'success'),
    v('customer_confirmation', 'Customer confirmation', 'info'),
    v('closed', 'Closed', 'success'),
    v('reopened', 'Re-opened', 'danger'),
  ]),
  master('ticketType', 'Ticket type', [
    v('breakdown', 'Breakdown', 'danger'),
    v('installation', 'Installation'),
    v('pm', 'Preventive maintenance', 'info'),
    v('remote_support', 'Remote support', 'accent'),
    v('training', 'Training'),
    v('relocation', 'Relocation'),
    v('chargeable_visit', 'Chargeable visit', 'warning'),
    v('spare_only', 'Spare-part only'),
  ]),
  master('ticketPriority', 'Ticket priority', [v('critical', 'Critical (machine down)', 'danger'), v('high', 'High', 'warning'), v('medium', 'Medium', 'info'), v('low', 'Low')]),
  master('ticketChannel', 'Logged via', [v('phone', 'Phone (coordinator)'), v('whatsapp', 'WhatsApp', 'success'), v('email', 'Email', 'info'), v('portal', 'Customer portal', 'accent'), v('engineer_app', 'Engineer app')]),
  master(
    'complaintCategory',
    'Complaint category',
    Object.keys(COMPLAINT_TREE).map((k) => v(k, CATEGORY_LABEL[k])),
    'Indicative list; the final master comes from True Colors’ service data (BRD §13 #3).',
  ),
  master(
    'complaintSubCategory',
    'Complaint sub-category',
    Object.entries(COMPLAINT_TREE).flatMap(([parent, subs]) => subs.map(([k, l]) => v(k, l, 'neutral', parent))),
  ),
  master('chargeableStatus', 'Chargeable status', [
    v('none', 'Not chargeable'),
    v('quoted', 'Quote sent', 'warning'),
    v('approved', 'Customer approved', 'success'),
    v('rejected', 'Customer declined', 'danger'),
    v('billing_requested', 'Billing requested (ERP)', 'info'),
    v('waived', 'Charges waived', 'neutral'),
  ]),
  master('pmStatus', 'PM visit status', [v('due', 'Due', 'info'), v('overdue', 'Overdue', 'danger'), v('done', 'Done', 'success'), v('missed', 'Missed', 'warning')]),
  master('visitStatus', 'Visit status', [v('travelling', 'Travelling', 'info'), v('on_site', 'On site', 'warning'), v('completed', 'Completed', 'success')]),
  master('visitType', 'Visit type', [v('site', 'Site visit'), v('remote', 'Remote session', 'accent')]),
  master('signOffMethod', 'Customer sign-off', [v('otp', 'One-time code'), v('signature', 'Signature')]),
  master('kbStatus', 'Article status', [v('draft', 'Draft'), v('pending', 'Pending approval', 'warning'), v('published', 'Published', 'success')]),
];

// ---------------------------------------------------------------- tickets

export const tickets: ResourceDefinition = {
  id: 'res_tickets',
  key: 'tickets',
  module: 'service',
  label: 'Service ticket',
  labelPlural: 'Service tickets',
  icon: 'activity',
  version: 1,
  idPrefix: 'TKT',
  idFormat: 'fy',
  titleField: 'description',
  subtitleFields: ['customerId', 'status'],
  ownerField: 'assigneeId',
  divisionField: 'divisionId',
  description: 'Breakdowns, PM, remote support and chargeable visits with SLA clocks. Coverage (warranty / AMC / CMC) is checked automatically.',
  status: 'published',
  fields: [
    ft('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 220, subFields: ['machineId'] }),
    ft('machineId', 'Machine', 'relation', {
      relation: { resource: 'machines', filterBy: { field: 'customerId', fromField: 'customerId' } },
      width: 170,
      help: 'Required for machine divisions (Textile, POD, Label). Optional for Ink, Paper and Fabric complaints.',
    }),
    ft('contactId', 'Reported by', 'relation', { relation: { resource: 'contacts', filterBy: { field: 'customerId', fromField: 'customerId' } }, width: 170 }),
    ft('channel', 'Logged via', 'master', { master: 'ticketChannel', required: true, defaultValue: 'phone', width: 140 }),
    ft('reportedAt', 'Reported at', 'datetime', { readOnly: true, width: 150, capabilities: SYS }),
    ft('description', 'Complaint', 'longtext', { required: true, maxLength: 2000, capabilities: { ...ALL, list: true }, width: 280 }),
    ft('category', 'Category', 'master', { master: 'complaintCategory', required: true, width: 150 }),
    ft('subCategory', 'Sub-category', 'master', { master: 'complaintSubCategory', masterParentField: 'category', width: 160 }),
    ft('ticketType', 'Type', 'master', { master: 'ticketType', required: true, defaultValue: 'breakdown', width: 150 }),
    ft('priority', 'Priority', 'master', { master: 'ticketPriority', required: true, defaultValue: 'medium', width: 160 }),
    ft('coverage', 'Coverage', 'master', { master: 'coverage', readOnly: true, width: 150, capabilities: SYS }),
    ft('divisionId', 'Division', 'master', { master: 'division', width: 130, help: 'Taken from the machine; choose it for Ink / Paper / Fabric complaints without a machine.' }),
    ft('assigneeId', 'Engineer', 'relation', {
      relation: { resource: 'employees', where: { field: 'roleId', op: 'in', value: ['engineer', 'service_head'] } },
      width: 170,
      display: 'person',
      personSubtitle: 'designation',
      help: 'Assign from the dispatch board for suggestions by territory, skill and workload.',
    }),
    ft('status', 'Status', 'master', { master: 'ticketStatus', readOnly: true, width: 170 }),
    ft('responseDueAt', 'Response due', 'datetime', { readOnly: true, capabilities: SYS }),
    ft('arrivalDueAt', 'On-site due', 'datetime', { readOnly: true, capabilities: SYS }),
    ft('resolutionDueAt', 'Resolution due', 'datetime', { readOnly: true, capabilities: SYS, width: 150 }),
    ft('respondedAt', 'Responded', 'datetime', { readOnly: true, capabilities: SYS }),
    ft('arrivedAt', 'Arrived on site', 'datetime', { readOnly: true, capabilities: SYS }),
    ft('resolvedAt', 'Resolved', 'datetime', { readOnly: true, capabilities: SYS }),
    ft('closedAt', 'Closed', 'datetime', { readOnly: true, capabilities: SYS }),
    ft('slaBreached', 'SLA breached', 'boolean', { readOnly: true, capabilities: SYS, width: 110 }),
    ft('resolution', 'Work done / resolution', 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
    ft('repeatOfId', 'Repeat of', 'relation', { relation: { resource: 'tickets' }, readOnly: true, capabilities: SYS }),
    ft('rootCause', 'Root cause', 'longtext', { maxLength: 1000, capabilities: FORM_ONLY, help: 'Mandatory before closing a repeat complaint (BR-33).' }),
    ft('rating', 'Customer rating', 'number', { readOnly: true, min: 1, max: 5, capabilities: SYS }),
    ft('feedbackComment', 'Customer feedback', 'longtext', { readOnly: true, capabilities: { export: true } }),
    ft('reopenCount', 'Re-opened', 'number', { readOnly: true, capabilities: SYS }),
    ft('remoteSteps', 'Remote troubleshooting steps', 'longtext', { readOnly: true, capabilities: { export: true } }),
    ft('remoteDurationMin', 'Remote call duration', 'number', { readOnly: true, unit: 'min', capabilities: { export: true } }),
    ft('remoteSessionRef', 'Remote session ref.', 'text', { readOnly: true, capabilities: { export: true } }),
    ft('chargeableStatus', 'Chargeable', 'master', { master: 'chargeableStatus', readOnly: true, defaultValue: 'none', capabilities: SYS }),
    ft('chargeableAmount', 'Chargeable amount', 'money', { readOnly: true, currency: 'INR', capabilities: SYS }),
    ft('chargeableNote', 'Chargeable details', 'longtext', { readOnly: true, capabilities: { export: true } }),
    ft('spottedLeadId', 'Lead from this visit', 'text', { readOnly: true, capabilities: { export: true } }),
    // System bookkeeping (not shown in forms)
    ft('pausedSince', 'Paused since', 'datetime', { system: true, readOnly: true, capabilities: HIDDEN }),
    ft('pausedMinutes', 'Paused (min)', 'number', { system: true, readOnly: true, capabilities: HIDDEN }),
    ft('escalationLevel', 'Escalation level', 'number', { system: true, readOnly: true, capabilities: HIDDEN }),
    ft('feedbackToken', 'Feedback token', 'text', { system: true, readOnly: true, capabilities: {} }),
    ft('lastActivityAt', 'Last activity', 'datetime', { system: true, readOnly: true, capabilities: HIDDEN }),
  ],
  relationships: [
    { id: 'rel_ticket_visits', label: 'Visits', resource: 'serviceVisits', foreignKey: 'ticketId' },
    { id: 'rel_ticket_repeats', label: 'Repeat complaints', resource: 'tickets', foreignKey: 'repeatOfId' },
  ],
  lifecycle: {
    field: 'status',
    initial: 'open',
    terminal: [],
    transitions: [
      { from: ['open', 'reopened'], to: 'assigned', action: 'Mark assigned', capability: 'ticket.assign' },
      { from: ['assigned'], to: 'accepted', action: 'Accept job' },
      { from: ['assigned'], to: 'open', action: 'Reject job', confirm: 'Reject this job? It goes back to the coordinator for re-assignment.' },
      { from: ['accepted', 'reopened'], to: 'in_progress', action: 'Start work' },
      { from: ['in_progress'], to: 'waiting_parts', action: 'Waiting for parts' },
      { from: ['in_progress'], to: 'waiting_customer', action: 'Waiting for customer' },
      { from: ['waiting_parts', 'waiting_customer'], to: 'in_progress', action: 'Resume work' },
      { from: ['in_progress'], to: 'resolved', action: 'Resolve' },
      { from: ['resolved'], to: 'customer_confirmation', action: 'Send for customer confirmation' },
      { from: ['customer_confirmation'], to: 'closed', action: 'Close (customer confirmed)' },
      { from: ['customer_confirmation'], to: 'in_progress', action: 'Customer says not resolved' },
      { from: ['closed'], to: 'reopened', action: 'Re-open', confirm: 'Re-open this ticket? SLA clocks restart and it counts against first-time fix.' },
    ],
  },
  form: {
    quickCreate: ['customerId', 'machineId', 'contactId', 'channel', 'description', 'category', 'subCategory', 'ticketType', 'priority', 'divisionId'],
    sections: [
      { id: 'who', title: 'Customer & machine', fields: ['customerId', 'machineId', 'contactId', 'channel', 'divisionId'], columns: 2 },
      { id: 'what', title: 'Complaint', fields: ['description', 'category', 'subCategory', 'ticketType', 'priority', 'assigneeId'], columns: 2 },
      { id: 'close', title: 'Resolution', fields: ['resolution', 'rootCause'], columns: 1 },
    ],
    primaryLabel: 'Log ticket',
  },
  views: views([
    {
      id: 'v_tkt_open',
      resource: 'tickets',
      name: 'Open',
      type: 'table',
      filter: group('and', [cond('status', 'in', ['open', 'assigned', 'accepted', 'in_progress', 'waiting_parts', 'waiting_customer', 'reopened'])]),
      sort: [{ field: 'resolutionDueAt', dir: 'asc' }],
      columns: cols('id', 'customerId', 'description', 'priority', 'status', 'assigneeId', 'coverage', 'resolutionDueAt', 'slaBreached'),
    },
    {
      id: 'v_tkt_unassigned',
      resource: 'tickets',
      name: 'Unassigned',
      type: 'table',
      filter: group('and', [cond('status', 'in', ['open', 'reopened'])]),
      sort: [{ field: 'reportedAt', dir: 'asc' }],
      columns: cols('id', 'customerId', 'description', 'priority', 'divisionId', 'reportedAt', 'responseDueAt', 'channel'),
    },
    {
      id: 'v_tkt_breached',
      resource: 'tickets',
      name: 'SLA breached',
      type: 'table',
      filter: group('and', [cond('slaBreached', 'eq', true), cond('status', 'in', ['open', 'assigned', 'accepted', 'in_progress', 'waiting_parts', 'waiting_customer', 'reopened'])]),
      sort: [{ field: 'resolutionDueAt', dir: 'asc' }],
      columns: cols('id', 'customerId', 'priority', 'status', 'assigneeId', 'resolutionDueAt', 'coverage'),
    },
    {
      id: 'v_tkt_repeat',
      resource: 'tickets',
      name: 'Repeat complaints',
      type: 'table',
      filter: group('and', [cond('repeatOfId', 'notEmpty')]),
      sort: [{ field: 'reportedAt', dir: 'desc' }],
      columns: cols('id', 'customerId', 'machineId', 'category', 'repeatOfId', 'status', 'assigneeId'),
    },
    {
      id: 'v_tkt_board',
      resource: 'tickets',
      name: 'Board',
      type: 'board',
      boardField: 'status',
      filter: group('and', [cond('status', 'neq', 'closed')]),
      sort: [{ field: 'resolutionDueAt', dir: 'asc' }],
      columns: cols('customerId', 'priority', 'assigneeId', 'resolutionDueAt'),
    },
    {
      id: 'v_tkt_all',
      resource: 'tickets',
      name: 'All',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'reportedAt', dir: 'desc' }],
      columns: cols('id', 'reportedAt', 'customerId', 'machineId', 'ticketType', 'category', 'priority', 'status', 'assigneeId', 'rating'),
    },
  ]),
};

// ---------------------------------------------------------------- service visits (job cards)

export const serviceVisits: ResourceDefinition = {
  id: 'res_serviceVisits',
  key: 'serviceVisits',
  module: 'service',
  label: 'Service visit',
  labelPlural: 'Service visits',
  icon: 'id-card',
  version: 1,
  idPrefix: 'SV',
  titleField: 'ticketId',
  subtitleFields: ['engineerId', 'status'],
  ownerField: 'engineerId',
  description: 'Engineer job cards: travel, geo-tagged check-in, diagnosis, work done, parts, photos, check-out and customer sign-off.',
  status: 'published',
  fields: [
    fv('ticketId', 'Ticket', 'relation', { relation: { resource: 'tickets' }, required: true, capabilities: ALL, width: 160 }),
    fv('engineerId', 'Engineer', 'relation', { relation: { resource: 'employees' }, required: true, width: 170, display: 'person' }),
    fv('visitType', 'Visit type', 'master', { master: 'visitType', required: true, defaultValue: 'site' }),
    fv('status', 'Status', 'master', { master: 'visitStatus', readOnly: true, defaultValue: 'travelling' }),
    fv('travelStartAt', 'Travel started', 'datetime', { readOnly: true }),
    fv('checkInAt', 'Checked in', 'datetime', { readOnly: true, width: 150 }),
    fv('checkInLat', 'Check-in latitude', 'number', { readOnly: true, capabilities: { export: true } }),
    fv('checkInLng', 'Check-in longitude', 'number', { readOnly: true, capabilities: { export: true } }),
    fv('checkInMock', 'Location simulated', 'boolean', { readOnly: true, capabilities: { export: true } }),
    fv('diagnosis', 'Diagnosis', 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
    fv('workDone', 'Work performed', 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
    fv('partsUsed', 'Parts used', 'text', { maxLength: 300, capabilities: NO_SEARCH }),
    fv('photosBefore', 'Photos before', 'text', { readOnly: true, capabilities: { export: true } }),
    fv('photosAfter', 'Photos after', 'text', { readOnly: true, capabilities: { export: true } }),
    fv('printCounter', 'Print counter', 'number', { min: 0, unit: 'm²' }),
    fv('inkUsedMl', 'Ink consumption', 'number', { min: 0, unit: 'ml' }),
    fv('checkOutAt', 'Checked out', 'datetime', { readOnly: true }),
    fv('signOffMethod', 'Sign-off', 'master', { master: 'signOffMethod', readOnly: true }),
    fv('signedOffAt', 'Signed off', 'datetime', { readOnly: true }),
  ],
  relationships: [],
  form: {
    quickCreate: ['ticketId', 'engineerId', 'visitType', 'diagnosis', 'workDone'],
    sections: [
      { id: 'main', title: 'Visit', fields: ['ticketId', 'engineerId', 'visitType'], columns: 2 },
      { id: 'work', title: 'Work', fields: ['diagnosis', 'workDone', 'partsUsed', 'printCounter', 'inkUsedMl'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_sv_recent',
      resource: 'serviceVisits',
      name: 'Recent',
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
  label: 'PM visit',
  labelPlural: 'PM visits',
  icon: 'calendar-clock',
  version: 1,
  idPrefix: 'PMV',
  titleField: 'machineId',
  subtitleFields: ['dueDate', 'status'],
  ownerField: 'engineerId',
  divisionField: 'divisionId',
  description: 'Preventive maintenance schedule generated from warranty and AMC/CMC contracts.',
  status: 'published',
  fields: [
    fp('machineId', 'Machine', 'relation', { relation: { resource: 'machines' }, required: true, capabilities: ALL, width: 170 }),
    fp('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, required: true, capabilities: ALL, width: 210 }),
    fp('amcContractId', 'Contract', 'relation', { relation: { resource: 'amcContracts' }, width: 150 }),
    fp('dueDate', 'Due', 'date', { required: true, width: 120 }),
    fp('status', 'Status', 'master', { master: 'pmStatus', readOnly: true, defaultValue: 'due', width: 110 }),
    fp('engineerId', 'Engineer', 'relation', { relation: { resource: 'employees', where: { field: 'roleId', op: 'in', value: ['engineer', 'service_head'] } }, width: 170, display: 'person' }),
    fp('divisionId', 'Division', 'master', { master: 'division', width: 130 }),
    fp('ticketId', 'Ticket', 'relation', { relation: { resource: 'tickets' }, readOnly: true }),
    fp('completedAt', 'Completed', 'date', { readOnly: true }),
    fp('checklist', 'Checklist result', 'longtext', { readOnly: true, capabilities: { export: true } }),
  ],
  relationships: [],
  form: {
    quickCreate: ['machineId', 'customerId', 'dueDate', 'engineerId', 'divisionId'],
    sections: [{ id: 'main', title: 'PM visit', fields: ['machineId', 'customerId', 'amcContractId', 'dueDate', 'engineerId', 'divisionId'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_pm_due',
      resource: 'pmVisits',
      name: 'Due & overdue',
      type: 'table',
      filter: group('and', [cond('status', 'in', ['due', 'overdue'])]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: cols('dueDate', 'machineId', 'customerId', 'status', 'engineerId', 'amcContractId'),
    },
    {
      id: 'v_pm_all',
      resource: 'pmVisits',
      name: 'All',
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
  label: 'Knowledge article',
  labelPlural: 'Knowledge base',
  icon: 'scroll-text',
  version: 1,
  idPrefix: 'KB',
  titleField: 'title',
  subtitleFields: ['category', 'status'],
  ownerField: 'authorId',
  description: 'Known issues and solutions, searchable by model and error code. Engineers contribute; the service head approves.',
  status: 'published',
  fields: [
    fk('title', 'Title', 'text', { required: true, maxLength: 140, capabilities: ALL, width: 320, subFields: ['models'] }),
    fk('models', 'Machine models', 'text', { required: true, maxLength: 200, capabilities: ALL, width: 200, help: 'Comma-separated, e.g. "TX-1800, TX-3200".' }),
    fk('errorCodes', 'Error codes', 'text', { maxLength: 120, capabilities: ALL, width: 140 }),
    fk('category', 'Category', 'master', { master: 'complaintCategory', required: true, width: 150 }),
    fk('symptoms', 'Symptoms', 'longtext', { required: true, maxLength: 2000, capabilities: { ...FORM_ONLY, search: true } }),
    fk('solution', 'Solution', 'longtext', { required: true, maxLength: 4000, capabilities: { ...FORM_ONLY, search: true } }),
    fk('authorId', 'Author', 'relation', { relation: { resource: 'employees' }, required: true, width: 170, display: 'person' }),
    fk('status', 'Status', 'master', { master: 'kbStatus', readOnly: true, width: 140 }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'draft',
    terminal: [],
    transitions: [
      { from: ['draft'], to: 'pending', action: 'Submit for approval' },
      { from: ['draft', 'pending'], to: 'published', action: 'Publish', capability: 'approve.service' },
      { from: ['published'], to: 'draft', action: 'Unpublish', capability: 'approve.service', confirm: 'Unpublish this article? Engineers will no longer find it.' },
    ],
  },
  form: {
    quickCreate: ['title', 'models', 'errorCodes', 'category', 'symptoms', 'solution'],
    sections: [{ id: 'main', title: 'Article', fields: ['title', 'models', 'errorCodes', 'category', 'symptoms', 'solution'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_kb_published',
      resource: 'knowledgeArticles',
      name: 'Published',
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'published')]),
      sort: [{ field: 'title', dir: 'asc' }],
      columns: cols('title', 'models', 'errorCodes', 'category', 'authorId'),
    },
    {
      id: 'v_kb_review',
      resource: 'knowledgeArticles',
      name: 'Drafts & pending',
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
  nav: {
    id: 'service',
    label: 'Service',
    icon: 'wrench',
    resources: ['tickets', 'pmVisits', 'serviceVisits', 'knowledgeArticles'],
    pages: [
      { id: 'dispatch-board', label: 'Dispatch board', icon: 'layout-dashboard', path: 'dispatch-board', capability: 'ticket.assign' },
      { id: 'my-jobs', label: 'My jobs', icon: 'check-square', path: 'my-jobs', capability: 'service.field' },
      { id: 'pm-schedule', label: 'PM schedule', icon: 'calendar-clock', path: 'pm-schedule' },
    ],
  },
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
