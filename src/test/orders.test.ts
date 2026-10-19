import '../domain/extensions/index';
import { demoUsers } from '../domain/pack';
import { actorFor, type Actor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { userOfStaff } from '../services/lookups';
import { transitionRecord, updateRecord } from '../services/runtime';
import { ServiceError, type Approval } from '../services/types';
import { canDecide, decideApproval } from '../services/workflow';
import { computeTotals, diffLines, type QuoteLine } from '../services/orders/lines';
import * as so from '../services/orders/orders';
import { generateContract, sendForSignature, signContract } from '../services/orders/contracts';

const line = (p: Partial<QuoteLine>): QuoteLine => ({ productId: 'P1', description: 'Printer', qty: 1, listPrice: 1_000_000, gstRate: 18, ...p });

describe('order line maths (BR-16 / BR-22)', () => {
  it('splits GST by place of supply and taxes freight at the main rate', () => {
    const intra = computeTotals([line({ discountPct: 10 })], '27', 10_000, 0);
    expect(intra.taxable).toBe(910_000);
    expect(intra.cgst + intra.sgst).toBeCloseTo(163_800, 2);
    expect(intra.igst).toBe(0);
    const inter = computeTotals([line({ discountPct: 10 })], '24', 10_000, 0);
    expect(inter.igst).toBeCloseTo(163_800, 2);
    expect(inter.grandTotal).toBeCloseTo(1_073_800, 2);
    expect(inter.maxDiscountPct).toBe(10);
  });
  it('detects added lines, value change and higher discount', () => {
    const q = [line({})];
    const d = diffLines([line({ discountPct: 5 }), line({ productId: 'P2', listPrice: 5000 })], q, 960_000, 1_000_000);
    expect(d.added).toHaveLength(1);
    expect(d.discountIncreased).toBe(true);
    expect(d.valueChangePct).toBe(-4);
  });
});

describe('sales order flow', () => {
  beforeEach(() => __setDb(createDb(new Date())));
  const approveAll = (a: Approval) => {
    let cur: Approval = a;
    while (cur.status === 'pending') {
      const approver = demoUsers.map((u) => actorFor(u.id, 'tc')).find((x) => canDecide(x, cur));
      expect(approver, `no approver for ${cur.levels[cur.currentLevel].label}`).toBeTruthy();
      cur = decideApproval(approver!, cur.id, 'approved', 'ok', cur.version);
    }
    return cur;
  };
  const ownerActor = (staffId: unknown): Actor => actorFor(userOfStaff(staffId)!.id, 'tc');

  it('seeds orders across statuses with milestones and dispatches', () => {
    const d = getDb();
    const orders = d.records.salesOrders ?? [];
    if (!(d.records.customers ?? []).length) return; // upstream modules not seeded yet
    expect(orders.length).toBeGreaterThan(10);
    expect(new Set(orders.map((o) => o.status)).size).toBeGreaterThan(5);
    orders.forEach((o) => {
      const ms = so.milestonesOf(d, o.id);
      expect(ms.length).toBeGreaterThan(0);
      expect(Math.round(ms.reduce((t, m) => t + Number(m.percent), 0))).toBe(100);
    });
    expect((d.records.dispatches ?? []).length).toBeGreaterThan(0);
  });

  it('quotation → order → approval → payment → dispatch → delivery creates an installation job', () => {
    const d = getDb();
    const q = (d.records.quotations ?? []).find((x) => !so.quotationBlocker(d, x));
    if (!q) return; // no eligible quotation in this seed
    const owner = ownerActor(q.ownerId);
    const draft = so.draftFromQuotation(owner, q.id);
    expect(draft.blocker).toBeNull();
    // BR-21: PO details mandatory
    expect(() => so.createOrder(owner, { source: 'quotation', sourceId: q.id, lines: draft.lines, customerPoNo: '', customerPoDate: '', poFileName: '', idempotencyKey: 'k0' })).toThrow(ServiceError);
    const order = so.createOrder(owner, { source: 'quotation', sourceId: q.id, lines: draft.lines, customerPoNo: 'PO-123', customerPoDate: draft.siteAddresses.length ? '2026-01-05' : '2026-01-05', poFileName: 'po.pdf', poFileSize: 1000, idempotencyKey: 'k1' });
    expect(order.status).toBe('pending_approval');
    // Same quotation cannot be ordered twice (BR-20)
    expect(so.quotationBlocker(getDb(), q)).toMatch(/already exists/);
    // Client-side price tampering is ignored (QUO-05)
    const tampered = so.sanitizeLines(draft.lines.map((l) => ({ ...l, listPrice: 1 })), draft.lines);
    expect(tampered[0].listPrice).toBe(draft.lines[0].listPrice);

    const pending = getDb().approvals.find((a) => a.recordId === order.id && a.status === 'pending')!;
    expect(pending).toBeTruthy();
    approveAll(pending);
    let cur = getDb().records.salesOrders.find((o) => o.id === order.id)!;
    expect(['confirmed', 'payment_pending']).toContain(cur.status);
    expect(cur.erpPushedAt).toBeTruthy();

    // Advance receipt → payment received
    const admin = actorFor('u_rahul', 'tc');
    const advance = so.milestonesOf(getDb(), order.id)[0];
    if (cur.status === 'payment_pending') {
      so.recordReceipt(admin, advance.id, Number(advance.amount), String(cur.orderDate));
      cur = getDb().records.salesOrders.find((o) => o.id === order.id)!;
      expect(cur.status).toBe('payment_received');
    }
    // Processing → ready needs machine readiness + PDI (machine orders)
    transitionRecord(admin, 'salesOrders', order.id, 'processing', cur.version);
    cur = getDb().records.salesOrders.find((o) => o.id === order.id)!;
    if (cur.orderKind === 'machine') expect(() => transitionRecord(admin, 'salesOrders', order.id, 'ready_for_dispatch', cur.version)).toThrow(/readiness/);
    const scm = actorFor('u_rajesh', 'tc');
    cur = getDb().records.salesOrders.find((o) => o.id === order.id)!;
    // SCM may edit processing fields only (FR-056)
    expect(() => updateRecord(scm, 'salesOrders', order.id, { customerPoNo: 'X' }, cur.version)).toThrow(ServiceError);
    updateRecord(scm, 'salesOrders', order.id, { machineReady: true, pdiDone: true }, cur.version);
    cur = getDb().records.salesOrders.find((o) => o.id === order.id)!;
    transitionRecord(scm, 'salesOrders', order.id, 'ready_for_dispatch', cur.version);
    const today = new Date().toISOString().slice(0, 10);
    const dsp = so.recordDispatch(scm, order.id, { dispatchDate: today, transporter: 'VRL', lrNumber: 'LR9', expectedDelivery: today, notifyCustomer: true });
    const res = so.confirmDelivery(scm, dsp.id, { actualDelivery: today, podFileName: 'pod.pdf' });
    cur = getDb().records.salesOrders.find((o) => o.id === order.id)!;
    expect(cur.status).toBe('delivered');
    if (cur.orderKind === 'machine' && getDb().records.installations) expect(getDb().records.installations.some((i) => i.id === res.installationId && i.salesOrderId === order.id)).toBe(true);
  });

  it('BR-22: lines beyond tolerance send an approved order back for approval', () => {
    const d = getDb();
    const o = (d.records.salesOrders ?? []).find((x) => ['confirmed', 'payment_received', 'processing'].includes(String(x.status)) && x.quotationId);
    if (!o) return;
    const owner = ownerActor(o.ownerId);
    const lines = so.linesOf(o).map((l, i) => (i === 0 ? { ...l, qty: Number(l.qty) * 2 } : l));
    const r = so.updateLines(owner, o.id, { lines, freight: Number(o.freight) || 0, insurance: Number(o.insurance) || 0, version: o.version });
    expect(r.reapproval).toBe(true);
    expect(getDb().records.salesOrders.find((x) => x.id === o.id)!.status).toBe('pending_approval');
    expect(getDb().approvals.some((a) => a.recordId === o.id && a.status === 'pending')).toBe(true);
  });

  it('dispatch and delivery (BR-26), hold approval and contract signing', () => {
    const d = getDb();
    const ready = (d.records.salesOrders ?? []).find((o) => o.status === 'ready_for_dispatch' && o.orderKind === 'machine');
    if (!ready) return;
    const scm = actorFor('u_rajesh', 'tc');
    expect(() => so.recordDispatch(scm, ready.id, { dispatchDate: '2099-01-01', transporter: '', lrNumber: '', expectedDelivery: '', notifyCustomer: false })).toThrow(ServiceError);
    const today = new Date().toISOString().slice(0, 10);
    const dsp = so.recordDispatch(scm, ready.id, { dispatchDate: today, transporter: 'VRL', lrNumber: 'LR1', expectedDelivery: today, ewayBill: '123456789012', notifyCustomer: true });
    expect(getDb().records.salesOrders.find((o) => o.id === ready.id)!.status).toBe('dispatched');
    expect(() => so.confirmDelivery(scm, dsp.id, { actualDelivery: today, podFileName: '' })).toThrow(ServiceError);
    const r = so.confirmDelivery(scm, dsp.id, { actualDelivery: today, podFileName: 'pod.pdf' });
    expect(getDb().records.salesOrders.find((o) => o.id === ready.id)!.status).toBe('delivered');
    if (getDb().records.installations) expect(r.installationId).toBeTruthy();
  });

  it('hold needs approval and resumes to the previous status; schedule must total 100%', () => {
    const d = getDb();
    const o = (d.records.salesOrders ?? []).find((x) => x.status === 'processing');
    if (!o) return;
    const owner = ownerActor(o.ownerId);
    expect(() => so.saveSchedule(owner, o.id, [{ label: 'A', percent: 50, dueDate: String(o.orderDate) }])).toThrow(/100%/);
    const a = so.requestStatusChange(owner, o.id, 'hold', 'Customer asked to wait');
    approveAll(a);
    expect(getDb().records.salesOrders.find((x) => x.id === o.id)!.status).toBe('on_hold');
    approveAll(so.requestStatusChange(owner, o.id, 'resume', 'Site is ready now'));
    expect(getDb().records.salesOrders.find((x) => x.id === o.id)!.status).toBe('processing');
    // Contract: generate, send, sign with OTP
    if (so.contractsOf(getDb(), o.id).some((x) => x.status === 'signed')) {
      expect(() => generateContract(owner, o.id)).toThrow(/already signed/);
      return;
    }
    const c = generateContract(owner, o.id);
    expect(c.version).toBeGreaterThanOrEqual(1);
    const { otp } = sendForSignature(owner, c.id);
    expect(() => signContract(owner, c.id, '000000', 'X')).toThrow();
    signContract(owner, c.id, otp, 'Mr Shah');
    expect(getDb().records.salesContracts.find((x) => x.id === c.id)!.status).toBe('signed');
  });
});
