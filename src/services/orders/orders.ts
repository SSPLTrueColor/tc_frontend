/**
 * Sales order domain service (FR-049 – FR-058, FR-060/061, CON-02 repeat orders). Synchronous engine
 * logic; pages call it through src/services/api/orders.ts. Every write is one commit, audited.
 */
import { appPack } from '../../domain/pack';
import { L } from '../../constants/labels';
import { addDays, todayKey } from '../../lib/dates';
import { nowIso } from '../../lib/clock';
import { fyLabel } from '../../lib/fy';
import { uid } from '../../lib/ids';
import { formatMoney } from '../../lib/format';
import type { RecordData } from '../../metadata/types';
import { type Actor, can, canReadRecord, canUpdateRecord, perm } from '../authz';
import { commit, getDb } from '../db';
import { appendAudit, notify } from '../ledger';
import { byId, contractRateFor, listPriceFor, managerOf, recordsOfCustomer, userOfStaff } from '../lookups';
import { queueMessage } from '../outbox';
import { getPolicies } from '../policies';
import type { HookContext } from '../resourceHooks';
import { getResource } from '../registry';
import { insertRecordIn, patchRecordIn, updateRecord } from '../runtime';
import { type Approval, type ApprovalLevel, type Db, ServiceError } from '../types';
import { requestApprovalIn } from '../workflow';
import { computeTotals, describeDiff, diffLines, type LineDiff, type OrderTotals, type QuoteLine } from './lines';
import { CUSTOMS_STATUSES, SO_BEFORE_DISPATCH, SO_PROCESSING_STATUSES } from '../../domain/modules/orders';

const E = L.orders.errors;
const N = L.orders.notices;
const statusLabel = (key: unknown) => (L.orders.masters.soStatus.values as Record<string, string>)[String(key)] ?? String(key);

export const SO = 'salesOrders';
export const APPROVAL = 'salesOrder.approval';
export const HOLD = 'salesOrder.hold';
export const RESUME = 'salesOrder.resume';
export const CANCEL = 'salesOrder.cancel';

const hasResource = (key: string) => appPack.resources.some((r) => r.key === key);
const rows = (d: Db, key: string) => (d.records[key] ?? []) as RecordData[];
const ctxOf = (d: Db, actor: Actor): HookContext => ({ d, actor, correlationId: uid('cor') });

export const linesOf = (r: RecordData | undefined): QuoteLine[] => ((r?.lines as QuoteLine[] | undefined) ?? []).map((l) => ({ ...l }));

// ---------------------------------------------------------------- reads

/** Raw order (with lines) after the same scope check the engine applies. */
export function getOrder(actor: Actor, id: string): RecordData {
  const res = getResource(SO);
  const r = rows(getDb(), SO).find((x) => x.id === id);
  if (!r || !canReadRecord(actor, res, r)) throw new ServiceError('not_found', E.notFound(id));
  return r;
}

/**
 * Commercial changes (lines, payment schedule, hold / resume / cancel, re-submission) belong to the roles
 * that raise sales orders. Import / SCM may update the order only for Order Processing (SO-08, REQUIREMENTS
 * §2.2 "E processing tab only"), so update scope alone is not enough.
 */
export function canEditCommercial(actor: Actor, r: RecordData): boolean {
  return perm(actor, SO).create && canUpdateRecord(actor, getResource(SO), r);
}

function requireUpdatable(actor: Actor, r: RecordData) {
  if (!canEditCommercial(actor, r)) throw new ServiceError('forbidden', E.cannotChange(actor.role.label, String(r.orderNo ?? r.id)));
}

export const milestonesOf = (d: Db, orderId: string) => rows(d, 'paymentMilestones').filter((m) => m.salesOrderId === orderId).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
export const dispatchesOf = (d: Db, orderId: string) => rows(d, 'dispatches').filter((x) => x.salesOrderId === orderId).sort((a, b) => String(b.dispatchDate).localeCompare(String(a.dispatchDate)));
export const contractsOf = (d: Db, orderId: string) => rows(d, 'salesContracts').filter((x) => x.salesOrderId === orderId).sort((a, b) => Number(b.contractVersion) - Number(a.contractVersion));

export interface OrderView {
  order: RecordData;
  lines: QuoteLine[];
  quotation?: RecordData;
  quotationLines: QuoteLine[];
  diff?: LineDiff;
  milestones: RecordData[];
  dispatches: RecordData[];
  contracts: RecordData[];
  approvals: Approval[];
  canEdit: boolean;
  canEditLines: boolean;
}

export function orderView(actor: Actor, id: string): OrderView {
  const d = getDb();
  const order = getOrder(actor, id);
  const quotation = order.quotationId ? byId('quotations', order.quotationId) : undefined;
  const lines = linesOf(order);
  const quotationLines = linesOf(quotation);
  const canEdit = canEditCommercial(actor, order);
  return {
    order,
    lines,
    quotation,
    quotationLines,
    diff: quotation ? diffLines(lines, quotationLines, Number(order.grandTotal), Number(quotation.grandTotal)) : undefined,
    milestones: milestonesOf(d, id),
    dispatches: dispatchesOf(d, id),
    contracts: contractsOf(d, id),
    approvals: d.approvals.filter((a) => a.recordId === id && a.resource === SO).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
    canEdit,
    canEditLines: canEdit && SO_BEFORE_DISPATCH.includes(String(order.status)),
  };
}

// ---------------------------------------------------------------- eligibility (FR-049 / BR-20)

/** Why a quotation cannot become a sales order — or null when it can. */
export function quotationBlocker(d: Db, q: RecordData | undefined): string | null {
  if (!q) return E.quotationNotFound;
  if (q.status !== 'accepted') return E.quotationNotAccepted(String(q.status).replace(/_/g, ' '));
  if (q.isLatest === false) return E.quotationNotLatest;
  const opp = q.opportunityId ? rows(d, 'opportunities').find((o) => o.id === q.opportunityId) : undefined;
  if (opp && opp.stage !== 'won') return E.opportunityNotWon(opp.id);
  const existing = rows(d, SO).find((o) => o.quotationId === q.id && o.status !== 'cancelled');
  if (existing) return E.orderExists(String(existing.orderNo ?? existing.id));
  return null;
}

/** Quotations the actor may convert: accepted, latest, opportunity won, no live order yet. */
export function eligibleQuotations(actor: Actor): RecordData[] {
  if (!hasResource('quotations')) return [];
  const d = getDb();
  const res = getResource('quotations');
  return rows(d, 'quotations')
    .filter((q) => canReadRecord(actor, res, q) && !quotationBlocker(d, q))
    .sort((a, b) => String(b.acceptedAt ?? b.quoteDate).localeCompare(String(a.acceptedAt ?? a.quoteDate)));
}

/** Previous consumables orders the actor can repeat (latest per customer). */
export function repeatableOrders(actor: Actor): RecordData[] {
  const res = getResource(SO);
  const latest = new Map<string, RecordData>();
  rows(getDb(), SO)
    .filter((o) => o.orderKind === 'consumables' && o.status !== 'cancelled' && canReadRecord(actor, res, o))
    .forEach((o) => {
      const k = String(o.customerId);
      const cur = latest.get(k);
      if (!cur || String(o.orderDate) > String(cur.orderDate)) latest.set(k, o);
    });
  return [...latest.values()].sort((a, b) => String(b.orderDate).localeCompare(String(a.orderDate)));
}

export interface OrderDraft {
  source: 'quotation' | 'repeat';
  sourceId: string;
  customerId: string;
  divisionId: string;
  orderKind: 'machine' | 'consumables';
  ownerId: string;
  placeOfSupply: string;
  lines: QuoteLine[];
  /** Per line: where the price came from (repeat orders). */
  priceSource: string[];
  freight: number;
  insurance: number;
  totals: OrderTotals;
  terms: { paymentTerms?: string; deliveryTerms?: string; warrantyTerms?: string; installationTerms?: string };
  quotationTotal?: number;
  quotationLines?: QuoteLine[];
  opportunityId?: string;
  productId?: string;
  siteAddresses: RecordData[];
  /** Customer name resolved here: a sales user may own the quotation without owning the customer record. */
  customerName: string;
  /** Customer PO captured when the quotation was accepted (QUO-11 / SO-02), so it is not entered twice. */
  po?: { customerPoNo: string; customerPoDate: string; poFileName: string };
  blocker: string | null;
}

/** Display name of a customer for order screens (falls back to the id). */
export const customerNameOf = (id: unknown) => String(byId('customers', id)?.name ?? id ?? '');

const MACHINE_TYPES = ['machine'];

function mainProduct(lines: QuoteLine[]): string | undefined {
  const products = rows(getDb(), 'products');
  const machine = lines.find((l) => MACHINE_TYPES.includes(String(products.find((p) => p.id === l.productId)?.productType ?? l.lineType)));
  return machine?.productId ?? lines[0]?.productId;
}

function kindOf(lines: QuoteLine[]): 'machine' | 'consumables' {
  const products = rows(getDb(), 'products');
  return lines.some((l) => l.lineType === 'machine' || products.find((p) => p.id === l.productId)?.productType === 'machine') ? 'machine' : 'consumables';
}

export function draftFromQuotation(actor: Actor, quotationId: string): OrderDraft {
  const d = getDb();
  if (!hasResource('quotations')) throw new ServiceError('not_found', E.quotationsUnavailable);
  const q = rows(d, 'quotations').find((x) => x.id === quotationId);
  if (!q || !canReadRecord(actor, getResource('quotations'), q)) throw new ServiceError('not_found', E.quotationNotFoundId(quotationId));
  const lines = linesOf(q);
  const customer = byId('customers', q.customerId);
  const placeOfSupply = String(q.placeOfSupply ?? customer?.billingState ?? getPolicies().companyGstState);
  return {
    source: 'quotation',
    sourceId: q.id,
    customerId: String(q.customerId),
    divisionId: String(q.divisionId),
    orderKind: kindOf(lines),
    ownerId: String(q.ownerId ?? actor.staffId),
    placeOfSupply,
    lines,
    priceSource: lines.map(() => L.orders.lines.priceSource.quotation),
    freight: Number(q.freight) || 0,
    insurance: Number(q.insurance) || 0,
    totals: computeTotals(lines, placeOfSupply, Number(q.freight) || 0, Number(q.insurance) || 0),
    terms: { paymentTerms: q.paymentTerms as string, deliveryTerms: q.deliveryTerms as string, warrantyTerms: q.warrantyTerms as string, installationTerms: q.installationTerms as string },
    quotationTotal: Number(q.grandTotal) || undefined,
    quotationLines: lines,
    opportunityId: q.opportunityId as string,
    productId: mainProduct(lines),
    siteAddresses: recordsOfCustomer('addresses', String(q.customerId)),
    customerName: customerNameOf(q.customerId),
    po: q.customerPoNo ? { customerPoNo: String(q.customerPoNo), customerPoDate: String(q.customerPoDate ?? ''), poFileName: String(q.poFileName ?? '') } : undefined,
    blocker: quotationBlocker(d, q),
  };
}

/** CON-02: repeat a consumables order at today's rate contract (if any), else today's list price. */
export function draftFromRepeat(actor: Actor, orderId: string): OrderDraft {
  const prev = getOrder(actor, orderId);
  if (prev.orderKind !== 'consumables') throw new ServiceError('invalid_state', E.onlyConsumablesRepeat);
  const today = todayKey();
  const priceSource: string[] = [];
  const lines = linesOf(prev).map((l) => {
    const rate = contractRateFor(String(prev.customerId), l.productId, today);
    const lp = listPriceFor(l.productId, today);
    if (rate !== null) {
      priceSource.push(L.orders.lines.priceSource.rateContract);
      return { ...l, listPrice: rate, discountPct: 0, discountAmt: 0 };
    }
    if (lp) {
      priceSource.push(L.orders.lines.priceSource.priceList);
      return { ...l, listPrice: lp.listPrice };
    }
    priceSource.push(L.orders.lines.priceSource.previous);
    return l;
  });
  const placeOfSupply = String(prev.placeOfSupply);
  return {
    source: 'repeat',
    sourceId: prev.id,
    customerId: String(prev.customerId),
    divisionId: String(prev.divisionId),
    orderKind: 'consumables',
    ownerId: String(prev.ownerId),
    placeOfSupply,
    lines,
    priceSource,
    freight: Number(prev.freight) || 0,
    insurance: 0,
    totals: computeTotals(lines, placeOfSupply, Number(prev.freight) || 0, 0),
    terms: { paymentTerms: prev.paymentTerms as string, deliveryTerms: prev.deliveryTerms as string },
    productId: mainProduct(lines),
    siteAddresses: recordsOfCustomer('addresses', String(prev.customerId)),
    customerName: customerNameOf(prev.customerId),
    blocker: null,
  };
}

// ---------------------------------------------------------------- validation helpers

const ALLOWED_PO = /\.(pdf|jpe?g|png)$/i;

export interface PoInput {
  customerPoNo: string;
  customerPoDate: string;
  poFileName: string;
  poFileSize?: number;
}

/** BR-21: PO number, PO date (not in the future) and PO copy are mandatory. */
export function validatePo(po: PoInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (!po.customerPoNo?.trim()) e.customerPoNo = E.poRequired;
  else if (po.customerPoNo.trim().length > 40) e.customerPoNo = E.maxChars(40);
  if (!po.customerPoDate) e.customerPoDate = E.poDateRequired;
  else if (po.customerPoDate > todayKey()) e.customerPoDate = E.poDateFuture;
  if (!po.poFileName?.trim()) e.poFileName = E.poFileRequired;
  else if (!ALLOWED_PO.test(po.poFileName)) e.poFileName = E.fileType;
  else if ((po.poFileSize ?? 0) > getPolicies().maxFileMb * 1024 * 1024) e.poFileName = E.fileSize(getPolicies().maxFileMb);
  return e;
}

export function validateLines(lines: QuoteLine[]): string | null {
  if (!lines.length) return E.addLine;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!(Number(l.qty) > 0)) return E.lineQty(i + 1);
    if (!(Number(l.listPrice) >= 0)) return E.linePrice(i + 1);
    const pct = Number(l.discountPct) || 0;
    if (pct < 0 || pct > 100) return E.lineDiscountRange(i + 1);
    if ((Number(l.discountAmt) || 0) > Number(l.qty) * Number(l.listPrice)) return E.lineDiscountMax(i + 1);
  }
  return null;
}

/**
 * Users change quantities and discounts only. Prices, tax rates and HSN/SAC always come from the
 * reference line (accepted quotation / previous order) or, for a newly added product, today's
 * price list (QUO-05: sales users cannot edit list prices).
 */
export function sanitizeLines(input: QuoteLine[], reference: QuoteLine[]): QuoteLine[] {
  const refBy = new Map(reference.map((l) => [l.productId, l]));
  const products = rows(getDb(), 'products');
  return input.map((l, i) => {
    const ref = refBy.get(l.productId);
    const qty = Number(l.qty);
    const discountPct = Math.round((Number(l.discountPct) || 0) * 100) / 100;
    const discountAmt = Math.round((Number(l.discountAmt) || 0) * 100) / 100;
    if (ref) return { ...ref, qty, discountPct, discountAmt };
    const product = products.find((p) => p.id === l.productId);
    const price = listPriceFor(l.productId);
    if (!product || !price) throw new ServiceError('validation', E.lineNoPrice(i + 1));
    return {
      productId: l.productId,
      description: String(product.name),
      lineType: String(product.productType ?? 'other'),
      qty,
      listPrice: price.listPrice,
      discountPct,
      discountAmt,
      hsnSac: String(product.hsnSac ?? ''),
      gstRate: Number(product.gstRate) || 18,
      landedCost: price.landedCost,
    };
  });
}

// ---------------------------------------------------------------- approval levels (FR-052 / BR-23)

const MANAGER_LEVEL: ApprovalLevel = { capability: 'orders.approve.manager', label: L.roles.approvalLevels[1] };
const L2: ApprovalLevel = { capability: 'approve.l2', label: L.roles.approvalLevels[2] };
const L3: ApprovalLevel = { capability: 'approve.l3', label: L.roles.approvalLevels[3] };
const FINANCE: ApprovalLevel = { capability: 'approve.finance', label: L.orders.approvals.finance };

/**
 * SO-04: the requester's direct reporting manager decides (pinned by employee id). Their role
 * gives the label and capability: sales manager → division head → management.
 */
export function managerLevel(d: Db, requesterStaffId: string): ApprovalLevel {
  const mgr = managerOf(requesterStaffId, d.records);
  const emp = mgr ? rows(d, 'employees').find((e) => e.id === mgr && e.status !== 'inactive') : undefined;
  const role = emp?.roleId as string | undefined;
  const base = role === 'sales_manager' ? MANAGER_LEVEL : role === 'division_head' ? L2 : L3;
  if (!emp || !['sales_manager', 'division_head', 'management'].includes(String(role))) return base;
  return { ...base, label: `${base.label.replace(/ \(.*\)$/, '')} — ${emp.fullName}`, approverStaffId: emp.id };
}

/** BR-23: finance check when the advance is below policy or the customer already has overdue amounts. */
export function needsFinanceCheck(d: Db, order: RecordData): boolean {
  const advance = milestonesOf(d, order.id)[0];
  const advancePct = advance ? Number(advance.percent) || 0 : 0;
  const customer = rows(d, 'customers').find((c) => c.id === order.customerId);
  return advancePct < getPolicies().soFinanceCheckAdvancePct || Number(customer?.overdue ?? 0) > 0;
}

/** The order owner's reporting manager; if that is the requester (separation of duties), the next level up. */
function orderManagerLevel(ctx: HookContext, order: RecordData): ApprovalLevel {
  const lvl = managerLevel(ctx.d, String(order.ownerId));
  return lvl.approverStaffId === ctx.actor.staffId ? managerLevel(ctx.d, ctx.actor.staffId) : lvl;
}

function withdrawPending(ctx: HookContext, orderId: string, type: string, why: string) {
  ctx.d.approvals
    .filter((a) => a.recordId === orderId && a.type === type && a.status === 'pending')
    .forEach((a) => {
      a.status = 'withdrawn';
      a.version++;
      appendAudit(ctx.d, ctx.actor, { action: 'approval.withdrawn', actorType: 'workflow', resource: SO, recordId: orderId, summary: N.withdrew(a.id, why), correlationId: ctx.correlationId });
    });
}

function requestOrderApproval(ctx: HookContext, order: RecordData, reason: string) {
  const finance = needsFinanceCheck(ctx.d, order);
  patchRecordIn(ctx, SO, order.id, { financeCheck: finance }, finance ? N.financeLog : undefined);
  return requestApprovalIn(ctx, {
    type: APPROVAL,
    resource: SO,
    recordId: order.id,
    reason,
    summary: L.orders.approvals.summary(String(order.orderNo), formatMoney(Number(order.grandTotal))),
    amount: Number(order.grandTotal),
    divisionIds: [String(order.divisionId)],
    levels: finance ? [orderManagerLevel(ctx, order), FINANCE] : [orderManagerLevel(ctx, order)],
  });
}

// ---------------------------------------------------------------- create (FR-049/050, CON-02)

function nextOrderNo(d: Db, divisionId: string) {
  const fy = fyLabel();
  const k = `soNo:${divisionId}:${fy}`;
  d.counters[k] = (d.counters[k] ?? 0) + 1;
  return `SO/${divisionId}/${fy}/${String(d.counters[k]).padStart(4, '0')}`;
}

/** Default schedule (BR-25): machines 30 / 60 / 10, consumables 100 % on 30-day credit. Editable on the Payments tab. */
export function defaultSchedule(kind: string, orderDate: string): { label: string; percent: number; dueDate: string }[] {
  return kind === 'machine'
    ? [
        { label: L.orders.schedule.advance, percent: 30, dueDate: addDays(orderDate, 7) },
        { label: L.orders.schedule.beforeDispatch, percent: 60, dueDate: addDays(orderDate, 45) },
        { label: L.orders.schedule.onInstallation, percent: 10, dueDate: addDays(orderDate, 75) },
      ]
    : [{ label: L.orders.schedule.credit, percent: 100, dueDate: addDays(orderDate, 30) }];
}

function writeSchedule(ctx: HookContext, order: RecordData, schedule: { label: string; percent: number; dueDate: string; id?: string }[]) {
  const total = Number(order.grandTotal) || 0;
  let allocated = 0;
  schedule.forEach((s, i) => {
    const amount = i === schedule.length - 1 ? Math.round((total - allocated) * 100) / 100 : Math.round(((total * s.percent) / 100) * 100) / 100;
    allocated += amount;
    const base = { label: s.label, percent: s.percent, amount, dueDate: s.dueDate };
    if (s.id) patchRecordIn(ctx, 'paymentMilestones', s.id, base);
    else
      insertRecordIn(ctx, 'paymentMilestones', {
        ...base,
        salesOrderId: order.id,
        customerId: order.customerId,
        ownerId: order.ownerId,
        divisionId: order.divisionId,
        receivedAmount: 0,
        status: s.dueDate < todayKey() ? 'overdue' : 'due',
      });
  });
}

export interface CreateOrderInput extends PoInput {
  source: 'quotation' | 'repeat';
  sourceId: string;
  lines: QuoteLine[];
  siteAddressId?: string;
  idempotencyKey: string;
}

export function createOrder(actor: Actor, input: CreateOrderInput): RecordData {
  if (!perm(actor, SO).create) throw new ServiceError('forbidden', E.cannotCreate(actor.role.label));
  // A repeated submit (double click, retry after a timeout) returns the order it already created.
  const done = getDb().idempotency[input.idempotencyKey];
  const already = done ? rows(getDb(), SO).find((x) => x.id === done) : undefined;
  if (already && canReadRecord(actor, getResource(SO), already)) return already;
  const draft = input.source === 'quotation' ? draftFromQuotation(actor, input.sourceId) : draftFromRepeat(actor, input.sourceId);
  if (draft.blocker) throw new ServiceError('invalid_state', draft.blocker);
  const errors = validatePo(input);
  if (Object.keys(errors).length) throw new ServiceError('validation', E.fixFields, { fieldErrors: errors });
  const lines = sanitizeLines(input.lines, draft.lines);
  const lineErr = validateLines(lines);
  if (lineErr) throw new ServiceError('validation', lineErr);
  if (input.siteAddressId && !draft.siteAddresses.some((a) => a.id === input.siteAddressId)) throw new ServiceError('validation', E.siteInvalid, { fieldErrors: { siteAddressId: E.siteNotCustomer } });
  // The installation job (INS-05) needs a site: machine orders must name one of the customer's addresses.
  if (draft.orderKind === 'machine' && !input.siteAddressId) throw new ServiceError('validation', E.fixFields, { fieldErrors: { siteAddressId: draft.siteAddresses.length ? E.siteRequired : E.siteNoAddresses } });

  return commit((d) => {
    const existing = d.idempotency[input.idempotencyKey];
    if (existing) {
      const r = rows(d, SO).find((x) => x.id === existing);
      if (r) return r;
    }
    const ctx = ctxOf(d, actor);
    const totals = computeTotals(lines, draft.placeOfSupply, draft.freight, draft.insurance);
    const diff = draft.quotationLines ? diffLines(lines, draft.quotationLines, totals.grandTotal, draft.quotationTotal ?? totals.grandTotal) : undefined;
    const orderDate = todayKey();
    const created = insertRecordIn(ctx, SO, {
      orderNo: nextOrderNo(d, draft.divisionId),
      customerId: draft.customerId,
      orderKind: draft.orderKind,
      divisionId: draft.divisionId,
      ownerId: draft.ownerId,
      orderDate,
      quotationId: draft.source === 'quotation' ? draft.sourceId : null,
      opportunityId: draft.opportunityId ?? null,
      repeatOfId: draft.source === 'repeat' ? draft.sourceId : null,
      customerPoNo: input.customerPoNo.trim(),
      customerPoDate: input.customerPoDate,
      poFileName: input.poFileName.trim(),
      productId: draft.productId ?? null,
      siteAddressId: input.siteAddressId || null,
      placeOfSupply: draft.placeOfSupply,
      ...totals,
      changeSummary: diff ? describeDiff(diff) : L.orders.diff.repeat,
      ...draft.terms,
      status: 'pending_approval',
      financeCheck: false,
    });
    const order = patchRecordIn(ctx, SO, created.id, { lines }, N.linesCaptured(lines.length));
    writeSchedule(ctx, order, defaultSchedule(draft.orderKind, orderDate));
    d.idempotency[input.idempotencyKey] = order.id;
    appendAudit(d, actor, { action: 'salesOrder.created', resource: SO, recordId: order.id, summary: N.createdLog(String(order.orderNo), draft.source === 'quotation' ? N.fromQuotation(draft.sourceId) : N.fromPrevious(draft.sourceId), input.customerPoNo), correlationId: ctx.correlationId });
    requestOrderApproval(ctx, order, draft.source === 'quotation' ? L.orders.approvals.reasonNew(diff ? describeDiff(diff) : '') : L.orders.approvals.reasonRepeat);
    return rows(d, SO).find((x) => x.id === order.id)!;
  });
}

/** Re-request approval for an order still pending (e.g. after a rejection or seeded without a request). */
export function submitForApproval(actor: Actor, id: string, note: string): Approval {
  return commit((d) => {
    const order = rows(d, SO).find((x) => x.id === id);
    if (!order || !canReadRecord(actor, getResource(SO), order)) throw new ServiceError('not_found', E.notFound(id));
    requireUpdatable(actor, order);
    if (order.status !== 'pending_approval') throw new ServiceError('invalid_state', E.submitOnlyPending);
    return requestOrderApproval(ctxOf(d, actor), order, note.trim() || L.orders.approvals.reasonResubmit);
  });
}

// ---------------------------------------------------------------- edit lines (FR-051 / BR-22)

export function updateLines(actor: Actor, id: string, input: { lines: QuoteLine[]; freight: number; insurance: number; version: number; note?: string }): { reapproval: boolean; summary: string } {
  if ((Number(input.freight) || 0) < 0 || (Number(input.insurance) || 0) < 0) throw new ServiceError('validation', E.negativeExtras);
  return commit((d) => {
    const order = rows(d, SO).find((x) => x.id === id);
    if (!order || !canReadRecord(actor, getResource(SO), order)) throw new ServiceError('not_found', E.notFound(id));
    requireUpdatable(actor, order);
    if (!SO_BEFORE_DISPATCH.includes(String(order.status))) throw new ServiceError('invalid_state', E.linesBeforeDispatch);
    if (order.version !== input.version) throw new ServiceError('version_conflict', E.versionConflict(String(order.orderNo)));
    const ctx = ctxOf(d, actor);
    const quotation = order.quotationId ? rows(d, 'quotations').find((q) => q.id === order.quotationId) : undefined;
    const lines = sanitizeLines(input.lines, [...linesOf(order), ...linesOf(quotation).filter((q) => !linesOf(order).some((o) => o.productId === q.productId))]);
    const lineErr = validateLines(lines);
    if (lineErr) throw new ServiceError('validation', lineErr);
    const totals = computeTotals(lines, String(order.placeOfSupply), input.freight, input.insurance);
    // Reference: the accepted quotation; repeat orders compare with their own previous lines.
    const refLines = quotation ? linesOf(quotation) : linesOf(order);
    const refTotal = quotation ? Number(quotation.grandTotal) : Number(order.grandTotal);
    const diff = diffLines(lines, refLines, totals.grandTotal, refTotal);
    const tol = getPolicies().soTolerancePct;
    const reasons: string[] = [];
    if (diff.added.length || diff.removed.length) reasons.push(L.orders.diff.reasonLines);
    if (Math.abs(diff.valueChangePct) > tol) reasons.push(L.orders.diff.reasonValue(diff.valueChangePct, tol));
    if (diff.discountIncreased) reasons.push(L.orders.diff.reasonDiscount);
    const reapproval = reasons.length > 0 && order.status !== 'pending_approval';
    const summary = quotation ? describeDiff(diff) : reasons.length ? reasons.join(', ') : L.orders.diff.noSignificant;
    const next = patchRecordIn(ctx, SO, id, { ...totals, lines, changeSummary: summary, productId: mainProduct(lines) ?? order.productId, ...(reapproval ? { status: 'pending_approval' } : {}) }, N.linesEdited(summary));
    // Re-split unpaid milestones on the new value (received ones keep their amount).
    const ms = milestonesOf(d, id);
    if (ms.length && !ms.some((m) => Number(m.receivedAmount) > 0)) writeSchedule(ctx, next, ms.map((m) => ({ id: m.id, label: String(m.label), percent: Number(m.percent), dueDate: String(m.dueDate) })));
    if (reapproval || (order.status === 'pending_approval' && reasons.length)) {
      withdrawPending(ctx, id, APPROVAL, L.orders.approvals.withdrawnChanged);
      requestOrderApproval(ctx, next, L.orders.approvals.reasonChanged(reasons.join(', '), input.note ?? ''));
    }
    return { reapproval: reapproval || (order.status === 'pending_approval' && reasons.length > 0), summary };
  });
}

// ---------------------------------------------------------------- approval outcomes

function notifyOwner(ctx: HookContext, order: RecordData, title: string, kind: 'info' | 'reminder' | 'exception' = 'info') {
  const u = userOfStaff(order.ownerId);
  if (u) notify(ctx.d, { userId: u.id, workspaceId: order.workspaceId, kind, title, link: { resource: SO, recordId: order.id } });
}

/** Customer contact for messages: prefers a contact who consented to WhatsApp / email. */
function customerContact(d: Db, customerId: unknown): { whatsapp?: string; email?: string; name?: string } {
  const cs = rows(d, 'contacts').filter((c) => c.customerId === customerId);
  const wa = cs.find((c) => c.consentWhatsapp && (c.whatsapp || c.mobile));
  const em = cs.find((c) => c.consentEmail && c.email);
  return { whatsapp: (wa?.whatsapp ?? wa?.mobile) as string | undefined, email: em?.email as string | undefined, name: (wa?.name ?? em?.name) as string | undefined };
}

/** Advance unpaid → payment pending; otherwise confirmed. */
function paymentStatusAfterApproval(d: Db, orderId: string): 'confirmed' | 'payment_pending' | 'payment_received' {
  const advance = milestonesOf(d, orderId)[0];
  if (!advance || Number(advance.percent) === 100) return 'confirmed';
  const received = Number(advance.receivedAmount) || 0;
  if (received >= Number(advance.amount) - 0.01) return 'payment_received';
  return 'payment_pending';
}

/** BRD gap G2 (assumption): a prospect becomes an Active Customer on its first approved (confirmed) sales order. */
function activateCustomer(ctx: HookContext, order: RecordData) {
  const c = rows(ctx.d, 'customers').find((x) => x.id === order.customerId);
  if (c?.category === 'prospect') patchRecordIn(ctx, 'customers', c.id, { category: 'active' }, N.becameActive(String(order.orderNo ?? order.id)));
}

export function onOrderApproved(ctx: HookContext, a: Approval) {
  const order = rows(ctx.d, SO).find((x) => x.id === a.recordId);
  if (order && ['on_hold', 'pending_approval'].includes(String(order.status))) activateCustomer(ctx, order);
  // Approved while on hold: the order resumes into the approved status instead of Pending Approval.
  if (order?.status === 'on_hold' && order.statusBeforeHold === 'pending_approval') {
    const status = paymentStatusAfterApproval(ctx.d, order.id);
    patchRecordIn(ctx, SO, order.id, { statusBeforeHold: status, erpPushedAt: nowIso() }, N.approvedLog(a.id, statusLabel(status)));
    notifyOwner(ctx, order, N.approved(String(order.orderNo)));
    return;
  }
  if (!order || order.status !== 'pending_approval') return;
  const status = paymentStatusAfterApproval(ctx.d, order.id);
  const next = patchRecordIn(ctx, SO, order.id, { status, erpPushedAt: nowIso() }, N.approvedLog(a.id, statusLabel(status)));
  notifyOwner(ctx, next, N.approved(String(order.orderNo)));
  const c = customerContact(ctx.d, order.customerId);
  if (c.email) queueMessage(ctx, { channel: 'email', to: c.email, subject: N.confirmationSubject(String(order.orderNo)), body: N.confirmationBody(c.name ?? N.customer, String(order.customerPoNo), String(order.orderNo), formatMoney(Number(order.grandTotal))), related: { resource: SO, recordId: order.id } });
}

export function onHoldApproved(ctx: HookContext, a: Approval) {
  const order = rows(ctx.d, SO).find((x) => x.id === a.recordId);
  if (!order || !SO_BEFORE_DISPATCH.includes(String(order.status))) return;
  patchRecordIn(ctx, SO, order.id, { status: 'on_hold', statusBeforeHold: order.status, holdReason: a.reason }, N.heldLog(a.id, a.reason));
  notifyOwner(ctx, order, N.held(String(order.orderNo)), 'exception');
}

export function onResumeApproved(ctx: HookContext, a: Approval) {
  const order = rows(ctx.d, SO).find((x) => x.id === a.recordId);
  if (!order || order.status !== 'on_hold') return;
  let back = String(order.statusBeforeHold || 'confirmed');
  // The advance may have been received from the ERP while the order was on hold.
  if (back === 'payment_pending' && paymentStatusAfterApproval(ctx.d, order.id) === 'payment_received') back = 'payment_received';
  patchRecordIn(ctx, SO, order.id, { status: back, statusBeforeHold: null, holdReason: null }, N.resumedLog(a.id, statusLabel(back)));
  notifyOwner(ctx, order, N.resumed(String(order.orderNo)));
}

export function onCancelApproved(ctx: HookContext, a: Approval) {
  const order = rows(ctx.d, SO).find((x) => x.id === a.recordId);
  if (!order || !(SO_BEFORE_DISPATCH.includes(String(order.status)) || order.status === 'on_hold')) return;
  patchRecordIn(ctx, SO, order.id, { status: 'cancelled', cancelReason: a.reason }, N.cancelledLog(a.id, a.reason));
  [APPROVAL, HOLD, RESUME].forEach((type) => withdrawPending(ctx, order.id, type, L.orders.approvals.withdrawnCancelled));
  notifyOwner(ctx, order, N.cancelled(String(order.orderNo)), 'exception');
}

// ---------------------------------------------------------------- hold / resume / cancel (FR-058)

export function requestStatusChange(actor: Actor, id: string, kind: 'hold' | 'resume' | 'cancel', reason: string): Approval {
  const text = reason.trim();
  if (text.length < 5) throw new ServiceError('validation', E.reasonMin, { fieldErrors: { reason: E.reasonMinField } });
  return commit((d) => {
    const order = rows(d, SO).find((x) => x.id === id);
    if (!order || !canReadRecord(actor, getResource(SO), order)) throw new ServiceError('not_found', E.notFound(id));
    requireUpdatable(actor, order);
    const status = String(order.status);
    if (kind === 'hold' && !SO_BEFORE_DISPATCH.includes(status)) throw new ServiceError('invalid_state', E.holdOnlyBeforeDispatch);
    if (kind === 'cancel' && !(SO_BEFORE_DISPATCH.includes(status) || status === 'on_hold')) throw new ServiceError('invalid_state', E.cancelNotAllowed);
    if (kind === 'resume' && status !== 'on_hold') throw new ServiceError('invalid_state', E.resumeOnlyHold);
    const ctx = ctxOf(d, actor);
    const mgr = orderManagerLevel(ctx, order);
    // Cancellation always reaches the division head (or management above them).
    const levels = kind === 'cancel' && mgr.capability === MANAGER_LEVEL.capability ? [mgr, L2] : [mgr];
    const type = kind === 'hold' ? HOLD : kind === 'resume' ? RESUME : CANCEL;
    return requestApprovalIn(ctx, { type, resource: SO, recordId: id, reason: text, summary: L.orders.approvals.statusSummary(kind, String(order.orderNo)), amount: Number(order.grandTotal), divisionIds: [String(order.divisionId)], levels });
  });
}

// ---------------------------------------------------------------- ERP (SO-09 / FR-057, simulated)

/** "Push to ERP": sends the approved order to the ERP and receives invoice number, date and e-way bill reference. */
export function pushToErp(actor: Actor, id: string): RecordData {
  if (!can(actor, 'orders.erp')) throw new ServiceError('forbidden', E.erpForbidden);
  return commit((d) => {
    const order = rows(d, SO).find((x) => x.id === id);
    if (!order || !canReadRecord(actor, getResource(SO), order)) throw new ServiceError('not_found', E.notFound(id));
    if (['pending_approval', 'cancelled'].includes(String(order.status))) throw new ServiceError('invalid_state', E.erpNotApproved);
    const ctx = ctxOf(d, actor);
    const patch: Record<string, unknown> = { erpPushedAt: order.erpPushedAt ?? nowIso() };
    if (!order.invoiceNo) {
      const k = `invoice:${order.divisionId}:${fyLabel()}`;
      d.counters[k] = (d.counters[k] ?? 0) + 1;
      patch.invoiceNo = `INV/${order.divisionId}/${fyLabel()}/${String(d.counters[k]).padStart(5, '0')}`;
      patch.invoiceDate = todayKey();
      patch.ewayBill = String(Math.floor(100000000000 + Math.abs(hash(order.id)) % 899999999999));
    }
    return patchRecordIn(ctx, SO, id, patch, N.erpLog);
  });
}

function hash(s: string) {
  let h = 7;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

// ---------------------------------------------------------------- payments (FR-055 / BR-25)

const round2 = (n: number) => Math.round(n * 100) / 100;

function milestoneStatus(m: RecordData, today = todayKey()): string {
  const rec = Number(m.receivedAmount) || 0;
  if (rec >= Number(m.amount) - 0.01) return 'received';
  if (String(m.dueDate) < today) return 'overdue';
  return rec > 0 ? 'partly_received' : 'due';
}

export interface ScheduleRow {
  id?: string;
  label: string;
  percent: number;
  dueDate: string;
}

export function saveSchedule(actor: Actor, id: string, schedule: ScheduleRow[]) {
  const errors: string[] = [];
  if (!schedule.length) errors.push(E.scheduleAddOne);
  schedule.forEach((s, i) => {
    if (!s.label.trim()) errors.push(E.scheduleLabel(i + 1));
    if (!(s.percent > 0)) errors.push(E.scheduleShare(i + 1));
    if (!s.dueDate) errors.push(E.scheduleDue(i + 1));
  });
  const total = round2(schedule.reduce((t, s) => t + (Number(s.percent) || 0), 0));
  if (Math.abs(total - 100) > 0.01) errors.push(E.scheduleTotal(total));
  if (errors.length) throw new ServiceError('validation', errors.join(' '));
  commit((d) => {
    const order = rows(d, SO).find((x) => x.id === id);
    if (!order || !canReadRecord(actor, getResource(SO), order)) throw new ServiceError('not_found', E.notFound(id));
    requireUpdatable(actor, order);
    if (['completed', 'cancelled'].includes(String(order.status))) throw new ServiceError('invalid_state', E.scheduleClosed);
    if (schedule.some((s) => s.dueDate < String(order.orderDate))) throw new ServiceError('validation', E.scheduleBeforeOrder);
    const ctx = ctxOf(d, actor);
    const existing = milestonesOf(d, id);
    const kept = new Set(schedule.map((s) => s.id).filter(Boolean));
    const receivedRemoved = existing.filter((m) => !kept.has(m.id) && Number(m.receivedAmount) > 0);
    if (receivedRemoved.length) throw new ServiceError('invalid_state', E.scheduleHasReceipts(String(receivedRemoved[0].label)));
    d.records.paymentMilestones = rows(d, 'paymentMilestones').filter((m) => m.salesOrderId !== id || kept.has(m.id));
    writeSchedule(ctx, order, schedule);
    milestonesOf(d, id).forEach((m) => {
      if (Number(m.receivedAmount) > Number(m.amount) + 0.01) throw new ServiceError('validation', E.scheduleBelowReceived(String(m.label)));
      const st = milestoneStatus(m);
      if (st !== m.status) patchRecordIn(ctx, 'paymentMilestones', m.id, { status: st });
    });
    appendAudit(d, actor, { action: 'salesOrder.schedule', resource: SO, recordId: id, summary: N.scheduleLog(schedule.map((s) => `${s.label} ${s.percent}%`).join(', ')), correlationId: ctx.correlationId });
  });
}

/** Receipt from the ERP (simulated: Accounts enters what the ERP reported). Moves the order to payment received. */
export function recordReceipt(actor: Actor, milestoneId: string, amount: number, receivedAt: string) {
  if (!can(actor, 'orders.receipts')) throw new ServiceError('forbidden', E.receiptsForbidden);
  if (!(amount > 0)) throw new ServiceError('validation', E.amountPositive, { fieldErrors: { amount: E.amountPositiveField } });
  if (!receivedAt || receivedAt > todayKey()) throw new ServiceError('validation', E.receiptFuture, { fieldErrors: { receivedAt: E.notInFuture } });
  commit((d) => {
    const m = rows(d, 'paymentMilestones').find((x) => x.id === milestoneId);
    if (!m) throw new ServiceError('not_found', E.milestoneNotFound);
    const order = rows(d, SO).find((x) => x.id === m.salesOrderId);
    if (!order || ['pending_approval', 'cancelled'].includes(String(order.status))) throw new ServiceError('invalid_state', E.receiptsApprovedOnly);
    const remaining = round2(Number(m.amount) - (Number(m.receivedAmount) || 0));
    if (amount > remaining + 0.01) throw new ServiceError('validation', E.receiptMax(formatMoney(remaining)), { fieldErrors: { amount: E.receiptMaxField(formatMoney(remaining)) } });
    const ctx = ctxOf(d, actor);
    const updated = { ...m, receivedAmount: round2((Number(m.receivedAmount) || 0) + amount), receivedAt };
    patchRecordIn(ctx, 'paymentMilestones', m.id, { receivedAmount: updated.receivedAmount, receivedAt, status: milestoneStatus(updated) }, N.receiptLog(formatMoney(amount)));
    if (order.status === 'payment_pending' && paymentStatusAfterApproval(d, order.id) === 'payment_received') {
      patchRecordIn(ctx, SO, order.id, { status: 'payment_received' }, N.advanceLog);
      notifyOwner(ctx, order, N.advanceReceived(String(order.orderNo)));
    }
  });
}

/**
 * BR-25 reminder sweep: owner reminded N days before a due date and again when overdue (weekly);
 * overdue reminders also go to the owner's manager and, with consent, to the customer (simulated).
 * Idempotent: reminders are stamped on the milestone.
 */
export function runPaymentReminders(actor: Actor): { reminded: number; overdue: number } {
  const today = todayKey();
  const before = getPolicies().paymentReminderDaysBefore;
  let reminded = 0;
  let overdue = 0;
  commit((d) => {
    const ctx = ctxOf(d, actor);
    rows(d, 'paymentMilestones').forEach((m) => {
      const order = rows(d, SO).find((o) => o.id === m.salesOrderId);
      if (!order || ['pending_approval', 'cancelled'].includes(String(order.status))) return;
      const st = milestoneStatus(m, today);
      if (st !== m.status) patchRecordIn(ctx, 'paymentMilestones', m.id, { status: st });
      if (st === 'received') return;
      const last = m.lastReminderAt ? String(m.lastReminderAt).slice(0, 10) : '';
      const dueSoon = String(m.dueDate) >= today && String(m.dueDate) <= addDays(today, before);
      const isOverdue = st === 'overdue';
      if (isOverdue) overdue++;
      const stale = !last || last <= addDays(today, -7);
      if (!(dueSoon && !last) && !(isOverdue && stale)) return;
      const outstanding = formatMoney(round2(Number(m.amount) - (Number(m.receivedAmount) || 0)));
      notifyOwner(ctx, order, isOverdue ? N.overdue(String(m.label), outstanding, String(order.orderNo)) : N.dueOn(String(m.dueDate), String(m.label), outstanding, String(order.orderNo)), 'reminder');
      if (isOverdue) {
        const mgr = userOfStaff(managerOf(order.ownerId, d.records));
        if (mgr) notify(d, { userId: mgr.id, workspaceId: order.workspaceId, kind: 'reminder', title: N.teamOverdue(String(m.label), outstanding, String(order.orderNo)), link: { resource: SO, recordId: order.id } });
        const c = customerContact(d, order.customerId);
        if (c.whatsapp) queueMessage(ctx, { channel: 'whatsapp', to: c.whatsapp, body: N.reminderWhatsapp(String(m.label), outstanding, String(order.orderNo), String(m.dueDate)), related: { resource: SO, recordId: order.id } });
      }
      patchRecordIn(ctx, 'paymentMilestones', m.id, { lastReminderAt: nowIso() }, isOverdue ? N.overdueReminderLog : N.dueReminderLog);
      reminded++;
    });
  });
  return { reminded, overdue };
}

// ---------------------------------------------------------------- dispatch & delivery (FR-060 / FR-061 / BR-26)

export interface DispatchInput {
  dispatchDate: string;
  transporter: string;
  lrNumber: string;
  challanNo?: string;
  invoiceRef?: string;
  ewayBill?: string;
  expectedDelivery: string;
  notifyCustomer: boolean;
}

export function recordDispatch(actor: Actor, id: string, input: DispatchInput): RecordData {
  if (!can(actor, 'orders.dispatch')) throw new ServiceError('forbidden', E.dispatchForbidden);
  const e: Record<string, string> = {};
  if (!input.dispatchDate) e.dispatchDate = E.dispatchDateRequired;
  else if (input.dispatchDate > todayKey()) e.dispatchDate = E.dispatchDateFuture;
  if (!input.transporter?.trim()) e.transporter = E.transporterRequired;
  if (!input.lrNumber?.trim()) e.lrNumber = E.lrRequired;
  const ewayBill = input.ewayBill?.trim() ?? '';
  if (ewayBill && !/^[0-9]{12}$/.test(ewayBill)) e.ewayBill = E.ewayDigits;
  if ((input.transporter?.trim().length ?? 0) > 80) e.transporter = E.maxChars(80);
  if ((input.lrNumber?.trim().length ?? 0) > 40) e.lrNumber = E.maxChars(40);
  if ((input.challanNo?.trim().length ?? 0) > 40) e.challanNo = E.maxChars(40);
  if ((input.invoiceRef?.trim().length ?? 0) > 40) e.invoiceRef = E.maxChars(40);
  if (!input.expectedDelivery) e.expectedDelivery = E.expectedRequired;
  else if (input.dispatchDate && input.expectedDelivery < input.dispatchDate) e.expectedDelivery = E.expectedBeforeDispatch;
  return commit((d) => {
    const order = rows(d, SO).find((x) => x.id === id);
    if (!order || !canReadRecord(actor, getResource(SO), order)) throw new ServiceError('not_found', E.notFound(id));
    // INS-01 / REQUIREMENTS §4.2: the dispatch record carries the e-way bill (typed, or the one the ERP returned).
    if (!ewayBill && !order.ewayBill && !e.ewayBill) e.ewayBill = E.ewayRequired;
    if (input.dispatchDate && input.dispatchDate < String(order.orderDate) && !e.dispatchDate) e.dispatchDate = E.dispatchBeforeOrder;
    if (Object.keys(e).length) throw new ServiceError('validation', E.fixFields, { fieldErrors: e });
    if (order.status !== 'ready_for_dispatch') throw new ServiceError('invalid_state', E.dispatchOnlyReady);
    const ctx = ctxOf(d, actor);
    const dsp = insertRecordIn(ctx, 'dispatches', {
      salesOrderId: id,
      customerId: order.customerId,
      ownerId: order.ownerId,
      divisionId: order.divisionId,
      dispatchDate: input.dispatchDate,
      transporter: input.transporter.trim(),
      lrNumber: input.lrNumber.trim(),
      challanNo: input.challanNo?.trim() || null,
      invoiceRef: input.invoiceRef?.trim() || (order.invoiceNo as string) || null,
      ewayBill: ewayBill || (order.ewayBill as string) || null,
      expectedDelivery: input.expectedDelivery,
      status: 'in_transit',
    });
    patchRecordIn(ctx, SO, id, { status: 'dispatched' }, N.dispatchedLog(String(dsp.transporter), String(dsp.lrNumber)));
    notifyOwner(ctx, order, N.dispatched(String(order.orderNo), input.expectedDelivery));
    if (input.notifyCustomer) {
      const c = customerContact(d, order.customerId);
      const body = N.intimation(String(order.orderNo), input.dispatchDate, String(dsp.transporter), String(dsp.lrNumber), dsp.ewayBill ? String(dsp.ewayBill) : '', input.expectedDelivery);
      if (c.whatsapp) queueMessage(ctx, { channel: 'whatsapp', to: c.whatsapp, body, related: { resource: SO, recordId: id } });
      if (c.email) queueMessage(ctx, { channel: 'email', to: c.email, subject: N.intimationSubject(String(order.orderNo)), body, related: { resource: SO, recordId: id } });
      if (!c.whatsapp && !c.email) appendAudit(d, actor, { action: 'dispatch.intimation_skipped', resource: SO, recordId: id, summary: N.intimationSkipped, correlationId: ctx.correlationId });
    }
    return dsp;
  });
}

const ALLOWED_POD = /\.(pdf|jpe?g|png)$/i;
const ALLOWED_PHOTO = /\.(jpe?g|png)$/i;

export function confirmDelivery(actor: Actor, dispatchId: string, input: { actualDelivery: string; podFileName: string; podFileSize?: number; podPhotoName?: string; podPhotoSize?: number }): { installationId?: string } {
  if (!can(actor, 'orders.dispatch')) throw new ServiceError('forbidden', E.deliveryForbidden);
  return commit((d) => {
    const dsp = rows(d, 'dispatches').find((x) => x.id === dispatchId);
    const scoped = dsp && rows(d, SO).find((x) => x.id === dsp.salesOrderId);
    if (!dsp || !scoped || !canReadRecord(actor, getResource(SO), scoped)) throw new ServiceError('not_found', E.dispatchNotFound);
    if (dsp.status === 'delivered') throw new ServiceError('invalid_state', E.alreadyDelivered);
    const e: Record<string, string> = {};
    if (!input.actualDelivery) e.actualDelivery = E.deliveryDateRequired;
    else if (input.actualDelivery > todayKey()) e.actualDelivery = E.deliveryDateFuture;
    else if (input.actualDelivery < String(dsp.dispatchDate)) e.actualDelivery = E.deliveryBeforeDispatch;
    if (!input.podFileName?.trim()) e.podFileName = E.podRequired;
    else if (!ALLOWED_POD.test(input.podFileName)) e.podFileName = E.fileType;
    else if ((input.podFileSize ?? 0) > getPolicies().maxFileMb * 1024 * 1024) e.podFileName = E.fileSize(getPolicies().maxFileMb);
    // INS-02: delivery confirmation needs a photo as well as the signed proof of delivery.
    if (!input.podPhotoName?.trim()) e.podPhotoName = E.photoRequired;
    else if (!ALLOWED_PHOTO.test(input.podPhotoName)) e.podPhotoName = E.photoType;
    else if ((input.podPhotoSize ?? 0) > getPolicies().maxFileMb * 1024 * 1024) e.podPhotoName = E.fileSize(getPolicies().maxFileMb);
    if (Object.keys(e).length) throw new ServiceError('validation', E.fixFields, { fieldErrors: e });
    const order = rows(d, SO).find((x) => x.id === dsp.salesOrderId);
    if (!order || order.status !== 'dispatched') throw new ServiceError('invalid_state', E.notDispatched);
    const ctx = ctxOf(d, actor);
    patchRecordIn(ctx, 'dispatches', dsp.id, { status: 'delivered', actualDelivery: input.actualDelivery, podFileName: input.podFileName.trim(), podPhotoName: input.podPhotoName?.trim() || null }, N.deliveredLog);
    patchRecordIn(ctx, SO, order.id, { status: 'delivered', deliveredAt: input.actualDelivery }, N.deliveredOn(input.actualDelivery));
    notifyOwner(ctx, order, N.delivered(String(order.orderNo)));
    let installationId: string | undefined;
    if (order.orderKind === 'machine') installationId = createInstallationJob(ctx, order);
    return { installationId };
  });
}

/** BR-26: delivery of a machine order creates the installation job (installed module's resource). */
export function createInstallationJob(ctx: HookContext, order: RecordData): string | undefined {
  if (!hasResource('installations')) {
    appendAudit(ctx.d, ctx.actor, { action: 'installation.skipped', actorType: 'workflow', resource: SO, recordId: order.id, summary: N.installationSkipped, correlationId: ctx.correlationId });
    return undefined;
  }
  const exists = rows(ctx.d, 'installations').find((i) => i.salesOrderId === order.id);
  if (exists) return exists.id;
  const job = insertRecordIn(
    ctx,
    'installations',
    { salesOrderId: order.id, customerId: order.customerId, siteAddressId: order.siteAddressId ?? null, productId: order.productId ?? null, status: 'scheduled' },
    { validate: false },
  );
  // Planners are notified once, by the installation module's afterCreate hook.
  return job.id;
}

// ---------------------------------------------------------------- Order Processing page (SO-08 / FR-056)

export interface ProcessingInput {
  poToPrincipalNo: string;
  poToPrincipalDate: string;
  shipmentEta: string;
  customsStatus: string;
  machineReady: boolean;
  pdiDone: boolean;
  processingNotes?: string;
}

export interface ProcessingRow {
  order: RecordData;
  /** Shipment ETA is in the past and the order is not ready for dispatch yet. */
  etaPassed: boolean;
  /** The actor may edit processing fields on this order (Import / SCM, admin). */
  canEdit: boolean;
}

/** Sales orders the actor can read that are approved and not yet dispatched (plus Hold). */
export function processingBoard(actor: Actor): ProcessingRow[] {
  const res = getResource(SO);
  const today = todayKey();
  const mayProcess = can(actor, 'orders.process');
  return rows(getDb(), SO)
    .filter((o) => SO_PROCESSING_STATUSES.includes(String(o.status)) && canReadRecord(actor, res, o))
    .map((order) => ({
      order,
      etaPassed: !!order.shipmentEta && String(order.shipmentEta) < today && order.status !== 'ready_for_dispatch',
      canEdit: mayProcess && canUpdateRecord(actor, res, order),
    }))
    .sort((a, b) => String(a.order.shipmentEta ?? '9999').localeCompare(String(b.order.shipmentEta ?? '9999')) || String(a.order.orderDate).localeCompare(String(b.order.orderDate)));
}

/** Field-level validation of an Order Processing update (empty object = valid). */
export function validateProcessing(order: RecordData, input: ProcessingInput): Record<string, string> {
  const e: Record<string, string> = {};
  const no = input.poToPrincipalNo?.trim() ?? '';
  if (no.length > 40) e.poToPrincipalNo = E.maxChars(40);
  if (input.poToPrincipalDate) {
    if (input.poToPrincipalDate > todayKey()) e.poToPrincipalDate = E.principalDateFuture;
    else if (input.poToPrincipalDate < String(order.orderDate)) e.poToPrincipalDate = E.principalDateBeforeOrder;
    if (!no) e.poToPrincipalNo = E.principalNoRequired;
  }
  if (input.shipmentEta && input.poToPrincipalDate && input.shipmentEta < input.poToPrincipalDate) e.shipmentEta = E.etaBeforePo;
  if (!(CUSTOMS_STATUSES as readonly string[]).includes(input.customsStatus)) e.customsStatus = E.customsInvalid;
  if (input.pdiDone && !input.machineReady) e.pdiDone = E.pdiNeedsReady;
  if (order.orderKind === 'machine' && input.machineReady && !['cleared', 'not_applicable'].includes(input.customsStatus)) e.machineReady = E.readyNeedsCustoms;
  if ((input.processingNotes ?? '').length > 1000) e.processingNotes = E.maxChars(1000);
  return e;
}

/** Import / SCM updates the processing fields of one sales order (optimistic version check). */
export function updateProcessing(actor: Actor, id: string, input: ProcessingInput, version: number): RecordData {
  if (!can(actor, 'orders.process')) throw new ServiceError('forbidden', E.processForbidden);
  const order = getOrder(actor, id);
  if (!SO_PROCESSING_STATUSES.includes(String(order.status))) throw new ServiceError('invalid_state', E.processNotEditable(statusLabel(order.status)));
  const errors = validateProcessing(order, input);
  if (Object.keys(errors).length) throw new ServiceError('validation', E.fixFields, { fieldErrors: errors });
  const patch = {
    poToPrincipalNo: input.poToPrincipalNo.trim() || null,
    poToPrincipalDate: input.poToPrincipalDate || null,
    shipmentEta: input.shipmentEta || null,
    customsStatus: input.customsStatus,
    machineReady: !!input.machineReady,
    pdiDone: !!input.pdiDone,
    ...(input.processingNotes !== undefined ? { processingNotes: input.processingNotes.trim() || null } : {}),
  };
  return updateRecord(actor, SO, id, patch, version).record;
}
