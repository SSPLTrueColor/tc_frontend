/** Aggregates every module's routes. Each module edits only its own routes.tsx. */
import type { AppRoute } from './types';
import { routes as catalog } from './catalog/routes';
import { routes as customers } from './customers/routes';
import { routes as leads } from './leads/routes';
import { routes as opportunities } from './opportunities/routes';
import { routes as quotations } from './quotations/routes';
import { routes as orders } from './orders/routes';
import { routes as installed } from './installed/routes';
import { routes as service } from './service/routes';
import { routes as spares } from './spares/routes';
import { routes as field } from './field/routes';
import { routes as reports } from './reports/routes';

export const moduleRoutes: AppRoute[] = [...catalog, ...customers, ...leads, ...opportunities, ...quotations, ...orders, ...installed, ...service, ...spares, ...field, ...reports];
