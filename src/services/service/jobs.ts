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
import { ServiceError } from '../types';
import { chargeableBlocker, OPEN_STATUSES } from './tickets';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export const visitsOf = (ticketId: string): RecordData[] => (getDb().records.serviceVisits ?? []).filter((v) => v.ticketId === ticketId).sort((a, b) => s(b.createdAt).localeCompare(s(a.createdAt)));
export const openVisitOf = (ticketId: string) => visitsOf(ticketId).find((v) => v.status !== 'completed' && v.visitType !== 'remote');

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
    if (!t) throw new ServiceError('not_found', `Ticket ${ticketId} was not found.`);
    if (t.assigneeId !== actor.staffId && !can(actor, 'ticket.assign')) throw new ServiceError('forbidden', 'Only the assigned engineer can update this job card.');
    if (expectedVersion !== undefined && t.version !== expectedVersion) throw new ServiceError('version_conflict', `${ticketId} was changed by someone else while you were offline (now version ${t.version}). Open the job again and redo this step.`);
    return fn({ d, actor, correlationId: uid('cor') }, t);
  });
}

export const acceptJob = (actor: Actor, id: string, version: number) => transitionRecord(actor, 'tickets', id, 'accepted', version);
export const rejectJob = (actor: Actor, id: string, version: number) => transitionRecord(actor, 'tickets', id, 'open', version);
export const setWaiting = (actor: Actor, id: string, version: number, to: 'waiting_parts' | 'waiting_customer' | 'in_progress') => transitionRecord(actor, 'tickets', id, to, version);

export function startTravel(actor: Actor, id: string, version?: number) {
  return jobCommit(actor, id, version, (ctx, t) => {
    if (!['accepted', 'reopened', 'in_progress', 'waiting_parts'].includes(s(t.status))) throw new ServiceError('invalid_state', 'Accept the job before starting travel.');
    if (openVisitOf(t.id)) throw new ServiceError('invalid_state', 'A visit for this job is already in progress.');
    return insertRecordIn(ctx, 'serviceVisits', { ticketId: t.id, engineerId: actor.staffId, visitType: 'site', status: 'travelling', travelStartAt: nowLocal() });
  });
}

export function checkIn(actor: Actor, id: string, at: { lat: number; lng: number; mock: boolean }, version?: number) {
  return jobCommit(actor, id, version, (ctx, t) => {
    const now = nowLocal();
    const visit = openVisitOf(t.id) ?? insertRecordIn(ctx, 'serviceVisits', { ticketId: t.id, engineerId: actor.staffId, visitType: 'site', status: 'travelling', travelStartAt: now });
    patchRecordIn(ctx, 'serviceVisits', visit.id, { status: 'on_site', checkInAt: now, checkInLat: Math.round(at.lat * 1e5) / 1e5, checkInLng: Math.round(at.lng * 1e5) / 1e5, checkInMock: at.mock }, `Checked in at site${at.mock ? ' (location simulated)' : ''}`);
    const patch: Record<string, unknown> = { arrivedAt: t.arrivedAt || now, respondedAt: t.respondedAt || now };
    if (['accepted', 'reopened', 'assigned'].includes(s(t.status))) patch.status = 'in_progress';
    return patchRecordIn(ctx, 'tickets', t.id, patch, 'Engineer arrived on site');
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
    if (!visit || visit.status !== 'on_site') throw new ServiceError('invalid_state', 'Check in at the site before recording work.');
    if (w.printCounter !== null && w.printCounter !== undefined && w.printCounter < 0) throw new ServiceError('validation', 'Readings cannot be negative.', { fieldErrors: { printCounter: 'Must be 0 or more' } });
    patchRecordIn(ctx, 'serviceVisits', visit.id, { diagnosis: w.diagnosis.trim(), workDone: w.workDone.trim(), partsUsed: w.partsUsed.trim(), photosBefore: w.photosBefore, photosAfter: w.photosAfter, printCounter: w.printCounter ?? null, inkUsedMl: w.inkUsedMl ?? null }, 'Job card updated');
    return w.workDone.trim() ? patchRecordIn(ctx, 'tickets', t.id, { resolution: w.workDone.trim() }, 'Work done recorded from the job card') : t;
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
  if (input.method === 'otp' && (!input.otp || otps.get(id) !== input.otp.trim())) throw new ServiceError('validation', 'The customer’s code does not match. Ask them to read it again.', { fieldErrors: { otp: 'Incorrect code' } });
  if (input.method === 'signature' && !input.signed) throw new ServiceError('validation', 'Ask the customer to sign in the box.', { fieldErrors: { signature: 'Signature required' } });
  const updated = jobCommit(actor, id, version, (ctx, t) => {
    const visit = openVisitOf(t.id);
    if (!visit || visit.status !== 'on_site') throw new ServiceError('invalid_state', 'Check in at the site first.');
    if (input.resolve) {
      if (!s(t.resolution).trim() && !s(visit.workDone).trim()) throw new ServiceError('validation', 'Record the work performed before resolving.', { fieldErrors: { workDone: 'Required to resolve' } });
      const block = chargeableBlocker(t);
      if (block) throw new ServiceError('invalid_state', block);
    }
    const now = nowLocal();
    patchRecordIn(ctx, 'serviceVisits', visit.id, { status: 'completed', checkOutAt: now, signOffMethod: input.method, signedOffAt: now }, `Checked out; customer signed off by ${input.method === 'otp' ? 'one-time code' : 'signature'}`);
    return patchRecordIn(ctx, 'tickets', t.id, { resolution: t.resolution || visit.workDone }, undefined);
  });
  otps.delete(id);
  return input.resolve ? transitionRecord(actor, 'tickets', id, 'resolved', updated.version).record : updated;
}
