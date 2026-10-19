/** Opportunities module: stage guards, defaults, demo double-booking check, record actions, banner and timeline. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { addMinutes, formatDate, overlaps, todayKey } from '../../lib/dates';
import { nowIso } from '../../lib/clock';
import { formatMoney } from '../../lib/format';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { activitiesFor } from '../../services/activities';
import { canUpdateRecord } from '../../services/authz';
import { userOfStaff } from '../../services/lookups';
import { notify } from '../../services/ledger';
import { masterLabel } from '../../services/registry';
import { registerResourceHooks, type HookContext } from '../../services/resourceHooks';
import { runStagnationSweep } from '../../services/api/opportunities';
import { acceptedQuotationFor, applyCreateDefaults, checkStageEntry, isStagnant, OPEN_STAGES, stageProbability } from '../../services/opportunities';
import { getPolicies } from '../../services/policies';
import { ServiceError } from '../../services/types';
import type { RecordData } from '../../metadata/types';
import { registerRecordActions, registerRecordBanner, registerRecordTab, type RecordExtensionProps } from '../../components/resource/extensions';
import { Button } from '../../components/primitives/Button';
import { DateText } from '../../components/primitives/display';
import { EmptyState, ErrorState, InlineAlert, Skeleton } from '../../components/primitives/feedback';
import { LogActivityDialog } from '../../components/crm/LogActivityDialog';
import { MarkLostDialog } from '../../modules/opportunities/MarkLostDialog';
import { configureStagnationDays } from '../modules/opportunities';

configureStagnationDays(() => getPolicies().opportunityStagnationDays);

const notifyStaff = (ctx: HookContext, staffId: unknown, title: string, link: { resource: string; recordId: string }) => {
  const u = userOfStaff(staffId);
  if (u && u.id !== ctx.actor.user.id) notify(ctx.d, { userId: u.id, workspaceId: ctx.actor.workspaceId, kind: 'assignment', title, link });
};

// ---------------------------------------------------------------- opportunities

registerResourceHooks('opportunities', {
  beforeCreate: (ctx, c) => applyCreateDefaults(ctx, c),
  afterCreate: (ctx, r) => notifyStaff(ctx, r.ownerId, `${ctx.actor.user.name} assigned you opportunity ${r.id}: ${String(r.name)}`, { resource: 'opportunities', recordId: r.id }),
  beforeUpdate: (ctx, before, c) => {
    if (before.ownerId !== c.ownerId || before.customerId !== c.customerId || before.productId !== c.productId) {
      if (before.customerId !== c.customerId) c.territoryId = null;
      if (before.productId !== c.productId) c.productType = null;
      applyCreateDefaults(ctx, c);
    }
  },
  afterUpdate: (ctx, before, after) => {
    if (before.ownerId !== after.ownerId) notifyStaff(ctx, after.ownerId, `${ctx.actor.user.name} assigned you opportunity ${after.id}: ${String(after.name)}`, { resource: 'opportunities', recordId: after.id });
  },
  beforeTransition: (ctx, r, to) => {
    if (OPEN_STAGES.includes(to) || to === 'won') checkStageEntry(ctx, r, to);
    const rec = r as Record<string, unknown>;
    rec.probability = stageProbability(to);
    rec.stageChangedAt = nowIso();
    if (to === 'won') rec.wonAt = nowIso();
    if (to === 'needs_assessment') {
      rec.lostReason = null;
      rec.lostToCompetitor = null;
      rec.lostToPrice = null;
      rec.wonAt = null;
    }
  },
  afterTransition: (ctx, before, after) => {
    if (after.stage === 'won') notifyStaff(ctx, after.ownerId, `${after.id} won — ${String(after.name)} (${formatMoney(Number(after.value))})`, { resource: 'opportunities', recordId: after.id });
    else if (before.ownerId !== undefined) notifyStaff(ctx, after.ownerId, `${ctx.actor.user.name} moved ${after.id} to ${masterLabel('oppStage', after.stage)}`, { resource: 'opportunities', recordId: after.id });
  },
});

// ---------------------------------------------------------------- demos: copy context, no double booking

function demoGuard(ctx: HookContext, c: Record<string, unknown>, selfId?: string) {
  const opp = ctx.d.records.opportunities?.find((o) => o.id === c.opportunityId);
  if (opp) {
    c.customerId = opp.customerId ?? null;
    c.divisionId = opp.divisionId ?? null;
  }
  if (c.location !== 'centre' || !c.demoMachineId || !c.scheduledAt || ['cancelled', 'done'].includes(String(c.status))) return;
  const start = String(c.scheduledAt);
  const end = addMinutes(start, Number(c.durationMin) || 120);
  const clash = (ctx.d.records.demos ?? []).find(
    (x) => x.id !== selfId && x.demoMachineId === c.demoMachineId && ['requested', 'scheduled'].includes(String(x.status)) && overlaps(start, end, String(x.scheduledAt), addMinutes(String(x.scheduledAt), Number(x.durationMin) || 120)),
  );
  if (clash) throw new ServiceError('validation', `The demo machine is already booked by ${clash.id} at that time.`, { fieldErrors: { scheduledAt: `Overlaps ${clash.id} — choose another time or machine` } });
}

registerResourceHooks('demos', {
  beforeCreate: (ctx, c) => demoGuard(ctx, c),
  beforeUpdate: (ctx, before, c) => demoGuard(ctx, c, before.id),
  afterCreate: (ctx, r) => notifyStaff(ctx, r.ownerId, `Demo ${r.id} booked for ${String(r.scheduledAt).replace('T', ' ')}`, { resource: 'demos', recordId: r.id }),
  beforeTransition: (_ctx, r, to) => {
    if (to === 'done' && !String(r.results ?? '').trim()) throw new ServiceError('validation', 'Record the demo results before marking it done (Edit → Results).', { fieldErrors: { results: 'Required to mark done' } });
  },
});

registerResourceHooks('sampleRequests', {
  beforeCreate: (ctx, c) => {
    const opp = ctx.d.records.opportunities?.find((o) => o.id === c.opportunityId);
    if (opp) {
      c.customerId = opp.customerId ?? null;
      c.divisionId = opp.divisionId ?? null;
    }
  },
  afterCreate: (ctx, r) => notifyStaff(ctx, r.assigneeId, `Sample print requested: ${String(r.title)} (${r.id}), needed by ${formatDate(String(r.dueDate))}`, { resource: 'sampleRequests', recordId: r.id }),
  beforeTransition: (_ctx, r, to) => {
    if (to === 'results_shared' && !String(r.results ?? '').trim()) throw new ServiceError('validation', 'Record the print results before sharing them (Edit → Print results).', { fieldErrors: { results: 'Required' } });
  },
  afterTransition: (ctx, _b, after) => {
    if (after.status === 'results_shared') notifyStaff(ctx, after.ownerId, `Sample results ready: ${String(after.title)} (${after.id})`, { resource: 'sampleRequests', recordId: after.id });
  },
});

// ---------------------------------------------------------------- record UI

function OpportunityActions({ actor, res, record }: RecordExtensionProps) {
  const [logging, setLogging] = useState(false);
  const [losing, setLosing] = useState(false);
  const open = OPEN_STAGES.includes(String(record.stage));
  const editable = canUpdateRecord(actor, res, record);
  const accepted = acceptedQuotationFor(record.id);
  return (
    <>
      <Button icon="message" onClick={() => setLogging(true)}>
        Log activity
      </Button>
      {open && (
        <Button onClick={() => setLosing(true)} disabledReason={editable ? undefined : `Read-only for ${actor.role.label}`}>
          Mark lost…
        </Button>
      )}
      {record.stage === 'won' &&
        (accepted ? (
          <Link className="btn btn-primary" to={`/orders/new?quotation=${encodeURIComponent(accepted.id)}`}>
            <span className="btn-label">Generate sales order</span>
          </Link>
        ) : (
          <Button variant="primary" disabledReason="Needs an accepted quotation on this opportunity">
            Generate sales order
          </Button>
        ))}
      <LogActivityDialog
        open={logging}
        onClose={() => setLogging(false)}
        requireNextFollowUp={open}
        parent={{ parentResource: 'opportunities', parentId: record.id, parentLabel: `${record.id} · ${String(record.name)}`, customerId: record.customerId ? String(record.customerId) : undefined }}
      />
      {losing && <MarkLostDialog actor={actor} record={record} onClose={() => setLosing(false)} />}
    </>
  );
}

let swept = false;
function OpportunityBanner({ actor, record }: RecordExtensionProps) {
  useEffect(() => {
    if (swept) return;
    swept = true;
    void runStagnationSweep(actor).catch(() => (swept = false));
  }, [actor]);
  if (record.stage === 'lost')
    return (
      <InlineAlert tone="danger" title="Lost">
        {masterLabel('lostReason', record.lostReason)}
        {record.lostToCompetitor ? ` — to ${String(record.lostToCompetitor)}` : ''}
        {record.lostToPrice ? ` at ${formatMoney(Number(record.lostToPrice))}` : ''}
      </InlineAlert>
    );
  if (record.stage === 'won') return null;
  if (!isStagnant(record)) return null;
  const past = !!record.expectedCloseDate && String(record.expectedCloseDate) < todayKey();
  return (
    <InlineAlert tone="warning" title="Stagnant opportunity">
      {past ? `Expected close date ${formatDate(String(record.expectedCloseDate))} has passed.` : `No activity for more than ${getPolicies().opportunityStagnationDays} days.`} Log an activity or update the close date.
    </InlineAlert>
  );
}

function Timeline({ actor, record }: RecordExtensionProps) {
  const q = useServiceQuery(() => activitiesFor(actor, 'opportunities', record.id), [record.id, actor.user.id]);
  if (q.error)
    return (
      <ErrorState title="Could not load the timeline" onRetry={q.retry}>
        {q.error}
      </ErrorState>
    );
  if (!q.data) return <Skeleton rows={4} />;
  if (!q.data.length) return <EmptyState icon="message" title="No activities yet">Calls, meetings and notes logged on this opportunity appear here.</EmptyState>;
  return (
    <ul className="flow-list">
      {q.data.map((a: RecordData) => (
        <li key={a.id} className="flow-item">
          <span className="tag tone-neutral">{masterLabel('activityType', a.activityType)}</span>
          <span className="flow-main">
            <span className="flow-title">{String(a.subject)}</span>
            <span className="muted small">
              <DateText value={String(a.at)} />
              {a.notes ? ` · ${String(a.notes).slice(0, 140)}` : ''}
              {a.nextFollowUpAt ? ` · next follow-up ${formatDate(String(a.nextFollowUpAt))}` : ''}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

registerRecordActions('opportunities', OpportunityActions);
registerRecordBanner('opportunities', OpportunityBanner);
registerRecordTab('opportunities', { id: 'timeline', label: 'Timeline', component: Timeline });
