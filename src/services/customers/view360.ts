/**
 * Customer 360° View read model (CUS-07): everything linked to one customer, gathered from each
 * module's resources through the scoped runtime. Resources that are not built yet, or that the
 * actor cannot read, are reported as unavailable — they never fail the view.
 */
import type { RecordData, Tone } from '../../metadata/types';
import { type Actor, perm } from '../authz';
import { getResource, masterValue } from '../registry';
import { getRecord, queryRecords, recordTitle } from '../runtime';
import { activitiesForCustomer } from '../activities';
import { todayKey } from '../../lib/dates';
import { isRegistered } from './operations';

export interface LinkedRow {
  resKey: string;
  resLabel: string;
  id: string;
  title: string;
  status?: { label: string; tone?: Tone };
  /** Raw status / stage key, for open/closed checks (labels are for display only). */
  statusKey?: string;
  amount?: number;
  date?: string;
}

export interface LinkedSet {
  resKey: string;
  available: boolean;
  rows: LinkedRow[];
}

const AMOUNT = ['grandTotal', 'value', 'amount'];
const DATE = ['expectedCloseDate', 'quoteDate', 'orderDate', 'installDate', 'reportedAt', 'endDate', 'scheduledAt', 'nextFollowUpAt', 'createdAt'];

const readable = (actor: Actor, resKey: string) => isRegistered(resKey) && perm(actor, resKey).read !== 'none';

const statusFieldOf = (resKey: string) => {
  const res = getResource(resKey);
  return res.lifecycle ? res.fields.find((f) => f.key === res.lifecycle!.field) : res.fields.find((f) => (f.key === 'status' || f.key === 'stage') && f.type === 'master');
};

function statusOf(resKey: string, r: RecordData) {
  const statusField = statusFieldOf(resKey);
  const mv = statusField?.master ? masterValue(statusField.master, r[statusField.key]) : undefined;
  return mv ? { label: mv.label, tone: mv.tone } : undefined;
}

function describe(actor: Actor, resKey: string, r: RecordData): LinkedRow {
  const amountKey = AMOUNT.find((k) => typeof r[k] === 'number');
  const dateKey = DATE.find((k) => r[k]);
  return {
    resKey,
    resLabel: getResource(resKey).label,
    id: r.id,
    title: recordTitle(resKey, r.id, actor),
    status: statusOf(resKey, r),
    statusKey: (() => {
      const f = statusFieldOf(resKey);
      return f && r[f.key] !== undefined && r[f.key] !== null ? String(r[f.key]) : undefined;
    })(),
    amount: amountKey ? Number(r[amountKey]) : undefined,
    date: dateKey ? String(r[dateKey]) : undefined,
  };
}

/** Rows of `resKey` where `field` = value, or [] when the resource is missing / not readable. */
export function linked(actor: Actor, resKey: string, field: string, value: string): RecordData[] {
  if (!readable(actor, resKey)) return [];
  return queryRecords(actor, resKey, { where: { [field]: value } }).rows;
}

/** Number of `resKey` rows linked to a customer that the actor can see (tab badges). */
export const countLinked = (actor: Actor, resKey: string, customerId: string) => linked(actor, resKey, 'customerId', customerId).length;

export const linkedRows = (actor: Actor, resKey: string, field: string, value: string) => linked(actor, resKey, field, value).map((r) => describe(actor, resKey, r));

const linkedSet = (actor: Actor, resKey: string, customerId: string): LinkedSet => ({ resKey, available: readable(actor, resKey), rows: linkedRows(actor, resKey, 'customerId', customerId) });

const sortByDateDesc = (rows: LinkedRow[]) => [...rows].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));

export interface PaymentRow {
  id: string;
  label: string;
  salesOrderId: string;
  salesOrderTitle: string;
  dueDate: string;
  amount: number;
  received: number;
  status?: { label: string; tone?: Tone };
  pastDue: boolean;
}

export interface FeedbackRow {
  ticketId: string;
  ticketTitle: string;
  rating?: number;
  comment: string;
  closedAt?: string;
}

export interface DocumentRow {
  key: string;
  fileName: string;
  fieldLabel: string;
  resKey: string;
  resLabel: string;
  recordId: string;
  updatedAt: string;
}

/** Full Customer 360° read model. Sync; pages call it through useServiceQuery (simulated latency). */
export function customer360(actor: Actor, customerId: string) {
  const customer = getRecord(actor, 'customers', customerId).record;
  const today = todayKey();
  const machines = linked(actor, 'machines', 'customerId', customerId);
  const ticketRecords = linked(actor, 'tickets', 'customerId', customerId);

  const payments: PaymentRow[] = linked(actor, 'paymentMilestones', 'customerId', customerId)
    .map((m) => ({
      id: m.id,
      label: String(m.label ?? m.id),
      salesOrderId: String(m.salesOrderId ?? ''),
      salesOrderTitle: m.salesOrderId ? recordTitle('salesOrders', m.salesOrderId, actor) : '',
      dueDate: String(m.dueDate ?? ''),
      amount: Number(m.amount ?? 0),
      received: Number(m.receivedAmount ?? 0),
      status: statusOf('paymentMilestones', m),
      pastDue: !!m.dueDate && String(m.dueDate) < today && Number(m.receivedAmount ?? 0) < Number(m.amount ?? 0),
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const feedback: FeedbackRow[] = ticketRecords
    .filter((t) => typeof t.rating === 'number' || (typeof t.feedbackComment === 'string' && t.feedbackComment.trim()))
    .map((t) => ({ ticketId: t.id, ticketTitle: recordTitle('tickets', t.id, actor), rating: typeof t.rating === 'number' ? t.rating : undefined, comment: String(t.feedbackComment ?? ''), closedAt: t.closedAt ? String(t.closedAt) : undefined }))
    .sort((a, b) => String(b.closedAt ?? '').localeCompare(String(a.closedAt ?? '')));

  return {
    customer,
    contacts: linked(actor, 'contacts', 'customerId', customerId),
    sites: linked(actor, 'addresses', 'customerId', customerId),
    leads: linkedSet(actor, 'leads', customerId),
    opportunities: linkedSet(actor, 'opportunities', customerId),
    quotations: linkedSet(actor, 'quotations', customerId),
    salesOrders: linkedSet(actor, 'salesOrders', customerId),
    machines: { resKey: 'machines', available: readable(actor, 'machines'), rows: machines.map((m) => describe(actor, 'machines', m)) } as LinkedSet,
    warranties: linkedSet(actor, 'warranties', customerId),
    amcContracts: linkedSet(actor, 'amcContracts', customerId),
    tickets: { resKey: 'tickets', available: readable(actor, 'tickets'), rows: sortByDateDesc(ticketRecords.map((t) => describe(actor, 'tickets', t))) } as LinkedSet,
    payments: { available: readable(actor, 'paymentMilestones'), rows: payments },
    feedback: { available: readable(actor, 'tickets'), rows: feedback },
  };
}

export type Customer360 = ReturnType<typeof customer360>;

/** Closed status keys (REQUIREMENTS §4.2) — everything else counts as open. */
export const CLOSED_LEAD = ['qualified', 'disqualified'];
export const CLOSED_OPP = ['won', 'lost'];
export const CLOSED_TICKET = ['resolved', 'customer_confirmation', 'closed', 'cancelled'];

/** Open opportunities of a Customer 360° model (Key Account Plan, CUS-11). */
export const openOpportunities = (v: Customer360) => v.opportunities.rows.filter((r) => !CLOSED_OPP.includes(String(r.statusKey ?? '')));

/** Counts for the Overview tab. */
export function customer360Overview(actor: Actor, customerId: string) {
  const v = customer360(actor, customerId);
  const open = (s: LinkedSet, closed: string[]) => (s.available ? s.rows.filter((r) => !closed.includes(String(r.statusKey ?? ''))).length : undefined);
  return {
    view: v,
    counts: {
      contacts: v.contacts.length,
      sites: v.sites.length,
      openLeads: open(v.leads, CLOSED_LEAD),
      openOpportunities: open(v.opportunities, CLOSED_OPP),
      machines: v.machines.available ? v.machines.rows.length : undefined,
      openTickets: open(v.tickets, CLOSED_TICKET),
    },
    children: linked(actor, 'customers', 'parentId', customerId).map((c) => ({ id: c.id, name: String(c.name) })),
    endCustomers: linked(actor, 'customers', 'dealerId', customerId).map((c) => ({ id: c.id, name: String(c.name) })),
    recent: activitiesForCustomer(actor, customerId).slice(0, 5),
  };
}

/**
 * Documents (COM-04, simulated): file names attached to this customer's records — PO copies,
 * proof of delivery, photos. Only metadata exists in the prototype.
 */
export function customerDocuments(actor: Actor, customerId: string): DocumentRow[] {
  const out: DocumentRow[] = [];
  const keys = ['quotations', 'salesOrders', 'dispatches', 'installations', 'tickets', 'salesContracts', 'amcContracts'];
  for (const resKey of keys) {
    if (!readable(actor, resKey)) continue;
    const res = getResource(resKey);
    if (!res.fields.some((f) => f.key === 'customerId')) continue;
    const fileFields = res.fields.filter((f) => /FileName$|PhotoName$/.test(f.key));
    if (!fileFields.length) continue;
    for (const r of linked(actor, resKey, 'customerId', customerId)) {
      for (const f of fileFields) {
        const name = r[f.key];
        if (typeof name === 'string' && name.trim()) out.push({ key: `${resKey}:${r.id}:${f.key}`, fileName: name, fieldLabel: f.label, resKey, resLabel: res.label, recordId: r.id, updatedAt: String(r.updatedAt ?? '') });
      }
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
