/**
 * Async service boundary for the Service module pages (simulated latency / failures, see client.ts).
 * Reads run the SLA sweep first so breaches, escalations and auto-closures are current.
 */
import { activeMasterValues } from '../registry';
import type { Actor } from '../authz';
import { call } from './client';
import { engineerLoads, suggestEngineers, territoryGrid, unassignedTickets } from '../service/board';
import { acceptJob, checkIn, checkOut, myJobs, rejectJob, saveWork, setWaiting, startTravel, type WorkInput } from '../service/jobs';
import { assignPm, completePm, pmChecklist, pmSchedule, raisePmTicket } from '../service/pm';
import { searchArticles, type KbQuery } from '../service/kb';
import {
  assignTicket,
  createTicketFromChannel,
  feedbackLookup,
  type NewTicketInput,
  opportunitySpotted,
  portalIdentify,
  quoteChargeable,
  recordChargeableDecision,
  recordRemoteSession,
  requestBilling,
  resendJobCard,
  simulateIncoming,
  submitFeedback,
  sweepService,
  waiveCharges,
} from '../service/tickets';
import { getRecord } from '../runtime';
import { byId } from '../lookups';

const swept = <T>(actor: Actor, op: () => T) => () => {
  sweepService(actor);
  return op();
};

/** Sync loaders for useServiceQuery (it adds the simulated latency itself). */
export const loaders = {
  board: (actor: Actor) =>
    swept(actor, () => ({
      unassigned: unassignedTickets(actor),
      engineers: engineerLoads(actor),
      territories: territoryGrid(
        actor,
        activeMasterValues('territory').map((t) => ({ key: t.key, label: t.label })),
      ),
    })),
  myJobs: (actor: Actor) => swept(actor, () => myJobs(actor)),
  job: (actor: Actor, id: string) => () => getRecord(actor, 'tickets', id).record,
  pm: (actor: Actor) => swept(actor, () => pmSchedule(actor)),
  knowledgeBase: (actor: Actor, q: KbQuery) => () => searchArticles(actor, q),
};

export const serviceApi = {
  suggest: (actor: Actor, ticketId: string) => call(() => suggestEngineers(actor, getRecord(actor, 'tickets', ticketId).record)),
  assign: (actor: Actor, ticketId: string, staffId: string) => call(() => assignTicket(actor, ticketId, staffId)),
  remote: (actor: Actor, id: string, input: Parameters<typeof recordRemoteSession>[2]) => call(() => recordRemoteSession(actor, id, input)),
  quote: (actor: Actor, id: string, amount: number, note: string) => call(() => quoteChargeable(actor, id, amount, note)),
  chargeableDecision: (actor: Actor, id: string, approved: boolean) => call(() => recordChargeableDecision(actor, id, approved)),
  billing: (actor: Actor, id: string) => call(() => requestBilling(actor, id)),
  waive: (actor: Actor, id: string, reason: string) => call(() => waiveCharges(actor, id, reason)),
  spotted: (actor: Actor, id: string, input: { interest: string; note: string }) => call(() => opportunitySpotted(actor, id, input)),
  resendJobCard: (actor: Actor, id: string) => call(() => resendJobCard(actor, id)),
  incoming: (actor: Actor, input: Parameters<typeof simulateIncoming>[1]) => call(() => simulateIncoming(actor, input)),
  // Engineer job card steps (pages wrap them in runOrQueue for offline mode).
  accept: acceptJob,
  reject: rejectJob,
  waiting: setWaiting,
  startTravel,
  checkIn,
  saveWork: (actor: Actor, id: string, w: WorkInput, version?: number) => saveWork(actor, id, w, version),
  checkOut,
  // PM
  assignPm: (actor: Actor, id: string, staffId: string) => call(() => assignPm(actor, id, staffId)),
  completePm: (actor: Actor, id: string, input: Parameters<typeof completePm>[2]) => call(() => completePm(actor, id, input)),
  raisePmTicket: (actor: Actor, id: string) => call(() => raisePmTicket(actor, id)),
  checklistFor: (machineId: unknown) => pmChecklist(byId('machines', machineId)),
  checklistForVisit: (pmId: string) => pmChecklist(byId('machines', byId('pmVisits', pmId)?.machineId)),
  /** Active service engineers the actor may see (assignment pickers and filters). */
  engineerOptions: (actor: Actor) => engineerLoads(actor).map((e) => ({ value: e.id, label: e.name })),
};

/** Public pages (no sign-in): customer portal and feedback link. */
export const publicApi = {
  identify: (query: string) => call(() => portalIdentify(query)),
  createTicket: (input: NewTicketInput) => call(() => createTicketFromChannel(input)),
  feedback: (token: string) => call(() => feedbackLookup(token)),
  submitFeedback: (token: string, input: Parameters<typeof submitFeedback>[1]) => call(() => submitFeedback(token, input)),
};
