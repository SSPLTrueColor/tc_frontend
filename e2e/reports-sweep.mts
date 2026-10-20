import { chromium } from '@playwright/test';
import { openAs } from './helpers';
// usage: tsx e2e/reports-sweep.mts <user> <outDir|-> <width> <theme>
const [, , user, out, width = '1440', theme = 'light'] = process.argv;
export const REPORTS: [string, string[]][] = [
  ['business-scorecard', ['']], ['pipeline-forecast', ['stage', 'owner']], ['crm-adoption', ['']],
  ['customer-sales', ['']], ['machine-history', ['']], ['dormant-customers', ['']],
  ['lead-conversion', ['']], ['lead-speed', ['ageing', 'response', 'followups']], ['lost-leads', ['']], ['exec-performance', ['']], ['referrals', ['']],
  ['quotation-value', ['']], ['lost-quotations', ['']], ['discount-analysis', ['']],
  ['order-value', ['']], ['order-backlog', ['backlog', 'awaiting', 'delayed']], ['payment-status', ['']],
  ['installed-base-by-model', ['']], ['warranty-amc', ['warranty', 'renewals', 'status']], ['machines-without-contract', ['']],
  ['open-tickets', ['']], ['sla-compliance', ['']], ['service-quality', ['engineer', 'month']], ['machine-reliability', ['downtime', 'mtbf', 'repeats']], ['pm-compliance', ['']],
  ['attendance', ['daily', 'employee', 'exceptions']], ['field-visits', ['']],
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 1300 } });
let errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
let bad = 0;
for (const [id, views] of REPORTS) {
  for (const v of views) {
    errors = [];
    const path = `/reports/${id}${v ? `?view=${v}` : ''}`;
    await openAs(page, user, path, { theme: theme as 'light' | 'dark' });
    await page.waitForSelector('.rp-kpis:not([aria-busy]), .state', { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => ({
      err: !!document.querySelector('.state-icon.tone-danger'),
      noAccess: document.body.innerText.includes('You do not have access'),
      kpis: document.querySelectorAll('.rp-kpis .kpi-card').length,
      chart: !!document.querySelector('.rp-chart-body'),
      chartEmpty: !!document.querySelector('.rp-chart-body .state'),
      rows: document.querySelectorAll('.rp-table tbody tr').length,
      hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    const flag = info.err || errors.length || info.hscroll || !info.kpis;
    if (flag) bad++;
    console.log(flag ? 'XX' : 'ok', path, JSON.stringify(info), errors.length ? errors.slice(0, 2) : '');
    if (out !== '-') await page.screenshot({ path: `${out}/${id}_${v || 'main'}.png` });
  }
}
console.log('problems:', bad);
await browser.close();
