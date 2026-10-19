/**
 * Field & performance module (BRD 4.11 Field force, 4.12 Targets): attendance, regularisation,
 * field visits, beat plans, expense claims, leave, and targets. Custom pages live in src/modules/field.
 */
import type { MasterDefinition, MasterValue, ResourceDefinition, Tone } from '../../metadata/types';
import { ALL, cols, cond, field, FORM_ONLY, group, NO_SEARCH, views } from '../helpers';
import { type ModulePack, p } from './types';

const mv = (key: string, label: string, tone: Tone = 'neutral'): Omit<MasterValue, 'order'> => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[]): MasterDefinition => ({ id: `mst_${key}`, key, label, version: 1, values: values.map((x, i) => ({ ...x, order: i })) });

const masters: MasterDefinition[] = [
  master('attendanceStatus', 'Attendance status', [mv('present', 'Present', 'success'), mv('half_day', 'Half-day', 'warning'), mv('on_tour', 'On tour', 'info'), mv('leave', 'Leave', 'accent'), mv('absent', 'Absent', 'danger')]),
  master('regularisationStatus', 'Regularisation status', [mv('pending', 'Pending approval', 'warning'), mv('approved', 'Approved', 'success'), mv('rejected', 'Rejected', 'danger')]),
  master('visitPurpose', 'Visit purpose', [mv('prospecting', 'Prospecting', 'info'), mv('follow_up', 'Follow-up'), mv('demo', 'Demo', 'accent'), mv('service', 'Service', 'warning'), mv('collection', 'Collection', 'success')]),
  master('fieldVisitStatus', 'Field visit status', [mv('planned', 'Planned', 'info'), mv('in_progress', 'At site', 'warning'), mv('completed', 'Completed', 'success'), mv('cancelled', 'Cancelled')]),
  master('beatStatus', 'Beat plan status', [mv('planned', 'Planned', 'info'), mv('visited', 'Visited', 'success'), mv('missed', 'Missed', 'danger')]),
  master('expenseType', 'Expense type', [mv('conveyance', 'Conveyance (km)'), mv('travel', 'Travel (bus / train / air)'), mv('food', 'Food'), mv('lodging', 'Lodging'), mv('other', 'Other')]),
  master('vehicleType', 'Vehicle', [mv('two_wheeler', 'Two-wheeler'), mv('car', 'Car')]),
  master('expenseStatus', 'Expense status', [mv('draft', 'Draft'), mv('submitted', 'Submitted', 'warning'), mv('approved', 'Approved', 'success'), mv('rejected', 'Rejected', 'danger'), mv('exported', 'Exported to payroll', 'accent')]),
  master('leaveType', 'Leave type', [mv('casual', 'Casual'), mv('sick', 'Sick'), mv('earned', 'Earned'), mv('comp_off', 'Compensatory off')]),
  master('leaveStatus', 'Leave status', [mv('pending', 'Pending approval', 'warning'), mv('approved', 'Approved', 'success'), mv('rejected', 'Rejected', 'danger'), mv('cancelled', 'Cancelled')]),
  master('targetScope', 'Target for', [mv('user', 'Person'), mv('team', 'Team'), mv('division', 'Division')]),
  master('periodType', 'Period', [mv('month', 'Month'), mv('quarter', 'Quarter'), mv('year', 'Financial year')]),
  master('targetMetric', 'Metric', [mv('order_value', 'Order value (₹)', 'accent'), mv('quantity', 'Quantity (units)'), mv('collections', 'Collections (₹)', 'success'), mv('new_customers', 'New customers', 'info'), mv('activities', 'Activities logged')]),
];

const f = (res: string) => (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field(res, key, label, type, extra);
const employee = { relation: { resource: 'employees' }, display: 'person' as const, personSubtitle: 'designation' };
const SYS = { readOnly: true, capabilities: { list: true, sort: true, filter: true, export: true } };

const fa = f('attendance');
export const attendance: ResourceDefinition = {
  id: 'res_attendance',
  key: 'attendance',
  module: 'field',
  label: 'Attendance',
  labelPlural: 'Attendance',
  icon: 'calendar-clock',
  version: 1,
  idPrefix: 'ATT',
  titleField: 'date',
  subtitleFields: ['employeeId', 'status'],
  ownerField: 'employeeId',
  description: 'Daily check-in / check-out with time and location. Created from the "My day" screen; corrections go through regularisation.',
  status: 'published',
  fields: [
    fa('employeeId', 'Employee', 'relation', { ...employee, required: true, readOnly: true, width: 180, capabilities: ALL }),
    fa('date', 'Date', 'date', { required: true, readOnly: true, width: 120 }),
    fa('status', 'Status', 'master', { master: 'attendanceStatus', required: true, readOnly: true, width: 120 }),
    fa('checkInAt', 'Check-in', 'datetime', { ...SYS, width: 150 }),
    fa('checkOutAt', 'Check-out', 'datetime', { ...SYS, width: 150 }),
    fa('workMinutes', 'Worked', 'number', { ...SYS, unit: 'min', width: 100 }),
    fa('lateByMin', 'Late by', 'number', { ...SYS, unit: 'min', width: 100 }),
    fa('earlyByMin', 'Early exit by', 'number', { ...SYS, unit: 'min', width: 110 }),
    fa('checkInPlace', 'Check-in place', 'text', { ...SYS, width: 200 }),
    fa('insideGeofence', 'Inside office geofence', 'boolean', SYS),
    fa('mockLocation', 'Mock location detected', 'boolean', SYS),
    fa('selfie', 'Selfie attached', 'boolean', SYS),
    fa('locationSource', 'Location source', 'text', SYS),
    fa('distanceKm', 'Distance travelled', 'number', { ...SYS, unit: 'km' }),
    fa('checkInLat', 'Check-in latitude', 'number', { readOnly: true, capabilities: { export: true } }),
    fa('checkInLng', 'Check-in longitude', 'number', { readOnly: true, capabilities: { export: true } }),
    fa('checkOutLat', 'Check-out latitude', 'number', { readOnly: true, capabilities: { export: true } }),
    fa('checkOutLng', 'Check-out longitude', 'number', { readOnly: true, capabilities: { export: true } }),
    fa('regularised', 'Regularised', 'boolean', SYS),
  ],
  relationships: [],
  form: { quickCreate: [], sections: [{ id: 'main', title: 'Attendance', fields: ['employeeId', 'date', 'status'], columns: 2 }] },
  views: views([
    { id: 'v_att_recent', resource: 'attendance', name: 'Recent', type: 'table', filter: group('and'), sort: [{ field: 'date', dir: 'desc' }], columns: cols('date', 'employeeId', 'status', 'checkInAt', 'checkOutAt', 'workMinutes', 'lateByMin', 'earlyByMin', 'checkInPlace') },
    { id: 'v_att_late', resource: 'attendance', name: 'Late arrivals', type: 'table', filter: group('and', [cond('lateByMin', 'gt', 0)]), sort: [{ field: 'date', dir: 'desc' }], columns: cols('date', 'employeeId', 'checkInAt', 'lateByMin', 'status') },
    { id: 'v_att_by_person', resource: 'attendance', name: 'By person', type: 'table', filter: group('and'), sort: [{ field: 'date', dir: 'desc' }], groupBy: 'employeeId', columns: cols('date', 'status', 'checkInAt', 'checkOutAt', 'workMinutes', 'lateByMin') },
  ]),
};

const fr = f('regularisations');
export const regularisations: ResourceDefinition = {
  id: 'res_regularisations',
  key: 'regularisations',
  module: 'field',
  label: 'Regularisation',
  labelPlural: 'Regularisations',
  icon: 'calendar-clock',
  version: 1,
  idPrefix: 'REG',
  titleField: 'reason',
  subtitleFields: ['date', 'status'],
  ownerField: 'employeeId',
  description: 'Requests to correct a day’s attendance (missed check-in, wrong time). The reporting manager approves in the Work inbox.',
  status: 'published',
  fields: [
    fr('employeeId', 'Employee', 'relation', { ...employee, required: true, readOnly: true, width: 180 }),
    fr('date', 'Date', 'date', { required: true, dateRule: 'past', width: 120 }),
    fr('requestedCheckIn', 'Correct check-in', 'datetime', { required: true, width: 150 }),
    fr('requestedCheckOut', 'Correct check-out', 'datetime', { required: true, width: 150, compare: { op: 'gte', field: 'requestedCheckIn', message: 'Check-out must be after check-in' } }),
    fr('reason', 'Reason', 'text', { required: true, maxLength: 200, capabilities: ALL, width: 260 }),
    fr('status', 'Status', 'master', { master: 'regularisationStatus', readOnly: true, defaultValue: 'pending', width: 140 }),
    fr('decisionNote', 'Decision note', 'text', { readOnly: true }),
  ],
  relationships: [],
  form: { quickCreate: ['date', 'requestedCheckIn', 'requestedCheckOut', 'reason'], sections: [{ id: 'main', title: 'Request', fields: ['date', 'requestedCheckIn', 'requestedCheckOut', 'reason'], columns: 2 }] },
  views: views([
    { id: 'v_reg_pending', resource: 'regularisations', name: 'Pending', type: 'table', filter: group('and', [cond('status', 'eq', 'pending')]), sort: [{ field: 'date', dir: 'desc' }], columns: cols('date', 'employeeId', 'requestedCheckIn', 'requestedCheckOut', 'reason', 'status') },
    { id: 'v_reg_all', resource: 'regularisations', name: 'All', type: 'table', filter: group('and'), sort: [{ field: 'date', dir: 'desc' }], columns: cols('date', 'employeeId', 'reason', 'status', 'decisionNote') },
  ]),
};

const fv = f('fieldVisits');
export const fieldVisits: ResourceDefinition = {
  id: 'res_fieldVisits',
  key: 'fieldVisits',
  module: 'field',
  label: 'Field visit',
  labelPlural: 'Field visits',
  icon: 'door-open',
  version: 1,
  idPrefix: 'FV',
  idFormat: 'fy',
  titleField: 'siteLabel',
  subtitleFields: ['purpose', 'status'],
  ownerField: 'employeeId',
  description: 'Customer and site visits with geo-tagged check-in / check-out, remarks and next action, linked to the account, lead, opportunity or ticket.',
  status: 'published',
  fields: [
    fv('siteLabel', 'Customer / site', 'text', { required: true, maxLength: 140, capabilities: ALL, width: 240, subFields: ['parentLabel'] }),
    fv('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, width: 200, capabilities: ALL }),
    fv('employeeId', 'Visited by', 'relation', { ...employee, required: true, width: 170 }),
    fv('purpose', 'Purpose', 'master', { master: 'visitPurpose', required: true, defaultValue: 'follow_up', width: 120 }),
    fv('plannedFor', 'Planned for', 'date', { required: true, width: 120 }),
    fv('status', 'Status', 'master', { master: 'fieldVisitStatus', readOnly: true, width: 120 }),
    fv('checkInAt', 'Checked in', 'datetime', { ...SYS, width: 150 }),
    fv('checkOutAt', 'Checked out', 'datetime', { ...SYS, width: 150 }),
    fv('remarks', 'Remarks', 'longtext', { maxLength: 2000, capabilities: { ...FORM_ONLY, search: true } }),
    fv('nextAction', 'Next action', 'text', { maxLength: 200, capabilities: NO_SEARCH, width: 200 }),
    fv('nextActionDate', 'Next action date', 'date', { dateRule: 'future' }),
    fv('parentLabel', 'Linked to', 'text', { readOnly: true, capabilities: { list: true, search: true, sort: true }, width: 220 }),
    fv('parentResource', 'Linked record type', 'text', { system: true, readOnly: true, capabilities: { filter: true } }),
    fv('parentId', 'Linked record', 'text', { system: true, readOnly: true, capabilities: { filter: true, search: true } }),
    fv('checkInLat', 'Check-in latitude', 'number', { readOnly: true, capabilities: { export: true } }),
    fv('checkInLng', 'Check-in longitude', 'number', { readOnly: true, capabilities: { export: true } }),
    fv('locationSource', 'Location source', 'text', SYS),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'planned',
    terminal: ['cancelled'],
    transitions: [{ from: ['planned'], to: 'cancelled', action: 'Cancel visit', confirm: 'Cancel this planned visit?' }],
  },
  form: {
    quickCreate: ['siteLabel', 'customerId', 'purpose', 'plannedFor', 'nextAction'],
    sections: [{ id: 'main', title: 'Visit', fields: ['siteLabel', 'customerId', 'employeeId', 'purpose', 'plannedFor', 'remarks', 'nextAction', 'nextActionDate'], columns: 2 }],
  },
  views: views([
    { id: 'v_fv_recent', resource: 'fieldVisits', name: 'Recent', type: 'table', filter: group('and'), sort: [{ field: 'plannedFor', dir: 'desc' }], columns: cols('plannedFor', 'siteLabel', 'employeeId', 'purpose', 'status', 'checkInAt', 'checkOutAt', 'nextAction') },
    { id: 'v_fv_planned', resource: 'fieldVisits', name: 'Planned', type: 'table', filter: group('and', [cond('status', 'eq', 'planned')]), sort: [{ field: 'plannedFor', dir: 'asc' }], columns: cols('plannedFor', 'siteLabel', 'employeeId', 'purpose', 'parentLabel') },
    { id: 'v_fv_by_person', resource: 'fieldVisits', name: 'By person', type: 'table', filter: group('and'), sort: [{ field: 'plannedFor', dir: 'desc' }], groupBy: 'employeeId', columns: cols('plannedFor', 'siteLabel', 'purpose', 'status', 'nextAction') },
  ]),
};

const fb = f('beatPlans');
export const beatPlans: ResourceDefinition = {
  id: 'res_beatPlans',
  key: 'beatPlans',
  module: 'field',
  label: 'Beat plan entry',
  labelPlural: 'Beat plan',
  icon: 'calendar',
  version: 1,
  idPrefix: 'BP',
  titleField: 'siteLabel',
  subtitleFields: ['date', 'status'],
  ownerField: 'employeeId',
  description: 'Weekly visit plan: who plans to visit which customer on which day. Compared with actual visits on the beat plan page.',
  status: 'published',
  fields: [
    fb('siteLabel', 'Customer / site', 'text', { required: true, maxLength: 140, capabilities: ALL, width: 240 }),
    fb('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, width: 200 }),
    fb('employeeId', 'Planned by', 'relation', { ...employee, required: true, width: 170 }),
    fb('date', 'Date', 'date', { required: true, width: 120 }),
    fb('weekStart', 'Week of', 'date', { readOnly: true, capabilities: { list: true, sort: true, filter: true } }),
    fb('purpose', 'Purpose', 'master', { master: 'visitPurpose', required: true, defaultValue: 'follow_up', width: 120 }),
    fb('status', 'Status', 'master', { master: 'beatStatus', readOnly: true, defaultValue: 'planned', width: 110 }),
  ],
  relationships: [],
  form: { quickCreate: ['siteLabel', 'customerId', 'date', 'purpose'], sections: [{ id: 'main', title: 'Plan entry', fields: ['siteLabel', 'customerId', 'employeeId', 'date', 'purpose'], columns: 2 }] },
  views: views([
    { id: 'v_bp_week', resource: 'beatPlans', name: 'This week', type: 'table', filter: group('and', [cond('date', 'next7')]), sort: [{ field: 'date', dir: 'asc' }], columns: cols('date', 'siteLabel', 'employeeId', 'purpose', 'status') },
    { id: 'v_bp_all', resource: 'beatPlans', name: 'All', type: 'table', filter: group('and'), sort: [{ field: 'date', dir: 'desc' }], groupBy: 'employeeId', columns: cols('date', 'siteLabel', 'purpose', 'status') },
  ]),
};

const fx = f('expenseClaims');
export const expenseClaims: ResourceDefinition = {
  id: 'res_expenseClaims',
  key: 'expenseClaims',
  module: 'field',
  label: 'Expense claim',
  labelPlural: 'Expense claims',
  icon: 'receipt',
  version: 1,
  idPrefix: 'EXP',
  idFormat: 'fy',
  titleField: 'description',
  subtitleFields: ['amount', 'status'],
  ownerField: 'employeeId',
  description: 'Travel and expense claims. Conveyance is calculated from km × the policy rate; claims above the policy limit need a justification. Reporting manager then Accounts approve.',
  status: 'published',
  fields: [
    fx('description', 'Description', 'text', { required: true, maxLength: 140, capabilities: ALL, width: 260, subFields: ['claimDate'] }),
    fx('employeeId', 'Claimed by', 'relation', { ...employee, required: true, readOnly: true, width: 170 }),
    fx('claimDate', 'Expense date', 'date', { required: true, dateRule: 'past', width: 120 }),
    fx('expenseType', 'Type', 'master', { master: 'expenseType', required: true, defaultValue: 'conveyance', width: 150 }),
    fx('vehicleType', 'Vehicle', 'master', { master: 'vehicleType', defaultValue: 'two_wheeler', requiredWhen: { field: 'expenseType', op: 'eq', value: 'conveyance' }, visibleWhen: { field: 'expenseType', op: 'eq', value: 'conveyance' }, clearWhenHidden: true }),
    fx('km', 'Distance', 'number', { unit: 'km', min: 0, max: 2000, requiredWhen: { field: 'expenseType', op: 'eq', value: 'conveyance' }, visibleWhen: { field: 'expenseType', op: 'eq', value: 'conveyance' }, clearWhenHidden: true, help: 'From your tracked route for the day; use “Fill km from tracked route” on the claim.' }),
    fx('amount', 'Amount', 'money', { required: true, min: 0, currency: 'INR', width: 130, help: 'For conveyance the amount is calculated from distance × the policy rate per km.' }),
    fx('billFileName', 'Bill / receipt', 'text', { maxLength: 120, requiredWhen: { field: 'expenseType', op: 'neq', value: 'conveyance' }, help: 'File name of the uploaded bill (simulated upload, 10 MB limit).' }),
    fx('justification', 'Justification', 'longtext', { maxLength: 500, help: 'Required when the amount is above the policy limit.', capabilities: FORM_ONLY }),
    fx('policyLimit', 'Policy limit', 'money', { readOnly: true, currency: 'INR', capabilities: { list: true, export: true } }),
    fx('status', 'Status', 'master', { master: 'expenseStatus', readOnly: true, width: 150 }),
    fx('exportedAt', 'Exported to payroll on', 'datetime', { readOnly: true, capabilities: { list: true, sort: true, export: true } }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'draft',
    terminal: ['exported'],
    transitions: [
      { from: ['draft'], to: 'submitted', action: 'Submit for approval' },
      { from: ['rejected'], to: 'draft', action: 'Revise' },
      { from: ['approved'], to: 'exported', action: 'Mark exported to payroll', capability: 'expense.export' },
    ],
  },
  form: {
    quickCreate: ['description', 'claimDate', 'expenseType', 'vehicleType', 'km', 'amount', 'billFileName'],
    sections: [{ id: 'main', title: 'Claim', fields: ['description', 'claimDate', 'expenseType', 'vehicleType', 'km', 'amount', 'billFileName', 'justification'], columns: 2 }],
  },
  views: views([
    { id: 'v_exp_mine', resource: 'expenseClaims', name: 'Open', type: 'table', filter: group('and', [cond('status', 'in', ['draft', 'submitted', 'rejected'])]), sort: [{ field: 'claimDate', dir: 'desc' }], columns: cols('claimDate', 'description', 'employeeId', 'expenseType', 'km', 'amount', 'status') },
    { id: 'v_exp_approved', resource: 'expenseClaims', name: 'Approved (to export)', type: 'table', filter: group('and', [cond('status', 'eq', 'approved')]), sort: [{ field: 'claimDate', dir: 'asc' }], columns: cols('claimDate', 'description', 'employeeId', 'expenseType', 'amount', 'status') },
    { id: 'v_exp_all', resource: 'expenseClaims', name: 'All', type: 'table', filter: group('and'), sort: [{ field: 'claimDate', dir: 'desc' }], columns: cols('claimDate', 'description', 'employeeId', 'expenseType', 'km', 'amount', 'policyLimit', 'status', 'exportedAt') },
    { id: 'v_exp_board', resource: 'expenseClaims', name: 'Board', type: 'board', boardField: 'status', filter: group('and'), sort: [{ field: 'claimDate', dir: 'desc' }], columns: cols('description', 'employeeId', 'amount', 'claimDate') },
  ]),
};

const fl = f('leaves');
export const leaves: ResourceDefinition = {
  id: 'res_leaves',
  key: 'leaves',
  module: 'field',
  label: 'Leave',
  labelPlural: 'Leave',
  icon: 'calendar',
  version: 1,
  idPrefix: 'LV',
  titleField: 'reason',
  subtitleFields: ['fromDate', 'status'],
  ownerField: 'employeeId',
  description: 'Leave applications and approvals. Approved leave marks attendance as "Leave" for those days. (HRMS integration is not applicable to the prototype.)',
  status: 'published',
  fields: [
    fl('employeeId', 'Employee', 'relation', { ...employee, required: true, readOnly: true, width: 170 }),
    fl('leaveType', 'Type', 'master', { master: 'leaveType', required: true, defaultValue: 'casual', width: 130 }),
    fl('fromDate', 'From', 'date', { required: true, width: 120 }),
    fl('toDate', 'To', 'date', { required: true, width: 120, compare: { op: 'gte', field: 'fromDate', message: 'End date must be on or after the start date' } }),
    fl('days', 'Days', 'number', { readOnly: true, computed: (r) => (r.fromDate && r.toDate ? Math.max(0, Math.round((Date.parse(String(r.toDate)) - Date.parse(String(r.fromDate))) / 86_400_000) + 1) : null), capabilities: { list: true, export: true }, width: 80 }),
    fl('reason', 'Reason', 'text', { required: true, maxLength: 200, capabilities: ALL, width: 240 }),
    fl('status', 'Status', 'master', { master: 'leaveStatus', readOnly: true, width: 140 }),
    fl('decisionNote', 'Decision note', 'text', { readOnly: true }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'pending',
    terminal: ['cancelled', 'rejected'],
    transitions: [{ from: ['pending', 'approved'], to: 'cancelled', action: 'Cancel leave', confirm: 'Cancel this leave? A pending approval is withdrawn.' }],
  },
  form: { quickCreate: ['leaveType', 'fromDate', 'toDate', 'reason'], sections: [{ id: 'main', title: 'Leave', fields: ['leaveType', 'fromDate', 'toDate', 'reason'], columns: 2 }] },
  views: views([
    { id: 'v_lv_upcoming', resource: 'leaves', name: 'Upcoming', type: 'table', filter: group('and', [cond('toDate', 'future')]), sort: [{ field: 'fromDate', dir: 'asc' }], columns: cols('fromDate', 'toDate', 'days', 'employeeId', 'leaveType', 'reason', 'status') },
    { id: 'v_lv_all', resource: 'leaves', name: 'All', type: 'table', filter: group('and'), sort: [{ field: 'fromDate', dir: 'desc' }], columns: cols('fromDate', 'toDate', 'days', 'employeeId', 'leaveType', 'status', 'decisionNote') },
  ]),
};

const ft = f('targets');
export const targets: ResourceDefinition = {
  id: 'res_targets',
  key: 'targets',
  module: 'field',
  label: 'Target',
  labelPlural: 'Targets',
  icon: 'activity',
  version: 1,
  idPrefix: 'TGT',
  titleField: 'name',
  subtitleFields: ['metric', 'periodStart'],
  ownerField: 'employeeId',
  divisionField: 'divisionId',
  description: 'Targets by person, team or division and period. Achievement is calculated automatically from sales orders, payments and activities.',
  status: 'published',
  fields: [
    ft('name', 'Target', 'text', { readOnly: true, capabilities: { list: true, search: true, sort: true, export: true }, width: 260 }),
    ft('scopeType', 'Target for', 'master', { master: 'targetScope', required: true, defaultValue: 'user', width: 110 }),
    ft('employeeId', 'Person / team lead', 'relation', { ...employee, requiredWhen: { field: 'scopeType', op: 'in', value: ['user', 'team'] }, visibleWhen: { field: 'scopeType', op: 'in', value: ['user', 'team'] }, clearWhenHidden: true, width: 170, help: 'For a team target, the manager whose reporting team is measured.' }),
    ft('divisionId', 'Division', 'master', { master: 'division', required: true, width: 150, help: 'For person and team targets this is the division the target counts towards.' }),
    ft('periodType', 'Period', 'master', { master: 'periodType', required: true, defaultValue: 'month', width: 110 }),
    ft('periodStart', 'Period start', 'date', { required: true, width: 120, help: 'First day of the month, quarter (Apr / Jul / Oct / Jan) or financial year (1 April).' }),
    ft('productCategory', 'Product category', 'master', { master: 'productType', width: 140, help: 'Leave empty for all products.' }),
    ft('metric', 'Metric', 'master', { master: 'targetMetric', required: true, defaultValue: 'order_value', width: 150 }),
    ft('targetValue', 'Target value', 'number', { required: true, min: 1, width: 130 }),
  ],
  relationships: [],
  form: {
    quickCreate: ['scopeType', 'employeeId', 'divisionId', 'periodType', 'periodStart', 'metric', 'targetValue', 'productCategory'],
    sections: [{ id: 'main', title: 'Target', fields: ['scopeType', 'employeeId', 'divisionId', 'periodType', 'periodStart', 'metric', 'productCategory', 'targetValue'], columns: 2 }],
  },
  views: views([
    { id: 'v_tgt_all', resource: 'targets', name: 'All targets', type: 'table', filter: group('and'), sort: [{ field: 'periodStart', dir: 'desc' }], columns: cols('name', 'scopeType', 'employeeId', 'divisionId', 'periodType', 'periodStart', 'metric', 'productCategory', 'targetValue') },
    { id: 'v_tgt_by_metric', resource: 'targets', name: 'By metric', type: 'table', filter: group('and'), sort: [{ field: 'periodStart', dir: 'desc' }], groupBy: 'metric', columns: cols('name', 'scopeType', 'periodType', 'periodStart', 'targetValue') },
  ]),
};

const FIELD = ['attendance', 'regularisations', 'fieldVisits', 'beatPlans', 'expenseClaims', 'leaves'];
/** Same scope on every field-force resource: read by role scope, write own. */
const fieldPerms = (read: Parameters<typeof p>[0], exp = false, del = false) => Object.fromEntries(FIELD.map((k) => [k, p(read, 'own', true, del || k === 'beatPlans', exp)]));

export const fieldPack: ModulePack = {
  id: 'field',
  nav: {
    id: 'field',
    label: 'Field & performance',
    icon: 'map-pin',
    resources: ['fieldVisits', 'expenseClaims', 'leaves', 'regularisations', 'beatPlans', 'targets'],
    pages: [
      { id: 'attendance-me', label: 'My day (check-in)', icon: 'calendar-clock', path: 'attendance' },
      { id: 'visits-me', label: 'My visits', icon: 'door-open', path: 'visits' },
      { id: 'beat-plan', label: 'Beat plan vs actual', icon: 'calendar', path: 'visits/plan' },
      { id: 'att-team', label: 'Team attendance', icon: 'users', path: 'attendance/team' },
      { id: 'att-exceptions', label: 'Exceptions', icon: 'alert', path: 'attendance/exceptions' },
      { id: 'payroll', label: 'Payroll export', icon: 'download', path: 'expenseClaims/payroll-export', capability: 'expense.export' },
      { id: 'achievement', label: 'Target achievement', icon: 'activity', path: 'targets/achievement' },
      { id: 'scorecard', label: 'Weekly scorecard', icon: 'check-square', path: 'scorecard' },
      { id: 'leaderboard', label: 'Leaderboard', icon: 'star', path: 'leaderboard' },
    ],
  },
  resources: [attendance, regularisations, fieldVisits, beatPlans, expenseClaims, leaves, targets],
  masters,
  permissions: {
    admin: { ...Object.fromEntries(FIELD.map((k) => [k, p('all', 'all', true, true, true)])), targets: p('all', 'all', true, true, true) },
    management: { ...fieldPerms('all', true), targets: p('all', 'all', true, true, true) },
    division_head: { ...fieldPerms('division', true), targets: p('division', 'division', true, true, true) },
    sales_manager: { ...fieldPerms('team', true), targets: p('team', 'team', true, false, true) },
    sales_exec: { ...fieldPerms('own'), targets: p('own') },
    service_head: { ...fieldPerms('team', true), targets: p('team') },
    engineer: { ...fieldPerms('own') },
    coordinator: { ...fieldPerms('division') },
    scm: { ...fieldPerms('own') },
    store: { ...fieldPerms('own') },
    accounts: { ...fieldPerms('all', true), targets: p('all', 'none', false, false, true) },
    profiling: { ...fieldPerms('own') },
  },
  capabilities: {
    admin: ['expense.export', 'field.team'],
    management: ['field.team'],
    division_head: ['field.team'],
    sales_manager: ['field.team'],
    service_head: ['field.team'],
    coordinator: ['field.team'],
    accounts: ['expense.export', 'field.team'],
  },
};
