/** Writes e2e/routes.json: every page each demo role can reach from the sidebar (rail → every module → every nav link). */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { openAs, BASE } from './helpers';
import { ROLE_USERS } from './pages';

const out: Record<string, string[]> = {};
const browser = await chromium.launch();
for (const [role, user] of Object.entries(ROLE_USERS)) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await openAs(page, user, '/dashboard');
  const paths = new Set<string>();
  const rail = await page.locator('nav.rail a.rail-item').evaluateAll((els) => els.map((a) => (a as HTMLAnchorElement).pathname));
  for (const r of rail) {
    await page.goto(`${BASE}${r}`);
    await page.waitForTimeout(450);
    const links = await page.locator('.sidebar-scroll a.nav-row').evaluateAll((els) => els.map((a) => (a as HTMLAnchorElement).pathname));
    links.forEach((l) => paths.add(l));
    paths.add(r);
  }
  out[role] = [...paths].sort();
  console.log(role, out[role].length);
  await page.close();
}
await browser.close();
writeFileSync(new URL('./routes.json', import.meta.url), JSON.stringify(out, null, 1));
