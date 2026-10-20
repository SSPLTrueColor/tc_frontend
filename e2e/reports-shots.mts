import { chromium } from '@playwright/test';
import { openAs } from './helpers';
// usage: tsx e2e/reports-shots.mts <user> <outDir> <width> <theme> <path> [<path>...]
const [, , user, out, width, theme, ...paths] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 1500 } });
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
for (const p of paths) {
  await openAs(page, user, p, { theme: theme as 'light' | 'dark' });
  await page.waitForTimeout(1200);
  const name = p.replace(/[^a-z0-9]+/gi, '_');
  await page.screenshot({ path: `${out}/${name}.png` });
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
