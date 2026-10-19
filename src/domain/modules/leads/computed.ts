/**
 * Computed lead fields (score, SLA flags). Kept free of store imports so resource definitions can
 * use them without an import cycle; the leads extension injects the live lookups at start-up.
 */
import type { RecordData } from '../../../metadata/types';
import { nowMs } from '../../../lib/clock';
import { todayKey } from '../../../lib/dates';

export interface LeadComputedDeps {
  scoringRules: () => RecordData[];
  activityCount: (leadId: string) => number;
  firstContactHours: () => number;
}

let deps: LeadComputedDeps = { scoringRules: () => [], activityCount: () => 0, firstContactHours: () => 24 };
export const injectLeadDeps = (d: LeadComputedDeps) => {
  deps = d;
};

const OPEN = ['new', 'contacted', 'nurture'];

/** LEAD-13: sum of matching active rules, clamped to 0–100. */
export function scoreLead(r: Record<string, unknown>, rules = deps.scoringRules(), activities = deps.activityCount(String(r.id ?? ''))): number {
  let total = 0;
  for (const rule of rules) {
    if (rule.active === false) continue;
    const want = String(rule.matchValue ?? '').trim();
    const pts = Number(rule.points) || 0;
    switch (rule.factor) {
      case 'source':
        if (r.sourceId === want) total += pts;
        break;
      case 'segment':
        if (r.segment === want) total += pts;
        break;
      case 'timeline':
        if (r.timeline === want) total += pts;
        break;
      case 'budget':
        if (Number(r.budget) > 0 && Number(r.budget) >= Number(want)) total += pts;
        break;
      case 'engagement':
        if (activities >= Number(want)) total += pts;
        break;
    }
  }
  return Math.max(0, Math.min(100, Math.round(total)));
}

/** BR-08: open "new" lead with no first contact past the SLA. */
export function isNotAttended(r: Record<string, unknown>, hours = deps.firstContactHours()): boolean {
  return r.status === 'new' && !r.firstContactAt && !!r.createdAt && nowMs() - new Date(String(r.createdAt)).getTime() > hours * 3_600_000;
}

export const isFollowUpDue = (r: Record<string, unknown>) => OPEN.includes(String(r.status)) && !!r.nextFollowUpAt && String(r.nextFollowUpAt) <= todayKey();

export const leadComputed = {
  score: (r: Record<string, unknown>) => scoreLead(r),
  notAttended: (r: Record<string, unknown>) => isNotAttended(r),
  followUpDue: (r: Record<string, unknown>) => isFollowUpDue(r),
};
