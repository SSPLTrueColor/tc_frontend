/**
 * Account & governance settings: Notification Preferences (COM-03), Security (NFR-07 / NFR-08, simulated)
 * and Data Protection (DPDP Act 2023). Personal values live in the user's settings; Data Protection is
 * workspace-wide in the Db. Each write validates, persists and is audited.
 */
import { L } from '../constants/labels';
import { nowIso } from '../lib/clock';
import { uid } from '../lib/ids';
import { type Actor, can } from './authz';
import { commit, getDb } from './db';
import { appendAudit } from './ledger';
import { getSettings, updateSettings } from './settings';
import { type DataProtection, type DpRequest, type NotificationPrefs, type NotifChannel, type NotifEvent, ServiceError } from './types';

const A = L.account;

export const NOTIF_EVENTS: NotifEvent[] = ['approvals', 'followUps', 'slaBreach', 'renewals', 'payments'];
export const NOTIF_CHANNELS: NotifChannel[] = ['inApp', 'email', 'whatsapp', 'push'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------------------------------------------------------------- Notification Preferences

export const getNotificationPrefs = (userId: string): NotificationPrefs => getSettings(userId).notifications;

export type NotificationErrors = { quiet?: string };
export function validateNotificationPrefs(p: NotificationPrefs): NotificationErrors {
  const e: NotificationErrors = {};
  const q = p.quietHours;
  if (q.enabled) {
    if (!TIME.test(q.from) || !TIME.test(q.to)) e.quiet = A.notifications.errors.time;
    else if (q.from === q.to) e.quiet = A.notifications.errors.sameTime;
  }
  return e;
}

export function saveNotificationPrefs(actor: Actor, prefs: NotificationPrefs) {
  const errors = validateNotificationPrefs(prefs);
  if (errors.quiet) throw new ServiceError('validation', errors.quiet);
  // In-app is always on: it is the record of truth and the place approvals are actioned.
  const events = Object.fromEntries(NOTIF_EVENTS.map((k) => [k, Array.from(new Set<NotifChannel>(['inApp', ...(prefs.events[k] ?? [])]))])) as NotificationPrefs['events'];
  updateSettings(actor.user.id, { notifications: { ...prefs, events } });
  commit((d) => appendAudit(d, actor, { action: 'settings.notifications', summary: A.notifications.audit, correlationId: uid('cor') }));
}

// ---------------------------------------------------------------- Security (simulated)

export interface DeviceSession {
  id: string;
  device: string;
  place: string;
  lastActive: string;
  current: boolean;
}
const DEVICES: Omit<DeviceSession, 'lastActive'>[] = [
  { id: 'current', device: A.security.devices.current, place: A.security.devices.currentPlace, current: true },
  { id: 'phone', device: A.security.devices.phone, place: A.security.devices.phonePlace, current: false },
  { id: 'tablet', device: A.security.devices.tablet, place: A.security.devices.tabletPlace, current: false },
];
export function listSessions(userId: string): DeviceSession[] {
  const revoked = getSettings(userId).revokedSessions;
  return DEVICES.filter((d) => d.current || !revoked.includes(d.id)).map((d, i) => ({ ...d, lastActive: d.current ? A.security.activeNow : A.security.daysAgo(i) }));
}
export function setMfaOptIn(actor: Actor, on: boolean) {
  updateSettings(actor.user.id, { mfaOptIn: on });
  commit((d) => appendAudit(d, actor, { action: 'settings.security', summary: on ? A.security.auditMfaOn : A.security.auditMfaOff, correlationId: uid('cor') }));
}
export function signOutDevice(actor: Actor, id: string) {
  if (id === 'current') throw new ServiceError('invalid_state', A.security.errors.current);
  const s = getSettings(actor.user.id);
  updateSettings(actor.user.id, { revokedSessions: Array.from(new Set([...s.revokedSessions, id])) });
  commit((d) => appendAudit(d, actor, { action: 'settings.security', summary: A.security.auditSignedOut(id), correlationId: uid('cor') }));
}
export const signOutOtherDevices = (actor: Actor) => DEVICES.filter((d) => !d.current).forEach((d) => signOutDevice(actor, d.id));

// ---------------------------------------------------------------- Data Protection

export const DEFAULT_DATA_PROTECTION: DataProtection = {
  consents: { employeeLocation: true, customerComms: true, whatsappOptIn: true },
  retention: { auditMonths: 84, recycleDays: 30, inactiveContactMonths: 36 },
  requests: [
    { id: 'DPR-0001', type: 'correction', subject: 'Contact at Shree Textiles', details: 'Mobile number on the contact record is out of date.', status: 'done', createdAt: '2026-09-02T10:15:00.000Z', createdBy: 'u_rahul', resolvedAt: '2026-09-04T09:00:00.000Z' },
    { id: 'DPR-0002', type: 'erasure', subject: 'Former dealer contact', details: 'Asked us to remove their personal details after closing the account.', status: 'open', createdAt: '2026-10-11T12:40:00.000Z', createdBy: 'u_rahul' },
  ],
};

export function getDataProtection(): DataProtection {
  const d = getDb().dataProtection;
  return { ...DEFAULT_DATA_PROTECTION, ...(d ?? {}), consents: { ...DEFAULT_DATA_PROTECTION.consents, ...(d?.consents ?? {}) }, retention: { ...DEFAULT_DATA_PROTECTION.retention, ...(d?.retention ?? {}) }, requests: d?.requests ?? DEFAULT_DATA_PROTECTION.requests };
}

const requireAdmin = (actor: Actor) => {
  if (!can(actor, 'config.publish')) throw new ServiceError('forbidden', A.dataProtection.errors.adminOnly);
};

export function setConsent(actor: Actor, key: keyof DataProtection['consents'], on: boolean) {
  requireAdmin(actor);
  commit((d) => {
    const cur = getDataProtection();
    d.dataProtection = { ...cur, consents: { ...cur.consents, [key]: on } };
    appendAudit(d, actor, { action: 'settings.dataProtection', summary: A.dataProtection.auditConsent(A.dataProtection.consents[key].title, on), correlationId: uid('cor') });
  });
}

const RANGES: Record<keyof DataProtection['retention'], [number, number]> = { auditMonths: [12, 120], recycleDays: [7, 365], inactiveContactMonths: [6, 120] };
export type RetentionErrors = Partial<Record<keyof DataProtection['retention'], string>>;
export function validateRetention(r: DataProtection['retention']): RetentionErrors {
  const e: RetentionErrors = {};
  for (const k of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
    const v = r[k];
    const [lo, hi] = RANGES[k];
    if (!Number.isInteger(v)) e[k] = A.dataProtection.errors.whole;
    else if (v < lo || v > hi) e[k] = A.dataProtection.errors.range(lo, hi);
  }
  return e;
}
export function saveRetention(actor: Actor, r: DataProtection['retention']) {
  requireAdmin(actor);
  const err = Object.values(validateRetention(r))[0];
  if (err) throw new ServiceError('validation', err);
  commit((d) => {
    d.dataProtection = { ...getDataProtection(), retention: r };
    appendAudit(d, actor, { action: 'settings.dataProtection', summary: A.dataProtection.auditRetention, correlationId: uid('cor') });
  });
}

export interface DpRequestInput {
  type: DpRequest['type'];
  subject: string;
  details: string;
}
export type DpRequestErrors = Partial<Record<keyof DpRequestInput, string>>;
/** Spaces-only and emoji-only text do not count as a subject. */
export function validateDpRequest(i: DpRequestInput): DpRequestErrors {
  const E = A.dataProtection.errors;
  const e: DpRequestErrors = {};
  const subject = i.subject.trim();
  if (!subject) e.subject = E.subjectRequired;
  else if (subject.length < 2) e.subject = E.subjectShort;
  else if (subject.length > 80) e.subject = E.subjectLong;
  else if (!/[\p{L}\p{N}]/u.test(subject)) e.subject = E.subjectLetters;
  if (i.details.trim().length > 500) e.details = E.detailsLong;
  return e;
}
export function logDpRequest(actor: Actor, input: DpRequestInput): DpRequest {
  const errors = validateDpRequest(input);
  const first = Object.values(errors)[0];
  if (first) throw new ServiceError('validation', first);
  const cur = getDataProtection();
  if (cur.requests.some((r) => r.status === 'open' && r.type === input.type && r.subject.trim().toLowerCase() === input.subject.trim().toLowerCase())) throw new ServiceError('conflict', A.dataProtection.errors.duplicate);
  const req: DpRequest = { id: `DPR-${String(cur.requests.length + 1).padStart(4, '0')}`, type: input.type, subject: input.subject.trim(), details: input.details.trim(), status: 'open', createdAt: nowIso(), createdBy: actor.user.id };
  commit((d) => {
    d.dataProtection = { ...cur, requests: [req, ...cur.requests] };
    appendAudit(d, actor, { action: 'settings.dataProtection', summary: A.dataProtection.auditRequest(req.id), correlationId: uid('cor') });
  });
  return req;
}
export function resolveDpRequest(actor: Actor, id: string, status: 'done' | 'rejected') {
  requireAdmin(actor);
  const cur = getDataProtection();
  if (!cur.requests.some((r) => r.id === id)) throw new ServiceError('not_found', A.dataProtection.errors.unknown);
  commit((d) => {
    d.dataProtection = { ...cur, requests: cur.requests.map((r) => (r.id === id ? { ...r, status, resolvedAt: nowIso() } : r)) };
    appendAudit(d, actor, { action: 'settings.dataProtection', summary: A.dataProtection.auditResolved(id, status), correlationId: uid('cor') });
  });
}
