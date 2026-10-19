/** Opportunities module: stage guards, defaults, demo double-booking check, record actions, banner and timeline. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { addMinutes, formatDate, overlaps, todayKey } from '../../lib/dates';
import { nowIso } from '../../lib/clock';
import { formatMoney } from '../../lib/format';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { activitiesFor } from '../../services/activities';
import { canUpdateRecord, perm } from '../../services/authz';
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
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
import { configureStagnationDays } from '../modules/opportunities';

const T = L.opportunities;

configureStagnationDays(() => getPolicies().opportunityStagnationDays);

const notifyStaff = (ctx: HookContext, staffId: unknown, title: string, link: { resource: string; recordId: string }) => {
  const u = userOfStaff(staffId);
  if (u && u.id !== ctx.actor.user.id) notify(ctx.d, { userId: u.id, workspaceId: ctx.actor.workspaceId, kind: 'assignment', title, link });
};

// ---------------------------------------------------------------- opportunities

/** Whitespace-only text counts as empty, so required names / artwork cannot be blanks. */
const trimText = (c: Record<string, unknown>, keys: string[]) => keys.forEach((k) => typeof c[k] === 'string' && (c[k] = (c[k] as string).trim()));
const OPP_TEXT = ['name', 'competitors', 'decisionMakers', 'notes'];
const SAMPLE_TEXT = ['title', 'artwork', 'fabricDetails', 'results', 'customerFeedback'];

registerResourceHooks('opportunities', {
  beforeCreate: (ctx, c) => {
    trimText(c, OPP_TEXT);
    applyCreateDefaults(ctx, c);
  },
  afterCreate: (ctx, r) => notifyStaff(ctx, r.ownerId, T.messages.assigned(ctx.actor.user.name, r.id, String(r.name)), { resource: 'opportunities', recordId: r.id }),
  beforeUpdate: (ctx, before, c) => {
    trimText(c, OPP_TEXT);
    if (before.ownerId !== c.ownerId || before.customerId !== c.customerId || before.productId !== c.productId) {
      if (before.customerId !== c.customerId) c.territoryId = null;
      if (before.productId !== c.productId) c.productType = null;
      applyCreateDefaults(ctx, c);
    }
  },
  afterUpdate: (ctx, before, after) => {
    if (before.ownerId !== after.ownerId) notifyStaff(ctx, after.ownerId, T.messages.assigned(ctx.actor.user.name, after.id, String(after.name)), { resource: 'opportunities', recordId: after.id });
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
    if (after.stage === 'won') notifyStaff(ctx, after.ownerId, T.messages.won(after.id, String(after.name), formatMoney(Number(after.value))), { resource: 'opportunities', recordId: after.id });
    else if (before.ownerId !== undefined) notifyStaff(ctx, after.ownerId, T.messages.moved(ctx.actor.user.name, after.id, masterLabel('oppStage', after.stage)), { resource: 'opportunities', recordId: after.id });
  },
});

// ---------------------------------------------------------------- demos: copy context, no double booking

function demoGuard(ctx: HookContext, c: Record<string, unknown>, before?: RecordData) {
  const selfId = before?.id;
  const opp = ctx.d.records.opportunities?.find((o) => o.id === c.opportunityId);
  if (opp) {
    c.customerId = opp.customerId ?? null;
    c.divisionId = opp.divisionId ?? null;
  }
  if (c.location !== 'centre' || !c.demoMachineId || ['cancelled', 'done'].includes(String(c.status))) return;
  const machine = ctx.d.records.demoMachines?.find((m) => m.id === c.demoMachineId);
  // Only a new booking or a moved one must use an active machine; recording results on an old booking stays possible.
  const moved = !before || before.demoMachineId !== c.demoMachineId || before.scheduledAt !== c.scheduledAt;
  if (machine && machine.status !== 'active' && moved) {
    const msg = T.messages.demoMachineUnavailable(String(machine.name), masterLabel('demoMachineStatus', machine.status));
    throw new ServiceError('validation', msg, { fieldErrors: { demoMachineId: T.messages.demoMachineUnavailableField } });
  }
  if (!c.scheduledAt) return;
  const start = String(c.scheduledAt);
  const end = addMinutes(start, Number(c.durationMin) || 120);
  const clash = (ctx.d.records.demos ?? []).find(
    (x) => x.id !== selfId && x.demoMachineId === c.demoMachineId && ['requested', 'scheduled'].includes(String(x.status)) && overlaps(start, end, String(x.scheduledAt), addMinutes(String(x.scheduledAt), Number(x.durationMin) || 120)),
  );
  if (clash) throw new ServiceError('validation', T.messages.demoClash(clash.id), { fieldErrors: { scheduledAt: T.messages.demoClashField(clash.id) } });
}

registerResourceHooks('demos', {
  beforeCreate: (ctx, c) => demoGuard(ctx, c),
  beforeUpdate: (ctx, before, c) => demoGuard(ctx, c, before),
  afterCreate: (ctx, r) => notifyStaff(ctx, r.ownerId, T.messages.demoBooked(r.id, String(r.scheduledAt).replace('T', ' ')), { resource: 'demos', recordId: r.id }),
  beforeTransition: (_ctx, r, to) => {
    if (to === 'done' && !String(r.results ?? '').trim()) throw new ServiceError('validation', T.messages.demoResultsNeeded, { fieldErrors: { results: T.messages.demoResultsField } });
  },
});

registerResourceHooks('sampleRequests', {
  beforeUpdate: (_ctx, _before, c) => trimText(c, SAMPLE_TEXT),
  beforeCreate: (ctx, c) => {
    trimText(c, SAMPLE_TEXT);
    const opp = ctx.d.records.opportunities?.find((o) => o.id === c.opportunityId);
    if (opp) {
      c.customerId = opp.customerId ?? null;
      c.divisionId = opp.divisionId ?? null;
    }
  },
  afterCreate: (ctx, r) => notifyStaff(ctx, r.assigneeId, T.messages.sampleRequested(String(r.title), r.id, formatDate(String(r.dueDate))), { resource: 'sampleRequests', recordId: r.id }),
  beforeTransition: (_ctx, r, to) => {
    if (to === 'results_shared' && !String(r.results ?? '').trim()) throw new ServiceError('validation', T.messages.sampleResultsNeeded, { fieldErrors: { results: T.messages.required } });
  },
  afterTransition: (ctx, _b, after) => {
    if (after.status === 'results_shared') notifyStaff(ctx, after.ownerId, T.messages.sampleResultsReady(String(after.title), after.id), { resource: 'sampleRequests', recordId: after.id });
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
        {T.actions.logFollowUp}
      </Button>
      {open && (
        <Button onClick={() => setLosing(true)} disabledReason={editable ? undefined : T.messages.readOnlyFor(actor.role.label)}>
          {T.actions.markLost}
        </Button>
      )}
      {record.stage === 'won' &&
        (accepted ? (
          <Link className="btn btn-primary" to={toPath(ROUTES.salesOrderNew, {}, { quotation: accepted.id })}>
            <span className="btn-label">{T.actions.generateSalesOrder}</span>
          </Link>
        ) : (
          <Button variant="primary" disabledReason={T.messages.needsAcceptedQuotation}>
            {T.actions.generateSalesOrder}
          </Button>
        ))}
      <LogActivityDialog
        open={logging}
        onClose={() => setLogging(false)}
        requireNextFollowUp={open}
        title={T.actions.logFollowUp}
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
      <InlineAlert tone="danger" title={T.banner.lostTitle}>
        {masterLabel('lostReason', record.lostReason)}
        {record.lostToCompetitor ? T.banner.lostTo(String(record.lostToCompetitor)) : ''}
        {record.lostToPrice ? T.banner.lostAt(formatMoney(Number(record.lostToPrice))) : ''}
      </InlineAlert>
    );
  if (record.stage === 'won') return null;
  if (!isStagnant(record)) return null;
  const past = !!record.expectedCloseDate && String(record.expectedCloseDate) < todayKey();
  return (
    <InlineAlert tone="warning" title={T.banner.stagnantTitle}>
      {past ? T.banner.pastClose(formatDate(String(record.expectedCloseDate))) : T.banner.idle(getPolicies().opportunityStagnationDays)}
      {T.banner.hint}
    </InlineAlert>
  );
}

function Timeline({ actor, record }: RecordExtensionProps) {
  // LEAD-10: the opportunity carries the lead's history, so the timeline also lists the activities logged on its lead.
  const leadId = record.leadId ? String(record.leadId) : '';
  const q = useServiceQuery(
    () =>
      [...activitiesFor(actor, 'opportunities', record.id), ...(leadId && perm(actor, 'activities').read !== 'none' ? activitiesFor(actor, 'leads', leadId) : [])].sort((a, b) => String(b.at).localeCompare(String(a.at))),
    [record.id, leadId, actor.user.id],
  );
  if (q.error)
    return (
      <ErrorState title={T.timeline.errorTitle} onRetry={q.retry}>
        {q.error}
      </ErrorState>
    );
  if (!q.data) return <Skeleton rows={4} />;
  if (!q.data.length) return <EmptyState icon="message" title={T.timeline.emptyTitle}>{T.timeline.emptyBody}</EmptyState>;
  return (
    <ul className="flow-list">
      {q.data.map((a: RecordData) => (
        <li key={a.id} className="flow-item">
          <span className="tag tone-neutral">{masterLabel('activityType', a.activityType)}</span>
          {a.parentResource === 'leads' && <span className="tag tone-info">{T.timeline.fromLead(String(a.parentId))}</span>}
          <span className="flow-main">
            <span className="flow-title">{String(a.subject)}</span>
            <span className="muted small">
              <DateText value={String(a.at)} />
              {a.notes ? ` · ${String(a.notes).slice(0, 140)}` : ''}
              {a.nextFollowUpAt ? T.timeline.nextFollowUp(formatDate(String(a.nextFollowUpAt))) : ''}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

registerRecordActions('opportunities', OpportunityActions);
registerRecordBanner('opportunities', OpportunityBanner);
registerRecordTab('opportunities', { id: 'timeline', label: T.tabs.timeline, component: Timeline });
