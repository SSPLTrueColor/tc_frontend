import type { ModulePack } from './types';

/** Reports module pack: navigation and the export capability. Reports read other modules' resources (no own records). */
export const reportsPack: ModulePack = {
  id: 'reports',
  nav: {
    id: 'reports',
    label: 'Reports',
    icon: 'activity',
    resources: [],
    pages: [
      { id: 'catalogue', label: 'All reports', icon: 'list', path: 'reports' },
      { id: 'r-kpis', label: 'KPIs & adoption', icon: 'activity', path: 'reports/kpis' },
      { id: 'r-customers', label: 'Customers', icon: 'users', path: 'reports/customers' },
      { id: 'r-leads', label: 'Leads & sales team', icon: 'send', path: 'reports/leads' },
      { id: 'r-quotations', label: 'Quotations', icon: 'receipt', path: 'reports/quotations' },
      { id: 'r-orders', label: 'Orders & collections', icon: 'check-square', path: 'reports/orders' },
      { id: 'r-installed', label: 'Installed base & AMC', icon: 'blocks', path: 'reports/installed' },
      { id: 'r-service', label: 'Service', icon: 'settings', path: 'reports/service' },
      { id: 'r-field', label: 'Field force', icon: 'id-card', path: 'reports/field' },
    ],
  },
  resources: [],
  masters: [],
  permissions: {},
  // ADM-07 / COM-08: report export is role-restricted (and audited by the report service).
  capabilities: {
    admin: ['reports.export'],
    management: ['reports.export'],
    division_head: ['reports.export'],
    sales_manager: ['reports.export'],
    service_head: ['reports.export'],
    accounts: ['reports.export'],
  },
};
