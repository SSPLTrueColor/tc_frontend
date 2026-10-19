/** Activity log service (COM-05, LEAD-09). Parent records pick up lastActivityAt / nextFollowUpAt via the core hook. */
import { nowLocal } from '../lib/dates';
import type { Actor } from './authz';
import { createRecord, queryRecords } from './runtime';
import type { RecordData } from '../metadata/types';

export interface ActivityInput {
  parentResource: string;
  parentId: string;
  /** Shown in lists, e.g. "LD-2627-00012 · Om Sai Textiles". */
  parentLabel: string;
  customerId?: string;
  activityType: string;
  subject: string;
  notes?: string;
  at?: string;
  nextFollowUpAt?: string | null;
}

export function logActivity(actor: Actor, input: ActivityInput) {
  return createRecord(actor, 'activities', { ...input, at: input.at || nowLocal(), byId: actor.staffId, nextFollowUpAt: input.nextFollowUpAt || null });
}

/** Activities for one record (timeline), newest first; scope-filtered like any read. */
export function activitiesFor(actor: Actor, parentResource: string, parentId: string): RecordData[] {
  return queryRecords(actor, 'activities', { where: { parentResource, parentId }, sort: [{ field: 'at', dir: 'desc' }] }).rows;
}

/** Everything logged for a customer (Customer 360 timeline). */
export function activitiesForCustomer(actor: Actor, customerId: string): RecordData[] {
  return queryRecords(actor, 'activities', { where: { customerId }, sort: [{ field: 'at', dir: 'desc' }] }).rows;
}
