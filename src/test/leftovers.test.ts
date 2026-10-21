/**
 * Regression tests for the leftover fixes (docs/BRD-AUDIT.md plan section 2):
 * custom fields saved with the quotation / order create, server-side number limits on order lines,
 * workflow start / end master values locked in validateDraft, and role capabilities honoured by quotation approvals.
 */
import '../domain/extensions/index';
import { beforeEach, describe, expect, it } from 'vitest';
import { demoUsers } from '../domain/pack';
import { todayKey } from '../lib/dates';
import { actorFor, type Actor } from '../services/authz';
import { __setDb, createDb, getDb } from '../services/db';
import { addDraftField, ensureDraft, isWorkflowValue, publishDraft, setDraftMaster, validateDraft } from '../services/config';
import { getMaster } from '../services/registry';
import { listPriceFor, userOfStaff } from '../services/lookups';
import { saveRoleCapabilities } from '../services/catalog/access';
import { capabilityGrants } from '../services/catalog/roleOverrides';
import { roleHoldsQuoteLevel, roleMayDecideQuoteLevel } from '../services/quotations/approvalLevels';
import { canDecideQuote, decideQuoteApproval, quoteApprovalChain, saveQuote, submitQuote } from '../services/quotations/workflow';
import type { QuoteLine } from '../services/quotations/pricing';
import * as so from '../services/orders/orders';
import type { QuoteLine as OrderLine } from '../services/orders/lines';
import { ServiceError } from '../services/types';

const A = (id: string): Actor => actorFor(id, 'tc');
const admin = () => A('u_rahul');
const fieldErrors = (fn: () => unknown): Record<string, string> => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ServiceError) return e.fieldErrors ?? { _: e.message };
    throw e;
  }
  return {};
};

function publishRequired(resource: string, key: string) {
  ensureDraft(admin());
  addDraftField(admin(), { resource, key, label: 'Buyer reference', type: 'text', required: true, defaultValue: 'NA', sensitivity: 'none' });
  publishDraft(admin());
}

function karanQuoteSetup() {
  const d = getDb();
  const karan = A('u_karan');
  const opp = d.records.opportunities.find((o) => o.ownerId === karan.staffId && ['needs_assessment', 'demo', 'proposal', 'negotiation'].includes(String(o.stage)) && !(d.records.quotations ?? []).some((q) => q.opportunityId === o.id && q.status === 'accepted'))!;
  expect(opp, 'seed has an open opportunity owned by Karan').toBeTruthy();
  const product = d.records.products.find((p) => p.divisionId === opp.divisionId && listPriceFor(p.id, todayKey()))!;
  const line = (discountPct: number): QuoteLine => ({ productId: product.id, description: String(product.name), lineType: String(product.productType), qty: 1, listPrice: 1, discountPct, discountAmt: 0, hsnSac: String(product.hsnSac), gstRate: Number(product.gstRate) });
  return { karan, opp, line };
}

beforeEach(() => __setDb(createDb(new Date())));

describe('1. required custom fields are saved with the quotation / order in one write', () => {
  it('quotation: a blank required custom field is refused on the field; a filled one is stored on create (version 1)', () => {
    publishRequired('quotations', 'buyerRef');
    const { karan, opp, line } = karanQuoteSetup();
    const errs = fieldErrors(() => saveQuote(karan, { header: { opportunityId: opp.id, buyerRef: '' }, lines: [line(0)] }));
    expect(errs.buyerRef).toBeTruthy();
    const saved = saveQuote(karan, { header: { opportunityId: opp.id, buyerRef: 'BR-77' }, lines: [line(0)] });
    const q = getDb().records.quotations.find((x) => x.id === saved.record.id)!;
    expect(q.buyerRef).toBe('BR-77');
    expect(q.version).toBe(1);
    // Edit path accepts the custom key too.
    const upd = saveQuote(karan, { id: q.id, version: q.version, header: { opportunityId: opp.id, buyerRef: 'BR-78' }, lines: [line(0)] });
    expect(getDb().records.quotations.find((x) => x.id === upd.record.id)!.buyerRef).toBe('BR-78');
  });

  it('sales order: createOrder validates and stores custom values with the order', () => {
    publishRequired('salesOrders', 'buyerRef');
    const d = getDb();
    const q = d.records.quotations.find((x) => !so.quotationBlocker(d, x) && so.draftFromQuotation(admin(), x.id).orderKind === 'machine')!;
    const owner = A(userOfStaff(q.ownerId)!.id);
    const draft = so.draftFromQuotation(owner, q.id);
    const base = { source: 'quotation' as const, sourceId: q.id, lines: draft.lines, customerPoNo: 'PO/CF/1', customerPoDate: todayKey(), poFileName: 'po.pdf', poFileSize: 1000, siteAddressId: draft.siteAddresses[0]?.id };
    expect(fieldErrors(() => so.createOrder(owner, { ...base, idempotencyKey: 'cf-1', custom: { buyerRef: '' } })).buyerRef).toBeTruthy();
    const o = so.createOrder(owner, { ...base, idempotencyKey: 'cf-2', custom: { buyerRef: 'SO-REF-9' } });
    expect(getDb().records.salesOrders.find((x) => x.id === o.id)!.buyerRef).toBe('SO-REF-9');
  });
});

describe('2. order lines: the NumberInput limits are enforced by the service', () => {
  const good: OrderLine = { productId: 'p', description: 'x', lineType: 'machine', qty: 2, listPrice: 1000, discountPct: 5, discountAmt: 0, hsnSac: '8443', gstRate: 18 };
  it('accepts a line within limits', () => expect(so.validateLines([good])).toBeNull());
  it.each([
    ['qty 0', { qty: 0 }, /quantity/],
    ['qty 10,000', { qty: 10_000 }, /quantity/],
    ['qty 1.5', { qty: 1.5 }, /quantity/],
    ['qty NaN', { qty: NaN }, /quantity/],
    ['discount 101 %', { discountPct: 101 }, /discount %/],
    ['discount -1 %', { discountPct: -1 }, /discount %/],
    ['negative discount amount', { discountAmt: -5 }, /discount amount/],
    ['negative price', { listPrice: -1 }, /price/],
    ['price above ₹99,99,99,999', { listPrice: 1_000_000_000 }, /price/],
  ])('rejects %s', (_n, patch, msg) => {
    expect(so.validateLines([good, { ...good, ...patch }])).toMatch(new RegExp(`^Line 2: ${msg.source}`));
  });
  it('rejects freight / insurance outside ₹0 – ₹99,99,99,999', () => {
    expect(so.validateExtras(0, 0)).toBeNull();
    expect(so.validateExtras(1_000_000_000, 0)).toMatch(/^Freight/);
    expect(so.validateExtras(0, NaN)).toMatch(/^Insurance/);
  });
});

describe('3. workflow start / end master values cannot be deactivated or removed', () => {
  it('opportunity stage Won / Lost are locked; other values still deactivate', () => {
    const m = getMaster('oppStage');
    expect(isWorkflowValue('oppStage', 'won')).toBe(true);
    expect(isWorkflowValue('oppStage', 'lost')).toBe(true);
    ensureDraft(admin());
    setDraftMaster(admin(), { ...m, values: m.values.map((v) => (v.key === 'won' ? { ...v, active: false } : v)) });
    expect(validateDraft(getDb().config.draft!).some((i) => i.severity === 'error' && i.message.includes('workflow'))).toBe(true);
    setDraftMaster(admin(), { ...m, values: m.values.filter((v) => v.key !== 'lost') });
    expect(validateDraft(getDb().config.draft!).some((i) => i.severity === 'error' && i.message.includes('workflow'))).toBe(true);
    // Renaming a workflow value stays allowed.
    setDraftMaster(admin(), { ...m, values: m.values.map((v) => (v.key === 'won' ? { ...v, label: 'Closed Won' } : v)) });
    expect(validateDraft(getDb().config.draft!).filter((i) => i.severity === 'error')).toEqual([]);
    expect(() => publishDraft(admin())).not.toThrow();
  });
});

describe('6. role capabilities from Roles › Approvals and special actions drive quotation approvals', () => {
  it('pure rule: granted levels count, removed levels stop counting, shipped extra holders still do not', () => {
    expect(roleHoldsQuoteLevel('division_head', 'approve.l2')).toBe(true);
    expect(roleHoldsQuoteLevel('sales_manager', 'approve.l2')).toBe(false);
    expect(roleHoldsQuoteLevel('sales_manager', 'approve.l2', { sales_manager: { add: ['approve.l2'], remove: [] } })).toBe(true);
    expect(roleHoldsQuoteLevel('division_head', 'approve.l2', { division_head: { add: [], remove: ['approve.l2'] } })).toBe(false);
    expect(roleMayDecideQuoteLevel('service_head', { capability: 'approve.l1', label: 'L1' })).toBe(false);
  });

  it('granting approve.l2 to Sales Manager lets Rohan decide level 2; the selection guard still applies', () => {
    const { karan, opp, line } = karanQuoteSetup();
    const saved = saveQuote(karan, { header: { opportunityId: opp.id }, lines: [line(12)] });
    const q = getDb().records.quotations.find((x) => x.id === saved.record.id)!;
    const r = submitQuote(karan, q.id, q.version, 'Competitive offer from importer');
    expect(r.status).toBe('pending_approval');
    const appr = () => getDb().approvals.find((a) => a.id === r.approvalId)!;
    const rohan = A('u_rohan');
    decideQuoteApproval(rohan, appr().id, 'approved', 'ok at L1', appr().version);
    expect(appr().levels[appr().currentLevel].capability).toBe('approve.l2');
    expect(canDecideQuote(A('u_rohan'), appr())).toBe(false);
    saveRoleCapabilities(admin(), 'sales_manager', [...A('u_rohan').role.capabilities, 'approve.l2']);
    expect(capabilityGrants().sales_manager?.add).toContain('approve.l2');
    expect(canDecideQuote(A('u_rohan'), appr())).toBe(true);
    const done = decideQuoteApproval(A('u_rohan'), appr().id, 'approved', 'ok at L2', appr().version);
    expect(done.status).toBe('approved');
  });

  it('taking approve.l2 away from Division Head moves level 2 up to Management', () => {
    const { karan, opp } = karanQuoteSetup();
    const q: Record<string, unknown> = { ownerId: karan.staffId, divisionId: opp.divisionId };
    expect(quoteApprovalChain(karan, q, 12).map((l) => l.capability)).toEqual(['approve.l1', 'approve.l2']);
    const dh = demoUsers.find((u) => u.roleId === 'division_head')!;
    saveRoleCapabilities(admin(), 'division_head', A(dh.id).role.capabilities.filter((c) => c !== 'approve.l2'));
    expect(quoteApprovalChain(karan, q, 12).map((l) => l.capability)).toEqual(['approve.l1', 'approve.l3']);
  });
});

