/**
 * LOCAL-ONLY persistence. This is the prototype's stand-in for server storage:
 * a single JSON document in this browser's localStorage. It is not shared with
 * other devices or users, and it is not a security boundary.
 * Only the service layer reads or writes it; seed data lives in src/mocks.
 */
import { now as clockNow, nowIso } from '../lib/clock';
import { SEED_REVISION, seedApp } from '../mocks/seed';
import type { Db, DemoSettings, PersonalSettings } from './types';
import { L } from '../constants/labels';

export const STORAGE_KEY = 'tc.crm.db.v1';
export const SEED = 2627;
/** Stored data is re-seeded when this changes (core schema + every module's seed rev). */
const SCHEMA_VERSION = `2:${SEED_REVISION}`;

export const defaultDemoSettings = (): DemoSettings => ({ latencyMin: 300, latencyMax: 800, failureRate: 0, idleTimeoutMin: 30 });

export const defaultSettings = (): PersonalSettings => ({
  theme: 'system',
  railSkin: 'softCharcoal',
  navDensity: 'balanced',
  sidebarWidth: 240,
  sidebarCollapsed: false,
  pins: [],
  favorites: [],
  palette: 'violet',
  formLayout: 'simple',
  customPalettes: [],
  recents: [],
  defaultViews: {},
  language: 'en',
  notifications: {
    events: { approvals: ['inApp', 'email'], followUps: ['inApp', 'push'], slaBreach: ['inApp', 'email', 'whatsapp'], renewals: ['inApp', 'email'], payments: ['inApp'] },
    quietHours: { enabled: false, from: '21:00', to: '08:00' },
    dailyDigest: false,
  },
  mfaOptIn: false,
  revokedSessions: [],
  lastViews: {},
  lastUsed: {},
});

export function createDb(now = clockNow()): Db {
  const s = seedApp(SEED, now);
  return {
    schemaVersion: SCHEMA_VERSION,
    seed: SEED,
    seededAt: now.toISOString(),
    records: s.records,
    counters: s.counters,
    comments: [],
    approvals: s.approvals,
    notifications: s.notifications,
    outbox: [],
    recycle: [],
    demo: defaultDemoSettings(),
    audit: [],
    events: [],
    views: [],
    config: { version: 1, masters: {}, customFields: {}, resourceVersions: {}, history: [], draft: null },
    idempotency: {},
    session: { userId: 'u_rahul', workspaceId: 'tc', signedIn: false, lastActiveAt: nowIso() },
    settings: {},
    commentDrafts: {},
    formDrafts: {},
  };
}

function load(): Db {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Db;
      if (parsed.schemaVersion === SCHEMA_VERSION) return parsed;
    }
  } catch {
    /* storage unavailable or corrupt — fall back to a fresh seed */
  }
  return createDb();
}

let db: Db = load();
/** Last committed state as JSON — used to roll back a write that fails half-way. */
let lastGood: string = JSON.stringify(db);
let revision = 0;
let persistError: string | null = null;
const listeners = new Set<() => void>();

function persist() {
  lastGood = JSON.stringify(db);
  try {
    localStorage.setItem(STORAGE_KEY, lastGood);
    persistError = null;
  } catch (e) {
    persistError = e instanceof Error ? e.message : L.common.errors.storageWrite;
  }
}

function emit() {
  revision++;
  listeners.forEach((l) => l());
}

export function getDb(): Db {
  return db;
}

export function getRevision(): number {
  return revision;
}

export function getPersistError(): string | null {
  return persistError;
}

/** All writes go through commit so persistence and subscribers stay consistent. */
export function commit<T>(mutate: (d: Db) => T): T {
  let result: T;
  try {
    result = mutate(db);
  } catch (e) {
    // A failed write must not leave a half-applied change in memory: restore the last committed state.
    db = JSON.parse(lastGood) as Db;
    emit();
    throw e;
  }
  persist();
  emit();
  return result;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** "Reset demo data": fresh seed; keeps who is signed in, personal settings and demo controls. */
export function resetDb() {
  const { session, settings, demo } = db;
  db = createDb();
  db.session = session;
  db.settings = settings;
  db.demo = demo;
  persist();
  emit();
}

/** Full data export (NFR-12/18): the whole local store as JSON. */
export const exportDbJson = () => JSON.stringify(db, null, 2);

/** Restore from an export. Rejects files from another schema version. */
export function importDbJson(text: string) {
  const parsed = JSON.parse(text) as Db;
  if (parsed.schemaVersion !== SCHEMA_VERSION || !parsed.records) throw new Error(L.common.errors.badImport);
  db = parsed;
  persist();
  emit();
}

/** Replace the in-memory store (tests). */
export function __setDb(next: Db) {
  db = next;
  lastGood = JSON.stringify(next);
  emit();
}

// Cross-tab sync: another tab's write replaces our copy (optimistic concurrency still applies).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      db = JSON.parse(e.newValue) as Db;
      lastGood = e.newValue;
      emit();
    } catch {
      /* ignore */
    }
  });
}
