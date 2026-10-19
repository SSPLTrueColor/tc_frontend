/**
 * Role overview (FR-149, NFR-22). Sections adapt to the signed-in role; every figure is computed
 * from records read through the scoped dataset and every tile links to the list it summarises.
 */
import { addDays, formatDate, todayKey } from '../../lib/dates';
import { nowMs } from '../../lib/clock';
import { resourcePath } from '../../lib/routes';
import { type Actor, can, canReadResource } from '../authz';
import { listNotifications } from '../collab';
import { encodeFilter, newCondition, newGroup } from '../filter';
import { canDecide, listApprovals } from '../workflow';
import { achievement } from '../field/field';
import { periodStartFor } from '../field/rules';
import { masterLabel } from '../registry';
import { loadDataset } from './dataset';
import { BACKLOG, ageingBuckets, attachRate, collections, csat, dayOf, inRange, isBooked, isOpenOpp, isOpenTicket, lastMonths, monthLabel, ms, mttrHours, outstandingOf, pipeline, quoteToOrder, slaCompliance, sum, winRate } from './kpis';
import { compactInr } from './format';
import type { Dataset } from './types';

/** Status meaning used for tile values and chart bars: green good, amber needs attention, red act now. */
export type Signal = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface Tile {
  label: string;
  /** Pre-formatted, or a typed KPI string ("money:…", "pct:…", "hours:…"). */
  value: string;
  sub?: string;
  to?: string;
  /** Colour of the value; omit for plain figures. */
  tone?: Signal;
}

export interface ChartBar {
  key: string;
  label: string;
  value: number;
  tone?: Signal;
}
export interface PlanItem {
  id: string;
  title: string;
  sub: string;
  tag: string;
  tone: 'danger' | 'warning' | 'neutral' | 'info';
  to: string;
  /** Task id when the item can be completed from the overview. */
  taskId?: string;
  taskVersion?: number;
}
export interface Section {
  id: string;
  title: string;
  info: string;
  tiles: Tile[];
  chart?: { label: string; unit: string; money?: boolean; data: ChartBar[]; to?: string; legend?: { tone: Signal; label: string }[] };
  list?: { title: string; items: PlanItem[]; empty: string; to?: string };
}
export interface Overview {
  family: string;
  headline: string;
  plan: PlanItem[];
  today: Tile[];
  sections: Section[];
}

type Cond = [field: string, op: Parameters<typeof newCondition>[1], value?: unknown];
const listWith = (res: string, conds: Cond[] = [], view?: string) => {
  const g = newGroup('and');
  g.children = conds.map(([f, o, v]) => newCondition(f, o, v));
  return resourcePath('tc', res, { view, f: conds.length ? encodeFilter(g) : undefined });
};
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const pctStr = (v: number | null) => (v === null ? '' : `pct:${v}`);
/** Count that is bad when above zero (overdue, breached …). */
const badIfAny = (n: number, level: Signal = 'danger'): Signal => (n > 0 ? level : 'success');
/** Higher is better: ≥ good → green, ≥ ok → amber, else red; no data → plain. */
const higherBetter = (v: number | null, good: number, ok: number): Signal | undefined => (v === null ? undefined : v >= good ? 'success' : v >= ok ? 'warning' : 'danger');
/** Same for KPI ratios (0–1), with thresholds given in percent. */
const ratioTone = (v: number | null, goodPct: number, okPct: number) => higherBetter(v === null ? null : v * 100, goodPct, okPct);

const FAMILY: Record<string, string> = {
  admin: 'company',
  management: 'company',
  division_head: 'division',
  sales_manager: 'sales',
  sales_exec: 'sales',
  service_head: 'service',
  coordinator: 'service',
  engineer: 'engineer',
  scm: 'supply',
  store: 'supply',
  accounts: 'finance',
  profiling: 'profiling',
};

const OPEN_LEAD = ['new', 'contacted', 'nurture'];

export function overviewFor(actor: Actor): Overview {
  const ds = loadDataset(actor);
  const today = todayKey();
  const family = FAMILY[actor.role.id] ?? 'sales';
  const monthStart = `${today.slice(0, 7)}-01`;
  const approvals = listApprovals(actor).filter((a) => canDecide(actor, a));
  const unread = listNotifications(actor).filter((n) => !n.readAt).length;

  const todayTiles: Tile[] = [
    { label: 'Waiting for my approval', value: String(approvals.length), sub: approvals.length ? 'Decide in the inbox' : 'Nothing waiting', to: '/inbox?tab=approvals', tone: badIfAny(approvals.length, 'warning') },
    { label: 'Unread notifications', value: String(unread), to: '/inbox', tone: unread ? 'info' : undefined },
  ];

  const sections: Section[] = [];
  if (family === 'company' || family === 'division') sections.push(salesSection(ds, actor, today, monthStart), collectionsSection(ds, today, monthStart), serviceSection(ds, today), installedSection(ds, today));
  if (family === 'sales') sections.push(mySalesSection(ds, actor, today, monthStart), quotesOrdersSection(ds, actor, today, monthStart));
  if (family === 'service') sections.push(serviceSection(ds, today), serviceDeskSection(ds, today));
  if (family === 'engineer') sections.push(engineerSection(ds, actor, today));
  if (family === 'supply') sections.push(supplySection(ds, today));
  if (family === 'finance') sections.push(collectionsSection(ds, today, monthStart), financeSection(ds, actor, today));
  if (family === 'profiling') sections.push(profilingSection(ds, actor, today));

  return {
    family,
    headline:
      family === 'company'
        ? 'Company-wide sales, collections and service'
        : family === 'division'
          ? `Your division${actor.divisionIds.length > 1 ? 's' : ''}: ${actor.divisionIds.map((d) => masterLabel('division', d)).join(', ')}`
          : family === 'sales'
            ? actor.role.id === 'sales_manager'
              ? 'You and your team'
              : 'Your leads, deals and orders'
            : family === 'service'
              ? 'Service desk'
              : family === 'engineer'
                ? 'Your jobs'
                : family === 'supply'
                  ? 'Orders, dispatch and stock'
                  : family === 'finance'
                    ? 'Collections and finance checks'
                    : 'Sample requests',
    plan: planFor(ds, actor, today),
    today: todayTiles,
    sections: sections.filter((x) => x.tiles.length || x.chart || x.list),
  };
}

// ---------------------------------------------------------------- today's plan (NFR-22)

function planFor(ds: Dataset, actor: Actor, today: string): PlanItem[] {
  const me = actor.staffId;
  const items: (PlanItem & { sort: string })[] = [];
  const tag = (due: string) => (due < today ? { tag: 'Overdue', tone: 'danger' as const } : due === today ? { tag: 'Today', tone: 'warning' as const } : { tag: formatDate(due), tone: 'neutral' as const });
  ds.get('tasks')
    .filter((t) => t.assigneeId === me && ['todo', 'in_progress'].includes(s(t.status)) && s(t.dueDate) <= addDays(today, 3))
    .forEach((t) => items.push({ id: `t:${t.id}`, title: s(t.title), sub: s(t.relatedLabel) || 'Task', ...tag(s(t.dueDate)), to: resourcePath('tc', 'tasks', { peek: t.id }), taskId: t.id, taskVersion: t.version, sort: s(t.dueDate) }));
  ds.get('leads')
    .filter((l) => l.ownerId === me && OPEN_LEAD.includes(s(l.status)) && s(l.nextFollowUpAt) && dayOf(l.nextFollowUpAt) <= today)
    .forEach((l) => items.push({ id: `l:${l.id}`, title: `Follow up ${ds.name('leads', l.id)}`, sub: 'Lead follow-up', ...tag(dayOf(l.nextFollowUpAt)), to: resourcePath('tc', 'leads', { peek: l.id }), sort: dayOf(l.nextFollowUpAt) }));
  ds.get('opportunities')
    .filter((o) => o.ownerId === me && isOpenOpp(o) && s(o.nextFollowUpAt) && dayOf(o.nextFollowUpAt) <= today)
    .forEach((o) => items.push({ id: `o:${o.id}`, title: `Follow up ${s(o.name)}`, sub: 'Opportunity follow-up', ...tag(dayOf(o.nextFollowUpAt)), to: resourcePath('tc', 'opportunities', { peek: o.id }), sort: dayOf(o.nextFollowUpAt) }));
  ds.get('tickets')
    .filter((t) => t.assigneeId === me && isOpenTicket(t))
    .forEach((t) => items.push({ id: `k:${t.id}`, title: `${t.id} · ${ds.name('customers', t.customerId)}`, sub: `${masterLabel('ticketPriority', t.priority)} · ${masterLabel('ticketStatus', t.status)}`, ...(s(t.resolutionDueAt) && ms(t.resolutionDueAt) < nowMs() ? { tag: 'SLA breached', tone: 'danger' as const } : { tag: 'Job', tone: 'info' as const }), to: `/my-jobs/${t.id}`, sort: s(t.resolutionDueAt) || today }));
  ds.get('pmVisits')
    .filter((v) => v.engineerId === me && ['due', 'overdue'].includes(s(v.status)) && dayOf(v.dueDate) <= addDays(today, 3))
    .forEach((v) => items.push({ id: `p:${v.id}`, title: `PM visit · ${ds.name('customers', v.customerId)}`, sub: 'Preventive maintenance', ...tag(dayOf(v.dueDate)), to: '/pm-schedule', sort: dayOf(v.dueDate) }));
  ds.get('fieldVisits')
    .filter((v) => v.employeeId === me && v.status === 'planned' && dayOf(v.plannedFor) === today)
    .forEach((v) => items.push({ id: `v:${v.id}`, title: `Visit ${s(v.siteLabel) || ds.name('customers', v.customerId)}`, sub: masterLabel('visitPurpose', v.purpose), tag: 'Today', tone: 'warning', to: '/visits', sort: today }));
  return items.sort((a, b) => a.sort.localeCompare(b.sort)).slice(0, 10);
}

// ---------------------------------------------------------------- sections

function salesSection(ds: Dataset, _actor: Actor, today: string, monthStart: string): Section {
  const opps = ds.get('opportunities');
  const p = pipeline(opps);
  const since = addDays(today, -90);
  const closed = opps.filter((o) => ['won', 'lost'].includes(s(o.stage)) && dayOf(o.wonAt || o.stageChangedAt || o.updatedAt) >= since);
  const orders = ds.get('salesOrders').filter(isBooked);
  const month = orders.filter((o) => dayOf(o.orderDate) >= monthStart);
  const months = lastMonths(today, 6);
  return {
    id: 'sales',
    title: 'Sales',
    info: 'Open pipeline and forecast, 90-day win rate and quote-to-order, and orders booked (confirmed or later).',
    tiles: [
      { label: 'Open pipeline', value: compactInr(p.value), sub: `${p.count} opportunities`, to: listWith('opportunities', [['stage', 'in', ['needs_assessment', 'demo', 'proposal', 'negotiation']]]) },
      { label: 'Weighted forecast', value: compactInr(p.weighted), sub: 'Value × stage probability', to: '/opportunities/forecast' },
      { label: 'Win rate (90 days)', tone: ratioTone(winRate(closed), 40, 25), value: pctStr(winRate(closed)), sub: `${closed.filter((o) => o.stage === 'won').length} won · ${closed.filter((o) => o.stage === 'lost').length} lost`, to: '/reports/exec-performance' },
      { label: 'Quote-to-order (90 days)', ...((v) => ({ value: pctStr(v), tone: ratioTone(v, 30, 15) }))(quoteToOrder(ds.get('quotations').filter((q) => dayOf(q.quoteDate) >= since), ds.get('salesOrders'))), to: '/reports/quote-to-order' },
      { label: 'Booked this month', value: compactInr(sum(month, 'grandTotal')), sub: `${month.length} orders`, to: listWith('salesOrders', [['orderDate', 'gte', monthStart]]) },
    ],
    chart: monthlyVsAverage(
      'Orders booked, last 6 months',
      months.map((m) => ({ key: m, label: monthLabel(m), value: sum(orders.filter((o) => dayOf(o.orderDate).startsWith(m)), 'grandTotal') })),
      today,
      '/reports/order-value',
    ),
  };
}

function collectionsSection(ds: Dataset, today: string, monthStart: string): Section {
  const ms_ = ds.get('paymentMilestones');
  const c = collections(ms_, today);
  const next30 = ms_.filter((m) => dayOf(m.dueDate) >= today && dayOf(m.dueDate) <= addDays(today, 30) && outstandingOf(m) > 0);
  const receivedMonth = ms_.filter((m) => s(m.receivedAt) && dayOf(m.receivedAt) >= monthStart);
  return {
    id: 'collections',
    title: 'Collections',
    info: 'Payment milestones from sales orders. Receipts come from the ERP (simulated).',
    tiles: [
      { label: 'Overdue', value: compactInr(c.overdueAmount), sub: `${c.overdueCount} milestone(s)`, to: '/reports/payment-status', tone: badIfAny(c.overdueAmount) },
      { label: 'Due in next 30 days', value: compactInr(next30.reduce((t, m) => t + outstandingOf(m), 0)), sub: `${next30.length} milestone(s)`, to: '/orders/payments' },
      { label: 'Received this month', tone: 'success', value: compactInr(sum(receivedMonth, 'receivedAmount')), to: listWith('paymentMilestones', [['receivedAt', 'gte', monthStart]]) },
    ],
    chart: {
      label: 'Overdue amount by age',
      unit: '₹',
      money: true,
      to: '/reports/payment-status',
      data: c.ageing.map((b, i) => ({ key: b.key, label: b.label, value: b.amount, tone: i === 0 ? ('warning' as const) : ('danger' as const) })),
      legend: [
        { tone: 'warning', label: 'Up to 30 days late' },
        { tone: 'danger', label: 'More than 30 days late' },
      ],
    },
  };
}

function serviceSection(ds: Dataset, today: string): Section {
  const tickets = ds.get('tickets');
  const open = tickets.filter(isOpenTicket);
  const recent = tickets.filter((t) => dayOf(t.reportedAt) >= addDays(today, -30));
  const c = csat(tickets.filter((t) => dayOf(t.reportedAt) >= addDays(today, -90)));
  const breached = open.filter((t) => t.slaBreached || (s(t.resolutionDueAt) && ms(t.resolutionDueAt) < nowMs()));
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(today, -7 * (7 - i) - 6));
  return {
    id: 'service',
    title: 'Service',
    info: 'Open tickets now, SLA compliance and MTTR over 30 days, CSAT over 90 days.',
    tiles: [
      { label: 'Open tickets', value: String(open.length), sub: `${breached.length} past SLA`, tone: breached.length ? 'danger' : 'success', to: listWith('tickets', [['status', 'in', ['open', 'assigned', 'accepted', 'in_progress', 'waiting_parts', 'waiting_customer', 'reopened']]]) },
      { label: 'SLA compliance (30 days)', value: pctStr(slaCompliance(recent)), tone: ratioTone(slaCompliance(recent), 90, 75), to: '/reports/sla-compliance' },
      { label: 'MTTR (30 days)', value: mttrHours(recent) === null ? '' : `hours:${mttrHours(recent)}`, to: '/reports/engineer-productivity' },
      { label: 'CSAT (90 days)', tone: higherBetter(c.avg, 4, 3), value: c.avg === null ? '' : `${c.avg.toFixed(1)} / 5`, sub: c.count ? `${c.count} ratings` : undefined, to: '/reports/csat' },
      ...((n) => [{ label: 'PM overdue', value: String(n), tone: badIfAny(n), to: '/pm-schedule' }])(ds.get('pmVisits').filter((v) => v.status === 'overdue' || (v.status === 'due' && dayOf(v.dueDate) < today)).length),
    ],
    chart: loadChart(
      'Tickets reported per week',
      weeks.map((w) => ({ key: w, label: `Wk of ${formatDate(w).slice(0, 5)}`, value: tickets.filter((t) => inRange(t.reportedAt, w, addDays(w, 6))).length })),
      '/reports/open-tickets',
    ),
  };
}

function installedSection(ds: Dataset, today: string): Section {
  const amc = ds.get('amcContracts');
  const due = amc.filter((c) => c.status === 'due_for_renewal');
  const machines = ds.get('machines').filter((m) => m.status !== 'scrapped');
  const attach = attachRate(machines, ds.get('salesOrders'), addDays(today, -365));
  const wEnd = ds.get('warranties').filter((w) => dayOf(w.endDate) >= today && dayOf(w.endDate) <= addDays(today, 90));
  return {
    id: 'installed',
    title: 'Installed base & renewals',
    info: 'AMC/CMC renewals, warranties ending in 90 days and consumables attach rate (last 12 months).',
    tiles: [
      { label: 'Machines in the field', value: String(machines.length), to: '/reports/installed-base' },
      { label: 'AMC due for renewal', value: String(due.length), sub: compactInr(sum(due, 'value')), to: '/renewals', tone: badIfAny(due.length, 'warning') },
      { label: 'Warranties ending ≤ 90 days', value: String(wEnd.length), to: '/reports/warranty-expiry', tone: wEnd.length ? 'info' : undefined },
      { label: 'Consumables attach rate', tone: ratioTone(attach.rate, 60, 40), value: pctStr(attach.rate), sub: `${attach.machineCustomers} machine customers`, to: '/consumables/leakage' },
    ],
  };
}

function mySalesSection(ds: Dataset, actor: Actor, today: string, _monthStart: string): Section {
  const leads = ds.get('leads');
  const open = leads.filter((l) => OPEN_LEAD.includes(s(l.status)));
  const opps = ds.get('opportunities');
  const p = pipeline(opps);
  const overdue = [...open, ...opps.filter(isOpenOpp)].filter((r) => s(r.nextFollowUpAt) && dayOf(r.nextFollowUpAt) < today);
  const stages = ['needs_assessment', 'demo', 'proposal', 'negotiation'];
  return {
    id: 'pipeline',
    title: actor.role.id === 'sales_manager' ? 'Team pipeline' : 'My pipeline',
    info: 'Open leads and opportunities in your scope, follow-ups past due and the first-contact SLA.',
    tiles: [
      { label: 'Open leads', value: String(open.length), to: listWith('leads', [['status', 'in', OPEN_LEAD]]) },
      { label: 'Not attended (SLA)', tone: badIfAny(open.filter((l) => l.notAttended).length), value: String(open.filter((l) => l.notAttended).length), to: resourcePath('tc', 'leads', { view: 'v_leads_not_attended' }) },
      { label: 'Follow-ups overdue', value: String(overdue.length), to: '/follow-ups', tone: badIfAny(overdue.length) },
      { label: 'Open pipeline', value: compactInr(p.value), sub: `${p.count} opportunities`, to: listWith('opportunities', [['stage', 'in', stages]]) },
      { label: 'Weighted forecast', value: compactInr(p.weighted), to: '/opportunities/forecast' },
    ],
    chart: {
      label: 'Pipeline value by stage',
      unit: '₹',
      money: true,
      to: resourcePath('tc', 'opportunities'),
      data: stages.map((st) => ({ key: st, label: masterLabel('oppStage', st), value: sum(opps.filter((o) => o.stage === st), 'value'), tone: st === 'negotiation' ? ('success' as const) : st === 'proposal' ? ('info' as const) : ('neutral' as const) })),
      legend: [
        { tone: 'neutral', label: 'Early stage' },
        { tone: 'info', label: 'Proposal sent' },
        { tone: 'success', label: 'Close to winning' },
      ],
    },
  };
}

function quotesOrdersSection(ds: Dataset, actor: Actor, today: string, monthStart: string): Section {
  const quotes = ds.get('quotations').filter((q) => q.isLatest !== false);
  const orders = ds.get('salesOrders').filter(isBooked);
  const month = orders.filter((o) => dayOf(o.orderDate) >= monthStart);
  const tiles: Tile[] = [
    { label: 'Quotations pending approval', tone: badIfAny(quotes.filter((q) => q.status === 'pending_approval').length, 'warning'), value: String(quotes.filter((q) => q.status === 'pending_approval').length), to: listWith('quotations', [['status', 'eq', 'pending_approval']]) },
    { label: 'Sent, awaiting customer', value: String(quotes.filter((q) => q.status === 'sent' || q.status === 'negotiation').length), to: listWith('quotations', [['status', 'in', ['sent', 'negotiation']]]) },
    ...((n) => [{ label: 'Expiring in 7 days', tone: badIfAny(n, 'warning'), value: String(n), to: listWith('quotations', [['validUntil', 'next7']]) }])(
      quotes.filter((q) => ['sent', 'negotiation', 'approved'].includes(s(q.status)) && dayOf(q.validUntil) >= today && dayOf(q.validUntil) <= addDays(today, 7)).length,
    ),
    { label: 'Booked this month', value: compactInr(sum(month, 'grandTotal')), sub: `${month.length} orders`, to: listWith('salesOrders', [['orderDate', 'gte', monthStart]]) },
  ];
  if (canReadResource(actor, 'targets')) {
    try {
      const rows = achievement(actor, 'month', periodStartFor('month', today));
      const mine = rows.find((r) => r.target.employeeId === actor.staffId && r.target.scopeType === (actor.role.id === 'sales_manager' ? 'team' : 'user')) ?? rows.find((r) => r.target.employeeId === actor.staffId) ?? rows[0];
      if (mine) tiles.push({ label: 'Target achieved (month)', tone: higherBetter(mine.pct, 100, 70), value: `${mine.pct}%`, sub: `${String(masterLabel('targetMetric', mine.target.metric) || mine.target.metric)}`, to: '/targets/achievement' });
    } catch {
      /* targets unavailable for this role */
    }
  }
  return { id: 'quotes-orders', title: 'Quotations & orders', info: 'Latest quotation revisions and orders booked this month (confirmed or later).', tiles };
}

function serviceDeskSection(ds: Dataset, today: string): Section {
  const open = ds.get('tickets').filter(isOpenTicket);
  const unassigned = open.filter((t) => !t.assigneeId);
  const byEng = new Map<string, number>();
  open.filter((t) => t.assigneeId).forEach((t) => byEng.set(s(t.assigneeId), (byEng.get(s(t.assigneeId)) ?? 0) + 1));
  const urgent = open
    .filter((t) => t.priority === 'critical' || t.priority === 'high')
    .sort((a, b) => ms(a.reportedAt) - ms(b.reportedAt))
    .slice(0, 6)
    .map((t) => ({ id: t.id, title: `${t.id} · ${ds.name('customers', t.customerId)}`, sub: `${masterLabel('ticketStatus', t.status)} · ${t.assigneeId ? ds.name('employees', t.assigneeId) : 'Unassigned'}`, tag: masterLabel('ticketPriority', t.priority), tone: (t.priority === 'critical' ? 'danger' : 'warning') as PlanItem['tone'], to: resourcePath('tc', 'tickets', { peek: t.id }) }));
  return {
    id: 'desk',
    title: 'Dispatch & workload',
    info: 'Unassigned tickets, preventive visits due this week and open tickets per engineer.',
    tiles: [
      { label: 'Unassigned', value: String(unassigned.length), to: '/dispatch-board', tone: badIfAny(unassigned.length) },
      { label: 'PM due in 7 days', value: String(ds.get('pmVisits').filter((v) => v.status === 'due' && dayOf(v.dueDate) >= today && dayOf(v.dueDate) <= addDays(today, 7)).length), to: '/pm-schedule' },
      { label: 'Ageing > 7 days', value: String(ageingBuckets(open, 'reportedAt', nowMs()).filter((b) => b.min > 7).reduce((t, b) => t + b.count, 0)), to: '/reports/open-tickets' },
    ],
    chart: {
      label: 'Open tickets per engineer',
      unit: 'tickets',
      to: '/dispatch-board',
      data: [...byEng.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([id, v]) => ({ key: id, label: ds.name('employees', id), value: v, tone: v >= 7 ? ('danger' as const) : v >= 4 ? ('warning' as const) : ('success' as const) })),
      legend: [
        { tone: 'success', label: 'Up to 3 — normal' },
        { tone: 'warning', label: '4–6 — busy' },
        { tone: 'danger', label: '7 or more — overloaded' },
      ],
    },
    list: { title: 'Oldest critical & high tickets', items: urgent, empty: 'No critical or high-priority tickets open.', to: listWith('tickets', [['priority', 'in', ['critical', 'high']]]) },
  };
}

function engineerSection(ds: Dataset, actor: Actor, today: string): Section {
  const mine = ds.get('tickets').filter((t) => t.assigneeId === actor.staffId);
  const open = mine.filter(isOpenTicket);
  const resolved30 = mine.filter((t) => s(t.resolvedAt) && dayOf(t.resolvedAt) >= addDays(today, -30));
  return {
    id: 'jobs',
    title: 'My jobs',
    info: 'Tickets assigned to you and preventive visits due. Open a job to accept, travel, check in and sign off.',
    tiles: [
      { label: 'Open jobs', value: String(open.length), sub: `${open.filter((t) => t.status === 'assigned').length} to accept`, to: '/my-jobs', tone: badIfAny(open.filter((t) => t.status === 'assigned').length, 'warning') },
      { label: 'PM due in 7 days', value: String(ds.get('pmVisits').filter((v) => v.engineerId === actor.staffId && ['due', 'overdue'].includes(s(v.status)) && dayOf(v.dueDate) <= addDays(today, 7)).length), to: '/pm-schedule' },
      { label: 'Resolved (30 days)', value: String(resolved30.length), sub: mttrHours(resolved30) === null ? undefined : `MTTR ${Math.round(mttrHours(resolved30)! * 10) / 10} h` },
      { label: 'My CSAT', tone: higherBetter(csat(mine).avg, 4, 3), value: csat(mine).avg === null ? '' : `${csat(mine).avg!.toFixed(1)} / 5` },
    ],
  };
}

function supplySection(ds: Dataset, today: string): Section {
  const orders = ds.get('salesOrders');
  const dsp = ds.get('dispatches');
  const delayed = dsp.filter((d) => (s(d.actualDelivery) ? dayOf(d.actualDelivery) : today) > dayOf(d.expectedDelivery) && d.status !== 'delivered');
  const below = ds.get('spareParts').filter((p) => p.belowMin || Number(p.stockMain) < Number(p.minLevel));
  const reqs = ds.get('requisitions');
  return {
    id: 'supply',
    title: 'Orders, dispatch & stock',
    info: 'Order processing (SCM), dispatch delays, spares below minimum and requisitions waiting for the store.',
    tiles: [
      { label: 'In processing', value: String(orders.filter((o) => ['payment_received', 'processing'].includes(s(o.status))).length), to: listWith('salesOrders', [['status', 'in', ['payment_received', 'processing']]]) },
      { label: 'Ready for dispatch', value: String(orders.filter((o) => o.status === 'ready_for_dispatch').length), to: listWith('salesOrders', [['status', 'eq', 'ready_for_dispatch']]) },
      { label: 'Delayed in transit', value: String(delayed.length), to: '/reports/delayed-dispatches', tone: badIfAny(delayed.length) },
      { label: 'Spares below minimum', value: String(below.length), to: resourcePath('tc', 'spareParts', { view: 'v_sp_below' }), tone: badIfAny(below.length, 'warning') },
      { label: 'Requisitions to issue', tone: badIfAny(reqs.filter((r) => r.status === 'approved').length, 'warning'), value: String(reqs.filter((r) => r.status === 'approved').length), to: listWith('requisitions', [['status', 'eq', 'approved']]) },
    ],
    chart: {
      label: 'Orders by step',
      unit: 'orders',
      to: '/reports/order-backlog',
      data: BACKLOG.map((st) => ({
        key: st,
        label: masterLabel('soStatus', st),
        value: orders.filter((o) => o.status === st).length,
        tone: ['pending_approval', 'payment_pending', 'on_hold'].includes(st) ? ('warning' as const) : st === 'ready_for_dispatch' || st === 'dispatched' ? ('success' as const) : ('info' as const),
      })).filter((d) => d.value > 0),
      legend: [
        { tone: 'warning', label: 'Waiting (approval, payment, hold)' },
        { tone: 'info', label: 'In progress' },
        { tone: 'success', label: 'Ready or on the way' },
      ],
    },
  };
}

function financeSection(ds: Dataset, actor: Actor, today: string): Section {
  const approvals = listApprovals(actor).filter((a) => canDecide(actor, a));
  const big = ds
    .get('paymentMilestones')
    .filter((m) => dayOf(m.dueDate) < today && outstandingOf(m) > 0)
    .sort((a, b) => outstandingOf(b) - outstandingOf(a))
    .slice(0, 6)
    .map((m) => ({ id: m.id, title: `${ds.name('customers', m.customerId)} · ${compactInr(outstandingOf(m))}`, sub: `${s(m.label)} · ${ds.name('salesOrders', m.salesOrderId)}`, tag: `${Math.round((ms(today) - ms(dayOf(m.dueDate))) / 86_400_000)} days`, tone: 'danger' as const, to: resourcePath('tc', 'paymentMilestones', { peek: m.id }) }));
  return {
    id: 'finance',
    title: 'Finance checks',
    info: 'Approvals that need Accounts (sales-order finance checks, expense claims) and the largest overdue amounts.',
    tiles: [
      ...((n) => [{ label: 'Finance approvals waiting', value: String(n), to: '/inbox?tab=approvals', tone: badIfAny(n, 'warning') }])(approvals.filter((a) => a.levels[a.currentLevel]?.capability === 'approve.finance').length),
      { label: 'Expense claims to approve', value: String(approvals.filter((a) => a.type === 'expense.claim').length), to: '/inbox?tab=approvals' },
      ...((n) => [{ label: 'Customers overdue', tone: badIfAny(n), value: String(n), to: '/reports/payment-status' }])(new Set(ds.get('paymentMilestones').filter((m) => dayOf(m.dueDate) < today && outstandingOf(m) > 0).map((m) => s(m.customerId))).size),
    ],
    list: { title: 'Largest overdue milestones', items: big, empty: 'Nothing overdue.', to: '/reports/payment-status' },
  };
}

function profilingSection(ds: Dataset, actor: Actor, today: string): Section {
  const reqs = ds.get('sampleRequests').filter((r) => ['requested', 'in_progress'].includes(s(r.status)));
  const items = reqs
    .sort((a, b) => s(a.dueDate).localeCompare(s(b.dueDate)))
    .slice(0, 8)
    .map((r) => ({ id: r.id, title: s(r.title) || r.id, sub: `${ds.name('customers', r.customerId)} · ${masterLabel('sampleStatus', r.status)}`, tag: s(r.dueDate) < today ? 'Overdue' : s(r.dueDate) ? formatDate(s(r.dueDate)) : 'No date', tone: (s(r.dueDate) && s(r.dueDate) < today ? 'danger' : 'neutral') as PlanItem['tone'], to: resourcePath('tc', 'sampleRequests', { peek: r.id }) }));
  return {
    id: 'samples',
    title: 'Sample print requests',
    info: 'Sample prints requested by sales for demos and trials.',
    tiles: [
      { label: 'Open requests', value: String(reqs.length), to: resourcePath('tc', 'sampleRequests') },
      { label: 'Assigned to me', value: String(reqs.filter((r) => r.assigneeId === actor.staffId).length), to: listWith('sampleRequests', [['assigneeId', 'eq', actor.staffId]]) },
      { label: 'Due this week', value: String(reqs.filter((r) => s(r.dueDate) >= today && s(r.dueDate) <= addDays(today, 7)).length) },
    ],
    list: { title: 'Next requests', items, empty: 'No open sample requests.', to: resourcePath('tc', 'sampleRequests') },
  };
}

/** Export restrictions shown in the UI (reports.export capability). */
export const canExport = (actor: Actor) => can(actor, 'reports.export');

/** Monthly bars against the average of the completed months: at/above average green, below amber, current month blue. */
function monthlyVsAverage(label: string, bars: ChartBar[], today: string, to: string): NonNullable<Section['chart']> {
  const current = today.slice(0, 7);
  const done = bars.filter((b) => b.key !== current);
  const avg = done.length ? done.reduce((t, b) => t + b.value, 0) / done.length : 0;
  return {
    label,
    unit: '₹',
    money: true,
    to,
    data: bars.map((b) => ({ ...b, tone: b.key === current ? 'info' : b.value >= avg ? 'success' : 'warning' })),
    legend: [
      { tone: 'success', label: 'At or above average' },
      { tone: 'warning', label: 'Below average' },
      { tone: 'info', label: 'This month (in progress)' },
    ],
  };
}

/** Workload bars against the period average: normal green, busier amber, peak (≥ 1.5× average) red. */
function loadChart(label: string, bars: ChartBar[], to: string): NonNullable<Section['chart']> {
  const avg = bars.length ? bars.reduce((t, b) => t + b.value, 0) / bars.length : 0;
  return {
    label,
    unit: 'tickets',
    to,
    data: bars.map((b) => ({ ...b, tone: avg && b.value >= avg * 1.5 ? 'danger' : b.value > avg ? 'warning' : 'success' })),
    legend: [
      { tone: 'success', label: 'Normal' },
      { tone: 'warning', label: 'Busier than usual' },
      { tone: 'danger', label: 'Peak (1.5× usual)' },
    ],
  };
}
