/**
 * Audit Ledger, simulated Event Outbox and Notification Service writers.
 * Each owns its own collection; none writes another domain's state.
 */
import { organization } from '../domain/clinic/pack';
import { uid } from '../lib/ids';
import type { Actor } from './authz';
import type { AppNotification, AuditEntry, Db, DomainEvent } from './types';

export function appendAudit(d: Db, actor: Actor, entry: Omit<AuditEntry, 'id' | 'at' | 'workspaceId' | 'actorId' | 'actorRole' | 'actorType'> & { actorType?: AuditEntry['actorType'] }) {
  d.audit.unshift({
    id: uid('aud'),
    at: new Date().toISOString(),
    workspaceId: actor.workspaceId,
    actorId: actor.user.id,
    actorRole: actor.role.label,
    actorType: entry.actorType ?? 'user',
    ...entry,
  });
  if (d.audit.length > 2000) d.audit.length = 2000;
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
    occurredAt: new Date().toISOString(),
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
  d.notifications.unshift({ id: uid('ntf'), createdAt: new Date().toISOString(), ...n });
}
