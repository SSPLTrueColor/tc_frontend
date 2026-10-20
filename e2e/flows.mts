/**
 * Click-count baseline for the main workflows: drives the real UI and counts every click / key press.
 * Typing a value counts as one "entry" (kept apart from clicks). Usage: npx tsx e2e/flows.mts [W1 W2 …]
 */
import { chromium, type Page, type Locator } from '@playwright/test';
import { BASE, openAs } from './helpers';

class Counter {
  clicks = 0;
  entries = 0;
  log: string[] = [];
  constructor(public page: Page) {}
  async click(loc: Locator, note: string) {
    await loc.first().click({ timeout: 8000 });
    this.clicks++;
    this.log.push(`click ${note}`);
    await this.page.waitForTimeout(300);
  }
  async fill(loc: Locator, v: string, note: string) {
    await loc.first().fill(v);
    this.entries++;
    this.log.push(`type  ${note}`);
  }
  /** Chooses the first option, but only if the field is still empty (a pre-filled field costs no clicks). */
  async pickFirstOption(trigger: Locator, note: string) {
    const empty = await trigger.first().evaluate((el) => el.classList.contains('is-placeholder') || /^Select…?$|^Choose/.test((el.textContent ?? '').trim()));
    if (!empty) {
      this.log.push(`skip  ${note} (already filled)`);
      return;
    }
    await this.click(trigger, `${note} (open)`);
    await this.click(this.page.getByRole('option').first(), `${note} (choose)`);
  }
}

interface Flow {
  user: string;
  title: string;
  run: (c: Counter) => Promise<string>;
}

const flows: Record<string, Flow> = {
  W1: {
    user: 'u_karan',
    title: 'Create a lead for an existing customer',
    run: async (c) => {
      const p = c.page;
      await c.click(p.locator('nav.rail a[aria-label*="Lead"]'), 'Leads (rail)');
      await c.click(p.getByRole('button', { name: /^New Lead/ }), 'New Lead');
      await c.pickFirstOption(p.locator('button.select-menu-trigger[aria-label*="Customer"]').first(), 'Customer');
      await c.pickFirstOption(p.locator('button.select-menu-trigger[aria-label*="Contact person"]').first(), 'Contact');
      await c.pickFirstOption(p.locator('button.select-menu-trigger[aria-label*="Lead source"]').first(), 'Lead source');
      await c.pickFirstOption(p.locator('button.select-menu-trigger[aria-label*="Product type"]').first(), 'Product type');
      await c.click(p.getByRole('button', { name: 'Create Lead' }), 'Create Lead');
      await p.waitForTimeout(1200);
      return p.url().includes('/leads/new') ? 'FAILED (still on form)' : 'saved';
    },
  },
  W1b: {
    user: 'u_karan',
    title: 'Create the SECOND lead in a row (repeat work)',
    run: async (c) => {
      await flows.W1.run(new Counter(c.page));
      await c.page.goto(`${BASE}/dashboard`);
      await c.page.waitForTimeout(800);
      return flows.W1.run(c);
    },
  },
  W2: {
    user: 'u_karan',
    title: 'Log a follow-up call on a lead',
    run: async (c) => {
      const p = c.page;
      await c.click(p.locator('nav.rail a[aria-label*="Lead"]'), 'Leads (rail)');
      await c.click(p.locator('.sidebar-scroll a', { hasText: /^Follow-ups$/ }), 'Follow-ups (sidebar)');
      await c.click(p.getByRole('button', { name: 'Log Follow-up' }), 'Log Follow-up (row)');
      await c.fill(p.locator('#act-subject'), 'Called, sending quote tomorrow', 'subject');
      const dateBtn = p.locator('[role=dialog] button[aria-label^="Next follow-up date"]').first();
      if ((await dateBtn.getAttribute('aria-label'))?.includes('not set')) {
        await c.click(dateBtn, 'Next follow-up date (open picker)');
        await c.click(p.locator('.dp-day:not(.is-outside):not([disabled])').last(), 'pick a day');
      }
      await c.click(p.getByRole('button', { name: 'Save Activity' }), 'Save Activity');
      await p.waitForTimeout(900);
      return (await p.getByRole('dialog').count()) ? 'FAILED (dialog still open)' : 'saved';
    },
  },
  W3: {
    user: 'u_arjun',
    title: 'Approve a quotation discount',
    run: async (c) => {
      const p = c.page;
      await c.click(p.locator('nav.rail a[aria-label*="Quotation"]'), 'Quotations (rail)');
      await c.click(p.locator('.sidebar-scroll a', { hasText: /Pending Approvals/i }), 'Pending approvals (sidebar)');
      await c.click(p.getByRole('button', { name: 'Approve', exact: true }), 'Approve (row)');
      await p.waitForTimeout(500);
      const dialog = await p.getByRole('dialog, alertdialog').count().catch(() => 0);
      const dlg = p.locator('[role=dialog], [role=alertdialog]');
      if (await dlg.count()) await c.click(dlg.getByRole('button', { name: /Approve|Confirm/ }), 'Approve (confirm in dialog)');
      await p.waitForTimeout(800);
      void dialog;
      return 'done';
    },
  },
  W4: {
    user: 'u_suresh',
    title: 'Export the lead list',
    run: async (c) => {
      const p = c.page;
      await c.click(p.locator('nav.rail a[aria-label*="Lead"]'), 'Leads (rail)');
      await c.click(p.getByRole('button', { name: /^Export/ }), 'Export');
      await p.waitForTimeout(600);
      return (await p.getByText(/exported/i).count()) ? 'exported' : 'clicked (no confirmation seen)';
    },
  },
  W5: {
    user: 'u_karan',
    title: 'Come back to the list view I was using',
    run: async (c) => {
      const p = c.page;
      await c.click(p.locator('nav.rail a[aria-label*="Lead"]'), 'Leads (rail)');
      await c.click(p.locator('.view-tabs button, [role=tab]', { hasText: 'Board' }), 'switch to Board view');
      await c.click(p.locator('nav.rail a[aria-label*="Dashboard"]'), 'Dashboard (rail) — leave');
      await c.click(p.locator('nav.rail a[aria-label*="Lead"]'), 'Leads (rail) — return');
      await p.waitForTimeout(600);
      const onBoard = (await p.locator('.board').count()) > 0;
      if (!onBoard) await c.click(p.locator('.view-tabs button, [role=tab]', { hasText: 'Board' }), 'switch to Board view again');
      return onBoard ? 'view remembered' : 'view reset (re-selected)';
    },
  },
  W6: {
    user: 'u_meera',
    title: 'Log a service ticket from a call',
    run: async (c) => {
      const p = c.page;
      await c.click(p.locator('nav.rail a[aria-label*="Service"]'), 'Service (rail)');
      await c.click(p.getByRole('button', { name: /Log Ticket/ }), 'Log Ticket');
      const dlg = p.getByRole('dialog');
      await c.click(dlg.locator('button.select-menu-trigger[aria-label*="Customer"]').first(), 'Customer (open)');
      await c.fill(p.getByPlaceholder(/Search/).last(), 'Arvind', 'customer search');
      await c.click(p.getByRole('option').first(), 'Customer (choose)');
      await p.waitForTimeout(300);
      await c.pickFirstOption(dlg.locator('button.select-menu-trigger[aria-label*="Machine"]').first(), 'Machine');
      await c.fill(dlg.locator('textarea').first(), 'Printer stops mid-job and shows an error', 'complaint description');
      await c.pickFirstOption(dlg.locator('button.select-menu-trigger[aria-label*="Complaint category"]').first(), 'Complaint category');
      await c.click(dlg.getByRole('button', { name: /^(Log Ticket|Create|Save)/ }).last(), 'Log Ticket (save)');
      await p.waitForTimeout(1200);
      const text = (await p.getByRole('dialog').count()) ? await p.getByRole('dialog').innerText() : '';
      return /TKT-\d/.test(text) ? 'saved' : `FAILED: ${text.replace(/\n+/g, ' | ').slice(0, 120)}`;
    },
  },
  W7: {
    user: 'u_arjun',
    title: 'Approve all 3 pending discounts',
    run: async (c) => {
      const p = c.page;
      await c.click(p.locator('nav.rail a[aria-label*="Quotation"]'), 'Quotations (rail)');
      await c.click(p.locator('.sidebar-scroll a', { hasText: /Pending Approvals/i }), 'Pending approvals (sidebar)');
      await p.waitForTimeout(1500);
      const bulk = p.getByRole('checkbox', { name: /Select all approvals/ });
      if (await bulk.count()) {
        await c.click(bulk, 'select all');
        await c.click(p.getByRole('button', { name: /Approve \d+ selected/ }), 'Approve selected');
        await c.click(p.getByRole('alertdialog').getByRole('button', { name: /Approve \d+ selected/ }), 'Approve selected (confirm)');
      } else {
        for (let i = 0; i < 3; i++) {
          await c.click(p.getByRole('button', { name: 'Approve', exact: true }), `Approve #${i + 1}`);
          await c.click(p.locator('[role=alertdialog]').getByRole('button', { name: 'Approve', exact: true }), `Approve #${i + 1} (confirm)`);
          await p.waitForTimeout(600);
        }
      }
      await p.waitForTimeout(800);
      return `${await p.getByRole('button', { name: 'Approve', exact: true }).count()} approve buttons left`;
    },
  },
};

const want = process.argv.slice(2).filter((a) => /^W\d/.test(a));
const browser = await chromium.launch();
for (const [id, f] of Object.entries(flows)) {
  if (want.length && !want.includes(id)) continue;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await openAs(page, f.user, '/dashboard');
  const c = new Counter(page);
  let result = '';
  try {
    result = await f.run(c);
  } catch (e) {
    result = `ERROR ${(e as Error).message.split('\n')[0]}`;
  }
  console.log(`${id} ${f.title}: ${c.clicks} clicks, ${c.entries} entries — ${result}`);
  if (process.env.VERBOSE) c.log.forEach((l) => console.log('     ', l));
  await page.close();
}
await browser.close();
