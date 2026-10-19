import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, todayKey } from '../lib/dates';
import { demoUsers } from '../domain/pack';
import { actorFor } from '../services/authz';
import { createDb, __setDb } from '../services/db';
import { dashboardFor, resolveRange, type RangeKey } from '../services/reports/overview';

const RANGES: RangeKey[] = ['today', '7d', '30d', 'month'];

describe('role dashboard', () => {
  beforeAll(() => __setDb(createDb()));

  it('resolves ranges with an equal-length previous window', () => {
    const t = '2026-10-19';
    const r7 = resolveRange('7d', undefined, t);
    expect([r7.from, r7.to, r7.prevFrom, r7.prevTo]).toEqual(['2026-10-13', '2026-10-19', '2026-10-06', '2026-10-12']);
    const m = resolveRange('month', undefined, t);
    expect([m.from, m.days, m.prevFrom, m.prevTo]).toEqual(['2026-10-01', 19, '2026-09-01', '2026-09-19']);
    const c = resolveRange('custom', { from: '2026-10-10', to: '2026-10-01' }, t);
    expect([c.from, c.to, c.days]).toEqual(['2026-10-01', '2026-10-10', 10]);
  });

  it('builds a complete dashboard for every demo user and range', () => {
    for (const u of demoUsers) {
      for (const k of RANGES) {
        const d = dashboardFor(actorFor(u.id, 'tc'), resolveRange(k));
        const tag = `${u.id}/${k}`;
        expect(d.kpis.length, tag).toBeGreaterThanOrEqual(4);
        expect(d.kpis.length, tag).toBeLessThanOrEqual(6);
        d.kpis.forEach((x) => expect(Number.isNaN(x.value as number), `${tag} ${x.id}`).toBe(false));
        expect(d.trend.points.length, tag).toBeGreaterThan(0);
        d.trend.points.forEach((p) => d.trend.series.forEach((s) => expect(Number.isFinite(p[s.key] as number), `${tag} ${s.key}`).toBe(true)));
      }
    }
  });

  it('is computed from data: a longer range never has fewer booked orders', () => {
    const admin = actorFor('u_rahul', 'tc');
    const rev = (k: RangeKey) => dashboardFor(admin, resolveRange(k)).kpis.find((x) => x.id === 'revenue')!.value!;
    expect(rev('30d')).toBeGreaterThanOrEqual(rev('7d'));
    expect(rev('7d')).toBeGreaterThanOrEqual(rev('today'));
    const wide = dashboardFor(admin, resolveRange('custom', { from: addDays(todayKey(), -365), to: todayKey() }));
    expect(wide.kpis.find((x) => x.id === 'revenue')!.value!).toBeGreaterThanOrEqual(rev('30d'));
  });

  it('scopes data by role', () => {
    const karan = dashboardFor(actorFor('u_karan', 'tc'), resolveRange('custom', { from: addDays(todayKey(), -365), to: todayKey() }));
    const admin = dashboardFor(actorFor('u_rahul', 'tc'), resolveRange('custom', { from: addDays(todayKey(), -365), to: todayKey() }));
    expect(karan.kpis.find((x) => x.id === 'revenue')!.value!).toBeLessThanOrEqual(admin.kpis.find((x) => x.id === 'revenue')!.value!);
    expect(karan.family).toBe('sales');
    expect(admin.family).toBe('company');
  });
});
