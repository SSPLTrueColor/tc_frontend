/** Async page services for the leads module (simulated network boundary). */
import type { Actor } from '../authz';
import { call } from './client';
import {
  convertWithFirstContact,
  createLeadWithParty,
  disqualifyLead,
  followUpsFor,
  importLeads,
  logLeadContact,
  notAttendedLeads,
  nurtureLead,
  qualifyLead,
  reactivateLead,
  type FirstContactInput,
  type ImportPreviewRow,
  type NewCompanyInput,
  type NewContactInput,
  type QualifyInput,
} from '../leads/rules';

export const leadsApi = {
  create: (actor: Actor, lead: Record<string, unknown>, company: NewCompanyInput | null, contact: NewContactInput | null, opts?: { duplicateReason?: string }) => call(() => createLeadWithParty(actor, lead, company, contact, opts)),
  /** LEAD-10: Convert to Opportunity. */
  convertToOpportunity: (actor: Actor, id: string, version: number, input: QualifyInput) => call(() => qualifyLead(actor, id, version, input)),
  /** LEAD-10 combined path: log the first contact / reactivate a Nurture lead, then convert — one atomic write. */
  convertWithFirstContact: (actor: Actor, id: string, version: number, input: QualifyInput, firstContact?: FirstContactInput) => call(() => convertWithFirstContact(actor, id, version, input, firstContact)),
  /** Step 1 of the combined flow: log the first contact (lead moves to Contacted); returns the updated lead. */
  logContact: (actor: Actor, id: string, fc: FirstContactInput) => call(() => logLeadContact(actor, id, fc)),
  /** LEAD-11: Nurture → Contacted with the next follow-up date. */
  reactivate: (actor: Actor, id: string, version: number, nextFollowUpAt: string, note: string) => call(() => reactivateLead(actor, id, version, nextFollowUpAt, note)),
  nurture: (actor: Actor, id: string, version: number, until: string, note: string) => call(() => nurtureLead(actor, id, version, until, note)),
  disqualify: (actor: Actor, id: string, version: number, reason: string, note: string) => call(() => disqualifyLead(actor, id, version, reason, note)),
  followUps: (actor: Actor, days: number) => call(() => followUpsFor(actor, days)),
  /** LEAD-08: Not Attended Leads dashboard (leads past the first-contact SLA, role-scoped). */
  notAttended: (actor: Actor) => call(() => notAttendedLeads(actor)),
  import: (actor: Actor, rows: ImportPreviewRow[], eventName: string) => call(() => importLeads(actor, rows, eventName)),
};

/**
 * Synchronous query bodies for `useServiceQuery`, which adds the simulated latency itself and
 * refreshes silently on store changes. Same data as the async functions above.
 */
export const leadsQueries = {
  followUps: (actor: Actor, days: number) => followUpsFor(actor, days),
  notAttended: (actor: Actor) => notAttendedLeads(actor),
};
