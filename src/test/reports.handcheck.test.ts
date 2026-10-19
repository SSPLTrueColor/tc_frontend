/**
 * QA hand-check: every dashboard KPI and the Appendix C KPI Summary recomputed from the raw seed records
 * with independent code (own scope filter from the reporting chain, own formulas written from BRD Appendix C),
 * then compared with what the services show. Two roles with different scopes plus a service role.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, toDateKey, todayKey } from '../lib/dates';
import { nowMs } from '../lib/clock';
import type { RecordData } from '../metadata/types';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { runReport } from '../services/api/reports';
import { dashboardFor, resolveRange } from '../services/reports/overview';
import { dayOf } from '../services/reports/kpis';

type R = RecordData;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const n = (v: unknown) => Number(v) || 0;
/** Calendar day in IST of a stored value (UTC ISO stamps are converted, wall-clock strings are already IST). */
const day = (v: unknown) => {
  const x = s(v);
  if (!x) return '';
  return /Z$/.test(x) ? toDateKey(new Date(x)) : x.slice(0, 10);
};
const t = (v: unknown) => (/Z$/.test(s(v)) ? new Date(s(v)).getTime() : new Date(s(v).length === 10 ? `${s(v)}T00:00` : s(v)).getTime());
const inR = (v: unknown, from: string, to: string) => !!day(v) && day(v) >= from && day(v) <= to;

/** Independent scope: who is in the actor's team (manager chain over employees). */
function teamOf(staffId: string): string[] {
  const emps = getDb().records.employees;
  const out = [staffId];
  for (let i = 0; i < out.length; i++) emps.filter((e) => e.managerId === out[i]).forEach((e) => out.push(String(e.id)));
  return out;
}
const rows = (k: string) => getDb().records[k] as R[];
const scoped = (k: string, staffIds?: string[]) => (staffIds ? rows(k).filter((r) => staffIds.includes(s(r.ownerId))) : rows(k));

const OPEN = ['needs_assessment', 'demo', 'proposal', 'negotiation'];
const BOOKED = (o: R) => !['pending_approval', 'cancelled'].includes(s(o.status));
const closedDay = (o: R) => o.wonAt || o.stageChangedAt || o.updatedAt;

function salesHand(staffIds: string[] | undefined, from: string, to: string) {
  const orders = scoped('salesOrders', staffIds);
  const opps = scoped('opportunities', staffIds);
  const leads = scoped('leads', staffIds);
  const quotes = scoped('quotations', staffIds);
  const closed = opps.filter((o) => ['won', 'lost'].includes(s(o.stage)) && inR(closedDay(o), from, to));
  const won = closed.filter((o) => o.stage === 'won').length;
  const sent = quotes.filter((q) => inR(q.quoteDate, from, to) && q.isLatest !== false && (['sent', 'negotiation', 'accepted', 'rejected', 'expired'].includes(s(q.status)) || !!q.sentAt));
  const ordered = new Set(orders.filter((o) => o.status !== 'cancelled').map((o) => s(o.quotationId)));
  return {
    revenue: orders.filter((o) => BOOKED(o) && inR(o.orderDate, from, to)).reduce((a, o) => a + n(o.grandTotal), 0),
    pipeline: opps.filter((o) => OPEN.includes(s(o.stage))).reduce((a, o) => a + n(o.value), 0),
    winrate: closed.length ? won / closed.length : null,
    leads: leads.filter((l) => inR(l.createdAt, from, to)).length,
    q2o: sent.length ? sent.filter((q) => ordered.has(String(q.id))).length / sent.length : null,
  };
}

const kpiOf = (d: ReturnType<typeof dashboardFor>, id: string) => d.kpis.find((k) => k.id === id)?.value ?? null;
const close = (a: number | null, b: number | null) => (a === null || b === null ? expect(a).toBe(b) : expect(a).toBeCloseTo(b, 6));

describe('QA hand-check: dashboard KPIs = Appendix C from raw records', () => {
  beforeAll(() => __setDb(createDb()));
  const today = () => todayKey();

  for (const [user, team] of [
    ['u_rahul', undefined],
    ['u_rohan', ['E-1008', 'E-1011']],
    ['u_karan', ['E-1011']],
  ] as const) {
    it(`sales KPIs for ${user} (30 days and 1 year)`, () => {
      const staff = team ? teamOf(team[0]) : undefined;
      if (team) expect(staff!.sort()).toEqual([...team].sort());
      for (const r of [resolveRange('30d'), resolveRange('custom', { from: addDays(today(), -364), to: today() })]) {
        const d = dashboardFor(actorFor(user, 'tc'), r);
        const h = salesHand(staff, r.from, r.to);
        close(kpiOf(d, 'revenue'), h.revenue);
        close(kpiOf(d, 'pipeline'), h.pipeline);
        close(kpiOf(d, 'winrate'), h.winrate);
        close(kpiOf(d, 'leads'), h.leads);
        if (d.kpis.some((k) => k.id === 'q2o')) close(kpiOf(d, 'q2o'), h.q2o);
      }
    });
  }

  it('company KPIs for System Administrator: open tickets and overdue payments', () => {
    const d = dashboardFor(actorFor('u_rahul', 'tc'), resolveRange('30d'));
    const open = rows('tickets').filter((x) => !['resolved', 'customer_confirmation', 'closed'].includes(s(x.status)));
    close(kpiOf(d, 'open-tickets'), open.length);
    const overdue = rows('paymentMilestones')
      .filter((m) => day(m.dueDate) < today())
      .reduce((a, m) => a + Math.max(0, n(m.amount) - n(m.receivedAmount)), 0);
    close(kpiOf(d, 'overdue'), overdue);
  });

  it('service KPIs for Service Head (SLA, MTTR, CSAT, resolved) over 1 year', () => {
    const r = resolveRange('custom', { from: addDays(today(), -364), to: today() });
    const d = dashboardFor(actorFor('u_manoj', 'tc'), r);
    const resolved = rows('tickets').filter((x) => ['resolved', 'customer_confirmation', 'closed'].includes(s(x.status)) && x.resolvedAt && inR(x.resolvedAt, r.from, r.to));
    close(kpiOf(d, 'resolved'), resolved.length);
    const met = resolved.filter((x) => (!x.responseDueAt || (x.respondedAt && t(x.respondedAt) <= t(x.responseDueAt))) && (!x.resolutionDueAt || t(x.resolvedAt) <= t(x.resolutionDueAt)) && !x.slaBreached);
    close(kpiOf(d, 'sla'), resolved.length ? met.length / resolved.length : null);
    const hrs = resolved.map((x) => (t(x.resolvedAt) - t(x.reportedAt || x.createdAt)) / 3_600_000 - n(x.pausedMinutes) / 60).filter((h) => h >= 0);
    expect(kpiOf(d, 'mttr')).toBeCloseTo(Math.round((hrs.reduce((a, b) => a + b, 0) / hrs.length) * 10) / 10, 6);
    const rated = resolved.map((x) => n(x.rating)).filter((x) => x >= 1 && x <= 5);
    expect(kpiOf(d, 'csat')).toBeCloseTo(Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10, 6);
    const pmLate = rows('pmVisits').filter((v) => v.status === 'overdue' || (v.status === 'due' && day(v.dueDate) < today()));
    close(kpiOf(d, 'pm'), pmLate.length);
  });

  it('KPI Summary (all Appendix C KPIs) for System Administrator over 1 year', () => {
    const from = addDays(today(), -364);
    const to = today();
    const res = runReport(actorFor('u_rahul', 'tc'), 'kpi-summary', { from, to });
    const v = (key: string) => {
      const cell = s(res.rows.find((r) => r._key === key)?.value);
      return cell ? Number(cell.split(':')[1]) : null;
    };
    const leads = rows('leads').filter((l) => inR(l.createdAt, from, to));
    const contacted = leads.filter((l) => l.firstContactAt).map((l) => (t(l.firstContactAt) - t(l.createdAt)) / 3_600_000).filter((h) => h >= 0);
    close(v('lead-response'), contacted.reduce((a, b) => a + b, 0) / contacted.length);
    close(v('lead-conversion'), leads.filter((l) => l.status === 'qualified' || l.opportunityId).length / leads.length);
    const h = salesHand(undefined, from, to);
    close(v('win-rate'), h.winrate);
    close(v('pipeline'), h.pipeline);
    const open = rows('opportunities').filter((o) => OPEN.includes(s(o.stage)));
    close(v('weighted'), open.reduce((a, o) => a + (n(o.weightedValue) || (n(o.value) * n(o.probability)) / 100), 0));
    close(v('q2o'), h.q2o);
    const backlog = rows('salesOrders').filter((o) => ['confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch', 'dispatched', 'delivered', 'installation'].includes(s(o.status)));
    close(v('backlog'), backlog.reduce((a, o) => a + n(o.grandTotal), 0));
    const ms = rows('paymentMilestones').filter((m) => inR(m.dueDate, from, to));
    close(v('collections'), ms.reduce((a, m) => a + n(m.receivedAmount), 0));
    close(v('overdue'), ms.filter((m) => day(m.dueDate) < to).reduce((a, m) => a + Math.max(0, n(m.amount) - n(m.receivedAmount)), 0));
    const tickets = rows('tickets').filter((x) => inR(x.reportedAt, from, to));
    close(v('repeat'), tickets.filter((x) => x.repeatOfId).length / tickets.length);
    const resolved = tickets.filter((x) => ['resolved', 'customer_confirmation', 'closed'].includes(s(x.status)) && x.resolvedAt);
    const visits = new Map<string, number>();
    rows('serviceVisits').forEach((sv) => visits.set(s(sv.ticketId), (visits.get(s(sv.ticketId)) ?? 0) + 1));
    const site = resolved.filter((x) => (visits.get(String(x.id)) ?? 0) > 0);
    close(v('ftfr'), site.filter((x) => visits.get(String(x.id)) === 1 && !n(x.reopenCount)).length / site.length);
    const pm = rows('pmVisits').filter((p) => inR(p.dueDate, from, to) && day(p.dueDate) <= to);
    close(v('pm'), pm.filter((p) => p.status === 'done' && (!p.completedAt || day(p.completedAt) <= day(p.dueDate))).length / pm.length);
    const amc = rows('amcContracts').filter((c) => inR(c.endDate, from, to));
    const renewed = amc.filter((c) => c.status === 'renewed').length;
    close(v('amc'), renewed / (renewed + amc.filter((c) => ['lost', 'expired'].includes(s(c.status))).length));
    const mc = new Set(rows('machines').filter((m) => m.status !== 'scrapped').map((m) => s(m.customerId)));
    const buyers = new Set(rows('salesOrders').filter((o) => o.orderKind === 'consumables' && BOOKED(o) && day(o.orderDate) >= addDays(to, -365)).map((o) => s(o.customerId)));
    close(v('attach'), [...mc].filter((c) => buyers.has(c)).length / mc.size);
    // Every Appendix C KPI is on the summary (CRM adoption links to its own report).
    expect(res.rows.map((r) => r._key)).toEqual(expect.arrayContaining(['lead-response', 'lead-conversion', 'win-rate', 'pipeline', 'weighted', 'cycle', 'q2o', 'scorecard', 'backlog', 'collections', 'overdue', 'sla', 'mttr', 'ftfr', 'repeat', 'pm', 'amc', 'csat', 'attach', 'adoption']));
  });

  it('repeat-complaint flag matches "same machine + category within 30 days"', () => {
    const tk = rows('tickets');
    const byId = new Map(tk.map((x) => [x.id, x]));
    tk.filter((x) => x.repeatOfId).forEach((x) => {
      const prev = byId.get(s(x.repeatOfId))!;
      expect(prev, String(x.id)).toBeTruthy();
      expect(prev.machineId).toBe(x.machineId);
      expect(prev.category).toBe(x.category);
      expect((t(x.reportedAt) - t(prev.reportedAt)) / 86_400_000).toBeLessThanOrEqual(30);
    });
  });

  it('dates stored as UTC stamps are bucketed by the IST calendar day (COM-11)', () => {
    // 20:00 UTC on the 18th is 01:30 IST on the 19th.
    expect(dayOf('2026-10-18T20:00:00.000Z')).toBe(toDateKey(new Date('2026-10-18T20:00:00.000Z')));
    expect(dayOf('2026-10-18T20:00')).toBe('2026-10-18');
    expect(dayOf('2026-10-18')).toBe('2026-10-18');
    expect(Number.isFinite(nowMs())).toBe(true);
  });
});
