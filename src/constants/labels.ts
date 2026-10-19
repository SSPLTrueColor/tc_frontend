/**
 * Every label the app shows (docs/GLOSSARY.md). Components and metadata read from `L`; never hard-code a domain term.
 * A rename is a change to one value here.
 */
import { common } from './labels/common';
import { nav } from './labels/nav';
import { roles } from './labels/roles';
import { customers } from './labels/customers';
import { leads } from './labels/leads';
import { opportunities } from './labels/opportunities';
import { quotations } from './labels/quotations';
import { orders } from './labels/orders';
import { dispatch } from './labels/dispatch';
import { installed } from './labels/installed';
import { service } from './labels/service';
import { spares } from './labels/spares';
import { consumables } from './labels/consumables';
import { field } from './labels/field';
import { targets } from './labels/targets';
import { reports } from './labels/reports';
import { dashboard } from './labels/dashboard';
import { calendar } from './labels/calendar';
import { admin } from './labels/admin';
import { catalog } from './labels/catalog';

export const L = { common, nav, roles, customers, leads, opportunities, quotations, orders, dispatch, installed, service, spares, consumables, field, targets, reports, dashboard, calendar, admin, catalog } as const;
