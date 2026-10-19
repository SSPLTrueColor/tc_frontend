/**
 * SIMULATED integrations (BRD §6; FR-015, FR-016, FR-141–146). Nothing calls an external system:
 * each action fabricates the inbound payload a webhook / ERP / WhatsApp provider would send and
 * runs it through the same hand-off helpers the live integration would use. Every run is audited
 * with an `integration.*` action so the log below can list it.
 */
import { L } from '../../constants/labels';
import { appPack } from '../../domain/pack';
import { nowLocal, todayKey, addDays } from '../../lib/dates';
import { nowIso } from '../../lib/clock';
import { uid } from '../../lib/ids';
import type { RecordData } from '../../metadata/types';
import { type Actor, can } from '../authz';
import { commit, getDb } from '../db';
import { appendAudit, notify } from '../ledger';
import { employeesWithRole, userOfStaff } from '../lookups';
import { activeMasterValues, getResource } from '../registry';
import type { HookContext } from '../resourceHooks';
import { insertRecordIn, patchRecordIn } from '../runtime';
import { type AuditEntry, ServiceError } from '../types';

export const LEAD_CHANNELS = (['website', 'meta_ads', 'google_ads', 'indiamart'] as const).map((key) => ({ key, label: L.admin.integrations.channels[key] }));

const has = (resKey: string) => appPack.resources.some((r) => r.key === resKey);

function requireIntegrations(actor: Actor) {
  if (!can(actor, 'integrations.manage')) throw new ServiceError('forbidden', L.admin.integrations.forbidden);
}

/** First active key of a field's master, preferring the given keys (masters of other modules may change). */
function pick(resKey: string, fieldKey: string, preferred: string[]): string | undefined {
  const f = getResource(resKey).fields.find((x) => x.key === fieldKey);
  if (!f?.master) return preferred[0];
  const keys = activeMasterValues(f.master).map((v) => v.key);
  return preferred.find((k) => keys.includes(k)) ?? keys[0];
}

const FIRST = ['Amit', 'Bhavna', 'Chirag', 'Divya', 'Harsh', 'Jignesh', 'Kunal', 'Mansi', 'Nilesh', 'Ritu', 'Sagar', 'Tejal', 'Vivek', 'Yash'];
const LAST = ['Patel', 'Shah', 'Agarwal', 'Jain', 'Mehta', 'Reddy', 'Iyer', 'Gupta', 'Kothari', 'Bhatt', 'Naidu', 'Sethi'];
const COMPANIES = ['Digital Prints', 'Fab Creations', 'Colour Craft', 'Textile Studio', 'Label House', 'Print Point', 'Weave Works', 'Graphic Hub'];
const CITIES: { city: string; state: string; territory: string }[] = [
  { city: 'Surat', state: '24', territory: 'surat' },
  { city: 'Ahmedabad', state: '24', territory: 'ahmedabad' },
  { city: 'Mumbai', state: '27', territory: 'mumbai' },
  { city: 'Tiruppur', state: '33', territory: 'tiruppur' },
  { city: 'Ludhiana', state: '03', territory: 'ludhiana' },
  { city: 'Delhi', state: '07', territory: 'delhi_ncr' },
  { city: 'Bengaluru', state: '29', territory: 'bengaluru' },
];
const INTEREST: { division: string; productType: string; subType?: string; text: string }[] = [
  { division: 'TX', productType: 'machine', subType: 'textile', text: 'Sublimation printer, 1.9 m width' },
  { division: 'TX', productType: 'machine', subType: 'textile', text: 'Direct-to-fabric printer for cotton' },
  { division: 'INK', productType: 'ink', text: 'Sublimation ink supply for 2 machines' },
  { division: 'POD', productType: 'machine', subType: 'pod', text: 'Print-on-demand machine for photo books' },
  { division: 'LBL', productType: 'machine', subType: 'label', text: 'Narrow-web label press' },
  { division: 'PPR', productType: 'paper', text: 'Sublimation paper rolls, monthly' },
];
const rand = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

/** Least-loaded active sales owner in the division (round-robin by open leads). */
function pickOwner(d: HookContext['d'], division: string): string | undefined {
  const pool = [...employeesWithRole('sales_exec', division, d.records), ...employeesWithRole('sales_manager', division, d.records)];
  const candidates = pool.length ? pool : employeesWithRole('division_head', division, d.records);
  if (!candidates.length) return undefined;
  const open = (id: string) => (d.records.leads ?? []).filter((l) => l.ownerId === id && ['new', 'contacted'].includes(String(l.status))).length;
  return [...candidates].sort((a, b) => open(a.id) - open(b.id))[0].id;
}

export interface LeadCaptureResult {
  outcome: 'created' | 'duplicate' | 'skipped';
  message: string;
  leadId?: string;
}

/** Webhook from website / Meta / Google / IndiaMART → dedupe on mobile/email → customer, contact, lead. */
export function simulateIncomingLead(actor: Actor, source: string): LeadCaptureResult {
  requireIntegrations(actor);
  if (!has('leads') || !has('customers') || !has('contacts')) {
    return { outcome: 'skipped', message: L.admin.integrations.leadNeedsModules };
  }
  const name = `${rand(FIRST)} ${rand(LAST)}`;
  const place = rand(CITIES);
  const interest = rand(INTEREST);
  // Every third capture repeats an existing contact so the duplicate check is visible.
  const existing = (getDb().records.contacts ?? []).filter((c) => c.mobile || c.email);
  const repeat = existing.length && Math.random() < 0.34 ? rand(existing) : null;
  const mobile = repeat ? String(repeat.mobile ?? '') : `9${Math.floor(100000000 + Math.random() * 899999999)}`;
  const email = repeat ? String(repeat.email ?? '') : `${name.split(' ')[0].toLowerCase()}.${Math.floor(Math.random() * 900 + 100)}@example.in`;
  const label = LEAD_CHANNELS.find((c) => c.key === source)?.label ?? source;
  return commit((d) => {
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    const contact = (d.records.contacts ?? []).find((c) => (mobile && c.mobile === mobile) || (email && c.email && String(c.email).toLowerCase() === email.toLowerCase()));
    if (contact) {
      const openLead = (d.records.leads ?? []).find((l) => l.contactId === contact.id && ['new', 'contacted', 'nurture'].includes(String(l.status)));
      if (openLead) {
        appendAudit(d, actor, { action: 'integration.lead_duplicate', actorType: 'system', resource: 'leads', recordId: openLead.id, summary: L.admin.integrations.duplicateAudit(label, String(contact.name), openLead.id), correlationId: ctx.correlationId });
        const owner = userOfStaff(openLead.ownerId);
        if (owner) notify(d, { userId: owner.id, workspaceId: actor.workspaceId, kind: 'info', title: L.admin.integrations.repeatNotice(label, String(contact.name), openLead.id), link: { resource: 'leads', recordId: openLead.id } });
        return { outcome: 'duplicate', message: L.admin.integrations.duplicateMessage(openLead.id, String(contact.name)), leadId: openLead.id };
      }
    }
    const ownerId = pickOwner(d, interest.division);
    if (!ownerId) return { outcome: 'skipped', message: L.admin.integrations.noOwner(interest.division) };
    let customerId = contact?.customerId ? String(contact.customerId) : '';
    if (!customerId) {
      const company: RecordData = insertRecordIn(ctx, 'customers', {
        name: `${place.city} ${rand(COMPANIES)}`,
        category: pick('customers', 'category', ['prospect']),
        divisionIds: [interest.division],
        territoryId: place.territory,
        billingState: place.state,
        ownerId,
        status: pick('customers', 'status', ['active']),
      });
      customerId = company.id;
    }
    const contactId = contact
      ? contact.id
      : insertRecordIn(ctx, 'contacts', { name, customerId, mobile, email, ownerId, divisionIds: [interest.division], source, poolStatus: pick('contacts', 'poolStatus', ['converted']), consentWhatsapp: true, consentEmail: true }).id;
    const lead = insertRecordIn(ctx, 'leads', {
      customerId,
      contactId,
      divisionId: interest.division,
      sourceId: source,
      campaign: L.admin.integrations.campaign(label, new Date().toLocaleString('en-IN', { month: 'short' })),
      productType: interest.productType,
      subType: interest.subType,
      requirement: interest.text,
      ownerId,
      status: pick('leads', 'status', ['new']),
      nextFollowUpAt: addDays(todayKey(), 1),
    });
    appendAudit(d, actor, { action: 'integration.lead_captured', actorType: 'system', resource: 'leads', recordId: lead.id, summary: L.admin.integrations.capturedAudit(label, lead.id, name, userOfStaff(ownerId)?.name ?? ownerId), correlationId: ctx.correlationId });
    const owner = userOfStaff(ownerId);
    if (owner) notify(d, { userId: owner.id, workspaceId: actor.workspaceId, kind: 'assignment', title: L.admin.integrations.capturedNotice(label, lead.id), link: { resource: 'leads', recordId: lead.id } });
    return { outcome: 'created', message: L.admin.integrations.capturedMessage(lead.id, label, owner?.name ?? ownerId), leadId: lead.id };
  });
}

/** Simulated ERP pull: credit limit / outstanding / overdue per customer and main-store spares stock. */
export function syncFromErp(actor: Actor): { customers: number; spares: number } {
  requireIntegrations(actor);
  return commit((d) => {
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    const at = nowIso();
    let customers = 0;
    let spares = 0;
    if (has('customers')) {
      for (const c of d.records.customers ?? []) {
        if (c.workspaceId !== actor.workspaceId) continue;
        const seed = [...c.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 9973, 7);
        const creditLimit = c.creditLimit ? Number(c.creditLimit) : (seed % 20 + 5) * 100000;
        const outstanding = Math.round(((seed * (Date.now() % 97)) % 60) / 100 * creditLimit);
        const overdue = seed % 3 === 0 ? Math.round(outstanding * 0.35) : 0;
        patchRecordIn(ctx, 'customers', c.id, { creditLimit, outstanding, overdue, erpSyncedAt: at }, L.admin.integrations.erpCustomerNote);
        customers++;
      }
    }
    if (has('spareParts')) {
      for (const sp of d.records.spareParts ?? []) {
        const stock = Math.max(0, Number(sp.stockMain ?? 10) + Math.round((Math.random() - 0.5) * 6));
        patchRecordIn(ctx, 'spareParts', sp.id, { stockMain: stock }, L.admin.integrations.erpStockNote);
        spares++;
      }
    }
    appendAudit(d, actor, { action: 'integration.erp_sync', actorType: 'system', summary: L.admin.integrations.erpAudit(customers, spares), correlationId: ctx.correlationId });
    return { customers, spares };
  });
}

/** Inbound WhatsApp / email from a known customer contact → service ticket (SRV-01). */
export function simulateIncomingMessage(actor: Actor, channel: 'whatsapp' | 'email'): { outcome: 'created' | 'skipped'; message: string; ticketId?: string } {
  requireIntegrations(actor);
  if (!has('tickets')) return { outcome: 'skipped', message: L.admin.integrations.ticketNeedsModule };
  const db = getDb().records;
  const contacts = (db.contacts ?? []).filter((c) => c.customerId);
  if (!contacts.length) return { outcome: 'skipped', message: L.admin.integrations.noContacts };
  // Prefer a customer with an installed machine; otherwise a consumables customer (machine optional there, Q-13).
  const machines = (db.machines ?? []).filter((m) => contacts.some((c) => c.customerId === m.customerId));
  const CONSUMABLES = ['INK', 'PPR', 'FAB'];
  let machine: RecordData | undefined;
  let contact: RecordData | undefined;
  let division = '';
  if (machines.length) {
    machine = rand(machines);
    contact = rand(contacts.filter((c) => c.customerId === machine!.customerId));
    division = String(machine.divisionId ?? '');
  } else {
    const consumable = contacts.filter((c) => ((db.customers ?? []).find((x) => x.id === c.customerId)?.divisionIds as string[] | undefined)?.some((d) => CONSUMABLES.includes(d)));
    if (!consumable.length) return { outcome: 'skipped', message: L.admin.integrations.noMachineCustomer };
    contact = rand(consumable);
    division = ((db.customers ?? []).find((x) => x.id === contact!.customerId)?.divisionIds as string[]).find((d) => CONSUMABLES.includes(d)) ?? 'INK';
  }
  const text = rand(L.admin.integrations.messageTexts);
  const channelName = L.admin.integrations.channelName[channel];
  return commit((d) => {
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    try {
      const t = insertRecordIn(ctx, 'tickets', {
        customerId: contact.customerId,
        contactId: contact.id,
        machineId: machine?.id,
        channel: pick('tickets', 'channel', [channel]),
        reportedAt: nowLocal(),
        description: L.admin.integrations.ticketDescription(channelName, String(contact.name), text),
        category: pick('tickets', 'category', []),
        ticketType: pick('tickets', 'ticketType', ['breakdown']),
        priority: pick('tickets', 'priority', [text === L.admin.integrations.messageTexts[0] ? 'critical' : 'medium']),
        divisionId: division,
      });
      appendAudit(d, actor, { action: 'integration.message_ticket', actorType: 'system', resource: 'tickets', recordId: t.id, summary: L.admin.integrations.ticketAudit(channelName, String(contact.name), t.id), correlationId: ctx.correlationId });
      return { outcome: 'created' as const, message: L.admin.integrations.ticketMessage(t.id, channelName), ticketId: t.id };
    } catch (e) {
      return { outcome: 'skipped' as const, message: e instanceof Error ? e.message : L.admin.integrations.ticketFailed };
    }
  });
}

/** Integration runs (newest first). */
export function integrationLog(actor: Actor): AuditEntry[] {
  requireIntegrations(actor);
  return getDb().audit.filter((a) => a.workspaceId === actor.workspaceId && a.action.startsWith('integration.'));
}
