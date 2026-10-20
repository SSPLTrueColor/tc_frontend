/** QUO-14 quotation reports: value & conversion, lost quotations, discount analysis. (Pending approvals: /quotations/pending-approvals.) */
import { L } from '../../../constants/labels';
import { getPolicies } from '../../policies';
import { sum } from '../kpis';
import { applyFilters, empName, groupBy, label, monthKey, n, peek, row, s } from '../helpers';
import { count, countIf, maxOf, ratio, sum as sumOf, weighted } from '../metrics';
import type { ReportDef } from '../types';

const D = L.reports.defs;
const C = L.reports.cols;
const G = L.reports.groupBy;
const R = L.reports.rep;
const M = L.reports.more;
const latest = <T extends Record<string, unknown>>(qs: T[]) => qs.filter((q) => q.isLatest !== false && q.status !== 'superseded');
const SENT = ['sent', 'negotiation', 'accepted', 'rejected', 'expired'];

export const quotationReports: ReportDef[] = [
  {
    id: 'quotation-value',
    title: R.quoteValue.title,
    group: 'quotations',
    icon: 'receipt',
    fr: ['FR-048'],
    description: R.quoteValue.description,
    needs: ['quotations'],
    views: [
      {
        id: 'value',
        label: R.quoteValue.title,
        filters: { date: 'past', division: true, owner: true },
        dateLabel: D.quotationValue.dateLabel,
        groupOptions: [
          { value: 'month', label: G.month },
          { value: 'owner', label: G.owner },
          { value: 'division', label: G.division },
          { value: 'status', label: G.status },
        ],
        compute: (ds, f) => {
          const qs = latest(applyFilters(ds.get('quotations'), f, { date: 'quoteDate', owner: 'ownerId' }));
          const orders = ds.get('salesOrders').filter((o) => o.status !== 'cancelled');
          const g = f.group ?? 'month';
          const keyOf = (q: Record<string, unknown>) => (g === 'division' ? label('division', q.divisionId) : g === 'status' ? label('quoteStatus', q.status) : g === 'owner' ? empName(ds, q.ownerId) : monthKey(q.quoteDate));
          const rows = [...groupBy(qs, keyOf).entries()].map(([k, v]) => {
            const sent = v.filter((q) => SENT.includes(s(q.status)) || s(q.sentAt));
            const ordered = sent.filter((q) => orders.some((x) => x.quotationId === q.id));
            return row(k, { group: k, quotes: v.length, value: sum(v, 'grandTotal'), sent: sent.length, ordered: ordered.length, rate: sent.length ? ordered.length / sent.length : null, avgDiscount: v.length ? v.reduce((t, q) => t + n(q.maxDiscountPct), 0) / v.length / 100 : null, accepted: v.filter((q) => q.status === 'accepted').length });
          });
          return {
            columns: [
              { key: 'group', label: g === 'month' ? C.month : g === 'division' ? C.division : g === 'owner' ? C.salesExecutive : C.status, type: g === 'month' ? 'month' : 'text' },
              { key: 'quotes', label: C.quotations, type: 'number', total: 'sum' },
              { key: 'value', label: D.quotationValue.cols.value, type: 'money', total: 'sum' },
              { key: 'ordered', label: D.quoteToOrder.cols.ordered, type: 'number', total: 'sum' },
              { key: 'rate', label: D.quoteToOrder.cols.rate, type: 'pct', total: ratio('ordered', 'sent') },
              { key: 'avgDiscount', label: D.quotationValue.cols.avgDiscount, type: 'pct', total: weighted('avgDiscount', 'quotes') },
              { key: 'accepted', label: D.quotationValue.cols.accepted, type: 'number', total: 'sum' },
              { key: 'sent', label: D.quoteToOrder.cols.sent, type: 'number', total: 'sum', optional: true },
            ],
            rows: g === 'month' ? rows.sort((a, b) => s(a.group).localeCompare(s(b.group))) : rows.sort((a, b) => n(b.value) - n(a.value)),
          };
        },
        kpis: [
          { label: D.quotationValue.tiles.quotations, fmt: 'number', value: sumOf('quotes') },
          { label: D.quotationValue.tiles.total, fmt: 'money', value: sumOf('value') },
          { label: D.quoteToOrder.tile, fmt: 'pct', value: ratio('ordered', 'sent'), hint: D.kpiSummary.definitions.q2o },
          { label: D.quotationValue.cols.avgDiscount, fmt: 'pct', value: weighted('avgDiscount', 'quotes'), better: 'down' },
        ],
        chart: (f) => (!f.group || f.group === 'month' ? { type: 'combo', title: M.quoteComboTitle, x: 'group', y: 'value', fmt: 'money', y2: 'rate', fmt2: 'pct', label: M.quotedValue, label2: M.quoteRate } : { type: 'hbar', title: R.quoteValue.chartBy, x: 'group', y: 'value', fmt: 'money' }),
      },
    ],
  },
  {
    id: 'lost-quotations',
    title: D.lostQuotations.title,
    group: 'quotations',
    icon: 'undo',
    fr: ['FR-048'],
    description: R.lostQuotes.description,
    needs: ['quotations'],
    views: [
      {
        id: 'lost',
        label: D.lostQuotations.title,
        filters: { date: 'past', division: true, owner: true },
        dateLabel: D.lostQuotations.dateLabel,
        compute: (ds, f) => {
          const qs = latest(applyFilters(ds.get('quotations').filter((q) => q.status === 'rejected' || q.status === 'expired'), f, { date: 'quoteDate', owner: 'ownerId' }));
          const reasonOf = (q: Record<string, unknown>) => (q.status === 'expired' ? D.lostQuotations.expired : label('lostReason', q.rejectReason));
          const rows = qs.map((q) => row(q.id, { id: q.id, quote: s(q.quoteNo) || q.id, customer: ds.name('customers', q.customerId), status: q.status, reason: reasonOf(q), value: n(q.grandTotal), owner: empName(ds, q.ownerId) })).sort((a, b) => n(b.value) - n(a.value));
          return {
            columns: [
              { key: 'quote', label: C.quotationNumber, link: peek('quotations') },
              { key: 'customer', label: C.customer },
              { key: 'status', label: C.status, type: 'status', master: 'quoteStatus' },
              { key: 'reason', label: D.lostQuotations.cols.reason },
              { key: 'value', label: C.value, type: 'money', total: 'sum' },
              { key: 'owner', label: C.salesExecutive },
            ],
            rows,
            points: [...groupBy(rows, (r) => s(r.reason)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.reduce((t, r) => t + n(r.value), 0) })),
          };
        },
        kpis: [
          { label: R.lostQuotes.kpis.lost, fmt: 'number', value: count, better: 'down' },
          { label: R.lostQuotes.kpis.value, fmt: 'money', value: sumOf('value'), better: 'down' },
          { label: R.lostQuotes.kpis.rejected, fmt: 'number', value: countIf((r) => r.status === 'rejected'), better: 'down' },
          { label: R.lostQuotes.kpis.expired, fmt: 'number', value: countIf((r) => r.status === 'expired'), better: 'down' },
        ],
        chart: { type: 'donut', title: D.lostQuotations.chart, x: 'reason', y: 'value', fmt: 'money' },
      },
    ],
  },
  {
    id: 'discount-analysis',
    title: D.discountAnalysis.title,
    group: 'quotations',
    icon: 'percent',
    fr: ['FR-048'],
    description: R.discount.description,
    needs: ['quotations'],
    views: [
      {
        id: 'discount',
        label: D.discountAnalysis.title,
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
          return {
            columns: [
              { key: 'group', label: g === 'division' ? C.division : C.salesExecutive },
              { key: 'quotes', label: C.quotations, type: 'number', total: 'sum' },
              { key: 'avg', label: D.discountAnalysis.cols.avg, type: 'pct', total: weighted('avg', 'quotes') },
              { key: 'max', label: D.discountAnalysis.cols.max, type: 'pct', total: maxOf('max') },
              { key: 'aboveFirstBand', label: D.discountAnalysis.cols.aboveFirstBand(bands[0] ?? 5), type: 'number', total: 'sum' },
              { key: 'discountValue', label: D.discountAnalysis.cols.discountValue, type: 'money', total: 'sum' },
            ],
            rows: [...groupBy(qs, (q) => (g === 'division' ? label('division', q.divisionId) : empName(ds, q.ownerId))).entries()]
              .map(([k, v]) => {
                const d = v.map((q) => n(q.maxDiscountPct));
                return row(k, { group: k, quotes: v.length, avg: d.length ? d.reduce((t, x) => t + x, 0) / d.length / 100 : null, max: d.length ? Math.max(...d) / 100 : null, aboveFirstBand: d.filter((x) => x > (bands[0] ?? 5)).length, discountValue: sum(v, 'discountTotal') });
              })
              .sort((a, b) => n(b.avg) - n(a.avg)),
          };
        },
        kpis: [
          { label: C.quotations, fmt: 'number', value: sumOf('quotes'), better: 'none' },
          { label: R.discount.kpis.avg, fmt: 'pct', value: weighted('avg', 'quotes'), better: 'down' },
          { label: R.discount.kpis.max, fmt: 'pct', value: maxOf('max'), better: 'down' },
          { label: R.discount.kpis.given, fmt: 'money', value: sumOf('discountValue'), better: 'none' },
        ],
        chart: { type: 'hbar', title: D.discountAnalysis.chart, x: 'group', y: 'avg', fmt: 'pct' },
      },
    ],
  },
];
