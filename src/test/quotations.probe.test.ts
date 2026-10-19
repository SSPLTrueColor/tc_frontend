import '../domain/extensions/quotations';
import { __setDb, createDb, getDb } from '../services/db';
import { listPriceFor } from '../services/lookups';
import { todayKey } from '../lib/dates';

it('probe', () => {
  __setDb(createDb(new Date()));
  const ps = getDb().records.products;
  console.log(ps.length, ps.map((p) => `${p.id}|${p.productType}|${p.divisionId}|${p.name}|${listPriceFor(p.id, todayKey())?.listPrice ?? 'NOPRICE'}|${p.status}`).join('\n'));
  const q = getDb().records.quotations;
  const custom = q.flatMap((x: any) => x.lines).filter((l: any) => !l.productId);
  console.log('custom lines in seed', custom.length, custom.slice(0, 5).map((l: any) => l.description));
});
