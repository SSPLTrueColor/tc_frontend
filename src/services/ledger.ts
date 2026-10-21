/**
 * Audit Ledger, simulated Event Outbox and Notification Service writers.
 * Each owns its own collection; none writes another domain's state.
 */
import { nowIso } from '../lib/clock';
import { organization } from '../domain/pack';
import { uid } from '../lib/ids';
import type { Actor } from './authz';
import type { AppNotification, AuditEntry, Db, DomainEvent } from './types';
import { routeStaffAlert } from './outbox';
import { getUser } from './registry';

/**
 * NFR-13: the audit trail is append-only and is not truncated in normal use. The only bound is a
 * browser-storage safety net far above any demo session (a live system archives to cold storage
 * and retains entries for at least 3 years).
 */
export const AUDIT_SAFETY_LIMIT = 50_000;

export function appendAudit(d: Db, actor: Actor, entry: Omit<AuditEntry, 'id' | 'at' | 'workspaceId' | 'actorId' | 'actorRole' | 'actorType'> & { actorType?: AuditEntry['actorType'] }) {
  d.audit.unshift({
    id: uid('aud'),
    at: nowIso(),
    workspaceId: actor.workspaceId,
    actorId: actor.user.id,
    actorRole: actor.role.label,
    actorType: entry.actorType ?? 'user',
    ...entry,
  });
  if (d.audit.length > AUDIT_SAFETY_LIMIT) d.audit.length = AUDIT_SAFETY_LIMIT;
}

export function emitEvent(
  d: Db,
  actor: Actor,
  e: { eventType: string; resourceId?: string; recordId?: string; correlationId: string; causationId?: string; idempotencyKey?: string; payload: Record<string, unknown>; classification?: string },
): DomainEvent {
  const ev: DomainEvent = {
    eventId: uid('evt'),
    eventVersion: 1,
    tenantId: organization.id,
    workspaceId: actor.workspaceId,
    actorId: actor.user.id,
    actorType: 'user',
    occurredAt: nowIso(),
    idempotencyKey: e.idempotencyKey ?? `${e.eventType}:${e.recordId ?? ''}:${e.correlationId}`,
    delivery: 'simulated',
    ...e,
  };
  // Outbox idempotency: an event with the same key is recorded once.
  if (!d.events.some((x) => x.idempotencyKey === ev.idempotencyKey)) d.events.unshift(ev);
  if (d.events.length > 2000) d.events.length = 2000;
  return ev;
}

export function notify(d: Db, n: Omit<AppNotification, 'id' | 'createdAt'>) {
  // De-duplicate identical unread notifications.
  if (d.notifications.some((x) => !x.readAt && x.userId === n.userId && x.title === n.title)) return;
  d.notifications.unshift({ id: uid('ntf'), createdAt: nowIso(), ...n });
  // COM-03: the same alert also goes out on the channels the recipient chose for this event
  // (Notification Preferences), held during quiet hours or batched into the daily digest.
  const staffId = getUser(n.userId)?.staffIds[n.workspaceId];
  const emp = staffId ? (d.records.employees ?? []).find((e) => e.id === staffId) : undefined;
  routeStaffAlert(d, n, { userId: n.userId, email: emp?.email ? String(emp.email) : undefined, mobile: emp?.mobile ? String(emp.mobile) : undefined });
}
