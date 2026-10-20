/** LEAD-14 / LEAD-12 lead reports: conversion, speed (ageing · first response · follow-ups), lost leads, executive performance, referrals. */
import { L } from '../../../constants/labels';
import { ROUTES } from '../../../constants/routes';
import { getPolicies } from '../../policies';
import { dayOf, inRange, isBooked, isOpenOpp, leadResponseHours, ms, sum, winRate } from '../kpis';
import { applyFilters, empName, groupBy, label, list, monthKey, n, peek, row, s } from '../helpers';
import { count, countIf, maxOf, mean, ratio, sum as sumOf, weighted } from '../metrics';
import { periodStartFor } from '../../../domain/modules/field/rules';
import { achievement, type AchievementRow } from '../../field/field';
import type { ReportColumn, ReportDef, ReportRow } from '../types';

const D = L.reports.defs;
const C = L.reports.cols;
const G = L.reports.groupBy;
const R = L.reports.rep;
const M = L.reports.more;
const OPEN = ['new', 'contacted', 'nurture'];
const isQualified = (l: Record<string, unknown>) => l.status === 'qualified' || !!l.opportunityId;

export const leadReports: ReportDef[] = [
  // ---------------------------------------------------------------- conversion
  {
    id: 'lead-conversion',
    title: D.leadConversion.title,
    group: 'leads',
    icon: 'send',
    fr: ['FR-026'],
    description: R.leadConversion.description,
    needs: ['leads'],
    views: [
      {
        id: 'conversion',
        label: D.leadConversion.title,
        filters: { date: 'past', division: true, owner: true },
        dateLabel: D.leadConversion.dateLabel,
        groupOptions: [
          { value: 'month', label: G.month },
          { value: 'owner', label: G.owner },
          { value: 'product', label: G.productType },
          { value: 'source', label: G.source },
          { value: 'campaign', label: G.campaign },
        ],
        compute: (ds, f) => {
          const leads = applyFilters(ds.get('leads'), f, { date: 'createdAt', owner: 'ownerId' });
          const g = f.group ?? 'month';
          const keyOf = (l: Record<string, unknown>) => (g === 'owner' ? empName(ds, l.ownerId) : g === 'product' ? label('productType', l.productType) : g === 'source' ? label('leadSource', l.sourceId) : g === 'campaign' ? s(l.campaign) || D.leadConversion.noCampaign : monthKey(l.createdAt));
          const rows = [...groupBy(leads, keyOf).entries()].map(([k, ls]) => row(k, { group: k, leads: ls.length, qualified: ls.filter(isQualified).length, open: ls.filter((l) => OPEN.includes(s(l.status))).length, disqualified: ls.filter((l) => l.status === 'disqualified').length }));
          const withRate = rows.map((r) => ({ ...r, conversion: n(r.leads) ? n(r.qualified) / n(r.leads) : null }) as ReportRow);
          return {
            columns: [
              { key: 'group', label: g === 'month' ? C.month : g === 'owner' ? C.salesExecutive : g === 'product' ? D.leadConversion.cols.productType : g === 'source' ? D.leadConversion.cols.source : D.leadConversion.cols.campaign, type: g === 'month' ? 'month' : 'text' },
              { key: 'leads', label: C.leads, type: 'number', total: 'sum' },
              { key: 'qualified', label: D.leadConversion.cols.qualified, type: 'number', total: 'sum' },
              { key: 'open', label: D.leadConversion.cols.open, type: 'number', total: 'sum' },
              { key: 'disqualified', label: D.leadConversion.cols.disqualified, type: 'number', total: 'sum' },
              { key: 'conversion', label: D.leadConversion.cols.conversion, type: 'pct', total: ratio('qualified', 'leads') },
            ],
            rows: g === 'month' ? withRate.sort((a, b) => s(a.group).localeCompare(s(b.group))) : withRate.sort((a, b) => n(b.leads) - n(a.leads)),
          };
        },
        kpis: [
          { label: D.leadConversion.tiles.leads, fmt: 'number', value: sumOf('leads') },
          { label: D.leadConversion.cols.qualified, fmt: 'number', value: sumOf('qualified') },
          { label: D.leadConversion.tiles.conversion, fmt: 'pct', value: ratio('qualified', 'leads'), hint: D.kpiSummary.definitions.leadConversion },
          { label: D.leadConversion.cols.disqualified, fmt: 'number', value: sumOf('disqualified'), better: 'down' },
        ],
        chart: (f) => (!f.group || f.group === 'month' ? { type: 'combo', title: M.leadComboTitle, x: 'group', y: 'leads', fmt: 'number', unit: 'leads', y2: 'conversion', fmt2: 'pct', label: M.leadsBars, label2: M.conversionLine } : { type: 'hbar', title: R.leadConversion.chartBy(f.group), x: 'group', y: 'conversion', fmt: 'pct' }),
      },
    ],
  },

  // ---------------------------------------------------------------- speed
  {
    id: 'lead-speed',
    title: R.leadSpeed.title,
    group: 'leads',
    icon: 'timer',
    fr: ['FR-026', 'FR-020', 'FR-021'],
    description: R.leadSpeed.description,
    needs: ['leads'],
    views: [
      {
        id: 'ageing',
        label: R.leadSpeed.views.ageing,
        filters: { division: true, owner: true },
        compute: (ds, f, ctx) => {
          const open = applyFilters(ds.get('leads').filter((l) => OPEN.includes(s(l.status))), f, { owner: 'ownerId' });
          const rows = open
            .map((l) => row(l.id, { id: l.id, lead: ds.name('leads', l.id), status: l.status, owner: empName(ds, l.ownerId), created: dayOf(l.createdAt), age: Math.floor((ctx.nowMs - ms(l.createdAt)) / 86_400_000), nextFollowUp: l.nextFollowUpAt }))
            .sort((a, b) => n(b.age) - n(a.age));
          const buckets = [
            [L.reports.ageing.leads.d0_7, 0, 7],
            [L.reports.ageing.leads.d8_15, 8, 15],
            [L.reports.ageing.leads.d16_30, 16, 30],
            [L.reports.ageing.leads.d31_60, 31, 60],
            [L.reports.ageing.leads.d60, 61, Infinity],
          ] as const;
          return {
            columns: [
              { key: 'lead', label: D.leadAgeing.cols.lead, link: peek('leads') },
              { key: 'status', label: L.reports.cols.status, type: 'status', master: 'leadStatus' },
              { key: 'owner', label: D.leadAgeing.cols.owner },
              { key: 'created', label: D.leadAgeing.cols.created, type: 'date' },
              { key: 'age', label: C.ageDays, type: 'number' },
              { key: 'nextFollowUp', label: D.leadAgeing.cols.nextFollowUp, type: 'date' },
            ],
            rows,
            points: buckets.map(([lb, a, b]) => ({ key: lb, label: lb, value: rows.filter((r) => n(r.age) >= a && n(r.age) <= b).length })),
          };
        },
        kpis: [
          { label: R.leadSpeed.kpis.open, fmt: 'number', value: count, better: 'down' },
          { label: R.leadSpeed.kpis.avgAge, fmt: 'days', value: mean('age'), better: 'down' },
          { label: R.leadSpeed.kpis.over30, fmt: 'number', value: countIf((r) => n(r.age) > 30), better: 'down' },
          { label: R.leadSpeed.kpis.oldest, fmt: 'days', value: maxOf('age'), better: 'down' },
        ],
        chart: { type: 'bar', title: D.leadAgeing.chart, x: 'lead', y: 'age', fmt: 'number', unit: D.leadAgeing.unit, keepOrder: true },
      },
      {
        id: 'response',
        label: R.leadSpeed.views.response,
        filters: { date: 'past', division: true },
        dateLabel: D.leadFirstResponse.dateLabel,
        compute: (ds, f) => {
          const leads = applyFilters(ds.get('leads'), f, { date: 'createdAt' });
          const sla = getPolicies().leadFirstContactHours;
          return {
            columns: [
              { key: 'owner', label: C.salesExecutive },
              { key: 'leads', label: C.leads, type: 'number', total: 'sum' },
              { key: 'contacted', label: D.leadFirstResponse.cols.contacted, type: 'number', total: 'sum' },
              { key: 'avgHours', label: D.leadFirstResponse.cols.avgHours, type: 'hours', total: weighted('avgHours', 'contacted') },
              { key: 'outsideSla', label: D.leadFirstResponse.cols.outsideSla(sla), type: 'number', total: 'sum' },
              { key: 'notAttended', label: D.leadFirstResponse.cols.notAttended, type: 'number', total: 'sum', link: () => ROUTES.notAttendedLeads },
            ],
            rows: [...groupBy(leads, (l) => s(l.ownerId)).entries()]
              .map(([oid, ls]) => {
                const contacted = ls.filter((l) => s(l.firstContactAt));
                const late = contacted.filter((l) => (ms(l.firstContactAt) - ms(l.createdAt)) / 3_600_000 > sla).length + ls.filter((l) => l.notAttended).length;
                return row(oid, { owner: empName(ds, oid), leads: ls.length, contacted: contacted.length, avgHours: leadResponseHours(ls), outsideSla: late, notAttended: ls.filter((l) => l.notAttended).length });
              })
              .sort((a, b) => n(b.avgHours) - n(a.avgHours)),
          };
        },
        kpis: [
          { label: D.leadFirstResponse.tile, fmt: 'hours', value: weighted('avgHours', 'contacted'), better: 'down', hint: D.leadFirstResponse.hint(getPolicies().leadFirstContactHours) },
          { label: R.leadSpeed.kpis.contactedShare, fmt: 'pct', value: ratio('contacted', 'leads') },
          { label: D.leadFirstResponse.cols.outsideSla(getPolicies().leadFirstContactHours), fmt: 'number', value: sumOf('outsideSla'), better: 'down' },
          { label: D.leadFirstResponse.cols.notAttended, fmt: 'number', value: sumOf('notAttended'), better: 'down' },
        ],
        chart: { type: 'hbar', title: D.leadFirstResponse.chart, x: 'owner', y: 'avgHours', fmt: 'hours' },
      },
      {
        id: 'followups',
        label: R.leadSpeed.views.followups,
        filters: { division: true, owner: true },
        compute: (ds, f, ctx) => {
          const leads = ds.get('leads').filter((l) => OPEN.includes(s(l.status)));
          const opps = ds.get('opportunities').filter(isOpenOpp);
          const due = applyFilters([...leads.map((r) => ({ ...r, _res: 'leads' })), ...opps.map((r) => ({ ...r, _res: 'opportunities' }))], f, { owner: 'ownerId' }).filter((r) => s(r.nextFollowUpAt) && dayOf(r.nextFollowUpAt) <= ctx.today);
          const rows = due
            .map((r) => row(`${r._res}:${r.id}`, { id: r.id, res: r._res === 'leads' ? D.pendingFollowups.lead : D.pendingFollowups.opportunity, record: ds.name(String(r._res), r.id), owner: empName(ds, r.ownerId), due: r.nextFollowUpAt, overdueDays: Math.round((ms(ctx.today) - ms(dayOf(r.nextFollowUpAt))) / 86_400_000), _link: String(r._res) }))
            .sort((a, b) => n(b.overdueDays) - n(a.overdueDays));
          return {
            columns: [
              { key: 'record', label: D.pendingFollowups.cols.record, link: (r) => peek(String(r._link))(r) },
              { key: 'res', label: D.pendingFollowups.cols.type },
              { key: 'owner', label: C.owner },
              { key: 'due', label: D.pendingFollowups.cols.due, type: 'date' },
              { key: 'overdueDays', label: D.pendingFollowups.cols.overdueDays, type: 'number' },
            ],
            rows,
            points: [...groupBy(rows, (r) => s(r.owner)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.length })),
          };
        },
        kpis: [
          { label: R.leadSpeed.kpis.pending, fmt: 'number', value: count, better: 'down' },
          { label: R.leadSpeed.kpis.overdue7, fmt: 'number', value: countIf((r) => n(r.overdueDays) > 7), better: 'down' },
          { label: R.leadSpeed.kpis.avgOverdue, fmt: 'days', value: mean('overdueDays'), better: 'down' },
        ],
        chart: { type: 'hbar', title: D.pendingFollowups.chart, x: 'owner', y: 'overdueDays', fmt: 'number', unit: D.pendingFollowups.unit },
      },
    ],
  },

  // ---------------------------------------------------------------- lost leads
  {
    id: 'lost-leads',
    title: D.lostLeads.title,
    group: 'leads',
    icon: 'search-x',
    fr: ['FR-026', 'FR-023'],
    description: R.lostLeads.description,
    needs: ['leads'],
    views: [
      {
        id: 'reasons',
        label: D.lostLeads.title,
        filters: { date: 'past', division: true, owner: true },
        dateLabel: D.lostLeads.dateLabel,
        compute: (ds, f) => {
          const lost = applyFilters(ds.get('leads').filter((l) => l.status === 'disqualified'), f, { date: 'createdAt', owner: 'ownerId' });
          return {
            columns: [
              { key: 'reason', label: D.lostLeads.cols.reason, link: () => list('leads', { view: 'v_leads_all' }) },
              { key: 'leads', label: C.leads, type: 'number', total: 'sum' },
              { key: 'share', label: D.lostLeads.cols.share, type: 'pct', total: 'sum' },
              { key: 'budget', label: D.lostLeads.cols.budget, type: 'money', total: 'sum' },
            ],
            rows: [...groupBy(lost, (l) => label('lostReason', l.disqualifyReason)).entries()]
              .map(([k, ls]) => row(k, { reason: k, leads: ls.length, share: lost.length ? ls.length / lost.length : null, budget: sum(ls, 'budget') }))
              .sort((a, b) => n(b.leads) - n(a.leads)),
          };
        },
        kpis: [
          { label: R.lostLeads.kpis.lost, fmt: 'number', value: sumOf('leads'), better: 'down' },
          { label: R.lostLeads.kpis.budget, fmt: 'money', value: sumOf('budget'), better: 'down', hint: R.lostLeads.budgetHint },
          { label: R.lostLeads.kpis.reasons, fmt: 'number', value: count, better: 'none' },
        ],
        chart: { type: 'donut', title: D.lostLeads.chart, x: 'reason', y: 'leads', fmt: 'number', unit: D.lostLeads.unit },
      },
    ],
  },

  // ---------------------------------------------------------------- executive performance
  {
    id: 'exec-performance',
    title: D.execPerformance.title,
    group: 'leads',
    icon: 'medal',
    fr: ['FR-026', 'FR-059'],
    description: R.exec.description,
    needs: ['leads'],
    views: [
      {
        id: 'performance',
        label: D.execPerformance.title,
        filters: { date: 'past', division: true },
        dateLabel: D.execPerformance.dateLabel,
        compute: (ds, f) => {
          const leads = applyFilters(ds.get('leads'), f, { date: 'createdAt' });
          const opps = applyFilters(ds.get('opportunities'), f);
          const orders = applyFilters(ds.get('salesOrders').filter(isBooked), f, { date: 'orderDate' });
          const acts = ds.get('activities').filter((a) => inRange(a.at, f.from, f.to));
          const owners = new Set([...leads, ...orders].map((r) => s(r.ownerId)).filter(Boolean));
          return {
            columns: [
              { key: 'owner', label: C.salesExecutive },
              { key: 'leads', label: C.leads, type: 'number', total: 'sum' },
              { key: 'conversion', label: D.execPerformance.cols.conversion, type: 'pct', total: ratio('qualified', 'leads') },
              { key: 'winRate', label: D.execPerformance.cols.winRate, type: 'pct' },
              { key: 'orders', label: C.salesOrders, type: 'number', total: 'sum' },
              { key: 'booked', label: C.bookedValue, type: 'money', total: 'sum' },
              { key: 'activities', label: D.execPerformance.cols.activities, type: 'number', total: 'sum' },
              { key: 'qualified', label: D.leadConversion.cols.qualified, type: 'number', total: 'sum', optional: true },
            ],
            rows: [...owners]
              .map((o) => {
                const ls = leads.filter((l) => l.ownerId === o);
                const q = ls.filter(isQualified).length;
                const closed = opps.filter((x) => x.ownerId === o && ['won', 'lost'].includes(s(x.stage)) && inRange(x.wonAt || x.stageChangedAt || x.updatedAt, f.from, f.to));
                const mine = orders.filter((x) => x.ownerId === o);
                return row(o, { owner: empName(ds, o), leads: ls.length, qualified: q, conversion: ls.length ? q / ls.length : null, winRate: winRate(closed), orders: mine.length, booked: sum(mine, 'grandTotal'), activities: acts.filter((a) => a.byId === o).length });
              })
              .sort((a, b) => n(b.booked) - n(a.booked)),
          };
        },
        kpis: [
          { label: R.exec.kpis.booked, fmt: 'money', value: sumOf('booked') },
          { label: C.salesOrders, fmt: 'number', value: sumOf('orders') },
          { label: C.leads, fmt: 'number', value: sumOf('leads') },
          { label: D.execPerformance.cols.conversion, fmt: 'pct', value: ratio('qualified', 'leads') },
          { label: D.execPerformance.cols.activities, fmt: 'number', value: sumOf('activities') },
        ],
        chart: { type: 'hbar', title: D.execPerformance.chart, x: 'owner', y: 'booked', fmt: 'money' },
      },
      {
        id: 'target',
        label: M.target.view,
        filters: { division: true },
        dateLabel: M.target.dateLabel,
        compute: (_ds, f, ctx) => {
          // Targets are set per period, so this view always measures the current month (TGT-02).
          let found: AchievementRow[] = [];
          try {
            found = achievement(ctx.actor, 'month', periodStartFor('month', ctx.today));
          } catch {
            found = [];
          }
          const mine = found.filter((r) => r.target.metric === 'order_value' && r.target.scopeType === 'user' && (!f.division || r.target.divisionId === f.division));
          return {
            columns: [
              { key: 'owner', label: C.salesExecutive },
              { key: 'target', label: M.target.target, type: 'money', total: 'sum' },
              { key: 'booked', label: M.target.booked, type: 'money', total: 'sum' },
              { key: 'pct', label: M.target.pct, type: 'pct', total: ratio('booked', 'target') },
            ],
            rows: mine
              .map((r) => row(String(r.target.employeeId), { owner: _ds.name('employees', r.target.employeeId), target: Number(r.target.targetValue), booked: r.actual, pct: Number(r.target.targetValue) ? r.actual / Number(r.target.targetValue) : null }))
              .sort((a, b) => n(b.pct) - n(a.pct)),
          };
        },
        kpis: [
          { label: M.target.target, fmt: 'money', value: sumOf('target'), better: 'none' },
          { label: M.target.booked, fmt: 'money', value: sumOf('booked') },
          { label: M.target.pct, fmt: 'pct', value: ratio('booked', 'target') },
          { label: M.target.onTarget, fmt: 'number', value: countIf((r) => n(r.pct) >= 1) },
          { label: M.target.below, fmt: 'number', value: countIf((r) => n(r.pct) < 0.7), better: 'down' },
        ],
        chart: { type: 'bullet', title: M.target.chart, x: 'owner', y: 'booked', target: 'target', fmt: 'money' },
      },
    ],
  },

  // ---------------------------------------------------------------- referrals (LEAD-12 / D-5: a report, no own page)
  {
    id: 'referrals',
    title: D.referrals.title,
    group: 'leads',
    icon: 'gift',
    fr: ['FR-024', 'FR-026'],
    description: R.referrals.description,
    needs: ['leads'],
    views: [
      {
        id: 'referrals',
        label: D.referrals.title,
        filters: { date: 'past', division: true, owner: true },
        dateLabel: D.referrals.dateLabel,
        groupOptions: [
          { value: 'referrer', label: G.referrer },
          { value: 'type', label: G.referrerType },
        ],
        compute: (ds, f) => {
          const refs = applyFilters(ds.get('leads').filter((l) => l.sourceId === 'referral'), f, { date: 'createdAt', owner: 'ownerId' });
          const g = f.group ?? 'referrer';
          const referrerOf = (l: Record<string, unknown>) => (s(l.referrerEmployeeId) ? empName(ds, l.referrerEmployeeId) : s(l.referrerCustomerId) ? ds.name('customers', l.referrerCustomerId) : D.referrals.notRecorded);
          const converted = (ls: Record<string, unknown>[]) => ls.filter(isQualified).length;
          const columns: ReportColumn[] = [
            { key: 'referrer', label: g === 'type' ? D.referrals.cols.referrerType : D.referrals.cols.referrer, link: g === 'type' ? undefined : () => list('leads') },
            ...(g === 'type' ? [] : [{ key: 'referrerType', label: D.referrals.cols.referrerType, type: 'status' as const, master: 'referrerType' }]),
            { key: 'leads', label: C.leads, type: 'number', total: 'sum' },
            { key: 'converted', label: D.referrals.cols.converted, type: 'number', total: 'sum' },
            { key: 'open', label: D.referrals.cols.open, type: 'number', total: 'sum' },
            { key: 'conversion', label: D.referrals.cols.conversion, type: 'pct', total: ratio('converted', 'leads') },
          ];
          return {
            columns,
            rows: [...groupBy(refs, (l) => (g === 'type' ? s(l.referrerType) : `${s(l.referrerType)}|${referrerOf(l)}`)).entries()]
              .map(([k, ls]) => row(k, { referrer: g === 'type' ? label('referrerType', ls[0].referrerType) : referrerOf(ls[0]), referrerType: ls[0].referrerType, leads: ls.length, converted: converted(ls), open: ls.filter((l) => OPEN.includes(s(l.status))).length, conversion: ls.length ? converted(ls) / ls.length : null }))
              .sort((a, b) => n(b.leads) - n(a.leads)),
          };
        },
        kpis: [
          { label: D.referrals.tiles.leads, fmt: 'number', value: sumOf('leads') },
          { label: D.referrals.cols.converted, fmt: 'number', value: sumOf('converted') },
          { label: D.referrals.tiles.conversion, fmt: 'pct', value: ratio('converted', 'leads') },
          { label: D.referrals.cols.open, fmt: 'number', value: sumOf('open'), better: 'none' },
        ],
        chart: { type: 'hbar', title: D.referrals.chart, x: 'referrer', y: 'leads', fmt: 'number', unit: D.referrals.unit },
      },
    ],
  },
];
