/** Quotations page services (async, simulated network). Same signatures a REST API would expose. */
import type { Actor } from '../authz';
import { call } from './client';
import {
  acceptQuote,
  type AcceptInput,
  backToDraft,
  editorData,
  getQuote,
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
  revise: (actor: Actor, id: string, version: number, note: string) => call(() => reviseQuote(actor, id, version, note)),
  sweep: () => call(() => runQuotationSweep(), { fast: true }),
};
