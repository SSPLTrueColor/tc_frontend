/**
 * Deal History & Deal Chain (COM-05, BRD §3 lead-to-order cycle).
 *
 * One deal = lead ↔ opportunity ↔ every quotation (incl. revisions) ↔ sales order(s) ↔ sales contract(s).
 * `resolveDealChain` finds the chain from any member; `buildDealTimeline` merges, across the whole chain and
 * its child records (milestones, dispatches, demos …), the audit ledger (status changes, field edits, sends,
 * acceptances), approval decisions per level, activities and comments into one newest-first list.
 * `fetchDealHistory` is the async boundary (simulated latency) that pages call.
 */
import { L } from '../constants/labels';
import { toDate } from '../lib/dates';
import type { RecordData } from '../metadata/types';
import { call } from './api/client';
import { type Actor, canReadRecord, perm } from './authz';
import { getDb } from './db';
import { userOfStaff } from './lookups';
import { allResources, getResource, getUser, masterLabel, masterValue } from './registry';
import { recordTitle } from './runtime';

const D = L.common.deal;

/** Resources that make up a deal, in chain order. */
export const DEAL_RESOURCES = ['leads', 'opportunities', 'quotations', 'salesOrders', 'salesContracts'] as const;
export type DealResource = (typeof DEAL_RESOURCES)[number];
export const isDealResource = (resKey: string): resKey is DealResource => (DEAL_RESOURCES as readonly string[]).includes(resKey);
/** Resources whose record page opens on the Deal History tab and shows the Deal Chain panel. */
export const DEAL_HISTORY_RESOURCES: readonly string[] = DEAL_RESOURCES;
export const DEAL_CHAIN_RESOURCES: readonly string[] = ['leads', 'opportunities', 'quotations', 'salesOrders'];

export interface DealChain {
  lead?: RecordData;
  opportunity?: RecordData;
  /** Every quotation of the opportunity (all revisions), grouped by root, oldest revision first. */
  quotations: RecordData[];
  /** The selected quotation: opportunity.selectedQuotationId, else the accepted one, else the one ordered. */
  selectedQuotationId?: string;
  orders: RecordData[];
  contracts: RecordData[];
}

export interface DealRef {
  resource: string;
  id: string;
}

const rows = (key: string): RecordData[] => getDb().records[key] ?? [];
const find = (key: string, id: unknown) => (id ? rows(key).find((r) => r.id === id) : undefined);

/** Quotation that won the deal (BR-18): explicit selection first, then acceptance, then the live order. */
function selectedOf(opp: RecordData | undefined, quotes: RecordData[], orders: RecordData[]): string | undefined {
  if (opp?.selectedQuotationId && quotes.some((q) => q.id === opp.selectedQuotationId)) return String(opp.selectedQuotationId);
  const accepted = quotes.filter((q) => q.status === 'accepted');
  if (accepted.length) return String(accepted[accepted.length - 1].id);
  const ordered = orders.find((o) => o.status !== 'cancelled' && o.quotationId && quotes.some((q) => q.id === o.quotationId));
  return ordered ? String(ordered.quotationId) : undefined;
}

/** Root id of a quotation family (R0 and its revisions share it). */
const rootOf = (q: RecordData) => String(q.rootId || q.id);

/** Deal chain for any member record. Raw lookup (no scope filter) — callers filter with `canSee`. */
export function resolveDealChain(resKey: string, recordId: string): DealChain {
  const self = find(resKey, recordId);
  let lead: RecordData | undefined;
  let opp: RecordData | undefined;
  let seedOrder: RecordData | undefined;
  let seedQuote: RecordData | undefined;
  if (self) {
    if (resKey === 'leads') lead = self;
    if (resKey === 'opportunities') opp = self;
    if (resKey === 'quotations') seedQuote = self;
    if (resKey === 'salesOrders') seedOrder = self;
    if (resKey === 'salesContracts') seedOrder = find('salesOrders', self.salesOrderId);
  }
  if (seedOrder) {
    seedQuote = seedQuote ?? find('quotations', seedOrder.quotationId);
    opp = find('opportunities', seedOrder.opportunityId);
  }
  if (seedQuote && !opp) opp = find('opportunities', seedQuote.opportunityId);
  if (lead && !opp) opp = find('opportunities', lead.opportunityId) ?? rows('opportunities').find((o) => o.leadId === lead!.id);
  if (opp && !lead) lead = find('leads', opp.leadId) ?? rows('leads').find((l) => l.opportunityId === opp!.id);

  const quotations = opp ? rows('quotations').filter((q) => q.opportunityId === opp!.id) : seedQuote ? [seedQuote] : [];
  const quoteIds = new Set(quotations.map((q) => q.id));
  const orders = rows('salesOrders').filter((o) => (opp && o.opportunityId === opp.id) || (o.quotationId && quoteIds.has(String(o.quotationId))) || o.id === seedOrder?.id);
  const orderIds = new Set(orders.map((o) => o.id));
  const contracts = rows('salesContracts').filter((c) => orderIds.has(String(c.salesOrderId)));
  quotations.sort((a, b) => rootOf(a).localeCompare(rootOf(b)) || (Number(a.revision) || 0) - (Number(b.revision) || 0));
  return { lead, opportunity: opp, quotations, selectedQuotationId: selectedOf(opp, quotations, orders), orders, contracts };
}

export function chainRefs(chain: DealChain): DealRef[] {
  const out: DealRef[] = [];
  if (chain.lead) out.push({ resource: 'leads', id: chain.lead.id });
  if (chain.opportunity) out.push({ resource: 'opportunities', id: chain.opportunity.id });
  chain.quotations.forEach((q) => out.push({ resource: 'quotations', id: q.id }));
  chain.orders.forEach((o) => out.push({ resource: 'salesOrders', id: o.id }));
  chain.contracts.forEach((c) => out.push({ resource: 'salesContracts', id: c.id }));
  return out;
}

/** Can the actor open this record? Unreadable chain members are shown as restricted, their events are skipped. */
export function canSee(actor: Actor, resource: string, record: RecordData | undefined): boolean {
  if (!record) return false;
  try {
    return perm(actor, resource).read !== 'none' && canReadRecord(actor, getResource(resource), record);
  } catch {
    return false;
  }
}

/** Status (lifecycle) label + tone of any record. */
export function statusOf(resource: string, record: RecordData): { label: string; tone?: string } | undefined {
  const res = getResource(resource);
  const f = res.fields.find((x) => x.key === (res.lifecycle?.field ?? 'status'));
  if (!f?.master) return undefined;
  const v = masterValue(f.master, record[f.key]);
  return v ? { label: v.label, tone: v.tone } : record[f.key] ? { label: String(record[f.key]) } : undefined;
}

/** Short label for a chain record, e.g. "QT/TX/26-27/0012-R1" or "OPP-2627-00119". */
export function refLabel(resource: string, record: RecordData, actor?: Actor): string {
  if (resource === 'quotations') return String(record.quoteNo || record.id);
  if (resource === 'salesOrders') return String(record.orderNo || record.id);
  if (resource === 'salesContracts') return String(record.contractNo || record.id);
  if (resource === 'leads' || resource === 'opportunities') return String(record.id);
  return recordTitle(resource, record.id, actor) || String(record.id);
}

// ---------------------------------------------------------------- timeline

export type DealEventType = 'activity' | 'status' | 'edit' | 'approval' | 'comment' | 'record';
export const DEAL_FILTERS = ['all', 'activity', 'status', 'edit', 'approval', 'comment'] as const;
export type DealFilter = (typeof DEAL_FILTERS)[number];

export interface DealEvent {
  id: string;
  type: DealEventType;
  /** Icon name (shared Icon set). */
  icon: string;
  title: string;
  detail?: string;
  changes?: { field: string; label: string; before: string; after: string }[];
  /** Stored timestamp (UTC ISO or local wall-clock "YYYY-MM-DDTHH:mm"). */
  at: string;
  /** Epoch ms of `at` (local interpretation for wall-clock strings) — the sort key. */
  ts: number;
  actorName: string;
  automatic?: boolean;
  source: DealRef & { label: string };
}

const ACTIVITY_ICONS: Record<string, string> = { call: 'f-phone', email: 'f-email', whatsapp: 'message', meeting: 'users', visit: 'map-pin', demo: 'play', note: 'f-longtext' };

function staffName(staffId: unknown): string {
  if (!staffId) return D.system;
  return userOfStaff(staffId)?.name ?? String(find('employees', staffId)?.name ?? staffId);
}
const userName = (userId: string | undefined) => (userId ? getUser(userId)?.name ?? (userId.startsWith('system') ? D.system : userId) : D.system);
const tsOf = (s: string) => {
  const t = toDate(s).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** Child records of the chain (payment milestones, dispatches, installations, demos, samples …) via relation fields. */
function childRefs(actor: Actor, parents: DealRef[]): (DealRef & { label: string; parent: DealRef })[] {
  const byRes = new Map<string, Set<string>>();
  parents.forEach((p) => (byRes.get(p.resource) ?? byRes.set(p.resource, new Set()).get(p.resource)!).add(p.id));
  const out: (DealRef & { label: string; parent: DealRef })[] = [];
  const skip = new Set<string>([...DEAL_RESOURCES, 'activities']);
  for (const res of allResources()) {
    if (skip.has(res.key)) continue;
    const links = res.fields.filter((f) => f.type === 'relation' && f.relation && byRes.has(f.relation.resource) && !f.computed);
    if (!links.length) continue;
    for (const r of rows(res.key)) {
      const link = links.find((f) => byRes.get(f.relation!.resource)!.has(String(r[f.key])));
      if (!link || !canSee(actor, res.key, r)) continue;
      out.push({ resource: res.key, id: r.id, label: `${res.label} ${recordTitle(res.key, r.id, actor) || r.id}`, parent: { resource: link.relation!.resource, id: String(r[link.key]) } });
    }
  }
  return out;
}

function auditType(action: string): DealEventType {
  if (action === 'transition') return 'status';
  if (action === 'update') return 'edit';
  if (action.startsWith('approval.')) return 'approval';
  return 'record';
}
const AUDIT_ICON: Record<DealEventType, string> = { status: 'arrow-right', edit: 'pencil', approval: 'shield-check', record: 'file-text', activity: 'activity', comment: 'message' };

/** Seed records have no audit rows: milestone date fields stand in for them. */
const MILESTONES: { resource: string; field: keyof typeof D.milestone; icon: string }[] = [
  { resource: 'quotations', field: 'sentAt', icon: 'send' },
  { resource: 'quotations', field: 'acceptedAt', icon: 'check-circle' },
  { resource: 'quotations', field: 'notSelectedAt', icon: 'x-circle' },
  { resource: 'opportunities', field: 'wonAt', icon: 'trophy' },
  { resource: 'salesContracts', field: 'signedAt', icon: 'check-circle' },
];

/** Every event on the deal of `resKey/recordId`, newest first. Only records the actor may read contribute. */
export function buildDealTimeline(actor: Actor, resKey: string, recordId: string): DealEvent[] {
  const d = getDb();
  const chain = resolveDealChain(resKey, recordId);
  const members = chainRefs(chain)
    .map((ref) => ({ ...ref, record: find(ref.resource, ref.id)! }))
    .filter((m) => m.record && canSee(actor, m.resource, m.record));
  // The record itself always contributes, even when it is not part of a resolvable chain.
  if (!members.some((m) => m.resource === resKey && m.id === recordId)) {
    const self = find(resKey, recordId);
    if (self && canSee(actor, resKey, self)) members.push({ resource: resKey, id: recordId, record: self });
  }
  const sources = new Map<string, DealEvent['source']>();
  members.forEach((m) => sources.set(`${m.resource}:${m.id}`, { resource: m.resource, id: m.id, label: refLabel(m.resource, m.record, actor) }));
  childRefs(actor, members).forEach((c) => sources.set(`${c.resource}:${c.id}`, { resource: c.resource, id: c.id, label: c.label }));
  const sourceOf = (resource: string | undefined, id: string | undefined) => (resource && id ? sources.get(`${resource}:${id}`) : undefined);

  const events: DealEvent[] = [];
  const audited = new Set<string>();
  const created = new Set<string>();

  // 1. Audit ledger: create, status transitions, field edits (before → after), sends, acceptances, order/contract generation.
  for (const a of d.audit) {
    if (a.workspaceId !== actor.workspaceId) continue;
    const source = sourceOf(a.resource, a.recordId);
    if (!source) continue;
    audited.add(`${a.resource}:${a.recordId}`);
    // Approval requests/decisions come from the approvals store (per level, with notes); withdrawals stay here.
    if (a.action.startsWith('approval.') && a.action !== 'approval.withdrawn') continue;
    if (a.action === 'create') created.add(`${a.resource}:${a.recordId}`);
    const type = auditType(a.action);
    events.push({
      id: a.id,
      type,
      icon: a.action === 'approval.withdrawn' ? 'undo' : AUDIT_ICON[type],
      title: a.action === 'approval.withdrawn' ? D.approvalWithdrawn : a.summary,
      detail: a.action === 'approval.withdrawn' ? a.summary : undefined,
      changes: a.changes?.length ? a.changes : undefined,
      at: a.at,
      ts: tsOf(a.at),
      actorName: userName(a.actorId),
      automatic: a.actorType !== 'user',
      source,
    });
  }

  // 2. Creation of every chain record (seed records have no "create" audit row).
  for (const m of members) {
    const key = `${m.resource}:${m.id}`;
    if (created.has(key) || !m.record.createdAt) continue;
    const res = getResource(m.resource);
    events.push({
      id: `created:${key}`,
      type: 'record',
      icon: 'plus',
      title: D.created(res.label, refLabel(m.resource, m.record, actor)),
      at: String(m.record.createdAt),
      ts: tsOf(String(m.record.createdAt)),
      actorName: userName(String(m.record.createdBy ?? '')),
      source: sources.get(key)!,
    });
  }

  // 3. Milestones stored on seed records that have no audit history.
  for (const m of members) {
    const key = `${m.resource}:${m.id}`;
    if (audited.has(key)) continue;
    for (const ms of MILESTONES) {
      const v = ms.resource === m.resource ? m.record[ms.field] : undefined;
      if (!v) continue;
      events.push({ id: `ms:${key}:${ms.field}`, type: 'status', icon: ms.icon, title: D.milestone[ms.field], at: String(v), ts: tsOf(String(v)), actorName: D.system, automatic: true, source: sources.get(key)! });
    }
  }

  // 4. Approvals: the request, then one entry per level decision (who, decision, note).
  for (const ap of d.approvals) {
    if (ap.workspaceId !== actor.workspaceId) continue;
    const source = sourceOf(ap.resource, ap.recordId);
    if (!source) continue;
    events.push({ id: `apr:${ap.id}`, type: 'approval', icon: 'shield', title: D.approvalRequested(ap.summary), detail: ap.reason || undefined, at: ap.requestedAt, ts: tsOf(ap.requestedAt), actorName: userName(ap.requestedBy), source });
    ap.decisions.forEach((dec, i) => {
      const level = ap.levels[dec.level]?.label ?? String(dec.level + 1);
      events.push({
        id: `apr:${ap.id}:${i}`,
        type: 'approval',
        icon: dec.decision === 'approved' ? 'check-circle' : 'x-circle',
        title: D.approvalLevel(level, dec.decision === 'approved'),
        detail: dec.note || undefined,
        at: dec.at,
        ts: tsOf(dec.at),
        actorName: userName(dec.by),
        source,
      });
    });
  }

  // 5. Activities (calls, meetings, visits, notes …) logged on any chain or child record.
  if (perm(actor, 'activities').read !== 'none') {
    for (const act of rows('activities')) {
      const source = sourceOf(String(act.parentResource ?? ''), String(act.parentId ?? ''));
      if (!source || !act.at || !canSee(actor, 'activities', act)) continue;
      const type = String(act.activityType ?? 'note');
      const detail = [act.notes ? String(act.notes) : '', act.nextFollowUpAt ? D.nextFollowUp(String(act.nextFollowUpAt)) : ''].filter(Boolean).join(' · ');
      events.push({
        id: act.id,
        type: 'activity',
        icon: ACTIVITY_ICONS[type] ?? 'activity',
        title: D.activity(masterLabel('activityType', type), String(act.subject ?? '')),
        detail: detail || undefined,
        at: String(act.at),
        ts: tsOf(String(act.at)),
        actorName: staffName(act.byId),
        source,
      });
    }
  }

  // 6. Internal comments.
  for (const c of d.comments) {
    if (c.workspaceId !== actor.workspaceId) continue;
    const source = sourceOf(c.resource, c.recordId);
    if (!source) continue;
    events.push({ id: c.id, type: 'comment', icon: 'message', title: D.comment, detail: c.body, at: c.createdAt, ts: tsOf(c.createdAt), actorName: userName(c.authorId), source });
  }

  return events.sort((a, b) => b.ts - a.ts || a.id.localeCompare(b.id));
}

export interface DealHistory {
  events: DealEvent[];
  /** Records that contributed, for the record filter (chain members first, then child records). */
  sources: DealEvent['source'][];
}

export function dealHistory(actor: Actor, resKey: string, recordId: string): DealHistory {
  const events = buildDealTimeline(actor, resKey, recordId);
  const seen = new Map<string, DealEvent['source']>();
  const order = (s: DealEvent['source']) => {
    const i = (DEAL_RESOURCES as readonly string[]).indexOf(s.resource);
    return i < 0 ? DEAL_RESOURCES.length : i;
  };
  events.forEach((e) => seen.set(`${e.source.resource}:${e.source.id}`, e.source));
  return { events, sources: [...seen.values()].sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label)) };
}

/** Async boundary (simulated 300–800 ms latency, demo failure rate) — same signature a real API would have. */
export const fetchDealHistory = (actor: Actor, resKey: string, recordId: string) => call(() => dealHistory(actor, resKey, recordId));

/** Filter + group by local calendar day (newest day first). */
export function filterDealEvents(events: DealEvent[], type: DealFilter, sourceKey: string): DealEvent[] {
  return events.filter((e) => (type === 'all' || e.type === type || (type === 'status' && e.type === 'record')) && (!sourceKey || `${e.source.resource}:${e.source.id}` === sourceKey));
}
