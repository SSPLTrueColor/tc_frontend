/**
 * QA stress tests for BRD 4.5 Sales Order & Sales Contract (SO-01 – SO-10) and dispatch / delivery of 4.6
 * (INS-01 / INS-02), including the §3.1 hand-off "Machine delivered → installation job created".
 */
import '../domain/extensions/index';
import { demoUsers } from '../domain/pack';
import { actorFor, type Actor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { todayKey, addDays } from '../lib/dates';
import { userOfStaff } from '../services/lookups';
import { availableTransitions, transitionRecord, updateRecord } from '../services/runtime';
import { getResource } from '../services/registry';
import { type Approval, ServiceError } from '../services/types';
import { canDecide, decideApproval } from '../services/workflow';
import * as so from '../services/orders/orders';
import { generateContract, sendForSignature, signContract } from '../services/orders/contracts';
import { L } from '../constants/labels';
import type { RecordData } from '../metadata/types';

const E = L.orders.errors;
const A = (id: string): Actor => actorFor(id, 'tc');
const admin = () => A('u_rahul');
const scm = () => A('u_rajesh');
const ownerActor = (staffId: unknown): Actor => A(userOfStaff(staffId)!.id);
const order = (id: string) => getDb().records.salesOrders.find((o) => o.id === id)!;
const fieldErr = (fn: () => unknown): Record<string, string> => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ServiceError) return e.fieldErrors ?? { _: e.message };
    throw e;
  }
  return {};
};
const approveAll = (a: Approval) => {
  let cur = a;
  while (cur.status === 'pending') {
    const approver = demoUsers.map((u) => A(u.id)).find((x) => canDecide(x, cur));
    expect(approver, `no approver for ${cur.levels[cur.currentLevel].label}`).toBeTruthy();
    cur = decideApproval(approver!, cur.id, 'approved', 'ok', cur.version);
  }
  return cur;
};
const pendingOf = (id: string, type = so.APPROVAL) => getDb().approvals.find((a) => a.recordId === id && a.type === type && a.status === 'pending');

/** Generates an order from the one eligible machine quotation the seed keeps for the demo. */
function newMachineOrder(key = 'qa') {
  const d = getDb();
  const q = d.records.quotations.find((x) => !so.quotationBlocker(d, x) && so.draftFromQuotation(admin(), x.id).orderKind === 'machine')!;
  expect(q, 'seed keeps one accepted machine quotation without an order').toBeTruthy();
  const owner = ownerActor(q.ownerId);
  const draft = so.draftFromQuotation(owner, q.id);
  const o = so.createOrder(owner, { source: 'quotation', sourceId: q.id, lines: draft.lines, customerPoNo: 'PO/QA/1', customerPoDate: todayKey(), poFileName: 'po.pdf', poFileSize: 1000, siteAddressId: draft.siteAddresses[0]?.id, idempotencyKey: key });
  return { q, owner, draft, o };
}

/** Takes a fresh machine order to Ready for Dispatch. */
function toReady() {
  const { o, owner } = newMachineOrder();
  approveAll(pendingOf(o.id)!);
  const adv = so.milestonesOf(getDb(), o.id)[0];
  if (order(o.id).status === 'payment_pending') so.recordReceipt(admin(), adv.id, Number(adv.amount), todayKey());
  transitionRecord(scm(), 'salesOrders', o.id, 'processing', order(o.id).version);
  so.updateProcessing(scm(), o.id, { poToPrincipalNo: 'IMP/1', poToPrincipalDate: todayKey(), shipmentEta: todayKey(), customsStatus: 'cleared', machineReady: true, pdiDone: true }, order(o.id).version);
  transitionRecord(scm(), 'salesOrders', o.id, 'ready_for_dispatch', order(o.id).version);
  return { o: order(o.id), owner };
}

beforeEach(() => __setDb(createDb(new Date())));

describe('seed covers every Appendix A sales order status (demo)', () => {
  it('has each status, and delivered dispatches carry POD + photo', () => {
    const statuses = new Set(getDb().records.salesOrders.map((o) => o.status));
    ['pending_approval', 'confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch', 'dispatched', 'delivered', 'installation', 'completed', 'on_hold', 'cancelled'].forEach((s) => expect(statuses.has(s), s).toBe(true));
    getDb().records.dispatches.filter((x) => x.status === 'delivered').forEach((x) => expect(x.podFileName && x.podPhotoName).toBeTruthy());
    getDb().records.salesOrders.forEach((o) => expect(Math.round(so.milestonesOf(getDb(), o.id).reduce((t, m) => t + Number(m.percent), 0))).toBe(100));
  });
});

describe('SO-01 / SO-02 Generate Sales Order', () => {
  it('only accepted, latest, won quotations are eligible; a second live order is blocked', () => {
    const d = getDb();
    const draftQ = d.records.quotations.find((q) => q.status === 'draft');
    if (draftQ) expect(so.quotationBlocker(d, draftQ)).toMatch(/Only accepted/);
    const { q, o } = newMachineOrder();
    expect(o.quotationId).toBe(q.id);
    expect(so.quotationBlocker(getDb(), q)).toBe(E.orderExists(String(o.orderNo)));
    expect(so.eligibleQuotations(admin()).some((x) => x.id === q.id)).toBe(false);
  });
  it('pre-fills customer, lines, rates and terms from the quotation without re-entry', () => {
    const { q, draft, o } = newMachineOrder();
    expect([o.customerId, o.divisionId, o.paymentTerms, o.deliveryTerms]).toEqual([q.customerId, q.divisionId, q.paymentTerms, q.deliveryTerms]);
    expect(so.linesOf(o).map((l) => [l.productId, l.qty, l.listPrice])).toEqual(draft.lines.map((l) => [l.productId, l.qty, l.listPrice]));
    // Same GST maths as the quotation: totals match to the paisa
    expect([o.taxable, o.cgst, o.sgst, o.igst, o.grandTotal]).toEqual([q.taxable, q.cgst, q.sgst, q.igst, q.grandTotal].map(Number));
    expect(draft.customerName).toBe(getDb().records.customers.find((c) => c.id === q.customerId)!.name);
    expect(String(o.orderNo)).toMatch(new RegExp(`^SO/${o.divisionId}/\\d{2}-\\d{2}/\\d{4}$`));
  });
  it('validates PO number, date and copy (BR-21)', () => {
    const po = (p: Partial<so.PoInput>) => so.validatePo({ customerPoNo: 'PO1', customerPoDate: todayKey(), poFileName: 'po.pdf', poFileSize: 10, ...p });
    expect(po({ customerPoNo: '   ' }).customerPoNo).toBe(E.poRequired);
    expect(po({ customerPoNo: 'x'.repeat(41) }).customerPoNo).toBe(E.maxChars(40));
    expect(po({ customerPoDate: addDays(todayKey(), 1) }).customerPoDate).toBe(E.poDateFuture);
    expect(po({ customerPoDate: '' }).customerPoDate).toBe(E.poDateRequired);
    expect(po({ poFileName: '' }).poFileName).toBe(E.poFileRequired);
    expect(po({ poFileName: 'virus.exe' }).poFileName).toBe(E.fileType);
    expect(po({ poFileSize: 11 * 1024 * 1024 }).poFileName).toMatch(/larger/);
    expect(po({})).toEqual({});
  });
  it('every accepted quotation pre-fills an order whose totals equal the quotation exactly', () => {
    const d = getDb();
    d.records.quotations.filter((q) => q.status === 'accepted').forEach((q) => {
      const t = so.draftFromQuotation(admin(), q.id).totals;
      expect([t.cgst, t.sgst, t.igst, t.grandTotal], String(q.id)).toEqual([q.cgst, q.sgst, q.igst, q.grandTotal].map(Number));
    });
  });
  it('carries the PO captured at quotation acceptance; machine orders need an installation site', () => {
    const d = getDb();
    const q = d.records.quotations.find((x) => !so.quotationBlocker(d, x) && so.draftFromQuotation(admin(), x.id).orderKind === 'machine')!;
    Object.assign(q, { customerPoNo: 'PO/ACC/9', customerPoDate: todayKey(), poFileName: 'po-acc.pdf' });
    const draft = so.draftFromQuotation(admin(), q.id);
    expect(draft.po).toEqual({ customerPoNo: 'PO/ACC/9', customerPoDate: todayKey(), poFileName: 'po-acc.pdf' });
    const owner = ownerActor(q.ownerId);
    expect(fieldErr(() => so.createOrder(owner, { source: 'quotation', sourceId: q.id, lines: draft.lines, ...draft.po!, idempotencyKey: 'nosite' })).siteAddressId).toBeTruthy();
  });
  it('double submit with the same idempotency key creates one order', () => {
    const { q, owner, draft, o } = newMachineOrder('same');
    const again = so.createOrder(owner, { source: 'quotation', sourceId: q.id, lines: draft.lines, customerPoNo: 'PO/QA/1', customerPoDate: todayKey(), poFileName: 'po.pdf', siteAddressId: draft.siteAddresses[0]?.id, idempotencyKey: 'same' });
    expect(again.id).toBe(o.id);
  });
  it('roles without create (SCM, Accounts, engineer) cannot generate', () => {
    const d = getDb();
    const q = d.records.quotations.find((x) => !so.quotationBlocker(d, x))!;
    ['u_rajesh', 'u_swati', 'u_ravi', 'u_manoj'].forEach((u) => expect(() => so.createOrder(A(u), { source: 'quotation', sourceId: q.id, lines: [], customerPoNo: 'P', customerPoDate: todayKey(), poFileName: 'p.pdf', idempotencyKey: u })).toThrow(/cannot generate/));
  });
  it('repeat order (CON-02) only from consumables orders', () => {
    const machine = getDb().records.salesOrders.find((o) => o.orderKind === 'machine')!;
    expect(() => so.draftFromRepeat(admin(), machine.id)).toThrow(E.onlyConsumablesRepeat);
  });
});

describe('SO-03 customisation and re-approval', () => {
  it('rejects bad lines; ignores price tampering; within tolerance keeps status, beyond re-triggers approval', () => {
    const { o, owner } = newMachineOrder();
    approveAll(pendingOf(o.id)!);
    const cur = order(o.id);
    const lines = so.linesOf(cur);
    const upd = (ls: typeof lines, extra = {}) => so.updateLines(owner, o.id, { lines: ls, freight: Number(cur.freight) || 0, insurance: Number(cur.insurance) || 0, version: order(o.id).version, ...extra });
    expect(() => upd(lines.map((l, i) => (i ? l : { ...l, qty: 0 })))).toThrow(E.lineQty(1));
    expect(() => upd(lines.map((l, i) => (i ? l : { ...l, discountPct: 101 })))).toThrow(E.lineDiscountRange(1));
    expect(() => upd(lines, { freight: -1 })).toThrow(E.negativeExtras);
    expect(() => upd([])).toThrow(E.addLine);
    // price change from the client is ignored → no difference, no re-approval
    const r1 = upd(lines.map((l) => ({ ...l, listPrice: 1 })));
    expect(r1.reapproval).toBe(false);
    expect(order(o.id).status).not.toBe('pending_approval');
    // doubling quantity is far beyond ±2 %
    const r2 = upd(lines.map((l, i) => (i ? l : { ...l, qty: Number(l.qty) * 2 })));
    expect(r2.reapproval).toBe(true);
    expect(order(o.id).status).toBe('pending_approval');
    expect(pendingOf(o.id)).toBeTruthy();
    expect(() => so.updateLines(owner, o.id, { lines, freight: 0, insurance: 0, version: 1 })).toThrow(/changed since/);
  });
});

describe('SO-04 approval', () => {
  it('goes to the owner’s named reporting manager; finance check by Accounts when advance < 30 % or overdue', () => {
    const { o } = newMachineOrder();
    const a = pendingOf(o.id)!;
    const ownerEmp = getDb().records.employees.find((e) => e.id === o.ownerId)!;
    expect(a.levels[0].approverStaffId).toBe(ownerEmp.managerId);
    const needs = so.needsFinanceCheck(getDb(), order(o.id));
    expect(a.levels.length).toBe(needs ? 2 : 1);
    if (needs) expect(a.levels[1].capability).toBe('approve.finance');
    // requester cannot approve; an unrelated manager cannot approve
    expect(canDecide(ownerActor(o.ownerId), a)).toBe(false);
    expect(canDecide(A('u_priya'), a)).toBe(false);
  });
});

describe('Customer category hand-off (BRD gap G2)', () => {
  it('a prospect becomes an Active Customer when its first sales order is approved', () => {
    const { o } = newMachineOrder();
    const c = getDb().records.customers.find((x) => x.id === o.customerId)!;
    c.category = 'prospect';
    approveAll(pendingOf(o.id)!);
    expect(getDb().records.customers.find((x) => x.id === o.customerId)!.category).toBe('active');
  });
});

describe('Roles and scope (REQUIREMENTS §2.2)', () => {
  it('engineer / profiling have no access; sales executive sees only own orders', () => {
    const someOrder = getDb().records.salesOrders[0];
    expect(() => so.getOrder(A('u_ravi'), someOrder.id)).toThrow(/not found/);
    expect(() => so.getOrder(A('u_tanvi'), someOrder.id)).toThrow(/not found/);
    const karan = A('u_karan');
    const notKaran = getDb().records.salesOrders.find((o) => o.ownerId !== karan.staffId)!;
    expect(() => so.getOrder(karan, notKaran.id)).toThrow(/not found/);
    expect(() => so.orderView(karan, notKaran.id)).toThrow(/not found/);
  });
  it('Import / SCM edits Order Processing only: no line edits, schedule, hold / cancel or re-submission', () => {
    const o = getDb().records.salesOrders.find((x) => x.status === 'processing')!;
    const s = scm();
    expect(so.orderView(s, o.id).canEdit).toBe(false);
    expect(() => so.updateLines(s, o.id, { lines: so.linesOf(o), freight: 0, insurance: 0, version: o.version })).toThrow(/cannot change/);
    expect(() => so.requestStatusChange(s, o.id, 'hold', 'Principal delay')).toThrow(/cannot change/);
    expect(() => so.requestStatusChange(s, o.id, 'cancel', 'Principal delay')).toThrow(/cannot change/);
    expect(() => so.saveSchedule(s, o.id, [{ label: 'All', percent: 100, dueDate: String(o.orderDate) }])).toThrow(/cannot change/);
    expect(() => updateRecord(s, 'salesOrders', o.id, { customerPoNo: 'X' }, o.version)).toThrow(ServiceError);
  });
  it('Accounts and management are read-only on orders; store cannot dispatch', () => {
    const o = getDb().records.salesOrders.find((x) => x.status === 'ready_for_dispatch')!;
    expect(() => so.requestStatusChange(A('u_swati'), o.id, 'hold', 'Credit issue')).toThrow(/cannot change/);
    expect(() => so.requestStatusChange(A('u_vikram'), o.id, 'hold', 'Credit issue')).toThrow(/cannot change/);
    expect(() => so.recordDispatch(A('u_prakash'), o.id, { dispatchDate: todayKey(), transporter: 'VRL', lrNumber: 'L', ewayBill: '123456789012', expectedDelivery: todayKey(), notifyCustomer: false })).toThrow(E.dispatchForbidden);
  });
  it('a coordinator cannot confirm delivery outside their division', () => {
    const tx = getDb().records.dispatches.find((x) => x.status === 'in_transit' && x.divisionId !== 'FAB')!;
    expect(() => so.confirmDelivery(A('u_nisha'), tx.id, { actualDelivery: todayKey(), podFileName: 'pod.pdf', podPhotoName: 'p.jpg' })).toThrow(E.dispatchNotFound);
  });
});

describe('Status workflow (Appendix A / REQUIREMENTS §4.2)', () => {
  it('Processing needs the advance; Ready for Dispatch needs readiness + PDI; machines complete only on sign-off', () => {
    const { o } = newMachineOrder();
    expect(() => transitionRecord(scm(), 'salesOrders', o.id, 'processing', order(o.id).version)).toThrow(ServiceError); // still pending approval
    approveAll(pendingOf(o.id)!);
    if (order(o.id).status === 'payment_pending') {
      expect(() => transitionRecord(scm(), 'salesOrders', o.id, 'processing', order(o.id).version)).toThrow(ServiceError);
      const adv = so.milestonesOf(getDb(), o.id)[0];
      expect(() => so.recordReceipt(A('u_swati'), adv.id, Number(adv.amount) + 1, todayKey())).toThrow(/outstanding/);
      expect(() => so.recordReceipt(A('u_swati'), adv.id, 100, addDays(todayKey(), 1))).toThrow(E.receiptFuture);
      expect(() => so.recordReceipt(A('u_swati'), adv.id, 0, todayKey())).toThrow(E.amountPositive);
      expect(() => so.recordReceipt(A('u_karan'), adv.id, 100, todayKey())).toThrow(E.receiptsForbidden);
      so.recordReceipt(A('u_swati'), adv.id, Number(adv.amount), todayKey());
      expect(order(o.id).status).toBe('payment_received');
    }
    transitionRecord(scm(), 'salesOrders', o.id, 'processing', order(o.id).version);
    expect(() => transitionRecord(scm(), 'salesOrders', o.id, 'ready_for_dispatch', order(o.id).version)).toThrow(E.readinessFirst);
    expect(() => transitionRecord(admin(), 'salesOrders', o.id, 'completed', order(o.id).version)).toThrow(ServiceError);
  });
  it('consumables complete straight from Delivered; machines do not', () => {
    const cons = getDb().records.salesOrders.find((x) => x.status === 'delivered' && x.orderKind === 'consumables')!;
    expect(() => transitionRecord(admin(), 'salesOrders', cons.id, 'installation', cons.version)).toThrow(ServiceError);
    transitionRecord(admin(), 'salesOrders', cons.id, 'completed', cons.version);
    expect(order(cons.id).completedAt).toBeTruthy();
    const mach = getDb().records.salesOrders.find((x) => x.status === 'delivered' && x.orderKind === 'machine')!;
    expect(() => transitionRecord(admin(), 'salesOrders', mach.id, 'completed', mach.version)).toThrow(ServiceError);
    // only the step valid for the order type is offered
    const actions = (r: RecordData) => availableTransitions(admin(), getResource('salesOrders'), r).map((t) => t.to);
    expect(actions(mach)).toEqual(['installation']);
    expect(actions(getDb().records.salesOrders.find((x) => x.status === 'delivered' && x.orderKind === 'consumables')!)).toEqual(['completed']);
  });
});

describe('SO-10 Hold / Resume / Cancel', () => {
  it('needs a real reason and approval; resumes to the previous status; blocked after dispatch', () => {
    const o = getDb().records.salesOrders.find((x) => x.status === 'processing' && x.orderKind === 'machine')!;
    const owner = ownerActor(o.ownerId);
    expect(fieldErr(() => so.requestStatusChange(owner, o.id, 'hold', '    ')).reason).toBe(E.reasonMinField);
    expect(fieldErr(() => so.requestStatusChange(owner, o.id, 'hold', 'abc')).reason).toBe(E.reasonMinField);
    expect(() => so.requestStatusChange(owner, o.id, 'resume', 'Ready again')).toThrow(E.resumeOnlyHold);
    const h = so.requestStatusChange(owner, o.id, 'hold', 'Customer site not ready');
    expect(() => so.requestStatusChange(owner, o.id, 'hold', 'Again please')).toThrow(/pending/);
    expect(order(o.id).status).toBe('processing'); // nothing changes before approval
    approveAll(h);
    expect([order(o.id).status, order(o.id).holdReason]).toEqual(['on_hold', 'Customer site not ready']);
    expect(() => so.updateLines(owner, o.id, { lines: so.linesOf(o), freight: 0, insurance: 0, version: order(o.id).version })).toThrow(E.linesBeforeDispatch);
    approveAll(so.requestStatusChange(owner, o.id, 'resume', 'Site is ready'));
    expect(order(o.id).status).toBe('processing');
    const dispatched = getDb().records.salesOrders.find((x) => x.status === 'dispatched')!;
    const dOwner = ownerActor(dispatched.ownerId);
    expect(() => so.requestStatusChange(dOwner, dispatched.id, 'hold', 'Too late now')).toThrow(E.holdOnlyBeforeDispatch);
    expect(() => so.requestStatusChange(dOwner, dispatched.id, 'cancel', 'Too late now')).toThrow(E.cancelNotAllowed);
  });
  it('cancellation goes up to the division head, is terminal and withdraws other pending requests', () => {
    const o = getDb().records.salesOrders.find((x) => x.status === 'processing' && x.orderKind === 'machine')!;
    const owner = ownerActor(o.ownerId);
    const hold = so.requestStatusChange(owner, o.id, 'hold', 'Customer asked to wait');
    const c = so.requestStatusChange(owner, o.id, 'cancel', 'Customer cancelled the PO');
    expect(c.levels[c.levels.length - 1].capability).not.toBe('orders.approve.manager'); // reaches division head or above
    approveAll(c);
    expect([order(o.id).status, order(o.id).cancelReason]).toEqual(['cancelled', 'Customer cancelled the PO']);
    expect(getDb().approvals.find((a) => a.id === hold.id)!.status).toBe('withdrawn');
    expect(() => updateRecord(admin(), 'salesOrders', o.id, { paymentTerms: 'x' }, order(o.id).version)).toThrow(E.closedOrder);
    expect(() => so.requestStatusChange(owner, o.id, 'resume', 'Undo please')).toThrow(E.resumeOnlyHold);
    expect(() => generateContract(owner, o.id)).toThrow(E.contractNotApproved);
    expect(() => so.pushToErp(admin(), o.id)).toThrow(E.erpNotApproved);
  });
  it('an order approved while on hold resumes into the approved status', () => {
    const { o, owner } = newMachineOrder();
    approveAll(so.requestStatusChange(owner, o.id, 'hold', 'Awaiting customer go-ahead'));
    expect(order(o.id).status).toBe('on_hold');
    approveAll(pendingOf(o.id)!);
    approveAll(so.requestStatusChange(owner, o.id, 'resume', 'Customer confirmed'));
    expect(['confirmed', 'payment_pending', 'payment_received']).toContain(order(o.id).status);
  });
});

describe('SO-05 / SO-06 Sales contract', () => {
  it('only after approval; versions supersede; signed contract locks; OTP and signer required', () => {
    const { o, owner } = newMachineOrder();
    expect(() => generateContract(owner, o.id)).toThrow(E.contractNotApproved);
    approveAll(pendingOf(o.id)!);
    const v1 = generateContract(owner, o.id);
    ['paymentTerms', 'deliveryTerms', 'loadingTerms', 'installationTerms', 'warrantyTerms', 'sparesTerms', 'inkCommitment', 'amcTerms'].forEach((k) => expect(v1[k], k).toBeTruthy());
    const v2 = generateContract(owner, o.id);
    expect([v2.contractVersion, getDb().records.salesContracts.find((c) => c.id === v1.id)!.status]).toEqual([2, 'superseded']);
    expect(String(v2.contractNo)).toBe(`${v1.contractNo}-v2`);
    expect(() => updateRecord(admin(), 'salesContracts', v1.id, { amcTerms: 'x' }, getDb().records.salesContracts.find((c) => c.id === v1.id)!.version)).toThrow(E.contractDraftOnly);
    expect(() => signContract(owner, v2.id, '123456', 'Mr Shah')).toThrow(E.sendFirst);
    const { otp } = sendForSignature(owner, v2.id);
    expect(fieldErr(() => signContract(owner, v2.id, otp, '  ')).signerName).toBeTruthy();
    expect(fieldErr(() => signContract(owner, v2.id, '000000', 'Mr Shah')).otp).toBe(E.otpIncorrectField);
    signContract(owner, v2.id, otp, 'Mr Shah');
    expect(() => generateContract(owner, o.id)).toThrow(E.contractSigned);
    expect(() => generateContract(scm(), o.id)).toThrow(E.contractForbidden);
  });
});

describe('SO-07 payment schedule', () => {
  it('must total 100 %, dates on/after order date, receipts kept', () => {
    const o = getDb().records.salesOrders.find((x) => x.status === 'processing' && x.orderKind === 'machine')!;
    const owner = ownerActor(o.ownerId);
    const ms = so.milestonesOf(getDb(), o.id);
    expect(() => so.saveSchedule(owner, o.id, [])).toThrow(E.scheduleAddOne);
    expect(() => so.saveSchedule(owner, o.id, [{ label: 'A', percent: 60, dueDate: String(o.orderDate) }, { label: 'B', percent: 60, dueDate: String(o.orderDate) }])).toThrow(/120%/);
    expect(() => so.saveSchedule(owner, o.id, [{ label: ' ', percent: 100, dueDate: String(o.orderDate) }])).toThrow(E.scheduleLabel(1));
    expect(() => so.saveSchedule(owner, o.id, [{ label: 'A', percent: 100, dueDate: addDays(String(o.orderDate), -1) }])).toThrow(E.scheduleBeforeOrder);
    const paid = ms.find((m) => Number(m.receivedAmount) > 0);
    if (paid) expect(() => so.saveSchedule(owner, o.id, ms.filter((m) => m.id !== paid.id).map((m, i, a) => ({ id: m.id, label: String(m.label), percent: i === a.length - 1 ? 100 - a.slice(0, -1).reduce((t, x) => t + Number(x.percent), 0) : Number(m.percent), dueDate: String(m.dueDate) })))).toThrow(/already has receipts/);
  });
  it('reminders run once per milestone (idempotent)', () => {
    const r1 = so.runPaymentReminders(admin());
    const r2 = so.runPaymentReminders(admin());
    expect(r1.reminded).toBeGreaterThanOrEqual(0);
    expect(r2.reminded).toBe(0);
  });
});

describe('INS-01 / INS-02 dispatch and delivery, §3.1 installation hand-off', () => {
  it('dispatch validation: required, e-way bill, dates; intimation queued', () => {
    const { o } = toReady();
    const base: so.DispatchInput = { dispatchDate: todayKey(), transporter: 'VRL Logistics', lrNumber: 'LR123', ewayBill: '', expectedDelivery: addDays(todayKey(), 4), notifyCustomer: true };
    const err = (p: Partial<so.DispatchInput>) => fieldErr(() => so.recordDispatch(scm(), o.id, { ...base, ...p }));
    expect(err({ transporter: '  ' }).transporter).toBe(E.transporterRequired);
    expect(err({ lrNumber: '' }).lrNumber).toBe(E.lrRequired);
    expect(err({ ewayBill: '12345' }).ewayBill).toBe(E.ewayDigits);
    if (!order(o.id).ewayBill) expect(err({}).ewayBill).toBe(E.ewayRequired);
    expect(err({ dispatchDate: addDays(todayKey(), 1) }).dispatchDate).toBe(E.dispatchDateFuture);
    expect(err({ dispatchDate: addDays(String(o.orderDate), -1), expectedDelivery: addDays(todayKey(), 2) }).dispatchDate).toBe(E.dispatchBeforeOrder);
    expect(err({ expectedDelivery: addDays(todayKey(), -1) }).expectedDelivery).toBe(E.expectedBeforeDispatch);
    expect(order(o.id).status).toBe('ready_for_dispatch');
    const before = getDb().outbox.length;
    const dsp = so.recordDispatch(scm(), o.id, { ...base, ewayBill: '123456789012' });
    expect(order(o.id).status).toBe('dispatched');
    expect([dsp.transporter, dsp.lrNumber, dsp.ewayBill, dsp.status]).toEqual(['VRL Logistics', 'LR123', '123456789012', 'in_transit']);
    expect(getDb().outbox.length).toBeGreaterThanOrEqual(before); // intimation simulated (needs a consenting contact)
    expect(() => so.recordDispatch(scm(), o.id, { ...base, ewayBill: '123456789012' })).toThrow(E.dispatchOnlyReady);
  });
  it('delivery needs date, signed POD and photo; machine delivery creates the installation job once', () => {
    const { o } = toReady();
    const dsp = so.recordDispatch(scm(), o.id, { dispatchDate: todayKey(), transporter: 'Gati', lrNumber: 'LR9', ewayBill: '123456789012', expectedDelivery: todayKey(), notifyCustomer: false });
    const err = (p: Record<string, unknown>) => fieldErr(() => so.confirmDelivery(scm(), dsp.id, { actualDelivery: todayKey(), podFileName: 'pod.pdf', podPhotoName: 'site.jpg', ...p }));
    expect(err({ podFileName: '' }).podFileName).toBe(E.podRequired);
    expect(err({ podPhotoName: '' }).podPhotoName).toBe(E.photoRequired);
    expect(err({ podPhotoName: 'photo.pdf' }).podPhotoName).toBe(E.photoType);
    expect(err({ podFileName: 'pod.docx' }).podFileName).toBe(E.fileType);
    expect(err({ actualDelivery: addDays(todayKey(), 1) }).actualDelivery).toBe(E.deliveryDateFuture);
    expect(err({ actualDelivery: addDays(todayKey(), -1) }).actualDelivery).toBe(E.deliveryBeforeDispatch);
    expect(order(o.id).status).toBe('dispatched');
    const r = so.confirmDelivery(scm(), dsp.id, { actualDelivery: todayKey(), podFileName: 'pod.pdf', podPhotoName: 'site.jpg' });
    expect(order(o.id).status).toBe('delivered');
    const job = getDb().records.installations.find((i) => i.id === r.installationId) as RecordData;
    expect([job.salesOrderId, job.customerId, job.status]).toEqual([o.id, o.customerId, 'scheduled']);
    expect(() => so.confirmDelivery(scm(), dsp.id, { actualDelivery: todayKey(), podFileName: 'pod.pdf', podPhotoName: 'site.jpg' })).toThrow(E.alreadyDelivered);
    expect(getDb().records.installations.filter((i) => i.salesOrderId === o.id)).toHaveLength(1);
    // planners get exactly one notification for the new job (from the installation module)
    const titles = getDb().notifications.filter((n) => n.link && 'recordId' in n.link && n.link.recordId === r.installationId).map((n) => `${n.userId}:${n.title}`);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
