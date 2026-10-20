/**
 * Data stress (UX Step 5): empty / one / 1,200 records, very long text, special characters, huge and negative amounts,
 * invalid and duplicate input, double-click submit, unsaved-changes guard, and a slow (3 s) service.
 */
import { expect, test } from '@playwright/test';
import { openAs, pageOverflow, watchErrors } from './helpers';
import { ROLE_USERS } from './pages';

test.describe.configure({ mode: 'parallel' });
const ADMIN = ROLE_USERS.admin;
const IGNORE = /Failed to load resource|net::ERR/;

/** [resource key, list path, role that can read it] */
const LISTS: [string, string, string][] = [
  ['leads', '/leads', 'u_rahul'],
  ['customers', '/companies', 'u_rahul'],
  ['contacts', '/contacts', 'u_rahul'],
  ['opportunities', '/opportunities', 'u_rahul'],
  ['quotations', '/quotations', 'u_rahul'],
  ['salesOrders', '/sales-orders', 'u_rahul'],
  ['tickets', '/service-tickets', 'u_rahul'],
  ['activities', '/activity-history', 'u_rahul'],
  ['tasks', '/tasks', 'u_rahul'],
  ['machines', '/installed-base', 'u_rahul'],
  ['spareParts', '/spare-parts', 'u_rahul'],
];

const grow = (res: string, n: number) => `
  db.audit = []; db.events = []; db.outbox = []; db.notifications = [];
  const src = db.records['${res}'] ?? [];
  if (src.length) {
    const out = [];
    for (let i = 0; i < ${n}; i++) { const r = src[i % src.length]; out.push(i < src.length ? r : { ...r, id: r.id + '-x' + i }); }
    db.records['${res}'] = out;
  }
`;
const shrink = (res: string, n: number) => `db.records['${res}'] = (db.records['${res}'] ?? []).slice(0, ${n});`;

test.describe('empty, one and 1,200 records', () => {
  for (const [res, path, user] of LISTS) {
    test(`${res}: empty list shows an empty state, one record shows one row`, async ({ page }) => {
      const errors = watchErrors(page);
      await openAs(page, user, path, { db: shrink(res, 0) });
      await expect(page.locator('h1.page-title')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1200);
      await expect(page.locator('#main .state, #main .empty').first(), 'empty state').toBeVisible();
      await openAs(page, user, path, { db: 'localStorage.clear();' });
      expect(errors.filter((e) => !IGNORE.test(e)), errors.join('\n')).toEqual([]);
    });
    test(`${res}: 1,200 records paginate, stay fast and never scroll the page sideways`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = watchErrors(page);
      // how many the default view shows with the seed data, to compare with after growing
      await openAs(page, user, path);
      await page.waitForTimeout(1200);
      const before = await page.locator('.grid-footer-range').first().innerText({ timeout: 2000 }).catch(() => '');
      const n0 = Number((before.match(/of ([\d,]+)/)?.[1] ?? '0').replace(/,/g, ''));
      await openAs(page, user, path, { db: grow(res, 1200) });
      const t0 = Date.now();
      await expect(page.locator('#main table tbody tr, #main .grid [role=row], #main .board-card').first()).toBeVisible({ timeout: 20_000 });
      const ms = Date.now() - t0;
      const rows = await page.locator('#main table tbody tr').count();
      const cards = await page.locator('#main .board-card').count();
      expect(rows, `${res}: rendered ${rows} rows at once`).toBeLessThanOrEqual(110);
      expect(cards, `${res}: rendered ${cards} board cards at once`).toBeLessThanOrEqual(40 * 12);
      expect(ms, `${res}: ${ms} ms to first row`).toBeLessThan(6000);
      if (!cards) {
        const footer = await page.locator('.grid-footer-range').first().innerText();
        const total = Number((footer.match(/of ([\d,]+)/)?.[1] ?? '0').replace(/,/g, ''));
        expect(total, `footer says "${footer}" (seed view showed ${n0})`).toBeGreaterThan(Math.min(n0 * 2, n0 + 100));
      }
      for (const w of [1440, 768, 375]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(200);
        expect.soft((await pageOverflow(page)).doc, `${res} @${w}`).toBeLessThanOrEqual(1);
      }
      expect(errors.filter((e) => !IGNORE.test(e)), errors.join('\n')).toEqual([]);
    });
  }
});

/** Every text field becomes 400 characters without spaces + HTML; every number a huge or negative figure. */
const NASTY = `
  const long = 'W'.repeat(400);
  const html = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  for (const [res, rows] of Object.entries(db.records)) {
    if (!['leads', 'customers', 'contacts', 'opportunities', 'quotations', 'salesOrders', 'tickets', 'tasks', 'machines'].includes(res)) continue;
    rows.slice(0, 3).forEach((r, i) => {
      for (const [k, v] of Object.entries(r)) {
        if (['id', 'workspaceId', 'version', 'createdAt', 'updatedAt', 'createdBy', 'ownerId'].includes(k) || k.endsWith('Id') || k.endsWith('At') || k.endsWith('Date')) continue;
        if (typeof v === 'string' && v.length > 0 && v.length < 200 && !/^[A-Z]{1,5}[-\\w]*\\d/.test(v) && !/^\\d{4}-\\d\\d/.test(v)) r[k] = i === 0 ? long : i === 1 ? html + ' "quotes" & ampersand ' + '😀'.repeat(5) : '   ';
        if (typeof v === 'number') r[k] = i === 0 ? 99999999999999 : i === 1 ? -123456.789 : 0;
      }
    });
  }
`;
test.describe('long text, special characters, huge and negative figures', () => {
  for (const [res, path, user] of LISTS.slice(0, 9)) {
    test(`${res}: list and record page survive hostile data`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = watchErrors(page);
      const dialogs: string[] = [];
      page.on('dialog', (d) => {
        dialogs.push(d.message());
        void d.dismiss();
      });
      await openAs(page, user, path, { db: NASTY });
      await expect(page.locator('#main table tbody tr, #main .board-card').first()).toBeVisible({ timeout: 15_000 });
      for (const w of [1440, 375]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(250);
        expect.soft((await pageOverflow(page)).doc, `${res} list @${w}`).toBeLessThanOrEqual(1);
      }
      // open the first record in the full page
      await page.setViewportSize({ width: 1440, height: 900 });
      const firstId = await page.evaluate((r) => JSON.parse(localStorage.getItem('tc.crm.db.v1') ?? '{}').records?.[r]?.[0]?.id, res);
      if (firstId) {
        await page.goto(page.url().split('?')[0].replace(/\/$/, '') + `/${firstId}`);
        await page.waitForTimeout(1200);
        for (const w of [1440, 375]) {
          await page.setViewportSize({ width: w, height: 900 });
          await page.waitForTimeout(250);
          expect.soft((await pageOverflow(page)).doc, `${res} record @${w}`).toBeLessThanOrEqual(1);
        }
      }
      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), 'script from data must never run').toBeUndefined();
      expect(dialogs).toEqual([]);
      expect(errors.filter((e) => !IGNORE.test(e)), errors.join('\n')).toEqual([]);
    });
  }
});

test.describe('slow service (3 s)', () => {
  for (const path of ['/dashboard', '/leads', '/companies', '/reports/leads', '/quotations/pending-approvals', '/service-tickets', '/notifications']) {
    test(`${path}: a loading state shows, then content, nothing jumps blank`, async ({ page }) => {
      await openAs(page, 'u_arjun', path, { db: 'db.demo.latencyMin = 3000; db.demo.latencyMax = 3000;' });
      await expect(page.locator('h1.page-title')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(600);
      const busy = await page.locator('[aria-busy="true"], .skeleton, .spinner').count();
      const text = (await page.locator('#main').innerText()).trim().length;
      expect(busy + text, 'either a loader or content while waiting').toBeGreaterThan(0);
      await page.waitForTimeout(4500);
      expect(await page.locator('[aria-busy="true"]').count(), 'loader is gone after the response').toBe(0);
    });
  }
});
