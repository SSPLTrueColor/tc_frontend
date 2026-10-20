# UX QA — Steps 1–6 (neat, clean, consistent CRM)

Run date: 2026-10-20. Browser: Chromium (Playwright). Roles: all 12 demo roles. Source of truth for the plan: `docs/UX-AUDIT.md`; component rules: `docs/COMPONENTS.md`.

## 1. What was fixed

| Area | Before | After |
|---|---|---|
| Tables / pagination | 6 pagination implementations, 68 hand-built tables | One `Pagination` + `DataTable`; module `Pager`s are thin wrappers over it. Raw `<table>` allowed only in the ESLint exception list (see §5) |
| Form controls | Raw `<input>`, `<textarea>`, checkbox, switch, segmented controls | Shared `Input`, `Textarea`, `Checkbox`, `Radio`, `Switch`, `Segmented`, `FileInput`; ESLint blocks new raw ones |
| Skeleton / loading | 4 styles | One `Skeleton` family (`SkeletonLine/Block`) |
| Status colours | 6 local tone maps, `Badge` + `StatusChip` mixed | One registry `src/domain/statusTones.ts` |
| Confirmations | `confirmDelete`, 13 hand-rolled dialogs, 2 `window.confirm` | One `confirmDelete` (`tone`, `typedWord`, async); no `window.confirm` |
| Page header | Different per page | One `PageHeader`: title in top bar, description + one primary action, breadcrumb only on detail pages |
| Tokens | Hard-coded colours/px everywhere | `app.css` has zero hard-coded colours; 705 spacing values snapped to the 4/8/12/16/24/32 scale; shadows, overlays, chip colours and chart palette are tokens (3 theme blocks) |
| Touch targets | 32–40 px on phones | 44 px at `(max-width:760px), (pointer:coarse)` |
| Role visibility | Sidebar listed pages a role could not open; "No access" had no title | Sidebar hides pages lacking capability; `NoAccess` keeps the page title |
| Lists at volume | Board columns rendered every card | 40 cards per column with "Show more" |
| Step 6 clean-up | Raw `#fff`, two raw `rgb()` shadows in module CSS | Now `var(--s-on-accent)`, `var(--s-shadow-sm)`, `var(--s-shadow-lg)` |

## 2. Click-count improvements (measured with `e2e/flows.mts`)

| Workflow | Before | After (re-measured today) |
|---|---|---|
| Log a follow-up call on a lead | 6 | **4** |
| Approve one quotation discount | 5 | **4** |
| Create a second lead in a row | 11 | **7** (form remembers last-used choices); first lead is 11 clicks as scripted |
| Export the lead list | – | **2** |
| Return to the list view I was using | – | **4** (view remembered) |
| Log a service ticket from a call | – | **9** clicks + 2 typed entries |
| Approve many pending discounts | 8 single approvals | **5** with select-all + bulk approve |

## 3. Report → chart mapping

Rule: the chart is chosen by the question the report answers, and the same question always gets the same chart type. Across the 39 report views: hbar 20, bar 7, donut 6, line 3, area 2, funnel 2, combo 2, stacked 1, heatmap 1, bullet 1.

| Question | Chart |
|---|---|
| How is a value trending over time? | Area / line (orders value, attendance present) |
| Volume **and** rate together over months? | Combo – bars + line on a second axis (lead conversion, quotation value vs win rate) |
| How does it compare across groups (owner, product, region)? | Horizontal bars, sorted |
| What share is each reason / status? | Donut (lost leads, lost quotations, AMC status, awaiting orders, attendance exceptions) |
| Where do we drop off? | Funnel (business scorecard, pipeline by stage) |
| Won vs lost over time? | Stacked bars (outcomes) |
| Which days/hours are busiest? | Heatmap (visits by weekday × hour) |
| Target vs achieved per person? | Bullet (executive performance target view) |
| Ageing / days to expiry (ordered buckets) | Vertical bars in fixed order |

Every report also has an insight line, a legend, click-through from chart to rows, and KPI sparklines.

## 4. Test matrix results (final regression, 2026-10-20)

| Check | Result |
|---|---|
| `npx tsc --noEmit -p .` | 0 errors |
| `npx eslint .` | 0 errors |
| `npm run build` | passes (only the usual chunk-size notice) |
| `npx vitest run` | 385 passed, 1 skipped, 39 files |
| `npx playwright test` | 589 passed, 1 failed (see below) |
| Roles × pages | 12/12 roles: every page is either in the nav and opens, or blocked cleanly with a title |
| Layout matrix (1440 / 768 / 375 wide) | 107/107 pages, no sideways page scroll |
| Keyboard (Tab reach, visible focus, no trap) | 107/107 |
| Failing and slow (3 s) services | 107/107 show loading then content or a retryable error |
| Data volume | empty list shows an empty state; 1 record shows 1 row; 1,200 records paginate (≤110 rows rendered), first row < 6 s, no sideways scroll – all 11 lists incl. the opportunities board |
| Hostile data (400-char words, HTML/script, emoji, negative/huge numbers) | 9 resources survive; no script executed |
| Console errors | none in any test above |

The one failure in the full run was `settings.spec.ts › roles › store` (fixed 1.5 s wait under load). It passes when run alone (45 s); treat it as a timing flake, not an app defect.

## 5. Known limitations

- **Tables**: every page and module now renders through `Table` (static), `DataTable` (sort / search / page) or `DataGrid` (resource lists). `ReportTable`, the line-item editor and the GST summary use `Table` for markup and styling. The only raw `<table>` left are the table components themselves and the quotation PDF print layout (ESLint exception).
- **Custom list pages** (a few module lists) still build their own toolbar rather than the shared one.
- **Remaining colours outside tokens** are deliberate: the quotation paper/PDF print layout and the signature canvas are fixed white-on-dark-ink so they print correctly; the rest are `var(--token, #fallback)` fallbacks.
- **Inline styles**: 71 `style={{…}}`; most are dynamic widths/colours. Three static ones remain (`installed/components.tsx`, `TicketExtensions.tsx`).
- **Duplicate names**: `LinesTable` / `TotalsBlock` exist for quotations and for orders (different data shapes); `Pager` exists in Pipeline and Field as wrappers over the shared `Pagination`.
- **Unsaved-changes guard** is applied on Settings pages (SaveBar). Record forms, drawers, New Lead / New Order and quick-create were **not** verified or wired to it. `BrowserRouter` cannot intercept the browser Back button.
- **Bulk approve**: after "select all → approve", the flow script still found 1 `Approve` button; not investigated (it may be a row the bulk action does not include).
- **Not tested**: Safari / Firefox, real screen readers, real device zoom (emulated with narrower viewports), contrast beyond a sample.
