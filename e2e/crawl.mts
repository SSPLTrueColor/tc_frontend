import { chromium } from '@playwright/test';
import { openAs } from './helpers';
// Visits every sidebar page + resource list as admin and reports: visible primary buttons, description presence, breadcrumb presence.
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await openAs(page, 'u_rahul', '/dashboard');
const paths = new Set<string>();
// collect links from every module's sidebar by visiting rail items
const rail = await page.locator('nav.rail a.rail-item').evaluateAll((els) => els.map((a) => (a as HTMLAnchorElement).pathname));
for (const r of rail) {
  await page.goto(`http://localhost:5175${r}`);
  await page.waitForTimeout(500);
  const links = await page.locator('.sidebar-scroll a.nav-row').evaluateAll((els) => els.map((a) => (a as HTMLAnchorElement).pathname + (a as HTMLAnchorElement).search.replace(/view=[^&]*/, '')));
  links.forEach((l) => paths.add(l));
}
const out: any[] = [];
for (const p of [...paths].sort()) {
  await page.goto(`http://localhost:5175${p}`);
  await page.waitForTimeout(1300);
  const r = await page.evaluate(() => {
    const main = document.getElementById('main')!;
    const prim = [...main.querySelectorAll('.btn-primary')].filter((b) => (b as HTMLElement).offsetParent && !b.closest('[role=dialog],[role=alertdialog],.drawer'));
    const title = document.querySelector('h1.page-title')?.textContent ?? '';
    const desc = !!main.querySelector('.st-desc, .page-intro, .page-desc');
    const create = [...main.querySelectorAll('button.btn, a.btn')].filter((b) => (b as HTMLElement).offsetParent && !b.closest('[role=dialog],[role=alertdialog],.drawer,.st-savebar') && /^\s*(New|Add|Create|Log|Start|Import|Upload)\b/i.test(b.textContent ?? '')).map((b) => `${(b.textContent ?? '').trim()}|${b.className.match(/btn-(primary|secondary|ghost|danger)/)?.[1]}`);
    return { primary: prim.filter((b) => !b.closest('.st-savebar:not(.is-open)')).map((b) => (b.textContent ?? '').trim()), title, desc, crumb: !!document.querySelector('.crumbs, .breadcrumb'), create };
  });
  out.push({ path: p, ...r });
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
