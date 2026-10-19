/** FR-074 installed base, FR-091 service, FR-113 field force reports. */
import { L } from '../../../constants/labels';
import { ROUTES } from '../../../constants/routes';
import { coverageFor } from '../../lookups';
import { ageingBuckets, amcRenewalRate, csat, dayOf, firstTimeFix, hoursBetween, isOpenTicket, isResolvedTicket, mtbfByModel, mttrHours, ms, pmCompliance, repeatRate, slaCompliance } from '../kpis';
import { applyFilters, empName, groupBy, label, list, monthKey, n, pctOf, peek, s, top } from '../helpers';
import type { ReportDef, ReportRow } from '../types';

const D = L.reports.defs;
const C = L.reports.cols;
const G = L.reports.groupBy;
const row = (key: string, o: Record<string, unknown>): ReportRow => ({ _key: key, ...o });
const ticketDate = 'reportedAt';

export const operationsReports: ReportDef[] = [
  // ---------------------------------------------------------------- FR-074 installed base
  {
    id: 'amc-status',
    title: D.amcStatus.title,
    group: 'installed-base',
    fr: ['FR-074', 'FR-072'],
    description: D.amcStatus.description,
    needs: ['amcContracts'],
    filters: { date: 'past', division: true, owner: true },
    dateLabel: D.amcStatus.dateLabel,
    compute: (ds, f) => {
      const cs = applyFilters(ds.get('amcContracts'), f, { date: 'endDate', owner: 'ownerId' });
      const rows = [...groupBy(cs, (c) => s(c.status)).entries()].map(([st, v]) => row(st, { status: st, contracts: v.length, value: v.reduce((t, c) => t + n(c.value), 0), amc: v.filter((c) => c.contractType === 'amc').length, cmc: v.filter((c) => c.contractType === 'cmc').length }));
      return {
        columns: [
          { key: 'status', label: C.status, type: 'status', master: 'amcStatus', link: () => list('amcContracts') },
          { key: 'contracts', label: D.amcStatus.cols.contracts, type: 'number' },
          { key: 'amc', label: D.amcStatus.cols.amc, type: 'number' },
          { key: 'cmc', label: D.amcStatus.cols.cmc, type: 'number' },
          { key: 'value', label: C.value, type: 'money' },
        ],
        rows: rows.sort((a, b) => n(b.contracts) - n(a.contracts)),
        chart: { polarity: 'neutral', label: D.amcStatus.chart, unit: D.amcStatus.unit, data: rows.map((r) => ({ key: r._key, label: label('amcStatus', r.status), value: n(r.contracts) })) },
        kpis: [{ label: D.amcStatus.tile, value: `pct:${amcRenewalRate(cs) ?? ''}`, hint: D.amcStatus.hint }],
      };
    },
  },
  {
    id: 'machines-without-contract',
    title: D.machinesWithoutContract.title,
    group: 'installed-base',
    fr: ['FR-074', 'FR-072'],
    description: D.machinesWithoutContract.description,
    needs: ['machines'],
    filters: { division: true },
    compute: (ds, f, ctx) => {
      const ms_ = applyFilters(ds.get('machines').filter((m) => m.status !== 'scrapped'), f).filter((m) => coverageFor(m.id, ctx.today) === 'none');
      const rows = ms_.map((m) => row(m.id, { id: m.id, serial: s(m.serialNo), model: s(m.model) || ds.name('products', m.productId), customer: ds.name('customers', m.customerId), installDate: m.installDate, ageYears: Math.round(((ms(ctx.today) - ms(dayOf(m.installDate))) / (365 * 86_400_000)) * 10) / 10 }));
      return {
        columns: [
          { key: 'serial', label: C.serialNumber, link: peek('machines') },
          { key: 'model', label: C.model },
          { key: 'customer', label: C.customer },
          { key: 'installDate', label: C.installationDate, type: 'date' },
          { key: 'ageYears', label: D.machinesWithoutContract.cols.ageYears, type: 'number' },
        ],
        rows: rows.sort((a, b) => n(a.ageYears) - n(b.ageYears)),
        chart: { polarity: 'lower', label: D.machinesWithoutContract.chart, unit: D.machinesWithoutContract.unit, data: top([...groupBy(rows, (r) => s(r.model)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.length }))) },
        kpis: [{ label: D.machinesWithoutContract.tile, value: L.reports.common.ofTotal(rows.length, ds.get('machines').filter((m) => m.status !== 'scrapped').length) }],
      };
    },
  },
  {
    id: 'installed-base-by-model',
    title: D.installedBase.title,
    group: 'installed-base',
    fr: ['FR-074'],
    description: D.installedBase.description,
    needs: ['machines'],
    filters: { division: true },
    groupOptions: [
      { value: 'model', label: G.model },
      { value: 'region', label: G.region },
      { value: 'coverage', label: G.coverage },
    ],
    compute: (ds, f, ctx) => {
      const ms_ = applyFilters(ds.get('machines').filter((m) => m.status !== 'scrapped'), f);
      const custState = new Map(ds.get('customers').map((c) => [c.id, label('state', c.billingState)]));
      const g = f.group ?? 'model';
      const keyOf = (m: Record<string, unknown>) => (g === 'region' ? custState.get(s(m.customerId)) ?? L.reports.common.unknown : g === 'coverage' ? label('coverage', coverageFor(s(m.id), ctx.today)) : s(m.model) || ds.name('products', m.productId));
      const rows = [...groupBy(ms_, keyOf).entries()].map(([k, v]) => row(k, { group: k, machines: v.length, customers: new Set(v.map((m) => s(m.customerId))).size, newThisYear: v.filter((m) => dayOf(m.installDate) >= `${ctx.today.slice(0, 4)}-01-01`).length }));
      return {
        columns: [
          { key: 'group', label: g === 'region' ? D.installedBase.cols.region : g === 'coverage' ? D.installedBase.cols.coverage : C.model, link: () => list('machines') },
          { key: 'machines', label: C.machines, type: 'number' },
          { key: 'customers', label: D.installedBase.cols.customers, type: 'number' },
          { key: 'newThisYear', label: D.installedBase.cols.newThisYear, type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.machines) - n(a.machines)),
        chart: { polarity: 'neutral', label: D.installedBase.chart, unit: D.installedBase.unit, data: top(rows.map((r) => ({ key: r._key, label: s(r.group), value: n(r.machines) })), 12) },
        kpis: [{ label: D.installedBase.tile, value: String(ms_.length) }],
      };
    },
  },

  // ---------------------------------------------------------------- FR-091 service
  {
    id: 'open-tickets',
    title: D.openTickets.title,
    group: 'service',
    fr: ['FR-091'],
    description: D.openTickets.description,
    needs: ['tickets'],
    filters: { division: true, owner: true },
    compute: (ds, f, ctx) => {
      const open = applyFilters(ds.get('tickets').filter(isOpenTicket), f, { owner: 'assigneeId' });
      const rows = open.map((t) => row(t.id, { id: t.id, customer: ds.name('customers', t.customerId), priority: t.priority, status: t.status, engineer: empName(ds, t.assigneeId), reported: t.reportedAt, ageDays: Math.floor((ctx.nowMs - ms(t.reportedAt)) / 86_400_000), breached: t.slaBreached ? D.openTickets.breached : s(t.resolutionDueAt) && ms(t.resolutionDueAt) < ctx.nowMs ? D.openTickets.breached : D.openTickets.onTrack }));
      return {
        columns: [
          { key: 'id', label: C.serviceTicket, link: peek('tickets') },
          { key: 'customer', label: C.customer },
          { key: 'priority', label: D.openTickets.cols.priority, type: 'status', master: 'ticketPriority' },
          { key: 'status', label: C.status, type: 'status', master: 'ticketStatus' },
          { key: 'engineer', label: C.serviceEngineer },
          { key: 'reported', label: D.openTickets.cols.reported, type: 'date' },
          { key: 'ageDays', label: C.ageDays, type: 'number' },
          { key: 'breached', label: D.openTickets.cols.sla },
        ],
        rows: rows.sort((a, b) => n(b.ageDays) - n(a.ageDays)),
        chart: { polarity: 'ageing', label: D.openTickets.chart, unit: D.openTickets.unit, data: ageingBuckets(open, ticketDate, ctx.nowMs).map((b) => ({ key: b.key, label: b.label, value: b.count })) },
        kpis: [
          { label: D.openTickets.tiles.open, value: String(open.length) },
          { label: D.openTickets.tiles.breached, value: String(rows.filter((r) => r.breached === D.openTickets.breached).length) },
        ],
      };
    },
  },
  {
    id: 'sla-compliance',
    title: D.slaCompliance.title,
    group: 'service',
    fr: ['FR-091', 'FR-083'],
    description: D.slaCompliance.description,
    needs: ['tickets'],
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
      const rows = [...groupBy(ts, (t) => (g === 'priority' ? label('ticketPriority', t.priority) : g === 'coverage' ? label('coverage', t.coverage) : monthKey(t.reportedAt))).entries()].map(([k, v]) => row(k, { group: k, tickets: v.length, resolved: v.filter(isResolvedTicket).length, compliance: slaCompliance(v), mttr: mttrHours(v) }));
      const sorted = g === 'month' ? rows.sort((a, b) => s(a.group).localeCompare(s(b.group))) : rows;
      return {
        columns: [
          { key: 'group', label: g === 'priority' ? D.slaCompliance.cols.priority : g === 'coverage' ? D.slaCompliance.cols.coverage : C.month },
          { key: 'tickets', label: C.serviceTickets, type: 'number' },
          { key: 'resolved', label: C.resolved, type: 'number' },
          { key: 'compliance', label: D.slaCompliance.cols.compliance, type: 'pct' },
          { key: 'mttr', label: D.slaCompliance.cols.mttr, type: 'hours' },
        ],
        rows: sorted,
        chart: { polarity: 'higher', label: D.slaCompliance.chart, unit: '%', data: sorted.filter((r) => r.compliance !== null).map((r) => ({ key: r._key, label: s(r.group), value: Math.round(n(r.compliance) * 100) })) },
        kpis: [
          { label: D.slaCompliance.tiles.sla, value: `pct:${slaCompliance(ts) ?? ''}`, hint: D.slaCompliance.hint },
          { label: D.slaCompliance.tiles.mttr, value: `hours:${mttrHours(ts) ?? ''}` },
        ],
      };
    },
  },
  {
    id: 'engineer-productivity',
    title: D.engineerProductivity.title,
    group: 'service',
    fr: ['FR-091'],
    description: D.engineerProductivity.description,
    needs: ['tickets'],
    filters: { date: 'past', division: true },
    dateLabel: D.engineerProductivity.dateLabel,
    compute: (ds, f) => {
      const ts = applyFilters(ds.get('tickets'), f, { date: ticketDate });
      const visits = ds.get('serviceVisits');
      const rows = [...groupBy(ts.filter((t) => t.assigneeId), (t) => s(t.assigneeId)).entries()].map(([e, v]) => {
        const c = csat(v);
        return row(e, { engineer: empName(ds, e), tickets: v.length, resolved: v.filter(isResolvedTicket).length, visits: visits.filter((x) => x.engineerId === e && v.some((t) => t.id === x.ticketId)).length, mttr: mttrHours(v), ftfr: firstTimeFix(v, visits), repeats: v.filter((t) => t.repeatOfId).length, csat: c.avg });
      });
      return {
        columns: [
          { key: 'engineer', label: C.serviceEngineer },
          { key: 'tickets', label: C.serviceTickets, type: 'number' },
          { key: 'resolved', label: C.resolved, type: 'number' },
          { key: 'visits', label: D.engineerProductivity.cols.visits, type: 'number' },
          { key: 'mttr', label: D.engineerProductivity.cols.mttr, type: 'hours' },
          { key: 'ftfr', label: D.engineerProductivity.cols.ftfr, type: 'pct' },
          { key: 'repeats', label: D.engineerProductivity.cols.repeats, type: 'number' },
          { key: 'csat', label: D.engineerProductivity.cols.csat, type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.resolved) - n(a.resolved)),
        chart: { polarity: 'higher', label: D.engineerProductivity.chart, unit: D.engineerProductivity.unit, data: rows.map((r) => ({ key: r._key, label: s(r.engineer), value: n(r.resolved) })) },
      };
    },
  },
  {
    id: 'first-time-fix',
    title: D.firstTimeFix.title,
    group: 'service',
    fr: ['FR-091'],
    description: D.firstTimeFix.description,
    needs: ['tickets', 'serviceVisits'],
    filters: { date: 'past', division: true },
    dateLabel: D.firstTimeFix.dateLabel,
    compute: (ds, f) => {
      const ts = applyFilters(ds.get('tickets'), f, { date: ticketDate });
      const visits = ds.get('serviceVisits');
      const rows = [...groupBy(ts, (t) => monthKey(t.reportedAt)).entries()].sort().map(([k, v]) => row(k, { month: k, resolved: v.filter(isResolvedTicket).length, ftfr: firstTimeFix(v, visits), reopened: v.filter((t) => n(t.reopenCount) > 0).length }));
      return {
        columns: [
          { key: 'month', label: C.month },
          { key: 'resolved', label: C.resolved, type: 'number' },
          { key: 'ftfr', label: D.firstTimeFix.cols.ftfr, type: 'pct' },
          { key: 'reopened', label: D.firstTimeFix.cols.reopened, type: 'number' },
        ],
        rows,
        chart: { polarity: 'higher', label: D.firstTimeFix.chart, unit: '%', data: rows.filter((r) => r.ftfr !== null).map((r) => ({ key: r._key, label: s(r.month), value: Math.round(n(r.ftfr) * 100) })) },
        kpis: [{ label: D.firstTimeFix.tile, value: `pct:${firstTimeFix(ts, visits) ?? ''}` }],
      };
    },
  },
  {
    id: 'machine-downtime',
    title: D.machineDowntime.title,
    group: 'service',
    fr: ['FR-091'],
    description: D.machineDowntime.description,
    needs: ['tickets'],
    filters: { date: 'past', division: true },
    dateLabel: D.machineDowntime.dateLabel,
    compute: (ds, f, ctx) => {
      const ts = applyFilters(ds.get('tickets').filter((t) => t.ticketType === 'breakdown' && t.machineId), f, { date: ticketDate });
      const rows = [...groupBy(ts, (t) => s(t.machineId)).entries()].map(([mid, v]) => {
        const hours = v.reduce((t, x) => t + Math.max(0, hoursBetween(x.reportedAt, s(x.resolvedAt) || new Date(ctx.nowMs).toISOString()) - n(x.pausedMinutes) / 60), 0);
        const m = ds.get('machines').find((x) => x.id === mid);
        return row(mid, { id: mid, machine: m ? s(m.serialNo) : mid, model: s(m?.model), customer: ds.name('customers', m?.customerId ?? v[0].customerId), breakdowns: v.length, hours: Math.round(hours * 10) / 10, open: v.filter(isOpenTicket).length });
      });
      return {
        columns: [
          { key: 'machine', label: C.machine, link: peek('machines') },
          { key: 'model', label: C.model },
          { key: 'customer', label: C.customer },
          { key: 'breakdowns', label: C.breakdowns, type: 'number' },
          { key: 'hours', label: D.machineDowntime.cols.hours, type: 'hours' },
          { key: 'open', label: D.machineDowntime.cols.open, type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.hours) - n(a.hours)),
        chart: { polarity: 'lower', label: D.machineDowntime.chart, unit: 'h', data: top(rows.map((r) => ({ key: r._key, label: s(r.machine), value: n(r.hours) }))) },
      };
    },
  },
  {
    id: 'repeat-complaints',
    title: D.repeatComplaints.title,
    group: 'service',
    fr: ['FR-091', 'FR-087'],
    description: D.repeatComplaints.description,
    needs: ['tickets'],
    filters: { date: 'past', division: true },
    dateLabel: D.repeatComplaints.dateLabel,
    compute: (ds, f) => {
      const ts = applyFilters(ds.get('tickets'), f, { date: ticketDate });
      const reps = ts.filter((t) => t.repeatOfId);
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
        chart: { polarity: 'lower', label: D.repeatComplaints.chart, unit: D.repeatComplaints.unit, data: [...groupBy(rows, (r) => s(r.category)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.length })) },
        kpis: [{ label: D.repeatComplaints.tile, value: `pct:${repeatRate(ts) ?? ''}` }],
      };
    },
  },
  {
    id: 'mtbf-by-model',
    title: D.mtbf.title,
    group: 'service',
    fr: ['FR-091'],
    description: D.mtbf.description,
    needs: ['machines', 'tickets'],
    filters: { date: 'past', division: true },
    dateLabel: D.mtbf.dateLabel,
    compute: (ds, f, ctx) => {
      const from = f.from ?? '2000-01-01';
      const to = f.to ?? ctx.today;
      const rows = mtbfByModel(applyFilters(ds.get('machines'), f), ds.get('tickets'), from, to).map((g) => row(g.model, { model: g.model, machines: g.machines, breakdowns: g.breakdowns, mtbf: g.mtbfDays }));
      return {
        columns: [
          { key: 'model', label: C.model },
          { key: 'machines', label: C.machines, type: 'number' },
          { key: 'breakdowns', label: C.breakdowns, type: 'number' },
          { key: 'mtbf', label: D.mtbf.cols.mtbf, type: 'days' },
        ],
        rows: rows.sort((a, b) => n(a.mtbf) - n(b.mtbf)),
        chart: { polarity: 'higher', label: D.mtbf.chart, unit: D.mtbf.unit, data: rows.filter((r) => r.mtbf !== null).map((r) => ({ key: r._key, label: s(r.model), value: Math.round(n(r.mtbf)) })) },
      };
    },
  },
  {
    id: 'pm-compliance',
    title: D.pmCompliance.title,
    group: 'service',
    fr: ['FR-091', 'FR-085'],
    description: D.pmCompliance.description,
    needs: ['pmVisits'],
    filters: { date: 'past', division: true },
    dateLabel: D.pmCompliance.dateLabel,
    compute: (ds, f, ctx) => {
      const pm = applyFilters(ds.get('pmVisits'), f, { date: 'dueDate' }).filter((v) => dayOf(v.dueDate) <= ctx.today);
      const rows = [...groupBy(pm, (v) => monthKey(v.dueDate)).entries()].sort().map(([k, v]) => row(k, { month: k, due: v.length, onTime: v.filter((x) => x.status === 'done' && (!s(x.completedAt) || dayOf(x.completedAt) <= dayOf(x.dueDate))).length, late: v.filter((x) => x.status === 'done' && s(x.completedAt) && dayOf(x.completedAt) > dayOf(x.dueDate)).length, missed: v.filter((x) => x.status === 'missed' || x.status === 'overdue').length, compliance: pmCompliance(v, ctx.today) }));
      return {
        columns: [
          { key: 'month', label: D.pmCompliance.cols.month, link: () => ROUTES.pmSchedule },
          { key: 'due', label: D.pmCompliance.cols.due, type: 'number' },
          { key: 'onTime', label: D.pmCompliance.cols.onTime, type: 'number' },
          { key: 'late', label: D.pmCompliance.cols.late, type: 'number' },
          { key: 'missed', label: D.pmCompliance.cols.missed, type: 'number' },
          { key: 'compliance', label: D.pmCompliance.cols.compliance, type: 'pct' },
        ],
        rows,
        chart: { polarity: 'higher', label: D.pmCompliance.chart, unit: '%', data: rows.filter((r) => r.compliance !== null).map((r) => ({ key: r._key, label: s(r.month), value: Math.round(n(r.compliance) * 100) })) },
        kpis: [{ label: D.pmCompliance.tile, value: `pct:${pmCompliance(pm, ctx.today) ?? ''}` }],
      };
    },
  },
  {
    id: 'csat',
    title: D.csat.title,
    group: 'service',
    fr: ['FR-091', 'FR-086'],
    description: D.csat.description,
    needs: ['tickets'],
    filters: { date: 'past', division: true },
    dateLabel: D.csat.dateLabel,
    compute: (ds, f) => {
      const ts = applyFilters(ds.get('tickets'), f, { date: ticketDate });
      const rows = [...groupBy(ts.filter((t) => n(t.rating) > 0), (t) => monthKey(t.reportedAt)).entries()].sort().map(([k, v]) => {
        const c = csat(v);
        return row(k, { month: k, ratings: c.count, avg: c.avg, share4: c.share4plus, low: v.filter((t) => n(t.rating) <= 2).length });
      });
      const all = csat(ts);
      return {
        columns: [
          { key: 'month', label: C.month },
          { key: 'ratings', label: D.csat.cols.ratings, type: 'number' },
          { key: 'avg', label: D.csat.cols.avg, type: 'number' },
          { key: 'share4', label: D.csat.cols.share4, type: 'pct' },
          { key: 'low', label: D.csat.cols.low, type: 'number', link: () => list('tickets') },
        ],
        rows,
        chart: { polarity: 'higher', label: D.csat.chart, unit: D.csat.unit, data: rows.map((r) => ({ key: r._key, label: s(r.month), value: Math.round(n(r.avg) * 10) })) },
        kpis: [
          { label: D.csat.tiles.avg, value: all.avg === null ? '' : all.avg.toFixed(2) },
          { label: D.csat.tiles.share4, value: `pct:${all.share4plus ?? ''}` },
        ],
      };
    },
  },

  // ---------------------------------------------------------------- FR-113 field force
  {
    id: 'attendance-daily',
    title: D.attendanceDaily.title,
    group: 'field-force',
    fr: ['FR-113'],
    description: D.attendanceDaily.description,
    needs: ['attendance'],
    filters: { date: 'past', owner: true },
    dateLabel: D.attendanceDaily.dateLabel,
    compute: (ds, f) => {
      const at = applyFilters(ds.get('attendance'), f, { date: 'date', owner: 'employeeId' });
      const rows = [...groupBy(at, (a) => dayOf(a.date)).entries()].sort().reverse().map(([d, v]) => row(d, { date: d, present: v.filter((a) => a.status === 'present').length, halfDay: v.filter((a) => a.status === 'half_day').length, onTour: v.filter((a) => a.status === 'on_tour').length, leave: v.filter((a) => a.status === 'leave').length, absent: v.filter((a) => a.status === 'absent').length, late: v.filter((a) => n(a.lateByMin) > 0).length }));
      return {
        columns: [
          { key: 'date', label: C.date, type: 'date', link: () => ROUTES.teamAttendance },
          { key: 'present', label: D.attendanceDaily.cols.present, type: 'number' },
          { key: 'halfDay', label: D.attendanceDaily.cols.halfDay, type: 'number' },
          { key: 'onTour', label: D.attendanceDaily.cols.onTour, type: 'number' },
          { key: 'leave', label: D.attendanceDaily.cols.leave, type: 'number' },
          { key: 'absent', label: D.attendanceDaily.cols.absent, type: 'number' },
          { key: 'late', label: D.attendanceDaily.cols.late, type: 'number' },
        ],
        rows,
        chart: { polarity: 'lower', label: D.attendanceDaily.chart, unit: D.attendanceDaily.unit, data: [...rows].reverse().slice(-20).map((r) => ({ key: r._key, label: s(r.date).slice(5), value: n(r.late) })) },
      };
    },
  },
  {
    id: 'attendance-monthly',
    title: D.attendanceMonthly.title,
    group: 'field-force',
    fr: ['FR-113'],
    description: D.attendanceMonthly.description,
    needs: ['attendance'],
    filters: { date: 'past', owner: true },
    dateLabel: D.attendanceMonthly.dateLabel,
    compute: (ds, f) => {
      const at = applyFilters(ds.get('attendance'), f, { date: 'date', owner: 'employeeId' });
      const rows = [...groupBy(at, (a) => s(a.employeeId)).entries()].map(([e, v]) => row(e, { employee: empName(ds, e), present: v.filter((a) => a.status === 'present' || a.status === 'on_tour').length, halfDay: v.filter((a) => a.status === 'half_day').length, leave: v.filter((a) => a.status === 'leave').length, lateDays: v.filter((a) => n(a.lateByMin) > 0).length, hours: Math.round(v.reduce((t, a) => t + n(a.workMinutes), 0) / 6) / 10, km: Math.round(v.reduce((t, a) => t + n(a.distanceKm), 0)) }));
      return {
        columns: [
          { key: 'employee', label: C.user },
          { key: 'present', label: D.attendanceMonthly.cols.present, type: 'number' },
          { key: 'halfDay', label: D.attendanceMonthly.cols.halfDay, type: 'number' },
          { key: 'leave', label: D.attendanceMonthly.cols.leave, type: 'number' },
          { key: 'lateDays', label: D.attendanceMonthly.cols.lateDays, type: 'number' },
          { key: 'hours', label: D.attendanceMonthly.cols.hours, type: 'number' },
          { key: 'km', label: D.attendanceMonthly.cols.km, type: 'number' },
        ],
        rows: rows.sort((a, b) => s(a.employee).localeCompare(s(b.employee))),
        chart: { polarity: 'lower', label: D.attendanceMonthly.chart, unit: D.attendanceMonthly.unit, data: top(rows.map((r) => ({ key: r._key, label: s(r.employee), value: n(r.lateDays) }))) },
      };
    },
  },
  {
    id: 'field-visits',
    title: D.fieldVisits.title,
    group: 'field-force',
    fr: ['FR-113', 'FR-108'],
    description: D.fieldVisits.description,
    needs: ['fieldVisits'],
    filters: { date: 'past', owner: true },
    dateLabel: D.fieldVisits.dateLabel,
    compute: (ds, f) => {
      const vs = applyFilters(ds.get('fieldVisits'), f, { date: 'plannedFor', owner: 'employeeId' });
      const rows = [...groupBy(vs, (v) => s(v.employeeId)).entries()].map(([e, v]) => {
        const done = v.filter((x) => x.status === 'completed');
        return row(e, { employee: empName(ds, e), planned: v.length, completed: done.length, adherence: pctOf(done.length, v.length), prospecting: done.filter((x) => x.purpose === 'prospecting').length, followUp: done.filter((x) => x.purpose === 'follow_up').length, demo: done.filter((x) => x.purpose === 'demo').length, service: done.filter((x) => x.purpose === 'service').length, collection: done.filter((x) => x.purpose === 'collection').length });
      });
      return {
        columns: [
          { key: 'employee', label: C.user, link: () => ROUTES.fieldVisits },
          { key: 'planned', label: D.fieldVisits.cols.planned, type: 'number' },
          { key: 'completed', label: D.fieldVisits.cols.completed, type: 'number' },
          { key: 'adherence', label: D.fieldVisits.cols.adherence, type: 'pct' },
          { key: 'prospecting', label: D.fieldVisits.cols.prospecting, type: 'number' },
          { key: 'followUp', label: D.fieldVisits.cols.followUp, type: 'number' },
          { key: 'demo', label: D.fieldVisits.cols.demo, type: 'number' },
          { key: 'service', label: D.fieldVisits.cols.service, type: 'number' },
          { key: 'collection', label: D.fieldVisits.cols.collection, type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.completed) - n(a.completed)),
        chart: { polarity: 'higher', label: D.fieldVisits.chart, unit: D.fieldVisits.unit, data: top(rows.map((r) => ({ key: r._key, label: s(r.employee), value: n(r.completed) }))) },
      };
    },
  },
  {
    id: 'attendance-exceptions',
    title: D.attendanceExceptions.title,
    group: 'field-force',
    fr: ['FR-113'],
    description: D.attendanceExceptions.description,
    needs: ['attendance'],
    filters: { date: 'past', owner: true },
    dateLabel: D.attendanceExceptions.dateLabel,
    compute: (ds, f, ctx) => {
      const at = applyFilters(ds.get('attendance'), f, { date: 'date', owner: 'employeeId' });
      const rows: ReportRow[] = [];
      at.forEach((a) => {
        const add = (kind: string, detail: string) => rows.push(row(`${a.id}:${kind}`, { id: a.id, date: a.date, employee: empName(ds, a.employeeId), exception: kind, detail }));
        const X = D.attendanceExceptions;
        if (n(a.lateByMin) > 0) add(X.kinds.late, X.details.late(n(a.lateByMin)));
        if (n(a.earlyByMin) > 0) add(X.kinds.early, X.details.early(n(a.earlyByMin)));
        if (s(a.checkInAt) && !s(a.checkOutAt) && dayOf(a.date) < ctx.today) add(X.kinds.noCheckOut, X.details.noCheckOut);
        if (a.mockLocation) add(X.kinds.mock, X.details.mock);
        if (a.status === 'absent') add(X.kinds.absent, X.details.absent);
      });
      return {
        columns: [
          { key: 'date', label: C.date, type: 'date', link: () => ROUTES.exceptionDashboard },
          { key: 'employee', label: C.user },
          { key: 'exception', label: D.attendanceExceptions.cols.exception },
          { key: 'detail', label: D.attendanceExceptions.cols.detail },
        ],
        rows: rows.sort((a, b) => s(b.date).localeCompare(s(a.date))),
        chart: { polarity: 'lower', label: D.attendanceExceptions.chart, unit: D.attendanceExceptions.unit, data: [...groupBy(rows, (r) => s(r.exception)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.length })) },
      };
    },
  },
];

