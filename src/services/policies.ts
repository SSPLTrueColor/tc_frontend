/**
 * Configurable business policies (REQUIREMENTS §5 — values marked "Assumption, configurable").
 * Defaults live here; an administrator overrides them at /admin/policies (catalog module).
 * Every module reads policies through getPolicies() — never hard-code these numbers.
 */
import { nowIso } from '../lib/clock';
import { uid } from '../lib/ids';
import { type Actor, can } from './authz';
import { commit, getDb } from './db';
import { appendAudit } from './ledger';
import { getMaster } from './registry';
import { type ApprovalLevel, ServiceError } from './types';
import { L } from '../constants/labels';

export interface Policies {
  /** True Colors' own GST registration state code (Q-10). Same state → CGST+SGST, else IGST. */
  companyGstState: string;
  /** BR-08 first-contact SLA for new leads. */
  leadFirstContactHours: number;
  /** BR-12 stagnation alert after N days without activity. */
  opportunityStagnationDays: number;
  /** BR-11 default probability per opportunity stage key (%). */
  stageProbability: Record<string, number>;
  /** BR-14 default quotation validity. */
  quoteValidityDays: number;
  /** BR-17 discount approval: highest line discount % → levels. Up to `upTo` % needs the listed capabilities in order. */
  discountBands: { upTo: number; levels: ApprovalLevel[] }[];
  /** BR-22 SO value change vs quotation that re-triggers approval (± %). */
  soTolerancePct: number;
  /** BR-23 finance check when advance % is below this, or the customer has overdue amounts. */
  soFinanceCheckAdvancePct: number;
  /** BR-25 payment reminders: days before due date. */
  paymentReminderDaysBefore: number;
  /** BR-28 default warranty when the product has none. */
  defaultWarrantyMonths: number;
  /** IB-05 renewal reminders (days before end). */
  renewalReminderDays: number[];
  /** BR-30 SLA hours by priority × coverage: sla[priority][coverage] = { response, arrival, resolution }. */
  sla: Record<string, Record<string, { response: number; arrival: number; resolution: number }>>;
  /** BR-32 escalation chain after a breach: hours after breach → role label. */
  escalation: { afterHours: number; to: string }[];
  /** BR-33 repeat complaint window. */
  repeatComplaintDays: number;
  /** BR-34 re-open window after closure. */
  reopenWindowDays: number;
  /** Auto-close tickets awaiting customer confirmation after N days. */
  autoCloseDays: number;
  /** BR-35 ratings at or below this alert the service manager. */
  lowRatingThreshold: number;
  /** BR-39 machine customer with no consumables order in N days → leakage. */
  leakageDays: number;
  /** BR-40 reorder "missed" after N days overdue. */
  missedReorderDays: number;
  /** BR-51 dormant customer after N days with no order and no activity. */
  dormantDays: number;
  /** BR-42 geofence radius for office attendance. */
  geofenceRadiusM: number;
  /** BR-43 shift policy. */
  shift: { start: string; end: string; graceMin: number; halfDayHours: number };
  /** BR-46 conveyance ₹/km. */
  conveyance: { twoWheeler: number; car: number };
  /** COM-04 file size limit. */
  maxFileMb: number;
}

const L1: ApprovalLevel = { capability: 'approve.l1', label: L.roles.approvalLevels[1] };
const L2: ApprovalLevel = { capability: 'approve.l2', label: L.roles.approvalLevels[2] };
const L3: ApprovalLevel = { capability: 'approve.l3', label: L.roles.approvalLevels[3] };
const crit = (r: number, a: number, s: number) => ({ response: r, arrival: a, resolution: s });

export const DEFAULT_POLICIES: Policies = {
  companyGstState: '27',
  leadFirstContactHours: 24,
  opportunityStagnationDays: 14,
  stageProbability: { needs_assessment: 10, demo: 25, proposal: 50, negotiation: 75, won: 100, lost: 0 },
  quoteValidityDays: 30,
  discountBands: [
    { upTo: 5, levels: [] },
    { upTo: 10, levels: [L1] },
    { upTo: 15, levels: [L1, L2] },
    { upTo: 100, levels: [L1, L2, L3] },
  ],
  soTolerancePct: 2,
  soFinanceCheckAdvancePct: 30,
  paymentReminderDaysBefore: 7,
  defaultWarrantyMonths: 12,
  renewalReminderDays: [90, 60, 30],
  sla: {
    critical: { cmc: crit(1, 4, 8), amc: crit(1, 4, 8), warranty: crit(1, 4, 8), none: crit(2, 8, 24) },
    high: { cmc: crit(2, 8, 24), amc: crit(2, 8, 24), warranty: crit(2, 8, 24), none: crit(4, 24, 48) },
    medium: { cmc: crit(4, 24, 48), amc: crit(4, 24, 48), warranty: crit(4, 24, 48), none: crit(8, 48, 72) },
    low: { cmc: crit(8, 48, 96), amc: crit(8, 48, 96), warranty: crit(8, 48, 96), none: crit(24, 72, 120) },
  },
  escalation: [
    { afterHours: 0, to: L.roles.escalationLevels[1] },
    { afterHours: 4, to: L.roles.escalationLevels[2] },
    { afterHours: 8, to: L.roles.escalationLevels[3] },
    { afterHours: 24, to: L.roles.escalationLevels[4] },
  ],
  repeatComplaintDays: 30,
  reopenWindowDays: 15,
  autoCloseDays: 3,
  lowRatingThreshold: 2,
  leakageDays: 90,
  missedReorderDays: 7,
  dormantDays: 180,
  geofenceRadiusM: 200,
  shift: { start: '09:30', end: '18:30', graceMin: 15, halfDayHours: 4.5 },
  conveyance: { twoWheeler: 4, car: 9 },
  maxFileMb: 10,
};

export function getPolicies(): Policies {
  const o = (getDb().config.policies ?? {}) as Partial<Policies>;
  return withMasterDefaults({ ...DEFAULT_POLICIES, ...o });
}

const masterKeys = (key: string) => {
  try {
    return [...getMaster(key).values].sort((a, b) => a.order - b.order).map((v) => v.key);
  } catch {
    return [];
  }
};

/**
 * ADM-04: values added to the Opportunity Stage and Ticket Priority masters take part at once.
 * A new stage gets a probability between its neighbours (editable under Configurable Rules); a new
 * priority gets a copy of Medium's SLA row (editable on the SLA Matrix). Saved values always win.
 */
function withMasterDefaults(p: Policies): Policies {
  const stages = masterKeys('oppStage').filter((k) => k !== 'won' && k !== 'lost');
  const missingStage = stages.filter((k) => p.stageProbability[k] === undefined);
  const missingPriority = masterKeys('ticketPriority').filter((k) => !p.sla[k]);
  if (!missingStage.length && !missingPriority.length) return p;
  const stageProbability = { ...p.stageProbability };
  missingStage.forEach((k) => {
    const i = stages.indexOf(k);
    const before = stages.slice(0, i).reverse().map((s) => stageProbability[s]).find((x) => x !== undefined) ?? 0;
    const after = stages.slice(i + 1).map((s) => stageProbability[s]).find((x) => x !== undefined) ?? Math.min(100, before + 10);
    stageProbability[k] = Math.round((before + after) / 2);
  });
  const sla = { ...p.sla };
  missingPriority.forEach((k) => (sla[k] = structuredClone(p.sla.medium ?? Object.values(p.sla)[0])));
  return { ...p, stageProbability, sla };
}

export function updatePolicies(actor: Actor, patch: Partial<Policies>) {
  if (!can(actor, 'config.publish')) throw new ServiceError('forbidden', L.common.errors.policiesOnly);
  commit((d) => {
    d.config.policies = { ...(d.config.policies ?? {}), ...patch };
    appendAudit(d, actor, { action: 'config.policies', summary: L.common.audit.policiesChanged(Object.keys(patch).join(', '), nowIso().slice(0, 10)), correlationId: uid('cor') });
  });
}

/** BR-17: approval levels for the highest line discount on a quotation. Empty = auto-approved. */
export function discountApprovalLevels(maxDiscountPct: number): ApprovalLevel[] {
  const band = getPolicies().discountBands.find((b) => maxDiscountPct <= b.upTo) ?? getPolicies().discountBands[getPolicies().discountBands.length - 1];
  return band.levels;
}
