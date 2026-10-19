import '../domain/extensions/quotations';
import { addDays, todayKey } from '../lib/dates';
import { demoUsers } from '../domain/pack';
import type { RecordData } from '../metadata/types';
import { actorFor } from '../services/authz';
import { __setDb, createDb, getDb } from '../services/db';
import { listPriceFor } from '../services/lookups';
import { updateRecord } from '../services/runtime';
import { acceptQuote, reviseQuote, runQuotationSweep, saveQuote, sendQuote, submitQuote } from '../services/quotations/workflow';
import { canDecide, decideApproval } from '../services/workflow';
import type { QuoteLine } from '../services/quotations/pricing';

const ready = () => {
  const d = getDb();
  return (d.records.opportunities ?? []).length && (d.records.priceListItems ?? []).length && (d.records.products ?? []).length;
};
const ownerActor = (o: RecordData) => actorFor(demoUsers.find((u) => u.staffIds.tc === o.ownerId)!.id, 'tc');
const fresh = (id: string) => getDb().records.quotations.find((q) => q.id === id)!;

describe('quotation workflow', () => {
  beforeEach(() => __setDb(createDb(new Date())));

  it('prices from the price list, needs approval for a 12% discount, then sends and accepts (opportunity → won)', () => {
    if (!ready()) return;
    const d = getDb();
    const opp = d.records.opportunities.find((o) => ['proposal', 'negotiation', 'needs_assessment', 'demo'].includes(String(o.stage)) && demoUsers.some((u) => u.staffIds.tc === o.ownerId))!;
    const actor = ownerActor(opp);
    const product = d.records.products.find((p) => listPriceFor(p.id, todayKey()))!;
    const lp = listPriceFor(product.id, todayKey())!;
    const line: QuoteLine = { productId: product.id, description: String(product.name), lineType: 'machine', qty: 1, listPrice: 1, discountPct: 12, discountAmt: 0, hsnSac: String(product.hsnSac), gstRate: Number(product.gstRate) };
    const saved = saveQuote(actor, { header: { opportunityId: opp.id }, lines: [line] });
    const q = fresh(saved.record.id);
    expect(String(q.quoteNo)).toMatch(/^QT\/[A-Z]+\/\d\d-\d\d\/\d{4}$/);
    expect((q.lines as QuoteLine[])[0].listPrice).toBe(lp.listPrice); // BR-15: client price ignored
    expect(q.maxDiscountPct).toBe(12);

    expect(() => submitQuote(actor, q.id, q.version, '')).toThrow(/reason/);
    const r = submitQuote(actor, q.id, q.version, 'Competitive offer from importer');
    expect(r.status).toBe('pending_approval');
    expect(() => submitQuote(actor, q.id, fresh(q.id).version, 'again')).toThrow();

    // Decide every level with whoever may decide it (never the requester).
    for (let i = 0; i < 4 && fresh(q.id).status === 'pending_approval'; i++) {
      const a = getDb().approvals.find((x) => x.recordId === q.id && x.status === 'pending')!;
      const approver = demoUsers.map((u) => actorFor(u.id, 'tc')).find((x) => canDecide(x, a))!;
      expect(approver.user.id).not.toBe(actor.user.id);
      decideApproval(approver, a.id, 'approved', 'ok', a.version);
    }
    expect(fresh(q.id).status).toBe('approved');

    expect(() => sendQuote(actor, q.id, fresh(q.id).version, { channel: 'email', to: 'not-an-email', message: '' })).toThrow();
    sendQuote(actor, q.id, fresh(q.id).version, { channel: 'email', to: 'buyer@example.com', message: 'Please review' });
    expect(fresh(q.id).status).toBe('sent');
    expect(getDb().outbox.some((m) => m.related?.recordId === q.id)).toBe(true);

    expect(() => acceptQuote(actor, q.id, fresh(q.id).version, { method: 'po', poNo: 'PO-1', poDate: todayKey(), file: { name: 'po.exe', size: 10 } })).toThrow();
    acceptQuote(actor, q.id, fresh(q.id).version, { method: 'po', poNo: 'PO-1', poDate: todayKey(), file: { name: 'po.pdf', size: 2048 } });
    expect(fresh(q.id).status).toBe('accepted');
    expect(getDb().records.opportunities.find((o) => o.id === opp.id)!.stage).toBe('won');
  });

  it('locks non-drafts, revises to R1 and expires past validity', () => {
    if (!ready()) return;
    const sent = getDb().records.quotations.find((q) => q.status === 'sent' && q.isLatest)!;
    if (!sent) return;
    const actor = ownerActor(getDb().records.opportunities.find((o) => o.id === sent.opportunityId)!);
    expect(() => updateRecord(actor, 'quotations', sent.id, { freight: 1 }, sent.version)).toThrow(/Only draft/);
    const nextId = reviseQuote(actor, sent.id, sent.version, 'New price after negotiation');
    expect(fresh(sent.id)).toMatchObject({ status: 'superseded', isLatest: false });
    expect(fresh(nextId)).toMatchObject({ status: 'draft', isLatest: true, revision: 1 });
    expect(String(fresh(nextId).quoteNo)).toMatch(/-R1$/);

    const other = getDb().records.quotations.find((q) => q.status === 'approved' && q.isLatest)!;
    if (!other) return;
    other.validUntil = addDays(todayKey(), -1);
    expect(runQuotationSweep()).toBeGreaterThan(0);
    expect(fresh(other.id).status).toBe('expired');
    expect(runQuotationSweep()).toBe(0); // idempotent
  });
});
