/**
 * Component consistency checks (UX Step 2): the Component Gallery renders every shared component in every state;
 * these tests check the rules that make the app look the same everywhere.
 */
import { expect, test } from '@playwright/test';
import { openAs, pageOverflow, watchErrors } from './helpers';

const GALLERY = '/admin/component-gallery';
const lum = (c: number[]) => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};

test.describe('component gallery', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: renders without errors or horizontal scroll at every width`, async ({ page }) => {
      const errors = watchErrors(page);
      await openAs(page, 'u_rahul', GALLERY, { theme });
      await expect(page.locator('h1.page-title')).toHaveText('Component Gallery');
      for (const w of [1440, 1024, 768, 375]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(250);
        expect((await pageOverflow(page)).doc, `@${w}`).toBeLessThanOrEqual(1);
      }
      expect(errors, errors.join('\n')).toEqual([]);
    });

    test(`${theme}: every status chip tone has readable text (≥ 4.5:1)`, async ({ page }) => {
      await openAs(page, 'u_rahul', GALLERY, { theme });
      const rows = await page.evaluate(() => {
        const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
        const bg = (el: Element | null): number[] => {
          while (el) {
            const c = parse(getComputedStyle(el).backgroundColor);
            if (c.length >= 3 && (c.length === 3 || c[3] > 0.9)) return c;
            // translucent: blend over the parent's background
            if (c.length === 4 && c[3] > 0) {
              const under = bg(el.parentElement);
              return [0, 1, 2].map((i) => Math.round(c[i] * c[3] + under[i] * (1 - c[3])));
            }
            el = el.parentElement;
          }
          return [255, 255, 255];
        };
        return [...document.querySelectorAll('[data-gallery="chips"] .chip, [data-gallery="chips"] *')]
          .filter((e) => e.children.length === 0 && e.textContent?.trim())
          .map((e) => ({ tone: e.textContent!.trim(), fg: parse(getComputedStyle(e).color), bg: bg(e) }));
      });
      expect(rows.length).toBeGreaterThan(5);
      const bad = rows.filter((r) => {
        const a = lum(r.fg) + 0.05;
        const b = lum(r.bg) + 0.05;
        return (a > b ? a / b : b / a) < 4.5;
      });
      expect(bad.map((b) => `${b.tone} fg=${b.fg} bg=${b.bg}`), 'low-contrast chips').toEqual([]);
    });
  }

  test('keyboard: Tab reaches every control and each shows a focus ring', async ({ page }) => {
    await openAs(page, 'u_rahul', GALLERY);
    await page.locator('#main').focus();
    const seen = new Set<string>();
    const noRing: string[] = [];
    for (let i = 0; i < 70; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body || !el.closest('#main')) return null;
        const cs = getComputedStyle(el);
        const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
        const sib = el.nextElementSibling ? getComputedStyle(el.nextElementSibling) : null;
        const sibRing = !!sib && ((sib.outlineStyle !== 'none' && parseFloat(sib.outlineWidth) > 0) || sib.boxShadow !== 'none');
        const wrapRing = !!el.closest('.select-menu') && ring;
        return { label: `${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') || el.textContent || el.id || '').trim().slice(0, 20)}]`, ok: ring || sibRing || wrapRing, type: (el as HTMLInputElement).type };
      });
      if (!r) continue;
      seen.add(r.label);
      if (!r.ok && r.type !== 'radio') noRing.push(r.label);
    }
    expect(seen.size).toBeGreaterThan(15);
    expect(noRing, `no focus ring: ${noRing.join(', ')}`).toEqual([]);
  });

  test('touch: every control is ≥ 44 px tall on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openAs(page, 'u_rahul', GALLERY);
    await expect(page.locator('h1.page-title')).toBeVisible();
    const small = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll('#main button, #main input:not([type=checkbox]):not([type=radio]):not([role=switch]), #main textarea, #main a.btn').forEach((el) => {
        const e = el as HTMLElement;
        if (!e.offsetParent) return;
        if (e.matches('.org-toggle, .infotip-btn')) return;
        const r = e.getBoundingClientRect();
        if (r.height && r.height < 43.5 && !e.closest('.grid-pages')) out.push(`${e.tagName.toLowerCase()}[${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20)}] ${Math.round(r.height)}px`);
      });
      return out;
    });
    expect(small, small.join('\n')).toEqual([]);
  });

  test('typed confirmation needs the exact word; plain confirmation does not', async ({ page }) => {
    await openAs(page, 'u_rahul', GALLERY);
    await page.getByRole('button', { name: 'Confirm (delete)' }).click();
    const plain = page.getByRole('alertdialog');
    await expect(plain.getByRole('button', { name: 'Delete' })).toBeEnabled();
    await plain.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Confirm (typed)' }).click();
    const typed = page.getByRole('alertdialog');
    await expect(typed.getByRole('button', { name: 'Reset' })).toBeDisabled();
    await typed.locator('input').fill('reset');
    await expect(typed.getByRole('button', { name: 'Reset' })).toBeDisabled();
    await typed.locator('input').fill('RESET');
    await expect(typed.getByRole('button', { name: 'Reset' })).toBeEnabled();
  });

  test('DataTable: sorts, searches and pages with the shared footer', async ({ page }) => {
    await openAs(page, 'u_rahul', GALLERY);
    const table = page.locator('table[aria-label="Sample"]');
    await expect(table.locator('tbody tr')).toHaveCount(5);
    await page.getByRole('button', { name: 'Amount' }).click();
    await page.getByRole('button', { name: 'Amount' }).click();
    await expect(table.locator('tbody tr').first()).toContainText('R-60');
    await page.getByRole('searchbox', { name: /Search Sample/ }).fill('company 1');
    await expect(page.getByText(/of 11 companies/)).toBeVisible();
  });
});

test.describe('chart palette', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: every chart colour reaches 3:1 against the panel (WCAG 1.4.11)`, async ({ page }) => {
      await openAs(page, 'u_rahul', GALLERY, { theme });
      const r = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const probe = document.createElement('span');
        document.body.appendChild(probe);
        const rgb = (v: string) => {
          probe.style.color = v;
          return (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        };
        const out: Record<string, number[]> = { panel: rgb(cs.getPropertyValue('--s-panel')) };
        for (const k of ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 'others', 'neg', 'good']) out[k] = rgb(cs.getPropertyValue(`--rp-${k}`));
        probe.remove();
        return out;
      });
      const bad = Object.entries(r)
        .filter(([k]) => k !== 'panel')
        .map(([k, c]) => ({ k, ratio: (lum(c) > lum(r.panel) ? (lum(c) + 0.05) / (lum(r.panel) + 0.05) : (lum(r.panel) + 0.05) / (lum(c) + 0.05)) }))
        .filter((x) => x.ratio < 3);
      expect(bad, `low-contrast chart colours: ${JSON.stringify(bad)}`).toEqual([]);
    });
  }
});
