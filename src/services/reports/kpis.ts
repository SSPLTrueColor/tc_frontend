/**
 * BRD Appendix C KPIs as pure functions over record arrays. Callers pass rows already read
 * through services (role-scoped), so every figure follows what the actor may see.
 * No store access here — this file is unit-tested on fixed fixtures.
 */
import { L } from '../../constants/labels';
import type { RecordData } from '../../metadata/types';
import { addDays, toDate } from '../../lib/dates';

type Rows = RecordData[];

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
export const ms = (v: unknown) => (s(v) ? toDate(s(v)).getTime() : NaN);
export const hoursBetween = (a: unknown, b: unknown) => (ms(b) - ms(a)) / 3_600_000;
const avg = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);
const ratio = (num: number, den: number) => (den ? num / den : null);
export const dayOf = (v: unknown) => s(v).slice(0, 10);
export const sum = (rows: Rows, key: string) => rows.reduce((t, r) => t + n(r[key]), 0);

/** Date-window test on a "YYYY-MM-DD…" value; open bounds pass. */
export const inRange = (v: unknown, from?: string, to?: string) => {
  const d = dayOf(v);
  if (!d) return false;
  return (!from || d >= from) && (!to || d <= to);
};

// ---------------------------------------------------------------- sales

/** Lead response time: hours from creation to first logged contact (contacted leads only). */
export const leadResponseHours = (leads: Rows) => avg(leads.filter((l) => s(l.firstContactAt)).map((l) => hoursBetween(l.createdAt, l.firstContactAt)).filter((h) => h >= 0));

/** Lead conversion %: leads qualified to opportunity ÷ leads created. */
export const leadConversion = (leads: Rows) => ratio(leads.filter((l) => l.status === 'qualified' || !!l.opportunityId).length, leads.length);

/** Win rate: opportunities won ÷ opportunities closed (won + lost). */
export function winRate(opps: Rows) {
  const won = opps.filter((o) => o.stage === 'won').length;
  const lost = opps.filter((o) => o.stage === 'lost').length;
  return ratio(won, won + lost);
}

const OPEN_STAGES = ['needs_assessment', 'demo', 'proposal', 'negotiation'];
export const isOpenOpp = (o: RecordData) => OPEN_STAGES.includes(s(o.stage));

/** Pipeline value and weighted forecast (value × stage probability) of open opportunities. */
export function pipeline(opps: Rows) {
  const open = opps.filter(isOpenOpp);
  return { count: open.length, value: sum(open, 'value'), weighted: open.reduce((t, o) => t + (n(o.weightedValue) || (n(o.value) * n(o.probability)) / 100), 0) };
}

/** Average sales cycle: days from lead creation (or opportunity creation) to the win. */
export function avgSalesCycleDays(opps: Rows, leads: Rows) {
  const leadById = new Map(leads.map((l) => [l.id, l]));
  return avg(
    opps
      .filter((o) => o.stage === 'won' && s(o.wonAt))
      .map((o) => (ms(o.wonAt) - ms(leadById.get(s(o.leadId))?.createdAt ?? o.createdAt)) / 86_400_000)
      .filter((d) => d >= 0),
  );
}

const SENT = ['sent', 'negotiation', 'accepted', 'rejected', 'expired'];
/** Quote-to-order %: latest quotations that became a sales order ÷ quotations sent. */
export function quoteToOrder(quotes: Rows, orders: Rows) {
  const ordered = new Set(orders.filter((o) => o.status !== 'cancelled').map((o) => s(o.quotationId)));
  const sent = quotes.filter((q) => q.isLatest !== false && (SENT.includes(s(q.status)) || s(q.sentAt)));
  return ratio(sent.filter((q) => ordered.has(q.id)).length, sent.length);
}

/** Order backlog: confirmed orders not yet completed (excludes pending approval, hold, cancelled). */
export const BACKLOG = ['confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch', 'dispatched', 'delivered', 'installation'];
export const orderBacklog = (orders: Rows) => {
  const rows = orders.filter((o) => BACKLOG.includes(s(o.status)));
  return { count: rows.length, value: sum(rows, 'grandTotal') };
};

/** Orders that count as booked business (confirmed or later, not cancelled). */
export const isBooked = (o: RecordData) => !['pending_approval', 'cancelled'].includes(s(o.status));

// ---------------------------------------------------------------- collections

export const outstandingOf = (m: RecordData) => Math.max(0, n(m.amount) - n(m.receivedAmount));

export const AGEING = [
  { key: '0-30', label: L.reports.ageing.overdue.d0_30, min: 1, max: 30 },
  { key: '31-60', label: L.reports.ageing.overdue.d31_60, min: 31, max: 60 },
  { key: '61-90', label: L.reports.ageing.overdue.d61_90, min: 61, max: 90 },
  { key: '90+', label: L.reports.ageing.overdue.d90, min: 91, max: Infinity },
];

/** Collections and overdues: payments received vs due, overdue amount and ageing as of a date. */
export function collections(milestones: Rows, today: string) {
  const due = milestones.filter((m) => dayOf(m.dueDate) <= today);
  const overdue = milestones.filter((m) => dayOf(m.dueDate) < today && outstandingOf(m) > 0);
  const age = (m: RecordData) => Math.round((ms(today) - ms(dayOf(m.dueDate))) / 86_400_000);
  return {
    dueAmount: sum(due, 'amount'),
    received: sum(milestones, 'receivedAmount'),
    overdueAmount: overdue.reduce((t, m) => t + outstandingOf(m), 0),
    overdueCount: overdue.length,
    ageing: AGEING.map((b) => {
      const rows = overdue.filter((m) => age(m) >= b.min && age(m) <= b.max);
      return { ...b, count: rows.length, amount: rows.reduce((t, m) => t + outstandingOf(m), 0) };
    }),
  };
}

// ---------------------------------------------------------------- service

const RESOLVED = ['resolved', 'customer_confirmation', 'closed'];
export const isResolvedTicket = (t: RecordData) => RESOLVED.includes(s(t.status)) && !!s(t.resolvedAt);
export const isOpenTicket = (t: RecordData) => !RESOLVED.includes(s(t.status));

/** SLA compliance %: resolved tickets that met both response and resolution targets ÷ resolved tickets. */
export function slaCompliance(tickets: Rows) {
  const resolved = tickets.filter(isResolvedTicket);
  const met = resolved.filter((t) => {
    const respOk = !s(t.responseDueAt) || (s(t.respondedAt) && ms(t.respondedAt) <= ms(t.responseDueAt));
    const resOk = !s(t.resolutionDueAt) || ms(t.resolvedAt) <= ms(t.resolutionDueAt);
    return respOk && resOk && !t.slaBreached;
  });
  return ratio(met.length, resolved.length);
}

/** MTTR: average hours from ticket creation to resolution, excluding customer-pause time. */
export const mttrHours = (tickets: Rows) => avg(tickets.filter(isResolvedTicket).map((t) => hoursBetween(t.reportedAt || t.createdAt, t.resolvedAt) - n(t.pausedMinutes) / 60).filter((h) => h >= 0));

/** First-time fix rate: site-visit tickets resolved with exactly one visit and never re-opened ÷ resolved site-visit tickets. */
export function firstTimeFix(tickets: Rows, visits: Rows) {
  const count = new Map<string, number>();
  visits.forEach((v) => count.set(s(v.ticketId), (count.get(s(v.ticketId)) ?? 0) + 1));
  const site = tickets.filter((t) => isResolvedTicket(t) && (count.get(t.id) ?? 0) > 0);
  return ratio(site.filter((t) => count.get(t.id) === 1 && !n(t.reopenCount)).length, site.length);
}

/** Repeat complaint %: tickets flagged as a repeat (same machine + category in the window) ÷ tickets. */
export const repeatRate = (tickets: Rows) => ratio(tickets.filter((t) => !!s(t.repeatOfId)).length, tickets.length);

/** PM compliance %: preventive visits done on or before the due date ÷ visits due by today. */
export function pmCompliance(pm: Rows, today: string) {
  const due = pm.filter((v) => dayOf(v.dueDate) <= today);
  return ratio(due.filter((v) => v.status === 'done' && (!s(v.completedAt) || dayOf(v.completedAt) <= dayOf(v.dueDate))).length, due.length);
}

/** AMC renewal %: contracts renewed ÷ contracts that came up for renewal (renewed + lost + expired). */
export function amcRenewalRate(contracts: Rows) {
  const renewed = contracts.filter((c) => c.status === 'renewed').length;
  const closed = renewed + contracts.filter((c) => c.status === 'lost' || c.status === 'expired').length;
  return ratio(renewed, closed);
}

/** CSAT: average feedback rating and share of ratings 4 or 5. */
export function csat(tickets: Rows) {
  const rated = tickets.map((t) => n(t.rating)).filter((r) => r >= 1 && r <= 5);
  return { avg: avg(rated), share4plus: ratio(rated.filter((r) => r >= 4).length, rated.length), count: rated.length };
}

/** Ageing buckets in days for open items (tickets, leads). */
export const OPEN_AGE = [
  { key: '0-2', label: L.reports.ageing.open.d0_2, min: 0, max: 2 },
  { key: '3-7', label: L.reports.ageing.open.d3_7, min: 3, max: 7 },
  { key: '8-15', label: L.reports.ageing.open.d8_15, min: 8, max: 15 },
  { key: '16-30', label: L.reports.ageing.open.d16_30, min: 16, max: 30 },
  { key: '30+', label: L.reports.ageing.open.d30, min: 31, max: Infinity },
];
export function ageingBuckets(rows: Rows, dateKey: string, nowMs: number) {
  return OPEN_AGE.map((b) => ({ ...b, count: rows.filter((r) => { const d = Math.floor((nowMs - ms(r[dateKey] || r.createdAt)) / 86_400_000); return d >= b.min && d <= b.max; }).length }));
}

/** MTBF by model: machine-days in the window ÷ breakdown tickets in the window (days between failures). */
export function mtbfByModel(machines: Rows, tickets: Rows, from: string, to: string) {
  const byMachine = new Map(machines.map((m) => [m.id, m]));
  const groups = new Map<string, { model: string; machines: number; machineDays: number; breakdowns: number }>();
  const windowDays = Math.max(1, Math.round((ms(to) - ms(from)) / 86_400_000) + 1);
  machines.forEach((m) => {
    const model = s(m.model) || L.reports.common.unknownModel;
    const g = groups.get(model) ?? { model, machines: 0, machineDays: 0, breakdowns: 0 };
    const start = dayOf(m.installDate) > from ? dayOf(m.installDate) : from;
    g.machines++;
    g.machineDays += Math.max(0, Math.round((ms(to) - ms(start)) / 86_400_000) + 1) || (start <= to ? windowDays : 0);
    groups.set(model, g);
  });
  tickets
    .filter((t) => t.ticketType === 'breakdown' && inRange(t.reportedAt, from, to))
    .forEach((t) => {
      const m = byMachine.get(s(t.machineId));
      const g = m ? groups.get(s(m.model) || L.reports.common.unknownModel) : undefined;
      if (g) g.breakdowns++;
    });
  return [...groups.values()].map((g) => ({ ...g, mtbfDays: g.breakdowns ? g.machineDays / g.breakdowns : null }));
}

// ---------------------------------------------------------------- consumables & adoption

/** Consumables attach rate: machine customers buying company consumables (in the lookback) ÷ machine customers. */
export function attachRate(machines: Rows, orders: Rows, sinceDay: string) {
  const machineCustomers = new Set(machines.filter((m) => m.status !== 'scrapped').map((m) => s(m.customerId)));
  const buyers = new Set(orders.filter((o) => o.orderKind === 'consumables' && isBooked(o) && dayOf(o.orderDate) >= sinceDay).map((o) => s(o.customerId)));
  return { rate: ratio([...machineCustomers].filter((c) => buyers.has(c)).length, machineCustomers.size), machineCustomers: machineCustomers.size };
}

/** Activity scorecard counts per person for a window (calls, visits, demos, quotations, referrals). */
export function activityScorecard(input: { activities: Rows; fieldVisits: Rows; demos: Rows; quotations: Rows; leads: Rows; from: string; to: string }) {
  const per = new Map<string, { calls: number; visits: number; demos: number; quotations: number; referrals: number }>();
  const row = (id: unknown) => {
    const k = s(id);
    if (!per.has(k)) per.set(k, { calls: 0, visits: 0, demos: 0, quotations: 0, referrals: 0 });
    return per.get(k)!;
  };
  input.activities.filter((a) => inRange(a.at, input.from, input.to)).forEach((a) => {
    if (a.activityType === 'call') row(a.byId).calls++;
    if (a.activityType === 'visit') row(a.byId).visits++;
    if (a.activityType === 'demo') row(a.byId).demos++;
  });
  input.fieldVisits.filter((v) => v.status === 'completed' && inRange(v.checkInAt || v.plannedFor, input.from, input.to)).forEach((v) => row(v.employeeId).visits++);
  input.demos.filter((d) => d.status === 'done' && inRange(d.scheduledAt, input.from, input.to)).forEach((d) => row(d.ownerId).demos++);
  input.quotations.filter((q) => s(q.sentAt) && inRange(q.sentAt, input.from, input.to)).forEach((q) => row(q.ownerId).quotations++);
  input.leads.filter((l) => l.sourceId === 'referral' && inRange(l.createdAt, input.from, input.to)).forEach((l) => row(l.referrerEmployeeId || l.ownerId).referrals++);
  return per;
}

/** Overdue follow-ups on open leads/opportunities owned by a person. */
export function overdueFollowUps(leads: Rows, opps: Rows, today: string) {
  const per = new Map<string, number>();
  [...leads.filter((l) => ['new', 'contacted', 'nurture'].includes(s(l.status))), ...opps.filter(isOpenOpp)]
    .filter((r) => s(r.nextFollowUpAt) && dayOf(r.nextFollowUpAt) < today)
    .forEach((r) => per.set(s(r.ownerId), (per.get(s(r.ownerId)) ?? 0) + 1));
  return per;
}

/** Months (YYYY-MM) ending at `today`, oldest first — for monthly series. */
export function lastMonths(today: string, count: number) {
  const out: string[] = [];
  const d = toDate(`${today.slice(0, 7)}-01`);
  for (let i = count - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

export const daysAgo = (today: string, days: number) => addDays(today, -days);
