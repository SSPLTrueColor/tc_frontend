/** App navigation + simulated sign-in identities. Modules are added here as they are built. */

export interface Role {
  id: string;
  label: string;
}

export interface DemoUser {
  id: string;
  name: string;
  roleId: string;
}

export interface NavPage {
  id: string;
  label: string;
  icon: string;
  path: string;
}

export interface NavModule {
  id: string;
  label: string;
  icon: string;
  pages: NavPage[];
}

export const appName = 'True Color';
export const appMonogram = 'TC';

/** BRD §COM-01 role list. */
export const roles: Role[] = [
  { id: 'admin', label: 'Admin' },
  { id: 'management', label: 'Management' },
  { id: 'division_head', label: 'Division Head' },
  { id: 'sales', label: 'Sales' },
  { id: 'service', label: 'Service' },
  { id: 'coordinator', label: 'Coordinator' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'scm', label: 'Import / SCM' },
  { id: 'store', label: 'Store' },
];

export const demoUsers: DemoUser[] = [{ id: 'u-admin', name: 'Admin User', roleId: 'admin' }];

export const appModules: NavModule[] = [{ id: 'home', label: 'Home', icon: 'home', pages: [{ id: 'dashboard', label: 'Overview', icon: 'layout-dashboard', path: '/dashboard' }] }];

export const getRole = (id: string) => roles.find((r) => r.id === id) ?? { id, label: id };

/** First path segment decides the active module; `/dashboard` belongs to Home. */
export function activeModule(pathname: string) {
  const seg = pathname.split('/')[1];
  if (!seg || seg === 'dashboard') return 'home';
  return seg;
}
