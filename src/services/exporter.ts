/**
 * Permission-aware CSV export. Values come from the projected (already masked)
 * rows, so masked or hidden fields never leave in raw form.
 */
import type { RecordData, ResourceDefinition } from '../metadata/types';
import { type Actor, can, perm } from './authz';
import { commit } from './db';
import { getResource } from './registry';
import { appendAudit } from './ledger';
import { displayText } from './runtime';
import { ServiceError } from './types';
import { L } from '../constants/labels';
import { uid } from '../lib/ids';

/** Spreadsheet formula-injection guard. */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function buildCsv(actor: Actor, res: ResourceDefinition, rows: RecordData[], columns: string[]): string {
  const fields = columns
    .map((k) => (k === 'id' ? { key: 'id', label: 'ID' } : res.fields.find((f) => f.key === k)))
    .filter((f): f is NonNullable<typeof f> => !!f && (f.key === 'id' || 'capabilities' in f));
  const header = fields.map((f) => csvCell(f.label)).join(',');
  const body = rows.map((r) =>
    fields
      .map((f) => {
        if (!(f.key in r)) return '';
        const def = res.fields.find((x) => x.key === f.key);
        return csvCell(def ? displayText(def, r[f.key], actor) : String(r[f.key] ?? ''));
      })
      .join(','),
  );
  return [header, ...body].join('\n');
}

export function exportCsv(actor: Actor, res: ResourceDefinition, rows: RecordData[], columns: string[]): string {
  if (!perm(actor, res.key).export) throw new ServiceError('forbidden', L.common.errors.cannotExport(res.labelPlural.toLowerCase()));
  const csv = buildCsv(actor, res, rows, columns);
  commit((d) => appendAudit(d, actor, { action: 'export', resource: res.key, summary: L.common.audit.exported(rows.length, res.labelPlural.toLowerCase()), correlationId: uid('cor') }));
  return csv;
}

/**
 * ADM-07 / COM-08 / COM-09: may the actor export rows of this list? A list bound to a resource needs that
 * resource's export (X) permission; a computed list with no single resource needs the Data Export capability.
 */
export function canExportRows(actor: Actor, resource?: string): boolean {
  if (resource) {
    try {
      getResource(resource);
    } catch {
      return can(actor, 'data.export');
    }
    return perm(actor, resource).export;
  }
  return can(actor, 'data.export');
}

/**
 * "Export selected" on computed tables (DataTable): the same permission check and audit entry as a list
 * export. `cells` are already what the actor sees on screen (masked values stay masked).
 */
export function exportRowsCsv(actor: Actor, input: { label: string; resource?: string; header: string[]; cells: string[][] }): string {
  const what = input.resource ? getResource(input.resource).labelPlural.toLowerCase() : input.label.toLowerCase();
  if (!canExportRows(actor, input.resource)) throw new ServiceError('forbidden', L.common.errors.cannotExport(what));
  const csv = [input.header.map(csvCell).join(','), ...input.cells.map((r) => r.map(csvCell).join(','))].join('\n');
  commit((d) => appendAudit(d, actor, { action: 'export', resource: input.resource, summary: L.common.audit.exportedSelection(input.cells.length, what), correlationId: uid('cor') }));
  return csv;
}

export function downloadText(filename: string, text: string, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBytes(filename: string, bytes: Uint8Array, type: string) {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
