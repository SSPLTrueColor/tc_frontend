/**
 * Quotation selection (BR-20, QUO-07/10/12, SO-01): one quotation per opportunity is selected — accepted by
 * the customer or ordered with the customer PO. Every other open quotation (and revision) of the opportunity
 * becomes "Not Selected" (read-only) with its pending approvals withdrawn, in the same commit as the
 * selection. Marking the opportunity Lost closes its open quotations the same way.
 *
 * Kept free of the quotation workflow so the opportunity and order services can use it without cycles.
 */
import { L } from '../../constants/labels';
import { nowIso } from '../../lib/clock';
import type { RecordData } from '../../metadata/types';
import { appendAudit } from '../ledger';
import { getPolicies } from '../policies';
import { masterLabel } from '../registry';
import type { HookContext } from '../resourceHooks';
import { patchRecordIn } from '../runtime';
import type { Db } from '../types';
import { reopenApprovalIn } from '../workflow';

export const QUOTE_APPROVAL = 'quotation.discount';
/** Statuses that are still open (they close as Not Selected when another quotation is selected). */
export const OPEN_QUOTE = ['draft', 'pending_approval', 'approved', 'sent', 'negotiation'];
const RESTORABLE = ['draft', 'approved', 'sent', 'negotiation'];

const S = L.quotations.selection;
const quotes = (d: Db) => (d.records.quotations ?? []) as RecordData[];
const noOf = (q: RecordData | undefined) => String(q?.quoteNo ?? q?.id ?? '');

/** Live (not cancelled) sales order of an opportunity. */
export const liveOrderForOpportunity = (d: Db, oppId: unknown): RecordData | undefined =>
  oppId ? ((d.records.salesOrders ?? []) as RecordData[]).find((o) => o.opportunityId === oppId && o.status !== 'cancelled') : undefined;

/** Live sales order generated from a quotation or for its opportunity. */
export const liveOrderForQuote = (d: Db, q: RecordData): RecordData | undefined =>
  ((d.records.salesOrders ?? []) as RecordData[]).find((o) => o.status !== 'cancelled' && (o.quotationId === q.id || (!!q.opportunityId && o.opportunityId === q.opportunityId)));

/** The selected (accepted) quotation of an opportunity. */
export function selectedQuoteOf(d: Db, oppId: unknown): RecordData | undefined {
  if (!oppId) return undefined;
  const opp = ((d.records.opportunities ?? []) as RecordData[]).find((o) => o.id === oppId);
  const byField = opp?.selectedQuotationId ? quotes(d).find((q) => q.id === opp.selectedQuotationId && q.status === 'accepted') : undefined;
  return byField ?? quotes(d).find((q) => q.opportunityId === oppId && q.status === 'accepted');
}

/**
 * The one guard for every quotation action (edit, submit, approve, send, accept, reject, version, order,
 * lifecycle / bulk / board moves). Returns why the quotation can no longer be acted on, or undefined.
 * The selected (accepted) quotation itself stays actionable (generate order, undo selection).
 */
export function quoteBlockReason(d: Db, q: RecordData | undefined): string | undefined {
  if (!q) return undefined;
  const no = noOf(q);
  if (q.status === 'not_selected') {
    const sel = q.selectedQuotationId ? quotes(d).find((x) => x.id === q.selectedQuotationId) : undefined;
    if (sel) return S.notSelected(no, S.reasonAccepted(noOf(sel)));
    if (q.notSelectedReason === S.reasonLost) return S.notSelectedLost(no);
    return S.notSelected(no, String(q.notSelectedReason ?? ''));
  }
  if (q.status === 'accepted' || !q.opportunityId) return undefined;
  const opp = ((d.records.opportunities ?? []) as RecordData[]).find((o) => o.id === q.opportunityId);
  if (opp?.stage === 'lost') return S.oppLost(String(opp.id));
  const other = quotes(d).find((x) => x.id !== q.id && x.opportunityId === q.opportunityId && x.status === 'accepted');
  if (other) return S.otherAccepted(noOf(other));
  return undefined;
}

/** Withdraws the pending discount approval(s) of a quotation (closed in the approvals store, audited). */
export function withdrawQuoteApprovals(ctx: HookContext, id: string, why: string, forSelection = false) {
  ctx.d.approvals.forEach((a) => {
    if (a.recordId === id && a.type === QUOTE_APPROVAL && a.status === 'pending') {
      a.status = 'withdrawn';
      a.decidedAt = nowIso();
      a.decisionNote = why;
      // Withdrawn because another quotation was selected: Undo Selection re-opens it.
      if (forSelection) a.withdrawnFor = 'selection';
      a.version++;
      appendAudit(ctx.d, ctx.actor, { action: 'approval.withdrawn', actorType: 'workflow', resource: 'quotations', recordId: id, summary: L.quotations.audit.withdrawn(a.id, why), correlationId: ctx.correlationId });
    }
  });
}

/**
 * Marks every other open quotation of the opportunity Not Selected (read-only), withdrawing its pending
 * approvals. `winnerId` is the selected quotation (null when the opportunity was lost). Returns how many closed.
 */
export function closeOtherQuotesIn(ctx: HookContext, oppId: unknown, winnerId: string | null, reason: string): number {
  if (!oppId) return 0;
  const at = nowIso();
  const ids = quotes(ctx.d)
    .filter((q) => q.opportunityId === oppId && q.id !== winnerId && OPEN_QUOTE.includes(String(q.status)))
    .map((q) => q.id);
  ids.forEach((id) => {
    const q = quotes(ctx.d).find((x) => x.id === id)!;
    withdrawQuoteApprovals(ctx, id, S.withdrawWhy(reason), true);
    patchRecordIn(ctx, 'quotations', id, { status: 'not_selected', previousStatus: q.status, notSelectedAt: at, notSelectedReason: reason, selectedQuotationId: winnerId }, S.auditNotSelected(reason));
  });
  if (ids.length) appendAudit(ctx.d, ctx.actor, { action: 'quotations.not_selected', actorType: 'workflow', resource: 'opportunities', recordId: String(oppId), summary: S.auditOppClosed(ids.length, reason), correlationId: ctx.correlationId });
  return ids.length;
}

/**
 * A quotation was selected (accepted or ordered): the opportunity is Won at the selected value and remembers
 * the selected quotation; every other open quotation becomes Not Selected. Same commit as the acceptance.
 */
export function selectQuotationIn(ctx: HookContext, q: RecordData, reason: string, value: number, wonSummary: string) {
  const opp = ((ctx.d.records.opportunities ?? []) as RecordData[]).find((o) => o.id === q.opportunityId);
  if (opp) {
    const v = value || Number(opp.value) || 0;
    if (!['won', 'lost'].includes(String(opp.stage))) {
      // The won deal is worth what the customer accepted, not the early estimate (pipeline / won reports read this value).
      patchRecordIn(ctx, 'opportunities', String(opp.id), { stage: 'won', wonAt: nowIso(), stageChangedAt: nowIso(), probability: 100, value: v, selectedQuotationId: q.id, preWinStage: opp.stage, preWinValue: opp.value ?? null, preWinProbability: opp.probability ?? null }, wonSummary);
    } else if (opp.stage === 'won' && (opp.selectedQuotationId !== q.id || Number(opp.value) !== v)) {
      patchRecordIn(ctx, 'opportunities', String(opp.id), { selectedQuotationId: q.id, value: v }, S.auditSelected(noOf(q)));
    }
  }
  closeOtherQuotesIn(ctx, q.opportunityId, q.id, reason);
}

/** What restoring Not Selected quotations did: which came back to Pending Approval (approval re-opened) and which as Draft. */
export interface RestoreOutcome {
  pending: { quoteNo: string; approvalId: string }[];
  drafted: string[];
}

/**
 * Re-opens Not Selected quotations at their previous status. One that was Pending Approval returns to
 * Pending Approval with its withdrawn approval re-opened; when that is not possible it returns as a Draft.
 */
function restoreQuotesIn(ctx: HookContext, list: RecordData[], summary: string, why: string): RestoreOutcome {
  const out: RestoreOutcome = { pending: [], drafted: [] };
  list.forEach((q) => {
    const prev = String(q.previousStatus ?? '');
    let status = RESTORABLE.includes(prev) ? prev : 'draft';
    if (prev === 'pending_approval') {
      const a = ctx.d.approvals.filter((x) => x.recordId === q.id && x.type === QUOTE_APPROVAL && x.status === 'withdrawn' && x.withdrawnFor === 'selection').sort((x, y) => String(y.decidedAt ?? '').localeCompare(String(x.decidedAt ?? '')))[0];
      if (a && reopenApprovalIn(ctx, a, why)) {
        status = 'pending_approval';
        out.pending.push({ quoteNo: noOf(q), approvalId: a.id });
      } else out.drafted.push(noOf(q));
    }
    patchRecordIn(ctx, 'quotations', q.id, { status, previousStatus: null, notSelectedAt: null, notSelectedReason: null, selectedQuotationId: null }, summary);
  });
  return out;
}

/** Returns the selected quotation to its status before acceptance and re-opens its Not Selected alternatives. */
export function unselectQuotationIn(ctx: HookContext, winner: RecordData, summary: string, siblingSummary: string): RestoreOutcome {
  const prev = String(winner.previousStatus ?? '');
  patchRecordIn(
    ctx,
    'quotations',
    winner.id,
    { status: ['approved', 'sent', 'negotiation'].includes(prev) ? prev : 'negotiation', previousStatus: null, acceptedAt: null, acceptanceMethod: null, acceptedByName: null, customerPoNo: null, customerPoDate: null, poFileName: null },
    summary,
  );
  return restoreQuotesIn(ctx, quotes(ctx.d).filter((q) => q.opportunityId === winner.opportunityId && q.status === 'not_selected' && q.selectedQuotationId === winner.id), siblingSummary, S.reopenWhy(noOf(winner)));
}

/** Undo the selection on the opportunity: back to the stage (and value) it had before it was won. */
export function restoreOpportunityIn(ctx: HookContext, oppId: unknown, summary: (stageLabel: string) => string) {
  const opp = ((ctx.d.records.opportunities ?? []) as RecordData[]).find((o) => o.id === oppId);
  if (!opp || opp.stage !== 'won') return;
  const stage = ['needs_assessment', 'demo', 'proposal', 'negotiation'].includes(String(opp.preWinStage)) ? String(opp.preWinStage) : 'negotiation';
  patchRecordIn(
    ctx,
    'opportunities',
    String(opp.id),
    { stage, probability: getPolicies().stageProbability[stage] ?? 0, wonAt: null, stageChangedAt: nowIso(), selectedQuotationId: null, value: opp.preWinValue ?? opp.value, preWinStage: null, preWinValue: null, preWinProbability: null },
    summary(masterLabel('oppStage', stage)),
  );
}

/** Why re-opening the opportunity is not allowed (a live sales order exists), or undefined. */
export function reopenBlockReason(d: Db, opp: RecordData, to: string): string | undefined {
  if (to !== 'needs_assessment' || opp.stage !== 'won') return undefined;
  const so = liveOrderForOpportunity(d, opp.id);
  return so ? S.reopenOrderExists(String(so.orderNo ?? so.id)) : undefined;
}

/** After a Won / Lost opportunity is re-opened: its quotations open again (accepted one back to its previous status). */
export function reopenQuotesIn(ctx: HookContext, before: RecordData) {
  const oppId = before.id;
  if (before.stage === 'won') {
    const winner = selectedQuoteOf(ctx.d, oppId);
    if (winner) unselectQuotationIn(ctx, winner, S.auditReopenRestored, S.auditReopenRestored);
  } else if (before.stage === 'lost') {
    restoreQuotesIn(ctx, quotes(ctx.d).filter((q) => q.opportunityId === oppId && q.status === 'not_selected' && !q.selectedQuotationId && q.notSelectedReason === S.reasonLost), S.auditReopenRestored, S.auditReopenRestored);
  }
  const opp = ((ctx.d.records.opportunities ?? []) as RecordData[]).find((o) => o.id === oppId);
  if (opp?.selectedQuotationId) patchRecordIn(ctx, 'opportunities', String(oppId), { selectedQuotationId: null, preWinStage: null, preWinValue: null, preWinProbability: null });
}
