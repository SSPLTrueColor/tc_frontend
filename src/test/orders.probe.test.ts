import '../domain/extensions/index';
import { demoUsers } from '../domain/pack';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import * as so from '../services/orders/orders';
import { listRecords } from '../services/runtime';

it('probe', () => {
  __setDb(createDb(new Date()));
  const d = getDb();
  const orders = d.records.salesOrders;
  console.log('orders', orders.length, JSON.stringify(Object.entries(orders.reduce((m: Record<string, number>, o) => ((m[String(o.status)] = (m[String(o.status)] ?? 0) + 1), m), {}))));
  console.log('kinds', orders.map((o) => `${o.id}:${o.orderNo}:${o.status}:${o.orderKind}:${o.divisionId}:${o.ownerId}`).join('\n'));
  console.log('dispatches', d.records.dispatches.map((x) => `${x.id}:${x.salesOrderId}:${x.status}:${x.podPhotoName}:${x.ewayBill}`).join('\n'));
  console.log('installs', (d.records.installations ?? []).length, (d.records.installations ?? []).slice(0, 3).map((i) => JSON.stringify(i)).join('\n'));
  for (const u of demoUsers) {
    const a = actorFor(u.id, 'tc');
    const n = orders.filter((o) => { try { so.getOrder(a, o.id); return true; } catch { return false; } }).length;
    console.log(u.id, u.role ?? '', 'sees', n, 'eligibleQ', so.eligibleQuotations(a).length);
  }
  void listRecords;
});
