/** Async report services (simulated network boundary) and audited CSV export. */
import { nowMs } from '../../lib/clock';
import { todayKey } from '../../lib/dates';
import { uid } from '../../lib/ids';
import { type Actor, can } from '../authz';
import { commit } from '../db';
import { csvCell } from '../exporter';
import { appendAudit } from '../ledger';
import { getReport, reportsFor } from '../reports/catalog';
import { loadDataset } from '../reports/dataset';
import { formatCell } from '../reports/format';
import type { ReportFilters, ReportResult } from '../reports/types';
import { ServiceError } from '../types';

export const listReports = (actor: Actor) => reportsFor(actor);

/** Runs a report over role-scoped data. Synchronous engine op — call through useServiceQuery / call(). */
export function runReport(actor: Actor, reportId: string, filters: ReportFilters): ReportResult {
  const def = getReport(reportId);
  if (!def || !reportsFor(actor).includes(def)) throw new ServiceError('not_found', 'This report does not exist or your role cannot open it.');
  return def.compute(loadDataset(actor), filters, { actor, today: todayKey(), nowMs: nowMs() });
}

export const canExportReports = (actor: Actor) => can(actor, 'reports.export');

/** CSV of the rows on screen (already scope-filtered). Role-restricted and written to the audit log (ADM-07). */
export function exportReport(actor: Actor, reportId: string, result: ReportResult, filters: ReportFilters): string {
  const def = getReport(reportId);
  if (!def) throw new ServiceError('not_found', 'Unknown report.');
  if (!canExportReports(actor)) throw new ServiceError('forbidden', `${actor.role.label} cannot export reports.`);
  const header = result.columns.map((c) => csvCell(c.label)).join(',');
  const body = result.rows.map((r) => result.columns.map((c) => csvCell(formatCell(c, r[c.key]))).join(','));
  const range = filters.from || filters.to ? ` (${filters.from ?? '…'} to ${filters.to ?? '…'})` : '';
  commit((d) => appendAudit(d, actor, { action: 'export', summary: `Exported report "${def.title}"${range}: ${result.rows.length} rows`, correlationId: uid('cor') }));
  return [header, ...body].join('\n');
}
