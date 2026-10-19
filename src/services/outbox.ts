/**
 * Simulated outbound messaging (email, WhatsApp, SMS, push). Nothing is sent: messages are
 * recorded here so a demo can show exactly what the live system would deliver (COM-03, §6).
 */
import { nowIso } from '../lib/clock';
import { uid } from '../lib/ids';
import { type Actor, can } from './authz';
import { getDb } from './db';
import type { HookContext } from './resourceHooks';
import { type OutboxMessage, ServiceError } from './types';
import { L } from '../constants/labels';

export function queueMessage(ctx: HookContext, m: Omit<OutboxMessage, 'id' | 'workspaceId' | 'createdAt' | 'createdBy' | 'status'>): OutboxMessage {
  const msg: OutboxMessage = { ...m, id: uid('msg'), workspaceId: ctx.actor.workspaceId, createdAt: nowIso(), createdBy: ctx.actor.user.id, status: 'simulated' };
  ctx.d.outbox.unshift(msg);
  if (ctx.d.outbox.length > 1000) ctx.d.outbox.length = 1000;
  return msg;
}

export function listOutbox(actor: Actor): OutboxMessage[] {
  if (!can(actor, 'outbox.view')) throw new ServiceError('forbidden', L.common.errors.outboxOnly);
  return getDb().outbox.filter((m) => m.workspaceId === actor.workspaceId);
}
