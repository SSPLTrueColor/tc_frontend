import type { Page } from '@playwright/test';

export const BASE = process.env.BASE_URL ?? 'http://localhost:5175';
const KEY = 'tc.crm.db.v1';

/** Reads, edits and writes the simulated database (localStorage) before the app boots. */
export async function editDb(page: Page, fn: string) {
  await page.evaluate(
    ([key, body]) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const db = JSON.parse(raw);
      // eslint-disable-next-line no-new-func
      new Function('db', body)(db);
      localStorage.setItem(key, JSON.stringify(db));
    },
    [KEY, fn] as const,
  );
}

/** Signs in as a demo user by writing the simulated session (skips the OTP screen), then opens `path`. */
export async function openAs(page: Page, userId: string, path: string, opts: { theme?: 'light' | 'dark'; db?: string; settings?: string } = {}) {
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(
    ([key, uid, theme]) => {
      const raw = localStorage.getItem(key);
      const db = raw ? JSON.parse(raw) : null;
      if (!db) return;
      db.session = { userId: uid, workspaceId: 'tc', signedIn: true, lastActiveAt: new Date().toISOString() };
      db.settings = { ...(db.settings ?? {}), [uid]: { ...(db.settings?.[uid] ?? {}), tourSeenAt: new Date().toISOString(), ...(theme ? { theme } : {}) } };
      localStorage.setItem(key, JSON.stringify(db));
    },
    [KEY, userId, opts.theme ?? ''] as const,
  );
  if (opts.db) await editDb(page, opts.db);
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState('networkidle');
}

export const pageOverflow = (page: Page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.getElementById('main');
    return { doc: doc.scrollWidth - doc.clientWidth, main: main ? main.scrollWidth - main.clientWidth : 0 };
  });

/** Collects console errors and uncaught exceptions. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
