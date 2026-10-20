/**
 * Quotation domain service (FR-035 – FR-047). Engine-side and synchronous: every write goes
 * through one commit with permission checks, audit and events. Pages call the async wrappers in
 * src/services/api/quotations.ts.
 *
 * Line items are hidden from the generic engine; saves hand them to the quotation hooks through
 * `withPendingLines` so the hooks (not the UI) price, validate and total them.
 */
import { L } from '../../constants/labels';
import { ROUTES } from '../../constants/routes';
import { addDays, todayKey } from '../../lib/dates';
import { nowIso, nowMs } from '../../lib/clock';
import { fyLabel } from '../../lib/fy';
import { uid } from '../../lib/ids';
import { validateEmail, validateMobile } from '../../lib/validators';
import { demoUsers } from '../../domain/pack';
import type { RecordData } from '../../metadata/types';
import { type Actor, actorFor, canReadRecord, canUpdateRecord, fieldAccess, perm } from '../authz';
import { commit, getDb } from '../db';
import { appendAudit, notify } from '../ledger';
import { byId, listPriceFor, userOfStaff } from '../lookups';
import { queueMessage } from '../outbox';
import { discountApprovalLevels, getPolicies } from '../policies';
import { getResource, masterLabel } from '../registry';
import type { HookContext } from '../resourceHooks';
import { createRecord, insertRecordIn, patchRecordIn, type Projected, updateRecord } from '../runtime';
import { ServiceError } from '../types';
import { canDecide, decideApproval, requestApprovalIn } from '../workflow';
import { cleanLines, computeTotals, type QuoteLine, validateLines } from './pricing';
import { resolveQuoteLevels, roleMayDecideQuoteLevel } from './approvalLevels';
import type { Approval, ApprovalLevel } from '../types';

const E = L.quotations.errors;
const A = L.quotations.audit;

/**
 * BR-15: lines for products with a valid price list take the list price (and landed cost) from
 * the price list on the quotation date — whatever the client sent. Other lines keep their price.
 */
export function applyPriceList(lines: QuoteLine[], quoteDate: string, store?: Parameters<typeof listPriceFor>[2]): QuoteLine[] {
  return lines.map((l) => {
    if (!l.productId) return { ...l, priceLocked: false };
    const pl = listPriceFor(String(l.productId), quoteDate, store);
    if (!pl) return { ...l, priceLocked: false };
    return { ...l, listPrice: pl.listPrice, landedCost: pl.landedCost ?? l.landedCost ?? null, priceLocked: true };
  });
}

export const QUOTE_APPROVAL = 'quotation.discount';
const OPEN = ['draft', 'pending_approval', 'approved', 'sent', 'negotiation'];
const ROI_KEYS = ['roiOutputPerDay', 'roiPricePerUnit', 'roiCostPerUnit', 'roiWorkingDays'];
/** Header fields the editor may write (everything else is derived or set by the workflow). */
export const EDITABLE_HEADER = ['opportunityId', 'contactId', 'ownerId', 'quoteDate', 'validUntil', 'placeOfSupply', 'freight', 'insurance', 'termsTemplateId', 'paymentTerms', 'deliveryTerms', 'warrantyTerms', 'installationTerms'];

const res = () => getResource('quotations');
export const rootOf = (q: RecordData) => String(q.rootId || q.id);
const baseNo = (quoteNo: unknown) => String(quoteNo ?? '').replace(/-R\d+$/, '');

// ---------------------------------------------------------------- hooks (registered in domain/extensions/quotations.ts)

let pendingLines: QuoteLine[] | null = null;

/** Runs a create/update with line items attached for the hooks to price and validate. */
function withPendingLines<T>(lines: QuoteLine[] | undefined, run: () => T): T {
  pendingLines = lines ?? null;
  try {
    return run();
  } finally {
    pendingLines = null;
  }
}

/** Fills derived values and recomputes totals on the candidate (create and update). */
function derive(ctx: HookContext, c: Record<string, unknown>, isNew: boolean) {
  const { d } = ctx;
  const opp = byId('opportunities', c.opportunityId, d.records);
  // Out-of-scope opportunities are treated as missing (no quoting on someone else's opportunity by id).
  if (c.opportunityId && (!opp || (isNew && !canReadRecord(ctx.actor, getResource('opportunities'), opp)))) throw new ServiceError('validation', E.opportunityMissing, { fieldErrors: { opportunityId: E.opportunityNotFound } });
  if (opp) {
    if (isNew && opp.stage === 'lost') throw new ServiceError('invalid_state', E.opportunityLost(String(opp.id)));
    // BR-20 / §3.1: a won opportunity is closed — no new quotations on it.
    if (isNew && opp.stage === 'won') throw new ServiceError('invalid_state', E.opportunityWon(String(opp.id)));
    c.customerId = opp.customerId ?? c.customerId;
    c.divisionId = opp.divisionId ?? c.divisionId;
    if (!c.ownerId) c.ownerId = opp.ownerId;
    if (!c.contactId && opp.contactId) c.contactId = opp.contactId;
  }
  if (c.contactId) {
    const contact = byId('contacts', c.contactId, d.records);
    if (contact && contact.customerId && contact.customerId !== c.customerId) c.contactId = null;
  }
  if (!c.quoteDate) c.quoteDate = todayKey();
  if (!c.validUntil) c.validUntil = addDays(String(c.quoteDate), getPolicies().quoteValidityDays);
  if (!c.placeOfSupply) c.placeOfSupply = byId('customers', c.customerId, d.records)?.billingState ?? getPolicies().companyGstState;
  // Terms: copy from the chosen (or the division's default) template when empty (QUO-07).
  const tpl = byId('termsTemplates', c.termsTemplateId, d.records) ?? (isNew ? (d.records.termsTemplates ?? []).find((t) => t.divisionId === c.divisionId && t.isDefault && t.status !== 'inactive') : undefined);
  if (tpl) {
    if (isNew && !c.termsTemplateId) c.termsTemplateId = tpl.id;
    for (const k of ['paymentTerms', 'deliveryTerms', 'warrantyTerms', 'installationTerms']) if (!String(c[k] ?? '').trim()) c[k] = tpl[k] ?? '';
  }
  const lines = applyPriceList(cleanLines(c.lines), String(c.quoteDate), d.records);
  const errors = [...validateLines(lines), ...listPriceErrors(ctx, lines, c)];
  if (errors.length) throw new ServiceError('validation', errors[0], { fieldErrors: { lines: errors.join(' · ') } });
  const t = computeTotals(lines, String(c.placeOfSupply), Number(c.freight) || 0, Number(c.insurance) || 0, getPolicies().companyGstState);
  Object.assign(c, {
    lines,
    subtotal: t.subtotal,
    discountTotal: t.discountTotal,
    freight: t.freight,
    insurance: t.insurance,
    taxable: t.taxable,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    grandTotal: t.grandTotal,
    amountInWords: t.amountInWords,
    maxDiscountPct: t.maxDiscountPct,
    landedCostTotal: t.landedCostTotal,
    marginPct: t.marginPct,
  });
}

const lineSig = (l: QuoteLine) => JSON.stringify([l.productId ?? null, l.description, l.listPrice]);

/** May the actor price an item that is not on a valid price list (QUO-05: only roles that maintain price lists)? */
export const canSetListPrice = (actor: Actor) => perm(actor, 'priceListItems').update !== 'none';

/**
 * QUO-05 / BR-15: sales users cannot set list prices. A line that is not on a valid price list may carry a
 * price only when the actor maintains price lists, or when the same line is already on a version of this
 * quotation (so others can still edit the draft or create a version).
 */
function listPriceErrors(ctx: HookContext, lines: QuoteLine[], c: Record<string, unknown>): string[] {
  if (canSetListPrice(ctx.actor)) return [];
  const root = String(c.rootId || c.id || '');
  const known = new Set(root ? (ctx.d.records.quotations ?? []).filter((q) => rootOf(q) === root).flatMap((q) => cleanLines(q.lines).map(lineSig)) : []);
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (!l.priceLocked && l.listPrice > 0 && !known.has(lineSig(l))) out.push(`${L.quotations.lineErrors.line(i + 1)}: ${L.quotations.lineErrors.notOnPriceList}`);
  });
  return out;
}

export function quoteBeforeCreate(ctx: HookContext, c: Record<string, unknown>) {
  if (pendingLines) c.lines = pendingLines;
  derive(ctx, c, true);
  if (c.revision === undefined || c.revision === null) c.revision = 0;
  if (c.isLatest === undefined || c.isLatest === null) c.isLatest = true;
  // BR-13: division-wise series per financial year, e.g. QT/TX/26-27/0001.
  if (!c.quoteNo) {
    const fy = fyLabel();
    const key = `quoteNo:${c.divisionId}:${fy}`;
    ctx.d.counters[key] = (ctx.d.counters[key] ?? 0) + 1;
    c.quoteNo = `QT/${c.divisionId}/${fy}/${String(ctx.d.counters[key]).padStart(4, '0')}`;
  }
}

export function quoteBeforeUpdate(ctx: HookContext, before: RecordData, c: Record<string, unknown>) {
  if (pendingLines) c.lines = pendingLines;
  const changed = Object.keys(c).filter((k) => !['version', 'updatedAt'].includes(k) && JSON.stringify(c[k] ?? null) !== JSON.stringify(before[k] ?? null));
  const content = changed.filter((k) => !ROI_KEYS.includes(k));
  if (!content.length) return; // ROI inputs can change in any status (FR-047)
  if (!before.isLatest) throw new ServiceError('invalid_state', E.oldVersion(String(before.quoteNo)));
  if (before.status !== 'draft') throw new ServiceError('invalid_state', E.onlyDraftEdit(String(before.quoteNo)));
  derive(ctx, c, false);
}

// ---------------------------------------------------------------- reads

export interface QuoteView {
  record: RecordData;
  lines: QuoteLine[];
  /** Landed cost / margin visible (BR-19). */
  showMargin: boolean;
  canEdit: boolean;
  canUpdate: boolean;
  /** Every version of this quotation the actor can see, R0 first. */
  revisions: RecordData[];
  pendingApprovalId?: string;
  /** Discount approval requests for this version, newest first. */
  approvals: Approval[];
  /** Sales order generated from this quotation, if any. */
  salesOrder?: { id: string; orderNo: string };
}

function readRaw(actor: Actor, id: string): RecordData {
  const raw = (getDb().records.quotations ?? []).find((q) => q.id === id);
  if (!raw || !canReadRecord(actor, res(), raw)) throw new ServiceError('not_found', E.notFound(id));
  return raw;
}

const marginVisible = (actor: Actor) => fieldAccess(actor, res(), res().fields.find((f) => f.key === 'marginPct')!) !== 'hide';

export function getQuote(actor: Actor, id: string): QuoteView {
  const raw = readRaw(actor, id);
  const showMargin = marginVisible(actor);
  const lines = cleanLines(raw.lines).map((l) => (showMargin ? l : { ...l, landedCost: null }));
  const record: RecordData = { ...raw, lines };
  if (!showMargin) {
    record.landedCostTotal = null;
    record.marginPct = null;
  }
  const root = rootOf(raw);
  const revisions = (getDb().records.quotations ?? []).filter((q) => rootOf(q) === root && canReadRecord(actor, res(), q)).sort((a, b) => Number(a.revision) - Number(b.revision));
  const canUpdate = canUpdateRecord(actor, res(), raw);
  const approvals = getDb()
    .approvals.filter((a) => a.recordId === id && a.type === QUOTE_APPROVAL)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const pending = approvals.find((a) => a.status === 'pending');
  const so = (getDb().records.salesOrders ?? []).find((o) => o.quotationId === id);
  return {
    record,
    lines,
    showMargin,
    canUpdate,
    canEdit: canUpdate && raw.status === 'draft' && !!raw.isLatest,
    revisions,
    pendingApprovalId: pending?.id,
    approvals,
    salesOrder: so ? { id: so.id, orderNo: String(so.orderNo || so.id) } : undefined,
  };
}

/** Opportunities the actor may quote on (open stages, visible). */
export function quotableOpportunities(actor: Actor): RecordData[] {
  if (perm(actor, 'opportunities').read === 'none' || !getDb().records.opportunities) return [];
  const oppRes = getResource('opportunities');
  return (getDb().records.opportunities ?? []).filter((o) => !['won', 'lost'].includes(String(o.stage)) && canReadRecord(actor, oppRes, o));
}

/** Product picker options (active products; prices come from price lists). */
export function productOptions(divisionId?: string): RecordData[] {
  return (getDb().records.products ?? []).filter((p) => p.status !== 'inactive' && (!divisionId || !p.divisionId || p.divisionId === divisionId || ['ink', 'paper', 'fabric', 'spares', 'service', 'software'].includes(String(p.productType))));
}

// ---------------------------------------------------------------- writes

export interface QuoteInput {
  id?: string;
  version?: number;
  header: Record<string, unknown>;
  lines: QuoteLine[];
}

export function saveQuote(actor: Actor, input: QuoteInput): Projected {
  const header = Object.fromEntries(Object.entries(input.header).filter(([k]) => EDITABLE_HEADER.includes(k)));
  if (!input.lines.length) throw new ServiceError('validation', E.needLine, { fieldErrors: { lines: E.needLineField } });
  return withPendingLines(input.lines, () => (input.id ? updateRecord(actor, 'quotations', input.id, header, input.version ?? 0) : createRecord(actor, 'quotations', header)));
}

function load(actor: Actor, d: ReturnType<typeof getDb>, id: string, version?: number) {
  const q = (d.records.quotations ?? []).find((x) => x.id === id);
  if (!q || !canReadRecord(actor, res(), q)) throw new ServiceError('not_found', E.notFound(id));
  if (!canUpdateRecord(actor, res(), q)) throw new ServiceError('forbidden', E.cannotChange(String(q.quoteNo)));
  if (version !== undefined && q.version !== version) throw new ServiceError('version_conflict', E.changed(String(q.quoteNo)));
  if (!q.isLatest) throw new ServiceError('invalid_state', E.superseded(String(q.quoteNo)));
  return q;
}

function withdrawPending(ctx: HookContext, id: string, why: string) {
  ctx.d.approvals.forEach((a) => {
    if (a.recordId === id && a.type === QUOTE_APPROVAL && a.status === 'pending') {
      a.status = 'withdrawn';
      a.version++;
      appendAudit(ctx.d, ctx.actor, { action: 'approval.withdrawn', actorType: 'workflow', resource: 'quotations', recordId: id, summary: A.withdrawn(a.id, why), correlationId: ctx.correlationId });
    }
  });
}

function logActivityIn(ctx: HookContext, q: RecordData, type: string, subject: string, notes = '') {
  if (!ctx.d.records.activities) return;
  insertRecordIn(
    ctx,
    'activities',
    { activityType: type, subject, notes, at: nowIso().slice(0, 16), byId: ctx.actor.staffId, parentResource: 'quotations', parentId: q.id, parentLabel: String(q.quoteNo), customerId: q.customerId ?? null, nextFollowUpAt: null },
    { validate: false },
  );
}

/** FR-040 / BR-17: Submit for Approval. Within the discount limit it is approved at once; otherwise the approval chain starts. */
export function submitQuote(actor: Actor, id: string, version: number, reason = ''): { status: string; approvalId?: string } {
  return commit((d) => {
    const q = load(actor, d, id, version);
    if (q.status !== 'draft') throw new ServiceError('invalid_state', E.onlyDraftSubmit);
    if (!cleanLines(q.lines).length) throw new ServiceError('validation', E.needLineSubmit);
    if (String(q.validUntil) < todayKey()) throw new ServiceError('validation', E.validityPassed, { fieldErrors: { validUntil: E.inPast } });
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    const pct = Number(q.maxDiscountPct) || 0;
    const levels = quoteApprovalChain(actor, q, pct);
    if (!levels.length) {
      patchRecordIn(ctx, 'quotations', id, { status: 'approved', rejectNote: '' }, A.autoApproved(pct));
      return { status: 'approved' };
    }
    if (pct > 0 && reason.trim().length < 5) throw new ServiceError('validation', E.needReason, { fieldErrors: { reason: E.needReasonField } });
    patchRecordIn(ctx, 'quotations', id, { status: 'pending_approval', rejectNote: '' }, A.submitted(pct));
    const a = requestApprovalIn(ctx, {
      type: QUOTE_APPROVAL,
      resource: 'quotations',
      recordId: id,
      reason,
      summary: A.approvalSummary(pct, String(q.quoteNo), new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(q.grandTotal) || 0)),
      levels,
      amount: Number(q.grandTotal) || 0,
      divisionIds: q.divisionId ? [String(q.divisionId)] : undefined,
    });
    return { status: 'pending_approval', approvalId: a.id };
  });
}

/** BR-17 band for the discount, resolved to who actually decides (named Sales Manager, escalation; see approvalLevels.ts). */
export function quoteApprovalChain(actor: Actor, q: Record<string, unknown>, pct: number): ApprovalLevel[] {
  return resolveQuoteLevels(discountApprovalLevels(pct), { ownerStaffId: q.ownerId ?? actor.staffId, requesterUserId: actor.user.id, divisionId: q.divisionId, users: demoUsers, workspaceId: actor.workspaceId });
}

/** canDecide plus the quotation rule that only the role holding the level decides it (REQUIREMENTS §2.2). */
export const canDecideQuote = (actor: Actor, a: Approval) => canDecide(actor, a) && roleMayDecideQuoteLevel(actor.role.id, a.levels[a.currentLevel]);

/** Pulls a pending request back to draft (e.g. to change the discount). */
export function backToDraft(actor: Actor, id: string, version: number) {
  commit((d) => {
    const q = load(actor, d, id, version);
    if (q.status !== 'pending_approval') throw new ServiceError('invalid_state', E.onlyPendingPullBack);
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    withdrawPending(ctx, id, A.pulledBackWhy);
    patchRecordIn(ctx, 'quotations', id, { status: 'draft' }, A.pulledBack);
  });
}

export interface SendInput {
  channel: 'email' | 'whatsapp';
  to: string;
  message: string;
}

/** FR-042: send by email / WhatsApp (simulated outbox), sent date logged. */
export function sendQuote(actor: Actor, id: string, version: number, input: SendInput) {
  commit((d) => {
    const q = load(actor, d, id, version);
    if (!['approved', 'sent', 'negotiation'].includes(String(q.status))) throw new ServiceError('invalid_state', E.onlyApprovedSend);
    if (String(q.validUntil) < todayKey()) throw new ServiceError('invalid_state', E.expiredSend);
    const to = input.to.trim();
    const err = input.channel === 'email' ? validateEmail(to) : validateMobile(to);
    if (err) throw new ServiceError('validation', err, { fieldErrors: { to: err } });
    const contact = byId('contacts', q.contactId, d.records);
    if (contact && input.channel === 'email' && contact.consentEmail === false) throw new ServiceError('forbidden', E.noEmailConsent(String(contact.name)));
    if (contact && input.channel === 'whatsapp' && contact.consentWhatsapp === false) throw new ServiceError('forbidden', E.noWhatsappConsent(String(contact.name)));
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    queueMessage(ctx, {
      channel: input.channel,
      to,
      subject: A.sendSubject(String(q.quoteNo)),
      body: `${input.message.trim() || A.sendBody(String(q.quoteNo))} ${A.attachment(String(q.quoteNo))}`,
      related: { resource: 'quotations', recordId: q.id },
    });
    const via = input.channel === 'email' ? L.quotations.dialogs.send.email : L.quotations.dialogs.send.whatsapp;
    patchRecordIn(ctx, 'quotations', id, { status: q.status === 'approved' ? 'sent' : q.status, sentAt: nowIso(), sentVia: `${via} · ${to}` }, A.sentBy(via, to));
    logActivityIn(ctx, q, input.channel, A.sentActivity(String(q.quoteNo), via));
  });
}

export interface AcceptInput {
  method: 'po' | 'electronic';
  poNo?: string;
  poDate?: string;
  file?: { name: string; size: number } | null;
  acceptedByName?: string;
}

const PO_TYPES = /\.(pdf|jpe?g|png)$/i;

/** FR-045: customer acceptance by PO upload (simulated file) or electronic acceptance. Opportunity → Won. */
export function acceptQuote(actor: Actor, id: string, version: number, input: AcceptInput) {
  commit((d) => {
    const q = load(actor, d, id, version);
    if (!['sent', 'negotiation'].includes(String(q.status))) throw new ServiceError('invalid_state', E.onlySentAccept);
    if (String(q.validUntil) < todayKey()) throw new ServiceError('invalid_state', E.expiredAccept);
    // BR-20: one accepted quotation per opportunity — a second open quotation cannot win it again.
    const other = q.opportunityId ? (d.records.quotations ?? []).find((x) => x.id !== q.id && x.opportunityId === q.opportunityId && x.status === 'accepted') : undefined;
    if (other) throw new ServiceError('invalid_state', E.otherQuoteAccepted(String(other.quoteNo ?? other.id)));
    const errors: Record<string, string> = {};
    const patch: Record<string, unknown> = { status: 'accepted', acceptedAt: nowIso(), acceptanceMethod: input.method };
    if (input.method === 'po') {
      if (!input.poNo?.trim()) errors.poNo = E.poNoRequired;
      else if (input.poNo.trim().length > 40) errors.poNo = E.poNoMax;
      if (!input.poDate) errors.poDate = E.poDateRequired;
      else if (input.poDate > todayKey()) errors.poDate = E.poDateFuture;
      const maxMb = getPolicies().maxFileMb;
      if (!input.file) errors.file = E.poFileRequired;
      else if (!PO_TYPES.test(input.file.name)) errors.file = E.poFileType;
      else if (input.file.size > maxMb * 1024 * 1024) errors.file = E.poFileSize(maxMb);
      Object.assign(patch, { customerPoNo: input.poNo?.trim(), customerPoDate: input.poDate, poFileName: input.file?.name, acceptedByName: '' });
    } else {
      if (!input.acceptedByName?.trim()) errors.acceptedByName = E.acceptedByRequired;
      Object.assign(patch, { acceptedByName: input.acceptedByName?.trim() });
    }
    if (Object.keys(errors).length) throw new ServiceError('validation', E.fixFields, { fieldErrors: errors });
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    patchRecordIn(ctx, 'quotations', id, patch, input.method === 'po' ? A.acceptedPo(String(input.poNo)) : A.acceptedElectronic(String(input.acceptedByName)));
    const opp = byId('opportunities', q.opportunityId, d.records);
    if (opp && !['won', 'lost'].includes(String(opp.stage))) {
      patchRecordIn(ctx, 'opportunities', String(opp.id), { stage: 'won', wonAt: nowIso(), probability: 100 }, A.oppWon(String(q.quoteNo)));
    } else if (opp?.stage === 'lost') {
      appendAudit(d, actor, { action: 'warning', resource: 'opportunities', recordId: String(opp.id), summary: A.oppLostWarning(String(q.quoteNo)), correlationId: ctx.correlationId });
    }
    const owner = userOfStaff(q.ownerId);
    if (owner && owner.id !== actor.user.id) notify(d, { userId: owner.id, workspaceId: actor.workspaceId, kind: 'info', title: A.acceptedNotify(String(q.quoteNo)), link: { resource: 'quotations', recordId: q.id } });
    logActivityIn(ctx, q, 'note', A.acceptedActivity(String(q.quoteNo)));
  });
}

/** Customer declined (QUO-10, QUO-14 lost quotations with reasons). */
export function rejectQuote(actor: Actor, id: string, version: number, reason: string, note: string) {
  commit((d) => {
    const q = load(actor, d, id, version);
    if (!['sent', 'negotiation'].includes(String(q.status))) throw new ServiceError('invalid_state', E.onlySentReject);
    if (!reason) throw new ServiceError('validation', E.chooseReason, { fieldErrors: { reason: E.required } });
    patchRecordIn({ d, actor, correlationId: uid('cor') }, 'quotations', id, { status: 'rejected', rejectReason: reason, rejectNote: note.trim() }, A.rejected(masterLabel('lostReason', reason)));
  });
}

/** FR-043 / BR-18: new version R(n+1) as a draft; the previous one becomes read-only. Expired quotations can get a new version (Q-09). */
export function reviseQuote(actor: Actor, id: string, version: number, note: string): string {
  return commit((d) => {
    const q = load(actor, d, id, version);
    if (![...OPEN, 'expired'].includes(String(q.status))) throw new ServiceError('invalid_state', E.cannotVersion(masterLabel('quoteStatus', q.status)));
    if (q.status === 'draft') throw new ServiceError('invalid_state', E.draftEditInstead);
    if (!perm(actor, 'quotations').create) throw new ServiceError('forbidden', E.cannotCreate);
    if (note.trim().length < 5) throw new ServiceError('validation', E.needVersionNote, { fieldErrors: { note: E.required } });
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    withdrawPending(ctx, id, A.supersededWhy);
    patchRecordIn(ctx, 'quotations', id, { status: 'superseded', isLatest: false }, A.superseded);
    const rev = (Number(q.revision) || 0) + 1;
    const copy: Record<string, unknown> = {};
    for (const k of [...EDITABLE_HEADER, 'customerId', 'divisionId', 'lines', ...ROI_KEYS]) copy[k] = q[k];
    const next = insertRecordIn(ctx, 'quotations', {
      ...copy,
      quoteDate: todayKey(),
      validUntil: addDays(todayKey(), getPolicies().quoteValidityDays),
      quoteNo: `${baseNo(q.quoteNo)}-R${rev}`,
      revision: rev,
      rootId: rootOf(q),
      isLatest: true,
      status: 'draft',
      revisionNote: note.trim(),
    });
    appendAudit(d, actor, { action: 'version.created', resource: 'quotations', recordId: next.id, summary: A.versionCreated(rev, baseNo(q.quoteNo), note.trim()), correlationId: ctx.correlationId });
    return next.id;
  });
}

// ---------------------------------------------------------------- scheduled sweeps (simulated server jobs)

const systemActor = () => actorFor(demoUsers[0].id, 'tc');

/**
 * FR-044 automatic expiry, stale "Pending Approval" clean-up (request withdrawn elsewhere) and
 * QUO-06 reminders after 24 h. Idempotent: commits only when something changes.
 */
export function runQuotationSweep(): number {
  const db = getDb();
  const today = todayKey();
  const quotes = db.records.quotations ?? [];
  const expiring = quotes.filter((q) => q.isLatest && OPEN.includes(String(q.status)) && String(q.validUntil) < today);
  const orphaned = quotes.filter((q) => q.status === 'pending_approval' && !db.approvals.some((a) => a.recordId === q.id && a.type === QUOTE_APPROVAL && a.status === 'pending'));
  const dayMs = 86_400_000;
  const stale = db.approvals.filter((a) => a.type === QUOTE_APPROVAL && a.status === 'pending' && nowMs() - new Date(a.requestedAt).getTime() > dayMs && (!a.remindedAt || nowMs() - new Date(a.remindedAt).getTime() > dayMs));
  const n = expiring.length + orphaned.length + stale.length;
  if (!n) return 0;
  commit((d) => {
    const ctx: HookContext = { d, actor: systemActor(), correlationId: uid('cor') };
    expiring.forEach((q) => {
      withdrawPending(ctx, q.id, A.validityEnded);
      patchRecordIn(ctx, 'quotations', q.id, { status: 'expired' }, A.expired(String(q.validUntil)));
    });
    orphaned.filter((q) => !expiring.includes(q)).forEach((q) => patchRecordIn(ctx, 'quotations', q.id, { status: 'draft' }, A.orphaned));
    stale.forEach((s) => {
      const a = d.approvals.find((x) => x.id === s.id)!;
      a.remindedAt = nowIso();
      demoUsers
        .map((u) => actorFor(u.id, a.workspaceId))
        .filter((x) => canDecideQuote(x, a))
        .forEach((x) => notify(d, { userId: x.user.id, workspaceId: a.workspaceId, kind: 'reminder', title: A.reminder(a.remindedAt!.slice(0, 10), levelName(a.levels[a.currentLevel]), a.summary), link: { page: ROUTES.quotationPendingApprovals.slice(1) } }));
    });
  });
  return n;
}

// ---------------------------------------------------------------- approvals (registered in extensions)

/** Approval level shown by role name (GLOSSARY §3: Sales Manager → Division Head → Management (MD)). */
export function levelName(level?: ApprovalLevel): string {
  if (!level) return '';
  const n = /^approve\.l([123])$/.exec(level.capability)?.[1];
  return n ? L.roles.approvalLevels[Number(n) as 1 | 2 | 3] : level.label;
}

export interface PendingApprovalRow {
  approval: Approval;
  quoteId: string;
  quoteNo: string;
  customerName: string;
  ownerName: string;
  divisionId: string;
  grandTotal: number;
  discountPct: number;
  levelName: string;
  /** 1-based level in the chain. */
  step: number;
  steps: number;
  /** When the current level started (request time or the previous level's decision). */
  waitingSince: string;
  waitingHours: number;
  /** Pending for more than 24 h at this level (QUO-06 reminder rule). */
  overdue: boolean;
  /** The viewer may approve / reject at the current level. */
  canDecide: boolean;
  /** The viewer raised this request (separation of duties). */
  ownRequest: boolean;
}

/**
 * QUO-06 / QUO-14 Pending Approvals: every pending quotation discount request the viewer can see —
 * the ones at the viewer's approval level (approve.l1/l2/l3 + division) and all others for follow-up.
 */
export function pendingQuoteApprovals(actor: Actor): PendingApprovalRow[] {
  if (perm(actor, 'quotations').read === 'none') return [];
  const d = getDb();
  const quotes = new Map((d.records.quotations ?? []).map((q) => [q.id, q]));
  const now = nowMs();
  const rows: PendingApprovalRow[] = [];
  d.approvals.forEach((a) => {
    if (a.type !== QUOTE_APPROVAL || a.status !== 'pending' || a.workspaceId !== actor.workspaceId) return;
    const q = quotes.get(a.recordId);
    if (!q) return;
    const decide = canDecideQuote(actor, a);
    if (!decide && !canReadRecord(actor, res(), q)) return;
    const last = a.decisions.filter((x) => x.level < a.currentLevel).map((x) => x.at).sort().pop();
    const since = last ?? a.requestedAt;
    const hours = Math.max(0, Math.floor((now - new Date(since).getTime()) / 3_600_000));
    rows.push({
      approval: a,
      quoteId: q.id,
      quoteNo: String(q.quoteNo ?? q.id),
      customerName: String(byId('customers', q.customerId, d.records)?.name ?? q.customerId ?? ''),
      ownerName: String(byId('employees', q.ownerId, d.records)?.fullName ?? q.ownerId ?? ''),
      divisionId: String(q.divisionId ?? ''),
      grandTotal: Number(q.grandTotal) || 0,
      discountPct: Number(q.maxDiscountPct) || 0,
      levelName: levelName(a.levels[a.currentLevel]),
      step: a.currentLevel + 1,
      steps: a.levels.length,
      waitingSince: since,
      waitingHours: hours,
      overdue: hours >= 24,
      canDecide: decide,
      ownRequest: a.requestedBy === actor.user.id,
    });
  });
  return rows;
}

/** Approve / Reject a quotation discount request at the viewer's level (comment required to reject). */
export function decideQuoteApproval(actor: Actor, approvalId: string, decision: 'approved' | 'rejected', note: string, expectedVersion: number): Approval {
  const a = getDb().approvals.find((x) => x.id === approvalId && x.workspaceId === actor.workspaceId);
  if (!a) throw new ServiceError('not_found', E.approvalNotFound);
  if (a.type !== QUOTE_APPROVAL) throw new ServiceError('invalid_state', E.notQuotationApproval);
  if (a.status === 'pending' && a.requestedBy !== actor.user.id && !roleMayDecideQuoteLevel(actor.role.id, a.levels[a.currentLevel])) throw new ServiceError('forbidden', E.notYourLevel(levelName(a.levels[a.currentLevel])));
  return decideApproval(actor, approvalId, decision, note, expectedVersion);
}

export function onDiscountApproved(ctx: HookContext, recordId: string) {
  const q = (ctx.d.records.quotations ?? []).find((x) => x.id === recordId);
  if (q && q.status === 'pending_approval') patchRecordIn(ctx, 'quotations', recordId, { status: 'approved' }, A.discountApproved);
}

export function onDiscountRejected(ctx: HookContext, recordId: string, note: string) {
  const q = (ctx.d.records.quotations ?? []).find((x) => x.id === recordId);
  if (q && q.status === 'pending_approval') patchRecordIn(ctx, 'quotations', recordId, { status: 'draft', rejectNote: A.discountRejectedNote(note) }, A.discountRejected(note));
}

// ---------------------------------------------------------------- comparison (FR-043)

export interface CompareRow {
  label: string;
  a: string;
  b: string;
  changed: boolean;
}

export function compareLines(a: QuoteLine[], b: QuoteLine[]) {
  const key = (l: QuoteLine, i: number) => (l.productId ? `p:${l.productId}:${l.lineType}` : `d:${l.description.toLowerCase()}:${i}`);
  const ka = new Map(a.map((l, i) => [key(l, i), l]));
  const kb = new Map(b.map((l, i) => [key(l, i), l]));
  const keys = [...new Set([...ka.keys(), ...kb.keys()])];
  return keys.map((k) => {
    const x = ka.get(k);
    const y = kb.get(k);
    const state = !x ? 'added' : !y ? 'removed' : JSON.stringify([x.qty, x.listPrice, x.discountPct, x.discountAmt, x.gstRate, x.description]) === JSON.stringify([y.qty, y.listPrice, y.discountPct, y.discountAmt, y.gstRate, y.description]) ? 'same' : 'changed';
    return { key: k, a: x, b: y, state: state as 'added' | 'removed' | 'same' | 'changed' };
  });
}


// ---------------------------------------------------------------- editor data

export interface EditorData {
  quote: QuoteView | null;
  opportunities: RecordData[];
  products: RecordData[];
  contacts: RecordData[];
  customers: Record<string, { name: string; billingState?: string }>;
  terms: RecordData[];
  showMargin: boolean;
  /** Opportunity to prefill from (?opportunity=). */
  opportunity: RecordData | null;
}

/** Everything the full-page editor needs in one round-trip. */
export function editorData(actor: Actor, quoteId?: string, opportunityId?: string): EditorData {
  if (!quoteId && !perm(actor, 'quotations').create) throw new ServiceError('forbidden', E.cannotCreateRole(actor.role.label));
  const quote = quoteId ? getQuote(actor, quoteId) : null;
  const d = getDb();
  const opps = quotableOpportunities(actor);
  const current = quote ? byId('opportunities', quote.record.opportunityId) : undefined;
  const fromParam = opportunityId ? opps.find((o) => o.id === opportunityId) ?? null : null;
  if (opportunityId && !fromParam) throw new ServiceError('not_found', E.oppNotOpen(opportunityId));
  const customers: EditorData['customers'] = {};
  (d.records.customers ?? []).forEach((c) => (customers[c.id] = { name: String(c.name), billingState: c.billingState as string | undefined }));
  return {
    quote,
    opportunities: current && !opps.includes(current) ? [current, ...opps] : opps,
    products: productOptions(),
    contacts: (d.records.contacts ?? []).filter((c) => c.customerId),
    customers,
    terms: (d.records.termsTemplates ?? []).filter((t) => t.status !== 'inactive'),
    showMargin: marginVisible(actor),
    opportunity: fromParam ?? current ?? null,
  };
}

/** Resolve the originating lead without exposing records outside the viewer's scope. */
export function quotationOrigin(actor: Actor, id: string): { leadId?: string; opportunityId?: string; directCustomer: boolean } {
  const quote = readRaw(actor, id);
  const opportunity = byId('opportunities', quote.opportunityId);
  if (!opportunity || !canReadRecord(actor, getResource('opportunities'), opportunity)) return { directCustomer: false };
  const lead = byId('leads', opportunity.leadId);
  return {
    opportunityId: opportunity.id,
    leadId: lead && canReadRecord(actor, getResource('leads'), lead) ? lead.id : undefined,
    directCustomer: !opportunity.leadId,
  };
}
