/** SO-11 order reports: order value & sales performance, backlog & delays, payments & overdue ageing. */
import { L } from '../../../constants/labels';
import { AGEING, BACKLOG, dayOf, isBooked, ms, netValue, outstandingOf, sum, sumNet } from '../kpis';
import { applyFilters, empName, groupBy, label, list, monthKey, n, peek, row, s } from '../helpers';
import { count, mean, maxOf, ratio, sum as sumOf, sumIf } from '../metrics';
import type { ReportDef } from '../types';

const D = L.reports.defs;
const C = L.reports.cols;
const G = L.reports.groupBy;
const R = L.reports.rep;

export const orderReports: ReportDef[] = [
  {
    id: 'order-value',
    title: R.orderValue.title,
    group: 'sales-orders',
    icon: 'shopping-cart',
    fr: ['FR-059'],
    description: R.orderValue.description,
    needs: ['salesOrders'],
    views: [
      {
        id: 'value',
        label: R.orderValue.title,
        filters: { date: 'past', division: true, owner: true },
        dateLabel: D.orderValue.dateLabel,
        groupOptions: [
          { value: 'month', label: G.month },
          { value: 'owner', label: G.owner },
          { value: 'division', label: G.division },
          { value: 'kind', label: D.orderValue.machineVsConsumables },
        ],
        compute: (ds, f) => {
          const os = applyFilters(ds.get('salesOrders').filter(isBooked), f, { date: 'orderDate', owner: 'ownerId' });
          const g = f.group ?? 'month';
          const rows = [...groupBy(os, (o) => (g === 'division' ? label('division', o.divisionId) : g === 'kind' ? label('orderKind', o.orderKind) : g === 'owner' ? empName(ds, o.ownerId) : monthKey(o.orderDate))).entries()].map(([k, v]) => row(k, { group: k, orders: v.length, value: sumNet(v), gross: sum(v, 'grandTotal'), avg: v.length ? sumNet(v) / v.length : 0 }));
          return {
            columns: [
              { key: 'group', label: g === 'month' ? C.month : g === 'division' ? C.division : g === 'owner' ? C.salesExecutive : D.orderValue.cols.orderType, type: g === 'month' ? 'month' : 'text', link: () => list('salesOrders') },
              { key: 'orders', label: C.salesOrders, type: 'number', total: 'sum' },
              { key: 'value', label: D.orderValue.cols.value, type: 'money', total: 'sum' },
              { key: 'gross', label: D.orderValue.cols.gross, type: 'money', total: 'sum' },
              { key: 'avg', label: D.orderValue.cols.avg, type: 'money', total: ratio('value', 'orders') },
            ],
            rows: g === 'month' ? rows.sort((a, b) => s(a.group).localeCompare(s(b.group))) : rows.sort((a, b) => n(b.value) - n(a.value)),
          };
        },
        kpis: [
          { label: D.orderValue.tiles.booked, fmt: 'number', value: sumOf('orders') },
          { label: D.orderValue.tiles.value, fmt: 'money', value: sumOf('value') },
          { label: D.orderValue.cols.avg, fmt: 'money', value: ratio('value', 'orders') },
        ],
        chart: (f) => (!f.group || f.group === 'month' ? { type: 'area', title: R.orderValue.chartTrend, x: 'group', y: 'value', fmt: 'money' } : { type: 'hbar', title: R.orderValue.chartBy, x: 'group', y: 'value', fmt: 'money' }),
      },
    ],
  },
  {
    id: 'order-backlog',
    title: R.backlog.title,
    group: 'sales-orders',
    icon: 'boxes',
    fr: ['FR-059', 'FR-061'],
    description: R.backlog.description,
    needs: ['salesOrders'],
    views: [
      {
        id: 'backlog',
        label: R.backlog.views.backlog,
        filters: { division: true, owner: true },
        compute: (ds, f, ctx) => {
          const os = applyFilters(ds.get('salesOrders').filter((o) => BACKLOG.includes(s(o.status))), f, { owner: 'ownerId' });
          const rows = os
            .map((o) => row(o.id, { id: o.id, order: s(o.orderNo) || o.id, customer: ds.name('customers', o.customerId), status: o.status, kind: o.orderKind, value: netValue(o), age: Math.round((ms(ctx.today) - ms(dayOf(o.orderDate))) / 86_400_000), owner: empName(ds, o.ownerId) }))
            .sort((a, b) => n(b.age) - n(a.age));
          return {
            columns: [
              { key: 'order', label: C.orderNumber, link: peek('salesOrders') },
              { key: 'customer', label: C.customer },
              { key: 'status', label: C.status, type: 'status', master: 'soStatus' },
              { key: 'kind', label: D.orderBacklog.cols.orderType, type: 'status', master: 'orderKind' },
              { key: 'value', label: C.value, type: 'money', total: 'sum' },
              { key: 'age', label: C.ageDays, type: 'number' },
              { key: 'owner', label: C.salesExecutive },
            ],
            rows,
            points: BACKLOG.map((st) => ({ key: st, label: label('soStatus', st), value: rows.filter((r) => r.status === st).reduce((t, r) => t + n(r.value), 0) })).filter((p) => p.value > 0),
          };
        },
        kpis: [
          { label: R.backlog.kpis.orders, fmt: 'number', value: count, better: 'down' },
          { label: D.orderBacklog.tile, fmt: 'money', value: sumOf('value'), better: 'down', hint: D.kpiSummary.definitions.backlog },
          { label: R.backlog.kpis.avgAge, fmt: 'days', value: mean('age'), better: 'down' },
          { label: R.backlog.kpis.oldest, fmt: 'days', value: maxOf('age'), better: 'down' },
        ],
        chart: { type: 'bar', title: D.orderBacklog.chart, x: 'status', y: 'value', fmt: 'money', keepOrder: true },
      },
      {
        id: 'awaiting',
        label: R.backlog.views.awaiting,
        filters: { division: true, owner: true },
        compute: (ds, f, ctx) => {
          const os = applyFilters(ds.get('salesOrders').filter((o) => o.status === 'pending_approval' || o.status === 'on_hold'), f, { owner: 'ownerId' });
          const rows = os
            .map((o) => row(o.id, { id: o.id, order: s(o.orderNo) || o.id, customer: ds.name('customers', o.customerId), status: o.status, reason: s(o.holdReason), value: n(o.grandTotal), waiting: Math.floor((ctx.nowMs - ms(o.updatedAt)) / 86_400_000) }))
            .sort((a, b) => n(b.waiting) - n(a.waiting));
          return {
            columns: [
              { key: 'order', label: C.orderNumber, link: peek('salesOrders') },
              { key: 'customer', label: C.customer },
              { key: 'status', label: C.status, type: 'status', master: 'soStatus' },
              { key: 'reason', label: D.pendingOrders.cols.reason },
              { key: 'value', label: C.value, type: 'money', total: 'sum' },
              { key: 'waiting', label: C.waitingDays, type: 'number' },
            ],
            rows,
            points: [...groupBy(rows, (r) => label('soStatus', r.status)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.length })),
          };
        },
        kpis: [
          { label: R.backlog.kpis.waiting, fmt: 'number', value: count, better: 'down' },
          { label: R.backlog.kpis.valueWaiting, fmt: 'money', value: sumOf('value'), better: 'down' },
          { label: R.backlog.kpis.avgWait, fmt: 'days', value: mean('waiting'), better: 'down' },
          { label: R.backlog.kpis.longest, fmt: 'days', value: maxOf('waiting'), better: 'down' },
        ],
        chart: { type: 'donut', title: R.backlog.chartAwaiting, x: 'status', y: 'value', fmt: 'number', unit: R.backlog.orderUnit },
      },
      {
        id: 'delayed',
        label: R.backlog.views.delayed,
        filters: { date: 'past', division: true },
        dateLabel: D.delayedDispatches.dateLabel,
        compute: (ds, f, ctx) => {
          const dsp = applyFilters(ds.get('dispatches'), f, { date: 'dispatchDate' });
          const rows = dsp
            .map((d) => {
              const end = s(d.actualDelivery) ? dayOf(d.actualDelivery) : ctx.today;
              return { d, delay: Math.round((ms(end) - ms(dayOf(d.expectedDelivery))) / 86_400_000) };
            })
            .filter((x) => x.delay > 0)
            .map(({ d, delay }) => row(d.id, { id: d.id, order: ds.name('salesOrders', d.salesOrderId), customer: ds.name('customers', d.customerId), transporter: s(d.transporter), expected: d.expectedDelivery, actual: d.actualDelivery ?? '', delay, status: d.status }))
            .sort((a, b) => n(b.delay) - n(a.delay));
          return {
            columns: [
              { key: 'order', label: C.orderNumber, link: peek('dispatches') },
              { key: 'customer', label: C.customer },
              { key: 'transporter', label: D.delayedDispatches.cols.transporter },
              { key: 'expected', label: D.delayedDispatches.cols.expected, type: 'date' },
              { key: 'actual', label: D.delayedDispatches.cols.actual, type: 'date' },
              { key: 'delay', label: D.delayedDispatches.cols.delay, type: 'number' },
              { key: 'status', label: C.status, type: 'status', master: 'dispatchStatus' },
            ],
            rows,
            points: [...groupBy(rows, (r) => s(r.transporter) || L.reports.common.unknown).entries()].map(([k, v]) => ({ key: k, label: k, value: v.length })),
          };
        },
        kpis: [
          { label: D.delayedDispatches.tiles.delayed, fmt: 'number', value: count, better: 'down' },
          { label: R.backlog.kpis.avgDelay, fmt: 'days', value: mean('delay'), better: 'down' },
          { label: R.backlog.kpis.worstDelay, fmt: 'days', value: maxOf('delay'), better: 'down' },
        ],
        chart: { type: 'hbar', title: R.backlog.chartDelayed, x: 'transporter', y: 'delay', fmt: 'number', unit: R.backlog.dispatchUnit },
      },
    ],
  },
  {
    id: 'payment-status',
    title: R.payments.title,
    group: 'sales-orders',
    icon: 'landmark',
    fr: ['FR-059', 'FR-055'],
    description: R.payments.description,
    needs: ['paymentMilestones'],
    views: [
      {
        id: 'payments',
        label: R.payments.title,
        filters: { date: 'past', division: true, owner: true },
        dateLabel: D.paymentStatus.dateLabel,
        compute: (ds, f, ctx) => {
          const ms_ = applyFilters(ds.get('paymentMilestones'), f, { date: 'dueDate', owner: 'ownerId' });
          const rows = ms_
            .map((m) => {
              const out = outstandingOf(m);
              const age = Math.round((ms(ctx.today) - ms(dayOf(m.dueDate))) / 86_400_000);
              return row(m.id, { id: m.id, milestone: s(m.label), order: ds.name('salesOrders', m.salesOrderId), customer: ds.name('customers', m.customerId), due: m.dueDate, amount: n(m.amount), received: n(m.receivedAmount), outstanding: out, overdueDays: out > 0 && age > 0 ? age : null, owner: empName(ds, m.ownerId) });
            })
            .sort((a, b) => n(b.overdueDays) - n(a.overdueDays) || s(a.due).localeCompare(s(b.due)));
          const overdue = rows.filter((r) => r.overdueDays !== null);
          return {
            columns: [
              { key: 'milestone', label: D.paymentStatus.cols.milestone, link: peek('paymentMilestones') },
              { key: 'order', label: C.orderNumber },
              { key: 'customer', label: C.customer },
              { key: 'due', label: D.paymentStatus.cols.due, type: 'date' },
              { key: 'amount', label: R.payments.cols.amount, type: 'money', total: 'sum' },
              { key: 'outstanding', label: D.paymentStatus.cols.outstanding, type: 'money', total: 'sum' },
              { key: 'overdueDays', label: D.paymentStatus.cols.age, type: 'number' },
              { key: 'received', label: R.payments.cols.received, type: 'money', total: 'sum', optional: true },
              { key: 'owner', label: C.salesExecutive, optional: true },
            ],
            rows,
            points: AGEING.map((b) => ({ key: b.key, label: b.label, value: overdue.filter((r) => n(r.overdueDays) >= b.min && n(r.overdueDays) <= b.max).reduce((t, r) => t + n(r.outstanding), 0) })),
          };
        },
        kpis: [
          { label: D.paymentStatus.tiles.due, fmt: 'money', value: sumOf('amount'), better: 'none', hint: R.payments.dueHint },
          { label: D.paymentStatus.tiles.received, fmt: 'money', value: sumOf('received') },
          { label: D.paymentStatus.cols.outstanding, fmt: 'money', value: sumOf('outstanding'), better: 'down' },
          { label: D.paymentStatus.tiles.overdue, fmt: 'money', value: sumIf('outstanding', (r) => r.overdueDays !== null), better: 'down', hint: R.payments.overdueHint },
        ],
        chart: { type: 'bar', title: D.paymentStatus.chart, x: 'overdueDays', y: 'outstanding', fmt: 'money', keepOrder: true },
      },
    ],
  },
];
