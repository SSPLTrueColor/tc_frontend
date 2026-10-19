import type {
  FieldCapabilities,
  FieldDefinition,
  FilterCondition,
  FilterGroup,
  ResourceDefinition,
  ViewDefinition,
} from '../../metadata/types';
import { addMinutes } from '../../lib/dates';

const ALL: FieldCapabilities = { list: true, sort: true, filter: true, search: true, form: true, export: true };
const NO_SEARCH: FieldCapabilities = { list: true, sort: true, filter: true, form: true, export: true };
const FORM_ONLY: FieldCapabilities = { form: true, export: true };

function f(resource: string, key: string, label: string, type: FieldDefinition['type'], extra: Partial<FieldDefinition> = {}): FieldDefinition {
  return { id: `fld_${resource}_${key}`, key, label, type, capabilities: NO_SEARCH, ...extra };
}

let condSeq = 0;
export const cond = (field: string, operator: FilterCondition['operator'], value?: unknown): FilterCondition => ({
  kind: 'condition',
  id: `c${++condSeq}`,
  field,
  operator,
  value,
});
export const group = (join: 'and' | 'or', children: FilterGroup['children'] = []): FilterGroup => ({
  kind: 'group',
  id: `g${++condSeq}`,
  join,
  children,
});

type ViewSeed = Omit<ViewDefinition, 'resourceVersion' | 'order' | 'scope' | 'ownerId' | 'density'> &
  Partial<Pick<ViewDefinition, 'density' | 'scope'>>;
const views = (list: ViewSeed[]): ResourceDefinition['views'] =>
  list.map((x, i) => ({ density: 'compact', scope: 'org', ownerId: 'system', order: i, ...x }));

const CLINICAL = ['physician', 'nurse_practitioner', 'nurse', 'physiotherapist'];

const lineTotal = (r: Record<string, unknown>) =>
  ((r.lineItems as { qty?: number; unitPrice?: number }[] | undefined) ?? []).reduce(
    (s, li) => s + (Number(li.qty) || 0) * (Number(li.unitPrice) || 0),
    0,
  );

export const patients: ResourceDefinition = {
  id: 'res_patients',
  key: 'patients',
  module: 'patients',
  label: 'Patient',
  labelPlural: 'Patients',
  icon: 'users',
  version: 1,
  idPrefix: 'P',
  titleField: 'fullName',
  subtitleFields: ['id', 'status'],
  description: 'Administrative patient registry: identity, contact and coverage. No clinical records.',
  status: 'published',
  fields: [
    f('patients', 'fullName', 'Full name', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 220 }),
    f('patients', 'preferredName', 'Preferred name', 'text', { maxLength: 40, capabilities: { ...ALL, list: false } }),
    f('patients', 'dateOfBirth', 'Date of birth', 'date', { required: true, dateRule: 'past', sensitivity: 'identifier', capabilities: NO_SEARCH }),
    f('patients', 'phone', 'Phone', 'phone', {
      required: true,
      sensitivity: 'contact',
      pattern: { regex: '^\\+?[0-9 ()-]{7,20}$', message: 'Enter a valid phone number' },
      capabilities: ALL,
      width: 210,
    }),
    f('patients', 'email', 'Email', 'email', {
      sensitivity: 'contact',
      pattern: { regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', message: 'Enter a valid email address' },
      capabilities: ALL,
      width: 220,
    }),
    f('patients', 'contactPreference', 'Contact preference', 'master', { master: 'contactPreference', defaultValue: 'phone' }),
    f('patients', 'status', 'Status', 'master', { master: 'patientStatus', defaultValue: 'new', required: true }),
    f('patients', 'primaryClinicianId', 'Primary clinician', 'relation', {
      relation: { resource: 'staff', where: { field: 'staffRole', op: 'in', value: CLINICAL } },
      width: 180,
    }),
    f('patients', 'payer', 'Payer', 'master', { master: 'payer', required: true, defaultValue: 'self_pay', width: 200 }),
    f('patients', 'memberId', 'Member ID', 'identifier', {
      sensitivity: 'identifier',
      requiredWhen: { field: 'payer', op: 'neq', value: 'self_pay' },
      visibleWhen: { field: 'payer', op: 'neq', value: 'self_pay' },
      help: 'Required when a payer other than self-pay is selected.',
      maxLength: 24,
    }),
    f('patients', 'accessNeeds', 'Access needs', 'multimaster', { master: 'accessNeeds', capabilities: { ...NO_SEARCH, list: false } }),
    f('patients', 'restrictedNote', 'Restricted admin note', 'longtext', {
      sensitivity: 'health',
      maxLength: 500,
      help: 'Restricted to roles with health-information access. Administrative only.',
      capabilities: FORM_ONLY,
    }),
    f('patients', 'registeredOn', 'Registered on', 'date', { system: true, readOnly: true, capabilities: { list: true, sort: true, filter: true } }),
  ],
  relationships: [
    { id: 'rel_patient_appts', label: 'Appointments', resource: 'appointments', foreignKey: 'patientId' },
    { id: 'rel_patient_invoices', label: 'Invoices', resource: 'invoices', foreignKey: 'patientId' },
    { id: 'rel_patient_referrals', label: 'Referrals', resource: 'referrals', foreignKey: 'patientId' },
  ],
  form: {
    quickCreate: ['fullName', 'dateOfBirth', 'phone', 'payer', 'memberId'],
    sections: [
      { id: 'identity', title: 'Identity', fields: ['fullName', 'preferredName', 'dateOfBirth', 'status'], columns: 2 },
      { id: 'contact', title: 'Contact', fields: ['phone', 'email', 'contactPreference', 'accessNeeds'], columns: 2 },
      { id: 'coverage', title: 'Coverage & care team', fields: ['payer', 'memberId', 'primaryClinicianId'], columns: 2 },
      { id: 'restricted', title: 'Restricted', fields: ['restrictedNote'], columns: 1 },
    ],
    wizard: [
      { id: 'w1', title: 'Identity', sections: ['identity'] },
      { id: 'w2', title: 'Contact', sections: ['contact'] },
      { id: 'w3', title: 'Coverage', sections: ['coverage', 'restricted'] },
    ],
  },
  views: views([
    {
      id: 'v_patients_all',
      resource: 'patients',
      name: 'All patients',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'fullName', dir: 'asc' }],
      columns: ['fullName', 'id', 'dateOfBirth', 'phone', 'email', 'status', 'payer', 'primaryClinicianId', 'registeredOn'].map((key) => ({ key })),
    },
    {
      id: 'v_patients_new',
      resource: 'patients',
      name: 'New registrations',
      type: 'table',
      filter: group('and', [cond('status', 'eq', 'new')]),
      sort: [{ field: 'registeredOn', dir: 'desc' }],
      columns: ['fullName', 'id', 'phone', 'payer', 'memberId', 'registeredOn'].map((key) => ({ key })),
    },
    {
      id: 'v_patients_by_payer',
      resource: 'patients',
      name: 'By payer',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'fullName', dir: 'asc' }],
      groupBy: 'payer',
      columns: ['fullName', 'id', 'payer', 'memberId', 'status'].map((key) => ({ key })),
    },
  ]),
};

export const appointments: ResourceDefinition = {
  id: 'res_appointments',
  key: 'appointments',
  module: 'scheduling',
  label: 'Appointment',
  labelPlural: 'Appointments',
  icon: 'calendar',
  version: 1,
  idPrefix: 'A',
  titleField: 'patientId',
  subtitleFields: ['start', 'status'],
  ownerField: 'clinicianId',
  calendar: {
    startField: 'start',
    durationField: 'durationMin',
    lanes: [
      { field: 'roomId', label: 'Rooms', emptyLaneLabel: 'Telehealth' },
      { field: 'clinicianId', label: 'Clinicians', laneFilter: { field: 'staffRole', op: 'in', value: CLINICAL } },
    ],
  },
  description: 'Bookings for clinicians and rooms. Overlaps are rejected by the scheduling service.',
  status: 'published',
  fields: [
    f('appointments', 'patientId', 'Patient', 'relation', { required: true, relation: { resource: 'patients' }, capabilities: ALL, width: 200 }),
    f('appointments', 'start', 'Start', 'datetime', { required: true, width: 170 }),
    f('appointments', 'durationMin', 'Duration', 'number', { required: true, min: 10, max: 180, unit: 'min', defaultValue: 30, width: 100 }),
    f('appointments', 'end', 'End', 'datetime', {
      readOnly: true,
      computed: (r) => (r.start && r.durationMin ? addMinutes(String(r.start), Number(r.durationMin)) : null),
      capabilities: { list: true, sort: false, export: true },
    }),
    f('appointments', 'clinicianId', 'Clinician', 'relation', {
      required: true,
      relation: { resource: 'staff', where: { field: 'staffRole', op: 'in', value: CLINICAL } },
      capabilities: ALL,
      width: 180,
    }),
    f('appointments', 'visitMode', 'Visit mode', 'master', { master: 'visitMode', required: true, defaultValue: 'in_person' }),
    f('appointments', 'roomId', 'Room', 'relation', {
      relation: { resource: 'rooms' },
      requiredWhen: { field: 'visitMode', op: 'eq', value: 'in_person' },
      visibleWhen: { field: 'visitMode', op: 'eq', value: 'in_person' },
      clearWhenHidden: true,
      help: 'Required for in-person visits. Rooms are exclusive — overlapping bookings are rejected.',
    }),
    f('appointments', 'appointmentType', 'Type', 'master', { master: 'appointmentType', required: true, defaultValue: 'follow_up', width: 160 }),
    f('appointments', 'status', 'Status', 'master', { master: 'appointmentStatus', readOnly: true, width: 150 }),
    f('appointments', 'bookingChannel', 'Booked via', 'master', { master: 'bookingChannel', defaultValue: 'phone' }),
    f('appointments', 'visitReason', 'Reason for visit', 'longtext', {
      sensitivity: 'health',
      maxLength: 300,
      help: 'Restricted: visible only to clinicians and practice management.',
      capabilities: FORM_ONLY,
    }),
    f('appointments', 'expectedCopay', 'Expected copay', 'money', { sensitivity: 'financial', currency: 'USD', min: 0 }),
  ],
  relationships: [{ id: 'rel_appt_invoices', label: 'Invoices', resource: 'invoices', foreignKey: 'appointmentId' }],
  lifecycle: {
    field: 'status',
    initial: 'scheduled',
    terminal: ['completed'],
    transitions: [
      { from: ['scheduled'], to: 'confirmed', action: 'Confirm' },
      { from: ['scheduled', 'confirmed'], to: 'checked_in', action: 'Check in' },
      { from: ['checked_in'], to: 'in_progress', action: 'Start visit', capability: 'visit.manage' },
      { from: ['in_progress'], to: 'completed', action: 'Complete visit', capability: 'visit.manage' },
      { from: ['scheduled', 'confirmed'], to: 'no_show', action: 'Mark no-show', confirm: 'Mark this appointment as a no-show?' },
      { from: ['scheduled', 'confirmed', 'checked_in'], to: 'cancelled', action: 'Cancel appointment', confirm: 'Cancel this appointment? The slot will be released.' },
      { from: ['cancelled', 'no_show'], to: 'scheduled', action: 'Reopen' },
    ],
  },
  form: {
    quickCreate: ['patientId', 'clinicianId', 'start', 'durationMin', 'visitMode', 'roomId', 'appointmentType'],
    sections: [
      { id: 'who', title: 'Who', fields: ['patientId', 'clinicianId'], columns: 2 },
      { id: 'when', title: 'When & where', fields: ['start', 'durationMin', 'visitMode', 'roomId'], columns: 2 },
      { id: 'what', title: 'Details', fields: ['appointmentType', 'bookingChannel', 'expectedCopay'], columns: 2 },
      { id: 'restricted', title: 'Restricted', fields: ['visitReason'], columns: 1 },
    ],
  },
  views: views([
    {
      id: 'v_appts_today',
      resource: 'appointments',
      name: 'Today',
      type: 'table',
      filter: group('and', [cond('start', 'today')]),
      sort: [{ field: 'start', dir: 'asc' }],
      columns: ['start', 'patientId', 'clinicianId', 'roomId', 'appointmentType', 'status', 'durationMin'].map((key) => ({ key })),
    },
    {
      id: 'v_appts_upcoming',
      resource: 'appointments',
      name: 'Upcoming 7 days',
      type: 'table',
      filter: group('and', [cond('start', 'next7')]),
      sort: [{ field: 'start', dir: 'asc' }],
      groupBy: 'clinicianId',
      columns: ['start', 'patientId', 'clinicianId', 'roomId', 'appointmentType', 'status'].map((key) => ({ key })),
    },
    {
      id: 'v_appts_board',
      resource: 'appointments',
      name: 'Front desk flow',
      type: 'board',
      boardField: 'status',
      filter: group('and', [cond('start', 'today')]),
      sort: [{ field: 'start', dir: 'asc' }],
      columns: ['start', 'patientId', 'clinicianId', 'roomId', 'status'].map((key) => ({ key })),
    },
    {
      id: 'v_appts_calendar',
      resource: 'appointments',
      name: 'Room calendar',
      type: 'calendar',
      filter: group('and'),
      sort: [{ field: 'start', dir: 'asc' }],
      columns: ['start', 'patientId', 'clinicianId', 'roomId', 'status'].map((key) => ({ key })),
    },
    {
      id: 'v_appts_all',
      resource: 'appointments',
      name: 'All',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'start', dir: 'desc' }],
      columns: ['start', 'patientId', 'clinicianId', 'roomId', 'appointmentType', 'status', 'bookingChannel', 'expectedCopay'].map((key) => ({ key })),
    },
  ]),
};

export const staff: ResourceDefinition = {
  id: 'res_staff',
  key: 'staff',
  module: 'resources',
  label: 'Staff member',
  labelPlural: 'Staff',
  icon: 'id-card',
  version: 1,
  idPrefix: 'S',
  titleField: 'fullName',
  subtitleFields: ['staffRole', 'status'],
  description: 'Clinic team members and their working days.',
  status: 'published',
  fields: [
    f('staff', 'photo', 'Photo', 'image', { capabilities: { list: false, form: true } }),
    f('staff', 'fullName', 'Full name', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 200 }),
    f('staff', 'staffRole', 'Role', 'master', { master: 'staffRole', required: true, width: 170 }),
    f('staff', 'department', 'Department', 'master', { master: 'department', required: true }),
    f('staff', 'status', 'Status', 'master', { master: 'staffStatus', required: true, defaultValue: 'active' }),
    f('staff', 'workingDays', 'Working days', 'multimaster', { master: 'weekday', width: 200 }),
    f('staff', 'email', 'Work email', 'email', {
      sensitivity: 'contact',
      required: true,
      pattern: { regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', message: 'Enter a valid email address' },
      capabilities: ALL,
      width: 220,
    }),
    f('staff', 'phone', 'Work phone', 'phone', { sensitivity: 'contact', capabilities: ALL }),
    f('staff', 'weeklyCapacity', 'Weekly appointment capacity', 'number', { min: 0, max: 200, unit: 'slots' }),
  ],
  relationships: [
    { id: 'rel_staff_appts', label: 'Appointments', resource: 'appointments', foreignKey: 'clinicianId' },
    { id: 'rel_staff_tasks', label: 'Tasks', resource: 'tasks', foreignKey: 'assigneeId' },
  ],
  form: {
    quickCreate: ['fullName', 'staffRole', 'department', 'email'],
    sections: [
      { id: 'main', title: 'Profile', fields: ['fullName', 'staffRole', 'department', 'status'], columns: 2 },
      { id: 'contact', title: 'Contact & availability', fields: ['email', 'phone', 'workingDays', 'weeklyCapacity'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_staff_all',
      resource: 'staff',
      name: 'Directory',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'fullName', dir: 'asc' }],
      columns: ['fullName', 'staffRole', 'department', 'status', 'workingDays', 'email', 'phone'].map((key) => ({ key })),
    },
    {
      id: 'v_staff_dept',
      resource: 'staff',
      name: 'By department',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'fullName', dir: 'asc' }],
      groupBy: 'department',
      columns: ['fullName', 'staffRole', 'status', 'workingDays'].map((key) => ({ key })),
    },
  ]),
};

export const rooms: ResourceDefinition = {
  id: 'res_rooms',
  key: 'rooms',
  module: 'resources',
  label: 'Room',
  labelPlural: 'Rooms',
  icon: 'door-open',
  version: 1,
  idPrefix: 'R',
  titleField: 'name',
  subtitleFields: ['roomType', 'status'],
  description: 'Bookable rooms. Rooms in maintenance cannot receive new bookings.',
  status: 'published',
  fields: [
    f('rooms', 'name', 'Name', 'text', { required: true, maxLength: 40, capabilities: ALL, width: 180 }),
    f('rooms', 'roomType', 'Type', 'master', { master: 'roomType', required: true }),
    f('rooms', 'floor', 'Floor', 'text', { maxLength: 10 }),
    f('rooms', 'capacity', 'Capacity', 'number', { min: 1, max: 20, unit: 'people', defaultValue: 2 }),
    f('rooms', 'status', 'Status', 'master', { master: 'roomStatus', required: true, defaultValue: 'available' }),
    f('rooms', 'equipment', 'Equipment notes', 'longtext', { maxLength: 200, capabilities: { form: true, list: true, export: true } }),
  ],
  relationships: [{ id: 'rel_room_appts', label: 'Bookings', resource: 'appointments', foreignKey: 'roomId' }],
  form: {
    quickCreate: ['name', 'roomType', 'floor', 'status'],
    sections: [{ id: 'main', title: 'Room', fields: ['name', 'roomType', 'floor', 'capacity', 'status', 'equipment'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_rooms_all',
      resource: 'rooms',
      name: 'All rooms',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'name', dir: 'asc' }],
      columns: ['name', 'roomType', 'floor', 'capacity', 'status', 'equipment'].map((key) => ({ key })),
    },
  ]),
};

export const invoices: ResourceDefinition = {
  id: 'res_invoices',
  key: 'invoices',
  module: 'billing',
  label: 'Invoice',
  labelPlural: 'Invoices',
  icon: 'receipt',
  version: 1,
  idPrefix: 'INV',
  titleField: 'id',
  subtitleFields: ['patientId', 'status'],
  description: 'Patient invoices. Payments are recorded manually — no card or payer processing exists in this prototype.',
  status: 'published',
  fields: [
    f('invoices', 'patientId', 'Patient', 'relation', { required: true, relation: { resource: 'patients' }, capabilities: ALL, width: 200 }),
    f('invoices', 'appointmentId', 'Appointment', 'relation', {
      relation: { resource: 'appointments', filterBy: { field: 'patientId', fromField: 'patientId' } },
      help: 'Only appointments for the selected patient are listed.',
    }),
    f('invoices', 'payer', 'Payer', 'master', { master: 'payer', required: true, defaultValue: 'self_pay' }),
    f('invoices', 'issueDate', 'Issue date', 'date', { required: true }),
    f('invoices', 'dueDate', 'Due date', 'date', {
      required: true,
      compare: { op: 'gte', field: 'issueDate', message: 'Due date must be on or after the issue date' },
    }),
    f('invoices', 'lineItems', 'Line items', 'lineitems', {
      required: true,
      sensitivity: 'financial',
      capabilities: { form: true },
      lineItemColumns: [
        { key: 'serviceCode', label: 'Service', type: 'master', master: 'serviceCode', required: true },
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'qty', label: 'Qty', type: 'number', required: true, min: 1 },
        { key: 'unitPrice', label: 'Unit price', type: 'money', required: true, min: 0 },
      ],
    }),
    f('invoices', 'total', 'Total', 'money', { sensitivity: 'financial', currency: 'USD', readOnly: true, computed: lineTotal, width: 120 }),
    f('invoices', 'amountPaid', 'Paid', 'money', { sensitivity: 'financial', currency: 'USD', readOnly: true, defaultValue: 0, width: 110 }),
    f('invoices', 'balance', 'Balance', 'money', {
      sensitivity: 'financial',
      currency: 'USD',
      readOnly: true,
      computed: (r) => (['void', 'written_off'].includes(String(r.status)) ? 0 : lineTotal(r) - (Number(r.amountPaid) || 0)),
      width: 120,
    }),
    f('invoices', 'paidRatio', 'Collected', 'progress', {
      sensitivity: 'financial',
      readOnly: true,
      computed: (r) => {
        const t = lineTotal(r);
        return t ? Math.min(1, (Number(r.amountPaid) || 0) / t) : 0;
      },
      capabilities: { list: true },
    }),
    f('invoices', 'status', 'Status', 'master', { master: 'invoiceStatus', readOnly: true, width: 150 }),
    f('invoices', 'notes', 'Notes', 'longtext', { maxLength: 300, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'draft',
    terminal: ['paid', 'void', 'written_off'],
    transitions: [
      { from: ['draft'], to: 'issued', action: 'Issue invoice' },
      { from: ['draft', 'issued'], to: 'void', action: 'Void', capability: 'billing.void', confirm: 'Void this invoice? This cannot be undone.' },
    ],
  },
  form: {
    quickCreate: ['patientId', 'payer', 'issueDate', 'dueDate'],
    sections: [
      { id: 'who', title: 'Billing details', fields: ['patientId', 'appointmentId', 'payer', 'issueDate', 'dueDate'], columns: 2 },
      { id: 'items', title: 'Line items', fields: ['lineItems'], columns: 1 },
      { id: 'notes', title: 'Notes', fields: ['notes'], columns: 1 },
    ],
  },
  views: views([
    {
      id: 'v_inv_open',
      resource: 'invoices',
      name: 'Open balances',
      type: 'table',
      filter: group('or', [cond('status', 'eq', 'issued'), cond('status', 'eq', 'partially_paid')]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: ['id', 'patientId', 'issueDate', 'dueDate', 'total', 'amountPaid', 'balance', 'paidRatio', 'status'].map((key) => ({ key })),
    },
    {
      id: 'v_inv_overdue',
      resource: 'invoices',
      name: 'Overdue',
      type: 'table',
      filter: group('and', [cond('dueDate', 'past'), group('or', [cond('status', 'eq', 'issued'), cond('status', 'eq', 'partially_paid')])]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: ['id', 'patientId', 'payer', 'dueDate', 'balance', 'status'].map((key) => ({ key })),
    },
    {
      id: 'v_inv_all',
      resource: 'invoices',
      name: 'All invoices',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'issueDate', dir: 'desc' }],
      columns: ['id', 'patientId', 'payer', 'issueDate', 'dueDate', 'total', 'balance', 'status'].map((key) => ({ key })),
    },
  ]),
};

export const referrals: ResourceDefinition = {
  id: 'res_referrals',
  key: 'referrals',
  module: 'work',
  label: 'Referral',
  labelPlural: 'Referral queue',
  icon: 'send',
  version: 1,
  idPrefix: 'RF',
  titleField: 'patientId',
  subtitleFields: ['specialty', 'status'],
  description: 'Outbound referral coordination queue (administrative booking only).',
  status: 'published',
  fields: [
    f('referrals', 'patientId', 'Patient', 'relation', { required: true, relation: { resource: 'patients' }, capabilities: ALL, width: 200 }),
    f('referrals', 'specialty', 'Specialty', 'master', { master: 'specialty', required: true }),
    f('referrals', 'service', 'Service', 'master', { master: 'referralService', masterParentField: 'specialty', required: true, width: 180 }),
    f('referrals', 'urgency', 'Urgency', 'master', { master: 'urgency', required: true, defaultValue: 'routine' }),
    f('referrals', 'status', 'Status', 'master', { master: 'referralStatus', readOnly: true }),
    f('referrals', 'referredTo', 'Receiving organization', 'text', { maxLength: 80, capabilities: ALL, width: 200 }),
    f('referrals', 'assigneeId', 'Coordinator', 'relation', { relation: { resource: 'staff' } }),
    f('referrals', 'dueBy', 'Book by', 'date', { required: true }),
    f('referrals', 'notes', 'Referral notes', 'longtext', { sensitivity: 'health', maxLength: 400, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'received',
    terminal: ['closed', 'declined'],
    transitions: [
      { from: ['received'], to: 'in_review', action: 'Start review' },
      { from: ['in_review'], to: 'scheduled', action: 'Mark booked' },
      { from: ['in_review', 'received'], to: 'declined', action: 'Decline', confirm: 'Decline this referral?' },
      { from: ['scheduled'], to: 'closed', action: 'Close' },
    ],
  },
  form: {
    quickCreate: ['patientId', 'specialty', 'service', 'urgency', 'dueBy'],
    sections: [
      { id: 'main', title: 'Referral', fields: ['patientId', 'specialty', 'service', 'urgency', 'referredTo', 'assigneeId', 'dueBy'], columns: 2 },
      { id: 'restricted', title: 'Restricted', fields: ['notes'], columns: 1 },
    ],
  },
  views: views([
    {
      id: 'v_ref_board',
      resource: 'referrals',
      name: 'Queue board',
      type: 'board',
      boardField: 'status',
      filter: group('and'),
      sort: [{ field: 'dueBy', dir: 'asc' }],
      columns: ['patientId', 'service', 'urgency', 'dueBy', 'assigneeId'].map((key) => ({ key })),
    },
    {
      id: 'v_ref_open',
      resource: 'referrals',
      name: 'Open',
      type: 'table',
      filter: group('or', [cond('status', 'eq', 'received'), cond('status', 'eq', 'in_review')]),
      sort: [{ field: 'dueBy', dir: 'asc' }],
      columns: ['patientId', 'specialty', 'service', 'urgency', 'dueBy', 'assigneeId', 'status'].map((key) => ({ key })),
    },
    {
      id: 'v_ref_all',
      resource: 'referrals',
      name: 'All',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'dueBy', dir: 'desc' }],
      columns: ['patientId', 'specialty', 'service', 'urgency', 'referredTo', 'dueBy', 'status'].map((key) => ({ key })),
    },
  ]),
};

export const tasks: ResourceDefinition = {
  id: 'res_tasks',
  key: 'tasks',
  module: 'work',
  label: 'Task',
  labelPlural: 'Tasks',
  icon: 'check-square',
  version: 1,
  idPrefix: 'T',
  titleField: 'title',
  subtitleFields: ['assigneeId', 'status'],
  description: 'Operational work items. Completing a task never approves a workflow request.',
  status: 'published',
  fields: [
    // subFields / display: 'person' only take effect in multi-line views (the "Team view" option)
    f('tasks', 'cover', 'Image', 'image', { capabilities: { list: false, form: true } }),
    // Team view: 3 lines → image section + title / due / priority; 2 lines → title / due (no image)
    f('tasks', 'title', 'Title', 'text', { required: true, maxLength: 120, capabilities: ALL, width: 320, subFields: ['dueDate', 'priority'], leadingImage: 'cover', leadingImageMinLines: 3 }),
    f('tasks', 'assigneeId', 'Assignee', 'relation', { relation: { resource: 'staff' }, required: true, width: 180, display: 'person', personSubtitle: 'staffRole' }),
    f('tasks', 'collaboratorIds', 'Team', 'people', { relation: { resource: 'staff' }, width: 150, personSubtitle: 'staffRole', capabilities: { list: true, form: true, export: true } }),
    f('tasks', 'dueDate', 'Due', 'date', { required: true }),
    f('tasks', 'priority', 'Priority', 'master', { master: 'priority', required: true, defaultValue: 'normal' }),
    f('tasks', 'status', 'Status', 'master', { master: 'taskStatus', readOnly: true }),
    f('tasks', 'relatedLabel', 'Related to', 'text', { readOnly: true, capabilities: { list: true, search: true } }),
    f('tasks', 'description', 'Description', 'longtext', { maxLength: 500, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'todo',
    terminal: [],
    transitions: [
      { from: ['todo', 'blocked'], to: 'in_progress', action: 'Start' },
      { from: ['in_progress'], to: 'blocked', action: 'Mark blocked' },
      { from: ['todo', 'in_progress', 'blocked'], to: 'done', action: 'Complete' },
      { from: ['done'], to: 'todo', action: 'Reopen' },
    ],
  },
  form: {
    quickCreate: ['title', 'assigneeId', 'dueDate', 'priority'],
    sections: [{ id: 'main', title: 'Task', fields: ['title', 'assigneeId', 'dueDate', 'priority', 'description'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_tasks_open',
      resource: 'tasks',
      name: 'Open',
      type: 'table',
      filter: group('and', [cond('status', 'neq', 'done')]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: ['title', 'assigneeId', 'dueDate', 'priority', 'status', 'relatedLabel'].map((key) => ({ key })),
    },
    {
      // New option: rich rows — 3-line and 2-line cells in the same row, people as avatars with a hover card
      id: 'v_tasks_team',
      resource: 'tasks',
      name: 'Team view',
      type: 'table',
      filter: group('and', [cond('status', 'neq', 'done')]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      rowLines: 3,
      // Title = 3 lines (title / due / priority), Assignee = 2 lines (person / role), Team = avatars + card
      columns: ['title', 'assigneeId', 'collaboratorIds', 'status'].map((key) => ({ key })),
    },
    {
      id: 'v_tasks_board',
      resource: 'tasks',
      name: 'Board',
      type: 'board',
      boardField: 'status',
      filter: group('and'),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: ['title', 'assigneeId', 'dueDate', 'priority'].map((key) => ({ key })),
    },
    {
      id: 'v_tasks_all',
      resource: 'tasks',
      name: 'All',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'dueDate', dir: 'desc' }],
      columns: ['title', 'assigneeId', 'dueDate', 'priority', 'status', 'relatedLabel'].map((key) => ({ key })),
    },
  ]),
};

export const clinicResources: ResourceDefinition[] = [patients, appointments, staff, rooms, invoices, referrals, tasks];
