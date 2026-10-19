/**
 * Leads domain service (LEAD-01…13, BR-05…10). Synchronous engine-side logic; pages call the
 * async wrappers in services/api/leads.ts.
 */
import type { RecordData } from '../../metadata/types';
import { appPack } from '../../domain/pack';
import { addDays, todayKey } from '../../lib/dates';
import { nowIso } from '../../lib/clock';
import { uid } from '../../lib/ids';
import { normaliseMobile, validateEmail, validateMobile } from '../../lib/validators';
import { type Actor, can, canReadRecord, canUpdateRecord, perm } from '../authz';
import { commit, getDb } from '../db';
import { appendAudit, emitEvent, notify } from '../ledger';
import { byId, managerOf, userOfStaff } from '../lookups';
import { queueMessage } from '../outbox';
import { getPolicies } from '../policies';
import { activeMasterValues, allResources, getResource, masterLabel } from '../registry';
import type { HookContext } from '../resourceHooks';
import { createRecord, insertRecordIn, queryRecords, recordTitle } from '../runtime';
import { ServiceError, type Db } from '../types';
import { isFollowUpDue, isNotAttended } from '../../domain/modules/leads/computed';

export const OPEN_STATUSES = ['new', 'contacted', 'nurture'];
const SALES_ROLES = ['sales_exec', 'sales_manager'];

export const hasResource = (key: string) => appPack.resources.some((r) => r.key === key);

/** recordTitle that tolerates resources another module has not published yet. */
export function safeTitle(resKey: string, id: unknown, actor?: Actor): string {
  if (!id) return '';
  if (!hasResource(resKey)) return String(id);
  return recordTitle(resKey, id, actor);
}

export const leadLabel = (lead: RecordData, actor?: Actor) => `${lead.id} · ${safeTitle('customers', lead.customerId, actor) || 'Unknown company'}`;

// ---------------------------------------------------------------- assignment (LEAD-07, BR-09)

const employeesIn = (d: Db) => d.records.employees ?? [];

/** The owner must work in the lead's division (management and admin cover every division). */
export function ownerDivisionError(d: Db, ownerId: unknown, divisionId: unknown): string | undefined {
  if (!ownerId || !divisionId) return undefined;
  const e = employeesIn(d).find((x) => x.id === ownerId);
  if (!e) return 'Selected owner no longer exists';
  if (e.status === 'inactive') return `${e.fullName} is inactive`;
  if (!((e.divisionIds as string[]) ?? []).includes(String(divisionId))) return `${e.fullName} does not work in the ${masterLabel('division', divisionId)} division`;
  return undefined;
}

/** Territories whose parent state equals the lead's state. */
const territoriesOfState = (state: unknown) => (state ? activeMasterValues('territory').filter((t) => t.parent === state).map((t) => t.key) : []);

/**
 * BR-09: first active rule (lowest priority) matching division + product type + territory; round-robin
 * inside its team (rotation pointer stored on the rule). No match → first division head.
 * Returns the employee id and how it was chosen.
 */
export function autoAssign(d: Db, lead: Record<string, unknown>): { ownerId: string | null; via: string } {
  const territories = territoriesOfState(lead.state);
  const rules = (d.records.assignmentRules ?? [])
    .filter((r) => r.active !== false && r.divisionId === lead.divisionId && (!r.productType || r.productType === lead.productType) && (!r.territoryId || territories.includes(String(r.territoryId))))
    .sort((a, b) => Number(a.priority) - Number(b.priority));
  for (const rule of rules) {
    const team = ((rule.assigneeIds as string[]) ?? []).filter((id) => employeesIn(d).some((e) => e.id === id && e.status !== 'inactive'));
    if (!team.length) continue;
    const i = Number(rule.rrPointer ?? 0) % team.length;
    const idx = d.records.assignmentRules.findIndex((r) => r.id === rule.id);
    // Rotation pointer is system bookkeeping (not audited as a user change).
    d.records.assignmentRules[idx] = { ...rule, rrPointer: (i + 1) % team.length };
    return { ownerId: team[i], via: `rule ${rule.id} (${rule.name})` };
  }
  const head = employeesIn(d).find((e) => e.roleId === 'division_head' && e.status !== 'inactive' && ((e.divisionIds as string[]) ?? []).includes(String(lead.divisionId)));
  return head ? { ownerId: head.id, via: 'division head queue (no matching rule)' } : { ownerId: null, via: 'none' };
}

/** Owner defaulting on create: sales users own what they enter; everyone else (and imports/API) uses the rules. */
export function resolveOwner(ctx: HookContext, c: Record<string, unknown>) {
  if (c.ownerId) return;
  if (SALES_ROLES.includes(ctx.actor.role.id)) {
    c.ownerId = ctx.actor.staffId;
    return;
  }
  const { ownerId, via } = autoAssign(ctx.d, c);
  c.ownerId = ownerId ?? ctx.actor.staffId;
  c.__assignedVia = ownerId ? via : 'creator (no rule or division head)';
}

// ---------------------------------------------------------------- duplicates (LEAD-03, BR-10, CUS-06)

const norm = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|co|company|and|&)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

export interface DuplicateCheck {
  customerId?: string;
  contactId?: string;
  divisionId?: string;
  mobile?: string;
  email?: string;
  companyName?: string;
  gstin?: string;
}

/** Open leads in the same division for the same company or contact details. Hidden ones are only counted. */
export function findDuplicateLeads(actor: Actor, q: DuplicateCheck): { visible: RecordData[]; hidden: number } {
  const d = getDb();
  const res = getResource('leads');
  const mobile = q.mobile ? normaliseMobile(q.mobile) : '';
  const email = (q.email ?? '').trim().toLowerCase();
  const contactMatch = (contactId: unknown) => {
    const c = byId('contacts', contactId);
    if (!c) return false;
    return (!!mobile && (normaliseMobile(String(c.mobile ?? '')) === mobile || normaliseMobile(String(c.whatsapp ?? '')) === mobile)) || (!!email && String(c.email ?? '').toLowerCase() === email);
  };
  const companyKey = q.companyName ? norm(q.companyName) : '';
  const hits = (d.records.leads ?? []).filter((l) => {
    if (!OPEN_STATUSES.includes(String(l.status))) return false;
    if (q.divisionId && l.divisionId !== q.divisionId) return false;
    if (q.customerId && l.customerId === q.customerId) return true;
    if (q.contactId && l.contactId === q.contactId) return true;
    if (contactMatch(l.contactId)) return true;
    if (companyKey && norm(byId('customers', l.customerId)?.name) === companyKey) return true;
    return false;
  });
  const visible = hits.filter((l) => canReadRecord(actor, res, l));
  return { visible, hidden: hits.length - visible.length };
}

/** Existing companies matching a new company's GSTIN or (normalised) name — offered instead of creating a duplicate. */
export function findDuplicateCustomers(name: string, gstin?: string): RecordData[] {
  const key = norm(name);
  const g = (gstin ?? '').trim().toUpperCase();
  return (getDb().records.customers ?? []).filter((c) => (g && String(c.gstin ?? '').toUpperCase() === g) || (key.length >= 4 && (norm(c.name) === key || norm(c.name).includes(key) || key.includes(norm(c.name)))));
}

// ---------------------------------------------------------------- create with inline company / contact (LEAD-01)

export interface NewCompanyInput {
  name: string;
  city: string;
  state: string;
  territoryId: string;
  gstin?: string;
  industry?: string;
}
export interface NewContactInput {
  name: string;
  mobile?: string;
  email?: string;
  designation?: string;
}

export function validateNewParty(company: NewCompanyInput | null, contact: NewContactInput | null): Record<string, string> {
  const e: Record<string, string> = {};
  if (company) {
    if (!company.name.trim()) e['company.name'] = 'Company name is required';
    if (!company.city.trim()) e['company.city'] = 'City is required';
    if (!company.state) e['company.state'] = 'State is required';
    if (!company.territoryId) e['company.territoryId'] = 'Territory is required';
  }
  if (contact) {
    if (!contact.name.trim()) e['contact.name'] = 'Contact name is required';
    if (!contact.mobile?.trim() && !contact.email?.trim()) e['contact.mobile'] = 'Give a mobile number or an email (BR-03)';
    if (contact.mobile?.trim() && validateMobile(contact.mobile)) e['contact.mobile'] = validateMobile(contact.mobile)!;
    if (contact.email?.trim() && validateEmail(contact.email)) e['contact.email'] = validateEmail(contact.email)!;
  }
  return e;
}

/**
 * Creates the company and/or contact inline (when the customers module is available), then the lead.
 * The party records are created in one commit; the lead goes through the normal runtime (permissions,
 * validation, audit). Lead values are pre-validated so a failing lead never leaves an orphan company.
 */
export function createLeadWithParty(actor: Actor, lead: Record<string, unknown>, company: NewCompanyInput | null, contact: NewContactInput | null) {
  if (!perm(actor, 'leads').create) throw new ServiceError('forbidden', 'Your role cannot create leads.');
  const partyErrors = validateNewParty(company, contact);
  if (Object.keys(partyErrors).length) throw new ServiceError('validation', 'Please fix the highlighted fields.', { fieldErrors: partyErrors });
  if ((company && !hasResource('customers')) || (contact && !hasResource('contacts'))) throw new ServiceError('invalid_state', 'Companies and contacts cannot be created here until the Customers module is available. Pick an existing company.');
  if (company && !perm(actor, 'customers').create) throw new ServiceError('forbidden', 'Your role cannot create companies. Pick an existing company or ask a coordinator.');
  let customerId = lead.customerId as string | undefined;
  let contactId = lead.contactId as string | undefined;
  if (company || contact) {
    commit((d) => {
      const ctx: HookContext = { d, actor, correlationId: uid('cor') };
      if (company) {
        const c = insertRecordIn(
          ctx,
          'customers',
          {
            name: company.name.trim(),
            gstin: company.gstin?.trim().toUpperCase() || undefined,
            industry: company.industry || undefined,
            category: 'prospect',
            divisionIds: [lead.divisionId],
            territoryId: company.territoryId,
            billingState: company.state,
            ownerId: (lead.ownerId as string) || actor.staffId,
            status: 'active',
          },
          { validate: false },
        );
        customerId = c.id;
        if (hasResource('addresses')) insertRecordIn(ctx, 'addresses', { customerId, addressType: 'billing', label: 'Head office', line1: company.city.trim(), city: company.city.trim(), state: company.state, pincode: '' }, { validate: false });
      }
      if (contact) {
        const c = insertRecordIn(
          ctx,
          'contacts',
          {
            name: contact.name.trim(),
            customerId,
            designation: contact.designation?.trim() || undefined,
            mobile: contact.mobile ? normaliseMobile(contact.mobile) : undefined,
            whatsapp: contact.mobile ? normaliseMobile(contact.mobile) : undefined,
            email: contact.email?.trim().toLowerCase() || undefined,
            ownerId: (lead.ownerId as string) || actor.staffId,
            divisionIds: [lead.divisionId],
            poolStatus: 'converted',
            source: lead.sourceId,
          },
          { validate: false },
        );
        contactId = c.id;
      }
    });
  }
  return createRecord(actor, 'leads', { ...lead, customerId, contactId, city: lead.city || company?.city, state: lead.state || company?.state, industry: lead.industry || company?.industry });
}

// ---------------------------------------------------------------- status changes with data (LEAD-10, LEAD-11)

function loadForChange(d: Db, actor: Actor, id: string, version: number) {
  const res = getResource('leads');
  const idx = (d.records.leads ?? []).findIndex((r) => r.id === id);
  const lead = d.records.leads?.[idx];
  if (!lead || !canReadRecord(actor, res, lead)) throw new ServiceError('not_found', `Lead ${id} was not found or you do not have access.`);
  if (!canUpdateRecord(actor, res, lead)) throw new ServiceError('forbidden', 'Your role cannot change this lead.');
  if (lead.version !== version) throw new ServiceError('version_conflict', `Lead ${id} changed since you opened it. Reload and try again.`);
  return { idx, lead };
}

function writeStatus(d: Db, actor: Actor, idx: number, lead: RecordData, to: string, patch: Record<string, unknown>, action: string, correlationId: string) {
  const next: RecordData = { ...lead, ...patch, status: to, version: lead.version + 1, updatedAt: nowIso() };
  d.records.leads[idx] = next;
  appendAudit(d, actor, {
    action: 'transition',
    resource: 'leads',
    recordId: lead.id,
    summary: `${action}: ${masterLabel('leadStatus', lead.status)} → ${masterLabel('leadStatus', to)}`,
    changes: [{ field: 'status', label: 'Status', before: masterLabel('leadStatus', lead.status), after: masterLabel('leadStatus', to) }],
    correlationId,
  });
  emitEvent(d, actor, { eventType: 'leads.status_changed', resourceId: 'res_leads', recordId: lead.id, correlationId, payload: { from: lead.status, to } });
  return next;
}

export interface QualifyInput {
  requirement: string;
  budget: number;
  decisionMaker: string;
  timeline: string;
  currentSetup?: string;
  opportunityName: string;
  value: number;
  expectedCloseDate: string;
}

export function validateQualify(q: QualifyInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (!q.requirement?.trim()) e.requirement = 'Describe the customer’s need';
  if (!(Number(q.budget) > 0)) e.budget = 'Enter the budget';
  if (!q.decisionMaker?.trim()) e.decisionMaker = 'Name the decision maker';
  if (!q.timeline) e.timeline = 'Pick the purchase timeline';
  if (!q.opportunityName?.trim()) e.opportunityName = 'Name the opportunity';
  if (!(Number(q.value) > 0)) e.value = 'Enter the expected value';
  if (!q.expectedCloseDate) e.expectedCloseDate = 'Pick the expected close date';
  else if (q.expectedCloseDate < todayKey()) e.expectedCloseDate = 'Date cannot be in the past';
  return e;
}

/** LEAD-10 / §3.1: qualify → opportunity with the lead's data; notify the referrer (LEAD-12, BR-37). */
export function qualifyLead(actor: Actor, id: string, version: number, q: QualifyInput): { leadId: string; opportunityId: string } {
  const errors = validateQualify(q);
  if (Object.keys(errors).length) throw new ServiceError('validation', 'Complete the qualification (BANT) before converting.', { fieldErrors: errors });
  if (!hasResource('opportunities')) throw new ServiceError('invalid_state', 'The Opportunities module is not available yet, so the lead cannot be converted.');
  return commit((d) => {
    const { idx, lead } = loadForChange(d, actor, id, version);
    if (!['new', 'contacted'].includes(String(lead.status))) throw new ServiceError('invalid_state', `Only new or contacted leads can be qualified (this one is ${masterLabel('leadStatus', lead.status)}).`);
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    const probability = getPolicies().stageProbability.needs_assessment ?? 10;
    const opp = insertRecordIn(
      ctx,
      'opportunities',
      {
        name: q.opportunityName.trim(),
        customerId: lead.customerId,
        contactId: lead.contactId,
        leadId: lead.id,
        divisionId: lead.divisionId,
        oppType: lead.productType === 'machine' ? 'new_machine' : 'consumables',
        value: Number(q.value),
        expectedCloseDate: q.expectedCloseDate,
        stage: 'needs_assessment',
        probability,
        competitors: q.currentSetup?.trim() || lead.currentSetup || undefined,
        ownerId: lead.ownerId,
        decisionMakers: q.decisionMaker.trim(),
        nextFollowUpAt: lead.nextFollowUpAt && String(lead.nextFollowUpAt) >= todayKey() ? lead.nextFollowUpAt : addDays(todayKey(), 3),
        lastActivityAt: lead.lastActivityAt,
      },
      { validate: false },
    );
    writeStatus(
      d,
      actor,
      idx,
      lead,
      'qualified',
      { requirement: q.requirement.trim(), budget: Number(q.budget), decisionMaker: q.decisionMaker.trim(), timeline: q.timeline, currentSetup: q.currentSetup?.trim() || lead.currentSetup, opportunityId: opp.id, nextFollowUpAt: null, statusNote: `Converted to ${opp.id}` },
      'Qualified',
      ctx.correlationId,
    );
    const label = leadLabel(lead, actor);
    // Referrer recognition (LEAD-12): employees/engineers in-app; customers/dealers by WhatsApp (simulated).
    const refEmp = lead.referrerEmployeeId ? userOfStaff(lead.referrerEmployeeId) : undefined;
    if (refEmp && refEmp.id !== actor.user.id) notify(d, { userId: refEmp.id, workspaceId: actor.workspaceId, kind: 'info', title: `Your referral ${label} was qualified as ${opp.id} — thank you!`, link: { resource: 'leads', recordId: lead.id } });
    if (lead.referrerCustomerId) {
      const refCust = byId('customers', lead.referrerCustomerId, d.records);
      queueMessage(ctx, { channel: 'whatsapp', to: String(refCust?.name ?? lead.referrerCustomerId), body: `Thank you for referring ${safeTitle('customers', lead.customerId)} to True Colors. Our team is now working on their requirement.`, related: { resource: 'leads', recordId: lead.id } });
    }
    const owner = userOfStaff(lead.ownerId);
    if (owner && owner.id !== actor.user.id) notify(d, { userId: owner.id, workspaceId: actor.workspaceId, kind: 'info', title: `${label} was qualified into ${opp.id}`, link: { resource: 'opportunities', recordId: opp.id } });
    return { leadId: lead.id, opportunityId: opp.id };
  });
}

/** LEAD-11 nurture: not ready yet — re-contact on a future date. */
export function nurtureLead(actor: Actor, id: string, version: number, until: string, note: string) {
  if (!until) throw new ServiceError('validation', 'Pick the re-contact date.', { fieldErrors: { until: 'Required' } });
  if (until <= todayKey()) throw new ServiceError('validation', 'The re-contact date must be in the future.', { fieldErrors: { until: 'Must be a future date' } });
  return commit((d) => {
    const { idx, lead } = loadForChange(d, actor, id, version);
    if (!['new', 'contacted'].includes(String(lead.status))) throw new ServiceError('invalid_state', 'Only new or contacted leads can be moved to Nurture.');
    return writeStatus(d, actor, idx, lead, 'nurture', { nurtureUntil: until, nextFollowUpAt: until, statusNote: note.trim() || undefined }, 'Nurture', uid('cor'));
  });
}

/** LEAD-11 disqualify: reason from the master list is mandatory. */
export function disqualifyLead(actor: Actor, id: string, version: number, reason: string, note: string) {
  if (!reason) throw new ServiceError('validation', 'Pick a reason.', { fieldErrors: { reason: 'Required' } });
  if (reason === 'other' && note.trim().length < 5) throw new ServiceError('validation', 'Explain the reason (at least 5 characters).', { fieldErrors: { note: 'Required for “Other”' } });
  return commit((d) => {
    const { idx, lead } = loadForChange(d, actor, id, version);
    if (!OPEN_STATUSES.includes(String(lead.status))) throw new ServiceError('invalid_state', 'This lead is already closed.');
    return writeStatus(d, actor, idx, lead, 'disqualified', { disqualifyReason: reason, nextFollowUpAt: null, nurtureUntil: null, statusNote: note.trim() || undefined }, 'Disqualify', uid('cor'));
  });
}

// ---------------------------------------------------------------- SLA sweep + reminders (LEAD-08, LEAD-09)

/**
 * Idempotent sweep on the simulated clock: escalates leads past the first-contact SLA to the owner's
 * manager (once), and sends one follow-up / nurture reminder per lead per day (in-app + simulated push).
 * Commits only when something changed, so it is safe to run after every store change.
 */
export function sweepLeads(actor: Actor): { escalated: number; reminded: number } {
  const d0 = getDb();
  const today = todayKey();
  const hours = getPolicies().leadFirstContactHours;
  const due = (d0.records.leads ?? []).filter((l) => (isNotAttended(l, hours) && !l.escalatedAt) || (isFollowUpDue(l) && l.reminderSentOn !== today));
  if (!due.length) return { escalated: 0, reminded: 0 };
  let escalated = 0;
  let reminded = 0;
  commit((d) => {
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    const at = nowIso();
    d.records.leads = d.records.leads.map((l) => {
      let next = l;
      const label = `${l.id} · ${safeTitle('customers', l.customerId)}`;
      if (isNotAttended(l, hours) && !l.escalatedAt) {
        const owner = userOfStaff(l.ownerId);
        const mgr = userOfStaff(managerOf(l.ownerId, d.records));
        if (mgr) notify(d, { userId: mgr.id, workspaceId: l.workspaceId, kind: 'escalation', title: `Not attended: ${label} has had no contact for over ${hours} h (owner ${owner?.name ?? 'unassigned'})`, link: { resource: 'leads', recordId: l.id } });
        if (owner) notify(d, { userId: owner.id, workspaceId: l.workspaceId, kind: 'escalation', title: `First-contact SLA missed on ${label} — escalated to your manager`, link: { resource: 'leads', recordId: l.id } });
        appendAudit(d, actor, { action: 'sla.escalated', actorType: 'system', resource: 'leads', recordId: l.id, summary: `First-contact SLA (${hours} h) missed; escalated to ${mgr?.name ?? 'no manager'}`, correlationId: ctx.correlationId });
        next = { ...next, escalatedAt: at };
        escalated++;
      }
      if (isFollowUpDue(l) && l.reminderSentOn !== today) {
        const owner = userOfStaff(l.ownerId);
        if (owner) {
          const overdue = String(l.nextFollowUpAt) < today;
          const what = l.status === 'nurture' ? 'Re-contact (nurture)' : overdue ? 'Overdue follow-up' : 'Follow-up due today';
          notify(d, { userId: owner.id, workspaceId: l.workspaceId, kind: 'reminder', title: `${what}: ${label}`, link: { resource: 'leads', recordId: l.id } });
          queueMessage(ctx, { channel: 'push', to: owner.name, body: `${what}: ${label}`, related: { resource: 'leads', recordId: l.id } });
        }
        next = { ...next, reminderSentOn: today };
        reminded++;
      }
      return next;
    });
  });
  return { escalated, reminded };
}

// ---------------------------------------------------------------- follow-ups across records (LEAD-09)

export interface FollowUpItem {
  resource: string;
  resourceLabel: string;
  record: RecordData;
  title: string;
  due: string;
  ownerId?: string;
  bucket: 'overdue' | 'today' | 'upcoming';
  customerId?: string;
}

const CLOSED = new Set(['qualified', 'disqualified', 'won', 'lost', 'closed', 'completed', 'cancelled', 'rejected', 'expired', 'superseded', 'done']);

/** Every record the actor can see that has an open next follow-up within `days` (overdue included). */
export function followUpsFor(actor: Actor, days = 7): FollowUpItem[] {
  const today = todayKey();
  const horizon = addDays(today, days);
  const out: FollowUpItem[] = [];
  for (const res of allResources()) {
    if (res.key === 'activities' || !res.fields.some((f) => f.key === 'nextFollowUpAt') || perm(actor, res.key).read === 'none') continue;
    const statusKey = res.lifecycle?.field ?? (res.fields.some((f) => f.key === 'status') ? 'status' : res.fields.some((f) => f.key === 'stage') ? 'stage' : undefined);
    const rows = queryRecords(actor, res.key, {}).rows;
    for (const r of rows) {
      const due = String(r.nextFollowUpAt ?? '');
      if (!due || due > horizon) continue;
      if (statusKey && CLOSED.has(String(r[statusKey]))) continue;
      const ownerKey = res.ownerField;
      out.push({
        resource: res.key,
        resourceLabel: res.label,
        record: r,
        title: recordTitle(res.key, r.id, actor),
        due,
        ownerId: ownerKey ? (r[ownerKey] as string) : undefined,
        bucket: due < today ? 'overdue' : due === today ? 'today' : 'upcoming',
        customerId: (r.customerId as string) ?? undefined,
      });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

// ---------------------------------------------------------------- import (LEAD-05, FR-016/017)

export const IMPORT_COLUMNS = ['company', 'contact_name', 'mobile', 'email', 'designation', 'city', 'state', 'division', 'product_type', 'event_name', 'requirement'] as const;
export type ImportRow = Record<(typeof IMPORT_COLUMNS)[number], string>;

/** Minimal RFC-4180 CSV parser (quoted fields, embedded commas/quotes/newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const matchMaster = (master: string, raw: string) => {
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  return activeMasterValues(master).find((m) => m.key.toLowerCase() === v || m.label.toLowerCase() === v || m.label.toLowerCase().startsWith(v))?.key;
};

export interface ImportPreviewRow {
  line: number;
  values: ImportRow;
  division?: string;
  productType?: string;
  state?: string;
  errors: string[];
  warnings: string[];
}

export function toImportRows(table: string[][]): ImportRow[] {
  if (!table.length) return [];
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const known = IMPORT_COLUMNS.filter((c) => header.includes(c));
  if (!known.includes('company')) throw new ServiceError('validation', 'The file needs a header row with at least a “company” column. Download the template.');
  return table.slice(1).map((r) => Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, (r[header.indexOf(c)] ?? '').trim()])) as ImportRow);
}

/** Row-level validation (required, formats, master values) + duplicate warnings. */
export function previewImport(actor: Actor, rows: ImportRow[]): ImportPreviewRow[] {
  const seen = new Set<string>();
  return rows.map((v, i) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!v.company) errors.push('Company is required');
    if (!v.contact_name) errors.push('Contact name is required');
    if (!v.mobile && !v.email) errors.push('Mobile or email is required');
    if (v.mobile && validateMobile(v.mobile)) errors.push(validateMobile(v.mobile)!);
    if (v.email && validateEmail(v.email)) errors.push(validateEmail(v.email)!);
    const division = matchMaster('division', v.division);
    if (!division) errors.push(v.division ? `Unknown division “${v.division}”` : 'Division is required');
    const productType = matchMaster('productType', v.product_type) ?? 'machine';
    if (v.product_type && !matchMaster('productType', v.product_type)) warnings.push(`Unknown product type “${v.product_type}” — using Machine`);
    const state = matchMaster('state', v.state);
    if (v.state && !state) warnings.push(`Unknown state “${v.state}”`);
    const key = `${normaliseMobile(v.mobile)}|${v.email.toLowerCase()}|${norm(v.company)}`;
    if (seen.has(key)) warnings.push('Repeated in this file');
    seen.add(key);
    if (division) {
      const dup = findDuplicateLeads(actor, { divisionId: division, mobile: v.mobile, email: v.email, companyName: v.company });
      if (dup.visible.length + dup.hidden > 0) warnings.push(`Possible duplicate of ${dup.visible.map((l) => l.id).join(', ') || `${dup.hidden} lead(s) owned by another team`}`);
    }
    return { line: i + 2, values: v, division, productType, state, errors, warnings };
  });
}

/**
 * Imports valid rows as exhibition leads (source = exhibition), reusing existing companies/contacts
 * by name / mobile / email, and auto-assigning owners by rule. Returns created lead ids.
 */
export function importLeads(actor: Actor, rows: ImportPreviewRow[], eventName: string): { created: string[]; skipped: number } {
  if (!can(actor, 'leads.import') || !perm(actor, 'leads').create) throw new ServiceError('forbidden', 'Your role cannot import leads.');
  if (!eventName.trim()) throw new ServiceError('validation', 'Enter the exhibition / event name.', { fieldErrors: { eventName: 'Required' } });
  if (!hasResource('customers') || !hasResource('contacts')) throw new ServiceError('invalid_state', 'Import needs the Customers module (companies and contacts).');
  const valid = rows.filter((r) => !r.errors.length);
  const created: string[] = [];
  commit((d) => {
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    for (const r of valid) {
      const v = r.values;
      const territory = activeMasterValues('territory').find((t) => t.parent === r.state)?.key ?? activeMasterValues('territory')[0]?.key;
      let customer = (d.records.customers ?? []).find((c) => norm(c.name) === norm(v.company));
      customer ??= insertRecordIn(ctx, 'customers', { name: v.company, category: 'prospect', divisionIds: [r.division], territoryId: territory, billingState: r.state ?? '27', ownerId: actor.staffId, status: 'active' }, { validate: false });
      const mobile = v.mobile ? normaliseMobile(v.mobile) : undefined;
      let contact = (d.records.contacts ?? []).find((c) => c.customerId === customer!.id && ((mobile && c.mobile === mobile) || (v.email && String(c.email ?? '').toLowerCase() === v.email.toLowerCase())));
      contact ??= insertRecordIn(ctx, 'contacts', { name: v.contact_name, customerId: customer.id, designation: v.designation || undefined, mobile, whatsapp: mobile, email: v.email.toLowerCase() || undefined, divisionIds: [r.division], poolStatus: 'converted', source: 'exhibition' }, { validate: false });
      const base = { divisionId: r.division, productType: r.productType, state: r.state };
      const lead = insertRecordIn(ctx, 'leads', {
        ownerId: autoAssign(d, base).ownerId ?? actor.staffId,
        customerId: customer.id,
        contactId: contact.id,
        divisionId: r.division,
        sourceId: 'exhibition',
        eventName: eventName.trim(),
        productType: r.productType,
        requirement: v.requirement || undefined,
        city: v.city || undefined,
        state: r.state,
        nextFollowUpAt: addDays(todayKey(), 1),
      });
      created.push(lead.id);
    }
    appendAudit(d, actor, { action: 'import', resource: 'leads', summary: `Imported ${created.length} exhibition lead(s) from “${eventName.trim()}” (${rows.length - valid.length} row(s) skipped)`, correlationId: ctx.correlationId });
  });
  return { created, skipped: rows.length - valid.length };
}

/** Simulated visiting-card scan (no OCR in the prototype): returns a realistic card as an import row. */
const CARDS: ImportRow[] = [
  { company: 'Shree Balaji Digital Prints', contact_name: 'Mahesh Agarwal', mobile: '9824012345', email: 'mahesh@balajiprints.example', designation: 'Proprietor', city: 'Surat', state: 'Gujarat', division: 'Textile', product_type: 'Machine', event_name: '', requirement: 'Sublimation printer, 3.2 m' },
  { company: 'Lotus Label Converters', contact_name: 'Ananya Rao', mobile: '9845098765', email: 'ananya@lotuslabels.example', designation: 'Purchase Manager', city: 'Bengaluru', state: 'Karnataka', division: 'Commercial – Label', product_type: 'Machine', event_name: '', requirement: 'Digital label press for short runs' },
  { company: 'Kanchan Fashion House', contact_name: 'Ritu Malhotra', mobile: '9811122233', email: 'ritu@kanchanfashion.example', designation: 'Director', city: 'New Delhi', state: 'Delhi', division: 'Fabric', product_type: 'Fabric', event_name: '', requirement: 'Printed georgette, 2,000 m per month' },
  { company: 'Vardhman Ink Traders', contact_name: 'Sunil Jain', mobile: '9829076543', email: 'sunil@vardhmanink.example', designation: 'Partner', city: 'Jaipur', state: 'Rajasthan', division: 'Ink', product_type: 'Ink', event_name: '', requirement: 'Dye-sublimation ink, 200 L per month' },
];
let cardSeq = 0;
export const scanVisitingCard = (): ImportRow => ({ ...CARDS[cardSeq++ % CARDS.length] });

export const importTemplateCsv = () => `${IMPORT_COLUMNS.join(',')}\nShree Ganesh Prints,Ramesh Patel,9825011122,ramesh@ganeshprints.example,Owner,Surat,Gujarat,Textile,Machine,,Needs 3.2 m sublimation printer\n`;
