import '../domain/extensions/spares';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { createRecord, transitionRecord } from '../services/runtime';
import { dealerOrderList, predictReorder, repeatOrderList } from '../services/spares/consumables';
import { engineerStock, mainStoreStock } from '../services/spares/stock';
import { minimumLevelAlerts } from '../services/spares/requisitions';
import { issueRequisition, raiseClaimFromRequisition, recordConsumption, rejectRequisition, returnRequisition } from '../services/spares/requisitions';
import { decideApproval, pendingApprovalFor } from '../services/workflow';
import type { RecordData } from '../metadata/types';

const base = { workspaceId: 'tc', version: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', createdBy: 'system' };

describe('reorder prediction (BR-40)', () => {
  it('averages the last three intervals and classifies due / missed / upcoming', () => {
    expect(predictReorder(['2026-09-01'], '2026-10-19')).toBeNull();
    const p = predictReorder(['2026-06-01', '2026-07-01', '2026-07-31', '2026-08-30'], '2026-10-19', 7)!;
    expect(p.avgIntervalDays).toBe(30);
    expect(p.dueDate).toBe('2026-09-29');
    expect(p.state).toBe('missed');
    expect(predictReorder(['2026-09-01', '2026-10-01'], '2026-10-26', 7)!.state).toBe('due');
    expect(predictReorder(['2026-09-20', '2026-10-15'], '2026-10-19', 7)!.state).toBe('upcoming');
  });
});

describe('requisition workflow (SPR-03/04, BR-38)', () => {
  let part: RecordData;
  beforeEach(() => {
    __setDb(createDb(new Date('2026-10-19T10:00:00')));
    const d = getDb();
    part = { ...base, id: 'SP-9001', partNo: 'TC-TEST-PH', description: 'Test print head', category: 'print_head', hsn: '84439990', price: 100000, uom: 'Nos', warrantyApplicable: true, returnable: true, stockMain: 3, minLevel: 2, critical: true, status: 'active' };
    d.records.spareParts = [part, ...(d.records.spareParts ?? [])];
    d.records.tickets = [{ ...base, id: 'TKT-TEST-1', status: 'in_progress', customerId: null, machineId: null, divisionId: 'TX', assigneeId: actorFor('u_ravi', 'tc').staffId }, ...(d.records.tickets ?? [])];
  });

  it('runs request → approval → issue → receive → consume → OEM claim', () => {
    const ravi = actorFor('u_ravi', 'tc');
    const created = createRecord(ravi, 'requisitions', { ticketId: 'TKT-TEST-1', partId: 'SP-9001', qty: 2, urgency: 'urgent' }).record;
    expect(created.status).toBe('requested');
    expect(created.basis).toBe('chargeable'); // no machine → no coverage
    const apr = pendingApprovalFor(created.id, 'spares.requisition')!;
    expect(apr).toBeTruthy();
    decideApproval(actorFor('u_sanjay', 'tc'), apr.id, 'approved', '', apr.version);
    let r = getDb().records.requisitions.find((x) => x.id === created.id)!;
    expect(r.status).toBe('approved');

    const store = actorFor('u_prakash', 'tc');
    expect(() => issueRequisition(store, r.id, { issuedQty: 3, courier: 'Blue Dart', docketNo: 'BD1' }, r.version)).toThrow(/more than/);
    issueRequisition(store, r.id, { issuedQty: 2, courier: 'Blue Dart', docketNo: 'BD123' }, r.version);
    expect(getDb().records.spareParts.find((p) => p.id === 'SP-9001')!.stockMain).toBe(1);
    expect(getDb().notifications.some((n) => /Below minimum: TC-TEST-PH/.test(n.title))).toBe(true);

    r = getDb().records.requisitions.find((x) => x.id === created.id)!;
    transitionRecord(ravi, 'requisitions', r.id, 'received', r.version);
    r = getDb().records.requisitions.find((x) => x.id === created.id)!;
    expect(r.receivedAt).toBeTruthy();
    recordConsumption(ravi, r.id, { consumedQty: 1, basis: 'warranty', defectiveReturned: true }, r.version);
    r = getDb().records.requisitions.find((x) => x.id === created.id)!;
    expect(r.status).toBe('consumed');
    expect(r.defectiveReturn).toBe('received');
    expect(getDb().records.spareParts.find((p) => p.id === 'SP-9001')!.stockMain).toBe(2); // 1 unused back to store

    const claim = raiseClaimFromRequisition(store, r.id, 'epson');
    expect(claim.status).toBe('raised');
    expect(() => raiseClaimFromRequisition(store, r.id, 'epson')).toThrow(/already exists/);
  });

  it('enforces separation of duties, permissions and states', () => {
    const ravi = actorFor('u_ravi', 'tc');
    const r = createRecord(ravi, 'requisitions', { ticketId: 'TKT-TEST-1', partId: 'SP-9001', qty: 1 }).record;
    expect(() => rejectRequisition(ravi, r.id, 'not needed', r.version)).toThrow(/service leadership/);
    expect(() => issueRequisition(ravi, r.id, { issuedQty: 1, courier: 'x', docketNo: 'y' }, r.version)).toThrow(/store/);
    expect(() => returnRequisition(ravi, r.id, 'unused', r.version)).toThrow(/received/);
    rejectRequisition(actorFor('u_sanjay', 'tc'), r.id, 'Use the spare from stock van', r.version);
    expect(getDb().records.requisitions.find((x) => x.id === r.id)!.status).toBe('rejected');
    expect(pendingApprovalFor(r.id, 'spares.requisition')).toBeUndefined();
  });
});

describe('rate contracts (BR-41)', () => {
  it('rejects overlapping contracts for the same customer and product', () => {
    __setDb(createDb(new Date('2026-10-19T10:00:00')));
    const d = getDb();
    d.records.customers = [{ ...base, id: 'C-TEST', name: 'Test Prints', ownerId: 'E-1001', divisionIds: ['INK'], status: 'active' }, ...(d.records.customers ?? [])];
    d.records.products = [{ ...base, id: 'PRD-TEST', name: 'Test ink 1 L', productType: 'ink', divisionId: 'INK', status: 'active' }, ...(d.records.products ?? [])];
    d.records.rateContracts = [];
    const admin = actorFor('u_rahul', 'tc');
    const first = createRecord(admin, 'rateContracts', { customerId: 'C-TEST', productId: 'PRD-TEST', rate: 900, validFrom: '2026-10-01', validTo: '2027-03-31', status: 'active' }).record;
    expect(first.divisionId).toBe('INK');
    expect(() => createRecord(admin, 'rateContracts', { customerId: 'C-TEST', productId: 'PRD-TEST', rate: 880, validFrom: '2027-03-01', validTo: '2027-09-30', status: 'active' })).toThrow(/highlighted|Overlaps/);
    expect(createRecord(admin, 'rateContracts', { customerId: 'C-TEST', productId: 'PRD-TEST', rate: 880, validFrom: '2027-04-01', validTo: '2027-09-30', status: 'active' }).record.id).toBeTruthy();
  });
});

describe('stock pages (SPR-02, 4.9 engineer stock, SPR-06)', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  it('main store stock: on hand, in transit and value; store only', () => {
    const store = actorFor('u_prakash', 'tc');
    const out = mainStoreStock(store);
    expect(out.rows.length).toBeGreaterThan(20);
    const transit = getDb().records.requisitions.filter((r) => r.status === 'issued').reduce((s, r) => s + Number(r.issuedQty ?? r.qty), 0);
    expect(out.rows.reduce((s, r) => s + r.inTransit, 0)).toBe(transit);
    expect(out.below).toBe(out.rows.filter((r) => r.stockMain < r.minLevel).length);
    expect(out.rows.every((r) => r.value === r.stockMain * r.price)).toBe(true);
    expect(minimumLevelAlerts(store).below.length).toBe(out.below);
    expect(() => mainStoreStock(actorFor('u_karan', 'tc'))).toThrow(/cannot view spare part stock/);
  });

  it('engineer stock: leadership sees all, engineers only their own', () => {
    const all = engineerStock(actorFor('u_sanjay', 'tc'));
    expect(all.scope).toBe('all');
    expect(all.engineers.length).toBeGreaterThan(1);
    const reqs = getDb().records.requisitions;
    const inHand = reqs.filter((r) => r.status === 'received').reduce((s, r) => s + Number(r.issuedQty ?? r.qty), 0);
    expect(all.engineers.reduce((s, e) => s + e.inHand, 0)).toBe(inHand);
    for (const e of all.engineers) expect(e.issued).toBe(e.inTransit + e.received);

    const ravi = actorFor('u_ravi', 'tc');
    const own = engineerStock(ravi);
    expect(own.scope).toBe('own');
    expect(own.engineers.map((e) => e.engineerId)).toEqual([ravi.staffId]);
    expect(own.parts.reduce((s, p) => s + p.issued, 0)).toBe(own.engineers[0].issued);
    const other = all.engineers.find((e) => e.engineerId !== ravi.staffId)!;
    expect(() => engineerStock(ravi, other.engineerId)).toThrow(/only see your own/);
    expect(() => engineerStock(actorFor('u_karan', 'tc'))).toThrow(/cannot view engineer stock/);
  });
});

describe('consumables pages (CON-02, CON-06)', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  it('repeat orders list previous consumables orders with one latest per customer', () => {
    const out = repeatOrderList(actorFor('u_rahul', 'tc'));
    expect(out.rows.length).toBeGreaterThan(0);
    const latest = out.rows.filter((r) => r.latest);
    expect(new Set(latest.map((r) => r.customerId)).size).toBe(latest.length);
    expect(out.canRepeat).toBe(true);
  });

  it('dealer orders: seeded, scoped, validated', () => {
    const admin = actorFor('u_rahul', 'tc');
    const list = dealerOrderList(admin);
    expect(list.rows.length).toBeGreaterThan(10);
    expect(list.dealers.length).toBeGreaterThan(0);
    const d = getDb();
    const dealer = d.records.customers.find((c) => c.id === list.dealers[0].value)!;
    const notDealer = d.records.customers.find((c) => c.category === 'active')!;
    const product = d.records.products.find((p) => p.productType === 'ink' && p.status !== 'inactive')!;
    const input = { dealerId: dealer.id, endCustomer: 'Shree Ram Prints', productId: product.id, qty: 10, rate: 1200, orderDate: '2026-10-10', status: 'booked', invoiceNo: 'tst/1' };
    const created = createRecord(admin, 'dealerOrders', input).record;
    expect(created.invoiceNo).toBe('TST/1');
    expect(created.ownerId).toBe(dealer.ownerId);
    expect(() => createRecord(admin, 'dealerOrders', { ...input, invoiceNo: 'TST/1' })).toThrow(/already recorded|highlighted/);
    expect(() => createRecord(admin, 'dealerOrders', { ...input, invoiceNo: '', dealerId: notDealer.id })).toThrow(/Dealer or Distributor|highlighted/);
    expect(() => createRecord(admin, 'dealerOrders', { ...input, invoiceNo: '', orderDate: '2026-12-01' })).toThrow();
    expect(() => dealerOrderList(actorFor('u_ravi', 'tc'))).toThrow();
  });
});
