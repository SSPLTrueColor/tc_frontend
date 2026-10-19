/**
 * Resource Runtime (mock service). Owns business records. Every read is
 * projected through the simulated Authorization Service (row scope, field
 * hide/mask); every write is validated, version-checked, audited and emits a
 * versioned domain event into the simulated outbox.
 */
import type { FieldAccess, FieldDefinition, FilterGroup, RecordData, ResourceDefinition } from '../metadata/types';
import { formatDate, formatDateTime, todayKey } from '../lib/dates';
import { formatMoney, pct } from '../lib/format';
import { uid } from '../lib/ids';
import { maskEmail, maskIdentifier, maskPhone, RESTRICTED } from '../lib/phiMask';
import { type Actor, canReadRecord, canUpdateRecord, can, fieldAccess, fieldAccessMap, perm, queryableField } from './authz';
import { commit, getDb } from './db';
import { evalGroup } from './filter';
import { appendAudit, emitEvent, notify } from './ledger';
import { getResource, masterLabel } from './registry';
import { findConflicts } from './scheduling';
import { type Db, ServiceError } from './types';
import { inactiveMasterErrors, isEmpty, isVisible, validateValues } from './validation';

function applyHiddenPolicy(res: ResourceDefinition, values: Record<string, unknown>) {
  res.fields.forEach((f) => {
    if (f.clearWhenHidden && !isVisible(f, values)) values[f.key] = null;
  });
}
import { demoUsers } from '../domain/clinic/pack';

export interface Projected {
  record: RecordData;
  access: Record<string, FieldAccess>;
  canUpdate: boolean;
}

// ---------------------------------------------------------------- display

export function withComputed(res: ResourceDefinition, r: RecordData): RecordData {
  const computed = res.fields.filter((f) => f.computed);
  if (!computed.length) return r;
  const out = { ...r };
  computed.forEach((f) => (out[f.key] = f.computed!(r)));
  return out;
}

export function maskValue(f: FieldDefinition, v: unknown): unknown {
  if (isEmpty(v)) return v;
  if (f.type === 'phone') return maskPhone(v);
  if (f.type === 'email') return maskEmail(v);
  if (f.sensitivity === 'identifier' || f.sensitivity === 'contact') return maskIdentifier(v);
  return RESTRICTED;
}

export function recordTitle(resKey: string, id: unknown, actor?: Actor): string {
  if (isEmpty(id)) return '';
  const res = getResource(resKey);
  const r = getDb().records[resKey]?.find((x) => x.id === id);
  if (!r) return String(id);
  if (actor && !canReadRecord(actor, res, r)) return `${id}`;
  const title = res.fields.find((f) => f.key === res.titleField);
  if (!title) return String(r[res.titleField] ?? r.id);
  if (title.type === 'relation') {
    const base = recordTitle(title.relation!.resource, r[title.key], actor);
    return resKey === 'appointments' ? `${base} · ${formatDateTime(String(r.start))}` : base;
  }
  return String(r[res.titleField] ?? r.id);
}

/** Plain-text display used by search, filters ("contains"), grouping and CSV export. */
export function displayText(f: FieldDefinition, v: unknown, actor?: Actor): string {
  if (isEmpty(v)) return '';
  if (typeof v === 'string' && (v === RESTRICTED || v.includes('*'))) return v;
  switch (f.type) {
    case 'master':
      return masterLabel(f.master!, v);
    case 'multimaster':
      return (v as string[]).map((k) => masterLabel(f.master!, k)).join(', ');
    case 'relation':
      return recordTitle(f.relation!.resource, v, actor);
    case 'people':
      return (v as string[]).map((id) => recordTitle(f.relation!.resource, id, actor)).join(', ');
    case 'image':
      return 'Image';
    case 'date':
      return formatDate(String(v));
    case 'datetime':
      return formatDateTime(String(v));
    case 'money':
      return formatMoney(Number(v));
    case 'boolean':
      return v ? 'Yes' : 'No';
    case 'progress':
      return pct(Number(v));
    case 'lineitems':
      return `${(v as unknown[]).length} item(s)`;
    case 'number':
      return `${v}${f.unit ? ` ${f.unit}` : ''}`;
    default:
      return String(v);
  }
}

// ---------------------------------------------------------------- reads

export function project(actor: Actor, res: ResourceDefinition, raw: RecordData): Projected {
  const access = fieldAccessMap(actor, res);
  const full = withComputed(res, raw);
  const out: RecordData = { id: raw.id, workspaceId: raw.workspaceId, version: raw.version, createdAt: raw.createdAt, updatedAt: raw.updatedAt, createdBy: raw.createdBy };
  for (const f of res.fields) {
    const a = access[f.key];
    if (a === 'hide') continue;
    out[f.key] = a === 'mask' ? maskValue(f, full[f.key]) : full[f.key];
  }
  return { record: out, access, canUpdate: canUpdateRecord(actor, res, raw) };
}

export function getRecord(actor: Actor, resKey: string, id: string): Projected {
  const res = getResource(resKey);
  if (perm(actor, resKey).read === 'none') throw new ServiceError('forbidden', `You do not have access to ${res.labelPlural}.`);
  const raw = getDb().records[resKey]?.find((r) => r.id === id);
  // Not-found and not-authorized are indistinguishable to avoid disclosure across workspaces/scopes.
  if (!raw || !canReadRecord(actor, res, raw)) throw new ServiceError('not_found', `${res.label} ${id} was not found or you do not have access.`);
  return project(actor, res, raw);
}

export interface Query {
  filter?: FilterGroup;
  search?: string;
  sort?: { field: string; dir: 'asc' | 'desc' }[];
  where?: Record<string, unknown>;
  page?: number;
  pageSize?: number;
}

export interface QueryResult {
  rows: RecordData[];
  total: number;
  ignoredFields: string[];
}

/**
 * Query adapter. Executes locally over the in-browser dataset (documented local
 * mode); the signature mirrors what a server query API would accept.
 */
export function queryRecords(actor: Actor, resKey: string, q: Query = {}): QueryResult {
  const res = getResource(resKey);
  if (perm(actor, resKey).read === 'none') throw new ServiceError('forbidden', `You do not have access to ${res.labelPlural}.`);
  const fields = new Map(res.fields.map((f) => [f.key, f]));
  const ignored = new Set<string>();
  const resolveFactory = (r: RecordData) => (key: string) => {
    if (key === 'id') return { value: r.id };
    const f = fields.get(key);
    if (!f || !queryableField(actor, res, f)) {
      ignored.add(key);
      return undefined;
    }
    return { value: r[key], display: displayText(f, r[key], actor) };
  };
  const searchFields = res.fields.filter((f) => f.capabilities.search && queryableField(actor, res, f));
  const needle = q.search?.trim().toLowerCase();

  let rows = (getDb().records[resKey] ?? [])
    .filter((r) => canReadRecord(actor, res, r))
    .map((r) => withComputed(res, r))
    .filter((r) => !q.where || Object.entries(q.where).every(([k, v]) => r[k] === v))
    .filter((r) => !q.filter || evalGroup(q.filter, resolveFactory(r)))
    .filter((r) => !needle || r.id.toLowerCase().includes(needle) || searchFields.some((f) => displayText(f, r[f.key], actor).toLowerCase().includes(needle)));

  const sorts = (q.sort ?? []).filter((s) => s.field === 'id' || (fields.get(s.field) && queryableField(actor, res, fields.get(s.field)!)));
  if (sorts.length) {
    rows = [...rows].sort((a, b) => {
      for (const s of sorts) {
        const f = fields.get(s.field);
        const av = f && ['master', 'relation', 'multimaster', 'people'].includes(f.type) ? displayText(f, a[s.field], actor) : a[s.field];
        const bv = f && ['master', 'relation', 'multimaster', 'people'].includes(f.type) ? displayText(f, b[s.field], actor) : b[s.field];
        const cmp = compare(av, bv);
        if (cmp !== 0) return s.dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }
  const total = rows.length;
  if (q.pageSize) {
    const page = q.page ?? 0;
    rows = rows.slice(page * q.pageSize, page * q.pageSize + q.pageSize);
  }
  return { rows: rows.map((r) => project(actor, res, r).record), total, ignoredFields: [...ignored] };
}

function compare(a: unknown, b: unknown): number {
  if (isEmpty(a) && isEmpty(b)) return 0;
  if (isEmpty(a)) return 1;
  if (isEmpty(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

// ---------------------------------------------------------------- writes

function nextId(d: Db, res: ResourceDefinition, workspaceId: string): string {
  const base = workspaceId === 'hillcrest' ? 2000 : 1000;
  const nums = (d.records[res.key] ?? [])
    .filter((r) => r.workspaceId === workspaceId)
    .map((r) => Number(r.id.split('-').pop()))
    .filter((n) => !Number.isNaN(n));
  return `${res.idPrefix}-${Math.max(base, ...nums) + 1}`;
}

const REDACT = new Set(['contact', 'identifier', 'health']);

function diff(res: ResourceDefinition, before: Record<string, unknown>, after: Record<string, unknown>, actor: Actor) {
  const changes: { field: string; label: string; before: string; after: string }[] = [];
  for (const f of res.fields) {
    if (f.computed) continue;
    const a = before[f.key];
    const b = after[f.key];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    const red = f.sensitivity && REDACT.has(f.sensitivity);
    changes.push({
      field: f.key,
      label: f.label,
      before: red ? '[redacted]' : f.type === 'lineitems' ? 'previous items' : displayText(f, a, actor) || 'N/A',
      after: red ? '[redacted]' : f.type === 'lineitems' ? 'updated items' : displayText(f, b, actor) || 'N/A',
    });
  }
  return changes;
}

function pickWritable(actor: Actor, res: ResourceDefinition, input: Record<string, unknown>, mode: 'create' | 'update') {
  const out: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    const f = res.fields.find((x) => x.key === k);
    if (!f) continue;
    if (fieldAccess(actor, res, f, mode) === 'edit') out[k] = v;
    else rejected.push(f.label);
  }
  return { values: out, rejected };
}

function scheduleGuard(d: Db, actor: Actor, candidate: Record<string, unknown>, selfId: string | undefined, overrideReason?: string) {
  const conflicts = findConflicts(d, candidate, actor.workspaceId, selfId);
  if (!conflicts.length) return null;
  const hard = conflicts.filter((c) => !c.overridable);
  if (hard.length || !overrideReason?.trim() || !can(actor, 'schedule.override')) {
    throw new ServiceError('conflict', hard.length ? 'This booking conflicts with an exclusive resource.' : 'This booking needs an authorized override.', { conflicts });
  }
  return conflicts;
}

function staffUser(staffId: unknown, workspaceId: string) {
  return demoUsers.find((u) => u.staffIds[workspaceId] === staffId);
}

export interface WriteOptions {
  idempotencyKey?: string;
  overrideReason?: string;
}

export function createRecord(actor: Actor, resKey: string, input: Record<string, unknown>, opts: WriteOptions = {}): Projected {
  const res = getResource(resKey);
  if (!perm(actor, resKey).create) throw new ServiceError('forbidden', `Your role cannot create ${res.labelPlural.toLowerCase()}.`);
  return commit((d) => {
    if (opts.idempotencyKey && d.idempotency[opts.idempotencyKey]) {
      const existing = d.records[resKey].find((r) => r.id === d.idempotency[opts.idempotencyKey!]);
      if (existing) return project(actor, res, existing);
    }
    const { values } = pickWritable(actor, res, input, 'create');
    const candidate: Record<string, unknown> = {};
    for (const f of res.fields) {
      if (f.computed) continue;
      if (f.key in values) candidate[f.key] = values[f.key];
      else if (f.defaultValue !== undefined) candidate[f.key] = f.defaultValue;
    }
    if (res.lifecycle) candidate[res.lifecycle.field] = res.lifecycle.initial;
    applyHiddenPolicy(res, candidate);
    if (resKey === 'patients') candidate.registeredOn = todayKey();
    if (resKey === 'invoices') candidate.amountPaid = 0;
    if (resKey === 'tasks' && !candidate.relatedLabel) candidate.relatedLabel = '';
    const editable = new Set(res.fields.filter((f) => fieldAccess(actor, res, f, 'create') === 'edit').map((f) => f.key));
    const errors = { ...validateValues(res, candidate, editable), ...inactiveMasterErrors(res, candidate) };
    if (Object.keys(errors).length) throw new ServiceError('validation', 'Please fix the highlighted fields.', { fieldErrors: errors });
    const overridden = resKey === 'appointments' ? scheduleGuard(d, actor, candidate, undefined, opts.overrideReason) : null;

    const now = new Date().toISOString();
    const record: RecordData = {
      ...candidate,
      id: nextId(d, res, actor.workspaceId),
      workspaceId: actor.workspaceId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.user.id,
    };
    d.records[resKey] = [record, ...(d.records[resKey] ?? [])];
    if (opts.idempotencyKey) d.idempotency[opts.idempotencyKey] = record.id;
    const correlationId = uid('cor');
    appendAudit(d, actor, { action: 'create', resource: resKey, recordId: record.id, summary: `Created ${res.label.toLowerCase()} ${record.id}`, correlationId });
    if (overridden) {
      appendAudit(d, actor, {
        action: 'schedule.override',
        resource: resKey,
        recordId: record.id,
        summary: `Booked despite ${overridden.length} warning(s). Reason: ${opts.overrideReason}`,
        correlationId,
      });
    }
    emitEvent(d, actor, { eventType: `${resKey}.created`, resourceId: res.id, recordId: record.id, correlationId, idempotencyKey: opts.idempotencyKey, payload: { id: record.id } });
    if (resKey === 'tasks') {
      const u = staffUser(record.assigneeId, actor.workspaceId);
      if (u && u.id !== actor.user.id) notify(d, { userId: u.id, workspaceId: actor.workspaceId, kind: 'assignment', title: `${actor.user.name} assigned you ${record.id}`, link: { resource: 'tasks', recordId: record.id } });
    }
    return project(actor, res, record);
  });
}

export function updateRecord(actor: Actor, resKey: string, id: string, patch: Record<string, unknown>, expectedVersion: number, opts: WriteOptions = {}): Projected {
  const res = getResource(resKey);
  return commit((d) => {
    const idx = d.records[resKey].findIndex((r) => r.id === id);
    const current = d.records[resKey][idx];
    if (!current || !canReadRecord(actor, res, current)) throw new ServiceError('not_found', `${res.label} ${id} was not found or you do not have access.`);
    if (!canUpdateRecord(actor, res, current)) throw new ServiceError('forbidden', `Your role cannot edit this ${res.label.toLowerCase()}.`);
    if (current.version !== expectedVersion) {
      throw new ServiceError('version_conflict', `${res.label} ${id} was changed by someone else (now version ${current.version}). Reload to see the latest before saving.`);
    }
    const { values, rejected } = pickWritable(actor, res, patch, 'update');
    if (rejected.length) throw new ServiceError('forbidden', `You cannot change: ${rejected.join(', ')}.`);
    const candidate = { ...current, ...values };
    applyHiddenPolicy(res, candidate);
    const editable = new Set(Object.keys(values));
    // Re-validate conditional dependants of changed fields too.
    res.fields.forEach((f) => {
      if (f.requiredWhen && editable.has(f.requiredWhen.field) && fieldAccess(actor, res, f, 'update') === 'edit') editable.add(f.key);
    });
    const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(current[k] ?? null)));
    const errors = { ...validateValues(res, candidate, editable), ...inactiveMasterErrors(res, changed) };
    if (Object.keys(errors).length) throw new ServiceError('validation', 'Please fix the highlighted fields.', { fieldErrors: errors });
    const scheduleChanged = resKey === 'appointments' && ['start', 'durationMin', 'roomId', 'clinicianId', 'visitMode'].some((k) => k in values && values[k] !== current[k]);
    const overridden = scheduleChanged ? scheduleGuard(d, actor, candidate, id, opts.overrideReason) : null;
    const changes = diff(res, current, candidate, actor);
    if (!changes.length) return project(actor, res, current);
    const next: RecordData = { ...candidate, version: current.version + 1, updatedAt: new Date().toISOString() };
    d.records[resKey][idx] = next;
    const correlationId = uid('cor');
    appendAudit(d, actor, { action: 'update', resource: resKey, recordId: id, summary: `Updated ${changes.map((c) => c.label).join(', ')}`, changes, correlationId });
    if (overridden) appendAudit(d, actor, { action: 'schedule.override', resource: resKey, recordId: id, summary: `Override reason: ${opts.overrideReason}`, correlationId });
    emitEvent(d, actor, {
      eventType: scheduleChanged ? 'appointments.rescheduled' : `${resKey}.updated`,
      resourceId: res.id,
      recordId: id,
      correlationId,
      payload: { fields: changes.map((c) => c.field), version: next.version },
    });
    if (resKey === 'tasks' && 'assigneeId' in values && values.assigneeId !== current.assigneeId) {
      const u = staffUser(values.assigneeId, actor.workspaceId);
      if (u && u.id !== actor.user.id) notify(d, { userId: u.id, workspaceId: actor.workspaceId, kind: 'assignment', title: `${actor.user.name} assigned you ${id}`, link: { resource: 'tasks', recordId: id } });
    }
    return project(actor, res, next);
  });
}

export function availableTransitions(actor: Actor, res: ResourceDefinition, record: RecordData) {
  if (!res.lifecycle) return [];
  const raw = getDb().records[res.key].find((r) => r.id === record.id);
  const current = String(record[res.lifecycle.field]);
  return res.lifecycle.transitions
    .filter((t) => t.from.includes(current))
    .map((t) => {
      let reason: string | undefined;
      if (!raw || !canUpdateRecord(actor, res, raw)) reason = `Your role (${actor.role.label}) cannot update this record`;
      else if (t.capability && !can(actor, t.capability)) reason = `Requires the "${t.capability}" permission`;
      return { ...t, disabledReason: reason };
    });
}

export function transitionRecord(actor: Actor, resKey: string, id: string, to: string, expectedVersion: number, opts: WriteOptions = {}): Projected {
  const res = getResource(resKey);
  const lc = res.lifecycle;
  if (!lc) throw new ServiceError('invalid_state', `${res.label} has no lifecycle.`);
  return commit((d) => {
    const idx = d.records[resKey].findIndex((r) => r.id === id);
    const current = d.records[resKey][idx];
    if (!current || !canReadRecord(actor, res, current)) throw new ServiceError('not_found', `${res.label} ${id} was not found.`);
    if (!canUpdateRecord(actor, res, current)) throw new ServiceError('forbidden', `Your role cannot change this ${res.label.toLowerCase()}.`);
    if (current.version !== expectedVersion) throw new ServiceError('version_conflict', `${res.label} ${id} changed since you loaded it. Reload and try again.`);
    const from = String(current[lc.field]);
    const t = lc.transitions.find((x) => x.to === to && x.from.includes(from));
    if (!t) throw new ServiceError('invalid_state', `Cannot move from "${masterLabel(res.fields.find((f) => f.key === lc.field)!.master!, from)}" to "${to}".`);
    if (t.capability && !can(actor, t.capability)) throw new ServiceError('forbidden', `"${t.action}" requires the ${t.capability} permission.`);
    const candidate = { ...current, [lc.field]: to };
    if (resKey === 'appointments' && to === 'scheduled') scheduleGuard(d, actor, candidate, id, opts.overrideReason);
    const next: RecordData = { ...candidate, version: current.version + 1, updatedAt: new Date().toISOString() };
    d.records[resKey][idx] = next;
    const correlationId = uid('cor');
    const master = res.fields.find((f) => f.key === lc.field)!.master!;
    appendAudit(d, actor, {
      action: 'transition',
      resource: resKey,
      recordId: id,
      summary: `${t.action}: ${masterLabel(master, from)} → ${masterLabel(master, to)}`,
      changes: [{ field: lc.field, label: 'Status', before: masterLabel(master, from), after: masterLabel(master, to) }],
      correlationId,
    });
    emitEvent(d, actor, { eventType: `${resKey}.status_changed`, resourceId: res.id, recordId: id, correlationId, payload: { from, to } });
    return project(actor, res, next);
  });
}

export function deleteRecord(actor: Actor, resKey: string, id: string) {
  const res = getResource(resKey);
  if (!perm(actor, resKey).delete) throw new ServiceError('forbidden', `Your role cannot delete ${res.labelPlural.toLowerCase()}.`);
  commit((d) => {
    const current = d.records[resKey].find((r) => r.id === id);
    if (!current || !canReadRecord(actor, res, current)) throw new ServiceError('not_found', `${res.label} ${id} was not found.`);
    // Referential integrity: refuse deletes that would orphan related records.
    const refs: string[] = [];
    for (const other of Object.keys(d.records)) {
      const r = getResource(other);
      r.fields
        .filter((f) => f.type === 'relation' && f.relation?.resource === resKey)
        .forEach((f) => {
          const n = d.records[other].filter((x) => x[f.key] === id).length;
          if (n) refs.push(`${n} ${r.labelPlural.toLowerCase()}`);
        });
    }
    if (refs.length) throw new ServiceError('invalid_state', `Cannot delete ${id}: referenced by ${refs.join(', ')}. Deactivate it instead.`);
    d.records[resKey] = d.records[resKey].filter((r) => r.id !== id);
    const correlationId = uid('cor');
    appendAudit(d, actor, { action: 'delete', resource: resKey, recordId: id, summary: `Deleted ${res.label.toLowerCase()} ${id}`, correlationId });
    emitEvent(d, actor, { eventType: `${resKey}.deleted`, resourceId: res.id, recordId: id, correlationId, payload: { id } });
  });
}

/**
 * Records a MANUAL payment entry (e.g. cash/cheque taken at the desk).
 * No card, bank or payer processing happens. Idempotent by key so a retried
 * submit never double-posts.
 */
export function recordPayment(actor: Actor, invoiceId: string, amount: number, method: string, expectedVersion: number, idempotencyKey: string): Projected {
  const res = getResource('invoices');
  if (!can(actor, 'billing.payment') || perm(actor, 'invoices').read === 'none') throw new ServiceError('forbidden', 'Your role cannot record payments.');
  return commit((d) => {
    if (d.idempotency[idempotencyKey]) return project(actor, res, d.records.invoices.find((r) => r.id === invoiceId)!);
    const idx = d.records.invoices.findIndex((r) => r.id === invoiceId);
    const current = d.records.invoices[idx];
    if (!current || !canReadRecord(actor, res, current)) throw new ServiceError('not_found', `Invoice ${invoiceId} was not found.`);
    if (current.version !== expectedVersion) throw new ServiceError('version_conflict', 'Invoice changed since you opened it. Reload and try again.');
    if (!['issued', 'partially_paid'].includes(String(current.status))) throw new ServiceError('invalid_state', 'Payments can only be recorded on issued invoices.');
    const full = withComputed(res, current);
    const balance = Number(full.balance);
    if (!(amount > 0)) throw new ServiceError('validation', 'Enter an amount greater than zero.', { fieldErrors: { amount: 'Must be greater than zero' } });
    if (amount > balance + 0.001) throw new ServiceError('validation', `Amount exceeds the balance of ${formatMoney(balance)}.`, { fieldErrors: { amount: `At most ${formatMoney(balance)}` } });
    const paid = Number(current.amountPaid || 0) + amount;
    const status = paid >= Number(full.total) - 0.001 ? 'paid' : 'partially_paid';
    const next: RecordData = { ...current, amountPaid: Math.round(paid * 100) / 100, status, version: current.version + 1, updatedAt: new Date().toISOString() };
    d.records.invoices[idx] = next;
    d.idempotency[idempotencyKey] = invoiceId;
    const correlationId = uid('cor');
    appendAudit(d, actor, {
      action: 'payment.recorded',
      resource: 'invoices',
      recordId: invoiceId,
      summary: `Recorded manual ${method} payment of ${formatMoney(amount)} (no processor involved)`,
      changes: [{ field: 'amountPaid', label: 'Paid', before: formatMoney(Number(current.amountPaid || 0)), after: formatMoney(paid) }],
      correlationId,
    });
    emitEvent(d, actor, { eventType: 'invoices.payment_recorded', resourceId: res.id, recordId: invoiceId, correlationId, idempotencyKey, payload: { amount, method }, classification: 'financial' });
    return project(actor, res, next);
  });
}
