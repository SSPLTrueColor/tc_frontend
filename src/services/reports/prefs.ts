/**
 * Per-user report conveniences kept in this browser only: favourites, recently viewed and the
 * filters last used on each report. Never throws (private windows / blocked storage just forget).
 */
export interface StoredFilters {
  view?: string;
  preset?: string;
  from?: string;
  to?: string;
  division?: string;
  owner?: string;
  group?: string;
}
export interface Recent {
  id: string;
  at: number;
}

const KEY = (userId: string, name: string) => `tc.reports.${name}.${userId}`;
const listeners = new Set<() => void>();
let version = 0;

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the preference lasts for this page view only */
  }
  version++;
  listeners.forEach((l) => l());
};

export const subscribePrefs = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const prefsVersion = () => version;

export const getFavourites = (userId: string): string[] => read<string[]>(KEY(userId, 'fav'), []);
export const toggleFavourite = (userId: string, reportId: string) => {
  const cur = getFavourites(userId);
  write(KEY(userId, 'fav'), cur.includes(reportId) ? cur.filter((x) => x !== reportId) : [...cur, reportId]);
};

export const getRecent = (userId: string): Recent[] => read<Recent[]>(KEY(userId, 'recent'), []);
export const touchRecent = (userId: string, reportId: string, at: number) =>
  write(KEY(userId, 'recent'), [{ id: reportId, at }, ...getRecent(userId).filter((r) => r.id !== reportId)].slice(0, 30));

export const getSavedFilters = (userId: string, reportId: string): StoredFilters | null => read<Record<string, StoredFilters>>(KEY(userId, 'filters'), {})[reportId] ?? null;
export const saveFilters = (userId: string, reportId: string, f: StoredFilters | null) => {
  const all = read<Record<string, StoredFilters>>(KEY(userId, 'filters'), {});
  if (f) all[reportId] = f;
  else delete all[reportId];
  write(KEY(userId, 'filters'), all);
};
