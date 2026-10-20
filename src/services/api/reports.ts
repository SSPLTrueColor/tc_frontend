/** Async report services (simulated network boundary) and audited Excel export. */
import { L } from '../../constants/labels';
import { nowMs } from '../../lib/clock';
import { todayKey } from '../../lib/dates';
import { uid } from '../../lib/ids';
import { type Actor, can } from '../authz';
import { commit } from '../db';
import { appendAudit } from '../ledger';
import { getReport, reportsFor } from '../reports/catalog';
import { loadDataset } from '../reports/dataset';
import { runView } from '../reports/engine';
import { buildReportWorkbook, type ExportInput } from '../reports/excel';
import type { ReportFilters, ReportOutput } from '../reports/types';
import { ServiceError } from '../types';

export const listReports = (actor: Actor) => reportsFor(actor);

/** Runs one view of a report over role-scoped data. Synchronous engine op — call through useServiceQuery / call(). */
export function runReport(actor: Actor, reportId: string, viewId: string | undefined, filters: ReportFilters): ReportOutput {
  const def = getReport(reportId);
  if (!def || !reportsFor(actor).includes(def)) throw new ServiceError('not_found', L.reports.errors.notFound);
  const view = def.views.find((v) => v.id === viewId) ?? def.views[0];
  return runView({ view, ds: loadDataset(actor), filters, ctx: { actor, today: todayKey(), nowMs: nowMs() } });
}

export const canExportReports = (actor: Actor) => can(actor, 'reports.export');

/** Excel workbook of the rows on screen (already scope-filtered). Role-restricted and written to the audit log (ADM-07). */
export function exportReport(actor: Actor, reportId: string, input: ExportInput): Uint8Array {
  const def = getReport(reportId);
  if (!def) throw new ServiceError('not_found', L.reports.errors.unknown);
  if (!canExportReports(actor)) throw new ServiceError('forbidden', L.reports.errors.cannotExport(actor.role.label));
  const bytes = buildReportWorkbook(def.title, input);
  commit((d) => appendAudit(d, actor, { action: 'export', summary: L.reports.audit.exported(def.title, input.filterLines.length ? ` (${input.filterLines.join('; ')})` : '', input.rows.length), correlationId: uid('cor') }));
  return bytes;
}
