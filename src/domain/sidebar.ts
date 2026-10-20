import type { ModuleDefinition } from '../metadata/types';
import { L } from '../constants/labels';
import { ROUTES } from '../constants/routes';

type PageId = keyof typeof L.nav.pages;
type ModuleId = keyof typeof L.nav.modules;

interface PageEntry {
  id: PageId;
  icon: string;
  /** Defaults to ROUTES[id]. */
  path?: string;
  capability?: string;
}

interface Group {
  id: ModuleId;
  icon: string;
  /** Resource keys; each shows its saved views underneath. */
  resources: string[];
  pages: PageEntry[];
}

/**
 * The sidebar (docs/GLOSSARY.md §1.1): one module per BRD §4 module, in BRD order, Dashboard first.
 * Module ids stay stable; labels come from src/constants/labels.ts, paths from src/constants/routes.ts.
 * Every module icon is different (owner rule: never repeat an icon in the rail).
 */
const SIDEBAR: Group[] = [
  {
    id: 'home',
    icon: 'layout-dashboard',
    resources: ['tasks', 'activities', 'calendarEvents'],
    pages: [
      { id: 'dashboard', icon: 'home' },
      { id: 'notifications', icon: 'inbox' },
      { id: 'calendar', icon: 'calendar' },
    ],
  },
  {
    id: 'customers',
    icon: 'building',
    resources: ['customers', 'contacts', 'addresses'],
    pages: [
      { id: 'contactPool', icon: 'users', capability: 'read:contacts' },
      { id: 'contactPoolImport', icon: 'arrow-up', capability: 'create:contacts' },
    ],
  },
  {
    id: 'leads',
    icon: 'target',
    resources: ['leads'],
    pages: [
      { id: 'salesWorkspace', icon: 'target', path: '/sales', capability: 'read:leads' },
      { id: 'notAttendedLeads', icon: 'alert', capability: 'read:leads' },
      { id: 'followUps', icon: 'calendar-clock' },
      { id: 'importLeads', icon: 'download', capability: 'leads.import+create:leads' },
    ],
  },
  {
    id: 'opportunities',
    icon: 'handshake',
    resources: ['opportunities', 'demos', 'sampleRequests', 'demoMachines'],
    pages: [
      { id: 'pipeline', icon: 'board', capability: 'read:opportunities' },
      { id: 'salesForecast', icon: 'gauge', capability: 'read:opportunities' },
      { id: 'demoMachineCalendar', icon: 'calendar-days', capability: 'read:demoMachines' },
    ],
  },
  {
    id: 'quotations',
    icon: 'file-text',
    resources: ['quotations'],
    pages: [{ id: 'quotationPendingApprovals', icon: 'check-square', capability: 'read:quotations' }],
  },
  {
    id: 'orders',
    icon: 'shopping-cart',
    resources: ['salesOrders', 'salesContracts'],
    pages: [
      { id: 'paymentSchedule', icon: 'calendar-clock', capability: 'read:paymentMilestones' },
      { id: 'orderProcessing', icon: 'sliders', capability: 'read:salesOrders' },
    ],
  },
  {
    id: 'dispatch',
    icon: 'truck',
    resources: ['dispatches', 'installations', 'trainingRecords'],
    pages: [],
  },
  {
    id: 'installed',
    icon: 'printer',
    resources: ['machines', 'warranties', 'amcContracts', 'machineComponents', 'machineReadings', 'machineMoves'],
    pages: [{ id: 'renewalPipeline', icon: 'reset', capability: 'read:amcContracts' }],
  },
  {
    id: 'service',
    icon: 'wrench',
    resources: ['tickets', 'serviceVisits'],
    pages: [
      { id: 'engineerCalendar', icon: 'map-pin', capability: 'ticket.assign' },
      { id: 'myJobs', icon: 'check-square', capability: 'service.field' },
      { id: 'pmSchedule', icon: 'calendar-clock' },
      { id: 'knowledgeBase', icon: 'notebook' },
    ],
  },
  {
    id: 'spares',
    icon: 'package',
    resources: ['spareParts', 'requisitions', 'warrantyClaims'],
    pages: [
      { id: 'mainStoreStock', icon: 'archive', capability: 'spares.stock' },
      { id: 'engineerStock', icon: 'users', capability: 'spares.engineerStock' },
      { id: 'minimumLevelAlerts', icon: 'alert', capability: 'spares.stock' },
    ],
  },
  {
    id: 'consumables',
    icon: 'droplet',
    resources: ['rateContracts', 'sampleDispatches'],
    pages: [
      { id: 'repeatOrders', icon: 'reset', capability: 'consumables.view' },
      { id: 'leakageList', icon: 'droplet', capability: 'consumables.view' },
      { id: 'reorderPrediction', icon: 'calendar-clock', capability: 'consumables.view' },
      { id: 'dealerOrders', icon: 'building', capability: 'consumables.view' },
    ],
  },
  {
    id: 'field',
    icon: 'map-pin',
    resources: ['fieldVisits', 'beatPlans', 'regularisations', 'expenseClaims', 'leaves'],
    pages: [
      { id: 'attendance', icon: 'calendar-clock' },
      { id: 'teamAttendance', icon: 'users' },
      { id: 'exceptionDashboard', icon: 'alert' },
      { id: 'routeMap', icon: 'map-pin' },
      { id: 'payrollExport', icon: 'download', capability: 'expense.export' },
    ],
  },
  {
    id: 'targets',
    icon: 'trophy',
    resources: ['targets'],
    pages: [
      { id: 'targetVsActual', icon: 'activity', capability: 'read:targets' },
      { id: 'activityScorecard', icon: 'check-square', capability: 'read:targets' },
      { id: 'leaderboards', icon: 'star', capability: 'read:targets' },
    ],
  },
  {
    id: 'reports',
    icon: 'bar-chart',
    resources: [],
    pages: [
      { id: 'reports', icon: 'list' },
      { id: 'reportKpis', icon: 'activity', path: '/reports/kpis' },
      { id: 'reportCustomers', icon: 'building', path: '/reports/customers' },
      { id: 'reportLeads', icon: 'target', path: '/reports/leads' },
      { id: 'reportQuotations', icon: 'file-text', path: '/reports/quotations' },
      { id: 'reportSalesOrders', icon: 'shopping-cart', path: '/reports/sales-orders' },
      { id: 'reportInstalledBase', icon: 'printer', path: '/reports/installed-base' },
      { id: 'reportService', icon: 'wrench', path: '/reports/service' },
      { id: 'reportFieldForce', icon: 'map-pin', path: '/reports/field-force' },
    ],
  },
  {
    id: 'admin',
    icon: 'settings',
    resources: ['employees', 'products', 'priceLists', 'priceListItems', 'termsTemplates', 'assignmentRules', 'leadScoringRules', 'notificationTemplates'],
    pages: [
      { id: 'profile', icon: 'palette' },
      { id: 'notificationPreferences', icon: 'bell' },
      { id: 'security', icon: 'lock' },
      { id: 'dataProtection', icon: 'shield' },
      { id: 'organisationHierarchy', icon: 'building', capability: 'org.view' },
      { id: 'rolesPermissions', icon: 'shield', capability: 'access.view' },
      { id: 'masters', icon: 'blocks', capability: 'config.publish' },
      { id: 'customFields', icon: 'columns', capability: 'config.publish' },
      { id: 'workflows', icon: 'sliders', capability: 'config.publish' },
      { id: 'slaMatrix', icon: 'calendar-clock', capability: 'config.publish' },
      { id: 'configurableRules', icon: 'check-square', capability: 'config.publish' },
      { id: 'bulkImportExport', icon: 'download', capability: 'data.export' },
      { id: 'duplicateMerge', icon: 'copy', capability: 'customers.merge' },
      { id: 'ownershipTransfer', icon: 'users', capability: 'customers.transfer' },
      { id: 'integrations', icon: 'activity', capability: 'integrations.manage' },
      { id: 'auditTrail', icon: 'scroll-text', capability: 'audit.view' },
      { id: 'recycleBin', icon: 'trash', capability: 'recycle.manage' },
      { id: 'sentMessages', icon: 'send', capability: 'outbox.view' },
      { id: 'demoSettings', icon: 'palette' },
      { id: 'componentGallery', icon: 'blocks', capability: 'demo.settings' },
    ],
  },
];

/**
 * Resources whose list is served by a page instead of a sidebar group (the list URL redirects there).
 * Their record pages (/<slug>/:id) still belong to the page's module for highlighting and reachability.
 */
export const RESOURCE_PAGES: Record<string, { module: ModuleId; path: string }> = {
  pmVisits: { module: 'service', path: ROUTES.pmSchedule },
  knowledgeArticles: { module: 'service', path: ROUTES.knowledgeBase },
  paymentMilestones: { module: 'orders', path: ROUTES.paymentSchedule },
};

/** Sidebar modules in the engine's ModuleDefinition shape. */
const WORKSPACES: { id: ModuleId; label: string; members: ModuleId[]; sectioned?: boolean }[] = [
  { id: 'home', label: 'My Work', members: ['home'] },
  { id: 'customers', label: 'Customers', members: ['customers'] },
  // Sales is long (4 BRD modules): one collapsible section per module, no per-view rows (views are tabs on the page).
  { id: 'leads', label: 'Sales', members: ['leads', 'opportunities', 'quotations', 'consumables'], sectioned: true },
  { id: 'orders', label: 'Orders & Delivery', members: ['orders', 'dispatch'] },
  { id: 'installed', label: 'Machines & Service', members: ['installed', 'service', 'spares'] },
  { id: 'field', label: 'Field Team', members: ['field'] },
  { id: 'targets', label: 'Performance', members: ['targets', 'reports'] },
  { id: 'admin', label: 'Settings', members: ['admin'] },
];
export const workspaceForModule = (id: string) => WORKSPACES.find((w) => w.members.includes(id as ModuleId))?.id ?? id;

export const sidebarModules: ModuleDefinition[] = WORKSPACES.map((workspace) => {
  const members = SIDEBAR.filter((g) => workspace.members.includes(g.id));
  const sections = workspace.sectioned
    ? members.map((g) => ({ id: g.id, label: (L.nav.modules[g.id] as { title: string; nav?: string }).nav ?? L.nav.modules[g.id].title, icon: g.icon, resources: g.resources, pages: g.pages.map((p) => p.id as string) }))
    : undefined;
  return { ...members[0], label: workspace.label, resources: members.flatMap((g) => g.resources), pages: members.flatMap((g) => g.pages), sections };
}).map((g) => ({
  id: g.id,
  label: g.label,
  icon: g.icon,
  resources: g.resources,
  pages: g.pages.map((p) => {
    const page = L.nav.pages[p.id] as { title: string; nav?: string };
    return { id: p.id, label: page.nav ?? page.title, icon: p.icon, path: p.path ?? (ROUTES as Record<string, string>)[p.id], capability: p.capability };
  }),
  navChildIcons: [],
  sections: g.sections,
}));

/** Full BRD module name (page title / breadcrumb) for a sidebar module id. */
export const moduleTitle = (id: string) => WORKSPACES.find((w) => w.id === workspaceForModule(id))?.label ?? id;
