/** FR-074 installed base, FR-091 service, FR-113 field force reports. */
import { coverageFor } from '../../lookups';
import { ageingBuckets, amcRenewalRate, csat, dayOf, firstTimeFix, hoursBetween, isOpenTicket, isResolvedTicket, mtbfByModel, mttrHours, ms, pmCompliance, repeatRate, slaCompliance } from '../kpis';
import { applyFilters, empName, groupBy, label, list, monthKey, n, pctOf, peek, s, top } from '../helpers';
import type { ReportDef, ReportRow } from '../types';

const row = (key: string, o: Record<string, unknown>): ReportRow => ({ _key: key, ...o });
const ticketDate = 'reportedAt';

export const operationsReports: ReportDef[] = [
  // ---------------------------------------------------------------- FR-074 installed base
  {
    id: 'amc-status',
    title: 'AMC / CMC status',
    group: 'installed',
    fr: ['FR-074', 'FR-072'],
    description: 'Contracts due for renewal, renewed, lost and expired, with renewal rate.',
    needs: ['amcContracts'],
    filters: { date: 'past', division: true, owner: true },
    dateLabel: 'Contract end date',
    compute: (ds, f) => {
      const cs = applyFilters(ds.get('amcContracts'), f, { date: 'endDate', owner: 'ownerId' });
      const rows = [...groupBy(cs, (c) => s(c.status)).entries()].map(([st, v]) => row(st, { status: st, contracts: v.length, value: v.reduce((t, c) => t + n(c.value), 0), amc: v.filter((c) => c.contractType === 'amc').length, cmc: v.filter((c) => c.contractType === 'cmc').length }));
      return {
        columns: [
          { key: 'status', label: 'Status', type: 'status', master: 'amcStatus', link: () => list('amcContracts') },
          { key: 'contracts', label: 'Contracts', type: 'number' },
          { key: 'amc', label: 'AMC', type: 'number' },
          { key: 'cmc', label: 'CMC', type: 'number' },
          { key: 'value', label: 'Value', type: 'money' },
        ],
        rows: rows.sort((a, b) => n(b.contracts) - n(a.contracts)),
        chart: { label: 'Contracts by status', unit: 'contracts', data: rows.map((r) => ({ key: r._key, label: label('amcStatus', r.status), value: n(r.contracts) })) },
        kpis: [{ label: 'AMC renewal rate', value: `pct:${amcRenewalRate(cs) ?? ''}`, hint: 'Renewed ÷ (renewed + lost + expired)' }],
      };
    },
  },
  {
    id: 'machines-without-contract',
    title: 'Machines without a contract',
    group: 'installed',
    fr: ['FR-074', 'FR-072'],
    description: 'Active machines with no warranty and no AMC/CMC today — the upsell list.',
    needs: ['machines'],
    filters: { division: true },
    compute: (ds, f, ctx) => {
      const ms_ = applyFilters(ds.get('machines').filter((m) => m.status !== 'scrapped'), f).filter((m) => coverageFor(m.id, ctx.today) === 'none');
      const rows = ms_.map((m) => row(m.id, { id: m.id, serial: s(m.serialNo), model: s(m.model) || ds.name('products', m.productId), customer: ds.name('customers', m.customerId), installDate: m.installDate, ageYears: Math.round(((ms(ctx.today) - ms(dayOf(m.installDate))) / (365 * 86_400_000)) * 10) / 10 }));
      return {
        columns: [
          { key: 'serial', label: 'Serial', link: peek('machines') },
          { key: 'model', label: 'Model' },
          { key: 'customer', label: 'Customer' },
          { key: 'installDate', label: 'Installed', type: 'date' },
          { key: 'ageYears', label: 'Age (years)', type: 'number' },
        ],
        rows: rows.sort((a, b) => n(a.ageYears) - n(b.ageYears)),
        chart: { label: 'Uncovered machines by model', unit: 'machines', data: top([...groupBy(rows, (r) => s(r.model)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.length }))) },
        kpis: [{ label: 'Machines without cover', value: `${rows.length} of ${ds.get('machines').filter((m) => m.status !== 'scrapped').length}` }],
      };
    },
  },
  {
    id: 'installed-base',
    title: 'Installed base',
    group: 'installed',
    fr: ['FR-074'],
    description: 'Machines in the field by model or region (customer billing state).',
    needs: ['machines'],
    filters: { division: true },
    groupOptions: [
      { value: 'model', label: 'By model' },
      { value: 'region', label: 'By region' },
      { value: 'coverage', label: 'By coverage today' },
    ],
    compute: (ds, f, ctx) => {
      const ms_ = applyFilters(ds.get('machines').filter((m) => m.status !== 'scrapped'), f);
      const custState = new Map(ds.get('customers').map((c) => [c.id, label('state', c.billingState)]));
      const g = f.group ?? 'model';
      const keyOf = (m: Record<string, unknown>) => (g === 'region' ? custState.get(s(m.customerId)) ?? 'Unknown' : g === 'coverage' ? label('coverage', coverageFor(s(m.id), ctx.today)) : s(m.model) || ds.name('products', m.productId));
      const rows = [...groupBy(ms_, keyOf).entries()].map(([k, v]) => row(k, { group: k, machines: v.length, customers: new Set(v.map((m) => s(m.customerId))).size, newThisYear: v.filter((m) => dayOf(m.installDate) >= `${ctx.today.slice(0, 4)}-01-01`).length }));
      return {
        columns: [
          { key: 'group', label: g === 'region' ? 'Region (state)' : g === 'coverage' ? 'Coverage' : 'Model', link: () => list('machines') },
          { key: 'machines', label: 'Machines', type: 'number' },
          { key: 'customers', label: 'Customers', type: 'number' },
          { key: 'newThisYear', label: 'Installed this year', type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.machines) - n(a.machines)),
        chart: { label: 'Machines', unit: 'machines', data: top(rows.map((r) => ({ key: r._key, label: s(r.group), value: n(r.machines) })), 12) },
        kpis: [{ label: 'Machines in the field', value: String(ms_.length) }],
      };
    },
  },

  // ---------------------------------------------------------------- FR-091 service
  {
    id: 'open-tickets',
    title: 'Open tickets and ageing',
    group: 'service',
    fr: ['FR-091'],
    description: 'Tickets not yet resolved, by age since they were reported.',
    needs: ['tickets'],
    filters: { division: true, owner: true },
    compute: (ds, f, ctx) => {
      const open = applyFilters(ds.get('tickets').filter(isOpenTicket), f, { owner: 'assigneeId' });
      const rows = open.map((t) => row(t.id, { id: t.id, customer: ds.name('customers', t.customerId), priority: t.priority, status: t.status, engineer: empName(ds, t.assigneeId), reported: t.reportedAt, ageDays: Math.floor((ctx.nowMs - ms(t.reportedAt)) / 86_400_000), breached: t.slaBreached ? 'Breached' : s(t.resolutionDueAt) && ms(t.resolutionDueAt) < ctx.nowMs ? 'Breached' : 'On track' }));
      return {
        columns: [
          { key: 'id', label: 'Ticket', link: peek('tickets') },
          { key: 'customer', label: 'Customer' },
          { key: 'priority', label: 'Priority', type: 'status', master: 'ticketPriority' },
          { key: 'status', label: 'Status', type: 'status', master: 'ticketStatus' },
          { key: 'engineer', label: 'Engineer' },
          { key: 'reported', label: 'Reported', type: 'date' },
          { key: 'ageDays', label: 'Age (days)', type: 'number' },
          { key: 'breached', label: 'SLA' },
        ],
        rows: rows.sort((a, b) => n(b.ageDays) - n(a.ageDays)),
        chart: { label: 'Open tickets by age', unit: 'tickets', data: ageingBuckets(open, ticketDate, ctx.nowMs).map((b) => ({ key: b.key, label: b.label, value: b.count })) },
        kpis: [
          { label: 'Open tickets', value: String(open.length) },
          { label: 'SLA breached', value: String(rows.filter((r) => r.breached === 'Breached').length) },
        ],
      };
    },
  },
  {
    id: 'sla-compliance',
    title: 'SLA compliance',
    group: 'service',
    fr: ['FR-091', 'FR-083'],
    description: 'Resolved tickets meeting response and resolution targets, by month or priority.',
    needs: ['tickets'],
    filters: { date: 'past', division: true },
    dateLabel: 'Reported',
    groupOptions: [
      { value: 'month', label: 'By month' },
      { value: 'priority', label: 'By priority' },
      { value: 'coverage', label: 'By coverage' },
    ],
    compute: (ds, f) => {
      const ts = applyFilters(ds.get('tickets'), f, { date: ticketDate });
      const g = f.group ?? 'month';
      const rows = [...groupBy(ts, (t) => (g === 'priority' ? label('ticketPriority', t.priority) : g === 'coverage' ? label('coverage', t.coverage) : monthKey(t.reportedAt))).entries()].map(([k, v]) => row(k, { group: k, tickets: v.length, resolved: v.filter(isResolvedTicket).length, compliance: slaCompliance(v), mttr: mttrHours(v) }));
      const sorted = g === 'month' ? rows.sort((a, b) => s(a.group).localeCompare(s(b.group))) : rows;
      return {
        columns: [
          { key: 'group', label: g === 'priority' ? 'Priority' : g === 'coverage' ? 'Coverage' : 'Month' },
          { key: 'tickets', label: 'Tickets', type: 'number' },
          { key: 'resolved', label: 'Resolved', type: 'number' },
          { key: 'compliance', label: 'SLA compliance', type: 'pct' },
          { key: 'mttr', label: 'MTTR', type: 'hours' },
        ],
        rows: sorted,
        chart: { label: 'SLA compliance %', unit: '%', data: sorted.filter((r) => r.compliance !== null).map((r) => ({ key: r._key, label: s(r.group), value: Math.round(n(r.compliance) * 100) })) },
        kpis: [
          { label: 'SLA compliance', value: `pct:${slaCompliance(ts) ?? ''}`, hint: 'Response and resolution on time' },
          { label: 'MTTR', value: `hours:${mttrHours(ts) ?? ''}` },
        ],
      };
    },
  },
  {
    id: 'engineer-productivity',
    title: 'Engineer productivity',
    group: 'service',
    fr: ['FR-091'],
    description: 'Per engineer: tickets resolved, visits, MTTR, first-time fix, repeats and CSAT.',
    needs: ['tickets'],
    filters: { date: 'past', division: true },
    dateLabel: 'Reported',
    compute: (ds, f) => {
      const ts = applyFilters(ds.get('tickets'), f, { date: ticketDate });
      const visits = ds.get('serviceVisits');
      const rows = [...groupBy(ts.filter((t) => t.assigneeId), (t) => s(t.assigneeId)).entries()].map(([e, v]) => {
        const c = csat(v);
        return row(e, { engineer: empName(ds, e), tickets: v.length, resolved: v.filter(isResolvedTicket).length, visits: visits.filter((x) => x.engineerId === e && v.some((t) => t.id === x.ticketId)).length, mttr: mttrHours(v), ftfr: firstTimeFix(v, visits), repeats: v.filter((t) => t.repeatOfId).length, csat: c.avg });
      });
      return {
        columns: [
          { key: 'engineer', label: 'Engineer' },
          { key: 'tickets', label: 'Tickets', type: 'number' },
          { key: 'resolved', label: 'Resolved', type: 'number' },
          { key: 'visits', label: 'Site visits', type: 'number' },
          { key: 'mttr', label: 'MTTR', type: 'hours' },
          { key: 'ftfr', label: 'First-time fix', type: 'pct' },
          { key: 'repeats', label: 'Repeats', type: 'number' },
          { key: 'csat', label: 'CSAT (1–5)', type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.resolved) - n(a.resolved)),
        chart: { label: 'Tickets resolved per engineer', unit: 'tickets', data: rows.map((r) => ({ key: r._key, label: s(r.engineer), value: n(r.resolved) })) },
      };
    },
  },
  {
    id: 'first-time-fix',
    title: 'First-time fix rate',
    group: 'service',
    fr: ['FR-091'],
    description: 'Resolved site-visit tickets fixed on the first visit and never re-opened, by month.',
    needs: ['tickets', 'serviceVisits'],
    filters: { date: 'past', division: true },
    dateLabel: 'Reported',
    compute: (ds, f) => {
      const ts = applyFilters(ds.get('tickets'), f, { date: ticketDate });
      const visits = ds.get('serviceVisits');
      const rows = [...groupBy(ts, (t) => monthKey(t.reportedAt)).entries()].sort().map(([k, v]) => row(k, { month: k, resolved: v.filter(isResolvedTicket).length, ftfr: firstTimeFix(v, visits), reopened: v.filter((t) => n(t.reopenCount) > 0).length }));
      return {
        columns: [
          { key: 'month', label: 'Month' },
          { key: 'resolved', label: 'Resolved', type: 'number' },
          { key: 'ftfr', label: 'First-time fix', type: 'pct' },
          { key: 'reopened', label: 'Re-opened', type: 'number' },
        ],
        rows,
        chart: { label: 'First-time fix %', unit: '%', data: rows.filter((r) => r.ftfr !== null).map((r) => ({ key: r._key, label: s(r.month), value: Math.round(n(r.ftfr) * 100) })) },
        kpis: [{ label: 'First-time fix rate', value: `pct:${firstTimeFix(ts, visits) ?? ''}` }],
      };
    },
  },
  {
    id: 'machine-downtime',
    title: 'Machine downtime',
    group: 'service',
    fr: ['FR-091'],
    description: 'Breakdown hours per machine (reported to resolved, or to now when still open).',
    needs: ['tickets'],
    filters: { date: 'past', division: true },
    dateLabel: 'Reported',
    compute: (ds, f, ctx) => {
      const ts = applyFilters(ds.get('tickets').filter((t) => t.ticketType === 'breakdown' && t.machineId), f, { date: ticketDate });
      const rows = [...groupBy(ts, (t) => s(t.machineId)).entries()].map(([mid, v]) => {
        const hours = v.reduce((t, x) => t + Math.max(0, hoursBetween(x.reportedAt, s(x.resolvedAt) || new Date(ctx.nowMs).toISOString()) - n(x.pausedMinutes) / 60), 0);
        const m = ds.get('machines').find((x) => x.id === mid);
        return row(mid, { id: mid, machine: m ? s(m.serialNo) : mid, model: s(m?.model), customer: ds.name('customers', m?.customerId ?? v[0].customerId), breakdowns: v.length, hours: Math.round(hours * 10) / 10, open: v.filter(isOpenTicket).length });
      });
      return {
        columns: [
          { key: 'machine', label: 'Machine', link: peek('machines') },
          { key: 'model', label: 'Model' },
          { key: 'customer', label: 'Customer' },
          { key: 'breakdowns', label: 'Breakdowns', type: 'number' },
          { key: 'hours', label: 'Downtime', type: 'hours' },
          { key: 'open', label: 'Still open', type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.hours) - n(a.hours)),
        chart: { label: 'Downtime hours (top 10 machines)', unit: 'h', data: top(rows.map((r) => ({ key: r._key, label: s(r.machine), value: n(r.hours) }))) },
      };
    },
  },
  {
    id: 'repeat-complaints',
    title: 'Repeat complaints',
    group: 'service',
    fr: ['FR-091', 'FR-087'],
    description: 'Tickets flagged as repeats (same machine and category within the policy window) with root cause.',
    needs: ['tickets'],
    filters: { date: 'past', division: true },
    dateLabel: 'Reported',
    compute: (ds, f) => {
      const ts = applyFilters(ds.get('tickets'), f, { date: ticketDate });
      const reps = ts.filter((t) => t.repeatOfId);
      const rows = reps.map((t) => row(t.id, { id: t.id, customer: ds.name('customers', t.customerId), category: label('complaintCategory', t.category), repeatOf: s(t.repeatOfId), rootCause: s(t.rootCause), status: t.status }));
      return {
        columns: [
          { key: 'id', label: 'Ticket', link: peek('tickets') },
          { key: 'customer', label: 'Customer' },
          { key: 'category', label: 'Category' },
          { key: 'repeatOf', label: 'Repeat of', link: peek('tickets', 'repeatOf') },
          { key: 'rootCause', label: 'Root cause' },
          { key: 'status', label: 'Status', type: 'status', master: 'ticketStatus' },
        ],
        rows,
        chart: { label: 'Repeats by category', unit: 'tickets', data: [...groupBy(rows, (r) => s(r.category)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.length })) },
        kpis: [{ label: 'Repeat complaint rate', value: `pct:${repeatRate(ts) ?? ''}` }],
      };
    },
  },
  {
    id: 'mtbf-by-model',
    title: 'Mean time between failures',
    group: 'service',
    fr: ['FR-091'],
    description: 'Machine-days in the window ÷ breakdown tickets, per model.',
    needs: ['machines', 'tickets'],
    filters: { date: 'past', division: true },
    dateLabel: 'Window',
    compute: (ds, f, ctx) => {
      const from = f.from ?? '2000-01-01';
      const to = f.to ?? ctx.today;
      const rows = mtbfByModel(applyFilters(ds.get('machines'), f), ds.get('tickets'), from, to).map((g) => row(g.model, { model: g.model, machines: g.machines, breakdowns: g.breakdowns, mtbf: g.mtbfDays }));
      return {
        columns: [
          { key: 'model', label: 'Model' },
          { key: 'machines', label: 'Machines', type: 'number' },
          { key: 'breakdowns', label: 'Breakdowns', type: 'number' },
          { key: 'mtbf', label: 'MTBF', type: 'days' },
        ],
        rows: rows.sort((a, b) => n(a.mtbf) - n(b.mtbf)),
        chart: { label: 'MTBF (days) by model', unit: 'days', data: rows.filter((r) => r.mtbf !== null).map((r) => ({ key: r._key, label: s(r.model), value: Math.round(n(r.mtbf)) })) },
      };
    },
  },
  {
    id: 'pm-compliance',
    title: 'PM compliance',
    group: 'service',
    fr: ['FR-091', 'FR-085'],
    description: 'Preventive visits done on time ÷ visits due, by month due.',
    needs: ['pmVisits'],
    filters: { date: 'past', division: true },
    dateLabel: 'Due date',
    compute: (ds, f, ctx) => {
      const pm = applyFilters(ds.get('pmVisits'), f, { date: 'dueDate' }).filter((v) => dayOf(v.dueDate) <= ctx.today);
      const rows = [...groupBy(pm, (v) => monthKey(v.dueDate)).entries()].sort().map(([k, v]) => row(k, { month: k, due: v.length, onTime: v.filter((x) => x.status === 'done' && (!s(x.completedAt) || dayOf(x.completedAt) <= dayOf(x.dueDate))).length, late: v.filter((x) => x.status === 'done' && s(x.completedAt) && dayOf(x.completedAt) > dayOf(x.dueDate)).length, missed: v.filter((x) => x.status === 'missed' || x.status === 'overdue').length, compliance: pmCompliance(v, ctx.today) }));
      return {
        columns: [
          { key: 'month', label: 'Month due', link: () => list('pmVisits') },
          { key: 'due', label: 'Due', type: 'number' },
          { key: 'onTime', label: 'Done on time', type: 'number' },
          { key: 'late', label: 'Done late', type: 'number' },
          { key: 'missed', label: 'Overdue / missed', type: 'number' },
          { key: 'compliance', label: 'PM compliance', type: 'pct' },
        ],
        rows,
        chart: { label: 'PM compliance %', unit: '%', data: rows.filter((r) => r.compliance !== null).map((r) => ({ key: r._key, label: s(r.month), value: Math.round(n(r.compliance) * 100) })) },
        kpis: [{ label: 'PM compliance', value: `pct:${pmCompliance(pm, ctx.today) ?? ''}` }],
      };
    },
  },
  {
    id: 'csat',
    title: 'Customer satisfaction (CSAT)',
    group: 'service',
    fr: ['FR-091', 'FR-086'],
    description: 'Average feedback rating and share of 4–5 ratings, by month; low ratings listed.',
    needs: ['tickets'],
    filters: { date: 'past', division: true },
    dateLabel: 'Reported',
    compute: (ds, f) => {
      const ts = applyFilters(ds.get('tickets'), f, { date: ticketDate });
      const rows = [...groupBy(ts.filter((t) => n(t.rating) > 0), (t) => monthKey(t.reportedAt)).entries()].sort().map(([k, v]) => {
        const c = csat(v);
        return row(k, { month: k, ratings: c.count, avg: c.avg, share4: c.share4plus, low: v.filter((t) => n(t.rating) <= 2).length });
      });
      const all = csat(ts);
      return {
        columns: [
          { key: 'month', label: 'Month' },
          { key: 'ratings', label: 'Ratings', type: 'number' },
          { key: 'avg', label: 'Average (1–5)', type: 'number' },
          { key: 'share4', label: 'Rated 4 or 5', type: 'pct' },
          { key: 'low', label: 'Low ratings (≤2)', type: 'number', link: () => list('tickets') },
        ],
        rows,
        chart: { label: 'Average rating by month (×10)', unit: 'points', data: rows.map((r) => ({ key: r._key, label: s(r.month), value: Math.round(n(r.avg) * 10) })) },
        kpis: [
          { label: 'Average rating', value: all.avg === null ? '' : all.avg.toFixed(2) },
          { label: 'Rated 4 or 5', value: `pct:${all.share4plus ?? ''}` },
        ],
      };
    },
  },

  // ---------------------------------------------------------------- FR-113 field force
  {
    id: 'attendance-daily',
    title: 'Daily attendance',
    group: 'field',
    fr: ['FR-113'],
    description: 'Present, half-day, on tour, leave, absent and late arrivals per day.',
    needs: ['attendance'],
    filters: { date: 'past', owner: true },
    dateLabel: 'Date',
    compute: (ds, f) => {
      const at = applyFilters(ds.get('attendance'), f, { date: 'date', owner: 'employeeId' });
      const rows = [...groupBy(at, (a) => dayOf(a.date)).entries()].sort().reverse().map(([d, v]) => row(d, { date: d, present: v.filter((a) => a.status === 'present').length, halfDay: v.filter((a) => a.status === 'half_day').length, onTour: v.filter((a) => a.status === 'on_tour').length, leave: v.filter((a) => a.status === 'leave').length, absent: v.filter((a) => a.status === 'absent').length, late: v.filter((a) => n(a.lateByMin) > 0).length }));
      return {
        columns: [
          { key: 'date', label: 'Date', type: 'date', link: () => '/attendance/team' },
          { key: 'present', label: 'Present', type: 'number' },
          { key: 'halfDay', label: 'Half-day', type: 'number' },
          { key: 'onTour', label: 'On tour', type: 'number' },
          { key: 'leave', label: 'Leave', type: 'number' },
          { key: 'absent', label: 'Absent', type: 'number' },
          { key: 'late', label: 'Late', type: 'number' },
        ],
        rows,
        chart: { label: 'Late arrivals per day', unit: 'people', data: [...rows].reverse().slice(-20).map((r) => ({ key: r._key, label: s(r.date).slice(5), value: n(r.late) })) },
      };
    },
  },
  {
    id: 'attendance-monthly',
    title: 'Monthly attendance by employee',
    group: 'field',
    fr: ['FR-113'],
    description: 'Days present, half-days, leave, late days and hours worked per employee in the period.',
    needs: ['attendance'],
    filters: { date: 'past', owner: true },
    dateLabel: 'Date',
    compute: (ds, f) => {
      const at = applyFilters(ds.get('attendance'), f, { date: 'date', owner: 'employeeId' });
      const rows = [...groupBy(at, (a) => s(a.employeeId)).entries()].map(([e, v]) => row(e, { employee: empName(ds, e), present: v.filter((a) => a.status === 'present' || a.status === 'on_tour').length, halfDay: v.filter((a) => a.status === 'half_day').length, leave: v.filter((a) => a.status === 'leave').length, lateDays: v.filter((a) => n(a.lateByMin) > 0).length, hours: Math.round(v.reduce((t, a) => t + n(a.workMinutes), 0) / 6) / 10, km: Math.round(v.reduce((t, a) => t + n(a.distanceKm), 0)) }));
      return {
        columns: [
          { key: 'employee', label: 'Employee' },
          { key: 'present', label: 'Days present', type: 'number' },
          { key: 'halfDay', label: 'Half-days', type: 'number' },
          { key: 'leave', label: 'Leave', type: 'number' },
          { key: 'lateDays', label: 'Late days', type: 'number' },
          { key: 'hours', label: 'Hours worked', type: 'number' },
          { key: 'km', label: 'Km travelled', type: 'number' },
        ],
        rows: rows.sort((a, b) => s(a.employee).localeCompare(s(b.employee))),
        chart: { label: 'Late days per employee', unit: 'days', data: top(rows.map((r) => ({ key: r._key, label: s(r.employee), value: n(r.lateDays) }))) },
      };
    },
  },
  {
    id: 'field-visits',
    title: 'Field visit report',
    group: 'field',
    fr: ['FR-113', 'FR-108'],
    description: 'Visits planned and completed per person, by purpose.',
    needs: ['fieldVisits'],
    filters: { date: 'past', owner: true },
    dateLabel: 'Visit date',
    compute: (ds, f) => {
      const vs = applyFilters(ds.get('fieldVisits'), f, { date: 'plannedFor', owner: 'employeeId' });
      const rows = [...groupBy(vs, (v) => s(v.employeeId)).entries()].map(([e, v]) => {
        const done = v.filter((x) => x.status === 'completed');
        return row(e, { employee: empName(ds, e), planned: v.length, completed: done.length, adherence: pctOf(done.length, v.length), prospecting: done.filter((x) => x.purpose === 'prospecting').length, followUp: done.filter((x) => x.purpose === 'follow_up').length, demo: done.filter((x) => x.purpose === 'demo').length, service: done.filter((x) => x.purpose === 'service').length, collection: done.filter((x) => x.purpose === 'collection').length });
      });
      return {
        columns: [
          { key: 'employee', label: 'Employee', link: () => list('fieldVisits') },
          { key: 'planned', label: 'Visits', type: 'number' },
          { key: 'completed', label: 'Completed', type: 'number' },
          { key: 'adherence', label: 'Completed %', type: 'pct' },
          { key: 'prospecting', label: 'Prospecting', type: 'number' },
          { key: 'followUp', label: 'Follow-up', type: 'number' },
          { key: 'demo', label: 'Demo', type: 'number' },
          { key: 'service', label: 'Service', type: 'number' },
          { key: 'collection', label: 'Collection', type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.completed) - n(a.completed)),
        chart: { label: 'Completed visits per person', unit: 'visits', data: top(rows.map((r) => ({ key: r._key, label: s(r.employee), value: n(r.completed) }))) },
      };
    },
  },
  {
    id: 'attendance-exceptions',
    title: 'Attendance exceptions',
    group: 'field',
    fr: ['FR-113'],
    description: 'Late check-ins, missing check-outs, mock locations and early exits in the period.',
    needs: ['attendance'],
    filters: { date: 'past', owner: true },
    dateLabel: 'Date',
    compute: (ds, f, ctx) => {
      const at = applyFilters(ds.get('attendance'), f, { date: 'date', owner: 'employeeId' });
      const rows: ReportRow[] = [];
      at.forEach((a) => {
        const add = (kind: string, detail: string) => rows.push(row(`${a.id}:${kind}`, { id: a.id, date: a.date, employee: empName(ds, a.employeeId), exception: kind, detail }));
        if (n(a.lateByMin) > 0) add('Late check-in', `${n(a.lateByMin)} min late`);
        if (n(a.earlyByMin) > 0) add('Early exit', `${n(a.earlyByMin)} min early`);
        if (s(a.checkInAt) && !s(a.checkOutAt) && dayOf(a.date) < ctx.today) add('No check-out', 'Checked in but never checked out');
        if (a.mockLocation) add('Mock location', 'Fake-GPS app detected');
        if (a.status === 'absent') add('Absent', 'No check-in, no leave');
      });
      return {
        columns: [
          { key: 'date', label: 'Date', type: 'date', link: () => '/attendance/exceptions' },
          { key: 'employee', label: 'Employee' },
          { key: 'exception', label: 'Exception' },
          { key: 'detail', label: 'Detail' },
        ],
        rows: rows.sort((a, b) => s(b.date).localeCompare(s(a.date))),
        chart: { label: 'Exceptions by type', unit: 'cases', data: [...groupBy(rows, (r) => s(r.exception)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.length })) },
      };
    },
  },
];

