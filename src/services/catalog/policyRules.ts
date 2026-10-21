/**
 * Validation and page grouping for the configurable business numbers (services/policies.ts).
 * Administration shows them on three pages (GLOSSARY G-A12, G-B9):
 *   workflows → Workflows & Approval Matrices (ADM-04)
 *   sla       → SLA Matrix (SRV-04, SRV-09)
 *   rules     → Configurable Rules (ADM-04, ADM-09)
 */
import { L } from '../../constants/labels';
import type { Policies } from '../policies';
import { activeMasterValues, getMaster } from '../registry';

export type PolicyGroup = 'workflows' | 'sla' | 'rules';

/** Which policy keys each page owns. Every key of Policies belongs to exactly one page. */
export const POLICY_GROUPS: Record<PolicyGroup, (keyof Policies)[]> = {
  workflows: ['discountBands', 'soTolerancePct', 'soFinanceCheckAdvancePct', 'paymentReminderDaysBefore'],
  sla: ['sla', 'escalation'],
  rules: [
    'leadFirstContactHours',
    'opportunityStagnationDays',
    'stageProbability',
    'quoteValidityDays',
    'companyGstState',
    'defaultWarrantyMonths',
    'renewalReminderDays',
    'repeatComplaintDays',
    'reopenWindowDays',
    'autoCloseDays',
    'lowRatingThreshold',
    'leakageDays',
    'missedReorderDays',
    'dormantDays',
    'geofenceRadiusM',
    'shift',
    'conveyance',
    'maxFileMb',
  ],
};

/** Stage probability rows: every Opportunity Stage master value, in master order (ADM-04). */
export const stageKeys = (): string[] => [...getMaster('oppStage').values].filter((v) => v.active || ['won', 'lost'].includes(v.key)).sort((a, b) => a.order - b.order).map((v) => v.key);
/** SLA rows: every active Ticket Priority master value (a new priority starts with Medium's hours). */
export const priorityKeys = (): string[] => activeMasterValues('ticketPriority').map((v) => v.key);
export const COVERAGE_KEYS = ['cmc', 'amc', 'warranty', 'none'] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export type PolicyErrors = Record<string, string>;

/** Error key → policy key it belongs to (error keys are `policyKey` or `prefix.detail`). */
const ERROR_PREFIX: Record<string, keyof Policies> = { stage: 'stageProbability', band: 'discountBands', sla: 'sla', esc: 'escalation', shift: 'shift', conveyance: 'conveyance' };
export const errorPolicyKey = (errorKey: string): keyof Policies => ERROR_PREFIX[errorKey.split('.')[0]] ?? (errorKey as keyof Policies);

/** Validation for every policy value (non-negative, ordered bands, response ≤ arrival ≤ resolution …). */
export function validatePolicies(p: Policies): PolicyErrors {
  const E = L.admin.policies.errors;
  const e: PolicyErrors = {};
  const nonNeg = (k: string, v: number, max?: number) => {
    if (!Number.isFinite(v) || v < 0) e[k] = E.nonNegative;
    else if (max !== undefined && v > max) e[k] = E.atMost(max);
  };
  const positive = (k: string, v: number) => {
    if (!Number.isFinite(v) || v <= 0) e[k] = E.positive;
  };
  positive('leadFirstContactHours', p.leadFirstContactHours);
  positive('opportunityStagnationDays', p.opportunityStagnationDays);
  positive('quoteValidityDays', p.quoteValidityDays);
  nonNeg('soTolerancePct', p.soTolerancePct, 100);
  nonNeg('soFinanceCheckAdvancePct', p.soFinanceCheckAdvancePct, 100);
  nonNeg('paymentReminderDaysBefore', p.paymentReminderDaysBefore, 90);
  positive('defaultWarrantyMonths', p.defaultWarrantyMonths);
  positive('repeatComplaintDays', p.repeatComplaintDays);
  nonNeg('reopenWindowDays', p.reopenWindowDays);
  positive('autoCloseDays', p.autoCloseDays);
  if (!(p.lowRatingThreshold >= 1 && p.lowRatingThreshold <= 4)) e.lowRatingThreshold = E.rating;
  positive('leakageDays', p.leakageDays);
  nonNeg('missedReorderDays', p.missedReorderDays);
  positive('dormantDays', p.dormantDays);
  positive('geofenceRadiusM', p.geofenceRadiusM);
  positive('maxFileMb', p.maxFileMb);
  nonNeg('conveyance.twoWheeler', p.conveyance.twoWheeler);
  nonNeg('conveyance.car', p.conveyance.car);
  stageKeys().forEach((k) => nonNeg(`stage.${k}`, p.stageProbability[k] ?? NaN, 100));
  if (!p.renewalReminderDays.length || p.renewalReminderDays.some((d) => !Number.isInteger(d) || d <= 0)) e.renewalReminderDays = E.renewal;
  if (!TIME.test(p.shift.start)) e['shift.start'] = E.time;
  if (!TIME.test(p.shift.end)) e['shift.end'] = E.time;
  if (TIME.test(p.shift.start) && TIME.test(p.shift.end) && p.shift.end <= p.shift.start) e['shift.end'] = E.afterStart;
  nonNeg('shift.graceMin', p.shift.graceMin, 120);
  if (!(p.shift.halfDayHours > 0 && p.shift.halfDayHours < 12)) e['shift.halfDayHours'] = E.halfDay;
  p.discountBands.forEach((b, i) => {
    if (!(b.upTo > 0 && b.upTo <= 100)) e[`band.${i}`] = E.bandRange;
    else if (i > 0 && b.upTo <= p.discountBands[i - 1].upTo) e[`band.${i}`] = E.bandOrder;
  });
  if (!p.discountBands.length || p.discountBands[p.discountBands.length - 1].upTo !== 100) e.discountBands = E.lastBand;
  priorityKeys().forEach((pr) =>
    COVERAGE_KEYS.forEach((cv) => {
      const s = p.sla[pr]?.[cv];
      const k = `sla.${pr}.${cv}`;
      if (!s || [s.response, s.arrival, s.resolution].some((x) => !(x > 0))) e[k] = E.slaPositive;
      else if (!(s.response <= s.arrival && s.arrival <= s.resolution)) e[k] = E.slaOrder;
    }),
  );
  p.escalation.forEach((x, i) => {
    if (!x.to.trim()) e[`esc.${i}`] = E.escalationTo;
    else if (!(x.afterHours >= 0) || (i > 0 && x.afterHours <= p.escalation[i - 1].afterHours)) e[`esc.${i}`] = E.escalationOrder;
  });
  return e;
}

/** Errors that belong to one page. */
export function validatePolicyGroup(p: Policies, group: PolicyGroup): PolicyErrors {
  const keys = new Set<string>(POLICY_GROUPS[group]);
  return Object.fromEntries(Object.entries(validatePolicies(p)).filter(([k]) => keys.has(errorPolicyKey(k))));
}

/** The values of one page only (for a save or a reset). */
export function pickGroup(p: Policies, group: PolicyGroup): Partial<Policies> {
  return Object.fromEntries(POLICY_GROUPS[group].map((k) => [k, structuredClone(p[k])])) as Partial<Policies>;
}
