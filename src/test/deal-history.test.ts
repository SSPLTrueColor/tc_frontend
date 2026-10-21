/** Deal History & Deal Chain (services/dealHistory): aggregation across the chain, ordering, local-date stamping. */
import '../domain/extensions/index';
import { demoUsers } from '../domain/pack';
import { nowMs } from '../lib/clock';
import { parseLocal } from '../lib/dates';
import type { RecordData } from '../metadata/types';
import { logActivity } from '../services/activities';
import { actorFor } from '../services/authz';
import { addComment } from '../services/collab';
import { __setDb, createDb, getDb } from '../services/db';
import { buildDealTimeline, chainRefs, dealHistory, fetchDealHistory, filterDealEvents, resolveDealChain } from '../services/dealHistory';
import { sendQuote } from '../services/quotations/workflow';
import { updateRecord } from '../services/runtime';

const admin = () => actorFor('u_rahul', 'tc');
const ownerOf = (r: RecordData) => {
  const u = demoUsers.find((x) => x.staffIds.tc === r.ownerId);
  return u ? actorFor(u.id, 'tc') : admin();
};
const recs = (k: string) => getDb().records[k] ?? [];

/** A seeded order whose quotation → opportunity → lead chain is complete. */
function fullChainOrder(): RecordData | undefined {
  return recs('salesOrders').find((o) => {
    const opp = recs('opportunities').find((x) => x.id === o.opportunityId);
    return !!o.quotationId && !!opp && !!opp.leadId && recs('leads').some((l) => l.id === opp.leadId);
  });
}

describe('deal history', () => {
  beforeEach(() => __setDb(createDb(new Date())));

  it('resolves the same chain from every member (lead ↔ opportunity ↔ quotations ↔ order ↔ contract)', () => {
    const order = fullChainOrder();
    expect(order).toBeTruthy();
    const fromOrder = resolveDealChain('salesOrders', order!.id);
    expect(fromOrder.lead).toBeTruthy();
    expect(fromOrder.opportunity?.id).toBe(order!.opportunityId);
    expect(fromOrder.quotations.some((q) => q.id === order!.quotationId)).toBe(true);
    expect(fromOrder.selectedQuotationId).toBeTruthy();
    const key = (c: ReturnType<typeof resolveDealChain>) => chainRefs(c).map((r) => `${r.resource}:${r.id}`).sort().join('|');
    expect(key(resolveDealChain('leads', fromOrder.lead!.id))).toBe(key(fromOrder));
    expect(key(resolveDealChain('opportunities', fromOrder.opportunity!.id))).toBe(key(fromOrder));
    expect(key(resolveDealChain('quotations', String(order!.quotationId)))).toBe(key(fromOrder));
    // Opportunity and quotation link forward to the sales order.
    expect(resolveDealChain('opportunities', fromOrder.opportunity!.id).orders.some((o) => o.id === order!.id)).toBe(true);
    expect(resolveDealChain('quotations', String(order!.quotationId)).orders.some((o) => o.id === order!.id)).toBe(true);
  });

  it('merges activities, edits, comments and creations from the whole chain, newest first', () => {
    const order = fullChainOrder()!;
    const chain = resolveDealChain('salesOrders', order.id);
    const lead = chain.lead!;
    const opp = chain.opportunity!;
    const actor = admin();
    logActivity(actor, { parentResource: 'leads', parentId: lead.id, parentLabel: lead.id, activityType: 'call', subject: 'Deal-history probe call', at: '2020-01-02T10:15' });
    addComment(actor, 'salesOrders', order.id, 'Deal-history probe comment', 'dh-probe-1');
    const fresh = recs('opportunities').find((o) => o.id === opp.id)!;
    updateRecord(actor, 'opportunities', opp.id, { notes: 'Deal-history probe edit' }, fresh.version);

    // Opened from the quotation: events from the lead, opportunity and order all appear.
    const events = buildDealTimeline(actor, 'quotations', String(order.quotationId));
    const call = events.find((e) => e.type === 'activity' && e.title.includes('Deal-history probe call'));
    expect(call?.source).toMatchObject({ resource: 'leads', id: lead.id });
    expect(call?.ts).toBe(parseLocal('2020-01-02T10:15').getTime());
    const comment = events.find((e) => e.type === 'comment' && e.detail === 'Deal-history probe comment');
    expect(comment?.source).toMatchObject({ resource: 'salesOrders', id: order.id });
    const edit = events.find((e) => e.type === 'edit' && e.source.id === opp.id);
    expect(edit?.changes?.some((c) => c.after.includes('Deal-history probe edit'))).toBe(true);
    expect(events.some((e) => e.type === 'record' && e.source.id === order.id)).toBe(true);
    const resources = new Set(events.map((e) => e.source.resource));
    ['leads', 'opportunities', 'quotations', 'salesOrders'].forEach((r) => expect(resources.has(r)).toBe(true));

    // Strictly newest first.
    for (let i = 1; i < events.length; i++) expect(events[i - 1].ts).toBeGreaterThanOrEqual(events[i].ts);
    // Same timeline whichever member it is opened from.
    expect(buildDealTimeline(actor, 'leads', lead.id).map((e) => e.id)).toEqual(events.map((e) => e.id));

    // Filters: type and record.
    expect(filterDealEvents(events, 'comment', '').every((e) => e.type === 'comment')).toBe(true);
    expect(filterDealEvents(events, 'all', `leads:${lead.id}`).every((e) => e.source.id === lead.id)).toBe(true);
    expect(dealHistory(actor, 'leads', lead.id).sources[0].resource).toBe('leads');
  });

  it('is served through the async boundary', async () => {
    const order = fullChainOrder()!;
    getDb().demo.latencyMin = 0;
    getDb().demo.latencyMax = 0;
    getDb().demo.failureRate = 0;
    const out = await fetchDealHistory(admin(), 'salesOrders', order.id);
    expect(out.events.length).toBeGreaterThan(0);
  });

  it('stamps workflow activities (quotation sent) with the local date-time, not UTC', () => {
    const q = recs('quotations').find((x) => x.status === 'approved' && x.isLatest !== false && recs('opportunities').some((o) => o.id === x.opportunityId && !['won', 'lost'].includes(String(o.stage))) && String(x.validUntil) >= new Date().toISOString().slice(0, 10));
    expect(q).toBeTruthy();
    const actor = ownerOf(q!);
    sendQuote(actor, q!.id, q!.version, { channel: 'manual', to: '', message: 'Handed over at the plant' });
    const act = recs('activities').find((a) => a.parentResource === 'quotations' && a.parentId === q!.id);
    expect(act).toBeTruthy();
    const at = String(act!.at);
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // Read back as local wall-clock time it is "now" (a UTC stamp would be off by the zone offset, e.g. 5h30 in IST).
    expect(Math.abs(parseLocal(at).getTime() - nowMs())).toBeLessThan(2 * 60_000);
    // And the Deal History lists it under the quotation with the same instant.
    const ev = buildDealTimeline(admin(), 'quotations', q!.id).find((e) => e.id === act!.id);
    expect(ev?.ts).toBe(parseLocal(at).getTime());
  });
});
