import { useEffect, useRef, useState } from 'react';
import { call, errorMessage } from '../services/api/client';
import { useRevision } from '../services/hooks';

export interface ServiceQuery<T> {
  /** Data for the current inputs; undefined while the first load for these inputs runs. */
  data: T | undefined;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Loads data through the simulated network boundary.
 * - First load and every change of `deps` wait the simulated latency (loading state).
 * - Later store changes (a save, another tab) refresh silently with no delay, as a live
 *   subscription would.
 */
export function useServiceQuery<T>(op: () => T, deps: unknown[]): ServiceQuery<T> {
  const rev = useRevision();
  const key = JSON.stringify(deps);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; error: string | null; loading: boolean }>({ key, error: null, loading: true });
  const opRef = useRef(op);
  opRef.current = op;
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ key, data: s.key === key ? s.data : undefined, error: null, loading: true }));
    call(() => opRef.current())
      .then((data) => {
        if (!alive) return;
        loadedKey.current = key;
        setState({ key, data, error: null, loading: false });
      })
      .catch((e) => alive && setState({ key, error: errorMessage(e), loading: false }));
    return () => {
      alive = false;
    };
  }, [key, nonce]);

  useEffect(() => {
    if (loadedKey.current !== key) return;
    try {
      const data = opRef.current();
      setState((s) => (s.key === key ? { ...s, data, error: null } : s));
    } catch (e) {
      setState((s) => (s.key === key ? { ...s, error: errorMessage(e) } : s));
    }
  }, [rev]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data: state.key === key ? state.data : undefined, loading: state.loading || state.key !== key, error: state.key === key ? state.error : null, retry: () => setNonce((n) => n + 1) };
}
