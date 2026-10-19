import '../domain/extensions/index';
import { gstinCheckDigit } from '../lib/validators';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { createRecord, getRecord, queryRecords, updateRecord } from '../services/runtime';
import { mergeCustomers, transferOwnership, convertContactToLead, previewTransfer, syncFromErp } from '../services/customers/operations';
import { customer360 } from '../services/customers/view360';
import { listPoolContacts } from '../services/customers/pool';
import { rowsFromCsv, importRows } from '../services/customers/importContacts';

const admin = () => actorFor('u_rahul', 'tc');
const tryIt = (fn: () => unknown) => {
  try {
    const r = fn();
    const rec = (r as { record?: { id: string } })?.record;
    return { ok: true, r: rec ? rec.id : r };
  } catch (e) {
    return { ok: false, e: (e as Error).message, fe: (e as { fieldErrors?: unknown }).fieldErrors };
  }
};

describe('QA probe', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));
  it('probe', () => {
    const out: Record<string, unknown> = {};
    const base = { name: 'Probe Prints', category: 'prospect', divisionIds: ['TX'], territoryId: 'surat', billingState: '24', ownerId: 'E-1011' };
    out.wsName = tryIt(() => createRecord(admin(), 'customers', { ...base, name: '   ' }));
    out.badPan = tryIt(() => createRecord(admin(), 'customers', { ...base, pan: 'abcde1234' }));
    out.lowerPan = tryIt(() => (createRecord(admin(), 'customers', { ...base, name: 'Lower Pan', pan: 'abcde1234f' }) as { record: { pan: unknown } }).record.pan);
    const g = '24AAPFU0939F1Z' + gstinCheckDigit('24AAPFU0939F1Z');
    out.lowerGst = tryIt(() => (createRecord(admin(), 'customers', { ...base, name: 'Lower Gst', gstin: g.toLowerCase() }) as { record: { gstin: unknown } }).record.gstin);
    out.gstPanMismatch = tryIt(() => createRecord(admin(), 'customers', { ...base, name: 'Mismatch', gstin: '24AAPFU0939F1Z' + gstinCheckDigit('24AAPFU0939F1Z'), pan: 'ABCDE1234F' }));
    out.badWebsite = tryIt(() => createRecord(admin(), 'customers', { ...base, name: 'Web', website: 'foo' }));
    out.erpWrite = tryIt(() => (createRecord(admin(), 'customers', { ...base, name: 'Erp write', creditLimit: 5 }) as { record: { creditLimit: unknown } }).record.creditLimit);
    out.fuzzyCreate = tryIt(() => (createRecord(admin(), 'customers', { ...base, name: 'Om Sai Digital Prints Private Limited' }) as { record: { id: unknown } }).record.id);
    // past plan review on edit of an unrelated field
    const key = getDb().records.customers.find((c) => c.keyAccount && String(c.planNextReview) < '2026-10-19');
    out.keyPast = key?.id;
    if (key) out.editKeyPast = tryIt(() => updateRecord(admin(), 'customers', key.id, { ...key, name: key.name + ' X' }, key.version));
    // dealer pointing to a non-dealer
    const nonDealer = getDb().records.customers.find((c) => c.category === 'prospect')!;
    out.dealerNonDealer = tryIt(() => createRecord(admin(), 'customers', { ...base, name: 'Dealer test', dealerId: nonDealer.id }));
    // sales exec scope
    const karan = actorFor('u_karan', 'tc');
    const other = getDb().records.customers.find((c) => c.ownerId !== karan.staffId)!;
    out.execRead = tryIt(() => getRecord(karan, 'customers', other.id));
    out.exec360 = tryIt(() => customer360(karan, other.id));
    const otherSite = getDb().records.addresses.find((a) => a.customerId === other.id)!;
    out.execEditOtherSite = tryIt(() => updateRecord(karan, 'addresses', otherSite.id, { label: 'hijack' }, otherSite.version));
    out.execSitesVisible = queryRecords(karan, 'addresses').rows.length + '/' + getDb().records.addresses.length;
    out.execContactOnOther = tryIt(() => createRecord(karan, 'contacts', { name: 'Leak', mobile: '9811177777', customerId: other.id }));
    out.execCreateCustomerOtherOwner = tryIt(() => (createRecord(karan, 'customers', { ...base, name: 'Owner leak', ownerId: 'E-1001' }) as { record: { ownerId: unknown } }).record.ownerId);
    out.execAddrOnOther = tryIt(() => createRecord(karan, 'addresses', { customerId: other.id, label: 'X', addressType: 'billing', line1: 'a', city: 'Surat', state: '24', pincode: '395003' }));
    // store / engineer
    out.storeRead = tryIt(() => queryRecords(actorFor('u_prakash', 'tc'), 'customers').rows.length);
    out.engRead = tryIt(() => queryRecords(actorFor('u_ravi', 'tc'), 'customers').rows.length);
    out.engUpdate = tryIt(() => updateRecord(actorFor('u_ravi', 'tc'), 'customers', other.id, { name: 'x' }, other.version));
    out.mgmtUpdate = tryIt(() => updateRecord(actorFor('u_vikram', 'tc'), 'customers', other.id, { name: 'x' }, other.version));
    out.accountsErp = tryIt(() => syncFromErp(actorFor('u_swati', 'tc'), other.id));
    out.execErpOther = tryIt(() => syncFromErp(karan, other.id));
    // pincode / lat
    out.badPin = tryIt(() => createRecord(admin(), 'addresses', { customerId: other.id, label: 'X', addressType: 'billing', line1: 'a', city: 'Surat', state: '24', pincode: '012345' }));
    out.latOnly = tryIt(() => createRecord(admin(), 'addresses', { customerId: other.id, label: 'X', addressType: 'billing', line1: 'a', city: 'Surat', state: '24', pincode: '395003', lat: 21 }));
    out.latRange = tryIt(() => createRecord(admin(), 'addresses', { customerId: other.id, label: 'X', addressType: 'billing', line1: 'a', city: 'Surat', state: '24', pincode: '395003', lat: 95, lng: 72 }));
    // contacts
    out.badEmail = tryIt(() => createRecord(admin(), 'contacts', { name: 'E', email: 'foo@', ownerId: 'E-1001', divisionIds: ['TX'] }));
    out.badMobile = tryIt(() => createRecord(admin(), 'contacts', { name: 'E', mobile: '5811122334', ownerId: 'E-1001', divisionIds: ['TX'] }));
    const c0 = getDb().records.contacts.find((c) => c.email)!;
    out.dupEmailCase = tryIt(() => createRecord(admin(), 'contacts', { name: 'E', email: String(c0.email).toUpperCase(), ownerId: 'E-1001', divisionIds: ['TX'] }));
    // merge with parent relation
    const cs = getDb().records.customers;
    const a = cs[0];
    const b = cs[1];
    const i = cs.findIndex((x) => x.id === a.id);
    cs[i] = { ...a, parentId: b.id };
    out.merge = tryIt(() => mergeCustomers(admin(), a.id, b.id));
    out.afterMergeParent = getDb().records.customers.find((x) => x.id === a.id)?.parentId;
    // transfer
    out.transferToInactive = tryIt(() => transferOwnership(admin(), karan.staffId, 'NOPE', 'reason long'));
    out.transferWsReason = tryIt(() => transferOwnership(admin(), karan.staffId, 'E-1008', '     '));
    out.transferByExec = tryIt(() => previewTransfer(karan, 'E-1008'));
    out.transferByDivHeadInk = tryIt(() => previewTransfer(actorFor('u_neha', 'tc'), karan.staffId));
    // convert
    const pool = listPoolContacts(admin()).map((p) => p.contact).find((c) => c.source !== 'exhibition')!;
    out.convertPast = tryIt(() => convertContactToLead(admin(), { contactId: pool.id, companyName: 'X', territoryId: 'surat', billingState: '24', divisionId: 'TX', productType: 'machine', ownerId: 'E-1011', nextFollowUpAt: '2026-10-01' }));
    out.convertWsCompany = tryIt(() => convertContactToLead(admin(), { contactId: pool.id, companyName: '   ', territoryId: 'surat', billingState: '24', divisionId: 'TX', productType: 'machine', ownerId: 'E-1011', nextFollowUpAt: '2026-10-25' }));
    out.convertDupCompany = tryIt(() => convertContactToLead(admin(), { contactId: pool.id, companyName: cs[3].name as string, territoryId: 'surat', billingState: '24', divisionId: 'TX', productType: 'machine', ownerId: 'E-1011', nextFollowUpAt: '2026-10-25' }));
    out.convertedLead = getDb().records.leads?.find((l) => l.contactId === pool.id);
    out.convertStore = tryIt(() => convertContactToLead(actorFor('u_prakash', 'tc'), { contactId: pool.id, divisionId: 'TX', productType: 'machine', ownerId: 'E-1011', nextFollowUpAt: '2026-10-25' }));
    // import
    out.csvEmailDup = rowsFromCsv('name,mobile,email\nA,,x@y.com\nB,,X@y.com').map((r) => r.errors);
    out.csvLong = tryIt(() => importRows(admin(), rowsFromCsv(`name,mobile,email\n${'N'.repeat(200)},9811100991,`)));
    console.log(JSON.stringify(out, null, 1));
  });
});
