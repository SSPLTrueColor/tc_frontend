import '../domain/extensions/index';
import { gstinCheckDigit, validateGstin } from '../lib/validators';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { allResources } from '../services/registry';
import { createRecord, queryRecords, updateRecord } from '../services/runtime';
import { ServiceError } from '../services/types';
import { nameSimilarity, normaliseName } from '../services/customers/duplicates';
import { convertContactToLead, mergeCustomers, previewTransfer, transferOwnership } from '../services/customers/operations';
import { importRows, rowsFromCsv } from '../services/customers/importContacts';
import { deletePoolContact, listPoolContacts } from '../services/customers/pool';
import { countLinked, customer360, customer360Overview, customerDocuments } from '../services/customers/view360';
import { getRecordTabs } from '../components/resource/extensions';
import { getResource } from '../services/registry';
import { L } from '../constants/labels';
import { ownedOpenRecords } from '../services/catalog/admin';

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

  it('one transfer hands over every open record that blocks deactivation (CUS-10, ADM-08)', () => {
    const karan = actorFor('u_karan', 'tc').staffId;
    expect(ownedOpenRecords(karan).length).toBeGreaterThan(0);
    const keys = previewTransfer(admin(), karan).map((t) => t.resKey);
    expect(keys).toEqual(expect.arrayContaining(['customers', 'leads', 'opportunities', 'quotations', 'salesOrders']));
    transferOwnership(admin(), karan, 'E-1008', 'Leaving the company');
    expect(ownedOpenRecords(karan)).toEqual([]);
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
    // Own accounts, plus (read-only) accounts on his own deals — the customer of an opportunity he owns.
    const dealCustomers = new Set((['leads', 'opportunities', 'quotations', 'salesOrders'] as const).flatMap((k) => (getDb().records[k] ?? []).filter((r) => r.ownerId === karan.staffId).map((r) => r.customerId)));
    expect(rows.every((c) => c.ownerId === karan.staffId || dealCustomers.has(c.id))).toBe(true);
    expect(rows.some((c) => c.ownerId !== karan.staffId)).toBe(true);
    const other = rows.find((c) => c.ownerId !== karan.staffId)!;
    expect(() => updateRecord(karan, 'customers', other.id, { name: 'X' }, other.version)).toThrow(ServiceError);
  });

  it('lists the Contact Pool (CUS-05): unlinked contacts plus converted ones, scoped to the actor', () => {
    const pool = listPoolContacts(admin());
    expect(pool.length).toBe(25);
    expect(pool.every((p) => !p.contact.customerId || p.contact.poolStatus === 'converted')).toBe(true);
    const karan = actorFor('u_karan', 'tc');
    expect(listPoolContacts(karan).every((p) => p.contact.ownerId === karan.staffId)).toBe(true);
    deletePoolContact(admin(), pool[0].contact.id);
    expect(listPoolContacts(admin()).length).toBe(24);
    expect(() => deletePoolContact(karan, pool[1].contact.id)).toThrow(ServiceError);
  });

  it('builds the Customer 360° View model: sites, linked sets, payment schedule, feedback, documents', () => {
    const c = getDb().records.customers.find((x) => getDb().records.addresses.some((a) => a.customerId === x.id))!;
    const v = customer360(admin(), c.id);
    expect(v.sites.length).toBeGreaterThan(0);
    for (const k of ['leads', 'opportunities', 'quotations', 'salesOrders', 'machines', 'warranties', 'amcContracts', 'tickets'] as const) expect(Array.isArray(v[k].rows)).toBe(true);
    expect(v.payments.rows.every((r) => r.amount >= 0)).toBe(true);
    expect(v.feedback.rows.every((f) => f.rating !== undefined || f.comment)).toBe(true);
    const o = customer360Overview(admin(), c.id);
    expect(o.counts.sites).toBe(v.sites.length);
    expect(Array.isArray(customerDocuments(admin(), c.id))).toBe(true);
  });

  it('uses glossary terms: Site record, Customer 360° tab order, Converted to Lead', async () => {
    await Promise.resolve();
    expect(getResource('addresses').label).toBe('Site');
    expect(getResource('contacts').fields.find((f) => f.key === 'buyingRole')?.label).toBe(L.customers.fields.contacts.buyingRole);
    const labels = getRecordTabs('customers').map((t) => t.label);
    const want = ['Overview', 'Contacts', 'Sites', 'Leads', 'Opportunities', 'Quotations', 'Sales Orders', 'Payment Status', 'Installed Machines', 'Warranty & AMC', 'Service Tickets', 'Feedback', 'Consumables', 'Training Records', 'Key Account Plan', 'Activity History', 'Documents'];
    const idx = want.map((w) => labels.indexOf(w));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(L.customers.masters.poolStatus.values.converted).toBe('Converted to Lead');
  });
  // ---------------------------------------------------------------- QA regressions (scratchpad/qa/customers.md)

  it('rejects whitespace-only names on companies, contacts and sites', () => {
    const base = { category: 'prospect', divisionIds: ['TX'], territoryId: 'surat', billingState: '24', ownerId: 'E-1011' };
    expectValidation(() => createRecord(admin(), 'customers', { ...base, name: '   ' }), 'name');
    expectValidation(() => createRecord(admin(), 'contacts', { name: '  ', mobile: '9811177001', ownerId: 'E-1001', divisionIds: ['TX'] }), 'name');
    const c = getDb().records.customers[0];
    expectValidation(() => createRecord(admin(), 'addresses', { customerId: c.id, label: ' ', addressType: 'billing', line1: 'a', city: 'Surat', state: '24', pincode: '395003' }), 'label');
    expect(createRecord(admin(), 'customers', { ...base, name: '  Trim Prints  ' }).record.name).toBe('Trim Prints');
  });

  it('lets a key account with an overdue plan review be edited, but not set a new past review date (CUS-11)', () => {
    const key = getDb().records.customers.find((c) => c.keyAccount && String(c.planNextReview) < '2026-10-19')!;
    expect(key).toBeTruthy();
    const editable = { name: `${String(key.name)} Group`, planNextReview: key.planNextReview, keyAccount: true };
    expect(updateRecord(admin(), 'customers', key.id, editable, key.version).record.name).toBe(`${String(key.name)} Group`);
    const fresh = getDb().records.customers.find((c) => c.id === key.id)!;
    expectValidation(() => updateRecord(admin(), 'customers', key.id, { planNextReview: '2026-10-01' }, fresh.version), 'planNextReview');
  });

  it('only links a Dealer or Distributor as the dealer (CUS-08)', () => {
    const prospect = getDb().records.customers.find((c) => c.category === 'prospect')!;
    const dealer = getDb().records.customers.find((c) => c.category === 'dealer' || c.category === 'distributor')!;
    const base = { name: 'End Customer Prints', category: 'prospect', divisionIds: ['TX'], territoryId: 'surat', billingState: '24', ownerId: 'E-1011' };
    expectValidation(() => createRecord(admin(), 'customers', { ...base, dealerId: prospect.id }), 'dealerId');
    expect(createRecord(admin(), 'customers', { ...base, dealerId: dealer.id }).record.dealerId).toBe(dealer.id);
  });

  it('keeps sites and contacts inside the sales executive’s own companies (REQUIREMENTS §2.2)', () => {
    const karan = actorFor('u_karan', 'tc');
    const other = getDb().records.customers.find((c) => c.ownerId !== karan.staffId && getDb().records.addresses.some((a) => a.customerId === c.id))!;
    const site = getDb().records.addresses.find((a) => a.customerId === other.id)!;
    expect(() => updateRecord(karan, 'addresses', site.id, { label: 'Changed' }, site.version)).toThrow(ServiceError);
    expectValidation(() => createRecord(karan, 'addresses', { customerId: other.id, label: 'X', addressType: 'billing', line1: 'a', city: 'Surat', state: '24', pincode: '395003' }), 'customerId');
    expectValidation(() => createRecord(karan, 'contacts', { name: 'Linked Elsewhere', mobile: '9811177002', customerId: other.id }), 'customerId');
    const own = getDb().records.customers.find((c) => c.ownerId === karan.staffId)!;
    expect(createRecord(karan, 'addresses', { customerId: own.id, label: 'Own plant', addressType: 'installation', line1: 'Plot 4', city: 'Surat', state: '24', pincode: '395003' }).record.customerId).toBe(own.id);
  });

  it('merging a parent into its child leaves no self-reference (CUS-06/08)', () => {
    const cs = getDb().records.customers;
    const [a, b] = [cs[0], cs[1]];
    cs[0] = { ...a, parentId: b.id };
    mergeCustomers(admin(), a.id, b.id);
    expect(getDb().records.customers.find((c) => c.id === a.id)!.parentId).toBeNull();
    expect(getDb().audit.some((x) => x.action === 'customers.merge' && x.recordId === a.id)).toBe(true);
  });

  it('flags duplicate emails and over-long values inside an import file, and reports the real reason (CUS-05/06)', () => {
    const rows = rowsFromCsv(`name,mobile,email\nA,,dup@example.com\nB,,DUP@example.com\n${'N'.repeat(81)},9811100991,`);
    expect(rows[1].errors[0]).toMatch(/Same email as line 2/);
    expect(rows[2].errors[0]).toMatch(/80 characters/);
  });

  it('imports a contact into the pool when the matched company is outside the importer’s scope', () => {
    const karan = actorFor('u_karan', 'tc');
    const other = getDb().records.customers.find((c) => c.ownerId !== karan.staffId)!;
    const rows = rowsFromCsv(`name,company,mobile,email\nScoped Person,${String(other.name).replace(/,/g, ' ')},9811100992,`);
    expect(rows[0].customerId).toBe(other.id);
    const r = importRows(karan, rows);
    expect(r.created.length).toBe(1);
    expect(getDb().records.contacts.find((c) => c.id === r.created[0])!.customerId).toBeNull();
  });

  it('counts open leads / opportunities / tickets by status key and scopes tab badges', () => {
    const c = getDb().records.customers.find((x) => (getDb().records.opportunities ?? []).some((o) => o.customerId === x.id))!;
    const o = customer360Overview(admin(), c.id);
    const opps = (getDb().records.opportunities ?? []).filter((x) => x.customerId === c.id && !['won', 'lost'].includes(String(x.stage)));
    expect(o.counts.openOpportunities).toBe(opps.length);
    const karan = actorFor('u_karan', 'tc');
    const own = getDb().records.customers.find((x) => x.ownerId === karan.staffId)!;
    expect(countLinked(karan, 'contacts', own.id)).toBeLessThanOrEqual(getDb().records.contacts.filter((x) => x.customerId === own.id).length);
  });
  it('pre-fills territory and billing state from the pool contact’s city on Convert to Lead (BR-04)', () => {
    const pool = getDb().records.contacts.find((c) => !c.customerId && c.source !== 'exhibition')!;
    const i = getDb().records.contacts.findIndex((c) => c.id === pool.id);
    getDb().records.contacts[i] = { ...pool, city: 'Surat' };
    if (!allResources().some((r) => r.key === 'leads')) return;
    const r = convertContactToLead(admin(), { contactId: pool.id, companyName: 'City Prefill Prints', divisionId: 'TX', productType: 'machine', ownerId: 'E-1011', nextFollowUpAt: '2026-10-25' });
    const co = getDb().records.customers.find((c) => c.id === r.customerId)!;
    expect(co.territoryId).toBe('surat');
    expect(co.billingState).toBe('24');
    expect(getDb().records.leads.find((l) => l.id === r.leadId)!.state).toBe('24');
  });
});
