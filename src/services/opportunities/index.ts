/**
 * Opportunities domain service (engine side, synchronous). Pages call the async wrappers in
 * src/services/api/opportunities.ts.
 */
import { appPack } from '../../domain/pack';
import { OPEN_STAGES, isStagnant } from '../../domain/modules/opportunities';
import type { RecordData } from '../../metadata/types';
import { addDays, nowLocal, todayKey } from '../../lib/dates';
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
  if (to === 'proposal' && !(Number(r.value) > 0)) throw new ServiceError('validation', 'Enter the deal value before moving to Proposal.', { fieldErrors: { value: 'Required for Proposal' } });
  if (to === 'negotiation' && hasResource('quotations') && !quotationsOf(String(r.id), recs).length) throw new ServiceError('invalid_state', 'Negotiation needs a quotation for this opportunity. Create one first.');
  if (to === 'won') {
    if (hasResource('quotations') && !acceptedQuotationFor(String(r.id), recs)) throw new ServiceError('invalid_state', 'Won needs an accepted quotation (customer PO or acceptance recorded on the quotation).');
    if (!(Number(r.value) > 0)) throw new ServiceError('validation', 'A won opportunity needs a value.');
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
  if (!input.lostReason) errors.lostReason = 'Choose a lost reason';
  if (!input.lostToCompetitor?.trim()) errors.lostToCompetitor = 'Name the competitor (or "None — project dropped")';
  if (input.lostToPrice !== undefined && input.lostToPrice !== null && !(Number(input.lostToPrice) >= 0)) errors.lostToPrice = 'Enter a valid amount';
  if (Object.keys(errors).length) throw new ServiceError('validation', 'Please fix the highlighted fields.', { fieldErrors: errors });
  return commit((d) => {
    const idx = d.records.opportunities.findIndex((r) => r.id === id);
    const cur = d.records.opportunities[idx];
    if (!cur || !canReadRecord(actor, res, cur)) throw new ServiceError('not_found', `Opportunity ${id} was not found.`);
    if (!canUpdateRecord(actor, res, cur)) throw new ServiceError('forbidden', 'Your role cannot change this opportunity.');
    if (cur.version !== expectedVersion) throw new ServiceError('version_conflict', 'This opportunity changed since you opened it. Reload and try again.');
    if (!OPEN_STAGES.includes(String(cur.stage))) throw new ServiceError('invalid_state', 'Only open opportunities can be marked lost.');
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
      summary: `Marked lost: ${masterLabel('lostReason', input.lostReason)} — to ${input.lostToCompetitor.trim()}${input.note ? ` (${input.note})` : ''}`,
      changes: [{ field: 'stage', label: 'Stage', before: masterLabel('oppStage', cur.stage), after: 'Lost' }],
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
  const fresh = stale.filter((r) => !getDb().notifications.some((n) => n.title.includes(r.id) && n.title.includes('stagnant') && n.createdAt.slice(0, 10) === today));
  if (!fresh.length) return stale.length;
  commit((d) => {
    fresh.forEach((r) => {
      const owner = userOfStaff(r.ownerId);
      const mgr = userOfStaff(managerOf(r.ownerId, d.records));
      const past = !!r.expectedCloseDate && String(r.expectedCloseDate) < today;
      const title = `${r.id} is stagnant: ${past ? 'past its expected close date' : `no activity for ${getPolicies().opportunityStagnationDays}+ days`} — ${String(r.name)}`;
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
  /** Largest open deals closing in range (for the "where the number comes from" panel). */
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
 * Weighted = Σ value × probability (open deals closing in the period).
 * Commit = Σ value of deals in Negotiation (the team's committed number) + won in the period.
 * Pipeline = Σ value of all open deals. Won = value won in the period (by won date).
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
    if (k === 'unspecified' || k === 'undefined' || k === 'null') return 'Not specified';
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

// ---------------------------------------------------------------- calendar (FR-034)

export interface CalendarItem {
  id: string;
  date: string;
  time?: string;
  kind: 'task' | 'demo' | 'close' | 'follow_up';
  title: string;
  sub: string;
  resource: string;
  recordId: string;
  overdue: boolean;
}

/** Tasks, demos, expected close dates and follow-ups the actor can see, between two dates. */
export function calendarItems(actor: Actor, from: string, to: string, mineOnly: boolean): CalendarItem[] {
  const today = todayKey();
  const inRange = (d: string) => d >= from && d <= to;
  const mine = (owner: unknown) => !mineOnly || owner === actor.staffId;
  const items: CalendarItem[] = [];
  const read = (key: string) => (hasResource(key) && perm(actor, key).read !== 'none' ? queryRecords(actor, key, {}).rows : []);
  for (const t of read('tasks')) {
    const d = String(t.dueDate ?? '');
    if (!d || !inRange(d) || !mine(t.assigneeId) || !['todo', 'in_progress'].includes(String(t.status))) continue;
    items.push({ id: `t-${t.id}`, date: d, kind: 'task', title: String(t.title), sub: String(t.relatedLabel || 'Task'), resource: 'tasks', recordId: t.id, overdue: d < today });
  }
  for (const m of read('demos')) {
    const at = String(m.scheduledAt ?? '');
    const d = at.slice(0, 10);
    if (!d || !inRange(d) || !mine(m.ownerId) || !['requested', 'scheduled'].includes(String(m.status))) continue;
    items.push({ id: `d-${m.id}`, date: d, time: at.slice(11, 16), kind: 'demo', title: `Demo · ${titleOf('opportunities', m.opportunityId)}`, sub: masterLabel('demoLocation', m.location), resource: 'demos', recordId: m.id, overdue: d < today });
  }
  for (const o of read('opportunities')) {
    if (!OPEN_STAGES.includes(String(o.stage)) || !mine(o.ownerId)) continue;
    const c = String(o.expectedCloseDate ?? '');
    if (c && inRange(c)) items.push({ id: `c-${o.id}`, date: c, kind: 'close', title: `Expected close · ${String(o.name)}`, sub: masterLabel('oppStage', o.stage), resource: 'opportunities', recordId: o.id, overdue: c < today });
    const f = String(o.nextFollowUpAt ?? '');
    if (f && inRange(f)) items.push({ id: `f-${o.id}`, date: f, kind: 'follow_up', title: `Follow up · ${String(o.name)}`, sub: 'Opportunity', resource: 'opportunities', recordId: o.id, overdue: f < today });
  }
  for (const l of read('leads')) {
    const f = String(l.nextFollowUpAt ?? '');
    if (!f || !inRange(f) || !mine(l.ownerId) || !['new', 'contacted', 'nurture'].includes(String(l.status))) continue;
    items.push({ id: `l-${l.id}`, date: f, kind: 'follow_up', title: `Follow up · lead ${l.id}`, sub: titleOf('customers', l.customerId) || 'Lead', resource: 'leads', recordId: l.id, overdue: f < today });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
}

function titleOf(resKey: string, id: unknown): string {
  if (!id || !hasResource(resKey)) return '';
  const res = getResource(resKey);
  const r = getDb().records[resKey]?.find((x) => x.id === id);
  return r ? String(r[res.titleField] ?? r.id) : String(id);
}

/** New-opportunity defaults for the hook: probability, hub, product category, stage timestamp. */
export function applyCreateDefaults(ctx: HookContext, c: Record<string, unknown>) {
  if (c.probability === undefined || c.probability === null || c.probability === '') c.probability = stageProbability(String(c.stage ?? 'needs_assessment'));
  const cust = ctx.d.records.customers?.find((x) => x.id === c.customerId);
  if (cust && !c.territoryId) c.territoryId = cust.territoryId ?? null;
  const prod = ctx.d.records.products?.find((x) => x.id === c.productId);
  if (prod && !c.productType) c.productType = prod.productType ?? null;
  if (!c.stageChangedAt) c.stageChangedAt = nowIso();
  if (!c.lastActivityAt) c.lastActivityAt = nowLocal();
}
