/**
 * Bulk import / export (FR-125, FR-136, ADM-07, COM-08). CSV templates are generated from the
 * resource definitions; each row is converted and validated with the same rules as the forms
 * before anything is written. Imports are role-restricted and audited.
 */
import type { FieldDefinition, ResourceDefinition } from '../../metadata/types';
import { appPack } from '../../domain/pack';
import { uid } from '../../lib/ids';
import { type Actor, can, fieldAccess, perm } from '../authz';
import { commit, getDb } from '../db';
import { csvCell } from '../exporter';
import { appendAudit } from '../ledger';
import { getMaster, getResource } from '../registry';
import { createRecord, queryRecords, recordTitle } from '../runtime';
import { ServiceError } from '../types';
import { isEmpty, validateValues } from '../validation';

const IMPORTABLE_TYPES = new Set(['text', 'longtext', 'email', 'phone', 'identifier', 'number', 'money', 'date', 'datetime', 'boolean', 'master', 'multimaster', 'relation']);

/** Fields an actor can supply on create, in form order. */
export function importFields(actor: Actor, res: ResourceDefinition): FieldDefinition[] {
  return res.fields.filter((f) => IMPORTABLE_TYPES.has(f.type) && !f.computed && !f.system && !f.readOnly && fieldAccess(actor, res, f, 'create') === 'edit');
}

/** Resources this actor may import into (create permission + data.import capability). */
export function importableResources(actor: Actor): ResourceDefinition[] {
  if (!can(actor, 'data.import')) return [];
  return appPack.resources.map((r) => getResource(r.key)).filter((r) => perm(actor, r.key).create && importFields(actor, r).length > 0);
}

/** Resources this actor may export (export permission). */
export function exportableResources(actor: Actor): ResourceDefinition[] {
  return appPack.resources.map((r) => getResource(r.key)).filter((r) => perm(actor, r.key).export);
}

/** Header row = field labels; a second "help" row explains formats and is skipped on import. */
export function templateCsv(actor: Actor, resKey: string): string {
  const res = getResource(resKey);
  const fields = importFields(actor, res);
  const hint = (f: FieldDefinition) => {
    if (f.type === 'master') return `One of: ${getMaster(f.master!).values.filter((v) => v.active).map((v) => v.label).slice(0, 8).join(' | ')}`;
    if (f.type === 'multimaster') return `Several of: ${getMaster(f.master!).values.map((v) => v.label).slice(0, 6).join(' | ')} (separate with ;)`;
    if (f.type === 'relation') return `${getResource(f.relation!.resource).label} ID or name`;
    if (f.type === 'date') return 'DD-MM-YYYY';
    if (f.type === 'datetime') return 'DD-MM-YYYY HH:mm';
    if (f.type === 'boolean') return 'Yes / No';
    if (f.type === 'money' || f.type === 'number') return 'Number';
    return f.required ? 'Required' : 'Optional';
  };
  return [fields.map((f) => csvCell(`${f.label}${f.required ? ' *' : ''}`)).join(','), fields.map((f) => csvCell(`# ${hint(f)}`)).join(',')].join('\n');
}

/** RFC-4180-style CSV parser (quotes, escaped quotes, CR/LF). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out.filter((r) => r.some((x) => x.trim() !== ''));
}

const clean = (s: string) => s.replace(/^'(?=[=+\-@])/, '').trim();
const norm = (s: string) => s.toLowerCase().replace(/\s*\*$/, '').replace(/[^a-z0-9]/g, '');

function toDateKey(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(t);
  if (m) {
    const date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return m[4] ? `${date}T${m[4].padStart(2, '0')}:${m[5]}` : date;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(t);
  if (m) return m[4] ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** Converts one cell to the field's stored value, or returns an error message. */
function convert(actor: Actor, f: FieldDefinition, raw: string): { value?: unknown; error?: string } {
  const s = clean(raw);
  if (s === '') return { value: undefined };
  switch (f.type) {
    case 'number':
    case 'money': {
      const n = Number(s.replace(/[₹,\s]/g, ''));
      return Number.isNaN(n) ? { error: `${f.label}: "${s}" is not a number` } : { value: n };
    }
    case 'boolean':
      if (/^(yes|y|true|1)$/i.test(s)) return { value: true };
      if (/^(no|n|false|0)$/i.test(s)) return { value: false };
      return { error: `${f.label}: use Yes or No` };
    case 'date':
    case 'datetime': {
      const d = toDateKey(s);
      return d ? { value: f.type === 'date' ? d.slice(0, 10) : d } : { error: `${f.label}: use DD-MM-YYYY` };
    }
    case 'master': {
      const mv = getMaster(f.master!).values.find((v) => v.key.toLowerCase() === s.toLowerCase() || v.label.toLowerCase() === s.toLowerCase());
      return mv ? { value: mv.key } : { error: `${f.label}: "${s}" is not a known value` };
    }
    case 'multimaster': {
      const parts = s.split(/[;|]/).map((x) => x.trim()).filter(Boolean);
      const keys: string[] = [];
      for (const part of parts) {
        const mv = getMaster(f.master!).values.find((v) => v.key.toLowerCase() === part.toLowerCase() || v.label.toLowerCase() === part.toLowerCase());
        if (!mv) return { error: `${f.label}: "${part}" is not a known value` };
        keys.push(mv.key);
      }
      return { value: keys };
    }
    case 'relation': {
      const target = f.relation!.resource;
      const rows = getDb().records[target] ?? [];
      const hit = rows.find((r) => r.id.toLowerCase() === s.toLowerCase()) ?? rows.find((r) => recordTitle(target, r.id, actor).toLowerCase() === s.toLowerCase());
      return hit ? { value: hit.id } : { error: `${f.label}: no ${getResource(target).label.toLowerCase()} "${s}"` };
    }
    case 'phone':
      return { value: s.replace(/[\s-]/g, '').replace(/^(\+91|0)(?=\d{10}$)/, '') };
    case 'identifier':
      return { value: s.toUpperCase() };
    default:
      return { value: s };
  }
}

export interface PreviewRow {
  line: number;
  values: Record<string, unknown>;
  errors: string[];
}

export interface ImportPreview {
  resource: string;
  columns: { header: string; field?: FieldDefinition }[];
  rows: PreviewRow[];
  unknownColumns: string[];
}

/** Maps headers to fields (by label or key), converts and validates every row. Nothing is written. */
export function previewImport(actor: Actor, resKey: string, text: string): ImportPreview {
  if (!can(actor, 'data.import') || !perm(actor, resKey).create) throw new ServiceError('forbidden', 'Your role cannot import these records.');
  const res = getResource(resKey);
  const fields = importFields(actor, res);
  const table = parseCsv(text.replace(/^\uFEFF/, ''));
  if (!table.length) throw new ServiceError('validation', 'The file is empty.');
  if (table.length > 1001) throw new ServiceError('validation', 'Import at most 1,000 rows at a time.');
  const columns = table[0].map((h) => ({ header: h.trim(), field: fields.find((f) => norm(f.label) === norm(h) || norm(f.key) === norm(h)) }));
  const unknownColumns = columns.filter((c) => !c.field && c.header).map((c) => c.header);
  const missing = fields.filter((f) => f.required && f.defaultValue === undefined && !columns.some((c) => c.field?.key === f.key));
  const rows: PreviewRow[] = [];
  table.slice(1).forEach((cells, i) => {
    if (cells[0]?.trim().startsWith('#')) return; // template help row
    const values: Record<string, unknown> = {};
    const errors: string[] = missing.map((f) => `${f.label} column is missing`);
    columns.forEach((c, j) => {
      if (!c.field) return;
      const r = convert(actor, c.field, cells[j] ?? '');
      if (r.error) errors.push(r.error);
      else if (r.value !== undefined) values[c.field.key] = r.value;
    });
    fields.forEach((f) => {
      if (isEmpty(values[f.key]) && f.defaultValue !== undefined) values[f.key] = f.defaultValue;
    });
    const editable = new Set(fields.map((f) => f.key));
    const fieldErrors = validateValues(res, values, editable);
    Object.entries(fieldErrors).forEach(([k, msg]) => {
      const label = res.fields.find((f) => f.key === k)?.label ?? k;
      if (!errors.some((e) => e.startsWith(label))) errors.push(msg.startsWith(label) ? msg : `${label}: ${msg}`);
    });
    rows.push({ line: i + 2, values, errors });
  });
  return { resource: resKey, columns, rows, unknownColumns };
}

export interface ImportResult {
  created: string[];
  failed: { line: number; message: string }[];
}

/** Creates every valid row through the normal create path (permissions, hooks, audit). */
export function commitImport(actor: Actor, preview: ImportPreview): ImportResult {
  const res = getResource(preview.resource);
  const result: ImportResult = { created: [], failed: [] };
  const key = uid('imp');
  preview.rows
    .filter((r) => !r.errors.length)
    .forEach((r, i) => {
      try {
        result.created.push(createRecord(actor, preview.resource, r.values, { idempotencyKey: `${key}:${i}` }).record.id);
      } catch (e) {
        result.failed.push({ line: r.line, message: e instanceof Error ? e.message : 'Failed' });
      }
    });
  commit((d) => appendAudit(d, actor, { action: 'import', resource: preview.resource, summary: `Imported ${result.created.length} ${res.labelPlural.toLowerCase()} from CSV (${preview.rows.length - result.created.length} skipped)`, correlationId: key }));
  return result;
}

/** All rows the actor can see, for export (the exporter masks and audits). */
export const rowsForExport = (actor: Actor, resKey: string) => queryRecords(actor, resKey).rows;
