/** Quotation selection (BR-20, QUO-07/10/12, SO-01): accept / order closes the alternatives as Not Selected, one guard on every action. */
import '../domain/extensions/index';
import { L } from '../constants/labels';
import { todayKey } from '../lib/dates';
import { demoUsers } from '../domain/pack';
import { actorFor, type Actor } from '../services/authz';
import { __setDb, commit, createDb, getDb } from '../services/db';
import { listPriceFor, recordsOfCustomer } from '../services/lookups';
import { availableTransitions, transitionRecord, updateRecord } from '../services/runtime';
import { getResource } from '../services/registry';
import { markLost } from '../services/opportunities';
import * as so from '../services/orders/orders';
import { acceptQuote, backToDraft, decideQuoteApproval, rejectQuote, reviseQuote, saveQuote, sendQuote, submitQuote, undoSelection } from '../services/quotations/workflow';
import type { QuoteLine } from '../services/quotations/pricing';
import { hooksFor } from '../services/resourceHooks';

const WS = 'tc';
const S = L.quotations.selection;
const A = (u: string) => actorFor(u, WS);
const q = (id: string) => getDb().records.quotations.find((x) => x.id === id)!;
const opp = (id: string) => getDb().records.opportunities.find((x) => x.id === id)!;
const PO = { method: 'po' as const, poNo: 'PO/SEL/1', poDate: todayKey(), file: { name: 'po.pdf', size: 2048 } };

interface Setup {
  owner: Actor;
  oppId: string;
  /** Sent, Sent, Pending Approval, Draft. */
  a: string;
  b: string;
  pending: string;
  draft: string;
}

function line(): QuoteLine {
  const d = getDb();
  const product = d.records.products.find((p) => p.productType === 'machine' && listPriceFor(p.id, todayKey())) ?? d.records.products.find((p) => listPriceFor(p.id, todayKey()))!;
  return { productId: product.id, description: String(product.name), lineType: 'machine', qty: 1, listPrice: 1, discountPct: 0, discountAmt: 0, hsnSac: String(product.hsnSac), gstRate: Number(product.gstRate) };
}

function setup(): Setup | null {
  const d = getDb();
  const karan = A('u_karan');
  const o = (d.records.opportunities ?? []).find((x) => ['needs_assessment', 'demo', 'proposal', 'negotiation'].includes(String(x.stage)) && x.ownerId === karan.staffId && !(d.records.quotations ?? []).some((qq) => qq.opportunityId === x.id) && recordsOfCustomer('addresses', String(x.customerId)).length);
  expect(o, "seed has an open opportunity of Karan without quotations").toBeTruthy();
  if (!o) return null;
  const mk = () => saveQuote(karan, { header: { opportunityId: o.id }, lines: [line()] }).record.id;
  const sent = () => {
    const id = mk();
    submitQuote(karan, id, q(id).version);
    sendQuote(karan, id, q(id).version, { channel: 'manual', to: '', message: '' });
    return id;
  };
  const a = sent();
  const b = sent();
  const pending = saveQuote(karan, { header: { opportunityId: o.id }, lines: [{ ...line(), discountPct: 12 }] }).record.id;
  submitQuote(karan, pending, q(pending).version, 'Competitive offer from importer');
  const draft = mk();
  expect([q(a).status, q(b).status, q(pending).status, q(draft).status]).toEqual(['sent', 'sent', 'pending_approval', 'draft']);
  return { owner: karan, oppId: o.id, a, b, pending, draft };
}

const pendingApproval = (id: string) => getDb().approvals.find((x) => x.recordId === id && x.status === 'pending');
const refuse = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected a refusal');
};

function orderFrom(actor: Actor, id: string, key: string) {
  const draft = so.draftFromQuotation(actor, id);
  return so.createOrder(actor, { source: 'quotation', sourceId: id, lines: draft.lines, customerPoNo: 'PO/SEL/ORD', customerPoDate: todayKey(), poFileName: 'po.pdf', poFileSize: 1000, siteAddressId: draft.siteAddresses[0]?.id, idempotencyKey: key });
}

describe('quotation selection', () => {
  beforeEach(() => __setDb(createDb(new Date())));

  it('accept → every other open quotation is Not Selected (read-only) and its pending approval withdrawn, in one commit', () => {
    const s = setup();
    if (!s) return;
    const approvalId = pendingApproval(s.pending)!.id;
    acceptQuote(s.owner, s.a, q(s.a).version, PO);
    expect(q(s.a).status).toBe('accepted');
    for (const id of [s.b, s.pending, s.draft]) {
      expect(q(id)).toMatchObject({ status: 'not_selected', selectedQuotationId: s.a, notSelectedReason: S.reasonAccepted(String(q(s.a).quoteNo)) });
      expect(q(id).notSelectedAt).toBeTruthy();
    }
    expect([q(s.b).previousStatus, q(s.pending).previousStatus, q(s.draft).previousStatus]).toEqual(['sent', 'pending_approval', 'draft']);
    expect(getDb().approvals.find((x) => x.id === approvalId)!.status).toBe('withdrawn');
    expect(getDb().audit.some((e) => e.recordId === s.pending && e.action === 'approval.withdrawn')).toBe(true);
    expect(getDb().audit.some((e) => e.recordId === s.b && e.summary.startsWith('Not Selected'))).toBe(true);
    expect(getDb().audit.some((e) => e.recordId === s.oppId && e.action === 'quotations.not_selected')).toBe(true);
    // D-1: the won value is the selected quotation's taxable value (before GST), not the GST-inclusive total.
    expect(opp(s.oppId)).toMatchObject({ stage: 'won', selectedQuotationId: s.a, value: q(s.a).taxable });
    expect(Number(opp(s.oppId).value)).toBeLessThan(Number(q(s.a).grandTotal));
  });

  it('one guard refuses every action on a Not Selected quotation (edit, submit, approve, send, accept, reject, version, order, lifecycle)', () => {
    const s = setup();
    if (!s) return;
    const approvalId = pendingApproval(s.pending)!.id;
    acceptQuote(s.owner, s.a, q(s.a).version, PO);
    const k = s.owner;
    const rohan = A('u_rohan');
    expect(refuse(() => updateRecord(k, 'quotations', s.draft, { freight: 10 }, q(s.draft).version))).toMatch(/Not Selected/);
    expect(refuse(() => updateRecord(k, 'quotations', s.b, { roiOutputPerDay: 10 }, q(s.b).version))).toMatch(/Not Selected/);
    expect(refuse(() => saveQuote(k, { id: s.draft, version: q(s.draft).version, header: { freight: 5 }, lines: [line()] }))).toMatch(/Not Selected/);
    expect(refuse(() => submitQuote(k, s.draft, q(s.draft).version))).toMatch(/Not Selected/);
    expect(refuse(() => backToDraft(k, s.pending, q(s.pending).version))).toMatch(/Not Selected/);
    expect(refuse(() => sendQuote(k, s.b, q(s.b).version, { channel: 'manual', to: '', message: '' }))).toMatch(/Not Selected/);
    expect(refuse(() => acceptQuote(k, s.b, q(s.b).version, PO))).toMatch(/Not Selected/);
    expect(refuse(() => rejectQuote(k, s.b, q(s.b).version, 'price', ''))).toMatch(/Not Selected/);
    expect(refuse(() => reviseQuote(k, s.b, q(s.b).version, 'New price after negotiation'))).toMatch(/Not Selected/);
    expect(refuse(() => decideQuoteApproval(rohan, approvalId, 'approved', 'ok', getDb().approvals.find((x) => x.id === approvalId)!.version))).toBeTruthy();
    expect(so.quotationBlocker(getDb(), q(s.b))).toMatch(/Not Selected/);
    expect(refuse(() => orderFrom(k, s.b, 'sel-b'))).toMatch(/Not Selected/);
    expect(so.eligibleQuotations(k).some((x) => x.id === s.b)).toBe(false);
    // Generic lifecycle (record button, bulk, board): Not Selected is terminal and the hook refuses it.
    expect(hooksFor('quotations').transitionBlocked?.(k, q(s.b), 'negotiation')).toMatch(/Not Selected/);
    expect(availableTransitions(k, getResource('quotations'), q(s.b))).toEqual([]);
    expect(() => transitionRecord(k, 'quotations', s.b, 'negotiation', q(s.b).version)).toThrow();
    expect(hooksFor('quotations').editBlocked?.(q(s.b))).toMatch(/Not Selected/);
    // The selected quotation stays actionable.
    expect(so.quotationBlocker(getDb(), q(s.a))).toBeNull();
  });

  it('order straight from a sent quotation: accepted, opportunity Won at the order value with the quote selected, siblings Not Selected', () => {
    const s = setup();
    if (!s) return;
    const order = orderFrom(s.owner, s.b, 'sel-order');
    expect(q(s.b)).toMatchObject({ status: 'accepted', previousStatus: 'sent', acceptanceMethod: 'po' });
    // D-1: won value = the sales order's taxable value (before GST, incl. freight).
    expect(opp(s.oppId)).toMatchObject({ stage: 'won', selectedQuotationId: s.b, value: order.taxable });
    for (const id of [s.a, s.pending, s.draft]) expect(q(id)).toMatchObject({ status: 'not_selected', selectedQuotationId: s.b });
    expect(pendingApproval(s.pending)).toBeUndefined();
    expect(String(q(s.a).notSelectedReason)).toContain(String(order.orderNo));
  });

  it('Mark Lost closes every open quotation as Not Selected ("Opportunity lost"); accept on a lost opportunity is refused', () => {
    const s = setup();
    if (!s) return;
    markLost(s.owner, s.oppId, { lostReason: 'price', lostToCompetitor: 'Importer X' }, opp(s.oppId).version);
    for (const id of [s.a, s.b, s.pending, s.draft]) expect(q(id)).toMatchObject({ status: 'not_selected', notSelectedReason: S.reasonLost, selectedQuotationId: null });
    expect(pendingApproval(s.pending)).toBeUndefined();
    expect(refuse(() => acceptQuote(s.owner, s.a, q(s.a).version, PO))).toMatch(/Not Selected|Lost/);
    expect(so.quotationBlocker(getDb(), q(s.a))).toBeTruthy();
    // Re-open by an administrator: the quotations open again (the withdrawn request is re-opened → Pending Approval).
    transitionRecord(A('u_rahul'), 'opportunities', s.oppId, 'needs_assessment', opp(s.oppId).version);
    expect([q(s.a).status, q(s.b).status, q(s.pending).status, q(s.draft).status]).toEqual(['sent', 'sent', 'pending_approval', 'draft']);
    expect(pendingApproval(s.pending)).toBeTruthy();
  });

  it('re-open of a won opportunity is blocked while a live sales order exists; after cancellation a Sales Manager may re-open', () => {
    const s = setup();
    if (!s) return;
    const order = orderFrom(s.owner, s.a, 'sel-reopen');
    const rohan = A('u_rohan');
    expect(rohan.role.id).toBe('sales_manager');
    const reopen = availableTransitions(rohan, getResource('opportunities'), opp(s.oppId)).find((t) => t.to === 'needs_assessment');
    expect(reopen?.disabledReason).toBe(S.reopenOrderExists(String(order.orderNo)));
    expect(refuse(() => transitionRecord(rohan, 'opportunities', s.oppId, 'needs_assessment', opp(s.oppId).version))).toBe(S.reopenOrderExists(String(order.orderNo)));
    expect(refuse(() => transitionRecord(A('u_rahul'), 'opportunities', s.oppId, 'needs_assessment', opp(s.oppId).version))).toBe(S.reopenOrderExists(String(order.orderNo)));
    expect(refuse(() => undoSelection(rohan, s.a, q(s.a).version))).toBe(S.undoOrderExists(String(order.orderNo)));
    commit((d) => {
      d.records.salesOrders.find((o) => o.id === order.id)!.status = 'cancelled';
    });
    // Sales executives still cannot re-open.
    expect(() => transitionRecord(s.owner, 'opportunities', s.oppId, 'needs_assessment', opp(s.oppId).version)).toThrow();
    transitionRecord(rohan, 'opportunities', s.oppId, 'needs_assessment', opp(s.oppId).version);
    expect(opp(s.oppId)).toMatchObject({ stage: 'needs_assessment', selectedQuotationId: null });
    expect(q(s.a).status).toBe('sent');
    expect(q(s.b).status).toBe('sent');
  });

  it('Undo Selection (Sales Manager / Admin, no sales order): quote back to its prior status, siblings restored, opportunity back to its prior stage', () => {
    const s = setup();
    if (!s) return;
    const before = opp(s.oppId);
    const prevStage = String(before.stage);
    acceptQuote(s.owner, s.a, q(s.a).version, PO);
    expect(refuse(() => undoSelection(s.owner, s.a, q(s.a).version))).toBe(S.undoOnlyRoles);
    expect(demoUsers.some((u) => u.id === 'u_rohan')).toBe(true);
    const approvalId = getDb().approvals.find((x) => x.recordId === s.pending)!.id;
    const out = undoSelection(A('u_rohan'), s.a, q(s.a).version);
    expect(q(s.a)).toMatchObject({ status: 'sent', acceptedAt: null, customerPoNo: null });
    // The revision that was waiting for approval is back in Pending Approval with the same request re-opened.
    expect([q(s.b).status, q(s.pending).status, q(s.draft).status]).toEqual(['sent', 'pending_approval', 'draft']);
    expect(out).toEqual({ pending: [{ quoteNo: String(q(s.pending).quoteNo), approvalId }], drafted: [] });
    expect(pendingApproval(s.pending)?.id).toBe(approvalId);
    expect(getDb().audit.some((e) => e.recordId === s.pending && e.action === 'approval.reopened')).toBe(true);
    expect(getDb().notifications.some((n) => n.kind === 'approval_request' && n.about?.recordId === s.pending)).toBe(true);
    expect(q(s.b).selectedQuotationId).toBeNull();
    expect(opp(s.oppId)).toMatchObject({ stage: prevStage, selectedQuotationId: null, wonAt: null, value: before.value });
    expect(getDb().audit.some((e) => e.recordId === s.a && e.summary === S.auditUndo(String(q(s.a).quoteNo)))).toBe(true);
    // Another quotation can now be selected.
    acceptQuote(s.owner, s.b, q(s.b).version, PO);
    expect(q(s.a)).toMatchObject({ status: 'not_selected', selectedQuotationId: s.b });
  });

  it('a stale request on a non-selectable quotation never completes', () => {
    const s = setup();
    if (!s) return;
    acceptQuote(s.owner, s.a, q(s.a).version, PO);
    // Legacy data: a request left pending on a Not Selected quotation.
    commit((d) => {
      const a = d.approvals.find((x) => x.recordId === s.pending)!;
      a.status = 'pending';
    });
    const a = pendingApproval(s.pending)!;
    const approver = demoUsers.map((u) => actorFor(u.id, WS)).find((x) => x.user.id !== s.owner.user.id && x.role.id === 'sales_manager')!;
    expect(refuse(() => decideQuoteApproval(approver, a.id, 'approved', 'ok', a.version))).toMatch(/Not Selected|level/);
    expect(q(s.pending).status).toBe('not_selected');
  });
});

describe('quotation selection — demo data', () => {
  it('after seed no Won / Lost opportunity has an open quotation; won opportunities point at their accepted quotation', () => {
    __setDb(createDb(new Date()));
    const d = getDb();
    const OPEN = ['draft', 'pending_approval', 'approved', 'sent', 'negotiation'];
    const closed = (d.records.opportunities ?? []).filter((o) => o.stage === 'won' || o.stage === 'lost');
    expect(closed.length).toBeGreaterThan(0);
    closed.forEach((o) => {
      const open = (d.records.quotations ?? []).filter((x) => x.opportunityId === o.id && OPEN.includes(String(x.status)));
      expect(open.map((x) => x.id), `${o.id} (${o.stage})`).toEqual([]);
      const accepted = (d.records.quotations ?? []).find((x) => x.opportunityId === o.id && x.status === 'accepted' && x.isLatest !== false);
      if (o.stage === 'won' && accepted) expect(o.selectedQuotationId).toBe(accepted.id);
    });
    (d.records.quotations ?? []).filter((x) => x.status === 'not_selected').forEach((x) => {
      expect(x.previousStatus).toBeTruthy();
      expect(d.approvals.some((a) => a.recordId === x.id && a.status === 'pending')).toBe(false);
    });
  });
});
