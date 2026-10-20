/** Every Settings page, the capability that gates it, and the demo users for each role. */
export interface SettingsPageDef {
  id: string;
  path: string;
  /** Roles that may open it (everyone when omitted). */
  roles?: string[];
  /** Redesigned onto the Settings kit (has .st-col). */
  kit: boolean;
}

const ALL = ['admin', 'management', 'division_head', 'sales_manager', 'sales_exec', 'service_head', 'engineer', 'coordinator', 'scm', 'store', 'accounts', 'profiling'];

export const ROLE_USERS: Record<string, string> = {
  admin: 'u_rahul',
  management: 'u_vikram',
  division_head: 'u_suresh',
  sales_manager: 'u_rohan',
  sales_exec: 'u_karan',
  service_head: 'u_manoj',
  engineer: 'u_ravi',
  coordinator: 'u_meera',
  scm: 'u_rajesh',
  store: 'u_prakash',
  accounts: 'u_swati',
  profiling: 'u_tanvi',
};

export const PAGES: SettingsPageDef[] = [
  { id: 'profile', path: '/admin/profile', kit: true },
  { id: 'notification-preferences', path: '/admin/notification-preferences', kit: true },
  { id: 'security', path: '/admin/security', kit: true },
  { id: 'data-protection', path: '/admin/data-protection', kit: true },
  { id: 'organisation', path: '/admin/organisation-hierarchy', kit: true },
  { id: 'roles', path: '/admin/roles-permissions', kit: true },
  { id: 'workflows', path: '/admin/workflows', kit: true },
  { id: 'sla', path: '/admin/sla-matrix', kit: true },
  { id: 'rules', path: '/admin/configurable-rules', kit: true },
  { id: 'masters', path: '/admin/masters', kit: true },
  { id: 'custom-fields', path: '/admin/custom-fields', kit: true },
  { id: 'import-export', path: '/admin/bulk-import-export', kit: true },
  { id: 'duplicate-merge', path: '/admin/duplicate-merge', kit: true },
  { id: 'ownership-transfer', path: '/admin/ownership-transfer', kit: true },
  { id: 'recycle-bin', path: '/admin/recycle-bin', kit: true },
  { id: 'integrations', path: '/admin/integrations', kit: true },
  { id: 'sent-messages', path: '/admin/sent-messages', kit: true },
  { id: 'audit-trail', path: '/admin/audit-trail', kit: true },
  { id: 'demo-settings', path: '/admin/demo-settings', kit: true },
  // Resource lists served by the template grid (not rebuilt on the Settings kit).
  { id: 'users', path: '/admin/users', kit: false },
  { id: 'products', path: '/admin/products', kit: false },
  { id: 'price-lists', path: '/admin/price-lists', kit: false },
  { id: 'price-list-items', path: '/admin/price-list-items', kit: false },
  { id: 'terms-templates', path: '/admin/terms-templates', kit: false },
  { id: 'lead-assignment-rules', path: '/admin/lead-assignment-rules', kit: false },
  { id: 'lead-scoring-rules', path: '/admin/lead-scoring-rules', kit: false },
  { id: 'notification-templates', path: '/admin/notification-templates', kit: false },
];
void ALL;
export const WIDTHS = [1440, 1280, 1024, 768, 375];
