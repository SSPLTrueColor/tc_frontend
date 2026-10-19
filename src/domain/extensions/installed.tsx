/** Installed-base module: runtime hooks and record extensions (installations, machines, contracts, training). */
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
  countFor,
  CustomerTrainingTab,
  HistoryTab,
  InstallationActions,
  InstallationBanner,
  MachineActions,
  MachineBanner,
  ReadingsTab,
} from '../../modules/installed/components';

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
  title: (r) => `${r.id} · ${String(byId('customers', r.customerId)?.name ?? r.customerId ?? '')}`,
  beforeCreate: ({ d }, c) => {
    const so = byId('salesOrders', c.salesOrderId, d.records);
    if (so) {
      c.customerId ??= so.customerId;
      c.productId ??= so.productId;
      c.siteAddressId ??= so.siteAddressId;
      c.divisionId ??= so.divisionId;
      if (c.customerId !== so.customerId) fail('salesOrderId', 'The sales order belongs to another customer');
    }
    if (!c.divisionId && c.productId) c.divisionId = byId('products', c.productId, d.records)?.divisionId ?? null;
    if (c.serialNo) c.serialNo = String(c.serialNo).toUpperCase();
  },
  afterCreate: ({ d, actor }, r) => {
    const link = { resource: 'installations', recordId: r.id };
    if (r.engineerId) tell(d, actor.workspaceId, r.engineerId, `Installation ${r.id} assigned to you`, link, actor.user.id);
    serviceDesk(r.divisionId, d)
      .filter((e) => e.roleId === 'coordinator')
      .forEach((e) => tell(d, actor.workspaceId, e.id, `New installation job ${r.id} — assign an engineer and share the readiness checklist`, link, actor.user.id));
  },
  beforeUpdate: (_ctx, before, c) => {
    if (before.status === 'signed_off') throw new ServiceError('invalid_state', 'This installation is signed off and locked for audit.');
    if (c.serialNo) c.serialNo = String(c.serialNo).toUpperCase();
    // Handover is complete once all three sections are written (INS-04).
    if (!before.handoverAt && handoverComplete(c)) c.handoverAt = nowLocal();
    // Readiness edits after verification send the job back for re-verification (BR-27).
    if (before.status === 'site_ready' && missingReadiness(c as never).length) fail('rdPower', 'Readiness items cannot be unticked after verification — use “Reopen readiness check”.');
  },
  afterUpdate: (ctx, before, after) => {
    const link = { resource: 'installations', recordId: after.id };
    const reassigned = after.engineerId && after.engineerId !== before.engineerId;
    const rescheduled = after.scheduledAt && after.scheduledAt !== before.scheduledAt;
    if (reassigned) tell(ctx.d, ctx.actor.workspaceId, after.engineerId, `Installation ${after.id} assigned to you${after.scheduledAt ? ` for ${String(after.scheduledAt).replace('T', ' ')}` : ''}`, link, ctx.actor.user.id);
    if ((reassigned || rescheduled) && after.engineerId && after.scheduledAt) {
      const r = customerRecipient(ctx.d, after.customerId);
      const eng = byId('employees', after.engineerId, ctx.d.records);
      queueMessage(ctx, {
        channel: r.channel,
        to: r.to,
        subject: `Installation scheduled — ${after.id}`,
        body: `Our engineer ${eng?.fullName ?? ''} (${eng?.mobile ?? ''}) will install your machine on ${String(after.scheduledAt).replace('T', ' at ')}. Please keep the site readiness checklist complete.`,
        related: link,
      });
    }
  },
  beforeTransition: (_ctx, r, to) => {
    if (to === 'site_ready') {
      const miss = missingReadiness(r);
      if (miss.length) throw new ServiceError('invalid_state', `Verify every readiness item first: ${miss.join(', ')}.`);
      r.readinessVerifiedAt = nowLocal();
    }
    if (to === 'scheduled') r.readinessVerifiedAt = null;
    if (to === 'in_progress') {
      if (!r.engineerId) throw new ServiceError('invalid_state', 'Assign an engineer before starting.');
      if (missingReadiness(r).length) throw new ServiceError('invalid_state', 'Site readiness is not fully verified.');
      if (!handoverComplete(r)) throw new ServiceError('invalid_state', 'Complete the sales-to-service handover (expectations, commitments, key contacts) before starting.');
    }
    if (to === 'trial_training') {
      const left = missingSteps(r);
      if (left.length) throw new ServiceError('invalid_state', `Complete every job-card step first (${left.length} left).`);
    }
  },
});

registerRecordActions('installations', InstallationActions);
registerRecordBanner('installations', InstallationBanner);

// ---------------------------------------------------------------- machines (IB-01, BR-28 unique serial)

const assertUniqueSerial = (d: { records: Record<string, { id: string; serialNo?: unknown }[]> }, serial: unknown, selfId?: string) => {
  const s = String(serial ?? '').toUpperCase();
  if (s && (d.records.machines ?? []).some((m) => m.id !== selfId && String(m.serialNo).toUpperCase() === s)) fail('serialNo', `Serial ${s} already exists on another machine`);
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
    if (c.siteAddressId && byId('addresses', c.siteAddressId, d.records)?.customerId !== c.customerId) fail('siteAddressId', 'The site must belong to the owner');
  },
  beforeUpdate: ({ d }, before, c) => {
    if (c.serialNo !== before.serialNo) {
      c.serialNo = String(c.serialNo ?? '').toUpperCase();
      assertUniqueSerial(d as never, c.serialNo, before.id);
    }
    if (c.customerId !== before.customerId) fail('customerId', 'Change the owner with “Relocate / transfer” so the history is kept');
  },
});

registerRecordActions('machines', MachineActions);
registerRecordBanner('machines', MachineBanner);
registerRecordTab('machines', { id: 'components', label: 'Components', component: ComponentsTab, count: ({ actor, record }) => countFor(actor, 'machineComponents', { machineId: record.id, status: 'in_service' }) });
registerRecordTab('machines', { id: 'readings', label: 'Readings', component: ReadingsTab });
registerRecordTab('machines', { id: 'history', label: 'Ownership', component: HistoryTab });

registerResourceHooks('machineComponents', {
  title: (r) => `${String(r.serialNo)}`,
  beforeCreate: ({ d }, c) => {
    c.serialNo = String(c.serialNo ?? '').toUpperCase();
    if ((d.records.machineComponents ?? []).some((x) => String(x.serialNo).toUpperCase() === c.serialNo)) fail('serialNo', 'This serial number is already recorded');
    c.divisionId ??= byId('machines', c.machineId, d.records)?.divisionId ?? null;
  },
});

registerResourceHooks('machineReadings', {
  title: (r) => `${String(byId('machines', r.machineId)?.serialNo ?? r.machineId)} · ${String(r.readingDate)}`,
  beforeCreate: ({ d }, c) => {
    const m = byId('machines', c.machineId, d.records);
    c.divisionId ??= m?.divisionId ?? null;
    const last = (d.records.machineReadings ?? []).filter((x) => x.machineId === c.machineId && String(x.readingDate) <= String(c.readingDate)).sort((a, b) => String(b.readingDate).localeCompare(String(a.readingDate)))[0];
    if (last && Number(c.printCounter) < Number(last.printCounter)) fail('printCounter', `Counter cannot go below the previous reading (${Number(last.printCounter).toLocaleString('en-IN')} on ${last.readingDate})`);
  },
});

registerResourceHooks('machineMoves', {
  title: (r) => `${String(byId('machines', r.machineId)?.serialNo ?? r.machineId)} · ${String(r.moveDate)}`,
});

// ---------------------------------------------------------------- warranties (IB-03)

registerResourceHooks('warranties', {
  title: (r) => `Warranty · ${String(byId('machines', r.machineId)?.serialNo ?? r.machineId)}`,
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
    if (m && m.customerId !== c.customerId) fail('machineId', 'This machine belongs to another customer');
    if (m) c.divisionId = m.divisionId;
    if (!c.slaTerms) c.slaTerms = defaultSlaTerms(String(c.contractType ?? 'amc'));
    c.contractNo = nextContractNo(d);
    // Overlapping open contracts on one machine are not allowed.
    const clash = (d.records.amcContracts ?? []).find((x) => x.machineId === c.machineId && ['draft', 'active', 'due_for_renewal'].includes(String(x.status)) && String(x.startDate) <= String(c.endDate) && String(x.endDate) >= String(c.startDate));
    if (clash && c.status !== 'active') fail('startDate', `Overlaps ${clash.contractNo} (${formatDate(String(clash.startDate))} – ${formatDate(String(clash.endDate))}) on this machine`);
  },
  beforeUpdate: (_ctx, before, c) => {
    if (!['draft'].includes(String(before.status)) && (c.machineId !== before.machineId || c.customerId !== before.customerId)) fail('machineId', 'Customer and machine are fixed once the contract is active');
  },
  beforeTransition: (_ctx, r, to) => {
    if (to === 'active') {
      if (String(r.startDate) > todayKey()) throw new ServiceError('invalid_state', `This contract starts on ${formatDate(String(r.startDate))}; activate it on or after that date.`);
      if (String(r.endDate) < todayKey()) throw new ServiceError('invalid_state', 'The end date has passed — renew instead.');
      if (!(Number(r.value) > 0)) throw new ServiceError('invalid_state', 'Set the contract value before activating.');
    }
    if (to === 'lost' && !r.lostReason) throw new ServiceError('validation', 'A lost reason is required.', { fieldErrors: { lostReason: 'Required' } });
  },
  afterTransition: (ctx, _before, after) => {
    if (after.status === 'active') {
      const m = byId('machines', after.machineId, ctx.d.records);
      if (m) generatePmVisits(ctx, { machine: m, start: String(after.startDate) > todayKey() ? String(after.startDate) : addDays(todayKey(), -1), end: String(after.endDate), perYear: Number(after.pmVisitsPerYear) || 0, amcContractId: after.id });
    }
    if (after.status === 'due_for_renewal') {
      ensureRenewalOpportunity(ctx, after);
      [after.ownerId, after.serviceOwnerId].forEach((s) => tell(ctx.d, ctx.actor.workspaceId, s, `${after.contractNo} is due for renewal (ends ${formatDate(String(after.endDate))})`, { resource: 'amcContracts', recordId: after.id }, ctx.actor.user.id));
    }
  },
});

registerRecordActions('amcContracts', ContractActions);
registerRecordBanner('amcContracts', ContractBanner);

// ---------------------------------------------------------------- training (INS-08)

registerResourceHooks('trainingRecords', {
  title: (r) => `Training · ${String(byId('customers', r.customerId)?.name ?? r.customerId)} · ${String(r.date)}`,
  beforeCreate: ({ d }, c) => {
    const m = byId('machines', c.machineId, d.records);
    if (m && m.customerId !== c.customerId) fail('machineId', 'This machine belongs to another customer');
    c.divisionId ??= m?.divisionId ?? ((byId('customers', c.customerId, d.records)?.divisionIds as string[] | undefined) ?? [])[0] ?? null;
  },
  afterCreate: ({ d, actor }, r) => {
    if (r.retrainingStatus === 'requested') serviceDesk(r.divisionId, d).forEach((e) => tell(d, actor.workspaceId, e.id, `Re-training requested by ${String(byId('customers', r.customerId, d.records)?.name ?? '')}`, { resource: 'trainingRecords', recordId: r.id }, actor.user.id));
  },
  afterUpdate: ({ d, actor }, before, after) => {
    if (after.retrainingStatus === 'requested' && before.retrainingStatus !== 'requested')
      serviceDesk(after.divisionId, d).forEach((e) => tell(d, actor.workspaceId, e.id, `Re-training requested by ${String(byId('customers', after.customerId, d.records)?.name ?? '')}`, { resource: 'trainingRecords', recordId: after.id }, actor.user.id));
  },
});

registerRecordTab('customers', { id: 'training', label: 'Training', component: CustomerTrainingTab, count: ({ actor, record }) => countFor(actor, 'trainingRecords', { customerId: record.id }) });
