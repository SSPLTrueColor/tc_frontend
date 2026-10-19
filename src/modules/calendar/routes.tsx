import type { AppRoute } from '../types';
import { CalendarPage } from './CalendarPage';

/** /calendar — FullCalendar month / week / day / agenda (FR-034). */
export const routes: AppRoute[] = [{ path: '/calendar', element: <CalendarPage /> }];
