import { Navigate } from 'react-router-dom';
import type { AppRoute } from '../types';
import { ImportExportPage } from './ImportExportPage';
import { IntegrationsPage } from './IntegrationsPage';
import { OrganisationPage } from './OrganisationPage';
import { PoliciesPage } from './PoliciesPage';
import { RecycleBinPage } from './RecycleBinPage';
import './catalog.css';

/** Catalog & administration pages (resource lists — products, price lists, templates — are routed automatically). */
export const routes: AppRoute[] = [
  { path: '/admin/organisation', element: <OrganisationPage /> },
  { path: '/admin/policies', element: <PoliciesPage /> },
  { path: '/admin/import-export', element: <ImportExportPage /> },
  { path: '/admin/integrations', element: <IntegrationsPage /> },
  { path: '/admin/recycle-bin', element: <RecycleBinPage /> },
  { path: '/admin/notification-templates', element: <Navigate to="/notificationTemplates" replace /> },
];
