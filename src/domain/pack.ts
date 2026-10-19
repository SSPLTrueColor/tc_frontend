// Must stay the first statement: module packs import `p` from here while this file is still loading.
export { p } from './modules/types';
import { p } from './modules/types';
import type { DomainPack, ModuleDefinition, RoleDefinition } from '../metadata/types';
import { appMasters } from './masters';
import { appResources } from './resources/index';
import type { ModulePack } from './modules/types';
import { catalogPack } from './modules/catalog';
import { customersPack } from './modules/customers';
import { leadsPack } from './modules/leads';
import { opportunitiesPack } from './modules/opportunities';
import { quotationsPack } from './modules/quotations';
import { ordersPack } from './modules/orders';
import { installedPack } from './modules/installed';
import { servicePack } from './modules/service';
import { sparesPack } from './modules/spares';
import { fieldPack } from './modules/field';
import { reportsPack } from './modules/reports';

/** Business modules in navigation order (REQUIREMENTS §3). */
export const MODULE_PACKS: ModulePack[] = [customersPack, leadsPack, opportunitiesPack, quotationsPack, ordersPack, installedPack, servicePack, sparesPack, catalogPack, fieldPack, reportsPack];

const NONE = p('none');

/**
 * Demo roles — the proposed matrix in docs/REQUIREMENTS.md §2.2 (BRD Appendix B is blank).
 * Row scopes follow the reporting hierarchy: own → team → division → all.
 * The browser enforces these as a model of server rules, not as a security boundary.
 */
const baseRoles: RoleDefinition[] = [
  {
    id: 'admin',
    label: 'System administrator',
    description: 'CRM admin (IT/MIS): full access, users, masters, workflows and configuration.',
    resources: { employees: p('all', 'all', true, true, true), tasks: p('all', 'all', true, true, true), activities: p('all', 'all', true, true, true) },
    sensitivity: { identifier: 'edit', health: 'hide', financial: 'edit' },
    capabilities: ['config.publish', 'audit.view', 'events.view', 'access.view', 'demo.settings', 'recycle.manage', 'users.manage', 'views.share.org', 'views.share.team', 'outbox.view'],
  },
  {
    id: 'management',
    label: 'Management',
    description: 'MD, Chairman, CFO & Director: company-wide visibility and final approvals.',
    resources: { employees: p('all'), tasks: p('all', 'all', true, false, true), activities: p('all', 'all', true, false, true) },
    sensitivity: { identifier: 'view', health: 'hide', financial: 'view' },
    capabilities: ['audit.view', 'access.view', 'approve.l3', 'views.share.org', 'views.share.team', 'outbox.view'],
  },
  {
    id: 'division_head',
    label: 'Division head',
    description: 'GM / VP / Head of a division: everything in their division, level-2 approvals.',
    resources: { employees: p('all'), tasks: p('division', 'division', true, false, true), activities: p('division', 'division', true, false, true) },
    sensitivity: { identifier: 'view', health: 'hide', financial: 'hide' },
    capabilities: ['approve.l2', 'views.share.org', 'views.share.team'],
  },
  {
    id: 'sales_manager',
    label: 'Sales manager',
    description: 'Regional / national sales managers: own and team records, level-1 approvals.',
    resources: { employees: p('all'), tasks: p('team', 'team', true, false, true), activities: p('team', 'team', true, false, true) },
    sensitivity: { identifier: 'view', health: 'hide', financial: 'hide' },
    capabilities: ['approve.l1', 'views.share.team'],
  },
  {
    id: 'sales_exec',
    label: 'Sales executive',
    description: 'Ink, Paper, Fabric and Textile sales: own records only.',
    resources: { employees: p('all'), tasks: p('own', 'own', true), activities: p('own', 'own', true) },
    sensitivity: { identifier: 'view', health: 'hide', financial: 'hide' },
    capabilities: [],
  },
  {
    id: 'service_head',
    label: 'Service leadership',
    description: 'Service Head, National Service Manager: all service work, service approvals and escalations.',
    resources: { employees: p('all'), tasks: p('team', 'team', true, false, true), activities: p('team', 'team', true, false, true) },
    sensitivity: { identifier: 'view', health: 'hide', financial: 'hide' },
    capabilities: ['approve.l1', 'approve.service', 'views.share.team'],
  },
  {
    id: 'engineer',
    label: 'Service engineer',
    description: 'Field engineers: assigned jobs, own attendance and visits.',
    resources: { employees: p('all'), tasks: p('own', 'own', true), activities: p('own', 'own', true) },
    sensitivity: { identifier: 'view', health: 'hide', financial: 'hide' },
    capabilities: [],
  },
  {
    id: 'coordinator',
    label: 'Coordinator',
    description: 'Service / sales / fabric coordinators: division records, ticket logging and assignment.',
    resources: { employees: p('all'), tasks: p('division', 'division', true), activities: p('division', 'division', true) },
    sensitivity: { identifier: 'view', health: 'hide', financial: 'hide' },
    capabilities: ['views.share.team'],
  },
  {
    id: 'scm',
    label: 'Import / SCM',
    description: 'Import Head and SCM executives: order processing, shipments and spares import.',
    resources: { employees: p('all'), tasks: p('own', 'own', true), activities: p('own', 'own', true) },
    sensitivity: { identifier: 'view', health: 'hide', financial: 'hide' },
    capabilities: [],
  },
  {
    id: 'store',
    label: 'Store in-charge',
    description: 'Main store: spares issue, receipts and returns.',
    resources: { employees: p('all'), tasks: p('own', 'own', true), activities: p('own', 'own', true) },
    sensitivity: { identifier: 'view', health: 'hide', financial: 'hide' },
    capabilities: [],
  },
  {
    id: 'accounts',
    label: 'Accounts',
    description: 'Finance checks on orders, expenses and collections; sees margins.',
    resources: { employees: p('all'), tasks: p('own', 'own', true), activities: p('own', 'own', true) },
    sensitivity: { identifier: 'view', health: 'hide', financial: 'view' },
    capabilities: ['approve.finance'],
  },
  {
    id: 'profiling',
    label: 'Profiling',
    description: 'Profiling Manager: sample print requests and results.',
    resources: { employees: p('all'), tasks: p('own', 'own', true), activities: p('own', 'own', true) },
    sensitivity: { identifier: 'view', health: 'hide', financial: 'hide' },
    capabilities: [],
  },
];

export const NO_ACCESS = NONE;

/** Base roles + every module's permissions, capabilities and field overrides. */
export const appRoles: RoleDefinition[] = baseRoles.map((r) => ({
  ...r,
  resources: Object.assign({}, r.resources, ...MODULE_PACKS.map((m) => m.permissions[r.id] ?? {})),
  capabilities: [...new Set([...r.capabilities, ...MODULE_PACKS.flatMap((m) => m.capabilities?.[r.id] ?? [])])],
  fieldOverrides: Object.assign({}, r.fieldOverrides, ...MODULE_PACKS.map((m) => m.fieldOverrides?.[r.id] ?? {})),
}));

export interface DemoUser {
  id: string;
  name: string;
  roleId: string;
  /** Linked employee record per workspace (drives Own / Team scope). */
  staffIds: Record<string, string>;
  initials: string;
  title: string;
  divisions: string[];
  /** Reporting manager (user id) — seeds the employee hierarchy. */
  managerId?: string;
  territories: string[];
}

const ALL_DIV = ['TX', 'INK', 'POD', 'LBL', 'PPR', 'FAB'];

const u = (n: number, id: string, name: string, roleId: string, title: string, divisions: string[], managerId?: string, territories: string[] = []): DemoUser => ({
  id,
  name,
  roleId,
  staffIds: { tc: `E-${1000 + n}` },
  initials: name
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join(''),
  title,
  divisions,
  managerId,
  territories,
});

/** Fictional demo users (simulated sign-in). Reporting lines mirror BRD §2.1. */
export const demoUsers: DemoUser[] = [
  u(1, 'u_rahul', 'Rahul Mehta', 'admin', 'CRM Administrator (IT/MIS)', ALL_DIV),
  u(2, 'u_vikram', 'Vikram Shah', 'management', 'Managing Director', ALL_DIV),
  u(3, 'u_anjali', 'Anjali Kapoor', 'management', 'CFO & Director', ALL_DIV, 'u_vikram'),
  u(4, 'u_suresh', 'Suresh Iyer', 'division_head', 'GM Sales – Textile', ['TX', 'FAB'], 'u_vikram'),
  u(5, 'u_neha', 'Neha Bansal', 'division_head', 'GM – Ink', ['INK'], 'u_vikram'),
  u(6, 'u_arjun', 'Arjun Malhotra', 'division_head', 'VP – Commercial', ['POD', 'LBL'], 'u_vikram'),
  u(7, 'u_kavita', 'Kavita Rao', 'division_head', 'Head – Paper Division', ['PPR'], 'u_vikram'),
  u(8, 'u_rohan', 'Rohan Desai', 'sales_manager', 'Regional Sales Manager – Textile (West)', ['TX'], 'u_suresh', ['mumbai', 'surat', 'ahmedabad']),
  u(9, 'u_priya', 'Priya Nair', 'sales_manager', 'Sales Manager – POD', ['POD'], 'u_arjun', ['bengaluru', 'chennai']),
  u(10, 'u_imran', 'Imran Qureshi', 'sales_manager', 'Sales Manager – Label', ['LBL'], 'u_arjun', ['delhi_ncr', 'jaipur']),
  u(11, 'u_karan', 'Karan Singh', 'sales_exec', 'Sales Executive – Textile', ['TX'], 'u_rohan', ['surat']),
  u(12, 'u_sneha', 'Sneha Kulkarni', 'sales_exec', 'Sales Executive – Ink', ['INK'], 'u_neha', ['mumbai', 'pune']),
  u(13, 'u_deepak', 'Deepak Yadav', 'sales_exec', 'Sales Executive – Paper', ['PPR'], 'u_kavita', ['delhi_ncr']),
  u(14, 'u_pooja', 'Pooja Joshi', 'sales_exec', 'Sales Executive – Fabric', ['FAB'], 'u_suresh', ['tiruppur']),
  u(15, 'u_manoj', 'Manoj Pillai', 'service_head', 'Service Head', ALL_DIV, 'u_vikram'),
  u(16, 'u_sanjay', 'Sanjay Verma', 'service_head', 'National Service Manager', ['TX', 'POD', 'LBL'], 'u_manoj'),
  u(17, 'u_ravi', 'Ravi Kumar', 'engineer', 'Service Engineer – Textile', ['TX'], 'u_sanjay', ['surat', 'ahmedabad']),
  u(18, 'u_ajay', 'Ajay Chauhan', 'engineer', 'Service Engineer – Textile', ['TX'], 'u_sanjay', ['ludhiana', 'delhi_ncr']),
  u(19, 'u_lakshmi', 'Lakshmi Menon', 'engineer', 'Service Engineer – Textile', ['TX'], 'u_sanjay', ['tiruppur', 'chennai']),
  u(20, 'u_farhan', 'Farhan Sheikh', 'engineer', 'Service Engineer – POD', ['POD'], 'u_sanjay', ['mumbai', 'pune']),
  u(21, 'u_ganesh', 'Ganesh Naidu', 'engineer', 'Service Engineer – Label', ['LBL'], 'u_sanjay', ['hyderabad', 'bengaluru']),
  u(22, 'u_meera', 'Meera Iyer', 'coordinator', 'Service Coordinator', ['TX', 'POD', 'LBL'], 'u_manoj'),
  u(23, 'u_nisha', 'Nisha Gupta', 'coordinator', 'Fabric Coordinator', ['FAB'], 'u_suresh'),
  u(24, 'u_rajesh', 'Rajesh Agarwal', 'scm', 'Import Head', ALL_DIV, 'u_anjali'),
  u(25, 'u_prakash', 'Prakash Jadhav', 'store', 'Store In-charge', ALL_DIV, 'u_rajesh'),
  u(26, 'u_swati', 'Swati Deshmukh', 'accounts', 'Accounts Manager', ALL_DIV, 'u_anjali'),
  u(27, 'u_tanvi', 'Tanvi Shah', 'profiling', 'Profiling Manager', ['TX', 'FAB'], 'u_suresh'),
];

export const organization = { id: 'org_truecolors', slug: 'truecolors', name: 'True Colors Limited', shortName: 'True Colors', monogram: 'TC' };

/** Single workspace: the engine supports several, True Colors runs one company-wide. */
export const workspaces = [{ id: 'tc', slug: 'tc', name: 'True Colors', timezoneLabel: 'IST' }];

/** Roles whose sign-in asks for a one-time code (NFR-07, simulated). */
export const MFA_ROLES = ['admin', 'management'];

const coreModules: ModuleDefinition[] = [
  {
    id: 'home',
    label: 'Home',
    icon: 'home',
    resources: ['tasks', 'activities'],
    pages: [
      { id: 'dashboard', label: 'Overview', icon: 'layout-dashboard', path: 'dashboard' },
      { id: 'inbox', label: 'Work inbox', icon: 'inbox', path: 'inbox' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    icon: 'settings',
    resources: ['employees'],
    pages: [
      { id: 'studio', label: 'Configuration studio', icon: 'blocks', path: 'studio', capability: 'config.publish' },
      { id: 'access', label: 'Roles & access', icon: 'shield', path: 'access', capability: 'access.view' },
      { id: 'audit', label: 'Audit log', icon: 'scroll-text', path: 'audit', capability: 'audit.view' },
      { id: 'events', label: 'Event trace', icon: 'activity', path: 'events', capability: 'events.view' },
      { id: 'outbox', label: 'Message outbox', icon: 'send', path: 'outbox', capability: 'outbox.view' },
      { id: 'settings', label: 'Settings', icon: 'sliders', path: 'settings' },
    ],
  },
];

function extendNav(m: ModuleDefinition): ModuleDefinition {
  const ext = MODULE_PACKS.map((x) => x.extend?.[m.id]).filter((x): x is NonNullable<typeof x> => !!x);
  if (!ext.length) return m;
  return { ...m, resources: [...m.resources, ...ext.flatMap((e) => e.resources ?? [])], pages: [...(m.pages ?? []), ...ext.flatMap((e) => e.pages ?? [])] };
}

/** Home first, then business modules in order, Administration last. */
export const appModules: ModuleDefinition[] = [coreModules[0], ...MODULE_PACKS.map((m) => m.nav).filter((x): x is ModuleDefinition => !!x), coreModules[1]].map(extendNav);

export const appPack: DomainPack = {
  id: 'truecolors-crm',
  version: '0.1.0',
  label: 'True Colors CRM',
  description: 'Sales and service CRM for True Colors Limited (frontend simulation prototype).',
  modules: appModules,
  resources: [...appResources, ...MODULE_PACKS.flatMap((m) => m.resources)],
  masters: [...appMasters, ...MODULE_PACKS.flatMap((m) => m.masters)],
  roles: appRoles,
};
