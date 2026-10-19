/** FR-012 customer reports, FR-026 lead reports, FR-048 quotation reports, FR-059 order reports. */
import { L } from '../../../constants/labels';
import { ROUTES } from '../../../constants/routes';
import { addDays } from '../../../lib/dates';
import { coverageFor } from '../../lookups';
import { getPolicies } from '../../policies';
import { BACKLOG, collections, dayOf, inRange, isBooked, isOpenOpp, leadResponseHours, ms, outstandingOf, quoteToOrder, sum, winRate } from '../kpis';
import { applyFilters, empName, groupBy, label, list, monthKey, n, pctOf, peek, s, top } from '../helpers';
import type { ReportColumn, ReportDef, ReportRow } from '../types';

const D = L.reports.defs;
const C = L.reports.cols;
const G = L.reports.groupBy;
const row = (key: string, o: Record<string, unknown>): ReportRow => ({ _key: key, ...o });
const latest = <T extends Record<string, unknown>>(qs: T[]) => qs.filter((q) => q.isLatest !== false && q.status !== 'superseded');

export const salesReports: ReportDef[] = [
  // ---------------------------------------------------------------- FR-012 customers
  {
    id: 'customer-sales',
    title: D.customerSales.title,
    group: 'customers',
    fr: ['FR-012'],
    description: D.customerSales.description,
    needs: ['customers', 'salesOrders'],
    filters: { date: 'past', division: true, owner: true },
    dateLabel: D.customerSales.dateLabel,
    compute: (ds, f) => {
      const orders = applyFilters(ds.get('salesOrders').filter(isBooked), f, { date: 'orderDate', owner: 'ownerId' });
      const opps = ds.get('opportunities').filter(isOpenOpp);
      const machines = ds.get('machines');
      const byCust = groupBy(orders, (o) => s(o.customerId));
      const rows = [...byCust.entries()].map(([cid, os]) =>
        row(cid, {
          id: cid,
          customer: ds.name('customers', cid),
          orders: os.length,
          value: sum(os, 'grandTotal'),
          lastOrder: os.map((o) => dayOf(o.orderDate)).sort().pop(),
          pipeline: sum(opps.filter((o) => o.customerId === cid), 'value'),
          machines: machines.filter((m) => m.customerId === cid).length,
        }),
      );
      return {
        columns: [
          { key: 'customer', label: C.customer, link: peek('customers') },
          { key: 'orders', label: C.salesOrders, type: 'number' },
          { key: 'value', label: C.bookedValue, type: 'money' },
          { key: 'lastOrder', label: D.customerSales.cols.lastOrder, type: 'date' },
          { key: 'pipeline', label: D.customerSales.cols.pipeline, type: 'money' },
          { key: 'machines', label: C.machines, type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.value) - n(a.value)),
        chart: { polarity: 'higher', label: D.customerSales.chart, unit: '₹', money: true, data: top(rows.map((r) => ({ key: r._key, label: s(r.customer), value: n(r.value) }))) },
        kpis: [
          { label: D.customerSales.tiles.customers, value: String(rows.length) },
          { label: D.customerSales.tiles.booked, value: `money:${sum(orders, 'grandTotal')}` },
        ],
      };
    },
  },
  {
    id: 'machine-history',
    title: D.machineHistory.title,
    group: 'customers',
    fr: ['FR-012', 'FR-074'],
    description: D.machineHistory.description,
    needs: ['machines'],
    filters: { date: 'past', division: true },
    dateLabel: D.machineHistory.dateLabel,
    compute: (ds, f, ctx) => {
      const machines = applyFilters(ds.get('machines'), f);
      const tickets = ds.get('tickets').filter((t) => inRange(t.reportedAt, f.from, f.to));
      const pm = ds.get('pmVisits');
      const rows = machines.map((m) => {
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
      });
      return {
        columns: [
          { key: 'serial', label: C.serialNumber, link: peek('machines') },
          { key: 'model', label: C.model },
          { key: 'customer', label: C.customer },
          { key: 'installDate', label: C.installationDate, type: 'date' },
          { key: 'coverage', label: D.machineHistory.cols.coverage, type: 'status', master: 'coverage' },
          { key: 'tickets', label: C.serviceTickets, type: 'number' },
          { key: 'breakdowns', label: C.breakdowns, type: 'number' },
          { key: 'lastTicket', label: D.machineHistory.cols.lastTicket, type: 'date' },
          { key: 'pmDone', label: D.machineHistory.cols.pmDone, type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.tickets) - n(a.tickets)),
        chart: { polarity: 'lower', label: D.machineHistory.chart, unit: D.machineHistory.unit, data: top(rows.map((r) => ({ key: r._key, label: s(r.serial), value: n(r.tickets) }))) },
      };
    },
  },
  {
    id: 'warranty-expiry',
    title: D.warrantyExpiry.title,
    group: 'installed-base',
    fr: ['FR-012', 'FR-074'],
    description: D.warrantyExpiry.description,
    needs: ['warranties'],
    filters: { date: 'future', division: true },
    dateLabel: D.warrantyExpiry.dateLabel,
    compute: (ds, f, ctx) => {
      const ws = applyFilters(ds.get('warranties'), f, { date: 'endDate' });
      const amc = ds.get('amcContracts');
      const rows = ws.map((w) => {
        const m = ds.get('machines').find((x) => x.id === w.machineId);
        return row(w.id, {
          id: w.id,
          serial: m ? s(m.serialNo) : s(w.machineId),
          customer: ds.name('customers', w.customerId ?? m?.customerId),
          endDate: w.endDate,
          daysLeft: Math.round((ms(dayOf(w.endDate)) - ms(ctx.today)) / 86_400_000),
          hasContract: amc.some((c) => c.machineId === w.machineId && ['active', 'due_for_renewal', 'draft'].includes(s(c.status)) && dayOf(c.endDate) > dayOf(w.endDate)) ? L.reports.common.yes : L.reports.common.no,
        });
      });
      const byMonth = groupBy(rows, (r) => monthKey(r.endDate));
      return {
        columns: [
          { key: 'serial', label: C.machine, link: peek('warranties') },
          { key: 'customer', label: C.customer },
          { key: 'endDate', label: D.warrantyExpiry.cols.endDate, type: 'date' },
          { key: 'daysLeft', label: C.daysLeft, type: 'number' },
          { key: 'hasContract', label: D.warrantyExpiry.cols.hasContract },
        ],
        rows: rows.sort((a, b) => n(a.daysLeft) - n(b.daysLeft)),
        chart: { polarity: 'neutral', label: D.warrantyExpiry.chart, unit: L.reports.defs.installedBase.unit, data: [...byMonth.entries()].sort().map(([k, v]) => ({ key: k, label: k, value: v.length })) },
        kpis: [{ label: D.warrantyExpiry.tile, value: String(rows.filter((r) => r.hasContract === L.reports.common.no).length) }],
      };
    },
  },
  {
    id: 'amc-renewals-due',
    title: D.amcRenewalsDue.title,
    group: 'installed-base',
    fr: ['FR-012', 'FR-074'],
    description: D.amcRenewalsDue.description,
    needs: ['amcContracts'],
    filters: { date: 'future', division: true, owner: true },
    dateLabel: D.amcRenewalsDue.dateLabel,
    compute: (ds, f, ctx) => {
      const cs = applyFilters(ds.get('amcContracts').filter((c) => ['active', 'due_for_renewal'].includes(s(c.status))), f, { date: 'endDate', owner: 'ownerId' });
      const rows = cs.map((c) =>
        row(c.id, {
          id: c.id,
          contract: s(c.contractNo) || c.id,
          customer: ds.name('customers', c.customerId),
          type: c.contractType,
          endDate: c.endDate,
          daysLeft: Math.round((ms(dayOf(c.endDate)) - ms(ctx.today)) / 86_400_000),
          value: n(c.value),
          status: c.status,
          owner: empName(ds, c.ownerId),
        }),
      );
      return {
        columns: [
          { key: 'contract', label: D.amcRenewalsDue.cols.contract, link: peek('amcContracts') },
          { key: 'customer', label: C.customer },
          { key: 'type', label: D.amcRenewalsDue.cols.type, type: 'status', master: 'amcType' },
          { key: 'endDate', label: D.amcRenewalsDue.cols.endDate, type: 'date' },
          { key: 'daysLeft', label: C.daysLeft, type: 'number' },
          { key: 'value', label: C.value, type: 'money' },
          { key: 'status', label: C.status, type: 'status', master: 'amcStatus' },
          { key: 'owner', label: C.salesExecutive },
        ],
        rows: rows.sort((a, b) => n(a.daysLeft) - n(b.daysLeft)),
        chart: { polarity: 'neutral', label: D.amcRenewalsDue.chart, unit: '₹', money: true, data: [...groupBy(rows, (r) => monthKey(r.endDate)).entries()].sort().map(([k, v]) => ({ key: k, label: k, value: v.reduce((t, r) => t + n(r.value), 0) })) },
        kpis: [{ label: D.amcRenewalsDue.tile, value: `money:${rows.reduce((t, r) => t + n(r.value), 0)}` }],
      };
    },
  },
  {
    id: 'dormant-customers',
    title: D.dormantCustomers.title,
    group: 'customers',
    fr: ['FR-012'],
    description: D.dormantCustomers.description,
    needs: ['customers'],
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
        .map(({ c, last }) =>
          row(c.id, { id: c.id, customer: s(c.name), category: c.category, owner: empName(ds, c.ownerId), lastOrder: lastOrder.get(c.id) ?? '', lastTouch: last, idleDays: last ? Math.round((ms(ctx.today) - ms(last)) / 86_400_000) : null }),
        );
      return {
        columns: [
          { key: 'customer', label: C.customer, link: peek('customers') },
          { key: 'category', label: D.dormantCustomers.cols.category, type: 'status', master: 'customerCategory' },
          { key: 'owner', label: D.dormantCustomers.cols.owner },
          { key: 'lastOrder', label: D.dormantCustomers.cols.lastOrder, type: 'date' },
          { key: 'lastTouch', label: D.dormantCustomers.cols.lastTouch, type: 'date' },
          { key: 'idleDays', label: D.dormantCustomers.cols.idleDays, type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.idleDays) - n(a.idleDays)),
        kpis: [{ label: D.dormantCustomers.tile, value: String(rows.length), hint: D.dormantCustomers.hint(days) }],
      };
    },
  },

  // ---------------------------------------------------------------- FR-026 leads
  {
    id: 'lead-conversion',
    title: D.leadConversion.title,
    group: 'leads',
    fr: ['FR-026'],
    description: D.leadConversion.description,
    needs: ['leads'],
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
      const rows = [...groupBy(leads, keyOf).entries()].map(([k, ls]) => {
        const q = ls.filter((l) => l.status === 'qualified' || l.opportunityId).length;
        return row(k, { group: k, leads: ls.length, qualified: q, disqualified: ls.filter((l) => l.status === 'disqualified').length, open: ls.filter((l) => ['new', 'contacted', 'nurture'].includes(s(l.status))).length, conversion: pctOf(q, ls.length) });
      });
      const sorted = g === 'month' ? rows.sort((a, b) => s(a.group).localeCompare(s(b.group))) : rows.sort((a, b) => n(b.leads) - n(a.leads));
      const q = leads.filter((l) => l.status === 'qualified' || l.opportunityId).length;
      return {
        columns: [
          { key: 'group', label: g === 'month' ? C.month : g === 'owner' ? C.salesExecutive : g === 'product' ? D.leadConversion.cols.productType : g === 'source' ? D.leadConversion.cols.source : D.leadConversion.cols.campaign },
          { key: 'leads', label: C.leads, type: 'number' },
          { key: 'qualified', label: D.leadConversion.cols.qualified, type: 'number' },
          { key: 'open', label: D.leadConversion.cols.open, type: 'number' },
          { key: 'disqualified', label: D.leadConversion.cols.disqualified, type: 'number' },
          { key: 'conversion', label: D.leadConversion.cols.conversion, type: 'pct' },
        ],
        rows: sorted,
        chart: { polarity: 'higher', label: D.leadConversion.chart, unit: '%', data: sorted.slice(0, 12).map((r) => ({ key: r._key, label: s(r.group), value: Math.round(n(r.conversion) * 100) })) },
        kpis: [
          { label: D.leadConversion.tiles.leads, value: String(leads.length) },
          { label: D.leadConversion.tiles.conversion, value: `pct:${pctOf(q, leads.length) ?? ''}` },
        ],
      };
    },
  },
  {
    id: 'lead-ageing',
    title: D.leadAgeing.title,
    group: 'leads',
    fr: ['FR-026'],
    description: D.leadAgeing.description,
    needs: ['leads'],
    filters: { division: true, owner: true },
    compute: (ds, f, ctx) => {
      const open = applyFilters(ds.get('leads').filter((l) => ['new', 'contacted', 'nurture'].includes(s(l.status))), f, { owner: 'ownerId' });
      const rows = open.map((l) => row(l.id, { id: l.id, lead: ds.name('leads', l.id), status: l.status, owner: empName(ds, l.ownerId), created: dayOf(l.createdAt), age: Math.floor((ctx.nowMs - ms(l.createdAt)) / 86_400_000), nextFollowUp: l.nextFollowUpAt }));
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
          { key: 'status', label: C.status, type: 'status', master: 'leadStatus' },
          { key: 'owner', label: D.leadAgeing.cols.owner },
          { key: 'created', label: D.leadAgeing.cols.created, type: 'date' },
          { key: 'age', label: C.ageDays, type: 'number' },
          { key: 'nextFollowUp', label: D.leadAgeing.cols.nextFollowUp, type: 'date' },
        ],
        rows: rows.sort((a, b) => n(b.age) - n(a.age)),
        chart: { polarity: 'ageing', label: D.leadAgeing.chart, unit: D.leadAgeing.unit, data: buckets.map(([lb, a, b]) => ({ key: lb, label: lb, value: rows.filter((r) => n(r.age) >= a && n(r.age) <= b).length })) },
      };
    },
  },
  {
    id: 'lead-first-response',
    title: D.leadFirstResponse.title,
    group: 'leads',
    fr: ['FR-026', 'FR-020'],
    description: D.leadFirstResponse.description,
    needs: ['leads'],
    filters: { date: 'past', division: true },
    dateLabel: D.leadFirstResponse.dateLabel,
    compute: (ds, f) => {
      const leads = applyFilters(ds.get('leads'), f, { date: 'createdAt' });
      const sla = getPolicies().leadFirstContactHours;
      const rows = [...groupBy(leads, (l) => s(l.ownerId)).entries()].map(([oid, ls]) => {
        const contacted = ls.filter((l) => s(l.firstContactAt));
        const late = contacted.filter((l) => (ms(l.firstContactAt) - ms(l.createdAt)) / 3_600_000 > sla).length + ls.filter((l) => l.notAttended).length;
        return row(oid, { owner: empName(ds, oid), leads: ls.length, contacted: contacted.length, avgHours: leadResponseHours(ls), outsideSla: late, notAttended: ls.filter((l) => l.notAttended).length });
      });
      return {
        columns: [
          { key: 'owner', label: C.salesExecutive },
          { key: 'leads', label: C.leads, type: 'number' },
          { key: 'contacted', label: D.leadFirstResponse.cols.contacted, type: 'number' },
          { key: 'avgHours', label: D.leadFirstResponse.cols.avgHours, type: 'hours' },
          { key: 'outsideSla', label: D.leadFirstResponse.cols.outsideSla(sla), type: 'number' },
          { key: 'notAttended', label: D.leadFirstResponse.cols.notAttended, type: 'number', link: () => ROUTES.notAttendedLeads },
        ],
        rows: rows.sort((a, b) => n(b.avgHours) - n(a.avgHours)),
        chart: { polarity: 'lower', label: D.leadFirstResponse.chart, unit: 'h', data: rows.filter((r) => r.avgHours !== null).map((r) => ({ key: r._key, label: s(r.owner), value: Math.round(n(r.avgHours) * 10) / 10 })) },
        kpis: [{ label: D.leadFirstResponse.tile, value: `hours:${leadResponseHours(leads) ?? ''}`, hint: D.leadFirstResponse.hint(sla) }],
      };
    },
  },
  {
    id: 'pending-followups',
    title: D.pendingFollowups.title,
    group: 'leads',
    fr: ['FR-026', 'FR-021'],
    description: D.pendingFollowups.description,
    needs: ['leads'],
    filters: { division: true, owner: true },
    compute: (ds, f, ctx) => {
      const leads = ds.get('leads').filter((l) => ['new', 'contacted', 'nurture'].includes(s(l.status)));
      const opps = ds.get('opportunities').filter(isOpenOpp);
      const due = applyFilters([...leads.map((r) => ({ ...r, _res: 'leads' })), ...opps.map((r) => ({ ...r, _res: 'opportunities' }))], f, { owner: 'ownerId' }).filter((r) => s(r.nextFollowUpAt) && dayOf(r.nextFollowUpAt) <= ctx.today);
      const rows = due.map((r) => row(`${r._res}:${r.id}`, { id: r.id, res: r._res === 'leads' ? D.pendingFollowups.lead : D.pendingFollowups.opportunity, record: ds.name(String(r._res), r.id), owner: empName(ds, r.ownerId), due: r.nextFollowUpAt, overdueDays: Math.round((ms(ctx.today) - ms(dayOf(r.nextFollowUpAt))) / 86_400_000), _link: String(r._res) }));
      return {
        columns: [
          { key: 'record', label: D.pendingFollowups.cols.record, link: (r) => peek(String(r._link))(r) },
          { key: 'res', label: D.pendingFollowups.cols.type },
          { key: 'owner', label: C.owner },
          { key: 'due', label: D.pendingFollowups.cols.due, type: 'date' },
          { key: 'overdueDays', label: D.pendingFollowups.cols.overdueDays, type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.overdueDays) - n(a.overdueDays)),
        chart: { polarity: 'lower', label: D.pendingFollowups.chart, unit: D.pendingFollowups.unit, data: top([...groupBy(rows, (r) => s(r.owner)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.length }))) },
      };
    },
  },
  {
    id: 'lost-leads',
    title: D.lostLeads.title,
    group: 'leads',
    fr: ['FR-026', 'FR-023'],
    description: D.lostLeads.description,
    needs: ['leads'],
    filters: { date: 'past', division: true, owner: true },
    dateLabel: D.lostLeads.dateLabel,
    compute: (ds, f) => {
      const lost = applyFilters(ds.get('leads').filter((l) => l.status === 'disqualified'), f, { date: 'createdAt', owner: 'ownerId' });
      const rows = [...groupBy(lost, (l) => label('lostReason', l.disqualifyReason)).entries()].map(([k, ls]) => row(k, { reason: k, leads: ls.length, share: pctOf(ls.length, lost.length), budget: sum(ls, 'budget') }));
      return {
        columns: [
          { key: 'reason', label: D.lostLeads.cols.reason, link: () => list('leads', { view: 'v_leads_all' }) },
          { key: 'leads', label: C.leads, type: 'number' },
          { key: 'share', label: D.lostLeads.cols.share, type: 'pct' },
          { key: 'budget', label: D.lostLeads.cols.budget, type: 'money' },
        ],
        rows: rows.sort((a, b) => n(b.leads) - n(a.leads)),
        chart: { polarity: 'neutral', label: D.lostLeads.chart, unit: D.lostLeads.unit, data: rows.map((r) => ({ key: r._key, label: s(r.reason), value: n(r.leads) })) },
      };
    },
  },
  {
    id: 'exec-performance',
    title: D.execPerformance.title,
    group: 'leads',
    fr: ['FR-026', 'FR-059'],
    description: D.execPerformance.description,
    needs: ['leads'],
    filters: { date: 'past', division: true },
    dateLabel: D.execPerformance.dateLabel,
    compute: (ds, f) => {
      const leads = applyFilters(ds.get('leads'), f, { date: 'createdAt' });
      const opps = applyFilters(ds.get('opportunities'), f);
      const orders = applyFilters(ds.get('salesOrders').filter(isBooked), f, { date: 'orderDate' });
      const acts = ds.get('activities').filter((a) => inRange(a.at, f.from, f.to));
      const owners = new Set([...leads, ...orders].map((r) => s(r.ownerId)).filter(Boolean));
      const rows = [...owners].map((o) => {
        const ls = leads.filter((l) => l.ownerId === o);
        const q = ls.filter((l) => l.status === 'qualified' || l.opportunityId).length;
        const closed = opps.filter((x) => x.ownerId === o && ['won', 'lost'].includes(s(x.stage)) && inRange(x.wonAt || x.stageChangedAt || x.updatedAt, f.from, f.to));
        return row(o, { owner: empName(ds, o), leads: ls.length, conversion: pctOf(q, ls.length), winRate: winRate(closed), orders: orders.filter((x) => x.ownerId === o).length, booked: sum(orders.filter((x) => x.ownerId === o), 'grandTotal'), activities: acts.filter((a) => a.byId === o).length });
      });
      return {
        columns: [
          { key: 'owner', label: C.salesExecutive },
          { key: 'leads', label: C.leads, type: 'number' },
          { key: 'conversion', label: D.execPerformance.cols.conversion, type: 'pct' },
          { key: 'winRate', label: D.execPerformance.cols.winRate, type: 'pct' },
          { key: 'orders', label: C.salesOrders, type: 'number' },
          { key: 'booked', label: C.bookedValue, type: 'money' },
          { key: 'activities', label: D.execPerformance.cols.activities, type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.booked) - n(a.booked)),
        chart: { polarity: 'higher', label: D.execPerformance.chart, unit: '₹', money: true, data: top(rows.map((r) => ({ key: r._key, label: s(r.owner), value: n(r.booked) }))) },
      };
    },
  },
  {
    // LEAD-12 / D-5: referrals stay a report (no own page).
    id: 'referrals',
    title: D.referrals.title,
    group: 'leads',
    fr: ['FR-024', 'FR-026'],
    description: D.referrals.description,
    needs: ['leads'],
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
      const converted = (ls: Record<string, unknown>[]) => ls.filter((l) => l.status === 'qualified' || l.opportunityId).length;
      const rows = [...groupBy(refs, (l) => (g === 'type' ? s(l.referrerType) : `${s(l.referrerType)}|${referrerOf(l)}`)).entries()].map(([k, ls]) =>
        row(k, {
          referrer: g === 'type' ? label('referrerType', ls[0].referrerType) : referrerOf(ls[0]),
          referrerType: ls[0].referrerType,
          leads: ls.length,
          converted: converted(ls),
          open: ls.filter((l) => ['new', 'contacted', 'nurture'].includes(s(l.status))).length,
          conversion: pctOf(converted(ls), ls.length),
        }),
      );
      const columns: ReportColumn[] = [
        ...(g === 'type' ? [] : [{ key: 'referrer', label: D.referrals.cols.referrer, link: () => list('leads') }]),
        { key: 'referrerType', label: D.referrals.cols.referrerType, type: 'status', master: 'referrerType' },
        { key: 'leads', label: C.leads, type: 'number' },
        { key: 'converted', label: D.referrals.cols.converted, type: 'number' },
        { key: 'open', label: D.referrals.cols.open, type: 'number' },
        { key: 'conversion', label: D.referrals.cols.conversion, type: 'pct' },
      ];
      return {
        columns,
        rows: rows.sort((a, b) => n(b.leads) - n(a.leads)),
        chart: { polarity: 'higher', label: D.referrals.chart, unit: D.referrals.unit, data: top(rows.map((r) => ({ key: r._key, label: g === 'type' ? label('referrerType', r.referrerType) : s(r.referrer), value: n(r.leads) }))) },
        kpis: [
          { label: D.referrals.tiles.leads, value: String(refs.length) },
          { label: D.referrals.tiles.conversion, value: `pct:${pctOf(converted(refs), refs.length) ?? ''}` },
        ],
      };
    },
  },

  // ---------------------------------------------------------------- FR-048 quotations
  {
    id: 'quotation-value',
    title: D.quotationValue.title,
    group: 'quotations',
    fr: ['FR-048'],
    description: D.quotationValue.description,
    needs: ['quotations'],
    filters: { date: 'past', division: true, owner: true },
    dateLabel: D.quotationValue.dateLabel,
    groupOptions: [
      { value: 'month', label: G.month },
      { value: 'division', label: G.division },
      { value: 'status', label: G.status },
    ],
    compute: (ds, f) => {
      const qs = latest(applyFilters(ds.get('quotations'), f, { date: 'quoteDate', owner: 'ownerId' }));
      const g = f.group ?? 'month';
      const keyOf = (q: Record<string, unknown>) => (g === 'division' ? label('division', q.divisionId) : g === 'status' ? label('quoteStatus', q.status) : monthKey(q.quoteDate));
      const rows = [...groupBy(qs, keyOf).entries()].map(([k, v]) => row(k, { group: k, quotes: v.length, value: sum(v, 'grandTotal'), accepted: v.filter((q) => q.status === 'accepted').length, avgDiscount: v.length ? v.reduce((t, q) => t + n(q.maxDiscountPct), 0) / v.length / 100 : null }));
      const sorted = g === 'month' ? rows.sort((a, b) => s(a.group).localeCompare(s(b.group))) : rows.sort((a, b) => n(b.value) - n(a.value));
      return {
        columns: [
          { key: 'group', label: g === 'month' ? C.month : g === 'division' ? C.division : C.status },
          { key: 'quotes', label: C.quotations, type: 'number' },
          { key: 'value', label: D.quotationValue.cols.value, type: 'money' },
          { key: 'accepted', label: D.quotationValue.cols.accepted, type: 'number' },
          { key: 'avgDiscount', label: D.quotationValue.cols.avgDiscount, type: 'pct' },
        ],
        rows: sorted,
        chart: { polarity: 'higher', label: D.quotationValue.chart, unit: '₹', money: true, data: sorted.map((r) => ({ key: r._key, label: s(r.group), value: n(r.value) })) },
        kpis: [
          { label: D.quotationValue.tiles.quotations, value: String(qs.length) },
          { label: D.quotationValue.tiles.total, value: `money:${sum(qs, 'grandTotal')}` },
        ],
      };
    },
  },
  {
    id: 'pending-approvals',
    title: D.pendingApprovals.title,
    group: 'quotations',
    fr: ['FR-048', 'FR-040'],
    description: D.pendingApprovals.description,
    needs: ['quotations'],
    filters: { division: true, owner: true },
    compute: (ds, f, ctx) => {
      const qs = applyFilters(ds.get('quotations').filter((q) => q.status === 'pending_approval'), f, { owner: 'ownerId' });
      const rows = qs.map((q) => row(q.id, { id: q.id, quote: s(q.quoteNo) || q.id, customer: ds.name('customers', q.customerId), owner: empName(ds, q.ownerId), discount: n(q.maxDiscountPct) / 100, value: n(q.grandTotal), waitingDays: Math.floor((ctx.nowMs - ms(q.updatedAt)) / 86_400_000) }));
      return {
        columns: [
          { key: 'quote', label: C.quotationNumber, link: peek('quotations') },
          { key: 'customer', label: C.customer },
          { key: 'owner', label: D.pendingApprovals.cols.owner },
          { key: 'discount', label: D.pendingApprovals.cols.discount, type: 'pct' },
          { key: 'value', label: C.value, type: 'money' },
          { key: 'waitingDays', label: C.waitingDays, type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.waitingDays) - n(a.waitingDays)),
        kpis: [{ label: D.pendingApprovals.tile, value: `money:${sum(qs, 'grandTotal')}` }],
      };
    },
  },
  {
    id: 'quote-to-order',
    title: D.quoteToOrder.title,
    group: 'quotations',
    fr: ['FR-048'],
    description: D.quoteToOrder.description,
    needs: ['quotations', 'salesOrders'],
    filters: { date: 'past', division: true },
    dateLabel: D.quoteToOrder.dateLabel,
    compute: (ds, f) => {
      const qs = latest(applyFilters(ds.get('quotations'), f, { date: 'quoteDate' }));
      const orders = ds.get('salesOrders');
      const rows = [...groupBy(qs, (q) => s(q.ownerId)).entries()].map(([o, v]) => {
        const sent = v.filter((q) => ['sent', 'negotiation', 'accepted', 'rejected', 'expired'].includes(s(q.status)) || s(q.sentAt));
        const ordered = sent.filter((q) => orders.some((x) => x.quotationId === q.id && x.status !== 'cancelled'));
        return row(o, { owner: empName(ds, o), sent: sent.length, ordered: ordered.length, rate: quoteToOrder(v, orders), orderedValue: sum(ordered, 'grandTotal') });
      });
      return {
        columns: [
          { key: 'owner', label: C.salesExecutive },
          { key: 'sent', label: D.quoteToOrder.cols.sent, type: 'number' },
          { key: 'ordered', label: D.quoteToOrder.cols.ordered, type: 'number' },
          { key: 'rate', label: D.quoteToOrder.cols.rate, type: 'pct' },
          { key: 'orderedValue', label: D.quoteToOrder.cols.orderedValue, type: 'money' },
        ],
        rows: rows.sort((a, b) => n(b.rate) - n(a.rate)),
        chart: { polarity: 'higher', label: D.quoteToOrder.chart, unit: '%', data: rows.filter((r) => r.rate !== null).map((r) => ({ key: r._key, label: s(r.owner), value: Math.round(n(r.rate) * 100) })) },
        kpis: [{ label: D.quoteToOrder.tile, value: `pct:${quoteToOrder(qs, orders) ?? ''}` }],
      };
    },
  },
  {
    id: 'lost-quotations',
    title: D.lostQuotations.title,
    group: 'quotations',
    fr: ['FR-048'],
    description: D.lostQuotations.description,
    needs: ['quotations'],
    filters: { date: 'past', division: true, owner: true },
    dateLabel: D.lostQuotations.dateLabel,
    compute: (ds, f) => {
      const qs = latest(applyFilters(ds.get('quotations').filter((q) => q.status === 'rejected' || q.status === 'expired'), f, { date: 'quoteDate', owner: 'ownerId' }));
      const reasonOf = (q: Record<string, unknown>) => (q.status === 'expired' ? D.lostQuotations.expired : label('lostReason', q.rejectReason));
      const rows = qs.map((q) => row(q.id, { id: q.id, quote: s(q.quoteNo) || q.id, customer: ds.name('customers', q.customerId), status: q.status, reason: reasonOf(q), value: n(q.grandTotal), owner: empName(ds, q.ownerId) }));
      return {
        columns: [
          { key: 'quote', label: C.quotationNumber, link: peek('quotations') },
          { key: 'customer', label: C.customer },
          { key: 'status', label: C.status, type: 'status', master: 'quoteStatus' },
          { key: 'reason', label: D.lostQuotations.cols.reason },
          { key: 'value', label: C.value, type: 'money' },
          { key: 'owner', label: C.salesExecutive },
        ],
        rows: rows.sort((a, b) => n(b.value) - n(a.value)),
        chart: { polarity: 'neutral', label: D.lostQuotations.chart, unit: '₹', money: true, data: [...groupBy(rows, (r) => s(r.reason)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.reduce((t, r) => t + n(r.value), 0) })) },
      };
    },
  },
  {
    id: 'discount-analysis',
    title: D.discountAnalysis.title,
    group: 'quotations',
    fr: ['FR-048'],
    description: D.discountAnalysis.description,
    needs: ['quotations'],
    filters: { date: 'past', division: true },
    dateLabel: D.discountAnalysis.dateLabel,
    groupOptions: [
      { value: 'owner', label: G.owner },
      { value: 'division', label: G.division },
    ],
    compute: (ds, f) => {
      const qs = latest(applyFilters(ds.get('quotations'), f, { date: 'quoteDate' }));
      const bands = getPolicies().discountBands.map((b) => b.upTo);
      const g = f.group ?? 'owner';
      const rows = [...groupBy(qs, (q) => (g === 'division' ? label('division', q.divisionId) : empName(ds, q.ownerId))).entries()].map(([k, v]) => {
        const d = v.map((q) => n(q.maxDiscountPct));
        return row(k, { group: k, quotes: v.length, avg: d.length ? d.reduce((t, x) => t + x, 0) / d.length / 100 : null, max: d.length ? Math.max(...d) / 100 : null, aboveFirstBand: d.filter((x) => x > (bands[0] ?? 5)).length, discountValue: sum(v, 'discountTotal') });
      });
      return {
        columns: [
          { key: 'group', label: g === 'division' ? C.division : C.salesExecutive },
          { key: 'quotes', label: C.quotations, type: 'number' },
          { key: 'avg', label: D.discountAnalysis.cols.avg, type: 'pct' },
          { key: 'max', label: D.discountAnalysis.cols.max, type: 'pct' },
          { key: 'aboveFirstBand', label: D.discountAnalysis.cols.aboveFirstBand(bands[0] ?? 5), type: 'number' },
          { key: 'discountValue', label: D.discountAnalysis.cols.discountValue, type: 'money' },
        ],
        rows: rows.sort((a, b) => n(b.avg) - n(a.avg)),
        chart: { polarity: 'lower', label: D.discountAnalysis.chart, unit: '%', data: rows.map((r) => ({ key: r._key, label: s(r.group), value: Math.round(n(r.avg) * 1000) / 10 })) },
      };
    },
  },

  // ---------------------------------------------------------------- FR-059 orders
  {
    id: 'order-value',
    title: D.orderValue.title,
    group: 'sales-orders',
    fr: ['FR-059'],
    description: D.orderValue.description,
    needs: ['salesOrders'],
    filters: { date: 'past', division: true, owner: true },
    dateLabel: D.orderValue.dateLabel,
    groupOptions: [
      { value: 'month', label: G.month },
      { value: 'division', label: G.division },
      { value: 'kind', label: D.orderValue.machineVsConsumables },
    ],
    compute: (ds, f) => {
      const os = applyFilters(ds.get('salesOrders').filter(isBooked), f, { date: 'orderDate', owner: 'ownerId' });
      const g = f.group ?? 'month';
      const rows = [...groupBy(os, (o) => (g === 'division' ? label('division', o.divisionId) : g === 'kind' ? label('orderKind', o.orderKind) : monthKey(o.orderDate))).entries()].map(([k, v]) => row(k, { group: k, orders: v.length, value: sum(v, 'grandTotal'), avg: v.length ? sum(v, 'grandTotal') / v.length : 0 }));
      const sorted = g === 'month' ? rows.sort((a, b) => s(a.group).localeCompare(s(b.group))) : rows.sort((a, b) => n(b.value) - n(a.value));
      return {
        columns: [
          { key: 'group', label: g === 'month' ? C.month : g === 'division' ? C.division : D.orderValue.cols.orderType, link: () => list('salesOrders') },
          { key: 'orders', label: C.salesOrders, type: 'number' },
          { key: 'value', label: D.orderValue.cols.value, type: 'money' },
          { key: 'avg', label: D.orderValue.cols.avg, type: 'money' },
        ],
        rows: sorted,
        chart: { polarity: 'higher', label: D.orderValue.chart, unit: '₹', money: true, data: sorted.map((r) => ({ key: r._key, label: s(r.group), value: n(r.value) })) },
        kpis: [
          { label: D.orderValue.tiles.booked, value: String(os.length) },
          { label: D.orderValue.tiles.value, value: `money:${sum(os, 'grandTotal')}` },
        ],
      };
    },
  },
  {
    id: 'order-backlog',
    title: D.orderBacklog.title,
    group: 'sales-orders',
    fr: ['FR-059'],
    description: D.orderBacklog.description,
    needs: ['salesOrders'],
    filters: { division: true, owner: true },
    compute: (ds, f, ctx) => {
      const os = applyFilters(ds.get('salesOrders').filter((o) => BACKLOG.includes(s(o.status))), f, { owner: 'ownerId' });
      const rows = os.map((o) => row(o.id, { id: o.id, order: s(o.orderNo) || o.id, customer: ds.name('customers', o.customerId), status: o.status, kind: o.orderKind, value: n(o.grandTotal), age: Math.round((ms(ctx.today) - ms(dayOf(o.orderDate))) / 86_400_000), owner: empName(ds, o.ownerId) }));
      return {
        columns: [
          { key: 'order', label: C.orderNumber, link: peek('salesOrders') },
          { key: 'customer', label: C.customer },
          { key: 'status', label: C.status, type: 'status', master: 'soStatus' },
          { key: 'kind', label: D.orderBacklog.cols.orderType, type: 'status', master: 'orderKind' },
          { key: 'value', label: C.value, type: 'money' },
          { key: 'age', label: C.ageDays, type: 'number' },
          { key: 'owner', label: C.salesExecutive },
        ],
        rows: rows.sort((a, b) => n(b.age) - n(a.age)),
        chart: { polarity: 'neutral', label: D.orderBacklog.chart, unit: '₹', money: true, data: BACKLOG.map((st) => ({ key: st, label: label('soStatus', st), value: rows.filter((r) => r.status === st).reduce((t, r) => t + n(r.value), 0) })).filter((d) => d.value > 0) },
        kpis: [{ label: D.orderBacklog.tile, value: `money:${rows.reduce((t, r) => t + n(r.value), 0)}` }],
      };
    },
  },
  {
    id: 'pending-orders',
    title: D.pendingOrders.title,
    group: 'sales-orders',
    fr: ['FR-059'],
    description: D.pendingOrders.description,
    needs: ['salesOrders'],
    filters: { division: true, owner: true },
    compute: (ds, f, ctx) => {
      const os = applyFilters(ds.get('salesOrders').filter((o) => o.status === 'pending_approval' || o.status === 'on_hold'), f, { owner: 'ownerId' });
      const rows = os.map((o) => row(o.id, { id: o.id, order: s(o.orderNo) || o.id, customer: ds.name('customers', o.customerId), status: o.status, reason: s(o.holdReason), value: n(o.grandTotal), waiting: Math.floor((ctx.nowMs - ms(o.updatedAt)) / 86_400_000) }));
      return {
        columns: [
          { key: 'order', label: C.orderNumber, link: peek('salesOrders') },
          { key: 'customer', label: C.customer },
          { key: 'status', label: C.status, type: 'status', master: 'soStatus' },
          { key: 'reason', label: D.pendingOrders.cols.reason },
          { key: 'value', label: C.value, type: 'money' },
          { key: 'waiting', label: C.waitingDays, type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.waiting) - n(a.waiting)),
      };
    },
  },
  {
    id: 'delayed-dispatches',
    title: D.delayedDispatches.title,
    group: 'sales-orders',
    fr: ['FR-059', 'FR-061'],
    description: D.delayedDispatches.description,
    needs: ['dispatches'],
    filters: { date: 'past', division: true },
    dateLabel: D.delayedDispatches.dateLabel,
    compute: (ds, f, ctx) => {
      const dsp = applyFilters(ds.get('dispatches'), f, { date: 'dispatchDate' });
      const late = dsp
        .map((d) => {
          const end = s(d.actualDelivery) ? dayOf(d.actualDelivery) : ctx.today;
          return { d, delay: Math.round((ms(end) - ms(dayOf(d.expectedDelivery))) / 86_400_000) };
        })
        .filter((x) => x.delay > 0);
      const rows = late.map(({ d, delay }) => row(d.id, { id: d.id, order: ds.name('salesOrders', d.salesOrderId), customer: ds.name('customers', d.customerId), transporter: s(d.transporter), expected: d.expectedDelivery, actual: d.actualDelivery ?? '', delay, status: d.status }));
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
        rows: rows.sort((a, b) => n(b.delay) - n(a.delay)),
        kpis: [
          { label: D.delayedDispatches.tiles.delayed, value: L.reports.common.ofTotal(rows.length, dsp.length) },
          { label: D.delayedDispatches.tiles.onTime, value: `pct:${dsp.length ? 1 - rows.length / dsp.length : ''}` },
        ],
      };
    },
  },
  {
    id: 'payment-status',
    title: D.paymentStatus.title,
    group: 'sales-orders',
    fr: ['FR-059', 'FR-055'],
    description: D.paymentStatus.description,
    needs: ['paymentMilestones'],
    filters: { date: 'past', division: true, owner: true },
    dateLabel: D.paymentStatus.dateLabel,
    compute: (ds, f, ctx) => {
      const ms_ = applyFilters(ds.get('paymentMilestones'), f, { date: 'dueDate', owner: 'ownerId' });
      const c = collections(ms_, ctx.today);
      const overdue = ms_.filter((m) => dayOf(m.dueDate) < ctx.today && outstandingOf(m) > 0);
      const rows = overdue.map((m) => row(m.id, { id: m.id, milestone: s(m.label), order: ds.name('salesOrders', m.salesOrderId), customer: ds.name('customers', m.customerId), due: m.dueDate, outstanding: outstandingOf(m), age: Math.round((ms(ctx.today) - ms(dayOf(m.dueDate))) / 86_400_000), owner: empName(ds, m.ownerId) }));
      return {
        columns: [
          { key: 'milestone', label: D.paymentStatus.cols.milestone, link: peek('paymentMilestones') },
          { key: 'order', label: C.orderNumber },
          { key: 'customer', label: C.customer },
          { key: 'due', label: D.paymentStatus.cols.due, type: 'date' },
          { key: 'outstanding', label: D.paymentStatus.cols.outstanding, type: 'money' },
          { key: 'age', label: D.paymentStatus.cols.age, type: 'number' },
          { key: 'owner', label: C.salesExecutive },
        ],
        rows: rows.sort((a, b) => n(b.age) - n(a.age)),
        chart: { polarity: 'ageing', label: D.paymentStatus.chart, unit: '₹', money: true, data: c.ageing.map((b) => ({ key: b.key, label: b.label, value: b.amount })) },
        kpis: [
          { label: D.paymentStatus.tiles.due, value: `money:${c.dueAmount}` },
          { label: D.paymentStatus.tiles.received, value: `money:${c.received}` },
          { label: D.paymentStatus.tiles.overdue, value: `money:${c.overdueAmount}`, hint: D.paymentStatus.overdueHint(c.overdueCount) },
        ],
      };
    },
  },
];
