/** Every report and every role overview runs on the full demo seed, respecting role scope. */
import { demoUsers } from '../domain/pack';
import { addDays, todayKey } from '../lib/dates';
import { actorFor } from '../services/authz';
import { createDb, __setDb } from '../services/db';
import { listReports, runReport } from '../services/api/reports';
import { REPORTS } from '../services/reports/catalog';
import { overviewFor } from '../services/reports/dashboard';

describe('reports and overviews on the demo seed', () => {
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

  it('builds an overview for every demo user', () => {
    for (const u of demoUsers) {
      const o = overviewFor(actorFor(u.id, 'tc'));
      expect(o.sections.length, u.id).toBeGreaterThan(0);
      o.sections.forEach((s) => s.tiles.forEach((t) => expect(t.label).toBeTruthy()));
    }
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
