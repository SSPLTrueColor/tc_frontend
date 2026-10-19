/** Service module: ticket/visit/PM/KB hooks, KB approval type, ticket record extensions and the SLA sweep timer. */
import { registerRecordActions, registerRecordBanner, registerRecordTab } from '../../components/resource/extensions';
import { isSignedIn } from '../../services/session';
import { byId } from '../../services/lookups';
import { registerResourceHooks } from '../../services/resourceHooks';
import { patchRecordIn, recordTitle } from '../../services/runtime';
import { visitsOf } from '../../services/service/jobs';
import { afterTicketCreated, afterTicketTransition, afterTicketUpdated, applyTicketDefaults, customerName, guardTicketTransition, guardTicketUpdate, sweepService } from '../../services/service/tickets';
import { registerApprovalType, requestApprovalIn } from '../../services/workflow';
import { SlaTab, TicketActions, TicketBanner, VisitsTab } from '../../modules/service/components/TicketExtensions';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

registerResourceHooks('tickets', {
  beforeCreate: applyTicketDefaults,
  afterCreate: afterTicketCreated,
  beforeUpdate: guardTicketUpdate,
  afterUpdate: afterTicketUpdated,
  beforeTransition: guardTicketTransition,
  afterTransition: afterTicketTransition,
  title: (t) => `${customerName(t.customerId)} — ${s(t.description).slice(0, 48)}${s(t.description).length > 48 ? '…' : ''}`,
});

registerResourceHooks('serviceVisits', {
  beforeCreate: (ctx, c) => {
    c.engineerId = c.engineerId || ctx.actor.staffId;
  },
  title: (v) => `${s(v.ticketId)} · ${recordTitle('employees', v.engineerId)}`,
});

registerResourceHooks('pmVisits', {
  beforeCreate: (ctx, c) => {
    const m = byId('machines', c.machineId, ctx.d.records);
    c.divisionId = c.divisionId || m?.divisionId || null;
    c.customerId = c.customerId || m?.customerId;
  },
  title: (p) => `PM ${s(byId('machines', p.machineId)?.serialNo) || s(p.machineId)} · due ${s(p.dueDate)}`,
});

// Knowledge base: engineers submit, the service head approves (FR-090).
registerResourceHooks('knowledgeArticles', {
  beforeCreate: (ctx, c) => {
    c.authorId = c.authorId || ctx.actor.staffId;
  },
  afterTransition: (ctx, before, after) => {
    if (after.status === 'pending' && before.status === 'draft') {
      requestApprovalIn(ctx, { type: 'kb.article', resource: 'knowledgeArticles', recordId: after.id, reason: '', summary: `KB article “${s(after.title)}”`, levels: [{ capability: 'approve.service', label: 'Service head' }] });
    }
  },
});

registerApprovalType('kb.article', {
  label: 'Knowledge article',
  onApproved: (ctx, a) => {
    const art = (ctx.d.records.knowledgeArticles ?? []).find((x) => x.id === a.recordId);
    if (art?.status === 'pending') patchRecordIn(ctx, 'knowledgeArticles', art.id, { status: 'published' }, `Published after approval ${a.id}`);
  },
  onRejected: (ctx, a) => {
    const art = (ctx.d.records.knowledgeArticles ?? []).find((x) => x.id === a.recordId);
    if (art?.status === 'pending') patchRecordIn(ctx, 'knowledgeArticles', art.id, { status: 'draft' }, `Returned to draft: ${a.decisionNote ?? ''}`);
  },
});

registerRecordBanner('tickets', TicketBanner);
registerRecordActions('tickets', TicketActions);
registerRecordTab('tickets', { id: 'sla', label: 'SLA', component: SlaTab });
registerRecordTab('tickets', { id: 'visits', label: 'Visits', component: VisitsTab, count: ({ record }) => visitsOf(record.id).length || undefined });

// SLA sweep on the simulated clock (BR-32): every minute while signed in; writes only when something changed.
if (typeof window !== 'undefined') {
  const tick = () => {
    try {
      if (isSignedIn()) sweepService();
    } catch {
      /* the sweep must never break the app; it retries on the next tick */
    }
  };
  window.setTimeout(tick, 1500);
  window.setInterval(tick, 60_000);
}
