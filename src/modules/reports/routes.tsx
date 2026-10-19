import './reports.css';
import { ROUTES } from '../../constants/routes';
import type { AppRoute } from '../types';
import { ReportRoute, ReportsCatalogPage } from './ReportPages';

/** All Reports catalogue, the eight category pages (/reports/<category>) and the viewer (FR-012/024/026/048/059/074/091/113, NFR-23). */
export const routes: AppRoute[] = [
  { path: ROUTES.reports, element: <ReportsCatalogPage /> },
  { path: ROUTES.report, element: <ReportRoute /> },
];
