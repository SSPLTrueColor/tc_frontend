/**
 * Permission-aware CSV export. Values come from the projected (already masked)
 * rows, so masked or hidden fields never leave in raw form.
 */
import type { RecordData, ResourceDefinition } from '../metadata/types';
import { type Actor, perm } from './authz';
import { commit } from './db';
import { appendAudit } from './ledger';
import { displayText } from './runtime';
import { ServiceError } from './types';
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
  if (!perm(actor, res.key).export) throw new ServiceError('forbidden', `Your role cannot export ${res.labelPlural.toLowerCase()}.`);
  const csv = buildCsv(actor, res, rows, columns);
  commit((d) => appendAudit(d, actor, { action: 'export', resource: res.key, summary: `Exported ${rows.length} ${res.labelPlural.toLowerCase()} to CSV`, correlationId: uid('cor') }));
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
