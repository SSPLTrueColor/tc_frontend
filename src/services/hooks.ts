import { useSyncExternalStore } from 'react';
import { currentActor, type Actor } from './authz';
import { getRevision, subscribe } from './db';
import { getSettings } from './settings';

/** Re-render on any store commit; returns the revision for memo dependencies. */
export function useRevision(): number {
  return useSyncExternalStore(subscribe, getRevision, getRevision);
}

export function useActor(): Actor {
  useRevision();
  return currentActor();
}

export function useSettings() {
  const actor = useActor();
  return getSettings(actor.user.id);
}
