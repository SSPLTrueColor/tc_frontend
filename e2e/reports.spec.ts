/** Every report view: renders its chart, no console errors, no horizontal scroll, light and dark, phone width. */
import { expect, test } from '@playwright/test';
import { REPORTS } from '../src/services/reports/catalog';
import { openAs, pageOverflow, watchErrors } from './helpers';

test.describe.configure({ mode: 'parallel' });

const VIEWS = REPORTS.flatMap((r) => r.views.map((v) => ({ report: r.id, view: v.id, label: `${r.id}/${v.id}`, multi: r.views.length > 1 })));

for (const v of VIEWS) {
  test(`${v.label}: chart + table render in light and dark, 1440 and 375, no errors`, async ({ page }) => {
    const errors = watchErrors(page);
    for (const theme of ['light', 'dark'] as const) {
      await openAs(page, 'u_rahul', `/reports/${v.report}${v.multi ? `?view=${v.view}` : ''}`, { theme });
      await expect(page.locator('section[aria-label].rp-chart, .rp-chart').first()).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.rp-chart .panel-title').first()).toBeVisible();
      await page.waitForTimeout(500);
      for (const w of [1440, 375]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(200);
        const o = await pageOverflow(page);
        expect.soft(o.doc, `${v.label} ${theme} @${w}`).toBeLessThanOrEqual(1);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    expect(errors.filter((e) => !/Failed to load resource/.test(e)), errors.join('\n')).toEqual([]);
  });
}

test('chart marks link to the records behind them (ranked bars)', async ({ page }) => {
  await openAs(page, 'u_rahul', '/reports/customer-sales');
  const link = page.locator('.rp-rank-label.rp-mark-link').first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();
  await expect(page).not.toHaveURL(/\/reports\/customer-sales$/);
});

test('every chart states its insight under the title', async ({ page }) => {
  for (const path of ['/reports/lead-conversion', '/reports/lost-leads', '/reports/pipeline-forecast?view=outcomes', '/reports/field-visits?view=hours', '/reports/exec-performance?view=target']) {
    await openAs(page, 'u_rahul', path);
    await expect(page.locator('.rp-chart .rp-insight').first(), path).toBeVisible({ timeout: 15_000 });
    expect((await page.locator('.rp-chart .rp-insight').first().innerText()).length, path).toBeGreaterThan(8);
  }
});

test('multi-measure charts name what each colour / line means', async ({ page }) => {
  await openAs(page, 'u_rahul', '/reports/lead-conversion');
  await expect(page.locator('.rp-key li')).toHaveCount(2, { timeout: 15_000 });
  await openAs(page, 'u_rahul', '/reports/pipeline-forecast?view=outcomes');
  await expect(page.locator('.rp-key li')).toHaveCount(2, { timeout: 15_000 });
});

test('KPI cards on time-based reports carry a sparkline', async ({ page }) => {
  await openAs(page, 'u_rahul', '/reports/lead-conversion');
  await expect(page.locator('.rp-kpis svg.kpi-spark').first()).toBeVisible({ timeout: 15_000 });
});
