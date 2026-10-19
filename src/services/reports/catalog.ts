/** The report catalogue: declarative definitions, grouped for navigation. */
import { canReadResource, type Actor } from '../authz';
import { kpiReports } from './defs/kpis';
import { operationsReports } from './defs/operations';
import { salesReports } from './defs/sales';
import type { ReportDef, ReportGroup } from './types';

export const REPORTS: ReportDef[] = [...kpiReports, ...salesReports, ...operationsReports];

export const REPORT_GROUPS: { id: ReportGroup; label: string; icon: string }[] = [
  { id: 'kpis', label: 'KPIs & adoption', icon: 'activity' },
  { id: 'customers', label: 'Customers', icon: 'users' },
  { id: 'leads', label: 'Leads & sales team', icon: 'send' },
  { id: 'quotations', label: 'Quotations', icon: 'receipt' },
  { id: 'orders', label: 'Orders & collections', icon: 'check-square' },
  { id: 'installed', label: 'Installed base & AMC', icon: 'blocks' },
  { id: 'service', label: 'Service', icon: 'settings' },
  { id: 'field', label: 'Field force', icon: 'id-card' },
];

/** Reports whose base resource the actor can read. */
export const reportsFor = (actor: Actor) => REPORTS.filter((r) => r.needs.every((k) => canReadResource(actor, k)));
export const getReport = (id: string) => REPORTS.find((r) => r.id === id);
