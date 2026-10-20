import { chromium } from '@playwright/test';
import { openAs } from './helpers';
const [, , user, path, ...clicks] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await openAs(page, user, path);
await page.waitForTimeout(1200);
for (const c of clicks) { await page.getByText(c, { exact: false }).first().click(); await page.waitForTimeout(700); }
const info = await page.evaluate(() => {
  const root = (document.querySelector('[role=dialog]') ?? document.getElementById('main')!) as HTMLElement;
  return {
    url: location.pathname,
    root: root.getAttribute('role') ?? 'main',
    buttons: [...root.querySelectorAll('button, a.btn')].filter((e) => (e as HTMLElement).offsetParent !== null).map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40)).filter(Boolean).slice(0, 40),
    inputs: [...root.querySelectorAll('input, textarea, button.select-menu-trigger')].filter((e) => (e as HTMLElement).offsetParent !== null).map((i) => (i.getAttribute('aria-label') || (i as HTMLInputElement).placeholder || i.id || i.textContent || '').trim().slice(0, 30)).slice(0, 30),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
