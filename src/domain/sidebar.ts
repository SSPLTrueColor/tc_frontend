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
      { id: 'contactPool', icon: 'users' },
      { id: 'contactPoolImport', icon: 'arrow-up' },
    ],
  },
  {
    id: 'leads',
    icon: 'target',
    resources: ['leads'],
    pages: [
      { id: 'notAttendedLeads', icon: 'alert' },
      { id: 'followUps', icon: 'calendar-clock' },
      { id: 'importLeads', icon: 'download' },
    ],
  },
  {
    id: 'opportunities',
    icon: 'handshake',
    resources: ['opportunities', 'demos', 'sampleRequests', 'demoMachines'],
    pages: [
      { id: 'pipeline', icon: 'board' },
      { id: 'salesForecast', icon: 'activity' },
      { id: 'demoMachineCalendar', icon: 'calendar-days' },
    ],
  },
  {
    id: 'quotations',
    icon: 'file-text',
    resources: ['quotations'],
    pages: [{ id: 'quotationPendingApprovals', icon: 'check-square' }],
  },
  {
    id: 'orders',
    icon: 'shopping-cart',
    resources: ['salesOrders', 'salesContracts'],
    pages: [
      { id: 'paymentSchedule', icon: 'calendar-clock' },
      { id: 'orderProcessing', icon: 'sliders' },
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
    pages: [{ id: 'renewalPipeline', icon: 'reset' }],
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
      { id: 'leakageList', icon: 'activity', capability: 'consumables.view' },
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
      { id: 'targetVsActual', icon: 'activity' },
      { id: 'activityScorecard', icon: 'check-square' },
      { id: 'leaderboards', icon: 'star' },
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
export const sidebarModules: ModuleDefinition[] = SIDEBAR.map((g) => ({
  id: g.id,
  label: L.nav.modules[g.id].nav,
  icon: g.icon,
  resources: g.resources,
  pages: g.pages.map((p) => {
    const page = L.nav.pages[p.id] as { title: string; nav?: string };
    return { id: p.id, label: page.nav ?? page.title, icon: p.icon, path: p.path ?? (ROUTES as Record<string, string>)[p.id], capability: p.capability };
  }),
  navChildIcons: [],
}));

/** Full BRD module name (page title / breadcrumb) for a sidebar module id. */
export const moduleTitle = (id: string) => (L.nav.modules as Record<string, { title: string }>)[id]?.title ?? id;
