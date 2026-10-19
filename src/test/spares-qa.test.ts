/** QA regression tests for BRD 4.9 / 4.10 defects (scratchpad QA report spares-consumables). */
import '../domain/extensions/spares';
import { actorFor, can } from '../services/authz';
import { commit, createDb, getDb, __setDb } from '../services/db';
import { createRecord, transitionRecord, updateRecord } from '../services/runtime';
import { customerConsumables, dealerOrderList } from '../services/spares/consumables';
import { engineerStockScope } from '../services/spares/stock';
import { issueRequisition, recordConsumption } from '../services/spares/requisitions';
import type { RecordData } from '../metadata/types';

const base = { workspaceId: 'tc', version: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', createdBy: 'system' };
const req = (id: string) => getDb().records.requisitions.find((x) => x.id === id)!;
const fieldErr = (fn: () => unknown, key: string) => {
  try {
    fn();
  } catch (e) {
    return ((e as { fieldErrors?: Record<string, string> }).fieldErrors ?? {})[key] ?? (e as Error).message;
  }
  throw new Error(`expected ${key} to fail`);
};

describe('spares requisition QA fixes (SPR-03/04/05, Appendix A)', () => {
  const ravi = () => actorFor('u_ravi', 'tc');
  const ajay = () => actorFor('u_ajay', 'tc');
  const sanjay = () => actorFor('u_sanjay', 'tc');
  const store = () => actorFor('u_prakash', 'tc');
  beforeEach(() => {
    __setDb(createDb(new Date('2026-10-19T10:00:00')));
    const part: RecordData = { ...base, id: 'SP-9001', partNo: 'TC-TEST-PH', description: 'Test print head', category: 'print_head', hsn: '84439990', price: 1000, uom: 'Nos', warrantyApplicable: true, returnable: false, stockMain: 5, minLevel: 1, critical: false, status: 'active' };
    const noWarranty: RecordData = { ...part, id: 'SP-9002', partNo: 'TC-TEST-NW', warrantyApplicable: false };
    commit((d) => {
      d.records.spareParts = [part, noWarranty, ...(d.records.spareParts ?? [])];
      d.records.tickets = [
        { ...base, id: 'TKT-R', status: 'in_progress', customerId: null, machineId: null, divisionId: 'TX', assigneeId: ravi().staffId },
        { ...base, id: 'TKT-A', status: 'in_progress', customerId: null, machineId: null, divisionId: 'TX', assigneeId: ajay().staffId },
        ...(d.records.tickets ?? []),
      ];
    });
  });

  it('rejects fractional quantities, other engineers’ tickets and raising for someone else', () => {
    expect(fieldErr(() => createRecord(ravi(), 'requisitions', { ticketId: 'TKT-R', partId: 'SP-9001', qty: 1.5 }), 'qty')).toMatch(/whole number/);
    expect(fieldErr(() => createRecord(ravi(), 'requisitions', { ticketId: 'TKT-A', partId: 'SP-9001', qty: 1 }), 'ticketId')).toMatch(/assigned to you/);
    expect(fieldErr(() => createRecord(ravi(), 'requisitions', { ticketId: 'TKT-R', partId: 'SP-9001', qty: 1, engineerId: ajay().staffId }), 'engineerId')).toMatch(/themselves/);
    expect(createRecord(ravi(), 'requisitions', { ticketId: 'TKT-R', partId: 'SP-9001', qty: 1 }).record.engineerId).toBe(ravi().staffId);
  });

  it('blocks self-approval, store edits of the request and store receipt acknowledgement', () => {
    const own = createRecord(sanjay(), 'requisitions', { ticketId: 'TKT-R', partId: 'SP-9001', qty: 1 }).record;
    expect(() => transitionRecord(sanjay(), 'requisitions', own.id, 'approved', own.version)).toThrow(/Separation of duties/);
    const r = createRecord(ravi(), 'requisitions', { ticketId: 'TKT-R', partId: 'SP-9001', qty: 2 }).record;
    expect(() => updateRecord(store(), 'requisitions', r.id, { qty: 5 }, r.version)).toThrow(/requester or service leadership/);
    transitionRecord(sanjay(), 'requisitions', r.id, 'approved', r.version);
    issueRequisition(store(), r.id, { issuedQty: 2, courier: 'Blue Dart', docketNo: 'BD1' }, req(r.id).version);
    expect(() => transitionRecord(store(), 'requisitions', r.id, 'received', req(r.id).version)).toThrow(/acknowledge receipt/);
    expect(() => updateRecord(sanjay(), 'requisitions', r.id, { engineerId: ajay().staffId }, req(r.id).version)).toThrow(/still Requested/);
    transitionRecord(ravi(), 'requisitions', r.id, 'received', req(r.id).version);
    recordConsumption(ravi(), r.id, { consumedQty: 1, basis: 'warranty', defectiveReturned: false }, req(r.id).version);
    expect(getDb().records.spareParts.find((p) => p.id === 'SP-9001')!.stockMain).toBe(4); // 5 − 2 issued + 1 unused back
    // Terminal: locked for everyone, including the administrator.
    expect(() => updateRecord(actorFor('u_rahul', 'tc'), 'requisitions', r.id, { urgency: 'urgent' }, req(r.id).version)).toThrow(/can no longer be changed/);
  });

  it('warranty claims (OEM) need a warranty consumption, once, within the consumed quantity', () => {
    const r = createRecord(ravi(), 'requisitions', { ticketId: 'TKT-R', partId: 'SP-9001', qty: 2 }).record;
    const claim = { partId: 'SP-9001', requisitionId: r.id, oem: 'epson', raisedOn: '2026-10-18', qty: 1 };
    expect(fieldErr(() => createRecord(store(), 'warrantyClaims', claim), 'requisitionId')).toMatch(/consumed under warranty/);
    transitionRecord(sanjay(), 'requisitions', r.id, 'approved', r.version);
    issueRequisition(store(), r.id, { issuedQty: 2, courier: 'Blue Dart', docketNo: 'BD1' }, req(r.id).version);
    transitionRecord(ravi(), 'requisitions', r.id, 'received', req(r.id).version);
    recordConsumption(ravi(), r.id, { consumedQty: 1, basis: 'warranty', defectiveReturned: false }, req(r.id).version);
    expect(fieldErr(() => createRecord(store(), 'warrantyClaims', { ...claim, qty: 2 }), 'qty')).toMatch(/more than the 1 consumed/);
    expect(createRecord(store(), 'warrantyClaims', claim).record.status).toBe('raised');
    expect(fieldErr(() => createRecord(store(), 'warrantyClaims', claim), 'requisitionId')).toMatch(/already exists/);
    expect(fieldErr(() => createRecord(store(), 'warrantyClaims', { ...claim, requisitionId: null, partId: 'SP-9002' }), 'partId')).toMatch(/not covered by warranty/);
  });

  it('spare part master trims description and upper-cases part numbers on edit', () => {
    const admin = actorFor('u_rahul', 'tc');
    expect(fieldErr(() => createRecord(admin, 'spareParts', { partNo: 'NEW-1', description: '   ', category: 'pump', hsn: '84439990', price: 10 }), 'description')).toMatch(/required/);
    const p = getDb().records.spareParts.find((x) => x.id === 'SP-9002')!;
    expect(updateRecord(admin, 'spareParts', p.id, { partNo: ' tc-new-9 ' }, p.version).record.partNo).toBe('TC-NEW-9');
  });
});

describe('consumables QA fixes (CON-01/02/05/06, BR-41)', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  it('rate contracts: consumables products only, rate above zero', () => {
    const admin = actorFor('u_rahul', 'tc');
    const d = getDb();
    const cust = d.records.customers[0];
    const machine = d.records.products.find((p) => p.productType === 'machine')!;
    const ink = d.records.products.find((p) => p.productType === 'ink')!;
    expect(fieldErr(() => createRecord(admin, 'rateContracts', { customerId: cust.id, productId: machine.id, rate: 10, validFrom: '2030-10-01', validTo: '2030-12-01' }), 'productId')).toMatch(/ink, paper/);
    expect(fieldErr(() => createRecord(admin, 'rateContracts', { customerId: cust.id, productId: ink.id, rate: 0, validFrom: '2030-10-01', validTo: '2030-12-01' }), 'rate')).toMatch(/above zero/);
  });

  it('sample / trial dispatch: trial not before dispatch, consumables products only', () => {
    const admin = actorFor('u_rahul', 'tc');
    const d = getDb();
    const cust = d.records.customers[0];
    const machine = d.records.products.find((p) => p.productType === 'machine')!;
    const ink = d.records.products.find((p) => p.productType === 'ink')!;
    expect(fieldErr(() => createRecord(admin, 'sampleDispatches', { customerId: cust.id, productId: ink.id, qty: 1, dispatchedOn: '2026-10-10', trialDate: '2026-10-01' }), 'trialDate')).toMatch(/before the dispatch/);
    expect(fieldErr(() => createRecord(admin, 'sampleDispatches', { customerId: cust.id, productId: machine.id, qty: 1 }), 'productId')).toMatch(/ink, paper or fabric/);
  });

  it('dealer orders: dealer must be in scope, consumables products only', () => {
    const karan = actorFor('u_karan', 'tc');
    const d = getDb();
    const ink = d.records.products.find((p) => p.productType === 'ink' && p.status !== 'inactive')!;
    const machine = d.records.products.find((p) => p.productType === 'machine')!;
    const foreign = d.records.customers.find((c) => ['dealer', 'distributor'].includes(String(c.category)) && c.ownerId !== karan.staffId)!;
    expect(dealerOrderList(karan).dealers.some((x) => x.value === foreign.id)).toBe(false);
    expect(fieldErr(() => createRecord(karan, 'dealerOrders', { dealerId: foreign.id, endCustomer: 'Shree Prints', productId: ink.id, qty: 1, rate: 10, orderDate: '2026-10-10' }), 'dealerId')).toMatch(/in your scope/);
    const admin = actorFor('u_rahul', 'tc');
    expect(fieldErr(() => createRecord(admin, 'dealerOrders', { dealerId: foreign.id, endCustomer: 'Shree Prints', productId: machine.id, qty: 1, rate: 10, orderDate: '2026-10-10' }), 'productId')).toMatch(/ink, paper/);
  });

  it('Customer 360 Consumables tab data and Engineer Stock follow the role', () => {
    const cust = getDb().records.customers[0];
    expect(() => customerConsumables(actorFor('u_ravi', 'tc'), cust.id)).toThrow(/cannot view consumables/);
    expect(customerConsumables(actorFor('u_rahul', 'tc'), cust.id).orderCount).toBeGreaterThanOrEqual(0);
    expect(engineerStockScope(actorFor('u_karan', 'tc'))).toBe('none');
    expect(can(actorFor('u_karan', 'tc'), 'spares.engineerStock')).toBe(false);
    expect(engineerStockScope(actorFor('u_ravi', 'tc'))).toBe('own');
    expect(engineerStockScope(actorFor('u_prakash', 'tc'))).toBe('all');
  });
});
