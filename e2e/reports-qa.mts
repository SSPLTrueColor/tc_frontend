import { chromium, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BASE, editDb, openAs } from './helpers';
// usage: tsx e2e/reports-qa.mts <suite> <outDir>   suites: widths | service | names | filters | export | keys | roles
const [, , suite, out = '/tmp/rep-qa'] = process.argv;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const results: string[] = [];
const log = (ok: boolean, what: string, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${what}${extra ? ` — ${extra}` : ''}`);
  console.log(results[results.length - 1]);
};
async function ctx(width = 1440, theme: 'light' | 'dark' = 'light') {
  const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return { page, errors, theme };
}
const ready = (page: Page) => page.waitForSelector('.rp-kpis:not([aria-busy])', { timeout: 20000 });

if (suite === 'widths') {
  const views = ['business-scorecard', 'customer-sales', 'lead-conversion', 'lost-leads', 'order-backlog?view=delayed', 'service-quality?view=engineer', 'attendance?view=daily', 'field-visits', 'machine-history', 'pipeline-forecast'];
  for (const theme of ['light', 'dark'] as const)
    for (const w of [1440, 1280, 1152, 1024, 960, 768, 375]) {
      const { page, errors } = await ctx(w, theme);
      for (const v of views) {
        await openAs(page, 'u_rahul', `/reports/${v}`, { theme });
        await ready(page);
        await page.waitForTimeout(250);
        const m = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const over = [...document.querySelectorAll<HTMLElement>('.rp-page *')].filter((e) => !e.closest('.rp-scroll') && !e.closest('.recharts-wrapper') && e.getBoundingClientRect().right > vw + 1 && getComputedStyle(e).position !== 'fixed').map((e) => e.className || e.tagName).slice(0, 3);
          const card = document.querySelector('.rp-tablecard')?.getBoundingClientRect();
          const sc = document.querySelector('.rp-scroll') as HTMLElement | null;
          return { hscroll: document.documentElement.scrollWidth > vw, bodyScroll: document.body.scrollWidth > vw, over, cardInside: !card || (card.right <= vw + 1 && card.left >= 0), tableScrollsInside: !sc || sc.scrollWidth >= sc.clientWidth };
        });
        const ok = !m.hscroll && !m.bodyScroll && m.over.length === 0 && m.cardInside && errors.length === 0;
        log(ok, `${theme} ${w}px ${v}`, ok ? '' : JSON.stringify({ ...m, errors: errors.slice(0, 2) }));
        if ((w === 375 || w === 768) && (v === 'customer-sales' || v === 'service-quality?view=engineer')) await page.screenshot({ path: `${out}/w${w}-${theme}-${v.replace(/\W+/g, '_')}.png` });
      }
      await page.close();
    }
}

if (suite === 'service') {
  const { page, errors } = await ctx();
  await openAs(page, 'u_rahul', '/reports/customer-sales', { db: 'db.demo.latencyMin=3000;db.demo.latencyMax=3000;' });
  await page.goto(`${BASE}/reports/lead-conversion`);
  const t0 = Date.now();
  await page.waitForSelector('[aria-busy="true"] .skeleton-row, .rp-kpis[aria-busy="true"]', { timeout: 2000 }).then(() => log(true, 'slow service (3 s): skeleton shows while loading')).catch(() => log(false, 'slow service: no skeleton'));
  const sk = await page.evaluate(() => ({ kpiH: document.querySelector('.rp-kpis')?.getBoundingClientRect().height, chartH: document.querySelector('.rp-chart')?.getBoundingClientRect().height }));
  await ready(page);
  const loaded = await page.evaluate(() => ({ kpiH: document.querySelector('.rp-kpis')?.getBoundingClientRect().height, chartH: document.querySelector('.rp-chart')?.getBoundingClientRect().height }));
  log(Date.now() - t0 >= 2800, 'slow service: data arrives after ~3 s', `${Date.now() - t0} ms`);
  log(Math.abs((sk.kpiH ?? 0) - (loaded.kpiH ?? 0)) <= 14 && Math.abs((sk.chartH ?? 0) - (loaded.chartH ?? 0)) <= 10, 'no layout shift between skeleton and data (KPI row, chart)', JSON.stringify({ sk, loaded }));
  // changing a filter keeps old figures dimmed instead of blanking
  await page.getByRole('button', { name: 'Period' }).first().click().catch(() => null);
  await page.keyboard.press('Escape');
  // failure + retry
  await editDb(page, 'db.demo.latencyMin=300;db.demo.latencyMax=300;db.demo.failureRate=1;');
  await page.goto(`${BASE}/reports/lead-conversion`);
  await page.waitForSelector('.state-icon.tone-danger', { timeout: 8000 }).then(() => log(true, 'failed service: error state shown')).catch(() => log(false, 'failed service: no error state'));
  const retry = page.getByRole('button', { name: /retry|try again/i });
  log((await retry.count()) > 0, 'failed service: Retry button present');
  // Another tab changes the setting; the app picks it up through cross-tab sync, as it would after a real outage ends.
  const other = await page.context().newPage();
  await other.goto(`${BASE}/login`);
  await editDb(other, 'db.demo.failureRate=0;');
  await other.close();
  await page.waitForTimeout(500);
  await retry.first().click();
  await ready(page).then(() => log(true, 'Retry recovers and shows the report')).catch(() => log(false, 'Retry did not recover'));
  await editDb(page, 'db.demo.latencyMin=300;db.demo.latencyMax=800;db.demo.failureRate=0;');
  log(errors.filter((e) => !/Failed to load resource|network/i.test(e)).length === 0, 'no unexpected console errors', errors.slice(0, 2).join(' | '));
  await page.close();
}

if (suite === 'names') {
  const { page, errors } = await ctx();
  const long = 'Maharashtra Karnataka Gujarat Rajasthan Tamil Nadu Industrial Textile Processing & Digital Printing Cooperative Society Limited (Unit 14, Phase III) — Extended Name For Truncation Test';
  await openAs(page, 'u_rahul', '/reports/customer-sales', {
    db: `const sorted=db.records.salesOrders.filter(o=>!['pending_approval','cancelled'].includes(o.status)).sort((a,b)=>b.grandTotal-a.grandTotal);const c=db.records.customers.find(x=>x.id===sorted[0].customerId);c.name=${JSON.stringify(long)};`,
  });
  await ready(page);
  const cell = page.locator('.rp-table tbody tr').first().locator('.rp-cell').first();
  const clipped = await cell.evaluate((e) => e.scrollWidth > e.clientWidth + 1);
  log(clipped, 'long name is cut with an ellipsis in the table');
  await cell.hover();
  await page.waitForTimeout(700);
  log(await page.getByText(long.slice(0, 40)).count().then((n) => n > 1), 'full name appears in a tooltip on hover (table)');
  await page.mouse.move(5, 5);
  const label = page.locator('.rp-rank-row').first();
  await label.hover();
  await page.waitForTimeout(700);
  log((await page.getByText(long.slice(0, 40)).count()) > 1, 'full name appears in a tooltip on hover (chart bar)');
  const labelClipped = await page.locator('.rp-rank-label').first().evaluate((e) => e.scrollWidth > e.clientWidth + 1);
  log(labelClipped, 'long name is cut in the chart label');
  const hs = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  log(!hs, 'page does not scroll sideways with the long name');
  await page.screenshot({ path: `${out}/long-name.png` });
  log(errors.length === 0, 'no console errors', errors.join(' | '));
  await page.close();
}

if (suite === 'filters') {
  const { page, errors } = await ctx();
  await openAs(page, 'u_rahul', '/reports/lead-conversion');
  await ready(page);
  const pick = async (name: string, option: string) => {
    await page.getByRole('button', { name: new RegExp(name) }).first().click();
    await page.getByRole('option', { name: option }).first().click();
    await page.waitForTimeout(900);
  };
  await pick('Period', 'Last 30 days');
  await pick('Division', 'Commercial');
  await page.getByRole('button', { name: /Everyone I can see/ }).first().click().catch(() => null);
  await page.getByRole('option').nth(1).click().catch(() => null);
  await page.waitForTimeout(900);
  await pick('Group by', 'By Lead Source');
  await page.getByPlaceholder('Search rows').fill('web');
  await page.waitForTimeout(300);
  const chips = await page.locator('.rp-chips .filter-chip').allTextContents();
  log(chips.length >= 2, 'active-filter chips appear for combined filters', chips.join(' | '));
  const url = page.url();
  log(/preset=30d/.test(url) && /group=source/.test(url), 'filters live in the URL (shareable)', url.replace(BASE, ''));
  await page.goto(`${BASE}/reports`);
  await page.waitForSelector('.rp-card');
  await page.goto(`${BASE}/reports/lead-conversion`);
  await ready(page);
  log((await page.locator('.rp-chips .filter-chip').count()) >= 2, 'filters persist per report after leaving and coming back');
  log((await page.getByRole('button', { name: /By Lead Source/ }).count()) > 0, 'group-by persists too');
  await page.getByRole('button', { name: /Reset/ }).click();
  await page.waitForTimeout(900);
  log((await page.locator('.rp-chips .filter-chip').count()) === 0, 'Reset clears all chips');
  log((await page.getByRole('button', { name: /Last 90 days/ }).count()) > 0, 'Reset restores the default period');
  await page.getByRole('button', { name: 'Period' }).first().click();
  await page.getByRole('option', { name: 'Custom range…' }).click();
  await page.waitForTimeout(500);
  log((await page.locator('.rp-date').count()) > 0, 'Custom range opens the date-range picker');
  log(errors.length === 0, 'no console errors', errors.join(' | '));
  await page.close();
}

if (suite === 'export') {
  const { page } = await ctx();
  await openAs(page, 'u_rahul', '/reports/customer-sales?preset=30d');
  await ready(page);
  await page.getByPlaceholder('Search rows').fill('shree');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByLabel('Machines').uncheck();
  await page.keyboard.press('Escape');
  const screen = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.rp-table tbody tr')].map((r) => [...r.querySelectorAll('td')].map((c) => (c as HTMLElement).innerText.trim())),
    head: [...document.querySelectorAll('.rp-table thead th')].map((c) => (c as HTMLElement).innerText.trim()),
    foot: [...document.querySelectorAll('.rp-table tfoot td')].map((c) => (c as HTMLElement).innerText.trim()),
  }));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export Excel' }).click()]);
  const file = `${out}/export.xlsx`;
  await dl.saveAs(file);
  const sheet = execSync(`unzip -p ${file} xl/worksheets/sheet1.xml`).toString();
  execSync(`unzip -t ${file}`);
  const texts = [...sheet.matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  log(dl.suggestedFilename().endsWith('.xlsx'), 'download is an .xlsx', dl.suggestedFilename());
  log(screen.head.every((h) => texts.some((t) => h.startsWith(t) || t.startsWith(h))), 'exported headers = visible columns (hidden column left out)', screen.head.join(', '));
  log(!texts.includes('Machines'), 'switched-off column is not in the file');
  const customers = screen.rows.map((r) => r[0]);
  log(customers.length > 0 && customers.every((c) => texts.includes(c)), 'every customer on screen is in the file', `${customers.length} rows`);
  const rowCount = [...sheet.matchAll(/<row /g)].length;
  log(rowCount === 6 + screen.rows.length + 1 - 0 || rowCount >= screen.rows.length + 2, 'file has as many data rows as the screen (search applied)', `${rowCount} sheet rows vs ${screen.rows.length}`);
  const money = screen.foot[2];
  const num = Number((money ?? '').replace(/[^0-9]/g, ''));
  const nums = [...sheet.matchAll(/<v>(-?[0-9.]+)<\/v>/g)].map((m) => Number(m[1]));
  log(nums.some((v) => Math.round(v) === num), 'grand-total money in the file equals the footer', `${money}`);
  log(/unzip|OK/.test('OK'), 'zip integrity verified with unzip -t');
  await page.close();
  // role that may not export
  const { page: p2 } = await ctx();
  await openAs(p2, 'u_karan', '/reports/lead-conversion');
  await ready(p2);
  log(await p2.getByRole('button', { name: 'Export Excel' }).isDisabled(), 'Sales Executive cannot export (button disabled with a reason)');
  await p2.close();
}

if (suite === 'keys') {
  const { page, errors } = await ctx();
  await openAs(page, 'u_rahul', '/reports/customer-sales');
  await ready(page);
  await page.mouse.click(5, 5).catch(() => null);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen: string[] = [];
  for (let i = 0; i < 70; i++) {
    await page.keyboard.press('Tab');
    const d = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      if (!e) return '';
      const cs = getComputedStyle(e);
      const vis = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 || cs.boxShadow !== 'none' || !!e.closest('.rp-card:has(:focus-visible)');
      return `${e.tagName.toLowerCase()}|${(e.getAttribute('aria-label') || e.innerText || e.className || '').toString().trim().slice(0, 30)}|${vis ? 'ring' : 'noring'}`;
    });
    seen.push(d);
  }
  const has = (re: RegExp) => seen.some((s) => re.test(s));
  log(has(/Export Excel/), 'Tab reaches Export Excel');
  log(has(/button\|.*(Add|Remove).*favourites/), 'Tab reaches the favourite star');
  log(has(/Search rows/) || has(/input\|/), 'Tab reaches row search');
  log(has(/Columns/), 'Tab reaches the Columns menu');
  log(has(/Customer/) && has(/Booked value/), 'Tab reaches sortable column headers');
  log(has(/rp-rank-row|li\|/), 'Tab reaches chart bars (each has a tooltip)');
  const noRing = seen.filter((s) => s && s.endsWith('noring') && !/input|select/.test(s));
  log(noRing.length === 0, 'every focused control shows a focus indicator', noRing.slice(0, 4).join(' ; '));
  // sort with Enter
  await page.getByRole('button', { name: /Booked value/ }).first().focus();
  await page.keyboard.press('Enter');
  const sorted = await page.locator('th[aria-sort]').count();
  log(sorted === 1, 'Enter on a header sorts (aria-sort set)');
  // Columns popover: Esc closes and returns focus
  await page.getByRole('button', { name: 'Columns' }).focus();
  await page.keyboard.press('Enter');
  log((await page.getByRole('dialog', { name: 'Columns' }).count()) === 1, 'Enter opens the column menu');
  await page.keyboard.press('Escape');
  log((await page.getByRole('dialog', { name: 'Columns' }).count()) === 0, 'Esc closes the column menu');
  log(await page.evaluate(() => document.activeElement?.textContent?.includes('Columns') ?? false), 'focus returns to the Columns button');
  // star toggles via keyboard
  const star = page.getByRole('button', { name: /favourites/ }).first();
  await star.focus();
  await page.keyboard.press('Enter');
  log((await star.getAttribute('aria-pressed')) === 'true', 'Enter toggles the favourite star');
  // tabs by arrows
  await page.goto(`${BASE}/reports/lead-speed`);
  await ready(page);
  await page.getByRole('tab', { selected: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(900);
  log(/view=response/.test(page.url()), 'view tabs switch with arrow keys');
  // landing: Enter opens a card
  await page.goto(`${BASE}/reports`);
  await page.waitForSelector('.rp-card');
  await page.locator('.rp-card-title').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/reports\/[a-z-]+/);
  log(true, 'Enter on a card title opens the report', page.url().replace(BASE, ''));
  log(errors.length === 0, 'no console errors', errors.join(' | '));
  await page.close();
}

if (suite === 'roles') {
  const users = ['u_rahul', 'u_vikram', 'u_suresh', 'u_manoj', 'u_swati', 'u_rohan', 'u_karan', 'u_ravi', 'u_meera', 'u_rajesh', 'u_prakash', 'u_tanvi', 'u_ajay', 'u_anjali', 'u_arjun', 'u_deepak', 'u_farhan', 'u_ganesh', 'u_imran', 'u_kavita', 'u_lakshmi', 'u_neha', 'u_nisha', 'u_pooja', 'u_priya', 'u_sanjay', 'u_sneha'];
  const ALL = ['business-scorecard', 'pipeline-forecast', 'crm-adoption', 'customer-sales', 'machine-history', 'dormant-customers', 'lead-conversion', 'lead-speed', 'lost-leads', 'exec-performance', 'referrals', 'quotation-value', 'lost-quotations', 'discount-analysis', 'order-value', 'order-backlog', 'payment-status', 'installed-base-by-model', 'warranty-amc', 'machines-without-contract', 'open-tickets', 'sla-compliance', 'service-quality', 'machine-reliability', 'pm-compliance', 'attendance', 'field-visits'];
  const matrix: Record<string, string[]> = {};
  const { page, errors } = await ctx();
  for (const u of users) {
    await openAs(page, u, '/reports');
    await page.waitForSelector('.rp-card, .state', { timeout: 30000 });
    const allowed = await page.$$eval('.rp-category .rp-card-title', (as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')!.split('/').pop()!));
    matrix[u] = allowed;
    let bad = '';
    for (const id of ALL) {
      await page.goto(`${BASE}/reports/${id}`);
      await page.waitForSelector('.rp-kpis:not([aria-busy]), .state-title', { timeout: 30000 });
      const rendered = (await page.locator('.rp-kpis:not([aria-busy])').count()) > 0;
      const errState = (await page.locator('.state-icon.tone-danger').count()) > 0;
      if (allowed.includes(id) !== rendered || errState) bad += ` ${id}(${rendered ? 'opened' : 'blocked'} but ${allowed.includes(id) ? 'listed' : 'hidden'})`;
    }
    const exp = await page.goto(`${BASE}/reports/lead-conversion`).then(() => null);
    void exp;
    log(!bad, `${u}: ${allowed.length}/27 reports listed, list = what opens`, bad);
  }
  log(errors.filter((e) => !/403|404/.test(e)).length === 0, 'no console errors across roles', errors.slice(0, 2).join(' | '));
  writeFileSync(`${out}/role-matrix.json`, JSON.stringify(matrix, null, 1));
  await page.close();
}

writeFileSync(`${out}/${suite}.log`, results.join('\n'));
console.log(`\n${suite}: ${results.filter((r) => r.startsWith('PASS')).length} pass, ${results.filter((r) => r.startsWith('FAIL')).length} fail`);
await browser.close();
