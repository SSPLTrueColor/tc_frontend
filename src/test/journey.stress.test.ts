/**
 * Service-level STRESS TEST of the full sales journey (BRD §3 / §3.1, Appendix A; REQUIREMENTS BR-01…BR-23):
 * Contact → Lead → Opportunity → stage moves → Quotation (lines, discounts, GST intra/inter, freight) → submit →
 * discount approval chain → send → accept → Sales Order → Opportunity Won.
 *
 * Uses the same service functions the pages call (engine services, and the async `*Api` wrappers for the
 * concurrency block). The store is only read directly to inspect state.
 *
 * Tests that expose real defects are left FAILING on purpose (see the "BUG:" messages).
 */
import '../domain/extensions/index';
import { demoUsers } from '../domain/pack';
import type { RecordData } from '../metadata/types';
import { addDays, nowLocal, todayKey } from '../lib/dates';
import { setClockOffset } from '../lib/clock';
import { gstinCheckDigit } from '../lib/validators';
import { actorFor, type Actor } from '../services/authz';
import { commit, createDb, getDb, getPersistError, __setDb } from '../services/db';
import { createRecord, queryRecords, transitionRecord, updateRecord } from '../services/runtime';
import { logActivity } from '../services/activities';
import { convertContactToLead } from '../services/customers/operations';
import { createLeadWithParty, findDuplicateLeads, qualifyLead, type QualifyInput } from '../services/leads/rules';
import { markLost, pipelineRows } from '../services/opportunities';
import { listPriceFor } from '../services/lookups';
import { acceptQuote, canDecideQuote, decideQuoteApproval, reviseQuote, runQuotationSweep, saveQuote, sendQuote, submitQuote } from '../services/quotations/workflow';
import type { QuoteLine } from '../services/quotations/pricing';
import * as so from '../services/orders/orders';
import { leadsApi } from '../services/api/leads';
import { quotationsApi } from '../services/api/quotations';
import { createOrder as createOrderApi } from '../services/api/orders';
import type { Approval } from '../services/types';

// ---------------------------------------------------------------- helpers

const WS = 'tc';
const A = (id: string) => actorFor(id, WS);
const db = () => getDb();
const R = (res: string): RecordData[] => db().records[res] ?? [];
const byId = (res: string, id: unknown) => R(res).find((r) => r.id === id);
const allActors = () => demoUsers.map((u) => A(u.id));
const COMPANY_STATE = '27';

/** Re-throws service errors with their field errors so a failing step says why. */
const X = <T,>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    const fe = (e as { fieldErrors?: Record<string, string> }).fieldErrors;
    throw new Error(`${(e as Error).message}${fe ? ` ${JSON.stringify(fe)}` : ''}`);
  }
};
/** Expect a service call to be refused; returns the error (code + field errors) for further checks. */
const refused = (fn: () => unknown): { code?: string; message: string; fieldErrors?: Record<string, string> } => {
  try {
    fn();
  } catch (e) {
    return { code: (e as { code?: string }).code, message: (e as Error).message, fieldErrors: (e as { fieldErrors?: Record<string, string> }).fieldErrors };
  }
  throw new Error('expected the service call to be refused, but it succeeded');
};

/** Deterministic RNG so failures reproduce. */
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let seq = 0;
const uniq = () => ++seq;
/** Unique valid Indian mobile (6xxxxxxxxx — not used by the seed). */
const mobileFor = (n: number) => `6${String(100000000 + n).slice(-9)}`;
const panFor = (n: number) => `STR${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + (Math.floor(n / 26) % 26))}${String(1000 + (n % 9000)).padStart(4, '0')}K`;
const gstinFor = (state: string, n: number) => {
  const first14 = `${state}${panFor(n)}1Z`;
  return first14 + gstinCheckDigit(first14);
};

// ---------------------------------------------------------------- independent expected maths (BR-16, COM-11)

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const w2 = (n: number) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
function indianWords(n: number): string {
  const p: string[] = [];
  const crore = Math.floor(n / 1e7);
  if (crore) p.push(`${indianWords(crore)} Crore`);
  n %= 1e7;
  if (Math.floor(n / 1e5)) p.push(`${w2(Math.floor(n / 1e5))} Lakh`);
  n %= 1e5;
  if (Math.floor(n / 1e3)) p.push(`${w2(Math.floor(n / 1e3))} Thousand`);
  n %= 1e3;
  if (Math.floor(n / 100)) p.push(`${ONES[Math.floor(n / 100)]} Hundred`);
  if (n % 100) p.push(w2(n % 100));
  return p.join(' ');
}
const expectedWords = (amount: number) => {
  const paiseTotal = Math.round(amount * 100);
  const r = Math.floor(paiseTotal / 100);
  const ps = paiseTotal % 100;
  return `Rupees ${indianWords(r) || 'Zero'}${ps ? ` and ${w2(ps)} Paise` : ''} Only`;
};

interface Expected {
  subtotal: number;
  discountTotal: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  grandTotal: number;
  maxDiscountPct: number;
}
/** Worked fully in integer paise, independent of src/services/quotations/pricing.ts. */
function expectedTotals(lines: QuoteLine[], pos: string, freight: number, insurance: number): Expected {
  const P = (n: number) => Math.round(n * 100);
  const rows = lines.map((l) => {
    const gross = l.qty * P(l.listPrice);
    const disc = l.discountAmt > 0 ? Math.min(P(l.discountAmt), gross) : Math.round((gross * l.discountPct) / 100);
    return { gross, disc, net: gross - disc, rate: l.gstRate, pct: gross ? (disc / gross) * 100 : 0 };
  });
  let main = 0;
  rows.forEach((r, i) => {
    if (r.net > rows[main].net) main = i;
  });
  const byRate = new Map<number, number>();
  rows.forEach((r) => byRate.set(r.rate, (byRate.get(r.rate) ?? 0) + r.net));
  const extras = P(freight) + P(insurance);
  if (extras) byRate.set(rows[main].rate, (byRate.get(rows[main].rate) ?? 0) + extras);
  let cgst = 0;
  let igst = 0;
  for (const [rate, base] of byRate) {
    if (pos === COMPANY_STATE) cgst += Math.round((base * rate) / 200);
    else igst += Math.round((base * rate) / 100);
  }
  const net = rows.reduce((s, r) => s + r.net, 0);
  const taxable = net + extras;
  return {
    subtotal: rows.reduce((s, r) => s + r.gross, 0) / 100,
    discountTotal: rows.reduce((s, r) => s + r.disc, 0) / 100,
    taxable: taxable / 100,
    cgst: cgst / 100,
    sgst: cgst / 100,
    igst: igst / 100,
    grandTotal: (taxable + 2 * cgst + igst) / 100,
    maxDiscountPct: Math.max(...rows.map((r) => r.pct)),
  };
}

// ---------------------------------------------------------------- journey building blocks

interface Owner {
  user: string;
  div: string;
}
const OWNERS: Owner[] = [
  { user: 'u_karan', div: 'TX' }, // Sales Exec → Sales Manager Rohan
  { user: 'u_sneha', div: 'INK' }, // Sales Exec → Division Head (no Sales Manager)
  { user: 'u_rohan', div: 'TX' }, // Sales Manager as owner
  { user: 'u_deepak', div: 'PPR' },
  { user: 'u_pooja', div: 'FAB' },
  { user: 'u_priya', div: 'POD' },
  { user: 'u_imran', div: 'LBL' },
  { user: 'u_suresh', div: 'TX' }, // Division Head as owner
];
const TERRITORIES: { key: string; label: string; state: string }[] = [
  { key: 'mumbai', label: 'Mumbai', state: '27' },
  { key: 'surat', label: 'Surat', state: '24' },
  { key: 'pune', label: 'Pune', state: '27' },
  { key: 'delhi_ncr', label: 'Delhi NCR', state: '07' },
  { key: 'bengaluru', label: 'Bengaluru', state: '29' },
  { key: 'chennai', label: 'Chennai', state: '33' },
  { key: 'kolkata', label: 'Kolkata', state: '19' },
];
const DISCOUNTS = [0, 3, 5, 5.01, 8, 10, 10.5, 12, 15, 15.5, 18, 25, 40, 7, 0];

const pricedProducts = (div: string) => R('products').filter((p) => p.divisionId === div && p.status !== 'inactive' && listPriceFor(p.id, todayKey()));

function productLine(p: RecordData, qty: number, discountPct = 0, discountAmt = 0): QuoteLine {
  return { productId: p.id, description: String(p.name), lineType: String(p.productType), qty, listPrice: 1, discountPct, discountAmt, hsnSac: String(p.hsnSac), gstRate: Number(p.gstRate) };
}

const bant = (value: number, name: string): QualifyInput => ({ requirement: `Needs ${name}`, budget: value, decisionMaker: 'Mr. Shah (MD)', timeline: '1_3m', opportunityName: name, value, expectedCloseDate: addDays(todayKey(), 45) });

/** Contact → Lead by either Convert to Lead (pool) or inline company + contact (LEAD-01). Returns ids. */
function makeLead(owner: Actor, div: string, productType: string, terr: (typeof TERRITORIES)[number], n: number, path: 'pool' | 'inline') {
  const name = `Stress Buyer ${n}`;
  const company = `Shree Stress Textiles ${n} Pvt Ltd`;
  const email = `buyer${n}@stress${n}.example`;
  if (path === 'pool') {
    const ct = X(() => createRecord(owner, 'contacts', { name, mobile: mobileFor(n), email, city: terr.label, source: 'website', consentEmail: true, consentWhatsapp: true })).record;
    const out = X(() => convertContactToLead(owner, { contactId: ct.id, companyName: company, territoryId: terr.key, billingState: terr.state, divisionId: div, productType, ownerId: owner.staffId, nextFollowUpAt: addDays(todayKey(), 1), requirement: 'Stress requirement' }));
    return { contactId: ct.id, leadId: out.leadId, customerId: out.customerId, email };
  }
  const lead = X(() =>
    createLeadWithParty(
      owner,
      { divisionId: div, sourceId: 'website', productType, ownerId: owner.staffId, nextFollowUpAt: addDays(todayKey(), 1) },
      { name: company, city: terr.label, state: terr.state, territoryId: terr.key, gstin: gstinFor(terr.state, n) },
      { name, mobile: mobileFor(n), email },
    ),
  ).record;
  // CUS-03 / DPDP: the salesperson records the contact's consent on the contact form before sending anything.
  const ct = byId('contacts', lead.contactId)!;
  X(() => updateRecord(owner, 'contacts', ct.id, { consentEmail: true, consentWhatsapp: true }, ct.version));
  return { contactId: String(lead.contactId), leadId: lead.id, customerId: String(lead.customerId), email };
}

function approveAll(quoteId: string, requester: Actor): { caps: string[]; deciders: string[] } {
  const caps: string[] = [];
  const deciders: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = db().approvals.find((x) => x.recordId === quoteId && x.status === 'pending');
    if (!a) break;
    const lvl = a.levels[a.currentLevel];
    const who = allActors().find((x) => x.user.id !== requester.user.id && canDecideQuote(x, a));
    if (!who) throw new Error(`nobody can decide level ${lvl.capability} (${lvl.label}) of ${quoteId}`);
    expect(canDecideQuote(requester, a), 'requester can never decide own request').toBe(false);
    X(() => decideQuoteApproval(who, a.id, 'approved', 'Approved in stress run', a.version));
    caps.push(lvl.capability);
    deciders.push(`${who.user.id}:${who.role.id}`);
  }
  return { caps, deciders };
}

const requiredLevel = (pct: number) => (pct <= 5 ? 0 : pct <= 10 ? 1 : pct <= 15 ? 2 : 3);
const levelNo = (cap: string) => Number(/approve\.l(\d)/.exec(cap)?.[1] ?? 0);

function idIntegrity(resources: string[]) {
  for (const res of resources) {
    const ids = R(res).map((r) => r.id);
    expect(new Set(ids).size, `duplicate ids in ${res}`).toBe(ids.length);
  }
  const qn = R('quotations').map((q) => String(q.quoteNo));
  expect(new Set(qn).size, `duplicate quotation numbers: ${qn.filter((x, i) => qn.indexOf(x) !== i).join(', ')}`).toBe(qn.length);
  const on = R('salesOrders').map((o) => String(o.orderNo));
  expect(new Set(on).size, `duplicate order numbers: ${on.filter((x, i) => on.indexOf(x) !== i).join(', ')}`).toBe(on.length);
}

// =====================================================================================================================
// 1. HAPPY PATH × 25
// =====================================================================================================================

const N_ITER = 25;
const timings: Record<string, number[]> = {};
const time = <T,>(k: string, fn: () => T): T => {
  const t0 = performance.now();
  const r = fn();
  (timings[k] ??= []).push(performance.now() - t0);
  return r;
};
const summary: string[] = [];

describe('1. Happy path journey × 25 (Contact → Lead → Opportunity → Quotation → approvals → accept → SO → Won)', () => {
  beforeAll(() => {
    setClockOffset(0);
    __setDb(createDb(new Date()));
  });
  afterAll(() => {
    const t = Object.entries(timings).map(([k, v]) => `${k}: n=${v.length} avg=${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)}ms max=${Math.max(...v).toFixed(1)}ms`);
    console.info(`JOURNEY_TIMINGS\n${t.join('\n')}`);
    console.info(`JOURNEY_SUMMARY\n${summary.join('\n')}`);
  });

  const rng = mulberry32(2627);
  for (let i = 0; i < N_ITER; i++) {
    it(`iteration ${i + 1}`, () => {
      const o = OWNERS[i % OWNERS.length];
      const owner = A(o.user);
      const terr = TERRITORIES[i % TERRITORIES.length];
      const disc = DISCOUNTS[i % DISCOUNTS.length];
      const useAmt = i % 4 === 3 && disc > 0;
      const products = pricedProducts(o.div);
      expect(products.length, `priced products in ${o.div}`).toBeGreaterThan(0);
      const main = products.find((p) => p.productType === 'machine') ?? products[0];
      const extra = products.find((p) => p.id !== main.id && Number(p.gstRate) !== Number(main.gstRate)) ?? products.find((p) => p.id !== main.id);
      const qty = i % 7 === 0 ? 40 + Math.floor(rng() * 60) : 1 + Math.floor(rng() * 4); // up to ₹ tens of crores
      const n = 1000 + i;
      const path = i % 2 === 0 ? 'inline' : 'pool';

      // ---- Contact → Lead
      const L1 = time('lead', () => makeLead(owner, o.div, String(main.productType), terr, n, path));
      let lead = byId('leads', L1.leadId)!;
      expect(lead).toMatchObject({ status: 'new', customerId: L1.customerId, contactId: L1.contactId, divisionId: o.div, ownerId: owner.staffId });
      expect(lead.id).toMatch(/^LD-\d{4}-\d{5}$/);
      expect(byId('contacts', L1.contactId)!.customerId).toBe(L1.customerId);
      expect(byId('customers', L1.customerId)!.billingState).toBe(terr.state);

      // ---- Follow-up → Contacted (LEAD-09)
      X(() => logActivity(owner, { parentResource: 'leads', parentId: lead.id, parentLabel: lead.id, customerId: L1.customerId, activityType: 'call', subject: 'Discovery call', at: nowLocal(), nextFollowUpAt: addDays(todayKey(), 2) }));
      lead = byId('leads', L1.leadId)!;
      expect(lead.status).toBe('contacted');

      // ---- Qualify → Opportunity (LEAD-10, §3.1 r2)
      const listMain = listPriceFor(main.id, todayKey())!.listPrice;
      const value = listMain * qty;
      const { opportunityId } = time('qualify', () => X(() => qualifyLead(owner, lead.id, lead.version, bant(value, `Stress deal ${n}`))));
      let opp = byId('opportunities', opportunityId)!;
      expect(byId('leads', lead.id)).toMatchObject({ status: 'qualified', opportunityId });
      expect(opp).toMatchObject({ leadId: lead.id, customerId: L1.customerId, contactId: L1.contactId, divisionId: o.div, ownerId: owner.staffId, stage: 'needs_assessment', probability: 10 });
      expect(opp.id).toMatch(/^OP-\d{4}-\d{5}$|^[A-Z]+-\d{4}-\d{5}$/);

      // ---- Stage moves (OPP-02, BR-11)
      if (i % 3 === 0) {
        opp = X(() => transitionRecord(owner, 'opportunities', opp.id, 'demo', opp.version)).record;
        expect(byId('opportunities', opp.id)!.probability).toBe(25);
      }
      X(() => transitionRecord(owner, 'opportunities', opp.id, 'proposal', byId('opportunities', opp.id)!.version));
      expect(byId('opportunities', opp.id)).toMatchObject({ stage: 'proposal', probability: 50 });

      // ---- Quotation (QUO-01…04, BR-13…16)
      const mainGross = listMain * qty;
      const lines: QuoteLine[] = [useAmt ? productLine(main, qty, 0, Math.round((mainGross * disc) / 100)) : productLine(main, qty, disc)];
      if (extra && i % 2 === 1) lines.push(productLine(extra, 1 + (i % 3)));
      const freight = i % 3 === 0 ? 0 : 1500 + Math.floor(rng() * 50000) + 0.5;
      const insurance = i % 4 === 0 ? 2500 : 0;
      const saved = time('saveQuote', () => X(() => saveQuote(owner, { header: { opportunityId: opp.id, freight, insurance }, lines })));
      let q = byId('quotations', saved.record.id)!;
      const priced = lines.map((l) => ({ ...l, listPrice: listPriceFor(String(l.productId), todayKey())!.listPrice }));
      const exp = expectedTotals(priced, terr.state, freight, insurance);
      expect(q).toMatchObject({ opportunityId: opp.id, customerId: L1.customerId, contactId: L1.contactId, divisionId: o.div, ownerId: owner.staffId, status: 'draft', revision: 0, isLatest: true, placeOfSupply: terr.state });
      expect(String(q.quoteNo)).toMatch(new RegExp(`^QT/${o.div}/\\d\\d-\\d\\d/\\d{4}$`));
      expect(q.validUntil).toBe(addDays(String(q.quoteDate), 30));
      expect((q.lines as QuoteLine[]).map((l) => l.listPrice)).toEqual(priced.map((l) => l.listPrice));
      for (const k of ['subtotal', 'discountTotal', 'taxable', 'cgst', 'sgst', 'igst', 'grandTotal'] as const) expect(Number(q[k]), `${k} (pos ${terr.state})`).toBeCloseTo(exp[k], 2);
      if (terr.state === COMPANY_STATE) {
        expect(Number(q.igst)).toBe(0);
        expect(Number(q.cgst)).toBe(Number(q.sgst));
        expect(Number(q.cgst)).toBeGreaterThan(0);
      } else {
        expect(Number(q.cgst) + Number(q.sgst)).toBe(0);
        expect(Number(q.igst)).toBeGreaterThan(0);
      }
      expect(q.amountInWords).toBe(expectedWords(Number(q.grandTotal)));
      expect(Number(q.maxDiscountPct)).toBeGreaterThanOrEqual(Math.floor(exp.maxDiscountPct * 100) / 100);

      if (i % 5 === 0) {
        X(() => transitionRecord(owner, 'opportunities', opp.id, 'negotiation', byId('opportunities', opp.id)!.version));
        expect(byId('opportunities', opp.id)!.probability).toBe(75);
      }

      // ---- Submit → approval chain (FR-040, QUO-06, BR-17)
      const pct = Number(q.maxDiscountPct);
      const need = requiredLevel(pct);
      if (need > 0) {
        const e = refused(() => submitQuote(owner, q.id, q.version, ''));
        expect(e.message.toLowerCase()).toMatch(/reason/);
      }
      const sub = time('submit', () => X(() => submitQuote(owner, q.id, byId('quotations', q.id)!.version, 'Competitive offer vs importer quote')));
      expect(sub.status).toBe(need ? 'pending_approval' : 'approved');
      const chain = time('approvals', () => approveAll(q.id, owner));
      if (need) {
        expect(chain.caps.length, `approval levels for ${pct}%`).toBeGreaterThan(0);
        expect(Math.max(...chain.caps.map(levelNo)), `top approval level for ${pct}% discount (BR-17)`).toBeGreaterThanOrEqual(need);
        const levels = chain.caps.map(levelNo);
        expect([...levels].sort(), 'levels ascend').toEqual(levels);
      } else expect(chain.caps).toEqual([]);
      q = byId('quotations', q.id)!;
      expect(q.status).toBe('approved');

      // ---- Send → Accept (FR-042, FR-045) → Opportunity Won
      X(() => sendQuote(owner, q.id, q.version, { channel: 'email', to: L1.email, message: '' }));
      q = byId('quotations', q.id)!;
      expect(q.status).toBe('sent');
      const poNo = `PO/STRESS/${n}`;
      X(() => acceptQuote(owner, q.id, q.version, { method: 'po', poNo, poDate: todayKey(), file: { name: `po-${n}.pdf`, size: 200_000 } }));
      q = byId('quotations', q.id)!;
      opp = byId('opportunities', opp.id)!;
      expect(q.status).toBe('accepted');
      expect(opp).toMatchObject({ stage: 'won', probability: 100 });
      expect(opp.wonAt).toBeTruthy();

      // ---- Generate Sales Order (SO-01/02, BR-20/21)
      const site = X(() => createRecord(owner, 'addresses', { customerId: L1.customerId, label: 'Plant', addressType: 'installation', line1: 'Plot 7, GIDC', city: terr.label, state: terr.state, pincode: '400001', lat: 19.07, lng: 72.87 })).record;
      const draft = X(() => so.draftFromQuotation(owner, q.id));
      expect(draft.blocker).toBeNull();
      expect(draft.po, 'PO captured at acceptance pre-fills the order (§2.2 no re-entry)').toMatchObject({ customerPoNo: poNo, poFileName: `po-${n}.pdf` });
      const order = time('createOrder', () =>
        X(() => so.createOrder(owner, { source: 'quotation', sourceId: q.id, lines: draft.lines, siteAddressId: site.id, customerPoNo: draft.po!.customerPoNo, customerPoDate: draft.po!.customerPoDate, poFileName: draft.po!.poFileName, idempotencyKey: `stress-${n}` })),
      );
      expect(order).toMatchObject({ quotationId: q.id, opportunityId: opp.id, customerId: L1.customerId, divisionId: o.div, ownerId: owner.staffId, status: 'pending_approval', customerPoNo: poNo });
      expect(String(order.orderNo)).toMatch(new RegExp(`^SO/${o.div}/\\d\\d-\\d\\d/\\d{4}$`));
      for (const k of ['subtotal', 'discountTotal', 'taxable', 'cgst', 'sgst', 'igst', 'grandTotal'] as const) expect(Number(order[k]), `order ${k} = quotation ${k}`).toBeCloseTo(Number(q[k]), 2);
      const ms = so.milestonesOf(db(), order.id);
      expect(ms.length).toBeGreaterThan(0);
      expect(ms.reduce((s, m) => s + Number(m.amount), 0)).toBeCloseTo(Number(order.grandTotal), 2);
      // second order from the same accepted quotation is refused
      expect(refused(() => so.createOrder(owner, { source: 'quotation', sourceId: q.id, lines: draft.lines, siteAddressId: site.id, customerPoNo: poNo, customerPoDate: todayKey(), poFileName: 'po.pdf', idempotencyKey: `stress-${n}-again` })).code).toBe('invalid_state');
      expect(R('salesOrders').filter((x) => x.quotationId === q.id).length).toBe(1);
      expect(db().approvals.filter((a) => a.recordId === order.id && a.status === 'pending').length).toBe(1);

      // ---- Integrity of the chain
      expect(R('opportunities').filter((x) => x.leadId === lead.id).length, 'one opportunity per lead').toBe(1);
      expect(R('leads').filter((x) => x.contactId === L1.contactId).length, 'one lead per new contact').toBe(1);
      expect(R('customers').filter((c) => c.name === `Shree Stress Textiles ${n} Pvt Ltd`).length, 'no duplicate company').toBe(1);
      idIntegrity(['contacts', 'customers', 'leads', 'opportunities', 'quotations', 'salesOrders', 'paymentMilestones', 'addresses', 'activities']);
      summary.push(`#${i + 1} ${o.user}/${o.div} ${path} pos=${terr.state} disc=${disc}%${useAmt ? '(amt)' : ''} qty=${qty} lines=${lines.length} grand=₹${q.grandTotal} chain=[${chain.deciders.join(' → ')}] ${q.quoteNo} → ${order.orderNo}`);
    });
  }

  it('global integrity after all iterations: no orphans, counters ahead of every id', () => {
    const run = R('customers').filter((c) => String(c.name).startsWith('Shree Stress Textiles'));
    expect(run.length).toBe(N_ITER);
    for (const c of run) expect(R('leads').some((l) => l.customerId === c.id), `orphan customer ${c.id}`).toBe(true);
    for (const o of R('opportunities').filter((x) => x.leadId)) {
      const l = byId('leads', o.leadId);
      if (!l) continue; // seed may reference purged leads
      if (String(o.name).startsWith('Stress deal')) expect(l.opportunityId).toBe(o.id);
    }
    for (const q of R('quotations')) expect(byId('opportunities', q.opportunityId) || !q.opportunityId, `quotation ${q.id} → missing opportunity`).toBeTruthy();
    for (const s of R('salesOrders').filter((x) => x.quotationId)) expect(byId('quotations', s.quotationId), `order ${s.id} → missing quotation`).toBeTruthy();
    // one latest version per quotation family
    const fam = new Map<string, number>();
    R('quotations').forEach((q) => q.isLatest && fam.set(String(q.rootId || q.id), (fam.get(String(q.rootId || q.id)) ?? 0) + 1));
    expect([...fam.values()].filter((n) => n > 1)).toEqual([]);
    // quotation series: per division consecutive, counter matches the highest number issued
    for (const div of ['TX', 'INK', 'POD', 'LBL', 'PPR', 'FAB']) {
      const nums = R('quotations')
        .filter((q) => q.divisionId === div && !q.revision)
        .map((q) => Number(/\/(\d{4})(-R\d+)?$/.exec(String(q.quoteNo))?.[1] ?? 0));
      if (!nums.length) continue;
      const key = Object.keys(db().counters).find((k) => k.startsWith(`quoteNo:${div}:`))!;
      expect(db().counters[key], `quote counter for ${div}`).toBeGreaterThanOrEqual(Math.max(...nums));
    }
  });
});

// =====================================================================================================================
// 2. NEGATIVE / EDGE CASES
// =====================================================================================================================

/** A contacted lead + opportunity at Proposal owned by Karan (TX, Surat → inter-state). */
function setupOpp(path: 'pool' | 'inline' = 'inline', ownerId = 'u_karan', div = 'TX') {
  const owner = A(ownerId);
  const n = 5000 + uniq();
  const main = pricedProducts(div).find((p) => p.productType === 'machine') ?? pricedProducts(div)[0];
  const L1 = makeLead(owner, div, String(main.productType), TERRITORIES[1], n, path);
  const l = byId('leads', L1.leadId)!;
  logActivity(owner, { parentResource: 'leads', parentId: l.id, parentLabel: l.id, activityType: 'call', subject: 'Call', at: nowLocal(), nextFollowUpAt: addDays(todayKey(), 1) });
  const { opportunityId } = X(() => qualifyLead(owner, l.id, byId('leads', l.id)!.version, bant(5_000_000, `Edge deal ${n}`)));
  X(() => transitionRecord(owner, 'opportunities', opportunityId, 'proposal', byId('opportunities', opportunityId)!.version));
  return { owner, n, main, ...L1, opportunityId };
}
function toAccepted(s: ReturnType<typeof setupOpp>, lines?: QuoteLine[], actor = s.owner) {
  const q0 = X(() => saveQuote(actor, { header: { opportunityId: s.opportunityId }, lines: lines ?? [productLine(s.main, 1, 0)] })).record;
  X(() => submitQuote(actor, q0.id, byId('quotations', q0.id)!.version, 'Reason for discount'));
  approveAll(q0.id, actor);
  X(() => sendQuote(actor, q0.id, byId('quotations', q0.id)!.version, { channel: 'email', to: s.email, message: '' }));
  X(() => acceptQuote(actor, q0.id, byId('quotations', q0.id)!.version, { method: 'po', poNo: `PO-${s.n}`, poDate: todayKey(), file: { name: 'po.pdf', size: 1000 } }));
  return byId('quotations', q0.id)!;
}
const site = (owner: Actor, customerId: string) => X(() => createRecord(owner, 'addresses', { customerId, label: 'Plant', addressType: 'installation', line1: 'Plot 1', city: 'Surat', state: '24', pincode: '394230', lat: 21.1, lng: 72.8 })).record;

describe('2. Negative / edge cases (BRD rules)', () => {
  beforeEach(() => {
    setClockOffset(0);
    __setDb(createDb(new Date()));
  });
  afterEach(() => setClockOffset(0));

  // ---------------- Contact / Lead
  it('BR-05 / LEAD-01: inline company + contact required fields are enforced and nothing is left behind', () => {
    const k = A('u_karan');
    const before = { c: R('customers').length, ct: R('contacts').length, l: R('leads').length };
    const lead = { divisionId: 'TX', sourceId: 'website', productType: 'machine', ownerId: k.staffId, nextFollowUpAt: addDays(todayKey(), 1) };
    const e = refused(() => createLeadWithParty(k, lead, { name: ' ', city: '', state: '', territoryId: '' }, { name: '', mobile: '', email: '' }));
    expect(Object.keys(e.fieldErrors ?? {}).sort()).toEqual(['company.city', 'company.name', 'company.state', 'company.territoryId', 'contact.mobile', 'contact.name']);
    refused(() => createLeadWithParty(k, { ...lead, productType: undefined }, { name: 'Valid Co', city: 'Surat', state: '24', territoryId: 'surat' }, { name: 'X', mobile: '9876500011' }));
    refused(() => createLeadWithParty(k, { ...lead, nextFollowUpAt: addDays(todayKey(), -1) }, { name: 'Valid Co', city: 'Surat', state: '24', territoryId: 'surat' }, { name: 'X', mobile: '9876500011' }));
    expect({ c: R('customers').length, ct: R('contacts').length, l: R('leads').length }).toEqual(before);
  });

  it('BR-03 / CUS-01: invalid mobile, email and GSTIN formats are rejected (inline and contact create)', () => {
    const k = A('u_karan');
    const lead = { divisionId: 'TX', sourceId: 'website', productType: 'machine', ownerId: k.staffId, nextFollowUpAt: addDays(todayKey(), 1) };
    const co = { name: 'Format Test Prints', city: 'Surat', state: '24', territoryId: 'surat' };
    expect(refused(() => createLeadWithParty(k, lead, co, { name: 'A', mobile: '12345' })).fieldErrors).toHaveProperty(['contact.mobile']);
    expect(refused(() => createLeadWithParty(k, lead, co, { name: 'A', mobile: '5123456789' })).fieldErrors).toHaveProperty(['contact.mobile']);
    expect(refused(() => createLeadWithParty(k, lead, co, { name: 'A', email: 'a@b' })).fieldErrors).toHaveProperty(['contact.email']);
    const badCheck = gstinFor('24', 77).slice(0, 14) + (gstinFor('24', 77)[14] === 'A' ? 'B' : 'A');
    refused(() => createLeadWithParty(k, lead, { ...co, gstin: badCheck }, { name: 'A', mobile: '9876512345' }));
    refused(() => createLeadWithParty(k, lead, { ...co, gstin: gstinFor('27', 78) }, { name: 'A', mobile: '9876512346' })); // state 27 vs billing 24
    refused(() => createLeadWithParty(k, lead, { ...co, gstin: 'NOTAGSTIN' }, { name: 'A', mobile: '9876512347' }));
    refused(() => createRecord(k, 'contacts', { name: 'Bad Mobile', mobile: '12345' }));
    refused(() => createRecord(k, 'contacts', { name: 'Bad Email', email: 'nobody@' }));
    refused(() => createRecord(k, 'contacts', { name: 'No reach' }));
    expect(R('customers').some((c) => c.name === 'Format Test Prints'), 'no orphan company after failed inline create').toBe(false);
  });

  it('BR-01 / CUS-06: duplicate contact (mobile / email) and duplicate company GSTIN are blocked', () => {
    const k = A('u_karan');
    const s = setupOpp('inline');
    const ct = byId('contacts', s.contactId)!;
    refused(() => createRecord(k, 'contacts', { name: 'Dup by mobile', mobile: `+91 ${ct.mobile}` }));
    refused(() => createRecord(k, 'contacts', { name: 'Dup by email', email: String(ct.email).toUpperCase() }));
    const gst = String(byId('customers', s.customerId)!.gstin);
    const lead = { divisionId: 'TX', sourceId: 'website', productType: 'machine', ownerId: k.staffId, nextFollowUpAt: addDays(todayKey(), 1) };
    refused(() => createLeadWithParty(k, lead, { name: 'Another Name Ltd', city: 'Surat', state: '24', territoryId: 'surat', gstin: gst }, { name: 'New P', mobile: '9876599999' }));
  });

  it('BR-10 / LEAD-03: duplicate open lead for the same company / contact is detected (warning)', () => {
    const k = A('u_karan');
    const s = setupOpp('pool');
    // open a second lead for the same company + contact
    const second = X(() => createRecord(k, 'leads', { customerId: s.customerId, contactId: s.contactId, divisionId: 'TX', sourceId: 'website', productType: 'ink', nextFollowUpAt: addDays(todayKey(), 1) })).record;
    const dups = findDuplicateLeads(k, { customerId: s.customerId, divisionId: 'TX' });
    expect(dups.visible.map((l) => l.id)).toContain(second.id);
    const byMobile = findDuplicateLeads(k, { mobile: String(byId('contacts', s.contactId)!.mobile), divisionId: 'TX' });
    expect(byMobile.visible.length + byMobile.hidden).toBeGreaterThan(0);
  });

  it('BR-04: a contact can be converted to a lead only once', () => {
    const k = A('u_karan');
    const ct = X(() => createRecord(k, 'contacts', { name: 'Once Only', mobile: '6222200001', city: 'Surat', source: 'website' })).record;
    const input = { contactId: ct.id, companyName: 'Once Only Prints', territoryId: 'surat', billingState: '24', divisionId: 'TX', productType: 'machine', ownerId: k.staffId, nextFollowUpAt: addDays(todayKey(), 1) };
    X(() => convertContactToLead(k, input));
    expect(refused(() => convertContactToLead(k, input)).code).toBe('invalid_state');
    expect(R('leads').filter((l) => l.contactId === ct.id).length).toBe(1);
    expect(R('customers').filter((c) => c.name === 'Once Only Prints').length).toBe(1);
  });

  it('BR-02: a company created by Convert to Lead has at least one address (like the inline path does)', () => {
    const k = A('u_karan');
    const ct = X(() => createRecord(k, 'contacts', { name: 'Addr Check', mobile: '6222200002', city: 'Surat', source: 'website' })).record;
    const out = X(() => convertContactToLead(k, { contactId: ct.id, companyName: 'Addr Check Prints', territoryId: 'surat', billingState: '24', divisionId: 'TX', productType: 'machine', ownerId: k.staffId, nextFollowUpAt: addDays(todayKey(), 1) }));
    const inline = setupOpp('inline');
    expect(R('addresses').filter((a) => a.customerId === inline.customerId).length, 'inline path creates a billing address').toBeGreaterThan(0);
    expect(R('addresses').filter((a) => a.customerId === out.customerId).length, 'BUG: Convert to Lead creates a company with NO address (BR-02 "Company: at least one address")').toBeGreaterThan(0);
  });

  it('LEAD-10: BANT required; converting an already-converted lead is refused (no second opportunity)', () => {
    const s = setupOpp('inline');
    const l = byId('leads', R('opportunities').find((o) => o.id === s.opportunityId)!.leadId)!;
    expect(refused(() => qualifyLead(s.owner, l.id, l.version, bant(1, 'Again'))).code).toBe('invalid_state');
    const fresh = makeLead(s.owner, 'TX', 'machine', TERRITORIES[0], 9100 + uniq(), 'inline');
    const lf = byId('leads', fresh.leadId)!;
    const e = refused(() => qualifyLead(s.owner, lf.id, lf.version, { requirement: '', budget: 0, decisionMaker: '', timeline: '', opportunityName: '', value: 0, expectedCloseDate: '' }));
    expect(Object.keys(e.fieldErrors ?? {}).length).toBeGreaterThanOrEqual(6);
    expect(R('opportunities').filter((o) => o.leadId === l.id).length).toBe(1);
  });

  // ---------------- Opportunity stages
  it('OPP-02: illegal stage moves are refused (Needs Assessment → Won; → Negotiation without a quotation; Won without accepted quote)', () => {
    const k = A('u_karan');
    const fresh = makeLead(k, 'TX', 'machine', TERRITORIES[1], 9200 + uniq(), 'inline');
    const l = byId('leads', fresh.leadId)!;
    const { opportunityId } = X(() => qualifyLead(k, l.id, l.version, bant(1_000_000, 'Stage test')));
    const v = () => byId('opportunities', opportunityId)!.version;
    expect(refused(() => transitionRecord(k, 'opportunities', opportunityId, 'won', v())).code).toBe('invalid_state');
    expect(refused(() => transitionRecord(k, 'opportunities', opportunityId, 'lost', v())).code).toBe('invalid_state'); // lost only via Mark Lost
    refused(() => transitionRecord(k, 'opportunities', opportunityId, 'negotiation', v()));
    X(() => transitionRecord(k, 'opportunities', opportunityId, 'proposal', v()));
    refused(() => transitionRecord(k, 'opportunities', opportunityId, 'won', v()));
    expect(byId('opportunities', opportunityId)).toMatchObject({ stage: 'proposal', probability: 50 });
    // a sales executive cannot reopen a won/lost deal (capability opportunity.reopen)
    X(() => markLost(k, opportunityId, { lostReason: 'price', lostToCompetitor: 'Importer X' }, v()));
    expect(refused(() => transitionRecord(k, 'opportunities', opportunityId, 'needs_assessment', v())).code).toBe('forbidden');
  });

  it('OPP-05 / FR-031: Mark Lost needs a reason and a competitor; probability → 0; no quotation on a lost deal', () => {
    const s = setupOpp();
    const v = () => byId('opportunities', s.opportunityId)!.version;
    expect(Object.keys(refused(() => markLost(s.owner, s.opportunityId, { lostReason: '', lostToCompetitor: ' ' }, v())).fieldErrors ?? {}).sort()).toEqual(['lostReason', 'lostToCompetitor']);
    refused(() => markLost(s.owner, s.opportunityId, { lostReason: 'price', lostToCompetitor: 'Y', lostToPrice: -5 }, v()));
    X(() => markLost(s.owner, s.opportunityId, { lostReason: 'price', lostToCompetitor: 'Importer Y', lostToPrice: 4_200_000 }, v()));
    expect(byId('opportunities', s.opportunityId)).toMatchObject({ stage: 'lost', probability: 0, lostToCompetitor: 'Importer Y' });
    expect(refused(() => markLost(s.owner, s.opportunityId, { lostReason: 'price', lostToCompetitor: 'Z' }, v())).code).toBe('invalid_state');
    expect(refused(() => saveQuote(s.owner, { header: { opportunityId: s.opportunityId }, lines: [productLine(s.main, 1)] })).code).toBe('invalid_state');
  });

  // ---------------- Quotation lines / pricing
  it('QUO-04 / BR-15: zero lines, zero / fractional qty, negative price, discount > 100 %, discount > gross, bad GST / HSN are refused', () => {
    const s = setupOpp();
    const admin = A('u_rahul'); // may price custom lines (maintains price lists)
    const base = productLine(s.main, 1);
    const save = (lines: QuoteLine[], who = s.owner) => () => saveQuote(who, { header: { opportunityId: s.opportunityId }, lines });
    refused(save([]));
    refused(save([{ ...base, qty: 0 }]));
    refused(save([{ ...base, qty: -2 }]));
    refused(save([{ ...base, qty: 1.5 }]));
    refused(save([{ ...base, discountPct: 101 }]));
    refused(save([{ ...base, discountPct: -1 }]));
    refused(save([{ ...base, discountAmt: 999_999_999 }]));
    refused(save([{ ...base, discountAmt: -10 }]));
    refused(save([{ ...base, gstRate: 7 }]));
    refused(save([{ ...base, hsnSac: '12' }]));
    const custom: QuoteLine = { productId: null, description: 'Installation & training', lineType: 'service', qty: 1, listPrice: -5000, discountPct: 0, discountAmt: 0, hsnSac: '998713', gstRate: 18 };
    refused(save([custom], admin));
    // QUO-05: a sales user cannot type a list price on an unlisted line
    refused(save([{ ...custom, listPrice: 25000 }]));
    // BR-15: client-sent price on a price-listed product is ignored
    const q = X(save([{ ...base, listPrice: 1 }])).record;
    expect((byId('quotations', q.id)!.lines as QuoteLine[])[0].listPrice).toBe(listPriceFor(s.main.id, todayKey())!.listPrice);
    expect(R('quotations').filter((x) => x.opportunityId === s.opportunityId).length).toBe(1);
  });

  it('QUO-04: a line in "amount" discount mode ignores a stale % value', () => {
    const s = setupOpp();
    const q = X(() => saveQuote(s.owner, { header: { opportunityId: s.opportunityId }, lines: [{ ...productLine(s.main, 1, 20, 0), discountType: 'amt' }] })).record;
    expect(Number(byId('quotations', q.id)!.discountTotal), 'BUG?: discountType "amt" with amount 0 still applies the hidden 20 % (pricing.ts lineAmounts ignores discountType)').toBe(0);
  });

  it('BR-14: validity cannot end before the quotation date', () => {
    const s = setupOpp();
    const r = (() => {
      try {
        return saveQuote(s.owner, { header: { opportunityId: s.opportunityId, quoteDate: addDays(todayKey(), 10), validUntil: addDays(todayKey(), 5) }, lines: [productLine(s.main, 1)] }).record;
      } catch {
        return null;
      }
    })();
    expect(r, 'BUG: quotation saved with Valid Until before the Quotation Date').toBeNull();
  });

  it('BR-17: discount above 5 % needs a reason ≥ 5 chars; 18 % runs Sales Manager → Division Head → MD; requester and wrong roles cannot decide', () => {
    const s = setupOpp();
    const q = X(() => saveQuote(s.owner, { header: { opportunityId: s.opportunityId }, lines: [productLine(s.main, 1, 18)] })).record;
    refused(() => submitQuote(s.owner, q.id, q.version, ''));
    refused(() => submitQuote(s.owner, q.id, q.version, 'ok'));
    X(() => submitQuote(s.owner, q.id, q.version, 'Matching importer offer'));
    const a = () => db().approvals.find((x) => x.recordId === q.id && x.status === 'pending') as Approval;
    expect(a().levels.map((l) => l.capability)).toEqual(['approve.l1', 'approve.l2', 'approve.l3']);
    expect(refused(() => decideQuoteApproval(s.owner, a().id, 'approved', 'self', a().version)).code).toBeTruthy();
    expect(refused(() => decideQuoteApproval(A('u_suresh'), a().id, 'approved', 'skip level', a().version)).code).toBeTruthy(); // DH at the SM level
    expect(refused(() => decideQuoteApproval(A('u_priya'), a().id, 'approved', 'other team SM', a().version)).code).toBeTruthy();
    // a rejection needs a comment and returns the quotation to draft
    refused(() => decideQuoteApproval(A('u_rohan'), a().id, 'rejected', '', a().version));
    X(() => decideQuoteApproval(A('u_rohan'), a().id, 'approved', 'ok', a().version));
    expect(refused(() => decideQuoteApproval(A('u_rohan'), a().id, 'approved', 'twice', a().version)).code).toBeTruthy(); // L2 now
    X(() => decideQuoteApproval(A('u_suresh'), a().id, 'rejected', 'Too deep', a().version));
    expect(byId('quotations', q.id)!.status).toBe('draft');
  });

  it('BR-18 / QUO-10: quotation locked after submit and after accept; revise → R1/R2 with one latest; old versions cannot be sent/accepted', () => {
    const s = setupOpp();
    const q = X(() => saveQuote(s.owner, { header: { opportunityId: s.opportunityId }, lines: [productLine(s.main, 1, 8)] })).record;
    X(() => submitQuote(s.owner, q.id, q.version, 'Needs 8 percent'));
    const pend = byId('quotations', q.id)!;
    expect(refused(() => saveQuote(s.owner, { id: q.id, version: pend.version, header: { freight: 999 }, lines: [productLine(s.main, 1, 8)] })).code).toBe('invalid_state');
    expect(refused(() => updateRecord(s.owner, 'quotations', q.id, { freight: 100 }, pend.version)).code).toBe('invalid_state');
    // revise while pending → pending approval withdrawn
    const r1 = X(() => reviseQuote(s.owner, q.id, pend.version, 'Customer asked for a new price'));
    expect(db().approvals.filter((a) => a.recordId === q.id && a.status === 'pending').length).toBe(0);
    expect(byId('quotations', q.id)).toMatchObject({ status: 'superseded', isLatest: false });
    expect(byId('quotations', r1)).toMatchObject({ status: 'draft', isLatest: true, revision: 1, rootId: q.id, quoteNo: `${q.quoteNo}-R1` });
    expect(refused(() => submitQuote(s.owner, q.id, byId('quotations', q.id)!.version, 'old version')).code).toBe('invalid_state');
    expect(refused(() => reviseQuote(s.owner, r1, byId('quotations', r1)!.version, 'draft revise')).code).toBe('invalid_state'); // draft: edit instead
    X(() => submitQuote(s.owner, r1, byId('quotations', r1)!.version, 'Needs 8 percent'));
    approveAll(r1, s.owner);
    const r2 = X(() => reviseQuote(s.owner, r1, byId('quotations', r1)!.version, 'Second revision'));
    expect(byId('quotations', r2)!.quoteNo).toBe(`${q.quoteNo}-R2`);
    expect(refused(() => sendQuote(s.owner, r1, byId('quotations', r1)!.version, { channel: 'email', to: s.email, message: '' })).code).toBe('invalid_state');
    const fam = R('quotations').filter((x) => (x.rootId || x.id) === q.id);
    expect(fam.filter((x) => x.isLatest).map((x) => x.id)).toEqual([r2]);
    // accept the latest and check it is frozen
    X(() => submitQuote(s.owner, r2, byId('quotations', r2)!.version, 'Needs 8 percent'));
    approveAll(r2, s.owner);
    X(() => sendQuote(s.owner, r2, byId('quotations', r2)!.version, { channel: 'email', to: s.email, message: '' }));
    X(() => acceptQuote(s.owner, r2, byId('quotations', r2)!.version, { method: 'electronic', acceptedByName: 'Mr Shah' }));
    expect(refused(() => reviseQuote(s.owner, r2, byId('quotations', r2)!.version, 'after accept')).code).toBe('invalid_state');
    expect(refused(() => updateRecord(s.owner, 'quotations', r2, { freight: 5 }, byId('quotations', r2)!.version)).code).toBe('invalid_state');
    expect(refused(() => acceptQuote(s.owner, r2, byId('quotations', r2)!.version, { method: 'electronic', acceptedByName: 'again' })).code).toBe('invalid_state');
  });

  it('QUO-11: accept needs Sent; PO number, date ≤ today and a PDF/JPG/PNG copy', () => {
    const s = setupOpp();
    const q = X(() => saveQuote(s.owner, { header: { opportunityId: s.opportunityId }, lines: [productLine(s.main, 1)] })).record;
    X(() => submitQuote(s.owner, q.id, q.version, ''));
    const v = () => byId('quotations', q.id)!.version;
    expect(refused(() => acceptQuote(s.owner, q.id, v(), { method: 'electronic', acceptedByName: 'X' })).code).toBe('invalid_state'); // approved, not sent
    X(() => sendQuote(s.owner, q.id, v(), { channel: 'email', to: s.email, message: '' }));
    refused(() => acceptQuote(s.owner, q.id, v(), { method: 'po', poNo: '', poDate: todayKey(), file: { name: 'po.pdf', size: 1 } }));
    refused(() => acceptQuote(s.owner, q.id, v(), { method: 'po', poNo: 'P1', poDate: addDays(todayKey(), 1), file: { name: 'po.pdf', size: 1 } }));
    refused(() => acceptQuote(s.owner, q.id, v(), { method: 'po', poNo: 'P1', poDate: todayKey(), file: { name: 'po.exe', size: 1 } }));
    refused(() => acceptQuote(s.owner, q.id, v(), { method: 'po', poNo: 'P1', poDate: todayKey(), file: null }));
    refused(() => acceptQuote(s.owner, q.id, v(), { method: 'po', poNo: 'P1', poDate: todayKey(), file: { name: 'po.pdf', size: 50 * 1024 * 1024 } }));
    refused(() => sendQuote(s.owner, q.id, v(), { channel: 'whatsapp', to: '12345', message: '' }));
    expect(byId('quotations', q.id)!.status).toBe('sent');
  });

  it('FR-044: expired validity — sweep expires, send/accept blocked, a new version is allowed', () => {
    const s = setupOpp();
    const q = X(() => saveQuote(s.owner, { header: { opportunityId: s.opportunityId }, lines: [productLine(s.main, 1)] })).record;
    X(() => submitQuote(s.owner, q.id, q.version, ''));
    setClockOffset(31 * 86_400_000);
    refused(() => sendQuote(s.owner, q.id, byId('quotations', q.id)!.version, { channel: 'email', to: s.email, message: '' }));
    expect(runQuotationSweep()).toBeGreaterThan(0);
    expect(byId('quotations', q.id)!.status).toBe('expired');
    refused(() => acceptQuote(s.owner, q.id, byId('quotations', q.id)!.version, { method: 'electronic', acceptedByName: 'X' }));
    const r1 = X(() => reviseQuote(s.owner, q.id, byId('quotations', q.id)!.version, 'Refresh validity'));
    expect(byId('quotations', r1)!.validUntil).toBe(addDays(todayKey(), 30));
  });

  // ---------------- Sales order
  it('BR-20/21: SO only from an accepted latest quotation; PO rules; one order per quotation', () => {
    const s = setupOpp();
    const q = X(() => saveQuote(s.owner, { header: { opportunityId: s.opportunityId }, lines: [productLine(s.main, 1)] })).record;
    const st = site(s.owner, s.customerId);
    const input = (over: Partial<so.CreateOrderInput> = {}): so.CreateOrderInput => ({ source: 'quotation', sourceId: q.id, lines: so.draftFromQuotation(s.owner, q.id).lines, siteAddressId: st.id, customerPoNo: 'PO-1', customerPoDate: todayKey(), poFileName: 'po.pdf', idempotencyKey: `k-${uniq()}`, ...over });
    expect(refused(() => so.createOrder(s.owner, input())).code).toBe('invalid_state'); // draft quotation
    toAcceptedExisting(s, q.id);
    refused(() => so.createOrder(s.owner, input({ customerPoDate: addDays(todayKey(), 2) })));
    refused(() => so.createOrder(s.owner, input({ poFileName: '' })));
    refused(() => so.createOrder(s.owner, input({ poFileName: 'po.docx' })));
    refused(() => so.createOrder(s.owner, input({ siteAddressId: undefined })));
    refused(() => so.createOrder(s.owner, input({ lines: [] })));
    const o1 = X(() => so.createOrder(s.owner, input()));
    expect(refused(() => so.createOrder(s.owner, input())).code).toBe('invalid_state');
    expect(R('salesOrders').filter((o) => o.quotationId === q.id).map((o) => o.id)).toEqual([o1.id]);
  });

  it('BR-20 / §3.1: a Won opportunity cannot get a new quotation, and cannot produce a second sales order via another quotation', () => {
    const s = setupOpp();
    // two quotations raised on the same opportunity while it is open
    const qa = X(() => saveQuote(s.owner, { header: { opportunityId: s.opportunityId }, lines: [productLine(s.main, 1)] })).record;
    const qb = X(() => saveQuote(s.owner, { header: { opportunityId: s.opportunityId }, lines: [productLine(s.main, 2)] })).record;
    for (const id of [qa.id, qb.id]) {
      X(() => submitQuote(s.owner, id, byId('quotations', id)!.version, ''));
      X(() => sendQuote(s.owner, id, byId('quotations', id)!.version, { channel: 'email', to: s.email, message: '' }));
    }
    X(() => acceptQuote(s.owner, qa.id, byId('quotations', qa.id)!.version, { method: 'electronic', acceptedByName: 'Buyer' }));
    expect(byId('opportunities', s.opportunityId)!.stage).toBe('won');
    const newOnWon = (() => {
      try {
        return saveQuote(s.owner, { header: { opportunityId: s.opportunityId }, lines: [productLine(s.main, 1)] }).record.id;
      } catch {
        return null;
      }
    })();
    let secondAccepted = false;
    try {
      acceptQuote(s.owner, qb.id, byId('quotations', qb.id)!.version, { method: 'electronic', acceptedByName: 'Buyer' });
      secondAccepted = true;
    } catch {
      /* expected */
    }
    const st = site(s.owner, s.customerId);
    const mk = (qid: string) => {
      try {
        return so.createOrder(s.owner, { source: 'quotation', sourceId: qid, lines: so.draftFromQuotation(s.owner, qid).lines, siteAddressId: st.id, customerPoNo: 'PO-9', customerPoDate: todayKey(), poFileName: 'po.pdf', idempotencyKey: `k-${uniq()}` }).id;
      } catch {
        return null;
      }
    };
    const o1 = mk(qa.id);
    const o2 = mk(qb.id);
    expect(o1).toBeTruthy();
    expect.soft(newOnWon, 'BUG: saveQuote accepts a NEW quotation on an opportunity that is already Won (workflow.ts derive only blocks Lost)').toBeNull();
    expect.soft(secondAccepted, 'BUG: a second quotation of an already-Won opportunity can still be Accepted').toBe(false);
    expect.soft(R('salesOrders').filter((o) => o.opportunityId === s.opportunityId).length, `BUG: two sales orders for one Won opportunity (${o1}, ${o2})`).toBe(1);
  });

  it('SO-01 / SO-03: order pre-filled from a quotation keeps every line (duplicate products and custom lines)', () => {
    const s = setupOpp();
    const admin = A('u_rahul');
    // Admin (maintains price lists) builds a quotation with two custom service lines and the same machine twice at different discounts.
    const lines: QuoteLine[] = [
      productLine(s.main, 1, 0),
      productLine(s.main, 1, 4),
      { productId: null, description: 'Installation', lineType: 'service', qty: 1, listPrice: 50_000, discountPct: 0, discountAmt: 0, hsnSac: '998713', gstRate: 18 },
      { productId: null, description: 'Operator training', lineType: 'service', qty: 2, listPrice: 20_000, discountPct: 0, discountAmt: 0, hsnSac: '999293', gstRate: 18 },
    ];
    const q = toAccepted(s, lines, admin);
    const draft = so.draftFromQuotation(admin, q.id);
    expect(draft.lines.map((l) => l.description)).toEqual(['ChromaJet S19 Sublimation Printer', 'ChromaJet S19 Sublimation Printer', 'Installation', 'Operator training'].map((d, i) => (i < 2 ? String(s.main.name) : d)));
    const st = site(admin, s.customerId);
    const order = X(() => so.createOrder(admin, { source: 'quotation', sourceId: q.id, lines: draft.lines, siteAddressId: st.id, customerPoNo: 'PO-77', customerPoDate: todayKey(), poFileName: 'po.pdf', idempotencyKey: `k-${uniq()}` }));
    const ol = order.lines as QuoteLine[];
    expect.soft(ol.map((l) => l.description), 'BUG: createOrder→sanitizeLines keys reference lines by productId, so custom lines (productId null) collapse into the last one').toEqual((q.lines as QuoteLine[]).map((l) => l.description));
    expect.soft(ol.map((l) => l.listPrice)).toEqual((q.lines as QuoteLine[]).map((l) => l.listPrice));
    expect.soft(Number(order.grandTotal), 'order total equals the accepted quotation (unchanged lines)').toBeCloseTo(Number(q.grandTotal), 2);
  });

  // ---------------- Role-based authorization
  it('COM-01 / Appendix B: role-based authorization across the journey', () => {
    const s = setupOpp();
    const q = X(() => saveQuote(s.owner, { header: { opportunityId: s.opportunityId }, lines: [productLine(s.main, 1)] })).record;
    const v = () => byId('quotations', q.id)!.version;
    // engineer: no quotations; can create a lead but not a company
    expect(refused(() => saveQuote(A('u_ravi'), { header: { opportunityId: s.opportunityId }, lines: [productLine(s.main, 1)] })).code).toBe('forbidden');
    expect(refused(() => createLeadWithParty(A('u_ravi'), { divisionId: 'TX', sourceId: 'website', productType: 'machine', nextFollowUpAt: addDays(todayKey(), 1) }, { name: 'Eng Co', city: 'Surat', state: '24', territoryId: 'surat' }, { name: 'E', mobile: '6333300001' })).code).toBe('forbidden');
    // other division sales exec cannot see / act on Karan's records
    expect(refused(() => submitQuote(A('u_sneha'), q.id, v(), '')).code).toBe('not_found');
    expect(refused(() => qualifyLead(A('u_sneha'), String(byId('opportunities', s.opportunityId)!.leadId), 1, bant(1, 'x'))).code).toBe('not_found');
    expect(refused(() => markLost(A('u_sneha'), s.opportunityId, { lostReason: 'price', lostToCompetitor: 'X' }, byId('opportunities', s.opportunityId)!.version)).code).toBe('not_found');
    // management / accounts / SCM read but never change quotations
    for (const u of ['u_vikram', 'u_swati', 'u_rajesh']) expect(refused(() => submitQuote(A(u), q.id, v(), '')).code, u).toBe('forbidden');
    // management cannot create orders; store cannot see quotations
    toAcceptedExisting(s, q.id);
    const st = site(s.owner, s.customerId);
    const inp = { source: 'quotation' as const, sourceId: q.id, lines: so.draftFromQuotation(s.owner, q.id).lines, siteAddressId: st.id, customerPoNo: 'P', customerPoDate: todayKey(), poFileName: 'po.pdf' };
    expect(refused(() => so.createOrder(A('u_vikram'), { ...inp, idempotencyKey: 'mgmt' })).code).toBe('forbidden');
    expect(refused(() => so.createOrder(A('u_sneha'), { ...inp, idempotencyKey: 'other' })).code).toBeTruthy();
    expect(refused(() => so.draftFromQuotation(A('u_prakash'), q.id)).code).toBe('not_found');
    // Sales manager of the team may act on his executive's quotation (team scope)
    expect(() => so.draftFromQuotation(A('u_rohan'), q.id)).not.toThrow();
  });
});

/** Takes an existing draft quotation to Accepted (within limits). */
function toAcceptedExisting(s: ReturnType<typeof setupOpp>, id: string) {
  X(() => submitQuote(s.owner, id, byId('quotations', id)!.version, 'Reason for discount'));
  approveAll(id, s.owner);
  X(() => sendQuote(s.owner, id, byId('quotations', id)!.version, { channel: 'email', to: s.email, message: '' }));
  X(() => acceptQuote(s.owner, id, byId('quotations', id)!.version, { method: 'po', poNo: `PO-${s.n}`, poDate: todayKey(), file: { name: 'po.pdf', size: 1000 } }));
}

// =====================================================================================================================
// 3. CONCURRENCY-ISH STRESS (async page services, real interleaving)
// =====================================================================================================================

describe('3. Concurrency stress (Promise.all over the async *Api services)', () => {
  beforeEach(() => {
    setClockOffset(0);
    __setDb(createDb(new Date()));
    // Fast but non-zero, random latency so calls interleave like real network calls. Through commit, so a rollback keeps it.
    commit((d) => {
      d.demo.latencyMin = 0;
      d.demo.latencyMax = 8;
      d.demo.failureRate = 0;
    });
  });

  it('60 parallel lead creates (inline company + contact) → 60 unique lead, company and contact ids, no lost writes', async () => {
    const k = A('u_karan');
    const before = { l: R('leads').length, c: R('customers').length, ct: R('contacts').length };
    const t0 = performance.now();
    const res = await Promise.allSettled(
      Array.from({ length: 60 }, (_, i) =>
        leadsApi.create(k, { divisionId: 'TX', sourceId: 'website', productType: 'machine', ownerId: k.staffId, nextFollowUpAt: addDays(todayKey(), 1) }, { name: `Parallel Prints ${i}`, city: 'Surat', state: '24', territoryId: 'surat' }, { name: `P ${i}`, mobile: mobileFor(70000 + i) }),
      ),
    );
    const ms = performance.now() - t0;
    const ok = res.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ record: RecordData }>[];
    expect(res.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    const ids = ok.map((r) => r.value.record.id);
    expect(new Set(ids).size).toBe(60);
    expect(R('leads').length - before.l).toBe(60);
    expect(R('customers').length - before.c).toBe(60);
    expect(R('contacts').length - before.ct).toBe(60);
    idIntegrity(['leads', 'customers', 'contacts', 'addresses']);
    console.info(`CONCURRENCY 60 lead creates: ${ms.toFixed(0)}ms`);
  });

  it('20 parallel updates of the same opportunity with the same version → exactly one wins (optimistic lock, no lost update)', async () => {
    const s = setupOpp();
    const o = byId('opportunities', s.opportunityId)!;
    const { call } = await import('../services/api/client');
    const res = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => call(() => updateRecord(s.owner, 'opportunities', o.id, { decisionMakers: `Writer ${i}` }, o.version))));
    const won = res.filter((r) => r.status === 'fulfilled');
    expect(won.length).toBe(1);
    expect(res.filter((r) => r.status === 'rejected').every((r) => /changed|version|modified|conflict/i.test(String((r as PromiseRejectedResult).reason?.message ?? '')))).toBe(true);
    expect(byId('opportunities', o.id)!.version).toBe(o.version + 1);
  });

  it('Parallel saveQuote on 30 opportunities across divisions → unique quotation numbers, consecutive per division', async () => {
    const owners = [A('u_karan'), A('u_sneha'), A('u_deepak')];
    const divs = ['TX', 'INK', 'PPR'];
    const setups = Array.from({ length: 30 }, (_, i) => setupOpp('inline', owners[i % 3].user.id, divs[i % 3]));
    const before = { ...db().counters };
    const res = await Promise.allSettled(setups.map((s) => quotationsApi.save(s.owner, { header: { opportunityId: s.opportunityId }, lines: [productLine(s.main, 1)] })));
    expect(res.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    idIntegrity(['quotations']);
    for (const div of divs) {
      const key = Object.keys(db().counters).find((k) => k.startsWith(`quoteNo:${div}:`))!;
      const nums = (res as PromiseFulfilledResult<{ record: RecordData }>[]).map((r) => r.value.record).filter((q) => q.divisionId === div).map((q) => Number(String(q.quoteNo).slice(-4))).sort((a, b) => a - b);
      expect(nums).toEqual(Array.from({ length: 10 }, (_, i) => (before[key] ?? 0) + i + 1));
    }
  });

  it('Parallel "Generate Sales Order" from one accepted quotation with different idempotency keys → one order; same key → same order', async () => {
    const s = setupOpp();
    const q = toAccepted(s);
    const st = site(s.owner, s.customerId);
    const lines = so.draftFromQuotation(s.owner, q.id).lines;
    const mk = (key: string) => createOrderApi(s.owner, { source: 'quotation', sourceId: q.id, lines, siteAddressId: st.id, customerPoNo: 'PO-C', customerPoDate: todayKey(), poFileName: 'po.pdf', idempotencyKey: key });
    const res = await Promise.allSettled([...Array.from({ length: 10 }, (_, i) => mk(`distinct-${i}`)), ...Array.from({ length: 10 }, () => mk('same-key'))]);
    expect(R('salesOrders').filter((o) => o.quotationId === q.id).length).toBe(1);
    const created = res.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<RecordData>).value.id);
    expect(new Set(created).size).toBe(1);
  });

  it('Parallel approvals of the same pending level by two eligible approvers → one decision recorded', async () => {
    const s = setupOpp('inline', 'u_sneha', 'INK'); // INK: no Sales Manager → capability level any eligible DH/MD may decide
    const q = X(() => saveQuote(s.owner, { header: { opportunityId: s.opportunityId }, lines: [productLine(s.main, 1, 20)] })).record;
    X(() => submitQuote(s.owner, q.id, q.version, 'Deep discount for volume'));
    const a = db().approvals.find((x) => x.recordId === q.id && x.status === 'pending')!;
    const eligible = allActors().filter((x) => canDecideQuote(x, a));
    const res = await Promise.allSettled(eligible.concat(eligible).map((x) => quotationsApi.decideApproval(x, a.id, 'approved', 'parallel', a.version)));
    expect(res.filter((r) => r.status === 'fulfilled').length).toBe(1);
    const after = db().approvals.find((x) => x.id === a.id)!;
    expect(after.decisions.filter((d) => d.level === 0).length).toBe(1);
  });

  it('Parallel qualify of the same lead (double click) → one opportunity', async () => {
    const k = A('u_karan');
    const L1 = makeLead(k, 'TX', 'machine', TERRITORIES[1], 8800 + uniq(), 'inline');
    const l = byId('leads', L1.leadId)!;
    const res = await Promise.allSettled(Array.from({ length: 8 }, () => leadsApi.convertToOpportunity(k, l.id, l.version, bant(2_000_000, 'Double click'))));
    expect(res.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(R('opportunities').filter((o) => o.leadId === l.id).length).toBe(1);
  });
});

// =====================================================================================================================
// 4. VOLUME
// =====================================================================================================================

describe('4. Volume: 200 leads + 200 opportunities, list / search / filter timings', () => {
  const vt: Record<string, number> = {};
  const T = <V,>(k: string, fn: () => V): V => {
    const t0 = performance.now();
    const r = fn();
    vt[k] = performance.now() - t0;
    return r;
  };
  beforeAll(() => {
    setClockOffset(0);
    __setDb(createDb(new Date()));
  });
  afterAll(() => console.info(`VOLUME_TIMINGS ${JSON.stringify(Object.fromEntries(Object.entries(vt).map(([k, v]) => [k, `${v.toFixed(1)}ms`])), null, 1)}`));

  it('creates 200 leads and converts all 200 to opportunities; ids unique; lists stay correct and fast', async () => {
    const owners = [A('u_karan'), A('u_rohan'), A('u_sneha'), A('u_deepak'), A('u_pooja')];
    const divs = ['TX', 'TX', 'INK', 'PPR', 'FAB'];
    const created: string[] = [];
    // Yield to the event loop every 10 writes: each commit re-serialises the whole store (persist + rollback copy)
    // and jsdom queues a storage task per localStorage write, so a tight synchronous loop runs the worker out of heap.
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const t0 = performance.now();
    {
      for (let i = 0; i < 200; i++) {
        if (i % 10 === 0) await tick();
        const o = owners[i % 5];
        const terr = TERRITORIES[i % TERRITORIES.length];
        const r = createLeadWithParty(o, { divisionId: divs[i % 5], sourceId: 'website', productType: divs[i % 5] === 'TX' ? 'machine' : divs[i % 5] === 'INK' ? 'ink' : divs[i % 5] === 'PPR' ? 'paper' : 'fabric', ownerId: o.staffId, nextFollowUpAt: addDays(todayKey(), 1) }, { name: `Volume Mills ${i} Pvt Ltd`, city: terr.label, state: terr.state, territoryId: terr.key }, { name: `Vol Buyer ${i}`, mobile: mobileFor(300000 + i), email: `vol${i}@volume.example` });
        created.push(r.record.id);
      }
    }
    vt.create200Leads = performance.now() - t0;
    expect(new Set(created).size).toBe(200);
    const t1 = performance.now();
    for (let i = 0; i < created.length; i++) {
      if (i % 10 === 0) await tick();
      const l = byId('leads', created[i])!;
      qualifyLead(owners[i % 5], created[i], l.version, bant(100_000 + i * 1000, `Volume deal ${i}`));
    }
    vt.convert200 = performance.now() - t1;
    const size = JSON.stringify(db()).length;
    console.info(`VOLUME store size after run: ${(size / 1e6).toFixed(2)} M chars; persistError=${getPersistError()}`);
    expect(getPersistError(), 'store still persists to localStorage').toBeNull();
    expect(R('opportunities').filter((o) => String(o.name).startsWith('Volume deal')).length).toBe(200);
    idIntegrity(['leads', 'opportunities', 'customers', 'contacts']);

    const admin = A('u_rahul');
    const rohan = A('u_rohan');
    const all = T('queryLeads_all_admin', () => queryRecords(admin, 'leads', {}));
    expect(all.total).toBeGreaterThanOrEqual(350);
    const page = T('queryLeads_page_sorted', () => queryRecords(admin, 'leads', { sort: [{ field: 'createdAt', dir: 'desc' }], page: 3, pageSize: 25 }));
    expect(page.rows.length).toBe(25);
    const search = T('queryLeads_search', () => queryRecords(admin, 'leads', { search: 'Volume Mills 1' }));
    expect(search.total, 'search by company name finds "Volume Mills 1…" (1, 10-19, 100-199 → 111)').toBeGreaterThanOrEqual(111);
    const byStatus = T('queryLeads_where_status', () => queryRecords(admin, 'leads', { where: { status: 'qualified' } }));
    expect(byStatus.total).toBeGreaterThanOrEqual(200);
    const team = T('queryLeads_team_scope_SM', () => queryRecords(rohan, 'leads', {}));
    expect(team.rows.every((l) => ['E-1008', 'E-1011'].includes(String(l.ownerId)))).toBe(true);
    const pipe = T('pipelineRows_open', () => pipelineRows(admin, {}));
    expect(pipe.filter((o) => String(o.name).startsWith('Volume deal')).length).toBe(200);
    const pipeSearch = T('pipelineRows_search', () => pipelineRows(admin, { search: 'Volume deal 19', divisionId: 'TX' }));
    expect(pipeSearch.length).toBeGreaterThan(0);
    const pipeFilter = T('pipelineRows_filter_owner_month', () => pipelineRows(admin, { ownerId: 'E-1011', closeMonth: addDays(todayKey(), 45).slice(0, 7), stage: 'all' }));
    expect(pipeFilter.every((o) => o.ownerId === 'E-1011')).toBe(true);
    const oppSort = T('queryOpps_sort_value', () => queryRecords(admin, 'opportunities', { sort: [{ field: 'value', dir: 'desc' }], pageSize: 50 }));
    const vals = oppSort.rows.map((r) => Number(r.value));
    expect(vals).toEqual([...vals].sort((a, b) => b - a));
    T('findDuplicateLeads', () => findDuplicateLeads(admin, { companyName: 'Volume Mills 150 Pvt Ltd', divisionId: 'TX' }));
    // a full list query should stay well under a second in local mode
    expect(vt.queryLeads_all_admin).toBeLessThan(1000);
    expect(vt.pipelineRows_open).toBeLessThan(1000);
  });
});
