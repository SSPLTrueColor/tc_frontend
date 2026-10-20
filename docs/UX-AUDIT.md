# UX audit — Step 1 (no code changed)

Scope: the whole app (140 components, ~65 module pages + ~50 list / record pages served by the resource engine, 39 report views, 11.4k lines of CSS).
Method: static analysis of the repository (counts below are exact `grep` / script results, 2026-10-20), the Settings QA run done earlier (`docs/SETTINGS-QA.md`), and screenshots taken during that work.
**Not verified yet:** the visual state of every component (hover / focus / disabled / loading / error) outside Settings, click counts per workflow, and keyboard / contrast behaviour outside Settings. These are marked "to measure" and become the first task of Step 3 / Step 5. Nothing in this file has been changed in the app.

## 0. Decisions I need from you before Step 2

1. **Page header.** Your rule is "breadcrumb → title → one-line description → actions". The app today follows an earlier owner rule (`PageHeader.tsx`): the title lives in the **top bar**, there is **no breadcrumb row** and **no ⓘ beside titles**; actions sit on the list toolbar. These conflict. Recommendation: keep the title in the top bar (it never scrolls away), add a small breadcrumb above it only on **detail and nested pages**, and put the one-line description + primary action in a header row inside the page. Please confirm or tell me to follow your rule literally on every page.
2. **Spacing scale.** The tokens give 4 / 8 / 12 / 16 / 24 / 32 px, but 33 % of spacing declarations use 6, 10, 14, 18 or 20 px (§A.9). Recommendation: snap to the scale (6→4 or 8, 10→8 or 12, 14→12 or 16, 20→16 or 24). This will shift some layouts by a few pixels. OK?
3. **Charts.** `recharts` is already the chart library (good: "one library"). It is only used by Reports and the Dashboard; the app also has its own SVG `BarChart` and a CSS funnel. I recommend one `Chart` wrapper on recharts and removing the duplicates. Adding stacked, combo, heatmap and bullet charts uses the same library (no new dependency).
4. **Step 2 text is cut off** in your message (it starts mid-sentence at "…lacement, spacing, all states"). I read it as "fix the global components first: sizes, variants, placement, spacing, all states, documented in `docs/COMPONENTS.md`". Please resend if it said more.
5. **Report additions** need your approval (§C): *Won vs Lost by month* (stacked bar), *Visits by day & hour* (heatmap), *Target vs achieved* (bullet). All use data already in the app.

## A. Global component audit

### A.1 Where shared components are used (files that use them, outside their own definition)

| Component | Files | Component | Files |
|---|---|---|---|
| Button | 91 | SelectMenu | 57 |
| IconButton | 37 | MultiSelectMenu | 4 |
| StatusChip | 30 | DatePicker / DateRangePicker | 19 / 3 |
| Badge | 17 | Dialog / Drawer | 27 / 3 |
| EmptyState | 50 | confirmDelete | 14 |
| ErrorState | 55 | InfoTip | 23 |
| Skeleton | 47 | Avatar | 5 |
| InlineAlert | 38 | PageHeader | 38 |
| NoAccess | 27 | DataGrid | 2 (ResourcePage, PipelinePage) |
| Tabs | 10 | BoardView / CalendarView | 3 / 2 |
| useToast | 61 | Settings kit (SettingsPage / Section) | 13 / 11 |

### A.2 Bypasses and duplicates (what pages do instead of the shared component)

| Finding | Evidence | Priority |
|---|---|---|
| **Two table systems.** `DataGrid` is used by only 2 pages; **36 files hand-build `mini-table`** and 42 files contain a raw `<table>` (68 tables). Columns, sorting, row actions and empty states differ per page. | grep | Critical |
| **Six pagination implementations**: `DataGrid`, catalog `Pager` / `usePaged`, `spares/ListKit`, `leads/SortableTable`, `field/common`, `ReportTable`. | grep | Critical |
| **Raw form controls.** 185 raw `<input>` (61 files), 37 `<textarea>` (25 files), 36 raw checkboxes, 8 switches built by hand. There is no `TextField`, `Textarea`, `NumberField`, `Checkbox`, `Switch` or `SearchInput` component, only CSS classes. | grep | Critical |
| **Buttons bypassing `Button`**: 46 `className="btn …"` and 102 raw `<button>` in 47 files (some are legitimate tab / chip / row triggers; many are not). | grep | High |
| **Native `type="time"` ×4 and `type="number"` ×16** look and behave differently from `DatePicker` / `Input`. | grep | High |
| **Segmented control hand-built 23 times** (`className="segmented"` + `seg-btn`). Not a component. | grep | High |
| **Two link-button styles**: `.link` (8) and `.rel-link` (23). | grep | Medium |
| **Four skeleton styles**: `Skeleton`, Settings `st-skel`, report skeletons, dashboard skeletons. | grep | High |
| **Status colours defined locally in 6 places** (`STATE_TONE`, `EX_TONE`, `APPROVAL_TONE`, `CLOCK_TONE`, `ACCESS_TONE`, Data Protection `TONE`) instead of one status → tone map; and both `Badge` (17 files) and `StatusChip` (30) are used for status. | grep | High |
| **Duplicate chart code**: custom SVG `components/resource/BarChart.tsx` (4 files), a CSS-only funnel in Reports, `recharts` elsewhere; two palettes (`--rp-s1…s6` hex in `reports.css`, `COLOR` object in `dashboard/widgets.tsx`). | grep | High |
| **Confirmations**: `confirmDelete` (14 files), 13 hand-rolled `alertdialog`s, 2 `window.confirm`. Typed confirmation exists only in the Settings kit. | grep | High |
| **Unsaved-changes guard exists only in the Settings kit** (`useUnsavedGuard`). Record forms, drawers, the quotation editor and field forms were not checked. | code review | High (to verify) |
| **Inline styles: 67** (`DataGrid` 10, dashboard widgets 6, `ThemePicker` 6, `CalendarView` 6, `TicketExtensions` 5 …). About two thirds are dynamic widths / colours (legitimate); the rest should be classes. | grep | Medium |

### A.3 Control sizes and touch targets
`.input` is 40 px high, `.input-compact` is 32 px (35 uses) and `Button` / `SelectMenu` are 32 px. Toolbars mix them (for example a 32 px search beside a 40 px select in some pages). On phones everything outside Settings is 32–40 px, below the 44 px target (Settings pages already get 44 px via `st-col`). Priority: High.

### A.4 Tokens: colours and spacing
- **Hard-coded colours outside tokens:** `app.css` 63, `reports.css` 30, `quotations.css` 13, `QuotationPdfPage.tsx` 6 (print layout, acceptable but should be documented), `calendar.css` 4, `installed/components.tsx` 3, `AttendancePages.tsx` 2, others 1–2.
- **Spacing:** of 992 `padding` / `margin` / `gap` values in CSS, **331 (33 %) are off the 4-8-12-16-24-32 scale** (6 px ×133, 10 px ×95, 14 px ×38, 3 px ×17, 20 px ×12, 18 px ×8). 277 of them are in `app.css`.
- Priority: Critical (colours in charts / reports), High (spacing).

### A.5 State coverage per component (hover · focus · active · disabled · loading · error · empty)
To measure. What is already known:
- `Button`: loading and disabled-with-reason exist; `IconButton`: disabled-with-reason; `SelectMenu`, `DatePicker`, `MultiSelectMenu`: keyboard handling exists.
- Settings pages pass the keyboard focus-ring and touch-size checks (19 pages). The same check has not been run for any other page.
- Empty / error / loading states: `EmptyState` (50), `ErrorState` (55), `Skeleton` (47) are widely used, but `PublicPages` and some report widgets use their own.
- Planned: one Playwright "component gallery" route that renders every component in every state, then automated checks for focus ring, contrast and size (Step 2 exit test).

### A.6 Accessibility (known so far)
- Focus ring: sidebar search draws it on the wrapper (`:focus-within`); verified OK. Other pages not yet checked.
- Contrast: Settings sampled at ≥ 4.5:1 in light and dark. Chart colours (`--rp-s1…s6`, dashboard `COLOR`) not checked against the panel background; amber `#eda100` on white is a likely fail.
- Labels: checkboxes and switches in tables use `aria-label`; chart marks have tooltips but no text alternative besides the table below them.

## B. Page audit

### B.1 Structure
- **PageHeader** is used by 38 files; `SettingsPage` by 13. Only `LoginPage` and the public ticket pages are outside the pattern (correct: they have no shell).
- **Toolbars:** 20 pages build their own `className="toolbar"` instead of one filter bar; list pages therefore differ in order of search / filter / sort / view controls.
- **Primary actions.** Files with more than one `variant="primary"` button (candidates for "competing primary action"; a file may hold several screens or states, so each needs a page-level check): `quotations/RecordExtensions` 9, `service/MyJobPage` 6, `orders/OrderActions` 6, `installed/components` 6, `spares/RequisitionActions` 5, `orders/OrderTabs` 5, `field/VisitPages` 5, `customers/pages` 5, `service/TicketExtensions` 4, `RecordForm` 4, `leads/LeadActions` 3, `CalendarPage` 3.
- **Forms:** `RecordForm` (drawer / full page), the quotation editor, line-item editors, field forms and dialogs use different footer layouts (Save left vs right, Cancel presence) — to verify with screenshots in Step 3.

### B.2 Click counts for the main BRD workflows (baseline = to measure)
I will not quote numbers I have not measured. Step 3 starts with a scripted baseline (Playwright counts clicks and keystrokes per workflow) so "before / after" is real. Workflows to measure and the click-reducers planned for each:

| Workflow | Likely reducers |
|---|---|
| Add a lead / company / contact | Quick-create row at top of the list; remember last division |
| Log a follow-up / call on a lead | Row action on hover; keyboard shortcut; pre-filled next date |
| Move an opportunity through stages | Drag on board; inline status in table |
| Create a quotation from an opportunity | One-click "Create quotation" with lines pre-filled |
| Approve / reject a discount | Approve from the notification row and the list, no page open |
| Create a service ticket from a call | Quick-create with company / machine search first |
| Assign an engineer | Inline assign in the list; suggested engineer pre-selected |
| Close a job with sign-off | Single page with sticky "Complete" |
| Check in / out (attendance) | Already 1 tap; keep |
| Raise a spares requisition | Pre-fill from ticket / machine |
| Bulk reassign / export | Bulk bar on every list; remember last export format |
| Find a record | Global search (exists); recent items on empty search |
| Filter a list and keep the filter | Persist last-used filters per list |
| Give someone extra access | Done (People view): ≤ 4 clicks |

### B.3 Other page-level findings
- Hard-coded colours / px: see A.4; the largest page-level offenders are Reports and Quotations CSS.
- Hidden important actions: row actions are shown per page in different ways (inline buttons, ⋯ menu, none). One pattern needed.
- Keyboard shortcuts: 21 files handle keys but there is no registry and no help overlay.

## C. Reports audit (39 report views)

Rule applied: the chart must follow the business question (your matrix). **Keep 34 · Change 3 · Add 2 new views** (plus 1 new report, below). Everything else already matches the matrix.

| Group | Report · view | Business question (the report's own description) | Current chart | Recommended chart | Action | Note |
|---|---|---|---|---|---|---|
| kpis | Business Scorecard | Every Appendix C KPI for the period, with the funnel from lead to order | Funnel — “Sales activity, lead to order” | Funnel | Keep | Matches "pipeline / stage conversion". |
| kpis | Pipeline & Forecast · By stage | Open opportunities by stage and salesperson, with the weighted forecast | Horizontal bar — “Pipeline value by stage” | Funnel | Change | Stage conversion is a funnel; today it is a ranked bar. |
| kpis | Pipeline & Forecast · By salesperson | Open opportunities by stage and salesperson, with the weighted forecast | Horizontal bar — “Weighted forecast by salesperson” | Horizontal bar (sorted) | Keep |  |
| kpis | CRM Adoption | Who is using the CRM and who is falling behind | Horizontal bar — “Overdue follow-ups per user” | Horizontal bar (sorted) | Keep |  |
| customers | Customer-wise Sales | Which customers bring the revenue and which have pipeline waiting | Horizontal bar — “Top 10 customers by booked value” | Horizontal bar (sorted) | Keep |  |
| customers | Machine History | Service and PM history per machine, to spot repeat offenders | Horizontal bar — “Machines with most service tickets” | Horizontal bar (sorted) | Keep |  |
| customers | Dormant Customers | Customers with no order or contact for a long time, ready to re-engage | Bar — “Dormant customers by idle time” | Bar by bucket | Keep | Idle-time buckets. |
| leads | Lead Conversion % | How many leads become opportunities, by month, owner, product, source or campaign | Line — “Lead conversion % by month” | Combo (bars: leads, line: conversion %) | Change | Two metrics; a % line alone hides volume. |
| leads | Lead Speed · Open lead ageing | How fast leads are answered and followed up | Bar — “Open leads by age” | Bar by bucket | Keep |  |
| leads | Lead Speed · First response | How fast leads are answered and followed up | Horizontal bar — “Average first response (hours)” | Horizontal bar (sorted) | Keep |  |
| leads | Lead Speed · Pending follow-ups | How fast leads are answered and followed up | Horizontal bar — “Overdue follow-ups per owner” | Horizontal bar (sorted) | Keep |  |
| leads | Lost and Disqualified Leads | Why leads are lost or disqualified, biggest reason first | Donut — “Disqualified leads by reason” | Donut (≤6, rest "Others") | Keep | Confirm the ≤6 + Others rule is enforced. |
| leads | Sales Executive Performance | Leads, conversion, orders and activity per sales executive | Horizontal bar — “Booked value per Sales Executive” | Horizontal bar + Bullet for target vs achieved | Add | Targets exist (TGT-02); show booked vs target as a bullet. |
| leads | Referral Report | Which referrers send leads that convert | Horizontal bar — “Referral leads per referrer” | Horizontal bar (sorted) | Keep |  |
| quotations | Quotation Value & Conversion | Quoted value, conversion to orders and discount, by month or owner | Area — “Quoted value by month” | Combo (bars: quoted value, line: conversion %) | Change | Title says "value & conversion" but plots one metric. |
| quotations | Lost Quotations | Rejected and expired quotations, with the reason | Donut — “Lost value by reason” | Donut (≤6, rest "Others") | Keep |  |
| quotations | Discount Analysis | Discounts given by salesperson or division against approval bands | Horizontal bar — “Average discount %” | Horizontal bar (sorted) | Keep |  |
| sales-orders | Order Value & Sales Performance | Booked order value by month, salesperson, division or order type | Area — “Order value by month” | Area | Keep | Trend over time. |
| sales-orders | Order Backlog & Delays · Backlog | Orders not yet delivered, waiting for approval, or dispatched late | Bar — “Backlog value by status” | Bar by bucket | Keep |  |
| sales-orders | Order Backlog & Delays · Waiting for approval | Orders not yet delivered, waiting for approval, or dispatched late | Donut — “Orders waiting, by status” | Donut (≤6) | Keep |  |
| sales-orders | Order Backlog & Delays · Delayed dispatches | Orders not yet delivered, waiting for approval, or dispatched late | Horizontal bar — “Delayed dispatches by transporter” | Horizontal bar (sorted) | Keep |  |
| sales-orders | Payments & Overdue Ageing | Payment milestones due, received and overdue, with ageing | Bar — “Overdue amount by age” | Bar by age bucket | Keep | Aging buckets. |
| installed-base | Installed Base by Model / Region | Installed machines by model, region or warranty/AMC cover | Horizontal bar — “Machines” | Horizontal bar (sorted) | Keep |  |
| installed-base | Warranty & AMC · Warranty expiry | Warranties and AMCs nearing expiry, and how contracts are performing | Bar — “Warranties ending per month” | Bar by month | Keep | Forward-looking monthly buckets: bars read better than a line; confirm. |
| installed-base | Warranty & AMC · AMC renewals due | Warranties and AMCs nearing expiry, and how contracts are performing | Bar — “Renewal value by month” | Bar by month | Keep | Same note. |
| installed-base | Warranty & AMC · Contract status | Warranties and AMCs nearing expiry, and how contracts are performing | Donut — “Contracts by status” | Donut | Keep |  |
| installed-base | Machines Without a Contract | Machines with no warranty, AMC or CMC cover: the upsell call list | Horizontal bar — “Uncovered machines by model” | Horizontal bar (sorted) | Keep |  |
| service | Open Service Tickets and Ageing | Open service tickets, their age and SLA breaches | Bar — “Open service tickets by age” | Bar by age bucket | Keep |  |
| service | SLA Compliance % | How often service meets its response and resolution targets | Line — “SLA compliance % by month” | Line | Keep |  |
| service | Service Quality · By engineer | Repair time, first-time fix, repeats and customer satisfaction | Horizontal bar — “Service tickets resolved per Service Engineer” | Horizontal bar (sorted) | Keep |  |
| service | Service Quality · By month | Repair time, first-time fix, repeats and customer satisfaction | Line — “First-time fix %” | Line | Keep |  |
| service | Machine Reliability · Downtime by machine | Which machines and models fail most: downtime, MTBF and repeats | Horizontal bar — “Downtime hours (top 10 machines)” | Horizontal bar (sorted) | Keep |  |
| service | Machine Reliability · MTBF by model | Which machines and models fail most: downtime, MTBF and repeats | Horizontal bar — “MTBF (days) by model” | Horizontal bar (sorted) | Keep |  |
| service | Machine Reliability · Repeat complaints | Which machines and models fail most: downtime, MTBF and repeats | Donut — “Repeat complaints by complaint category” | Donut (≤6) | Keep |  |
| service | PM Compliance % | Preventive maintenance visits done on time against those due | Line — “PM compliance %” | Line | Keep |  |
| field-force | Attendance · Daily | Who is in, on tour, on leave or late, and the exceptions to follow up | Area — “People present per day” | Area | Keep |  |
| field-force | Attendance · By employee | Who is in, on tour, on leave or late, and the exceptions to follow up | Horizontal bar — “Late days per user” | Horizontal bar (sorted) | Keep |  |
| field-force | Attendance · Exceptions | Who is in, on tour, on leave or late, and the exceptions to follow up | Donut — “Exceptions by type” | Donut (≤6) | Keep |  |
| field-force | Field Visit Report | Planned against completed field visits per person | Horizontal bar — “Completed field visits per user” | Horizontal bar + Heatmap (day × hour) | Add | "Activity by day & hour" has no report today. |

Additions that need your approval (not in the table above because they are new):
1. **Won vs Lost by month** — stacked bar (opportunity outcomes over time). Matrix row "Won vs lost / status over time" has no report today.
2. **Visits by day and hour** — heatmap (matrix row "Activity by day & hour"); shown as a second view of *Field Visit Report*.
3. **Target vs achieved** — bullet per Sales Executive / division (TGT-02); shown as a second view of *Sales Executive Performance*.
4. **KPI cards with sparkline** on report pages (the Dashboard has them, report pages do not).

Chart rules to verify in Step 5 (not yet measured): ₹ lakh / crore format on every money axis and tooltip; legend only when needed; click-through to the filtered list; chart totals equal KPI and table totals; no pie above 6 slices; titles state an insight.
Chart types the code supports today: line, area, bar, hbar, donut, funnel. Missing: stacked bar, combo, heatmap, bullet.

## D. Prioritised fix list

### Critical
1. **One data table** — rebuild on the existing `DataGrid` (sort, columns, row actions, bulk bar, empty / loading / error, pagination) and migrate the 36 hand-built tables.
2. **One pagination** component (replace the 6 variants).
3. **Form-control primitives**: `TextField`, `Textarea`, `NumberField`, `TimeField`, `Checkbox`, `Switch`, `SegmentedControl`, `SearchInput`; migrate raw inputs.
4. **Tokens for every colour** in reports / charts / quotation UI; one chart palette with AA contrast in both themes.
5. **One primary action per page** — resolve the 12 flagged files page by page; define Primary / Secondary / More (⋯) rules.
6. **Page header decision** (§0.1), then one `PageHeader` with breadcrumb (detail pages), description and actions.

### High
7. Snap spacing to the scale (331 off-scale values).
8. One status → colour registry; `Badge` = label / count, `StatusChip` = status only.
9. One `Skeleton` family (list, card, chart, form).
10. One `Chart` wrapper on recharts; remove custom `BarChart` and CSS funnel; add stacked, combo, heatmap, bullet; apply §C.
11. One `ConfirmDialog` (normal / destructive / typed) replacing `window.confirm` and 13 hand-rolled dialogs.
12. `useUnsavedGuard` on every form (RecordForm, drawers, editors).
13. Control heights: one default (40) and one compact (32) with a rule for when; 44 px targets on touch screens everywhere.
14. Replace native time / number inputs with the shared fields.
15. Row actions, inline edit, quick-create and bulk actions on every list (click reduction, §B.2).
16. One filter bar layout for all lists; remember last-used filters.

### Medium
17. Move static inline styles to classes (about 20 of 67).
18. Merge `.link` and `.rel-link`.
19. Keyboard shortcut registry and help overlay.
20. Document print / PDF colours (quotation) as an allowed exception.
21. `docs/COMPONENTS.md` (props, variants, when to use) and a component gallery route.

## E. Proposed order and exit tests
Step 2 → components (items 1–3, 8, 9, 11, 13, 14, 16 + gallery + `COMPONENTS.md`). Step 3 → pages (4–7, 12, 15, 17–19). Step 4 → reports (10, §C). Step 5 → stress test (Playwright, same suite style as Settings). Step 6 → search for hard-coded values and duplicates, `docs/UX-QA.md`. One commit per step.
