/**
 * Dashboard building blocks shared by the role dashboard (overview.ts) and the report viewer:
 * signal/tile/bar shapes, filtered list links, the role → dashboard family map and today's plan (NFR-22).
 */
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
import { addDays, formatDate } from '../../lib/dates';
import { nowMs } from '../../lib/clock';
import { resourcePath } from '../../lib/routes';
import { type Actor, can } from '../authz';
import { encodeFilter, newCondition, newGroup } from '../filter';
import { masterLabel } from '../registry';
import { dayOf, isOpenOpp, isOpenTicket, ms } from './kpis';
import type { Dataset } from './types';

/** Status meaning used for tile values and chart bars: green good, amber needs attention, red act now. */
export type Signal = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface Tile {
  label: string;
  /** Pre-formatted, or a typed KPI string ("money:…", "pct:…", "hours:…"). */
  value: string;
  sub?: string;
  to?: string;
  /** Colour of the value; omit for plain figures. */
  tone?: Signal;
}

export interface ChartBar {
  key: string;
  label: string;
  value: number;
  tone?: Signal;
}
export interface PlanItem {
  id: string;
  title: string;
  sub: string;
  tag: string;
  tone: 'danger' | 'warning' | 'neutral' | 'info';
  to: string;
  /** Task id when the item can be completed from the dashboard. */
  taskId?: string;
  taskVersion?: number;
}

type Cond = [field: string, op: Parameters<typeof newCondition>[1], value?: unknown];
/** Link to a resource list filtered by the given conditions (and optionally a saved view). */
export const listWith = (res: string, conds: Cond[] = [], view?: string) => {
  const g = newGroup('and');
  g.children = conds.map(([f, o, v]) => newCondition(f, o, v));
  return resourcePath('tc', res, { view, f: conds.length ? encodeFilter(g) : undefined });
};
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Role → dashboard family (which KPIs and widgets the role sees). */
export const FAMILY: Record<string, string> = {
  admin: 'company',
  management: 'company',
  division_head: 'division',
  sales_manager: 'sales',
  sales_exec: 'sales',
  service_head: 'service',
  coordinator: 'service',
  engineer: 'engineer',
  scm: 'supply',
  store: 'supply',
  accounts: 'finance',
  profiling: 'profiling',
};

const OPEN_LEAD = ['new', 'contacted', 'nurture'];

// ---------------------------------------------------------------- today's plan (NFR-22)

export function planFor(ds: Dataset, actor: Actor, today: string): PlanItem[] {
  const A = L.dashboard.agenda;
  const me = actor.staffId;
  const items: (PlanItem & { sort: string })[] = [];
  const tag = (due: string) => (due < today ? { tag: A.tags.overdue, tone: 'danger' as const } : due === today ? { tag: A.tags.today, tone: 'warning' as const } : { tag: formatDate(due), tone: 'neutral' as const });
  ds.get('tasks')
    .filter((t) => t.assigneeId === me && ['todo', 'in_progress'].includes(s(t.status)) && s(t.dueDate) <= addDays(today, 3))
    .forEach((t) => items.push({ id: `t:${t.id}`, title: s(t.title), sub: s(t.relatedLabel) || A.task, ...tag(s(t.dueDate)), to: resourcePath('tc', 'tasks', { peek: t.id }), taskId: t.id, taskVersion: t.version, sort: s(t.dueDate) }));
  ds.get('leads')
    .filter((l) => l.ownerId === me && OPEN_LEAD.includes(s(l.status)) && s(l.nextFollowUpAt) && dayOf(l.nextFollowUpAt) <= today)
    .forEach((l) => items.push({ id: `l:${l.id}`, title: A.followUp(ds.name('leads', l.id)), sub: A.leadFollowUp, ...tag(dayOf(l.nextFollowUpAt)), to: resourcePath('tc', 'leads', { peek: l.id }), sort: dayOf(l.nextFollowUpAt) }));
  ds.get('opportunities')
    .filter((o) => o.ownerId === me && isOpenOpp(o) && s(o.nextFollowUpAt) && dayOf(o.nextFollowUpAt) <= today)
    .forEach((o) => items.push({ id: `o:${o.id}`, title: A.followUp(s(o.name)), sub: A.oppFollowUp, ...tag(dayOf(o.nextFollowUpAt)), to: resourcePath('tc', 'opportunities', { peek: o.id }), sort: dayOf(o.nextFollowUpAt) }));
  ds.get('tickets')
    .filter((t) => t.assigneeId === me && isOpenTicket(t))
    .forEach((t) => items.push({ id: `k:${t.id}`, title: `${t.id} · ${ds.name('customers', t.customerId)}`, sub: `${masterLabel('ticketPriority', t.priority)} · ${masterLabel('ticketStatus', t.status)}`, ...(s(t.resolutionDueAt) && ms(t.resolutionDueAt) < nowMs() ? { tag: A.tags.slaBreached, tone: 'danger' as const } : { tag: A.tags.job, tone: 'info' as const }), to: toPath(ROUTES.myJob, { recordId: t.id }), sort: s(t.resolutionDueAt) || today }));
  ds.get('pmVisits')
    .filter((v) => v.engineerId === me && ['due', 'overdue'].includes(s(v.status)) && dayOf(v.dueDate) <= addDays(today, 3))
    .forEach((v) => items.push({ id: `p:${v.id}`, title: A.pmVisit(ds.name('customers', v.customerId)), sub: A.preventiveMaintenance, ...tag(dayOf(v.dueDate)), to: ROUTES.pmSchedule, sort: dayOf(v.dueDate) }));
  ds.get('fieldVisits')
    .filter((v) => v.employeeId === me && v.status === 'planned' && dayOf(v.plannedFor) === today)
    .forEach((v) => items.push({ id: `v:${v.id}`, title: A.fieldVisit(s(v.siteLabel) || ds.name('customers', v.customerId)), sub: masterLabel('visitPurpose', v.purpose), tag: A.tags.today, tone: 'warning', to: ROUTES.fieldVisits, sort: today }));
  return items.sort((a, b) => a.sort.localeCompare(b.sort)).slice(0, 10);
}

/** Export restrictions shown in the UI (reports.export capability). */
export const canExport = (actor: Actor) => can(actor, 'reports.export');
