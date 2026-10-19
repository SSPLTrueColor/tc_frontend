/**
 * Consumables & repeat business (CON-01/03/04, BR-39/40/41). Reads machines (installed module)
 * and sales orders (orders module) by their contract field names; tolerates either being absent.
 * Customer visibility follows the actor's scope on `customers`.
 */
import type { RecordData } from '../../metadata/types';
import { L } from '../../constants/labels';
import { DEALER_CATEGORIES, DEALER_PRODUCT_TYPES } from '../../domain/modules/spares';
import { addDays, todayKey } from '../../lib/dates';
import { uid } from '../../lib/ids';
import { type Actor, can, canReadRecord, canUpdateRecord } from '../authz';
import { commit, getDb } from '../db';
import { appendAudit, notify } from '../ledger';
import { contractRateFor, userOfStaff } from '../lookups';
import { getPolicies } from '../policies';
import { allResources, getResource } from '../registry';
import { type Db, ServiceError } from '../types';

const has = (key: string) => allResources().some((r) => r.key === key);
const rows = (key: string): RecordData[] => getDb().records[key] ?? [];
const NOT_ORDERS = ['cancelled', 'pending_approval'];
const DAY = 86_400_000;
const E = L.consumables.errors;
const G = L.consumables.log;
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / DAY);

function requireConsumables(actor: Actor) {
  if (!can(actor, 'consumables.view')) throw new ServiceError('forbidden', E.forbidden);
}

/** Customers the actor may see (scope on the customers resource). */
function visibleCustomers(actor: Actor): RecordData[] {
  if (!has('customers')) return [];
  const res = getResource('customers');
  if ((actor.role.resources.customers?.read ?? 'none') === 'none') return [];
  return rows('customers').filter((c) => canReadRecord(actor, res, c));
}

/** Confirmed (or later) consumables orders, oldest first. */
function consumablesOrders(customerId?: string): RecordData[] {
  return rows('salesOrders')
    .filter((o) => o.orderKind === 'consumables' && !NOT_ORDERS.includes(String(o.status)) && (!customerId || o.customerId === customerId))
    .sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)));
}

const activeMachines = (customerId: string) => rows('machines').filter((m) => m.customerId === customerId && m.status !== 'scrapped');

export interface LeakageRow {
  customerId: string;
  customerName: string;
  ownerId: string;
  machines: number;
  models: string;
  lastOrderDate: string | null;
  daysSince: number | null;
}

/** CON-03 / BR-39: machine customers with no consumables order in the last N days. */
export function leakageList(actor: Actor): { rows: LeakageRow[]; days: number; machineCustomers: number; sourcesMissing: string[] } {
  requireConsumables(actor);
  const days = getPolicies().leakageDays;
  const sourcesMissing = ['customers', 'machines', 'salesOrders'].filter((k) => !has(k));
  const cutoff = addDays(todayKey(), -days);
  const out: LeakageRow[] = [];
  let machineCustomers = 0;
  for (const c of visibleCustomers(actor)) {
    const ms = activeMachines(c.id);
    if (!ms.length) continue;
    machineCustomers++;
    const orders = consumablesOrders(c.id);
    const last = orders.length ? String(orders[orders.length - 1].orderDate).slice(0, 10) : null;
    if (last && last >= cutoff) continue;
    out.push({
      customerId: c.id,
      customerName: String(c.name),
      ownerId: String(c.ownerId ?? ''),
      machines: ms.length,
      models: [...new Set(ms.map((m) => String(m.model ?? m.serialNo ?? '')))].filter(Boolean).join(', '),
      lastOrderDate: last,
      daysSince: last ? daysBetween(last, todayKey()) : null,
    });
  }
  out.sort((a, b) => (b.daysSince ?? 99999) - (a.daysSince ?? 99999));
  return { rows: out, days, machineCustomers, sourcesMissing };
}

export type ReorderState = 'upcoming' | 'due' | 'missed';

export interface ReorderRow {
  customerId: string;
  customerName: string;
  ownerId: string;
  orders: number;
  avgIntervalDays: number;
  lastOrderId: string;
  lastOrderDate: string;
  lastOrderValue: number;
  dueDate: string;
  state: ReorderState;
  daysLate: number;
}

/** BR-40: due = last order + average interval of the last 3 orders (needs ≥ 2 orders). */
export function predictReorder(orderDates: string[], today = todayKey(), missedAfter = getPolicies().missedReorderDays) {
  const dates = orderDates.map((d) => d.slice(0, 10)).sort();
  if (dates.length < 2) return null;
  const recent = dates.slice(-4); // last 4 orders → last 3 intervals
  const gaps = recent.slice(1).map((d, i) => daysBetween(recent[i], d));
  const avg = Math.max(1, Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length));
  const due = addDays(dates[dates.length - 1], avg);
  const late = daysBetween(due, today);
  const state: ReorderState = late > missedAfter ? 'missed' : daysBetween(today, due) <= 7 ? 'due' : 'upcoming';
  return { avgIntervalDays: avg, dueDate: due, state, daysLate: Math.max(0, late) };
}

/** CON-04 reorder list for the actor's customers. */
export function reorderList(actor: Actor): { rows: ReorderRow[]; sourcesMissing: string[] } {
  requireConsumables(actor);
  const sourcesMissing = ['customers', 'salesOrders'].filter((k) => !has(k));
  const out: ReorderRow[] = [];
  for (const c of visibleCustomers(actor)) {
    const orders = consumablesOrders(c.id);
    const pred = predictReorder(orders.map((o) => String(o.orderDate)));
    if (!pred) continue;
    const last = orders[orders.length - 1];
    out.push({ customerId: c.id, customerName: String(c.name), ownerId: String(c.ownerId ?? ''), orders: orders.length, lastOrderId: last.id, lastOrderDate: String(last.orderDate).slice(0, 10), lastOrderValue: Number(last.grandTotal ?? 0), ...pred });
  }
  const rank = { missed: 0, due: 1, upcoming: 2 } as const;
  out.sort((a, b) => rank[a.state] - rank[b.state] || a.dueDate.localeCompare(b.dueDate));
  return { rows: out, sourcesMissing };
}

/** CON-04 reminders to the salesperson for due and missed reorders ("missed reorder" alert). */
export function sendReorderReminders(actor: Actor): number {
  const { rows: list } = reorderList(actor);
  const targets = list.filter((r) => r.state !== 'upcoming');
  commit((d: Db) => {
    targets.forEach((r) => {
      const u = userOfStaff(r.ownerId);
      if (!u) return;
      notify(d, {
        userId: u.id,
        workspaceId: actor.workspaceId,
        kind: r.state === 'missed' ? 'exception' : 'reminder',
        title: r.state === 'missed' ? G.missed(r.customerName, r.dueDate, r.daysLate) : G.due(r.customerName, r.dueDate),
        link: { resource: 'customers', recordId: r.customerId },
      });
    });
    appendAudit(d, actor, { action: 'consumables.reminders', summary: G.remindersAudit(targets.length), correlationId: uid('cor') });
  });
  return targets.length;
}

/** CON-01 / FR-098: consumables picture of one customer for the Customer 360 tab. */
export function customerConsumables(actor: Actor, customerId: string) {
  requireConsumables(actor);
  const machines = activeMachines(customerId);
  const orders = consumablesOrders(customerId).slice().reverse();
  const visible = (key: string) => {
    if (!has(key) || (actor.role.resources[key]?.read ?? 'none') === 'none') return [] as RecordData[];
    const res = getResource(key);
    return rows(key).filter((r) => r.customerId === customerId && canReadRecord(actor, res, r));
  };
  const today = todayKey();
  const contracts = visible('rateContracts').filter((r) => r.status !== 'inactive' && String(r.validTo) >= today);
  const samples = visible('sampleDispatches');
  const pred = predictReorder(orders.map((o) => String(o.orderDate)));
  const last = orders[0] ? String(orders[0].orderDate).slice(0, 10) : null;
  const leaking = machines.length > 0 && (!last || last < addDays(today, -getPolicies().leakageDays));
  return { machines, orders: orders.slice(0, 8), orderCount: orders.length, contracts, samples, reorder: pred, lastOrderDate: last, leaking, nonMachineCustomer: machines.length === 0 };
}

/** BR-41: two active contracts for the same customer and product may not overlap. */
export function findOverlap(d: Db, candidate: Record<string, unknown>, selfId?: string): RecordData | undefined {
  if (candidate.status === 'inactive' || !candidate.validFrom || !candidate.validTo) return undefined;
  return (d.records.rateContracts ?? []).find(
    (r) =>
      r.id !== selfId &&
      r.status !== 'inactive' &&
      r.customerId === candidate.customerId &&
      r.productId === candidate.productId &&
      String(r.validFrom) <= String(candidate.validTo) &&
      String(candidate.validFrom) <= String(r.validTo),
  );
}

// ---------------------------------------------------------------- Repeat Orders (CON-02)

export interface RepeatOrderRow {
  id: string;
  orderNo: string;
  customerId: string;
  customerName: string;
  orderDate: string;
  value: number;
  items: number;
  products: string;
  /** At least one line will be priced from a valid rate contract on repeat (BR-41). */
  contract: boolean;
  ownerId: string;
  /** Latest consumables order of this customer. */
  latest: boolean;
  customerOrders: number;
}

/** Previous consumables orders the actor can see, newest first, flagged with the price that applies on repeat. */
export function repeatOrderList(actor: Actor): { rows: RepeatOrderRow[]; sourcesMissing: string[]; canRepeat: boolean } {
  requireConsumables(actor);
  const sourcesMissing = ['customers', 'salesOrders'].filter((k) => !has(k));
  if (sourcesMissing.length) return { rows: [], sourcesMissing, canRepeat: false };
  if ((actor.role.resources.salesOrders?.read ?? 'none') === 'none') throw new ServiceError('forbidden', E.ordersForbidden);
  const res = getResource('salesOrders');
  const customers = new Map(rows('customers').map((c) => [c.id, c]));
  const products = new Map(rows('products').map((p) => [p.id, p]));
  const today = todayKey();
  const orders = consumablesOrders().filter((o) => canReadRecord(actor, res, o));
  const latestOf = new Map<string, RecordData>();
  const countOf = new Map<string, number>();
  orders.forEach((o) => {
    const k = String(o.customerId);
    countOf.set(k, (countOf.get(k) ?? 0) + 1);
    const cur = latestOf.get(k);
    if (!cur || String(o.orderDate) >= String(cur.orderDate)) latestOf.set(k, o);
  });
  const out = orders.map((o): RepeatOrderRow => {
    const lines = (o.lines as { productId: string; description?: string }[] | undefined) ?? [];
    const cid = String(o.customerId);
    return {
      id: o.id,
      orderNo: String(o.orderNo ?? o.id),
      customerId: cid,
      customerName: String(customers.get(cid)?.name ?? cid),
      orderDate: String(o.orderDate).slice(0, 10),
      value: Number(o.grandTotal ?? 0),
      items: lines.length,
      products: lines.map((l) => String(products.get(l.productId)?.name ?? l.description ?? l.productId)).join(', '),
      contract: lines.some((l) => contractRateFor(cid, l.productId, today) !== null),
      ownerId: String(o.ownerId ?? ''),
      latest: latestOf.get(cid)?.id === o.id,
      customerOrders: countOf.get(cid) ?? 0,
    };
  });
  out.sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.id.localeCompare(a.id));
  return { rows: out, sourcesMissing, canRepeat: !!actor.role.resources.salesOrders?.create };
}

// ---------------------------------------------------------------- Dealer / Distributor Orders (CON-06)

export interface DealerOrderRow {
  id: string;
  version: number;
  orderDate: string;
  dealerId: string;
  dealerName: string;
  endCustomer: string;
  endCustomerCity: string;
  productId: string;
  productName: string;
  qty: number;
  uom: string;
  rate: number;
  value: number;
  status: string;
  invoiceNo: string;
  canEdit: boolean;
}

/** Secondary sales the actor can see (scope on dealerOrders), newest first. */
export function dealerOrderList(actor: Actor): { rows: DealerOrderRow[]; dealers: { value: string; label: string }[]; canCreate: boolean; canDelete: boolean } {
  const res = getResource('dealerOrders');
  const perm = actor.role.resources.dealerOrders;
  if ((perm?.read ?? 'none') === 'none') throw new ServiceError('forbidden', L.consumables.pages.dealerOrders.noAccess);
  const customers = new Map(rows('customers').map((c) => [c.id, c]));
  const products = new Map(rows('products').map((p) => [p.id, p]));
  const list = rows('dealerOrders')
    .filter((r) => canReadRecord(actor, res, r))
    .map(
      (r): DealerOrderRow => ({
        id: r.id,
        version: r.version,
        orderDate: String(r.orderDate ?? ''),
        dealerId: String(r.dealerId ?? ''),
        dealerName: String(customers.get(String(r.dealerId))?.name ?? r.dealerId ?? ''),
        endCustomer: String(r.endCustomer ?? ''),
        endCustomerCity: String(r.endCustomerCity ?? ''),
        productId: String(r.productId ?? ''),
        productName: String(products.get(String(r.productId))?.name ?? r.productId ?? ''),
        qty: Number(r.qty ?? 0),
        uom: String(r.uom ?? ''),
        rate: Number(r.rate ?? 0),
        value: Number(r.qty ?? 0) * Number(r.rate ?? 0),
        status: String(r.status ?? ''),
        invoiceNo: String(r.invoiceNo ?? ''),
        canEdit: canUpdateRecord(actor, res, r),
      }),
    )
    .sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.id.localeCompare(a.id));
  const dealers = visibleCustomers(actor)
    .filter((c) => DEALER_CATEGORIES.includes(String(c.category)))
    .map((c) => ({ value: c.id, label: String(c.name) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { rows: list, dealers, canCreate: !!perm?.create, canDelete: !!perm?.delete };
}

/** CON-06 rules on create / update: dealer category, end customer, date, product, duplicate invoice. Fills division and owner. */
export function prepareDealerOrder(d: Db, c: Record<string, unknown>, selfId?: string, actor?: Actor) {
  const fe = (field: string, message: string) => new ServiceError('validation', message, { fieldErrors: { [field]: message } });
  const dealer = d.records.customers?.find((x) => x.id === c.dealerId);
  if (!dealer || !DEALER_CATEGORIES.includes(String(dealer.category))) throw fe('dealerId', E.notDealer);
  // The order belongs to the dealer's account owner, so the dealer must be inside the actor's customer scope.
  if (actor && has('customers') && !canReadRecord(actor, getResource('customers'), dealer)) throw fe('dealerId', E.customerOutOfScope);
  const end = String(c.endCustomer ?? '').trim();
  if (end.length < 2) throw fe('endCustomer', E.endCustomerShort);
  if (end.toLowerCase() === String(dealer.name ?? '').trim().toLowerCase()) throw fe('endCustomer', E.sameCustomer);
  c.endCustomer = end;
  if (c.orderDate && String(c.orderDate).slice(0, 10) > todayKey()) throw fe('orderDate', E.futureDate);
  const product = d.records.products?.find((x) => x.id === c.productId);
  if (product && product.status === 'inactive') throw fe('productId', E.productInactive);
  if (product && !DEALER_PRODUCT_TYPES.includes(String(product.productType))) throw fe('productId', E.dealerProductType);
  const inv = String(c.invoiceNo ?? '').trim().toUpperCase();
  c.invoiceNo = inv;
  if (inv) {
    const dup = (d.records.dealerOrders ?? []).find((x) => x.id !== selfId && x.dealerId === c.dealerId && String(x.invoiceNo ?? '').toUpperCase() === inv);
    if (dup) throw fe('invoiceNo', E.duplicateInvoice(dup.id));
  }
  c.divisionId = product?.divisionId ?? ((dealer.divisionIds as string[] | undefined) ?? [])[0] ?? null;
  c.ownerId = dealer.ownerId ?? null;
}
