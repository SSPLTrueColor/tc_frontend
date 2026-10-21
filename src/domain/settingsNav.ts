/** Settings information architecture: groups → pages. Drives the Settings left nav (sticky, grouped). */
import { ROUTES, slugOf } from '../constants/routes';

export interface SettingsNavItem {
  id: string;
  icon: string;
  path: string;
  /** Capability required to open the page (see services/authz). */
  capability?: string;
  /** Resource whose read access is required (list pages served by the resource engine). */
  resource?: string;
}
export interface SettingsNavGroup {
  id: string;
  items: SettingsNavItem[];
}

const page = (id: keyof typeof ROUTES, icon: string, capability?: string): SettingsNavItem => ({ id, icon, path: ROUTES[id], capability });
const res = (id: string, key: string, icon: string): SettingsNavItem => ({ id, icon, path: `/${slugOf(key)}`, resource: key });

export const SETTINGS_NAV: SettingsNavGroup[] = [
  { id: 'account', items: [page('profile', 'palette'), page('notificationPreferences', 'bell'), page('security', 'lock')] },
  {
    id: 'people',
    items: [page('organisationHierarchy', 'building', 'org.view'), res('users', 'employees', 'users'), page('rolesPermissions', 'shield', 'access.view')],
  },
  {
    id: 'rules',
    items: [
      page('workflows', 'sliders', 'config.publish'),
      page('slaMatrix', 'calendar-clock', 'config.publish'),
      res('leadAssignmentRules', 'assignmentRules', 'target'),
      res('leadScoringRules', 'leadScoringRules', 'star'),
      page('configurableRules', 'check-square', 'config.publish'),
    ],
  },
  {
    id: 'data',
    items: [
      page('masters', 'blocks', 'config.publish'),
      res('products', 'products', 'package'),
      res('priceLists', 'priceLists', 'tag'),
      res('priceListItems', 'priceListItems', 'receipt'),
      res('termsTemplates', 'termsTemplates', 'notebook'),
      page('customFields', 'columns', 'config.publish'),
      res('notificationTemplates', 'notificationTemplates', 'message'),
      page('numberingSeries', 'layers', 'config.publish'),
    ],
  },
  {
    id: 'tools',
    items: [page('bulkImportExport', 'download', 'data.export'), page('duplicateMerge', 'copy', 'customers.merge'), page('ownershipTransfer', 'users', 'customers.transfer'), page('recycleBin', 'trash', 'recycle.manage')],
  },
  { id: 'integrations', items: [page('integrations', 'activity', 'integrations.manage'), page('sentMessages', 'send', 'outbox.view')] },
  { id: 'governance', items: [page('auditTrail', 'scroll-text', 'audit.view'), page('dataProtection', 'shield')] },
  { id: 'demo', items: [page('demoSettings', 'palette'), page('componentGallery', 'blocks', 'demo.settings')] },
];
