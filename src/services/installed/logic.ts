/**
 * Installed Base domain services (BRD 4.6 / 4.7). Synchronous engine-side logic; pages call the
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
import { L } from '../../constants/labels';

const S = L.installed.service;

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
  const name = String(customer?.name ?? customerId ?? S.customerFallback);
  if (best && best.consentWhatsapp && (best.whatsapp || best.mobile)) return { to: `${best.name} (+91 ${best.whatsapp || best.mobile})`, name, channel: 'whatsapp' };
  if (best && best.email) return { to: `${best.name} <${best.email}>`, name, channel: 'email' };
  return { to: S.noConsentContact(name), name, channel: 'email' };
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
  // Visits spread evenly over the period; the count follows its length (12 months × 2 / year = 2 visits),
  // the last visit falls on the end date at the latest.
  const span = daysBetween(opts.start, opts.end) + 1;
  if (span <= 0) return 0;
  const count = Math.max(1, Math.round((opts.perYear * span) / 365));
  const existing = new Set(recordsIn(ctx, 'pmVisits').filter((v) => v.machineId === opts.machine.id).map((v) => String(v.dueDate).slice(0, 7)));
  let n = 0;
  for (let i = 1; i <= count; i++) {
    const at = addDays(opts.start, Math.round((i * span) / count));
    const due = at > opts.end ? opts.end : at;
    if (existing.has(due.slice(0, 7))) continue;
    try {
      insertRecordIn(ctx, 'pmVisits', { machineId: opts.machine.id, customerId: opts.machine.customerId, amcContractId: opts.amcContractId ?? null, dueDate: due, status: 'due' });
      existing.add(due.slice(0, 7));
      n++;
    } catch (e) {
      appendAudit(ctx.d, ctx.actor, { action: 'pm.skipped', actorType: 'workflow', resource: 'machines', recordId: opts.machine.id, summary: S.pmSkipped(due, e instanceof Error ? e.message : S.unknownError), correlationId: ctx.correlationId });
      break;
    }
  }
  return n;
}

// ---------------------------------------------------------------- installation job (INS-03 … INS-07)

const res = () => getResource('installations');

function loadInstallation(d: HookContext['d'], actor: Actor, id: string, write = true) {
  const raw = (d.records.installations ?? []).find((r) => r.id === id);
  if (!raw || !canReadRecord(actor, res(), raw)) throw new ServiceError('not_found', S.installationNotFound(id));
  if (write && !canUpdateRecord(actor, res(), raw)) throw new ServiceError('forbidden', S.cannotUpdateInstallation);
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
    if (raw.status !== 'scheduled') throw new ServiceError('invalid_state', S.checklistBeforeVerify);
    const ctx = ctxFor(d, actor);
    const r = customerRecipient(d, raw.customerId);
    queueMessage(ctx, {
      channel: r.channel,
      to: r.to,
      subject: S.checklistSubject(id),
      body: S.checklistBody(READINESS_FIELDS.map(([, l]) => l).join('; ')),
      related: { resource: 'installations', recordId: id },
    });
    patchRecordIn(ctx, 'installations', id, { readinessSharedAt: nowLocal() }, S.checklistShared(r.name));
  });
}

export interface HandoverInput {
  hoExpectations: string;
  hoCommitments: string;
  hoKeyContacts: string;
}

const HANDOVER_MAX: Record<keyof HandoverInput, number> = { hoExpectations: 1000, hoCommitments: 1000, hoKeyContacts: 500 };

/** Sales owner of the job: owner of the sales order, else the customer's account owner. */
export function handoverOwnerId(r: RecordData, d = getDb()): string | null {
  const so = hasResource('salesOrders') ? byId('salesOrders', r.salesOrderId, d.records) : undefined;
  const id = so?.ownerId ?? byId('customers', r.customerId, d.records)?.ownerId;
  return id ? String(id) : null;
}

/** INS-04 / BR-26: the sales owner fills the handover; the service desk (update right) can too. */
export const canFillHandover = (actor: Actor, r: RecordData, d = getDb()) =>
  r.status !== 'signed_off' && canReadRecord(actor, res(), r) && (canUpdateRecord(actor, res(), r) || (!!actor.staffId && handoverOwnerId(r, d) === actor.staffId));

/** INS-04 Sales-to-Service handover form: customer expectations, special commitments, key contacts. */
export function saveHandover(actor: Actor, id: string, input: HandoverInput, expectedVersion: number): RecordData {
  const fieldErrors: Record<string, string> = {};
  (Object.keys(HANDOVER_MAX) as (keyof HandoverInput)[]).forEach((k) => {
    const v = String(input[k] ?? '').trim();
    if (!v) fieldErrors[k] = S.handoverRequired;
    else if (v.length > HANDOVER_MAX[k]) fieldErrors[k] = L.installed.validation.maxLength(HANDOVER_MAX[k]);
  });
  if (Object.keys(fieldErrors).length) throw new ServiceError('validation', S.handoverFix, { fieldErrors });
  return commit((d) => {
    const raw = (d.records.installations ?? []).find((r) => r.id === id);
    if (!raw || !canReadRecord(actor, res(), raw)) throw new ServiceError('not_found', S.installationNotFound(id));
    if (raw.status === 'signed_off') throw new ServiceError('invalid_state', S.handoverLocked);
    if (!canFillHandover(actor, raw, d)) throw new ServiceError('forbidden', S.handoverDenied);
    if (raw.version !== expectedVersion) throw new ServiceError('version_conflict', S.versionConflict(id));
    return patchRecordIn(
      ctxFor(d, actor),
      'installations',
      id,
      { hoExpectations: input.hoExpectations.trim(), hoCommitments: input.hoCommitments.trim(), hoKeyContacts: input.hoKeyContacts.trim(), handoverAt: raw.handoverAt || nowLocal() },
      S.handoverAudit,
    );
  });
}

/** COM-04 file metadata only: names and sizes, size limit from policy. */
export function attachInstallationMedia(actor: Actor, id: string, files: { name: string; size: number }[]) {
  const max = getPolicies().maxFileMb;
  const tooBig = files.filter((f) => f.size > max * 1024 * 1024);
  if (tooBig.length) throw new ServiceError('validation', S.tooLarge(tooBig.map((f) => f.name).join(', '), tooBig.length > 1, max));
  if (!files.length) return;
  commit((d) => {
    const raw = loadInstallation(d, actor, id);
    if (raw.status === 'signed_off') throw new ServiceError('invalid_state', S.jobCardLocked);
    const names = [String(raw.mediaFiles ?? ''), ...files.map((f) => f.name)].filter(Boolean).join(', ');
    patchRecordIn(ctxFor(d, actor), 'installations', id, { mediaFiles: names.slice(0, 2000) }, S.attached(files.length));
  });
}

const otps = new Map<string, string>();

/** FR-065: simulated OTP to the customer's mobile; returns the code so the UI can show it. */
export function startSignOffOtp(actor: Actor, id: string): string {
  const code = String(100000 + Math.floor(Math.random() * 900000));
  commit((d) => {
    const raw = loadInstallation(d, actor, id);
    if (raw.status !== 'trial_training') throw new ServiceError('invalid_state', S.signOffAfterTrial);
    const ctx = ctxFor(d, actor);
    const r = customerRecipient(d, raw.customerId);
    queueMessage(ctx, { channel: 'sms', to: r.to, body: S.otpSms(id, code), related: { resource: 'installations', recordId: id } });
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
  if (r.status !== 'trial_training') out.push(S.blockerStatus);
  if (!r.productId) out.push(S.blockerProduct);
  if (!r.serialNo) out.push(S.blockerSerial);
  else if ((d.records.machines ?? []).some((m) => String(m.serialNo).toUpperCase() === String(r.serialNo).toUpperCase())) out.push(S.serialExists(String(r.serialNo)));
  if (!String(r.trialResults ?? '').trim()) out.push(S.blockerTrial);
  if (!((r.trainingTopics as string[] | undefined) ?? []).length) out.push(S.blockerTopics);
  if (!String(r.trainees ?? '').trim()) out.push(S.blockerTrainees);
  const steps = missingSteps(r);
  if (steps.length) out.push(S.blockerSteps(steps.map((s) => masterLabel('installStep', s)).join(', ')));
  return out;
}

/**
 * FR-065 / FR-066 / BR-28: customer sign-off. Creates the machine (serial unique), warranty
 * (start = sign-off, months from the product or policy), PM schedule, training record; completes
 * the sales order; notifies sales and the customer. One atomic commit.
 */
export function signOffInstallation(actor: Actor, id: string, input: SignOffInput, expectedVersion: number): RecordData {
  if (!can(actor, 'install.signoff')) throw new ServiceError('forbidden', S.noSignOffRole);
  const fieldErrors: Record<string, string> = {};
  if (!input.signedOffBy.trim()) fieldErrors.signedOffBy = S.representativeRequired;
  if (input.method === 'otp' && (!input.otp || input.otp.trim() !== otps.get(id))) fieldErrors.otp = S.otpMismatch;
  if (input.method === 'signature' && !/^data:image\//.test(input.signatureData ?? '')) fieldErrors.signature = S.signatureRequired;
  if (Object.keys(fieldErrors).length) throw new ServiceError('validation', S.completeSignOff, { fieldErrors });
  return commit((d) => {
    const raw = loadInstallation(d, actor, id);
    if (raw.version !== expectedVersion) throw new ServiceError('version_conflict', S.versionConflict(id));
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
    insertRecordIn(ctx, 'warranties', { machineId: machine.id, customerId: machine.customerId, coverageType: 'parts_labour', startDate: today, endDate: end, divisionId: machine.divisionId, exclusions: S.warrantyExclusions });
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
      S.signOffAudit(input.method, input.signedOffBy.trim()),
    );
    otps.delete(id);
    if (so && !['completed', 'cancelled'].includes(String(so.status))) {
      patchRecordIn(ctx, 'salesOrders', String(so.id), { status: 'completed', completedAt: nowIso() }, S.soCompleted(id));
      notifyStaff(ctx, so.ownerId, S.soCompletedNotice(String(machine.serialNo), String(so.orderNo ?? so.id)), { resource: 'machines', recordId: machine.id });
    }
    const r = customerRecipient(d, raw.customerId);
    queueMessage(ctx, {
      channel: r.channel,
      to: r.to,
      subject: S.completedSubject(String(machine.model), String(machine.serialNo)),
      body: S.completedBody(id, formatDate(today), formatDate(end), pm),
      related: { resource: 'machines', recordId: machine.id },
    });
    appendAudit(d, actor, { action: 'install.signed_off', resource: 'installations', recordId: id, summary: S.signOffSummary(String(machine.serialNo), formatDate(end), pm), correlationId: ctx.correlationId });
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
  if (!can(actor, 'machine.transfer')) throw new ServiceError('forbidden', S.noTransferRole);
  const fieldErrors: Record<string, string> = {};
  if (!input.reason.trim()) fieldErrors.reason = S.reasonRequired;
  if (!input.moveDate) fieldErrors.moveDate = S.effectiveRequired;
  else if (input.moveDate > todayKey()) fieldErrors.moveDate = S.noFuture;
  return commit((d) => {
    const m = (d.records.machines ?? []).find((x) => x.id === machineId);
    const mres = getResource('machines');
    if (!m || !canReadRecord(actor, mres, m)) throw new ServiceError('not_found', S.machineNotFound(machineId));
    if (!canUpdateRecord(actor, mres, m)) throw new ServiceError('forbidden', S.cannotUpdateMachine);
    if (m.status === 'scrapped') throw new ServiceError('invalid_state', S.scrappedNoMove);
    const toCustomer = input.moveType === 'resale' ? input.toCustomerId : String(m.customerId);
    if (input.moveType === 'resale' && (!toCustomer || toCustomer === m.customerId)) fieldErrors.toCustomerId = S.chooseNewOwner;
    if (input.moveType === 'relocation' && (!input.toSiteAddressId || input.toSiteAddressId === m.siteAddressId)) fieldErrors.toSiteAddressId = S.chooseNewSite;
    const site = input.toSiteAddressId ? byId('addresses', input.toSiteAddressId, d.records) : undefined;
    if (site && site.customerId !== toCustomer) fieldErrors.toSiteAddressId = S.siteOfOwner;
    if (Object.keys(fieldErrors).length) throw new ServiceError('validation', S.fixFields, { fieldErrors });
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
    patchRecordIn(ctx, 'machines', machineId, { customerId: toCustomer, siteAddressId: input.toSiteAddressId ?? null, status: input.moveType === 'relocation' ? 'relocated' : 'active' }, S.moveAudit(input.moveType === 'resale', input.reason.trim()));
    if (input.moveType === 'resale') {
      (d.records.warranties ?? []).filter((w) => w.machineId === machineId).forEach((w) => patchRecordIn(ctx, 'warranties', w.id, { customerId: toCustomer }));
      (d.records.amcContracts ?? [])
        .filter((c) => c.machineId === machineId && ['active', 'due_for_renewal'].includes(String(c.status)))
        .forEach((c) => {
          // The contract follows the machine: transfer it to the new owner and tell its owners.
          patchRecordIn(ctx, 'amcContracts', c.id, { customerId: toCustomer }, S.contractTransferred(String(m.serialNo)));
          notifyStaff(ctx, c.ownerId, S.resoldNotice(String(m.serialNo), String(c.contractNo)), { resource: 'amcContracts', recordId: c.id });
          notifyStaff(ctx, c.serviceOwnerId, S.resoldNotice(String(m.serialNo), String(c.contractNo)), { resource: 'amcContracts', recordId: c.id });
        });
    }
  });
}

/** IB-02: replace a serial-numbered component; the old one keeps its history. */
export function replaceComponent(actor: Actor, componentId: string, input: { newSerial: string; date: string; reason: string }) {
  const fieldErrors: Record<string, string> = {};
  const serial = input.newSerial.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9/-]{3,29}$/.test(serial)) fieldErrors.newSerial = L.installed.validation.serial;
  if (!input.date || input.date > todayKey()) fieldErrors.date = S.dateUpToToday;
  if (!input.reason.trim()) fieldErrors.reason = S.reasonRequired;
  if (Object.keys(fieldErrors).length) throw new ServiceError('validation', S.fixFields, { fieldErrors });
  return commit((d) => {
    const cres = getResource('machineComponents');
    const old = (d.records.machineComponents ?? []).find((c) => c.id === componentId);
    if (!old || !canReadRecord(actor, cres, old)) throw new ServiceError('not_found', S.componentNotFound);
    if (!canUpdateRecord(actor, cres, old)) throw new ServiceError('forbidden', S.cannotReplace);
    if (old.status !== 'in_service') throw new ServiceError('invalid_state', S.alreadyReplaced);
    if ((d.records.machineComponents ?? []).some((c) => String(c.serialNo).toUpperCase() === serial)) throw new ServiceError('validation', S.serialRecorded, { fieldErrors: { newSerial: S.serialOnOther } });
    if (input.date < String(old.installedAt)) throw new ServiceError('validation', S.beforeFitted, { fieldErrors: { date: S.beforeFittedShort } });
    const ctx = ctxFor(d, actor);
    const fresh = insertRecordIn(ctx, 'machineComponents', { machineId: old.machineId, componentType: old.componentType, position: old.position, serialNo: serial, installedAt: input.date, status: 'in_service', divisionId: old.divisionId });
    patchRecordIn(ctx, 'machineComponents', componentId, { status: 'replaced', replacedAt: input.date, replacedById: fresh.id, replacementReason: input.reason.trim() }, S.replacedBy(serial, input.reason.trim()));
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
  return S.slaTerms(s.response, s.arrival, s.resolution, contractType === 'cmc');
}

/** Renewal opportunity (IB-05) — created once, only when the opportunities module is installed. */
export function ensureRenewalOpportunity(ctx: HookContext, c: RecordData): string | null {
  if (c.renewalOpportunityId || !hasResource('opportunities')) return (c.renewalOpportunityId as string) ?? null;
  const machine = byId('machines', c.machineId, ctx.d.records);
  const customer = byId('customers', c.customerId, ctx.d.records);
  try {
    const opp = insertRecordIn(ctx, 'opportunities', {
      name: S.renewalOppName(String(c.contractType).toUpperCase(), String(machine?.serialNo ?? c.machineId), String(customer?.name ?? c.customerId)),
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
    patchRecordIn(ctx, 'amcContracts', c.id, { renewalOpportunityId: opp.id }, S.renewalOppCreated(opp.id));
    return opp.id;
  } catch (e) {
    appendAudit(ctx.d, ctx.actor, { action: 'renewal.opportunity_skipped', actorType: 'workflow', resource: 'amcContracts', recordId: c.id, summary: S.renewalOppSkipped(e instanceof Error ? e.message : S.unknownError), correlationId: ctx.correlationId });
    return null;
  }
}

interface SweepPlan {
  remind: { id: string; threshold: number; daysLeft: number; mark: number[] }[];
  due: string[];
  expire: string[];
  /** Draft contracts whose start date has come (D7: activated automatically). */
  activate: string[];
  /** Warranties ending inside the reminder window with no AMC / CMC to follow (IB-05). */
  warranty: { id: string; threshold: number; daysLeft: number; mark: number[] }[];
}

const OPEN_CONTRACT = ['draft', 'active', 'due_for_renewal'];
const thresholdsDue = (sentRaw: unknown, left: number, days: number[]) => {
  const sent = new Set(String(sentRaw ?? '').split(',').filter(Boolean).map(Number));
  const reached = days.filter((x) => left <= x);
  const unsent = reached.filter((x) => !sent.has(x));
  return unsent.length ? { threshold: Math.min(...unsent), mark: [...new Set([...sent, ...reached])].sort((a, b) => b - a) } : null;
};

/** What the renewal sweep would change today (pure; lets callers skip the commit when nothing is due). */
export function planRenewalSweep(d = getDb()): SweepPlan {
  const today = todayKey();
  const days = [...getPolicies().renewalReminderDays].sort((a, b) => b - a);
  const window = days[0] ?? 90;
  const plan: SweepPlan = { remind: [], due: [], expire: [], activate: [], warranty: [] };
  const contracts = d.records.amcContracts ?? [];
  for (const c of contracts) {
    const status = String(c.status);
    if (status === 'draft') {
      if (String(c.startDate) <= today && String(c.endDate) >= today && Number(c.value) > 0) plan.activate.push(c.id);
      continue;
    }
    if (!['active', 'due_for_renewal'].includes(status)) continue;
    const left = daysBetween(today, String(c.endDate));
    if (left < 0) {
      plan.expire.push(c.id);
      continue;
    }
    if (status === 'active' && left <= window) plan.due.push(c.id);
    const r = thresholdsDue(c.remindersSent, left, days);
    if (r) plan.remind.push({ id: c.id, daysLeft: left, ...r });
  }
  for (const w of d.records.warranties ?? []) {
    const left = daysBetween(today, String(w.endDate));
    if (left < 0 || left > window) continue;
    const machine = (d.records.machines ?? []).find((m) => m.id === w.machineId);
    if (!machine || machine.status === 'scrapped') continue;
    // A contract that runs past the warranty end already follows it.
    if (contracts.some((c) => c.machineId === w.machineId && OPEN_CONTRACT.includes(String(c.status)) && String(c.endDate) > String(w.endDate))) continue;
    const r = thresholdsDue(w.remindersSent, left, days);
    if (r) plan.warranty.push({ id: w.id, daysLeft: left, ...r });
  }
  return plan;
}

/** IB-05: AMC / CMC opportunity for a machine whose warranty ends with no contract to follow (created once). */
function ensureWarrantyOpportunity(ctx: HookContext, w: RecordData): string | null {
  if (w.renewalOpportunityId || !hasResource('opportunities')) return (w.renewalOpportunityId as string) ?? null;
  const machine = byId('machines', w.machineId, ctx.d.records);
  const customer = byId('customers', w.customerId ?? machine?.customerId, ctx.d.records);
  const so = machine?.salesOrderId && hasResource('salesOrders') ? byId('salesOrders', machine.salesOrderId, ctx.d.records) : undefined;
  const ownerId = customer?.ownerId ?? so?.ownerId;
  // Estimated value: average AMC / CMC value for the same model, else 0 (sales fills it in).
  const sameModel = (ctx.d.records.amcContracts ?? []).filter((c) => byId('machines', c.machineId, ctx.d.records)?.model === machine?.model && Number(c.value) > 0);
  const value = sameModel.length ? Math.round(sameModel.reduce((a, c) => a + Number(c.value), 0) / sameModel.length) : 0;
  try {
    const opp = insertRecordIn(ctx, 'opportunities', {
      name: S.warrantyOppName(String(machine?.serialNo ?? w.machineId), String(customer?.name ?? w.customerId)),
      customerId: customer?.id ?? w.customerId,
      divisionId: w.divisionId ?? machine?.divisionId,
      oppType: 'amc',
      productId: machine?.productId ?? null,
      value,
      expectedCloseDate: w.endDate,
      stage: 'needs_assessment',
      probability: getPolicies().stageProbability.needs_assessment,
      ownerId,
      machineId: w.machineId ?? null,
    });
    patchRecordIn(ctx, 'warranties', w.id, { renewalOpportunityId: opp.id }, S.warrantyOppCreated(opp.id));
    return opp.id;
  } catch (e) {
    appendAudit(ctx.d, ctx.actor, { action: 'renewal.opportunity_skipped', actorType: 'workflow', resource: 'warranties', recordId: w.id, summary: S.renewalOppSkipped(e instanceof Error ? e.message : S.unknownError), correlationId: ctx.correlationId });
    return null;
  }
}

/**
 * IB-05 renewal sweep on the simulated clock: draft contracts start on their start date (PM visits
 * generated), active → due for renewal inside the reminder window (renewal opportunity created), one
 * reminder per threshold (90 / 60 / 30 days) to sales and service owners, expired after the end date;
 * warranties ending with no contract to follow get the same reminders and one AMC / CMC opportunity.
 * Idempotent; commits only when something is due.
 */
export function runRenewalSweep(actor: Actor): number {
  const plan = planRenewalSweep();
  const n = plan.remind.length + plan.due.length + plan.expire.length + plan.activate.length + plan.warranty.length;
  if (!n) return 0;
  commit((d) => {
    const ctx = ctxFor(d, actor);
    const find = (id: string) => (d.records.amcContracts ?? []).find((c) => c.id === id)!;
    plan.activate.forEach((id) => {
      const c = patchRecordIn(ctx, 'amcContracts', id, { status: 'active' }, S.activatedAuto);
      const m = byId('machines', c.machineId, d.records);
      if (m) generatePmVisits(ctx, { machine: m, start: String(c.startDate), end: String(c.endDate), perYear: Number(c.pmVisitsPerYear) || 0, amcContractId: c.id });
    });
    plan.expire.forEach((id) => patchRecordIn(ctx, 'amcContracts', id, { status: 'expired' }, S.expiredAuto));
    plan.due.forEach((id) => {
      patchRecordIn(ctx, 'amcContracts', id, { status: 'due_for_renewal' }, S.dueAuto);
      ensureRenewalOpportunity(ctx, find(id));
    });
    plan.remind.forEach(({ id, threshold, daysLeft, mark }) => {
      const c = find(id);
      const title = S.reminderTitle(String(c.contractNo), daysLeft, threshold);
      notifyStaff(ctx, c.ownerId, title, { resource: 'amcContracts', recordId: id });
      notifyStaff(ctx, c.serviceOwnerId, title, { resource: 'amcContracts', recordId: id });
      const r = customerRecipient(d, c.customerId);
      queueMessage(ctx, {
        channel: r.channel,
        to: r.to,
        subject: S.reminderSubject(masterLabel('amcType', c.contractType), String(c.contractNo), formatDate(String(c.endDate))),
        body: S.reminderBody(formatDate(String(c.endDate)), formatMoney(Number(c.value))),
        related: { resource: 'amcContracts', recordId: id },
      });
      patchRecordIn(ctx, 'amcContracts', id, { remindersSent: mark.join(',') }, S.reminderSent(threshold));
    });
    plan.warranty.forEach(({ id, threshold, daysLeft, mark }) => {
      const w = (d.records.warranties ?? []).find((x) => x.id === id)!;
      const machine = byId('machines', w.machineId, d.records);
      const customer = byId('customers', w.customerId ?? machine?.customerId, d.records);
      const serial = String(machine?.serialNo ?? w.machineId);
      const title = S.warrantyReminderTitle(serial, daysLeft, threshold);
      const link = { resource: 'warranties', recordId: id };
      notifyStaff(ctx, customer?.ownerId, title, link);
      serviceDesk(w.divisionId ?? machine?.divisionId, d).forEach((e) => notifyStaff(ctx, e.id, title, link));
      const r = customerRecipient(d, customer?.id ?? w.customerId);
      queueMessage(ctx, { channel: r.channel, to: r.to, subject: S.warrantyReminderSubject(serial, formatDate(String(w.endDate))), body: S.warrantyReminderBody(formatDate(String(w.endDate))), related: link });
      patchRecordIn(ctx, 'warranties', id, { remindersSent: mark.join(',') }, S.warrantyReminderSent(threshold));
      ensureWarrantyOpportunity(ctx, (d.records.warranties ?? []).find((x) => x.id === id)!);
    });
  });
  return n;
}

function loadContract(d: HookContext['d'], actor: Actor, id: string) {
  const cres = getResource('amcContracts');
  const c = (d.records.amcContracts ?? []).find((x) => x.id === id);
  if (!c || !canReadRecord(actor, cres, c)) throw new ServiceError('not_found', S.contractNotFound(id));
  if (!can(actor, 'amc.renew') || !canUpdateRecord(actor, cres, c)) throw new ServiceError('forbidden', S.cannotRenew);
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
  if (!input.startDate) fieldErrors.startDate = S.startRequired;
  if (!input.endDate || input.endDate <= input.startDate) fieldErrors.endDate = L.installed.validation.endAfterStart;
  if (!(input.value > 0)) fieldErrors.value = S.enterRenewalValue;
  if (!(input.pmVisitsPerYear >= 0 && input.pmVisitsPerYear <= 12)) fieldErrors.pmVisitsPerYear = S.visitsRange;
  if (Object.keys(fieldErrors).length) throw new ServiceError('validation', S.fixFields, { fieldErrors });
  return commit((d) => {
    const c = loadContract(d, actor, id);
    if (!['active', 'due_for_renewal', 'expired'].includes(String(c.status))) throw new ServiceError('invalid_state', S.cannotRenewStatus(masterLabel('amcStatus', c.status)));
    // A renewal continues the contract: it cannot start before the current one, nor be over already.
    const dateErrors: Record<string, string> = {};
    if (input.startDate <= String(c.startDate)) dateErrors.startDate = S.renewStartAfterOld(formatDate(String(c.startDate)));
    if (input.endDate < todayKey()) dateErrors.endDate = S.renewEndPassed;
    if (Object.keys(dateErrors).length) throw new ServiceError('validation', S.fixFields, { fieldErrors: dateErrors });
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
    patchRecordIn(ctx, 'amcContracts', id, { status: 'renewed', renewedById: fresh.id }, S.renewedAs(String(fresh.contractNo)));
    const machine = byId('machines', c.machineId, d.records);
    if (machine) generatePmVisits(ctx, { machine, start: input.startDate, end: input.endDate, perYear: input.pmVisitsPerYear, amcContractId: fresh.id });
    const opp = c.renewalOpportunityId ? byId('opportunities', c.renewalOpportunityId, d.records) : undefined;
    if (opp && !['won', 'lost'].includes(String(opp.stage))) patchRecordIn(ctx, 'opportunities', opp.id, { stage: 'won', probability: 100, wonAt: nowIso() }, S.oppWon(String(fresh.contractNo)));
    return fresh;
  });
}

/** IB-05 lost renewal with a reason from the lost-reason master. */
export function markContractLost(actor: Actor, id: string, reason: string, note: string) {
  if (!reason) throw new ServiceError('validation', S.chooseLostReason, { fieldErrors: { lostReason: S.required } });
  commit((d) => {
    const c = loadContract(d, actor, id);
    if (!['active', 'due_for_renewal', 'expired'].includes(String(c.status))) throw new ServiceError('invalid_state', S.cannotLoseStatus(masterLabel('amcStatus', c.status)));
    const ctx = ctxFor(d, actor);
    patchRecordIn(ctx, 'amcContracts', id, { status: 'lost', lostReason: reason }, S.lostAudit(masterLabel('lostReason', reason), note.trim()));
    const opp = c.renewalOpportunityId ? byId('opportunities', c.renewalOpportunityId, d.records) : undefined;
    if (opp && !['won', 'lost'].includes(String(opp.stage))) patchRecordIn(ctx, 'opportunities', opp.id, { stage: 'lost', probability: 0, lostReason: reason }, S.oppLost(String(c.contractNo)));
  });
}

/**
 * IB-05 "Create Renewal Quotation": makes sure the contract has its renewal opportunity (creates it
 * when the reminder sweep has not yet) and returns its id; the quotation editor opens on it.
 */
export function prepareRenewalQuotation(actor: Actor, id: string): string {
  if (!hasResource('opportunities') || !hasResource('quotations')) throw new ServiceError('invalid_state', S.noOpportunities);
  return commit((d) => {
    const c = loadContract(d, actor, id);
    if (!['active', 'due_for_renewal', 'expired'].includes(String(c.status))) throw new ServiceError('invalid_state', S.quotationOnlyOpen);
    const oppId = ensureRenewalOpportunity(ctxFor(d, actor), c);
    if (!oppId) throw new ServiceError('invalid_state', S.noOpportunities);
    return oppId;
  });
}

/** Service leadership and coordinators of a division (re-training and escalation recipients). */
export function serviceDesk(divisionId: unknown, d = getDb()) {
  return [...employeesWithRole('service_head', undefined, d.records), ...employeesWithRole('coordinator', String(divisionId ?? '') || undefined, d.records)];
}

export const notifyStaffIn = notifyStaff;
