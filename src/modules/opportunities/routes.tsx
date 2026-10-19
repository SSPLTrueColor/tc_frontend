import type { AppRoute } from '../types';
import { CalendarPage } from './CalendarPage';
import { ForecastPage } from './ForecastPage';

/** Opportunities module pages (lists for opportunities, demos and sample requests are routed automatically). */
export const routes: AppRoute[] = [
  { path: '/opportunities/forecast', element: <ForecastPage /> },
  { path: '/calendar', element: <CalendarPage /> },
];
