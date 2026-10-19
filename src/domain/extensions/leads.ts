/** leads module: runtime hooks, computed-field lookups, SLA/reminder sweep, record actions and banner. */
import { addDays, nowLocal, todayKey } from '../../lib/dates';
import { currentActor } from '../../services/authz';
import { getDb, getRevision, subscribe } from '../../services/db';
import { getPolicies } from '../../services/policies';
import { registerResourceHooks } from '../../services/resourceHooks';
import { patchRecordIn } from '../../services/runtime';
import { isSignedIn } from '../../services/session';
import { ServiceError } from '../../services/types';
import { injectLeadDeps } from '../modules/leads/computed';
import { ownerDivisionError, resolveOwner, sweepLeads } from '../../services/leads/rules';
import { registerRecordActions, registerRecordBanner } from '../../components/resource/extensions';
import { LeadActions, LeadBanner } from '../../modules/leads/LeadActions';

// Computed fields (score, SLA flags) read live data through these lookups; activity counts are cached per store revision.
let countCache: { rev: number; counts: Map<string, number> } = { rev: -1, counts: new Map() };
injectLeadDeps({
  scoringRules: () => getDb().records.leadScoringRules ?? [],
  activityCount: (leadId) => {
    if (countCache.rev !== getRevision()) {
      const counts = new Map<string, number>();
      (getDb().records.activities ?? []).forEach((a) => a.parentResource === 'leads' && counts.set(String(a.parentId), (counts.get(String(a.parentId)) ?? 0) + 1));
      countCache = { rev: getRevision(), counts };
    }
    return countCache.counts.get(leadId) ?? 0;
  },
  firstContactHours: () => getPolicies().leadFirstContactHours,
});

registerResourceHooks('leads', {
  beforeCreate: (ctx, c) => {
    resolveOwner(ctx, c);
    const err = ownerDivisionError(ctx.d, c.ownerId, c.divisionId);
    if (err) throw new ServiceError('validation', err, { fieldErrors: { ownerId: err } });
    // Hand-offs (contact conversion, engineer referral, web leads) may not set a follow-up date (BR-07 default: tomorrow).
    if (!c.nextFollowUpAt) c.nextFollowUpAt = addDays(todayKey(), 1);
    const customer = (ctx.d.records.customers ?? []).find((x) => x.id === c.customerId);
    if (customer && !c.state) c.state = customer.billingState;
    if (customer && !c.industry) c.industry = customer.industry;
  },
  beforeUpdate: (ctx, before, c) => {
    if (before.status === 'qualified') throw new ServiceError('invalid_state', `Qualified leads are read-only — continue on opportunity ${before.opportunityId ?? ''}.`.trim());
    if (c.ownerId !== before.ownerId || c.divisionId !== before.divisionId) {
      const err = ownerDivisionError(ctx.d, c.ownerId, c.divisionId);
      if (err) throw new ServiceError('validation', err, { fieldErrors: { ownerId: err } });
    }
  },
  beforeTransition: (_ctx, rec, to) => {
    if (to !== 'contacted') return;
    if (!rec.firstContactAt) rec.firstContactAt = nowLocal();
    rec.disqualifyReason = null;
    rec.nurtureUntil = null;
    if (!rec.nextFollowUpAt || String(rec.nextFollowUpAt) < todayKey()) throw new ServiceError('validation', 'Set a next follow-up date (today or later) before changing the status — edit the lead or log an activity.', { fieldErrors: { nextFollowUpAt: 'Required' } });
  },
});

// LEAD-09 / BR-08: the first logged activity is the first contact; it moves New → Contacted.
registerResourceHooks('activities', {
  afterCreate: (ctx, a) => {
    if (a.parentResource !== 'leads') return;
    const lead = (ctx.d.records.leads ?? []).find((l) => l.id === a.parentId);
    if (!lead) return;
    const patch: Record<string, unknown> = {};
    if (!lead.firstContactAt) patch.firstContactAt = a.at;
    if (lead.status === 'new') patch.status = 'contacted';
    if (Object.keys(patch).length) patchRecordIn(ctx, 'leads', lead.id, patch, lead.status === 'new' ? `First contact logged (${a.id}): New → Contacted` : `First contact logged (${a.id})`);
  },
});

registerRecordActions('leads', LeadActions);
registerRecordBanner('leads', LeadBanner);

// SLA escalation + follow-up reminders on the simulated clock: run shortly after start-up and after store changes.
// The sweep commits only when it changes something, so it settles after one extra pass.
if (typeof window !== 'undefined') {
  let timer: number | undefined;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      try {
        if (isSignedIn() && getDb().records.leads) sweepLeads(currentActor());
      } catch {
        /* sweep is best-effort */
      }
    }, 600);
  };
  subscribe(schedule);
  schedule();
}
