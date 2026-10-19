/**
 * Customers domain operations (sync, engine-side). Pages call them through services/api/customers.ts.
 *  - mergeCustomers      CUS-06  admin merge with full audit
 *  - transferOwnership   CUS-10 / BR-52  bulk owner change with history
 *  - convertContactToLead CUS-05 / BR-04
 *  - syncFromErp         CUS-09  simulated ERP read
 */
import type { RecordData } from '../../metadata/types';
import { addDays, nowLocal, todayKey } from '../../lib/dates';
import { nowIso } from '../../lib/clock';
import { uid } from '../../lib/ids';
import { type Actor, can, canReadRecord, canUpdateRecord, perm } from '../authz';
import { commit, getDb } from '../db';
import { appendAudit, notify } from '../ledger';
import { activeMasterValues, allResources, getResource } from '../registry';
import { insertRecordIn, patchRecordIn } from '../runtime';
import { userOfStaff } from '../lookups';
import { ServiceError } from '../types';
import { L } from '../../constants/labels';
import { findDuplicateGroups } from './duplicates';

export const isRegistered = (resKey: string) => allResources().some((r) => r.key === resKey);

// ---------------------------------------------------------------- duplicates & merge

export function listDuplicateGroups(actor: Actor) {
  if (!can(actor, 'customers.merge')) throw new ServiceError('forbidden', L.customers.messages.onlyAdminDuplicates);
  const d = getDb();
  const ws = (r: RecordData) => r.workspaceId === actor.workspaceId;
  return findDuplicateGroups((d.records.customers ?? []).filter(ws), (d.records.contacts ?? []).filter(ws));
}

/** Fields across all resources that point at a customer. */
function customerRefFields(): { resKey: string; field: string }[] {
  const out: { resKey: string; field: string }[] = [];
  allResources().forEach((r) =>
    r.fields.forEach((f) => {
      if (f.key === 'customerId' || (f.type === 'relation' && f.relation?.resource === 'customers')) out.push({ resKey: r.key, field: f.key });
    }),
  );
  return out;
}

/**
 * Merges `removeId` into `keepId`: every record referencing the removed customer (contacts,
 * addresses, leads, orders, machines, tickets, activities …) is re-pointed, empty fields on the
 * survivor are filled from the duplicate, and the duplicate goes to the recycle bin.
 */
export function mergeCustomers(actor: Actor, keepId: string, removeId: string): { moved: number } {
  if (!can(actor, 'customers.merge')) throw new ServiceError('forbidden', L.customers.messages.onlyAdminMerge);
  if (keepId === removeId) throw new ServiceError('validation', L.customers.messages.mergeSame);
  return commit((d) => {
    const all = d.records.customers ?? [];
    const keep = all.find((c) => c.id === keepId && c.workspaceId === actor.workspaceId);
    const drop = all.find((c) => c.id === removeId && c.workspaceId === actor.workspaceId);
    if (!keep || !drop) throw new ServiceError('not_found', L.customers.messages.mergeMissing);
    const correlationId = uid('cor');
    let moved = 0;
    for (const { resKey, field } of customerRefFields()) {
      (d.records[resKey] ?? []).forEach((r, i) => {
        if (r[field] === removeId && !(resKey === 'customers' && r.id === removeId)) {
          d.records[resKey][i] = { ...r, [field]: keepId, version: r.version + 1, updatedAt: nowIso() };
          moved++;
        }
      });
    }
    // Survivor keeps its values; blanks are filled from the duplicate. Lists are united. ERP figures are read-only
    // (CUS-09) and are not copied. A group / dealer link between the two would point at itself after the merge.
    const fill: Record<string, unknown> = {};
    const survivor = d.records.customers.find((c) => c.id === keepId)!;
    getResource('customers').fields.forEach((f) => {
      if (f.readOnly) return;
      const a = survivor[f.key];
      const b = drop[f.key];
      if (Array.isArray(a) || Array.isArray(b)) fill[f.key] = [...new Set([...((a as string[]) ?? []), ...((b as string[]) ?? [])])];
      else if ((a === undefined || a === null || a === '') && b !== undefined && b !== null && b !== '') fill[f.key] = b;
    });
    (['parentId', 'dealerId'] as const).forEach((k) => {
      if ((fill[k] ?? survivor[k]) === keepId || (fill[k] ?? survivor[k]) === removeId) fill[k] = null;
    });
    patchRecordIn({ d, actor, correlationId }, 'customers', keepId, fill, L.customers.messages.mergeHistory(removeId, String(drop.name)));
    d.records.customers = d.records.customers.filter((c) => c.id !== removeId);
    d.recycle.unshift({ id: uid('bin'), workspaceId: actor.workspaceId, resource: 'customers', record: drop, deletedAt: nowIso(), deletedBy: actor.user.id });
    appendAudit(d, actor, { action: 'customers.merge', resource: 'customers', recordId: keepId, summary: L.customers.messages.mergeAudit(removeId, String(drop.name), keepId, moved), correlationId });
    return { moved };
  });
}

// ---------------------------------------------------------------- ownership transfer (BR-52)

const OPEN_LEAD = ['new', 'contacted', 'nurture'];
const OPEN_OPP = ['needs_assessment', 'demo', 'proposal', 'negotiation'];
const OPEN_TASK = ['todo', 'in_progress'];

interface TransferTarget {
  resKey: string;
  field: string;
  label: string;
  open: (r: RecordData) => boolean;
}
const TARGETS: TransferTarget[] = [
  { resKey: 'customers', field: 'ownerId', label: L.customers.transfer.targets.customers, open: () => true },
  { resKey: 'contacts', field: 'ownerId', label: L.customers.transfer.targets.contacts, open: () => true },
  { resKey: 'leads', field: 'ownerId', label: L.customers.transfer.targets.leads, open: (r) => OPEN_LEAD.includes(String(r.status)) },
  { resKey: 'opportunities', field: 'ownerId', label: L.customers.transfer.targets.opportunities, open: (r) => OPEN_OPP.includes(String(r.stage)) },
  { resKey: 'tasks', field: 'assigneeId', label: L.customers.transfer.targets.tasks, open: (r) => OPEN_TASK.includes(String(r.status)) },
];

export function canTransfer(actor: Actor) {
  return can(actor, 'customers.transfer');
}

/** What a transfer would move (closed records always keep their original owner). */
export function previewTransfer(actor: Actor, fromStaffId: string) {
  if (!canTransfer(actor)) throw new ServiceError('forbidden', L.customers.messages.noTransfer);
  const d = getDb();
  return TARGETS.filter((t) => isRegistered(t.resKey)).map((t) => {
    const res = getResource(t.resKey);
    const rows = (d.records[t.resKey] ?? []).filter((r) => r.workspaceId === actor.workspaceId && r[t.field] === fromStaffId && t.open(r) && canReadRecord(actor, res, r));
    return { resKey: t.resKey, label: t.label, count: rows.length };
  });
}

export function transferOwnership(actor: Actor, fromStaffId: string, toStaffId: string, reason: string): { moved: Record<string, number> } {
  if (!canTransfer(actor)) throw new ServiceError('forbidden', L.customers.messages.noTransfer);
  if (!fromStaffId || !toStaffId) throw new ServiceError('validation', L.customers.messages.chooseBoth, { fieldErrors: { from: !fromStaffId ? L.customers.messages.required : '', to: !toStaffId ? L.customers.messages.required : '' } });
  if (fromStaffId === toStaffId) throw new ServiceError('validation', L.customers.messages.chooseDifferent, { fieldErrors: { to: L.customers.messages.mustDiffer } });
  if (reason.trim().length < 5) throw new ServiceError('validation', L.customers.messages.reasonMin, { fieldErrors: { reason: L.customers.messages.reasonMinField } });
  return commit((d) => {
    const to = (d.records.employees ?? []).find((e) => e.id === toStaffId);
    if (!to || to.status === 'inactive') throw new ServiceError('validation', L.customers.messages.inactiveOwner, { fieldErrors: { to: L.customers.messages.inactiveOwnerField } });
    const ctx = { d, actor, correlationId: uid('cor') };
    const moved: Record<string, number> = {};
    for (const t of TARGETS) {
      if (!isRegistered(t.resKey)) continue;
      const res = getResource(t.resKey);
      const ids = (d.records[t.resKey] ?? []).filter((r) => r.workspaceId === actor.workspaceId && r[t.field] === fromStaffId && t.open(r) && canReadRecord(actor, res, r)).map((r) => r.id);
      ids.forEach((id) => patchRecordIn(ctx, t.resKey, id, { [t.field]: toStaffId }, L.customers.messages.transferHistory(reason.trim())));
      moved[t.label] = ids.length;
    }
    appendAudit(d, actor, { action: 'ownership.transfer', resource: 'employees', recordId: fromStaffId, summary: L.customers.messages.transferAudit(Object.entries(moved).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', '), fromStaffId, toStaffId, reason.trim()), correlationId: ctx.correlationId });
    const u = userOfStaff(toStaffId);
    if (u && u.id !== actor.user.id) notify(d, { userId: u.id, workspaceId: actor.workspaceId, kind: 'assignment', title: L.customers.messages.transferNotify(actor.user.name, Object.values(moved).reduce((a, b) => a + b, 0)), link: { page: 'customers' } });
    return { moved };
  });
}

// ---------------------------------------------------------------- contact pool → lead (BR-04)

export interface ConvertInput {
  contactId: string;
  /** Required when the contact has no company yet: the company is created inline. */
  companyName?: string;
  territoryId?: string;
  billingState?: string;
  divisionId: string;
  productType: string;
  ownerId: string;
  nextFollowUpAt: string;
  requirement?: string;
  /** BR-06: required when the contact came from an exhibition. */
  eventName?: string;
}

const CITY_ALIASES: Record<string, string> = { delhi: 'delhi_ncr', 'new delhi': 'delhi_ncr', noida: 'delhi_ncr', gurugram: 'delhi_ncr', gurgaon: 'delhi_ncr', bangalore: 'bengaluru', bombay: 'mumbai', madras: 'chennai', tirupur: 'tiruppur' };

/** Territory / hub (and its billing state) for a contact's city, when the city is a hub (BR-04 pre-fill). */
export function territoryForCity(city: unknown): { territoryId: string; billingState: string } | undefined {
  const c = String(city ?? '').trim().toLowerCase();
  if (!c) return undefined;
  const key = CITY_ALIASES[c] ?? c;
  const t = activeMasterValues('territory').find((m) => m.key === key || m.label.toLowerCase() === c);
  return t ? { territoryId: t.key, billingState: String(t.parent ?? '') } : undefined;
}

export function convertContactToLead(actor: Actor, input: ConvertInput): { leadId: string; customerId: string } {
  if (!isRegistered('leads')) throw new ServiceError('invalid_state', L.customers.messages.leadsUnavailable);
  if (!perm(actor, 'leads').create) throw new ServiceError('forbidden', L.customers.messages.noLeadCreate);
  const errors: Record<string, string> = {};
  if (!input.divisionId) errors.divisionId = L.customers.messages.divisionRequired;
  if (!input.productType) errors.productType = L.customers.messages.productTypeRequired;
  if (!input.ownerId) errors.ownerId = L.customers.messages.leadOwnerRequired;
  if (!input.nextFollowUpAt) errors.nextFollowUpAt = L.customers.messages.followUpRequired;
  else if (input.nextFollowUpAt < todayKey()) errors.nextFollowUpAt = L.customers.messages.followUpPast;
  return commit((d) => {
    const contact = (d.records.contacts ?? []).find((c) => c.id === input.contactId);
    if (!contact || !canReadRecord(actor, getResource('contacts'), contact)) throw new ServiceError('not_found', L.customers.messages.contactNotFound);
    if (contact.poolStatus === 'converted') throw new ServiceError('invalid_state', L.customers.messages.alreadyConverted);
    if (contact.source === 'exhibition' && !input.eventName?.trim()) errors.eventName = L.customers.messages.eventRequired;
    if (!contact.customerId) {
      // Pre-fill territory and billing state from the contact's city when not chosen (the lead's state follows the company).
      const guess = territoryForCity(contact.city);
      if (!input.territoryId && guess) input = { ...input, territoryId: guess.territoryId };
      if (!input.billingState && input.territoryId) input = { ...input, billingState: String(activeMasterValues('territory').find((t) => t.key === input.territoryId)?.parent ?? '') || undefined };
      if (!input.companyName?.trim()) errors.companyName = L.customers.messages.companyRequired;
      if (!input.territoryId) errors.territoryId = L.customers.messages.territoryRequired;
      if (!input.billingState) errors.billingState = L.customers.messages.stateRequired;
    }
    if (Object.values(errors).some(Boolean)) throw new ServiceError('validation', L.customers.messages.fixFields, { fieldErrors: errors });
    const ctx = { d, actor, correlationId: uid('cor') };
    let customerId = String(contact.customerId ?? '');
    if (!customerId) {
      const created = insertRecordIn(ctx, 'customers', {
        name: input.companyName!.trim(),
        category: 'prospect',
        divisionIds: [input.divisionId],
        territoryId: input.territoryId,
        billingState: input.billingState,
        ownerId: input.ownerId,
        status: 'active',
      });
      customerId = created.id;
    }
    // Link the contact first: the lead requires a contact of its own customer.
    patchRecordIn(ctx, 'contacts', contact.id, { customerId, divisionIds: [...new Set([...((contact.divisionIds as string[]) ?? []), input.divisionId])] }, L.customers.messages.linkedOnConversion);
    const lead = insertRecordIn(ctx, 'leads', {
      customerId,
      contactId: contact.id,
      divisionId: input.divisionId,
      sourceId: contact.source || 'cold_call',
      eventName: input.eventName?.trim() || null,
      productType: input.productType,
      requirement: input.requirement ?? '',
      ownerId: input.ownerId,
      status: 'new',
      nextFollowUpAt: input.nextFollowUpAt,
      city: contact.city ?? '',
    });
    patchRecordIn(ctx, 'contacts', contact.id, { poolStatus: 'converted' }, L.customers.messages.convertedHistory(lead.id));
    const owner = userOfStaff(input.ownerId);
    if (owner && owner.id !== actor.user.id) notify(d, { userId: owner.id, workspaceId: actor.workspaceId, kind: 'assignment', title: L.customers.messages.convertNotify(lead.id, String(contact.name)), link: { resource: 'leads', recordId: lead.id } });
    return { leadId: lead.id, customerId };
  });
}

// ---------------------------------------------------------------- ERP (simulated, CUS-09)

/** Deterministic pseudo-ERP figures per customer — stands in for the real ERP read. */
export function syncFromErp(actor: Actor, customerId: string) {
  const res = getResource('customers');
  return commit((d) => {
    const c = (d.records.customers ?? []).find((x) => x.id === customerId);
    if (!c || !canReadRecord(actor, res, c)) throw new ServiceError('not_found', L.customers.messages.customerNotFound);
    if (!canUpdateRecord(actor, res, c) && !can(actor, 'approve.finance')) throw new ServiceError('forbidden', L.customers.messages.noErpRefresh);
    const seed = [...customerId].reduce((a, ch) => a + ch.charCodeAt(0), 0) + new Date().getDate();
    const limit = Number(c.creditLimit) || (5 + (seed % 46)) * 100_000;
    const outstanding = Math.round(limit * (((seed * 37) % 70) / 100));
    const overdue = seed % 3 === 0 ? Math.round(outstanding * 0.3) : 0;
    patchRecordIn({ d, actor, correlationId: uid('cor') }, 'customers', customerId, { creditLimit: limit, outstanding, overdue, erpSyncedAt: nowLocal() }, L.customers.messages.erpHistory);
    return { creditLimit: limit, outstanding, overdue };
  });
}

/** Default follow-up for conversions: tomorrow. */
export const defaultFollowUp = () => addDays(todayKey(), 1);
