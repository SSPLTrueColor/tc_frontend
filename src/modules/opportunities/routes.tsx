import type { AppRoute } from '../types';
import { ROUTES } from '../../constants/routes';
import { DemoMachineCalendarPage } from './DemoMachineCalendarPage';
import { PipelinePage } from './PipelinePage';
import { SalesForecastPage } from './SalesForecastPage';

/** Opportunities & Pipeline pages (lists for opportunities, demos, sample print requests and demo machines are routed automatically). */
export const routes: AppRoute[] = [
  { path: ROUTES.pipeline, element: <PipelinePage /> },
  { path: ROUTES.salesForecast, element: <SalesForecastPage /> },
  { path: ROUTES.demoMachineCalendar, element: <DemoMachineCalendarPage /> },
];
