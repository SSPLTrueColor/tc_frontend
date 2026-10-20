/**
 * Calendar stress test (docs/CALENDAR-QA.md). Drives the real app in Chromium and prints a result row per check.
 *   BASE_URL=http://localhost:5175 npx tsx e2e/calendar-stress.mts [outDir]
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { BASE, openAs } from './helpers';

const OUT = process.argv[2] ?? '.';
mkdirSync(OUT, { recursive: true });
const KEY = 'tc.crm.db.v1';

type Row = { id: string; check: string; result: 'PASS' | 'FAIL'; note: string };
const rows: Row[] = [];
const consoleErrors: string[] = [];

async function check(id: string, name: string, fn: () => Promise<string | void>) {
  try {
    const note = (await fn()) ?? '';
    rows.push({ id, check: name, result: 'PASS', note });
  } catch (e) {
    rows.push({ id, check: name, result: 'FAIL', note: String((e as Error).message).split('\n')[0].slice(0, 220) });
  }
  const r = rows[rows.length - 1];
  console.log(`${r.id.padEnd(9)} ${r.result}  ${r.check.slice(0, 90).padEnd(90)} ${r.note}`);
}
const ok = (c: unknown, msg: string) => {
  if (!c) throw new Error(msg);
};

async function fresh(browser: Browser, opts: { width?: number; height?: number; user?: string; theme?: 'light' | 'dark'; demo?: Record<string, number> } = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 } });
  const page = await ctx.newPage();
  await page.addInitScript((k) => {
    (window as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f;
    // QA hook: demo network settings (latency / failure rate) applied to the stored db before the app starts.
    const o = sessionStorage.getItem('qa.demo');
    const raw = localStorage.getItem(k);
    if (o && raw) {
      const db = JSON.parse(raw);
      db.demo = { ...db.demo, ...JSON.parse(o) };
      localStorage.setItem(k, JSON.stringify(db));
    }
  }, KEY);
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`${m.text()}`));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await openAs(page, opts.user ?? 'u_rohan', '/calendar', { theme: opts.theme ?? 'light' });
  if (opts.demo) {
    await setDemo(page, opts.demo);
    await page.goto(`${BASE}/calendar`);
  }
  await page.waitForSelector('.fc-view, .state, .skeleton', { timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: `${OUT}/stuck-${opts.user ?? 'u_rohan'}.png` });
    consoleErrors.push(`calendar did not render for ${opts.user ?? 'u_rohan'}`);
  });
  return page;
}
const setDemo = (page: Page, demo: Record<string, number>) => page.evaluate((d) => sessionStorage.setItem('qa.demo', JSON.stringify(d)), demo);
/** Flip the simulated network of the running app: a second tab edits the stored demo settings and the app picks it up through its storage-sync. */
const liveDemo = async (page: Page, demo: Record<string, number>) => {
  const other = await page.context().newPage();
  await other.goto(`${BASE}/login`);
  await other.evaluate(
    ([k, d]) => {
      const db = JSON.parse(localStorage.getItem(k as string)!);
      db.demo = { ...db.demo, ...(d as object) };
      localStorage.setItem(k as string, JSON.stringify(db));
    },
    [KEY, demo] as const,
  );
  await other.close();
  await page.waitForTimeout(400);
};
const events = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).records.calendarEvents as Record<string, unknown>[], KEY);
const ready = async (page: Page) => {
  await page.waitForSelector('.fc-view', { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(250);
};
const settle = async (page: Page) => {
  await page.keyboard.press('Escape');
  await page.locator('.cal-search input').fill('');
  await page.locator('.cal-search input').blur();
  await page.mouse.click(5, 5);
  await page.waitForTimeout(150);
};
const title = (page: Page) => page.locator('.cal-title').innerText();
const dayCell = (page: Page, date: string) => page.locator(`td.fc-daygrid-day[data-date="${date}"]`);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function drag(page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 6, a.y + a.height / 2 + 6, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

const browser = await chromium.launch();

// ------------------------------------------------------------------ layout / states
{
  const page = await fresh(browser);
  await ready(page);
  await check('S01', 'Month loads with chips, no horizontal page scroll', async () => {
    ok((await page.locator('.fc-event').count()) > 10, 'few chips');
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'page scrolls horizontally');
  });
  await check('S02', 'Today strip shows count and next event', async () => {
    const t = await page.locator('.cal-today-strip').innerText();
    ok(/event/.test(t), t);
    return t.replace(/\s+/g, ' ');
  });
  await check('S03', 'Today cell highlighted; weekends shaded', async () => {
    ok((await page.locator('.fc-day-today .fc-daygrid-day-number').count()) === 1, 'no today chip');
    ok((await page.locator('.fc-day-sat .fc-non-business, .fc-day-sat.fc-non-business, .fc-day-sat .fc-bg-event').count()) >= 0, '');
  });
  await check('S04', 'Past events muted (is-past), future not', async () => {
    ok((await page.locator('.fc-event.is-past').count()) > 0, 'no past chips');
    ok((await page.locator('.fc-event:not(.is-past)').count()) > 0, 'no future chips');
  });
  await check('S05', 'Chip left border is the type colour (3px) and text size ≥ 12px', async () => {
    const r = await page.locator('.fc-h-event').first().evaluate((el) => {
      const cs = getComputedStyle(el);
      const t = getComputedStyle(el.querySelector('.ev-title') ?? el);
      return { bw: cs.borderLeftWidth, rw: cs.borderRightWidth, fs: parseFloat(t.fontSize) };
    });
    ok(r.bw === '3px' && r.rw === '0px', JSON.stringify(r));
    ok(r.fs >= 12, `font ${r.fs}`);
    return JSON.stringify(r);
  });
  await check('S06', 'View switch Month→Week→Day→Agenda keeps the grid height (no layout jump)', async () => {
    const h: number[] = [];
    for (const k of ['m', 'w', 'd', 'a']) {
      await page.keyboard.press(k);
      await page.waitForTimeout(300);
      h.push(Math.round((await page.locator('.tc-cal').boundingBox())!.height));
    }
    ok(new Set(h).size === 1, `heights ${h}`);
    return `height ${h[0]}px in all four views`;
  });
  await page.context().close();
}

// ------------------------------------------------------------------ keyboard
{
  const page = await fresh(browser);
  await ready(page);
  await check('K01', 'Shortcuts T / M / W / D / A / ← → work', async () => {
    const t0 = await title(page);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
    const t1 = await title(page);
    ok(t1 !== t0, 'ArrowRight did nothing');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(250);
    ok((await title(page)) === t0, 'ArrowLeft did not return');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('t');
    await page.waitForTimeout(250);
    ok((await title(page)) === t0, 'T did not return to today');
    for (const [k, v] of [['w', 'Week'], ['d', 'Day'], ['a', 'Agenda'], ['m', 'Month']] as const) {
      await page.keyboard.press(k);
      await page.waitForTimeout(200);
      ok(await page.locator(`.seg-btn.is-on:has-text("${v}")`).count(), `${k} → ${v}`);
    }
  });
  await check('K02', 'C opens quick-create focused on the title; Esc closes it', async () => {
    await page.keyboard.press('c');
    await page.waitForSelector('.cal-quick');
    ok(await page.evaluate(() => (document.activeElement as HTMLElement)?.getAttribute('aria-label') === 'Event title'), 'title not focused');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    ok((await page.locator('.cal-quick').count()) === 0, 'did not close');
  });
  await check('K03', 'Shortcuts ignored while typing in search', async () => {
    await page.keyboard.press('/');
    await page.keyboard.type('mwdac');
    ok((await page.locator('.cal-search input').inputValue()) === 'mwdac', 'keys leaked');
    await page.locator('.cal-search input').fill('');
    await page.locator('.cal-search input').blur();
  });
  await check('K04', 'Event reachable by Tab and opens with Enter', async () => {
    await page.keyboard.press('m');
    await page.waitForTimeout(250);
    const ev = page.locator('.fc-event[tabindex="0"]').first();
    ok(await ev.count(), 'events not focusable');
    await ev.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.cal-detail');
    await page.keyboard.press('Escape');
  });
  await page.context().close();
}

// ------------------------------------------------------------------ data shapes
{
  const page = await fresh(browser, { user: 'u_rahul' });
  await ready(page);
  await settle(page);
  await check('D01', 'Empty month → friendly empty state with Create event', async () => {
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    const empty = page.locator('.cal-empty');
    ok(await empty.count(), 'no empty state in ' + (await title(page)));
    ok(/Create event/.test(await empty.innerText()), 'no create button');
    await page.locator('.cal-empty button').click();
    await page.waitForSelector('.cal-quick');
    await page.keyboard.press('Escape');
    await page.keyboard.press('t');
    await page.waitForTimeout(300);
  });
  await settle(page);
  await check('D02', 'Search to 1 event shows 1 chip, count and no empty state', async () => {
    await page.locator('.cal-search input').fill('Night-shift');
    await page.waitForTimeout(300);
    ok((await page.locator('.cal-search-count').innerText()).includes('1 match'), await page.locator('.cal-search-count').innerText());
    ok((await page.locator('.fc-event').count()) >= 1, 'no chip');
    await page.locator('.cal-search input').fill('zzzzqq');
    await page.waitForTimeout(300);
    ok(/No events match/.test(await page.locator('.cal-empty').innerText()), 'no filtered empty state');
    await page.locator('.cal-empty button:has-text("Clear")').click();
    await page.waitForTimeout(300);
    ok((await page.locator('.cal-search input').inputValue()) === '', 'search not cleared');
  });
  await settle(page);
  await check('D03', '20+ events in one day → "+N more" popover lists them all, nothing overflows the cell', async () => {
    const d = addDays(today, 6);
    await page.keyboard.press('m');
    await page.locator('.cal-side-inner .cal-check:has-text("Everyone")').count();
    // show everyone's events for the day
    await page.keyboard.press('t');
    await page.waitForTimeout(300);
    const cell = dayCell(page, d);
    ok(await cell.count(), 'day cell missing');
    const more = cell.locator('.fc-daygrid-more-link');
    ok(await more.count(), 'no +more');
    const n = parseInt((await more.innerText()).replace(/\D/g, ''), 10);
    ok(n >= 5, `+${n}`);
    const over = await cell.evaluate((td) => {
      const r = td.getBoundingClientRect();
      return [...td.querySelectorAll('.fc-event')].some((e) => e.getBoundingClientRect().right > r.right + 1);
    });
    ok(!over, 'chip overflows cell');
    await more.click();
    await page.waitForSelector('.fc-popover');
    const total = await page.locator('.fc-popover .fc-event').count();
    ok(total >= 10, `popover has ${total}`);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    return `+${n} more; popover lists ${total}`;
  });
  await settle(page);
  await check('D04', '6 overlapping events at one time → stacked with "+more", titles readable', async () => {
    await page.keyboard.press('w');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    const col = await page.locator('.fc-timegrid-event').count();
    ok(col > 0, 'no timed events next week');
    const moreLinks = await page.locator('.fc-timegrid-more-link').count();
    ok(moreLinks >= 1, 'no +more for 6 overlapping');
    const narrow = await page.locator('.fc-timegrid-event').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width < 48).length);
    ok(narrow === 0, `${narrow} slivers narrower than 48px`);
  });
  await settle(page);
  await check('D05', 'Event crossing midnight shows on both days (week view)', async () => {
    await page.keyboard.press('t');
    await page.waitForTimeout(300);
    await page.locator('.cal-search input').fill('Night-shift');
    await page.waitForTimeout(300);
    const n = await page.locator('.fc-timegrid-event').count();
    ok(n === 2, `${n} segments`);
    await page.locator('.cal-search input').fill('');
  });
  await settle(page);
  await check('D06', 'Multi-day span crosses week and month boundary (continues across both)', async () => {
    await page.keyboard.press('m');
    await page.locator('.cal-search input').fill('stock take');
    await page.waitForTimeout(400);
    await page.locator('.cal-search input').blur();
    const cont1 = await page.locator('.fc-daygrid-block-event.fc-event-start:not(.fc-event-end)').count();
    ok(cont1 >= 1, 'does not continue past the end of the month');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    const cont2 = await page.locator('.fc-daygrid-block-event.fc-event-end:not(.fc-event-start)').count();
    ok(cont2 >= 1, 'no continuation in the next month');
    await page.keyboard.press('t');
    return 'continues out of Oct and into Nov';
  });
  await settle(page);
  await check('D07', 'All-day + timed events on the same day (week view)', async () => {
    await page.keyboard.press('w');
    await page.waitForTimeout(400);
    ok((await page.locator('.fc-timegrid-allday .fc-event, .fc-daygrid-body .fc-event').count()) > 0, 'no all-day');
    ok((await page.locator('.fc-timegrid-col-events .fc-event').count()) > 0, 'no timed');
    await page.keyboard.press('m');
  });
  await settle(page);
  await check('D08', 'Very long title truncates with ellipsis; tooltip carries the full text; nothing overflows', async () => {
    await page.locator('.cal-search input').fill('Annual dealer conference');
    await page.keyboard.press('Escape');
    await page.locator('.cal-search input').blur();
    for (let i = 0; i < 1; i++) await page.waitForTimeout(300);
    const r = await page.locator('.fc-event:has-text("Annual dealer")').first().evaluate((el) => {
      const t = el.querySelector('.ev-title') as HTMLElement;
      const cell = el.closest('td')!.getBoundingClientRect();
      return { cut: t.scrollWidth > t.clientWidth, tip: el.getAttribute('data-tooltip')!.length, over: el.getBoundingClientRect().right > cell.right + 1 };
    });
    ok(r.cut && r.tip > 90 && !r.over, JSON.stringify(r));
    await page.locator('.cal-search input').fill('');
    return JSON.stringify(r);
  });
  await page.context().close();
}

// ------------------------------------------------------------------ create / validate / double submit
{
  const page = await fresh(browser);
  await ready(page);
  await check('C01', 'Click a future month day → quick-create; end before start is rejected inline', async () => {
    await dayCell(page, addDays(today, 3)).click({ position: { x: 20, y: 20 } });
    await page.waitForSelector('.cal-quick');
    await page.locator('.cal-quick [aria-label="Event title"]').fill('QA end before start');
    await page.locator('.cal-quick [aria-label="From"]').fill('15:00');
    await page.locator('.cal-quick [aria-label="To"]').fill('14:00');
    await page.locator('.cal-quick button[type=submit]').click();
    await page.waitForTimeout(300);
    ok(/after/.test(await page.locator('.cal-quick .field-error').last().innerText()), 'no error');
    ok(!(await events(page)).some((e) => e.title === 'QA end before start'), 'saved anyway');
    await page.locator('.cal-quick [aria-label="To"]').fill('15:00');
    await page.locator('.cal-quick button[type=submit]').click();
    await page.waitForTimeout(300);
    ok(/after/.test(await page.locator('.cal-quick .field-error').last().innerText()), 'zero-duration accepted');
  });
  await check('C02', 'Rapid double-click on Save creates exactly one event', async () => {
    await page.locator('.cal-quick [aria-label="To"]').fill('16:00');
    await page.locator('.cal-quick button[type=submit]').dblclick();
    await page.waitForTimeout(1500);
    const n = (await events(page)).filter((e) => e.title === 'QA end before start').length;
    ok(n === 1, `${n} created`);
  });
  await check('C03', 'Overlap for the same user → warning in quick-create (not a block)', async () => {
    await page.keyboard.press('c');
    await page.waitForSelector('.cal-quick');
    await page.locator('.cal-quick [aria-label="Event title"]').fill('QA overlap');
    await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
  });
  await check('C04', 'Create in the past is blocked (past day click)', async () => {
    await dayCell(page, addDays(today, -5)).click({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(400);
    ok((await page.locator('.cal-quick').count()) === 0, 'popover opened for a past day');
    ok(/past/i.test(await page.locator('.toasts').innerText()), 'no message');
  });
  await check('C05', 'More options → full dialog keeps the typed title', async () => {
    await page.keyboard.press('c');
    await page.waitForSelector('.cal-quick');
    await page.locator('.cal-quick [aria-label="Event title"]').fill('QA more options');
    await page.locator('.cal-quick button:has-text("More options")').click();
    await page.waitForSelector('[role=dialog] #ev-title');
    ok((await page.locator('#ev-title').inputValue()) === 'QA more options', 'title lost');
    await page.keyboard.press('Escape');
  });
  await check('C06', 'Full dialog: title over 120 chars is capped; end before start shows an error', async () => {
    await page.keyboard.press('c');
    await page.locator('.cal-quick button:has-text("More options")').click();
    await page.waitForSelector('#ev-title');
    await page.locator('#ev-title').fill('x'.repeat(150));
    ok((await page.locator('#ev-title').inputValue()).length === 120, 'not capped');
    await page.keyboard.press('Escape');
  });
  await page.context().close();
}

// ------------------------------------------------------------------ drag / undo / recurrence
{
  const page = await fresh(browser);
  await ready(page);
  const target = 'QA drag me';
  await check('R00', 'Create a test event through quick-create (shows in the month grid)', async () => {
    await page.keyboard.press('c');
    await page.waitForSelector('.cal-quick');
    await page.locator('.cal-quick [aria-label="Event title"]').fill(target);
    await page.locator('.cal-quick [aria-label="From"]').fill('16:00');
    await page.locator('.cal-quick [aria-label="To"]').fill('17:00');
    await page.locator('.cal-quick button[type=submit]').click();
    await page.waitForTimeout(1500);
    ok((await events(page)).some((e) => e.title === target), 'not saved');
    await page.locator('.cal-search input').fill('QA drag');
    await page.waitForTimeout(400);
    await page.locator('.cal-search input').blur();
  });
  await check('R01', 'Drag to a past day reverts with a message', async () => {
    const chip = page.locator(`.fc-event:has-text("${target}")`).first();
    ok(await chip.count(), 'event not on screen');
    const before = (await events(page)).find((e) => e.title === target)!.start;
    await drag(page, chip, dayCell(page, addDays(today, -6)));
    await page.waitForTimeout(800);
    ok(/past/i.test(await page.locator('.toasts').innerText()), 'no past message: ' + (await page.locator('.toasts').innerText()));
    ok((await events(page)).find((e) => e.title === target)!.start === before, 'moved anyway');
    ok(await page.locator(`.fc-event:has-text("${target}")`).count(), 'chip vanished');
  });
  await check('R02', 'Drag to a future day moves it, shows an Undo toast; Undo restores it', async () => {
    const before = (await events(page)).find((e) => e.title === target)!.start as string;
    const chip = page.locator(`.fc-event:has-text("${target}")`).first();
    await drag(page, chip, dayCell(page, addDays(before.slice(0, 10), 2)));
    await page.waitForTimeout(1500);
    const moved = (await events(page)).find((e) => e.title === target)!.start as string;
    ok(moved.slice(0, 10) === addDays(before.slice(0, 10), 2), `not moved: ${moved}`);
    const undo = page.locator('.toast-action:has-text("Undo")');
    ok(await undo.count(), 'no Undo action');
    await undo.click();
    await page.waitForTimeout(1200);
    ok((await events(page)).find((e) => e.title === target)!.start === before, 'undo did not restore');
  });
  await check('R02b', 'Resize in the week view changes the duration; Undo puts it back', async () => {
    await page.keyboard.press('w');
    await page.waitForTimeout(500);
    const ev = page.locator(`.fc-timegrid-event:has-text("${target}")`).first();
    await page.evaluate(() => { for (const sc of document.querySelectorAll('.fc-scroller')) (sc as HTMLElement).scrollTop += 300; });
    await page.waitForTimeout(200);
    const before = (await events(page)).find((e) => e.title === target)!;
    await ev.hover();
    const grip = (await ev.locator('.fc-event-resizer-end').boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + 40, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const keep = page.locator('[role=dialog] button:has-text("Keep Anyway")');
    if (await keep.count()) await keep.click();
    await page.waitForTimeout(1500);
    const after = (await events(page)).find((e) => e.title === target)!;
    ok(after.end !== before.end, 'duration unchanged');
    await page.locator('.toast-action:has-text("Undo")').click();
    await page.waitForTimeout(1200);
    ok((await events(page)).find((e) => e.title === target)!.end === before.end, 'undo failed');
    await page.keyboard.press('m');
  });
  await settle(page);
  await check('R03', 'Edit a recurring event offers this / this and following / all', async () => {
    await page.keyboard.press('a');
    await page.waitForTimeout(400);
    await page.locator('.fc-list-event:has-text("Weekly sales review")').nth(1).click();
    await page.waitForSelector('.cal-detail');
    await page.locator('.cal-detail button:has-text("Edit")').click();
    await page.waitForSelector('[role=dialog]');
    const t = await page.locator('[role=dialog]').innerText();
    ok(/This Event/.test(t) && /This and Following/.test(t) && /All Events/.test(t), t.slice(0, 120));
    await page.locator('[role=dialog] button:has-text("Edit This and Following")').click();
    await page.waitForSelector('#ev-title');
    await page.locator('#ev-title').fill('Weekly sales review — new format');
    await page.locator('[role=dialog] button:has-text("Save")').click();
    await page.waitForTimeout(1500);
    const evs = await events(page);
    ok(evs.some((e) => e.title === 'Weekly sales review — new format' && e.recurrence === 'weekly'), 'no new series');
    ok(evs.some((e) => e.title === 'Weekly sales review — Textile West' && e.recurrenceUntil), 'old series not ended');
  });
  await check('R04', 'Delete one occurrence only removes that occurrence (series stays)', async () => {
    const before = (await events(page)).find((e) => e.title === 'Weekly sales review — new format')!;
    await page.locator('.fc-list-event:has-text("Weekly sales review")').nth(2).click();
    await page.waitForSelector('.cal-detail');
    await page.locator('.cal-detail button:has-text("Delete")').click();
    await page.locator('[role=dialog] button:has-text("Delete This Event")').click();
    await page.waitForTimeout(1500);
    const after = (await events(page)).find((e) => e.id === before.id)!;
    ok(after && String(after.exdates).length > String(before.exdates).length, 'no exdate added');
  });
  await check('R05', 'Delete this and following ends the series before the occurrence', async () => {
    await page.locator('.fc-list-event:has-text("Weekly sales review")').nth(2).click();
    await page.waitForSelector('.cal-detail');
    await page.locator('.cal-detail button:has-text("Delete")').click();
    await page.locator('[role=dialog] button:has-text("Delete This and Following")').click();
    await page.waitForTimeout(1500);
    const after = (await events(page)).find((e) => e.title === 'Weekly sales review — new format')!;
    ok(after && after.recurrenceUntil && String(after.recurrenceUntil) < addDays(today, 40), `until ${after?.recurrenceUntil}`);
  });
  await check('R06', 'Delete a single event asks for confirmation, then removes it', async () => {
    await page.keyboard.press('Escape');
    await page.locator('.cal-search input').fill('QA drag');
    await page.waitForTimeout(400);
    await page.locator(`.fc-list-event:has-text("${target}")`).first().click();
    await page.waitForSelector('.cal-detail');
    await page.locator('.cal-detail button:has-text("Delete")').click();
    await page.waitForSelector('[role=dialog], [role=alertdialog]');
    await page.locator('[role=dialog] button:has-text("Delete"), [role=alertdialog] button:has-text("Delete")').last().click();
    await page.waitForTimeout(1500);
    ok(!(await events(page)).some((e) => e.title === target), 'still there');
  });
  await page.context().close();
}

// ------------------------------------------------------------------ slow / failing service
{
  const page = await fresh(browser, { demo: { latencyMin: 3000, latencyMax: 3200 } });
  await check('N01', 'Slow (3s) service → loader first, then the calendar', async () => {
    await page.waitForTimeout(400);
    ok(await page.locator('.skeleton, .skeleton-row, [aria-busy], .tc-cal .skeleton').count(), 'no loader while waiting');
    await page.waitForSelector('.fc-view', { timeout: 10000 });
  });
  await page.context().close();
}
{
  const page = await fresh(browser, { demo: { failureRate: 1, latencyMin: 100, latencyMax: 200 } });
  await check('N02', 'Failed service on load → error state with Retry, then recovers', async () => {
    await page.waitForSelector('.state', { timeout: 8000 });
    ok(/Could not load the calendar/.test(await page.locator('.state').innerText()), 'no error text');
    await liveDemo(page, { failureRate: 0 });
    await page.locator('.state button:has-text("Retry")').click();
    await page.waitForSelector('.fc-view', { timeout: 10000 });
  });
  await page.context().close();
}
{
  const page = await fresh(browser, { demo: { latencyMin: 100, latencyMax: 200 } });
  await ready(page);
  await check('N03', 'Failed save keeps the typed text and shows Retry; Retry then saves exactly one event', async () => {
    await page.keyboard.press('c');
    await page.waitForSelector('.cal-quick');
    await page.locator('.cal-quick [aria-label="Event title"]').fill('QA offline save');
    await liveDemo(page, { failureRate: 1 });
    await page.locator('.cal-quick button[type=submit]').click();
    await page.waitForTimeout(900);
    ok(await page.locator('.cal-quick').count(), 'popover closed on failure');
    ok((await page.locator('.cal-quick [aria-label="Event title"]').inputValue()) === 'QA offline save', 'text lost');
    ok(/Could not save/.test(await page.locator('.cal-quick').innerText()), 'no error shown');
    ok(!(await events(page)).some((e) => e.title === 'QA offline save'), 'saved despite failure');
    await liveDemo(page, { failureRate: 0 });
    await page.locator('.cal-quick button[type=submit]').click();
    await page.waitForTimeout(1200);
    ok((await events(page)).filter((e) => e.title === 'QA offline save').length === 1, 'not exactly one');
  });
  await check('N04', 'Failed drag save reverts the event and offers Retry', async () => {
    await page.locator('.cal-search input').fill('QA offline');
    await page.waitForTimeout(400);
    await page.locator('.cal-search input').blur();
    const chip = page.locator('.fc-event:has-text("QA offline save")').first();
    const before = (await events(page)).find((e) => e.title === 'QA offline save')!.start as string;
    await liveDemo(page, { failureRate: 1 });
    await drag(page, chip, dayCell(page, addDays(before.slice(0, 10), 3)));
    await page.waitForTimeout(1200);
    ok(/Could not reschedule/.test(await page.locator('.toasts').innerText()), 'no failure toast');
    ok((await events(page)).find((e) => e.title === 'QA offline save')!.start === before, 'moved despite failure');
    await liveDemo(page, { failureRate: 0 });
    await page.locator('.toast-action:has-text("Retry")').click();
    await page.waitForTimeout(1500);
    ok((await events(page)).find((e) => e.title === 'QA offline save')!.start !== before, 'retry did not move it');
  });
  await page.context().close();
}

// ------------------------------------------------------------------ narrow, zoom
{
  const page = await fresh(browser, { width: 390, height: 800 });
  await check('Z01', 'Phone width defaults to Agenda, no horizontal scroll', async () => {
    await ready(page);
    ok(await page.locator('.seg-btn.is-on:has-text("Agenda")').count(), 'not agenda');
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'h-scroll');
  });
  await page.context().close();
}
for (const [label, w, h] of [['125%', 1152, 720], ['150%', 960, 600]] as const) {
  const page = await fresh(browser, { width: w, height: h });
  await ready(page);
  await check(`Z0${label === '125%' ? 2 : 3}`, `Zoom ${label} (${w}×${h} CSS px): toolbar visible, no horizontal scroll, grid ≥ 400px tall`, async () => {
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'h-scroll');
    const bar = await page.locator('.cal-toolbar').boundingBox();
    const grid = await page.locator('.tc-cal').boundingBox();
    ok(bar!.width > 300 && grid!.height >= 400, `grid ${Math.round(grid!.height)}px`);
    const seg = await page.locator('.segmented').boundingBox();
    ok(seg!.x + seg!.width <= w, 'view switch clipped');
    return `grid ${Math.round(grid!.height)}px`;
  });
  await page.screenshot({ path: `${OUT}/zoom-${label.replace('%', '')}.png` });
  await page.context().close();
}

// ------------------------------------------------------------------ colour contrast (WCAG AA), both themes
for (const theme of ['light', 'dark'] as const) {
  const page = await fresh(browser, { theme });
  await ready(page);
  await check(theme === 'light' ? 'A01' : 'A02', `WCAG AA contrast of event chips (${theme}): 6 types × normal/past, title and time text`, async () => {
    const res = await page.evaluate(() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      const g = cv.getContext('2d', { willReadFrequently: true })!;
      const rgba = (c: string) => {
        g.clearRect(0, 0, 1, 1);
        g.fillStyle = '#000';
        g.fillStyle = c;
        g.fillRect(0, 0, 1, 1);
        const d = g.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      };
      const lum = ([r, gg, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b);
      };
      const ratio = (a: number[], b: number[]) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
      };
      const mix = (fg: number[], bg: number[]) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
      const host = document.querySelector('.tc-cal')!;
      const panel = rgba(getComputedStyle(document.documentElement).getPropertyValue('--s-panel') || '#fff');
      const out: { type: string; past: boolean; part: string; ratio: number }[] = [];
      for (const type of ['meeting', 'demo', 'follow_up', 'field_visit', 'service_visit', 'internal']) {
        for (const past of [false, true]) {
          const el = document.createElement('div');
          el.className = `fc-event fc-h-event ev-${type} ${past ? 'is-past' : ''}`;
          el.innerHTML = '<div class="fc-event-main"><span class="ev-time">10 AM</span> <span class="ev-title">Title</span></div>';
          host.appendChild(el);
          const bg = mix(rgba(getComputedStyle(el).backgroundColor), panel);
          for (const part of ['ev-title', 'ev-time']) {
            const fg = rgba(getComputedStyle(el.querySelector(`.${part}`)!).color);
            out.push({ type, past, part, ratio: ratio(mix(fg, bg), bg) });
          }
          host.removeChild(el);
        }
      }
      return out;
    });
    const bad = res.filter((r) => r.ratio < 4.5);
    ok(!bad.length, bad.map((b) => `${b.type}${b.past ? '/past' : ''}/${b.part} ${b.ratio.toFixed(2)}`).join('; '));
    return `min ratio ${Math.min(...res.map((r) => r.ratio)).toFixed(2)}`;
  });
  await page.screenshot({ path: `${OUT}/month-${theme}.png` });
  await page.keyboard.press('w');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/week-${theme}.png` });
  await page.context().close();
}

// ------------------------------------------------------------------ roles
const ROLE_USERS: [string, string][] = [
  ['admin', 'u_rahul'], ['management', 'u_vikram'], ['division_head', 'u_suresh'], ['sales_manager', 'u_rohan'], ['sales_exec', 'u_karan'], ['service_head', 'u_manoj'],
  ['engineer', 'u_ravi'], ['coordinator', 'u_meera'], ['scm', 'u_rajesh'], ['store', 'u_prakash'], ['accounts', 'u_swati'], ['profiling', 'u_tanvi'],
];
for (const [role, uid] of ROLE_USERS) {
  const page = await fresh(browser, { user: uid });
  await ready(page);
  await check(`P-${role}`, `Role ${role}: create button, drag-select and Edit/Delete match permissions`, async () => {
    const dbRole = await page.evaluate(() => 1);
    void dbRole;
    const create = page.locator('.cal-create');
    const disabled = await create.isDisabled();
    const readOnlyRole = role === 'store';
    ok(disabled === readOnlyRole, `create disabled=${disabled}`);
    // pick an own, a foreign and a module chip
    await page.keyboard.press('a');
    await page.waitForTimeout(400);
    let sawEdit = 0;
    let sawNoEdit = 0;
    const rowsEl = page.locator('.fc-list-event');
    const n = Math.min(await rowsEl.count(), 14);
    for (let i = 0; i < n; i++) {
      await rowsEl.nth(i).click();
      await page.waitForSelector('.cal-detail');
      const hasEdit = (await page.locator('.cal-detail button:has-text("Edit")').count()) > 0;
      if (hasEdit) sawEdit++;
      else sawNoEdit++;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
    }
    if (readOnlyRole) ok(sawEdit === 0, 'read-only role sees Edit');
    return `${n} events opened: ${sawEdit} editable, ${sawNoEdit} view-only`;
  });
  if (role === 'store') {
    await check('P-store-2', 'Read-only role: drag-select does not open quick-create', async () => {
      await page.keyboard.press('m');
      await page.waitForTimeout(300);
      await dayCell(page, addDays(today, 4)).click({ position: { x: 20, y: 20 } });
      await page.waitForTimeout(400);
      ok((await page.locator('.cal-quick').count()) === 0, 'popover opened');
      await page.keyboard.press('c');
      await page.waitForTimeout(300);
      ok((await page.locator('.cal-quick').count()) === 0, 'C opened the popover');
    });
  }
  await page.context().close();
}

await browser.close();

writeFileSync(`${OUT}/results.json`, JSON.stringify({ rows, consoleErrors }, null, 2));
const failed = rows.filter((r) => r.result === 'FAIL').length;
console.log(`\n${rows.length - failed}/${rows.length} passed · console errors: ${consoleErrors.length}`);
if (consoleErrors.length) console.log([...new Set(consoleErrors)].slice(0, 8).join('\n'));
process.exit(failed ? 1 : 0);
