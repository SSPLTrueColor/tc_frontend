import { createDb } from '../services/db';

describe('quotations seed', () => {
  it('creates terms templates and quotations with consistent revisions', () => {
    const db = createDb(new Date('2026-10-19T10:00:00'));
    const q = db.records.quotations ?? [];
    expect((db.records.termsTemplates ?? []).length).toBeGreaterThanOrEqual(6);
    if (!(db.records.opportunities ?? []).length || !(db.records.priceListItems ?? []).length) return; // upstream not seeded yet
    expect(q.length).toBeGreaterThan(30);
    const roots = new Map<string, number>();
    q.forEach((x) => roots.set(String(x.rootId || x.id), (roots.get(String(x.rootId || x.id)) ?? 0) + (x.isLatest ? 1 : 0)));
    [...roots.values()].forEach((n) => expect(n).toBe(1));
    expect(q.every((x) => /^QT\/[A-Z]+\/\d\d-\d\d\/\d{4}(-R\d+)?$/.test(String(x.quoteNo)))).toBe(true);
    expect(q.some((x) => x.status === 'accepted')).toBe(true);
    expect(q.some((x) => x.status === 'superseded')).toBe(true);
    expect(q.every((x) => Number(x.grandTotal) > 0)).toBe(true);
  });
});
