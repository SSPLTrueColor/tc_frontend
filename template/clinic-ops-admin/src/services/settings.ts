/** Settings Resolver: personal preferences (local-only) layered on platform constraints. */
import type { Actor } from './authz';
import { commit, defaultSettings, getDb } from './db';
import type { PersonalSettings } from './types';

/** Platform constraints a user cannot override. */
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 360;

export function getSettings(userId: string): PersonalSettings {
  return { ...defaultSettings(), ...(getDb().settings[userId] ?? {}) };
}

export function updateSettings(userId: string, patch: Partial<PersonalSettings>) {
  commit((d) => {
    const next = { ...getSettings(userId), ...patch };
    next.sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(next.sidebarWidth)));
    d.settings[userId] = next;
  });
}

export function pushRecent(actor: Actor, label: string, path: string) {
  const s = getSettings(actor.user.id);
  if (s.recents[0]?.path === path) return;
  const recents = [{ label, path, at: new Date().toISOString() }, ...s.recents.filter((r) => r.path !== path)].slice(0, 8);
  updateSettings(actor.user.id, { recents });
}

export function togglePin(actor: Actor, label: string, path: string) {
  const s = getSettings(actor.user.id);
  const exists = s.pins.some((p) => p.path === path);
  updateSettings(actor.user.id, { pins: exists ? s.pins.filter((p) => p.path !== path) : [...s.pins, { label, path }] });
}

/** Star a sidebar option: it moves up into the "Favorites" section at the top (click again to remove). */
export function toggleFavorite(actor: Actor, entry: { label: string; path: string; icon?: string }) {
  const s = getSettings(actor.user.id);
  const exists = s.favorites.some((f) => f.path === entry.path);
  updateSettings(actor.user.id, { favorites: exists ? s.favorites.filter((f) => f.path !== entry.path) : [...s.favorites, entry] });
}

/** Theme changer: save (create or update) a custom palette and switch to it. */
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

export function switchSession(userId: string, workspaceId: string) {
  commit((d) => {
    d.session = { userId, workspaceId };
  });
}
