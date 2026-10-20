import { chromium } from '@playwright/test';
import { openAs } from './helpers';
const paths = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const p of paths) {
  await openAs(page, 'u_rahul', p);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(`(() => {
    const main = document.querySelector('#main');
    const root = main.querySelector('.page-main') || main.querySelector('.page') || main;
    const top0 = main.getBoundingClientRect().top;
    const out = [];
    for (const el of Array.from(root.children)) {
      const b = el.getBoundingClientRect();
      if (!b.height) continue;
      out.push((el.className || el.tagName).toString().split(' ').slice(0, 2).join('.') + ' y=' + Math.round(b.top - top0) + ' h=' + Math.round(b.height) + ' x=' + Math.round(b.left) + ' w=' + Math.round(b.width));
    }
    return out.slice(0, 7);
  })()`);
  console.log('## ' + p + '\n  ' + (r as string[]).join('\n  '));
}
await browser.close();
