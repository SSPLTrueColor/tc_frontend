/** Simulated session + personal shell settings, persisted to localStorage. */
import { useSyncExternalStore } from 'react';
import { demoUsers, getRole, type DemoUser, type Role } from '../app/nav';

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 360;

export interface PersonalSettings {
  theme: 'system' | 'light' | 'dark';
  railSkin: 'softCharcoal' | 'midnightNavy' | 'graphiteBlack' | 'softLight';
  navDensity: 'balanced' | 'compact';
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  pins: { label: string; path: string }[];
  favorites: { label: string; path: string; icon?: string }[];
  palette: string;
  customPalettes: { id: string; name: string; accent: string; sidebar: string; rail: string; custom?: boolean }[];
  recents: { label: string; path: string; at: string }[];
}

export interface Actor {
  user: DemoUser;
  role: Role;
}

interface SessionState {
  userId: string;
  settings: Record<string, PersonalSettings>;
}

const KEY = 'tc.session.v1';

export const defaultSettings = (): PersonalSettings => ({
  theme: 'system',
  railSkin: 'softCharcoal',
  navDensity: 'balanced',
  sidebarWidth: 240,
  sidebarCollapsed: false,
  pins: [],
  favorites: [],
  palette: 'violet',
  customPalettes: [],
  recents: [],
});

let persistError: string | null = null;
let revision = 0;
const listeners = new Set<() => void>();

function load(): SessionState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as SessionState;
  } catch (e) {
    persistError = e instanceof Error ? e.message : String(e);
  }
  return { userId: demoUsers[0].id, settings: {} };
}

let state = load();

function commit(mutate: (s: SessionState) => void) {
  mutate(state);
  state = { ...state };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    persistError = null;
  } catch (e) {
    persistError = e instanceof Error ? e.message : String(e);
  }
  revision++;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getRevision = () => revision;

export const getPersistError = () => persistError;

export function currentActor(): Actor {
  const user = demoUsers.find((u) => u.id === state.userId) ?? demoUsers[0];
  return { user, role: getRole(user.roleId) };
}

export function useRevision(): number {
  return useSyncExternalStore(subscribe, getRevision, getRevision);
}

export function useActor(): Actor {
  useRevision();
  return currentActor();
}

export function switchUser(userId: string) {
  commit((s) => {
    s.userId = userId;
  });
}

export function getSettings(userId: string): PersonalSettings {
  return { ...defaultSettings(), ...(state.settings[userId] ?? {}) };
}

export function updateSettings(userId: string, patch: Partial<PersonalSettings>) {
  commit((s) => {
    const next = { ...getSettings(userId), ...patch };
    next.sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(next.sidebarWidth)));
    s.settings = { ...s.settings, [userId]: next };
  });
}

export function togglePin(actor: Actor, label: string, path: string) {
  const s = getSettings(actor.user.id);
  const exists = s.pins.some((p) => p.path === path);
  updateSettings(actor.user.id, { pins: exists ? s.pins.filter((p) => p.path !== path) : [...s.pins, { label, path }] });
}

export function toggleFavorite(actor: Actor, entry: { label: string; path: string; icon?: string }) {
  const s = getSettings(actor.user.id);
  const exists = s.favorites.some((f) => f.path === entry.path);
  updateSettings(actor.user.id, { favorites: exists ? s.favorites.filter((f) => f.path !== entry.path) : [...s.favorites, entry] });
}

export function saveCustomPalette(actor: Actor, p: { id?: string; name: string; accent: string; sidebar: string; rail: string }) {
  const s = getSettings(actor.user.id);
  const id = p.id ?? `custom-${Date.now().toString(36)}`;
  const entry = { id, name: p.name.trim() || 'My palette', accent: p.accent, sidebar: p.sidebar, rail: p.rail, custom: true };
  const exists = s.customPalettes.some((x) => x.id === id);
  updateSettings(actor.user.id, { customPalettes: exists ? s.customPalettes.map((x) => (x.id === id ? entry : x)) : [...s.customPalettes, entry], palette: id });
  return id;
}

export function deleteCustomPalette(actor: Actor, id: string) {
  const s = getSettings(actor.user.id);
  updateSettings(actor.user.id, { customPalettes: s.customPalettes.filter((x) => x.id !== id), palette: s.palette === id ? 'violet' : s.palette });
}

/** Placeholder until module stores exist: they register their own reset here later. */
export function resetDemoData() {
  revision++;
  listeners.forEach((l) => l());
}
