/**
 * Phase 3 regression tests (docs/BRD-AUDIT.md 3.1–3.5): one Activity Scorecard calculation, win rate and
 * funnel from the same query, the lead → order funnel never above 100 %, value before GST (Decision D-1),
 * the Target tile never showing someone else's target, and dashboard KPIs moving after a won deal + order.
 */
import '../domain/extensions/index';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, startOfWeek, todayKey } from '../lib/dates';
import type { RecordData } from '../metadata/types';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { runReport } from '../services/api/reports';
import { scorecard } from '../services/field/field';
import { activityScorecard, dayOf, isLiveQuote, netValue, quoteToOrder, scoreTotal } from '../services/reports/kpis';
import { dashboardFor, resolveRange } from '../services/reports/overview';

const admin = () => actorFor('u_rahul', 'tc');
const recs = (k: string) => getDb().records[k] as RecordData[];
const kpi = (d: ReturnType<typeof dashboardFor>, id: string) => d.kpis.find((k) => k.id === id);
const scoreRow = (out: ReturnType<typeof runReport>, key: string) => {
  const v = /^[a-z]+:(.*)$/.exec(String(out.rows.find((r) => r._key === key)?.value ?? ''));
  return v && v[1] !== '' ? Number(v[1]) : null;
};

describe('KPI consistency', () => {
  beforeEach(() => __setDb(createDb()));

  it('3.1: /activity-scorecard and the Business Scorecard use one calculation for the same week', () => {
    const ws = startOfWeek(addDays(todayKey(), -7));
    const we = addDays(ws, 6);
    const page = scorecard(admin(), ws);
    const all = activityScorecard({ activities: recs('activities'), fieldVisits: recs('fieldVisits'), demos: recs('demos'), quotations: recs('quotations'), leads: recs('leads'), from: ws, to: we });
    // Every person on the page has exactly the shared counts.
    page.forEach((r) => {
      const c = all.get(String(r.employee.id)) ?? { calls: 0, visits: 0, demos: 0, quotations: 0, referrals: 0 };
      expect({ calls: r.calls, visits: r.visits, demos: r.demos, quotations: r.quotations, referrals: r.referrals }).toEqual(c);
      expect(r.total).toBe(scoreTotal(c));
    });
    // The report row is the same calculation over the report's own dates (not a fixed last-7-days window).
    const out = runReport(admin(), 'business-scorecard', 'scorecard', { from: ws, to: we });
    expect(scoreRow(out, 'scorecard')).toBe([...all.values()].reduce((t, c) => t + scoreTotal(c), 0));
  });

  it('3.1: a completed field visit counts once even though it also writes a visit activity', () => {
    const v = recs('fieldVisits').find((x) => x.status === 'completed')!;
    const day = String(v.checkOutAt ?? v.checkInAt).slice(0, 10);
    const linked = recs('activities').filter((a) => a.activityType === 'visit' && a.byId === v.employeeId && String(a.at).slice(0, 16) === String(v.checkOutAt ?? v.checkInAt).slice(0, 16));
    expect(linked.length).toBeGreaterThan(0); // the seed writes the timeline entry
    const sc = activityScorecard({ activities: recs('activities'), fieldVisits: recs('fieldVisits'), demos: [], quotations: [], leads: [], from: day, to: day });
    const completedThatDay = recs('fieldVisits').filter((x) => x.status === 'completed' && x.employeeId === v.employeeId && String(x.checkOutAt ?? x.checkInAt).slice(0, 10) === day).length;
    const manual = recs('activities').filter(
      (a) => a.activityType === 'visit' && a.byId === v.employeeId && String(a.at).slice(0, 10) === day && !recs('fieldVisits').some((x) => x.status === 'completed' && x.employeeId === a.byId && String(x.checkOutAt ?? x.checkInAt).slice(0, 16) === String(a.at).slice(0, 16)),
    ).length;
    expect(sc.get(String(v.employeeId))!.visits).toBe(completedThatDay + manual);
  });

  it('3.1: the Business Scorecard activity total follows the division filter', () => {
    const from = addDays(todayKey(), -29);
    const to = todayKey();
    const all = scoreRow(runReport(admin(), 'business-scorecard', 'scorecard', { from, to }), 'scorecard')!;
    const tx = scoreRow(runReport(admin(), 'business-scorecard', 'scorecard', { from, to, division: 'TX' }), 'scorecard')!;
    expect(tx).toBeLessThanOrEqual(all);
    expect(tx).toBeGreaterThan(0);
  });

  it('3.4: dashboard win rate, Won vs Lost and the funnel Won step come from the same opportunities', () => {
    for (const r of [resolveRange('30d'), resolveRange('custom', { from: addDays(todayKey(), -364), to: todayKey() })]) {
      const d = dashboardFor(admin(), r);
      const won = d.winLoss?.slices.find((x) => x.key === 'won')?.value ?? 0;
      const lost = d.winLoss?.slices.find((x) => x.key === 'lost')?.value ?? 0;
      const wr = kpi(d, 'winrate')!.value;
      expect(wr).toBe(won + lost ? won / (won + lost) : null);
      expect(d.pipe?.steps.find((x) => x.key === 'won')?.value ?? 0).toBe(won);
      // Business Scorecard win rate: same query.
      const out = runReport(admin(), 'business-scorecard', 'scorecard', { from: r.from, to: r.to });
      expect(scoreRow(out, 'win-rate')).toBe(wr);
    }
  });

  it('3.4: no stage of the lead → order funnel exceeds the one before it (no "% leads reach orders" above 100 %)', () => {
    for (const from of [addDays(todayKey(), -29), addDays(todayKey(), -364)]) {
      const out = runReport(admin(), 'business-scorecard', 'scorecard', { from, to: todayKey() });
      const pts = out.chart?.points ?? [];
      expect(pts.length).toBe(4);
      for (let i = 1; i < pts.length; i++) expect(pts[i].value).toBeLessThanOrEqual(pts[i - 1].value);
    }
  });

  it('3.2: dashboard revenue is the value before GST; the GST-inclusive total is shown with it', () => {
    const d = dashboardFor(admin(), resolveRange('30d'));
    const r = resolveRange('30d');
    const booked = recs('salesOrders').filter((o) => !['pending_approval', 'cancelled'].includes(String(o.status)) && dayOf(o.orderDate) >= r.from && dayOf(o.orderDate) <= r.to);
    const k = kpi(d, 'revenue')!;
    expect(k.value).toBeCloseTo(booked.reduce((t, o) => t + netValue(o), 0), 2);
    expect(k.label).toMatch(/excl\. GST/);
    expect(String(k.sub)).toMatch(/incl\. GST/);
    // Target achievement (field rules) and dashboard revenue agree on one order.
    const o = booked[0];
    if (o) expect(netValue(o)).toBeLessThan(Number(o.grandTotal));
  });

  it('3.3: the Target tile never shows another person’s target', () => {
    // Admin has no personal target in the seed: the tile is empty, not someone else's.
    const mineAdmin = recs('targets').some((t) => t.employeeId === admin().staffId);
    const t = kpi(dashboardFor(admin(), resolveRange('30d')), 'target');
    if (!mineAdmin && t) {
      expect(t.value).toBeNull();
      expect(t.radial).toBeUndefined();
    }
  });

  it('3.5: Not Selected and Superseded quotations are not live quotes', () => {
    const quotes = recs('quotations');
    const orders = recs('salesOrders');
    const sent = quotes.find((q) => isLiveQuote(q) && q.status === 'sent' && !orders.some((o) => o.quotationId === q.id))!;
    const before = quoteToOrder(quotes, orders)!;
    sent.status = 'not_selected';
    expect(isLiveQuote(sent)).toBe(false);
    const after = quoteToOrder(quotes, orders)!;
    expect(after).toBeGreaterThan(before); // one fewer unconverted quotation in the denominator
    sent.status = 'superseded';
    expect(quoteToOrder(quotes, orders)).toBe(after);
  });

  it('KPIs move after a won deal and a booked sales order', () => {
    const range = resolveRange('30d');
    const d0 = dashboardFor(admin(), range);
    const opp = recs('opportunities').find((o) => ['proposal', 'negotiation'].includes(String(o.stage)))!;
    opp.stage = 'won';
    opp.wonAt = `${todayKey()}T10:00:00`;
    opp.stageChangedAt = opp.wonAt;
    const d1 = dashboardFor(admin(), range);
    expect(kpi(d1, 'winrate')!.value).not.toBe(kpi(d0, 'winrate')!.value);
    expect(kpi(d1, 'pipeline')!.value).toBeLessThan(kpi(d0, 'pipeline')!.value as number);
    // Winning alone books no revenue; the sales order does.
    expect(kpi(d1, 'revenue')!.value).toBeCloseTo(kpi(d0, 'revenue')!.value as number, 2);
    const template = recs('salesOrders').find((o) => Array.isArray(o.lines) && (o.lines as unknown[]).length && !['pending_approval', 'cancelled'].includes(String(o.status)))!;
    const order = { ...template, id: 'SO-TEST-1', orderNo: 'SO/TX/TEST/0001', opportunityId: opp.id, ownerId: opp.ownerId, status: 'confirmed', orderDate: todayKey() };
    recs('salesOrders').push(order);
    const d2 = dashboardFor(admin(), range);
    expect(kpi(d2, 'revenue')!.value).toBeCloseTo((kpi(d1, 'revenue')!.value as number) + netValue(order), 2);
  });
});
