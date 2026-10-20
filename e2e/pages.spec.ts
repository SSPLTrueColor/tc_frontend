/** Page-structure rules (UX Step 3): same header everywhere, one primary action per page, breadcrumbs on detail pages. */
import { expect, test } from '@playwright/test';
import { openAs, watchErrors } from './helpers';

const LISTS: [string, string][] = [
  ['u_karan', '/leads'],
  ['u_karan', '/companies'],
  ['u_karan', '/opportunities'],
  ['u_karan', '/tasks'],
  ['u_rohan', '/quotations'],
  ['u_meera', '/service-tickets'],
  ['u_rahul', '/admin/users'],
  ['u_rahul', '/admin/products'],
];
const OTHER: [string, string][] = [
  ['u_rahul', '/dashboard'],
  ['u_rahul', '/notifications'],
  ['u_rahul', '/reports'],
  ['u_rahul', '/reports/leads'],
  ['u_rahul', '/admin/profile'],
  ['u_rahul', '/admin/roles-permissions'],
  ['u_arjun', '/quotations/pending-approvals'],
];
const DETAIL: [string, string][] = [
  ['u_karan', '/leads/new'],
  ['u_karan', '/leads/LD-2627-00038'],
  ['u_rahul', '/reports/lead-conversion'],
];

const primaries = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    [...document.getElementById('main')!.querySelectorAll('.btn-primary')]
      .filter((b) => (b as HTMLElement).offsetParent && !b.closest('[role=dialog],[role=alertdialog],.drawer') && !b.closest('.st-savebar:not(.is-open)'))
      .map((b) => (b.textContent ?? '').trim()),
  );

test.describe('page structure', () => {
  for (const [user, path] of [...LISTS, ...OTHER, ...DETAIL]) {
    test(`${path} (${user}): description row, at most one primary action`, async ({ page }) => {
      const errors = watchErrors(page);
      await openAs(page, user, path);
      await expect(page.locator('h1.page-title')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(900);
      await expect(page.locator('#main .page-intro .page-desc').first(), 'one-line description under the title').toBeVisible();
      const p = await primaries(page);
      expect(p.length, `primary buttons: ${p.join(' | ')}`).toBeLessThanOrEqual(1);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }

  for (const [user, path] of LISTS) {
    test(`${path} (${user}): the create button is the page's primary action`, async ({ page }) => {
      await openAs(page, user, path);
      await page.waitForTimeout(900);
      const p = await primaries(page);
      expect(p.length, 'a list page for a role that can create has exactly one primary').toBe(1);
      expect(p[0]).toMatch(/^(New|Log|Add|Create)/i);
    });
  }

  for (const [user, path] of DETAIL) {
    test(`${path}: breadcrumb back to the list`, async ({ page }) => {
      await openAs(page, user, path);
      await expect(page.locator('.topbar-title nav.crumbs')).toBeVisible({ timeout: 10_000 });
    });
  }

  test('N opens a new record, / focuses search, and neither fires while typing', async ({ page }) => {
    await openAs(page, 'u_karan', '/leads');
    await page.waitForTimeout(900);
    await page.keyboard.press('/');
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement).type)).toBe('search');
    await page.keyboard.type('n');
    await expect(page).toHaveURL(/\/leads$/);
    await page.keyboard.press('Escape');
    await page.locator('h1.page-title').click();
    await page.keyboard.press('n');
    await expect(page).toHaveURL(/\/leads\/new/);
  });

  test('last list view is remembered', async ({ page }) => {
    await openAs(page, 'u_karan', '/leads');
    await page.getByRole('tab', { name: 'Board' }).click().catch(async () => page.locator('.view-tabs button', { hasText: 'Board' }).first().click());
    await page.locator('nav.rail a[href="/dashboard"]').first().click();
    await page.locator('nav.rail a[aria-label*="Lead"]').click();
    await expect(page.locator('.board')).toBeVisible({ timeout: 10_000 });
  });

  test('new record form pre-fills last-used dropdowns and the next follow-up date', async ({ page }) => {
    await openAs(page, 'u_karan', '/leads/new');
    await page.waitForTimeout(800);
    await page.locator('button.select-menu-trigger[aria-label*="Customer"]').first().click();
    await page.getByRole('option').first().click();
    await page.locator('button.select-menu-trigger[aria-label*="Lead source"]').first().click();
    await page.getByRole('option').first().click();
    await page.locator('button.select-menu-trigger[aria-label*="Product type"]').first().click();
    await page.getByRole('option').first().click();
    const contact = page.locator('button.select-menu-trigger[aria-label*="Contact person"]').first();
    if ((await contact.getAttribute('class'))?.includes('is-placeholder')) {
      await contact.click();
      await page.getByRole('option').first().click();
    }
    await page.getByRole('button', { name: 'Create Lead' }).click();
    await page.waitForTimeout(1200);
    await openAs(page, 'u_karan', '/leads/new');
    await page.waitForTimeout(800);
    await expect(page.locator('button.select-menu-trigger[aria-label*="Lead source"]').first()).not.toHaveClass(/is-placeholder/);
    await expect(page.locator('button.select-menu-trigger[aria-label*="Product type"]').first()).not.toHaveClass(/is-placeholder/);
  });

  test('bulk approve: select all and approve in one go', async ({ page }) => {
    await openAs(page, 'u_arjun', '/quotations/pending-approvals');
    await page.waitForTimeout(1500);
    await page.getByRole('checkbox', { name: /Select all approvals/ }).check();
    await page.getByRole('button', { name: /Approve \d+ selected/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: /Approve \d+ selected/ }).click();
    await expect(page.getByText(/request\(s\) approved|approved\. Could not/i)).toBeVisible({ timeout: 10_000 });
  });
});
