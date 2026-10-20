import { resourcePath } from '../../lib/routes';
import { getResource } from '../../services/registry';
import type { Crumb } from './PageHeader';

/** Breadcrumb that goes back to a resource's list: "Leads", "Sales Orders" … */
export const listCrumb = (resKey: string, ws = 'tc'): Crumb => ({ label: getResource(resKey).labelPlural, to: resourcePath(ws, resKey) });
