/**
 * Async service boundary. Pages call module services in this folder; each call waits a
 * realistic network delay (demo setting, default 300–800 ms) and can fail on purpose
 * (demo failure rate) so loading and error states are visible. Swapping to a real backend
 * means replacing these functions with HTTP calls of the same signature.
 */
import { getDb } from '../db';
import { ServiceError } from '../types';
import { L } from '../../constants/labels';

export class NetworkError extends Error {
  constructor() {
    super(L.common.errors.network);
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function latency(): number {
  const { latencyMin, latencyMax } = getDb().demo;
  return latencyMin + Math.random() * Math.max(0, latencyMax - latencyMin);
}

/** Run a synchronous engine operation behind a simulated network round-trip. */
export async function call<T>(op: () => T, opts: { fast?: boolean } = {}): Promise<T> {
  await wait(opts.fast ? 0 : latency());
  if (Math.random() < getDb().demo.failureRate) throw new NetworkError();
  return op();
}

export const errorMessage = (e: unknown) => (e instanceof ServiceError || e instanceof NetworkError || e instanceof Error ? e.message : L.common.errors.generic);
