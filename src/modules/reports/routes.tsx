import './reports.css';
import type { AppRoute } from '../types';
import { ReportRoute, ReportsCatalogPage } from './ReportPages';

/** Report catalogue and viewer (FR-012/026/048/059/074/091/113, NFR-23). */
export const routes: AppRoute[] = [
  { path: '/reports', element: <ReportsCatalogPage /> },
  { path: '/reports/:reportId', element: <ReportRoute /> },
];
