import type { AppRoute } from '../types';
import { ROUTES } from '../../constants/routes';
import { DealerOrdersPage, RepeatOrdersPage } from './ConsumablesPages';
import { LeakageListPage, MinimumLevelAlertsPage, ReorderPredictionPage } from './pages';
import { EngineerStockPage, MainStoreStockPage } from './StockPages';
import './spares.css';

/** Spare Parts (4.9) and Consumables (4.10) pages that are not plain resource lists (resource lists are routed automatically). */
export const routes: AppRoute[] = [
  { path: ROUTES.mainStoreStock, element: <MainStoreStockPage /> },
  { path: ROUTES.engineerStock, element: <EngineerStockPage /> },
  { path: ROUTES.minimumLevelAlerts, element: <MinimumLevelAlertsPage /> },
  { path: ROUTES.repeatOrders, element: <RepeatOrdersPage /> },
  { path: ROUTES.leakageList, element: <LeakageListPage /> },
  { path: ROUTES.reorderPrediction, element: <ReorderPredictionPage /> },
  { path: ROUTES.dealerOrders, element: <DealerOrdersPage /> },
];
