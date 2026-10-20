/**
 * Every URL in the app (docs/GLOSSARY.md §1.2). Paths are kebab-case of the BRD name.
 * Links, navigation and route registration read from here; renaming a page is a one-line change.
 * Old paths keep working through LEGACY_REDIRECTS.
 */

/** Resource key (engine id, never shown) → URL slug. Admin-owned resources live under /admin/. */
export const RESOURCE_SLUGS: Record<string, string> = {
  // Dashboard
  tasks: 'tasks',
  activities: 'activity-history',
  calendarEvents: 'calendar-events',
  // Customers & Contacts (4.1)
  customers: 'companies',
  contacts: 'contacts',
  addresses: 'sites',
  // Leads (4.2)
  leads: 'leads',
  // Opportunities & Pipeline (4.3)
  opportunities: 'opportunities',
  demos: 'demos',
  sampleRequests: 'sample-print-requests',
  demoMachines: 'demo-machines',
  // Quotations (4.4)
  quotations: 'quotations',
  // Sales Orders & Contracts (4.5)
  salesOrders: 'sales-orders',
  paymentMilestones: 'payment-schedule',
  salesContracts: 'sales-contracts',
  // Dispatch & Installation (4.6)
  dispatches: 'dispatch-delivery',
  installations: 'installation-jobs',
  trainingRecords: 'training-records',
  // Installed Base & AMC (4.7)
  machines: 'installed-base',
  warranties: 'warranties',
  amcContracts: 'amc-cmc-contracts',
  machineComponents: 'component-serial-numbers',
  machineReadings: 'machine-usage-readings',
  machineMoves: 'resale-relocation-history',
  // Service Tickets (4.8)
  tickets: 'service-tickets',
  serviceVisits: 'site-visits',
  pmVisits: 'pm-visits',
  knowledgeArticles: 'knowledge-articles',
  // Spare Parts (4.9)
  spareParts: 'spare-parts',
  requisitions: 'spares-requisitions',
  warrantyClaims: 'oem-warranty-claims',
  // Consumables (4.10)
  rateContracts: 'rate-contracts',
  sampleDispatches: 'sample-trial-dispatch',
  dealerOrders: 'dealer-orders', // list served by the Dealer / Distributor Orders page
  // Field Force (4.11)
  attendance: 'attendance', // list served by the Attendance page; records at /attendance/:id
  regularisations: 'attendance-regularisation',
  fieldVisits: 'field-visits',
  beatPlans: 'beat-plan',
  expenseClaims: 'expense-claims',
  leaves: 'leave-applications',
  // Targets & Recognition (4.12)
  targets: 'targets',
  // Administration (4.14)
  employees: 'admin/users',
  assignmentRules: 'admin/lead-assignment-rules',
  leadScoringRules: 'admin/lead-scoring-rules',
  notificationTemplates: 'admin/notification-templates',
  termsTemplates: 'admin/terms-templates',
  products: 'admin/products',
  priceLists: 'admin/price-lists',
  priceListItems: 'admin/price-list-items',
};

const SLUG_TO_KEY: Record<string, string> = Object.fromEntries(Object.entries(RESOURCE_SLUGS).map(([k, s]) => [s, k]));

/** URL slug for a resource key (falls back to the key for anything not mapped yet). */
export const slugOf = (resKey: string) => RESOURCE_SLUGS[resKey] ?? resKey;
/** Resource key for a URL slug, or undefined. */
export const keyOfSlug = (slug: string) => SLUG_TO_KEY[slug];

/** Static pages. Patterns use react-router params (`:recordId`); build links with `toPath`. */
export const ROUTES = {
  login: '/login',
  dashboard: '/dashboard',
  calendar: '/calendar',
  notifications: '/notifications',

  // Customers & Contacts (4.1)
  contactPool: '/contact-pool',
  contactPoolImport: '/contact-pool/import',

  // Leads (4.2)
  leadNew: '/leads/new',
  notAttendedLeads: '/not-attended-leads',
  followUps: '/follow-ups',
  importLeads: '/leads/import',

  // Opportunities & Pipeline (4.3)
  pipeline: '/pipeline',
  salesForecast: '/sales-forecast',
  demoMachineCalendar: '/demo-machine-calendar',

  // Quotations (4.4)
  quotationNew: '/quotations/new',
  quotationEdit: '/quotations/:recordId/edit',
  quotationPdf: '/quotations/:recordId/pdf',
  quotationCompare: '/quotations/:recordId/compare',
  quotationPendingApprovals: '/quotations/pending-approvals',

  // Sales Orders & Contracts (4.5)
  salesOrders: '/sales-orders',
  salesOrderNew: '/sales-orders/new',
  salesOrderEdit: '/sales-orders/:recordId/edit',
  salesContractPdf: '/sales-orders/:recordId/contract/pdf',
  paymentSchedule: '/payment-schedule',
  orderProcessing: '/order-processing',

  // Installed Base & AMC (4.7)
  renewalPipeline: '/renewal-pipeline',

  // Service Tickets (4.8)
  engineerCalendar: '/engineer-calendar',
  myJobs: '/my-jobs',
  myJob: '/my-jobs/:recordId',
  pmSchedule: '/pm-schedule',
  knowledgeBase: '/knowledge-base',
  jobCard: '/service-tickets/:recordId/job-card',
  feedback: '/feedback/:token',
  portalLogTicket: '/customer-portal/log-ticket',

  // Spare Parts (4.9)
  mainStoreStock: '/main-store-stock',
  engineerStock: '/engineer-stock',
  minimumLevelAlerts: '/minimum-level-alerts',

  // Consumables (4.10)
  repeatOrders: '/repeat-orders',
  leakageList: '/leakage-list',
  reorderPrediction: '/reorder-prediction',
  dealerOrders: '/dealer-orders',

  // Field Force (4.11)
  attendance: '/attendance',
  teamAttendance: '/team-attendance',
  exceptionDashboard: '/exception-dashboard',
  routeMap: '/route-map',
  routeMapFor: '/route-map/:userId',
  fieldVisits: '/field-visits',
  beatPlan: '/beat-plan',
  expenseClaims: '/expense-claims',
  payrollExport: '/expense-claims/payroll-export',

  // Targets & Recognition (4.12)
  targetVsActual: '/target-vs-actual',
  activityScorecard: '/activity-scorecard',
  leaderboards: '/leaderboards',

  // Reports (4.13)
  reports: '/reports',
  report: '/reports/:reportId',

  // Administration (4.14)
  profile: '/admin/profile',
  notificationPreferences: '/admin/notification-preferences',
  security: '/admin/security',
  dataProtection: '/admin/data-protection',
  organisationHierarchy: '/admin/organisation-hierarchy',
  rolesPermissions: '/admin/roles-permissions',
  masters: '/admin/masters',
  customFields: '/admin/custom-fields',
  workflows: '/admin/workflows',
  slaMatrix: '/admin/sla-matrix',
  configurableRules: '/admin/configurable-rules',
  leadAssignmentRules: '/admin/lead-assignment-rules',
  leadScoringRules: '/admin/lead-scoring-rules',
  notificationTemplates: '/admin/notification-templates',
  bulkImportExport: '/admin/bulk-import-export',
  duplicateMerge: '/admin/duplicate-merge',
  ownershipTransfer: '/admin/ownership-transfer',
  integrations: '/admin/integrations',
  auditTrail: '/admin/audit-trail',
  recycleBin: '/admin/recycle-bin',
  sentMessages: '/admin/sent-messages',
  demoSettings: '/admin/demo-settings',
} as const;

export type RouteId = keyof typeof ROUTES;

/** Fill `:params` in a route pattern: toPath(ROUTES.jobCard, { recordId: 'TKT-1001' }). */
export function toPath(pattern: string, params: Record<string, string> = {}, query?: Record<string, string | undefined>) {
  const path = pattern.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ''));
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined) as [string, string][]).toString() : '';
  return qs ? `${path}?${qs}` : path;
}

/**
 * Old URL → new URL, so bookmarks and stored saved views keep working (GLOSSARY D-10).
 * Patterns may use `:params`; they are copied into the target. Old resource-key URLs
 * (e.g. /salesOrders/SO-1) are redirected generically from RESOURCE_SLUGS, not listed here.
 */
export const LEGACY_REDIRECTS: Record<string, string> = {
  '/inbox': ROUTES.notifications,
  '/contacts/import': ROUTES.contactPoolImport,
  '/opportunities/forecast': ROUTES.salesForecast,
  '/quotations/:recordId/print': ROUTES.quotationPdf,
  '/orders': ROUTES.salesOrders,
  '/orders/new': ROUTES.salesOrderNew,
  '/orders/payments': ROUTES.paymentSchedule,
  '/orders/:recordId/edit': ROUTES.salesOrderEdit,
  '/orders/:recordId/contract/print': ROUTES.salesContractPdf,
  '/salesOrders/:recordId/edit': ROUTES.salesOrderEdit,
  '/renewals': ROUTES.renewalPipeline,
  '/dispatch-board': ROUTES.engineerCalendar,
  '/tickets/:recordId/job-card': ROUTES.jobCard,
  '/portal/new-ticket': ROUTES.portalLogTicket,
  '/spares/stock-alerts': ROUTES.minimumLevelAlerts,
  '/consumables/leakage': ROUTES.leakageList,
  '/consumables/reorders': ROUTES.reorderPrediction,
  '/attendance/team': ROUTES.teamAttendance,
  '/attendance/exceptions': ROUTES.exceptionDashboard,
  '/attendance/:userId/route': ROUTES.routeMapFor,
  '/visits': ROUTES.fieldVisits,
  '/visits/plan': ROUTES.beatPlan,
  '/expenses': ROUTES.expenseClaims,
  '/expenseClaims/payroll-export': ROUTES.payrollExport,
  '/targets/achievement': ROUTES.targetVsActual,
  '/scorecard': ROUTES.activityScorecard,
  '/leaderboard': ROUTES.leaderboards,
  '/reports/orders': '/reports/sales-orders',
  '/reports/installed': '/reports/installed-base',
  '/reports/field': '/reports/field-force',
  '/admin/organisation': ROUTES.organisationHierarchy,
  '/admin/access': ROUTES.rolesPermissions,
  '/admin/studio': ROUTES.masters,
  '/admin/policies': ROUTES.workflows,
  '/admin/assignment-rules': ROUTES.leadAssignmentRules,
  '/admin/lead-scoring': ROUTES.leadScoringRules,
  '/admin/import-export': ROUTES.bulkImportExport,
  '/admin/duplicates': ROUTES.duplicateMerge,
  '/admin/transfer': ROUTES.ownershipTransfer,
  '/admin/audit': ROUTES.auditTrail,
  '/admin/events': `${ROUTES.auditTrail}?view=events`,
  '/admin/outbox': ROUTES.sentMessages,
  '/admin/settings': ROUTES.demoSettings,
};
