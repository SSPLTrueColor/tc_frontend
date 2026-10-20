import { chromium, type Page } from '@playwright/test';
import { openAs } from './helpers';
const [, , user = 'u_rohan', view = 'M', out = 'cal.png', width = '1440', theme = 'light', extra = ''] = process.argv;
const browser = await chromium.launch();
const page: Page = await browser.newPage({ viewport: { width: Number(width), height: 900 } });
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await openAs(page, user, '/calendar', { theme: theme as 'light' | 'dark' });
await page.waitForSelector('.fc-view');
await page.keyboard.press(view.toLowerCase());
await page.waitForTimeout(500);
if (extra === 'quick') {
  await page.keyboard.press('c');
  await page.waitForTimeout(300);
}
if (extra === 'detail') {
  await page.locator('.fc-event').first().click();
  await page.waitForTimeout(300);
}
await page.screenshot({ path: out });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
