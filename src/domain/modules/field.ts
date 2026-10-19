/**
 * Field Force (BRD 4.11) and Targets & Recognition (BRD 4.12): attendance, attendance regularisation,
 * field visits, beat plan, expense claims, leave applications and targets. Custom pages live in
 * src/modules/field; sidebar entries come from src/domain/sidebar.ts; every label comes from L.field / L.targets.
 */
import type { MasterDefinition, MasterValue, ResourceDefinition, Tone } from '../../metadata/types';
import { ALL, cols, cond, field, FORM_ONLY, group, NO_SEARCH, views } from '../helpers';
import { type ModulePack, p } from './types';
import { L } from '../../constants/labels';

const R = L.field.records;
const D = L.field.descriptions;
const F = L.field.fields;
const S = L.field.sections;
const V = L.field.views;
const A = L.field.actions;
const C = L.field.confirms;
const TF = L.targets.fields.targets;

const mv = (key: string, label: string, tone: Tone = 'neutral'): Omit<MasterValue, 'order'> => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[]): MasterDefinition => ({ id: `mst_${key}`, key, label, version: 1, values: values.map((x, i) => ({ ...x, order: i })) });

const M = L.field.masters;
const TM = L.targets.masters;
const masters: MasterDefinition[] = [
  master('attendanceStatus', M.attendanceStatus.label, [mv('present', M.attendanceStatus.values.present, 'success'), mv('half_day', M.attendanceStatus.values.half_day, 'warning'), mv('on_tour', M.attendanceStatus.values.on_tour, 'info'), mv('leave', M.attendanceStatus.values.leave, 'accent'), mv('absent', M.attendanceStatus.values.absent, 'danger')]),
  master('regularisationStatus', M.regularisationStatus.label, [mv('pending', M.regularisationStatus.values.pending, 'warning'), mv('approved', M.regularisationStatus.values.approved, 'success'), mv('rejected', M.regularisationStatus.values.rejected, 'danger')]),
  master('visitPurpose', M.visitPurpose.label, [mv('prospecting', M.visitPurpose.values.prospecting, 'info'), mv('follow_up', M.visitPurpose.values.follow_up), mv('demo', M.visitPurpose.values.demo, 'accent'), mv('service', M.visitPurpose.values.service, 'warning'), mv('collection', M.visitPurpose.values.collection, 'success')]),
  master('fieldVisitStatus', M.fieldVisitStatus.label, [mv('planned', M.fieldVisitStatus.values.planned, 'info'), mv('in_progress', M.fieldVisitStatus.values.in_progress, 'warning'), mv('completed', M.fieldVisitStatus.values.completed, 'success'), mv('cancelled', M.fieldVisitStatus.values.cancelled)]),
  master('beatStatus', M.beatStatus.label, [mv('planned', M.beatStatus.values.planned, 'info'), mv('visited', M.beatStatus.values.visited, 'success'), mv('missed', M.beatStatus.values.missed, 'danger')]),
  master('expenseType', M.expenseType.label, [mv('conveyance', M.expenseType.values.conveyance), mv('travel', M.expenseType.values.travel), mv('food', M.expenseType.values.food), mv('lodging', M.expenseType.values.lodging), mv('other', M.expenseType.values.other)]),
  master('vehicleType', M.vehicleType.label, [mv('two_wheeler', M.vehicleType.values.two_wheeler), mv('car', M.vehicleType.values.car)]),
  master('expenseStatus', M.expenseStatus.label, [mv('draft', M.expenseStatus.values.draft), mv('submitted', M.expenseStatus.values.submitted, 'warning'), mv('approved', M.expenseStatus.values.approved, 'success'), mv('rejected', M.expenseStatus.values.rejected, 'danger'), mv('exported', M.expenseStatus.values.exported, 'accent')]),
  master('leaveType', M.leaveType.label, [mv('casual', M.leaveType.values.casual), mv('sick', M.leaveType.values.sick), mv('earned', M.leaveType.values.earned), mv('comp_off', M.leaveType.values.comp_off)]),
  master('leaveStatus', M.leaveStatus.label, [mv('pending', M.leaveStatus.values.pending, 'warning'), mv('approved', M.leaveStatus.values.approved, 'success'), mv('rejected', M.leaveStatus.values.rejected, 'danger'), mv('cancelled', M.leaveStatus.values.cancelled)]),
  master('targetScope', TM.targetScope.label, [mv('user', TM.targetScope.values.user), mv('team', TM.targetScope.values.team), mv('division', TM.targetScope.values.division)]),
  master('periodType', TM.periodType.label, [mv('month', TM.periodType.values.month), mv('quarter', TM.periodType.values.quarter), mv('year', TM.periodType.values.year)]),
  master('targetMetric', TM.targetMetric.label, [mv('order_value', TM.targetMetric.values.order_value, 'accent'), mv('quantity', TM.targetMetric.values.quantity), mv('collections', TM.targetMetric.values.collections, 'success'), mv('new_customers', TM.targetMetric.values.new_customers, 'info'), mv('activities', TM.targetMetric.values.activities)]),
];

const f = (res: string) => (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field(res, key, label, type, extra);
const employee = { relation: { resource: 'employees' }, display: 'person' as const, personSubtitle: 'designation' };
const SYS = { readOnly: true, capabilities: { list: true, sort: true, filter: true, export: true } };

const fa = f('attendance');
export const attendance: ResourceDefinition = {
  id: 'res_attendance',
  key: 'attendance',
  module: 'field',
  label: R.attendance.one,
  labelPlural: R.attendance.many,
  icon: 'calendar-clock',
  version: 1,
  idPrefix: 'ATT',
  titleField: 'date',
  subtitleFields: ['employeeId', 'status'],
  ownerField: 'employeeId',
  description: D.attendance,
  status: 'published',
  fields: [
    fa('employeeId', F.attendance.employeeId, 'relation', { ...employee, required: true, readOnly: true, width: 180, capabilities: ALL }),
    fa('date', F.attendance.date, 'date', { required: true, readOnly: true, width: 120 }),
    fa('status', F.attendance.status, 'master', { master: 'attendanceStatus', required: true, readOnly: true, width: 120 }),
    fa('checkInAt', F.attendance.checkInAt, 'datetime', { ...SYS, width: 150 }),
    fa('checkOutAt', F.attendance.checkOutAt, 'datetime', { ...SYS, width: 150 }),
    fa('workMinutes', F.attendance.workMinutes, 'number', { ...SYS, unit: 'min', width: 100 }),
    fa('lateByMin', F.attendance.lateByMin, 'number', { ...SYS, unit: 'min', width: 100 }),
    fa('earlyByMin', F.attendance.earlyByMin, 'number', { ...SYS, unit: 'min', width: 110 }),
    fa('checkInPlace', F.attendance.checkInPlace, 'text', { ...SYS, width: 200 }),
    fa('insideGeofence', F.attendance.insideGeofence, 'boolean', SYS),
    fa('mockLocation', F.attendance.mockLocation, 'boolean', SYS),
    fa('selfie', F.attendance.selfie, 'boolean', SYS),
    fa('locationSource', F.attendance.locationSource, 'text', SYS),
    fa('distanceKm', F.attendance.distanceKm, 'number', { ...SYS, unit: 'km' }),
    fa('checkInLat', F.attendance.checkInLat, 'number', { readOnly: true, capabilities: { export: true } }),
    fa('checkInLng', F.attendance.checkInLng, 'number', { readOnly: true, capabilities: { export: true } }),
    fa('checkOutLat', F.attendance.checkOutLat, 'number', { readOnly: true, capabilities: { export: true } }),
    fa('checkOutLng', F.attendance.checkOutLng, 'number', { readOnly: true, capabilities: { export: true } }),
    fa('regularised', F.attendance.regularised, 'boolean', SYS),
  ],
  relationships: [],
  form: { quickCreate: [], sections: [{ id: 'main', title: S.attendance, fields: ['employeeId', 'date', 'status'], columns: 2 }] },
  views: views([
    { id: 'v_att_recent', resource: 'attendance', name: V.attendance.recent, type: 'table', filter: group('and'), sort: [{ field: 'date', dir: 'desc' }], columns: cols('date', 'employeeId', 'status', 'checkInAt', 'checkOutAt', 'workMinutes', 'lateByMin', 'earlyByMin', 'checkInPlace') },
    { id: 'v_att_late', resource: 'attendance', name: V.attendance.late, type: 'table', filter: group('and', [cond('lateByMin', 'gt', 0)]), sort: [{ field: 'date', dir: 'desc' }], columns: cols('date', 'employeeId', 'checkInAt', 'lateByMin', 'status') },
    { id: 'v_att_by_person', resource: 'attendance', name: V.attendance.byPerson, type: 'table', filter: group('and'), sort: [{ field: 'date', dir: 'desc' }], groupBy: 'employeeId', columns: cols('date', 'status', 'checkInAt', 'checkOutAt', 'workMinutes', 'lateByMin') },
  ]),
};

const fr = f('regularisations');
export const regularisations: ResourceDefinition = {
  id: 'res_regularisations',
  key: 'regularisations',
  module: 'field',
  label: R.regularisations.one,
  labelPlural: R.regularisations.many,
  icon: 'calendar-clock',
  version: 1,
  idPrefix: 'REG',
  titleField: 'reason',
  subtitleFields: ['date', 'status'],
  ownerField: 'employeeId',
  description: D.regularisations,
  status: 'published',
  fields: [
    fr('employeeId', F.regularisations.employeeId, 'relation', { ...employee, required: true, readOnly: true, width: 180 }),
    fr('date', F.regularisations.date, 'date', { required: true, dateRule: 'past', width: 120 }),
    fr('requestedCheckIn', F.regularisations.requestedCheckIn, 'datetime', { required: true, width: 150 }),
    fr('requestedCheckOut', F.regularisations.requestedCheckOut, 'datetime', { required: true, width: 150, compare: { op: 'gte', field: 'requestedCheckIn', message: L.field.errors.checkOutAfterIn } }),
    fr('reason', F.regularisations.reason, 'text', { required: true, maxLength: 200, capabilities: ALL, width: 260 }),
    fr('status', F.regularisations.status, 'master', { master: 'regularisationStatus', readOnly: true, defaultValue: 'pending', width: 140 }),
    fr('decisionNote', F.regularisations.decisionNote, 'text', { readOnly: true }),
  ],
  relationships: [],
  form: { quickCreate: ['date', 'requestedCheckIn', 'requestedCheckOut', 'reason'], sections: [{ id: 'main', title: S.regularisations, fields: ['date', 'requestedCheckIn', 'requestedCheckOut', 'reason'], columns: 2 }] },
  views: views([
    { id: 'v_reg_pending', resource: 'regularisations', name: V.regularisations.pending, type: 'table', filter: group('and', [cond('status', 'eq', 'pending')]), sort: [{ field: 'date', dir: 'desc' }], columns: cols('date', 'employeeId', 'requestedCheckIn', 'requestedCheckOut', 'reason', 'status') },
    { id: 'v_reg_all', resource: 'regularisations', name: V.regularisations.all, type: 'table', filter: group('and'), sort: [{ field: 'date', dir: 'desc' }], columns: cols('date', 'employeeId', 'reason', 'status', 'decisionNote') },
  ]),
};

const fv = f('fieldVisits');
export const fieldVisits: ResourceDefinition = {
  id: 'res_fieldVisits',
  key: 'fieldVisits',
  module: 'field',
  label: R.fieldVisits.one,
  labelPlural: R.fieldVisits.many,
  icon: 'door-open',
  version: 1,
  idPrefix: 'FV',
  idFormat: 'fy',
  titleField: 'siteLabel',
  subtitleFields: ['purpose', 'status'],
  ownerField: 'employeeId',
  description: D.fieldVisits,
  status: 'published',
  fields: [
    fv('siteLabel', F.fieldVisits.siteLabel, 'text', { required: true, maxLength: 140, capabilities: ALL, width: 240, subFields: ['parentLabel'] }),
    fv('customerId', F.fieldVisits.customerId, 'relation', { relation: { resource: 'customers' }, width: 200, capabilities: ALL }),
    fv('employeeId', F.fieldVisits.employeeId, 'relation', { ...employee, required: true, width: 170 }),
    fv('purpose', F.fieldVisits.purpose, 'master', { master: 'visitPurpose', required: true, defaultValue: 'follow_up', width: 120 }),
    fv('plannedFor', F.fieldVisits.plannedFor, 'date', { required: true, width: 120 }),
    fv('status', F.fieldVisits.status, 'master', { master: 'fieldVisitStatus', readOnly: true, width: 120 }),
    fv('checkInAt', F.fieldVisits.checkInAt, 'datetime', { ...SYS, width: 150 }),
    fv('checkOutAt', F.fieldVisits.checkOutAt, 'datetime', { ...SYS, width: 150 }),
    fv('remarks', F.fieldVisits.remarks, 'longtext', { maxLength: 2000, capabilities: { ...FORM_ONLY, search: true } }),
    fv('nextAction', F.fieldVisits.nextAction, 'text', { maxLength: 200, capabilities: NO_SEARCH, width: 200 }),
    fv('nextActionDate', F.fieldVisits.nextActionDate, 'date', { dateRule: 'future' }),
    fv('parentLabel', F.fieldVisits.parentLabel, 'text', { readOnly: true, capabilities: { list: true, search: true, sort: true }, width: 220 }),
    fv('parentResource', F.fieldVisits.parentResource, 'text', { system: true, readOnly: true, capabilities: { filter: true } }),
    fv('parentId', F.fieldVisits.parentId, 'text', { system: true, readOnly: true, capabilities: { filter: true, search: true } }),
    fv('checkInLat', F.fieldVisits.checkInLat, 'number', { readOnly: true, capabilities: { export: true } }),
    fv('checkInLng', F.fieldVisits.checkInLng, 'number', { readOnly: true, capabilities: { export: true } }),
    fv('locationSource', F.fieldVisits.locationSource, 'text', SYS),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'planned',
    terminal: ['cancelled'],
    transitions: [{ from: ['planned'], to: 'cancelled', action: A.cancelVisit, confirm: C.cancelVisit }],
  },
  form: {
    quickCreate: ['siteLabel', 'customerId', 'purpose', 'plannedFor', 'nextAction'],
    sections: [{ id: 'main', title: S.fieldVisits, fields: ['siteLabel', 'customerId', 'employeeId', 'purpose', 'plannedFor', 'remarks', 'nextAction', 'nextActionDate'], columns: 2 }],
  },
  views: views([
    { id: 'v_fv_recent', resource: 'fieldVisits', name: V.fieldVisits.recent, type: 'table', filter: group('and'), sort: [{ field: 'plannedFor', dir: 'desc' }], columns: cols('plannedFor', 'siteLabel', 'employeeId', 'purpose', 'status', 'checkInAt', 'checkOutAt', 'nextAction') },
    { id: 'v_fv_planned', resource: 'fieldVisits', name: V.fieldVisits.planned, type: 'table', filter: group('and', [cond('status', 'eq', 'planned')]), sort: [{ field: 'plannedFor', dir: 'asc' }], columns: cols('plannedFor', 'siteLabel', 'employeeId', 'purpose', 'parentLabel') },
    { id: 'v_fv_by_person', resource: 'fieldVisits', name: V.fieldVisits.byPerson, type: 'table', filter: group('and'), sort: [{ field: 'plannedFor', dir: 'desc' }], groupBy: 'employeeId', columns: cols('plannedFor', 'siteLabel', 'purpose', 'status', 'nextAction') },
  ]),
};

const fb = f('beatPlans');
export const beatPlans: ResourceDefinition = {
  id: 'res_beatPlans',
  key: 'beatPlans',
  module: 'field',
  label: R.beatPlans.one,
  labelPlural: R.beatPlans.many,
  icon: 'calendar',
  version: 1,
  idPrefix: 'BP',
  titleField: 'siteLabel',
  subtitleFields: ['date', 'status'],
  ownerField: 'employeeId',
  description: D.beatPlans,
  status: 'published',
  fields: [
    fb('siteLabel', F.beatPlans.siteLabel, 'text', { required: true, maxLength: 140, capabilities: ALL, width: 240 }),
    fb('customerId', F.beatPlans.customerId, 'relation', { relation: { resource: 'customers' }, width: 200 }),
    fb('employeeId', F.beatPlans.employeeId, 'relation', { ...employee, required: true, width: 170 }),
    fb('date', F.beatPlans.date, 'date', { required: true, width: 120 }),
    fb('weekStart', F.beatPlans.weekStart, 'date', { readOnly: true, capabilities: { list: true, sort: true, filter: true } }),
    fb('purpose', F.beatPlans.purpose, 'master', { master: 'visitPurpose', required: true, defaultValue: 'follow_up', width: 120 }),
    fb('status', F.beatPlans.status, 'master', { master: 'beatStatus', readOnly: true, defaultValue: 'planned', width: 110 }),
  ],
  relationships: [],
  form: { quickCreate: ['siteLabel', 'customerId', 'date', 'purpose'], sections: [{ id: 'main', title: S.beatPlans, fields: ['siteLabel', 'customerId', 'employeeId', 'date', 'purpose'], columns: 2 }] },
  views: views([
    { id: 'v_bp_week', resource: 'beatPlans', name: V.beatPlans.week, type: 'table', filter: group('and', [cond('date', 'next7')]), sort: [{ field: 'date', dir: 'asc' }], columns: cols('date', 'siteLabel', 'employeeId', 'purpose', 'status') },
    { id: 'v_bp_all', resource: 'beatPlans', name: V.beatPlans.all, type: 'table', filter: group('and'), sort: [{ field: 'date', dir: 'desc' }], groupBy: 'employeeId', columns: cols('date', 'siteLabel', 'purpose', 'status') },
  ]),
};

const fx = f('expenseClaims');
export const expenseClaims: ResourceDefinition = {
  id: 'res_expenseClaims',
  key: 'expenseClaims',
  module: 'field',
  label: R.expenseClaims.one,
  labelPlural: R.expenseClaims.many,
  icon: 'receipt',
  version: 1,
  idPrefix: 'EXP',
  idFormat: 'fy',
  titleField: 'description',
  subtitleFields: ['amount', 'status'],
  ownerField: 'employeeId',
  description: D.expenseClaims,
  status: 'published',
  fields: [
    fx('description', F.expenseClaims.description, 'text', { required: true, maxLength: 140, capabilities: ALL, width: 260, subFields: ['claimDate'] }),
    fx('employeeId', F.expenseClaims.employeeId, 'relation', { ...employee, required: true, readOnly: true, width: 170 }),
    fx('claimDate', F.expenseClaims.claimDate, 'date', { required: true, dateRule: 'past', width: 120 }),
    fx('expenseType', F.expenseClaims.expenseType, 'master', { master: 'expenseType', required: true, defaultValue: 'conveyance', width: 150 }),
    fx('vehicleType', F.expenseClaims.vehicleType, 'master', { master: 'vehicleType', defaultValue: 'two_wheeler', requiredWhen: { field: 'expenseType', op: 'eq', value: 'conveyance' }, visibleWhen: { field: 'expenseType', op: 'eq', value: 'conveyance' }, clearWhenHidden: true }),
    fx('km', F.expenseClaims.km, 'number', { unit: 'km', min: 0, max: 2000, requiredWhen: { field: 'expenseType', op: 'eq', value: 'conveyance' }, visibleWhen: { field: 'expenseType', op: 'eq', value: 'conveyance' }, clearWhenHidden: true, help: F.expenseClaims.kmHelp }),
    // BR-46: conveyance amount is calculated (km × rate) by the service, so it is only typed for other expense types.
    fx('amount', F.expenseClaims.amount, 'money', { requiredWhen: { field: 'expenseType', op: 'neq', value: 'conveyance' }, min: 0, currency: 'INR', width: 130, help: F.expenseClaims.amountHelp }),
    fx('billFileName', F.expenseClaims.billFileName, 'text', { maxLength: 120, requiredWhen: { field: 'expenseType', op: 'neq', value: 'conveyance' }, help: F.expenseClaims.billFileNameHelp }),
    fx('justification', F.expenseClaims.justification, 'longtext', { maxLength: 500, help: F.expenseClaims.justificationHelp, capabilities: FORM_ONLY }),
    fx('policyLimit', F.expenseClaims.policyLimit, 'money', { readOnly: true, currency: 'INR', capabilities: { list: true, export: true } }),
    fx('status', F.expenseClaims.status, 'master', { master: 'expenseStatus', readOnly: true, width: 150 }),
    fx('exportedAt', F.expenseClaims.exportedAt, 'datetime', { readOnly: true, capabilities: { list: true, sort: true, export: true } }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'draft',
    terminal: ['exported'],
    transitions: [
      { from: ['draft'], to: 'submitted', action: A.submitForApproval },
      { from: ['rejected'], to: 'draft', action: A.revise },
      { from: ['approved'], to: 'exported', action: A.markExported, capability: 'expense.export' },
    ],
  },
  form: {
    quickCreate: ['description', 'claimDate', 'expenseType', 'vehicleType', 'km', 'amount', 'billFileName'],
    sections: [{ id: 'main', title: S.expenseClaims, fields: ['description', 'claimDate', 'expenseType', 'vehicleType', 'km', 'amount', 'billFileName', 'justification'], columns: 2 }],
  },
  views: views([
    { id: 'v_exp_mine', resource: 'expenseClaims', name: V.expenseClaims.open, type: 'table', filter: group('and', [cond('status', 'in', ['draft', 'submitted', 'rejected'])]), sort: [{ field: 'claimDate', dir: 'desc' }], columns: cols('claimDate', 'description', 'employeeId', 'expenseType', 'km', 'amount', 'status') },
    { id: 'v_exp_approved', resource: 'expenseClaims', name: V.expenseClaims.approved, type: 'table', filter: group('and', [cond('status', 'eq', 'approved')]), sort: [{ field: 'claimDate', dir: 'asc' }], columns: cols('claimDate', 'description', 'employeeId', 'expenseType', 'amount', 'status') },
    { id: 'v_exp_all', resource: 'expenseClaims', name: V.expenseClaims.all, type: 'table', filter: group('and'), sort: [{ field: 'claimDate', dir: 'desc' }], columns: cols('claimDate', 'description', 'employeeId', 'expenseType', 'km', 'amount', 'policyLimit', 'status', 'exportedAt') },
    { id: 'v_exp_board', resource: 'expenseClaims', name: V.expenseClaims.board, type: 'board', boardField: 'status', filter: group('and'), sort: [{ field: 'claimDate', dir: 'desc' }], columns: cols('description', 'employeeId', 'amount', 'claimDate') },
  ]),
};

const fl = f('leaves');
export const leaves: ResourceDefinition = {
  id: 'res_leaves',
  key: 'leaves',
  module: 'field',
  label: R.leaves.one,
  labelPlural: R.leaves.many,
  icon: 'calendar',
  version: 1,
  idPrefix: 'LV',
  titleField: 'reason',
  subtitleFields: ['fromDate', 'status'],
  ownerField: 'employeeId',
  description: D.leaves,
  status: 'published',
  fields: [
    fl('employeeId', F.leaves.employeeId, 'relation', { ...employee, required: true, readOnly: true, width: 170 }),
    fl('leaveType', F.leaves.leaveType, 'master', { master: 'leaveType', required: true, defaultValue: 'casual', width: 130 }),
    fl('fromDate', F.leaves.fromDate, 'date', { required: true, width: 120 }),
    fl('toDate', F.leaves.toDate, 'date', { required: true, width: 120, compare: { op: 'gte', field: 'fromDate', message: L.field.errors.leaveEndBeforeStart } }),
    fl('days', F.leaves.days, 'number', { readOnly: true, computed: (r) => (r.fromDate && r.toDate ? Math.max(0, Math.round((Date.parse(String(r.toDate)) - Date.parse(String(r.fromDate))) / 86_400_000) + 1) : null), capabilities: { list: true, export: true }, width: 80 }),
    fl('reason', F.leaves.reason, 'text', { required: true, maxLength: 200, capabilities: ALL, width: 240 }),
    fl('status', F.leaves.status, 'master', { master: 'leaveStatus', readOnly: true, width: 140 }),
    fl('decisionNote', F.leaves.decisionNote, 'text', { readOnly: true }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'pending',
    terminal: ['cancelled', 'rejected'],
    transitions: [{ from: ['pending', 'approved'], to: 'cancelled', action: A.cancelLeave, confirm: C.cancelLeave }],
  },
  form: { quickCreate: ['leaveType', 'fromDate', 'toDate', 'reason'], sections: [{ id: 'main', title: S.leaves, fields: ['leaveType', 'fromDate', 'toDate', 'reason'], columns: 2 }] },
  views: views([
    { id: 'v_lv_upcoming', resource: 'leaves', name: V.leaves.upcoming, type: 'table', filter: group('and', [cond('toDate', 'future')]), sort: [{ field: 'fromDate', dir: 'asc' }], columns: cols('fromDate', 'toDate', 'days', 'employeeId', 'leaveType', 'reason', 'status') },
    { id: 'v_lv_all', resource: 'leaves', name: V.leaves.all, type: 'table', filter: group('and'), sort: [{ field: 'fromDate', dir: 'desc' }], columns: cols('fromDate', 'toDate', 'days', 'employeeId', 'leaveType', 'status', 'decisionNote') },
  ]),
};

const ft = f('targets');
export const targets: ResourceDefinition = {
  id: 'res_targets',
  key: 'targets',
  module: 'field',
  label: L.targets.records.targets.one,
  labelPlural: L.targets.records.targets.many,
  icon: 'activity',
  version: 1,
  idPrefix: 'TGT',
  titleField: 'name',
  subtitleFields: ['metric', 'periodStart'],
  ownerField: 'employeeId',
  divisionField: 'divisionId',
  description: L.targets.descriptions.targets,
  status: 'published',
  fields: [
    ft('name', TF.name, 'text', { readOnly: true, capabilities: { list: true, search: true, sort: true, export: true }, width: 260 }),
    ft('scopeType', TF.scopeType, 'master', { master: 'targetScope', required: true, defaultValue: 'user', width: 110 }),
    ft('employeeId', TF.employeeId, 'relation', { ...employee, requiredWhen: { field: 'scopeType', op: 'in', value: ['user', 'team'] }, visibleWhen: { field: 'scopeType', op: 'in', value: ['user', 'team'] }, clearWhenHidden: true, width: 170, help: TF.employeeIdHelp }),
    ft('divisionId', TF.divisionId, 'master', { master: 'division', required: true, width: 150, help: TF.divisionIdHelp }),
    ft('periodType', TF.periodType, 'master', { master: 'periodType', required: true, defaultValue: 'month', width: 110 }),
    ft('periodStart', TF.periodStart, 'date', { required: true, width: 120, help: TF.periodStartHelp }),
    ft('productCategory', TF.productCategory, 'master', { master: 'productType', width: 140, help: TF.productCategoryHelp }),
    ft('metric', TF.metric, 'master', { master: 'targetMetric', required: true, defaultValue: 'order_value', width: 150 }),
    ft('targetValue', TF.targetValue, 'number', { required: true, min: 1, width: 130 }),
  ],
  relationships: [],
  form: {
    quickCreate: ['scopeType', 'employeeId', 'divisionId', 'periodType', 'periodStart', 'metric', 'targetValue', 'productCategory'],
    sections: [{ id: 'main', title: L.targets.sections.targets, fields: ['scopeType', 'employeeId', 'divisionId', 'periodType', 'periodStart', 'metric', 'productCategory', 'targetValue'], columns: 2 }],
  },
  views: views([
    { id: 'v_tgt_all', resource: 'targets', name: L.targets.views.targets.all, type: 'table', filter: group('and'), sort: [{ field: 'periodStart', dir: 'desc' }], columns: cols('name', 'scopeType', 'employeeId', 'divisionId', 'periodType', 'periodStart', 'metric', 'productCategory', 'targetValue') },
    { id: 'v_tgt_by_metric', resource: 'targets', name: L.targets.views.targets.byMetric, type: 'table', filter: group('and'), sort: [{ field: 'periodStart', dir: 'desc' }], groupBy: 'metric', columns: cols('name', 'scopeType', 'periodType', 'periodStart', 'targetValue') },
  ]),
};

const FIELD = ['attendance', 'regularisations', 'fieldVisits', 'beatPlans', 'expenseClaims', 'leaves'];
/** Same scope on every field-force resource: read by role scope, write own. */
const fieldPerms = (read: Parameters<typeof p>[0], exp = false, del = false) => Object.fromEntries(FIELD.map((k) => [k, p(read, 'own', true, del || k === 'beatPlans', exp)]));

export const fieldPack: ModulePack = {
  id: 'field',
  resources: [attendance, regularisations, fieldVisits, beatPlans, expenseClaims, leaves, targets],
  masters,
  permissions: {
    admin: { ...Object.fromEntries(FIELD.map((k) => [k, p('all', 'all', true, true, true)])), targets: p('all', 'all', true, true, true) },
    management: { ...fieldPerms('all', true), targets: p('all', 'all', true, true, true) },
    division_head: { ...fieldPerms('division', true), targets: p('division', 'division', true, true, true) },
    // Permission matrix (REQUIREMENTS §2.2): sales managers view their team's targets; targets are set by Division head / Management / Admin.
    sales_manager: { ...fieldPerms('team', true), targets: p('team', 'none', false, false, true) },
    sales_exec: { ...fieldPerms('own'), targets: p('own') },
    service_head: { ...fieldPerms('team', true), targets: p('team') },
    engineer: { ...fieldPerms('own'), targets: p('own') },
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
