/** Administration reads: organisation structure (FR-119) and owned-open-records check (BR-53). */
import { appPack } from '../../domain/pack';
import type { RecordData } from '../../metadata/types';
import { type Actor, can } from '../authz';
import { getDb } from '../db';
import { activeMasterValues, getResource, masterLabel } from '../registry';
import { ServiceError } from '../types';

/** Statuses that mean "finished" across modules (in addition to each lifecycle's terminal list). */
const CLOSED = new Set(['done', 'closed', 'completed', 'cancelled', 'won', 'lost', 'disqualified', 'qualified', 'rejected', 'expired', 'superseded', 'signed_off', 'renewed', 'consumed', 'returned', 'converted', 'inactive', 'approved', 'withdrawn']);

export interface OwnedOpen {
  resource: string;
  label: string;
  count: number;
}

/** Open records an employee owns in every resource with an owner field (generic — new modules count automatically). */
export function ownedOpenRecords(staffId: string, store = getDb().records): OwnedOpen[] {
  const out: OwnedOpen[] = [];
  for (const def of appPack.resources) {
    if (!def.ownerField || def.key === 'employees') continue;
    const res = getResource(def.key);
    const terminal = new Set(res.lifecycle?.terminal ?? []);
    const statusKey = res.lifecycle?.field ?? (res.fields.some((f) => f.key === 'status') ? 'status' : undefined);
    const count = (store[res.key] ?? []).filter((r) => r[res.ownerField!] === staffId && (!statusKey || (!terminal.has(String(r[statusKey])) && !CLOSED.has(String(r[statusKey]))))).length;
    if (count) out.push({ resource: res.key, label: res.labelPlural, count });
  }
  return out;
}

export interface OrgNode {
  employee: RecordData;
  reports: OrgNode[];
}

export interface Organisation {
  divisions: { key: string; label: string; heads: string[]; employees: number }[];
  territories: { key: string; label: string; state: string; people: string[] }[];
  tree: OrgNode[];
  inactive: RecordData[];
}

export function getOrganisation(actor: Actor): Organisation {
  if (!can(actor, 'org.view')) throw new ServiceError('forbidden', 'Your role cannot view the organisation structure.');
  const emps = (getDb().records.employees ?? []).filter((e) => e.workspaceId === actor.workspaceId);
  const active = emps.filter((e) => e.status !== 'inactive');
  const divisions = activeMasterValues('division').map((d) => {
    const inDiv = active.filter((e) => ((e.divisionIds as string[]) ?? []).includes(d.key));
    return { key: d.key, label: d.label, heads: inDiv.filter((e) => e.roleId === 'division_head').map((e) => String(e.fullName)), employees: inDiv.length };
  });
  const territories = activeMasterValues('territory').map((t) => ({
    key: t.key,
    label: t.label,
    state: masterLabel('state', t.parent),
    people: active.filter((e) => ((e.territoryIds as string[]) ?? []).includes(t.key)).map((e) => String(e.fullName)),
  }));
  const ids = new Set(active.map((e) => e.id));
  const build = (managerId: string | null, seen: Set<string>): OrgNode[] =>
    active
      .filter((e) => (managerId === null ? !e.managerId || !ids.has(String(e.managerId)) : e.managerId === managerId) && !seen.has(e.id))
      .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)))
      .map((e) => {
        const next = new Set(seen).add(e.id);
        return { employee: e, reports: build(e.id, next) };
      });
  return { divisions, territories, tree: build(null, new Set()), inactive: emps.filter((e) => e.status === 'inactive') };
}
