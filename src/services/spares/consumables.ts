/**
 * Consumables & repeat business (CON-01/03/04, BR-39/40/41). Reads machines (installed module)
 * and sales orders (orders module) by their contract field names; tolerates either being absent.
 * Customer visibility follows the actor's scope on `customers`.
 */
import type { RecordData } from '../../metadata/types';
import { addDays, todayKey } from '../../lib/dates';
import { uid } from '../../lib/ids';
import { type Actor, can, canReadRecord } from '../authz';
import { commit, getDb } from '../db';
import { appendAudit, notify } from '../ledger';
import { userOfStaff } from '../lookups';
import { getPolicies } from '../policies';
import { allResources, getResource } from '../registry';
import { type Db, ServiceError } from '../types';

const has = (key: string) => allResources().some((r) => r.key === key);
const rows = (key: string): RecordData[] => getDb().records[key] ?? [];
const NOT_ORDERS = ['cancelled', 'pending_approval'];
const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / DAY);

function requireConsumables(actor: Actor) {
  if (!can(actor, 'consumables.view')) throw new ServiceError('forbidden', 'Your role cannot view consumables follow-up lists.');
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
        title: r.state === 'missed' ? `Missed reorder: ${r.customerName} was due ${r.dueDate} (${r.daysLate} days late)` : `Reorder due: ${r.customerName} around ${r.dueDate}`,
        link: { resource: 'customers', recordId: r.customerId },
      });
    });
    appendAudit(d, actor, { action: 'consumables.reminders', summary: `Reorder reminders sent for ${targets.length} customer(s)`, correlationId: uid('cor') });
  });
  return targets.length;
}

/** CON-01 / FR-098: consumables picture of one customer for the Customer 360 tab. */
export function customerConsumables(actor: Actor, customerId: string) {
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
