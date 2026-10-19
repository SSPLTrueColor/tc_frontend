import type { ModulePack } from './types';

/** Reports module pack: navigation and the export capability. Reports read other modules' resources (no own records). */
export const reportsPack: ModulePack = {
  id: 'reports',
  nav: {
    id: 'reports',
    label: 'Reports',
    icon: 'bar-chart',
    resources: [],
    pages: [
      { id: 'catalogue', label: 'All reports', icon: 'list', path: 'reports' },
      { id: 'r-kpis', label: 'KPIs & adoption', icon: 'activity', path: 'reports/kpis' },
      { id: 'r-customers', label: 'Customers', icon: 'building', path: 'reports/customers' },
      { id: 'r-leads', label: 'Leads & sales team', icon: 'target', path: 'reports/leads' },
      { id: 'r-quotations', label: 'Quotations', icon: 'file-text', path: 'reports/quotations' },
      { id: 'r-orders', label: 'Orders & collections', icon: 'shopping-cart', path: 'reports/orders' },
      { id: 'r-installed', label: 'Installed base & AMC', icon: 'printer', path: 'reports/installed' },
      { id: 'r-service', label: 'Service', icon: 'wrench', path: 'reports/service' },
      { id: 'r-field', label: 'Field force', icon: 'map-pin', path: 'reports/field' },
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
