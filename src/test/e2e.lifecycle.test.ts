/**
 * End-to-end lifecycle (BRD §3, §3.1 hand-offs, §2.2 "information captured once and reused").
 * Walks one customer from the Contact Pool to an engineer-spotted lead, as the real roles would,
 * checking at every hand-off that the next record is created and pre-filled WITHOUT re-entry,
 * that the right person is notified and that the audit trail records the step.
 *
 * Flow-breaking problems fail the step. Carry-forward gaps found against the BRD are collected and
 * asserted in the last test, which runs only with E2E_STRICT=1 (they belong to module owners).
 */
import '../domain/extensions/index';
import { actorFor, type Actor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { setClockOffset } from '../lib/clock';
import { addDays, todayKey } from '../lib/dates';
import { createRecord, transitionRecord, updateRecord } from '../services/runtime';
import { canDecide, decideApproval } from '../services/workflow';
import { listPoolContacts } from '../services/customers/pool';
import { convertContactToLead } from '../services/customers/operations';
import { qualifyLead } from '../services/leads/rules';
import { logActivity, activitiesFor } from '../services/activities';
import { saveQuote, submitQuote, sendQuote, acceptQuote } from '../services/quotations/workflow';
import { listPriceFor } from '../services/lookups';
import type { QuoteLine } from '../services/quotations/pricing';
import * as so from '../services/orders/orders';
import { generateContract } from '../services/orders/contracts';
import { allSteps, shareReadinessChecklist, startSignOffOtp, signOffInstallation, runRenewalSweep, addMonths } from '../services/installed/logic';
import { portalIdentify, createTicketFromChannel, assignTicket, submitFeedback, opportunitySpotted, sweepService } from '../services/service/tickets';
import { myJobs, acceptJob, startTravel, checkIn, saveWork, requestSignOffOtp, checkOut } from '../services/service/jobs';
import { issueRequisition, recordConsumption } from '../services/spares/requisitions';
import { leakageList, customerConsumables } from '../services/spares/consumables';
import { shiftClock } from '../services/demo';
import { dashboardFor, resolveRange } from '../services/reports/overview';
import { listNotifications } from '../services/collab';
import type { Approval } from '../services/types';

// ---------------------------------------------------------------- roles (src/domain/pack.ts)
const A = (id: string) => actorFor(id, 'tc');
const admin = () => A('u_rahul'); // System Administrator (time travel only)
const karan = () => A('u_karan'); // Sales Executive – Textile (reports to Rohan)
const rohan = () => A('u_rohan'); // Sales Manager – Textile
const suresh = () => A('u_suresh'); // Division Head – Textile
const vikram = () => A('u_vikram'); // Managing Director
const swati = () => A('u_swati'); // Accounts
const rajesh = () => A('u_rajesh'); // Import / SCM
const meera = () => A('u_meera'); // Service Coordinator
const ravi = () => A('u_ravi'); // Service Engineer – Textile
const sanjay = () => A('u_sanjay'); // National Service Manager
const manoj = () => A('u_manoj'); // Service Head

// ---------------------------------------------------------------- result log
interface Row { step: string; ref: string; role: string; expected: string; actual: string; reentry: 'no' | 'yes'; owner: string; ok: boolean }
const log: Row[] = [];
const gaps: { step: string; ref: string; expected: string; actual: string; owner: string }[] = [];
function rec(r: Omit<Row, 'ok' | 'reentry'> & { reentry?: 'yes' | 'no'; ok?: boolean }) {
  log.push({ reentry: 'no', ok: true, ...r });
}
function gap(step: string, ref: string, expected: string, actual: string, owner: string) {
  gaps.push({ step, ref, expected, actual, owner });
  rec({ step, ref, role: '—', expected, actual, owner, ok: false });
}
const note = (cond: boolean, step: string, ref: string, expected: string, actual: string, owner: string) => {
  if (!cond) gap(step, ref, expected, actual, owner);
  return cond;
};

const db = () => getDb();
const linkId = (n: { link?: { resource: string; recordId: string } | { page: string } }) => (n.link && 'recordId' in n.link ? n.link.recordId : undefined);
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const R = (res: string) => db().records[res] ?? [];
const byId = (res: string, id: unknown) => R(res).find((r) => r.id === id);
const notesFor = (a: Actor, recordId?: string) => listNotifications(a).filter((n) => !recordId || linkId(n) === recordId);
const approvalNotes = (a: Actor) => listNotifications(a).filter((n) => n.kind === 'approval_request').length;
const auditFor = (recordId: string) => db().audit.filter((x) => x.recordId === recordId);
const approverFor = (a: Approval, prefer: Actor[]) => prefer.find((x) => canDecide(x, a));
const pendingFor = (recordId: string, type?: string) => db().approvals.find((x) => x.recordId === recordId && x.status === 'pending' && (!type || x.type === type));

/** Re-throws service errors with their field errors so failures say what is wrong. */
const X = <T,>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    const fe = (e as { fieldErrors?: Record<string, string> }).fieldErrors;
    if (fe) throw new Error(`${(e as Error).message} ${JSON.stringify(fe)}`);
    throw e;
  }
};

// ---------------------------------------------------------------- shared state across steps
const S: Record<string, string> = {};
const kpiMap = (a: Actor) => Object.fromEntries(dashboardFor(a, resolveRange('30d')).kpis.map((k) => [k.label, Number(k.value)]));
const dash0: Record<string, Record<string, number>> = {};
/** Optional: E2E_SNAP_DIR=<dir> writes the store after a step so the browser walk can load that exact state. */
async function snap(name: string) {
  const dir = env.E2E_SNAP_DIR;
  if (!dir) return;
  const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { writeFileSync: (path: string, data: string) => void };
  fs.writeFileSync(`${dir}/snap-${name}.json`, JSON.stringify(db()));
  fs.writeFileSync(`${dir}/ids.json`, JSON.stringify(S, null, 1));
}

describe('E2E lifecycle — Contact Pool to engineer-spotted lead (BRD §3 / §3.1)', () => {
  beforeAll(() => {
    setClockOffset(0);
    __setDb(createDb(new Date()));
  });
  afterAll(() => {
    setClockOffset(0);
    // Step table for the QA report (scratchpad), printed for the run log.
    console.info(`E2E_STEPS ${JSON.stringify(log)}`);
    console.info(`E2E_GAPS ${JSON.stringify(gaps)}`);
  });

  it('1. Contact Pool → Convert to Lead (Sales Executive) — §3.1 row 1, BR-04, CUS-05', async () => {
    await snap('00-seed');
    dash0.karan = kpiMap(karan());
    dash0.rohan = kpiMap(rohan());
    dash0.manoj = kpiMap(manoj());
    dash0.swati = kpiMap(swati());
    const pool = listPoolContacts(karan()).filter((p) => !p.contact.customerId && p.contact.poolStatus !== 'converted' && p.contact.source !== 'exhibition');
    expect(pool.length, 'Sales Executive sees pool contacts').toBeGreaterThan(0);
    const c = pool[0].contact;
    S.contactId = c.id;
    const before = notesFor(rohan()).length;
    const out = convertContactToLead(karan(), {
      contactId: c.id,
      companyName: 'Shree Laxmi Digital Prints Pvt Ltd',
      territoryId: 'surat',
      billingState: '24',
      divisionId: 'TX',
      productType: 'machine',
      ownerId: karan().staffId,
      nextFollowUpAt: addDays(todayKey(), 1),
      requirement: 'Needs a 3.2 m dye-sublimation printer for polyester',
    });
    S.leadId = out.leadId;
    S.customerId = out.customerId;
    const lead = byId('leads', out.leadId)!;
    const contact = byId('contacts', c.id)!;
    expect(lead.contactId).toBe(c.id);
    expect(lead.customerId).toBe(out.customerId);
    expect(contact.customerId).toBe(out.customerId);
    expect(contact.poolStatus).toBe('converted');
    note(lead.city === (c.city ?? ''), '1. Convert to Lead', 'BR-04', 'Lead city taken from contact', String(lead.city), 'customers');
    note(auditFor(out.leadId).length > 0, '1. Convert to Lead', 'BR-50', 'Audit entry for lead create', `${auditFor(out.leadId).length}`, 'core');
    rec({ step: '1. Contact → Convert to Lead', ref: '§3.1 r1 / BR-04', role: 'Sales Executive (Karan)', expected: 'Lead with contact + company; company created inline when missing', actual: `Lead ${out.leadId} for ${out.customerId}; contact linked + "Converted"; manager notifications +${notesFor(rohan()).length - before}`, owner: 'customers' });
  });

  it('2. Follow-ups on the lead (LEAD-09) — activity logged, status Contacted', () => {
    const lead = byId('leads', S.leadId)!;
    logActivity(karan(), { parentResource: 'leads', parentId: lead.id, parentLabel: lead.id, customerId: String(lead.customerId), activityType: 'call', subject: 'Discovery call — needs 3.2 m printer', notes: 'Budget ~₹38 L, decision by MD, Q3', nextFollowUpAt: addDays(todayKey(), 2) });
    const autoContacted = byId('leads', S.leadId)!.status === 'contacted';
    if (!autoContacted) transitionRecord(karan(), 'leads', S.leadId, 'contacted', byId('leads', S.leadId)!.version as number);
    expect(byId('leads', S.leadId)!.status).toBe('contacted');
    expect(activitiesFor(karan(), 'leads', S.leadId).length).toBeGreaterThan(0);
    rec({ step: '2. Follow-up + Contacted', ref: 'LEAD-09', role: 'Sales Executive', expected: 'Activity logged; next follow-up kept; status Contacted', actual: `status ${byId('leads', S.leadId)!.status}; next ${byId('leads', S.leadId)!.nextFollowUpAt}`, owner: 'leads' });
  });

  it('3. Lead Qualified → Opportunity with all lead data, activities and documents — §3.1 row 2', () => {
    const lead = byId('leads', S.leadId)!;
    const out = qualifyLead(karan(), S.leadId, lead.version as number, {
      requirement: 'Needs a 3.2 m dye-sublimation printer for polyester',
      budget: 3_800_000,
      decisionMaker: 'Mr Laxmikant Shah (MD)',
      timeline: 'q3',
      currentSetup: 'Two 1.8 m printers',
      opportunityName: 'Shree Laxmi — 3.2 m sublimation printer',
      value: 3_800_000,
      expectedCloseDate: addDays(todayKey(), 45),
    });
    S.oppId = out.opportunityId;
    const opp = byId('opportunities', out.opportunityId)!;
    const lead2 = byId('leads', S.leadId)!;
    expect(lead2.status).toBe('qualified');
    expect(opp).toMatchObject({ customerId: lead.customerId, contactId: lead.contactId, leadId: lead.id, divisionId: 'TX', ownerId: lead.ownerId, stage: 'needs_assessment' });
    note(opp.productType === lead.productType || opp.productType === 'machine', '3. Lead → Opportunity', '§3.1 r2', 'Opportunity Product type carried from the lead', `opp.productType=${String(opp.productType)} (lead ${String(lead.productType)})`, 'leads (src/services/leads/rules.ts qualifyLead)');
    note(!!opp.territoryId || !R('customers').find((c) => c.id === lead.customerId)?.territoryId, '3. Lead → Opportunity', '§3.1 r2', 'Opportunity territory carried from the lead/customer', `opp.territoryId=${String(opp.territoryId)}`, 'leads (qualifyLead)');
    note(String(opp.notes ?? '').length > 0, '3. Lead → Opportunity', '§3.1 r2', 'Requirement / budget / timeline (BANT) visible on the opportunity', `opp.notes=${JSON.stringify(opp.notes ?? null)}`, 'leads (qualifyLead)');
    // The opportunity Timeline shows its own activities plus those of the source lead (no copy needed).
    const oppActs = [...activitiesFor(karan(), 'opportunities', out.opportunityId), ...(opp.leadId ? activitiesFor(karan(), 'leads', String(opp.leadId)) : [])];
    note(oppActs.length > 0, '3. Lead → Opportunity', '§3.1 r2 / §5.3', 'Lead activities visible on the opportunity Timeline', `opportunity timeline has ${oppActs.length} activities; lead had ${activitiesFor(karan(), 'leads', S.leadId).length}`, 'opportunities (src/domain/extensions/opportunities.tsx Timeline) + leads (qualifyLead)');
    rec({ step: '3. Qualified → Opportunity', ref: '§3.1 r2 / LEAD-10', role: 'Sales Executive', expected: 'Opportunity with all lead data, activities and documents', actual: `${out.opportunityId} at Needs Assessment, customer/contact/owner/division carried; activities on timeline: ${oppActs.length}`, owner: 'leads' });
  });

  it('4. Demo / Sample stage (OPP-04/05)', () => {
    let o = byId('opportunities', S.oppId)!;
    transitionRecord(karan(), 'opportunities', S.oppId, 'demo', o.version as number);
    const dm = R('demoMachines').find((m) => m.divisionId === 'TX' && m.status !== 'inactive') ?? R('demoMachines')[0];
    const demo = X(() => createRecord(karan(), 'demos', { opportunityId: S.oppId, location: 'centre', demoMachineId: dm?.id, scheduledAt: `${addDays(todayKey(), 1)}T11:00`, durationMin: 120, ownerId: karan().staffId, agenda: 'Print on customer polyester' }));
    S.demoId = demo.record.id;
    note(demo.record.customerId === byId('opportunities', S.oppId)!.customerId || demo.record.customerId === undefined, '4. Demo', 'OPP-04', 'Demo carries the opportunity customer', String(demo.record.customerId), 'opportunities');
    o = byId('opportunities', S.oppId)!;
    expect(o.stage).toBe('demo');
    transitionRecord(karan(), 'opportunities', S.oppId, 'proposal', o.version as number);
    expect(byId('opportunities', S.oppId)!.stage).toBe('proposal');
    rec({ step: '4. Demo booked, stage Demo → Proposal', ref: 'OPP-02/04', role: 'Sales Executive', expected: 'Demo linked to the opportunity; stage moves', actual: `Demo ${S.demoId}; stage ${byId('opportunities', S.oppId)!.stage}; probability ${byId('opportunities', S.oppId)!.probability}`, owner: 'opportunities' });
  });

  it('5. Quotation with discount above threshold → Sales Manager → Division Head → MD (QUO-06, BR-17)', () => {
    const product = R('products').find((p) => p.productType === 'machine' && p.divisionId === 'TX' && p.status !== 'inactive' && listPriceFor(p.id, todayKey()))!;
    expect(product, 'a priced TX machine').toBeTruthy();
    const line: QuoteLine = { productId: product.id, description: String(product.name), lineType: 'machine', qty: 1, listPrice: 1, discountPct: 18, discountAmt: 0, hsnSac: String(product.hsnSac), gstRate: Number(product.gstRate) };
    const saved = saveQuote(karan(), { header: { opportunityId: S.oppId }, lines: [line] });
    S.quoteId = saved.record.id;
    const q = byId('quotations', S.quoteId)!;
    const opp = byId('opportunities', S.oppId)!;
    expect(q.customerId).toBe(opp.customerId); // pre-filled from the opportunity
    expect(q.contactId).toBe(opp.contactId);
    expect(q.placeOfSupply).toBe('24'); // from customer's billing state
    expect(String(q.paymentTerms ?? '').length).toBeGreaterThan(0); // division terms template
    const apBefore = new Map([rohan(), suresh(), vikram()].map((a) => [a.user.id, approvalNotes(a)]));
    const r = submitQuote(karan(), S.quoteId, q.version as number, 'Competitive offer against importer');
    expect(r.status).toBe('pending_approval');
    const chain: string[] = [];
    for (const who of [rohan(), suresh(), vikram()]) {
      const a = pendingFor(S.quoteId);
      if (!a) break;
      const lvl = a.levels[a.currentLevel];
      const gotNote = approvalNotes(who) > (apBefore.get(who.user.id) ?? 0);
      expect(canDecide(who, a), `${who.user.name} decides "${lvl.label}"`).toBe(true);
      expect(canDecide(karan(), a)).toBe(false);
      decideApproval(who, a.id, 'approved', 'OK', a.version);
      chain.push(`${lvl.label} by ${who.user.name}${gotNote ? ' (notified)' : ' (NOT notified)'}`);
      note(gotNote, '5. Quote approval', 'QUO-06 / COM-06', `Approver ${who.user.name} notified of pending approval`, 'no in-app notification for this approver', 'quotations / core workflow (src/services/workflow.ts requestApprovalIn)');
    }
    expect(byId('quotations', S.quoteId)!.status).toBe('approved');
    expect(chain.length).toBe(3);
    rec({ step: '5. Quote 18 % discount → approvals', ref: 'QUO-06 / BR-17', role: 'Sales Exec → SM → DH → MD', expected: 'Chain Sales Manager → Division Head → Management', actual: chain.join(' → '), owner: 'quotations' });
  });

  it('6. Quotation Sent → Accepted with PO → Opportunity Won (QUO-10, §3.1 row 3)', async () => {
    let q = byId('quotations', S.quoteId)!;
    const ct = byId('contacts', q.contactId);
    const viaEmail = ct?.consentEmail !== false && !!ct?.email;
    sendQuote(karan(), S.quoteId, q.version as number, viaEmail ? { channel: 'email', to: String(ct!.email), message: '' } : { channel: 'whatsapp', to: String(ct?.whatsapp || ct?.mobile || '9825011122'), message: '' });
    q = byId('quotations', S.quoteId)!;
    expect(q.status).toBe('sent');
    acceptQuote(karan(), S.quoteId, q.version as number, { method: 'po', poNo: 'SLDP/PO/2026/118', poDate: todayKey(), file: { name: 'SLDP-PO-118.pdf', size: 120_000 } });
    expect(byId('quotations', S.quoteId)!.status).toBe('accepted');
    expect(byId('opportunities', S.oppId)!.stage).toBe('won');
    rec({ step: '6. Sent → Accepted (PO) → Won', ref: 'QUO-10 / OPP-02', role: 'Sales Executive', expected: 'PO captured; opportunity Won automatically', actual: `quote accepted; opp ${byId('opportunities', S.oppId)!.stage}`, owner: 'quotations' });
    await snap('06-won');
  });

  it('7. Generate Sales Order pre-filled from the quotation (SO-01, BR-20, §3.1 row 3)', async () => {
    const q = byId('quotations', S.quoteId)!;
    const draft = so.draftFromQuotation(karan(), S.quoteId);
    expect(draft.blocker).toBeNull();
    expect(draft.customerId).toBe(q.customerId);
    expect(draft.lines.length).toBe((q.lines as QuoteLine[]).length);
    expect(draft.terms.paymentTerms).toBe(q.paymentTerms);
    const d = draft as unknown as Record<string, unknown>;
    const poCarried = d.customerPoNo === q.customerPoNo || (d.po as Record<string, unknown> | undefined)?.customerPoNo === q.customerPoNo;
    note(poCarried, '7. Generate Sales Order', '§2.2 / SO-02 / BR-21', `PO no. / date / file captured at quotation acceptance (${String(q.customerPoNo)}) pre-fill the order`, 'OrderDraft has no PO fields; New Sales Order form starts with an empty PO number and file (re-entry)', 'orders (src/services/orders/orders.ts draftFromQuotation + src/modules/orders/NewOrderPage.tsx)');
    // BR-23: finance check needs an overdue amount — simulate the ERP sync result for the customer.
    const cust = byId('customers', q.customerId)!;
    cust.overdue = 45_000;
    const order = so.createOrder(karan(), { source: 'quotation', sourceId: S.quoteId, lines: draft.lines, customerPoNo: String(q.customerPoNo), customerPoDate: String(q.customerPoDate), poFileName: String(q.poFileName), idempotencyKey: 'e2e-so-1' });
    S.orderId = order.id;
    let twiceMsg = '';
    try {
      const twice = so.createOrder(karan(), { source: 'quotation', sourceId: S.quoteId, lines: draft.lines, customerPoNo: String(q.customerPoNo), customerPoDate: String(q.customerPoDate), poFileName: String(q.poFileName), idempotencyKey: 'e2e-so-1' });
      expect(twice.id).toBe(order.id);
    } catch (e) {
      twiceMsg = (e as Error).message;
    }
    expect(R('salesOrders').filter((o) => o.quotationId === S.quoteId).length).toBe(1); // never two orders
    note(!twiceMsg, '7. Double submit', 'Brief §6 / NFR idempotency', 'Retried submit with the same idempotency key returns the order already created', `throws "${twiceMsg}" — blocker check runs before the idempotency lookup`, 'orders (src/services/orders/orders.ts createOrder)');
    expect(order).toMatchObject({ status: 'pending_approval', quotationId: S.quoteId, opportunityId: S.oppId, customerId: q.customerId, orderKind: 'machine' });
    expect(Math.abs(Number(order.grandTotal) - Number(q.grandTotal))).toBeLessThan(1);
    rec({ step: '7. Generate Sales Order', ref: 'SO-01 / BR-20', role: 'Sales Executive', expected: 'SO pre-filled from quotation (customer, lines, terms, PO)', actual: `${String(order.orderNo)} pending approval; lines/terms carried; PO re-typed: ${poCarried ? 'no' : 'YES'}`, reentry: poCarried ? 'no' : 'yes', owner: 'orders' });
    await snap('07-so');
  });

  it('8. SO approval: reporting manager + Accounts finance check (SO-04, BR-23); ERP push; contract (§3.1 row 4)', async () => {
    const order = byId('salesOrders', S.orderId)!;
    expect(order.financeCheck).toBe(true);
    const a = pendingFor(S.orderId, so.APPROVAL)!;
    expect(a.levels.length).toBe(2);
    const steps: string[] = [];
    for (const prefer of [[rohan()], [swati()]]) {
      const cur = pendingFor(S.orderId, so.APPROVAL)!;
      const label = cur.levels[cur.currentLevel].label;
      const who = approverFor(cur, prefer);
      expect(who, `expected ${prefer[0].user.name} to decide ${label}`).toBeTruthy();
      const notified = listNotifications(who!).some((n) => n.kind === 'approval_request' && String(n.title).includes(String(order.orderNo)));
      note(notified, '8. SO approval', 'SO-04 / COM-06', `${who!.user.name} notified of SO approval`, 'no in-app notification', 'core workflow (src/services/workflow.ts)');
      decideApproval(who!, cur.id, 'approved', 'OK', cur.version);
      steps.push(`${label} by ${who!.user.name}${notified ? ' (notified)' : ''}`);
    }
    const after = byId('salesOrders', S.orderId)!;
    expect(['payment_pending', 'confirmed', 'payment_received']).toContain(after.status);
    expect(after.erpPushedAt).toBeTruthy();
    const ownerNotified = notesFor(karan()).some((n) => linkId(n) === S.orderId);
    note(ownerNotified, '8. SO approval', 'SO-04', 'Sales owner told the order is approved', 'no notification', 'orders');
    // Generate Sales Contract (enabled once approved).
    const c = generateContract(karan(), S.orderId);
    S.contractId = c.id;
    expect(c.contractValue).toBe(after.grandTotal);
    expect(c.customerId).toBe(after.customerId);
    // ERP push → invoice no. and e-way bill reference.
    const erp = so.pushToErp(swati(), S.orderId);
    expect(erp.invoiceNo).toBeTruthy();
    rec({ step: '8. SO approved → contract + ERP', ref: 'SO-04/05/09, BR-23/24', role: 'Sales Manager, Accounts, Sales Exec', expected: 'Manager then Accounts; Generate Sales Contract enabled; ERP push', actual: `${steps.join(' → ')}; status ${after.status}; contract ${String(c.contractNo)}; invoice ${String(erp.invoiceNo)}`, owner: 'orders' });
    await snap('08-approved');
  });

  it('9. Advance received → Order Processing by Import / SCM → Ready for Dispatch (SO-07/08)', () => {
    const ms = so.milestonesOf(db(), S.orderId)[0];
    so.recordReceipt(swati(), ms.id, Number(ms.amount), todayKey());
    let o = byId('salesOrders', S.orderId)!;
    expect(o.status).toBe('payment_received');
    o = so.updateProcessing(rajesh(), S.orderId, { poToPrincipalNo: 'PO-EPS-7781', poToPrincipalDate: todayKey(), shipmentEta: addDays(todayKey(), 20), customsStatus: 'cleared', machineReady: true, pdiDone: true, processingNotes: 'Arrived Nhava Sheva' }, o.version as number);
    o = transitionRecord(rajesh(), 'salesOrders', S.orderId, 'processing', o.version as number).record;
    o = transitionRecord(rajesh(), 'salesOrders', S.orderId, 'ready_for_dispatch', o.version as number).record;
    expect(o.status).toBe('ready_for_dispatch');
    const boardRow = so.processingBoard(rajesh()).find((r) => r.order.id === S.orderId);
    expect(boardRow?.canEdit).toBe(true);
    rec({ step: '9. Processing → Ready for Dispatch', ref: 'SO-08 / FR-056', role: 'Accounts, Import / SCM (Rajesh)', expected: 'Advance gate; PO to principal, ETA, customs, PDI; Ready for Dispatch', actual: `status ${o.status}`, owner: 'orders' });
  });

  it('10. Dispatch (LR, e-way bill) → Delivered (POD) → installation job + handover (INS-01/02/05, §3.1 row 5)', async () => {
    const dsp = so.recordDispatch(rajesh(), S.orderId, { dispatchDate: todayKey(), transporter: 'VRL Logistics', lrNumber: 'VRL-55102', expectedDelivery: addDays(todayKey(), 3), notifyCustomer: true });
    const erp = byId('salesOrders', S.orderId)!;
    expect(dsp.ewayBill).toBe(erp.ewayBill); // carried from ERP push, not re-typed
    expect(dsp.invoiceRef).toBe(erp.invoiceNo);
    const intimation = db().outbox.filter((m) => m.related?.recordId === S.orderId);
    note(intimation.length > 0, '10. Dispatch', 'INS-01', 'Dispatch intimation to customer by WhatsApp/email', 'nothing in the outbox', 'orders');
    const before = notesFor(meera()).length;
    const out = so.confirmDelivery(rajesh(), dsp.id, { actualDelivery: todayKey(), podFileName: 'POD-VRL-55102.pdf', podFileSize: 80_000, podPhotoName: 'delivery-photo.jpg', podPhotoSize: 90_000 } as Parameters<typeof so.confirmDelivery>[2]);
    expect(out.installationId).toBeTruthy();
    S.installationId = out.installationId!;
    const ins = byId('installations', S.installationId)!;
    expect(ins).toMatchObject({ salesOrderId: S.orderId, customerId: erp.customerId, productId: erp.productId, divisionId: 'TX', status: 'scheduled' });
    const meeraNew = notesFor(meera()).length - before;
    note(meeraNew === 1, '10. Delivered → installation job', 'INS-05', 'Coordinator gets one "new installation job" notification', `${meeraNew} notifications (createInstallationJob + installations afterCreate both notify)`, 'orders (src/services/orders/orders.ts createInstallationJob) / installed (src/domain/extensions/installed.tsx afterCreate)');
    const salesTold = notesFor(karan()).some((n) => linkId(n) === S.installationId);
    note(salesTold, '10. Handover form issued', 'BR-26 / INS-04', 'Sales owner asked to fill the Sales-to-Service handover form', 'no notification to the sales owner linking the installation', 'orders (createInstallationJob)');
    rec({ step: '10. Dispatch → Delivered → Installation job', ref: '§3.1 r5 / INS-01/02/05 / BR-26', role: 'Import / SCM', expected: 'LR + e-way bill; POD; job auto-created; handover form issued', actual: `dispatch ${dsp.id}; installation ${S.installationId} (customer/product/site/division carried); coordinator notes +${meeraNew}; sales owner notified: ${salesTold}`, owner: 'orders / installed' });
    await snap('10-delivered');
  });

  it('11. Handover, site readiness, install, job card, customer sign-off → machine + warranty + PM (INS-03..07, §3.1 row 6)', async () => {
    let ins = byId('installations', S.installationId)!;
    // Sales owner fills the handover.
    let handoverBy = 'Sales Executive';
    try {
      ins = X(() => updateRecord(karan(), 'installations', S.installationId, { hoExpectations: 'Production of 4,000 m/day', hoCommitments: 'Free ICC profiles for 3 fabrics', hoKeyContacts: 'Mr Shah 98250 11122' }, ins.version as number)).record;
    } catch (e) {
      handoverBy = 'Coordinator (sales exec blocked)';
      note(false, '11. Handover form', 'INS-04 / BR-26', 'Sales owner can fill the handover form', `Sales Executive blocked: ${(e as Error).message}`, 'installed (permissions on installations)');
      ins = X(() => updateRecord(meera(), 'installations', S.installationId, { hoExpectations: 'Production of 4,000 m/day', hoCommitments: 'Free ICC profiles for 3 fabrics', hoKeyContacts: 'Mr Shah 98250 11122' }, ins.version as number)).record;
    }
    expect(ins.handoverAt).toBeTruthy();
    ins = X(() => updateRecord(meera(), 'installations', S.installationId, { engineerId: ravi().staffId, scheduledAt: `${addDays(todayKey(), 2)}T10:00` }, ins.version as number)).record;
    expect(notesFor(ravi()).some((n) => linkId(n) === S.installationId)).toBe(true);
    note(!!ins.siteAddressId, '11. Schedule installation', 'BR-02', 'Installation is scheduled only for an installation-site address with lat/lng', 'scheduled with no site address (pool-converted customer has no address; SO and installation both allow an empty site)', 'installed (installations beforeUpdate on engineerId/scheduledAt) + orders (createOrder: require site for machine orders)');
    shareReadinessChecklist(meera(), S.installationId);
    ins = byId('installations', S.installationId)!;
    ins = X(() => updateRecord(ravi(), 'installations', S.installationId, { rdPower: true, rdEarthing: true, rdUps: true, rdClimate: true, rdSpace: true, rdAir: true, rdNetwork: true }, ins.version as number)).record;
    ins = transitionRecord(ravi(), 'installations', S.installationId, 'site_ready', ins.version as number).record;
    expect(byId('salesOrders', S.orderId)!.status).toBe('installation');
    ins = transitionRecord(ravi(), 'installations', S.installationId, 'in_progress', ins.version as number).record;
    ins = X(() => updateRecord(ravi(), 'installations', S.installationId, { jcSteps: allSteps() }, ins.version as number)).record;
    ins = transitionRecord(ravi(), 'installations', S.installationId, 'trial_training', ins.version as number).record;
    ins = X(() => updateRecord(ravi(), 'installations', S.installationId, { trialResults: 'Nozzle check OK; 4 colour profile OK', trainingTopics: ['operation'], trainees: 'Ramesh, Sunil', serialNo: 'TX32-E2E-0001', printHeads: 8, printWidth: 3.2, softwareVersion: '5.2.1' }, ins.version as number)).record;
    const otp = startSignOffOtp(ravi(), S.installationId);
    const signed = signOffInstallation(ravi(), S.installationId, { method: 'otp', otp, signedOffBy: 'Laxmikant Shah' }, byId('installations', S.installationId)!.version as number);
    expect(signed.status).toBe('signed_off');
    const m = byId('machines', signed.machineId)!;
    S.machineId = m.id;
    S.serialNo = String(m.serialNo);
    const order = byId('salesOrders', S.orderId)!;
    expect(m).toMatchObject({ serialNo: 'TX32-E2E-0001', customerId: order.customerId, salesOrderId: S.orderId, installDate: todayKey(), purchaseDate: order.orderDate, printHeads: 8 });
    const w = R('warranties').find((x) => x.machineId === m.id)!;
    expect(w.startDate).toBe(todayKey());
    S.warrantyEnd = String(w.endDate);
    const pm = R('pmVisits').filter((p) => p.machineId === m.id);
    expect(pm.length).toBeGreaterThan(0);
    note(pm.length >= 2, '11. PM schedule', 'BR-28 / INS-07', '12-month warranty with 2 PM visits a year → 2 PM visits', `${pm.length} PM visit(s): ${pm.map((p) => p.dueDate).join(', ')} (warranty ends ${w.endDate}; the month-12 visit falls one day after the end)`, 'installed (src/services/installed/logic.ts generatePmVisits)');
    expect(order.status).toBe('completed');
    note(notesFor(karan()).some((n) => linkId(n) === m.id), '11. Sign-off', 'INS-07', 'Sales owner told installation is complete', 'no notification', 'installed');
    rec({ step: '11. Install + sign-off → installed base', ref: '§3.1 r6 / INS-03..07 / BR-27/28', role: 'Coordinator (Meera), Engineer (Ravi)', expected: 'Machine (serial, config, dates, SO ref), warranty from sign-off, PM schedule, SO Completed', actual: `machine ${m.id} ${S.serialNo}; warranty ${w.startDate}→${w.endDate}; PM visits ${pm.length}; SO ${order.status}; handover by ${handoverBy}`, owner: 'installed' });
    await snap('11-signedoff');
  });

  it('12. Time travel: warranty nearing expiry → reminders + renewal opportunity (§3.1 row 7, IB-05)', () => {
    const d0 = todayKey();
    const toWarrantyMinus90 = Math.round((new Date(addDays(S.warrantyEnd, -90)).getTime() - new Date(d0).getTime()) / 86_400_000);
    const people = [karan(), sanjay(), manoj(), meera()];
    const n0 = people.map((a) => listNotifications(a).length);
    shiftClock(admin(), toWarrantyMinus90);
    expect(todayKey()).toBe(addDays(S.warrantyEnd, -90));
    runRenewalSweep(admin());
    sweepService(admin());
    const renewalOpp = R('opportunities').find((o) => o.machineId === S.machineId && o.oppType === 'renewal');
    const warnNotes = people.flatMap((a, i) => listNotifications(a).slice(0, Math.max(0, listNotifications(a).length - n0[i]))).filter((n) => /warrant|renew|expir/i.test(String(n.title)) && (linkId(n) === S.machineId || String(n.title).includes(S.serialNo) || String(n.title).includes(String(byId('customers', byId('machines', S.machineId)!.customerId)?.name))));
    note(!!renewalOpp || warnNotes.length > 0, '12. Warranty nearing expiry', '§3.1 r7 / IB-05', 'Warranty 90 days from expiry → reminder to sales + service owners and a renewal (AMC) opportunity', 'nothing: the renewal sweep only looks at amcContracts, warranties are never reminded', 'installed (src/services/installed/logic.ts planRenewalSweep/runRenewalSweep)');
    shiftClock(admin(), 0);
    rec({ step: '12. Warranty −90 days', ref: '§3.1 r7', role: 'System (clock), Admin', expected: 'Reminder + renewal opportunity', actual: `renewal opp: ${renewalOpp?.id ?? 'none'}; machine-linked notes: ${warnNotes.map((n) => n.title).join(' / ')}`, owner: 'installed' });
  });

  it('13. AMC after warranty: 90/60/30 reminders + renewal opportunity (IB-04/05)', async () => {
    shiftClock(admin(), 0);
    const start = addDays(S.warrantyEnd, 1);
    const end = addDays(addMonths(start, 12), -1);
    const amc = X(() => createRecord(sanjay(), 'amcContracts', { customerId: byId('machines', S.machineId)!.customerId, machineId: S.machineId, contractType: 'amc', startDate: start, endDate: end, pmVisitsPerYear: 2, value: 180_000, billingFrequency: 'annual', ownerId: karan().staffId, serviceOwnerId: sanjay().staffId, status: 'active' }));
    S.amcId = amc.record.id;
    let earlyActivate = '';
    try {
      transitionRecord(sanjay(), 'amcContracts', S.amcId, 'active', byId('amcContracts', S.amcId)!.version as number);
    } catch (e) {
      earlyActivate = (e as Error).message;
    }
    const daysTo = (target: string) => Math.round((new Date(target).getTime() - new Date(todayKey()).getTime()) / 86_400_000);
    shiftClock(admin(), daysTo(start));
    runRenewalSweep(admin());
    const autoActive = byId('amcContracts', S.amcId)!.status === 'active';
    note(autoActive, '13. AMC sold in advance', 'IB-04', 'An AMC sold before warranty end becomes Active on its start date', `stays "${String(byId('amcContracts', S.amcId)!.status)}" — cannot be activated early ("${earlyActivate}") and no sweep activates it on the start date`, 'installed (runRenewalSweep / amcContracts lifecycle)');
    if (!autoActive) transitionRecord(sanjay(), 'amcContracts', S.amcId, 'active', byId('amcContracts', S.amcId)!.version as number);
    const amcPm = R('pmVisits').filter((p) => p.amcContractId === S.amcId).length;
    note(amcPm > 0, '13. AMC activated', 'IB-04 / SRV-11', 'Activating an AMC generates its PM visits (pmVisitsPerYear = 2)', `${amcPm} PM visits for the AMC`, 'installed (amcContracts afterTransition → generatePmVisits)');
    const days = (target: string) => Math.round((new Date(target).getTime() - new Date(todayKey()).getTime()) / 86_400_000);
    const seen: string[] = [];
    for (const left of [90, 60, 30]) {
      shiftClock(admin(), days(addDays(end, -left)));
      runRenewalSweep(admin());
      const c = byId('amcContracts', S.amcId)!;
      const k = notesFor(karan(), S.amcId).length;
      const s = notesFor(sanjay(), S.amcId).length;
      seen.push(`T-${left}: status ${c.status}, sent ${c.remindersSent}, notes sales ${k} / service ${s}`);
    }
    shiftClock(admin(), 0);
    console.info('AMC_SEEN', seen.join(' | '), JSON.stringify(byId('amcContracts', S.amcId)));
    const c = byId('amcContracts', S.amcId)!;
    expect(String(c.remindersSent)).toBe('90,60,30');
    expect(c.renewalOpportunityId).toBeTruthy();
    const opp = byId('opportunities', c.renewalOpportunityId)!;
    expect(opp).toMatchObject({ customerId: c.customerId, machineId: S.machineId, oppType: 'renewal', ownerId: karan().staffId });
    expect(notesFor(karan(), S.amcId).length).toBe(3);
    expect(notesFor(sanjay(), S.amcId).length).toBe(3);
    shiftClock(admin(), 0);
    rec({ step: '13. AMC renewal 90/60/30', ref: 'IB-05 / §3.1 r7', role: 'System (clock); Sales Exec + Service Manager', expected: 'Reminder at each threshold to both owners; renewal opportunity once', actual: `${seen.join(' | ')}; renewal opp ${opp.id}`, owner: 'installed' });
    await snap('13-amc');
  });

  it('14. Ticket via Customer Portal → warranty status auto-shown (SRV-01/02, IB-03, BR-29)', () => {
    const match = portalIdentify(S.serialNo)!;
    expect(match.customerId).toBe(byId('machines', S.machineId)!.customerId);
    const before = notesFor(meera()).length;
    const t = createTicketFromChannel({ customerId: match.customerId, contactId: match.contactId, machineId: S.machineId, description: 'Head strike and banding on the left side since morning', category: R('tickets').find((x) => x.category)?.category as string ?? 'other', priority: 'critical', channel: 'portal' });
    S.ticketId = t.id;
    expect(t.coverage).toBe('warranty');
    expect(t.divisionId).toBe('TX');
    expect(t.status).toBe('open');
    const desk = notesFor(meera()).length - before;
    expect(desk).toBeGreaterThan(0);
    expect(db().outbox.some((m) => m.related?.recordId === t.id)).toBe(true);
    rec({ step: '14. Portal ticket', ref: 'SRV-01/02 / BR-29', role: 'Customer (portal)', expected: 'Customer identified by serial; coverage Warranty; desk notified; acknowledgement', actual: `${t.id} coverage ${String(t.coverage)}; SLA resolution due ${String(t.resolutionDueAt)}; desk notes +${desk}`, owner: 'service' });
  });

  it('15. Assign engineer → My Jobs → accept, travel, check-in, work (SRV-05/06)', async () => {
    assignTicket(meera(), S.ticketId, ravi().staffId);
    expect(byId('tickets', S.ticketId)!.status).toBe('assigned');
    expect(notesFor(ravi()).some((n) => linkId(n) === S.ticketId)).toBe(true);
    expect(myJobs(ravi()).tickets.some((t) => t.id === S.ticketId)).toBe(true);
    let t = byId('tickets', S.ticketId)!;
    acceptJob(ravi(), S.ticketId, t.version as number);
    startTravel(ravi(), S.ticketId);
    checkIn(ravi(), S.ticketId, { lat: 21.17, lng: 72.83, mock: false });
    saveWork(ravi(), S.ticketId, { diagnosis: 'Damper leaking on head 3', workDone: '', partsUsed: '', photosBefore: 'before.jpg', photosAfter: '' });
    t = byId('tickets', S.ticketId)!;
    expect(t.status).toBe('in_progress');
    rec({ step: '15. Assign → My Jobs → on site', ref: 'SRV-05/06', role: 'Coordinator, Engineer', expected: 'Assigned; engineer notified; job in My Jobs; check-in sets arrival', actual: `status ${t.status}; arrivedAt ${String(t.arrivedAt)}`, owner: 'service' });
    await snap('15-onsite');
  });

  it('16. Spares requisition → approve → issue → receive → consume (SPR-03/04, BR-38)', () => {
    const part = R('spareParts').find((p) => p.status === 'active' && Number(p.stockMain) > 2 && p.warrantyApplicable !== false)!;
    const req = X(() => createRecord(ravi(), 'requisitions', { ticketId: S.ticketId, partId: part.id, qty: 1, urgency: 'urgent', reason: 'Damper replacement' })).record;
    S.reqId = req.id;
    expect(req).toMatchObject({ machineId: S.machineId, customerId: byId('tickets', S.ticketId)!.customerId, basis: 'warranty' });
    expect(byId('tickets', S.ticketId)!.status).toBe('waiting_parts');
    const a = pendingFor(req.id)!;
    const approver = approverFor(a, [sanjay(), manoj()])!;
    expect(approver).toBeTruthy();
    decideApproval(approver, a.id, 'approved', 'OK', a.version);
    let r = byId('requisitions', req.id)!;
    expect(r.status).toBe('approved');
    const store = A('u_prakash');
    issueRequisition(store, req.id, { issuedQty: 1, courier: 'DTDC', docketNo: 'D7781' }, r.version as number);
    r = byId('requisitions', req.id)!;
    transitionRecord(ravi(), 'requisitions', req.id, 'received', r.version as number);
    r = byId('requisitions', req.id)!;
    recordConsumption(ravi(), req.id, { consumedQty: 1, basis: 'warranty', defectiveReturned: true }, r.version as number);
    r = byId('requisitions', req.id)!;
    expect(r.status).toBe('consumed');
    const t = byId('tickets', S.ticketId)!;
    note(t.status === 'in_progress', '16. Spares consumed', 'SPR-03', 'Ticket returns to In Progress once parts arrive', `ticket status ${String(t.status)}`, 'spares (releaseTicketIfDone on receive/consume)');
    rec({ step: '16. Requisition → consume', ref: 'SPR-03/04 / BR-38', role: 'Engineer, Service Manager, Store In-charge', expected: 'Machine/customer/basis from ticket; Waiting for Parts; issue; consume as warranty', actual: `req ${req.id} ${r.status}; ticket ${t.status}`, owner: 'spares' });
  });

  it('17. Resolve with sign-off → job card + feedback link → customer confirms with low rating → Closed + escalation (SRV-08/12, BR-35, §3.1 row 8)', async () => {
    let t = byId('tickets', S.ticketId)!;
    if (t.status === 'waiting_parts') t = transitionRecord(meera(), 'tickets', S.ticketId, 'in_progress', t.version as number).record;
    saveWork(ravi(), S.ticketId, { diagnosis: 'Damper leaking on head 3', workDone: 'Replaced damper, head cleaning, nozzle check OK', partsUsed: 'Damper ×1', photosBefore: 'before.jpg', photosAfter: 'after.jpg' });
    const otp = requestSignOffOtp(S.ticketId);
    checkOut(ravi(), S.ticketId, { method: 'otp', otp, resolve: true });
    t = byId('tickets', S.ticketId)!;
    expect(t.status).toBe('customer_confirmation');
    const msgs = db().outbox.filter((m) => m.related?.recordId === S.ticketId).map((m) => m.templateId);
    expect(msgs).toContain('ticket.resolved'); // feedback link
    const head = notesFor(manoj()).length + notesFor(sanjay()).length;
    submitFeedback(String(t.feedbackToken), { rating: 2, comment: 'Took two days', resolved: true });
    t = byId('tickets', S.ticketId)!;
    expect(t.status).toBe('closed');
    const esc = notesFor(manoj()).length + notesFor(sanjay()).length - head;
    expect(esc).toBeGreaterThan(0);
    note(msgs.includes('ticket.jobcard'), '17. Job card', 'SRV-08', 'Job card sent by email/WhatsApp', `outbox templates: ${msgs.join(', ')}`, 'service (sendClosurePack — job card only when the contact has an email)');
    rec({ step: '17. Resolve → feedback → Closed', ref: '§3.1 r8 / SRV-08/12 / BR-35', role: 'Engineer, Customer (feedback link)', expected: 'Customer Confirmation; job card + feedback link; rating ≤ 2 alerts Service Manager; Closed', actual: `status ${t.status}; outbox ${msgs.join(', ')}; escalation notes +${esc}`, owner: 'service' });
    await snap('17-closed');
  });

  it("18. Engineer 'Opportunity Spotted' → lead with engineer as referrer (SRV-14, BR-37, §3.1 row 9)", async () => {
    const before = notesFor(karan()).length;
    let leadId = '';
    try {
      const t = opportunitySpotted(ravi(), S.ticketId, { interest: 'consumables', note: 'Customer buying ink from a local trader' });
      leadId = String(t.spottedLeadId);
    } catch (e) {
      note(false, '18. Opportunity Spotted', 'SRV-14', 'Engineer can flag an opportunity on a job (even after closure)', (e as Error).message, 'service');
      return;
    }
    const lead = byId('leads', leadId)!;
    expect(lead).toMatchObject({ customerId: byId('tickets', S.ticketId)!.customerId, sourceId: 'referral', referrerType: 'engineer', referrerEmployeeId: ravi().staffId, divisionId: 'TX' });
    expect(notesFor(karan()).length).toBeGreaterThan(before);
    S.spottedLeadId = leadId;
    rec({ step: "18. Engineer 'Opportunity Spotted'", ref: '§3.1 r9 / BR-37', role: 'Service Engineer (Ravi)', expected: 'Lead: source Referral, referrer = engineer; account owner notified', actual: `lead ${leadId} owner ${String(lead.ownerId)} product ${String(lead.productType)}`, owner: 'service' });
    await snap('18-spotted');
  });

  it('19. Consumables: leakage list and repeat-order data for this customer (CON-01/02/03, BR-39)', () => {
    const cust = byId('machines', S.machineId)!.customerId;
    const leak = leakageList(karan());
    const inLeak = leak.rows.some((r) => (r as unknown as Record<string, unknown>).customerId === cust || JSON.stringify(r).includes(String(cust)));
    expect(inLeak, 'new machine customer without consumables orders is on the leakage list').toBe(true);
    const cc = customerConsumables(karan(), String(cust));
    rec({ step: '19. Leakage + consumables', ref: 'CON-01/03 / BR-39', role: 'Sales Executive', expected: 'Machine customer with no ink orders appears on leakage list', actual: `leakage rows ${leak.rows.length}; customer listed: ${inLeak}; consumables view keys: ${Object.keys(cc ?? {}).join(',')}`, owner: 'spares' });
  });

  it('20. Dashboards move for each role (Appendix C) and audit trail covers each step (COM-09, BR-50)', () => {
    const diff = (who: string, a: Actor) => {
      const now = kpiMap(a);
      return Object.keys(now).filter((k) => now[k] !== dash0[who][k]).map((k) => `${k}: ${dash0[who][k]} → ${now[k]}`);
    };
    const dk = diff('karan', karan());
    const dr = diff('rohan', rohan());
    const dm = diff('manoj', manoj());
    const ds = diff('swati', swati());
    note(dk.some((x) => x.startsWith('Order Value')), '20. Sales dashboard', 'App. C / TGT-02', 'Sales Executive Order Value KPI rises by the new order', dk.join('; ') || 'no KPI changed', 'reports');
    note(dm.length > 0, '20. Service dashboard', 'App. C', 'Service Head KPIs move with the closed ticket (resolved, CSAT)', dm.join('; ') || 'no KPI changed', 'reports');
    rec({ step: '20a. Dashboards before → after', ref: 'App. C', role: 'Sales Exec / Sales Manager / Service Head / Accounts', expected: 'KPIs move for each role', actual: `Karan: ${dk.join('; ') || '—'} || Rohan: ${dr.join('; ') || '—'} || Manoj: ${dm.join('; ') || '—'} || Swati: ${ds.join('; ') || '—'}`, owner: 'reports' });
    const ids = [S.leadId, S.oppId, S.quoteId, S.orderId, S.installationId, S.machineId, S.amcId, S.ticketId, S.reqId, S.spottedLeadId].filter(Boolean);
    const missing = ids.filter((id) => auditFor(id).length === 0);
    note(missing.length === 0, '20. Audit trail', 'COM-09 / BR-50', 'Every record in the chain has audit entries', `no audit for: ${missing.join(', ')}`, 'core (src/services/ledger.ts appendAudit callers)');
    rec({ step: '20c. Audit trail', ref: 'COM-09 / BR-50', role: 'Admin', expected: 'Audit entries for every step', actual: ids.map((id) => `${id}:${auditFor(id).length}`).join(' '), owner: 'core' });
  });

  it.skipIf(!env.E2E_STRICT)('BRD carry-forward gaps (strict)', () => {
    for (const g of gaps) expect.soft(g, `${g.step} — ${g.expected}`).toBeUndefined();
  });
});
