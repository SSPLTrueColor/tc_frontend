import { ROUTES } from '../../constants/routes';
import type { AppRoute } from '../types';
import { CalendarPage } from './CalendarPage';

/** Tasks & Calendar — FullCalendar month / week / day / agenda (FR-034, OPP-08). */
export const routes: AppRoute[] = [{ path: ROUTES.calendar, element: <CalendarPage /> }];
