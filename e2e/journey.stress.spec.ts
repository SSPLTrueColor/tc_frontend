/**
 * Sales journey stress test: Contact → Lead → Opportunity → Quotation → Approval → Acceptance → Sales Order,
 * driven through the real UI, plus abuse cases (validation, duplicates, double clicks, guards, permissions)
 * and responsive checks. Report-only: assertions that expose bugs use expect.soft and stay failing.
 *
 * Run: npx playwright test e2e/journey.stress.spec.ts   (dev server on BASE_URL, default http://localhost:5175)
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'fs';
import { openAs, pageOverflow, watchErrors } from './helpers';

const SHOTS = '/private/tmp/claude-501/-Users-maysolanki-Documents-True-Color-tc-frontend/6db01995-7c70-4313-86c1-2f272049ad5b/scratchpad/journey';
mkdirSync(SHOTS, { recursive: true });
const KEY = 'tc.crm.db.v1';
const WIDTHS = [1440, 768, 390] as const;

const SALES = 'u_karan'; // Sales Executive – Textile
const MANAGER = 'u_rohan'; // Sales Manager (approve.l1, TX)
const GM = 'u_suresh'; // Division Head TX (approve.l2)
const ADMIN = 'u_rahul';

test.describe.configure({ mode: 'parallel' });

// ------------------------------------------------------------------ helpers

type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const db = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), KEY) as Promise<{ records: Record<string, Rec[]>; approvals?: Rec[] }>;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

async function shot(page: Page, name: string, fullPage = false) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage }).catch(() => {});
}

/** Switches the simulated session to another demo user (keeps the same browser data) and opens `path`. */
async function switchUser(page: Page, uid: string, path: string) {
  await page.evaluate(
    ([k, u]) => {
      const d = JSON.parse(localStorage.getItem(k)!);
      d.session = { userId: u, workspaceId: 'tc', signedIn: true, lastActiveAt: new Date().toISOString() };
      d.settings = { ...(d.settings ?? {}), [u]: { ...(d.settings?.[u] ?? {}), tourSeenAt: new Date().toISOString(), theme: 'light' } };
      localStorage.setItem(k, JSON.stringify(d));
    },
    [KEY, uid] as const,
  );
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

/** Waits for a toast containing `re`. */
async function expectToast(page: Page, re: RegExp, timeout = 6000) {
  await expect(page.locator('.toasts .toast').filter({ hasText: re }).first(), `toast ${re}`).toBeVisible({ timeout });
}

/** Opens a SelectMenu (button "Label: value") and chooses an option, searching first when a search box exists. */
async function pick(page: Page, scope: Page | Locator, label: string, option: RegExp | string, search?: string) {
  await scope.getByRole('button', { name: new RegExp(`^${esc(label)}:`) }).first().click();
  if (search) {
    const box = page.getByRole('textbox', { name: new RegExp(`^Search`) }).last();
    if (await box.isVisible().catch(() => false)) await box.fill(search);
  }
  await page.getByRole('option', { name: option }).first().click();
}

/** Measures horizontal overflow at desktop / tablet / phone widths and screenshots each. */
async function responsive(page: Page, name: string) {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(450);
    const o = await pageOverflow(page);
    await shot(page, `${name}-${w}`);
    expect.soft(o.doc, `${name}: horizontal page overflow at ${w}px`).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(250);
}

/** Clicks Cancel on a dialog and confirms "discard" if an unsaved-changes prompt follows. */
async function cancelDialog(page: Page, dlg: Locator) {
  if (!(await dlg.isVisible().catch(() => false))) return;
  await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
  const ask = page.getByRole('alertdialog');
  if (await ask.isVisible({ timeout: 800 }).catch(() => false)) await ask.getByRole('button', { name: /Discard|Leave|Close|Yes/i }).last().click();
  await expect(dlg).toBeHidden();
}

/** Main-area actions panel (the record page duplicates some buttons inside the drawer). */
const actionsPanel = (page: Page) => page.locator('main');

interface RunData {
  tag: string;
  contactName: string;
  mobile: string;
  email: string;
  companyName?: string;
  existingCompany?: string;
  product: string;
  qty: string;
  discount: string;
  freight: string;
  /** approver users in level order */
  approvers: string[];
  acceptance: 'po' | 'electronic';
}

// ------------------------------------------------------------------ journey building blocks

/** Lead → Create Opportunity dialog (validation, then success). Returns the opportunity id. */
async function qualifyLead(page: Page, leadId: string, d: RunData): Promise<string> {
  await page.goto(`/leads/${leadId}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Actions', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Convert to Opportunity', exact: true }).first().click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await shot(page, `${d.tag}-04-convert-dialog`);
  // Empty required fields → inline validation.
  await dlg.getByLabel('Customer requirement *').fill('');
  await dlg.getByLabel('Decision maker *').fill('');
  await dlg.getByRole('button', { name: 'Convert to Opportunity' }).click();
  await expect(dlg.getByText('Name the decision maker')).toBeVisible();
  await expect(dlg.getByText('Pick the purchase timeline')).toBeVisible();
  await shot(page, `${d.tag}-04b-convert-validation`);
  await dlg.getByLabel('Customer requirement *').fill(`${d.qty} × ${d.product} for new unit`);
  await dlg.getByLabel('Budget (₹) *').fill('2500000');
  await dlg.getByLabel('Decision maker *').fill(`${d.contactName} (Owner)`);
  await pick(page, dlg, 'Purchase timeline', '1–3 Months');
  await dlg.getByLabel('Opportunity name *').fill(`${d.companyName ?? d.existingCompany} – ${d.product} (${d.tag})`);
  await dlg.getByLabel('Expected value (₹) *').fill('2500000');
  // Double click: must not create two opportunities.
  await dlg.getByRole('button', { name: 'Convert to Opportunity' }).dblclick();
  await expectToast(page, /converted to opportunity OPP-/);
  const data = await db(page);
  const lead = data.records.leads.find((l) => l.id === leadId)!;
  const opps = data.records.opportunities.filter((o) => o.leadId === leadId);
  expect.soft(opps.length, 'double-click Create Opportunity creates exactly one opportunity').toBe(1);
  expect(lead.status).toBe('qualified');
  await shot(page, `${d.tag}-05-lead-qualified`);
  return String(lead.opportunityId);
}

/** Moves the opportunity: drag on the board (→ Demo/Sample), list stage dropdown (→ Proposal/Quotation). */
async function movePipeline(page: Page, oppId: string, d: RunData) {
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.getByRole('searchbox', { name: 'Search opportunities' }).fill(oppId);
  await page.waitForTimeout(600);
  const card = page.locator('li.board-card').filter({ hasText: oppId });
  await expect(card).toBeVisible();
  await shot(page, `${d.tag}-06-board-before`);
  const demoCol = page.locator('section.board-col[aria-label^="Demo/Sample"]');
  await card.dragTo(demoCol);
  await page.waitForTimeout(1200);
  let stage = (await db(page)).records.opportunities.find((o) => o.id === oppId)!.stage;
  expect.soft(stage, 'board drag Needs Assessment → Demo/Sample changes the stage').toBe('demo');
  if (stage !== 'demo') {
    // Fallback through the record's Move button so the journey continues.
    await page.goto(`/opportunities/${oppId}`);
    await actionsPanel(page).getByRole('button', { name: 'Move to Demo/Sample' }).click();
    await page.waitForTimeout(1200);
    stage = (await db(page)).records.opportunities.find((o) => o.id === oppId)!.stage;
  }
  expect(stage).toBe('demo');
  await shot(page, `${d.tag}-07-board-after-drag`);

  // List layout: stage dropdown on the row.
  await page.getByRole('radio', { name: 'List' }).click();
  await page.waitForTimeout(800);
  const row = page.getByRole('row').filter({ hasText: oppId });
  await expect(row).toBeVisible();
  const stageBtn = row.getByRole('button', { name: /Change Stage/i });
  if (await stageBtn.count()) {
    await stageBtn.first().click();
    await page.getByRole('menuitem', { name: /Proposal\/Quotation/ }).click();
    await page.waitForTimeout(1200);
  } else {
    expect.soft(false, 'list view has a stage dropdown on the opportunity row').toBe(true);
    await page.goto(`/opportunities/${oppId}`);
    await actionsPanel(page).getByRole('button', { name: 'Move to Proposal/Quotation' }).click();
    await page.waitForTimeout(1200);
  }
  await shot(page, `${d.tag}-08-list-after-dropdown`);
  stage = (await db(page)).records.opportunities.find((o) => o.id === oppId)!.stage;
  expect(stage).toBe('proposal');
  await page.getByRole('radio', { name: 'Kanban' }).click();
}

/** Board card → Create Quotation → editor (validation, lines, discount, freight, terms) → Save & Submit. */
async function createQuotation(page: Page, oppId: string, d: RunData): Promise<Rec> {
  await page.goto(`/pipeline?q=${oppId}`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('searchbox', { name: 'Search opportunities' }).fill(oppId);
  await page.waitForTimeout(600);
  await page.locator('li.board-card').filter({ hasText: oppId }).getByRole('button', { name: 'Create Quotation' }).click();
  await expect(page).toHaveURL(new RegExp(`/quotations/new\\?opportunity=${oppId}`));
  await expect(page.getByRole('heading', { name: 'Line Items' })).toBeVisible();
  await shot(page, `${d.tag}-09-editor-empty`, true);

  // Empty submit → toast + line errors.
  await page.getByRole('button', { name: 'Save & Submit for Approval' }).click();
  await expectToast(page, /fix the highlighted fields/i);
  await expect(page.getByText(/Line 1: choose a product or enter a description/)).toBeVisible();

  await pick(page, page, 'Line 1 product', new RegExp(esc(d.product)), d.product);
  await page.getByRole('textbox', { name: 'Qty' }).first().fill(d.qty);
  await page.getByRole('textbox', { name: 'Discount' }).first().fill(d.discount);
  await page.getByRole('textbox', { name: 'Freight' }).fill(d.freight);
  // Second line: installation (service) so the quote has more than one line.
  await page.getByRole('button', { name: 'Add Line' }).click();
  await pick(page, page, 'Line 2 product', /Installation & commissioning – textile printer/, 'Installation & commissioning – textile');
  await pick(page, page, 'Terms & conditions template', /Standard Terms/);
  await expect(page.getByRole('textbox', { name: 'Payment terms' })).not.toHaveValue('');
  await expect(page.getByText(new RegExp(`Discount ${d.discount}% needs approval`))).toBeVisible();

  // Submit without the discount reason → field error.
  await page.getByRole('button', { name: 'Save & Submit for Approval' }).click();
  await expect(page.getByText('Give a reason for the discount (at least 5 characters)')).toBeVisible();
  await page.getByRole('textbox', { name: 'Reason for the discount *' }).fill(`Competitive price match (${d.tag})`);
  await shot(page, `${d.tag}-10-editor-filled`, true);
  await responsive(page, `${d.tag}-r-quote-editor`);

  // Double click → must create one quotation.
  await page.getByRole('button', { name: 'Save & Submit for Approval' }).dblclick();
  await expectToast(page, /sent for approval \(APR-/);
  const quotes = (await db(page)).records.quotations.filter((q) => q.opportunityId === oppId);
  expect.soft(quotes.length, 'double-click Save & Submit creates exactly one quotation').toBe(1);
  const q = quotes[0];
  expect(q.status).toBe('pending_approval');
  expect(Number(q.freight)).toBe(Number(d.freight));
  await shot(page, `${d.tag}-11-submitted-drawer`);

  // After submitting, closing the drawer must not leave a still-editable "New Quotation" with the same data.
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.waitForTimeout(600);
  await shot(page, `${d.tag}-11b-after-drawer-close`);
  expect.soft(page.url(), 'after Save & Submit the user leaves the new-quotation editor').not.toContain('/quotations/new');
  return q;
}

/** Salesperson cannot approve; each approver approves from Pending Approvals. */
async function approveQuotation(page: Page, q: Rec, d: RunData) {
  const rowName = new RegExp(esc(String(q.quoteNo)));
  // Permission: the salesperson sees it only under All Pending, without Approve / Reject.
  await switchUser(page, SALES, '/quotations/pending-approvals');
  await expect(page.getByRole('tab', { name: /Awaiting My Approval 0/ })).toBeVisible();
  const myRow = page.getByRole('row', { name: rowName });
  await expect(myRow).toBeVisible();
  await expect(myRow.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await shot(page, `${d.tag}-12-sales-pending-view`);
  await page.goto(`/quotations/${q.id}`);
  await expect(page.getByRole('button', { name: /^Approve/ })).toHaveCount(0);

  for (const [i, uid] of d.approvers.entries()) {
    await switchUser(page, uid, '/quotations/pending-approvals');
    await expect(page.getByRole('tab', { name: /Awaiting My Approval [1-9]/ })).toBeVisible();
    const row = page.getByRole('row', { name: rowName });
    await expect(row, `${uid} sees ${q.quoteNo} in the queue`).toBeVisible();
    await shot(page, `${d.tag}-13-${uid}-queue`);
    // Cancel first (dialog must close without deciding), then approve.
    await row.getByRole('button', { name: 'Approve' }).click();
    const ad = page.getByRole('alertdialog');
    await expect(ad).toBeVisible();
    await ad.getByRole('button', { name: 'Cancel' }).click();
    await expect(ad).toBeHidden();
    expect((await db(page)).records.quotations.find((x) => x.id === q.id)!.status).toBe('pending_approval');
    await row.getByRole('button', { name: 'Approve' }).click();
    await ad.getByRole('textbox').fill(`OK from ${uid}`);
    await ad.getByRole('button', { name: 'Approve' }).click();
    await expectToast(page, i === d.approvers.length - 1 ? /approved — ready to send/ : /approved/);
  }
  expect((await db(page)).records.quotations.find((x) => x.id === q.id)!.status).toBe('approved');
}

/** Send → Accept (PO upload or electronic) → Generate Sales Order. Returns the SO. */
async function acceptAndOrder(page: Page, q: Rec, oppId: string, d: RunData): Promise<Rec> {
  await switchUser(page, SALES, `/quotations/${q.id}`);
  const panel = actionsPanel(page);
  await panel.getByRole('button', { name: 'Send Quotation' }).first().click();
  const sd = page.getByRole('dialog');
  await expect(sd).toBeVisible();
  await shot(page, `${d.tag}-14-send-dialog`);
  await sd.getByRole('button', { name: 'Send Quotation' }).click();
  // A contact with no email / WhatsApp consent defaults to "Shared offline", which needs no consent.
  const SENT = /sent by (WhatsApp|email|Shared offline)/i;
  const sent = await page.locator('.toasts .toast').filter({ hasText: SENT }).first().isVisible({ timeout: 4000 }).catch(() => false);
  await page.waitForTimeout(sent ? 0 : 2500);
  if (!(await page.locator('.toasts .toast').filter({ hasText: SENT }).count())) {
    const said = (await page.locator('.toasts .toast, [role=dialog] .field-error, [role=dialog] [role=alert]').allInnerTexts()).join(' | ');
    await shot(page, `${d.tag}-14b-send-blocked`);
    expect.soft(false, `Send Quotation succeeds for a contact created in the journey (no consent captured). UI said: "${said}"`).toBe(true);
    // Fallback: give consent on the contact's full edit form, then send again.
    await cancelDialog(page, sd);
    await page.goto(`/contacts/${q.contactId}/edit`);
    await page.waitForLoadState('networkidle');
    for (const sw of ['Communication consent — WhatsApp', 'Communication consent — email']) {
      await page.getByRole('switch', { name: sw }).check({ force: true, timeout: 5000 });
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.goto(`/quotations/${q.id}`);
    await page.waitForLoadState('networkidle');
    await panel.getByRole('button', { name: 'Send Quotation' }).first().click();
    await sd.getByRole('button', { name: 'Send Quotation' }).click();
    await expectToast(page, /sent by (WhatsApp|email)/i);
  }

  await panel.getByRole('button', { name: 'Mark Accepted' }).first().click();
  const ad = page.getByRole('dialog');
  await expect(ad).toBeVisible();
  if (d.acceptance === 'po') {
    await ad.getByRole('button', { name: 'Mark Accepted' }).click();
    await expect(ad.getByText('Customer PO number is required')).toBeVisible();
    await expect(ad.getByText('Attach the PO copy')).toBeVisible();
    await shot(page, `${d.tag}-15-accept-validation`);
    await ad.getByLabel('Customer PO number *').fill(`PO/${d.tag}/2026/${Date.now() % 10000}`);
    await ad.locator('input[type=file]').setInputFiles({ name: 'customer-po.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 po') });
  } else {
    await ad.getByRole('radio', { name: 'Electronic Acceptance' }).click();
    await shot(page, `${d.tag}-15-accept-electronic`);
    // Electronic acceptance still needs whatever the dialog asks for; fill any visible required text box.
    for (const tb of await ad.getByRole('textbox').all()) if (!(await tb.inputValue())) await tb.fill(`${d.contactName} accepted via e-sign`);
  }
  await ad.getByRole('button', { name: 'Mark Accepted' }).click();
  await expectToast(page, /marked accepted/);
  let data = await db(page);
  expect(data.records.quotations.find((x) => x.id === q.id)!.status).toBe('accepted');
  const opp = data.records.opportunities.find((o) => o.id === oppId)!;
  expect(opp.stage, 'accepted quotation marks the opportunity Won').toBe('won');
  expect.soft(Number(opp.value), 'won opportunity value follows the accepted quotation total').toBe(Number(q.grandTotal));
  await shot(page, `${d.tag}-16-accepted`, true);

  await panel.getByRole('button', { name: 'Generate Sales Order' }).first().click();
  await expect(page).toHaveURL(/\/sales-orders\/new\?quotation=/);
  await expect(page.getByRole('heading', { name: 'Lines' })).toBeVisible();
  await shot(page, `${d.tag}-17-so-new`, true);
  await responsive(page, `${d.tag}-r-so-new`);
  const poBox = page.getByRole('textbox', { name: 'Customer PO number *' });
  if (!(await poBox.inputValue())) {
    // Electronic acceptance carries no PO: the SO form must insist on it (SO-02) and explain why.
    await page.getByRole('main').getByRole('button', { name: 'Generate Sales Order' }).click();
    await expect(page.getByText('Customer PO number is required')).toBeVisible();
    await shot(page, `${d.tag}-17b-so-po-required`, true);
    await poBox.fill(`PO/${d.tag}/2026/E-${Date.now() % 10000}`);
    await page.locator('main input[type=file]').setInputFiles({ name: 'po-after-esign.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 po') });
  }
  await page.getByRole('main').getByRole('button', { name: 'Generate Sales Order' }).dblclick();
  await expectToast(page, /generated and sent for approval/);
  data = await db(page);
  const sos = data.records.salesOrders.filter((s) => s.quotationId === q.id);
  expect.soft(sos.length, 'double-click Generate Sales Order creates exactly one SO').toBe(1);
  await page.waitForTimeout(1500);
  await shot(page, `${d.tag}-18-so-drawer`);
  // The page behind the new SO drawer should not show an error state for the just-created order.
  await expect.soft(page.getByText('This quotation cannot become a sales order yet'), 'no error page behind the freshly generated SO').toHaveCount(0);
  return sos[0];
}

/** Opportunity Won, Customer 360 tabs and timeline link everything back. */
async function verifyLinks(page: Page, ids: { customerId: string; leadId: string; oppId: string; q: Rec; so: Rec }, d: RunData) {
  await page.goto(`/opportunities/${ids.oppId}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('complementary').getByText('Won', { exact: true }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Quotations' }).click();
  await expect(page.getByText(String(ids.q.quoteNo)).first()).toBeVisible();
  await shot(page, `${d.tag}-19-opp-won`, true);

  await page.goto(`/sales-orders/${ids.so.id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(String(ids.so.orderNo)).first()).toBeVisible();
  await expect(page.getByText(String(ids.q.quoteNo)).first()).toBeVisible();
  await shot(page, `${d.tag}-20-so-record`, true);
  await responsive(page, `${d.tag}-r-so-record`);

  await page.goto(`/companies/${ids.customerId}`);
  await page.waitForLoadState('networkidle');
  await shot(page, `${d.tag}-21-c360-overview`, true);
  const checks: [string, string][] = [
    ['Leads', ids.leadId],
    ['Opportunities', ids.oppId],
    ['Quotations', String(ids.q.quoteNo)],
    ['Sales Orders', String(ids.so.orderNo)],
  ];
  for (const [tab, text] of checks) {
    await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
    await page.waitForTimeout(700);
    await expect.soft(page.getByRole('tabpanel').getByText(text).first(), `Customer 360 › ${tab} lists ${text}`).toBeVisible();
    await shot(page, `${d.tag}-22-c360-${tab.replace(/\s/g, '')}`);
  }
  await page.getByRole('tab', { name: /^Activity History/ }).click();
  await page.waitForTimeout(800);
  const timeline = await page.getByRole('tabpanel').innerText();
  await shot(page, `${d.tag}-23-c360-timeline`, true);
  expect.soft(timeline.includes(String(ids.q.quoteNo)) || timeline.includes(ids.oppId) || /quotation|opportunit/i.test(timeline), 'Customer 360 timeline shows the journey activity').toBe(true);
}

// ------------------------------------------------------------------ happy paths

test('Run A — Contact Pool → Lead → Opportunity → Quotation (8%, 1 approver) → PO acceptance → Sales Order', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  const d: RunData = {
    tag: 'A',
    contactName: 'Harpreet Sandhu',
    mobile: '9812345670',
    email: 'harpreet.sandhu@sandhutex.example',
    companyName: 'Sandhu Digital Textiles Pvt Ltd',
    product: 'FabriJet D18 Direct-to-Fabric Printer',
    qty: '2',
    discount: '8',
    freight: '25000',
    approvers: [MANAGER],
    acceptance: 'po',
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAs(page, SALES, '/contact-pool', { theme: 'light' });

  let contactId = '';
  await test.step('1. Create contact in Contact Pool (validation → success)', async () => {
    await expect(page.getByRole('table', { name: 'Contact Pool' })).toBeVisible();
    await shot(page, 'A-01-contact-pool');
    await page.getByRole('button', { name: 'Add Manually' }).click();
    const dlg = page.getByRole('dialog', { name: 'New Contact' });
    await dlg.getByRole('button', { name: 'Create' }).click();
    await expect(dlg.getByText('Name is required').first()).toBeVisible();
    await dlg.getByLabel('Name *').fill(d.contactName);
    await dlg.getByLabel('Mobile (optional)').fill('12345');
    await dlg.getByLabel('Email (optional)').fill('harpreet@');
    await dlg.getByRole('button', { name: 'Create' }).click();
    await expect(dlg.getByText('Enter a 10-digit Indian mobile number').first()).toBeVisible();
    await expect(dlg.getByText('Enter a valid email address').first()).toBeVisible();
    await shot(page, 'A-02-contact-validation');
    await dlg.getByLabel('Mobile (optional)').fill(d.mobile);
    await dlg.getByLabel('Email (optional)').fill(d.email);
    await dlg.getByLabel('Designation (optional)').fill('Managing Partner');
    await dlg.getByRole('button', { name: 'Create' }).click();
    await expectToast(page, /Contact CT-\d+ created/);
    const c = (await db(page)).records.contacts.find((x) => x.name === d.contactName)!;
    expect(c).toBeTruthy();
    contactId = c.id;
    await expect(page.getByRole('row', { name: new RegExp(d.contactName) })).toBeVisible();
    await responsive(page, 'A-r-contact-pool');
  });

  let leadId = '';
  let customerId = '';
  await test.step('2. Convert to Lead (company created as Prospect)', async () => {
    const row = page.getByRole('row', { name: new RegExp(d.contactName) });
    await row.getByRole('button', { name: 'Convert to Lead' }).click();
    const dlg = page.getByRole('dialog', { name: new RegExp(`Convert ${d.contactName}`) });
    await expect(dlg).toBeVisible();
    // Cancel must not create anything.
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(dlg).toBeHidden();
    await row.getByRole('button', { name: 'Convert to Lead' }).click();
    const create = dlg.getByRole('button', { name: 'Create Lead' });
    await expect.soft(create, 'Create Lead explains what is missing (enabled + inline error) instead of silently disabled').toBeEnabled();
    await dlg.getByLabel('Company name *').fill(d.companyName!);
    await pick(page, dlg, 'Territory / hub', /Surat/);
    await pick(page, dlg, 'Billing state', /Gujarat/, 'Gujarat');
    await dlg.getByLabel('Customer requirement').fill('Two direct-to-fabric printers for a new Surat unit');
    await shot(page, 'A-03-convert-to-lead');
    await create.dblclick();
    await expectToast(page, /Lead LD-[\d-]+ created with new company C-\d+/);
    const data = await db(page);
    const leads = data.records.leads.filter((l) => l.contactId === contactId);
    expect.soft(leads.length, 'double-click Create Lead creates exactly one lead').toBe(1);
    leadId = leads[0].id;
    customerId = leads[0].customerId;
    const company = data.records.customers.find((c) => c.id === customerId)!;
    expect(company.name).toBe(d.companyName);
    await page.goto(`/leads/${leadId}`);
    await page.waitForLoadState('networkidle');
    await responsive(page, 'A-r-lead-record');
  });

  let oppId = '';
  await test.step('3. Qualify → Create Opportunity (conversion dialog)', async () => {
    oppId = await qualifyLead(page, leadId, d);
    await page.goto(`/opportunities/${oppId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('complementary').getByRole('link', { name: d.companyName }).first()).toBeVisible();
  });

  await test.step('4. Move through pipeline stages (drag + list dropdown)', async () => {
    await movePipeline(page, oppId, d);
    await responsive(page, 'A-r-pipeline-board');
  });

  let q: Rec = {};
  await test.step('5. Create Quotation from the board card and submit for approval', async () => {
    q = await createQuotation(page, oppId, d);
    await page.goto(`/quotations/${q.id}`);
    await page.waitForLoadState('networkidle');
    await responsive(page, 'A-r-quote-detail');
  });

  await test.step('6. Permission check + Sales Manager approves', async () => {
    await approveQuotation(page, q, d);
  });

  let so: Rec = {};
  await test.step('7. Send, mark accepted (PO), Generate Sales Order', async () => {
    so = await acceptAndOrder(page, q, oppId, d);
  });

  await test.step('8. Opportunity Won and Customer 360 links', async () => {
    await verifyLinks(page, { customerId, leadId, oppId, q, so }, d);
  });

  expect.soft(errors, 'console / page errors during Run A').toEqual([]);
});

test('Run B — New Contact form → New Lead page → Opportunity → Quotation (12%, 2 approvers) → e-acceptance → Sales Order', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  const d: RunData = {
    tag: 'B',
    contactName: 'Meenakshi Raghavan',
    mobile: '9944556677',
    email: 'meenakshi.r@punjabwoollen.example',
    existingCompany: 'Punjab Woollen Prints',
    product: 'ChromaJet S32 High-speed Sublimation Printer',
    qty: '1',
    discount: '12',
    freight: '48500',
    approvers: [MANAGER, GM],
    acceptance: 'electronic',
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAs(page, SALES, '/contacts/new', { theme: 'light' });

  let contactId = '';
  let customerId = '';
  await test.step('1. New Contact full form (validation → success)', async () => {
    await expect(page.getByRole('group', { name: 'Contact details' })).toBeVisible();
    await shot(page, 'B-01-contact-form', true);
    await expect.soft(page.getByText(/payments are recorded/i), 'contact form subtitle describes contacts (not invoices)').toHaveCount(0);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Name is required').first()).toBeVisible();
    await shot(page, 'B-02-contact-form-validation', true);
    await page.getByLabel('Name *').fill(d.contactName);
    await pick(page, page, 'Company', new RegExp(esc(d.existingCompany!)), d.existingCompany);
    await page.getByLabel('Designation (optional)').fill('Purchase Head');
    await page.getByLabel('Mobile (optional)').fill('98765');
    await page.getByLabel('Email (optional)').fill('not-an-email');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Enter a 10-digit Indian mobile number').first()).toBeVisible();
    await expect(page.getByText('Enter a valid email address').first()).toBeVisible();
    await page.getByLabel('Mobile (optional)').fill(d.mobile);
    await page.getByLabel('Email (optional)').fill(d.email);
    // Owner / Divisions may need choosing on the full form.
    if (await page.getByRole('button', { name: /^Owner: Select/ }).count()) await pick(page, page, 'Owner', /Karan Singh/, 'Karan');
    if (await page.getByRole('button', { name: /^Divisions: Select/ }).count()) {
      await pick(page, page, 'Divisions', /Textile/);
      await page.keyboard.press('Escape');
    }
    await shot(page, 'B-03-contact-form-filled', true);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expectToast(page, /CT-\d+/);
    const c = (await db(page)).records.contacts.find((x) => x.name === d.contactName)!;
    expect(c, 'contact saved').toBeTruthy();
    contactId = c.id;
    customerId = c.customerId;
    await page.goto(`/contacts/${contactId}`);
    await page.waitForLoadState('networkidle');
    await shot(page, 'B-03b-contact-record', true);
    await responsive(page, 'B-r-contact-record');
  });

  let leadId = '';
  await test.step('2. New Lead page for that company + contact', async () => {
    await page.goto('/leads/new');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Create Lead' }).click();
    await page.waitForTimeout(500);
    await shot(page, 'B-04-new-lead-validation', true);
    await expect(page.locator('.field-error, [role=alert]').first(), 'empty New Lead shows validation').toBeVisible();
    await pick(page, page, 'Customer', new RegExp(esc(d.existingCompany!)), d.existingCompany);
    await pick(page, page, 'Contact person', new RegExp(d.contactName));
    await pick(page, page, 'Lead source', /Exhibition|Website/);
    await pick(page, page, 'Product type', /Machine/);
    await page.getByLabel('Customer requirement (optional)').fill('High-speed sublimation printer for sportswear');
    await shot(page, 'B-05-new-lead-filled', true);
    await page.getByRole('button', { name: 'Create Lead' }).click();
    // A duplicate warning may appear if the customer already has open leads; continue through it.
    const dup = page.getByRole('button', { name: /Create anyway|Continue|Save anyway/i });
    if (await dup.isVisible({ timeout: 1500 }).catch(() => false)) {
      await shot(page, 'B-05b-new-lead-duplicate-warning', true);
      await dup.click();
    }
    await expectToast(page, /LD-[\d-]+/);
    const lead = (await db(page)).records.leads.find((l) => l.contactId === contactId)!;
    expect(lead).toBeTruthy();
    leadId = lead.id;
  });

  let oppId = '';
  await test.step('3. Qualify → Create Opportunity', async () => {
    oppId = await qualifyLead(page, leadId, d);
  });

  await test.step('4. Stage moves: record Move buttons, rapid back-and-forth', async () => {
    await page.goto(`/opportunities/${oppId}`);
    await page.waitForLoadState('networkidle');
    const p = actionsPanel(page);
    await p.getByRole('button', { name: 'Move to Demo/Sample' }).click();
    await expect(p.getByRole('button', { name: 'Move to Proposal/Quotation' })).toBeVisible();
    await p.getByRole('button', { name: 'Move to Proposal/Quotation' }).click();
    await expect(p.getByRole('button', { name: 'Back to Needs Assessment' })).toBeVisible();
    await page.waitForTimeout(1000);
    await shot(page, 'B-06-opp-proposal', true);
    expect((await db(page)).records.opportunities.find((o) => o.id === oppId)!.stage).toBe('proposal');
  });

  let q: Rec = {};
  await test.step('5. Create Quotation (12% → two approval levels)', async () => {
    q = await createQuotation(page, oppId, d);
  });

  await test.step('6. Sales Manager then GM approve', async () => {
    await approveQuotation(page, q, d);
  });

  let so: Rec = {};
  await test.step('7. Send, electronic acceptance, Generate Sales Order', async () => {
    so = await acceptAndOrder(page, q, oppId, d);
  });

  await test.step('8. Links back (opportunity, SO, Customer 360)', async () => {
    await verifyLinks(page, { customerId, leadId, oppId, q, so }, d);
  });

  expect.soft(errors, 'console / page errors during Run B').toEqual([]);
});

// ------------------------------------------------------------------ stress / abuse

test('Stress — contact & company validation, duplicates, long text, double submit', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await openAs(page, SALES, '/contact-pool', { theme: 'light' });

  await test.step('duplicate contact (same mobile as an existing pool contact)', async () => {
    const existing = (await db(page)).records.contacts.find((c) => c.mobile && !c.customerId)!;
    await page.getByRole('button', { name: 'Add Manually' }).click();
    const dlg = page.getByRole('dialog', { name: 'New Contact' });
    await dlg.getByLabel('Name *').fill(String(existing.name));
    await dlg.getByLabel('Mobile (optional)').fill(String(existing.mobile));
    await dlg.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1500);
    await shot(page, 'S-01-duplicate-contact');
    const same = (await db(page)).records.contacts.filter((c) => c.mobile === existing.mobile);
    expect.soft(same.length, `duplicate mobile ${existing.mobile} is detected (CUS-06) instead of silently creating a second contact`).toBe(1);
    await cancelDialog(page, dlg);
  });

  await test.step('double-click Create in quick contact dialog', async () => {
    await page.getByRole('button', { name: 'Add Manually' }).click();
    const dlg = page.getByRole('dialog', { name: 'New Contact' });
    await dlg.getByLabel('Name *').fill('Double Click Dinesh');
    await dlg.getByLabel('Mobile (optional)').fill('9700011122');
    await dlg.getByRole('button', { name: 'Create' }).dblclick();
    await page.waitForTimeout(1800);
    const n = (await db(page)).records.contacts.filter((c) => c.name === 'Double Click Dinesh').length;
    expect.soft(n, 'double-click Create makes one contact').toBe(1);
  });

  await test.step('very long text in contact name', async () => {
    const long = 'Venkataraghavan '.repeat(30).trim(); // ~480 chars
    await page.getByRole('button', { name: 'Add Manually' }).click();
    const dlg = page.getByRole('dialog', { name: 'New Contact' });
    await dlg.getByLabel('Name *').fill(long);
    const typed = await dlg.getByLabel('Name *').inputValue();
    await dlg.getByLabel('Mobile (optional)').fill('9700033344');
    await dlg.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1500);
    await shot(page, 'S-02-long-name');
    const saved = (await db(page)).records.contacts.find((c) => String(c.name).startsWith('Venkataraghavan Venkataraghavan'));
    // Either a maxLength / validation message, or saved and rendered without breaking the layout.
    if (saved) {
      await page.getByRole('searchbox', { name: 'Search Contact Pool' }).fill('Venkataraghavan');
      await page.waitForTimeout(700);
      await shot(page, 'S-02b-long-name-row');
      expect.soft((await pageOverflow(page)).doc, 'long contact name does not overflow the page').toBeLessThanOrEqual(1);
    } else {
      expect.soft(typed.length < long.length || (await dlg.locator('.field-error').count()) > 0, 'long name rejected with a visible reason').toBe(true);
      await cancelDialog(page, dlg);
    }
  });

  await test.step('empty states: search with no match', async () => {
    await page.getByRole('searchbox', { name: 'Search Contact Pool' }).fill('zzzz-no-such-person');
    await page.waitForTimeout(700);
    await shot(page, 'S-03-pool-empty-search');
    await expect(page.getByText(/No .*match|Nothing|No contacts|0 contacts/i).first()).toBeVisible();
  });

  await test.step('company form: invalid GSTIN, mismatched state, duplicate GSTIN', async () => {
    await page.goto('/companies/new');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText(/Company name is required|is required/).first()).toBeVisible();
    await page.getByLabel('Company name *').fill('Gstin Test Prints');
    await pick(page, page, 'Billing state', /Gujarat/, 'Gujarat');
    for (const bad of ['24ABCDE1234F1Z', '24abcde1234f1z5', '27ABCDE1234F1Z5', '24ABCDE1234F1Z9']) {
      await page.getByLabel('GSTIN (optional)').fill(bad);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForTimeout(500);
      const err = await page.locator('.field-error, [role=alert]').allInnerTexts();
      expect.soft(err.join(' '), `GSTIN "${bad}" is rejected`).toMatch(/GSTIN|state|check|15/i);
    }
    await shot(page, 'S-04-gstin-validation', true);
    // Duplicate GSTIN of a seeded company.
    const seeded = (await db(page)).records.customers.find((c) => c.gstin && String(c.gstin).startsWith('24'))!;
    await page.getByLabel('GSTIN (optional)').fill(String(seeded.gstin));
    if (await page.getByRole('button', { name: /^Divisions served: Select/ }).count()) {
      await pick(page, page, 'Divisions served', /Textile/);
      await page.keyboard.press('Escape');
    }
    if (await page.getByRole('button', { name: /^Territory \/ hub: Select/ }).count()) await pick(page, page, 'Territory / hub', /Surat/);
    if (await page.getByRole('button', { name: /^Account owner: Select/ }).count()) await pick(page, page, 'Account owner', /Karan/, 'Karan');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(1500);
    await shot(page, 'S-05-duplicate-gstin', true);
    const dupes = (await db(page)).records.customers.filter((c) => c.gstin === seeded.gstin);
    expect.soft(dupes.length, `duplicate GSTIN ${seeded.gstin} is blocked/warned (CUS-06)`).toBe(1);
  });

  await test.step('contact form: browser back / refresh with unsaved changes', async () => {
    await page.goto('/contact-pool');
    await page.waitForLoadState('networkidle');
    await page.goto('/contacts/new');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Name *').fill('Unsaved Uma');
    await page.getByLabel('Designation (optional)').fill('Typed but not saved');
    let beforeUnload = false;
    const onDialog = async (dl: import('@playwright/test').Dialog) => {
      if (dl.type() === 'beforeunload') beforeUnload = true;
      await dl.dismiss().catch(() => {});
    };
    page.on('dialog', onDialog);
    await page.reload({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(800);
    expect.soft(beforeUnload, 'refresh on a dirty New Contact form asks before discarding').toBe(true);
    if (!page.url().includes('/contacts/new')) await page.goto('/contacts/new');
    await page.getByLabel('Name *').fill('Unsaved Uma');
    await page.goBack({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(800);
    const guarded = (await page.getByRole('alertdialog').count()) > 0 || page.url().includes('/contacts/new');
    await shot(page, 'S-06-contact-back-guard');
    expect.soft(guarded, 'browser Back on a dirty New Contact form is guarded').toBe(true);
    page.off('dialog', onDialog);
  });

  expect.soft(errors, 'console / page errors (contact stress)').toEqual([]);
});

test('Stress — lead & opportunity abuse: duplicate lead, cancel dialogs, Mark Lost without reason, rapid stage changes, ₹ extremes', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await openAs(page, SALES, '/leads/new', { theme: 'light' });

  await test.step('duplicate lead for same customer + contact + product', async () => {
    const data = await db(page);
    const open = data.records.leads.find((l) => l.ownerId === 'E-1011' && ['new', 'contacted'].includes(l.status) && l.productType === 'machine') ?? data.records.leads.find((l) => l.ownerId === 'E-1011' && ['new', 'contacted'].includes(l.status))!;
    const cust = data.records.customers.find((c) => c.id === open.customerId)!;
    const contact = data.records.contacts.find((c) => c.id === open.contactId)!;
    const before = data.records.leads.filter((l) => l.customerId === open.customerId).length;
    await pick(page, page, 'Customer', new RegExp(esc(String(cust.name))), String(cust.name));
    if (await page.getByRole('button', { name: /^Contact person: Select|^Contact person: Search/ }).count()) await pick(page, page, 'Contact person', new RegExp(esc(String(contact.name))));
    await pick(page, page, 'Lead source', /Website/);
    await pick(page, page, 'Product type', new RegExp(open.productType === 'machine' ? 'Machine' : '.'));
    await page.waitForTimeout(600);
    const warned = await page.getByText(/Possible duplicate|already exists/i).first().isVisible().catch(() => false);
    await shot(page, 'S-10-duplicate-lead-warning', true);
    expect.soft(warned, `duplicate lead for ${cust.name} shows a warning before saving`).toBe(true);
    await page.getByRole('button', { name: 'Create Lead' }).click();
    await page.waitForTimeout(1500);
    await shot(page, 'S-10b-duplicate-lead-after-create', true);
    const after = (await db(page)).records.leads.filter((l) => l.customerId === open.customerId).length;
    if (after > before) test.info().annotations.push({ type: 'observation', description: `Possible-duplicate lead saved on a single click without confirmation (${before} → ${after} leads for ${cust.name})` });
  });

  await test.step('cancel Create Opportunity dialog keeps the lead open', async () => {
    const lead = (await db(page)).records.leads.find((l) => l.ownerId === 'E-1011' && ['new', 'contacted'].includes(l.status))!;
    await page.goto(`/leads/${lead.id}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Convert to Opportunity', exact: true }).first().click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Decision maker *').fill('Will cancel');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await cancelDialog(page, dlg);
    await expect(dlg).toBeHidden();
    expect((await db(page)).records.leads.find((l) => l.id === lead.id)!.status).toBe(lead.status);
  });

  await test.step('₹ extremes in conversion budget / value', async () => {
    const lead = (await db(page)).records.leads.find((l) => l.ownerId === 'E-1011' && ['new', 'contacted'].includes(l.status))!;
    await page.goto(`/leads/${lead.id}`);
    await page.getByRole('button', { name: 'Convert to Opportunity', exact: true }).first().click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Customer requirement *').fill('Big order');
    await dlg.getByLabel('Decision maker *').fill('MD');
    await pick(page, dlg, 'Purchase timeline', '3–6 Months');
    await dlg.getByLabel('Budget (₹) *').fill('-5000');
    await dlg.getByLabel('Expected value (₹) *').fill('99999999999999');
    await dlg.getByRole('button', { name: 'Convert to Opportunity' }).click();
    await page.waitForTimeout(1500);
    await shot(page, 'S-11-rupee-extremes');
    const converted = (await db(page)).records.leads.find((l) => l.id === lead.id)!;
    expect.soft(converted.status !== 'qualified' || Number(converted.budget) >= 0, 'negative budget is rejected').toBe(true);
    const budgetMsg = (await dlg.locator('.field-error').allInnerTexts()).join(' ');
    expect.soft(budgetMsg, 'negative budget message says why (not just "Enter the budget")').toMatch(/positive|greater|negative|more than|at least/i);
    // Valid budget, absurd expected value.
    await dlg.getByLabel('Budget (₹) *').fill('100000');
    await dlg.getByRole('button', { name: 'Convert to Opportunity' }).click();
    await page.waitForTimeout(1500);
    await shot(page, 'S-11b-absurd-value');
    const opp = (await db(page)).records.opportunities.find((o) => o.leadId === lead.id);
    expect.soft(!opp || Number(opp.value) <= 1e12, `absurd expected value (₹99,99,99,99,99,99,999) is capped/rejected; saved ${opp?.value}`).toBe(true);
    await cancelDialog(page, dlg);
  });

  await test.step('Mark Lost without reason → validation; cancel keeps stage', async () => {
    const opp = (await db(page)).records.opportunities.find((o) => o.ownerId === 'E-1011' && o.stage === 'needs_assessment')!;
    await page.goto(`/opportunities/${opp.id}`);
    await page.waitForLoadState('networkidle');
    await actionsPanel(page).getByRole('button', { name: 'Mark Lost' }).click();
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: /Mark Lost/ }).click();
    await page.waitForTimeout(800);
    await shot(page, 'S-12-mark-lost-validation');
    const errs = await dlg.locator('.field-error').allInnerTexts();
    expect(errs.length, 'Mark Lost without reason shows field errors').toBeGreaterThan(0);
    expect((await db(page)).records.opportunities.find((o) => o.id === opp.id)!.stage).toBe('needs_assessment');
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(dlg).toBeHidden();
  });

  await test.step('rapid stage changes on one opportunity', async () => {
    const opp = (await db(page)).records.opportunities.find((o) => o.ownerId === 'E-1011' && o.stage === 'needs_assessment' && Number(o.value) > 0)!;
    await page.goto(`/opportunities/${opp.id}`);
    await page.waitForLoadState('networkidle');
    const p = actionsPanel(page);
    // Fire clicks without waiting for each save.
    await p.getByRole('button', { name: 'Move to Demo/Sample' }).click();
    await p.getByRole('button', { name: /Move to Proposal\/Quotation/ }).click({ timeout: 3000 }).catch(() => {});
    await p.getByRole('button', { name: /Back to|Move to Demo/ }).first().click({ timeout: 3000 }).catch(() => {});
    await p.getByRole('button', { name: /Move to Proposal\/Quotation/ }).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await shot(page, 'S-13-rapid-stage', true);
    const finalStage = (await db(page)).records.opportunities.find((o) => o.id === opp.id)!.stage;
    const chip = await page.getByRole('complementary').locator('.status-chip, [class*=chip]').first().innerText().catch(() => '');
    expect(['demo', 'proposal', 'needs_assessment']).toContain(finalStage);
    expect.soft(chip.toLowerCase().replace(/[^a-z]/g, ''), 'UI stage chip matches stored stage after rapid changes').toContain(
      ({ demo: 'demo', proposal: 'proposal', needs_assessment: 'needs' } as Record<string, string>)[finalStage],
    );
    // Negotiation without a quotation must be refused.
    const neg = p.getByRole('button', { name: /Move to Negotiation/ });
    if ((await neg.count()) && (await neg.first().isDisabled())) {
      // Refused up front: the step is disabled and says why (needs a quotation).
      expect.soft(await neg.first().innerText(), 'disabled Negotiation explains why').toMatch(/quotation/i);
    } else if (await neg.count()) {
      await neg.click();
      await page.waitForTimeout(1200);
      await shot(page, 'S-14-negotiation-without-quote');
      expect((await db(page)).records.opportunities.find((o) => o.id === opp.id)!.stage, 'Negotiation needs a quotation').not.toBe('negotiation');
      const msg = await page.locator('.toasts .toast, [role=alertdialog], [role=dialog]').allInnerTexts();
      expect.soft(msg.join(' '), 'refusal is explained (toast/dialog)').toMatch(/quotation/i);
    }
  });

  await test.step('pipeline empty state + Won without accepted quotation via board drag', async () => {
    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');
    await page.getByRole('searchbox', { name: 'Search opportunities' }).fill('zzzz-nothing');
    await page.waitForTimeout(700);
    await shot(page, 'S-15-pipeline-empty');
    await expect(page.getByText(/Nothing here|No opportunities|0 opportunities/).first()).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search opportunities' }).fill('');
    await page.waitForTimeout(700);
    const opp = (await db(page)).records.opportunities.find((o) => o.ownerId === 'E-1011' && o.stage === 'needs_assessment')!;
    const card = page.locator('li.board-card').filter({ hasText: opp.id });
    if (await card.count()) {
      await card.dragTo(page.locator('section.board-col[aria-label^="Won"]'));
      await page.waitForTimeout(1000);
      await shot(page, 'S-16-drag-to-won');
      const ask = page.getByRole('alertdialog');
      if (await ask.isVisible().catch(() => false)) {
        await ask.getByRole('button', { name: 'Confirm' }).click();
        await page.waitForTimeout(1500);
        await shot(page, 'S-16b-drag-to-won-confirmed');
        const said = (await page.locator('.toasts .toast').allInnerTexts()).join(' | ');
        expect.soft(said, 'refusal to mark Won without accepted quotation is explained').toMatch(/accepted quotation|quotation/i);
      }
      expect((await db(page)).records.opportunities.find((o) => o.id === opp.id)!.stage, 'Won needs an accepted quotation').not.toBe('won');
    }
  });

  expect.soft(errors, 'console / page errors (lead/opportunity stress)').toEqual([]);
});

test('Stress — quotation editor: unsaved guard, ₹ extremes, long text, bad URLs, permissions (admin / salesperson)', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await openAs(page, SALES, '/pipeline', { theme: 'light' });
  const opp = (await db(page)).records.opportunities.find((o) => o.ownerId === 'E-1011' && o.stage === 'needs_assessment' && o.customerId)!;

  await test.step('editor refresh / back / Cancel with unsaved changes', async () => {
    await page.goto(`/quotations/new?opportunity=${opp.id}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('textbox', { name: 'Freight' }).fill('1000');
    let beforeUnload = false;
    const onDialog = async (dl: import('@playwright/test').Dialog) => {
      if (dl.type() === 'beforeunload') beforeUnload = true;
      await dl.dismiss().catch(() => {});
    };
    page.on('dialog', onDialog);
    await page.reload({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(800);
    expect.soft(beforeUnload, 'refresh on dirty quotation editor asks first').toBe(true);
    page.off('dialog', onDialog);
    if (!(await page.getByRole('textbox', { name: 'Freight' }).isVisible().catch(() => false))) await page.goto(`/quotations/new?opportunity=${opp.id}`);
    await page.getByRole('textbox', { name: 'Freight' }).fill('2000');
    // In-app Cancel → confirm dialog; choose to stay.
    await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await expect(confirm.first(), 'Cancel on dirty editor asks to discard').toBeVisible();
    await shot(page, 'S-20-editor-cancel-guard');
    await confirm.first().getByRole('button', { name: /Keep|Stay|Cancel|Continue editing/i }).first().click();
    await expect(page.getByRole('textbox', { name: 'Freight' })).toHaveValue('2000');
    // Browser Back (SPA history) with unsaved changes.
    await page.goBack({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(900);
    await shot(page, 'S-21-editor-back');
    const stillHere = page.url().includes('/quotations/new') || (await page.getByRole('alertdialog').count()) > 0;
    expect.soft(stillHere, 'browser Back on dirty quotation editor is guarded').toBe(true);
  });

  await test.step('₹ extremes and long text in lines', async () => {
    await page.goto(`/quotations/new?opportunity=${opp.id}`);
    await page.waitForLoadState('networkidle');
    await pick(page, page, 'Line 1 product', /ChromaJet S32/, 'ChromaJet S32');
    await page.getByRole('textbox', { name: 'Qty' }).first().fill('99999');
    await page.getByRole('textbox', { name: 'Freight' }).fill('999999999999');
    await page.getByRole('textbox', { name: 'Insurance' }).fill('-500');
    await page.getByRole('textbox', { name: 'Description' }).first().fill('Extra-long description '.repeat(40));
    await page.getByRole('textbox', { name: 'Discount' }).first().fill('150');
    await page.waitForTimeout(600);
    await shot(page, 'S-22-editor-extremes', true);
    const body = await page.locator('main').innerText();
    expect.soft(body, 'no NaN / Infinity in totals').not.toMatch(/NaN|Infinity|undefined/);
    expect.soft(await page.getByRole('textbox', { name: 'Insurance' }).inputValue(), 'negative insurance is not accepted').not.toMatch(/^-/);
    await page.getByRole('button', { name: 'Save Draft' }).click();
    await page.waitForTimeout(1500);
    const disc = (await db(page)).records.quotations.find((q) => q.opportunityId === opp.id && q.lines?.some((l: Rec) => Number(l.discountPct) > 100));
    expect.soft(disc, 'discount above 100% is never saved').toBeUndefined();
    await shot(page, 'S-23-editor-extremes-save', true);
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(400);
      await shot(page, `S-24-editor-extremes-${w}`);
      expect.soft((await pageOverflow(page)).doc, `editor with extreme values overflows at ${w}px`).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step('error states: bad opportunity / quotation / order ids', async () => {
    await page.goto('/quotations/new?opportunity=OPP-NOPE');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/Could not open the quotation editor|not open or not visible|not found/i).first()).toBeVisible();
    await shot(page, 'S-25-editor-bad-opp');
    await page.goto('/quotations/QT-NOPE');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await shot(page, 'S-26-quote-not-found');
    await expect(page.getByText(/not found|doesn.t exist|no longer|not available|could not/i).first()).toBeVisible();
    await page.goto('/sales-orders/new?quotation=QT-NOPE');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await shot(page, 'S-27-so-bad-quote');
    await expect(page.getByText(/cannot|not found|could not/i).first()).toBeVisible();
  });

  await test.step('permissions: salesperson cannot approve; admin view of approvals', async () => {
    // Create a quotation needing approval quickly through the UI.
    await page.goto(`/quotations/new?opportunity=${opp.id}`);
    await page.waitForLoadState('networkidle');
    await pick(page, page, 'Line 1 product', /ThermoPress C18/, 'ThermoPress');
    await page.getByRole('textbox', { name: 'Discount' }).first().fill('9');
    await page.getByRole('textbox', { name: 'Reason for the discount *' }).fill('Permission test');
    await page.getByRole('button', { name: 'Save & Submit for Approval' }).click();
    await expectToast(page, /sent for approval/);
    const q = (await db(page)).records.quotations.find((x) => x.opportunityId === opp.id && x.status === 'pending_approval')!;
    // Salesperson: pending page has no Approve; direct record has no approve action.
    await page.goto('/quotations/pending-approvals');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('row', { name: new RegExp(esc(String(q.quoteNo))) }).getByRole('button', { name: 'Approve' })).toHaveCount(0);
    // Salesperson cannot edit a pending quotation into a lower discount silently either: Edit should be blocked or re-trigger approval.
    await page.goto(`/quotations/${q.id}/edit`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await shot(page, 'S-28-sales-edit-pending');
    // Admin sees the request.
    await switchUser(page, ADMIN, '/quotations/pending-approvals');
    await page.waitForTimeout(600);
    await shot(page, 'S-29-admin-pending');
    await page.getByRole('tab', { name: /All Pending/ }).click().catch(() => {});
    await expect(page.getByRole('row', { name: new RegExp(esc(String(q.quoteNo))) })).toBeVisible();
    // Another division's manager must not see it awaiting their approval.
    await switchUser(page, 'u_priya', '/quotations/pending-approvals');
    await page.waitForTimeout(600);
    await shot(page, 'S-30-other-division-manager');
    await expect(page.getByRole('row', { name: new RegExp(esc(String(q.quoteNo))) }).getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });

  await test.step('Quotation actions menu is clickable on the record page', async () => {
    await switchUser(page, SALES, '/quotations');
    const q = (await db(page)).records.quotations.find((x) => x.ownerId === 'E-1011' && x.isLatest)!;
    await page.goto(`/quotations/${q.id}`);
    await page.waitForLoadState('networkidle');
    const btn = page.getByRole('button', { name: 'Quotation actions' });
    if (await btn.count()) {
      let ok = true;
      await btn.first().click({ timeout: 4000 }).catch(() => (ok = false));
      await shot(page, 'S-31-quotation-actions-menu');
      expect.soft(ok, '"Quotation actions" (⋮) is not covered by the "More actions" button').toBe(true);
      await page.keyboard.press('Escape');
    }
  });

  expect.soft(errors, 'console / page errors (quotation stress)').toEqual([]);
});

test('Responsive — key sales screens at 1440 / 768 / 390 (seeded data)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await openAs(page, SALES, '/contact-pool', { theme: 'light' });
  const data = await db(page);
  const contact = data.records.contacts.find((c) => c.ownerId === 'E-1011' && c.customerId)!;
  const lead = data.records.leads.find((l) => l.ownerId === 'E-1011')!;
  const opp = data.records.opportunities.find((o) => o.ownerId === 'E-1011' && o.stage === 'needs_assessment' && !String(o.customerId).startsWith('X'))!;
  const quote = data.records.quotations.find((q) => q.ownerId === 'E-1011' && q.isLatest)!;
  const so = data.records.salesOrders.find((s) => s.ownerId === 'E-1011') ?? data.records.salesOrders[0];
  const screens: [string, string][] = [
    ['contacts-list', '/contacts'],
    ['contact-record', `/contacts/${contact.id}`],
    ['contact-new', '/contacts/new'],
    ['lead-new', '/leads/new'],
    ['lead-record', `/leads/${lead.id}`],
    ['pipeline-board', '/pipeline'],
    ['opportunity-record', `/opportunities/${opp.id}`],
    ['quote-editor', `/quotations/new?opportunity=${opp.id}`],
    ['quote-detail', `/quotations/${quote.id}`],
    ['pending-approvals', '/quotations/pending-approvals'],
    ['sales-orders', '/sales-orders'],
    ['so-record', `/sales-orders/${so.id}`],
    ['customer-360', `/companies/${opp.customerId}`],
  ];
  await test.step('own opportunities show their customer (not "Restricted")', async () => {
    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    const own = page.locator('li.board-card').filter({ hasText: 'Karan Singh' });
    const restricted = await own.filter({ hasText: 'Restricted' }).allInnerTexts();
    await shot(page, 'R-pipeline-restricted');
    expect.soft(restricted.map((t) => t.split('\n')[0]), 'Karan\'s own opportunity cards hide the customer as "Restricted"').toEqual([]);
  });
  for (const [name, path] of screens) {
    await test.step(name, async () => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(700);
      await expect(page.locator('h1').first()).toBeVisible();
      await responsive(page, `R-${name}`);
    });
  }
  expect.soft(errors, 'console / page errors (responsive)').toEqual([]);
});
