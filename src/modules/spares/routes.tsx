import type { AppRoute } from '../types';
import { LeakagePage, ReordersPage, StockAlertsPage } from './pages';
import './spares.css';

/** Spares & consumables pages that are not plain resource lists (resource lists are routed automatically). */
export const routes: AppRoute[] = [
  { path: '/spares/stock-alerts', element: <StockAlertsPage /> },
  { path: '/consumables/leakage', element: <LeakagePage /> },
  { path: '/consumables/reorders', element: <ReordersPage /> },
];
