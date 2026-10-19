/**
 * Engineer field flow (FR-080, SRV-06): accept → start travel → geo check-in → diagnosis / work /
 * parts / photos / readings → check-out with customer sign-off (on-screen OTP or signature).
 * Each step is one service call so the page can queue it while offline (runOrQueue, NFR-15);
 * steps carry the ticket version seen on screen, so a replay after a conflicting change fails loudly.
 */
import { nowLocal } from '../../lib/dates';
import { uid } from '../../lib/ids';
import type { RecordData } from '../../metadata/types';
import { type Actor, can } from '../authz';
import { commit, getDb } from '../db';
import type { HookContext } from '../resourceHooks';
import { insertRecordIn, patchRecordIn, queryRecords, transitionRecord } from '../runtime';
import { masterLabel } from '../registry';
import { ServiceError } from '../types';
import { chargeableBlocker, OPEN_STATUSES } from './tickets';
import { L } from '../../constants/labels';

const E = L.service.errors;
const A = L.service.audit;

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export const visitsOf = (ticketId: string): RecordData[] => (getDb().records.serviceVisits ?? []).filter((v) => v.ticketId === ticketId).sort((a, b) => s(b.createdAt).localeCompare(s(a.createdAt)));
export const openVisitOf = (ticketId: string) => visitsOf(ticketId).find((v) => v.status !== 'completed' && v.visitType !== 'remote');

/** Statuses in which the engineer can check in at the site (Accept first; not after resolution). */
const CHECK_IN_STATUSES = ['assigned', 'accepted', 'reopened', 'in_progress', 'waiting_parts', 'waiting_customer'];
const statusLabel = (v: unknown) => masterLabel('ticketStatus', v);

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Jobs assigned to the signed-in engineer, most urgent first. */
export function myJobs(actor: Actor) {
  const tickets = queryRecords(actor, 'tickets', { where: { assigneeId: actor.staffId } })
    .rows.filter((t) => OPEN_STATUSES.includes(s(t.status)) || t.status === 'customer_confirmation')
    .sort((a, b) => (PRIORITY_RANK[s(a.priority)] ?? 9) - (PRIORITY_RANK[s(b.priority)] ?? 9) || s(a.resolutionDueAt).localeCompare(s(b.resolutionDueAt)));
  const pm = queryRecords(actor, 'pmVisits', { where: { engineerId: actor.staffId } })
    .rows.filter((p) => p.status === 'due' || p.status === 'overdue')
    .sort((a, b) => s(a.dueDate).localeCompare(s(b.dueDate)));
  return { tickets, pm };
}

function jobCommit<T>(actor: Actor, ticketId: string, expectedVersion: number | undefined, fn: (ctx: HookContext, t: RecordData) => T): T {
  return commit((d) => {
    const t = (d.records.tickets ?? []).find((x) => x.id === ticketId);
    if (!t) throw new ServiceError('not_found', E.notFound(ticketId));
    if (t.assigneeId !== actor.staffId && !can(actor, 'ticket.assign')) throw new ServiceError('forbidden', E.onlyAssigneeJobCard);
    if (expectedVersion !== undefined && t.version !== expectedVersion) throw new ServiceError('version_conflict', E.versionConflict(ticketId, t.version));
    return fn({ d, actor, correlationId: uid('cor') }, t);
  });
}

export const acceptJob = (actor: Actor, id: string, version: number) => transitionRecord(actor, 'tickets', id, 'accepted', version);
export const rejectJob = (actor: Actor, id: string, version: number) => transitionRecord(actor, 'tickets', id, 'open', version);
export const setWaiting = (actor: Actor, id: string, version: number, to: 'waiting_parts' | 'waiting_customer' | 'in_progress') => transitionRecord(actor, 'tickets', id, to, version);

export function startTravel(actor: Actor, id: string, version?: number) {
  return jobCommit(actor, id, version, (ctx, t) => {
    if (!['accepted', 'reopened', 'in_progress', 'waiting_parts'].includes(s(t.status))) throw new ServiceError('invalid_state', E.acceptBeforeTravel);
    if (openVisitOf(t.id)) throw new ServiceError('invalid_state', E.visitInProgress);
    return insertRecordIn(ctx, 'serviceVisits', { ticketId: t.id, engineerId: actor.staffId, visitType: 'site', status: 'travelling', travelStartAt: nowLocal() });
  });
}

export function checkIn(actor: Actor, id: string, at: { lat: number; lng: number; mock: boolean }, version?: number) {
  return jobCommit(actor, id, version, (ctx, t) => {
    if (!CHECK_IN_STATUSES.includes(s(t.status))) throw new ServiceError('invalid_state', E.checkInClosed(statusLabel(t.status)));
    const now = nowLocal();
    const visit = openVisitOf(t.id) ?? insertRecordIn(ctx, 'serviceVisits', { ticketId: t.id, engineerId: actor.staffId, visitType: 'site', status: 'travelling', travelStartAt: now });
    patchRecordIn(ctx, 'serviceVisits', visit.id, { status: 'on_site', checkInAt: now, checkInLat: Math.round(at.lat * 1e5) / 1e5, checkInLng: Math.round(at.lng * 1e5) / 1e5, checkInMock: at.mock }, A.checkedIn(at.mock));
    const patch: Record<string, unknown> = { arrivedAt: t.arrivedAt || now, respondedAt: t.respondedAt || now };
    // Arriving on site starts (or, with the parts, resumes) the work; Waiting for Customer is left to Resume Work so the SLA pause is closed properly.
    if (['accepted', 'reopened', 'assigned', 'waiting_parts'].includes(s(t.status))) patch.status = 'in_progress';
    return patchRecordIn(ctx, 'tickets', t.id, patch, A.arrived);
  });
}

export interface WorkInput {
  diagnosis: string;
  workDone: string;
  partsUsed: string;
  photosBefore: string;
  photosAfter: string;
  printCounter?: number | null;
  inkUsedMl?: number | null;
}

export function saveWork(actor: Actor, id: string, w: WorkInput, version?: number) {
  return jobCommit(actor, id, version, (ctx, t) => {
    const visit = openVisitOf(t.id);
    if (!visit || visit.status !== 'on_site') throw new ServiceError('invalid_state', E.checkInFirstWork);
    if (w.printCounter !== null && w.printCounter !== undefined && w.printCounter < 0) throw new ServiceError('validation', E.readingsNegative, { fieldErrors: { printCounter: E.mustBeZeroOrMore } });
    patchRecordIn(ctx, 'serviceVisits', visit.id, { diagnosis: w.diagnosis.trim(), workDone: w.workDone.trim(), partsUsed: w.partsUsed.trim(), photosBefore: w.photosBefore, photosAfter: w.photosAfter, printCounter: w.printCounter ?? null, inkUsedMl: w.inkUsedMl ?? null }, A.jobCardUpdated);
    return w.workDone.trim() ? patchRecordIn(ctx, 'tickets', t.id, { resolution: w.workDone.trim() }, A.workFromJobCard) : t;
  });
}

// One-time codes for customer sign-off live only in memory (they are shown on screen in this prototype).
const otps = new Map<string, string>();
export function requestSignOffOtp(ticketId: string) {
  const code = String(100000 + Math.floor(Math.random() * 900000));
  otps.set(ticketId, code);
  return code;
}

/** Check-out with customer sign-off; `resolve` also moves the ticket to Resolved (job card + feedback link sent). */
export function checkOut(actor: Actor, id: string, input: { method: 'otp' | 'signature'; otp?: string; signed?: boolean; resolve: boolean }, version?: number) {
  if (input.method === 'otp' && (!input.otp || otps.get(id) !== input.otp.trim())) throw new ServiceError('validation', E.otpMismatch, { fieldErrors: { otp: E.otpField } });
  if (input.method === 'signature' && !input.signed) throw new ServiceError('validation', E.signatureMissing, { fieldErrors: { signature: E.signatureField } });
  const updated = jobCommit(actor, id, version, (ctx, t) => {
    const visit = openVisitOf(t.id);
    if (!visit || visit.status !== 'on_site') throw new ServiceError('invalid_state', E.checkInFirst);
    if (input.resolve) {
      if (t.status !== 'in_progress') throw new ServiceError('invalid_state', E.resolveNeedsInProgress(statusLabel(t.status)));
      if (!s(t.resolution).trim() && !s(visit.workDone).trim()) throw new ServiceError('validation', E.workPerformedRequired, { fieldErrors: { workDone: E.requiredToResolve } });
      const block = chargeableBlocker(t);
      if (block) throw new ServiceError('invalid_state', block);
    }
    const now = nowLocal();
    patchRecordIn(ctx, 'serviceVisits', visit.id, { status: 'completed', checkOutAt: now, signOffMethod: input.method, signedOffAt: now }, A.checkedOut(L.service.masters.signOffMethod.values[input.method]));
    return patchRecordIn(ctx, 'tickets', t.id, { resolution: t.resolution || visit.workDone }, undefined);
  });
  otps.delete(id);
  return input.resolve ? transitionRecord(actor, 'tickets', id, 'resolved', updated.version).record : updated;
}
