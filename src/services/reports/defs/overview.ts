/** Overview reports: business scorecard (Appendix C KPIs), pipeline & forecast (OPP-07), CRM adoption (NFR-23). */
import { L } from '../../../constants/labels';
import { ROUTES } from '../../../constants/routes';
import { addDays } from '../../../lib/dates';
import { recordPeekPath } from '../../../lib/routes';
import { perm } from '../../authz';
import { staffOfUser } from '../../lookups';
import { getPolicies } from '../../policies';
import { activityScorecard, amcRenewalRate, attachRate, avgSalesCycleDays, collections, csat, dayOf, firstTimeFix, inRange, isBooked, isOpenOpp, leadConversion, leadResponseHours, mttrHours, orderBacklog, overdueFollowUps, pipeline, pmCompliance, quoteToOrder, repeatRate, slaCompliance, sum, winRate } from '../kpis';
import { applyFilters, empName, groupBy, label, list, monthKey, n, reportPath, row, s } from '../helpers';
import { count, countIf, sum as sumOf, ratio } from '../metrics';
import type { RecordData } from '../../../metadata/types';
import type { Metric, ReportDef } from '../types';

const D = L.reports.defs;
const R = L.reports.rep;
const M = L.reports.more;
const K = D.kpiSummary.kpis;
const KD = D.kpiSummary.definitions;
const fmt = {
  pct: (v: number | null) => (v === null ? '' : `pct:${v}`),
  money: (v: number) => `money:${v}`,
  hours: (v: number | null) => (v === null ? '' : `hours:${v}`),
  days: (v: number | null) => (v === null ? '' : `days:${v}`),
  number: (v: number) => `number:${v}`,
  rating: (v: number | null) => (v === null ? '' : `rating:${v}`),
};

/** A scorecard figure: the typed number inside one KPI row's value ("pct:0.42" → 0.42). */
const figure =
  (rowKey: string): Metric =>
  (rows) => {
    const v = /^[a-z]+:(.*)$/.exec(String(rows.find((r) => r._key === rowKey)?.value ?? ''));
    return v && v[1] !== '' ? Number(v[1]) : null;
  };

export const overviewReports: ReportDef[] = [
  // ---------------------------------------------------------------- Appendix C scorecard
  {
    id: 'business-scorecard',
    title: R.scorecard.title,
    group: 'kpis',
    icon: 'gauge',
    fr: ['FR-149', 'NFR-23'],
    description: R.scorecard.description,
    needs: ['leads'],
    views: [
      {
        id: 'scorecard',
        label: R.scorecard.title,
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
          const sc = activityScorecard({ activities: ds.get('activities'), fieldVisits: ds.get('fieldVisits'), demos: ds.get('demos'), quotations: ds.get('quotations'), leads: ds.get('leads'), from: addDays(ctx.today, -6), to: ctx.today });
          const scTotal = [...sc.values()].reduce((t, x) => t + x.calls + x.visits + x.demos + x.quotations + x.referrals, 0);
          const k = (key: string, kpi: string, value: string, definition: string, link?: string) => row(key, { kpi, value, definition, _href: link });
          const qualified = leads.filter((l) => l.status === 'qualified' || l.opportunityId).length;
          const sent = quotes.filter((q) => q.isLatest !== false && s(q.sentAt)).length;
          return {
            columns: [
              { key: 'kpi', label: D.kpiSummary.cols.kpi, link: (r) => (r._href ? String(r._href) : undefined) },
              { key: 'value', label: D.kpiSummary.cols.value, type: 'kpi' },
              { key: 'definition', label: D.kpiSummary.cols.definition },
            ],
            rows: [
              k('booked', R.scorecard.booked, fmt.money(sum(booked, 'grandTotal')), R.scorecard.bookedDef, reportPath('order-value')),
              k('lead-response', K.leadResponse, fmt.hours(leadResponseHours(leads)), KD.leadResponse, reportPath('lead-speed')),
              k('lead-conversion', K.leadConversion, fmt.pct(leadConversion(leads)), KD.leadConversion, reportPath('lead-conversion')),
              k('win-rate', K.winRate, fmt.pct(winRate(closed)), KD.winRate, list('opportunities')),
              k('pipeline', K.pipeline, fmt.money(p.value), KD.pipeline(p.count), reportPath('pipeline-forecast')),
              k('weighted', K.weighted, fmt.money(p.weighted), KD.weighted, ROUTES.salesForecast),
              k('cycle', K.cycle, fmt.days(avgSalesCycleDays(closed, ds.get('leads'))), KD.cycle),
              k('q2o', K.q2o, fmt.pct(quoteToOrder(quotes, ds.get('salesOrders'))), KD.q2o, reportPath('quotation-value')),
              k('scorecard', K.scorecard, fmt.number(scTotal), KD.scorecard, ROUTES.activityScorecard),
              k('backlog', K.backlog, fmt.money(orderBacklog(orders).value), KD.backlog, reportPath('order-backlog')),
              k('collections', K.collections, fmt.money(coll.received), KD.collections, reportPath('payment-status')),
              k('overdue', K.overdue, fmt.money(coll.overdueAmount), KD.overdue(coll.overdueCount), reportPath('payment-status')),
              k('sla', K.sla, fmt.pct(slaCompliance(tickets)), KD.sla, reportPath('sla-compliance')),
              k('mttr', K.mttr, fmt.hours(mttrHours(tickets)), KD.mttr, reportPath('sla-compliance')),
              k('ftfr', K.ftfr, fmt.pct(firstTimeFix(tickets, ds.get('serviceVisits'))), KD.ftfr, reportPath('service-quality')),
              k('repeat', K.repeat, fmt.pct(repeatRate(tickets)), KD.repeat(getPolicies().repeatComplaintDays), reportPath('machine-reliability')),
              k('pm', K.pm, fmt.pct(pmCompliance(pm, ctx.today)), KD.pm, reportPath('pm-compliance')),
              k('amc', K.amc, fmt.pct(amcRenewalRate(amc)), KD.amc, reportPath('warranty-amc')),
              k('csat', K.csat, fmt.rating(c.avg), KD.csat, reportPath('service-quality')),
              k('attach', K.attach, fmt.pct(attach.rate), KD.attach(attach.machineCustomers), ROUTES.leakageList),
              k('adoption', K.adoption, '', KD.adoption, reportPath('crm-adoption')),
            ],
            points: [
              { key: 'leads', label: R.scorecard.stages.leads, value: leads.length },
              { key: 'qualified', label: R.scorecard.stages.qualified, value: qualified },
              { key: 'quotes', label: R.scorecard.stages.quotes, value: sent },
              { key: 'orders', label: R.scorecard.stages.orders, value: booked.length },
            ],
          };
        },
        kpis: [
          { label: R.scorecard.booked, fmt: 'money', value: figure('booked') },
          { label: K.leadConversion, fmt: 'pct', value: figure('lead-conversion'), hint: KD.leadConversion },
          { label: K.winRate, fmt: 'pct', value: figure('win-rate'), hint: KD.winRate },
          { label: K.sla, fmt: 'pct', value: figure('sla'), hint: KD.sla },
          { label: K.csat, fmt: 'rating', value: figure('csat'), hint: KD.csat },
        ],
        chart: { type: 'funnel', title: R.scorecard.chart, x: 'kpi', y: 'value', fmt: 'number', unit: R.scorecard.unit },
      },
    ],
  },

  // ---------------------------------------------------------------- OPP-07 pipeline & forecast
  {
    id: 'pipeline-forecast',
    title: R.pipeline.title,
    group: 'kpis',
    icon: 'trending-up',
    fr: ['FR-149', 'OPP-07'],
    description: R.pipeline.description,
    needs: ['opportunities'],
    views: [
      {
        id: 'outcomes',
        label: M.outcomes.view,
        filters: { date: 'past', division: true, owner: true },
        dateLabel: M.outcomes.closedDate,
        compute: (ds, f) => {
          const closedAt = (o: RecordData) => o.wonAt || o.stageChangedAt || o.updatedAt;
          const done = applyFilters(ds.get('opportunities'), f, { owner: 'ownerId' }).filter((o) => ['won', 'lost'].includes(s(o.stage)) && inRange(closedAt(o), f.from, f.to));
          const by = groupBy(done, (o) => monthKey(closedAt(o)));
          return {
            columns: [
              { key: 'month', label: L.reports.cols.month, type: 'month' },
              { key: 'won', label: M.outcomes.won, type: 'number', total: 'sum' },
              { key: 'lost', label: M.outcomes.lost, type: 'number', total: 'sum' },
              { key: 'closed', label: M.outcomes.closed, type: 'number', total: 'sum' },
              { key: 'winRate', label: M.outcomes.winRate, type: 'pct', total: ratio('won', 'closed') },
              { key: 'wonValue', label: M.outcomes.wonValue, type: 'money', total: 'sum' },
              { key: 'lostValue', label: M.outcomes.lostValue, type: 'money', total: 'sum', optional: true },
            ],
            rows: [...by.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([m, os]) => {
                const won = os.filter((o) => o.stage === 'won');
                const lost = os.filter((o) => o.stage === 'lost');
                return row(m, { month: m, won: won.length, lost: lost.length, closed: os.length, winRate: os.length ? won.length / os.length : null, wonValue: sum(won, 'value'), lostValue: sum(lost, 'value') });
              }),
          };
        },
        kpis: [
          { label: M.outcomes.won, fmt: 'number', value: sumOf('won') },
          { label: M.outcomes.lost, fmt: 'number', value: sumOf('lost'), better: 'down' },
          { label: M.outcomes.winRate, fmt: 'pct', value: ratio('won', 'closed') },
          { label: M.outcomes.wonValue, fmt: 'money', value: sumOf('wonValue') },
        ],
        chart: {
          type: 'stacked',
          title: M.outcomes.chart,
          x: 'month',
          y: 'closed',
          fmt: 'number',
          unit: M.outcomes.unit,
          series: [
            { key: 'won', label: M.outcomes.won, tone: 'success' },
            { key: 'lost', label: M.outcomes.lost, tone: 'danger' },
          ],
        },
      },
      {
        id: 'stage',
        label: R.pipeline.views.stage,
        filters: { division: true, owner: true },
        compute: (ds, f) => {
          const open = applyFilters(ds.get('opportunities').filter(isOpenOpp), f, { owner: 'ownerId' });
          const stages = ['needs_assessment', 'demo', 'proposal', 'negotiation'];
          const by = groupBy(open, (o) => s(o.stage));
          return {
            columns: [
              { key: 'stage', label: R.pipeline.cols.stage, link: () => list('opportunities') },
              { key: 'opportunities', label: R.pipeline.cols.opportunities, type: 'number', total: 'sum' },
              { key: 'value', label: R.pipeline.cols.value, type: 'money', total: 'sum' },
              { key: 'weighted', label: R.pipeline.cols.weighted, type: 'money', total: 'sum' },
              { key: 'avgDeal', label: R.pipeline.cols.avgDeal, type: 'money', total: ratio('value', 'opportunities') },
            ],
            rows: stages.map((st) => {
              const os = by.get(st) ?? [];
              const value = sum(os, 'value');
              return row(st, { stage: label('oppStage', st), opportunities: os.length, value, weighted: os.reduce((t, o) => t + (n(o.weightedValue) || (n(o.value) * n(o.probability)) / 100), 0), avgDeal: os.length ? value / os.length : null });
            }),
          };
        },
        kpis: [
          { label: R.pipeline.kpis.open, fmt: 'number', value: sumOf('opportunities') },
          { label: R.pipeline.kpis.value, fmt: 'money', value: sumOf('value'), hint: R.pipeline.valueHint },
          { label: R.pipeline.kpis.weighted, fmt: 'money', value: sumOf('weighted'), hint: D.kpiSummary.definitions.weighted },
          { label: R.pipeline.kpis.avgDeal, fmt: 'money', value: ratio('value', 'opportunities') },
        ],
        chart: { type: 'funnel', title: M.pipelineStageChart, x: 'stage', y: 'value', fmt: 'money', keepOrder: true, carry: false },
      },
      {
        id: 'owner',
        label: R.pipeline.views.owner,
        filters: { division: true, owner: true },
        compute: (ds, f) => {
          const open = applyFilters(ds.get('opportunities').filter(isOpenOpp), f, { owner: 'ownerId' });
          return {
            columns: [
              { key: 'owner', label: L.reports.cols.salesExecutive, link: () => list('opportunities') },
              { key: 'opportunities', label: R.pipeline.cols.opportunities, type: 'number', total: 'sum' },
              { key: 'value', label: R.pipeline.cols.value, type: 'money', total: 'sum' },
              { key: 'weighted', label: R.pipeline.cols.weighted, type: 'money', total: 'sum' },
              { key: 'avgDeal', label: R.pipeline.cols.avgDeal, type: 'money', total: ratio('value', 'opportunities') },
            ],
            rows: [...groupBy(open, (o) => s(o.ownerId)).entries()]
              .map(([id, os]) => {
                const value = sum(os, 'value');
                return row(id, { owner: empName(ds, id), opportunities: os.length, value, weighted: os.reduce((t, o) => t + (n(o.weightedValue) || (n(o.value) * n(o.probability)) / 100), 0), avgDeal: os.length ? value / os.length : null });
              })
              .sort((a, b) => n(b.weighted) - n(a.weighted)),
          };
        },
        kpis: [
          { label: R.pipeline.kpis.open, fmt: 'number', value: sumOf('opportunities') },
          { label: R.pipeline.kpis.value, fmt: 'money', value: sumOf('value') },
          { label: R.pipeline.kpis.weighted, fmt: 'money', value: sumOf('weighted') },
          { label: R.pipeline.kpis.people, fmt: 'number', value: count },
        ],
        chart: { type: 'hbar', title: R.pipeline.chartOwner, x: 'owner', y: 'weighted', fmt: 'money' },
      },
    ],
  },

  // ---------------------------------------------------------------- NFR-23 CRM adoption
  {
    id: 'crm-adoption',
    title: D.crmAdoption.title,
    group: 'kpis',
    icon: 'user-check',
    fr: ['NFR-23', 'FR-149'],
    description: R.adoption.description,
    needs: ['employees'],
    views: [
      {
        id: 'adoption',
        label: D.crmAdoption.title,
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
          const visible = (e: RecordData) => actScope === 'all' || (actScope === 'division' ? ((e.divisionIds as string[] | undefined) ?? []).some((d) => ctx.actor.divisionIds.includes(d)) : ctx.actor.teamStaffIds.includes(s(e.id)));
          const people = applyFilters(ds.get('employees').filter((e) => e.status !== 'inactive' && !['admin'].includes(s(e.roleId)) && visible(e)), f, { division: 'divisionIds' });
          return {
            columns: [
              { key: 'user', label: D.crmAdoption.cols.user, link: (r) => recordPeekPath('tc', 'employees', s(r.id)) },
              { key: 'created', label: D.crmAdoption.cols.created, type: 'number', total: 'sum' },
              { key: 'updated', label: D.crmAdoption.cols.updated, type: 'number', total: 'sum' },
              { key: 'activities', label: D.crmAdoption.cols.activities, type: 'number', total: 'sum' },
              { key: 'lastActivity', label: D.crmAdoption.cols.lastActivity, type: 'date' },
              { key: 'active', label: D.crmAdoption.cols.active },
              { key: 'overdue', label: D.crmAdoption.cols.overdue, type: 'number', total: 'sum' },
              { key: 'role', label: D.crmAdoption.cols.role, type: 'status', master: 'role', optional: true },
            ],
            rows: people
              .map((e) => {
                const mine = acts.filter((a) => a.byId === e.id);
                const last = mine.map((a) => dayOf(a.at)).sort().pop() ?? '';
                return row(e.id, { id: e.id, user: s(e.fullName), role: e.roleId, created: created.get(e.id) ?? 0, updated: updated.get(e.id) ?? 0, activities: mine.filter((a) => inRange(a.at, f.from, f.to)).length, lastActivity: last, active: last && last >= since ? D.crmAdoption.active : D.crmAdoption.inactive, overdue: overdue.get(e.id) ?? 0 });
              })
              .sort((a, b) => n(b.overdue) - n(a.overdue) || n(a.activities) - n(b.activities)),
          };
        },
        kpis: [
          { label: D.crmAdoption.tiles.active, fmt: 'number', value: countIf((r) => r.active === D.crmAdoption.active), hint: R.adoption.activeHint },
          { label: R.adoption.kpis.users, fmt: 'number', value: count, better: 'none' },
          { label: R.adoption.kpis.updated, fmt: 'number', value: sumOf('updated') },
          { label: R.adoption.kpis.activities, fmt: 'number', value: sumOf('activities') },
          { label: D.crmAdoption.tiles.overdue, fmt: 'number', value: sumOf('overdue'), better: 'down' },
        ],
        chart: { type: 'hbar', title: D.crmAdoption.chart, x: 'user', y: 'overdue', fmt: 'number', unit: D.crmAdoption.unit },
      },
    ],
  },
];
