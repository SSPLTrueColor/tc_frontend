# Reports — redesign and QA record

Scope: BRD 4.13 (Dashboards & Reports) and every "Reports" clause in the module requirements
(CUS-12, LEAD-12/14, QUO-14, SO-11, IB-07, SRV-17, ATT-10, App. C, NFR-23).
Run date: 20 Oct 2026 (simulated clock) on the demo seed. Reports are all simulated: figures come from the
mock services under each role's row scope; nothing is hard-coded.

## 1. What a report is now

Every report page has the same structure:

1. **Header** – description line, back to category, ★ Favourite, **Export Excel**.
2. **Views** (tabs) – only where one question has several cuts (for example Lead Speed: ageing · first response · follow-ups).
3. **Filter bar** – period presets (Today … Last 90 days … This financial year … All time, or Custom range), division, user, group-by, **Reset**, and a chip for every applied filter. Filters are kept in the URL (shareable) and remembered per user per report.
4. **3–5 KPI cards** – value, change vs the previous period (▲/▼ with sign and a "better/worse" word, never colour only), previous value underneath.
5. **One primary chart** in the form the data needs: line/area (trend), ranked bars or columns (comparison), donut (share), funnel (stages).
6. **Detail table** – sticky header, sort, column show/hide (7 columns by default, others optional), search, numbers right-aligned in ₹ Indian grouping, dates `DD MMM YYYY`, **grand-total footer**, numbered pagination (25/50/100), row click opens the drill-down.

KPI cards, chart marks and footer totals are **derived from the same rows** by the report engine
(`src/services/reports/engine.ts`), so they cannot disagree. The previous period is the equal-length period just before the chosen range (only for bounded past ranges).

## 2. Reports (27 reports, 8 categories)

Merged from the earlier 41; every BRD report clause is still covered (see `docs/REQUIREMENTS.md`). Older report ids redirect to the view that replaced them.

| Category | Report | Purpose (decision it supports) | Views / group-by | BRD |
|---|---|---|---|---|
| KPIs | Business Scorecard | Where the business is strong or weak this period | funnel lead → order + every App. C KPI | App. C, FR-149 |
| | Pipeline & Forecast | Is the quarter covered? | By stage · By salesperson | OPP-07 |
| | CRM Adoption | Who is using the CRM | – | NFR-23 |
| Customers | Customer-wise Sales | Where revenue and pipeline sit | – | CUS-12 |
| | Machine History | Which machines keep coming back | – | CUS-12 |
| | Dormant Customers | Whom to re-engage | – | CUS-12 |
| Leads | Lead Conversion % | Which channels convert | month · owner · product · source · campaign | LEAD-14 |
| | Lead Speed | How fast leads are handled | Ageing · First response · Pending follow-ups | LEAD-14 |
| | Lost and Disqualified Leads | Biggest leak first | – | LEAD-14 |
| | Sales Executive Performance | Weekly coaching | – | LEAD-14 |
| | Referral Report | Which referrers convert | referrer · type | LEAD-12 |
| Quotations | Quotation Value & Conversion | Quoted value, quote-to-order %, discount | month · owner · division · status | QUO-14 |
| | Lost Quotations | Why deals are lost | – | QUO-14 |
| | Discount Analysis | Margin control against approval bands | owner · division | QUO-14 |
| Sales Orders | Order Value & Sales Performance | Booked value vs plan | month · owner · division · order type | SO-11 |
| | Order Backlog & Delays | Unblock revenue | Backlog · Waiting for approval · Delayed dispatches | SO-11 |
| | Payments & Overdue Ageing | Whom to chase | – | SO-11 |
| Installed Base | Installed Base by Model | Where machines are | model · region · cover | IB-07 |
| | Warranty & AMC | Renewals never missed | Warranty expiry · AMC renewals due · Contract status | IB-07 |
| | Machines Without Contract | Upsell call list | – | IB-07 |
| Service | Open Tickets | Prioritise the day | – | SRV-17 |
| | SLA Compliance | Meeting targets and repair time | month · priority · cover | SRV-17 |
| | Service Quality | MTTR, first-time fix, repeats, CSAT | By engineer · By month | SRV-17 |
| | Machine Reliability | Which machines/models fail | Downtime · MTBF · Repeat complaints | SRV-17 |
| | PM Compliance | Preventive visits on time | – | SRV-17 |
| Field Force | Attendance | Who is in, late, absent | Daily · By employee · Exceptions | ATT-10 |
| | Field Visits | Who is out meeting customers | – | ATT-10 |

Not separate reports (and why): *Activity Scorecard* – lives on `/activity-scorecard`; *Quotation Pending Approvals* – the same list is `/quotations/pending-approvals`; *Exception dashboard* – kept as the live board and as the Exceptions view of Attendance.

## 3. Test matrix and results

Automated: `npx vitest run` (370 pass, 1 skipped, of which 52 are report tests; the new engine/stress file is `src/test/reports.engine.test.ts`).
Browser: Playwright scripts in `e2e/reports-sweep.mts` and `e2e/reports-qa.mts` against the dev server.

| Area | Case | Result |
|---|---|---|
| Data volume | No data in any resource: every view of every report | Pass – empty states, no errors; KPIs N/A or 0 |
| | One record per resource | Pass |
| | 10,000 records in each large resource: every view | Pass – all 100+ view/group combinations in ≈ 10–28 s total on a test machine; charts ≤ 12 marks (line charts ≤ 400); tables paginate (25 rows rendered) |
| Date ranges | Today · single day · 1 year · across year boundary · entirely future · all time · before any data | Pass, every view. Previous-period maths verified incl. year boundary and single day |
| | Indian financial year, last month in January, quarter start | Pass (unit tests) |
| Numbers | ₹10,00,00,000-scale order | Pass – full in footer/table, `₹10 Cr` on card |
| | Zero and negative amounts (credit notes) | Pass – shown with a minus sign, included in totals; donut leaves out ≤ 0 slices |
| Labels | 190-character customer name | Pass – ellipsis in table and chart label, full name in the tooltip on hover; page does not scroll sideways |
| Chart | 30 categories | Pass – top N plus "Others (n)" which still adds up; rate charts cut with "Top N of M" |
| Totals | Footer = sum of rows; additive chart = column total; KPI NaN-free | Pass for every report × view × group-by |
| Filters | Period + division + user + group-by + search combined; chips; Reset; custom range picker | Pass |
| | Persist per report after leaving and returning; shareable URL | Pass |
| Service | 3 s service: skeleton shown, data after ≈ 3.2 s, **no layout shift** (KPI row 96 → 96.5 px, chart 343 → 341 px) | Pass |
| | Failed service: error state with Retry; Retry recovers once service is back | Pass |
| | Filter change keeps previous figures dimmed while reloading | Pass (visual) |
| Export | Excel `.xlsx` with current filters: visible columns only, search applied, grand total equals the footer, filters listed in the sheet, valid zip (`unzip -t`) | Pass |
| | Role without export (Sales Executive): button disabled with reason; every export is written to the audit trail | Pass |
| Widths | 1440 · 1280 · 1152 (≈125 % zoom) · 1024 · 960 (≈150 % zoom) · 768 · 375, light and dark, 10 representative reports | 138 / 140 pass; the 2 flagged cases were the view-tab strip scrolling inside its own row at 375 px (the page itself never scrolls sideways) – label shortened |
| | Table scrolls inside its card, never the page | Pass at all widths |
| Themes | Light and dark | Pass (colours from tokens; chart palette selected per mode) |
| Keyboard | Tab reaches ★, Export, filters, search, Columns, every sortable header, chart bars, pagination; focus ring on every control; Enter sorts; Enter/Esc open/close Columns with focus returned; Enter toggles ★; ← → switch view tabs; Enter opens a card | Pass (15/15) |
| Roles | All 27 demo users: the reports listed equal the reports that open; the others show "no access"; no console errors | Pass (27/27) |

Role result (reports listed): Administrator, Management, Division Head, Sales/Service/Coordinator roles and others with wide read rights – 27; Accounts – 19 (no lead reports, PM compliance); Service Engineer – 19 (no sales, quotation, order or payment reports); Import/SCM – 14; Store in-charge – 13; Profiling – 5. Rows inside each report follow the role's scope (own / team / division / all). Export is limited to the roles with **X** in the access matrix (Administrator, Management, Division Head, Service Leadership, Accounts).

Build: `npm run build` passes; `npm run lint` clean; `tsc -b` clean; no console errors in any sweep.

## 4. Known limitations

- **Print / PDF / CSV are not offered** (only Excel was asked for). The Excel file is a genuine `.xlsx` written without a library; Indian ₹ grouping in cells uses a two-condition Excel format, so very large negative amounts show Western grouping.
- **Sales Executive and other wide-read roles see all categories.** Visibility is decided by which records a role may read plus row scope, as in the lists; categories with no records for that person simply show empty reports. A tighter per-role report list needs the BRD's Reports column in section 8 (left blank in the BRD) to be filled in.
- **Funnel stages are activity counts, not a strict cohort.** In the Business Scorecard funnel, quotations and orders in the period are not necessarily from the leads of the same period, so "carried over" percentages above 100 % are hidden.
- **Previous-period comparison needs a bounded past range.** "All time", snapshot reports (backlog, open tickets, pipeline) and future ranges show "Current snapshot" instead of a change.
- **Seed history is about six months,** so "Last 12 months" shows an empty previous period; the default is therefore Last 90 days.
- **Rounding:** tables show whole rupees; the sum of displayed rows can differ from the footer by under ₹1 per row because the footer adds the unrounded figures.
- **Performance is simulated.** Timings above are in-browser on one machine; real 4G, concurrency and the "reports within 10 s" target (NFR-03) are not measurable in a frontend-only prototype. The charts are drawn with Recharts and a 3 s service delay was simulated through the demo latency setting.
- **Favourites, recents and remembered filters live in this browser only** (per signed-in user); "Reset demo data" does not clear them.
- **Dates:** reports write `DD MMM YYYY` as asked; the rest of the app still uses `DD-MM-YYYY` (BRD COM-11), and report tables right-align numbers although the template left-aligns them elsewhere.
- **Report descriptions** are shown as one visible line under the title bar (as requested) instead of the ⓘ tooltip used elsewhere.
