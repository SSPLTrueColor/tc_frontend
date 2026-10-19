/**
 * Installed-base domain services (BRD 4.6 / 4.7). Synchronous engine-side logic; pages call the
 * async wrappers in services/api/installed.ts. Every write is one commit, audited.
 */
import { appPack } from '../../domain/pack';
import { addDays, formatDate, nowLocal, parseLocal, toDateKey, todayKey } from '../../lib/dates';
import { nowIso } from '../../lib/clock';
import { fyCode, fyLabel } from '../../lib/fy';
import { formatMoney } from '../../lib/format';
import { uid } from '../../lib/ids';
import type { RecordData } from '../../metadata/types';
import { type Actor, can, canReadRecord, canUpdateRecord } from '../authz';
import { commit, getDb } from '../db';
import { appendAudit, notify } from '../ledger';
import { byId, employeesWithRole, userOfStaff } from '../lookups';
import { queueMessage } from '../outbox';
import { getPolicies } from '../policies';
import { activeMasterValues, getResource, masterLabel } from '../registry';
import type { HookContext } from '../resourceHooks';
import { insertRecordIn, patchRecordIn, recordsIn } from '../runtime';
import { ServiceError } from '../types';
import { READINESS_FIELDS } from '../../domain/modules/installed/resources';

export { READINESS_FIELDS };

/** True when a resource is part of the published pack (other modules are built in parallel). */
export const hasResource = (key: string) => appPack.resources.some((r) => r.key === key);

const ctxFor = (d: HookContext['d'], actor: Actor): HookContext => ({ d, actor, correlationId: uid('cor') });

export function addMonths(dateKey: string, months: number): string {
  const d = parseLocal(dateKey);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toDateKey(d);
}

export const daysBetween = (from: string, to: string) => Math.round((parseLocal(to).getTime() - parseLocal(from).getTime()) / 86_400_000);

/** Best contact for customer messages: decision maker with consent, else any contact with a mobile. */
export function customerRecipient(d: HookContext['d'], customerId: unknown): { to: string; name: string; channel: 'whatsapp' | 'email' } {
  const customer = (d.records.customers ?? []).find((c) => c.id === customerId);
  const contacts = (d.records.contacts ?? []).filter((c) => c.customerId === customerId);
  const best = contacts.find((c) => c.buyingRole === 'decision_maker' && c.consentWhatsapp && (c.whatsapp || c.mobile)) ?? contacts.find((c) => c.consentWhatsapp && (c.whatsapp || c.mobile)) ?? contacts.find((c) => c.email && c.consentEmail);
  const name = String(customer?.name ?? customerId ?? 'Customer');
  if (best && best.consentWhatsapp && (best.whatsapp || best.mobile)) return { to: `${best.name} (+91 ${best.whatsapp || best.mobile})`, name, channel: 'whatsapp' };
  if (best && best.email) return { to: `${best.name} <${best.email}>`, name, channel: 'email' };
  return { to: `${name} (no contact with messaging consent on file)`, name, channel: 'email' };
}

const notifyStaff = (ctx: HookContext, staffId: unknown, title: string, link: { resource: string; recordId: string }) => {
  const u = userOfStaff(staffId);
  if (u && u.id !== ctx.actor.user.id) notify(ctx.d, { userId: u.id, workspaceId: ctx.actor.workspaceId, kind: 'assignment', title, link });
};

// ---------------------------------------------------------------- PM schedule (INS-07, IB-04)

/** Assumption (REQUIREMENTS §7): warranty includes 2 preventive visits a year. */
export const WARRANTY_PM_PER_YEAR = 2;

/**
 * Creates `pmVisits` spaced evenly between start and end (BR-28). Skips months that already have a
 * visit for the machine. Returns the number created; 0 when the service module is not installed.
 */
export function generatePmVisits(ctx: HookContext, opts: { machine: RecordData; start: string; end: string; perYear: number; amcContractId?: string }): number {
  if (!hasResource('pmVisits') || opts.perYear <= 0) return 0;
  const step = Math.max(1, Math.round(12 / opts.perYear));
  const existing = new Set(recordsIn(ctx, 'pmVisits').filter((v) => v.machineId === opts.machine.id).map((v) => String(v.dueDate).slice(0, 7)));
  let n = 0;
  for (let due = addMonths(opts.start, step); due <= opts.end; due = addMonths(due, step)) {
    if (existing.has(due.slice(0, 7))) continue;
    try {
      insertRecordIn(ctx, 'pmVisits', { machineId: opts.machine.id, customerId: opts.machine.customerId, amcContractId: opts.amcContractId ?? null, dueDate: due, status: 'due' });
      existing.add(due.slice(0, 7));
      n++;
    } catch (e) {
      appendAudit(ctx.d, ctx.actor, { action: 'pm.skipped', actorType: 'workflow', resource: 'machines', recordId: opts.machine.id, summary: `PM visit for ${due} not created: ${e instanceof Error ? e.message : 'unknown error'}`, correlationId: ctx.correlationId });
      break;
    }
  }
  return n;
}

// ---------------------------------------------------------------- installation job (INS-03 … INS-07)

const res = () => getResource('installations');

function loadInstallation(d: HookContext['d'], actor: Actor, id: string, write = true) {
  const raw = (d.records.installations ?? []).find((r) => r.id === id);
  if (!raw || !canReadRecord(actor, res(), raw)) throw new ServiceError('not_found', `Installation job ${id} was not found.`);
  if (write && !canUpdateRecord(actor, res(), raw)) throw new ServiceError('forbidden', 'Your role cannot update this installation job.');
  return raw;
}

export const missingReadiness = (r: RecordData) => READINESS_FIELDS.filter(([k]) => r[k] !== true).map(([, label]) => label);
export const allSteps = () => activeMasterValues('installStep').map((v) => v.key);
export const missingSteps = (r: RecordData) => allSteps().filter((s) => !((r.jcSteps as string[] | undefined) ?? []).includes(s));
export const handoverComplete = (r: Record<string, unknown>) => ['hoExpectations', 'hoCommitments', 'hoKeyContacts'].every((k) => String(r[k] ?? '').trim().length > 0);

/** FR-062: send the readiness checklist to the customer (simulated WhatsApp / email). */
export function shareReadinessChecklist(actor: Actor, id: string) {
  commit((d) => {
    const raw = loadInstallation(d, actor, id);
    if (raw.status !== 'scheduled') throw new ServiceError('invalid_state', 'The checklist is shared before the site is verified.');
    const ctx = ctxFor(d, actor);
    const r = customerRecipient(d, raw.customerId);
    queueMessage(ctx, {
      channel: r.channel,
      to: r.to,
      subject: `Site readiness checklist for your installation (${id})`,
      body: `Please confirm before installation: ${READINESS_FIELDS.map(([, l]) => l).join('; ')}. Our engineer will verify each item on site.`,
      related: { resource: 'installations', recordId: id },
    });
    patchRecordIn(ctx, 'installations', id, { readinessSharedAt: nowLocal() }, `Readiness checklist shared with ${r.name}`);
  });
}

/** COM-04 file metadata only: names and sizes, size limit from policy. */
export function attachInstallationMedia(actor: Actor, id: string, files: { name: string; size: number }[]) {
  const max = getPolicies().maxFileMb;
  const tooBig = files.filter((f) => f.size > max * 1024 * 1024);
  if (tooBig.length) throw new ServiceError('validation', `${tooBig.map((f) => f.name).join(', ')} ${tooBig.length > 1 ? 'are' : 'is'} larger than ${max} MB.`);
  if (!files.length) return;
  commit((d) => {
    const raw = loadInstallation(d, actor, id);
    if (raw.status === 'signed_off') throw new ServiceError('invalid_state', 'The job card is locked after sign-off.');
    const names = [String(raw.mediaFiles ?? ''), ...files.map((f) => f.name)].filter(Boolean).join(', ');
    patchRecordIn(ctxFor(d, actor), 'installations', id, { mediaFiles: names.slice(0, 2000) }, `Attached ${files.length} photo/video file(s)`);
  });
}

const otps = new Map<string, string>();

/** FR-065: simulated OTP to the customer's mobile; returns the code so the UI can show it. */
export function startSignOffOtp(actor: Actor, id: string): string {
  const code = String(100000 + Math.floor(Math.random() * 900000));
  commit((d) => {
    const raw = loadInstallation(d, actor, id);
    if (raw.status !== 'trial_training') throw new ServiceError('invalid_state', 'Sign-off happens after trial & training.');
    const ctx = ctxFor(d, actor);
    const r = customerRecipient(d, raw.customerId);
    queueMessage(ctx, { channel: 'sms', to: r.to, body: `True Colors: your installation sign-off code for ${id} is ${code}. Share it with the engineer only after you are satisfied.`, related: { resource: 'installations', recordId: id } });
  });
  otps.set(id, code);
  return code;
}

export interface SignOffInput {
  method: 'otp' | 'signature';
  otp?: string;
  signatureData?: string;
  signedOffBy: string;
}

/** What still blocks sign-off (shown in the dialog and enforced by signOffInstallation). */
export function signOffBlockers(r: RecordData, d = getDb()): string[] {
  const out: string[] = [];
  if (r.status !== 'trial_training') out.push('Move the job to Trial & training first');
  if (!r.productId) out.push('Machine model (product) is missing');
  if (!r.serialNo) out.push('Enter the machine serial number');
  else if ((d.records.machines ?? []).some((m) => String(m.serialNo).toUpperCase() === String(r.serialNo).toUpperCase())) out.push(`Serial ${r.serialNo} already exists on another machine`);
  if (!String(r.trialResults ?? '').trim()) out.push('Record the trial printing results');
  if (!((r.trainingTopics as string[] | undefined) ?? []).length) out.push('Record the training topics given');
  if (!String(r.trainees ?? '').trim()) out.push('Record the trainees');
  const steps = missingSteps(r);
  if (steps.length) out.push(`Complete job-card steps: ${steps.map((s) => masterLabel('installStep', s)).join(', ')}`);
  return out;
}

/**
 * FR-065 / FR-066 / BR-28: customer sign-off. Creates the machine (serial unique), warranty
 * (start = sign-off, months from the product or policy), PM schedule, training record; completes
 * the sales order; notifies sales and the customer. One atomic commit.
 */
export function signOffInstallation(actor: Actor, id: string, input: SignOffInput, expectedVersion: number): RecordData {
  if (!can(actor, 'install.signoff')) throw new ServiceError('forbidden', 'Your role cannot record customer sign-off.');
  const fieldErrors: Record<string, string> = {};
  if (!input.signedOffBy.trim()) fieldErrors.signedOffBy = 'Name of the customer representative is required';
  if (input.method === 'otp' && (!input.otp || input.otp.trim() !== otps.get(id))) fieldErrors.otp = 'The code does not match the one sent to the customer';
  if (input.method === 'signature' && !/^data:image\//.test(input.signatureData ?? '')) fieldErrors.signature = 'The customer must sign in the box';
  if (Object.keys(fieldErrors).length) throw new ServiceError('validation', 'Please complete the sign-off.', { fieldErrors });
  return commit((d) => {
    const raw = loadInstallation(d, actor, id);
    if (raw.version !== expectedVersion) throw new ServiceError('version_conflict', `Installation ${id} changed since you opened it. Reload and try again.`);
    const blockers = signOffBlockers(raw, d);
    if (blockers.length) throw new ServiceError('invalid_state', blockers.join('. '));
    const ctx = ctxFor(d, actor);
    const today = todayKey();
    const product = byId('products', raw.productId, d.records);
    const so = hasResource('salesOrders') ? byId('salesOrders', raw.salesOrderId, d.records) : undefined;
    const machine = insertRecordIn(ctx, 'machines', {
      serialNo: String(raw.serialNo).toUpperCase(),
      productId: raw.productId,
      model: String(product?.model ?? product?.name ?? ''),
      customerId: raw.customerId,
      siteAddressId: raw.siteAddressId ?? null,
      divisionId: raw.divisionId ?? product?.divisionId,
      printHeads: raw.printHeads ?? null,
      printWidth: raw.printWidth ?? null,
      softwareVersion: raw.softwareVersion ?? null,
      installDate: today,
      purchaseDate: so?.orderDate ?? null,
      salesOrderId: raw.salesOrderId ?? null,
      installationId: raw.id,
      status: 'active',
    });
    const months = Number(product?.warrantyMonths) || getPolicies().defaultWarrantyMonths;
    const end = addDays(addMonths(today, months), -1);
    insertRecordIn(ctx, 'warranties', { machineId: machine.id, customerId: machine.customerId, coverageType: 'parts_labour', startDate: today, endDate: end, divisionId: machine.divisionId, exclusions: 'Consumables, print-head damage from non-approved ink, physical damage and power surges.' });
    const pm = generatePmVisits(ctx, { machine, start: today, end, perYear: WARRANTY_PM_PER_YEAR });
    insertRecordIn(ctx, 'trainingRecords', {
      customerId: raw.customerId,
      machineId: machine.id,
      date: today,
      topics: raw.trainingTopics,
      trainees: raw.trainees,
      trainerId: raw.engineerId ?? actor.staffId,
      retrainingStatus: 'none',
      installationId: raw.id,
      divisionId: machine.divisionId,
    });
    const next = patchRecordIn(
      ctx,
      'installations',
      id,
      { status: 'signed_off', signedOffAt: nowLocal(), signOffMethod: input.method, signedOffBy: input.signedOffBy.trim(), signatureData: input.method === 'signature' ? input.signatureData : null, machineId: machine.id, serialNo: machine.serialNo },
      `Customer sign-off by ${input.signedOffBy.trim()} (${input.method === 'otp' ? 'OTP verified' : 'digital signature'})`,
    );
    otps.delete(id);
    if (so && !['completed', 'cancelled'].includes(String(so.status))) {
      patchRecordIn(ctx, 'salesOrders', String(so.id), { status: 'completed', completedAt: nowIso() }, `Completed after installation ${id} was signed off`);
      notifyStaff(ctx, so.ownerId, `${machine.serialNo} installed and signed off — order ${so.orderNo ?? so.id} completed`, { resource: 'machines', recordId: machine.id });
    }
    const r = customerRecipient(d, raw.customerId);
    queueMessage(ctx, {
      channel: r.channel,
      to: r.to,
      subject: `Installation completed — ${machine.model} ${machine.serialNo}`,
      body: `Thank you for signing off installation ${id}. Warranty runs from ${formatDate(today)} to ${formatDate(end)}. ${pm ? `${pm} preventive maintenance visit(s) are scheduled.` : ''} Your job card is attached.`,
      related: { resource: 'machines', recordId: machine.id },
    });
    appendAudit(d, actor, { action: 'install.signed_off', resource: 'installations', recordId: id, summary: `Signed off → machine ${machine.serialNo}, warranty to ${formatDate(end)}, ${pm} PM visit(s)`, correlationId: ctx.correlationId });
    return next;
  });
}

// ---------------------------------------------------------------- machines (IB-01 / IB-02 / IB-06)

export interface MoveInput {
  moveType: 'relocation' | 'resale';
  toCustomerId?: string;
  toSiteAddressId?: string | null;
  moveDate: string;
  reason: string;
}

/** IB-01 resale / relocation with history. Active contracts stay with the machine; their owners are told. */
export function moveMachine(actor: Actor, machineId: string, input: MoveInput) {
  if (!can(actor, 'machine.transfer')) throw new ServiceError('forbidden', 'Your role cannot relocate or transfer machines.');
  const fieldErrors: Record<string, string> = {};
  if (!input.reason.trim()) fieldErrors.reason = 'Reason is required';
  if (!input.moveDate) fieldErrors.moveDate = 'Effective date is required';
  else if (input.moveDate > todayKey()) fieldErrors.moveDate = 'Date cannot be in the future';
  return commit((d) => {
    const m = (d.records.machines ?? []).find((x) => x.id === machineId);
    const mres = getResource('machines');
    if (!m || !canReadRecord(actor, mres, m)) throw new ServiceError('not_found', `Machine ${machineId} was not found.`);
    if (!canUpdateRecord(actor, mres, m)) throw new ServiceError('forbidden', 'Your role cannot update this machine.');
    if (m.status === 'scrapped') throw new ServiceError('invalid_state', 'Scrapped machines cannot be moved.');
    const toCustomer = input.moveType === 'resale' ? input.toCustomerId : String(m.customerId);
    if (input.moveType === 'resale' && (!toCustomer || toCustomer === m.customerId)) fieldErrors.toCustomerId = 'Choose the new owner';
    if (input.moveType === 'relocation' && (!input.toSiteAddressId || input.toSiteAddressId === m.siteAddressId)) fieldErrors.toSiteAddressId = 'Choose the new site';
    const site = input.toSiteAddressId ? byId('addresses', input.toSiteAddressId, d.records) : undefined;
    if (site && site.customerId !== toCustomer) fieldErrors.toSiteAddressId = 'The site must belong to the owner';
    if (Object.keys(fieldErrors).length) throw new ServiceError('validation', 'Please fix the highlighted fields.', { fieldErrors });
    const ctx = ctxFor(d, actor);
    insertRecordIn(ctx, 'machineMoves', {
      machineId,
      moveType: input.moveType,
      moveDate: input.moveDate,
      fromCustomerId: m.customerId,
      toCustomerId: toCustomer,
      fromSiteAddressId: m.siteAddressId ?? null,
      toSiteAddressId: input.toSiteAddressId ?? null,
      reason: input.reason.trim(),
      divisionId: m.divisionId,
    });
    patchRecordIn(ctx, 'machines', machineId, { customerId: toCustomer, siteAddressId: input.toSiteAddressId ?? null, status: input.moveType === 'relocation' ? 'relocated' : 'active' }, `${input.moveType === 'resale' ? 'Resold' : 'Relocated'}: ${input.reason.trim()}`);
    if (input.moveType === 'resale') {
      (d.records.warranties ?? []).filter((w) => w.machineId === machineId).forEach((w) => patchRecordIn(ctx, 'warranties', w.id, { customerId: toCustomer }));
      (d.records.amcContracts ?? [])
        .filter((c) => c.machineId === machineId && ['active', 'due_for_renewal'].includes(String(c.status)))
        .forEach((c) => {
          // The contract follows the machine: transfer it to the new owner and tell its owners.
          patchRecordIn(ctx, 'amcContracts', c.id, { customerId: toCustomer }, `Transferred with ${m.serialNo} to the new owner`);
          notifyStaff(ctx, c.ownerId, `${m.serialNo} was resold — contract ${c.contractNo} transferred`, { resource: 'amcContracts', recordId: c.id });
          notifyStaff(ctx, c.serviceOwnerId, `${m.serialNo} was resold — contract ${c.contractNo} transferred`, { resource: 'amcContracts', recordId: c.id });
        });
    }
  });
}

/** IB-02: replace a serial-numbered component; the old one keeps its history. */
export function replaceComponent(actor: Actor, componentId: string, input: { newSerial: string; date: string; reason: string }) {
  const fieldErrors: Record<string, string> = {};
  const serial = input.newSerial.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9/-]{3,29}$/.test(serial)) fieldErrors.newSerial = 'Use 4–30 capital letters, digits, "-" or "/"';
  if (!input.date || input.date > todayKey()) fieldErrors.date = 'Enter a date up to today';
  if (!input.reason.trim()) fieldErrors.reason = 'Reason is required';
  if (Object.keys(fieldErrors).length) throw new ServiceError('validation', 'Please fix the highlighted fields.', { fieldErrors });
  return commit((d) => {
    const cres = getResource('machineComponents');
    const old = (d.records.machineComponents ?? []).find((c) => c.id === componentId);
    if (!old || !canReadRecord(actor, cres, old)) throw new ServiceError('not_found', 'Component not found.');
    if (!canUpdateRecord(actor, cres, old)) throw new ServiceError('forbidden', 'Your role cannot replace components.');
    if (old.status !== 'in_service') throw new ServiceError('invalid_state', 'This component was already replaced.');
    if ((d.records.machineComponents ?? []).some((c) => String(c.serialNo).toUpperCase() === serial)) throw new ServiceError('validation', 'That serial number is already recorded.', { fieldErrors: { newSerial: 'Already recorded on another component' } });
    if (input.date < String(old.installedAt)) throw new ServiceError('validation', 'Replacement date is before the part was fitted.', { fieldErrors: { date: 'Before the fitted date' } });
    const ctx = ctxFor(d, actor);
    const fresh = insertRecordIn(ctx, 'machineComponents', { machineId: old.machineId, componentType: old.componentType, position: old.position, serialNo: serial, installedAt: input.date, status: 'in_service', divisionId: old.divisionId });
    patchRecordIn(ctx, 'machineComponents', componentId, { status: 'replaced', replacedAt: input.date, replacedById: fresh.id, replacementReason: input.reason.trim() }, `Replaced by ${serial}: ${input.reason.trim()}`);
    return fresh;
  });
}

// ---------------------------------------------------------------- AMC / CMC (IB-04 / IB-05)

export function nextContractNo(d: HookContext['d']) {
  const key = `amcContracts:no:${fyCode()}`;
  d.counters[key] = (d.counters[key] ?? 0) + 1;
  return `AMC/${fyLabel()}/${String(d.counters[key]).padStart(4, '0')}`;
}

export function defaultSlaTerms(contractType: string) {
  const s = getPolicies().sla.critical[contractType] ?? getPolicies().sla.critical.none;
  return `Machine-down (critical) calls: response within ${s.response} h, engineer on site within ${s.arrival} h, resolution within ${s.resolution} h. ${contractType === 'cmc' ? 'Parts and labour included.' : 'Labour and preventive visits included; parts chargeable.'}`;
}

/** Renewal opportunity (IB-05) — created once, only when the opportunities module is installed. */
export function ensureRenewalOpportunity(ctx: HookContext, c: RecordData): string | null {
  if (c.renewalOpportunityId || !hasResource('opportunities')) return (c.renewalOpportunityId as string) ?? null;
  const machine = byId('machines', c.machineId, ctx.d.records);
  const customer = byId('customers', c.customerId, ctx.d.records);
  try {
    const opp = insertRecordIn(ctx, 'opportunities', {
      name: `${String(c.contractType).toUpperCase()} renewal – ${machine?.serialNo ?? c.machineId} – ${customer?.name ?? c.customerId}`,
      customerId: c.customerId,
      divisionId: c.divisionId,
      oppType: 'renewal',
      productId: machine?.productId ?? null,
      value: c.value,
      expectedCloseDate: c.endDate,
      stage: 'needs_assessment',
      probability: getPolicies().stageProbability.needs_assessment,
      ownerId: c.ownerId,
      machineId: c.machineId ?? null,
      amcContractId: c.id,
    });
    patchRecordIn(ctx, 'amcContracts', c.id, { renewalOpportunityId: opp.id }, `Renewal opportunity ${opp.id} created`);
    return opp.id;
  } catch (e) {
    appendAudit(ctx.d, ctx.actor, { action: 'renewal.opportunity_skipped', actorType: 'workflow', resource: 'amcContracts', recordId: c.id, summary: `Renewal opportunity not created: ${e instanceof Error ? e.message : 'unknown error'}`, correlationId: ctx.correlationId });
    return null;
  }
}

interface SweepPlan {
  remind: { id: string; threshold: number; daysLeft: number; mark: number[] }[];
  due: string[];
  expire: string[];
}

/** What the renewal sweep would change today (pure; lets callers skip the commit when nothing is due). */
export function planRenewalSweep(d = getDb()): SweepPlan {
  const today = todayKey();
  const days = [...getPolicies().renewalReminderDays].sort((a, b) => b - a);
  const window = days[0] ?? 90;
  const plan: SweepPlan = { remind: [], due: [], expire: [] };
  for (const c of d.records.amcContracts ?? []) {
    const status = String(c.status);
    if (!['active', 'due_for_renewal'].includes(status)) continue;
    const left = daysBetween(today, String(c.endDate));
    if (left < 0) {
      plan.expire.push(c.id);
      continue;
    }
    if (status === 'active' && left <= window) plan.due.push(c.id);
    const sent = new Set(String(c.remindersSent ?? '').split(',').filter(Boolean).map(Number));
    const reached = days.filter((x) => left <= x);
    const unsent = reached.filter((x) => !sent.has(x));
    if (unsent.length) plan.remind.push({ id: c.id, threshold: Math.min(...unsent), daysLeft: left, mark: [...new Set([...sent, ...reached])].sort((a, b) => b - a) });
  }
  return plan;
}

/**
 * IB-05 renewal sweep on the simulated clock: active → due for renewal inside the reminder window
 * (renewal opportunity created), one reminder per threshold (90 / 60 / 30 days) to sales and
 * service owners, and expired after the end date. Idempotent; commits only when something is due.
 */
export function runRenewalSweep(actor: Actor): number {
  const plan = planRenewalSweep();
  const n = plan.remind.length + plan.due.length + plan.expire.length;
  if (!n) return 0;
  commit((d) => {
    const ctx = ctxFor(d, actor);
    const find = (id: string) => (d.records.amcContracts ?? []).find((c) => c.id === id)!;
    plan.expire.forEach((id) => patchRecordIn(ctx, 'amcContracts', id, { status: 'expired' }, 'Expired automatically after the end date'));
    plan.due.forEach((id) => {
      patchRecordIn(ctx, 'amcContracts', id, { status: 'due_for_renewal' }, 'Due for renewal (reminder window reached)');
      ensureRenewalOpportunity(ctx, find(id));
    });
    plan.remind.forEach(({ id, threshold, daysLeft, mark }) => {
      const c = find(id);
      const title = `${c.contractNo} expires in ${daysLeft} day(s) — renewal due (${threshold}-day reminder)`;
      notifyStaff(ctx, c.ownerId, title, { resource: 'amcContracts', recordId: id });
      notifyStaff(ctx, c.serviceOwnerId, title, { resource: 'amcContracts', recordId: id });
      const r = customerRecipient(d, c.customerId);
      queueMessage(ctx, {
        channel: r.channel,
        to: r.to,
        subject: `Your ${masterLabel('amcType', c.contractType)} ${c.contractNo} expires on ${formatDate(String(c.endDate))}`,
        body: `Renew before ${formatDate(String(c.endDate))} to keep priority service and preventive visits. Current value ${formatMoney(Number(c.value))}. Reply to this message or call your service coordinator.`,
        related: { resource: 'amcContracts', recordId: id },
      });
      patchRecordIn(ctx, 'amcContracts', id, { remindersSent: mark.join(',') }, `${threshold}-day renewal reminder sent`);
    });
  });
  return n;
}

function loadContract(d: HookContext['d'], actor: Actor, id: string) {
  const cres = getResource('amcContracts');
  const c = (d.records.amcContracts ?? []).find((x) => x.id === id);
  if (!c || !canReadRecord(actor, cres, c)) throw new ServiceError('not_found', `Contract ${id} was not found.`);
  if (!can(actor, 'amc.renew') || !canUpdateRecord(actor, cres, c)) throw new ServiceError('forbidden', 'Your role cannot renew or close this contract.');
  return c;
}

export interface RenewInput {
  contractType: 'amc' | 'cmc';
  startDate: string;
  endDate: string;
  value: number;
  pmVisitsPerYear: number;
}

/** IB-05: renew — new active contract linked to the old one; PM visits generated; old → Renewed. */
export function renewContract(actor: Actor, id: string, input: RenewInput): RecordData {
  const fieldErrors: Record<string, string> = {};
  if (!input.startDate) fieldErrors.startDate = 'Start date is required';
  if (!input.endDate || input.endDate <= input.startDate) fieldErrors.endDate = 'End date must be after the start date';
  if (!(input.value > 0)) fieldErrors.value = 'Enter the renewal value';
  if (!(input.pmVisitsPerYear >= 0 && input.pmVisitsPerYear <= 12)) fieldErrors.pmVisitsPerYear = 'Between 0 and 12';
  if (Object.keys(fieldErrors).length) throw new ServiceError('validation', 'Please fix the highlighted fields.', { fieldErrors });
  return commit((d) => {
    const c = loadContract(d, actor, id);
    if (!['active', 'due_for_renewal', 'expired'].includes(String(c.status))) throw new ServiceError('invalid_state', `A ${masterLabel('amcStatus', c.status)} contract cannot be renewed.`);
    const ctx = ctxFor(d, actor);
    const fresh = insertRecordIn(ctx, 'amcContracts', {
      customerId: c.customerId,
      machineId: c.machineId,
      contractType: input.contractType,
      startDate: input.startDate,
      endDate: input.endDate,
      pmVisitsPerYear: input.pmVisitsPerYear,
      value: input.value,
      billingFrequency: c.billingFrequency ?? 'annual',
      slaTerms: defaultSlaTerms(input.contractType),
      ownerId: c.ownerId,
      serviceOwnerId: c.serviceOwnerId ?? null,
      status: 'active',
      renewalOfId: c.id,
    });
    patchRecordIn(ctx, 'amcContracts', id, { status: 'renewed', renewedById: fresh.id }, `Renewed as ${fresh.contractNo}`);
    const machine = byId('machines', c.machineId, d.records);
    if (machine) generatePmVisits(ctx, { machine, start: input.startDate, end: input.endDate, perYear: input.pmVisitsPerYear, amcContractId: fresh.id });
    const opp = c.renewalOpportunityId ? byId('opportunities', c.renewalOpportunityId, d.records) : undefined;
    if (opp && !['won', 'lost'].includes(String(opp.stage))) patchRecordIn(ctx, 'opportunities', opp.id, { stage: 'won', probability: 100, wonAt: nowIso() }, `Won: contract renewed as ${fresh.contractNo}`);
    return fresh;
  });
}

/** IB-05 lost renewal with a reason from the lost-reason master. */
export function markContractLost(actor: Actor, id: string, reason: string, note: string) {
  if (!reason) throw new ServiceError('validation', 'Choose a lost reason.', { fieldErrors: { lostReason: 'Required' } });
  commit((d) => {
    const c = loadContract(d, actor, id);
    if (!['active', 'due_for_renewal', 'expired'].includes(String(c.status))) throw new ServiceError('invalid_state', `A ${masterLabel('amcStatus', c.status)} contract cannot be marked lost.`);
    const ctx = ctxFor(d, actor);
    patchRecordIn(ctx, 'amcContracts', id, { status: 'lost', lostReason: reason }, `Renewal lost: ${masterLabel('lostReason', reason)}${note.trim() ? ` — ${note.trim()}` : ''}`);
    const opp = c.renewalOpportunityId ? byId('opportunities', c.renewalOpportunityId, d.records) : undefined;
    if (opp && !['won', 'lost'].includes(String(opp.stage))) patchRecordIn(ctx, 'opportunities', opp.id, { stage: 'lost', probability: 0, lostReason: reason }, `Lost: contract ${c.contractNo} not renewed`);
  });
}

/** Service leadership and coordinators of a division (re-training and escalation recipients). */
export function serviceDesk(divisionId: unknown, d = getDb()) {
  return [...employeesWithRole('service_head', undefined, d.records), ...employeesWithRole('coordinator', String(divisionId ?? '') || undefined, d.records)];
}

export const notifyStaffIn = notifyStaff;
