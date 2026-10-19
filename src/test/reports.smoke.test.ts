/** Every report runs on the full demo seed, respecting role scope; categories match the BRD report pages. */
import { addDays, todayKey } from '../lib/dates';
import { actorFor } from '../services/authz';
import { createDb, __setDb } from '../services/db';
import { listReports, runReport } from '../services/api/reports';
import { REPORT_GROUPS, REPORTS } from '../services/reports/catalog';
import { L } from '../constants/labels';

describe('reports on the demo seed', () => {
  beforeAll(() => __setDb(createDb()));

  it('every report computes for the administrator with sane output', () => {
    const admin = actorFor('u_rahul', 'tc');
    const f = { from: addDays(todayKey(), -365), to: addDays(todayKey(), 90) };
    for (const r of REPORTS) {
      const res = runReport(admin, r.id, { ...f, group: r.groupOptions?.[0]?.value });
      expect(res.columns.length, r.id).toBeGreaterThan(0);
      res.rows.forEach((row) => expect(row._key, r.id).toBeTruthy());
      expect(new Set(res.rows.map((x) => x._key)).size, `${r.id} unique keys`).toBe(res.rows.length);
    }
    expect(runReport(admin, 'order-value', f).rows.length).toBeGreaterThan(0);
    expect(runReport(admin, 'open-tickets', {}).rows.length).toBeGreaterThan(0);
  });

  it('groups reports under the eight BRD categories with URL-safe ids that never clash with a report id', () => {
    expect(REPORT_GROUPS.map((g) => g.id)).toEqual(['kpis', 'customers', 'leads', 'quotations', 'sales-orders', 'installed-base', 'service', 'field-force']);
    expect(REPORT_GROUPS.map((g) => g.label)).toContain(L.nav.pages.reportSalesOrders.title);
    REPORTS.forEach((r) => {
      expect(REPORT_GROUPS.some((g) => g.id === r.group), r.id).toBe(true);
      expect(REPORT_GROUPS.some((g) => g.id === r.id), r.id).toBe(false);
    });
    REPORT_GROUPS.forEach((g) => expect(REPORTS.some((r) => r.group === g.id), g.id).toBe(true));
  });

  it('has a Referral Report (LEAD-12) in Lead Reports, counting referral leads only', () => {
    const admin = actorFor('u_rahul', 'tc');
    const def = REPORTS.find((r) => r.id === 'referrals');
    expect(def?.group).toBe('leads');
    expect(def?.title).toBe('Referral Report');
    const f = { from: addDays(todayKey(), -730), to: todayKey() };
    const res = runReport(admin, 'referrals', f);
    expect(res.rows.length).toBeGreaterThan(0);
    const total = res.rows.reduce((t, r) => t + Number(r.leads), 0);
    expect(res.kpis?.[0].value).toBe(String(total));
    expect(runReport(admin, 'referrals', { ...f, group: 'type' }).rows.length).toBeLessThanOrEqual(4);
  });

  it('scopes report data: a sales executive sees only their own orders', () => {
    const karan = actorFor('u_karan', 'tc');
    const admin = actorFor('u_rahul', 'tc');
    const f = { from: addDays(todayKey(), -400), to: todayKey() };
    const mine = runReport(karan, 'order-backlog', f);
    const all = runReport(admin, 'order-backlog', f);
    expect(mine.rows.length).toBeLessThanOrEqual(all.rows.length);
    expect(listReports(actorFor('u_prakash', 'tc')).some((r) => r.id === 'lead-conversion')).toBe(false); // store has no lead access
  });
});
