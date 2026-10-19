/** FR-012 customer reports, FR-026 lead reports, FR-048 quotation reports, FR-059 order reports. */
import { addDays } from '../../../lib/dates';
import { coverageFor } from '../../lookups';
import { getPolicies } from '../../policies';
import { BACKLOG, collections, dayOf, inRange, isBooked, isOpenOpp, leadResponseHours, ms, outstandingOf, quoteToOrder, sum, winRate } from '../kpis';
import { applyFilters, empName, groupBy, label, list, monthKey, n, pctOf, peek, s, top } from '../helpers';
import type { ReportDef, ReportRow } from '../types';

const row = (key: string, o: Record<string, unknown>): ReportRow => ({ _key: key, ...o });
const latest = <T extends Record<string, unknown>>(qs: T[]) => qs.filter((q) => q.isLatest !== false && q.status !== 'superseded');

export const salesReports: ReportDef[] = [
  // ---------------------------------------------------------------- FR-012 customers
  {
    id: 'customer-sales',
    title: 'Customer-wise sales',
    group: 'customers',
    fr: ['FR-012'],
    description: 'Booked order value per customer in the period, with open pipeline and installed machines.',
    needs: ['customers', 'salesOrders'],
    filters: { date: 'past', division: true, owner: true },
    dateLabel: 'Order date',
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
          { key: 'customer', label: 'Customer', link: peek('customers') },
          { key: 'orders', label: 'Orders', type: 'number' },
          { key: 'value', label: 'Booked value', type: 'money' },
          { key: 'lastOrder', label: 'Last order', type: 'date' },
          { key: 'pipeline', label: 'Open pipeline', type: 'money' },
          { key: 'machines', label: 'Machines', type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.value) - n(a.value)),
        chart: { polarity: 'higher', label: 'Top 10 customers by booked value', unit: '₹', money: true, data: top(rows.map((r) => ({ key: r._key, label: s(r.customer), value: n(r.value) }))) },
        kpis: [
          { label: 'Customers ordering', value: String(rows.length) },
          { label: 'Booked value', value: `money:${sum(orders, 'grandTotal')}` },
        ],
      };
    },
  },
  {
    id: 'machine-history',
    title: 'Machine history',
    group: 'customers',
    fr: ['FR-012', 'FR-074'],
    description: 'Every installed machine with its service history in the period and today’s coverage.',
    needs: ['machines'],
    filters: { date: 'past', division: true },
    dateLabel: 'Ticket date',
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
          { key: 'serial', label: 'Serial', link: peek('machines') },
          { key: 'model', label: 'Model' },
          { key: 'customer', label: 'Customer' },
          { key: 'installDate', label: 'Installed', type: 'date' },
          { key: 'coverage', label: 'Coverage today', type: 'status', master: 'coverage' },
          { key: 'tickets', label: 'Tickets', type: 'number' },
          { key: 'breakdowns', label: 'Breakdowns', type: 'number' },
          { key: 'lastTicket', label: 'Last ticket', type: 'date' },
          { key: 'pmDone', label: 'PM visits done', type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.tickets) - n(a.tickets)),
        chart: { polarity: 'lower', label: 'Machines with most tickets', unit: 'tickets', data: top(rows.map((r) => ({ key: r._key, label: s(r.serial), value: n(r.tickets) }))) },
      };
    },
  },
  {
    id: 'warranty-expiry',
    title: 'Warranty expiry',
    group: 'installed',
    fr: ['FR-012', 'FR-074'],
    description: 'Warranties ending in the selected window — the AMC/CMC upsell list.',
    needs: ['warranties'],
    filters: { date: 'future', division: true },
    dateLabel: 'Warranty end date',
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
          hasContract: amc.some((c) => c.machineId === w.machineId && ['active', 'due_for_renewal', 'draft'].includes(s(c.status)) && dayOf(c.endDate) > dayOf(w.endDate)) ? 'Yes' : 'No',
        });
      });
      const byMonth = groupBy(rows, (r) => monthKey(r.endDate));
      return {
        columns: [
          { key: 'serial', label: 'Machine', link: peek('warranties') },
          { key: 'customer', label: 'Customer' },
          { key: 'endDate', label: 'Warranty ends', type: 'date' },
          { key: 'daysLeft', label: 'Days left', type: 'number' },
          { key: 'hasContract', label: 'AMC/CMC lined up' },
        ],
        rows: rows.sort((a, b) => n(a.daysLeft) - n(b.daysLeft)),
        chart: { polarity: 'neutral', label: 'Warranties ending per month', unit: 'machines', data: [...byMonth.entries()].sort().map(([k, v]) => ({ key: k, label: k, value: v.length })) },
        kpis: [{ label: 'Without an AMC/CMC lined up', value: String(rows.filter((r) => r.hasContract === 'No').length) }],
      };
    },
  },
  {
    id: 'amc-renewals-due',
    title: 'AMC renewals due',
    group: 'installed',
    fr: ['FR-012', 'FR-074'],
    description: 'Active and due-for-renewal AMC/CMC contracts ending in the window.',
    needs: ['amcContracts'],
    filters: { date: 'future', division: true, owner: true },
    dateLabel: 'Contract end date',
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
          { key: 'contract', label: 'Contract', link: peek('amcContracts') },
          { key: 'customer', label: 'Customer' },
          { key: 'type', label: 'Type', type: 'status', master: 'amcType' },
          { key: 'endDate', label: 'Ends', type: 'date' },
          { key: 'daysLeft', label: 'Days left', type: 'number' },
          { key: 'value', label: 'Value', type: 'money' },
          { key: 'status', label: 'Status', type: 'status', master: 'amcStatus' },
          { key: 'owner', label: 'Sales owner' },
        ],
        rows: rows.sort((a, b) => n(a.daysLeft) - n(b.daysLeft)),
        chart: { polarity: 'neutral', label: 'Renewal value by month', unit: '₹', money: true, data: [...groupBy(rows, (r) => monthKey(r.endDate)).entries()].sort().map(([k, v]) => ({ key: k, label: k, value: v.reduce((t, r) => t + n(r.value), 0) })) },
        kpis: [{ label: 'Value up for renewal', value: `money:${rows.reduce((t, r) => t + n(r.value), 0)}` }],
      };
    },
  },
  {
    id: 'dormant-customers',
    title: 'Dormant customers',
    group: 'customers',
    fr: ['FR-012'],
    description: 'Customers with no order and no logged activity within the dormant period set in business policies.',
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
          { key: 'customer', label: 'Customer', link: peek('customers') },
          { key: 'category', label: 'Category', type: 'status', master: 'customerCategory' },
          { key: 'owner', label: 'Owner' },
          { key: 'lastOrder', label: 'Last order', type: 'date' },
          { key: 'lastTouch', label: 'Last order or activity', type: 'date' },
          { key: 'idleDays', label: 'Days idle', type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.idleDays) - n(a.idleDays)),
        kpis: [{ label: 'Dormant customers', value: String(rows.length), hint: `No order or activity for ${days}+ days (policy)` }],
      };
    },
  },

  // ---------------------------------------------------------------- FR-026 leads
  {
    id: 'lead-conversion',
    title: 'Lead conversion',
    group: 'leads',
    fr: ['FR-026'],
    description: 'Leads created and converted to opportunities, by month, salesperson, product, source or campaign.',
    needs: ['leads'],
    filters: { date: 'past', division: true, owner: true },
    dateLabel: 'Lead created',
    groupOptions: [
      { value: 'month', label: 'By month' },
      { value: 'owner', label: 'By salesperson' },
      { value: 'product', label: 'By product category' },
      { value: 'source', label: 'By source' },
      { value: 'campaign', label: 'By campaign' },
    ],
    compute: (ds, f) => {
      const leads = applyFilters(ds.get('leads'), f, { date: 'createdAt', owner: 'ownerId' });
      const g = f.group ?? 'month';
      const keyOf = (l: Record<string, unknown>) => (g === 'owner' ? empName(ds, l.ownerId) : g === 'product' ? label('productType', l.productType) : g === 'source' ? label('leadSource', l.sourceId) : g === 'campaign' ? s(l.campaign) || 'No campaign' : monthKey(l.createdAt));
      const rows = [...groupBy(leads, keyOf).entries()].map(([k, ls]) => {
        const q = ls.filter((l) => l.status === 'qualified' || l.opportunityId).length;
        return row(k, { group: k, leads: ls.length, qualified: q, disqualified: ls.filter((l) => l.status === 'disqualified').length, open: ls.filter((l) => ['new', 'contacted', 'nurture'].includes(s(l.status))).length, conversion: pctOf(q, ls.length) });
      });
      const sorted = g === 'month' ? rows.sort((a, b) => s(a.group).localeCompare(s(b.group))) : rows.sort((a, b) => n(b.leads) - n(a.leads));
      const q = leads.filter((l) => l.status === 'qualified' || l.opportunityId).length;
      return {
        columns: [
          { key: 'group', label: g === 'month' ? 'Month' : g === 'owner' ? 'Salesperson' : g === 'product' ? 'Product category' : g === 'source' ? 'Source' : 'Campaign' },
          { key: 'leads', label: 'Leads', type: 'number' },
          { key: 'qualified', label: 'Converted', type: 'number' },
          { key: 'open', label: 'Still open', type: 'number' },
          { key: 'disqualified', label: 'Disqualified', type: 'number' },
          { key: 'conversion', label: 'Conversion', type: 'pct' },
        ],
        rows: sorted,
        chart: { polarity: 'higher', label: 'Conversion %', unit: '%', data: sorted.slice(0, 12).map((r) => ({ key: r._key, label: s(r.group), value: Math.round(n(r.conversion) * 100) })) },
        kpis: [
          { label: 'Leads', value: String(leads.length) },
          { label: 'Conversion', value: `pct:${pctOf(q, leads.length) ?? ''}` },
        ],
      };
    },
  },
  {
    id: 'lead-ageing',
    title: 'Lead ageing',
    group: 'leads',
    fr: ['FR-026'],
    description: 'Open leads by age since creation, oldest first.',
    needs: ['leads'],
    filters: { division: true, owner: true },
    compute: (ds, f, ctx) => {
      const open = applyFilters(ds.get('leads').filter((l) => ['new', 'contacted', 'nurture'].includes(s(l.status))), f, { owner: 'ownerId' });
      const rows = open.map((l) => row(l.id, { id: l.id, lead: ds.name('leads', l.id), status: l.status, owner: empName(ds, l.ownerId), created: dayOf(l.createdAt), age: Math.floor((ctx.nowMs - ms(l.createdAt)) / 86_400_000), nextFollowUp: l.nextFollowUpAt }));
      const buckets = [
        ['0–7 days', 0, 7],
        ['8–15 days', 8, 15],
        ['16–30 days', 16, 30],
        ['31–60 days', 31, 60],
        ['Over 60 days', 61, Infinity],
      ] as const;
      return {
        columns: [
          { key: 'lead', label: 'Lead', link: peek('leads') },
          { key: 'status', label: 'Status', type: 'status', master: 'leadStatus' },
          { key: 'owner', label: 'Owner' },
          { key: 'created', label: 'Created', type: 'date' },
          { key: 'age', label: 'Age (days)', type: 'number' },
          { key: 'nextFollowUp', label: 'Next follow-up', type: 'date' },
        ],
        rows: rows.sort((a, b) => n(b.age) - n(a.age)),
        chart: { polarity: 'ageing', label: 'Open leads by age', unit: 'leads', data: buckets.map(([lb, a, b]) => ({ key: lb, label: lb, value: rows.filter((r) => n(r.age) >= a && n(r.age) <= b).length })) },
      };
    },
  },
  {
    id: 'lead-first-response',
    title: 'First response time',
    group: 'leads',
    fr: ['FR-026', 'FR-020'],
    description: 'Average hours from lead creation to first logged contact, per salesperson, against the first-contact SLA.',
    needs: ['leads'],
    filters: { date: 'past', division: true },
    dateLabel: 'Lead created',
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
          { key: 'owner', label: 'Salesperson' },
          { key: 'leads', label: 'Leads', type: 'number' },
          { key: 'contacted', label: 'Contacted', type: 'number' },
          { key: 'avgHours', label: 'Avg first response', type: 'hours' },
          { key: 'outsideSla', label: `Outside ${sla} h SLA`, type: 'number' },
          { key: 'notAttended', label: 'Not attended now', type: 'number', link: () => list('leads', { view: 'v_leads_not_attended' }) },
        ],
        rows: rows.sort((a, b) => n(b.avgHours) - n(a.avgHours)),
        chart: { polarity: 'lower', label: 'Average first response (hours)', unit: 'h', data: rows.filter((r) => r.avgHours !== null).map((r) => ({ key: r._key, label: s(r.owner), value: Math.round(n(r.avgHours) * 10) / 10 })) },
        kpis: [{ label: 'Average first response', value: `hours:${leadResponseHours(leads) ?? ''}`, hint: `SLA ${sla} h (policy)` }],
      };
    },
  },
  {
    id: 'pending-followups',
    title: 'Pending follow-ups',
    group: 'leads',
    fr: ['FR-026', 'FR-021'],
    description: 'Open leads and opportunities whose next follow-up is today or overdue.',
    needs: ['leads'],
    filters: { division: true, owner: true },
    compute: (ds, f, ctx) => {
      const leads = ds.get('leads').filter((l) => ['new', 'contacted', 'nurture'].includes(s(l.status)));
      const opps = ds.get('opportunities').filter(isOpenOpp);
      const due = applyFilters([...leads.map((r) => ({ ...r, _res: 'leads' })), ...opps.map((r) => ({ ...r, _res: 'opportunities' }))], f, { owner: 'ownerId' }).filter((r) => s(r.nextFollowUpAt) && dayOf(r.nextFollowUpAt) <= ctx.today);
      const rows = due.map((r) => row(`${r._res}:${r.id}`, { id: r.id, res: r._res === 'leads' ? 'Lead' : 'Opportunity', record: ds.name(String(r._res), r.id), owner: empName(ds, r.ownerId), due: r.nextFollowUpAt, overdueDays: Math.round((ms(ctx.today) - ms(dayOf(r.nextFollowUpAt))) / 86_400_000), _link: String(r._res) }));
      return {
        columns: [
          { key: 'record', label: 'Record', link: (r) => peek(String(r._link))(r) },
          { key: 'res', label: 'Type' },
          { key: 'owner', label: 'Owner' },
          { key: 'due', label: 'Follow-up due', type: 'date' },
          { key: 'overdueDays', label: 'Days overdue', type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.overdueDays) - n(a.overdueDays)),
        chart: { polarity: 'lower', label: 'Overdue follow-ups per owner', unit: 'follow-ups', data: top([...groupBy(rows, (r) => s(r.owner)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.length }))) },
      };
    },
  },
  {
    id: 'lost-leads',
    title: 'Lost and disqualified leads',
    group: 'leads',
    fr: ['FR-026', 'FR-023'],
    description: 'Disqualified leads by reason (mandatory reason master).',
    needs: ['leads'],
    filters: { date: 'past', division: true, owner: true },
    dateLabel: 'Lead created',
    compute: (ds, f) => {
      const lost = applyFilters(ds.get('leads').filter((l) => l.status === 'disqualified'), f, { date: 'createdAt', owner: 'ownerId' });
      const rows = [...groupBy(lost, (l) => label('lostReason', l.disqualifyReason)).entries()].map(([k, ls]) => row(k, { reason: k, leads: ls.length, share: pctOf(ls.length, lost.length), budget: sum(ls, 'budget') }));
      return {
        columns: [
          { key: 'reason', label: 'Reason', link: () => list('leads', { view: 'v_leads_all' }) },
          { key: 'leads', label: 'Leads', type: 'number' },
          { key: 'share', label: 'Share', type: 'pct' },
          { key: 'budget', label: 'Stated budget lost', type: 'money' },
        ],
        rows: rows.sort((a, b) => n(b.leads) - n(a.leads)),
        chart: { polarity: 'neutral', label: 'Disqualified leads by reason', unit: 'leads', data: rows.map((r) => ({ key: r._key, label: s(r.reason), value: n(r.leads) })) },
      };
    },
  },
  {
    id: 'exec-performance',
    title: 'Sales executive performance',
    group: 'leads',
    fr: ['FR-026', 'FR-059'],
    description: 'Per salesperson: leads, conversion, opportunities won, booked value and activities in the period.',
    needs: ['leads'],
    filters: { date: 'past', division: true },
    dateLabel: 'Period',
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
          { key: 'owner', label: 'Salesperson' },
          { key: 'leads', label: 'Leads', type: 'number' },
          { key: 'conversion', label: 'Lead conversion', type: 'pct' },
          { key: 'winRate', label: 'Win rate', type: 'pct' },
          { key: 'orders', label: 'Orders', type: 'number' },
          { key: 'booked', label: 'Booked value', type: 'money' },
          { key: 'activities', label: 'Activities', type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.booked) - n(a.booked)),
        chart: { polarity: 'higher', label: 'Booked value per salesperson', unit: '₹', money: true, data: top(rows.map((r) => ({ key: r._key, label: s(r.owner), value: n(r.booked) }))) },
      };
    },
  },

  // ---------------------------------------------------------------- FR-048 quotations
  {
    id: 'quotation-value',
    title: 'Quotation value',
    group: 'quotations',
    fr: ['FR-048'],
    description: 'Quotations raised (latest revisions) and their value, by month or division.',
    needs: ['quotations'],
    filters: { date: 'past', division: true, owner: true },
    dateLabel: 'Quotation date',
    groupOptions: [
      { value: 'month', label: 'By month' },
      { value: 'division', label: 'By division' },
      { value: 'status', label: 'By status' },
    ],
    compute: (ds, f) => {
      const qs = latest(applyFilters(ds.get('quotations'), f, { date: 'quoteDate', owner: 'ownerId' }));
      const g = f.group ?? 'month';
      const keyOf = (q: Record<string, unknown>) => (g === 'division' ? label('division', q.divisionId) : g === 'status' ? label('quoteStatus', q.status) : monthKey(q.quoteDate));
      const rows = [...groupBy(qs, keyOf).entries()].map(([k, v]) => row(k, { group: k, quotes: v.length, value: sum(v, 'grandTotal'), accepted: v.filter((q) => q.status === 'accepted').length, avgDiscount: v.length ? v.reduce((t, q) => t + n(q.maxDiscountPct), 0) / v.length / 100 : null }));
      const sorted = g === 'month' ? rows.sort((a, b) => s(a.group).localeCompare(s(b.group))) : rows.sort((a, b) => n(b.value) - n(a.value));
      return {
        columns: [
          { key: 'group', label: g === 'month' ? 'Month' : g === 'division' ? 'Division' : 'Status' },
          { key: 'quotes', label: 'Quotations', type: 'number' },
          { key: 'value', label: 'Value (incl. GST)', type: 'money' },
          { key: 'accepted', label: 'Accepted', type: 'number' },
          { key: 'avgDiscount', label: 'Avg highest discount', type: 'pct' },
        ],
        rows: sorted,
        chart: { polarity: 'higher', label: 'Quotation value', unit: '₹', money: true, data: sorted.map((r) => ({ key: r._key, label: s(r.group), value: n(r.value) })) },
        kpis: [
          { label: 'Quotations', value: String(qs.length) },
          { label: 'Total value', value: `money:${sum(qs, 'grandTotal')}` },
        ],
      };
    },
  },
  {
    id: 'pending-approvals',
    title: 'Quotations pending approval',
    group: 'quotations',
    fr: ['FR-048', 'FR-040'],
    description: 'Quotations waiting for discount approval, oldest first.',
    needs: ['quotations'],
    filters: { division: true, owner: true },
    compute: (ds, f, ctx) => {
      const qs = applyFilters(ds.get('quotations').filter((q) => q.status === 'pending_approval'), f, { owner: 'ownerId' });
      const rows = qs.map((q) => row(q.id, { id: q.id, quote: s(q.quoteNo) || q.id, customer: ds.name('customers', q.customerId), owner: empName(ds, q.ownerId), discount: n(q.maxDiscountPct) / 100, value: n(q.grandTotal), waitingDays: Math.floor((ctx.nowMs - ms(q.updatedAt)) / 86_400_000) }));
      return {
        columns: [
          { key: 'quote', label: 'Quotation', link: peek('quotations') },
          { key: 'customer', label: 'Customer' },
          { key: 'owner', label: 'Owner' },
          { key: 'discount', label: 'Highest discount', type: 'pct' },
          { key: 'value', label: 'Value', type: 'money' },
          { key: 'waitingDays', label: 'Waiting (days)', type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.waitingDays) - n(a.waitingDays)),
        kpis: [{ label: 'Value awaiting approval', value: `money:${sum(qs, 'grandTotal')}` }],
      };
    },
  },
  {
    id: 'quote-to-order',
    title: 'Quote-to-order conversion',
    group: 'quotations',
    fr: ['FR-048'],
    description: 'Sent quotations that became sales orders, per salesperson.',
    needs: ['quotations', 'salesOrders'],
    filters: { date: 'past', division: true },
    dateLabel: 'Quotation date',
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
          { key: 'owner', label: 'Salesperson' },
          { key: 'sent', label: 'Quotations sent', type: 'number' },
          { key: 'ordered', label: 'Became orders', type: 'number' },
          { key: 'rate', label: 'Quote-to-order', type: 'pct' },
          { key: 'orderedValue', label: 'Ordered value', type: 'money' },
        ],
        rows: rows.sort((a, b) => n(b.rate) - n(a.rate)),
        chart: { polarity: 'higher', label: 'Quote-to-order %', unit: '%', data: rows.filter((r) => r.rate !== null).map((r) => ({ key: r._key, label: s(r.owner), value: Math.round(n(r.rate) * 100) })) },
        kpis: [{ label: 'Quote-to-order', value: `pct:${quoteToOrder(qs, orders) ?? ''}` }],
      };
    },
  },
  {
    id: 'lost-quotations',
    title: 'Lost quotations',
    group: 'quotations',
    fr: ['FR-048'],
    description: 'Rejected and expired quotations with reasons.',
    needs: ['quotations'],
    filters: { date: 'past', division: true, owner: true },
    dateLabel: 'Quotation date',
    compute: (ds, f) => {
      const qs = latest(applyFilters(ds.get('quotations').filter((q) => q.status === 'rejected' || q.status === 'expired'), f, { date: 'quoteDate', owner: 'ownerId' }));
      const reasonOf = (q: Record<string, unknown>) => (q.status === 'expired' ? 'Expired (no response)' : label('lostReason', q.rejectReason));
      const rows = qs.map((q) => row(q.id, { id: q.id, quote: s(q.quoteNo) || q.id, customer: ds.name('customers', q.customerId), status: q.status, reason: reasonOf(q), value: n(q.grandTotal), owner: empName(ds, q.ownerId) }));
      return {
        columns: [
          { key: 'quote', label: 'Quotation', link: peek('quotations') },
          { key: 'customer', label: 'Customer' },
          { key: 'status', label: 'Status', type: 'status', master: 'quoteStatus' },
          { key: 'reason', label: 'Reason' },
          { key: 'value', label: 'Value', type: 'money' },
          { key: 'owner', label: 'Owner' },
        ],
        rows: rows.sort((a, b) => n(b.value) - n(a.value)),
        chart: { polarity: 'neutral', label: 'Lost value by reason', unit: '₹', money: true, data: [...groupBy(rows, (r) => s(r.reason)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.reduce((t, r) => t + n(r.value), 0) })) },
      };
    },
  },
  {
    id: 'discount-analysis',
    title: 'Discount analysis',
    group: 'quotations',
    fr: ['FR-048'],
    description: 'Highest line discount per quotation, by salesperson and division, against the approval bands.',
    needs: ['quotations'],
    filters: { date: 'past', division: true },
    dateLabel: 'Quotation date',
    groupOptions: [
      { value: 'owner', label: 'By salesperson' },
      { value: 'division', label: 'By division' },
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
          { key: 'group', label: g === 'division' ? 'Division' : 'Salesperson' },
          { key: 'quotes', label: 'Quotations', type: 'number' },
          { key: 'avg', label: 'Average discount', type: 'pct' },
          { key: 'max', label: 'Highest discount', type: 'pct' },
          { key: 'aboveFirstBand', label: `Above ${bands[0] ?? 5}% (needed approval)`, type: 'number' },
          { key: 'discountValue', label: 'Discount given', type: 'money' },
        ],
        rows: rows.sort((a, b) => n(b.avg) - n(a.avg)),
        chart: { polarity: 'lower', label: 'Average discount %', unit: '%', data: rows.map((r) => ({ key: r._key, label: s(r.group), value: Math.round(n(r.avg) * 1000) / 10 })) },
      };
    },
  },

  // ---------------------------------------------------------------- FR-059 orders
  {
    id: 'order-value',
    title: 'Order value',
    group: 'orders',
    fr: ['FR-059'],
    description: 'Booked sales orders (confirmed or later) by month, division or order kind.',
    needs: ['salesOrders'],
    filters: { date: 'past', division: true, owner: true },
    dateLabel: 'Order date',
    groupOptions: [
      { value: 'month', label: 'By month' },
      { value: 'division', label: 'By division' },
      { value: 'kind', label: 'Machine vs consumables' },
    ],
    compute: (ds, f) => {
      const os = applyFilters(ds.get('salesOrders').filter(isBooked), f, { date: 'orderDate', owner: 'ownerId' });
      const g = f.group ?? 'month';
      const rows = [...groupBy(os, (o) => (g === 'division' ? label('division', o.divisionId) : g === 'kind' ? label('orderKind', o.orderKind) : monthKey(o.orderDate))).entries()].map(([k, v]) => row(k, { group: k, orders: v.length, value: sum(v, 'grandTotal'), avg: v.length ? sum(v, 'grandTotal') / v.length : 0 }));
      const sorted = g === 'month' ? rows.sort((a, b) => s(a.group).localeCompare(s(b.group))) : rows.sort((a, b) => n(b.value) - n(a.value));
      return {
        columns: [
          { key: 'group', label: g === 'month' ? 'Month' : g === 'division' ? 'Division' : 'Order kind', link: () => list('salesOrders') },
          { key: 'orders', label: 'Orders', type: 'number' },
          { key: 'value', label: 'Order value', type: 'money' },
          { key: 'avg', label: 'Average order', type: 'money' },
        ],
        rows: sorted,
        chart: { polarity: 'higher', label: 'Order value', unit: '₹', money: true, data: sorted.map((r) => ({ key: r._key, label: s(r.group), value: n(r.value) })) },
        kpis: [
          { label: 'Orders booked', value: String(os.length) },
          { label: 'Value booked', value: `money:${sum(os, 'grandTotal')}` },
        ],
      };
    },
  },
  {
    id: 'order-backlog',
    title: 'Order backlog',
    group: 'orders',
    fr: ['FR-059'],
    description: 'Confirmed orders not yet delivered and installed, with age and current step.',
    needs: ['salesOrders'],
    filters: { division: true, owner: true },
    compute: (ds, f, ctx) => {
      const os = applyFilters(ds.get('salesOrders').filter((o) => BACKLOG.includes(s(o.status))), f, { owner: 'ownerId' });
      const rows = os.map((o) => row(o.id, { id: o.id, order: s(o.orderNo) || o.id, customer: ds.name('customers', o.customerId), status: o.status, kind: o.orderKind, value: n(o.grandTotal), age: Math.round((ms(ctx.today) - ms(dayOf(o.orderDate))) / 86_400_000), owner: empName(ds, o.ownerId) }));
      return {
        columns: [
          { key: 'order', label: 'Order', link: peek('salesOrders') },
          { key: 'customer', label: 'Customer' },
          { key: 'status', label: 'Step', type: 'status', master: 'soStatus' },
          { key: 'kind', label: 'Kind', type: 'status', master: 'orderKind' },
          { key: 'value', label: 'Value', type: 'money' },
          { key: 'age', label: 'Age (days)', type: 'number' },
          { key: 'owner', label: 'Owner' },
        ],
        rows: rows.sort((a, b) => n(b.age) - n(a.age)),
        chart: { polarity: 'neutral', label: 'Backlog value by step', unit: '₹', money: true, data: BACKLOG.map((st) => ({ key: st, label: label('soStatus', st), value: rows.filter((r) => r.status === st).reduce((t, r) => t + n(r.value), 0) })).filter((d) => d.value > 0) },
        kpis: [{ label: 'Backlog value', value: `money:${rows.reduce((t, r) => t + n(r.value), 0)}` }],
      };
    },
  },
  {
    id: 'pending-orders',
    title: 'Pending orders',
    group: 'orders',
    fr: ['FR-059'],
    description: 'Orders waiting for approval or on hold.',
    needs: ['salesOrders'],
    filters: { division: true, owner: true },
    compute: (ds, f, ctx) => {
      const os = applyFilters(ds.get('salesOrders').filter((o) => o.status === 'pending_approval' || o.status === 'on_hold'), f, { owner: 'ownerId' });
      const rows = os.map((o) => row(o.id, { id: o.id, order: s(o.orderNo) || o.id, customer: ds.name('customers', o.customerId), status: o.status, reason: s(o.holdReason), value: n(o.grandTotal), waiting: Math.floor((ctx.nowMs - ms(o.updatedAt)) / 86_400_000) }));
      return {
        columns: [
          { key: 'order', label: 'Order', link: peek('salesOrders') },
          { key: 'customer', label: 'Customer' },
          { key: 'status', label: 'Status', type: 'status', master: 'soStatus' },
          { key: 'reason', label: 'Hold reason' },
          { key: 'value', label: 'Value', type: 'money' },
          { key: 'waiting', label: 'Waiting (days)', type: 'number' },
        ],
        rows: rows.sort((a, b) => n(b.waiting) - n(a.waiting)),
      };
    },
  },
  {
    id: 'delayed-dispatches',
    title: 'Delayed dispatches',
    group: 'orders',
    fr: ['FR-059', 'FR-061'],
    description: 'Dispatches delivered after, or still in transit past, the expected delivery date.',
    needs: ['dispatches'],
    filters: { date: 'past', division: true },
    dateLabel: 'Dispatch date',
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
          { key: 'order', label: 'Order', link: peek('dispatches') },
          { key: 'customer', label: 'Customer' },
          { key: 'transporter', label: 'Transporter' },
          { key: 'expected', label: 'Expected', type: 'date' },
          { key: 'actual', label: 'Delivered', type: 'date' },
          { key: 'delay', label: 'Delay (days)', type: 'number' },
          { key: 'status', label: 'Status', type: 'status', master: 'dispatchStatus' },
        ],
        rows: rows.sort((a, b) => n(b.delay) - n(a.delay)),
        kpis: [
          { label: 'Delayed', value: `${rows.length} of ${dsp.length}` },
          { label: 'On-time dispatch', value: `pct:${dsp.length ? 1 - rows.length / dsp.length : ''}` },
        ],
      };
    },
  },
  {
    id: 'payment-status',
    title: 'Payment status and overdues',
    group: 'orders',
    fr: ['FR-059', 'FR-055'],
    description: 'Payment milestones received vs due, overdue amount and ageing (receipts from ERP, simulated).',
    needs: ['paymentMilestones'],
    filters: { date: 'past', division: true, owner: true },
    dateLabel: 'Due date',
    compute: (ds, f, ctx) => {
      const ms_ = applyFilters(ds.get('paymentMilestones'), f, { date: 'dueDate', owner: 'ownerId' });
      const c = collections(ms_, ctx.today);
      const overdue = ms_.filter((m) => dayOf(m.dueDate) < ctx.today && outstandingOf(m) > 0);
      const rows = overdue.map((m) => row(m.id, { id: m.id, milestone: s(m.label), order: ds.name('salesOrders', m.salesOrderId), customer: ds.name('customers', m.customerId), due: m.dueDate, outstanding: outstandingOf(m), age: Math.round((ms(ctx.today) - ms(dayOf(m.dueDate))) / 86_400_000), owner: empName(ds, m.ownerId) }));
      return {
        columns: [
          { key: 'milestone', label: 'Milestone', link: peek('paymentMilestones') },
          { key: 'order', label: 'Order' },
          { key: 'customer', label: 'Customer' },
          { key: 'due', label: 'Due', type: 'date' },
          { key: 'outstanding', label: 'Outstanding', type: 'money' },
          { key: 'age', label: 'Days overdue', type: 'number' },
          { key: 'owner', label: 'Owner' },
        ],
        rows: rows.sort((a, b) => n(b.age) - n(a.age)),
        chart: { polarity: 'ageing', label: 'Overdue amount by age', unit: '₹', money: true, data: c.ageing.map((b) => ({ key: b.key, label: b.label, value: b.amount })) },
        kpis: [
          { label: 'Due in period', value: `money:${c.dueAmount}` },
          { label: 'Received', value: `money:${c.received}` },
          { label: 'Overdue', value: `money:${c.overdueAmount}`, hint: `${c.overdueCount} milestone(s)` },
        ],
      };
    },
  },
];
