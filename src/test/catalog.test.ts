import '../domain/extensions/index';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { parseCsv, previewImport, commitImport, templateCsv } from '../services/catalog/importer';
import { ownedOpenRecords } from '../services/catalog/admin';
import { createRecord, transitionRecord, updateRecord } from '../services/runtime';
import { listPriceFor } from '../services/lookups';
import { DEFAULT_POLICIES } from '../services/policies';
import { validatePolicies } from '../modules/catalog/PoliciesPage';

const admin = () => actorFor('u_rahul', 'tc');

describe('catalog: products and price lists', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  it('seeds products in every division with an active price', () => {
    const products = getDb().records.products;
    expect(products.length).toBeGreaterThanOrEqual(40);
    expect(new Set(products.map((p) => p.divisionId))).toEqual(new Set(['TX', 'INK', 'POD', 'LBL', 'PPR', 'FAB']));
    const machine = products.find((p) => p.sku === 'TX-SUB-1900')!;
    expect(listPriceFor(machine.id, '2026-10-19')?.listPrice).toBe(2850000);
  });

  it('rejects duplicate SKUs and invalid GST rates', () => {
    expect(() => createRecord(admin(), 'products', { name: 'X', sku: 'tx-sub-1900', divisionId: 'TX', productType: 'machine', hsnSac: '84433290', gstRate: 18, status: 'active' })).toThrow(/already used/);
    expect(() => createRecord(admin(), 'products', { name: 'Y', sku: 'NEW-1', divisionId: 'TX', productType: 'machine', hsnSac: '84433290', gstRate: 15, status: 'active' })).toThrow(/GST rate/);
  });

  it('blocks a product being priced on two overlapping active lists', () => {
    const a = admin();
    const machine = getDb().records.products.find((p) => p.sku === 'TX-SUB-1900')!;
    const pl = createRecord(a, 'priceLists', { name: 'Textile promo', divisionId: 'TX', validFrom: '2026-11-01', validTo: '2026-12-31' }).record;
    createRecord(a, 'priceListItems', { priceListId: pl.id, productId: machine.id, listPrice: 2700000 });
    const fresh = getDb().records.priceLists.find((l) => l.id === pl.id)!;
    expect(() => transitionRecord(a, 'priceLists', pl.id, 'active', fresh.version)).toThrow(/Cannot activate/);
  });

  it('division heads edit only their own division’s prices', () => {
    const inkHead = actorFor('u_neha', 'tc');
    const txList = getDb().records.priceLists.find((l) => l.divisionId === 'TX' && l.status === 'active')!;
    const txItem = getDb().records.priceListItems.find((i) => i.priceListId === txList.id)!;
    expect(() => updateRecord(inkHead, 'priceListItems', txItem.id, { listPrice: 1 }, txItem.version)).toThrow();
    const inkList = getDb().records.priceLists.find((l) => l.divisionId === 'INK' && l.status === 'active')!;
    const inkItem = getDb().records.priceListItems.find((i) => i.priceListId === inkList.id)!;
    expect(updateRecord(inkHead, 'priceListItems', inkItem.id, { listPrice: Number(inkItem.listPrice) + 50 }, inkItem.version).record.listPrice).toBe(Number(inkItem.listPrice) + 50);
  });
});

describe('catalog: administration', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  it('BR-53: blocks deactivating an employee who owns open tasks', () => {
    const karan = actorFor('u_karan', 'tc');
    expect(ownedOpenRecords(karan.staffId).some((o) => o.resource === 'tasks')).toBe(true);
    const emp = getDb().records.employees.find((e) => e.id === karan.staffId)!;
    expect(() => updateRecord(admin(), 'employees', emp.id, { status: 'inactive' }, emp.version)).toThrow(/Transfer them first/);
  });

  it('parses quoted CSV and imports only valid rows', () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1,2,3')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
    expect(templateCsv(admin(), 'products').split('\n')[0]).toContain('Product name *');
    const csv = ['Product name,SKU / item code,Division,Product type,HSN / SAC,GST %', 'Imported printer,IMP-001,Textile,Machine,84433290,18', 'Bad row,IMP-002,Nowhere,Machine,12,18'].join('\n');
    const preview = previewImport(admin(), 'products', csv);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0].errors).toEqual([]);
    expect(preview.rows[1].errors.join(' ')).toMatch(/Division|HSN/);
    const result = commitImport(admin(), preview);
    expect(result.created).toHaveLength(1);
    expect(getDb().records.products.some((p) => p.sku === 'IMP-001')).toBe(true);
    expect(getDb().audit.some((a) => a.action === 'import')).toBe(true);
  });

  it('policy validation catches unordered bands and inverted SLAs', () => {
    expect(validatePolicies(DEFAULT_POLICIES)).toEqual({});
    const bad = structuredClone(DEFAULT_POLICIES);
    bad.discountBands[1].upTo = 3;
    bad.sla.critical.cmc = { response: 5, arrival: 2, resolution: 8 };
    const e = validatePolicies(bad);
    expect(e['band.1']).toBeTruthy();
    expect(e['sla.critical.cmc']).toBeTruthy();
  });
});
