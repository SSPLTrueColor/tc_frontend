/** Async page services for the leads module (simulated network boundary). */
import type { Actor } from '../authz';
import { call } from './client';
import {
  createLeadWithParty,
  disqualifyLead,
  followUpsFor,
  importLeads,
  nurtureLead,
  qualifyLead,
  type ImportPreviewRow,
  type NewCompanyInput,
  type NewContactInput,
  type QualifyInput,
} from '../leads/rules';

export const leadsApi = {
  create: (actor: Actor, lead: Record<string, unknown>, company: NewCompanyInput | null, contact: NewContactInput | null) => call(() => createLeadWithParty(actor, lead, company, contact)),
  qualify: (actor: Actor, id: string, version: number, input: QualifyInput) => call(() => qualifyLead(actor, id, version, input)),
  nurture: (actor: Actor, id: string, version: number, until: string, note: string) => call(() => nurtureLead(actor, id, version, until, note)),
  disqualify: (actor: Actor, id: string, version: number, reason: string, note: string) => call(() => disqualifyLead(actor, id, version, reason, note)),
  followUps: (actor: Actor, days: number) => call(() => followUpsFor(actor, days)),
  import: (actor: Actor, rows: ImportPreviewRow[], eventName: string) => call(() => importLeads(actor, rows, eventName)),
};
