/**
 * Field Force and Targets & Recognition page services (async, simulated network). Field writes go through the
 * offline queue (NFR-15): while offline they are queued and replayed when back online.
 */
import type { Actor } from '../authz';
import * as field from '../field/field';
import { isOffline, runOrQueue } from '../offline';
import { call } from './client';
import { L } from '../../constants/labels';

const Q = L.field.offline.queue;

export type { BadgeKey, LocationSource, VisitLink } from '../field/field';

/** Runs a field write now (with network delay) or queues it while offline. Resolves `queued` accordingly. */
async function fieldWrite(label: string, op: () => void): Promise<{ queued: boolean }> {
  if (isOffline()) {
    runOrQueue(label, op);
    return { queued: true };
  }
  await call(() => runOrQueue(label, op));
  return { queued: false };
}

export const fieldApi = {
  myDay: (actor: Actor) => field.myDay(actor),
  teamAttendance: (actor: Actor, date: string) => field.teamAttendance(actor, date),
  exceptions: (actor: Actor, date: string) => field.attendanceExceptions(actor, date),
  route: (actor: Actor, userId: string, date: string) => field.routeFor(actor, userId, date),
  routePeople: (actor: Actor, date: string) => field.routePeople(actor, date),
  myVisits: (actor: Actor) => field.myVisits(actor),
  beatPlan: (actor: Actor, weekStart: string) => field.beatPlanVsActual(actor, weekStart),
  approvedClaims: (actor: Actor) => field.approvedClaims(actor),
  achievement: (actor: Actor, periodType: string, periodStart: string) => field.achievement(actor, periodType, periodStart),
  scorecard: (actor: Actor, weekStart: string) => field.scorecard(actor, weekStart),
  leaderboard: (actor: Actor, division: string | null, monthStart: string) => field.leaderboard(actor, division, monthStart),

  grantConsent: (actor: Actor) => call(() => field.grantLocationConsent(actor)),
  checkIn: (actor: Actor, input: field.CheckInput) => fieldWrite(Q.checkIn(input.at.slice(11)), () => void field.checkIn(actor, input)),
  checkOut: (actor: Actor, input: Omit<field.CheckInput, 'selfie' | 'onTour'>) => fieldWrite(Q.checkOut(input.at.slice(11)), () => void field.checkOut(actor, input)),
  logVisit: (actor: Actor, input: field.VisitInput) => fieldWrite(Q.visit(input.siteLabel), () => void field.logVisit(actor, input)),
  startVisit: (actor: Actor, id: string, at: string, point: { lat: number; lng: number }, source: field.LocationSource) => fieldWrite(Q.visitIn(id), () => void field.startVisit(actor, id, at, point, source)),
  completeVisit: (actor: Actor, id: string, input: Parameters<typeof field.completeVisit>[2]) => fieldWrite(Q.visitOut(id), () => void field.completeVisit(actor, id, input)),
  exportClaims: (actor: Actor, ids: string[]) => call(() => field.exportApprovedClaims(actor, ids)),
  exportAchievement: (actor: Actor, rows: field.AchievementRow[], period: string) => call(() => field.exportAchievement(actor, rows, period)),
};
