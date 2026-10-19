import { useState, useSyncExternalStore } from 'react';
import { call, errorMessage } from '../../../services/api/client';
import { isOffline, pendingWrites, runOrQueue, subscribeOffline } from '../../../services/offline';
import { useToast } from '../../../components/primitives/feedback';
import { L } from '../../../constants/labels';

/** Offline state for field pages (NFR-15). */
export function useOffline() {
  const offline = useSyncExternalStore(subscribeOffline, isOffline, isOffline);
  const pending = useSyncExternalStore(subscribeOffline, () => pendingWrites().length, () => 0);
  return { offline, pending };
}

/**
 * Runs one job-card step: online → simulated network call; offline → applied on the device and listed for sync.
 * Returns true when the step ran (or was queued) without error.
 */
export function useStep() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (label: string, op: () => unknown, ok: string) => {
    if (isOffline()) {
      // Local-first (SRV-06): the step is applied on this device at once so the engineer can carry on
      // with the next step; it is listed as pending and reported as synced when back online.
      try {
        op();
      } catch (e) {
        toast(errorMessage(e), 'danger');
        return false;
      }
      runOrQueue(label, () => undefined);
      toast(L.service.toasts.queued(label), 'info');
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
