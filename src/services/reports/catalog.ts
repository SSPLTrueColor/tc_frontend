/** The report catalogue: declarative definitions, grouped into the BRD report categories (GLOSSARY §1.2). */
import { L } from '../../constants/labels';
import { canReadResource, type Actor } from '../authz';
import { kpiReports } from './defs/kpis';
import { operationsReports } from './defs/operations';
import { salesReports } from './defs/sales';
import type { ReportDef, ReportGroup } from './types';

export const REPORTS: ReportDef[] = [...kpiReports, ...salesReports, ...operationsReports];

/** Category pages: id is the URL segment (/reports/<id>); the title is the page title in L.nav.pages. */
export const REPORT_GROUPS: { id: ReportGroup; label: string; icon: string }[] = [
  { id: 'kpis', label: L.nav.pages.reportKpis.title, icon: 'activity' },
  { id: 'customers', label: L.nav.pages.reportCustomers.title, icon: 'users' },
  { id: 'leads', label: L.nav.pages.reportLeads.title, icon: 'send' },
  { id: 'quotations', label: L.nav.pages.reportQuotations.title, icon: 'receipt' },
  { id: 'sales-orders', label: L.nav.pages.reportSalesOrders.title, icon: 'check-square' },
  { id: 'installed-base', label: L.nav.pages.reportInstalledBase.title, icon: 'blocks' },
  { id: 'service', label: L.nav.pages.reportService.title, icon: 'settings' },
  { id: 'field-force', label: L.nav.pages.reportFieldForce.title, icon: 'id-card' },
];

/** Reports whose base resource the actor can read. */
export const reportsFor = (actor: Actor) => REPORTS.filter((r) => r.needs.every((k) => canReadResource(actor, k)));
export const getReport = (id: string) => REPORTS.find((r) => r.id === id);
