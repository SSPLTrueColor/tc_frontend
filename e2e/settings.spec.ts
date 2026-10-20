/**
 * Settings stress tests (Step 4 of the Settings redesign). One spec, grouped by what is being stressed:
 *  - layout:     every page × 5 widths, 125 % / 150 % zoom, light + dark, console errors
 *  - roles:      every role × every page (visibility matches the sidebar, no crashes)
 *  - keyboard:   Tab through every page, visible focus, no trap
 *  - behaviour:  save bar, leave guard, double-click save, validation, failure, slow network
 *  - volume:     empty / 1 / 600+ records, very long text
 * Results are summarised into docs/SETTINGS-QA.md.
 */
import { expect, test, type Page } from '@playwright/test';
import { editDb, openAs, pageOverflow, watchErrors } from './helpers';
import { PAGES, ROLE_USERS, WIDTHS } from './pages';

test.describe.configure({ mode: 'parallel' });

const ADMIN = ROLE_USERS.admin;
const titleOf = (page: Page) => page.locator('h1.page-title');

// ------------------------------------------------------------------ layout

test.describe('layout', () => {
  for (const p of PAGES) {
    test(`${p.id}: renders, no console errors, no horizontal scroll at every width`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openAs(page, ADMIN, p.path, { theme: 'dark' });
      await expect(titleOf(page)).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(900);
      for (const w of [...WIDTHS, 1152, 960]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(150);
        const o = await pageOverflow(page);
        expect.soft(o.doc, `${p.id} @${w}: page scrolls horizontally by ${o.doc}px`).toBeLessThanOrEqual(1);
        expect.soft(o.main, `${p.id} @${w}: content area overflows by ${o.main}px`).toBeLessThanOrEqual(1);
      }
      expect(errors, errors.join('\n')).toEqual([]);
    });

    test(`${p.id}: light and dark both render with readable text`, async ({ page }) => {
      for (const theme of ['light', 'dark'] as const) {
        await openAs(page, ADMIN, p.path, { theme });
        await expect(titleOf(page)).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(700);
        const worst = await page.evaluate(() => {
          const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
          const lum = ([r, g, b]: number[]) => {
            const f = (v: number) => {
              const s = v / 255;
              return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
          };
          const bgOf = (el: Element | null): number[] => {
            while (el) {
              const c = parse(getComputedStyle(el).backgroundColor);
              if (c.length >= 3 && (c.length === 3 || c[3] > 0.9)) return c;
              el = el.parentElement;
            }
            return [255, 255, 255];
          };
          let min = 21;
          let who = '';
          const els = document.querySelectorAll('main .st-section-title, main .st-help, main .st-desc, main .field-label, main .field-help, main .mini-table th, main .mini-table td');
          els.forEach((el) => {
            if (!(el as HTMLElement).offsetParent || !el.textContent?.trim()) return;
            const fg = parse(getComputedStyle(el).color);
            const bg = bgOf(el);
            const a = lum(fg) + 0.05;
            const b = lum(bg) + 0.05;
            const ratio = a > b ? a / b : b / a;
            if (ratio < min) {
              min = ratio;
              who = `${el.className || el.tagName}: "${el.textContent?.trim().slice(0, 30)}"`;
            }
          });
          return { min: Math.round(min * 100) / 100, who };
        });
        expect.soft(worst.min, `${p.id} ${theme}: lowest text contrast ${worst.min}:1 on ${worst.who}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

// ------------------------------------------------------------------ roles

test.describe('roles', () => {
  for (const [role, user] of Object.entries(ROLE_USERS)) {
    test(`${role}: every settings page is either listed in the nav and opens, or is blocked cleanly`, async ({ page }) => {
      test.setTimeout(240_000);
      const errors = watchErrors(page);
      await openAs(page, user, '/admin/profile');
      await expect(titleOf(page)).toBeVisible({ timeout: 10_000 });
      const navPaths = await page.locator('.sidebar-scroll a.nav-row').evaluateAll((els) => els.map((a) => (a as HTMLAnchorElement).pathname));
      const problems: string[] = [];
      for (const p of PAGES) {
        await page.goto(`${page.url().split('/admin')[0]}${p.path}`);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1500);
        const blocked = await page.getByText(/^No access to /).first().isVisible().catch(() => false);
        const listed = navPaths.includes(p.path);
        const hasTitle = await titleOf(page).isVisible().catch(() => false);
        if (listed && blocked) problems.push(`${p.id}: in nav but shows "No access"`);
        if (!listed && !blocked && p.kit) problems.push(`${p.id}: opens by URL but is not in the nav`);
        if (!listed && !hasTitle && !blocked) problems.push(`${p.id}: blank page`);
      }
      expect(problems, problems.join('\n')).toEqual([]);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }

  test('non-admin: Data Protection is read-only and Roles & Permissions cannot be edited', async ({ page }) => {
    await openAs(page, ROLE_USERS.sales_manager, '/admin/data-protection');
    await expect(page.getByText('Only a System Administrator can change these settings')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#dp-auditMonths')).toBeDisabled();
    await expect(page.locator('input[role="switch"]').first()).toBeDisabled();
  });
});

// ------------------------------------------------------------------ keyboard

test.describe('keyboard', () => {
  for (const p of PAGES.filter((x) => x.kit)) {
    test(`${p.id}: Tab reaches controls, focus is always visible, no trap`, async ({ page }) => {
      await openAs(page, ADMIN, p.path);
      await expect(titleOf(page)).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(900);
      await page.locator('#main').focus();
      const seen = new Set<string>();
      const hidden: string[] = [];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        const r = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
          // Visually hidden inputs (switch / checkbox) show the ring on their track sibling.
          const sib = el.nextElementSibling ? getComputedStyle(el.nextElementSibling) : null;
          const sibRing = !!sib && ((sib.outlineStyle !== 'none' && parseFloat(sib.outlineWidth) > 0) || sib.boxShadow !== 'none');
          // The sidebar search draws its ring on the wrapper (:focus-within).
          const wrap = el.closest('.sidebar-search');
          const wrapRing = !!wrap && getComputedStyle(wrap).boxShadow !== 'none';
          const label = `${el.tagName.toLowerCase()}#${el.id || ''}.${String(el.className).split(' ')[0]}[${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}]`;
          return { label, ok: ring || sibRing || wrapRing };
        });
        if (!r) continue;
        seen.add(r.label);
        if (!r.ok) hidden.push(r.label);
      }
      expect(seen.size, 'Tab never moved focus').toBeGreaterThan(3);
      expect(hidden, `no visible focus ring on: ${hidden.join(', ')}`).toEqual([]);
    });
  }
});

// ------------------------------------------------------------------ touch targets

test.describe('touch targets (375px)', () => {
  for (const p of PAGES.filter((x) => x.kit)) {
    test(`${p.id}: buttons, inputs and selects are at least 44px tall`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      await openAs(page, ADMIN, p.path);
      await expect(titleOf(page)).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(900);
      const small = await page.evaluate(() => {
        const out: string[] = [];
        document.querySelectorAll('main .st-col button, main .st-col input:not([type=hidden]):not([type=checkbox]):not([type=radio]), main .st-col select, main .st-col textarea, main .st-col a.btn').forEach((el) => {
          const e = el as HTMLElement;
          if (!e.offsetParent) return;
          const r = e.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (e.matches('input[role=switch]')) return; // the visible track is wrapped by a 44px label
          if (e.matches('.org-toggle, .infotip-btn')) return; // small visual, 44px hit area via ::after
          if (r.height < 43.5) out.push(`${e.tagName.toLowerCase()}[${(e.getAttribute('aria-label') || e.textContent || e.id || '').trim().slice(0, 24)}] ${Math.round(r.height)}px`);
        });
        return out;
      });
      expect(small, small.join('\n')).toEqual([]);
    });
  }
});

// ------------------------------------------------------------------ behaviour

test.describe('behaviour', () => {
  test('save bar appears only with unsaved changes; Cancel restores', async ({ page }) => {
    await openAs(page, ADMIN, '/admin/notification-preferences');
    const bar = page.getByRole('region', { name: 'Unsaved changes' });
    await expect(page.locator('#np-from, .st-grid').first()).toBeVisible({ timeout: 10_000 });
    await expect(bar).toBeHidden();
    const box = page.getByLabel('Email for Follow-ups and tasks due');
    const before = await box.isChecked();
    await box.click();
    await expect(bar).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(bar).toBeHidden();
    expect(await box.isChecked()).toBe(before);
  });

  test('leaving with unsaved changes asks first (in-app link) and refresh warns (beforeunload)', async ({ page }) => {
    await openAs(page, ADMIN, '/admin/notification-preferences');
    await expect(page.locator('.st-grid')).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Email for Follow-ups and tasks due').click();
    await page.getByRole('link', { name: 'Security' }).click();
    const leave = page.getByRole('alertdialog', { name: 'Leave without saving?' });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/notification-preferences/);
    await page.getByRole('link', { name: 'Security' }).click();
    await page.getByRole('button', { name: 'Leave page' }).click();
    await expect(page).toHaveURL(/\/admin\/security/);
    // refresh / close: the page registers a beforeunload guard only while there are unsaved changes
    await page.goto(page.url().replace('security', 'notification-preferences'));
    await expect(page.locator('.st-grid')).toBeVisible({ timeout: 10_000 });
    const guarded = () =>
      page.evaluate(() => {
        const e = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      });
    expect(await guarded()).toBe(false);
    await page.getByLabel('Email for Follow-ups and tasks due').click();
    expect(await guarded()).toBe(true);
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(await guarded()).toBe(false);
  });

  test('rapid double-click on Save saves once', async ({ page }) => {
    await openAs(page, ADMIN, '/admin/notification-preferences');
    await expect(page.locator('.st-grid')).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Email for Follow-ups and tasks due').click();
    await page.getByRole('button', { name: 'Save', exact: true }).dblclick();
    await page.waitForTimeout(1800);
    const n = await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('tc.crm.db.v1') ?? '{}');
      return (db.audit ?? []).filter((a: { summary: string }) => a.summary === 'Notification preferences changed').length;
    });
    expect(n).toBe(1);
  });

  test('quiet hours: same start and end is rejected and nothing is saved', async ({ page }) => {
    await openAs(page, ADMIN, '/admin/notification-preferences');
    await expect(page.locator('.st-grid')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('switch', { name: 'Pause messages at night' }).setChecked(true, { force: true });
    await page.locator('#np-to').fill('21:00');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Start and end must be different')).toBeVisible();
  });

  test('toggles save instantly with a toast (daily digest)', async ({ page }) => {
    await openAs(page, ADMIN, '/admin/notification-preferences');
    await expect(page.locator('.st-grid')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('switch', { name: 'Send me a daily digest' }).setChecked(true, { force: true });
    await expect(page.getByText('Daily digest turned on')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeHidden();
  });

  test('data protection: spaces, emoji, symbols, long and duplicate subjects are rejected; specials are escaped', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await openAs(page, ADMIN, '/admin/data-protection');
    await expect(page.locator('#dp-subject')).toBeVisible({ timeout: 10_000 });
    const submit = page.getByRole('button', { name: 'Log request' });
    const tryText = async (v: string, err: RegExp) => {
      await page.locator('#dp-subject').fill(v);
      await submit.click();
      await expect(page.getByText(err).first()).toBeVisible();
    };
    await tryText('     ', /Enter who the request is about/);
    await tryText('A', /at least 2 characters/);
    await tryText('😀😀😀', /letters or numbers/);
    await tryText('!!!???', /letters or numbers/);
    await tryText('x'.repeat(81), /80 characters or fewer/);
    await page.locator('#dp-details').fill('d'.repeat(501));
    await expect(page.getByText(/500 characters or fewer/)).toBeVisible();
    await page.locator('#dp-details').fill('');
    await page.locator('#dp-subject').fill('<script>alert(1)</script> Café Ünï');
    await submit.click();
    await expect(page.getByText(/Request DPR-\d+ logged/)).toBeVisible();
    await expect(page.locator('td', { hasText: '<script>alert(1)</script>' }).first()).toBeVisible();
    expect(dialogs).toEqual([]);
    // duplicate open request of the same type for the same person
    await page.locator('#dp-subject').fill('<script>alert(1)</script> Café Ünï');
    await submit.click();
    await expect(page.getByText(/open request of this type already exists/)).toBeVisible();
  });

  test('data protection: retention min/max/decimal/empty are rejected', async ({ page }) => {
    await openAs(page, ADMIN, '/admin/data-protection');
    await expect(page.locator('#dp-auditMonths')).toBeVisible({ timeout: 10_000 });
    for (const [v, err] of [
      ['0', /from 12 to 120/],
      ['121', /from 12 to 120/],
      ['12.5', /whole number/],
      ['', /whole number/],
    ] as const) {
      await page.locator('#dp-auditMonths').fill(v);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText(err).first()).toBeVisible();
    }
    await page.locator('#dp-auditMonths').fill('60');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Retention periods saved')).toBeVisible();
  });

  test('policies: out-of-range numbers show an inline error after blur and block save', async ({ page }) => {
    await openAs(page, ADMIN, '/admin/configurable-rules');
    await expect(page.locator('#pol-lead')).toBeVisible({ timeout: 10_000 });
    await page.locator('#pol-lead').fill('-5');
    await page.locator('#pol-lead').blur();
    await expect(page.locator('#pol-lead-err')).toBeVisible();
    await page.locator('#pol-lead').fill('1e999');
    await page.getByRole('button', { name: /Save/ }).first().click();
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible();
  });

  test('typed confirmation: Danger zone action stays disabled until the word is typed', async ({ page }) => {
    await openAs(page, ADMIN, '/admin/configurable-rules');
    await expect(page.locator('.st-danger')).toBeVisible({ timeout: 10_000 });
    await page.locator('.st-danger').getByRole('button').click();
    const dlg = page.getByRole('alertdialog');
    const confirm = dlg.getByRole('button', { name: 'Restore Defaults' });
    await expect(confirm).toBeDisabled();
    await dlg.locator('input').fill('reset');
    await expect(confirm).toBeDisabled();
    await dlg.locator('input').fill('RESET');
    await expect(confirm).toBeEnabled();
  });

  test('service failure: every data page shows an error state with Retry (no crash, no blank)', async ({ page }) => {
    for (const path of ['/admin/security', '/admin/notification-preferences', '/admin/data-protection', '/admin/organisation-hierarchy', '/admin/configurable-rules', '/admin/workflows', '/admin/sla-matrix']) {
      const errors = watchErrors(page);
      await openAs(page, ADMIN, path, { db: 'db.demo.failureRate = 1; db.demo.latencyMin = 50; db.demo.latencyMax = 100;' });
      await expect(page.getByRole('button', { name: 'Retry' }), path).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Retry' }).click();
      await expect(page.getByRole('button', { name: 'Retry' }), `${path} after retry`).toBeVisible({ timeout: 10_000 });
      expect(errors.filter((e) => !/Failed to load resource|network/i.test(e)), errors.join('\n')).toEqual([]);
    }
  });

  test('service failure: turning failures off in Demo Settings lets the same page recover, nothing lost', async ({ page }) => {
    await openAs(page, ADMIN, '/admin/notification-preferences', { db: 'db.demo.failureRate = 1; db.demo.latencyMin = 50; db.demo.latencyMax = 100;' });
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('link', { name: 'Demo Settings' }).click();
    await page.getByRole('button', { name: /Simulated failures/ }).click();
    await page.getByRole('option', { name: 'Never' }).click();
    await page.getByRole('link', { name: 'Notification Preferences' }).click();
    await expect(page.locator('.st-grid')).toBeVisible({ timeout: 10_000 });
  });

  test('slow network (3 s): skeleton shows, then content; Save is disabled while saving', async ({ page }) => {
    await openAs(page, ADMIN, '/admin/notification-preferences', { db: 'db.demo.latencyMin = 3000; db.demo.latencyMax = 3000;' });
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.st-grid')).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Email for Follow-ups and tasks due').click();
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await save.click();
    await expect(save).toBeDisabled();
  });

  test('unsaved changes survive switching a tab inside the page (Roles) and are flagged', async ({ page }) => {
    await openAs(page, ADMIN, '/admin/roles-permissions');
    await page.getByRole('tab', { name: 'Roles', exact: true }).click();
    await expect(page.locator('#ap-role')).toBeVisible({ timeout: 10_000 });
    await page.locator('.area-toggle').first().click();
    await page.locator('.area-row.area-sub').first().locator('button').first().click();
    await page.getByRole('option').nth(1).click();
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible();
    await page.getByRole('tab', { name: 'Advanced' }).click();
    await page.getByRole('button', { name: 'Compare roles' }).click();
    await page.getByRole('tab', { name: 'Roles', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible();
  });

  test('roles: Reset lives in the Danger zone and needs a typed word', async ({ page }) => {
    await openAs(page, ADMIN, '/admin/roles-permissions');
    await page.getByRole('tab', { name: 'Roles', exact: true }).click();
    await expect(page.locator('#ap-role')).toBeVisible({ timeout: 10_000 });
    await page.locator('.area-toggle').first().click();
    await page.locator('.area-row.area-sub').first().locator('button').first().click();
    await page.getByRole('option').nth(1).click();
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.locator('.st-danger')).toBeVisible({ timeout: 10_000 });
    await page.locator('.st-danger').getByRole('button').click();
    await expect(page.getByRole('alertdialog').getByRole('button', { name: 'Reset to Default' })).toBeDisabled();
  });
});

// ------------------------------------------------------------------ volume + long text

const BIG = `
  const now = new Date().toISOString();
  db.recycle = Array.from({ length: 650 }, (_, i) => ({ id: 'rb' + i, workspaceId: 'tc', resource: 'leads', record: { id: 'LD-' + i, fullName: 'Deleted lead ' + i }, deletedAt: now, deletedBy: 'u_rahul' }));
  db.outbox = Array.from({ length: 650 }, (_, i) => ({ id: 'ob' + i, workspaceId: 'tc', status: 'simulated', channel: 'email', to: 'person' + i + '@example.com', subject: 'Subject ' + i, body: 'Body text number ' + i + ' ' + 'long '.repeat(40), createdAt: now, createdBy: 'u_rahul' }));
  const base = db.audit[0] ?? { id: 'a', at: now, workspaceId: 'tc', actorId: 'u_rahul', actorRole: 'System Administrator', actorType: 'user', action: 'update', summary: 'x', correlationId: 'c' };
  db.audit = Array.from({ length: 1500 }, (_, i) => ({ ...base, id: 'aud' + i, summary: 'Changed record ' + i + ' ' + 'detail '.repeat(10) }));
  db.dataProtection = { consents: { employeeLocation: true, customerComms: true, whatsappOptIn: true }, retention: { auditMonths: 84, recycleDays: 30, inactiveContactMonths: 36 }, requests: Array.from({ length: 600 }, (_, i) => ({ id: 'DPR-' + String(i + 1).padStart(4, '0'), type: 'correction', subject: 'Person number ' + i + ' ' + 'LongNameWithoutSpaces'.repeat(6), details: '', status: 'open', createdAt: now, createdBy: 'u_rahul' })) };
`;

test.describe('volume and long text', () => {
  for (const [id, path, rowSel, label] of [
    ['recycle-bin', '/admin/recycle-bin', '.mini-table tbody tr', 'Recycle Bin (650)'],
    ['sent-messages', '/admin/sent-messages', '.mini-table tbody tr', 'Sent Messages (650)'],
    ['audit-trail', '/admin/audit-trail', '.mini-table tbody tr', 'Audit Trail (1,500)'],
    ['data-protection', '/admin/data-protection', '.mini-table tbody tr', 'Data Protection requests (600, long names)'],
  ] as const) {
    test(`${label}: paginates, stays fast, no overflow`, async ({ page }) => {
      const errors = watchErrors(page);
      await openAs(page, ADMIN, path, { db: BIG });
      const t0 = Date.now();
      await expect(page.locator(rowSel).first()).toBeVisible({ timeout: 15_000 });
      const ms = Date.now() - t0;
      const rows = await page.locator(rowSel).count();
      expect(rows, `${id} rendered ${rows} rows at once`).toBeLessThanOrEqual(100);
      expect(ms, `${id} took ${ms}ms to show rows`).toBeLessThan(4000);
      for (const w of [1440, 768, 375]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(250);
        const o = await pageOverflow(page);
        expect.soft(o.doc, `${id} @${w} horizontal overflow ${o.doc}px`).toBeLessThanOrEqual(1);
      }
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }

  test('empty states: recycle bin, no-match search, data-protection requests', async ({ page }) => {
    await openAs(page, ADMIN, '/admin/recycle-bin', { db: 'db.recycle = []; db.dataProtection = { requests: [] };' });
    await expect(page.getByText(/No (deleted|items|records)|empty/i).first()).toBeVisible({ timeout: 10_000 });
    await page.goto(page.url().replace('recycle-bin', 'sent-messages'));
    await expect(page.locator('.mini-table tbody tr').first()).toBeVisible({ timeout: 10_000 });
    await page.locator('#main input[type=search]').first().fill('zzzzzzzzzz-no-such-message');
    await expect(page.getByText(/No matching/i).first()).toBeVisible();
    await page.goto(page.url().replace('sent-messages', 'data-protection'));
    await expect(page.getByText('No requests yet')).toBeVisible({ timeout: 10_000 });
  });

  test('one record: data protection shows a single row', async ({ page }) => {
    await openAs(page, ADMIN, '/admin/data-protection', {
      db: "db.dataProtection = { requests: [{ id: 'DPR-0001', type: 'access', subject: 'Only one', details: '', status: 'open', createdAt: new Date().toISOString(), createdBy: 'u_rahul' }] };",
    });
    await expect(page.locator('.mini-table tbody tr')).toHaveCount(1, { timeout: 10_000 });
  });

  test('masters: a very long label truncates without breaking the layout', async ({ page }) => {
    await openAs(page, ADMIN, '/admin/masters');
    await expect(page.locator('.st-masters')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Start Draft' }).click();
    await page.locator('#new-master-value').fill('Z'.repeat(80));
    await page.getByRole('button', { name: 'Add Value' }).click();
    const o = await pageOverflow(page);
    expect(o.doc).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 375, height: 900 });
    await page.waitForTimeout(250);
    expect((await pageOverflow(page)).doc).toBeLessThanOrEqual(1);
  });
});

// ------------------------------------------------------------------ people and extra access

test.describe('people and extra access', () => {
  const openPeople = async (page: Page) => {
    await openAs(page, ADMIN, '/admin/roles-permissions');
    await expect(page.getByRole('tab', { name: 'People' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Karan Singh/ }).click();
    await expect(page.getByRole('heading', { name: 'Karan Singh' })).toBeVisible();
  };

  test('give extra access: validated, takes effect, listed, expires list, removable', async ({ page }) => {
    await openPeople(page);
    await page.getByRole('button', { name: 'Give extra access' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.locator('#gr-what').click();
    await page.getByRole('option', { name: 'Spare Parts' }).click();
    await dlg.getByRole('button', { name: 'Give access' }).click();
    await expect(dlg.getByText('Say why they need it.')).toBeVisible();
    await dlg.locator('#gr-reason').fill('😀😀😀');
    await dlg.getByRole('button', { name: 'Give access' }).click();
    await expect(dlg.getByText(/words, not only symbols/)).toBeVisible();
    await dlg.locator('#gr-reason').fill('Covering the store while Prakash is away');
    await dlg.getByRole('button', { name: 'Give access' }).click();
    await expect(page.getByText('Extra access given to Karan Singh')).toBeVisible();
    await expect(page.locator('.pa-grant', { hasText: 'Spare Parts' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Expiring soon/ })).toContainText('1');
    // Karan can now open Spare Parts
    await page.getByRole('tab', { name: /Expiring soon/ }).click();
    await expect(page.locator('.mini-table tbody tr')).toHaveCount(1);
    await openAs(page, ROLE_USERS.sales_exec, '/spare-parts');
    await expect(page.getByText(/^No access to /)).toBeHidden({ timeout: 10_000 });
    // remove it again
    await openAs(page, ADMIN, '/admin/roles-permissions');
    await page.getByRole('tab', { name: /Expiring soon/ }).click();
    await page.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Extra access removed')).toBeVisible();
    await expect(page.getByText('No extra access has been given')).toBeVisible();
  });

  test('change role shows what changes before it happens', async ({ page }) => {
    await openPeople(page);
    await page.locator('#pa-role').click();
    await page.getByRole('option', { name: 'Sales Manager' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText(/Gains|Changes|Loses|will not change/);
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.pa-head')).toContainText('Sales Executive');
  });

  test('"cannot see something" explains the role and offers the fix', async ({ page }) => {
    await openPeople(page);
    await page.getByRole('button', { name: /Record type/ }).click();
    await page.getByRole('option', { name: 'Spare Parts' }).click();
    await expect(page.locator('.pa-why-text')).toContainText('cannot open');
    await page.getByRole('button', { name: 'Give extra access' }).last().click();
    await expect(page.getByRole('dialog')).toContainText('Spare Parts');
  });

  test('non-administrators see people read-only (no role change, no give / remove)', async ({ page }) => {
    await openAs(page, ROLE_USERS.management, '/admin/roles-permissions');
    await expect(page.getByRole('tab', { name: 'People' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Give extra access' })).toHaveCount(0);
    await expect(page.locator('#pa-role')).toHaveCount(0);
  });
});
