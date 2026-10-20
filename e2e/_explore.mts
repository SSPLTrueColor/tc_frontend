import { chromium } from '@playwright/test';
import { openAs } from './helpers';
const [user, ...paths] = process.argv.slice(2);
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs: string[] = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
page.on('pageerror', (e) => errs.push(String(e)));
await openAs(page, user, paths[0], { theme: 'light' });
for (const p of paths) {
  if (p !== paths[0]) { await page.goto('http://localhost:5175' + p); await page.waitForLoadState('networkidle'); }
  await page.waitForTimeout(1200);
  console.log('=====', p, page.url());
  console.log(await page.locator('main').first().ariaSnapshot());
}
console.log('ERRORS', errs);
await b.close();
