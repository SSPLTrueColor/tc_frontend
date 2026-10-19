/** Quotations page services (async, simulated network). Same signatures a REST API would expose. */
import type { Actor } from '../authz';
import { call } from './client';
import {
  acceptQuote,
  type AcceptInput,
  backToDraft,
  decideQuoteApproval,
  editorData,
  getQuote,
  pendingQuoteApprovals,
  productOptions,
  quotableOpportunities,
  type QuoteInput,
  rejectQuote,
  reviseQuote,
  runQuotationSweep,
  saveQuote,
  sendQuote,
  type SendInput,
  submitQuote,
} from '../quotations/workflow';

export const quotationsApi = {
  get: (actor: Actor, id: string) => call(() => getQuote(actor, id)),
  opportunities: (actor: Actor) => call(() => quotableOpportunities(actor)),
  products: (divisionId?: string) => call(() => productOptions(divisionId), { fast: true }),
  editor: (actor: Actor, quoteId?: string, opportunityId?: string) => call(() => editorData(actor, quoteId, opportunityId)),
  save: (actor: Actor, input: QuoteInput) => call(() => saveQuote(actor, input)),
  submit: (actor: Actor, id: string, version: number, reason: string) => call(() => submitQuote(actor, id, version, reason)),
  backToDraft: (actor: Actor, id: string, version: number) => call(() => backToDraft(actor, id, version)),
  send: (actor: Actor, id: string, version: number, input: SendInput) => call(() => sendQuote(actor, id, version, input)),
  accept: (actor: Actor, id: string, version: number, input: AcceptInput) => call(() => acceptQuote(actor, id, version, input)),
  reject: (actor: Actor, id: string, version: number, reason: string, note: string) => call(() => rejectQuote(actor, id, version, reason, note)),
  /** Create Version: new version R(n+1) as a draft (QUO-09). */
  createVersion: (actor: Actor, id: string, version: number, note: string) => call(() => reviseQuote(actor, id, version, note)),
  /** Pending Approvals page (QUO-06 / QUO-14). */
  pendingApprovals: (actor: Actor) => call(() => pendingQuoteApprovals(actor)),
  decideApproval: (actor: Actor, approvalId: string, decision: 'approved' | 'rejected', note: string, version: number) => call(() => decideQuoteApproval(actor, approvalId, decision, note, version)),
  sweep: () => call(() => runQuotationSweep(), { fast: true }),
};

/** Pending Approvals rows for `useServiceQuery`, which adds the simulated network round-trip (QUO-06 / QUO-14). */
export const loadPendingApprovals = (actor: Actor) => pendingQuoteApprovals(actor);
export type { PendingApprovalRow } from '../quotations/workflow';
