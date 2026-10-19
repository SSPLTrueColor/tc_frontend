/**
 * Service SLA clocks (FR-083, BR-30/31/32). Pure functions over local wall-clock strings
 * ("YYYY-MM-DDTHH:mm", IST) so they are deterministic and unit-testable.
 *
 * - Due times come from policies.sla[priority][coverage] (hours) counted from `reportedAt`.
 * - Response is met by the first assignment, arrival by site check-in (or remote start), resolution by "Resolved".
 * - The clocks pause only while the ticket is "Waiting for customer"; every pause pushes the
 *   still-running due times back by the paused minutes.
 */
import { addMinutes, parseLocal } from '../../lib/dates';
import type { Policies } from '../policies';
import { L } from '../../constants/labels';

export type Clock = 'response' | 'arrival' | 'resolution';
export const CLOCKS: Clock[] = ['response', 'arrival', 'resolution'];
export const DUE_FIELD: Record<Clock, string> = { response: 'responseDueAt', arrival: 'arrivalDueAt', resolution: 'resolutionDueAt' };
export const MET_FIELD: Record<Clock, string> = { response: 'respondedAt', arrival: 'arrivedAt', resolution: 'resolvedAt' };
export const CLOCK_LABEL: Record<Clock, string> = L.service.sla.clocks;

const minutesBetween = (a: string, b: string) => Math.round((parseLocal(b).getTime() - parseLocal(a).getTime()) / 60000);

export function slaTargets(policies: Pick<Policies, 'sla'>, priority: string, coverage: string) {
  const byPriority = policies.sla[priority] ?? policies.sla.medium;
  return byPriority[coverage] ?? byPriority.none ?? Object.values(byPriority)[0];
}

/** Due times for a new ticket. */
export function computeDues(policies: Pick<Policies, 'sla'>, reportedAt: string, priority: string, coverage: string) {
  const t = slaTargets(policies, priority, coverage);
  return {
    responseDueAt: addMinutes(reportedAt, t.response * 60),
    arrivalDueAt: addMinutes(reportedAt, t.arrival * 60),
    resolutionDueAt: addMinutes(reportedAt, t.resolution * 60),
  };
}

export type ClockStatus = 'met' | 'breached_met' | 'breached' | 'at_risk' | 'running' | 'paused' | 'not_applicable';

export interface ClockState {
  clock: Clock;
  due: string | null;
  metAt: string | null;
  status: ClockStatus;
  /** Minutes left (negative = overdue) for running clocks; minutes late/early for met ones. */
  minutes: number;
}

/**
 * State of each clock at `now`. A paused ticket (waiting_customer) freezes running clocks:
 * the current pause is added to their due time for display.
 */
export function clockStates(t: Record<string, unknown>, now: string): ClockState[] {
  const pausedSince = t.status === 'waiting_customer' && t.pausedSince ? String(t.pausedSince) : null;
  const extra = pausedSince ? Math.max(0, minutesBetween(pausedSince, now)) : 0;
  return CLOCKS.map((clock) => {
    const dueRaw = (t[DUE_FIELD[clock]] as string | undefined) ?? null;
    const metAt = (t[MET_FIELD[clock]] as string | undefined) ?? null;
    if (!dueRaw) return { clock, due: null, metAt, status: 'not_applicable' as const, minutes: 0 };
    if (metAt) {
      const late = minutesBetween(dueRaw, metAt);
      return { clock, due: dueRaw, metAt, status: late > 0 ? ('breached_met' as const) : ('met' as const), minutes: late };
    }
    const due = extra ? addMinutes(dueRaw, extra) : dueRaw;
    const left = minutesBetween(now, due);
    const status: ClockStatus = pausedSince ? 'paused' : left < 0 ? 'breached' : left <= 60 ? 'at_risk' : 'running';
    return { clock, due, metAt, status, minutes: left };
  });
}

export const isBreached = (states: ClockState[]) => states.some((s) => s.status === 'breached' || s.status === 'breached_met');

/** Patch when a pause ends: shift unmet due times by the paused minutes and accumulate the total. */
export function resumePatch(t: Record<string, unknown>, now: string): Record<string, unknown> {
  if (!t.pausedSince) return {};
  const mins = Math.max(0, minutesBetween(String(t.pausedSince), now));
  const patch: Record<string, unknown> = { pausedSince: null, pausedMinutes: Number(t.pausedMinutes ?? 0) + mins };
  CLOCKS.forEach((c) => {
    const due = t[DUE_FIELD[c]];
    if (due && !t[MET_FIELD[c]]) patch[DUE_FIELD[c]] = addMinutes(String(due), mins);
  });
  return patch;
}

/**
 * Hours since the earliest still-breached (running) clock passed its due time, for escalation (BR-32).
 * A clock that was met late raises the first alert (0 h) but does not keep climbing the matrix:
 * once the response or arrival is done late, only clocks that are still overdue escalate further.
 */
export function hoursSinceBreach(states: ClockState[], now: string): number | null {
  const running = states.filter((s) => s.status === 'breached').map((s) => s.due!);
  if (running.length) return minutesBetween(running.sort()[0], now) / 60;
  return states.some((s) => s.status === 'breached_met') ? 0 : null;
}

/** "2h 15m", "3d 4h" — compact duration for SLA chips. */
export function formatMinutes(m: number): string {
  const a = Math.abs(Math.round(m));
  if (a < 60) return `${a}m`;
  if (a < 60 * 24) return `${Math.floor(a / 60)}h${a % 60 ? ` ${a % 60}m` : ''}`;
  const d = Math.floor(a / 1440);
  const h = Math.floor((a % 1440) / 60);
  return `${d}d${h ? ` ${h}h` : ''}`;
}
