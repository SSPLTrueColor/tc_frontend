/** Installed Base module: runtime hooks and record extensions (installation jobs, machines, contracts, training). Labels: L.installed. */
import { L } from '../../constants/labels';
import { addDays, formatDate, nowLocal, todayKey } from '../../lib/dates';
import { registerRecordActions, registerRecordBanner, registerRecordTab } from '../../components/resource/extensions';
import { notify } from '../../services/ledger';
import { byId, coverageFor, userOfStaff } from '../../services/lookups';
import { queueMessage } from '../../services/outbox';
import { getResource } from '../../services/registry';
import { registerResourceHooks } from '../../services/resourceHooks';
import { ServiceError } from '../../services/types';
import {
  customerRecipient,
  defaultSlaTerms,
  ensureRenewalOpportunity,
  generatePmVisits,
  handoverComplete,
  missingReadiness,
  missingSteps,
  nextContractNo,
  serviceDesk,
} from '../../services/installed/logic';
import {
  ComponentsTab,
  ContractActions,
  ContractBanner,
  ContractsTab,
  countFor,
  CustomerTrainingTab,
  HandoverTab,
  HistoryTab,
  InstallationActions,
  InstallationBanner,
  JobCardTab,
  MachineActions,
  MachineBanner,
  ReadingsTab,
  ReadinessTab,
  SignOffTab,
  TicketsTab,
  WarrantyTab,
} from '../../modules/installed/components';

const S = L.installed.service;
const TABS = L.installed.tabs;

// Machine coverage is derived from warranties and contracts (BR-29). Attached here, not in the
// definition, because domain definitions load before the store.
const coverageField = getResource('machines').fields.find((f) => f.key === 'coverage');
if (coverageField) coverageField.computed = (r) => coverageFor(String(r.id));

const tell = (d: Parameters<typeof notify>[0], ws: string, staffId: unknown, title: string, link: { resource: string; recordId: string }, exceptUserId?: string) => {
  const u = userOfStaff(staffId);
  if (u && u.id !== exceptUserId) notify(d, { userId: u.id, workspaceId: ws, kind: 'assignment', title, link });
};

const fail = (field: string, message: string): never => {
  throw new ServiceError('validation', message, { fieldErrors: { [field]: message } });
};

// ---------------------------------------------------------------- installations (INS-03 … INS-06)

registerResourceHooks('installations', {
  title: (r) => S.installationTitle(r.id, String(byId('customers', r.customerId)?.name ?? r.customerId ?? '')),
  beforeCreate: ({ d }, c) => {
    const so = byId('salesOrders', c.salesOrderId, d.records);
    if (so) {
      c.customerId ??= so.customerId;
      c.productId ??= so.productId;
      c.siteAddressId ??= so.siteAddressId;
      c.divisionId ??= so.divisionId;
      if (c.customerId !== so.customerId) fail('salesOrderId', S.soOtherCustomer);
    }
    if (!c.divisionId && c.productId) c.divisionId = byId('products', c.productId, d.records)?.divisionId ?? null;
    if (c.serialNo) c.serialNo = String(c.serialNo).toUpperCase();
  },
  afterCreate: ({ d, actor }, r) => {
    const link = { resource: 'installations', recordId: r.id };
    if (r.engineerId) tell(d, actor.workspaceId, r.engineerId, S.assignedToYou(r.id), link, actor.user.id);
    serviceDesk(r.divisionId, d)
      .filter((e) => e.roleId === 'coordinator')
      .forEach((e) => tell(d, actor.workspaceId, e.id, S.newJobForCoordinator(r.id), link, actor.user.id));
  },
  beforeUpdate: (_ctx, before, c) => {
    if (before.status === 'signed_off') throw new ServiceError('invalid_state', S.lockedAfterSignOff);
    if (c.serialNo) c.serialNo = String(c.serialNo).toUpperCase();
    // Handover is complete once all three sections are written (INS-04).
    if (!before.handoverAt && handoverComplete(c)) c.handoverAt = nowLocal();
    // Site readiness edits after verification send the job back for re-verification (BR-27).
    if (before.status === 'site_ready' && missingReadiness(c as never).length) fail('rdPower', S.noUntick);
  },
  afterUpdate: (ctx, before, after) => {
    const link = { resource: 'installations', recordId: after.id };
    const reassigned = after.engineerId && after.engineerId !== before.engineerId;
    const rescheduled = after.scheduledAt && after.scheduledAt !== before.scheduledAt;
    if (reassigned) tell(ctx.d, ctx.actor.workspaceId, after.engineerId, S.assignedToYou(after.id, after.scheduledAt ? String(after.scheduledAt).replace('T', ' ') : undefined), link, ctx.actor.user.id);
    if ((reassigned || rescheduled) && after.engineerId && after.scheduledAt) {
      const r = customerRecipient(ctx.d, after.customerId);
      const eng = byId('employees', after.engineerId, ctx.d.records);
      queueMessage(ctx, {
        channel: r.channel,
        to: r.to,
        subject: S.scheduledSubject(after.id),
        body: S.scheduledBody(String(eng?.fullName ?? ''), String(eng?.mobile ?? ''), String(after.scheduledAt).replace('T', ' at ')),
        related: link,
      });
    }
  },
  beforeTransition: (_ctx, r, to) => {
    if (to === 'site_ready') {
      const miss = missingReadiness(r);
      if (miss.length) throw new ServiceError('invalid_state', S.verifyAllFirst(miss.join(', ')));
      r.readinessVerifiedAt = nowLocal();
    }
    if (to === 'scheduled') r.readinessVerifiedAt = null;
    if (to === 'in_progress') {
      if (!r.engineerId) throw new ServiceError('invalid_state', S.assignBeforeStart);
      if (missingReadiness(r).length) throw new ServiceError('invalid_state', S.readinessNotVerified);
      if (!handoverComplete(r)) throw new ServiceError('invalid_state', S.handoverBeforeStart);
    }
    if (to === 'trial_training') {
      const left = missingSteps(r);
      if (left.length) throw new ServiceError('invalid_state', S.stepsFirst(left.length));
    }
  },
});

registerRecordActions('installations', InstallationActions);
registerRecordBanner('installations', InstallationBanner);
registerRecordTab('installations', { id: 'readiness', label: TABS.readiness, component: ReadinessTab });
registerRecordTab('installations', { id: 'handover', label: TABS.handover, component: HandoverTab });
registerRecordTab('installations', { id: 'jobCard', label: TABS.jobCard, component: JobCardTab });
registerRecordTab('installations', { id: 'signOff', label: TABS.signOff, component: SignOffTab });

// ---------------------------------------------------------------- machines (IB-01, BR-28 unique serial)

const assertUniqueSerial = (d: { records: Record<string, { id: string; serialNo?: unknown }[]> }, serial: unknown, selfId?: string) => {
  const s = String(serial ?? '').toUpperCase();
  if (s && (d.records.machines ?? []).some((m) => m.id !== selfId && String(m.serialNo).toUpperCase() === s)) fail('serialNo', S.serialExists(s));
};

registerResourceHooks('machines', {
  title: (r) => `${String(r.serialNo ?? r.id)}${r.model ? ` · ${String(r.model)}` : ''}`,
  beforeCreate: ({ d }, c) => {
    c.serialNo = String(c.serialNo ?? '').toUpperCase();
    assertUniqueSerial(d as never, c.serialNo);
    const p = byId('products', c.productId, d.records);
    if (p) {
      c.divisionId ??= p.divisionId;
      if (!c.model) c.model = p.model ?? p.name;
    }
    if (c.siteAddressId && byId('addresses', c.siteAddressId, d.records)?.customerId !== c.customerId) fail('siteAddressId', S.siteOfOwner);
  },
  beforeUpdate: ({ d }, before, c) => {
    if (c.serialNo !== before.serialNo) {
      c.serialNo = String(c.serialNo ?? '').toUpperCase();
      assertUniqueSerial(d as never, c.serialNo, before.id);
    }
    if (c.customerId !== before.customerId) fail('customerId', S.changeOwnerViaMove);
  },
});

registerRecordActions('machines', MachineActions);
registerRecordBanner('machines', MachineBanner);
// Machine record tabs (GLOSSARY §1.2): Details, Warranty, AMC / CMC, Component Serial Numbers, Usage Readings,
// Service Tickets, Resale / Relocation History; the shell adds Related, Activity and Comments.
registerRecordTab('machines', { id: 'warranty', label: TABS.warranty, component: WarrantyTab, count: ({ actor, record }) => countFor(actor, 'warranties', { machineId: record.id }) });
registerRecordTab('machines', { id: 'amc', label: TABS.amc, component: ContractsTab, count: ({ actor, record }) => countFor(actor, 'amcContracts', { machineId: record.id }) });
registerRecordTab('machines', { id: 'components', label: TABS.components, component: ComponentsTab, count: ({ actor, record }) => countFor(actor, 'machineComponents', { machineId: record.id, status: 'in_service' }) });
registerRecordTab('machines', { id: 'readings', label: TABS.readings, component: ReadingsTab, count: ({ actor, record }) => countFor(actor, 'machineReadings', { machineId: record.id }) });
registerRecordTab('machines', { id: 'tickets', label: TABS.tickets, component: TicketsTab, count: ({ actor, record }) => countFor(actor, 'tickets', { machineId: record.id }) });
registerRecordTab('machines', { id: 'history', label: TABS.history, component: HistoryTab, count: ({ actor, record }) => countFor(actor, 'machineMoves', { machineId: record.id }) });

registerResourceHooks('machineComponents', {
  title: (r) => `${String(r.serialNo)}`,
  beforeCreate: ({ d }, c) => {
    c.serialNo = String(c.serialNo ?? '').toUpperCase();
    if ((d.records.machineComponents ?? []).some((x) => String(x.serialNo).toUpperCase() === c.serialNo)) fail('serialNo', S.componentSerialExists);
    c.divisionId ??= byId('machines', c.machineId, d.records)?.divisionId ?? null;
  },
});

registerResourceHooks('machineReadings', {
  title: (r) => `${String(byId('machines', r.machineId)?.serialNo ?? r.machineId)} · ${String(r.readingDate)}`,
  beforeCreate: ({ d }, c) => {
    const m = byId('machines', c.machineId, d.records);
    c.divisionId ??= m?.divisionId ?? null;
    const last = (d.records.machineReadings ?? []).filter((x) => x.machineId === c.machineId && String(x.readingDate) <= String(c.readingDate)).sort((a, b) => String(b.readingDate).localeCompare(String(a.readingDate)))[0];
    if (last && Number(c.printCounter) < Number(last.printCounter)) fail('printCounter', S.counterBelow(Number(last.printCounter).toLocaleString('en-IN'), formatDate(String(last.readingDate))));
  },
});

registerResourceHooks('machineMoves', {
  title: (r) => `${String(byId('machines', r.machineId)?.serialNo ?? r.machineId)} · ${String(r.moveDate)}`,
});

// ---------------------------------------------------------------- warranties (IB-03)

registerResourceHooks('warranties', {
  title: (r) => S.warrantyTitle(String(byId('machines', r.machineId)?.serialNo ?? r.machineId)),
  beforeCreate: ({ d }, c) => {
    const m = byId('machines', c.machineId, d.records);
    if (m) {
      c.customerId = m.customerId;
      c.divisionId = m.divisionId;
    }
  },
});

// ---------------------------------------------------------------- AMC / CMC (IB-04, IB-05)

registerResourceHooks('amcContracts', {
  title: (r) => String(r.contractNo ?? r.id),
  beforeCreate: ({ d }, c) => {
    const m = byId('machines', c.machineId, d.records);
    if (m && m.customerId !== c.customerId) fail('machineId', S.machineOtherCustomer);
    if (m) c.divisionId = m.divisionId;
    if (!c.slaTerms) c.slaTerms = defaultSlaTerms(String(c.contractType ?? 'amc'));
    c.contractNo = nextContractNo(d);
    // Overlapping open contracts on one machine are not allowed.
    const clash = (d.records.amcContracts ?? []).find((x) => x.machineId === c.machineId && ['draft', 'active', 'due_for_renewal'].includes(String(x.status)) && String(x.startDate) <= String(c.endDate) && String(x.endDate) >= String(c.startDate));
    if (clash && c.status !== 'active') fail('startDate', S.overlaps(String(clash.contractNo), formatDate(String(clash.startDate)), formatDate(String(clash.endDate))));
  },
  beforeUpdate: (_ctx, before, c) => {
    if (!['draft'].includes(String(before.status)) && (c.machineId !== before.machineId || c.customerId !== before.customerId)) fail('machineId', S.fixedOnceActive);
  },
  beforeTransition: (_ctx, r, to) => {
    if (to === 'active') {
      if (String(r.startDate) > todayKey()) throw new ServiceError('invalid_state', S.startsLater(formatDate(String(r.startDate))));
      if (String(r.endDate) < todayKey()) throw new ServiceError('invalid_state', S.endPassed);
      if (!(Number(r.value) > 0)) throw new ServiceError('invalid_state', S.valueBeforeActivate);
    }
    if (to === 'lost' && !r.lostReason) throw new ServiceError('validation', S.lostReasonRequired, { fieldErrors: { lostReason: S.required } });
  },
  afterTransition: (ctx, _before, after) => {
    if (after.status === 'active') {
      const m = byId('machines', after.machineId, ctx.d.records);
      if (m) generatePmVisits(ctx, { machine: m, start: String(after.startDate) > todayKey() ? String(after.startDate) : addDays(todayKey(), -1), end: String(after.endDate), perYear: Number(after.pmVisitsPerYear) || 0, amcContractId: after.id });
    }
    if (after.status === 'due_for_renewal') {
      ensureRenewalOpportunity(ctx, after);
      [after.ownerId, after.serviceOwnerId].forEach((s) => tell(ctx.d, ctx.actor.workspaceId, s, S.dueNotice(String(after.contractNo), formatDate(String(after.endDate))), { resource: 'amcContracts', recordId: after.id }, ctx.actor.user.id));
    }
  },
});

registerRecordActions('amcContracts', ContractActions);
registerRecordBanner('amcContracts', ContractBanner);

// ---------------------------------------------------------------- training (INS-08)

registerResourceHooks('trainingRecords', {
  title: (r) => S.trainingTitle(String(byId('customers', r.customerId)?.name ?? r.customerId), formatDate(String(r.date))),
  beforeCreate: ({ d }, c) => {
    const m = byId('machines', c.machineId, d.records);
    if (m && m.customerId !== c.customerId) fail('machineId', S.machineOtherCustomer);
    c.divisionId ??= m?.divisionId ?? ((byId('customers', c.customerId, d.records)?.divisionIds as string[] | undefined) ?? [])[0] ?? null;
  },
  afterCreate: ({ d, actor }, r) => {
    if (r.retrainingStatus === 'requested') serviceDesk(r.divisionId, d).forEach((e) => tell(d, actor.workspaceId, e.id, S.retrainingRequested(String(byId('customers', r.customerId, d.records)?.name ?? '')), { resource: 'trainingRecords', recordId: r.id }, actor.user.id));
  },
  afterUpdate: ({ d, actor }, before, after) => {
    if (after.retrainingStatus === 'requested' && before.retrainingStatus !== 'requested')
      serviceDesk(after.divisionId, d).forEach((e) => tell(d, actor.workspaceId, e.id, S.retrainingRequested(String(byId('customers', after.customerId, d.records)?.name ?? '')), { resource: 'trainingRecords', recordId: after.id }, actor.user.id));
  },
});

registerRecordTab('customers', { id: 'training', label: TABS.customerTraining, component: CustomerTrainingTab, count: ({ actor, record }) => countFor(actor, 'trainingRecords', { customerId: record.id }) });
