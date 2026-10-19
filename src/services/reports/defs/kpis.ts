/** Appendix C KPI summary, CRM adoption (NFR-23) and the weekly activity scorecard (TGT-03). */
import { addDays } from '../../../lib/dates';
import { staffOfUser } from '../../lookups';
import { getPolicies } from '../../policies';
import { activityScorecard, amcRenewalRate, attachRate, avgSalesCycleDays, collections, csat, dayOf, firstTimeFix, inRange, isBooked, leadConversion, leadResponseHours, mttrHours, orderBacklog, overdueFollowUps, pipeline, pmCompliance, quoteToOrder, repeatRate, slaCompliance, winRate } from '../kpis';
import { applyFilters, empName, list, n, s } from '../helpers';
import type { ReportDef, ReportRow } from '../types';

const row = (key: string, o: Record<string, unknown>): ReportRow => ({ _key: key, ...o });
const fmt = {
  pct: (v: number | null) => (v === null ? '' : `pct:${v}`),
  money: (v: number) => `money:${v}`,
  hours: (v: number | null) => (v === null ? '' : `hours:${v}`),
  days: (v: number | null) => (v === null ? '' : `days:${v}`),
};

export const kpiReports: ReportDef[] = [
  {
    id: 'kpi-summary',
    title: 'KPI summary (Appendix C)',
    group: 'kpis',
    fr: ['FR-149', 'NFR-23'],
    description: 'Every key performance indicator from the BRD for the period, computed from the records you can see.',
    needs: ['leads'],
    filters: { date: 'past', division: true },
    dateLabel: 'Period',
    compute: (ds, f, ctx) => {
      const leads = applyFilters(ds.get('leads'), f, { date: 'createdAt' });
      const oppsAll = applyFilters(ds.get('opportunities'), f);
      const closed = oppsAll.filter((o) => ['won', 'lost'].includes(s(o.stage)) && inRange(o.wonAt || o.stageChangedAt || o.updatedAt, f.from, f.to));
      const quotes = applyFilters(ds.get('quotations'), f, { date: 'quoteDate' });
      const orders = applyFilters(ds.get('salesOrders'), f);
      const booked = orders.filter((o) => isBooked(o) && inRange(o.orderDate, f.from, f.to));
      const tickets = applyFilters(ds.get('tickets'), f, { date: 'reportedAt' });
      const pm = applyFilters(ds.get('pmVisits'), f, { date: 'dueDate' });
      const amc = applyFilters(ds.get('amcContracts'), f, { date: 'endDate' });
      const coll = collections(applyFilters(ds.get('paymentMilestones'), f, { date: 'dueDate' }), ctx.today);
      const p = pipeline(oppsAll);
      const c = csat(tickets);
      const attach = attachRate(applyFilters(ds.get('machines'), f), ds.get('salesOrders'), addDays(ctx.today, -365));
      const weekAgo = addDays(ctx.today, -6);
      const sc = activityScorecard({ activities: ds.get('activities'), fieldVisits: ds.get('fieldVisits'), demos: ds.get('demos'), quotations: ds.get('quotations'), leads: ds.get('leads'), from: weekAgo, to: ctx.today });
      const scTotal = [...sc.values()].reduce((t, x) => t + x.calls + x.visits + x.demos + x.quotations + x.referrals, 0);
      const k = (key: string, kpi: string, value: string, definition: string, link?: string) => row(key, { kpi, value, definition, _href: link });
      const rows = [
        k('lead-response', 'Lead response time', fmt.hours(leadResponseHours(leads)), 'Time from lead creation to first logged contact', '/reports/lead-first-response'),
        k('lead-conversion', 'Lead conversion %', fmt.pct(leadConversion(leads)), 'Leads qualified to opportunity ÷ leads created', '/reports/lead-conversion'),
        k('win-rate', 'Win rate', fmt.pct(winRate(closed)), 'Opportunities won ÷ opportunities closed (won + lost)', list('opportunities')),
        k('pipeline', 'Pipeline value', fmt.money(p.value), `Sum of ${p.count} open opportunity values`, list('opportunities')),
        k('weighted', 'Weighted forecast', fmt.money(p.weighted), 'Sum of open value × stage probability', '/opportunities/forecast'),
        k('cycle', 'Average sales cycle', fmt.days(avgSalesCycleDays(closed, ds.get('leads'))), 'Days from lead creation to the win'),
        k('q2o', 'Quote-to-order %', fmt.pct(quoteToOrder(quotes, ds.get('salesOrders'))), 'Quotations converted to sales orders ÷ quotations sent', '/reports/quote-to-order'),
        k('scorecard', 'Activity scorecard (last 7 days)', String(scTotal), 'Calls, visits, demos, quotations and referrals logged', '/reports/activity-scorecard'),
        k('backlog', 'Order backlog', fmt.money(orderBacklog(orders).value), 'Value of confirmed orders not yet delivered / installed', '/reports/order-backlog'),
        k('collections', 'Collections received', fmt.money(coll.received), 'Payments received on milestones due in the period', '/reports/payment-status'),
        k('overdue', 'Overdue amount', fmt.money(coll.overdueAmount), `${coll.overdueCount} overdue milestone(s); see ageing`, '/reports/payment-status'),
        k('sla', 'SLA compliance %', fmt.pct(slaCompliance(tickets)), 'Tickets meeting response and resolution SLA ÷ resolved tickets', '/reports/sla-compliance'),
        k('mttr', 'Mean time to repair (MTTR)', fmt.hours(mttrHours(tickets)), 'Average time from ticket creation to resolution (customer pauses excluded)', '/reports/sla-compliance'),
        k('ftfr', 'First-time fix rate', fmt.pct(firstTimeFix(tickets, ds.get('serviceVisits'))), 'Tickets resolved on the first visit ÷ resolved site-visit tickets', '/reports/first-time-fix'),
        k('repeat', 'Repeat complaint %', fmt.pct(repeatRate(tickets)), `Tickets on the same machine and category within ${getPolicies().repeatComplaintDays} days ÷ tickets`, '/reports/repeat-complaints'),
        k('pm', 'PM compliance %', fmt.pct(pmCompliance(pm, ctx.today)), 'Preventive visits done on time ÷ visits due', '/reports/pm-compliance'),
        k('amc', 'AMC renewal %', fmt.pct(amcRenewalRate(amc)), 'Contracts renewed ÷ contracts due for renewal (renewed + lost + expired)', '/reports/amc-status'),
        k('csat', 'Customer satisfaction (CSAT)', c.avg === null ? '' : `${c.avg.toFixed(2)} / 5 · ${Math.round((c.share4plus ?? 0) * 100)}% rated 4+`, 'Average feedback rating; share of ratings 4 and above', '/reports/csat'),
        k('attach', 'Consumables attach rate', fmt.pct(attach.rate), `Machine customers buying company consumables in the last 12 months ÷ ${attach.machineCustomers} machine customers`, '/consumables/leakage'),
        k('adoption', 'CRM adoption', '', 'Active users, records updated and overdue follow-ups per user', '/reports/crm-adoption'),
      ];
      return {
        columns: [
          { key: 'kpi', label: 'KPI', link: (r) => (r._href ? String(r._href) : undefined) },
          { key: 'value', label: 'Value', type: 'kpi' },
          { key: 'definition', label: 'Definition (BRD Appendix C)' },
        ],
        rows,
        kpis: [
          { label: 'Win rate', value: fmt.pct(winRate(closed)) },
          { label: 'Booked value', value: fmt.money(booked.reduce((t, o) => t + n(o.grandTotal), 0)) },
          { label: 'SLA compliance', value: fmt.pct(slaCompliance(tickets)) },
          { label: 'CSAT', value: c.avg === null ? '' : c.avg.toFixed(2) },
        ],
      };
    },
  },
  {
    id: 'crm-adoption',
    title: 'CRM adoption',
    group: 'kpis',
    fr: ['NFR-23', 'FR-149'],
    description: 'Per user: records created and updated, activities logged, last activity and overdue follow-ups — for the 30/60/90-day adoption reviews.',
    needs: ['employees'],
    filters: { date: 'past', division: true },
    dateLabel: 'Period',
    compute: (ds, f, ctx) => {
      const resources = ['leads', 'opportunities', 'quotations', 'salesOrders', 'tickets', 'activities', 'fieldVisits', 'customers', 'contacts', 'tasks'];
      const created = new Map<string, number>();
      const updated = new Map<string, number>();
      resources.forEach((r) =>
        ds.get(r).forEach((rec) => {
          const staff = staffOfUser(s(rec.createdBy));
          if (staff && inRange(rec.createdAt, f.from, f.to)) created.set(staff, (created.get(staff) ?? 0) + 1);
          const owner = s(rec.ownerId || rec.assigneeId || rec.employeeId || rec.byId);
          if (owner && rec.version > 1 && inRange(rec.updatedAt, f.from, f.to)) updated.set(owner, (updated.get(owner) ?? 0) + 1);
        }),
      );
      const acts = ds.get('activities');
      const overdue = overdueFollowUps(ds.get('leads'), ds.get('opportunities'), ctx.today);
      const since = addDays(ctx.today, -6);
      const people = applyFilters(ds.get('employees').filter((e) => e.status !== 'inactive' && !['admin'].includes(s(e.roleId))), f, { division: 'divisionIds' });
      const rows = people.map((e) => {
        const mine = acts.filter((a) => a.byId === e.id);
        const last = mine.map((a) => dayOf(a.at)).sort().pop() ?? '';
        const inPeriod = mine.filter((a) => inRange(a.at, f.from, f.to)).length;
        const active = !!last && last >= since;
        return row(e.id, { id: e.id, user: s(e.fullName), role: e.roleId, created: created.get(e.id) ?? 0, updated: updated.get(e.id) ?? 0, activities: inPeriod, lastActivity: last, active: active ? 'Active' : 'Inactive', overdue: overdue.get(e.id) ?? 0 });
      });
      const activeCount = rows.filter((r) => r.active === 'Active').length;
      return {
        columns: [
          { key: 'user', label: 'User', link: (r) => `/employees?peek=${r.id}` },
          { key: 'role', label: 'Role', type: 'status', master: 'role' },
          { key: 'created', label: 'Records created', type: 'number' },
          { key: 'updated', label: 'Records updated', type: 'number' },
          { key: 'activities', label: 'Activities logged', type: 'number' },
          { key: 'lastActivity', label: 'Last activity', type: 'date' },
          { key: 'active', label: 'Last 7 days' },
          { key: 'overdue', label: 'Overdue follow-ups', type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.overdue) - n(a.overdue) || n(a.activities) - n(b.activities)),
        chart: { label: 'Overdue follow-ups per user', unit: 'follow-ups', data: rows.filter((r) => n(r.overdue) > 0).map((r) => ({ key: r._key, label: s(r.user), value: n(r.overdue) })) },
        kpis: [
          { label: 'Active users (7 days)', value: `${activeCount} of ${rows.length}` },
          { label: 'Overdue follow-ups', value: String(rows.reduce((t, r) => t + n(r.overdue), 0)) },
        ],
      };
    },
  },
  {
    id: 'activity-scorecard',
    title: 'Activity scorecard',
    group: 'kpis',
    fr: ['FR-116', 'FR-149'],
    description: 'Calls, visits, demos, quotations and referrals per person in the period.',
    needs: ['activities'],
    filters: { date: 'past', owner: true },
    dateLabel: 'Period',
    compute: (ds, f, ctx) => {
      const sc = activityScorecard({ activities: ds.get('activities'), fieldVisits: ds.get('fieldVisits'), demos: ds.get('demos'), quotations: ds.get('quotations'), leads: ds.get('leads'), from: f.from ?? addDays(ctx.today, -6), to: f.to ?? ctx.today });
      const rows = [...sc.entries()].filter(([id]) => id && (!f.owner || id === f.owner)).map(([id, v]) => row(id, { person: empName(ds, id), ...v, total: v.calls + v.visits + v.demos + v.quotations + v.referrals }));
      return {
        columns: [
          { key: 'person', label: 'Person', link: () => '/scorecard' },
          { key: 'calls', label: 'Calls', type: 'number' },
          { key: 'visits', label: 'Visits', type: 'number' },
          { key: 'demos', label: 'Demos', type: 'number' },
          { key: 'quotations', label: 'Quotations sent', type: 'number' },
          { key: 'referrals', label: 'Referrals', type: 'number' },
          { key: 'total', label: 'Total', type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.total) - n(a.total)),
        chart: { label: 'Activities per person', unit: 'activities', data: rows.slice(0, 12).map((r) => ({ key: r._key, label: s(r.person), value: n(r.total) })) },
      };
    },
  },
];
