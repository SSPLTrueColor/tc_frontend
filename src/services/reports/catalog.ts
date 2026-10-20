/** The report catalogue: declarative definitions, grouped into the BRD report categories (GLOSSARY §1.2). */
import { L } from '../../constants/labels';
import { canReadResource, type Actor } from '../authz';
import { customerReports } from './defs/customers';
import { fieldReports } from './defs/field';
import { installedReports } from './defs/installed';
import { leadReports } from './defs/leads';
import { orderReports } from './defs/orders';
import { overviewReports } from './defs/overview';
import { quotationReports } from './defs/quotations';
import { serviceReports } from './defs/service';
import type { ReportDef, ReportGroup } from './types';

export const REPORTS: ReportDef[] = [...overviewReports, ...customerReports, ...leadReports, ...quotationReports, ...orderReports, ...installedReports, ...serviceReports, ...fieldReports];

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

/**
 * Earlier report ids (bookmarks, links in other screens) and where they live now:
 * reports that were merged open as a view of the report that absorbed them.
 */
export const LEGACY_REPORTS: Record<string, { id: string; view?: string }> = {
  'kpi-summary': { id: 'business-scorecard' },
  'activity-scorecard': { id: 'business-scorecard' },
  'lead-ageing': { id: 'lead-speed', view: 'ageing' },
  'lead-first-response': { id: 'lead-speed', view: 'response' },
  'pending-followups': { id: 'lead-speed', view: 'followups' },
  'pending-approvals': { id: 'quotation-value' },
  'quote-to-order': { id: 'quotation-value' },
  'pending-orders': { id: 'order-backlog', view: 'awaiting' },
  'delayed-dispatches': { id: 'order-backlog', view: 'delayed' },
  'warranty-expiry': { id: 'warranty-amc', view: 'warranty' },
  'amc-renewals-due': { id: 'warranty-amc', view: 'renewals' },
  'amc-status': { id: 'warranty-amc', view: 'status' },
  'engineer-productivity': { id: 'service-quality', view: 'engineer' },
  'first-time-fix': { id: 'service-quality', view: 'month' },
  csat: { id: 'service-quality', view: 'month' },
  'machine-downtime': { id: 'machine-reliability', view: 'downtime' },
  'mtbf-by-model': { id: 'machine-reliability', view: 'mtbf' },
  'repeat-complaints': { id: 'machine-reliability', view: 'repeats' },
  'attendance-daily': { id: 'attendance', view: 'daily' },
  'attendance-monthly': { id: 'attendance', view: 'employee' },
  'attendance-exceptions': { id: 'attendance', view: 'exceptions' },
};

/** Reports whose base resource the actor can read. */
export const reportsFor = (actor: Actor) => REPORTS.filter((r) => r.needs.every((k) => canReadResource(actor, k)));
export const getReport = (id: string) => REPORTS.find((r) => r.id === id);
