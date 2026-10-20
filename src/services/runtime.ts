/**
 * Resource Runtime (mock service). Owns business records. Every read is
 * projected through the simulated Authorization Service (row scope, field
 * hide/mask); every write is validated, version-checked, audited and emits a
 * versioned domain event into the simulated outbox.
 */
import { rememberLastUsed } from './lastUsed';
import type { FieldAccess, FieldDefinition, FilterGroup, RecordData, ResourceDefinition } from '../metadata/types';
import { formatDate, formatDateTime } from '../lib/dates';
import { nowIso } from '../lib/clock';
import { fyCode } from '../lib/fy';
export { fyCode };
import { formatMoney, pct } from '../lib/format';
import { uid } from '../lib/ids';
import { maskEmail, maskIdentifier, maskPhone, RESTRICTED } from '../lib/phiMask';
import { type Actor, canReadRecord, canUpdateRecord, can, fieldAccess, fieldAccessMap, perm, queryableField } from './authz';
import { type HookContext, hooksFor } from './resourceHooks';
import { commit, getDb } from './db';
import { evalGroup, systemDateField } from './filter';
import { appendAudit, emitEvent } from './ledger';
import { getResource, masterLabel } from './registry';
import { type Db, ServiceError } from './types';
import { inactiveMasterErrors, isEmpty, isVisible, validateValues } from './validation';
import { L } from '../constants/labels';

const E = L.common.errors;
const AU = L.common.audit;

function applyHiddenPolicy(res: ResourceDefinition, values: Record<string, unknown>) {
  res.fields.forEach((f) => {
    if (f.clearWhenHidden && !isVisible(f, values)) values[f.key] = null;
  });
}

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
  // A related record outside the viewer's scope shows a neutral label, never its id or name.
  if (actor && !canReadRecord(actor, res, r)) return L.common.states.restricted;
  const custom = hooksFor(resKey).title;
  if (custom) return custom(r);
  const title = res.fields.find((f) => f.key === res.titleField);
  if (!title) return String(r[res.titleField] ?? r.id);
  if (title.type === 'relation') return recordTitle(title.relation!.resource, r[title.key], actor);
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
      return E.image;
    case 'date':
      return formatDate(String(v));
    case 'datetime':
      return formatDateTime(String(v));
    case 'money':
      return formatMoney(Number(v));
    case 'boolean':
      return v ? L.common.actions.yes : L.common.actions.no;
    case 'progress':
      return pct(Number(v));
    case 'lineitems':
      return E.items((v as unknown[]).length);
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
  const seesCost = actor.role.sensitivity.financial !== 'hide';
  for (const f of res.fields) {
    const a = access[f.key];
    if (a === 'hide') continue;
    let v = a === 'mask' ? maskValue(f, full[f.key]) : full[f.key];
    // BR-19: landed cost inside line items follows the financial classification too.
    if (f.type === 'lineitems' && !seesCost && Array.isArray(v)) v = (v as Record<string, unknown>[]).map(({ landedCost: _omit, ...rest }) => rest);
    out[f.key] = v;
  }
  return { record: out, access, canUpdate: canUpdateRecord(actor, res, raw) };
}

export function getRecord(actor: Actor, resKey: string, id: string): Projected {
  const res = getResource(resKey);
  if (perm(actor, resKey).read === 'none') throw new ServiceError('forbidden', E.noAccessTo(res.labelPlural));
  const raw = getDb().records[resKey]?.find((r) => r.id === id);
  // Not-found and not-authorized are indistinguishable to avoid disclosure across workspaces/scopes.
  if (!raw || !canReadRecord(actor, res, raw)) throw new ServiceError('not_found', E.notFoundOrNoAccess(res.label, id));
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
  if (perm(actor, resKey).read === 'none') throw new ServiceError('forbidden', E.noAccessTo(res.labelPlural));
  const fields = new Map(res.fields.map((f) => [f.key, f]));
  const ignored = new Set<string>();
  const resolveFactory = (r: RecordData) => (key: string) => {
    if (key === 'id') return { value: r.id };
    const f = fields.get(key) ?? systemDateField(key);
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


/** Ids come from per-series counters so deleted ids are never reused. */
function nextId(d: Db, res: ResourceDefinition): string {
  if (res.idFormat === 'fy') {
    const fy = fyCode();
    const key = `${res.key}:${fy}`;
    d.counters[key] = (d.counters[key] ?? 0) + 1;
    return `${res.idPrefix}-${fy}-${String(d.counters[key]).padStart(5, '0')}`;
  }
  d.counters[res.key] = Math.max(d.counters[res.key] ?? 1000, 1000) + 1;
  return `${res.idPrefix}-${d.counters[res.key]}`;
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
      before: red ? E.redacted : f.type === 'lineitems' ? E.previousItems : displayText(f, a, actor) || E.na,
      after: red ? E.redacted : f.type === 'lineitems' ? E.updatedItems : displayText(f, b, actor) || E.na,
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

export interface WriteOptions {
  idempotencyKey?: string;
}

export function createRecord(actor: Actor, resKey: string, input: Record<string, unknown>, opts: WriteOptions = {}): Projected {
  const res = getResource(resKey);
  if (!perm(actor, resKey).create) throw new ServiceError('forbidden', E.cannotCreate(res.labelPlural.toLowerCase()));
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
    const correlationId = uid('cor');
    const hooks = hooksFor(resKey);
    hooks.beforeCreate?.({ d, actor, correlationId }, candidate);
    const editable = new Set(res.fields.filter((f) => fieldAccess(actor, res, f, 'create') === 'edit').map((f) => f.key));
    const errors = { ...validateValues(res, candidate, editable), ...inactiveMasterErrors(res, candidate) };
    if (Object.keys(errors).length) throw new ServiceError('validation', L.common.form.fixHighlighted, { fieldErrors: errors });

    const at = nowIso();
    const record: RecordData = {
      ...candidate,
      id: nextId(d, res),
      workspaceId: actor.workspaceId,
      version: 1,
      createdAt: at,
      updatedAt: at,
      createdBy: actor.user.id,
    };
    d.records[resKey] = [record, ...(d.records[resKey] ?? [])];
    rememberLastUsed(d, actor, res, record);
    if (opts.idempotencyKey) d.idempotency[opts.idempotencyKey] = record.id;
    appendAudit(d, actor, { action: 'create', resource: resKey, recordId: record.id, summary: AU.created(res.label.toLowerCase(), record.id), correlationId });
    emitEvent(d, actor, { eventType: `${resKey}.created`, resourceId: res.id, recordId: record.id, correlationId, idempotencyKey: opts.idempotencyKey, payload: { id: record.id } });
    hooks.afterCreate?.({ d, actor, correlationId }, record);
    return project(actor, res, record);
  });
}

export function updateRecord(actor: Actor, resKey: string, id: string, patch: Record<string, unknown>, expectedVersion: number): Projected {
  const res = getResource(resKey);
  return commit((d) => {
    const idx = d.records[resKey].findIndex((r) => r.id === id);
    const current = d.records[resKey][idx];
    if (!current || !canReadRecord(actor, res, current)) throw new ServiceError('not_found', E.notFoundOrNoAccess(res.label, id));
    if (!canUpdateRecord(actor, res, current)) throw new ServiceError('forbidden', E.cannotEdit(res.label.toLowerCase()));
    if (current.version !== expectedVersion) {
      throw new ServiceError('version_conflict', E.versionConflict(res.label, id, current.version));
    }
    const { values, rejected } = pickWritable(actor, res, patch, 'update');
    if (rejected.length) throw new ServiceError('forbidden', E.cannotChangeFields(rejected.join(', ')));
    const candidate = { ...current, ...values };
    applyHiddenPolicy(res, candidate);
    const editable = new Set(Object.keys(values));
    // Re-validate conditional dependants of changed fields too.
    res.fields.forEach((f) => {
      if (f.requiredWhen && editable.has(f.requiredWhen.field) && fieldAccess(actor, res, f, 'update') === 'edit') editable.add(f.key);
    });
    const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(current[k] ?? null)));
    const errors = { ...validateValues(res, candidate, editable), ...inactiveMasterErrors(res, changed) };
    if (Object.keys(errors).length) throw new ServiceError('validation', L.common.form.fixHighlighted, { fieldErrors: errors });
    const correlationId = uid('cor');
    const hooks = hooksFor(resKey);
    hooks.beforeUpdate?.({ d, actor, correlationId }, current, candidate);
    const changes = diff(res, current, candidate, actor);
    if (!changes.length) return project(actor, res, current);
    const next: RecordData = { ...candidate, version: current.version + 1, updatedAt: nowIso() };
    d.records[resKey][idx] = next;
    appendAudit(d, actor, { action: 'update', resource: resKey, recordId: id, summary: AU.updated(changes.map((c) => c.label).join(', ')), changes, correlationId });
    emitEvent(d, actor, { eventType: `${resKey}.updated`, resourceId: res.id, recordId: id, correlationId, payload: { fields: changes.map((c) => c.field), version: next.version } });
    hooks.afterUpdate?.({ d, actor, correlationId }, current, next);
    return project(actor, res, next);
  });
}

export function availableTransitions(actor: Actor, res: ResourceDefinition, record: RecordData) {
  if (!res.lifecycle) return [];
  const raw = getDb().records[res.key].find((r) => r.id === record.id);
  const current = String(record[res.lifecycle.field]);
  return res.lifecycle.transitions
    .filter((t) => t.from.includes(current) && (!t.when || !raw || t.when(raw)))
    .map((t) => {
      let reason: string | undefined;
      if (!raw || !canUpdateRecord(actor, res, raw)) reason = E.roleCannotUpdate(actor.role.label);
      else if (t.capability && !can(actor, t.capability)) reason = E.requiresPermission(actor.role.label);
      else reason = hooksFor(res.key).transitionBlocked?.(actor, raw, t.to);
      return { ...t, disabledReason: reason };
    });
}

export function transitionRecord(actor: Actor, resKey: string, id: string, to: string, expectedVersion: number, extra: Record<string, unknown> = {}): Projected {
  const res = getResource(resKey);
  const lc = res.lifecycle;
  if (!lc) throw new ServiceError('invalid_state', E.noLifecycle(res.label));
  return commit((d) => {
    const idx = d.records[resKey].findIndex((r) => r.id === id);
    const current = d.records[resKey][idx];
    if (!current || !canReadRecord(actor, res, current)) throw new ServiceError('not_found', E.notFound(res.label, id));
    if (!canUpdateRecord(actor, res, current)) throw new ServiceError('forbidden', E.cannotChange(res.label.toLowerCase()));
    if (current.version !== expectedVersion) throw new ServiceError('version_conflict', E.changedSinceLoad(res.label, id));
    const from = String(current[lc.field]);
    const t = lc.transitions.find((x) => x.to === to && x.from.includes(from) && (!x.when || x.when(current)));
    if (!t) throw new ServiceError('invalid_state', E.badTransition(masterLabel(res.fields.find((f) => f.key === lc.field)!.master!, from), masterLabel(res.fields.find((f) => f.key === lc.field)!.master!, to)));
    if (t.capability && !can(actor, t.capability)) throw new ServiceError('forbidden', E.needsPermission(t.action, actor.role.label));
    const blocked = hooksFor(resKey).transitionBlocked?.(actor, current, to);
    if (blocked) throw new ServiceError('forbidden', blocked);
    const correlationId = uid('cor');
    const hooks = hooksFor(resKey);
    // `extra` carries values captured with the action (e.g. a lost reason); hooks validate them.
    const candidate = { ...current, ...extra, [lc.field]: to };
    hooks.beforeTransition?.({ d, actor, correlationId }, candidate as RecordData, to);
    const next: RecordData = { ...candidate, version: current.version + 1, updatedAt: nowIso() };
    d.records[resKey][idx] = next;
    const master = res.fields.find((f) => f.key === lc.field)!.master!;
    appendAudit(d, actor, {
      action: 'transition',
      resource: resKey,
      recordId: id,
      summary: AU.transition(t.action, masterLabel(master, from), masterLabel(master, to)),
      changes: [{ field: lc.field, label: 'Status', before: masterLabel(master, from), after: masterLabel(master, to) }],
      correlationId,
    });
    emitEvent(d, actor, { eventType: `${resKey}.status_changed`, resourceId: res.id, recordId: id, correlationId, payload: { from, to } });
    hooks.afterTransition?.({ d, actor, correlationId }, current, next);
    return project(actor, res, next);
  });
}

/** Soft delete (COM-10): the record moves to the recycle bin; an administrator can restore or purge it. */
export function deleteRecord(actor: Actor, resKey: string, id: string) {
  const res = getResource(resKey);
  if (!perm(actor, resKey).delete) throw new ServiceError('forbidden', E.cannotDelete(res.labelPlural.toLowerCase()));
  commit((d) => {
    const current = d.records[resKey].find((r) => r.id === id);
    if (!current || !canReadRecord(actor, res, current)) throw new ServiceError('not_found', E.notFound(res.label, id));
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
    if (refs.length) throw new ServiceError('invalid_state', E.referenced(id, refs.join(', ')));
    const correlationId = uid('cor');
    // Domain veto / repair (e.g. quotations keep exactly one latest version); runs before the record leaves.
    hooksFor(resKey).beforeDelete?.({ d, actor, correlationId }, current);
    d.records[resKey] = d.records[resKey].filter((r) => r.id !== id);
    d.recycle.unshift({ id: uid('bin'), workspaceId: actor.workspaceId, resource: resKey, record: current, deletedAt: nowIso(), deletedBy: actor.user.id });
    appendAudit(d, actor, { action: 'delete', resource: resKey, recordId: id, summary: AU.recycled(res.label.toLowerCase(), id), correlationId });
    emitEvent(d, actor, { eventType: `${resKey}.deleted`, resourceId: res.id, recordId: id, correlationId, payload: { id } });
  });
}

export function listRecycleBin(actor: Actor) {
  if (!can(actor, 'recycle.manage')) throw new ServiceError('forbidden', E.recycleOnly);
  return getDb().recycle.filter((e) => e.workspaceId === actor.workspaceId);
}

export function restoreRecord(actor: Actor, binId: string) {
  if (!can(actor, 'recycle.manage')) throw new ServiceError('forbidden', E.restoreOnly);
  commit((d) => {
    const entry = d.recycle.find((e) => e.id === binId && e.workspaceId === actor.workspaceId);
    if (!entry) throw new ServiceError('not_found', E.notInBin);
    if (d.records[entry.resource].some((r) => r.id === entry.record.id)) throw new ServiceError('conflict', E.alreadyExists(entry.record.id));
    d.records[entry.resource] = [{ ...entry.record, version: entry.record.version + 1, updatedAt: nowIso() }, ...d.records[entry.resource]];
    d.recycle = d.recycle.filter((e) => e.id !== binId);
    appendAudit(d, actor, { action: 'restore', resource: entry.resource, recordId: entry.record.id, summary: AU.restored(entry.record.id), correlationId: uid('cor') });
  });
}

export function purgeRecord(actor: Actor, binId: string) {
  if (!can(actor, 'recycle.manage')) throw new ServiceError('forbidden', E.purgeOnly);
  commit((d) => {
    const entry = d.recycle.find((e) => e.id === binId && e.workspaceId === actor.workspaceId);
    if (!entry) return;
    d.recycle = d.recycle.filter((e) => e.id !== binId);
    appendAudit(d, actor, { action: 'purge', resource: entry.resource, recordId: entry.record.id, summary: AU.purged(entry.record.id), correlationId: uid('cor') });
  });
}

// ---------------------------------------------------------------- system hand-offs (inside an existing commit)

/**
 * Creates a record as a workflow side effect (e.g. lead qualified → opportunity, delivery →
 * installation job). Runs inside the caller's commit: defaults and the lifecycle's initial
 * status apply, the id comes from the resource's series, and audit/event/afterCreate hooks
 * run. No permission check — the triggering action was already authorized.
 * Validation is NOT skipped: missing required values throw, so hand-offs stay consistent.
 */
export function insertRecordIn(ctx: HookContext, resKey: string, values: Record<string, unknown>, opts: { validate?: boolean } = {}): RecordData {
  const { d, actor, correlationId } = ctx;
  const res = getResource(resKey);
  const candidate: Record<string, unknown> = {};
  for (const f of res.fields) {
    if (f.computed) continue;
    if (f.key in values) candidate[f.key] = values[f.key];
    else if (f.defaultValue !== undefined) candidate[f.key] = typeof f.defaultValue === 'object' ? JSON.parse(JSON.stringify(f.defaultValue)) : f.defaultValue;
  }
  if (res.lifecycle && !(res.lifecycle.field in values)) candidate[res.lifecycle.field] = res.lifecycle.initial;
  hooksFor(resKey).beforeCreate?.(ctx, candidate);
  if (opts.validate !== false) {
    const errors = validateValues(res, candidate);
    if (Object.keys(errors).length) throw new ServiceError('validation', E.couldNotCreate(res.label.toLowerCase(), Object.values(errors).join('; ')), { fieldErrors: errors });
  }
  const at = nowIso();
  const record: RecordData = { ...candidate, id: nextId(d, res), workspaceId: actor.workspaceId, version: 1, createdAt: at, updatedAt: at, createdBy: actor.user.id };
  d.records[resKey] = [record, ...(d.records[resKey] ?? [])];
  appendAudit(d, actor, { action: 'create', actorType: 'workflow', resource: resKey, recordId: record.id, summary: AU.createdAuto(res.label.toLowerCase(), record.id), correlationId });
  emitEvent(d, actor, { eventType: `${resKey}.created`, resourceId: res.id, recordId: record.id, correlationId, payload: { id: record.id, automatic: true } });
  hooksFor(resKey).afterCreate?.(ctx, record);
  return record;
}

/** Patches a record as a workflow side effect (audited as workflow). Returns the new record. */
export function patchRecordIn(ctx: HookContext, resKey: string, id: string, patch: Record<string, unknown>, summary?: string): RecordData {
  const { d, actor, correlationId } = ctx;
  const res = getResource(resKey);
  const idx = (d.records[resKey] ?? []).findIndex((r) => r.id === id);
  if (idx < 0) throw new ServiceError('not_found', E.notFound(res.label, id));
  const before = d.records[resKey][idx];
  const next: RecordData = { ...before, ...patch, version: before.version + 1, updatedAt: nowIso() };
  const changes = diff(res, before, next, actor);
  d.records[resKey][idx] = next;
  if (changes.length) {
    appendAudit(d, actor, { action: res.lifecycle && res.lifecycle.field in patch ? 'transition' : 'update', actorType: 'workflow', resource: resKey, recordId: id, summary: summary ?? AU.updatedAuto(changes.map((c) => c.label).join(', ')), changes, correlationId });
    emitEvent(d, actor, { eventType: `${resKey}.updated`, resourceId: res.id, recordId: id, correlationId, payload: { fields: changes.map((c) => c.field), automatic: true } });
  }
  return next;
}

/** Records of a resource inside a commit (no scope filter — for hand-off logic only). */
export const recordsIn = (ctx: HookContext, resKey: string): RecordData[] => ctx.d.records[resKey] ?? [];
