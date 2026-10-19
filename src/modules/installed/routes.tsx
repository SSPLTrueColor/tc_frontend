import type { AppRoute } from '../types';
import { ROUTES } from '../../constants/routes';
import { RenewalsPage } from './RenewalsPage';

/** Installed Base & AMC pages that are not plain resource lists (resource lists are routed automatically). */
export const routes: AppRoute[] = [{ path: ROUTES.renewalPipeline, element: <RenewalsPage /> }];
