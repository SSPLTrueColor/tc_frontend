import type { ModulePack } from './types';

/** Reports module pack: the export capability. Reports read other modules' resources (no own records); pages live in src/domain/sidebar.ts. */
export const reportsPack: ModulePack = {
  id: 'reports',
  resources: [],
  masters: [],
  permissions: {},
  // ADM-07 / COM-08: report export is role-restricted (and audited by the report service).
  // REQUIREMENTS §2.2 Reports column: X only for Admin, Management, Division head, Service leadership, Accounts.
  capabilities: {
    admin: ['reports.export'],
    management: ['reports.export'],
    division_head: ['reports.export'],
    service_head: ['reports.export'],
    accounts: ['reports.export'],
  },
};
