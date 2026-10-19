/**
 * Simulated offline mode (NFR-15, COM-07). While "offline", field writes (attendance, visits,
 * job cards) are queued in memory instead of reaching the service; going online replays them in
 * order. A replay that hits a version conflict is reported, not silently merged.
 * The queue lives in this tab only (a real app would persist it on the device).
 */
import { ServiceError } from './types';
import { L } from '../constants/labels';

export interface QueuedWrite {
  id: number;
  label: string;
  queuedAt: string;
  run: () => void;
}

let offline = false;
let seq = 0;
const queue: QueuedWrite[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const isOffline = () => offline;
export const pendingWrites = (): readonly QueuedWrite[] => queue;
export function subscribeOffline(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Runs the write now, or queues it while offline. Returns true when it ran immediately. */
export function runOrQueue(label: string, run: () => void): boolean {
  if (!offline) {
    run();
    return true;
  }
  queue.push({ id: ++seq, label, queuedAt: new Date().toISOString(), run });
  emit();
  return false;
}

export interface SyncResult {
  synced: string[];
  conflicts: { label: string; message: string }[];
}

/** Switching back online replays the queue in order. */
export function setOffline(next: boolean): SyncResult | null {
  offline = next;
  if (next) {
    emit();
    return null;
  }
  const result: SyncResult = { synced: [], conflicts: [] };
  while (queue.length) {
    const w = queue.shift()!;
    try {
      w.run();
      result.synced.push(w.label);
    } catch (e) {
      result.conflicts.push({ label: w.label, message: e instanceof ServiceError || e instanceof Error ? e.message : L.common.shell.offline.couldNotSync });
    }
  }
  emit();
  return result;
}
