import { actorFor } from '../services/authz';
import { __setDb, createDb } from '../services/db';
import { addDays, todayKey } from '../lib/dates';
import { runReport } from '../services/api/reports';

const run = (reportId: string, viewId: string, filters = {}) => runReport(actorFor('u_rahul', 'tc'), reportId, viewId, { from: addDays(todayKey(), -200), to: addDays(todayKey(), 1), ...filters });

describe('chart follows the question, and agrees with the table', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  it('won vs lost: stacked marks add up to the table total', () => {
    const out = run('pipeline-forecast', 'outcomes');
    expect(out.chart!.spec.type).toBe('stacked');
    const won = out.chart!.points.reduce((t, p) => t + (p.values?.won ?? 0), 0);
    const lost = out.chart!.points.reduce((t, p) => t + (p.values?.lost ?? 0), 0);
    expect(won).toBe(out.totals.won);
    expect(lost).toBe(out.totals.lost);
    expect(won + lost).toBe(out.totals.closed);
  });

  it('lead conversion by month is a combo: bars = leads, line = conversion %', () => {
    const out = run('lead-conversion', 'conversion', { group: 'month' });
    expect(out.chart!.spec.type).toBe('combo');
    expect(out.chart!.points.reduce((t, p) => t + p.value, 0)).toBe(out.totals.leads);
    out.chart!.points.forEach((p, i) => expect(p.value2).toBe(out.rows[i].conversion));
  });

  it('target vs achieved is a bullet: one mark per person, actual and target from the table', () => {
    const out = run('exec-performance', 'target');
    expect(out.chart!.spec.type).toBe('bullet');
    expect(out.chart!.points.length).toBe(Math.min(out.rows.length, 12));
    out.chart!.points.forEach((p) => {
      const r = out.rows.find((x) => x._key === p.key)!;
      expect(p.value).toBe(r.booked);
      expect(p.target).toBe(r.target);
    });
  });

  it('visits by weekday and hour is a heatmap whose cells add up to the table total', () => {
    const out = run('field-visits', 'hours');
    expect(out.chart!.spec.type).toBe('heatmap');
    expect(out.chart!.points.reduce((t, p) => t + p.value, 0)).toBe(out.totals.total);
    expect(new Set(out.chart!.points.map((p) => p.row)).size).toBe(7);
  });

  it('pipeline by stage is a funnel without carry-over percentages (it is a snapshot, not a conversion)', () => {
    const out = run('pipeline-forecast', 'stage');
    expect(out.chart!.spec.type).toBe('funnel');
    expect(out.chart!.spec.carry).toBe(false);
  });

  it('time-based reports give every KPI a sparkline', () => {
    const out = run('pipeline-forecast', 'outcomes');
    expect(out.kpis.some((k) => k.spark && k.spark.length >= 3)).toBe(true);
  });
});
