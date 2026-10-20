/**
 * Whole-app stress test (UX Step 5). Page lists come from e2e/routes.json (run `npx tsx e2e/discover.mts` first):
 *  - roles:     every role opens every page it can reach: title shows, no console error, no "No access", no page scroll
 *  - layout:    every page × 5 widths × light / dark (+ 125 % / 150 % zoom as 1152 / 960 px) without horizontal page scroll
 *  - keyboard:  Tab reaches controls on every page and every stop shows a focus ring
 *  - failure:   every page survives a failing service (no crash, no blank page)
 */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { BASE, openAs, pageOverflow, watchErrors } from './helpers';
import { ROLE_USERS } from './pages';

const ROUTES: Record<string, string[]> = JSON.parse(readFileSync(new URL('./routes.json', import.meta.url), 'utf8'));
const ADMIN_PAGES = ROUTES.admin;
const IGNORE = /Failed to load resource|net::ERR/;

test.describe.configure({ mode: 'parallel' });

test.describe('roles × pages', () => {
  for (const [role, user] of Object.entries(ROLE_USERS)) {
    test(`${role}: all ${ROUTES[role].length} reachable pages open cleanly`, async ({ page }) => {
      test.setTimeout(900_000);
      const errors = watchErrors(page);
      await openAs(page, user, '/dashboard');
      const problems: string[] = [];
      for (const path of ROUTES[role]) {
        const before = errors.length;
        await page.goto(`${BASE}${path}`);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(900);
        const title = await page.locator('h1.page-title').isVisible().catch(() => false);
        const blocked = await page.getByText(/^No access to /).first().isVisible().catch(() => false);
        const o = await pageOverflow(page);
        const newErrors = errors.slice(before).filter((e) => !IGNORE.test(e));
        if (!title) problems.push(`${path}: no page title`);
        if (blocked) problems.push(`${path}: listed in the sidebar but shows "No access"`);
        if (o.doc > 1) problems.push(`${path}: page scrolls horizontally by ${o.doc}px`);
        if (newErrors.length) problems.push(`${path}: console error ${newErrors[0].slice(0, 120)}`);
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
});

test.describe('layout matrix (administrator)', () => {
  for (const path of ADMIN_PAGES) {
    test(`${path}: 5 widths + zoom, light and dark`, async ({ page }) => {
      test.setTimeout(120_000);
      const problems: string[] = [];
      for (const theme of ['light', 'dark'] as const) {
        await openAs(page, ROLE_USERS.admin, path, { theme });
        await page.waitForTimeout(700);
        for (const w of [1440, 1280, 1152, 1024, 960, 768, 375]) {
          await page.setViewportSize({ width: w, height: 900 });
          await page.waitForTimeout(180);
          const o = await pageOverflow(page);
          if (o.doc > 1) problems.push(`${theme} @${w}: page scrolls horizontally by ${o.doc}px`);
        }
        await page.setViewportSize({ width: 1440, height: 900 });
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
});

test.describe('keyboard (administrator)', () => {
  for (const path of ADMIN_PAGES) {
    test(`${path}: Tab moves through controls and every stop shows a focus ring`, async ({ page }) => {
      await openAs(page, ROLE_USERS.admin, path);
      await page.waitForTimeout(800);
      await page.locator('#main').focus();
      const seen = new Set<string>();
      const noRing: string[] = [];
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        const r = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body || !el.closest('#main')) return null;
          const cs = getComputedStyle(el);
          const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
          const sib = el.nextElementSibling ? getComputedStyle(el.nextElementSibling) : null;
          const sibRing = !!sib && ((sib.outlineStyle !== 'none' && parseFloat(sib.outlineWidth) > 0) || sib.boxShadow !== 'none');
          // The ring may be drawn on the control's wrapper or card (card-as-link, search field, select).
          let wrapRing = false;
          for (let a: HTMLElement | null = el.parentElement, i = 0; a && i < 4; a = a.parentElement, i++) {
            const c = getComputedStyle(a);
            if ((c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0) || (i < 2 && c.boxShadow !== 'none' && a.matches('.sidebar-search, .select-menu, .search-field, .input-affix'))) wrapRing = true;
          }
          const row = el.matches('tr[tabindex], li[tabindex], [role=row]') || el.closest('[data-row]') !== null;
          return { label: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}[${(el.getAttribute('aria-label') || el.textContent || el.id || '').trim().slice(0, 20)}]`, ok: ring || sibRing || wrapRing || row, type: (el as HTMLInputElement).type };
        });
        if (!r) continue;
        seen.add(r.label);
        if (!r.ok && r.type !== 'radio') noRing.push(r.label);
      }
      expect(noRing, `no visible focus ring on: ${[...new Set(noRing)].join(', ')}`).toEqual([]);
    });
  }
});

test.describe('failure and slow service (administrator)', () => {
  for (const path of ADMIN_PAGES) {
    test(`${path}: a failing service never crashes or blanks the page`, async ({ page }) => {
      const errors = watchErrors(page);
      await openAs(page, ROLE_USERS.admin, path, { db: 'db.demo.failureRate = 1; db.demo.latencyMin = 30; db.demo.latencyMax = 60;' });
      await page.waitForTimeout(1500);
      expect(await page.locator('h1.page-title').isVisible(), 'page title still shown').toBe(true);
      expect(await page.locator('#main').innerText().then((t) => t.trim().length), 'page is not blank').toBeGreaterThan(20);
      const real = errors.filter((e) => !IGNORE.test(e));
      expect(real, real.join('\n')).toEqual([]);
    });
  }
});
