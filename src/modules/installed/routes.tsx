import type { AppRoute } from '../types';
import { RenewalsPage } from './RenewalsPage';

/** installed module pages that are not plain resource lists (resource lists are routed automatically). */
export const routes: AppRoute[] = [{ path: '/renewals', element: <RenewalsPage /> }];
