/** Appendix C KPI summary, CRM adoption (NFR-23) and the weekly activity scorecard (TGT-03). */
import { L } from '../../../constants/labels';
import { ROUTES } from '../../../constants/routes';
import { addDays } from '../../../lib/dates';
import { recordPeekPath } from '../../../lib/routes';
import { staffOfUser } from '../../lookups';
import { perm } from '../../authz';
import { getPolicies } from '../../policies';
import { activityScorecard, amcRenewalRate, attachRate, avgSalesCycleDays, collections, csat, dayOf, firstTimeFix, inRange, isBooked, leadConversion, leadResponseHours, mttrHours, orderBacklog, overdueFollowUps, pipeline, pmCompliance, quoteToOrder, repeatRate, slaCompliance, winRate } from '../kpis';
import { applyFilters, empName, list, n, reportPath, s } from '../helpers';
import type { ReportDef, ReportRow } from '../types';
import type { RecordData } from '../../../metadata/types';

const row = (key: string, o: Record<string, unknown>): ReportRow => ({ _key: key, ...o });
const D = L.reports.defs;
const K = D.kpiSummary.kpis;
const KD = D.kpiSummary.definitions;
const fmt = {
  pct: (v: number | null) => (v === null ? '' : `pct:${v}`),
  money: (v: number) => `money:${v}`,
  hours: (v: number | null) => (v === null ? '' : `hours:${v}`),
  days: (v: number | null) => (v === null ? '' : `days:${v}`),
};

export const kpiReports: ReportDef[] = [
  {
    id: 'kpi-summary',
    title: D.kpiSummary.title,
    group: 'kpis',
    fr: ['FR-149', 'NFR-23'],
    description: D.kpiSummary.description,
    needs: ['leads'],
    filters: { date: 'past', division: true },
    dateLabel: D.kpiSummary.dateLabel,
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
        k('lead-response', K.leadResponse, fmt.hours(leadResponseHours(leads)), KD.leadResponse, reportPath('lead-first-response')),
        k('lead-conversion', K.leadConversion, fmt.pct(leadConversion(leads)), KD.leadConversion, reportPath('lead-conversion')),
        k('win-rate', K.winRate, fmt.pct(winRate(closed)), KD.winRate, list('opportunities')),
        k('pipeline', K.pipeline, fmt.money(p.value), KD.pipeline(p.count), ROUTES.pipeline),
        k('weighted', K.weighted, fmt.money(p.weighted), KD.weighted, ROUTES.salesForecast),
        k('cycle', K.cycle, fmt.days(avgSalesCycleDays(closed, ds.get('leads'))), KD.cycle),
        k('q2o', K.q2o, fmt.pct(quoteToOrder(quotes, ds.get('salesOrders'))), KD.q2o, reportPath('quote-to-order')),
        k('scorecard', K.scorecard, String(scTotal), KD.scorecard, reportPath('activity-scorecard')),
        k('backlog', K.backlog, fmt.money(orderBacklog(orders).value), KD.backlog, reportPath('order-backlog')),
        k('collections', K.collections, fmt.money(coll.received), KD.collections, reportPath('payment-status')),
        k('overdue', K.overdue, fmt.money(coll.overdueAmount), KD.overdue(coll.overdueCount), reportPath('payment-status')),
        k('sla', K.sla, fmt.pct(slaCompliance(tickets)), KD.sla, reportPath('sla-compliance')),
        k('mttr', K.mttr, fmt.hours(mttrHours(tickets)), KD.mttr, reportPath('sla-compliance')),
        k('ftfr', K.ftfr, fmt.pct(firstTimeFix(tickets, ds.get('serviceVisits'))), KD.ftfr, reportPath('first-time-fix')),
        k('repeat', K.repeat, fmt.pct(repeatRate(tickets)), KD.repeat(getPolicies().repeatComplaintDays), reportPath('repeat-complaints')),
        k('pm', K.pm, fmt.pct(pmCompliance(pm, ctx.today)), KD.pm, reportPath('pm-compliance')),
        k('amc', K.amc, fmt.pct(amcRenewalRate(amc)), KD.amc, reportPath('amc-status')),
        k('csat', K.csat, c.avg === null ? '' : D.kpiSummary.csatValue(c.avg.toFixed(2), Math.round((c.share4plus ?? 0) * 100)), KD.csat, reportPath('csat')),
        k('attach', K.attach, fmt.pct(attach.rate), KD.attach(attach.machineCustomers), ROUTES.leakageList),
        k('adoption', K.adoption, '', KD.adoption, reportPath('crm-adoption')),
      ];
      return {
        columns: [
          { key: 'kpi', label: D.kpiSummary.cols.kpi, link: (r) => (r._href ? String(r._href) : undefined) },
          { key: 'value', label: D.kpiSummary.cols.value, type: 'kpi' },
          { key: 'definition', label: D.kpiSummary.cols.definition },
        ],
        rows,
        kpis: [
          { label: D.kpiSummary.tiles.winRate, value: fmt.pct(winRate(closed)) },
          { label: D.kpiSummary.tiles.booked, value: fmt.money(booked.reduce((t, o) => t + n(o.grandTotal), 0)) },
          { label: D.kpiSummary.tiles.sla, value: fmt.pct(slaCompliance(tickets)) },
          { label: D.kpiSummary.tiles.csat, value: c.avg === null ? '' : c.avg.toFixed(2) },
        ],
      };
    },
  },
  {
    id: 'crm-adoption',
    title: D.crmAdoption.title,
    group: 'kpis',
    fr: ['NFR-23', 'FR-149'],
    description: D.crmAdoption.description,
    needs: ['employees'],
    filters: { date: 'past', division: true },
    dateLabel: D.crmAdoption.dateLabel,
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
      // Only people whose activity the viewer can see (activity log scope), so nobody looks "inactive" just because their records are out of scope.
      const actScope = perm(ctx.actor, 'activities').read;
      const visible = (e: RecordData) =>
        actScope === 'all' || (actScope === 'division' ? ((e.divisionIds as string[] | undefined) ?? []).some((d) => ctx.actor.divisionIds.includes(d)) : ctx.actor.teamStaffIds.includes(s(e.id)));
      const people = applyFilters(ds.get('employees').filter((e) => e.status !== 'inactive' && !['admin'].includes(s(e.roleId)) && visible(e)), f, { division: 'divisionIds' });
      const rows = people.map((e) => {
        const mine = acts.filter((a) => a.byId === e.id);
        const last = mine.map((a) => dayOf(a.at)).sort().pop() ?? '';
        const inPeriod = mine.filter((a) => inRange(a.at, f.from, f.to)).length;
        const active = !!last && last >= since;
        return row(e.id, { id: e.id, user: s(e.fullName), role: e.roleId, created: created.get(e.id) ?? 0, updated: updated.get(e.id) ?? 0, activities: inPeriod, lastActivity: last, active: active ? D.crmAdoption.active : D.crmAdoption.inactive, overdue: overdue.get(e.id) ?? 0 });
      });
      const activeCount = rows.filter((r) => r.active === D.crmAdoption.active).length;
      return {
        columns: [
          { key: 'user', label: D.crmAdoption.cols.user, link: (r) => recordPeekPath('tc', 'employees', s(r.id)) },
          { key: 'role', label: D.crmAdoption.cols.role, type: 'status', master: 'role' },
          { key: 'created', label: D.crmAdoption.cols.created, type: 'number' },
          { key: 'updated', label: D.crmAdoption.cols.updated, type: 'number' },
          { key: 'activities', label: D.crmAdoption.cols.activities, type: 'number' },
          { key: 'lastActivity', label: D.crmAdoption.cols.lastActivity, type: 'date' },
          { key: 'active', label: D.crmAdoption.cols.active },
          { key: 'overdue', label: D.crmAdoption.cols.overdue, type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.overdue) - n(a.overdue) || n(a.activities) - n(b.activities)),
        chart: { polarity: 'lower', label: D.crmAdoption.chart, unit: D.crmAdoption.unit, data: rows.filter((r) => n(r.overdue) > 0).map((r) => ({ key: r._key, label: s(r.user), value: n(r.overdue) })) },
        kpis: [
          { label: D.crmAdoption.tiles.active, value: L.reports.common.ofTotal(activeCount, rows.length) },
          { label: D.crmAdoption.tiles.overdue, value: String(rows.reduce((t, r) => t + n(r.overdue), 0)) },
        ],
      };
    },
  },
  {
    id: 'activity-scorecard',
    title: D.activityScorecard.title,
    group: 'kpis',
    fr: ['FR-116', 'FR-149'],
    description: D.activityScorecard.description,
    needs: ['activities'],
    filters: { date: 'past', owner: true },
    dateLabel: D.activityScorecard.dateLabel,
    compute: (ds, f, ctx) => {
      const sc = activityScorecard({ activities: ds.get('activities'), fieldVisits: ds.get('fieldVisits'), demos: ds.get('demos'), quotations: ds.get('quotations'), leads: ds.get('leads'), from: f.from ?? addDays(ctx.today, -6), to: f.to ?? ctx.today });
      const rows = [...sc.entries()].filter(([id]) => id && (!f.owner || id === f.owner)).map(([id, v]) => row(id, { person: empName(ds, id), ...v, total: v.calls + v.visits + v.demos + v.quotations + v.referrals }));
      return {
        columns: [
          { key: 'person', label: D.activityScorecard.cols.user, link: () => ROUTES.activityScorecard },
          { key: 'calls', label: D.activityScorecard.cols.calls, type: 'number' },
          { key: 'visits', label: D.activityScorecard.cols.visits, type: 'number' },
          { key: 'demos', label: D.activityScorecard.cols.demos, type: 'number' },
          { key: 'quotations', label: D.activityScorecard.cols.quotations, type: 'number' },
          { key: 'referrals', label: D.activityScorecard.cols.referrals, type: 'number' },
          { key: 'total', label: D.activityScorecard.cols.total, type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.total) - n(a.total)),
        chart: { polarity: 'higher', label: D.activityScorecard.chart, unit: D.activityScorecard.unit, data: rows.slice(0, 12).map((r) => ({ key: r._key, label: s(r.person), value: n(r.total) })) },
      };
    },
  },
];
