import type { DomainPack, ModuleDefinition, ResourcePermission, RoleDefinition } from '../../metadata/types';
import { clinicMasters } from './masters';
import { clinicResources } from './resources';

const full: ResourcePermission = { read: 'all', create: true, update: 'all', delete: true, export: true, sensitive_data: true };
const readOnly: ResourcePermission = { read: 'all', create: false, update: 'none', delete: false, export: false };
const none: ResourcePermission = { read: 'none', create: false, update: 'none', delete: false, export: false };

/**
 * Illustrative demo roles. In a real deployment the organization's policy
 * (enforced by a server-side Authorization Service) supersedes these.
 */
export const clinicRoles: RoleDefinition[] = [
  {
    id: 'practice_manager',
    label: 'Practice manager',
    description: 'Runs the clinic: full operational access, approvals and configuration.',
    resources: {
      patients: full,
      appointments: full,
      staff: full,
      rooms: full,
      invoices: full,
      referrals: full,
      tasks: full,
    },
    sensitivity: { identifier: 'edit', health: 'view', financial: 'edit' },
    capabilities: [
      'config.publish',
      'audit.view',
      'events.view',
      'access.view',
      'approve.writeoff',
      'schedule.override',
      'views.share.org',
      'views.share.team',
      'billing.void',
      'billing.payment',
      'billing.writeoff.request',
    ],
  },
  {
    id: 'front_desk',
    label: 'Front desk',
    description: 'Registers patients and books, confirms and checks in appointments.',
    resources: {
      patients: { read: 'all', create: true, update: 'all', delete: false, export: false, sensitive_data: true },
      appointments: { read: 'all', create: true, update: 'all', delete: false, export: false, sensitive_data: true },
      staff: { ...readOnly, sensitive_data: true },
      rooms: readOnly,
      invoices: readOnly,
      referrals: { read: 'all', create: true, update: 'all', delete: false, export: false },
      tasks: { read: 'all', create: true, update: 'all', delete: false, export: false },
    },
    sensitivity: { identifier: 'edit', health: 'hide', financial: 'view' },
    capabilities: ['views.share.team', 'billing.payment'],
  },
  {
    id: 'clinician',
    label: 'Clinician',
    description: 'Sees own schedule, starts and completes visits. No billing access.',
    resources: {
      patients: { read: 'all', create: false, update: 'all', delete: false, export: false, sensitive_data: false },
      appointments: { read: 'own', create: false, update: 'own', delete: false, export: false, sensitive_data: false },
      staff: { ...readOnly, sensitive_data: true },
      rooms: readOnly,
      invoices: none,
      referrals: { read: 'all', create: true, update: 'all', delete: false, export: false },
      tasks: { read: 'all', create: true, update: 'all', delete: false, export: false },
    },
    sensitivity: { identifier: 'mask', health: 'edit', financial: 'hide' },
    fieldOverrides: { 'patients.fullName': 'view', 'patients.status': 'view', 'patients.payer': 'view', 'patients.dateOfBirth': 'view' },
    capabilities: ['visit.manage'],
  },
  {
    id: 'billing',
    label: 'Billing specialist',
    description: 'Issues invoices, records manual payments, requests write-offs.',
    resources: {
      patients: { read: 'all', create: false, update: 'none', delete: false, export: false, sensitive_data: false },
      appointments: { ...readOnly, sensitive_data: false },
      staff: readOnly,
      rooms: none,
      invoices: { read: 'all', create: true, update: 'all', delete: false, export: true },
      referrals: none,
      tasks: { read: 'all', create: true, update: 'all', delete: false, export: false },
    },
    sensitivity: { identifier: 'view', health: 'hide', financial: 'edit' },
    capabilities: ['billing.payment', 'billing.writeoff.request', 'billing.void', 'views.share.team'],
  },
];

export interface DemoUser {
  id: string;
  name: string;
  roleId: string;
  /** Linked staff record per workspace (for "own" row scope). */
  staffIds: Record<string, string>;
  initials: string;
}

export const demoUsers: DemoUser[] = [
  { id: 'u_morgan', name: 'Morgan Ellis', roleId: 'practice_manager', staffIds: { riverside: 'S-1001', hillcrest: 'S-2001' }, initials: 'ME' },
  { id: 'u_jordan', name: 'Jordan Reyes', roleId: 'front_desk', staffIds: { riverside: 'S-1002', hillcrest: 'S-2002' }, initials: 'JR' },
  { id: 'u_amara', name: 'Dr. Amara Osei', roleId: 'clinician', staffIds: { riverside: 'S-1003', hillcrest: 'S-2003' }, initials: 'AO' },
  { id: 'u_sam', name: 'Sam Whitfield', roleId: 'billing', staffIds: { riverside: 'S-1004', hillcrest: 'S-2004' }, initials: 'SW' },
];

export const organization = { id: 'org_northwind', slug: 'northwind', name: 'Northwind Health Partners' };

export const workspaces = [
  { id: 'riverside', slug: 'riverside', name: 'Riverside Clinic', timezoneLabel: 'Clinic local time' },
  { id: 'hillcrest', slug: 'hillcrest', name: 'Hillcrest Clinic', timezoneLabel: 'Clinic local time' },
];

export const clinicModules: ModuleDefinition[] = [
  { id: 'home', label: 'Home', icon: 'home', resources: [], pages: [{ id: 'dashboard', label: 'Overview', icon: 'layout-dashboard', path: 'dashboard' }] },
  {
    id: 'scheduling',
    label: 'Scheduling',
    icon: 'calendar',
    resources: ['appointments'],
    pages: [{ id: 'schedule', label: 'Day schedule', icon: 'calendar-clock', path: 'schedule' }],
  },
  { id: 'patients', label: 'Patients', icon: 'users', resources: ['patients'] },
  { id: 'billing', label: 'Billing', icon: 'receipt', resources: ['invoices'], navChildIcons: ['invoices'] }, // example of a group WITH child icons
  { id: 'work', label: 'Work', icon: 'check-square', resources: ['tasks', 'referrals'], pages: [{ id: 'inbox', label: 'Work inbox', icon: 'inbox', path: 'inbox' }] },
  { id: 'resources', label: 'Staff & rooms', icon: 'id-card', resources: ['staff', 'rooms'] },
  {
    id: 'admin',
    label: 'Administration',
    icon: 'settings',
    resources: [],
    pages: [
      { id: 'studio', label: 'Configuration studio', icon: 'blocks', path: 'studio', capability: 'config.publish' },
      { id: 'access', label: 'Roles & access', icon: 'shield', path: 'access', capability: 'access.view' },
      { id: 'audit', label: 'Audit log', icon: 'scroll-text', path: 'audit', capability: 'audit.view' },
      { id: 'events', label: 'Event trace', icon: 'activity', path: 'events', capability: 'events.view' },
      { id: 'settings', label: 'Settings', icon: 'sliders', path: 'settings' },
    ],
  },
];

export const clinicPack: DomainPack = {
  id: 'healthcare-operations',
  version: '1.0.0',
  label: 'Clinic operations',
  description: 'Administrative outpatient clinic operations: scheduling, registry, billing, referrals and work. No clinical decision support.',
  modules: clinicModules,
  resources: clinicResources,
  masters: clinicMasters,
  roles: clinicRoles,
};
