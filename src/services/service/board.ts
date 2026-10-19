/** Engineer Calendar & Map (FR-079, SRV-05): engineer availability, workload, territory grid and suggested assignment. */
import { addDays, todayKey } from '../../lib/dates';
import type { RecordData } from '../../metadata/types';
import { type Actor, canReadRecord } from '../authz';
import { getDb } from '../db';
import { byId } from '../lookups';
import { getResource } from '../registry';
import { queryRecords } from '../runtime';
import { OPEN_STATUSES } from './tickets';
import { L } from '../../constants/labels';

const R = L.service.assign.reasons;

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

export interface EngineerLoad {
  id: string;
  name: string;
  designation: string;
  divisions: string[];
  territories: string[];
  open: number;
  critical: number;
  onLeave: boolean;
  checkedIn: boolean;
  /** Open jobs per day for the next 7 days (by on-site due date). */
  week: number[];
}

/** Leave and attendance come from the field module when present. */
function availability(staffId: string, today: string) {
  const db = getDb().records;
  const onLeave = (db.leaves ?? []).some((l) => l.employeeId === staffId && ['approved'].includes(s(l.status)) && s(l.fromDate) <= today && s(l.toDate) >= today);
  const checkedIn = (db.attendance ?? []).some((a) => a.employeeId === staffId && s(a.date) === today && !!a.checkInAt);
  return { onLeave, checkedIn };
}

export function engineerLoads(actor: Actor): EngineerLoad[] {
  const today = todayKey();
  const db = getDb().records;
  const empRes = getResource('employees');
  const open = (db.tickets ?? []).filter((t) => OPEN_STATUSES.includes(s(t.status)) && t.assigneeId);
  return (db.employees ?? [])
    .filter((e) => e.roleId === 'engineer' && e.status !== 'inactive' && canReadRecord(actor, empRes, e))
    .filter((e) => actor.role.id !== 'coordinator' || arr(e.divisionIds).some((d) => actor.divisionIds.includes(d)))
    .map((e) => {
      const mine = open.filter((t) => t.assigneeId === e.id);
      return {
        id: e.id,
        name: s(e.fullName),
        designation: s(e.designation),
        divisions: arr(e.divisionIds),
        territories: arr(e.territoryIds),
        open: mine.length,
        critical: mine.filter((t) => t.priority === 'critical').length,
        ...availability(e.id, today),
        week: Array.from({ length: 7 }, (_, i) => mine.filter((t) => s(t.arrivalDueAt || t.resolutionDueAt).slice(0, 10) === addDays(today, i)).length),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface Suggestion {
  engineer: EngineerLoad;
  score: number;
  reasons: string[];
  blocked?: string;
}

/** Ranks engineers for a ticket: division (skill) and territory match, model experience, workload, availability. */
export function suggestEngineers(actor: Actor, ticket: RecordData): Suggestion[] {
  const db = getDb().records;
  const territory = s(byId('customers', ticket.customerId, db)?.territoryId);
  const model = s(byId('machines', ticket.machineId, db)?.model);
  return engineerLoads(actor)
    .map((e) => {
      const reasons: string[] = [];
      let score = 0;
      let blocked: string | undefined;
      if (e.divisions.includes(s(ticket.divisionId))) {
        score += 4;
        reasons.push(R.skilled);
      } else blocked = R.notTrained;
      if (territory && e.territories.includes(territory)) {
        score += 3;
        reasons.push(R.territory);
      }
      if (model) {
        const done = (db.tickets ?? []).filter((t) => t.assigneeId === e.id && t.status === 'closed' && s(byId('machines', t.machineId, db)?.model) === model).length;
        if (done) {
          score += Math.min(2, done);
          reasons.push(R.fixed(done, model));
        }
      }
      score -= e.open;
      reasons.push(R.open(e.open));
      if (e.onLeave) blocked = R.onLeave;
      else if (e.checkedIn) {
        score += 1;
        reasons.push(R.checkedIn);
      }
      return { engineer: e, score, reasons, blocked };
    })
    .sort((a, b) => Number(!!a.blocked) - Number(!!b.blocked) || b.score - a.score);
}

/** Unassigned tickets the actor can see (open or re-opened with no service engineer), most urgent first. */
export function unassignedTickets(actor: Actor) {
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return queryRecords(actor, 'tickets', {})
    .rows.filter((t) => ['open', 'reopened'].includes(s(t.status)) && !t.assigneeId)
    .sort((a, b) => (rank[s(a.priority)] ?? 9) - (rank[s(b.priority)] ?? 9) || s(a.responseDueAt).localeCompare(s(b.responseDueAt)));
}

/** Territory grid ("map" without tiles): open tickets and covering engineers per territory. */
export function territoryGrid(actor: Actor, territories: { key: string; label: string }[]) {
  const db = getDb().records;
  const visible = queryRecords(actor, 'tickets', {}).rows.filter((t) => OPEN_STATUSES.includes(s(t.status)));
  const engineers = engineerLoads(actor);
  return territories.map((t) => {
    const here = visible.filter((x) => s(byId('customers', x.customerId, db)?.territoryId) === t.key);
    return {
      ...t,
      open: here.length,
      unassigned: here.filter((x) => !x.assigneeId).length,
      critical: here.filter((x) => x.priority === 'critical').length,
      engineers: engineers.filter((e) => e.territories.includes(t.key)).map((e) => e.name),
    };
  });
}
