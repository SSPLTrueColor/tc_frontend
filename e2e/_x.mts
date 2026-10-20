import { chromium, type Page } from '@playwright/test';
import { openAs } from './helpers';
import { readFileSync } from 'fs';
const [user, path, stepsFile] = process.argv.slice(2);
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 900 }, baseURL: 'http://localhost:5175' });
const errs: string[] = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
page.on('pageerror', (e) => errs.push(String(e)));
await openAs(page, user, path, { theme: 'light' });
await page.waitForTimeout(1000);
const snap = async (sel = 'main') => { const s = await page.locator(sel).first().ariaSnapshot(); console.log('-----SNAP', sel, page.url()); console.log(s.split('\n').filter(l=>!l.includes('/url:')).join('\n')); };
const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('tc.crm.db.v1')!));
const SHOT = '/private/tmp/claude-501/-Users-maysolanki-Documents-True-Color-tc-frontend/6db01995-7c70-4313-86c1-2f272049ad5b/scratchpad/journey/x_';
const body = readFileSync(stepsFile, 'utf8');
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
try { await new AsyncFn('page', 'snap', 'db', 'SHOT', body)(page, snap, db, SHOT); } catch (e) { console.log('STEP ERROR', String(e).slice(0, 800)); await snap('main').catch(()=>{}); }
console.log('ERRORS', errs);
await b.close();
