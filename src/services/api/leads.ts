/** Async page services for the leads module (simulated network boundary). */
import type { Actor } from '../authz';
import { call } from './client';
import {
  createLeadWithParty,
  disqualifyLead,
  followUpsFor,
  importLeads,
  notAttendedLeads,
  nurtureLead,
  qualifyLead,
  type ImportPreviewRow,
  type NewCompanyInput,
  type NewContactInput,
  type QualifyInput,
} from '../leads/rules';

export const leadsApi = {
  create: (actor: Actor, lead: Record<string, unknown>, company: NewCompanyInput | null, contact: NewContactInput | null, opts?: { duplicateReason?: string }) => call(() => createLeadWithParty(actor, lead, company, contact, opts)),
  /** LEAD-10: Convert to Opportunity. */
  convertToOpportunity: (actor: Actor, id: string, version: number, input: QualifyInput) => call(() => qualifyLead(actor, id, version, input)),
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
