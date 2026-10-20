import { expect, test } from '@playwright/test';
import { openAs, pageOverflow, watchErrors } from './helpers';

test('sales workspace, conversion card and responsive layouts', async ({ page }) => {
  const errors = watchErrors(page);
  await openAs(page, 'u_karan', '/sales', { theme: 'light' });
  await expect(page.getByRole('heading', { name: 'Leads & Opportunities', exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('navigation', { name: 'Sales workspace' }).getByRole('link', { name: 'Leads', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Sales workspace' })).toBeVisible();
  await page.goto('/leads?view=v_leads_board');
  await page.waitForTimeout(1000);
  // The saved board uses the same qualification dialog as record details.
  const convert = page.getByRole('button', { name: 'Create Opportunity', exact: true });
  await expect(convert.first()).toBeVisible();
  await convert.first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.screenshot({ path: '/tmp/tc-lead-board.png', fullPage: true });
  for (const path of ['/sales', '/opportunities', '/quotations', '/sales-orders', '/machines', '/tickets']) {
    await page.goto(path);
    await page.waitForTimeout(900);
    await expect(page.locator('h1.page-title')).toBeVisible();
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(350);
      expect((await pageOverflow(page)).doc, `${path} at ${width}`).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  expect(errors).toEqual([]);
});

test('quotation origin, active history and revision board', async ({ page }) => {
  const errors = watchErrors(page);
  await openAs(page, 'u_vikram', '/quotations', { theme: 'light' });
  const id = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tc.crm.db.v1')!);
    return db.records.quotations.find((q: { opportunityId: string; isLatest: boolean }) => q.isLatest && db.records.opportunities.some((o: { id: string; leadId?: string }) => o.id === q.opportunityId && o.leadId))?.id;
  });
  expect(id).toBeTruthy();
  await page.goto(`/quotations/${id}`);
  await expect(page.getByRole('button', { name: /Open Lead ·/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Versions', exact: true }).click();
  await expect(page.getByText(/v\d+ · Active/)).toBeVisible();
  await page.goto('/quotations?view=v_quotes_board');
  await expect(page.getByText('Under Revision', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: '/tmp/tc-quotation-board.png', fullPage: true });
  expect(errors).toEqual([]);
});
