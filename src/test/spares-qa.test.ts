import '../domain/extensions/spares';
import { actorFor, canReadRecord } from '../services/authz';
import { commit, createDb, getDb, __setDb } from '../services/db';
import { getResource } from '../services/registry';
import { createRecord, transitionRecord, updateRecord } from '../services/runtime';
import { customerConsumables } from '../services/spares/consumables';
import { issueRequisition, recordConsumption } from '../services/spares/requisitions';
import type { RecordData } from '../metadata/types';

const base = { workspaceId: 'tc', version: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', createdBy: 'system' };
const probe = (name: string, fn: () => unknown) => {
  try {
    const r = fn();
    console.log('PROBE', name, 'OK', JSON.stringify(r)?.slice(0, 160));
  } catch (e) {
    console.log('PROBE', name, 'THREW', (e as Error).message, JSON.stringify((e as { fieldErrors?: unknown }).fieldErrors ?? ''));
  }
};

describe('probe', () => {
  it('probes', () => {
    __setDb(createDb(new Date('2026-10-19T10:00:00')));
    const ravi = actorFor('u_ravi', 'tc');
    const ajay = actorFor('u_ajay', 'tc');
    const sanjay = actorFor('u_sanjay', 'tc');
    const store = actorFor('u_prakash', 'tc');
    const part: RecordData = { ...base, id: 'SP-9001', partNo: 'TC-TEST-PH', description: 'Test print head', category: 'print_head', hsn: '84439990', price: 100000, uom: 'Nos', warrantyApplicable: false, returnable: true, stockMain: 3, minLevel: 2, critical: true, status: 'active' };
    commit((d) => {
    d.records.spareParts = [part, ...(d.records.spareParts ?? [])];
    d.records.tickets = [
      { ...base, id: 'TKT-R', status: 'in_progress', customerId: null, machineId: null, divisionId: 'TX', assigneeId: ravi.staffId },
      { ...base, id: 'TKT-A', status: 'in_progress', customerId: null, machineId: null, divisionId: 'TX', assigneeId: ajay.staffId },
      ...(d.records.tickets ?? []),
    ];
    });
    const tres = getResource('tickets');
    console.log('ravi reads TKT-A', canReadRecord(ravi, tres, getDb().records.tickets[1]));
    probe('qty 0', () => createRecord(ravi, 'requisitions', { ticketId: 'TKT-R', partId: 'SP-9001', qty: 0 }).record.id);
    probe('qty 1.5', () => createRecord(ravi, 'requisitions', { ticketId: 'TKT-R', partId: 'SP-9001', qty: 1.5 }).record.id);
    probe('qty 51', () => createRecord(ravi, 'requisitions', { ticketId: 'TKT-R', partId: 'SP-9001', qty: 51 }).record.id);
    probe('ravi on ajay ticket', () => createRecord(ravi, 'requisitions', { ticketId: 'TKT-A', partId: 'SP-9001', qty: 1 }).record.id);
    probe('ravi engineerId=ajay', () => createRecord(ravi, 'requisitions', { ticketId: 'TKT-R', partId: 'SP-9001', qty: 1, engineerId: ajay.staffId }).record.engineerId);
    probe('store create', () => createRecord(store, 'requisitions', { ticketId: 'TKT-R', partId: 'SP-9001', qty: 1 }).record.id);
    // service head raises & self-approves
    const own = createRecord(sanjay, 'requisitions', { ticketId: 'TKT-R', partId: 'SP-9001', qty: 1 }).record;
    probe('sanjay self-approve via transition', () => transitionRecord(sanjay, 'requisitions', own.id, 'approved', own.version).record.status);
    const r = createRecord(ravi, 'requisitions', { ticketId: 'TKT-R', partId: 'SP-9001', qty: 2 }).record;
    probe('store approve', () => transitionRecord(store, 'requisitions', r.id, 'approved', r.version).record.status);
    probe('ravi skip to received', () => transitionRecord(ravi, 'requisitions', r.id, 'received', r.version).record.status);
    probe('store edit qty while requested', () => updateRecord(store, 'requisitions', r.id, { qty: 5 }, r.version).record.qty);
    let cur = getDb().records.requisitions.find((x) => x.id === r.id)!;
    transitionRecord(sanjay, 'requisitions', r.id, 'approved', cur.version);
    cur = getDb().records.requisitions.find((x) => x.id === r.id)!;
    probe('edit qty after approval', () => updateRecord(ravi, 'requisitions', r.id, { qty: 1 }, cur.version));
    probe('issue courier whitespace', () => issueRequisition(store, r.id, { issuedQty: 1, courier: '  ', docketNo: 'x' }, cur.version));
    probe('issue qty 0', () => issueRequisition(store, r.id, { issuedQty: 0, courier: 'BD', docketNo: 'x' }, cur.version));
    probe('issue qty -1', () => issueRequisition(store, r.id, { issuedQty: -1, courier: 'BD', docketNo: 'x' }, cur.version));
    const issued = issueRequisition(store, r.id, { issuedQty: 2.7, courier: 'BD', docketNo: 'D1' }, cur.version);
    console.log('issuedQty', issued.issuedQty);
    probe('issue again stale', () => issueRequisition(store, r.id, { issuedQty: 1, courier: 'BD', docketNo: 'D1' }, cur.version));
    probe('store ack receipt', () => transitionRecord(store, 'requisitions', r.id, 'received', issued.version).record.status);
    cur = getDb().records.requisitions.find((x) => x.id === r.id)!;
    probe('consume warranty on non-warranty part', () => recordConsumption(ravi, r.id, { consumedQty: 1, basis: 'warranty', defectiveReturned: false }, cur.version));
    probe('consume 3 > issued 2', () => recordConsumption(ravi, r.id, { consumedQty: 3, basis: 'chargeable', defectiveReturned: false }, cur.version));
    probe('ajay consume ravi req', () => recordConsumption(ajay, r.id, { consumedQty: 1, basis: 'chargeable', defectiveReturned: false }, cur.version));
    console.log('stock', getDb().records.spareParts.find((p) => p.id === 'SP-9001')!.stockMain);
    // warranty claims via form
    probe('claim form for non-consumed req', () => createRecord(store, 'warrantyClaims', { partId: 'SP-9001', requisitionId: r.id, oem: 'epson', raisedOn: '2026-10-18', qty: 1 }).record.id);
    probe('claim future raisedOn', () => createRecord(store, 'warrantyClaims', { partId: 'SP-9001', oem: 'epson', raisedOn: '2026-12-18', qty: 1 }).record.id);
    // spare parts
    const admin = actorFor('u_rahul', 'tc');
    probe('part desc whitespace', () => createRecord(admin, 'spareParts', { partNo: 'NEW-1', description: '   ', category: 'pump', hsn: '84439990', price: 10 }).record.id);
    probe('part dup lowercase', () => createRecord(admin, 'spareParts', { partNo: 'tc-test-ph', description: 'x', category: 'pump', hsn: '84439990', price: 10 }).record.id);
    probe('part bad hsn', () => createRecord(admin, 'spareParts', { partNo: 'NEW-2', description: 'x', category: 'pump', hsn: '12', price: 10 }).record.id);
    const other = getDb().records.spareParts.find((p) => p.id !== 'SP-9001')!;
    probe('part update dup lowercase', () => updateRecord(admin, 'spareParts', other.id, { partNo: 'tc-test-ph' }, other.version).record.partNo);
    probe('store edit price', () => updateRecord(store, 'spareParts', 'SP-9001', { price: 1 }, 1));
    probe('scm edit minLevel', () => updateRecord(actorFor('u_rajesh', 'tc'), 'spareParts', 'SP-9001', { minLevel: 5 }, getDb().records.spareParts.find((p) => p.id === 'SP-9001')!.version).record.minLevel);
    // rate contracts
    const cust = getDb().records.customers[0];
    const machineProduct = getDb().records.products.find((p) => p.productType === 'machine');
    const ink = getDb().records.products.find((p) => p.productType === 'ink')!;
    probe('rc machine product', () => createRecord(admin, 'rateContracts', { customerId: cust.id, productId: machineProduct?.id, rate: 10, validFrom: '2026-10-01', validTo: '2026-12-01' }).record.id);
    probe('rc rate 0', () => createRecord(admin, 'rateContracts', { customerId: cust.id, productId: ink.id, rate: 0, validFrom: '2030-10-01', validTo: '2030-12-01' }).record.id);
    probe('rc to<from', () => createRecord(admin, 'rateContracts', { customerId: cust.id, productId: ink.id, rate: 10, validFrom: '2031-10-01', validTo: '2031-09-01' }).record.id);
    // sample
    probe('sd trial before dispatch', () => createRecord(admin, 'sampleDispatches', { customerId: cust.id, productId: ink.id, qty: 1, dispatchedOn: '2026-10-10', trialDate: '2026-10-01' }).record.id);
    probe('sd machine product', () => createRecord(admin, 'sampleDispatches', { customerId: cust.id, productId: machineProduct?.id, qty: 1 }).record.id);
    // dealer orders as sales exec
    const karan = actorFor('u_karan', 'tc');
    const dealer = getDb().records.customers.find((c) => ['dealer', 'distributor'].includes(String(c.category)) && c.ownerId !== karan.staffId)!;
    probe('karan dealer order other owner', () => {
      const x = createRecord(karan, 'dealerOrders', { dealerId: dealer.id, endCustomer: 'Shree Prints', productId: ink.id, qty: 1, rate: 10, orderDate: '2026-10-10' }).record;
      return { id: x.id, owner: x.ownerId, karan: karan.staffId, dealerOwner: dealer.ownerId };
    });
    probe('dealer machine product', () => createRecord(admin, 'dealerOrders', { dealerId: dealer.id, endCustomer: 'Shree Prints', productId: machineProduct?.id, qty: 1, rate: 10, orderDate: '2026-10-10' }).record.id);
    probe('dealer endCustomer whitespace', () => createRecord(admin, 'dealerOrders', { dealerId: dealer.id, endCustomer: '   ', productId: ink.id, qty: 1, rate: 10, orderDate: '2026-10-10' }).record.id);
    // customer consumables leak
    probe('engineer customerConsumables', () => Object.keys(customerConsumables(ravi, cust.id)));
    probe('store customerConsumables', () => customerConsumables(store, cust.id).orderCount);
  });
});
