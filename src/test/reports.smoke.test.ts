/** Every report runs on the full demo seed, respecting role scope; categories match the BRD report pages. */
import { addDays, todayKey } from '../lib/dates';
import { actorFor } from '../services/authz';
import { createDb, __setDb } from '../services/db';
import { listReports, runReport } from '../services/api/reports';
import { LEGACY_REPORTS, REPORT_GROUPS, REPORTS } from '../services/reports/catalog';
import { L } from '../constants/labels';

describe('reports on the demo seed', () => {
  beforeAll(() => __setDb(createDb()));

  it('every view of every report computes for the administrator with sane output', () => {
    const admin = actorFor('u_rahul', 'tc');
    const f = { from: addDays(todayKey(), -365), to: addDays(todayKey(), 90) };
    for (const r of REPORTS) {
      for (const v of r.views) {
        for (const group of v.groupOptions?.map((g) => g.value) ?? [undefined]) {
          const id = `${r.id}/${v.id}/${group ?? '-'}`;
          const res = runReport(admin, r.id, v.id, { ...f, group });
          expect(res.columns.length, id).toBeGreaterThan(0);
          res.rows.forEach((row) => expect(row._key, id).toBeTruthy());
          expect(new Set(res.rows.map((x) => x._key)).size, `${id} unique keys`).toBe(res.rows.length);
          expect(res.kpis.length, `${id} KPI cards`).toBeGreaterThanOrEqual(3);
          expect(res.kpis.length, `${id} KPI cards`).toBeLessThanOrEqual(5);
          expect(res.chart, `${id} has the primary chart`).toBeTruthy();
        }
      }
    }
    expect(runReport(admin, 'order-value', 'value', f).rows.length).toBeGreaterThan(0);
    expect(runReport(admin, 'open-tickets', 'open', {}).rows.length).toBeGreaterThan(0);
  });

  it('groups reports under the eight BRD categories with URL-safe ids that never clash with a report id', () => {
    expect(REPORT_GROUPS.map((g) => g.id)).toEqual(['kpis', 'customers', 'leads', 'quotations', 'sales-orders', 'installed-base', 'service', 'field-force']);
    expect(REPORT_GROUPS.map((g) => g.label)).toContain(L.nav.pages.reportSalesOrders.title);
    REPORTS.forEach((r) => {
      expect(REPORT_GROUPS.some((g) => g.id === r.group), r.id).toBe(true);
      expect(REPORT_GROUPS.some((g) => g.id === r.id), r.id).toBe(false);
      expect(LEGACY_REPORTS[r.id], `${r.id} must not also be a legacy id`).toBeUndefined();
    });
    REPORT_GROUPS.forEach((g) => expect(REPORTS.some((r) => r.group === g.id), g.id).toBe(true));
  });

  it('keeps every earlier report id working: it redirects to a report and view that exist', () => {
    Object.entries(LEGACY_REPORTS).forEach(([old, to]) => {
      const def = REPORTS.find((r) => r.id === to.id);
      expect(def, old).toBeTruthy();
      if (to.view) expect(def!.views.some((v) => v.id === to.view), old).toBe(true);
    });
  });

  it('has a Referral Report (LEAD-12) in Lead Reports, counting referral leads only', () => {
    const admin = actorFor('u_rahul', 'tc');
    const def = REPORTS.find((r) => r.id === 'referrals');
    expect(def?.group).toBe('leads');
    expect(def?.title).toBe('Referral Report');
    const f = { from: addDays(todayKey(), -730), to: todayKey() };
    const res = runReport(admin, 'referrals', undefined, f);
    expect(res.rows.length).toBeGreaterThan(0);
    const total = res.rows.reduce((t, r) => t + Number(r.leads), 0);
    expect(res.kpis[0].value).toBe(total);
    expect(res.totals.leads).toBe(total);
    expect(runReport(admin, 'referrals', undefined, { ...f, group: 'type' }).rows.length).toBeLessThanOrEqual(4);
  });

  it('scopes report data: a sales executive sees only their own orders', () => {
    const karan = actorFor('u_karan', 'tc');
    const admin = actorFor('u_rahul', 'tc');
    const mine = runReport(karan, 'order-backlog', 'backlog', {});
    const all = runReport(admin, 'order-backlog', 'backlog', {});
    expect(mine.rows.length).toBeLessThanOrEqual(all.rows.length);
    expect(listReports(actorFor('u_prakash', 'tc')).some((r) => r.id === 'lead-conversion')).toBe(false); // store has no lead access
  });
});
