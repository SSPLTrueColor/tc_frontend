/**
 * Role dashboard (FR-149, NFR-22) driven by one global date range.
 * Every figure is computed from records read through the scoped dataset, compared with the
 * equal-length period before it, and links to the list it summarises.
 */
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
import { addDays, formatDate, parseLocal, todayKey } from '../../lib/dates';
import { nowMs } from '../../lib/clock';
import { resourcePath } from '../../lib/routes';
import { type Actor, canReadResource } from '../authz';
import { achievement } from '../field/field';
import { periodStartFor } from '../field/rules';
import { canDecide, listApprovals } from '../workflow';
import { masterLabel, masterValue } from '../registry';
import { FAMILY, listWith, planFor, type PlanItem, type Signal } from './dashboard';
import { loadDataset } from './dataset';
import { compactInr } from './format';
import { reportPath } from './helpers';
import { collections, csat, dayOf, inRange, isBooked, isOpenOpp, isOpenTicket, isResolvedTicket, mttrHours, ms, outstandingOf, pipeline, quoteToOrder, slaCompliance, sum, winRate } from './kpis';
import type { Dataset } from './types';
import type { RecordData } from '../../metadata/types';

type Rows = RecordData[];
const DL = L.dashboard;
const K = DL.kpis;
const KS = DL.kpiSub;
const W = DL.widgets;
const B = DL.board;
const AL = DL.alerts;

// ---------------------------------------------------------------- date range

export type RangeKey = 'today' | '7d' | '30d' | 'month' | 'custom';
export interface DashRange {
  key: RangeKey;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  days: number;
  label: string;
}
export interface CustomRange {
  from: string;
  to: string;
}
export const MAX_RANGE_DAYS = 366;

const daysBetween = (a: string, b: string) => Math.round((parseLocal(`${b}T00:00`).getTime() - parseLocal(`${a}T00:00`).getTime()) / 86_400_000);

/** Resolve a preset or custom range plus the equal-length window immediately before it. */
export function resolveRange(key: RangeKey, custom?: CustomRange, today = todayKey()): DashRange {
  let from = today;
  let to = today;
  let label: string = DL.range.labels.today;
  if (key === '7d') {
    from = addDays(today, -6);
    label = DL.range.labels.last7;
  } else if (key === '30d') {
    from = addDays(today, -29);
    label = DL.range.labels.last30;
  } else if (key === 'month') {
    from = `${today.slice(0, 7)}-01`;
    label = DL.range.labels.month;
  } else if (key === 'custom' && custom?.from && custom?.to) {
    from = custom.from <= custom.to ? custom.from : custom.to;
    to = custom.from <= custom.to ? custom.to : custom.from;
    label = `${formatDate(from)} – ${formatDate(to)}`;
  }
  const days = daysBetween(from, to) + 1;
  let prevFrom = addDays(from, -days);
  let prevTo = addDays(from, -1);
  if (key === 'month') {
    // Same number of elapsed days in the previous calendar month.
    prevTo = addDays(from, -1);
    prevFrom = `${prevTo.slice(0, 7)}-01`;
    const cap = addDays(prevFrom, days - 1);
    if (cap < prevTo) prevTo = cap;
  }
  return { key, from, to, prevFrom, prevTo, days, label };
}

// ---------------------------------------------------------------- shapes

export type Fmt = 'money' | 'number' | 'pct' | 'hours' | 'rating';
export type KpiIcon = 'bar-chart' | 'target' | 'users' | 'wrench' | 'receipt' | 'shopping-cart' | 'truck' | 'package' | 'file-text' | 'activity' | 'alert' | 'calendar-clock' | 'check-square' | 'star' | 'inbox' | 'printer';

export interface Kpi {
  id: string;
  label: string;
  icon: KpiIcon;
  /** Raw value; null when there is nothing to measure in the range. */
  value: number | null;
  fmt: Fmt;
  /** % change vs the previous period; null when it cannot be computed. */
  delta: number | null;
  /** Which direction is good, to colour the change. */
  good: 'up' | 'down';
  spark: number[];
  sub?: string;
  to?: string;
  /** Target-vs-actual card: shows a radial gauge instead of the sparkline. */
  radial?: { pct: number; actual: string; target: string };
}
export interface TrendPoint {
  label: string;
  tip: string;
  [series: string]: number | string;
}
export interface Trend {
  title: string;
  info: string;
  money: boolean;
  unit: string;
  series: { key: string; label: string; tone: Signal | 'accent' }[];
  points: TrendPoint[];
  note?: string;
  to?: string;
}
export interface Slice {
  key: string;
  label: string;
  value: number;
  tone: Signal | 'accent';
  to?: string;
}
export interface Share {
  title: string;
  info: string;
  totalLabel: string;
  slices: Slice[];
}
export interface Step {
  key: string;
  label: string;
  value: number;
  /** ₹ attached to the step, when the stage carries value. */
  amount?: number;
  /** Conversion from the previous step, 0–1. */
  conv?: number | null;
  tone: Signal | 'accent';
  to?: string;
}
export interface Pipe {
  title: string;
  info: string;
  money: boolean;
  unit: string;
  steps: Step[];
  to?: string;
}
export interface Board {
  title: string;
  info: string;
  columns: { key: string; label: string; num?: boolean }[];
  rows: { id: string; cells: Record<string, string>; to?: string }[];
  to?: string;
  empty: string;
}
export interface FeedItem {
  id: string;
  title: string;
  sub: string;
  at: string;
  kind: string;
  to: string;
}
export interface AlertItem {
  id: string;
  label: string;
  sub: string;
  count: number;
  tone: 'danger' | 'warning' | 'info';
  to: string;
}
export interface Dashboard {
  family: string;
  headline: string;
  range: DashRange;
  kpis: Kpi[];
  trend: Trend;
  share: Share;
  pipe: Pipe;
  board: Board;
  agenda: PlanItem[];
  feed: FeedItem[];
  alerts: AlertItem[];
}

// ---------------------------------------------------------------- helpers

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
const within = (rows: Rows, key: string, from: string, to: string) => rows.filter((r) => inRange(r[key], from, to));
const pctChange = (cur: number | null, prev: number | null) => (cur === null || prev === null || prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10);
const round1 = (x: number) => Math.round(x * 10) / 10;
const tone = (master: string, key: string): Slice['tone'] => (masterValue(master, key)?.tone as Slice['tone']) ?? 'neutral';

interface Bucket {
  from: string;
  to: string;
  label: string;
  tip: string;
}

/** Time buckets for charts: daily up to ~5 weeks, weekly up to ~4 months, otherwise monthly. A one-day range borrows the last 7 days for context. */
function buckets(range: DashRange): Bucket[] {
  const from = range.days < 7 ? addDays(range.to, -6) : range.from;
  const days = daysBetween(from, range.to) + 1;
  const out: Bucket[] = [];
  const short = (d: string) => formatDate(d).slice(0, 5);
  if (days <= 35) {
    for (let d = from; d <= range.to; d = addDays(d, 1)) out.push({ from: d, to: d, label: short(d), tip: formatDate(d) });
  } else if (days <= 120) {
    for (let d = from; d <= range.to; d = addDays(d, 7)) {
      const e = addDays(d, 6) > range.to ? range.to : addDays(d, 6);
      out.push({ from: d, to: e, label: short(d), tip: `${formatDate(d)} – ${formatDate(e)}` });
    }
  } else {
    let d = from;
    while (d <= range.to) {
      const monthEnd = addDays(`${addMonth(d.slice(0, 7))}-01`, -1);
      const e = monthEnd > range.to ? range.to : monthEnd;
      out.push({ from: d, to: e, label: `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`, tip: `${formatDate(d)} – ${formatDate(e)}` });
      d = addDays(e, 1);
    }
  }
  return out;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function addMonth(ym: string) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Per-bucket aggregate of `rows` by their date field (sum of `valueKey`, or a count). */
function perBucket(bs: Bucket[], rows: Rows, dateKey: string, valueKey?: string): number[] {
  return bs.map((b) => {
    const hit = rows.filter((r) => inRange(r[dateKey], b.from, b.to));
    return valueKey ? sum(hit, valueKey) : hit.length;
  });
}

/** Snapshot reconstruction: what was open / overdue at the end of a given day, from record dates. */
const closedDay = (o: RecordData) => dayOf(o.wonAt || o.stageChangedAt || o.updatedAt);
const openOppsAsOf = (opps: Rows, day: string) => opps.filter((o) => dayOf(o.createdAt) <= day && (isOpenOpp(o) || closedDay(o) > day));
const openTicketsAsOf = (tickets: Rows, day: string) => tickets.filter((t) => dayOf(t.reportedAt || t.createdAt) <= day && (!isResolvedTicket(t) || dayOf(t.resolvedAt) > day));
const overdueAsOf = (ms_: Rows, day: string) => ms_.filter((m) => dayOf(m.dueDate) < day).reduce((t, m) => t + Math.max(0, n(m.amount) - (s(m.receivedAt) && dayOf(m.receivedAt) <= day ? n(m.receivedAmount) : 0)), 0);
const atEnds = (bs: Bucket[], f: (day: string) => number) => bs.map((b) => f(b.to));

/** List conditions matching isBooked() (confirmed or later, not cancelled). */
const BOOKED_CONDS: [string, 'neq', string][] = [
  ['status', 'neq', 'pending_approval'],
  ['status', 'neq', 'cancelled'],
];
const dateConds = (key: string, r: { from: string; to: string }): [string, 'gte' | 'lte', string][] => [
  [key, 'gte', r.from],
  [key, 'lte', r.to],
];

// ---------------------------------------------------------------- entry

const OPEN_LEAD = ['new', 'contacted', 'nurture'];
const OPEN_TICKET = ['open', 'assigned', 'accepted', 'in_progress', 'waiting_parts', 'waiting_customer', 'reopened'];
const OPP_STAGES = ['needs_assessment', 'demo', 'proposal', 'negotiation', 'won'];

export function dashboardFor(actor: Actor, range: DashRange): Dashboard {
  const ds = loadDataset(actor);
  const today = todayKey();
  const family = FAMILY[actor.role.id] ?? 'sales';
  const bs = buckets(range);
  const ctx: Ctx = { ds, actor, today, range, bs, prev: { from: range.prevFrom, to: range.prevTo } };

  const kpis = kpisFor(family, ctx);
  const body = bodyFor(family, ctx);
  return {
    family,
    headline: HEADLINE[family] ?? '',
    range,
    kpis,
    ...body,
    agenda: planFor(ds, actor, today),
    feed: feedFor(ctx),
    alerts: alertsFor(family, ctx),
  };
}

const HEADLINE: Record<string, string> = DL.headlines;

interface Ctx {
  ds: Dataset;
  actor: Actor;
  today: string;
  range: DashRange;
  bs: Bucket[];
  prev: CustomRange;
}

// ---------------------------------------------------------------- KPI cards

function kpi(k: Omit<Kpi, 'delta' | 'good'> & { prev?: number | null; good?: 'up' | 'down'; delta?: number | null }): Kpi {
  const { prev, good = 'up', delta, ...rest } = k;
  return { ...rest, good, delta: delta !== undefined ? delta : prev === undefined ? null : pctChange(k.value, prev) };
}

/** Orders booked (confirmed or later) in a window. */
const booked = (ds: Dataset, from: string, to: string) => within(ds.get('salesOrders').filter(isBooked), 'orderDate', from, to);

function revenueKpi(c: Ctx): Kpi {
  const cur = booked(c.ds, c.range.from, c.range.to);
  const prev = booked(c.ds, c.prev.from, c.prev.to);
  return kpi({ id: 'revenue', label: K.orderValue, icon: 'receipt', fmt: 'money', value: sum(cur, 'grandTotal'), prev: sum(prev, 'grandTotal'), spark: perBucket(c.bs, c.ds.get('salesOrders').filter(isBooked), 'orderDate', 'grandTotal'), sub: KS.salesOrders(cur.length), to: listWith('salesOrders', [...BOOKED_CONDS, ...dateConds('orderDate', c.range)]) });
}

function pipelineKpi(c: Ctx): Kpi {
  const opps = c.ds.get('opportunities');
  const open = pipeline(opps);
  const val = (day: string) => sum(openOppsAsOf(opps, day), 'value');
  const added = within(opps, 'createdAt', c.range.from, c.range.to);
  return kpi({ id: 'pipeline', label: K.pipeline, icon: 'bar-chart', fmt: 'money', value: c.range.to >= c.today ? open.value : val(c.range.to), delta: pctChange(val(c.range.to), val(c.prev.to)), spark: atEnds(c.bs, val), sub: KS.pipeline(open.count, compactInr(sum(added, 'value'))), to: ROUTES.pipeline });
}

const closedIn = (opps: Rows, from: string, to: string) => opps.filter((o) => ['won', 'lost'].includes(s(o.stage)) && inRange(o.wonAt || o.stageChangedAt || o.updatedAt, from, to));

function winRateKpi(c: Ctx): Kpi {
  const opps = c.ds.get('opportunities');
  const cur = closedIn(opps, c.range.from, c.range.to);
  const prev = closedIn(opps, c.prev.from, c.prev.to);
  const won = opps.filter((o) => o.stage === 'won');
  const wr = winRate(cur);
  return kpi({ id: 'winrate', label: K.winRate, icon: 'target', fmt: 'pct', value: wr, prev: winRate(prev), spark: c.bs.map((b) => won.filter((o) => inRange(o.wonAt || o.stageChangedAt || o.updatedAt, b.from, b.to)).length), sub: KS.wonLost(cur.filter((o) => o.stage === 'won').length, cur.filter((o) => o.stage === 'lost').length), to: listWith('opportunities', [['stage', 'in', ['won', 'lost']], ...dateConds('stageChangedAt', c.range)]) });
}

function leadsKpi(c: Ctx): Kpi {
  const leads = c.ds.get('leads');
  const cur = within(leads, 'createdAt', c.range.from, c.range.to);
  const prev = within(leads, 'createdAt', c.prev.from, c.prev.to);
  const q = cur.filter((l) => l.status === 'qualified' || !!l.opportunityId).length;
  return kpi({ id: 'leads', label: K.newLeads, icon: 'users', fmt: 'number', value: cur.length, prev: prev.length, spark: perBucket(c.bs, leads, 'createdAt'), sub: cur.length ? KS.qualified(Math.round((q / cur.length) * 100)) : undefined, to: listWith('leads', dateConds('createdAt', c.range)) });
}

function quoteKpi(c: Ctx): Kpi {
  const quotes = c.ds.get('quotations');
  const orders = c.ds.get('salesOrders');
  const cur = within(quotes, 'quoteDate', c.range.from, c.range.to);
  const prev = within(quotes, 'quoteDate', c.prev.from, c.prev.to);
  return kpi({ id: 'q2o', label: K.quoteToOrder, icon: 'file-text', fmt: 'pct', value: quoteToOrder(cur, orders), prev: quoteToOrder(prev, orders), spark: perBucket(c.bs, quotes, 'quoteDate'), sub: KS.quotations(cur.length), to: listWith('quotations', dateConds('quoteDate', c.range)) });
}

function targetKpi(c: Ctx): Kpi | null {
  if (!canReadResource(c.actor, 'targets')) return null;
  try {
    const rows = achievement(c.actor, 'month', periodStartFor('month', c.range.to));
    const mine = rows.find((r) => r.target.employeeId === c.actor.staffId) ?? rows[0];
    if (!mine) return null;
    const money = /value|revenue|order/i.test(s(mine.target.metric));
    const fmt = (v: number) => (money ? compactInr(v) : String(Math.round(v)));
    return kpi({ id: 'target', label: K.targetVsActual, icon: 'target', fmt: 'pct', value: mine.pct / 100, delta: null, spark: [], sub: `${s(masterLabel('targetMetric', mine.target.metric)) || s(mine.target.metric)} · ${mine.label}`, to: ROUTES.targetVsActual, radial: { pct: mine.pct, actual: fmt(mine.actual), target: fmt(n(mine.target.targetValue)) } });
  } catch {
    return null;
  }
}

const raisedIn = (tickets: Rows, from: string, to: string) => within(tickets, 'reportedAt', from, to);
const resolvedIn = (tickets: Rows, from: string, to: string) => tickets.filter((t) => isResolvedTicket(t) && inRange(t.resolvedAt, from, to));

function openTicketsKpi(c: Ctx, label: string = K.openTickets): Kpi {
  const tickets = c.ds.get('tickets');
  const open = tickets.filter(isOpenTicket);
  const breached = open.filter((t) => t.slaBreached || (s(t.resolutionDueAt) && ms(t.resolutionDueAt) < nowMs()));
  const count = (day: string) => openTicketsAsOf(tickets, day).length;
  return kpi({ id: 'open-tickets', label, icon: 'wrench', fmt: 'number', value: c.range.to >= c.today ? open.length : count(c.range.to), good: 'down', delta: pctChange(count(c.range.to), count(c.prev.to)), spark: atEnds(c.bs, count), sub: KS.openTickets(breached.length, raisedIn(tickets, c.range.from, c.range.to).length), to: listWith('tickets', [['status', 'in', OPEN_TICKET]]) });
}
function resolvedKpi(c: Ctx): Kpi {
  const tickets = c.ds.get('tickets');
  const cur = resolvedIn(tickets, c.range.from, c.range.to);
  return kpi({ id: 'resolved', label: K.resolved, icon: 'check-square', fmt: 'number', value: cur.length, prev: resolvedIn(tickets, c.prev.from, c.prev.to).length, spark: c.bs.map((b) => resolvedIn(tickets, b.from, b.to).length), to: listWith('tickets', dateConds('resolvedAt', c.range)) });
}
function slaKpi(c: Ctx): Kpi {
  const tickets = c.ds.get('tickets');
  return kpi({ id: 'sla', label: K.sla, icon: 'alert', fmt: 'pct', value: slaCompliance(resolvedIn(tickets, c.range.from, c.range.to)), prev: slaCompliance(resolvedIn(tickets, c.prev.from, c.prev.to)), spark: c.bs.map((b) => slaCompliance(resolvedIn(tickets, b.from, b.to)) ?? 0), to: reportPath('sla-compliance') });
}
function mttrKpi(c: Ctx): Kpi {
  const tickets = c.ds.get('tickets');
  const v = mttrHours(resolvedIn(tickets, c.range.from, c.range.to));
  return kpi({ id: 'mttr', label: K.mttr, icon: 'activity', fmt: 'hours', value: v === null ? null : round1(v), good: 'down', prev: mttrHours(resolvedIn(tickets, c.prev.from, c.prev.to)), spark: c.bs.map((b) => mttrHours(resolvedIn(tickets, b.from, b.to)) ?? 0), to: reportPath('engineer-productivity') });
}
function csatKpi(c: Ctx): Kpi {
  const tickets = c.ds.get('tickets');
  const cur = csat(resolvedIn(tickets, c.range.from, c.range.to));
  return kpi({ id: 'csat', label: K.csat, icon: 'star', fmt: 'rating', value: cur.avg === null ? null : round1(cur.avg), prev: csat(resolvedIn(tickets, c.prev.from, c.prev.to)).avg, spark: c.bs.map((b) => csat(resolvedIn(tickets, b.from, b.to)).avg ?? 0), sub: cur.count ? KS.ratings(cur.count) : undefined, to: reportPath('csat') });
}

const milestones = (ds: Dataset) => ds.get('paymentMilestones');
function collectedKpi(c: Ctx): Kpi {
  const ms_ = milestones(c.ds);
  const cur = within(ms_, 'receivedAt', c.range.from, c.range.to);
  return kpi({ id: 'collected', label: K.paymentsReceived, icon: 'receipt', fmt: 'money', value: sum(cur, 'receivedAmount'), prev: sum(within(ms_, 'receivedAt', c.prev.from, c.prev.to), 'receivedAmount'), spark: perBucket(c.bs, ms_, 'receivedAt', 'receivedAmount'), sub: KS.receipts(cur.length), to: listWith('paymentMilestones', dateConds('receivedAt', c.range)) });
}
function overdueKpi(c: Ctx): Kpi {
  const ms_ = milestones(c.ds);
  const col = collections(ms_, c.today);
  const amt = (day: string) => overdueAsOf(ms_, day);
  return kpi({ id: 'overdue', label: K.overdue, icon: 'alert', fmt: 'money', value: c.range.to >= c.today ? col.overdueAmount : amt(c.range.to), good: 'down', delta: pctChange(amt(c.range.to), amt(c.prev.to)), spark: atEnds(c.bs, amt), sub: KS.milestonesOverdue(col.overdueCount), to: reportPath('payment-status') });
}
function outstandingKpi(c: Ctx): Kpi {
  const ms_ = milestones(c.ds);
  const open = ms_.filter((m) => outstandingOf(m) > 0);
  const next30 = open.filter((m) => dayOf(m.dueDate) >= c.today && dayOf(m.dueDate) <= addDays(c.today, 30));
  return kpi({ id: 'outstanding', label: K.outstanding, icon: 'file-text', fmt: 'money', value: open.reduce((t, m) => t + outstandingOf(m), 0), good: 'down', delta: null, spark: c.bs.map((b) => within(ms_, 'dueDate', b.from, b.to).reduce((t, m) => t + outstandingOf(m), 0)), sub: KS.dueIn30(compactInr(next30.reduce((t, m) => t + outstandingOf(m), 0))), to: listWith('paymentMilestones', [['status', 'neq', 'received']]) });
}

function kpisFor(family: string, c: Ctx): Kpi[] {
  const list: (Kpi | null)[] = [];
  switch (family) {
    case 'company':
    case 'division':
      list.push(revenueKpi(c), pipelineKpi(c), winRateKpi(c), leadsKpi(c), openTicketsKpi(c), overdueKpi(c));
      break;
    case 'sales':
      list.push(revenueKpi(c), pipelineKpi(c), winRateKpi(c), leadsKpi(c), quoteKpi(c), targetKpi(c));
      break;
    case 'service':
      list.push(openTicketsKpi(c), resolvedKpi(c), slaKpi(c), mttrKpi(c), csatKpi(c), pmOverdueKpi(c));
      break;
    case 'engineer':
      list.push(openTicketsKpi(c, K.myOpenJobs), resolvedKpi(c), mttrKpi(c), csatKpi(c), pmOverdueKpi(c));
      break;
    case 'supply':
      list.push(...supplyKpis(c));
      break;
    case 'finance':
      list.push(collectedKpi(c), overdueKpi(c), outstandingKpi(c), revenueKpi(c));
      break;
    default:
      list.push(...profilingKpis(c));
  }
  return list.filter((k): k is Kpi => !!k);
}

function pmOverdueKpi(c: Ctx): Kpi {
  const pm = c.ds.get('pmVisits');
  const late = pm.filter((v) => v.status === 'overdue' || (v.status === 'due' && dayOf(v.dueDate) < c.today));
  const dueIn = (from: string, to: string) => within(pm, 'dueDate', from, to).length;
  return kpi({ id: 'pm', label: K.pmOverdue, icon: 'calendar-clock', fmt: 'number', value: late.length, good: 'down', delta: pctChange(dueIn(c.range.from, c.range.to), dueIn(c.prev.from, c.prev.to)), spark: c.bs.map((b) => within(pm, 'dueDate', b.from, b.to).length), sub: KS.pmScheduled(dueIn(c.range.from, c.range.to)), to: ROUTES.pmSchedule });
}

function supplyKpis(c: Ctx): Kpi[] {
  const orders = c.ds.get('salesOrders');
  const dsp = c.ds.get('dispatches');
  const cur = booked(c.ds, c.range.from, c.range.to);
  const delivered = (from: string, to: string) => dsp.filter((d) => inRange(d.actualDelivery, from, to));
  const delayed = dsp.filter((d) => (s(d.actualDelivery) ? dayOf(d.actualDelivery) : c.today) > dayOf(d.expectedDelivery) && d.status !== 'delivered');
  const below = c.ds.get('spareParts').filter((p) => p.belowMin || n(p.stockMain) < n(p.minLevel));
  const inProcessing = orders.filter((o) => ['payment_received', 'processing'].includes(s(o.status)));
  return [
    kpi({ id: 'orders-in', label: K.ordersBooked, icon: 'shopping-cart', fmt: 'number', value: cur.length, prev: booked(c.ds, c.prev.from, c.prev.to).length, spark: perBucket(c.bs, orders.filter(isBooked), 'orderDate'), sub: compactInr(sum(cur, 'grandTotal')), to: listWith('salesOrders', [...BOOKED_CONDS, ...dateConds('orderDate', c.range)]) }),
    kpi({ id: 'processing', label: K.processing, icon: 'package', fmt: 'number', value: inProcessing.length, delta: null, spark: [], sub: KS.readyForDispatch(orders.filter((o) => o.status === 'ready_for_dispatch').length), to: listWith('salesOrders', [['status', 'in', ['payment_received', 'processing']]]) }),
    kpi({ id: 'delivered', label: K.delivered, icon: 'truck', fmt: 'number', value: delivered(c.range.from, c.range.to).length, prev: delivered(c.prev.from, c.prev.to).length, spark: c.bs.map((b) => delivered(b.from, b.to).length), to: listWith('dispatches', dateConds('actualDelivery', c.range)) }),
    kpi({ id: 'delayed', label: K.delayed, icon: 'alert', fmt: 'number', value: delayed.length, good: 'down', delta: null, spark: [], to: reportPath('delayed-dispatches') }),
    kpi({ id: 'spares', label: K.sparesBelowMin, icon: 'wrench', fmt: 'number', value: below.length, good: 'down', delta: null, spark: [], to: ROUTES.minimumLevelAlerts }),
  ];
}

function profilingKpis(c: Ctx): Kpi[] {
  const reqs = c.ds.get('sampleRequests');
  const open = reqs.filter((r) => ['requested', 'in_progress'].includes(s(r.status)));
  const raised = (from: string, to: string) => within(reqs, 'createdAt', from, to);
  const done = (from: string, to: string) => within(reqs.filter((r) => r.status === 'results_shared'), 'updatedAt', from, to);
  return [
    kpi({ id: 'open-req', label: K.openRequests, icon: 'printer', fmt: 'number', value: open.length, good: 'down', delta: pctChange(raised(c.range.from, c.range.to).length, raised(c.prev.from, c.prev.to).length), spark: perBucket(c.bs, reqs, 'createdAt'), sub: KS.raisedInRange(raised(c.range.from, c.range.to).length), to: listWith('sampleRequests', [['status', 'in', ['requested', 'in_progress']]]) }),
    kpi({ id: 'completed', label: K.resultsShared, icon: 'check-square', fmt: 'number', value: done(c.range.from, c.range.to).length, prev: done(c.prev.from, c.prev.to).length, spark: c.bs.map((b) => done(b.from, b.to).length), to: listWith('sampleRequests', [['status', 'eq', 'results_shared'], ...dateConds('updatedAt', c.range)]) }),
    kpi({ id: 'mine', label: K.assignedToMe, icon: 'users', fmt: 'number', value: open.filter((r) => r.assigneeId === c.actor.staffId).length, delta: null, spark: [], to: listWith('sampleRequests', [['assigneeId', 'eq', c.actor.staffId], ['status', 'in', ['requested', 'in_progress']]]) }),
    kpi({ id: 'due-week', label: K.dueThisWeek, icon: 'calendar-clock', fmt: 'number', value: open.filter((r) => s(r.dueDate) >= c.today && s(r.dueDate) <= addDays(c.today, 7)).length, good: 'down', delta: null, spark: [], to: listWith('sampleRequests', [['status', 'in', ['requested', 'in_progress']], ['dueDate', 'gte', c.today], ['dueDate', 'lte', addDays(c.today, 7)]]) }),
  ];
}

// ---------------------------------------------------------------- trend, share, funnel, board

type Body = Pick<Dashboard, 'trend' | 'share' | 'pipe' | 'board'>;

function bodyFor(family: string, c: Ctx): Body {
  if (family === 'service' || family === 'engineer') return serviceBody(family, c);
  if (family === 'supply') return supplyBody(c);
  if (family === 'finance') return financeBody(c);
  if (family === 'profiling') return profilingBody(c);
  return salesBody(family, c);
}

function makeTrend(c: Ctx, t: Omit<Trend, 'points' | 'note'>, rows: Record<string, number[]>): Trend {
  const points: TrendPoint[] = c.bs.map((b, i) => {
    const p: TrendPoint = { label: b.label, tip: b.tip };
    Object.keys(rows).forEach((k) => (p[k] = rows[k][i]));
    return p;
  });
  return { ...t, points, note: c.range.days < 7 ? DL.range.contextNote : undefined };
}

function slicesOf(rows: Rows, field: string, master: string, res: string, dateKey: string, c: Ctx, order?: string[]): Slice[] {
  const counts = new Map<string, number>();
  rows.forEach((r) => counts.set(s(r[field]), (counts.get(s(r[field])) ?? 0) + 1));
  const keys = order ? order.filter((k) => counts.has(k)) : [...counts.keys()];
  return keys
    .map((k) => ({ key: k, label: masterLabel(master, k) || k, value: counts.get(k) ?? 0, tone: tone(master, k), to: listWith(res, [[field, 'eq', k], ...dateConds(dateKey, c.range)]) }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
}

function funnelSteps(items: { key: string; label: string; value: number; amount?: number; tone: Step['tone']; to?: string }[]): Step[] {
  return items.map((it, i) => ({ ...it, conv: i === 0 ? null : items[i - 1].value ? it.value / items[i - 1].value : null }));
}

function salesBody(family: string, c: Ctx): Body {
  const opps = c.ds.get('opportunities');
  const orders = c.ds.get('salesOrders').filter(isBooked);
  const quotes = within(c.ds.get('quotations').filter((q) => q.isLatest !== false), 'quoteDate', c.range.from, c.range.to);

  const trend = makeTrend(
    c,
    { title: W.salesTrend.title, info: W.salesTrend.info, money: true, unit: '₹', series: [{ key: 'revenue', label: W.salesTrend.orderValue, tone: 'accent' }, { key: 'pipeline', label: W.salesTrend.pipelineAdded, tone: 'info' }], to: listWith('salesOrders', dateConds('orderDate', c.range)) },
    { revenue: perBucket(c.bs, orders, 'orderDate', 'grandTotal'), pipeline: perBucket(c.bs, opps, 'createdAt', 'value') },
  );

  const share: Share = {
    title: W.quotationStatus.title,
    info: W.quotationStatus.info,
    totalLabel: W.quotationStatus.total,
    slices: slicesOf(quotes, 'status', 'quoteStatus', 'quotations', 'quoteDate', c),
  };

  // Funnel: opportunities created in the range, by the furthest stage reached (lost opportunities count at the first stage only).
  const cohort = within(opps, 'createdAt', c.range.from, c.range.to);
  const rank = (o: RecordData) => (o.stage === 'lost' ? 0 : Math.max(0, OPP_STAGES.indexOf(s(o.stage))));
  const stageTone: Step['tone'][] = ['neutral', 'info', 'accent', 'warning', 'success'];
  const pipe: Pipe = {
    title: W.oppFunnel.title,
    info: W.oppFunnel.info,
    money: false,
    unit: W.oppFunnel.unit,
    steps: funnelSteps(
      OPP_STAGES.map((st, i) => {
        const hit = cohort.filter((o) => rank(o) >= i);
        return { key: st, label: masterLabel('oppStage', st) || st, value: hit.length, amount: sum(hit, 'value'), tone: stageTone[i], to: listWith('opportunities', [['stage', 'eq', st], ...dateConds('createdAt', c.range)]) };
      }),
    ),
    to: resourcePath('tc', 'opportunities'),
  };

  const inRangeOrders = within(orders, 'orderDate', c.range.from, c.range.to);
  const wins = (id: string) => closedIn(opps, c.range.from, c.range.to).filter((o) => o.stage === 'won' && o.ownerId === id).length;
  const byOwner = group(inRangeOrders, 'ownerId');
  let board: Board;
  if (actorIsExec(c)) {
    board = customerBoard(W.topCustomers.title, W.topCustomers.info, c, inRangeOrders, 'grandTotal', B.salesOrders, B.orderValue);
  } else {
    const rows = [...byOwner.entries()]
      .map(([id, os]) => ({ id, os, rev: sum(os, 'grandTotal') }))
      .sort((a, b) => b.rev - a.rev)
      .slice(0, 6)
      .map((r) => ({ id: r.id, cells: { name: c.ds.name('employees', r.id), orders: String(r.os.length), wins: String(wins(r.id)), revenue: compactInr(r.rev) }, to: listWith('salesOrders', [['ownerId', 'eq', r.id], ...dateConds('orderDate', c.range)]) }));
    board = {
      title: family === 'sales' ? W.teamPerformance.title : W.topPerformers.title,
      info: family === 'sales' ? W.teamPerformance.info : W.topPerformers.info,
      columns: [{ key: 'name', label: B.name }, { key: 'orders', label: B.salesOrders, num: true }, { key: 'wins', label: B.won, num: true }, { key: 'revenue', label: B.orderValue, num: true }],
      rows,
      to: ROUTES.leaderboards,
      empty: B.noOrders,
    };
  }
  return { trend, share, pipe, board };
}

const actorIsExec = (c: Ctx) => c.actor.role.id === 'sales_exec';

function group(rows: Rows, key: string) {
  const m = new Map<string, Rows>();
  rows.forEach((r) => {
    const k = s(r[key]);
    if (k) m.set(k, [...(m.get(k) ?? []), r]);
  });
  return m;
}

function customerBoard(title: string, info: string, c: Ctx, rows: Rows, valueKey: string, countLabel: string, valueLabel: string): Board {
  const out = [...group(rows, 'customerId').entries()]
    .map(([id, rs]) => ({ id, rs, v: sum(rs, valueKey) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 6)
    .map((r) => ({ id: r.id, cells: { name: c.ds.name('customers', r.id), count: String(r.rs.length), value: compactInr(r.v) }, to: resourcePath('tc', 'customers', { peek: r.id }) }));
  return { title, info, columns: [{ key: 'name', label: B.customer }, { key: 'count', label: countLabel, num: true }, { key: 'value', label: valueLabel, num: true }], rows: out, to: resourcePath('tc', 'customers'), empty: B.nothing };
}

function serviceBody(family: string, c: Ctx): Body {
  const tickets = c.ds.get('tickets');
  const raised = raisedIn(tickets, c.range.from, c.range.to);
  const trend = makeTrend(
    c,
    { title: W.ticketTrend.title, info: W.ticketTrend.info, money: false, unit: W.ticketTrend.unit, series: [{ key: 'raised', label: W.ticketTrend.logged, tone: 'warning' }, { key: 'resolved', label: W.ticketTrend.resolved, tone: 'success' }], to: listWith('tickets', dateConds('reportedAt', c.range)) },
    { raised: perBucket(c.bs, tickets, 'reportedAt'), resolved: c.bs.map((b) => resolvedIn(tickets, b.from, b.to).length) },
  );
  const share: Share = { title: W.ticketStatus.title, info: W.ticketStatus.info, totalLabel: W.ticketStatus.total, slices: slicesOf(raised, 'status', 'ticketStatus', 'tickets', 'reportedAt', c) };
  const assigned = raised.filter((t) => s(t.assigneeId));
  const resolved = raised.filter(isResolvedTicket);
  const closed = raised.filter((t) => t.status === 'closed');
  const pipe: Pipe = {
    title: W.ticketFunnel.title,
    info: W.ticketFunnel.info,
    money: false,
    unit: W.ticketFunnel.unit,
    steps: funnelSteps([
      { key: 'raised', label: W.ticketFunnel.logged, value: raised.length, tone: 'info', to: listWith('tickets', dateConds('reportedAt', c.range)) },
      { key: 'assigned', label: W.ticketFunnel.assigned, value: assigned.length, tone: 'accent' },
      { key: 'resolved', label: W.ticketFunnel.resolved, value: resolved.length, tone: 'warning' },
      { key: 'closed', label: W.ticketFunnel.closed, value: closed.length, tone: 'success', to: listWith('tickets', [['status', 'eq', 'closed'], ...dateConds('reportedAt', c.range)]) },
    ]),
    to: resourcePath('tc', 'tickets'),
  };
  let board: Board;
  if (family === 'engineer') {
    board = customerBoard(W.myCustomers.title, W.myCustomers.info, c, raised, 'id', B.serviceTickets, W.myCustomers.open);
    board.rows = board.rows.map((r) => ({ ...r, cells: { ...r.cells, value: String(raised.filter((t) => t.customerId === r.id && isOpenTicket(t)).length) } }));
  } else {
    const rows = [...group(tickets.filter((t) => s(t.assigneeId)), 'assigneeId').entries()]
      .map(([id, ts]) => ({ id, open: ts.filter(isOpenTicket).length, res: resolvedIn(ts, c.range.from, c.range.to), all: ts }))
      .sort((a, b) => b.res.length - a.res.length || b.open - a.open)
      .slice(0, 6)
      .map((r) => ({ id: r.id, cells: { name: c.ds.name('employees', r.id), resolved: String(r.res.length), mttr: mttrHours(r.res) === null ? '—' : DL.card.hours(round1(mttrHours(r.res)!)), open: String(r.open) }, to: listWith('tickets', [['assigneeId', 'eq', r.id]]) }));
    board = { title: W.engineerPerformance.title, info: W.engineerPerformance.info, columns: [{ key: 'name', label: B.serviceEngineer }, { key: 'resolved', label: W.engineerPerformance.resolved, num: true }, { key: 'mttr', label: W.engineerPerformance.mttr, num: true }, { key: 'open', label: W.engineerPerformance.open, num: true }], rows, to: ROUTES.engineerCalendar, empty: W.engineerPerformance.empty };
  }
  return { trend, share, pipe, board };
}

const ORDER_RANK = ['confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch', 'dispatched', 'delivered', 'installation', 'completed'];

function supplyBody(c: Ctx): Body {
  const orders = c.ds.get('salesOrders').filter(isBooked);
  const cur = within(orders, 'orderDate', c.range.from, c.range.to);
  const dsp = c.ds.get('dispatches');
  const trend = makeTrend(
    c,
    { title: W.orderTrend.title, info: W.orderTrend.info, money: false, unit: W.orderTrend.unit, series: [{ key: 'booked', label: W.orderTrend.booked, tone: 'accent' }, { key: 'delivered', label: W.orderTrend.delivered, tone: 'success' }], to: listWith('salesOrders', dateConds('orderDate', c.range)) },
    { booked: perBucket(c.bs, orders, 'orderDate'), delivered: perBucket(c.bs, dsp, 'actualDelivery') },
  );
  const share: Share = { title: W.orderStatus.title, info: W.orderStatus.info, totalLabel: W.orderStatus.total, slices: slicesOf(cur, 'status', 'soStatus', 'salesOrders', 'orderDate', c) };
  const reached = (from: number) => cur.filter((o) => ORDER_RANK.indexOf(s(o.status)) >= from).length;
  // Step names are the Sales Order status values (soStatus master).
  const steps: [string, string, number, Step['tone']][] = [
    ['confirmed', masterLabel('soStatus', 'confirmed'), 0, 'info'],
    ['processing', masterLabel('soStatus', 'processing'), ORDER_RANK.indexOf('processing'), 'accent'],
    ['ready', masterLabel('soStatus', 'ready_for_dispatch'), ORDER_RANK.indexOf('ready_for_dispatch'), 'warning'],
    ['dispatched', masterLabel('soStatus', 'dispatched'), ORDER_RANK.indexOf('dispatched'), 'warning'],
    ['delivered', masterLabel('soStatus', 'delivered'), ORDER_RANK.indexOf('delivered'), 'success'],
  ];
  const pipe: Pipe = {
    title: W.orderFunnel.title,
    info: W.orderFunnel.info,
    money: false,
    unit: W.orderFunnel.unit,
    steps: funnelSteps(steps.map(([key, label, from, t]) => ({ key, label, value: reached(from), tone: t, to: listWith('salesOrders', dateConds('orderDate', c.range)) }))),
    to: reportPath('order-backlog'),
  };
  return { trend, share, pipe, board: customerBoard(W.topCustomersByValue.title, W.topCustomersByValue.info, c, cur, 'grandTotal', B.salesOrders, B.value) };
}

function financeBody(c: Ctx): Body {
  const ms_ = milestones(c.ds);
  const col = collections(ms_, c.today);
  const trend = makeTrend(
    c,
    { title: W.collectionsTrend.title, info: W.collectionsTrend.info, money: true, unit: '₹', series: [{ key: 'received', label: W.collectionsTrend.received, tone: 'success' }, { key: 'due', label: W.collectionsTrend.due, tone: 'warning' }], to: reportPath('payment-status') },
    { received: perBucket(c.bs, ms_, 'receivedAt', 'receivedAmount'), due: perBucket(c.bs, ms_, 'dueDate', 'amount') },
  );
  const dueNow = within(ms_, 'dueDate', c.range.from, c.range.to);
  const share: Share = { title: W.milestoneStatus.title, info: W.milestoneStatus.info, totalLabel: W.milestoneStatus.total, slices: slicesOf(dueNow, 'status', 'milestoneStatus', 'paymentMilestones', 'dueDate', c) };
  const pipe: Pipe = {
    title: W.overdueByAge.title,
    info: W.overdueByAge.info,
    money: true,
    unit: '₹',
    steps: col.ageing.map((b, i) => ({ key: b.key, label: b.label, value: b.amount, tone: i === 0 ? ('warning' as const) : ('danger' as const), to: reportPath('payment-status') })),
    to: reportPath('payment-status'),
  };
  const overdue = ms_.filter((m) => dayOf(m.dueDate) < c.today && outstandingOf(m) > 0);
  const rows = [...group(overdue, 'customerId').entries()]
    .map(([id, rs]) => ({ id, rs, v: rs.reduce((t, m) => t + outstandingOf(m), 0), oldest: Math.max(...rs.map((m) => daysBetween(dayOf(m.dueDate), c.today))) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 6)
    .map((r) => ({ id: r.id, cells: { name: c.ds.name('customers', r.id), count: String(r.rs.length), value: compactInr(r.v), age: L.reports.common.days(r.oldest) }, to: resourcePath('tc', 'customers', { peek: r.id }) }));
  return {
    trend,
    share,
    pipe,
    board: { title: W.topOverdue.title, info: W.topOverdue.info, columns: [{ key: 'name', label: B.customer }, { key: 'count', label: W.topOverdue.items, num: true }, { key: 'value', label: W.topOverdue.overdue, num: true }, { key: 'age', label: W.topOverdue.oldest, num: true }], rows, to: reportPath('payment-status'), empty: W.topOverdue.empty },
  };
}

function profilingBody(c: Ctx): Body {
  const reqs = c.ds.get('sampleRequests');
  const raised = within(reqs, 'createdAt', c.range.from, c.range.to);
  const done = reqs.filter((r) => r.status === 'results_shared');
  const trend = makeTrend(
    c,
    { title: W.sampleTrend.title, info: W.sampleTrend.info, money: false, unit: W.sampleTrend.unit, series: [{ key: 'raised', label: W.sampleTrend.raised, tone: 'info' }, { key: 'done', label: W.sampleTrend.done, tone: 'success' }], to: resourcePath('tc', 'sampleRequests') },
    { raised: perBucket(c.bs, reqs, 'createdAt'), done: perBucket(c.bs, done, 'updatedAt') },
  );
  const share: Share = { title: W.sampleStatus.title, info: W.sampleStatus.info, totalLabel: W.sampleStatus.total, slices: slicesOf(raised, 'status', 'sampleStatus', 'sampleRequests', 'createdAt', c) };
  const pipe: Pipe = {
    title: W.sampleProgress.title,
    info: W.sampleProgress.info,
    money: false,
    unit: W.sampleProgress.unit,
    steps: funnelSteps([
      { key: 'requested', label: W.sampleProgress.requested, value: raised.filter((r) => r.status !== 'cancelled').length, tone: 'info', to: resourcePath('tc', 'sampleRequests') },
      { key: 'printing', label: W.sampleProgress.printing, value: raised.filter((r) => ['in_progress', 'results_shared'].includes(s(r.status))).length, tone: 'warning' },
      { key: 'shared', label: W.sampleProgress.shared, value: raised.filter((r) => r.status === 'results_shared').length, tone: 'success' },
    ]),
    to: resourcePath('tc', 'sampleRequests'),
  };
  return { trend, share, pipe, board: customerBoard(W.sampleCustomers.title, W.sampleCustomers.info, c, raised, 'id', W.sampleCustomers.count, W.sampleCustomers.open) };
}

// ---------------------------------------------------------------- feed and alerts

function feedFor(c: Ctx): FeedItem[] {
  return c.ds
    .get('activities')
    .filter((a) => inRange(a.at, c.range.from, c.range.to))
    .sort((a, b) => ms(b.at) - ms(a.at))
    .slice(0, 8)
    .map((a) => ({
      id: a.id,
      title: s(a.subject) || DL.feed.activity,
      sub: `${c.ds.name('employees', a.byId)}${s(a.parentLabel) ? ` · ${s(a.parentLabel)}` : ''}`,
      at: s(a.at),
      kind: masterLabel('activityType', a.activityType) || DL.feed.activity,
      to: resourcePath('tc', 'activities', { peek: a.id }),
    }));
}

function alertsFor(family: string, c: Ctx): AlertItem[] {
  const { ds, actor, today } = c;
  const me = actor.staffId;
  const out: AlertItem[] = [];
  const add = (id: string, label: string, sub: string, count: number, t: AlertItem['tone'], to: string) => count > 0 && out.push({ id, label, sub, count, tone: t, to });

  const approvals = listApprovals(actor).filter((a) => canDecide(actor, a));
  add('approvals', AL.approvals.label, AL.approvals.sub, approvals.length, 'warning', toPath(ROUTES.notifications, {}, { tab: 'approvals' }));
  add('tasks', AL.tasks.label, AL.tasks.sub, ds.get('tasks').filter((t) => t.assigneeId === me && ['todo', 'in_progress'].includes(s(t.status)) && s(t.dueDate) < today).length, 'danger', listWith('tasks', [['assigneeId', 'eq', me], ['status', 'in', ['todo', 'in_progress']], ['dueDate', 'lte', addDays(today, -1)]]));

  const openLeadOpp = [...ds.get('leads').filter((l) => OPEN_LEAD.includes(s(l.status))), ...ds.get('opportunities').filter(isOpenOpp)];
  const quotes = ds.get('quotations').filter((q) => q.isLatest !== false);
  const open = ds.get('tickets').filter(isOpenTicket);
  const breached = open.filter((t) => t.slaBreached || (s(t.resolutionDueAt) && ms(t.resolutionDueAt) < nowMs()));
  const salesLike = ['company', 'division', 'sales'].includes(family);
  if (salesLike) {
    add('followups', AL.followUps.label, AL.followUps.sub, openLeadOpp.filter((r) => s(r.nextFollowUpAt) && dayOf(r.nextFollowUpAt) < today).length, 'danger', ROUTES.followUps);
    add('quotes-pending', AL.quotesPending.label, AL.quotesPending.sub, quotes.filter((q) => q.status === 'pending_approval').length, 'warning', ROUTES.quotationPendingApprovals);
    add('quotes-expiring', AL.quotesExpiring.label, AL.quotesExpiring.sub, quotes.filter((q) => ['sent', 'negotiation', 'approved'].includes(s(q.status)) && dayOf(q.validUntil) >= today && dayOf(q.validUntil) <= addDays(today, 7)).length, 'warning', listWith('quotations', [['validUntil', 'next7']]));
    add('leads-unattended', AL.notAttended.label, AL.notAttended.sub, ds.get('leads').filter((l) => OPEN_LEAD.includes(s(l.status)) && l.notAttended).length, 'danger', ROUTES.notAttendedLeads);
  }
  if (['company', 'division', 'finance'].includes(family)) {
    const col = collections(ds.get('paymentMilestones'), today);
    add('overdue-pay', AL.overduePayments.label, compactInr(col.overdueAmount), col.overdueCount, 'danger', reportPath('payment-status'));
  }
  if (['company', 'division', 'service'].includes(family)) {
    add('amc', AL.amc.label, AL.amc.sub, ds.get('amcContracts').filter((a) => a.status === 'due_for_renewal').length, 'warning', ROUTES.renewalPipeline);
  }
  if (['company', 'division', 'service', 'engineer'].includes(family)) {
    add('sla', AL.sla.label, AL.sla.sub, breached.length, 'danger', listWith('tickets', [['status', 'in', OPEN_TICKET]]));
  }
  if (family === 'service') add('unassigned', AL.unassigned.label, AL.unassigned.sub, open.filter((t) => !t.assigneeId).length, 'danger', ROUTES.engineerCalendar);
  if (family === 'engineer') add('accept', AL.accept.label, AL.accept.sub, open.filter((t) => t.status === 'assigned').length, 'warning', ROUTES.myJobs);
  if (family === 'service' || family === 'engineer') add('pm', AL.pm.label, AL.pm.sub, ds.get('pmVisits').filter((v) => v.status === 'overdue' || (v.status === 'due' && dayOf(v.dueDate) < today)).length, 'danger', ROUTES.pmSchedule);
  if (family === 'supply') {
    const dsp = ds.get('dispatches');
    add('delayed', AL.delayed.label, AL.delayed.sub, dsp.filter((d) => (s(d.actualDelivery) ? dayOf(d.actualDelivery) : today) > dayOf(d.expectedDelivery) && d.status !== 'delivered').length, 'danger', reportPath('delayed-dispatches'));
    add('below-min', AL.belowMin.label, AL.belowMin.sub, ds.get('spareParts').filter((p) => p.belowMin || n(p.stockMain) < n(p.minLevel)).length, 'warning', ROUTES.minimumLevelAlerts);
    add('reqs', AL.requisitions.label, AL.requisitions.sub, ds.get('requisitions').filter((r) => r.status === 'approved').length, 'warning', listWith('requisitions', [['status', 'eq', 'approved']]));
  }
  if (family === 'profiling') add('samples-late', AL.samplesLate.label, AL.samplesLate.sub, ds.get('sampleRequests').filter((r) => ['requested', 'in_progress'].includes(s(r.status)) && s(r.dueDate) && s(r.dueDate) < today).length, 'danger', resourcePath('tc', 'sampleRequests'));

  const rank = { danger: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}
