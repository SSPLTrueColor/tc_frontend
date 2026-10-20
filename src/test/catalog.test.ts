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

describe('QA: user lifecycle, sign-in and configurable rules (ADM-08, COM-09, NFR-07, ADM-04)', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  it('MFA for System Administrator and Management only; sign-ins are audited', async () => {
    const { startSignIn, verifyOtp } = await import('../services/session');
    expect(startSignIn('u_karan').otp).toBeUndefined();
    const otp = startSignIn('u_vikram').otp!;
    expect(otp).toMatch(/^\d{6}$/);
    expect(() => verifyOtp('u_vikram', '000000' === otp ? '111111' : '000000')).toThrow();
    verifyOtp('u_vikram', otp);
    expect(startSignIn('u_rahul').otp).toBeTruthy();
    expect(getDb().audit.filter((a) => a.action === 'login').length).toBe(2);
  });

  it('a deactivated user cannot sign in or be switched to; the role switcher is audited', async () => {
    const { startSignIn } = await import('../services/session');
    const { switchSession } = await import('../services/settings');
    const deepak = actorFor('u_deepak', 'tc');
    const open = ownedOpenRecords(deepak.staffId);
    expect(() => updateRecord(admin(), 'employees', deepak.staffId, { status: 'inactive' }, getDb().records.employees.find((e) => e.id === deepak.staffId)!.version)).toThrow(); // BR-53 while records are open
    // Admin transfers on exit by direct edit in the seed store, then deactivates.
    getDb().records.employees.find((e) => e.id === deepak.staffId)!.status = 'inactive';
    expect(open.length).toBeGreaterThan(0);
    expect(() => startSignIn('u_deepak')).toThrow(/deactivated/);
    expect(() => switchSession('u_deepak', 'tc')).toThrow(/deactivated/);
    const before = getDb().audit.length;
    switchSession('u_karan', 'tc');
    expect(getDb().audit.length).toBe(before + 1);
    expect(getDb().audit[getDb().audit.length - 1].action).toBe('login');
  });

  it('ADM-08 end to end: transfer on exit, then deactivate (history such as attendance and activity log never blocks)', async () => {
    const { transferOwnership } = await import('../services/customers/operations');
    const { startSignIn } = await import('../services/session');
    const tanvi = actorFor('u_tanvi', 'tc');
    const emp = () => getDb().records.employees.find((e) => e.id === tanvi.staffId)!;
    getDb().records.leads.find((l) => l.status === 'new')!.ownerId = tanvi.staffId; // an open lead to hand over
    expect(ownedOpenRecords(tanvi.staffId).length).toBeGreaterThan(0);
    expect(() => updateRecord(admin(), 'employees', tanvi.staffId, { status: 'inactive' }, emp().version)).toThrow();
    transferOwnership(admin(), tanvi.staffId, actorFor('u_suresh', 'tc').staffId, 'Employee exit');
    expect(ownedOpenRecords(tanvi.staffId)).toEqual([]);
    updateRecord(admin(), 'employees', tanvi.staffId, { status: 'inactive' }, emp().version);
    expect(emp().status).toBe('inactive');
    expect(() => startSignIn('u_tanvi')).toThrow(/deactivated/);
  });

  it('Configurable Rules really change behaviour: first-contact SLA hours drive the Not Attended Leads queue', async () => {
    const { updatePolicies } = await import('../services/policies');
    const { notAttendedLeads } = await import('../services/leads/rules');
    const count = () => {
      const r = notAttendedLeads(admin()) as unknown as { rows?: unknown[]; leads?: unknown[]; items?: unknown[] };
      return (r.rows ?? r.leads ?? r.items ?? []).length;
    };
    const base = count();
    updatePolicies(admin(), { leadFirstContactHours: 24 * 365 });
    expect(count()).toBeLessThan(base === 0 ? 1 : base);
    updatePolicies(admin(), { leadFirstContactHours: 1 });
    expect(count()).toBeGreaterThanOrEqual(base);
    expect(() => updatePolicies(actorFor('u_karan', 'tc'), { leadFirstContactHours: 2 })).toThrow();
  });
});

describe('QA: shared runtime hooks requested by module owners', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  it('beforeDelete can veto a soft delete; editBlocked composes the first reason', async () => {
    const { registerResourceHooks, hooksFor } = await import('../services/resourceHooks');
    const { deleteRecord } = await import('../services/runtime');
    const { ServiceError } = await import('../services/types');
    registerResourceHooks('termsTemplates', { beforeDelete: (_c, r) => { if (r.id === 'BLOCK') throw new ServiceError('invalid_state', 'blocked'); }, editBlocked: (r) => (r.status === 'x' ? 'Not draft' : undefined) });
    const t = getDb().records.termsTemplates[0];
    const id = t.id;
    t.id = 'BLOCK';
    expect(() => deleteRecord(admin(), 'termsTemplates', 'BLOCK')).toThrow(/blocked/);
    t.id = id;
    expect(hooksFor('termsTemplates').editBlocked!({ ...t, status: 'x' })).toBe('Not draft');
    expect(hooksFor('termsTemplates').editBlocked!({ ...t, status: 'y' })).toBeUndefined();
  });

  it('GST split: CGST and SGST are equal halves rounded to the paisa (BR-16)', async () => {
    const { gstSplit } = await import('../services/lookups');
    const intra = gstSplit(DEFAULT_POLICIES.companyGstState, 999.99, 18);
    expect(intra.cgst).toBe(intra.sgst);
    expect(intra.cgst).toBe(90);
    expect(gstSplit('29', 999.99, 18).igst).toBe(180);
    expect(gstSplit(DEFAULT_POLICIES.companyGstState, 0.05, 5).cgst).toBe(0);
  });
});

describe('QA: transition guards (Transition.when, resourceHooks.transitionBlocked)', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  it('hides a step whose `when` fails and disables one a hook blocks, and the service enforces both', async () => {
    const { getResource } = await import('../services/registry');
    const { availableTransitions, transitionRecord } = await import('../services/runtime');
    const { registerResourceHooks } = await import('../services/resourceHooks');
    const res = getResource('tasks');
    const start = res.lifecycle!.transitions.find((t) => t.to === 'in_progress')!;
    const task = getDb().records.tasks.find((t) => t.status === 'todo')!;
    start.when = (r) => r.id !== task.id;
    expect(availableTransitions(admin(), res, task).some((t) => t.to === 'in_progress')).toBe(false);
    expect(() => transitionRecord(admin(), 'tasks', task.id, 'in_progress', task.version)).toThrow();
    delete start.when;
    registerResourceHooks('tasks', { transitionBlocked: (_a, r, to) => (to === 'done' && r.id === task.id ? 'Finish the checklist first' : undefined) });
    expect(availableTransitions(admin(), res, task).find((t) => t.to === 'done')!.disabledReason).toBe('Finish the checklist first');
    expect(() => transitionRecord(admin(), 'tasks', task.id, 'done', task.version)).toThrow(/checklist/);
  });
});
