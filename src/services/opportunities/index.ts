/**
 * Opportunities domain service (engine side, synchronous). Pages call the async wrappers in
 * src/services/api/opportunities.ts.
 */
import { appPack } from '../../domain/pack';
import { OPEN_STAGES, isStagnant } from '../../domain/modules/opportunities';
import type { RecordData } from '../../metadata/types';
import { addDays, addMinutes, nowLocal, todayKey } from '../../lib/dates';
import { nowIso } from '../../lib/clock';
import { uid } from '../../lib/ids';
import { type Actor, canReadRecord, canUpdateRecord, perm } from '../authz';
import { commit, getDb } from '../db';
import { appendAudit, emitEvent, notify } from '../ledger';
import { getPolicies } from '../policies';
import { userOfStaff, managerOf } from '../lookups';
import { getResource, masterLabel } from '../registry';
import type { HookContext } from '../resourceHooks';
import { queryRecords } from '../runtime';
import { ServiceError } from '../types';
import { L } from '../../constants/labels';

const T = L.opportunities.messages;

export { OPEN_STAGES, isStagnant };

const hasResource = (key: string) => appPack.resources.some((r) => r.key === key);

export const stageProbability = (stage: string) => getPolicies().stageProbability[stage] ?? 0;

/** Latest accepted quotation of an opportunity (Q-05), when the quotations module is present. */
export function acceptedQuotationFor(oppId: string, records = getDb().records): RecordData | undefined {
  return (records.quotations ?? []).find((q) => q.opportunityId === oppId && q.status === 'accepted' && q.isLatest !== false);
}

const quotationsOf = (oppId: string, records = getDb().records) => (records.quotations ?? []).filter((q) => q.opportunityId === oppId && q.status !== 'superseded');

/** OPP-02 entry criteria for the target stage. Throws a readable ServiceError when not met. */
export function checkStageEntry(ctx: HookContext, r: Record<string, unknown>, to: string) {
  const recs = ctx.d.records;
  if (to === 'proposal' && !(Number(r.value) > 0)) throw new ServiceError('validation', T.proposalNeedsValue, { fieldErrors: { value: T.proposalNeedsValueField } });
  if (to === 'negotiation' && hasResource('quotations') && !quotationsOf(String(r.id), recs).length) throw new ServiceError('invalid_state', T.negotiationNeedsQuotation);
  if (to === 'won') {
    if (hasResource('quotations') && !acceptedQuotationFor(String(r.id), recs)) throw new ServiceError('invalid_state', T.wonNeedsAccepted);
    if (!(Number(r.value) > 0)) throw new ServiceError('validation', T.wonNeedsValue);
  }
}

export interface LostInput {
  lostReason: string;
  lostToCompetitor: string;
  lostToPrice?: number | null;
  note?: string;
}

/** FR-031: Lost requires a reason from the master list and the competitor lost to. */
export function markLost(actor: Actor, id: string, input: LostInput, expectedVersion: number) {
  const res = getResource('opportunities');
  const errors: Record<string, string> = {};
  if (!input.lostReason) errors.lostReason = T.chooseLostReason;
  if (!input.lostToCompetitor?.trim()) errors.lostToCompetitor = T.nameCompetitor;
  if (input.lostToPrice !== undefined && input.lostToPrice !== null && !(Number(input.lostToPrice) >= 0)) errors.lostToPrice = T.validAmount;
  if (Object.keys(errors).length) throw new ServiceError('validation', T.fixFields, { fieldErrors: errors });
  return commit((d) => {
    const idx = d.records.opportunities.findIndex((r) => r.id === id);
    const cur = d.records.opportunities[idx];
    if (!cur || !canReadRecord(actor, res, cur)) throw new ServiceError('not_found', T.notFound(id));
    if (!canUpdateRecord(actor, res, cur)) throw new ServiceError('forbidden', T.cannotChange);
    if (cur.version !== expectedVersion) throw new ServiceError('version_conflict', T.versionConflict);
    if (!OPEN_STAGES.includes(String(cur.stage))) throw new ServiceError('invalid_state', T.onlyOpenLost);
    const at = nowIso();
    const next: RecordData = {
      ...cur,
      stage: 'lost',
      probability: 0,
      lostReason: input.lostReason,
      lostToCompetitor: input.lostToCompetitor.trim(),
      lostToPrice: input.lostToPrice ?? null,
      stageChangedAt: at,
      version: cur.version + 1,
      updatedAt: at,
    };
    d.records.opportunities[idx] = next;
    const correlationId = uid('cor');
    appendAudit(d, actor, {
      action: 'transition',
      resource: 'opportunities',
      recordId: id,
      summary: T.auditLost(masterLabel('lostReason', input.lostReason), input.lostToCompetitor.trim(), input.note ?? ''),
      changes: [{ field: 'stage', label: L.opportunities.fields.opportunities.stage, before: masterLabel('oppStage', cur.stage), after: masterLabel('oppStage', 'lost') }],
      correlationId,
    });
    emitEvent(d, actor, { eventType: 'opportunities.status_changed', resourceId: res.id, recordId: id, correlationId, payload: { from: cur.stage, to: 'lost' } });
    return next;
  });
}

/**
 * BR-12 stagnation sweep: notifies owner and their manager once per opportunity per day
 * (notifications de-duplicate identical unread titles). Only sweeps what the actor can see.
 */
export function sweepStagnation(actor: Actor): number {
  if (perm(actor, 'opportunities').read === 'none') return 0;
  const stale = queryRecords(actor, 'opportunities', {}).rows.filter((r) => isStagnant(r));
  if (!stale.length) return 0;
  const today = todayKey();
  const fresh = stale.filter((r) => !getDb().notifications.some((n) => n.title.includes(r.id) && n.title.includes(T.stagnantMarker) && n.createdAt.slice(0, 10) === today));
  if (!fresh.length) return stale.length;
  commit((d) => {
    fresh.forEach((r) => {
      const owner = userOfStaff(r.ownerId);
      const mgr = userOfStaff(managerOf(r.ownerId, d.records));
      const past = !!r.expectedCloseDate && String(r.expectedCloseDate) < today;
      const title = T.stagnantNotice(r.id, past ? T.stagnantPastClose : T.stagnantIdle(getPolicies().opportunityStagnationDays), String(r.name));
      [owner, mgr].filter(Boolean).forEach((u) => notify(d, { userId: u!.id, workspaceId: actor.workspaceId, kind: 'reminder', title, link: { resource: 'opportunities', recordId: r.id } }));
    });
  });
  return stale.length;
}

// ---------------------------------------------------------------- forecast (FR-033)

export type ForecastGroup = 'owner' | 'division' | 'productType';
export type ForecastPeriod = 'month' | 'quarter';

export interface ForecastRow {
  key: string;
  label: string;
  cells: Record<string, { weighted: number; commit: number; pipeline: number; won: number }>;
  total: { weighted: number; commit: number; pipeline: number; won: number };
}

export interface Forecast {
  /** Largest open opportunities closing in range (for the "where the number comes from" panel). */
  top: RecordData[];
  periods: { key: string; label: string }[];
  rows: ForecastRow[];
  totals: Record<string, { weighted: number; commit: number; pipeline: number; won: number }>;
  grand: { weighted: number; commit: number; pipeline: number; won: number };
  count: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Indian FY quarters: Q1 = Apr–Jun. */
export function periodOf(dateKey: string, period: ForecastPeriod): string {
  const y = Number(dateKey.slice(0, 4));
  const m = Number(dateKey.slice(5, 7));
  if (period === 'month') return dateKey.slice(0, 7);
  const fy = m >= 4 ? y : y - 1;
  const q = m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
  return `${fy}-Q${q}`;
}

export function periodLabel(key: string, period: ForecastPeriod): string {
  if (period === 'month') return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  const fy = Number(key.slice(0, 4));
  return `${key.slice(5)} FY${String(fy).slice(2)}-${String(fy + 1).slice(2)}`;
}

function nextPeriods(period: ForecastPeriod, count: number): { key: string; label: string }[] {
  const out: string[] = [];
  let d = todayKey().slice(0, 7) + '-01';
  while (out.length < count) {
    const k = periodOf(d, period);
    if (!out.includes(k)) out.push(k);
    d = addDays(d, 32).slice(0, 7) + '-01';
  }
  return out.map((key) => ({ key, label: periodLabel(key, period) }));
}

/**
 * Weighted = Σ value × probability (open opportunities closing in the period).
 * Commit = Σ value of opportunities in Negotiation (the team's committed number) + won in the period.
 * Pipeline = Σ value of all open opportunities. Won = value won in the period (by won date).
 */
export function computeForecast(actor: Actor, opts: { period: ForecastPeriod; groupBy: ForecastGroup; horizon: number; divisionId?: string }): Forecast {
  const periods = nextPeriods(opts.period, opts.horizon);
  const keys = new Set(periods.map((p) => p.key));
  const rows = queryRecords(actor, 'opportunities', {}).rows.filter((r) => !opts.divisionId || r.divisionId === opts.divisionId);
  const zero = () => ({ weighted: 0, commit: 0, pipeline: 0, won: 0 });
  const groups = new Map<string, ForecastRow>();
  const totals: Forecast['totals'] = Object.fromEntries(periods.map((p) => [p.key, zero()]));
  const grand = zero();
  let count = 0;
  const top: RecordData[] = [];
  const groupKey = (r: RecordData) => String(opts.groupBy === 'owner' ? r.ownerId : opts.groupBy === 'division' ? r.divisionId : r.productType ?? 'unspecified');
  const groupLabel = (k: string) => {
    if (k === 'unspecified' || k === 'undefined' || k === 'null') return T.notSpecified;
    if (opts.groupBy === 'owner') return String(getDb().records.employees?.find((e) => e.id === k)?.fullName ?? k);
    return masterLabel(opts.groupBy === 'division' ? 'division' : 'productType', k);
  };
  for (const r of rows) {
    const open = OPEN_STAGES.includes(String(r.stage));
    const won = r.stage === 'won';
    if (!open && !won) continue;
    const date = won ? String(r.wonAt ?? r.expectedCloseDate ?? '').slice(0, 10) : String(r.expectedCloseDate ?? '');
    if (!date) continue;
    const pk = periodOf(date, opts.period);
    if (!keys.has(pk)) continue;
    const v = Number(r.value) || 0;
    const add = { weighted: open ? (v * (Number(r.probability) || 0)) / 100 : 0, commit: won || r.stage === 'negotiation' ? v : 0, pipeline: open ? v : 0, won: won ? v : 0 };
    if (open) top.push(r);
    const gk = groupKey(r);
    if (!groups.has(gk)) groups.set(gk, { key: gk, label: groupLabel(gk), cells: Object.fromEntries(periods.map((p) => [p.key, zero()])), total: zero() });
    const g = groups.get(gk)!;
    (['weighted', 'commit', 'pipeline', 'won'] as const).forEach((m) => {
      g.cells[pk][m] += add[m];
      g.total[m] += add[m];
      totals[pk][m] += add[m];
      grand[m] += add[m];
    });
    count++;
  }
  top.sort((a, b) => (Number(b.value) * Number(b.probability)) - (Number(a.value) * Number(a.probability)));
  return { top: top.slice(0, 6), periods, rows: [...groups.values()].sort((a, b) => b.total.weighted - a.total.weighted), totals, grand, count };
}

// ---------------------------------------------------------------- demo machine calendar (OPP-04)

export interface DemoBooking {
  id: string;
  machineId: string;
  /** ISO local "YYYY-MM-DDTHH:mm". */
  start: string;
  end: string;
  status: string;
  /** False when the actor cannot read this demo (another owner's booking): shown as a busy slot only. */
  visible: boolean;
  opportunityId?: string;
  opportunityName?: string;
  customerName?: string;
  ownerId?: string;
}

export interface DemoMachineCalendarData {
  machines: RecordData[];
  bookings: DemoBooking[];
}

export interface DemoMachineCalendarFilter {
  machineId?: string;
  divisionId?: string;
  from?: string;
  to?: string;
  includeCancelled?: boolean;
}

/**
 * Demo machines the actor can see and every centre demo booked on them. Bookings of demos the actor
 * cannot read (row scope) still show as busy slots, so nobody double-books a machine.
 */
export function demoMachineCalendar(actor: Actor, f: DemoMachineCalendarFilter = {}): DemoMachineCalendarData {
  const machines = queryRecords(actor, 'demoMachines', {}).rows
    .filter((m) => (!f.machineId || m.id === f.machineId) && (!f.divisionId || m.divisionId === f.divisionId))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const ids = new Set(machines.map((m) => m.id));
  const demoRes = getResource('demos');
  const canSeeDemos = perm(actor, 'demos').read !== 'none';
  const bookings: DemoBooking[] = [];
  for (const d of getDb().records.demos ?? []) {
    if (d.location !== 'centre' || !ids.has(String(d.demoMachineId)) || !d.scheduledAt) continue;
    if (!f.includeCancelled && d.status === 'cancelled') continue;
    const start = String(d.scheduledAt).slice(0, 16);
    const end = addMinutes(start, Number(d.durationMin) || 120).slice(0, 16);
    if ((f.from && end.slice(0, 10) < f.from) || (f.to && start.slice(0, 10) > f.to)) continue;
    const visible = canSeeDemos && canReadRecord(actor, demoRes, d);
    bookings.push({
      id: d.id,
      machineId: String(d.demoMachineId),
      start,
      end,
      status: String(d.status),
      visible,
      ...(visible ? { opportunityId: String(d.opportunityId ?? ''), opportunityName: titleOf('opportunities', d.opportunityId), customerName: titleOf('customers', d.customerId), ownerId: String(d.ownerId ?? '') } : {}),
    });
  }
  bookings.sort((a, b) => a.start.localeCompare(b.start));
  return { machines, bookings };
}

// ---------------------------------------------------------------- pipeline (OPP-03)

export interface PipelineFilter {
  search?: string;
  divisionId?: string;
  ownerId?: string;
  /** '' / undefined = open stages, 'all' = every stage, else one stage key. */
  stage?: string;
  territoryId?: string;
  productType?: string;
  /** "YYYY-MM" of the expected close date. */
  closeMonth?: string;
  sort?: { field: string; dir: 'asc' | 'desc' }[];
}

/** Opportunities the actor can see, filtered for the Pipeline page (Kanban and list). */
export function pipelineRows(actor: Actor, f: PipelineFilter = {}): RecordData[] {
  const sort = f.sort?.length ? f.sort : [{ field: 'expectedCloseDate', dir: 'asc' as const }];
  return queryRecords(actor, 'opportunities', { search: f.search || undefined, sort }).rows.filter(
    (r) =>
      (!f.stage ? OPEN_STAGES.includes(String(r.stage)) : f.stage === 'all' || r.stage === f.stage) &&
      (!f.divisionId || r.divisionId === f.divisionId) &&
      (!f.ownerId || r.ownerId === f.ownerId) &&
      (!f.territoryId || r.territoryId === f.territoryId) &&
      (!f.productType || r.productType === f.productType) &&
      (!f.closeMonth || String(r.expectedCloseDate ?? '').startsWith(f.closeMonth)),
  );
}

/** Filter choices that depend on the data: owners and expected-close months of the opportunities the actor can see. */
export function pipelineFacets(actor: Actor): { ownerIds: string[]; closeMonths: string[] } {
  const rows = queryRecords(actor, 'opportunities', {}).rows;
  const ownerIds = [...new Set(rows.map((r) => String(r.ownerId ?? '')).filter(Boolean))];
  const closeMonths = [...new Set(rows.map((r) => String(r.expectedCloseDate ?? '').slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort();
  return { ownerIds, closeMonths };
}

/** Totals for the Pipeline header: count, value, weighted value and stagnation alerts of the open rows. */
export function pipelineTotals(rows: RecordData[]) {
  const open = rows.filter((r) => OPEN_STAGES.includes(String(r.stage)));
  return {
    open: open.length,
    value: open.reduce((s, r) => s + (Number(r.value) || 0), 0),
    weighted: open.reduce((s, r) => s + ((Number(r.value) || 0) * (Number(r.probability) || 0)) / 100, 0),
    stagnant: open.filter((r) => isStagnant(r)).length,
  };
}

function titleOf(resKey: string, id: unknown): string {
  if (!id || !hasResource(resKey)) return '';
  const res = getResource(resKey);
  const r = getDb().records[resKey]?.find((x) => x.id === id);
  return r ? String(r[res.titleField] ?? r.id) : String(id);
}

/** New-opportunity defaults for the hook: probability, territory / hub, product type, stage timestamp. */
export function applyCreateDefaults(ctx: HookContext, c: Record<string, unknown>) {
  if (c.probability === undefined || c.probability === null || c.probability === '') c.probability = stageProbability(String(c.stage ?? 'needs_assessment'));
  const cust = ctx.d.records.customers?.find((x) => x.id === c.customerId);
  if (cust && !c.territoryId) c.territoryId = cust.territoryId ?? null;
  const prod = ctx.d.records.products?.find((x) => x.id === c.productId);
  if (prod && !c.productType) c.productType = prod.productType ?? null;
  if (!c.stageChangedAt) c.stageChangedAt = nowIso();
  if (!c.lastActivityAt) c.lastActivityAt = nowLocal();
}
