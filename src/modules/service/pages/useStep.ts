import { useState, useSyncExternalStore } from 'react';
import { call, errorMessage } from '../../../services/api/client';
import { isOffline, pendingWrites, runOrQueue, subscribeOffline } from '../../../services/offline';
import { useToast } from '../../../components/primitives/feedback';

/** Offline state for field pages (NFR-15). */
export function useOffline() {
  const offline = useSyncExternalStore(subscribeOffline, isOffline, isOffline);
  const pending = useSyncExternalStore(subscribeOffline, () => pendingWrites().length, () => 0);
  return { offline, pending };
}

/**
 * Runs one job-card step: online → simulated network call; offline → queued for sync.
 * Returns true when the step ran (or was queued) without error.
 */
export function useStep() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (label: string, op: () => unknown, ok: string) => {
    if (isOffline()) {
      runOrQueue(label, () => void op());
      toast(`${label}: saved on this device — it syncs when you are back online`, 'info');
      return true;
    }
    setBusy(label);
    try {
      await call(op);
      toast(ok);
      return true;
    } catch (e) {
      toast(errorMessage(e), 'danger');
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { run, busy };
}
