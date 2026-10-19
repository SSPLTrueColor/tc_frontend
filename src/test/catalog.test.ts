import '../domain/extensions/index';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { parseCsv, previewImport, commitImport, templateCsv } from '../services/catalog/importer';
import { ownedOpenRecords } from '../services/catalog/admin';
import { createRecord, transitionRecord, updateRecord } from '../services/runtime';
import { listPriceFor } from '../services/lookups';
import { DEFAULT_POLICIES } from '../services/policies';
import { POLICY_GROUPS, validatePolicies, validatePolicyGroup } from '../services/catalog/policyRules';
import { getRoleMatrix, resetRolePermissions, saveRolePermissions } from '../services/catalog/access';
import { applyFormLayout, formLayoutDivision, getFormLayout, resetFormLayout, saveFormLayout } from '../services/catalog/formLayouts';
import { canReadResource, perm, fieldAccess } from '../services/authz';
import { getResource } from '../services/registry';
import { appRoles } from '../domain/pack';
import type { Policies } from '../services/policies';

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

  it('BR-53: blocks deactivating a user who owns open tasks', () => {
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

describe('administration: split policy pages', () => {
  it('every policy key belongs to exactly one page', () => {
    const all = Object.values(POLICY_GROUPS).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(Object.keys(DEFAULT_POLICIES) as (keyof Policies)[]));
  });

  it('validates only the keys of each page', () => {
    const bad = structuredClone(DEFAULT_POLICIES);
    bad.discountBands[1].upTo = 3;
    bad.sla.critical.cmc = { response: 5, arrival: 2, resolution: 8 };
    bad.geofenceRadiusM = 0;
    expect(Object.keys(validatePolicyGroup(bad, 'workflows'))).toEqual(['band.1']);
    expect(Object.keys(validatePolicyGroup(bad, 'sla'))).toEqual(['sla.critical.cmc']);
    expect(Object.keys(validatePolicyGroup(bad, 'rules'))).toEqual(['geofenceRadiusM']);
  });
});

describe('administration: Roles & Permissions (ADM-02)', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  const exec = () => actorFor('u_karan', 'tc');

  it('applies a saved scope change at runtime, audits it and resets to default', () => {
    const role = exec().role.id;
    expect(canReadResource(exec(), 'priceLists')).toBe(true);
    const shipped = appRoles.find((r) => r.id === role)!;
    const n = saveRolePermissions(admin(), role, { resources: { priceLists: { ...shipped.resources.priceLists, read: 'none' } }, fieldOverrides: {} });
    expect(n).toBe(1);
    expect(perm(exec(), 'priceLists').read).toBe('none');
    expect(getDb().audit.some((a) => a.action === 'access.role_changed' && a.changes?.length === 1)).toBe(true);
    expect(getRoleMatrix(admin()).overrides[role]).toBeTruthy();
    resetRolePermissions(admin(), role);
    expect(perm(exec(), 'priceLists').read).toBe('all');
  });

  it('applies field overrides and rejects invalid or locked changes', () => {
    const res = getResource('priceListItems');
    const cost = res.fields.find((f) => f.key === 'landedCost')!;
    const mgr = actorFor('u_karan', 'tc');
    expect(fieldAccess(mgr, res, cost)).toBe('hide');
    saveRolePermissions(admin(), mgr.role.id, { resources: {}, fieldOverrides: { 'priceListItems.landedCost': 'view' } });
    expect(fieldAccess(actorFor('u_karan', 'tc'), res, cost)).toBe('view');
    expect(() => saveRolePermissions(admin(), mgr.role.id, { resources: { products: { read: 'own', update: 'all', create: false, delete: false, export: false } }, fieldOverrides: {} })).toThrow(/wider/);
    expect(() => saveRolePermissions(admin(), 'admin', { resources: {}, fieldOverrides: {} })).toThrow();
    expect(() => saveRolePermissions(mgr, mgr.role.id, { resources: {}, fieldOverrides: {} })).toThrow();
  });
});

describe('administration: per-division form layouts (ADM-05)', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  it('reorders and hides sections for one division only, with history and audit', () => {
    const res = getResource('products');
    const v0 = getDb().config.version;
    saveFormLayout(admin(), { resource: 'products', division: 'INK', order: ['tax', 'main', 'spec'], hidden: ['spec'] });
    expect(applyFormLayout(res, 'INK').map((s) => s.id)).toEqual(['tax', 'main']);
    expect(applyFormLayout(res, 'TX').map((s) => s.id)).toEqual(['main', 'tax', 'spec']);
    expect(formLayoutDivision(res, { divisionId: 'INK' }, ['TX'])).toBe('INK');
    expect(formLayoutDivision(res, {}, ['TX'])).toBe('TX');
    expect(getDb().config.version).toBe(v0 + 1);
    expect(getDb().config.history[0].summary[0]).toMatch(/Form layout/);
    expect(getDb().audit.some((a) => a.action === 'config.form_layout')).toBe(true);
    resetFormLayout(admin(), 'products', 'INK');
    expect(getFormLayout('products', 'INK')).toBeNull();
  });

  it('refuses to hide a section with required fields', () => {
    expect(() => saveFormLayout(admin(), { resource: 'products', division: 'INK', order: ['main', 'tax', 'spec'], hidden: ['main'] })).toThrow(/required/);
  });
});
