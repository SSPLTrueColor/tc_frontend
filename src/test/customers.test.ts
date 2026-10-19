import '../domain/extensions/index';
import { gstinCheckDigit, validateGstin } from '../lib/validators';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { allResources } from '../services/registry';
import { createRecord, queryRecords, updateRecord } from '../services/runtime';
import { ServiceError } from '../services/types';
import { nameSimilarity, normaliseName } from '../services/customers/duplicates';
import { convertContactToLead, mergeCustomers, previewTransfer, transferOwnership } from '../services/customers/operations';
import { rowsFromCsv } from '../services/customers/importContacts';

const admin = () => actorFor('u_rahul', 'tc');
const expectValidation = (fn: () => unknown, field: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ServiceError);
    expect((e as ServiceError).fieldErrors?.[field]).toBeTruthy();
    return;
  }
  throw new Error('expected a validation error');
};

describe('customers module', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  it('seeds ~60 companies with valid GSTINs matching their billing state', () => {
    const cs = getDb().records.customers;
    expect(cs.length).toBeGreaterThanOrEqual(55);
    cs.filter((c) => c.gstin).forEach((c) => expect(validateGstin(String(c.gstin), { stateCode: String(c.billingState), pan: String(c.pan) })).toBeUndefined());
    expect(getDb().records.contacts.filter((c) => !c.customerId).length).toBe(25);
    getDb().records.contacts.forEach((c) => expect(c.mobile || c.email).toBeTruthy());
  });

  it('normalises legal suffixes and scores similar names', () => {
    expect(normaliseName('Om Sai Digital Prints Pvt. Ltd.')).toBe('om sai digital prints');
    expect(nameSimilarity('Om Sai Digital Prints', 'Om Sai Digital Prints Pvt Ltd')).toBe(1);
    expect(nameSimilarity('Kaveri Label Works', 'Sharp Labels')).toBeLessThan(0.85);
  });

  it('rejects a bad GSTIN, a GSTIN from another state and a duplicate GSTIN (BR-01/BR-02)', () => {
    const base = { name: 'Test Prints', category: 'prospect', divisionIds: ['TX'], territoryId: 'surat', billingState: '24' };
    expectValidation(() => createRecord(admin(), 'customers', { ...base, gstin: '24AAPFU0939F1ZA' }), 'gstin');
    expectValidation(() => createRecord(admin(), 'customers', { ...base, gstin: '27AAPFU0939F1ZV' }), 'gstin');
    const existing = getDb().records.customers.find((c) => c.gstin && c.billingState === '24')!;
    expectValidation(() => createRecord(admin(), 'customers', { ...base, gstin: existing.gstin }), 'gstin');
    const ok = createRecord(admin(), 'customers', { ...base, gstin: '24AAPFU0939F1Z' + gstinCheckDigit('24AAPFU0939F1Z') }).record;
    expect(ok.gstin).toBe('24AAPFU0939F1ZK'.slice(0, 14) + gstinCheckDigit('24AAPFU0939F1Z'));
  });

  it('requires a mobile or email on contacts and blocks duplicate mobiles (BR-03)', () => {
    expectValidation(() => createRecord(admin(), 'contacts', { name: 'No Reach', ownerId: 'E-1001', divisionIds: ['TX'] }), 'mobile');
    const taken = getDb().records.contacts[0];
    expectValidation(() => createRecord(admin(), 'contacts', { name: 'Copy', mobile: `+91 ${taken.mobile}`, ownerId: 'E-1001', divisionIds: ['TX'] }), 'mobile');
    const c = createRecord(admin(), 'contacts', { name: 'New Person', mobile: '+91 98111 22334', ownerId: 'E-1001', divisionIds: ['TX'] }).record;
    expect(c.mobile).toBe('9811122334');
  });

  it('merges a duplicate: linked records move to the survivor and the duplicate goes to the bin', () => {
    const cs = getDb().records.customers;
    const keep = cs.find((c) => c.name === 'Om Sai Digital Prints')!;
    const drop = cs.find((c) => c.name === 'Om Sai Digital Prints Pvt Ltd')!;
    const dropContacts = getDb().records.contacts.filter((c) => c.customerId === drop.id).length;
    const r = mergeCustomers(admin(), keep.id, drop.id);
    expect(r.moved).toBeGreaterThanOrEqual(dropContacts);
    expect(getDb().records.customers.some((c) => c.id === drop.id)).toBe(false);
    expect(getDb().recycle[0].record.id).toBe(drop.id);
    expect(getDb().records.contacts.some((c) => c.customerId === drop.id)).toBe(false);
    expect(() => mergeCustomers(actorFor('u_karan', 'tc'), keep.id, cs[1].id)).toThrow(ServiceError);
  });

  it('transfers accounts and open tasks only, with history (BR-52)', () => {
    const karan = actorFor('u_karan', 'tc').staffId;
    const preview = previewTransfer(admin(), karan);
    const accounts = preview.find((x) => x.resKey === 'customers')!.count;
    expect(accounts).toBeGreaterThan(0);
    const doneTask = getDb().records.tasks.find((t) => t.assigneeId === karan && t.status === 'done');
    transferOwnership(admin(), karan, 'E-1008', 'Territory realignment');
    expect(getDb().records.customers.filter((c) => c.ownerId === karan).length).toBe(0);
    if (doneTask) expect(getDb().records.tasks.find((t) => t.id === doneTask.id)!.assigneeId).toBe(karan);
    expect(getDb().audit.some((a) => a.action === 'ownership.transfer')).toBe(true);
    expect(() => transferOwnership(admin(), karan, karan, 'same person')).toThrow(ServiceError);
  });

  it('converts a pool contact to a lead with an inline company when leads exist', () => {
    const pool = getDb().records.contacts.find((c) => !c.customerId)!;
    const input = { contactId: pool.id, eventName: 'Gartex Mumbai 2026', companyName: 'Pool Prints', territoryId: 'surat', billingState: '24', divisionId: 'TX', productType: 'machine', ownerId: 'E-1011', nextFollowUpAt: '2026-10-25' };
    if (!allResources().some((r) => r.key === 'leads')) {
      expect(() => convertContactToLead(admin(), input)).toThrow(/not available/);
      return;
    }
    const r = convertContactToLead(admin(), input);
    expect(getDb().records.leads.find((l) => l.id === r.leadId)?.contactId).toBe(pool.id);
    const after = getDb().records.contacts.find((c) => c.id === pool.id)!;
    expect(after.poolStatus).toBe('converted');
    expect(after.customerId).toBe(r.customerId);
    expect(() => convertContactToLead(admin(), input)).toThrow(/already converted/);
  });

  it('validates CSV rows: missing reach, bad mobile, duplicates within the file and in the store', () => {
    const existing = getDb().records.contacts[0];
    const rows = rowsFromCsv(`name,company,mobile,email\nA,,98111,\nB,,,\nC,,${existing.mobile},\nD,Arvind Digital Fabrics,9811100001,\nE,,9811100001,`);
    expect(rows[0].errors[0]).toMatch(/10-digit/);
    expect(rows[1].errors[0]).toMatch(/Mobile or email/);
    expect(rows[2].duplicateOf).toBe(existing.id);
    expect(rows[3].customerId).toBeTruthy();
    expect(rows[4].errors[0]).toMatch(/Same mobile/);
  });

  it('scopes customers by owner for a sales executive', () => {
    const karan = actorFor('u_karan', 'tc');
    const rows = queryRecords(karan, 'customers').rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((c) => c.ownerId === karan.staffId)).toBe(true);
    const other = getDb().records.customers.find((c) => c.ownerId !== karan.staffId)!;
    expect(() => updateRecord(karan, 'customers', other.id, { name: 'X' }, other.version)).toThrow(ServiceError);
  });
});
