/** Communication Service (comments) and Notification Service (inbox state). */
import { demoUsers } from '../domain/clinic/pack';
import { uid } from '../lib/ids';
import { type Actor, canReadRecord } from './authz';
import { commit, getDb } from './db';
import { emitEvent, notify } from './ledger';
import { getResource } from './registry';
import { type Comment, ServiceError } from './types';

export function listComments(actor: Actor, resource: string, recordId: string): Comment[] {
  return getDb()
    .comments.filter((c) => c.workspaceId === actor.workspaceId && c.resource === resource && c.recordId === recordId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export const draftKey = (actor: Actor, resource: string, recordId: string) => `${actor.user.id}:${actor.workspaceId}:${resource}:${recordId}`;

export function getCommentDraft(actor: Actor, resource: string, recordId: string) {
  return getDb().commentDrafts[draftKey(actor, resource, recordId)] ?? '';
}

/** Draft policy: autosaved locally per user + record; survives tab and record switches. */
export function saveCommentDraft(actor: Actor, resource: string, recordId: string, body: string) {
  commit((d) => {
    const k = draftKey(actor, resource, recordId);
    if (body) d.commentDrafts[k] = body;
    else delete d.commentDrafts[k];
  });
}

export function addComment(actor: Actor, resource: string, recordId: string, body: string, idempotencyKey: string): Comment {
  const text = body.trim();
  if (!text) throw new ServiceError('validation', 'Write a comment first.');
  if (text.length > 2000) throw new ServiceError('validation', 'Comments are limited to 2000 characters.');
  const res = getResource(resource);
  return commit((d) => {
    const existing = d.comments.find((c) => c.id === d.idempotency[idempotencyKey]);
    if (existing) return existing;
    const record = d.records[resource]?.find((r) => r.id === recordId);
    if (!record || !canReadRecord(actor, res, record)) throw new ServiceError('not_found', 'Record not found.');
    const mentions = demoUsers.filter((u) => u.id !== actor.user.id && text.includes(`@${u.name}`)).map((u) => u.id);
    const comment: Comment = {
      id: uid('cmt'),
      workspaceId: actor.workspaceId,
      resource,
      recordId,
      body: text,
      authorId: actor.user.id,
      createdAt: new Date().toISOString(),
      mentions,
      visibility: 'internal',
    };
    d.comments.push(comment);
    d.idempotency[idempotencyKey] = comment.id;
    delete d.commentDrafts[draftKey(actor, resource, recordId)];
    emitEvent(d, actor, { eventType: 'comment.added', resourceId: res.id, recordId, correlationId: uid('cor'), idempotencyKey, payload: { commentId: comment.id, mentions } });
    // Payload minimization: notifications carry record ids, not comment text.
    mentions.forEach((m) => notify(d, { userId: m, workspaceId: actor.workspaceId, kind: 'mention', title: `${actor.user.name} mentioned you on ${recordId}`, link: { resource, recordId } }));
    return comment;
  });
}

export function listNotifications(actor: Actor) {
  const now = new Date().toISOString();
  return getDb().notifications.filter((n) => n.userId === actor.user.id && n.workspaceId === actor.workspaceId && (!n.snoozedUntil || n.snoozedUntil < now));
}

export function markNotification(actor: Actor, id: string, read: boolean) {
  commit((d) => {
    const n = d.notifications.find((x) => x.id === id && x.userId === actor.user.id);
    if (n) n.readAt = read ? new Date().toISOString() : undefined;
  });
}

export function markAllRead(actor: Actor) {
  commit((d) => {
    const now = new Date().toISOString();
    d.notifications.forEach((n) => {
      if (n.userId === actor.user.id && n.workspaceId === actor.workspaceId && !n.readAt) n.readAt = now;
    });
  });
}

export function snoozeNotification(actor: Actor, id: string, hours: number) {
  commit((d) => {
    const n = d.notifications.find((x) => x.id === id && x.userId === actor.user.id);
    if (n) n.snoozedUntil = new Date(Date.now() + hours * 3600_000).toISOString();
  });
}
