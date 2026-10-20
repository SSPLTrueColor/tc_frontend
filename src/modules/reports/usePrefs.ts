import { useCallback, useSyncExternalStore } from 'react';
import { useActor } from '../../services/hooks';
import { getFavourites, getRecent, prefsVersion, subscribePrefs, toggleFavourite, touchRecent } from '../../services/reports/prefs';

/** Favourites and recently viewed reports for the signed-in user (this browser). */
export function useReportPrefs() {
  const userId = useActor().user.id;
  useSyncExternalStore(subscribePrefs, prefsVersion);
  const toggle = useCallback((id: string) => toggleFavourite(userId, id), [userId]);
  const touch = useCallback((id: string) => touchRecent(userId, id, Date.now()), [userId]);
  return { favourites: getFavourites(userId), recent: getRecent(userId), toggle, touch };
}
