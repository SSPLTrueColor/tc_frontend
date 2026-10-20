/** SRV-17 service reports: open tickets, SLA compliance, service quality, machine reliability, PM compliance. */
import { L } from '../../../constants/labels';
import { ROUTES } from '../../../constants/routes';
import { ageingBuckets, csat, dayOf, fixCounts, hoursBetween, isOpenTicket, isResolvedTicket, mtbfByModel, mttrHours, ms, pmCounts, slaCounts } from '../kpis';
import { applyFilters, empName, groupBy, label, list, monthKey, n, peek, row, s } from '../helpers';
import { count, countIf, mean, maxOf, ratio, sum as sumOf, weighted } from '../metrics';
import type { ReportDef } from '../types';

const D = L.reports.defs;
const C = L.reports.cols;
const G = L.reports.groupBy;
const R = L.reports.rep;
const ticketDate = 'reportedAt';

export const serviceReports: ReportDef[] = [
  {
    id: 'open-tickets',
    title: D.openTickets.title,
    group: 'service',
    icon: 'wrench',
    fr: ['FR-091'],
    description: R.openTickets.description,
    needs: ['tickets'],
    views: [
      {
        id: 'open',
        label: D.openTickets.title,
        filters: { division: true, owner: true },
        compute: (ds, f, ctx) => {
          const open = applyFilters(ds.get('tickets').filter(isOpenTicket), f, { owner: 'assigneeId' });
          return {
            columns: [
              { key: 'id', label: C.serviceTicket, link: peek('tickets') },
              { key: 'customer', label: C.customer },
              { key: 'priority', label: D.openTickets.cols.priority, type: 'status', master: 'ticketPriority' },
              { key: 'status', label: C.status, type: 'status', master: 'ticketStatus' },
              { key: 'engineer', label: C.serviceEngineer },
              { key: 'ageDays', label: C.ageDays, type: 'number' },
              { key: 'breached', label: D.openTickets.cols.sla },
              { key: 'reported', label: D.openTickets.cols.reported, type: 'date', optional: true },
            ],
            rows: open
              .map((t) => row(t.id, { id: t.id, customer: ds.name('customers', t.customerId), priority: t.priority, status: t.status, engineer: empName(ds, t.assigneeId), reported: t.reportedAt, ageDays: Math.floor((ctx.nowMs - ms(t.reportedAt)) / 86_400_000), breached: t.slaBreached || (s(t.resolutionDueAt) && ms(t.resolutionDueAt) < ctx.nowMs) ? D.openTickets.breached : D.openTickets.onTrack }))
              .sort((a, b) => n(b.ageDays) - n(a.ageDays)),
            points: ageingBuckets(open, ticketDate, ctx.nowMs).map((b) => ({ key: b.key, label: b.label, value: b.count })),
          };
        },
        kpis: [
          { label: D.openTickets.tiles.open, fmt: 'number', value: count, better: 'down' },
          { label: D.openTickets.tiles.breached, fmt: 'number', value: countIf((r) => r.breached === D.openTickets.breached), better: 'down' },
          { label: R.openTickets.kpis.avgAge, fmt: 'days', value: mean('ageDays'), better: 'down' },
          { label: R.openTickets.kpis.oldest, fmt: 'days', value: maxOf('ageDays'), better: 'down' },
        ],
        chart: { type: 'bar', title: D.openTickets.chart, x: 'id', y: 'ageDays', fmt: 'number', unit: D.openTickets.unit, keepOrder: true },
      },
    ],
  },
  {
    id: 'sla-compliance',
    title: D.slaCompliance.title,
    group: 'service',
    icon: 'shield-check',
    fr: ['FR-091', 'FR-083'],
    description: R.sla.description,
    needs: ['tickets'],
    views: [
      {
        id: 'sla',
        label: D.slaCompliance.title,
        filters: { date: 'past', division: true },
        dateLabel: D.slaCompliance.dateLabel,
        groupOptions: [
          { value: 'month', label: G.month },
          { value: 'priority', label: G.priority },
          { value: 'coverage', label: G.coverage },
        ],
        compute: (ds, f) => {
          const ts = applyFilters(ds.get('tickets'), f, { date: ticketDate });
          const g = f.group ?? 'month';
          const rows = [...groupBy(ts, (t) => (g === 'priority' ? label('ticketPriority', t.priority) : g === 'coverage' ? label('coverage', t.coverage) : monthKey(t.reportedAt))).entries()].map(([k, v]) => {
            const c = slaCounts(v);
            return row(k, { group: k, tickets: v.length, resolved: c.resolved, met: c.met, compliance: c.resolved ? c.met / c.resolved : null, mttr: mttrHours(v) });
          });
          return {
            columns: [
              { key: 'group', label: g === 'priority' ? D.slaCompliance.cols.priority : g === 'coverage' ? D.slaCompliance.cols.coverage : C.month, type: g === 'month' ? 'month' : 'text' },
              { key: 'tickets', label: C.serviceTickets, type: 'number', total: 'sum' },
              { key: 'resolved', label: C.resolved, type: 'number', total: 'sum' },
              { key: 'compliance', label: D.slaCompliance.cols.compliance, type: 'pct', total: ratio('met', 'resolved') },
              { key: 'mttr', label: D.slaCompliance.cols.mttr, type: 'hours', total: weighted('mttr', 'resolved') },
              { key: 'met', label: R.sla.cols.met, type: 'number', total: 'sum', optional: true },
            ],
            rows: g === 'month' ? rows.sort((a, b) => s(a.group).localeCompare(s(b.group))) : rows,
          };
        },
        kpis: [
          { label: D.slaCompliance.tiles.sla, fmt: 'pct', value: ratio('met', 'resolved'), hint: D.slaCompliance.hint },
          { label: D.slaCompliance.tiles.mttr, fmt: 'hours', value: weighted('mttr', 'resolved'), better: 'down', hint: D.kpiSummary.definitions.mttr },
          { label: C.serviceTickets, fmt: 'number', value: sumOf('tickets'), better: 'none' },
          { label: C.resolved, fmt: 'number', value: sumOf('resolved') },
        ],
        chart: (f) => (!f.group || f.group === 'month' ? { type: 'line', title: R.sla.chartTrend, x: 'group', y: 'compliance', fmt: 'pct' } : { type: 'hbar', title: D.slaCompliance.chart, x: 'group', y: 'compliance', fmt: 'pct' }),
      },
    ],
  },
  {
    id: 'service-quality',
    title: R.quality.title,
    group: 'service',
    icon: 'heart-pulse',
    fr: ['FR-091', 'FR-086'],
    description: R.quality.description,
    needs: ['tickets'],
    views: [
      {
        id: 'engineer',
        label: R.quality.views.engineer,
        filters: { date: 'past', division: true },
        dateLabel: D.engineerProductivity.dateLabel,
        compute: (ds, f) => {
          const ts = applyFilters(ds.get('tickets'), f, { date: ticketDate });
          const visits = ds.get('serviceVisits');
          return {
            columns: [
              { key: 'engineer', label: C.serviceEngineer },
              { key: 'tickets', label: C.serviceTickets, type: 'number', total: 'sum' },
              { key: 'resolved', label: C.resolved, type: 'number', total: 'sum' },
              { key: 'mttr', label: D.engineerProductivity.cols.mttr, type: 'hours', total: weighted('mttr', 'resolved') },
              { key: 'ftfr', label: D.engineerProductivity.cols.ftfr, type: 'pct', total: ratio('fixed', 'site') },
              { key: 'repeats', label: D.engineerProductivity.cols.repeats, type: 'number', total: 'sum' },
              { key: 'csat', label: D.engineerProductivity.cols.csat, type: 'number', total: weighted('csat', 'ratings') },
              { key: 'visits', label: D.engineerProductivity.cols.visits, type: 'number', total: 'sum', optional: true },
              { key: 'fixed', label: R.quality.cols.fixed, type: 'number', total: 'sum', optional: true },
              { key: 'site', label: R.quality.cols.site, type: 'number', total: 'sum', optional: true },
              { key: 'ratings', label: R.quality.cols.ratings, type: 'number', total: 'sum', optional: true },
            ],
            rows: [...groupBy(ts.filter((t) => t.assigneeId), (t) => s(t.assigneeId)).entries()]
              .map(([e, v]) => {
                const c = csat(v);
                const fx = fixCounts(v, visits);
                return row(e, { engineer: empName(ds, e), tickets: v.length, resolved: v.filter(isResolvedTicket).length, visits: visits.filter((x) => x.engineerId === e && v.some((t) => t.id === x.ticketId)).length, mttr: mttrHours(v), fixed: fx.fixed, site: fx.site, ftfr: fx.site ? fx.fixed / fx.site : null, repeats: v.filter((t) => t.repeatOfId).length, csat: c.avg, ratings: c.count });
              })
              .sort((a, b) => n(b.resolved) - n(a.resolved)),
          };
        },
        kpis: [
          { label: C.resolved, fmt: 'number', value: sumOf('resolved') },
          { label: D.engineerProductivity.cols.mttr, fmt: 'hours', value: weighted('mttr', 'resolved'), better: 'down', hint: D.kpiSummary.definitions.mttr },
          { label: D.engineerProductivity.cols.ftfr, fmt: 'pct', value: ratio('fixed', 'site'), hint: D.kpiSummary.definitions.ftfr },
          { label: D.csat.tiles.avg, fmt: 'rating', value: weighted('csat', 'ratings'), hint: D.kpiSummary.definitions.csat },
          { label: D.engineerProductivity.cols.repeats, fmt: 'number', value: sumOf('repeats'), better: 'down' },
        ],
        chart: { type: 'hbar', title: D.engineerProductivity.chart, x: 'engineer', y: 'resolved', fmt: 'number', unit: D.engineerProductivity.unit },
      },
      {
        id: 'month',
        label: R.quality.views.month,
        filters: { date: 'past', division: true },
        dateLabel: D.firstTimeFix.dateLabel,
        compute: (ds, f) => {
          const ts = applyFilters(ds.get('tickets'), f, { date: ticketDate });
          const visits = ds.get('serviceVisits');
          return {
            columns: [
              { key: 'month', label: C.month, type: 'month' },
              { key: 'resolved', label: C.resolved, type: 'number', total: 'sum' },
              { key: 'mttr', label: D.engineerProductivity.cols.mttr, type: 'hours', total: weighted('mttr', 'resolved') },
              { key: 'ftfr', label: D.firstTimeFix.cols.ftfr, type: 'pct', total: ratio('fixed', 'site') },
              { key: 'reopened', label: D.firstTimeFix.cols.reopened, type: 'number', total: 'sum' },
              { key: 'avg', label: D.csat.cols.avg, type: 'number', total: weighted('avg', 'ratings') },
              { key: 'share4', label: D.csat.cols.share4, type: 'pct', total: ratio('rated4', 'ratings') },
              { key: 'ratings', label: D.csat.cols.ratings, type: 'number', total: 'sum', optional: true },
              { key: 'rated4', label: R.quality.cols.rated4, type: 'number', total: 'sum', optional: true },
              { key: 'fixed', label: R.quality.cols.fixed, type: 'number', total: 'sum', optional: true },
              { key: 'site', label: R.quality.cols.site, type: 'number', total: 'sum', optional: true },
              { key: 'low', label: D.csat.cols.low, type: 'number', total: 'sum', optional: true, link: () => list('tickets') },
            ],
            rows: [...groupBy(ts, (t) => monthKey(t.reportedAt)).entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => {
                const c = csat(v);
                const fx = fixCounts(v, visits);
                return row(k, { month: k, resolved: v.filter(isResolvedTicket).length, mttr: mttrHours(v), fixed: fx.fixed, site: fx.site, ftfr: fx.site ? fx.fixed / fx.site : null, reopened: v.filter((t) => n(t.reopenCount) > 0).length, ratings: c.count, avg: c.avg, rated4: v.filter((t) => n(t.rating) >= 4).length, share4: c.count ? v.filter((t) => n(t.rating) >= 4).length / c.count : null, low: v.filter((t) => n(t.rating) >= 1 && n(t.rating) <= 2).length });
              }),
          };
        },
        kpis: [
          { label: C.resolved, fmt: 'number', value: sumOf('resolved') },
          { label: D.engineerProductivity.cols.mttr, fmt: 'hours', value: weighted('mttr', 'resolved'), better: 'down' },
          { label: D.firstTimeFix.tile, fmt: 'pct', value: ratio('fixed', 'site') },
          { label: D.csat.tiles.avg, fmt: 'rating', value: weighted('avg', 'ratings') },
          { label: D.csat.tiles.share4, fmt: 'pct', value: ratio('rated4', 'ratings') },
        ],
        chart: { type: 'line', title: D.firstTimeFix.chart, x: 'month', y: 'ftfr', fmt: 'pct' },
      },
    ],
  },
  {
    id: 'machine-reliability',
    title: R.reliability.title,
    group: 'service',
    icon: 'hourglass',
    fr: ['FR-091', 'FR-087'],
    description: R.reliability.description,
    needs: ['tickets'],
    views: [
      {
        id: 'downtime',
        label: R.reliability.views.downtime,
        filters: { date: 'past', division: true },
        dateLabel: D.machineDowntime.dateLabel,
        compute: (ds, f, ctx) => {
          const ts = applyFilters(ds.get('tickets').filter((t) => t.ticketType === 'breakdown' && t.machineId), f, { date: ticketDate });
          const machines = ds.get('machines');
          return {
            columns: [
              { key: 'machine', label: C.machine, link: peek('machines') },
              { key: 'model', label: C.model },
              { key: 'customer', label: C.customer },
              { key: 'breakdowns', label: C.breakdowns, type: 'number', total: 'sum' },
              { key: 'hours', label: D.machineDowntime.cols.hours, type: 'hours', total: 'sum' },
              { key: 'open', label: D.machineDowntime.cols.open, type: 'number', total: 'sum' },
            ],
            rows: [...groupBy(ts, (t) => s(t.machineId)).entries()]
              .map(([mid, v]) => {
                const hours = v.reduce((t, x) => t + Math.max(0, hoursBetween(x.reportedAt, s(x.resolvedAt) || new Date(ctx.nowMs).toISOString()) - n(x.pausedMinutes) / 60), 0);
                const m = machines.find((x) => x.id === mid);
                return row(mid, { id: mid, machine: m ? s(m.serialNo) : mid, model: s(m?.model), customer: ds.name('customers', m?.customerId ?? v[0].customerId), breakdowns: v.length, hours: Math.round(hours * 10) / 10, open: v.filter(isOpenTicket).length });
              })
              .sort((a, b) => n(b.hours) - n(a.hours)),
          };
        },
        kpis: [
          { label: R.reliability.kpis.machines, fmt: 'number', value: count, better: 'none' },
          { label: C.breakdowns, fmt: 'number', value: sumOf('breakdowns'), better: 'down' },
          { label: R.reliability.kpis.downtime, fmt: 'hours', value: sumOf('hours'), better: 'down' },
          { label: D.machineDowntime.cols.open, fmt: 'number', value: sumOf('open'), better: 'down' },
        ],
        chart: { type: 'hbar', title: D.machineDowntime.chart, x: 'machine', y: 'hours', fmt: 'hours', sumOthers: true },
      },
      {
        id: 'mtbf',
        label: R.reliability.views.mtbf,
        filters: { date: 'past', division: true },
        dateLabel: D.mtbf.dateLabel,
        compute: (ds, f, ctx) => {
          const from = f.from ?? '2000-01-01';
          const to = f.to ?? ctx.today;
          return {
            columns: [
              { key: 'model', label: C.model },
              { key: 'machines', label: C.machines, type: 'number', total: 'sum' },
              { key: 'breakdowns', label: C.breakdowns, type: 'number', total: 'sum' },
              { key: 'mtbf', label: D.mtbf.cols.mtbf, type: 'days', total: ratio('machineDays', 'breakdowns') },
              { key: 'machineDays', label: R.reliability.cols.machineDays, type: 'number', total: 'sum', optional: true },
            ],
            rows: mtbfByModel(applyFilters(ds.get('machines'), f), ds.get('tickets'), from, to)
              .map((g) => row(g.model, { model: g.model, machines: g.machines, breakdowns: g.breakdowns, machineDays: g.machineDays, mtbf: g.mtbfDays }))
              .sort((a, b) => n(a.mtbf) - n(b.mtbf)),
          };
        },
        kpis: [
          { label: R.reliability.kpis.models, fmt: 'number', value: count, better: 'none' },
          { label: C.machines, fmt: 'number', value: sumOf('machines'), better: 'none' },
          { label: C.breakdowns, fmt: 'number', value: sumOf('breakdowns'), better: 'down' },
          { label: D.mtbf.cols.mtbf, fmt: 'days', value: ratio('machineDays', 'breakdowns'), hint: R.reliability.mtbfHint },
        ],
        chart: { type: 'hbar', title: D.mtbf.chart, x: 'model', y: 'mtbf', fmt: 'days' },
      },
      {
        id: 'repeats',
        label: R.reliability.views.repeats,
        filters: { date: 'past', division: true },
        dateLabel: D.repeatComplaints.dateLabel,
        compute: (ds, f) => {
          const reps = applyFilters(ds.get('tickets'), f, { date: ticketDate }).filter((t) => t.repeatOfId);
          const rows = reps.map((t) => row(t.id, { id: t.id, customer: ds.name('customers', t.customerId), category: label('complaintCategory', t.category), repeatOf: s(t.repeatOfId), rootCause: s(t.rootCause), status: t.status }));
          return {
            columns: [
              { key: 'id', label: C.serviceTicket, link: peek('tickets') },
              { key: 'customer', label: C.customer },
              { key: 'category', label: D.repeatComplaints.cols.category },
              { key: 'repeatOf', label: D.repeatComplaints.cols.repeatOf, link: peek('tickets', 'repeatOf') },
              { key: 'rootCause', label: D.repeatComplaints.cols.rootCause },
              { key: 'status', label: C.status, type: 'status', master: 'ticketStatus' },
            ],
            rows,
            points: [...groupBy(rows, (r) => s(r.category)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.length })),
          };
        },
        kpis: [
          { label: R.reliability.kpis.repeats, fmt: 'number', value: count, better: 'down', hint: D.kpiSummary.definitions.repeat(30) },
          { label: R.reliability.kpis.stillOpen, fmt: 'number', value: countIf((r) => !['resolved', 'closed', 'customer_confirmation'].includes(s(r.status))), better: 'down' },
          { label: R.reliability.kpis.noRoot, fmt: 'number', value: countIf((r) => !s(r.rootCause)), better: 'down' },
        ],
        chart: { type: 'donut', title: D.repeatComplaints.chart, x: 'category', y: 'id', fmt: 'number', unit: D.repeatComplaints.unit },
      },
    ],
  },
  {
    id: 'pm-compliance',
    title: D.pmCompliance.title,
    group: 'service',
    icon: 'calendar-check',
    fr: ['FR-091', 'FR-085'],
    description: R.pm.description,
    needs: ['pmVisits'],
    views: [
      {
        id: 'pm',
        label: D.pmCompliance.title,
        filters: { date: 'past', division: true },
        dateLabel: D.pmCompliance.dateLabel,
        compute: (ds, f, ctx) => {
          const pm = applyFilters(ds.get('pmVisits'), f, { date: 'dueDate' }).filter((v) => dayOf(v.dueDate) <= ctx.today);
          return {
            columns: [
              { key: 'month', label: D.pmCompliance.cols.month, type: 'month', link: () => ROUTES.pmSchedule },
              { key: 'due', label: D.pmCompliance.cols.due, type: 'number', total: 'sum' },
              { key: 'onTime', label: D.pmCompliance.cols.onTime, type: 'number', total: 'sum' },
              { key: 'late', label: D.pmCompliance.cols.late, type: 'number', total: 'sum' },
              { key: 'missed', label: D.pmCompliance.cols.missed, type: 'number', total: 'sum' },
              { key: 'compliance', label: D.pmCompliance.cols.compliance, type: 'pct', total: ratio('onTime', 'due') },
            ],
            rows: [...groupBy(pm, (v) => monthKey(v.dueDate)).entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => {
                const c = pmCounts(v, ctx.today);
                return row(k, { month: k, due: c.due, onTime: c.onTime, late: v.filter((x) => x.status === 'done' && s(x.completedAt) && dayOf(x.completedAt) > dayOf(x.dueDate)).length, missed: v.filter((x) => x.status === 'missed' || x.status === 'overdue').length, compliance: c.due ? c.onTime / c.due : null });
              }),
          };
        },
        kpis: [
          { label: D.pmCompliance.cols.due, fmt: 'number', value: sumOf('due'), better: 'none' },
          { label: D.pmCompliance.cols.onTime, fmt: 'number', value: sumOf('onTime') },
          { label: D.pmCompliance.tile, fmt: 'pct', value: ratio('onTime', 'due'), hint: D.kpiSummary.definitions.pm },
          { label: D.pmCompliance.cols.missed, fmt: 'number', value: sumOf('missed'), better: 'down' },
        ],
        chart: { type: 'line', title: D.pmCompliance.chart, x: 'month', y: 'compliance', fmt: 'pct' },
      },
    ],
  },
];
