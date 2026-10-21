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
import { L } from '../../constants/labels';
import { ownerDivisionError, resolveOwner, sweepLeads } from '../../services/leads/rules';
import { registerCardActions, registerRecordActions, registerRecordBanner, registerStageMoveHandler } from '../../components/resource/extensions';
import { LeadCardActions, LeadActions, LeadBanner, LeadMoveDialog, leadMoveTargets } from '../../modules/leads/LeadActions';

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

/** Whitespace-only text counts as empty, so required text (e.g. exhibition / event name, BR-06) cannot be blanks. */
const trimText = (c: Record<string, unknown>) => {
  for (const k of ['campaign', 'eventName', 'requirement', 'decisionMaker', 'currentSetup', 'city', 'specPodMedia', 'specPodFinishing', 'specLabelSubstrate', 'specOther']) if (typeof c[k] === 'string') c[k] = (c[k] as string).trim();
};

registerResourceHooks('leads', {
  beforeCreate: (ctx, c) => {
    trimText(c);
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
    trimText(c);
    if (before.status === 'qualified') throw new ServiceError('invalid_state', L.leads.errors.qualifiedReadOnly(String(before.opportunityId ?? '')));
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
    // Reactivation (Nurture / Disqualified → Contacted): disqualifying clears the follow-up date and a nurture
    // re-contact date may already have passed, so plan the next follow-up for tomorrow (BR-07 default).
    if (!rec.nextFollowUpAt || String(rec.nextFollowUpAt) < todayKey()) rec.nextFollowUpAt = addDays(todayKey(), 1);
  },
});

// LEAD-09 / BR-08: the first logged activity is the first contact; it moves New → Contacted (and Nurture → Contacted, LEAD-11).
registerResourceHooks('activities', {
  // BR-07: a follow-up logged on an open lead must plan the next follow-up (today or later) — enforced on the service, not only in the dialog.
  beforeCreate: (ctx, a) => {
    if (a.parentResource !== 'leads') return;
    const lead = (ctx.d.records.leads ?? []).find((l) => l.id === a.parentId);
    if (!lead || !['new', 'contacted', 'nurture'].includes(String(lead.status))) return;
    // Field check-ins (ATT-05) log a 'visit' activity whose next step is the visit's own next-action date, which may be blank.
    const missing = !a.nextFollowUpAt && a.activityType !== 'visit';
    if (missing || (a.nextFollowUpAt && String(a.nextFollowUpAt).slice(0, 10) < todayKey())) throw new ServiceError('validation', L.leads.errors.followUpRequired, { fieldErrors: { nextFollowUpAt: L.leads.errors.required } });
  },
  afterCreate: (ctx, a) => {
    if (a.parentResource !== 'leads') return;
    const lead = (ctx.d.records.leads ?? []).find((l) => l.id === a.parentId);
    if (!lead) return;
    const patch: Record<string, unknown> = {};
    if (!lead.firstContactAt) patch.firstContactAt = a.at;
    if (lead.status === 'new') patch.status = 'contacted';
    // LEAD-11: following up on a Nurture lead re-engages it — back to Contacted, re-contact date cleared.
    if (lead.status === 'nurture') Object.assign(patch, { status: 'contacted', nurtureUntil: null });
    const summary = lead.status === 'nurture' ? L.leads.messages.nurtureFollowUp(a.id) : L.leads.messages.firstContact(a.id, lead.status === 'new');
    if (Object.keys(patch).length) patchRecordIn(ctx, 'leads', lead.id, patch, summary);
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

registerCardActions('leads', LeadCardActions);
registerStageMoveHandler('leads', { targets: leadMoveTargets, Dialog: LeadMoveDialog });
