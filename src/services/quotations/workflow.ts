/**
 * Quotation domain service (FR-035 – FR-047). Engine-side and synchronous: every write goes
 * through one commit with permission checks, audit and events. Pages call the async wrappers in
 * src/services/api/quotations.ts.
 *
 * Line items are hidden from the generic engine; saves hand them to the quotation hooks through
 * `withPendingLines` so the hooks (not the UI) price, validate and total them.
 */
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
import { canDecide, requestApprovalIn } from '../workflow';
import { cleanLines, computeTotals, type QuoteLine, validateLines } from './pricing';

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

// ---------------------------------------------------------------- hooks (registered in domain/extensions/quotations.tsx)

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
  if (c.opportunityId && !opp) throw new ServiceError('validation', 'The selected opportunity no longer exists.', { fieldErrors: { opportunityId: 'Opportunity not found' } });
  if (opp) {
    if (isNew && opp.stage === 'lost') throw new ServiceError('invalid_state', `Opportunity ${opp.id} is lost — reopen it before quoting.`);
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
  const errors = validateLines(lines);
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
  if (!before.isLatest) throw new ServiceError('invalid_state', `${before.quoteNo} is an old revision and cannot be edited.`);
  if (before.status !== 'draft') throw new ServiceError('invalid_state', `Only draft quotations can be edited — revise ${before.quoteNo} to create the next revision.`);
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
  revisions: RecordData[];
  pendingApprovalId?: string;
}

function readRaw(actor: Actor, id: string): RecordData {
  const raw = (getDb().records.quotations ?? []).find((q) => q.id === id);
  if (!raw || !canReadRecord(actor, res(), raw)) throw new ServiceError('not_found', `Quotation ${id} was not found or you do not have access.`);
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
  const pending = getDb().approvals.find((a) => a.recordId === id && a.type === QUOTE_APPROVAL && a.status === 'pending');
  return { record, lines, showMargin, canUpdate, canEdit: canUpdate && raw.status === 'draft' && !!raw.isLatest, revisions, pendingApprovalId: pending?.id };
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
  if (!input.lines.length) throw new ServiceError('validation', 'Add at least one line item.', { fieldErrors: { lines: 'Add at least one line item' } });
  return withPendingLines(input.lines, () => (input.id ? updateRecord(actor, 'quotations', input.id, header, input.version ?? 0) : createRecord(actor, 'quotations', header)));
}

function load(actor: Actor, d: ReturnType<typeof getDb>, id: string, version?: number) {
  const q = (d.records.quotations ?? []).find((x) => x.id === id);
  if (!q || !canReadRecord(actor, res(), q)) throw new ServiceError('not_found', `Quotation ${id} was not found.`);
  if (!canUpdateRecord(actor, res(), q)) throw new ServiceError('forbidden', `Your role cannot change ${q.quoteNo}.`);
  if (version !== undefined && q.version !== version) throw new ServiceError('version_conflict', `${q.quoteNo} changed since you opened it. Reload and try again.`);
  if (!q.isLatest) throw new ServiceError('invalid_state', `${q.quoteNo} has been superseded by a newer revision.`);
  return q;
}

function withdrawPending(ctx: HookContext, id: string, why: string) {
  ctx.d.approvals.forEach((a) => {
    if (a.recordId === id && a.type === QUOTE_APPROVAL && a.status === 'pending') {
      a.status = 'withdrawn';
      a.version++;
      appendAudit(ctx.d, ctx.actor, { action: 'approval.withdrawn', actorType: 'workflow', resource: 'quotations', recordId: id, summary: `${a.id} withdrawn: ${why}`, correlationId: ctx.correlationId });
    }
  });
}

function logActivityIn(ctx: HookContext, q: RecordData, type: string, subject: string, notes = '') {
  if (!ctx.d.records.activities) return;
  insertRecordIn(
    ctx,
    'activities',
    { activityType: type, subject, notes, at: nowIso().slice(0, 16), byId: ctx.actor.staffId, parentResource: 'quotations', parentId: q.id, parentLabel: `${q.quoteNo}`, customerId: q.customerId ?? null, nextFollowUpAt: null },
    { validate: false },
  );
}

/** FR-040 / BR-17: submit a draft. Within the discount limit it is approved at once; otherwise the approval chain starts. */
export function submitQuote(actor: Actor, id: string, version: number, reason = ''): { status: string; approvalId?: string } {
  return commit((d) => {
    const q = load(actor, d, id, version);
    if (q.status !== 'draft') throw new ServiceError('invalid_state', 'Only draft quotations can be submitted.');
    if (!cleanLines(q.lines).length) throw new ServiceError('validation', 'Add at least one line item before submitting.');
    if (String(q.validUntil) < todayKey()) throw new ServiceError('validation', 'The validity date has passed — change “Valid until” first.', { fieldErrors: { validUntil: 'In the past' } });
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    const pct = Number(q.maxDiscountPct) || 0;
    const levels = discountApprovalLevels(pct);
    if (!levels.length) {
      patchRecordIn(ctx, 'quotations', id, { status: 'approved', rejectNote: '' }, `Approved automatically: highest discount ${pct}% is within the no-approval limit`);
      return { status: 'approved' };
    }
    if (pct > 0 && reason.trim().length < 5) throw new ServiceError('validation', 'Give a reason for the discount (at least 5 characters).', { fieldErrors: { reason: 'Required for discounts that need approval' } });
    patchRecordIn(ctx, 'quotations', id, { status: 'pending_approval', rejectNote: '' }, `Submitted for discount approval (${pct}%)`);
    const a = requestApprovalIn(ctx, {
      type: QUOTE_APPROVAL,
      resource: 'quotations',
      recordId: id,
      reason,
      summary: `Discount ${pct}% on ${q.quoteNo} (${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(q.grandTotal) || 0)})`,
      levels,
      amount: Number(q.grandTotal) || 0,
      divisionIds: q.divisionId ? [String(q.divisionId)] : undefined,
    });
    return { status: 'pending_approval', approvalId: a.id };
  });
}

/** Pulls a pending request back to draft (e.g. to change the discount). */
export function backToDraft(actor: Actor, id: string, version: number) {
  commit((d) => {
    const q = load(actor, d, id, version);
    if (q.status !== 'pending_approval') throw new ServiceError('invalid_state', 'Only quotations pending approval can be pulled back.');
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    withdrawPending(ctx, id, 'pulled back to draft by the requester');
    patchRecordIn(ctx, 'quotations', id, { status: 'draft' }, 'Pulled back to draft');
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
    if (!['approved', 'sent', 'negotiation'].includes(String(q.status))) throw new ServiceError('invalid_state', 'Only approved quotations can be sent.');
    if (String(q.validUntil) < todayKey()) throw new ServiceError('invalid_state', 'This quotation has expired — revise it before sending.');
    const to = input.to.trim();
    const err = input.channel === 'email' ? validateEmail(to) : validateMobile(to);
    if (err) throw new ServiceError('validation', err, { fieldErrors: { to: err } });
    const contact = byId('contacts', q.contactId, d.records);
    if (contact && input.channel === 'email' && contact.consentEmail === false) throw new ServiceError('forbidden', `${contact.name} has not consented to email (DPDP). Choose another channel or contact.`);
    if (contact && input.channel === 'whatsapp' && contact.consentWhatsapp === false) throw new ServiceError('forbidden', `${contact.name} has not consented to WhatsApp messages (DPDP).`);
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    queueMessage(ctx, {
      channel: input.channel,
      to,
      subject: `Quotation ${q.quoteNo} from True Colors Limited`,
      body: `${input.message.trim() || `Please find attached our quotation ${q.quoteNo}.`} [Attachment: ${q.quoteNo}.pdf]`,
      related: { resource: 'quotations', recordId: q.id },
    });
    const via = input.channel === 'email' ? 'Email' : 'WhatsApp';
    patchRecordIn(ctx, 'quotations', id, { status: q.status === 'approved' ? 'sent' : q.status, sentAt: nowIso(), sentVia: `${via} · ${to}` }, `Sent by ${via} to ${to}`);
    logActivityIn(ctx, q, input.channel, `Quotation ${q.quoteNo} sent by ${via}`);
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
    if (!['sent', 'negotiation'].includes(String(q.status))) throw new ServiceError('invalid_state', 'Only sent quotations can be accepted.');
    if (String(q.validUntil) < todayKey()) throw new ServiceError('invalid_state', 'This quotation has expired — revise it before recording acceptance.');
    const errors: Record<string, string> = {};
    const patch: Record<string, unknown> = { status: 'accepted', acceptedAt: nowIso(), acceptanceMethod: input.method };
    if (input.method === 'po') {
      if (!input.poNo?.trim()) errors.poNo = 'Customer PO number is required';
      else if (input.poNo.trim().length > 40) errors.poNo = 'At most 40 characters';
      if (!input.poDate) errors.poDate = 'PO date is required';
      else if (input.poDate > todayKey()) errors.poDate = 'PO date cannot be in the future';
      const maxMb = getPolicies().maxFileMb;
      if (!input.file) errors.file = 'Attach the PO copy';
      else if (!PO_TYPES.test(input.file.name)) errors.file = 'PO copy must be a PDF, JPG or PNG file';
      else if (input.file.size > maxMb * 1024 * 1024) errors.file = `PO copy must be ${maxMb} MB or smaller`;
      Object.assign(patch, { customerPoNo: input.poNo?.trim(), customerPoDate: input.poDate, poFileName: input.file?.name, acceptedByName: '' });
    } else {
      if (!input.acceptedByName?.trim()) errors.acceptedByName = 'Name of the person accepting is required';
      Object.assign(patch, { acceptedByName: input.acceptedByName?.trim() });
    }
    if (Object.keys(errors).length) throw new ServiceError('validation', 'Please fix the highlighted fields.', { fieldErrors: errors });
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    patchRecordIn(ctx, 'quotations', id, patch, input.method === 'po' ? `Accepted with customer PO ${input.poNo}` : `Accepted electronically by ${input.acceptedByName}`);
    const opp = byId('opportunities', q.opportunityId, d.records);
    if (opp && !['won', 'lost'].includes(String(opp.stage))) {
      patchRecordIn(ctx, 'opportunities', String(opp.id), { stage: 'won', wonAt: nowIso(), probability: 100 }, `Won: quotation ${q.quoteNo} accepted`);
    } else if (opp?.stage === 'lost') {
      appendAudit(d, actor, { action: 'warning', resource: 'opportunities', recordId: String(opp.id), summary: `Quotation ${q.quoteNo} accepted while the opportunity is marked lost — review the opportunity`, correlationId: ctx.correlationId });
    }
    const owner = userOfStaff(q.ownerId);
    if (owner && owner.id !== actor.user.id) notify(d, { userId: owner.id, workspaceId: actor.workspaceId, kind: 'info', title: `${q.quoteNo} accepted by the customer — generate the sales order`, link: { resource: 'quotations', recordId: q.id } });
    logActivityIn(ctx, q, 'note', `Quotation ${q.quoteNo} accepted`);
  });
}

/** Customer declined (QUO-10, QUO-14 lost quotations with reasons). */
export function rejectQuote(actor: Actor, id: string, version: number, reason: string, note: string) {
  commit((d) => {
    const q = load(actor, d, id, version);
    if (!['sent', 'negotiation'].includes(String(q.status))) throw new ServiceError('invalid_state', 'Only sent quotations can be marked rejected.');
    if (!reason) throw new ServiceError('validation', 'Choose a reason.', { fieldErrors: { reason: 'Required' } });
    patchRecordIn({ d, actor, correlationId: uid('cor') }, 'quotations', id, { status: 'rejected', rejectReason: reason, rejectNote: note.trim() }, `Rejected by the customer: ${masterLabel('lostReason', reason)}`);
  });
}

/** FR-043 / BR-18: new revision R(n+1) as a draft; the previous one becomes read-only. Expired quotations can be revised (Q-09). */
export function reviseQuote(actor: Actor, id: string, version: number, note: string): string {
  return commit((d) => {
    const q = load(actor, d, id, version);
    if (![...OPEN, 'expired'].includes(String(q.status))) throw new ServiceError('invalid_state', `A ${masterLabel('quoteStatus', q.status).toLowerCase()} quotation cannot be revised.`);
    if (q.status === 'draft') throw new ServiceError('invalid_state', 'This revision is still a draft — edit it instead.');
    if (!perm(actor, 'quotations').create) throw new ServiceError('forbidden', 'Your role cannot create quotations.');
    if (note.trim().length < 5) throw new ServiceError('validation', 'Describe what changes in this revision (at least 5 characters).', { fieldErrors: { note: 'Required' } });
    const ctx: HookContext = { d, actor, correlationId: uid('cor') };
    withdrawPending(ctx, id, `superseded by a new revision`);
    patchRecordIn(ctx, 'quotations', id, { status: 'superseded', isLatest: false }, 'Superseded by a new revision');
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
    appendAudit(d, actor, { action: 'revise', resource: 'quotations', recordId: next.id, summary: `Revision R${rev} of ${baseNo(q.quoteNo)}: ${note.trim()}`, correlationId: ctx.correlationId });
    return next.id;
  });
}

// ---------------------------------------------------------------- scheduled sweeps (simulated server jobs)

const systemActor = () => actorFor(demoUsers[0].id, 'tc');

/**
 * FR-044 automatic expiry, stale "pending approval" clean-up (request withdrawn in the inbox) and
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
      withdrawPending(ctx, q.id, 'validity ended');
      patchRecordIn(ctx, 'quotations', q.id, { status: 'expired' }, `Expired automatically (valid until ${q.validUntil})`);
    });
    orphaned.filter((q) => !expiring.includes(q)).forEach((q) => patchRecordIn(ctx, 'quotations', q.id, { status: 'draft' }, 'Back to draft: the approval request was withdrawn'));
    stale.forEach((s) => {
      const a = d.approvals.find((x) => x.id === s.id)!;
      a.remindedAt = nowIso();
      demoUsers
        .map((u) => actorFor(u.id, a.workspaceId))
        .filter((x) => canDecide(x, a))
        .forEach((x) => notify(d, { userId: x.user.id, workspaceId: a.workspaceId, kind: 'reminder', title: `Reminder (${a.remindedAt!.slice(0, 10)}): ${a.levels[a.currentLevel]?.label} approval still pending — ${a.summary}`, link: { page: 'inbox' } }));
    });
  });
  return n;
}

// ---------------------------------------------------------------- approvals (registered in extensions)

export function onDiscountApproved(ctx: HookContext, recordId: string) {
  const q = (ctx.d.records.quotations ?? []).find((x) => x.id === recordId);
  if (q && q.status === 'pending_approval') patchRecordIn(ctx, 'quotations', recordId, { status: 'approved' }, 'Discount approved — ready to send');
}

export function onDiscountRejected(ctx: HookContext, recordId: string, note: string) {
  const q = (ctx.d.records.quotations ?? []).find((x) => x.id === recordId);
  if (q && q.status === 'pending_approval') patchRecordIn(ctx, 'quotations', recordId, { status: 'draft', rejectNote: `Discount rejected: ${note}` }, `Discount rejected — back to draft (${note})`);
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
  if (!quoteId && !perm(actor, 'quotations').create) throw new ServiceError('forbidden', `${actor.role.label} cannot create quotations.`);
  const quote = quoteId ? getQuote(actor, quoteId) : null;
  const d = getDb();
  const opps = quotableOpportunities(actor);
  const current = quote ? byId('opportunities', quote.record.opportunityId) : undefined;
  const fromParam = opportunityId ? opps.find((o) => o.id === opportunityId) ?? null : null;
  if (opportunityId && !fromParam) throw new ServiceError('not_found', `Opportunity ${opportunityId} is not open or not visible to you.`);
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
