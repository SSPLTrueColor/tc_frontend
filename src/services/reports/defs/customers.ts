/** CUS-12 customer reports: customer-wise sales, machine history, dormant customers. */
import { L } from '../../../constants/labels';
import { addDays } from '../../../lib/dates';
import { coverageFor } from '../../lookups';
import { getPolicies } from '../../policies';
import { dayOf, inRange, isBooked, isOpenOpp, ms, sum } from '../kpis';
import { applyFilters, empName, groupBy, n, peek, row, s } from '../helpers';
import { count, maxOf, mean, ratio, sum as sumOf } from '../metrics';
import type { ReportDef, ReportRow } from '../types';

const D = L.reports.defs;
const C = L.reports.cols;
const R = L.reports.rep;
const M = L.reports.more;

export const customerReports: ReportDef[] = [
  {
    id: 'customer-sales',
    title: D.customerSales.title,
    group: 'customers',
    icon: 'wallet',
    fr: ['FR-012'],
    description: R.customerSales.description,
    needs: ['customers', 'salesOrders'],
    views: [
      {
        id: 'sales',
        label: D.customerSales.title,
        filters: { date: 'past', division: true, owner: true },
        dateLabel: D.customerSales.dateLabel,
        compute: (ds, f) => {
          const orders = applyFilters(ds.get('salesOrders').filter(isBooked), f, { date: 'orderDate', owner: 'ownerId' });
          const opps = ds.get('opportunities').filter(isOpenOpp);
          const machines = ds.get('machines');
          return {
            columns: [
              { key: 'customer', label: C.customer, link: peek('customers') },
              { key: 'orders', label: C.salesOrders, type: 'number', total: 'sum' },
              { key: 'value', label: C.bookedValue, type: 'money', total: 'sum' },
              { key: 'lastOrder', label: D.customerSales.cols.lastOrder, type: 'date' },
              { key: 'pipeline', label: D.customerSales.cols.pipeline, type: 'money', total: 'sum' },
              { key: 'machines', label: C.machines, type: 'number', total: 'sum' },
            ],
            rows: [...groupBy(orders, (o) => s(o.customerId)).entries()]
              .map(([cid, os]) =>
                row(cid, {
                  id: cid,
                  customer: ds.name('customers', cid),
                  orders: os.length,
                  value: sum(os, 'grandTotal'),
                  lastOrder: os.map((o) => dayOf(o.orderDate)).sort().pop(),
                  pipeline: sum(opps.filter((o) => o.customerId === cid), 'value'),
                  machines: machines.filter((m) => m.customerId === cid).length,
                }),
              )
              .sort((a, b) => n(b.value) - n(a.value)),
          };
        },
        kpis: [
          { label: R.customerSales.kpis.customers, fmt: 'number', value: count },
          { label: D.customerSales.tiles.booked, fmt: 'money', value: sumOf('value') },
          { label: R.customerSales.kpis.avgOrder, fmt: 'money', value: ratio('value', 'orders') },
          { label: R.customerSales.kpis.pipeline, fmt: 'money', value: sumOf('pipeline'), hint: R.customerSales.pipelineHint },
        ],
        chart: { type: 'pareto', title: D.customerSales.chart, x: 'customer', y: 'value', fmt: 'money', fmt2: 'pct', label: M.paretoValue, label2: M.paretoCumulative },
      },
    ],
  },
  {
    id: 'machine-history',
    title: D.machineHistory.title,
    group: 'customers',
    icon: 'printer',
    fr: ['FR-012', 'FR-074'],
    description: R.machineHistory.description,
    needs: ['machines'],
    views: [
      {
        id: 'history',
        label: D.machineHistory.title,
        filters: { date: 'past', division: true },
        dateLabel: D.machineHistory.dateLabel,
        compute: (ds, f, ctx) => {
          const machines = applyFilters(ds.get('machines'), f);
          const tickets = ds.get('tickets').filter((t) => inRange(t.reportedAt, f.from, f.to));
          const pm = ds.get('pmVisits');
          return {
            columns: [
              { key: 'serial', label: C.serialNumber, link: peek('machines') },
              { key: 'model', label: C.model },
              { key: 'customer', label: C.customer },
              { key: 'installDate', label: C.installationDate, type: 'date' },
              { key: 'coverage', label: D.machineHistory.cols.coverage, type: 'status', master: 'coverage' },
              { key: 'tickets', label: C.serviceTickets, type: 'number', total: 'sum' },
              { key: 'breakdowns', label: C.breakdowns, type: 'number', total: 'sum' },
              { key: 'lastTicket', label: D.machineHistory.cols.lastTicket, type: 'date', optional: true },
              { key: 'pmDone', label: D.machineHistory.cols.pmDone, type: 'number', total: 'sum', optional: true },
            ],
            rows: machines
              .map((m) => {
                const ts = tickets.filter((t) => t.machineId === m.id);
                return row(m.id, {
                  id: m.id,
                  serial: s(m.serialNo),
                  model: s(m.model) || ds.name('products', m.productId),
                  customer: ds.name('customers', m.customerId),
                  installDate: m.installDate,
                  coverage: coverageFor(m.id, ctx.today),
                  tickets: ts.length,
                  breakdowns: ts.filter((t) => t.ticketType === 'breakdown').length,
                  lastTicket: ts.map((t) => dayOf(t.reportedAt)).sort().pop(),
                  pmDone: pm.filter((v) => v.machineId === m.id && v.status === 'done').length,
                });
              })
              .sort((a, b) => n(b.tickets) - n(a.tickets)),
          };
        },
        kpis: [
          { label: R.machineHistory.kpis.machines, fmt: 'number', value: count, better: 'none' },
          { label: C.serviceTickets, fmt: 'number', value: sumOf('tickets'), better: 'down' },
          { label: C.breakdowns, fmt: 'number', value: sumOf('breakdowns'), better: 'down' },
          { label: D.machineHistory.cols.pmDone, fmt: 'number', value: sumOf('pmDone') },
        ],
        chart: { type: 'hbar', title: D.machineHistory.chart, x: 'serial', y: 'tickets', fmt: 'number', unit: D.machineHistory.unit, noOthers: true },
      },
    ],
  },
  {
    id: 'dormant-customers',
    title: D.dormantCustomers.title,
    group: 'customers',
    icon: 'hourglass',
    fr: ['FR-012'],
    description: R.dormant.description,
    needs: ['customers'],
    views: [
      {
        id: 'dormant',
        label: D.dormantCustomers.title,
        filters: { division: true, owner: true },
        compute: (ds, f, ctx) => {
          const days = getPolicies().dormantDays;
          const since = addDays(ctx.today, -days);
          const lastOrder = new Map<string, string>();
          ds.get('salesOrders').filter(isBooked).forEach((o) => lastOrder.set(s(o.customerId), [lastOrder.get(s(o.customerId)) ?? '', dayOf(o.orderDate)].sort().pop()!));
          const lastAct = new Map<string, string>();
          ds.get('activities').forEach((a) => a.customerId && lastAct.set(s(a.customerId), [lastAct.get(s(a.customerId)) ?? '', dayOf(a.at)].sort().pop()!));
          const rows = applyFilters(ds.get('customers').filter((c) => c.status !== 'inactive'), f, { owner: 'ownerId', division: 'divisionIds' })
            .map((c) => ({ c, last: [lastOrder.get(c.id) ?? '', lastAct.get(c.id) ?? '', dayOf(c.lastActivityAt)].sort().pop() ?? '' }))
            .filter((x) => !x.last || x.last < since)
            .map(({ c, last }) => row(c.id, { id: c.id, customer: s(c.name), category: c.category, owner: empName(ds, c.ownerId), lastOrder: lastOrder.get(c.id) ?? '', lastTouch: last, idleDays: last ? Math.round((ms(ctx.today) - ms(last)) / 86_400_000) : null }))
            .sort((a, b) => n(b.idleDays) - n(a.idleDays));
          // Idle bands relative to the "dormant after" setting, so the chart says how deep the problem goes.
          const band = (r: ReportRow) => (r.idleDays === null ? 3 : n(r.idleDays) < days * 2 ? 0 : n(r.idleDays) < days * 4 ? 1 : 2);
          const labels = [R.dormant.bands.first(days, days * 2), R.dormant.bands.second(days * 2, days * 4), R.dormant.bands.third(days * 4), R.dormant.bands.never];
          return {
            columns: [
              { key: 'customer', label: C.customer, link: peek('customers') },
              { key: 'category', label: D.dormantCustomers.cols.category, type: 'status', master: 'customerCategory' },
              { key: 'owner', label: D.dormantCustomers.cols.owner },
              { key: 'lastOrder', label: D.dormantCustomers.cols.lastOrder, type: 'date' },
              { key: 'lastTouch', label: D.dormantCustomers.cols.lastTouch, type: 'date' },
              { key: 'idleDays', label: D.dormantCustomers.cols.idleDays, type: 'number' },
            ],
            rows,
            points: labels.map((label, i) => ({ key: `b${i}`, label, value: rows.filter((r) => band(r) === i).length })),
          };
        },
        kpis: [
          { label: R.dormant.kpis.dormant, fmt: 'number', value: count, better: 'down', hint: R.dormant.hint },
          { label: R.dormant.kpis.avgIdle, fmt: 'days', value: mean('idleDays'), better: 'down' },
          { label: R.dormant.kpis.longest, fmt: 'days', value: maxOf('idleDays'), better: 'down' },
        ],
        chart: { type: 'bar', title: R.dormant.chart, x: 'customer', y: 'idleDays', fmt: 'number', unit: R.dormant.unit, keepOrder: true },
      },
    ],
  },
];
