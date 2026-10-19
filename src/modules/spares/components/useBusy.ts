import { useState } from 'react';
import { useToast } from '../../../components/primitives/feedback';
import { errorMessage } from '../../../services/api/client';

/** Runs an async page action with a busy flag; toasts the returned message, or the error. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const run = async (op: () => Promise<string>) => {
    setBusy(true);
    try {
      toast(await op());
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}
