/** Service module: service ticket / site visit / PM visit / knowledge article hooks, KB approval type, ticket record extensions and the SLA sweep timer. */
import { registerRecordActions, registerRecordBanner, registerRecordTab } from '../../components/resource/extensions';
import { isSignedIn } from '../../services/session';
import { byId } from '../../services/lookups';
import { registerResourceHooks } from '../../services/resourceHooks';
import { patchRecordIn, recordTitle } from '../../services/runtime';
import { visitsOf } from '../../services/service/jobs';
import { afterTicketCreated, afterTicketTransition, afterTicketUpdated, applyTicketDefaults, customerName, guardTicketTransition, guardTicketUpdate, sweepService } from '../../services/service/tickets';
import { registerApprovalType, requestApprovalIn } from '../../services/workflow';
import { ChargeableTab, FeedbackTab, RemoteTab, SlaTab, TicketActions, TicketBanner, VisitsTab } from '../../modules/service/components/TicketExtensions';
import { L } from '../../constants/labels';

const S = L.service;

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
  title: (p) => S.titles.pmVisit(s(byId('machines', p.machineId)?.serialNo) || s(p.machineId), s(p.dueDate)),
});

// Knowledge Base: service engineers submit, Service Leadership approves (FR-090).
registerResourceHooks('knowledgeArticles', {
  beforeCreate: (ctx, c) => {
    c.authorId = c.authorId || ctx.actor.staffId;
  },
  afterTransition: (ctx, before, after) => {
    if (after.status === 'pending' && before.status === 'draft') {
      requestApprovalIn(ctx, { type: 'kb.article', resource: 'knowledgeArticles', recordId: after.id, reason: '', summary: S.titles.kbApproval(s(after.title)), levels: [{ capability: 'approve.service', label: S.approvals.kbLevel }] });
    }
  },
});

registerApprovalType('kb.article', {
  label: S.approvals.kbType,
  onApproved: (ctx, a) => {
    const art = (ctx.d.records.knowledgeArticles ?? []).find((x) => x.id === a.recordId);
    if (art?.status === 'pending') patchRecordIn(ctx, 'knowledgeArticles', art.id, { status: 'published' }, S.approvals.published(a.id));
  },
  onRejected: (ctx, a) => {
    const art = (ctx.d.records.knowledgeArticles ?? []).find((x) => x.id === a.recordId);
    if (art?.status === 'pending') patchRecordIn(ctx, 'knowledgeArticles', art.id, { status: 'draft' }, S.approvals.returned(a.decisionNote ?? ''));
  },
});

registerRecordBanner('tickets', TicketBanner);
registerRecordActions('tickets', TicketActions);
// Ticket tabs (GLOSSARY §1.2): Details, SLA Tracking, Site Visits, Remote Support, Parts Used (Spare Parts module), Chargeable Service, Customer Feedback, Activity History.
registerRecordTab('tickets', { id: 'sla', order: 10, label: S.tabs.sla, component: SlaTab });
registerRecordTab('tickets', { id: 'visits', order: 20, label: S.tabs.visits, component: VisitsTab, count: ({ record }) => visitsOf(record.id).filter((v) => v.visitType !== 'remote').length || undefined });
registerRecordTab('tickets', { id: 'remote', order: 30, label: S.tabs.remote, component: RemoteTab, count: ({ record }) => visitsOf(record.id).filter((v) => v.visitType === 'remote').length || undefined });
registerRecordTab('tickets', { id: 'chargeable', order: 40, label: S.tabs.chargeable, component: ChargeableTab });
registerRecordTab('tickets', { id: 'feedback', order: 50, label: S.tabs.feedback, component: FeedbackTab });

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
