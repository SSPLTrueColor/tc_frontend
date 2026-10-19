/** QA stress tests for BRD 4.4 Quotation Management (QUO-01 … QUO-13). */
import '../domain/extensions/quotations';
import { addDays, todayKey } from '../lib/dates';
import { demoUsers } from '../domain/pack';
import { type Actor, actorFor } from '../services/authz';
import { __setDb, createDb, getDb } from '../services/db';
import { listPriceFor } from '../services/lookups';
import { transitionRecord, updateRecord } from '../services/runtime';
import { computeTotals, lineAmounts, type QuoteLine, rupeesInWords, validateLines } from '../services/quotations/pricing';
import { resolveQuoteLevels } from '../services/quotations/approvalLevels';
import {
  acceptQuote,
  backToDraft,
  canDecideQuote,
  decideQuoteApproval,
  getQuote,
  pendingQuoteApprovals,
  rejectQuote,
  reviseQuote,
  runQuotationSweep,
  saveQuote,
  sendQuote,
  submitQuote,
} from '../services/quotations/workflow';
import { canDecide } from '../services/workflow';

const ln = (o: Partial<QuoteLine>): QuoteLine => ({ productId: null, description: 'Item', lineType: 'machine', qty: 1, listPrice: 100000, discountPct: 0, discountAmt: 0, hsnSac: '8443', gstRate: 18, landedCost: null, ...o });
const as = (id: string): Actor => actorFor(id, 'tc');
const fresh = (id: string) => getDb().records.quotations.find((q) => q.id === id)!;
const userByStaff = (staff: unknown) => demoUsers.find((u) => u.staffIds.tc === staff);

describe('QUO-04 pricing arithmetic', () => {
  it('0 % and 100 % discount, amount = line value', () => {
    expect(lineAmounts(ln({ discountPct: 0 }))).toMatchObject({ discount: 0, net: 100000, effectivePct: 0 });
    expect(lineAmounts(ln({ discountPct: 100 }))).toMatchObject({ discount: 100000, net: 0, effectivePct: 100 });
    expect(lineAmounts(ln({ qty: 2, discountAmt: 200000 }))).toMatchObject({ net: 0, effectivePct: 100 });
    const t = computeTotals([ln({ discountPct: 100 })], '27', 1000, 0, '27');
    expect(t).toMatchObject({ subtotal: 100000, discountTotal: 100000, taxable: 1000, cgst: 90, sgst: 90, grandTotal: 1180 });
  });

  it('rounds to paise per rate group (intra and inter state)', () => {
    // 3 × 333.33 = 999.99, 7.5 % = 75.00, net 924.99, 18 % = 166.4982 → 166.50; CGST = SGST = 83.2491 → 83.25
    const intra = computeTotals([ln({ qty: 3, listPrice: 333.33, discountPct: 7.5 })], '27', 0, 0, '27');
    expect(intra).toMatchObject({ subtotal: 999.99, discountTotal: 75, taxable: 924.99, cgst: 83.25, sgst: 83.25, igst: 0, grandTotal: 1091.49 });
    const inter = computeTotals([ln({ qty: 3, listPrice: 333.33, discountPct: 7.5 })], '24', 0, 0, '27');
    expect(inter).toMatchObject({ igst: 166.5, cgst: 0, sgst: 0, grandTotal: 1091.49 });
  });

  it('CGST and SGST are always equal halves (BR-16 rate/2 each)', () => {
    const t = computeTotals([ln({ listPrice: 100.05 })], '27', 0, 0, '27');
    expect(t.cgst).toBe(t.sgst);
    expect(t.cgst).toBe(9); // 100.05 × 9 % = 9.0045
    for (let p = 1; p < 400; p += 7.37) {
      const x = computeTotals([ln({ listPrice: Math.round(p * 100) / 100, gstRate: 12 })], '27', 0, 0, '27');
      expect(x.cgst).toBe(x.sgst);
    }
  });

  it('half-paisa values round half up despite binary floating point', () => {
    expect(lineAmounts(ln({ listPrice: 10.05, discountPct: 50 })).discount).toBe(5.03);
    expect(computeTotals([ln({ listPrice: 0.25, gstRate: 18 })], '24', 0, 0, '27').igst).toBe(0.05); // 0.045 → 0.05
  });

  it('freight/insurance taxed at the main line rate; totals add up', () => {
    const t = computeTotals([ln({ listPrice: 500000, gstRate: 18 }), ln({ listPrice: 600000, gstRate: 12, lineType: 'software' })], '24', 10000, 2500, '27');
    expect(t.taxByRate.find((r) => r.rate === 12)!.taxable).toBe(612500);
    expect(t.grandTotal).toBe(Math.round((t.taxable + t.igst) * 100) / 100);
    expect(t.igst).toBe(90000 + 73500);
  });

  it('amount in words (Indian system) incl. crore, thousand-crore and paise', () => {
    expect(rupeesInWords(100000000)).toBe('Rupees Ten Crore Only');
    expect(rupeesInWords(10000000000)).toBe('Rupees One Thousand Crore Only');
    expect(rupeesInWords(0.5)).toBe('Rupees Zero and Fifty Paise Only');
    expect(rupeesInWords(1091.49)).toBe('Rupees One Thousand Ninety One and Forty Nine Paise Only');
    expect(rupeesInWords(118000)).toBe('Rupees One Lakh Eighteen Thousand Only');
  });

  it('validates ranges: fractional/negative qty, negative price, discount > 100 %, negative amount', () => {
    const e = (o: Partial<QuoteLine>) => validateLines([ln(o)]).join(' ');
    expect(e({ qty: 1.5 })).toMatch(/whole number/);
    expect(e({ qty: -1 })).toMatch(/whole number/);
    expect(e({ listPrice: -5 })).toMatch(/zero or more/);
    expect(e({ discountPct: 100.01 })).toMatch(/between 0 and 100/);
    expect(e({ discountPct: -1 })).toMatch(/between 0 and 100/);
    expect(e({ discountAmt: -1 })).toMatch(/negative/);
    expect(e({ hsnSac: '' })).toMatch(/HSN/);
    expect(e({ description: '   ' })).toMatch(/description/);
  });

  it('amount discounts just above 5 % still count as above 5 % (BR-17 bands)', () => {
    expect(lineAmounts(ln({ discountAmt: 5004 })).effectivePct).toBe(5.01);
    expect(lineAmounts(ln({ discountPct: 12 })).effectivePct).toBe(12);
    expect(lineAmounts(ln({ discountPct: 10 })).effectivePct).toBe(10);
  });
});

describe('QUO-06 approver resolution', () => {
  const users = demoUsers;
  const L1 = { capability: 'approve.l1', label: 'Sales Manager' };
  const L2 = { capability: 'approve.l2', label: 'Division Head' };
  const L3 = { capability: 'approve.l3', label: 'Management (MD)' };
  it('level 1 is the owner’s Sales Manager; escalates when there is none', () => {
    const karan = users.find((u) => u.id === 'u_karan')!;
    const r = resolveQuoteLevels([L1], { ownerStaffId: karan.staffIds.tc, requesterUserId: karan.id, divisionId: 'TX', users });
    expect(r).toHaveLength(1);
    expect(r[0].approverStaffId).toBe(users.find((u) => u.id === 'u_rohan')!.staffIds.tc);
    const pooja = users.find((u) => u.id === 'u_pooja')!; // FAB, reports to a Division Head
    expect(resolveQuoteLevels([L1], { ownerStaffId: pooja.staffIds.tc, requesterUserId: pooja.id, divisionId: 'FAB', users }).map((l) => l.capability)).toEqual(['approve.l2']);
    // Manager submitting for his own team member cannot approve his own request → Division Head
    expect(resolveQuoteLevels([L1, L2], { ownerStaffId: karan.staffIds.tc, requesterUserId: 'u_rohan', divisionId: 'TX', users }).map((l) => l.capability)).toEqual(['approve.l2']);
    // Division Head as requester → Management
    expect(resolveQuoteLevels([L1, L2], { ownerStaffId: users.find((u) => u.id === 'u_neha')!.staffIds.tc, requesterUserId: 'u_neha', divisionId: 'INK', users }).map((l) => l.capability)).toEqual(['approve.l3']);
    expect(resolveQuoteLevels([L1, L2, L3], { ownerStaffId: karan.staffIds.tc, requesterUserId: karan.id, divisionId: 'TX', users }).map((l) => l.capability)).toEqual(['approve.l1', 'approve.l2', 'approve.l3']);
  });
});

describe('QUO-01…QUO-12 workflow, roles and scope', () => {
  beforeEach(() => __setDb(createDb(new Date())));

  const oppOf = (userId: string) => {
    const u = demoUsers.find((x) => x.id === userId)!;
    return getDb().records.opportunities.find((o) => o.ownerId === u.staffIds.tc && !['won', 'lost'].includes(String(o.stage)))!;
  };
  const productIn = (div: string) => getDb().records.products.find((p) => p.divisionId === div && listPriceFor(p.id, todayKey()) && Number(listPriceFor(p.id, todayKey())!.listPrice) > 50)!;
  const machineLine = (div: string, discountPct = 0): QuoteLine => {
    const p = productIn(div);
    return ln({ productId: p.id, description: String(p.name), hsnSac: String(p.hsnSac), gstRate: Number(p.gstRate), discountPct });
  };
  const create = (userId: string, discountPct = 0) => {
    const opp = oppOf(userId);
    return fresh(saveQuote(as(userId), { header: { opportunityId: opp.id }, lines: [machineLine(String(opp.divisionId), discountPct)] }).record.id);
  };

  it('QUO-01 numbers per division series, consecutive; R1/R2 suffixes', () => {
    const a = create('u_karan');
    const b = create('u_karan');
    const na = Number(String(a.quoteNo).slice(-4));
    expect(String(b.quoteNo)).toBe(String(a.quoteNo).replace(/\d{4}$/, String(na + 1).padStart(4, '0')));
    expect(String(a.quoteNo)).toMatch(/^QT\/TX\//);
    const p = create('u_priya');
    expect(String(p.quoteNo)).toMatch(/^QT\/POD\//);
    expect(a).toMatchObject({ revision: 0, isLatest: true, status: 'draft' });
    expect(a.validUntil).toBe(addDays(String(a.quoteDate), 30));
    expect(a.customerId).toBeTruthy();
    expect(a.ownerId).toBe(userByStaff(a.ownerId)!.staffIds.tc);
    // revise twice
    submitQuote(as('u_karan'), a.id, a.version, '');
    const r1 = reviseQuote(as('u_karan'), a.id, fresh(a.id).version, 'Price change one');
    expect(String(fresh(r1).quoteNo)).toBe(`${a.quoteNo}-R1`);
    submitQuote(as('u_karan'), r1, fresh(r1).version, '');
    const r2 = reviseQuote(as('u_karan'), r1, fresh(r1).version, 'Price change two');
    expect(String(fresh(r2).quoteNo)).toBe(`${a.quoteNo}-R2`);
    expect(getDb().records.quotations.filter((q) => String(q.rootId || q.id) === a.id && q.isLatest)).toHaveLength(1);
  });

  it('QUO-01 validation: no lines, validity before date, negative freight, lost opportunity', () => {
    const opp = oppOf('u_karan');
    expect(() => saveQuote(as('u_karan'), { header: { opportunityId: opp.id }, lines: [] })).toThrow(/at least one line/);
    expect(() => saveQuote(as('u_karan'), { header: { opportunityId: opp.id, quoteDate: todayKey(), validUntil: addDays(todayKey(), -1) }, lines: [machineLine('TX')] })).toThrow();
    expect(() => saveQuote(as('u_karan'), { header: { opportunityId: opp.id, freight: -100 }, lines: [machineLine('TX')] })).toThrow();
  });

  it('QUO-05 sales users cannot set list prices; Division Head / Admin can', () => {
    const opp = oppOf('u_karan');
    const custom = ln({ description: 'Special jig', lineType: 'accessory', listPrice: 25000, hsnSac: '8443' });
    expect(() => saveQuote(as('u_karan'), { header: { opportunityId: opp.id }, lines: [machineLine('TX'), custom] })).toThrow(/price list/);
    expect(() => saveQuote(as('u_rohan'), { header: { opportunityId: opp.id }, lines: [machineLine('TX'), custom] })).toThrow(/price list/);
    // zero-priced descriptive line is fine
    saveQuote(as('u_karan'), { header: { opportunityId: opp.id }, lines: [machineLine('TX'), { ...custom, listPrice: 0 }] });
    const byDh = saveQuote(as('u_suresh'), { header: { opportunityId: opp.id }, lines: [machineLine('TX'), custom] }).record.id;
    // the sales executive can still edit that draft (line carried unchanged) …
    const q = fresh(byDh);
    updateRecord(as('u_karan'), 'quotations', q.id, { contactId: q.contactId ?? null, freight: 500 }, q.version);
    // … but cannot raise the custom price
    expect(() => saveQuote(as('u_karan'), { id: q.id, version: fresh(q.id).version, header: {}, lines: [machineLine('TX'), { ...custom, listPrice: 30000 }] })).toThrow(/price list/);
    // price-listed product: client price ignored
    const mine = saveQuote(as('u_karan'), { header: { opportunityId: opp.id }, lines: [{ ...machineLine('TX'), listPrice: 1 }] }).record.id;
    expect(Number((fresh(mine).lines as QuoteLine[])[0].listPrice)).toBe(listPriceFor(productIn('TX').id, todayKey())!.listPrice);
  });

  it('QUO-06 no-approval band, single level, escalation and separation of duties', () => {
    const q0 = create('u_karan', 5);
    expect(submitQuote(as('u_karan'), q0.id, q0.version, '').status).toBe('approved');

    const q = create('u_karan', 7);
    expect(() => submitQuote(as('u_karan'), q.id, q.version, '   ')).toThrow(/reason/);
    const r = submitQuote(as('u_karan'), q.id, q.version, 'Competitor offer');
    const a = getDb().approvals.find((x) => x.id === r.approvalId)!;
    expect(a.levels).toHaveLength(1);
    // Service Head (holds approve.l1 for service) must not decide a sales discount
    ['u_manoj', 'u_sanjay', 'u_karan', 'u_priya', 'u_imran'].forEach((u) => expect(canDecideQuote(as(u), a)).toBe(false));
    expect(() => decideQuoteApproval(as('u_manoj'), a.id, 'approved', 'ok', a.version)).toThrow();
    expect(() => decideQuoteApproval(as('u_karan'), a.id, 'approved', 'ok', a.version)).toThrow();
    expect(pendingQuoteApprovals(as('u_rohan')).find((x) => x.approval.id === a.id)!.canDecide).toBe(true);
    expect(pendingQuoteApprovals(as('u_karan')).find((x) => x.approval.id === a.id)!).toMatchObject({ canDecide: false, ownRequest: true });
    // reject needs a comment, returns to draft with the note
    expect(() => decideQuoteApproval(as('u_rohan'), a.id, 'rejected', ' ', a.version)).toThrow();
    decideQuoteApproval(as('u_rohan'), a.id, 'rejected', 'Too much for this account', a.version);
    expect(fresh(q.id)).toMatchObject({ status: 'draft' });
    expect(String(fresh(q.id).rejectNote)).toMatch(/Too much/);

    // Executive whose manager is a Division Head (Fabric / Ink / Paper): no Sales Manager → Division Head decides
    const [exec, head] = ([['u_pooja', 'u_suresh'], ['u_sneha', 'u_neha'], ['u_deepak', 'u_kavita']] as const).find(([e]) => oppOf(e))!;
    const f = create(exec, 8);
    const rf = submitQuote(as(exec), f.id, f.version, 'Bulk order pricing');
    const af = getDb().approvals.find((x) => x.id === rf.approvalId)!;
    expect(af.levels.map((l) => l.capability)).toEqual(['approve.l2']);
    expect(demoUsers.filter((u) => canDecide(as(u.id), af) && canDecideQuote(as(u.id), af)).map((u) => u.id)).toEqual([head]);
    decideQuoteApproval(as(head), af.id, 'approved', '', af.version);
    expect(fresh(f.id).status).toBe('approved');
  });

  it('QUO-06 three levels walk Sales Manager → Division Head → MD; the same person never decides twice', () => {
    const q = create('u_karan', 20);
    const r = submitQuote(as('u_karan'), q.id, q.version, 'Strategic account');
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const a = getDb().approvals.find((x) => x.id === r.approvalId)!;
      const who = demoUsers.find((u) => canDecideQuote(as(u.id), a) && !seen.has(u.id))!;
      expect(who).toBeTruthy();
      seen.add(who.id);
      expect(fresh(q.id).status).toBe('pending_approval');
      decideQuoteApproval(as(who.id), a.id, 'approved', '', a.version);
    }
    expect([...seen].map((u) => demoUsers.find((x) => x.id === u)!.roleId)).toEqual(['sales_manager', 'division_head', 'management']);
    expect(fresh(q.id).status).toBe('approved');
  });

  it('QUO-06 reminders after 24 h; pull back withdraws', () => {
    const q = create('u_karan', 7);
    const r = submitQuote(as('u_karan'), q.id, q.version, 'Competitor offer');
    const a = getDb().approvals.find((x) => x.id === r.approvalId)!;
    a.requestedAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
    expect(runQuotationSweep()).toBeGreaterThan(0);
    expect(getDb().approvals.find((x) => x.id === a.id)!.remindedAt).toBeTruthy();
    const rohan = demoUsers.find((u) => u.id === 'u_rohan')!;
    expect(getDb().notifications.some((n) => n.userId === rohan.id && n.kind === 'reminder')).toBe(true);
    expect(getDb().notifications.some((n) => n.userId === 'u_manoj' && n.kind === 'reminder' && n.title.includes(String(q.quoteNo)))).toBe(false);
    backToDraft(as('u_karan'), q.id, fresh(q.id).version);
    expect(getDb().approvals.find((x) => x.id === a.id)!.status).toBe('withdrawn');
  });

  it('QUO-10 status walk, guards and terminal states; QUO-11 acceptance; BR-18 only latest', () => {
    const q = create('u_karan', 0);
    const k = as('u_karan');
    expect(() => sendQuote(k, q.id, q.version, { channel: 'email', to: 'a@b.in', message: '' })).toThrow(/approved/);
    submitQuote(k, q.id, q.version, '');
    expect(() => acceptQuote(k, q.id, fresh(q.id).version, { method: 'electronic', acceptedByName: 'X' })).toThrow(/sent/);
    expect(() => sendQuote(k, q.id, fresh(q.id).version, { channel: 'whatsapp', to: '12345', message: '' })).toThrow();
    sendQuote(k, q.id, fresh(q.id).version, { channel: 'whatsapp', to: '9876543210', message: '' });
    expect(fresh(q.id).status).toBe('sent');
    expect(fresh(q.id).sentAt).toBeTruthy();
    transitionRecord(k, 'quotations', q.id, 'negotiation', fresh(q.id).version);
    expect(fresh(q.id).status).toBe('negotiation');
    expect(() => acceptQuote(k, q.id, fresh(q.id).version, { method: 'electronic', acceptedByName: '   ' })).toThrow();
    const po = (o: object) => () => acceptQuote(k, q.id, fresh(q.id).version, { method: 'po', poNo: 'PO-1', poDate: todayKey(), file: { name: 'po.pdf', size: 1000 }, ...o });
    expect(po({ poNo: '  ' })).toThrow();
    expect(po({ poNo: 'x'.repeat(41) })).toThrow();
    expect(po({ poDate: addDays(todayKey(), 1) })).toThrow();
    expect(po({ file: null })).toThrow();
    expect(po({ file: { name: 'po.pdf', size: 999 * 1024 * 1024 } })).toThrow();
    acceptQuote(k, q.id, fresh(q.id).version, { method: 'electronic', acceptedByName: 'Mr Shah' });
    expect(fresh(q.id).status).toBe('accepted');
    expect(getDb().records.opportunities.find((o) => o.id === q.opportunityId)!.stage).toBe('won');
    // terminal
    expect(() => reviseQuote(k, q.id, fresh(q.id).version, 'try again')).toThrow();
    expect(() => rejectQuote(k, q.id, fresh(q.id).version, 'price', '')).toThrow();
    expect(() => transitionRecord(k, 'quotations', q.id, 'negotiation', fresh(q.id).version)).toThrow();
  });

  it('Rejected needs a reason; older version is locked (BR-18)', () => {
    const q = create('u_karan', 0);
    const k = as('u_karan');
    submitQuote(k, q.id, q.version, '');
    sendQuote(k, q.id, fresh(q.id).version, { channel: 'email', to: 'buyer@example.com', message: '' });
    const next = reviseQuote(k, q.id, fresh(q.id).version, 'New configuration');
    expect(() => acceptQuote(k, q.id, fresh(q.id).version, { method: 'electronic', acceptedByName: 'A' })).toThrow(/superseded/);
    expect(() => sendQuote(k, q.id, fresh(q.id).version, { channel: 'email', to: 'buyer@example.com', message: '' })).toThrow();
    expect(getQuote(k, q.id).canEdit).toBe(false);
    submitQuote(k, next, fresh(next).version, '');
    sendQuote(k, next, fresh(next).version, { channel: 'email', to: 'buyer@example.com', message: '' });
    expect(() => rejectQuote(k, next, fresh(next).version, '', '')).toThrow();
    rejectQuote(k, next, fresh(next).version, 'price', 'Too costly');
    expect(fresh(next).status).toBe('rejected');
  });

  it('QUO-10 automatic expiry for every open status, withdrawing pending approvals', () => {
    const k = as('u_karan');
    const d = create('u_karan', 0);
    const p = create('u_karan', 7);
    submitQuote(k, p.id, p.version, 'Competitor offer');
    [d, p].forEach((q) => (fresh(q.id).validUntil = addDays(todayKey(), -1)));
    runQuotationSweep();
    expect(fresh(d.id).status).toBe('expired');
    expect(fresh(p.id).status).toBe('expired');
    expect(getDb().approvals.find((a) => a.recordId === p.id)!.status).toBe('withdrawn');
    // Expired can get a new version (Q-09)
    const r1 = reviseQuote(k, d.id, fresh(d.id).version, 'Re-quote after expiry');
    expect(fresh(r1)).toMatchObject({ status: 'draft', isLatest: true });
    expect(String(fresh(r1).validUntil) >= todayKey()).toBe(true);
  });

  it('scope: Own / Team / Division / All via direct id, and create rights', () => {
    const q = create('u_karan', 0);
    expect(() => getQuote(as('u_sneha'), q.id)).toThrow(/not found/);
    expect(() => getQuote(as('u_priya'), q.id)).toThrow(/not found/);
    expect(getQuote(as('u_rohan'), q.id).canUpdate).toBe(true);
    expect(getQuote(as('u_suresh'), q.id).canUpdate).toBe(true);
    expect(getQuote(as('u_vikram'), q.id).canUpdate).toBe(false);
    expect(getQuote(as('u_swati'), q.id).canUpdate).toBe(false);
    expect(() => getQuote(as('u_ravi'), q.id)).toThrow();
    expect(() => getQuote(as('u_prakash'), q.id)).toThrow();
    expect(() => submitQuote(as('u_vikram'), q.id, q.version, '')).toThrow();
    const opp = oppOf('u_karan');
    expect(() => saveQuote(as('u_vikram'), { header: { opportunityId: opp.id }, lines: [machineLine('TX')] })).toThrow();
    expect(() => saveQuote(as('u_sneha'), { header: { opportunityId: opp.id }, lines: [machineLine('TX')] })).toThrow();
  });

  it('QUO-12 landed cost / margin only for Management, Accounts and System Administrator', () => {
    const q = create('u_karan', 3);
    const visible = (u: string) => getQuote(as(u), q.id).showMargin;
    expect(['u_rahul', 'u_vikram', 'u_swati'].map(visible)).toEqual([true, true, true]);
    expect(['u_karan', 'u_rohan', 'u_suresh', 'u_manoj'].map(visible)).toEqual([false, false, false, false]);
    const v = getQuote(as('u_karan'), q.id);
    expect(v.record.marginPct).toBeNull();
    expect(v.lines.every((l) => l.landedCost === null)).toBe(true);
  });
});
