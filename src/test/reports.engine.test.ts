/**
 * Report engine QA: ranges, totals vs chart vs KPIs, big and tiny data, odd numbers, Excel export.
 * Every report × view × group-by is run for the administrator on the full seed unless a case says otherwise.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayKey } from '../lib/dates';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { runReport } from '../services/api/reports';
import { REPORTS } from '../services/reports/catalog';
import { chartFrom, totalsFor } from '../services/reports/engine';
import { compactInr, formatInr, formatMetric, formatReportDate } from '../services/reports/format';
import { buildReportWorkbook } from '../services/reports/excel';
import { presetsFor, previousPeriod } from '../services/reports/periods';
import { ratio, sum, weighted } from '../services/reports/metrics';
import { buildXlsx } from '../lib/xlsx';
import type { ReportColumn, ReportFilters, ReportRow } from '../services/reports/types';

const admin = () => actorFor('u_rahul', 'tc');
const row = (key: string, o: Record<string, unknown>): ReportRow => ({ _key: key, ...o });

/** Run every view (and every group-by) of every report; returns each id with its output. */
function runAll(filters: ReportFilters, actor = admin()) {
  const out: { id: string; res: ReturnType<typeof runReport> }[] = [];
  for (const r of REPORTS)
    for (const v of r.views)
      for (const group of v.groupOptions?.map((g) => g.value) ?? [undefined]) out.push({ id: `${r.id}/${v.id}/${group ?? '-'}`, res: runReport(actor, r.id, v.id, { ...filters, group }) });
  return out;
}

describe('periods', () => {
  it('compares a range with the equal-length period just before it', () => {
    expect(previousPeriod({ from: '2026-10-20', to: '2026-10-20' })).toEqual({ from: '2026-10-19', to: '2026-10-19' });
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-31' })).toEqual({ from: '2026-08-31', to: '2026-09-30' });
    expect(previousPeriod({ from: '2025-12-20', to: '2026-01-10' })).toEqual({ from: '2025-11-28', to: '2025-12-19' });
    expect(previousPeriod({ from: '2025-10-21', to: '2026-10-20' })).toEqual({ from: '2024-10-21', to: '2025-10-20' });
  });
  it('has no previous period for open, reversed or empty ranges', () => {
    expect(previousPeriod({})).toBeNull();
    expect(previousPeriod({ from: '2026-01-01' })).toBeNull();
    expect(previousPeriod({ from: '2026-02-01', to: '2026-01-01' })).toBeNull();
  });
  it('builds presets that end today (past) or start today (future), in Indian financial years', () => {
    const past = presetsFor('past', '2026-10-20');
    expect(past.find((p) => p.id === 'today')!.range).toEqual({ from: '2026-10-20', to: '2026-10-20' });
    expect(past.find((p) => p.id === 'fy')!.range).toEqual({ from: '2026-04-01', to: '2026-10-20' });
    expect(presetsFor('past', '2026-02-10').find((p) => p.id === 'fy')!.range.from).toBe('2025-04-01');
    expect(past.find((p) => p.id === 'lastMonth')!.range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(past.find((p) => p.id === 'qtd')!.range.from).toBe('2026-10-01');
    expect(presetsFor('past', '2026-01-05').find((p) => p.id === 'lastMonth')!.range).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetsFor('future', '2026-10-20').find((p) => p.id === 'next30')!.range).toEqual({ from: '2026-10-20', to: '2026-11-19' });
    expect(past.find((p) => p.id === 'all')!.range).toEqual({});
  });
});

describe('formatting', () => {
  it('writes ₹ with Indian grouping, no paise, and negatives with a sign', () => {
    expect(formatInr(100000)).toBe('₹1,00,000');
    expect(formatInr(1000000000)).toBe('₹1,00,00,00,000');
    expect(formatInr(0)).toBe('₹0');
    expect(formatInr(-1200)).toBe('-₹1,200');
    expect(formatInr(-12345678)).toBe('-₹1,23,45,678');
    expect(compactInr(100000000)).toBe('₹10 Cr');
    expect(compactInr(-250000)).toBe('-₹2.5 L');
    expect(compactInr(0)).toBe('₹0');
    expect(formatMetric(0.4213, 'pct')).toBe('42.1%');
    expect(formatMetric(null, 'money')).toBe('');
    expect(formatReportDate('2026-10-05')).toBe('05 Oct 2026');
  });
});

describe('metrics and totals', () => {
  const rows = [row('a', { n: 2, d: 4, h: 10, w: 1 }), row('b', { n: 3, d: 0, h: null, w: 3 }), row('c', { n: null, d: 6, h: 20, w: 1 })];
  it('adds up, divides and weights without choking on blanks or zero denominators', () => {
    expect(sum('n')(rows)).toBe(5);
    expect(ratio('n', 'd')(rows)).toBe(0.5);
    expect(ratio('n', 'zero')(rows)).toBeNull();
    expect(weighted('h', 'w')(rows)).toBe(15);
    expect(sum('n')([])).toBe(0);
    expect(weighted('h', 'w')([])).toBeNull();
  });
  it('totals a column the way it says, and re-totals a subset', () => {
    const cols: ReportColumn[] = [
      { key: 'n', label: 'N', total: 'sum' },
      { key: 'r', label: 'R', total: ratio('n', 'd') },
      { key: 'x', label: 'X' },
    ];
    expect(totalsFor(cols, rows)).toEqual({ n: 5, r: 0.5 });
    expect(totalsFor(cols, rows.slice(0, 1))).toEqual({ n: 2, r: 0.5 });
    expect(totalsFor(cols, [])).toEqual({ n: 0, r: null });
  });
});

describe('chart data', () => {
  const col: ReportColumn = { key: 'k', label: 'K' };
  const many = (n: number) => Array.from({ length: n }, (_, i) => row(`r${i}`, { k: `Category ${i}`, v: i + 1 }));
  it('folds 20+ categories into "Others" that still add up', () => {
    for (const type of ['hbar', 'bar', 'donut'] as const) {
      const c = chartFrom({ type, title: 't', x: 'k', y: 'v', fmt: 'number' }, [col], many(30));
      const total = many(30).reduce((t, r) => t + Number(r.v), 0);
      expect(c.points.reduce((t, p) => t + p.value, 0), type).toBe(total);
      expect(c.points.filter((p) => p.others), type).toHaveLength(1);
      expect(c.points.length, type).toBeLessThanOrEqual(12);
      expect(c.points[0].value, `${type} ranked`).toBe(30);
    }
  });
  it('cuts rate charts (cannot be summed) and says how many were hidden', () => {
    const c = chartFrom({ type: 'hbar', title: 't', x: 'k', y: 'v', fmt: 'pct' }, [col], many(25));
    expect(c.points).toHaveLength(10);
    expect(c.hiddenCount).toBe(15);
    expect(c.points.some((p) => p.others)).toBe(false);
  });
  it('keeps given order for ageing bands, draws negatives, and leaves slices positive', () => {
    const bands = [row('a', { k: '0–7', v: 5 }), row('b', { k: '8–15', v: 9 }), row('c', { k: '16+', v: 1 })];
    expect(chartFrom({ type: 'bar', title: 't', x: 'k', y: 'v', fmt: 'number', keepOrder: true }, [col], bands).points.map((p) => p.label)).toEqual(['0–7', '8–15', '16+']);
    const neg = [row('a', { k: 'Credit note', v: -500 }), row('b', { k: 'Invoice', v: 900 })];
    expect(chartFrom({ type: 'bar', title: 't', x: 'k', y: 'v', fmt: 'money' }, [col], neg).points.map((p) => p.value)).toEqual([900, -500]);
    expect(chartFrom({ type: 'donut', title: 't', x: 'k', y: 'v', fmt: 'money' }, [col], neg).points.map((p) => p.value)).toEqual([900]);
    expect(chartFrom({ type: 'line', title: 't', x: 'k', y: 'v', fmt: 'number' }, [col], [row('z', { k: 'Zero', v: 0 })]).points).toHaveLength(1);
    expect(chartFrom({ type: 'hbar', title: 't', x: 'k', y: 'v', fmt: 'number' }, [col], []).points).toEqual([]);
  });
});

describe('every report: totals, chart and cards come from the same rows', () => {
  beforeEach(() => __setDb(createDb()));
  it('column totals equal the sum of the rows, and an additive chart adds up to its column total', () => {
    const f = { from: addDays(todayKey(), -364), to: todayKey() };
    for (const r of REPORTS)
      for (const v of r.views)
        for (const group of v.groupOptions?.map((g) => g.value) ?? [undefined]) {
          const id = `${r.id}/${v.id}/${group ?? '-'}`;
          const filters = { ...f, group };
          const res = runReport(admin(), r.id, v.id, filters);
          res.columns.filter((c) => c.total === 'sum').forEach((c) => expect(res.totals[c.key], `${id} ${c.key}`).toBeCloseTo(res.rows.reduce((t, x) => t + (Number(x[c.key]) || 0), 0), 6));
          const spec = typeof v.chart === 'function' ? v.chart(filters) : v.chart;
          const custom = !!v.compute({ get: () => [], name: () => '' }, filters, { actor: admin(), today: todayKey(), nowMs: Date.now() }).points;
          const yCol = res.columns.find((c) => c.key === spec?.y);
          if (spec && !custom && yCol?.total === 'sum' && (spec.fmt === 'money' || spec.fmt === 'number') && spec.type !== 'line' && spec.type !== 'area' && !spec.noOthers) {
            // (a chart that names the top few cuts its long tail on purpose; the table keeps every row)
            const positive = res.rows.reduce((t, x) => t + Math.max(0, Number(x[spec.y]) || 0), 0);
            const charted = res.chart!.points.reduce((t, p) => t + Math.max(0, p.value), 0);
            expect(charted, `${id} chart vs total`).toBeCloseTo(positive, 6);
          }
        }
  });
  it('carries every KPI figure as a number or null (never NaN) and compares only bounded ranges', () => {
    runAll({ from: addDays(todayKey(), -89), to: todayKey() }).forEach(({ id, res }) =>
      res.kpis.forEach((k) => {
        expect(k.value === null || Number.isFinite(k.value), `${id} ${k.label}`).toBe(true);
        if (k.delta !== null) expect(Number.isFinite(k.delta), `${id} ${k.label} delta`).toBe(true);
      }),
    );
    const open = runReport(admin(), 'customer-sales', 'sales', {});
    expect(open.compared).toBeUndefined();
    expect(open.kpis.every((k) => k.prev === undefined && k.delta === null)).toBe(true);
  });
});

describe('date range matrix', () => {
  beforeEach(() => __setDb(createDb()));
  const t = () => todayKey();
  const cases: [string, () => ReportFilters][] = [
    ['today', () => ({ from: t(), to: t() })],
    ['a single day in the past', () => ({ from: addDays(t(), -40), to: addDays(t(), -40) })],
    ['one year', () => ({ from: addDays(t(), -364), to: t() })],
    ['across a year boundary', () => ({ from: '2025-12-15', to: '2026-01-15' })],
    ['entirely in the future', () => ({ from: addDays(t(), 30), to: addDays(t(), 400) })],
    ['all time', () => ({})],
    ['before any data existed', () => ({ from: '2010-01-01', to: '2010-12-31' })],
  ];
  for (const [name, f] of cases)
    it(`runs every view for ${name} without error`, () => {
      const all = runAll(f());
      expect(all.length).toBeGreaterThan(30);
      all.forEach(({ id, res }) => {
        expect(Array.isArray(res.rows), id).toBe(true);
        expect(new Set(res.rows.map((r) => r._key)).size, `${id} unique keys`).toBe(res.rows.length);
      });
    });
  it('keeps monthly rows inside the chosen range', () => {
    const f = { from: '2026-08-10', to: '2026-09-20' };
    runReport(admin(), 'lead-conversion', 'conversion', f).rows.forEach((r) => expect(String(r.group) >= '2026-08' && String(r.group) <= '2026-09').toBe(true));
  });
});

/** Views whose rows are a fixed list (every KPI, every stage), not records: they keep their rows when there is no data. */
const FIXED_ROWS = new Set(['business-scorecard/scorecard/-', 'pipeline-forecast/stage/-']);
// Attendance exceptions list one row per person per day (no check-in), like the live Exception Dashboard.
const PER_DAY_ROWS = new Set(['attendance/exceptions/-']);

describe('no data, one row, many rows', () => {
  const resources = () => Object.keys(getDb().records);
  it('shows empty reports (no rows, N/A or zero figures, no chart marks) instead of failing', () => {
    __setDb(createDb());
    resources().forEach((k) => (getDb().records[k] = []));
    runAll({ from: addDays(todayKey(), -89), to: todayKey() }).forEach(({ id, res }) => {
      if (FIXED_ROWS.has(id)) expect(res.rows.length, id).toBeGreaterThan(0);
      else expect(res.rows, id).toEqual([]);
      res.kpis.forEach((k) => expect(k.value === null || k.value === 0, `${id} ${k.label}`).toBe(true));
      expect((res.chart?.points ?? []).every((p) => p.value === 0), `${id} chart`).toBe(true);
    });
  });
  it('handles a single record per resource', () => {
    __setDb(createDb());
    resources().forEach((k) => (getDb().records[k] = getDb().records[k].slice(0, 1)));
    runAll({ from: addDays(todayKey(), -400), to: addDays(todayKey(), 400) }).forEach(({ id, res }) => {
      if (!FIXED_ROWS.has(id) && !PER_DAY_ROWS.has(id)) expect(res.rows.length, id).toBeLessThanOrEqual(3);
      res.kpis.forEach((k) => expect(k.value === null || Number.isFinite(k.value), `${id} ${k.label}`).toBe(true));
    });
  });
  it('runs on 10,000 records of each big resource in reasonable time, with a readable chart', () => {
    __setDb(createDb());
    const db = getDb();
    for (const key of ['leads', 'tickets', 'salesOrders', 'quotations', 'activities', 'attendance', 'paymentMilestones']) {
      const base = db.records[key];
      if (!base.length) continue;
      const out = [...base];
      for (let i = 0; out.length < 10_000; i++) out.push({ ...base[i % base.length], id: `${key}-x${i}` });
      db.records[key] = out;
    }
    const t0 = performance.now();
    const all = runAll({ from: addDays(todayKey(), -364), to: todayKey() });
    const ms = performance.now() - t0;
    expect(ms, `all views on 10k rows took ${Math.round(ms)} ms`).toBeLessThan(60_000);
    all.forEach(({ id, res }) => {
      expect(res.chart?.points.length ?? 0, id).toBeLessThanOrEqual(400);
      expect(new Set(res.rows.map((r) => r._key)).size, `${id} unique keys`).toBe(res.rows.length);
    });
    const big = runReport(admin(), 'lead-speed', 'ageing', {});
    expect(big.rows.length).toBeGreaterThan(1000);
    expect(big.chart!.points.length).toBeLessThanOrEqual(12);
  });
});

describe('very large, zero and negative amounts', () => {
  beforeEach(() => __setDb(createDb()));
  it('shows ₹10,00,00,000-scale orders in full in the footer and compact on the card', () => {
    const o = getDb().records.salesOrders.find((x) => !['pending_approval', 'cancelled'].includes(String(x.status)))!;
    o.grandTotal = 1_000_000_000;
    o.subtotal = 1_000_000_000;
    o.discountTotal = 0;
    o.taxable = 1_000_000_000; // value before GST = the taxable value (Decision D-1)
    o.orderDate = todayKey();
    const res = runReport(admin(), 'order-value', 'value', { from: addDays(todayKey(), -400), to: todayKey(), group: 'month' });
    expect(res.totals.value!).toBeGreaterThanOrEqual(1_000_000_000);
    expect(formatInr(res.totals.value!).startsWith('₹')).toBe(true);
    expect(formatMetric(res.kpis[1].value, 'money', { compact: true })).toMatch(/Cr$/);
  });
  it('keeps negative and zero amounts (credit notes) in totals', () => {
    const ms = getDb().records.paymentMilestones;
    ms[0].amount = -50_000;
    ms[0].receivedAmount = 0;
    ms[0].dueDate = addDays(todayKey(), -5);
    ms[1].amount = 0;
    ms[1].receivedAmount = 0;
    ms[1].dueDate = addDays(todayKey(), -5);
    const res = runReport(admin(), 'payment-status', 'payments', { from: addDays(todayKey(), -30), to: todayKey() });
    expect(res.totals.amount).toBe(res.rows.reduce((t, r) => t + Number(r.amount), 0));
    expect(res.rows.some((r) => Number(r.amount) < 0)).toBe(true);
    expect(res.rows.some((r) => Number(r.amount) === 0)).toBe(true);
  });
});

/** Reads an .xlsx made by buildXlsx: lists the entries and verifies every CRC-32. */
function readZip(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const dataStart = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const raw = bytes.subarray(dataStart, dataStart + size);
    const data = raw; // the writer stores entries uncompressed
    let c = 0xffffffff;
    for (const b of data) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    expect((c ^ 0xffffffff) >>> 0, `CRC of ${name}`).toBe(crc);
    files.set(name, new TextDecoder().decode(data));
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return files;
}

describe('Excel export', () => {
  beforeEach(() => __setDb(createDb()));
  it('writes a valid workbook whose rows, totals and filters match what the screen shows', () => {
    const res = runReport(admin(), 'customer-sales', 'sales', { from: addDays(todayKey(), -89), to: todayKey() });
    const cols = res.columns.filter((c) => c.key !== 'pipeline');
    const bytes = buildReportWorkbook('Customer-wise Sales', { viewLabel: 'Customer-wise Sales', columns: cols, rows: res.rows, filterLines: ['Order date: Last 90 days'], generatedAt: '20 Oct 2026' });
    const files = readZip(bytes);
    expect([...files.keys()].sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    const sheetRows = [...sheet.matchAll(/<row r="(\d+)">/g)].length;
    expect(sheetRows).toBe(6 + res.rows.length + 1);
    expect(sheet).toContain('Order date: Last 90 days');
    expect(sheet).not.toContain('Open pipeline');
    expect(sheet).toMatch(new RegExp(`<c r="C${sheetRows}" s="\\d+"><v>${res.totals.value}</v></c>`));
    expect(files.get('xl/styles.xml')).toContain('##\\,##\\,##0');
  });
  it('escapes markup and control characters and keeps long text, big numbers and blanks intact', () => {
    const files = readZip(
      buildXlsx({
        sheet: 'A/B?*[x]: long sheet name that is far too long for excel',
        rows: [[{ v: 'Tom & Jerry <b>"x"</b> \u0001bad' }, { v: 1e10, style: 'money' }, { v: null }, { v: 'x'.repeat(400) }]],
      }),
    );
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('Tom &amp; Jerry &lt;b&gt;&quot;x&quot;&lt;/b&gt; bad');
    expect(sheet).toContain('<v>10000000000</v>');
    expect(sheet).toContain('x'.repeat(400));
    const name = /<sheet name="([^"]*)"/.exec(files.get('xl/workbook.xml')!)![1];
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[\\/?*[\]:]/);
  });
});
