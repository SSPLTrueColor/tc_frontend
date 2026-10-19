import { ROUTES } from '../../constants/routes';
import type { AppRoute } from '../types';
import { CustomFieldsPage } from '../../pages/AdminPages';
import { ImportExportPage } from './ImportExportPage';
import { IntegrationsPage } from './IntegrationsPage';
import { OrganisationPage } from './OrganisationPage';
import { ConfigurableRulesPage, SlaMatrixPage, WorkflowsPage } from './PolicyPages';
import { RecycleBinPage } from './RecycleBinPage';
import './catalog.css';

/**
 * Administration pages (BRD 4.14). Product & Price Master and Notification Templates are resource lists,
 * routed automatically under /admin/<slug>. Masters, Roles & Permissions, Audit Trail, Sent Messages and
 * Demo Settings are registered in App.tsx.
 */
export const routes: AppRoute[] = [
  { path: ROUTES.organisationHierarchy, element: <OrganisationPage /> },
  { path: ROUTES.customFields, element: <CustomFieldsPage /> },
  { path: ROUTES.workflows, element: <WorkflowsPage /> },
  { path: ROUTES.slaMatrix, element: <SlaMatrixPage /> },
  { path: ROUTES.configurableRules, element: <ConfigurableRulesPage /> },
  { path: ROUTES.bulkImportExport, element: <ImportExportPage /> },
  { path: ROUTES.integrations, element: <IntegrationsPage /> },
  { path: ROUTES.recycleBin, element: <RecycleBinPage /> },
];
