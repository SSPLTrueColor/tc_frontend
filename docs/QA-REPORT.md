# True Color CRM — BRD Stress Test (QA Report)

Date: 19-10-2026 · Branch: `feature/crm-modules` · Scope: every page and every action of the prototype, checked against `docs/BRD.md` (requirement IDs, Appendix A workflows, §3.1 hand-offs, §2.2 permission matrix in `docs/REQUIREMENTS.md`) and `docs/GLOSSARY.md` names.

## 1. How it was tested

Nine QA passes ran in parallel, one per BRD area plus one end-to-end walk of the whole BRD process. Each pass:

- opened every page and ran every action in headless Chrome at 1440 px and 390 px, as the role that owns the work, its manager, and a role that must be refused (list, side panel, direct URL and search);
- checked validation (required, formats, ranges, duplicates, whitespace-only), every Appendix A status transition (allowed and blocked), mandatory reasons, locked end states, double-click, refresh and back;
- recomputed numbers by hand where the BRD defines them (GST split, totals, KPIs, targets, shift hours);
- fixed defects in its own module with a regression test, and sent changes to shared files to their owner.

## 2. Results

| Area (BRD) | Checks | Defects found | Fixed in module | Fixed by shared-file owner | BRD gaps noted |
|---|---|---|---|---|---|
| Customer & Contact Master (4.1) | ≈ 95 | 22 | 17 | 5 | 3 |
| Lead Management + Opportunity & Pipeline (4.2, 4.3) | ≈ 160 | 21 | 14 | 5 | 3 |
| Quotation Management (4.4) | ≈ 75 | 21 | 14 | 5 | 2 |
| Sales Order & Sales Contract + Dispatch (4.5, INS-01/02) | ≈ 60 | 15 | 15 | — | 2 |
| Installation, Installed Base & AMC, Service Tickets (4.6–4.8) | ≈ 95 | 25 | 19 | 3 | 3 |
| Spare Parts + Consumables (4.9, 4.10) | ≈ 120 | 20 | 18 | 2 | 3 |
| Field Force + Targets (4.11, 4.12) | ≈ 95 | 27 | 22 | 5 (3 fixed, 2 open — §3) | 3 |
| Dashboards & Reports, Administration, Common, shell (4.13, 4.14, §5) | ≈ 120 | 19 | 17 | 1 | 4 |
| End-to-end BRD process (§3, §3.1) | 20 steps × roles | 10 (counted in the areas above) | — | — | 2 |
| **Total** | **≈ 840** | **≈ 170** | **136** | **26** | **25** |

Most important defects fixed (all with tests):

- **Approvals and segregation of duties** — Service roles could approve sales discounts (QUO-06); requesters could approve their own spares requisition; the store could acknowledge its own dispatch; a Sales Manager could set targets for himself (TGT-01).
- **Data scope leaks** — quotations on another division's opportunity by ID, sites/contacts on other people's companies, dealer orders for another owner's dealer, Import / SCM editing commercial order fields, out-of-scope edit URLs, Knowledge Base drafts by direct URL, deactivated users still able to sign in.
- **BRD rules not enforced** — manual "Mark Contacted" stopped the first-contact SLA without contact (LEAD-08); mandatory next follow-up only checked in the dialog (LEAD-09); delivery photo and e-way bill optional (INS-01/02); sales users could type list prices (QUO-05); fractional spare quantities; zero-value and duplicate expense claims.
- **Hand-offs (§3.1)** — PO details had to be re-typed on the sales order; Convert to Opportunity lost product type, requirement and activity history; warranties near expiry raised no reminder or renewal opportunity; the sales owner could not fill the Sales-to-Service handover; PM visits were short by one; an AMC sold in advance never became Active.
- **Numbers** — CGST/SGST odd-paise splits and half-paisa rounding; sales order totals now equal the quotation to the paisa; target achievement used gross value for some targets and net for others; IST day boundaries in KPIs; every dashboard tile now opens a list with exactly the same count.
- **Administration** — no user could ever be deactivated (personal history counted as open work); Bulk Ownership Transfer now hands over every open record type, so one transfer clears deactivation.
- **Usability** — record pages were 2 px wide on phones; double-click created duplicates (quotations, orders, imports); action labels truncated; "Save Draft / Save & Issue" on records that have no Issue step.

The end-to-end walk now passes in strict mode: from a Contact Pool contact to an engineer-spotted lead, every hand-off carries its data forward with **no re-entry** (`E2E_STRICT=1 npx vitest run src/test/e2e.lifecycle.test.ts` → 21/21).

## 3. Still open (not fixed — decision or larger build needed)

| # | Item | BRD | Why open |
|---|---|---|---|
| O-1 | Engine-level check that a created record is inside the creator's write scope | §2.2 | Today each module's hooks guard this (field, targets, quotations, spares, dealer orders). A blanket engine rule would block valid creates such as an engineer's "Opportunity Spotted" lead (create allowed, edit not). Needs a per-resource rule. |
| O-2 | Configurable location-tracking interval | ATT-07 (Should) | Route map works from seeded points; the interval setting is not built. |
| O-3 | "Log Visit" action on lead, opportunity and service ticket records | ATT-05 | The deep link exists (`/field-visits?mode=checkin&log=1&link=…`); the record buttons are not added. |
| O-4 | Real file-upload field type (expense bill, PO, POD) | COM-04 | Uploads are simulated as file names (REQUIREMENTS FR-132 Partial). |
| O-5 | Documents on leads, carried to the opportunity | LEAD-10 ("documents") | Leads have no Documents tab yet. |

## 4. BRD gaps and the assumption the app makes

| Area | Gap | Assumption in the prototype |
|---|---|---|
| Customers | When does a Prospect become an Active Customer? | On approval of its first sales order (automatic, audited). |
| Customers | Sites have no owner | All sales roles can read sites (engineers need every site for routing). |
| Customers | Ownership transfer across divisions | Allowed; suggested warning when the new owner works in another division. |
| Leads | Profiling Manager scope | Reads all opportunities (scope rules cannot express "only with sample requests"). |
| Leads | Expected close date in the past on create | Accepted. |
| Leads | Field check-in on a lead | Uses the visit's own next-action date instead of the lead's next follow-up. |
| Quotations | Quotation date can be backdated (older price list) | Allowed. |
| Quotations | PO date before quotation date | Allowed. |
| Orders | SO-03 "customise price" vs QUO-05 "sales cannot edit list price" | QUO-05 wins: quantity, discount and products can change, list price cannot. |
| Orders | Tolerance baseline after a re-approval | Compared with the quotation, not the last approved version. |
| Service | Resolve without customer sign-off | Sign-off required only for site visits. |
| Service | Customer Portal identification | By registered mobile or serial (minimal portal, Q-23). |
| Installed base | Engineer visibility | Whole division's installed base, not only assigned machines. |
| Spares | Partial issue (1 of 4) | Closes the requisition; no back-order. |
| Spares | Coordinator and Engineer Stock | Coordinators have no Engineer Stock page. |
| Spares | System Administrator approving requisitions | Not allowed (Service Leadership approves). |
| Field | Manual conveyance km above the tracked route | Accepted without justification. |
| Field | Scorecard counting | A demo with a logged demo activity can count twice; service visits are not counted for engineers. |
| Field | Cancelling an approved leave after its dates | Allowed; those days then show "No Check-in". |
| Targets | Order value basis for achievement | Net of discount, before GST and freight. |
| Reports | SLA compliance % denominator | Resolved tickets; open tickets past SLA are shown separately. |
| Reports | Order backlog | Includes delivered orders not yet installed. |
| Shell | Role switcher | Skips the OTP (demo convenience; sign-in itself asks for it). |
| Shell | Demo Settings | Open to every role (prototype controls). |

## 5. Verification after all fixes

- `npx tsc -b --noEmit` — clean.
- `npm run lint` — clean.
- `npx vitest run` — 36 files, **334 passed**, 1 skipped by design (was 172 before the stress test).
- `E2E_STRICT=1 npx vitest run src/test/e2e.lifecycle.test.ts` — 21/21, zero carry-forward gaps.
- `npm run build` — passes.
- Browser (production build): every sidebar page as System Administrator (102), every old URL redirects (42), and every sidebar entry for 11 roles (Sales Executive, Sales Manager, Division Head, Coordinator, Service Engineer, Store In-charge, Accounts, Import / SCM, Profiling Manager, Service Head, Management) — see §6.

## 6. Role sweep

ROLE_SWEEP_PLACEHOLDER

---

## Appendix — detailed findings per area

Each appendix is the QA pass's own findings table (page / action, BRD ref, expected, found, severity, status). "Needs other owner" rows were resolved afterwards by the shared-file owner unless listed in §3.


### Appendix: QA — BRD 4.1 Customer & Contact Master (Customers & Contacts)

Method: service-level vitest probes (rules, validation, scope) and a headless-Chrome CDP walk-through. The browser tests ran against a frozen `vite build` snapshot served by `vite preview` on port 5211. The dev server kept doing full reloads while other agents edited shared files, so a snapshot was the only stable target.
Roles exercised: System Administrator (Rahul), Management (Vikram), Division head (Neha, Ink), Sales manager (Rohan), Sales executive (Karan), Service engineer (Ravi), Store in-charge (Prakash), Accounts (Swati).
Widths: 1440 and 390 px.

#### Findings

| # | Page / action | BRD ref | Expected (BRD) | Found | Severity | Status |
|---|---|---|---|---|---|---|
| 1 | Naming (list, 360, form, toasts, messages) | CUS-01, CUS-07, C-02 | Master record = Company / Companies; detail page title "Customer 360° View" | List "Companies" at /companies (/customers redirects), "New Company", 360 title "Customer 360° View · C-…". About 25 messages still said "customer" for the master record (GSTIN taken, own parent/dealer, merge, transfer, pool, convert toast, 360 empty states) | Wording | Fixed (labels.ts `customers` section) |
| 2 | New / Edit Company: whitespace-only name | CUS-01 | Name required | "   " was saved as a company name (also contact name, site label / address / city) | Major | Fixed (service hook trims and rejects). Client-side `isEmpty` does not trim; see Needs other owner |
| 3 | Edit a key account whose plan review is overdue | CUS-11 | Account stays editable; overdue review is flagged | Any edit to C-1007 (seed key account, review 15-10-2026) failed: "Date cannot be in the past" on Next plan review | Major | Fixed (`dateRule: 'future'` removed; the hook checks the date only when it changes). Verified in the UI |
| 4 | Dealer / distributor link | CUS-08 | Links to a Dealer or Distributor | Service accepted any company as dealer (only the form filtered the list) | Minor | Fixed |
| 5 | Sites: Sales executive edits or adds a site of another person's company | §2.2 (Sales exec CEV Own) | No edits outside scope | Karan could rename ADR-1002 (C-1002) and add sites or contacts to companies he cannot see | Major | Fixed (site and contact hooks require the parent company to be in the actor's read scope) |
| 6 | Sites list read scope | §2.2 | Sales exec Own; Engineer "assigned sites" | All roles with access see all 97 sites (sites have no owner field) | Minor | BRD gap / deviation. Engineers need all sites for routing; sales read is left open |
| 7 | Merge where one company is the other's group parent | CUS-06, CUS-08 | No broken links | Survivor ended up as its own parent (self-reference) | Major | Fixed. ERP read-only figures are no longer copied either |
| 8 | Merge (admin) happy path + audit | CUS-06 | Re-point, recycle bin, audit | C-1009 merged into C-1057: 72 linked records moved; audit entry written; list refreshed | — | Pass |
| 9 | Duplicate GSTIN on create | CUS-06, BR-01 | Blocking, link to existing | Blocked: "This GSTIN already belongs to C-1006 …". Message names the ID but is not a clickable link | Minor | Pass (link: Needs other owner, form errors are plain text) |
| 10 | Fuzzy name on create | CUS-06, BR-01 | Non-blocking warning at creation | No warning before save; warning banner only on the 360 page after save | Minor | Needs other owner (shared RecordForm has no warning hook) |
| 11 | Convert to Lead: inline company with a near-duplicate name | CUS-05/06, BR-04 | Duplicate check at creation | No check; an exact-name duplicate company was created | Major | Fixed: dialog shows "Possible duplicate — Looks like … (97 %)" with links (non-blocking) |
| 12 | Convert to Lead: pre-fill (coordinator item D10) | BR-04, §3.1 | Lead pre-filled without re-entry | Territory and state not pre-filled from the contact's city | Major | Fixed: dialog and service pre-fill territory / hub + billing state from the city (aliases Delhi/New Delhi/Noida→Delhi NCR, Bangalore→Bengaluru …); the lead's state follows the company. UI shows "Jaipur / Rajasthan" |
| 13 | Convert to Lead validation / double-click / hand-off | CUS-05, BR-04, BR-06 | Required fields, no past date, one lead | Errors for company, territory and state; past follow-up rejected; triple click → 1 company + 1 lead (LD-…, contact, source, owner, division, follow-up carried over); contact → "Converted to Lead" | — | Pass. A ref guard against double submit was added |
| 14 | Import Contacts: double-click Import | CUS-05 | One import | A second run toasted "Imported 0 contacts, skipped 5" (no duplicate rows were created) | Minor | Fixed (ref guard) |
| 15 | Import: duplicate email in the same file | CUS-06 | Duplicates flagged at import | Only mobile was checked within the file | Minor | Fixed ("Same email as line n") |
| 16 | Import: over-long values | CUS-05 | Row validation matches the form | 200-char name showed "Ready", then failed with a generic "Please fix the highlighted fields." | Minor | Fixed (length checks per column; the skip reason now shows the real field error) |
| 17 | Import: company outside the importer's scope | §2.2 | No cross-scope link | A sales exec's row matched by company name was linked to someone else's company | Minor | Fixed (goes to the Contact Pool instead) |
| 18 | Import: phone book, visiting card, CSV upload, bad header, ?add=card | CUS-05 | Simulated sources + validation | Works; bad mobile, missing name, unknown source and existing contacts are flagged; missing columns give a clear error | — | Pass (phone book / OCR Simulated; .xlsx not parsed, CSV only) |
| 19 | Contact Pool: search, filters, sort, pagination, empty, delete with confirm, Esc | CUS-05 | List standards | All work; delete confirm → toast, count 25→24 | — | Pass |
| 20 | 360 "At a glance" open counts / Key Account Plan open opportunities | CUS-07, CUS-11 | Counts by status | Counted by display label (breaks if labels change); "Customer Confirmation" tickets counted as open | Minor | Fixed (counts by status key) |
| 21 | 360 Contacts / Sites tab badges | §2.2 | Show only visible records | Badges counted every record, including ones out of scope | Minor | Fixed (scoped count) |
| 22 | 360 every tab (17) for C-1007 | CUS-07, 09, 11 | All present, BRD order | All 17 tabs in GLOSSARY order with loading / empty / error states, ERP block, payment schedule, feedback ★, plan overdue alert | — | Pass. A generic "Details" tab opens first, before Overview (Needs other owner) |
| 23 | Ownership transfer | CUS-10, BR-52 | Preview, reason ≥5, confirm, history, closed records kept | Karan → Sneha: 55 records, toast, preview resets to 0, audit + history | — | Pass |
| 24 | Transfer to someone outside the records' division | CUS-10 | — | Allowed (TX leads went to an Ink exec, which conflicts with the "lead owner works in the lead's division" rule) | Minor | BRD gap: no division check; suggest a warning |
| 25 | Roles: Store (no access), Engineer / Accounts / Management (view only, New disabled), Sales exec / manager / Div head scoped lists, direct URL to an out-of-scope company → "Record unavailable", Duplicate & Merge admin-only, Transfer admin / mgmt / div-head | §2.2 | — | As expected | — | Pass |
| 26 | Full-page New / Edit Company buttons and toast | CUS-01 | — | Only button is "Save Draft"; toast says "C-1058 saved as draft" — companies have no drafts | Wording | Needs other owner (src/pages/WorkPages.tsx) |
| 27 | Record page at 390 px (Customer 360° View, and every record page) | NFR responsive | Tabs usable on phone | Main column is 2 px wide; only the side cards are visible, so the 360 tabs cannot be reached | Major | Needs other owner (src/styles/app.css) |
| 28 | Company stays Prospect after its first confirmed order (coordinator item G2) | CUS-04 | — | Not automated | Minor | BRD gap; exact edit for the orders owner below. Assumption until then: category is changed by hand |
| 29 | Other 390 px pages: Companies, Contact Pool, Import, Duplicates, Transfer, Sites | NFR | No horizontal page scroll | No page scroll; tables scroll inside their container | — | Pass |
| 30 | Console | — | No errors | 0 console errors / exceptions across all runs | — | Pass |

#### Totals
- About 95 checks (service probes + browser steps across 8 roles).
- 22 defects found: 17 fixed, 5 need another owner (#9 link, #10, #22 default tab, #26, #27). Plus 3 BRD gaps / deviations (#6, #24, #28).
- Rule, validation and permission edge cases that passed: bad / lower-case GSTIN and PAN, PAN not inside the GSTIN, GSTIN state ≠ billing state, website format, pincode, lat/lng range and pair, mobile and email formats, case-insensitive email duplicate, ERP fields read-only, ERP refresh allowed for Accounts and denied out of scope, transfer to an inactive user, whitespace reason, transfer and merge denied for sales exec, Convert denied for Store.

#### Tests added (src/test/customers.test.ts, 12 → 21, all pass)
- whitespace names
- overdue key-account edit vs a new past review date
- dealer category rule
- sales exec site / contact scope
- merge self-reference + audit
- import email duplicates and length checks
- out-of-scope import goes to the pool
- open counts by key + scoped badge counts
- Convert to Lead city → territory / state pre-fill

#### Files changed (all owned)
- src/domain/extensions/customers.tsx — trim / required checks, dealer rule, plan-review rule, company-scope checks for sites and contacts
- src/domain/modules/customers.ts — planNextReview no longer `dateRule: 'future'`
- src/services/customers/operations.ts — merge self-reference + read-only fields; `territoryForCity`, Convert pre-fill
- src/services/customers/importContacts.ts — email duplicates in the file, length checks, scope-safe company link, real skip reason
- src/services/customers/view360.ts — `statusKey`, closed-status constants, `countLinked`, `openOpportunities`
- src/services/api/customers.ts — re-exports
- src/modules/customers/components.tsx — Convert dialog: fuzzy duplicate warning, city pre-fill, double-submit guard
- src/modules/customers/customer360.tsx — scoped badges, plan open opportunities by key
- src/modules/customers/pages.tsx — import double-submit guard
- src/constants/labels.ts (`const customers` only) — Company wording, new messages
- src/test/customers.test.ts — the new tests above

#### Exact edits needed in files I don't own
1. **src/styles/app.css ~line 7037 (Major, #27).** The later un-scoped rule `.record-page-layout { grid-template-columns: minmax(0, 1fr) 360px; … }` overrides the earlier `@media (max-width: 1100px)` single-column rule. Add right after it:
   `@media (max-width: 1100px) { .record-page-layout { grid-template-columns: minmax(0, 1fr); } }`
2. **src/pages/WorkPages.tsx `FullPageForm` (#26).** When `!form.res.lifecycle`:
   - label the button `L.common.actions.save` (or "Create <Label>" on new) with `variant="primary"`;
   - toast `savedDraft` only for lifecycle resources (use a plain "saved" toast otherwise).
3. **src/services/validation.ts `isEmpty` (#2, client side).** Treat whitespace-only strings as empty: `|| (typeof v === 'string' && v.trim() === '')`.
4. **Shared record page (#22).** Allow a resource to choose its default tab (e.g. `RecordTab.default`), so the Customer 360° View opens on Overview.
5. **Shared RecordForm (#10, #9).** Add a pre-save "warnings" hook (e.g. `registerFormWarnings('customers', (values) => fuzzyCustomerMatches(...))`) and allow a field error to carry a link to the existing record.
6. **Orders owner (G2, #28).** In the salesOrders hook where the status becomes `confirmed` (afterUpdate / transition):
   `const c = recordsIn(ctx,'customers').find(x => x.id === so.customerId); if (c?.category === 'prospect') patchRecordIn(ctx, 'customers', c.id, { category: 'active' }, 'Became Active Customer on first confirmed order ' + so.id);`
   I did not register a salesOrders hook from customers.tsx, because `registerResourceHooks` would replace the orders module's own hooks.
7. **docs/REQUIREMENTS.md (traceability).**
   - FR-001: add "whitespace-trimmed"
   - FR-005: "Convert pre-fills territory/state from city"
   - FR-006: "fuzzy warning also on Convert inline company; email duplicates within import file"
   - §2.2 deviations: "Sites: read All for sales roles (no owner field); create/edit limited to companies in the user's scope"

### Appendix: QA — BRD 4.2 Lead Management & 4.3 Opportunity & Pipeline

Method: service-level probes (vitest, `src/test/leads.qa.test.ts`, `src/test/opportunities.qa.test.ts`) and a headless-Chrome sweep (dev server :5212, CDP :9412, `scratchpad/qa/sales-run`) as System Administrator (Rahul), Management (Vikram), Sales Manager (Rohan), Sales Executive (Karan) and Store In-charge (Prakash, no access). Pages were checked at 1440 px and 390 px. Other agents' edits caused HMR reloads during the runs, so each step signs in again and failed captures were re-run.

#### Findings

| # | Page / action | BRD ref | Expected (BRD) | Found | Severity | Status |
|---|---|---|---|---|---|---|
| 1 | Lead record → "Mark Contacted" (lifecycle transition and board drag) | App. A / REQ §4.2 | New → Contacted only when the first activity is logged; this stops the first-contact SLA | A manual "Mark Contacted" transition set `firstContactAt` with no logged contact, so the SLA could be stopped without contacting anyone | Major | Fixed (transition removed; Log Follow-up does it) |
| 2 | Lead → Reactivate from Disqualified (manager) | LEAD-11, Q-07 | Manager can reactivate | Always failed with "Set a next follow-up date…" because disqualifying clears `nextFollowUpAt` | Major | Fixed (reactivation plans the next follow-up for tomorrow, as BR-07 does by default) |
| 3 | Lead → Reactivate from Nurture after the re-contact date | LEAD-11 | Nurture → Contacted on or after `nurtureUntil` | Failed once `nurtureUntil` was past, because the follow-up date was now in the past | Major | Fixed (same as #2) |
| 4 | Convert to Opportunity → data carried | LEAD-10, §3.1 | The opportunity carries all the lead's data and history | Product type and customer requirement were not copied. The opportunity timeline did not show the lead's activities | Major | Fixed (`productType`, `notes`=requirement copied; Activity History tab now lists the lead's activities, tagged "Lead LD-…") |
| 5 | Convert to Opportunity → new opportunity | BR-12 | A new opportunity is not stagnant | `lastActivityAt` was copied from the lead's last activity, so a just-converted opportunity showed a "Stagnation alert" right away | Major | Fixed (conversion stamps `lastActivityAt` = now) |
| 6 | Log Follow-up service (API) on an open lead | LEAD-09, BR-07 | Next follow-up date is mandatory and ≥ today on every update | Only the dialog enforced it. `logActivity` accepted a missing or past date | Major | Fixed (activities `beforeCreate` hook in leads extension; field check-in 'visit' activities may omit it — see gap G4) |
| 7 | New Lead with inline company/contact, lead invalid (e.g. Exhibition without event name) | LEAD-01 | Nothing is saved when the lead fails | The service created the company/contact, then the lead failed, which left an orphan company. The UI pre-validates, so this only affects the API | Minor | Fixed (service pre-validates the lead before creating the company/contact) |
| 8 | Import Leads → import | LEAD-05 | Invalid rows are skipped | The service trusted the page's preview errors. A tampered row failed the whole commit | Minor | Fixed (service re-runs `previewImport`) |
| 9 | Opportunity / Sample request create with whitespace-only name / title / artwork; lead event name of spaces | OPP-01, OPP-04, BR-06 | Required text cannot be blank | Accepted, because the shared `isEmpty` does not trim | Minor | Fixed locally (my hooks trim text); shared fix below |
| 10 | Book a demo on a demo machine under maintenance (API) | OPP-04 | Only active machines can be booked | The picker filters machines, but the service accepted any machine | Minor | Fixed (`demoGuard` rejects inactive machines when a booking is created or moved) |
| 11 | Log Follow-up dialog title (lead, opportunity, Follow-ups, Not Attended) | GLOSSARY §5 | "Log Follow-up" | The dialog was titled "Log Activity" | Wording | Fixed |
| 12 | Not Attended Leads — no-access text | Wording | "No access to leads" | "No access to Leads" | Wording | Fixed |
| 13 | Not Attended Leads — Lead ID column | Layout | ID on one line | The ID wrapped onto three lines | Minor | Fixed (`nowrap`) |
| 14 | Follow-ups list | CLAUDE.md lists | Pagination | No pagination (admin: 48 rows in Next 7 Days) | Minor | Fixed (Pipeline `Pager` reused: 25/50/100, "x–y of n follow-ups") |
| 15 | Pipeline Kanban drag Needs Assessment → Proposal | OPP-02/03 | Moves, probability 50 % | Moves; toast shown | — | Pass |
| 16 | Kanban drag → Negotiation without quotation; → Won from Needs Assessment | OPP-02, OPP-05 | Blocked with a reason | "Negotiation needs a quotation…" / "not an allowed step" | — | Pass |
| 17 | Mark Won without accepted quotation; terminal Won/Lost; reopen | OPP-05, REQ §4.2 | Blocked; reopen is Admin only | Blocked; Sales Manager reopen refused; Admin reopen clears lost fields | — | Pass |
| 18 | Mark Lost dialog | OPP-05 | Reason + competitor required, price optional ≥ 0 | Empty submit shows both errors; negative price, whitespace competitor, stale version (double submit), out-of-scope and Management are all refused; Esc closes | — | Pass |
| 19 | Won → Generate Sales Order | OPP-05, §3.1 | Enabled, prefilled | All 17 seeded Won opps have an accepted quotation and link to `/sales-orders/new?quotation=…`. The button is disabled with a reason otherwise | — | Pass |
| 20 | Disqualify | LEAD-11 | Reason from master required; "Other" needs a note | Empty submit shows "Required"; "Other" with blank note refused | — | Pass |
| 21 | Nurture | LEAD-11 | Future re-contact date | Today/past refused; nurture only from New/Contacted; qualify from Nurture refused | — | Pass |
| 22 | Convert (BANT) validation + double submit | LEAD-10 | All BANT + opp fields required; one opportunity per lead | 7 field errors; stale version refused; one opp per lead | — | Pass |
| 23 | Auto-assignment, owner division, exec reassign | LEAD-07, BR-09 | Round-robin; owner must be in division; exec cannot reassign; manager can | As expected ("You cannot change: Lead owner", "does not work in …") | — | Pass |
| 24 | Scope via list / direct URL | §2.2 | Exec Own, Manager Team, Store none | Karan sees 13 leads/12 opps (own); another owner's lead/opp URL → "Record unavailable"; Rohan sees team; Prakash gets "No access…" on all 17 pages | — | Pass |
| 25 | Not Attended Leads | LEAD-08, BR-08 | Leads past the SLA, escalated to the manager | 12 rows (admin), escalated-to manager, SLA age, sweep is idempotent | — | Pass |
| 26 | Stagnation | OPP-06, BR-12 | Alert when idle N days or past close; notify owner + manager once/day | As expected (banner, list flag, sweep idempotent) | — | Pass |
| 27 | Demos: duration 30–480, results needed for Done, double booking, cancel frees slot, site demo with no machine | OPP-04 | — | All enforced | — | Pass |
| 28 | Sample print request: artwork required, due date not in past, results needed to share | OPP-04 | — | Enforced; customer copied from the opportunity | — | Pass |
| 29 | Sales Forecast weighted/commit by owner/division/product, monthly/quarterly | OPP-07 | — | Totals verified; renders at 390 px | — | Pass |
| 30 | All 17 area routes × 4 roles, 1440 + 390 px | NFR | No console errors, no horizontal scroll | 0 console problems, no h-scroll | — | Pass |
| 31 | Profiling role sees opportunities | §2.2 | "V opps with samples" | Profiling reads **all** opportunities (row scope cannot express "with a sample request") | Minor | BRD gap / engine limitation |
| 32 | Opportunity expected close date in the past at create | OPP-01 | BRD silent | Accepted; the opportunity is flagged stagnant at once | — | BRD gap |
| 33 | Qualified (read-only) lead still shows Edit buttons | LEAD-10 | Read-only | Edit opens, then the service refuses ("read-only") | Minor | Needs other owner (record page) |
| 34 | Lead record Details shows spec fields for other sub-types as "N/A" | LEAD-06 | Only the sub-type's fields | The detail view ignores `visibleWhen` (the form respects it) | Minor | Needs other owner (record detail component) |
| 35 | Kanban card shows the raw customer ID (e.g. "C-1023") when the exec can't read that customer | OPP-03 | Customer name | The title lookup is scope-filtered | Minor | Needs other owner (engine `recordTitle`) |
| 36 | Kanban success toast "OPP-…: Move to Proposal/Quotation" | Wording | "Moved OPP-… to Proposal/Quotation" | The toast repeats the action name | Wording | Needs other owner (BoardView) |
| 37 | Record action buttons truncated ("Move to Demo/S…", "Convert to Opportu…") | Layout | Readable labels | Truncated in the 2-column actions card | Minor | Needs other owner (RecordPage actions card) |

BRD gaps / assumptions:
- G1 #31: Profiling reads all opportunities.
- G2 #32: Past close dates are accepted on create.
- G3: Kanban → Won from Needs Assessment / Demo is blocked. REQ §4.2 only allows Won from Proposal or Negotiation.
- G4: A field check-in (`activityType: 'visit'`, created by the field module) may omit the next follow-up date. The visit has its own next-action date. A past date is still refused.

#### Totals
- Checks run: 37 rows above, backed by 22 new vitest probes plus about 120 page/role/width captures and interactive steps.
- Passed: 16 (#15–30).
- Defects found: 21 (#1–14 and #31–37). Fixed: 14 (#1–14).
- Not fixed: 7. Five need other owners (#33–37) and two are BRD gaps (#31, #32).
- `npx vitest run`: 318 / 320 pass. The one failure is `installed.qa.test.ts` (BR-26 handover), another agent's work in progress and not in this area. `tsc` and `eslint` are clean for my files.

#### Coverage (exercised)
- **Admin:** all 17 routes, plus lead and opportunity records.
- **Management:** all routes. Create is denied, opportunities are read-only, Mark Lost is refused.
- **Sales Manager:** all routes. Sees the team, can reassign, can reactivate, can view assignment rules.
- **Sales Executive:**
  - All routes; own scope; direct-URL scope.
  - Kanban drag (allowed and blocked).
  - Log Follow-up, Disqualify, Convert (end to end in the browser), Mark Lost dialogs; Esc closes each.
  - Conversion's opportunity Activity History.
- **Store In-charge:** "No access" on every page and on direct URLs.
- **Phone:** 390 px for Admin and Executive.

#### Tests added
- `src/test/leads.qa.test.ts` (13): BR-07 on the service, Log Follow-up linking, no manual Mark Contacted, reactivation (manager / exec denied / past nurture), disallowed transitions, conversion carry-over + no stagnation + double submit, BR-05/06 validation, no orphan company, LEAD-07 reassign rules, scope, import re-validation.
- `src/test/opportunities.qa.test.ts` (9): OPP-01 validation (whitespace, negative, probability), stage flow/terminal/reopen, Mark Lost edge cases, roles, demos (including maintenance machine), sample requests, stagnation sweep, Won → accepted quotation.

#### Files changed (all owned)
- `src/domain/modules/leads.ts` — removed the manual New → Contacted transition.
- `src/domain/extensions/leads.ts`
  - Text trimming.
  - Reactivation defaults the follow-up date.
  - Activities `beforeCreate` enforces BR-07.
- `src/services/leads/rules.ts`
  - Conversion copies product type and requirement and sets `lastActivityAt`.
  - Lead pre-validation before the inline party is created.
  - Import re-validates rows.
- `src/domain/extensions/opportunities.tsx`
  - Text trimming.
  - Inactive demo machine guard.
  - Timeline includes the lead's activities.
  - "Log Follow-up" dialog title.
- `src/modules/leads/LeadActions.tsx`, `NotAttendedLeadsPage.tsx`, `FollowUpsPage.tsx` — dialog title, wording, nowrap, pagination.
- `src/modules/opportunities/PipelinePage.tsx` — `Pager` exported with an optional `range` label.
- `src/constants/labels.ts` (sections `const leads` and `const opportunities` only)
  - `errors.followUpRequired` text.
  - `pages.followUps.range`.
  - `timeline.fromLead`.
  - `timeline.emptyBody`.
  - `messages.demoMachineUnavailable` / `demoMachineUnavailableField`.

#### Exact edits needed in files I don't own
1. `src/services/validation.ts` `isEmpty`: treat whitespace-only strings as empty, so required text can't be blanks anywhere:
   `return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);`
2. Record page / inspector (`src/components/resource/RecordInspector.tsx` or the record page):
   - Hide Edit when the record is in a lifecycle `terminal` state that the resource treats as read-only. Leads: `qualified`. Or let a resource declare `readOnlyStates`.
   - Apply `isVisible(field, record)` in the Details section, so the LEAD-06 spec fields for other sub-types are not shown.
3. `src/components/resource/BoardView.tsx` success toast: use the "Moved {id} to {stage}" wording instead of "{id}: {action}".
4. `src/services/runtime.ts` `recordTitle`: when the actor can't read the target, show the record's title field (name) rather than the raw ID. Or decide that hiding it is intended.
5. Record actions card: avoid truncating action labels (wrap or use a single column when a label is longer than about 16 characters).
6. `docs/REQUIREMENTS.md` FR-021 / FR-022 / FR-023 notes (owner of docs):
   - "next follow-up enforced on the service";
   - "conversion carries product type, requirement and the lead activity history";
   - "reactivation plans the next follow-up for tomorrow";
   - §4.2 Lead table: drop any reference to a manual "Mark Contacted".

### Appendix: QA report — BRD 4.4 Quotation Management (QUO-01 … QUO-14)

Method: vitest checks at the service level (`src/test/quotations*.test.ts`, 35 tests), plus a headless-Chrome run on port 5213 / CDP 9413 at 1440 px and 390 px. Roles used: System Administrator, Sales Executive (Karan, TX), Sales Manager (Rohan), Division Head (Suresh/Neha/Kavita), Management (Vikram), Accounts (Swati), Service Head (Manoj/Sanjay), Service Engineer (Ravi), Store (Prakash), and a Sales Executive from another division (Sneha).

#### Findings

| # | Page / action | BRD ref | Expected (BRD) | Found | Severity | Status |
|---|---|---|---|---|---|---|
| 1 | Pending Approvals / Approve (level 1) | QUO-06, REQ §2.2 | Only the Sales Manager decides level 1 (Service leadership has no "A" on quotations) | Service Head and National Service Manager hold `approve.l1` (for service approvals), so they could approve sales discounts at the "Sales Manager" level. In FAB, INK and PPR they were the **only** people who could decide level 1 | Blocker | Fixed: level 1 is now a named approver (the owner's reporting Sales Manager). A level that nobody can decide moves up to the next level. `canDecideQuote` also checks the role |
| 2 | Pending Approvals / separation of duties | QUO-06 | The requester never decides, and each level has a valid approver | The seeded requests from Priya (POD Sales Manager) could only be decided by Service Heads | Major | Fixed: the seed uses the same resolver (seed rev bumped to 6). A manager who submits for their own team goes to the Division Head, and a Division Head who submits goes to MD |
| 3 | Editor › Save & Submit (double click) | Robustness | One quotation | A double click created **two** quotations (QT/TX/…/0018 and 0019) | Major | Fixed: a synchronous in-flight guard in the editor, the action dialogs, Create Version and the Decide dialog |
| 4 | Editor › save OK, then submit fails, then retry | Robustness | No duplicate | The retry created a second new quotation, because the editor still treated the draft as new | Major | Fixed: the saved id and version are kept, so later saves update that draft |
| 5 | Create quotation on someone else's opportunity by id | Scope §2.2 | Own scope only | Sneha (INK executive) could create a quotation on Karan's TX opportunity through the API | Major | Fixed: an opportunity outside the user's scope is treated as not found |
| 6 | Sales users entering list prices | QUO-05, BR-15 | Sales users cannot set list prices (only Admin and Division Head) | Custom lines, and products without a valid price list, took any typed price from any role | Major | Fixed: the service rejects a price above zero on an unlisted line unless the user maintains price lists. Lines carried unchanged from an earlier version are still allowed. The editor shows the price as read-only with an info tip |
| 7 | CGST/SGST split | QUO-04, BR-16 | CGST = SGST = taxable × rate/2 | Odd paise were split unevenly (e.g. 9.01 / 9.00) | Minor | Fixed: tax is worked in whole paise, so the two halves are always equal |
| 8 | Rounding on half-paisa values | QUO-04 | Round half up | Binary floating point gave 10.05 × 50 % = 5.02 | Minor | Fixed: `r2` uses `toPrecision(12)` |
| 9 | Discount bands with a ₹ amount | BR-17 | Anything above 5 % needs level 1 | An amount discount of 5.004 % rounded down to 5 % and was approved automatically | Minor | Fixed: the effective % rounds up to 0.01 % (shown values can read up to 0.01 % high) |
| 10 | Editor › discount unit % → ₹ | QUO-04 | Switching to amount works | With a 0 discount the unit stayed on %, so a typed amount was read as a percentage | Major | Fixed: `discountType` is kept on the line |
| 11 | Totals / tax summary for inter-state at ₹0 tax | QUO-04 | IGST rows for inter-state | CGST/SGST rows showed because the code checked `igst > 0` | Minor | Fixed: `interState` flag in TotalsBlock and TaxSummary (editor, Pricing & GST tab, PDF) |
| 12 | Compare Versions `?with=<other quotation>` | QUO-09 | Only versions of the same quotation | Any quotation id was compared | Minor | Fixed: falls back to the previous version |
| 13 | Editor of an Accepted/Rejected quotation | Wording | Correct reason | Said "create a version to change it", but a version is not allowed for these statuses. A draft opened by a read-only role said "Only drafts can be edited" | Wording | Fixed: new final-outcome message, and the read-only role message |
| 14 | Editor opportunity option label | Wording | Clean label | "FabriJet … — Laxmi Fab Processors · Laxmi Fab Processors" (customer name twice) | Wording | Fixed |
| 15 | Generic "Edit" button on non-draft quotations (record header) | QUO-10 | Disabled with a reason | Enabled; it leads to the editor's "cannot be edited" page (clear, but one extra click) | Minor | Needs other owner (shared InspectorHeader has no per-record edit guard) |
| 16 | Mark Under Negotiation toast | Wording | Uses the quotation number | Shows "QT-2627-00079: Mark Under Negotiation" (record id) | Wording | Needs other owner (runtime/transition toast) |
| 17 | Admin delete of a quotation version | QUO-09 | Deleting must not leave a quotation with no latest version | No `beforeDelete` hook. Deleting R1 leaves R0 superseded with no latest version, and deleting R0 orphans R1's `rootId` | Major | Needs other owner (resourceHooks/runtime: add `beforeDelete`; then quotations should allow deleting drafts only, or restore `isLatest` on the previous version) |
| 18 | Quotation vs Sales Order totals | QUO-04 / SO-03 | Same totals | Orders compute GST per line; quotations compute it per rate group. `lookups.gstSplit` still splits CGST/SGST unevenly. Totals can differ by a few paise | Minor | Needs other owner (orders / lookups) |
| 19 | Generate Sales Order page | §3.1 hand-off | Customer name shown | Pre-fill works (customer, quotation, place of supply, lines), but "Customer C-1010" shows the id | Wording | Needs other owner (orders) |
| 20 | Backdating Quotation date | BR-15 | Price valid on the quotation date | A user can backdate the date to pick up an older price list | — | BRD gap (assumption: the date stays editable while in draft) |
| 21 | PO date before quotation date | QUO-11 | — | Allowed | — | BRD gap |
| — | Arithmetic: 0 %/100 %, amount = line value, 3 × 333.33 at 7.5 %, freight at the main-line rate, multiple rates, words incl. crore and 1000 crore and paise | QUO-04 | | Correct | | Pass |
| — | Number series per division and FY, consecutive; -R1/-R2 | QUO-01, BR-13 | | Correct | | Pass |
| — | Line validation (fractional/negative qty, negative price, >100 %, negative amount, blank HSN, whitespace description); no lines; validity before date; negative freight | QUO-02/04 | | Rejected | | Pass |
| — | Status walk Draft→Approved/Pending→Sent→Under Negotiation→Accepted/Rejected; send/accept blocked before Sent; reject needs a reason; terminal locked; old version locked (BR-18) | QUO-10 | | Correct | | Pass |
| — | Automatic Expired for draft, pending (request withdrawn), approved, sent, negotiation; simulated clock +60 d in the browser → 26/26 expired; Expired can be versioned | QUO-10, Q-09 | | Correct | | Pass |
| — | Reminder after 24 h goes only to the level holder (not the Service Head); Pull Back withdraws | QUO-06 | | Correct | | Pass |
| — | Approve/Reject on the Pending Approvals page; reject needs a comment of ≥ 5 characters; Esc closes; the list refreshes live | QUO-06 | | Correct | | Pass |
| — | 3-level chain (≥ 15 %) decided by Sales Manager → Division Head → MD, all different people | QUO-06 | | Correct | | Pass |
| — | Send by email/WhatsApp: format validation, consent, sent date logged, outbox | QUO-08 | | Correct | | Pass |
| — | Acceptance by PO (number, max 40, date not in future, file type and size) or electronic (name; blank rejected); opportunity → Won; Generate Sales Order pre-fills | QUO-11, §3.1 | | Correct | | Pass |
| — | Margin / landed cost visible to Admin, Management and Accounts only; hidden from Sales Executive, Sales Manager, Division Head and Service Head (record, lines and projection) | QUO-12 | | Correct | | Pass |
| — | Scope by direct id: other executive or division → not found; manager (team) and DH (division) can edit; Management and Accounts view only; Engineer and Store get no access (list and Pending Approvals show a No Access state) | §2.2 | | Correct | | Pass |
| — | ROI calculator, PDF (branding, HSN, watermark for draft), Compare, Terms & Conditions Templates list; 390 px: no horizontal page scroll; no console errors | QUO-08/09/13, QUO-07 | | Correct | | Pass |

#### Totals
- Checks run: about 75 (35 vitest tests plus about 40 browser steps). Passed: 54. Defects found: 21, of which 14 fixed, 5 need another owner and 2 are BRD gaps.

#### Coverage
- System Administrator: list (all views), side panel, record page, PDF, Compare, Pending Approvals, New Quotation, Terms & Conditions Templates, and the same pages at 390 px.
- Sales Executive: list scope, direct URL to another executive's quotation, editor (product pick, discount % and ₹, custom line, remove line with confirmation, reason validation, double-click submit), Send (invalid and valid), Mark Under Negotiation, Mark Accepted (PO validation, electronic), Generate Sales Order hand-off, edit an Accepted quotation, simulated-clock expiry.
- Sales Manager: Pending Approvals (Reject without comment, Esc, Approve as last level).
- Service Head: Pending Approvals shows nothing at their level.
- Service Engineer: no access to the list or Pending Approvals.
- Service tests also cover Division Head, Management, Accounts, Store and the cross-division executive.

#### Tests added
- `src/test/quotations.qa.test.ts` (20 tests): arithmetic and rounding, bands, approver resolution, workflow, roles and scope, expiry, reminders, margin visibility.

#### Files changed (all owned)
- `src/services/quotations/pricing.ts`: rounding, equal CGST/SGST, effective % rounds up, `discountType`.
- `src/services/quotations/approvalLevels.ts` (new): named level 1, escalation, role guard.
- `src/services/quotations/workflow.ts`: `quoteApprovalChain`, `canDecideQuote`, list-price rule, opportunity scope check, reminders, decide guard.
- `src/mocks/quotations.ts`: seed approvals resolved; `rev` set to 6.
- `src/modules/quotations/QuoteEditorPage.tsx`, `RecordExtensions.tsx`, `PendingApprovalsPage.tsx`, `CompareVersionsPage.tsx`, `LinesTable.tsx`, `QuotationPdfPage.tsx`.
- `src/constants/labels.ts` (`const quotations` only): `lineErrors.notOnPriceList`, `errors.notYourLevel`, `editor.priceNotListed`, `editor.cannotEditFinal`.

#### Edits needed in files I don't own
1. `src/services/resourceHooks.ts` + `src/services/runtime.ts` `deleteRecord`: add a `beforeDelete(ctx, record)` hook. Quotations will then refuse to delete non-draft or older versions (finding 17).
2. `src/services/lookups.ts` `gstSplit`: compute `paise = Math.round(taxable*100)`, then `cgst = sgst = Math.round(paise*rate/200)/100` and `igst = Math.round(paise*rate/100)/100`. Also consider taxing by rate group in `services/orders/lines.ts` so SO totals match the quotation (finding 18).
3. Shared record header (`RecordInspector` InspectorHeader): a way for a module to disable Edit with a reason, so quotations can disable it when the status is not Draft (finding 15).
4. Transition toast: use the resource `title` hook (quote number) instead of the record id (finding 16).
5. Orders `NewOrderPage`: show the customer name, not the id (finding 19).
6. docs/REQUIREMENTS.md: under FR-040, note "Level 1 = owner's reporting Sales Manager (named); levels with no eligible approver escalate". Under FR-039, note "unlisted items can be priced only by roles that maintain price lists".
7. Shared `canDecide` (`services/workflow.ts`): the Notifications › Approvals tab uses it directly. New quotation approvals are safe because level 1 is named. If the admin adds a custom capability level, consider a per-type `canDecide` hook in `registerApprovalType`.

### Appendix: QA report: BRD 4.5 Sales Order & Sales Contract + 4.6 Dispatch / Delivery (SO-01…SO-11, INS-01, INS-02)

Method: service-level vitest (new `src/test/orders.qa.test.ts`, 25 tests, plus the existing `orders.test.ts`, 13 tests) and a headless-Chrome CDP run on :5214 (admin, Sales Executive Karan, Import / SCM Rajesh, Service Engineer Ravi, Accounts Swati; 1440 px and 390 px). Screenshots and run logs are in `scratchpad/qa/orders-run/`.

#### Findings

| # | Page / action | BRD ref | Expected (BRD) | Found | Severity | Status |
|---|---|---|---|---|---|---|
| 1 | Confirm Delivery dialog + `confirmDelivery` | INS-02 | Delivery confirmation needs a photo **and** a signed proof of delivery | Photo was optional; seed had delivered dispatches without a photo | Major | Fixed: photo required (JPG/PNG, size limit), dialog marks it required, every seeded delivered dispatch has a photo |
| 2 | Sales order record as Import / SCM | §2.2 "E processing tab only", SO-08 | SCM edits Order Processing only | SCM could Edit Lines, request Hold / Cancel / Resume, re-submit and edit the Payment Schedule. Its update scope is `all` and that was the only check | Major | Fixed: new `canEditCommercial` (create permission + update scope) used by the service guards, `orderView.canEdit` and OrderActions |
| 3 | Sales contract version | SO-05 "versioned" | v1, v2 … with history | The contract's `version` field collided with the record's optimistic-lock `version`: every new contract was v1 and the number went up on each save | Major | Fixed: field renamed to `contractVersion` (resource, labels, service, tabs, PDF, seed) |
| 4 | Record Dispatch | INS-01, REQUIREMENTS §4.2 guard "date, transporter, LR, e-way bill" | E-way bill on the dispatch | Dispatch could be saved with no e-way bill. Dispatch date could be before the order date | Major | Fixed: e-way bill required (typed, or the one returned by the ERP), dispatch date ≥ order date, max lengths |
| 5 | Confirm Delivery scope | §2.2 | Coordinator works only in their division | A coordinator could confirm the delivery of a dispatch from another division if they knew its id | Major | Fixed: order scope checked |
| 6 | Generate Sales Order totals | SO-01 (pre-filled from the quotation) | Order matches its quotation exactly | Off by a few paise (GST per line vs per rate) | Minor | Fixed: order and seed maths now use `quotations/pricing.computeTotals` (test: every accepted quotation matches to the paisa) |
| 7 | Generate Sales Order PO | SO-02, §3 "without re-entry" | PO captured at acceptance carries forward | PO number, date and file were blank again on the order form | Major | Fixed: `OrderDraft.po` is filled from the quotation, and the form starts from it |
| 8 | Generate Sales Order / Payment Schedule / Order Processing customer | wording | Company name | "C-1010" was shown when the user owns the order but not the customer record | Minor | Fixed: `customerNameOf` used on these pages |
| 9 | Machine order without a site | INS-05 / data model `siteAddressId*` | Installation job needs a site | Machine orders could be saved without an installation site | Major | Fixed: site required for machine orders ("Add an installation address to the customer first" if the customer has none) |
| 10 | Installation job notifications | §3.1 row 5 | One notification per planner | Coordinators were notified twice (once from orders, once from the installed hook) | Minor | Fixed: the orders-side notification is removed |
| 11 | Double submit / retry of Generate Sales Order | Brief §6 | The same idempotency key returns the same order | The second call threw "already exists" (blocker check ran before the idempotency check) | Minor | Fixed |
| 12 | Cancel approved while Hold / Resume pending | SO-10 | Stale requests closed | The Hold / Resume request stayed pending on a cancelled order | Minor | Fixed: withdrawn on cancel |
| 13 | Order approved while on Hold | SO-04/10 | Approval not lost | The order resumed to Pending Approval with no open approval | Minor | Fixed: on resume it goes to the approved status |
| 14 | Resume after an advance was received during Hold | SO-07 | Status reflects the receipt | The order went back to Payment Pending | Minor | Fixed |
| 15 | Demo seed | Appendix A | Every sales order status can be demoed | No Ready for Dispatch, Hold, Payment Pending or Payment Received orders | Minor | Fixed: four recent consumables orders are set to those statuses after all random draws (later modules' seeds unchanged). Orders `rev` → 5 |
| 16 | Prospect → Active Customer | BRD gap G2 (coordinator) | Category changes on first approved order | Not implemented | — | Done in `onOrderApproved`, with a test |
| 17 | "Start Installation" / "Complete Order" on Delivered | App. A | Only the step valid for the order type | Admin sees both on every delivered order. The wrong one is blocked with a clear message | Minor | Needs other owner (engine: see below) |
| 18 | Disabled transition reason | wording | Plain words | `E.requiresPermission(t.capability)` shows a raw capability key | Wording | Needs other owner (runtime.ts) |
| 19 | SO-03 price customisation | SO-03 vs QUO-05 | SO-03 lists price as customisable | Order lines keep the quotation's / price list's price; only quantity, discount and products can change | — | BRD gap: assumes QUO-05 (sales users can't edit list price) wins |
| 20 | Re-approval baseline | SO-03 / BR-22 | Tolerance compared with the quotation | After one re-approval, every later edit is still compared with the quotation, not the last approved version | — | BRD gap: kept as is |
| 21 | Generate Sales Order, happy path (admin, browser) | SO-01/02/04 | Pre-filled; auto number SO/DIV/FY/NNNN; approval to reporting manager | SO/TX/26-27/0007 created, banner "Level 1 of 1: Division Head — Suresh Iyer" | — | Pass |
| 22 | Validation (browser): PO blank / whitespace, file missing; dispatch blank / short e-way bill; POD / photo missing / photo.pdf; hold reason blank / "abc" | SO-02, INS-01/02, SO-10 | Field errors | All shown inline, with a toast | — | Pass |
| 23 | Scope by direct URL (Karan) | §2.2 | Foreign order, edit, PDF and dispatch not visible | "Record unavailable" / "not found or no access" every time. List shows 29 own orders | — | Pass |
| 24 | Engineer access | §2.2 | No access | No-access states on list, record, new, processing and payments | — | Pass |
| 25 | Accounts | §2.2 | View + Record Receipt + Push to ERP | Edit, Hold and Cancel disabled with "Read-only for Accounts" | — | Pass |
| 26 | Workflow guards | App. A / §4.2 | Processing needs the advance; Ready for Dispatch needs readiness + PDI; machines complete only on sign-off; consumables Delivered → Completed; Hold / Cancel only before dispatch; Cancelled is terminal | All enforced (tests) | — | Pass |
| 27 | Contract | SO-05/06 | Only after approval; all term sections; versions; OTP e-sign; signed locks | Pass (tests) | — | Pass |
| 28 | Payment schedule | SO-07 | Totals 100 %; due dates ≥ order date; milestones with receipts kept; receipt ≤ outstanding, not future, Accounts only; reminders idempotent | Pass | — | Pass |
| 29 | Machine delivered → installation job | §3.1 r5 / INS-05 | Job created once, pre-filled | INS-2627-00004 created for SO-2627-00004 (browser), scheduled, with customer / site / product | — | Pass |
| 30 | 390 px | Brief | No horizontal scroll | All 11 pages: hscroll false | — | Pass |
| 31 | Esc closes dialogs; console | Brief | — | Esc closes; 0 console errors in every run | — | Pass |

Totals: about 95 checks run (38 + 25 vitest assertion groups, about 30 browser steps per role), 15 defects found, 15 fixed, 2 left for other owners, 2 BRD gaps noted.

#### Tests added
`src/test/orders.qa.test.ts` (25 tests): seed covers every status; SO-01/02 eligibility, pre-fill, exact totals, PO validation, carried PO, site required, idempotency, roles that cannot create, repeat only for consumables; SO-03 line validation, ignored price tampering, tolerance, version conflict; SO-04 approver and finance check; scope (engineer, profiling, own scope, SCM processing-only, Accounts / Management read-only, store cannot dispatch, coordinator outside division); the full status workflow; Hold / Resume / Cancel; contract versions and e-sign; schedule and receipts; reminders; dispatch and delivery validation; the installation hand-off with exactly one notification each; Prospect → Active. `orders.test.ts` updated for the new required fields and `contractVersion`.

#### Files changed
src/services/orders/orders.ts, src/services/orders/lines.ts, src/services/orders/contracts.ts, src/services/api/orders.ts, src/domain/modules/orders.ts, src/mocks/orders.ts (rev 5), src/modules/orders/{OrderActions,OrderTabs,NewOrderPage,PaymentSchedulePage,OrderProcessingPage,SalesContractPdfPage,components}.tsx, src/constants/labels.ts (`const orders` section only: new errors, `file.photoHint`, `notices.becameActive`, contract field `contractVersion`), src/test/orders.test.ts, src/test/orders.qa.test.ts.

#### Edits needed in files I don't own
1. **src/metadata/types.ts + src/services/runtime.ts (engine)**: add `when?: (record: RecordData) => boolean` to `Transition` and filter on it in `availableTransitions`. Orders would then set `when: (r) => r.orderKind === 'machine'` on delivered→installation and `r.orderKind !== 'machine'` on delivered→completed.
2. **src/services/runtime.ts `availableTransitions`**: `E.requiresPermission(t.capability)` shows a raw capability key. Use a role-based sentence instead, e.g. `E.roleCannotUpdate(actor.role.label)`.
3. **src/test/e2e.lifecycle.test.ts (E2E agent)**: step 7 now needs an installation site (fix D5). Before `so.createOrder`, add an installation address to the pool-converted customer, e.g. `insertRecord(admin, 'addresses', { customerId: q.customerId, addressType: 'installation', label: 'Plant', line1: '…', city: 'Surat', state: '24', pincode: '395003' })`, and pass `siteAddressId`. Also use `draft.po` for the PO fields. Until then E2E_STRICT fails at step 7 with "Please fix the highlighted fields" ({siteAddressId}).
4. **src/domain/extensions/opportunities.tsx (~l.133)**: "Generate Sales Order" still shows on a Won opportunity whose quotation already has an order. Link to the existing order instead, as the quotation page does.
5. **Customers / quotations seed**: sales executive Karan owns quotation and orders for C-1010 but cannot read that customer, so generic list cells show the id. Either align ownership or let order owners read the order's customer.

### Appendix: QA report — BRD 4.6 (INS-03…08), 4.7 Installed Base, Warranty & AMC, 4.8 Service Tickets

Dev server :5215, CDP :9415, screenshots/steps in scratchpad/qa/service-run.

#### Findings

| # | Page / action | BRD ref | Expected (BRD) | Found | Severity | Status |
|---|---|---|---|---|---|---|
| 1 | My Jobs › job › Check-out with "resolve" while Waiting for Parts | SRV-06, App. A | Resolve only from In Progress; no half-done state | Visit closed, then transition failed → ticket stuck in Waiting for Parts with an error, job card gone | Major | Fixed (pre-check before any write; resolve option disabled with reason unless In Progress) |
| 2 | Installation › Sales-to-Service Handover | INS-04, BR-26 | Sales owner fills the handover form issued on delivery | Sales Exec/Manager read-only on installations → nobody from Sales could fill it; owner never asked | Major | Fixed ("Fill Handover" dialog for SO owner + desk, validation, notification to SO owner on job creation) |
| 3 | Resolve a PM service ticket | SRV-11 | PM completion status follows the work | PM visit stayed Due → later Overdue/Missed; PM compliance wrong | Major | Fixed (resolving a PM ticket completes its PM visit) |
| 4 | Warranty nearing expiry with no AMC/CMC | §3.1 row 7, IB-05 | 90/60/30 reminders + renewal (AMC) opportunity | Nothing happened for warranties (E2E D2) | Major | Fixed (sweep: one reminder per threshold to account owner + service desk + customer, one AMC/CMC opportunity, tracked on the warranty) |
| 5 | Sign-off → PM schedule (12-month warranty, 2/yr) | INS-07, BR-28 | 2 visits | 1 visit (2nd landed a day after end) (E2E D6) | Major | Fixed (count from period length, last visit clamped to end) |
| 6 | Future-dated AMC | IB-04 | Becomes Active on start date | Stayed Draft forever (E2E D7) | Major | Fixed (sweep activates on start date + PM visits); renewal sweep now also runs on a 1-min timer, not only on the Renewals page |
| 7 | AMC › Mark Expired | App. A / REQ §4.2 | Expired is automatic after end date | Manual expiry allowed months early | Major | Fixed (blocked until end date passed, clear reason) |
| 8 | AMC › Renew | IB-05 | Renewal continues the contract | Renewal dated 2001 accepted → "Active" contract already over, PM visits in the past | Minor | Fixed (start after current start, end not in past) |
| 9 | Escalation sweep | SRV-09, BR-32 | Alert on breach, climb while breached | A response met 10 min late kept climbing to Service Head/GM/MD although nothing was overdue | Minor | Fixed (met-late clock alerts once; only still-overdue clocks climb) |
| 10 | Engineer Calendar & Map › Unassigned; saved view "Unassigned" | SRV-05 | Tickets with no engineer | Re-opened tickets that still have an engineer listed as unassigned (3 vs grid 1) | Minor | Fixed |
| 11 | Opportunity Spotted (API) | SRV-14 | One lead per spotted opportunity | Repeated call created duplicate leads | Minor | Fixed |
| 12 | PM Schedule › Complete | SRV-11 | Model-wise checklist answered | Service accepted empty results | Minor | Fixed |
| 13 | Check-in on a Closed / Customer Confirmation ticket | SRV-06 | Not possible | Allowed (visit created on closed ticket); check-in while Waiting for Parts did not resume work | Minor | Fixed |
| 14 | Offline toggle on My Jobs | SRV-06 | Works offline, syncs later | Only one step possible per offline session (screen did not advance; chained steps conflicted on replay) | Minor | Fixed (local-first: step applied on device, listed as pending, "n synced" on Go Online) |
| 15 | Feedback rating | SRV-12 | 1–5 | 3.5 accepted by service | Minor | Fixed |
| 16 | Installation scheduled at site without lat/lng | BR-02 | Blocked | Allowed (E2E D5) | Minor | Fixed (create/update with scheduledAt) |
| 17 | Serial numbers in lower case | IB-01 | Accept, store upper case | Rejected by pattern (E2E D9) | Minor | Fixed |
| 18 | Customer Portal machine picker | IB-03, SRV-02 | Warranty/AMC status shown | Not shown (E2E D8) | Minor | Fixed |
| 19 | Installation created already scheduled | INS-05 | Customer notified | Only on later edits | Minor | Fixed |
| 20 | `/service-tickets/new` (full-page form) | SRV-01, GLOSSARY C-07 | "Log Ticket"; no draft state for tickets | Title "New Service Ticket", buttons "Save Draft" / "Save & Issue"; Save & Issue tries transition `issued` → danger toast + success toast | Major | Needs other owner (src/pages/WorkPages.tsx) |
| 21 | Service Tickets › Log Ticket quick-create dialog | GLOSSARY C-07 | Title/submit "Log Ticket" | "New Service Ticket" / "Create" | Wording | Needs other owner (shared QuickCreateDialog) |
| 22 | Knowledge article draft by URL `/knowledge-articles/:id` | SRV-16 | Drafts visible to author + approvers only | List hides them, but direct URL/getRecord shows another engineer's draft | Minor | Needs other owner (read hook in authz/resourceHooks) |
| 23 | Engineer read scope on installed base | REQ §2.2 "V assigned machines" | assigned machines | Division (undocumented deviation) | Minor | BRD gap / note in REQUIREMENTS deviations |
| 24 | Desk "Resolve" without customer sign-off | App. A In Progress→Resolved | sign-off required | Desk can resolve (remote/phone fixes) without OTP/signature | — | BRD gap (assumption: sign-off only for site visits) |
| 25 | Customer Portal identify by mobile reveals machines | SRV-01 | — | Anyone with a registered mobile sees customer's machines | — | BRD gap (Q-23 minimal portal; OTP would be needed in real build) |
| Pass | Readiness gate (BR-27), handover gate, steps gate, sign-off blockers, duplicate serial, OTP/signature sign-off → machine+warranty+PM+training+SO completed (INS-07), resale/relocation (no future date, reason required), component replacement (no dup, no future), counter can't go down, AMC overlap / end<start / value ≤0, lost reason required, renewal 90/60/30 idempotent, repeat-complaint + root cause before close, re-open window 15 d, SLA pause only in Waiting for Customer, chargeable quote → approval → billing (BR-36), scopes (engineer own; Fabric coordinator FAB only; SCM/Profiling no access; Sales cannot log tickets) | | | | | Pass |

#### Totals
Checks run ≈ 95 (service tests + browser); passed ≈ 70; defects found 25 (incl. 8 from E2E agent D2–D9); fixed 19; needs other owner 3; BRD gaps 3. D4 (duplicate coordinator notification) — my afterCreate notification kept; orders agent removes theirs.

#### Coverage (browser, 1440 + 390)
- Admin: all 19 area routes (sweep, no console errors, no h-scroll); installation jobs (3 statuses, tabs/actions), machine record tabs, AMC record actions, Renewals, Engineer Calendar & Map, PM Schedule, Knowledge Base, Job Card print view, Feedback page, Customer Portal.
- Coordinator (Meera): Log Ticket dialog, Assign Engineer + Suggest Engineer, Incoming Message, Unassigned list.
- Service Engineer (Ravi, 390 px): My Jobs, job: Resume → Waiting for Parts → job card → OTP → Check-out (defect 1 reproduced, then fixed), offline toggle + sync.
- Sales Manager (Rohan, SO owner): Fill Handover (empty → 3 errors; save → handoverAt set); blocked on a job of another division.
- Public: portal identify by serial → coverage chip shown.
- Service-level (vitest): Admin, Service Head, Coordinator, Fabric coordinator, Engineer, Sales Exec/Manager, SCM, Profiling, Store, Accounts.

#### Tests added
- src/test/service.qa.test.ts (10): check-out/resolve guard, check-in rules, PM via ticket, PM checklist, spotted once, unassigned, escalation, pause, rating, role scopes.
- src/test/installed.qa.test.ts (9): handover by SO owner, handover request + customer notice, no early expiry, renewal dates, coverage by date, warranty reminders + opportunity, draft auto-activation, PM count, BR-02 + lower-case serial.
- src/test/installed.test.ts: renewal-sweep outbox assertion scoped to the contract.
All 43 tests in installed*/service* pass; tsc clean for my files; eslint clean.

#### Files changed
src/services/service/{tickets,jobs,pm,board,sla}.ts, src/domain/modules/service.ts, src/modules/service/pages/{MyJobPage.tsx,useStep.ts,PublicPages.tsx}, src/services/installed/logic.ts, src/services/api/installed.ts, src/domain/extensions/installed.tsx, src/domain/modules/installed/resources.ts, src/modules/installed/components.tsx, src/constants/labels.ts (installed + service sections only), tests above.

#### Edits needed in files I don't own
1. src/pages/WorkPages.tsx `FullPageForm`: show "Save & Issue" only when `form.res.lifecycle?.transitions.some((t) => t.to === 'issued')`; otherwise one primary button labelled `form.res.form.primaryLabel ?? C.actions.save`; page title for a new record `form.res.form.primaryLabel ?? L.common.form.newTitle(label)`. (Affects tickets, installations, AMC, KB.)
2. Shared quick-create dialog (src/components/resource/RecordForm.tsx `QuickCreateDialog`): title and submit = `res.form.primaryLabel` when set ("Log Ticket").
3. Read guard for KB drafts: add an optional `canRead?(actor, record)` to ResourceHooks (src/services/resourceHooks.ts) and apply it in `canReadRecord` (src/services/authz.ts); service module would register `canSeeArticle` for knowledgeArticles.
4. docs/REQUIREMENTS.md: note warranty-expiry reminders/opportunity (FR-072), draft auto-activation (FR-071), handover by SO owner (FR-063), engineer division read on installed base as deviation.
5. E2E strict run (src/test/e2e.lifecycle.test.ts) currently stops at step 7 (Generate Sales Order "Please fix the highlighted fields" — orders area), so steps 10–18 cascade-fail; re-run once orders is fixed.

### Appendix: QA: BRD 4.9 Spare Parts & Engineer Stock / 4.10 Consumables & Repeat Business

Method: service-level probes (vitest) for every rule/permission, plus headless Chrome (port 5216, CDP 9416) for a role sweep of all 12 pages × 10 roles, a full requisition workflow across 3 users, and a 390 px phone pass. Data reset per run (`createDb`).

#### Findings

| # | Page / action | BRD ref | Expected (BRD) | Found | Severity | Status |
|---|---|---|---|---|---|---|
| 1 | Spares Requisition create | SPR-03, BR-38 | Qty is a whole number ≥ 1 | 1.5 was accepted | Major | Fixed |
| 2 | Spares Requisition create (engineer) | SPR-03, §2.2 Own | Engineer raises from **their** ticket | Could raise on another engineer's ticket (not visible to them) | Major | Fixed |
| 3 | Spares Requisition create (engineer) | §2.2 Own | Raised for themselves | Could set Service Engineer to someone else; the record then vanished from their scope | Major | Fixed |
| 4 | Approve (record button) | SPR-03, separation of duties | Requester cannot approve own (Reject and inbox already block) | Service head could approve own requisition via the status button | Major | Fixed |
| 5 | Acknowledge Receipt | SPR-03 | Receipt acknowledged by the receiving engineer | Store In-charge could acknowledge its own dispatch | Major | Fixed (engineer / roles that raise requisitions only) |
| 6 | Edit requisition (store) | §2.2 Store "CEV issue/receipt" | Store issues; does not rewrite the request | Store could change qty/part while Requested | Minor | Fixed |
| 7 | Edit Consumed/Returned/Rejected requisition | Appendix A terminal states | Terminal states locked | Engineer, urgency etc. editable after consumption (moves engineer stock) | Major | Fixed (service lock; Edit button still shows, see O-2) |
| 8 | Change service engineer after issue | SPR-03/04 | Stock follows the engineer it was issued to | Could be changed after issue | Major | Fixed (only while Requested) |
| 9 | Warranty Claim (OEM) via New form | SPR-05 | Claim follows a warranty consumption, once, ≤ consumed qty; warranty parts only | Any requisition state, duplicates, any qty, non-warranty parts accepted | Major | Fixed |
| 10 | Spare Parts Master create/edit | SPR-01 | Description required; part no. normalised | Whitespace-only description saved; edited part no. stored lower-case | Minor | Fixed |
| 11 | Rate Contract create | CON-02, BR-41 | Consumables products; rate > 0 | Machine product and rate 0 accepted | Major | Fixed |
| 12 | Rate Contract overlap / reactivation | BR-41 | Overlap blocked incl. reactivating an inactive duplicate | Blocked | — | Pass |
| 13 | Rate Contract valid-to before valid-from | CON-02 | Blocked | Blocked | — | Pass |
| 14 | Sample / Trial Dispatch | CON-05 | Trial not before dispatch; ink/paper/fabric only | Trial date before dispatch and machine product accepted | Minor | Fixed |
| 15 | Sample flow | CON-05 | Requested → Dispatched → Trial → Results; result required | Skips blocked; result required | — | Pass |
| 16 | Dealer / Distributor Order (sales exec) | CON-06, §2.2 Own | Only dealers in own scope | Dealer list showed all dealers; order for another owner's dealer was created and disappeared from the creator's list | Major | Fixed |
| 17 | Dealer order product | CON-06 | Consumables/spares only | Machine product accepted | Minor | Fixed |
| 18 | Dealer order validation | CON-06 | Dealer category, end customer ≠ dealer, no future date, unique invoice | Enforced | — | Pass |
| 19 | Customer 360 → Consumables tab | CON-01, §2.2 | Engineer / store / SCM / profiling: no consumables access | Service returned orders, contracts, samples to engineer & store | Major | Fixed (service + tab shows "not part of your role") |
| 20 | Sidebar: Spare Parts module | §2.2 | Sales, division head, profiling: no spares access | Spare Parts icon + Engineer Stock link shown to them (page has no capability) → No-access page | Major | Needs other owner (O-1); capability added in my pack |
| 21 | Issue dialog | SPR-03, BR-38 | Courier + docket required; issue ≤ requested ≤ stock; ≥ 1 | Enforced; only first missing field shown | Minor | Fixed (both errors at once) |
| 22 | Issue dialog wording | Wording | Errors match field labels | "Courier / hand delivery…" vs label "Courier / mode" | Wording | Fixed |
| 23 | Double-click Issue | Robustness | One issue | One issue, stock −1 once (browser) | — | Pass |
| 24 | Consumption | SPR-04 | ≤ issued; warranty only for warranty parts; unused back to stock; defective return pending/received | Enforced; stock never negative | — | Pass |
| 25 | Return Unused | Appendix A | Only from Received; stock restored; reason ≥ 3 chars | Enforced | — | Pass |
| 26 | Engineer Stock | 4.9 title | Engineer sees own only (list, direct id) | Own only; other engineer id → error | — | Pass |
| 27 | Main Store Stock / Minimum-Level Alerts / ERP sync | SPR-02, SPR-06 | Store, SCM, service head, accounts, mgmt; alerts to store + SCM | Correct; sync gated to store/SCM/admin | — | Pass |
| 28 | No-access titles | Wording (Title Case page names) | "No access to Main Store Stock" | "main store stock", "engineer stock", "minimum-level alerts", "repeat orders" | Wording | Fixed |
| 29 | Resource list no-access title | Wording | "Warranty Claims (OEM)" | "No access to warranty claims (oem)" (generic list lower-cases label) | Wording | Needs other owner (O-3) |
| 30 | Repeat order pricing | CON-02, BR-41 | Rate contract price first, locked | Draft shows "Rate contract", priceLocked | — | Pass |
| 31 | Reorder prediction / missed alert | CON-04, BR-40 | Avg of last 3 intervals; missed after 7 days | Matches (unit tests) | — | Pass |
| 32 | Leakage list | CON-03, BR-39 | Machine customers, no consumables order in 90 days, scoped | Scoped per role | — | Pass |
| 33 | Phone 390 px, all 12 pages | NFR | No horizontal page scroll | None; tables scroll inside wrapper | — | Pass |
| 34 | Console | — | No errors | 0 problems across all runs | — | Pass |
| 35 | Partial issue | SPR-03 | — | Issuing 1 of 4 closes the request at 1; remaining 3 not back-ordered | — | BRD gap (the app assumes a new requisition for the rest) |
| 36 | Coordinator engineer stock | §2.2 "C requisition, V Div" | — | Coordinator gets no Engineer Stock | — | BRD gap (the app assumes leadership/store only) |
| 37 | Admin approve requisition | §2.2 | — | Admin lacks `approve.service`, so cannot approve | — | BRD gap (matrix gives admin no "A" on spares) |

#### Totals
Checks run: ~120 (service probes ~70, browser steps ~150 page loads + 14 workflow steps). Passed: 21 rows above + all role/page sweeps. Defects found: 20. Fixed: 18. Need other owner: 2 (+1 UX note). BRD gaps: 3.

#### Coverage
- Pages: Spare Parts Master, Main Store Stock, Engineer Stock, Spares Requisitions (list, record, all actions), Warranty Claims (OEM), Minimum-Level Alerts, Repeat Orders, Rate Contracts, Leakage List, Reorder Prediction, Sample / Trial Dispatch, Dealer / Distributor Orders, Customer 360 Consumables tab, ticket Parts Used tab (service).
- Roles swept in the browser: System Administrator, Management (service), Division Head (Suresh), Sales Manager (service), Sales Executive (Karan), Service Head (Sanjay), Service Engineer (Ravi, Lakshmi), Coordinator (Meera), Import / SCM (Rajesh), Store In-charge (Prakash), Accounts (Swati), Profiling (Tanvi).
- Browser workflow: Sanjay approves → Prakash issues (empty / over-qty / double-click) → Prakash tries receipt (blocked) → Lakshmi acknowledges → consume over-qty (blocked) → consume OK → terminal.

#### Tests added
`src/test/spares-qa.test.ts` (8 tests): fractional qty, other engineer's ticket, raise-for-others, self-approval, store edit/receipt, terminal lock, engineer change after issue, stock arithmetic, claim rules, part master trimming, rate contract product/rate, sample dates/product, dealer scope/product, consumables tab + engineer stock scope. `src/test/spares.test.ts` unchanged and passing.

#### Files changed
- src/domain/extensions/spares.tsx: requisition, claim, part master, rate contract, sample and dealer hooks.
- src/domain/modules/spares.ts: `spares.engineerStock` capability; trial date ≥ dispatch date.
- src/services/spares/requisitions.ts: issue dialog returns all missing fields together.
- src/services/spares/consumables.ts: consumables tab gated; dealer scope + product type; dealer list scoped.
- src/services/spares/stock.ts: Engineer Stock gated by `spares.engineerStock`.
- src/modules/spares/components/RecordExtras.tsx: Consumables tab shows a no-access line.
- src/constants/labels.ts (`spares` / `consumables` sections only): new errors, wording fixes.
- src/test/spares-qa.test.ts: rewritten as regression tests. src/test/spares-qa2.test.ts: deleted (it was a temporary probe).

Note: commit 0eeeb4d (19:05, made during this run) captured my temporary probe files spares-qa.test.ts / spares-qa2.test.ts. The working tree now holds the final test file and the deleted probe.

#### Edits needed in files I don't own
- O-1 `src/domain/sidebar.ts` (spares module pages): `{ id: 'engineerStock', icon: 'users' }` → `{ id: 'engineerStock', icon: 'users', capability: 'spares.engineerStock' }`. The capability is already granted in my pack to admin, management, service_head, engineer and store. Without it, the Spare Parts icon shows for Sales, Division Head, Profiling, Coordinator, Accounts and SCM and opens a no-access page.
- O-2 shared record page (src/components/resource/…): hide or disable **Edit** when `record[lifecycle.field]` is in `lifecycle.terminal`, or support a `lockedStates` option. Today the service refuses the save with "This requisition is Consumed and can no longer be changed." The button should not be offered.
- O-3 shared resource-list no-access (it uses `labelPlural.toLowerCase()`): use `labelPlural` as-is, so it reads "No access to Warranty Claims (OEM)" and not "(oem)".
- O-4 (low) `availableTransitions` in src/services/runtime.ts cannot see hook-only rules, so the Store still sees "Acknowledge Receipt" and Service Leadership sees "Approve" on their own requisition. The click is refused with a clear toast. An optional `guard(actor, record)` on lifecycle transitions would let the button show a disabled reason.
- Unrelated: catalog.test.ts (ADM-08) and field.qa.test.ts (ATT-05) failed once in the full parallel run and pass when run alone. They look flaky under load.

### Appendix: QA report: BRD 4.11 Field Force (ATT-01…10) and 4.12 Targets & Recognition (TGT-01…05)

How I tested: vitest service probes and regression tests, plus headless Chrome (dev server port 5217, CDP 9417, outDir `scratchpad/qa/field-run`). I swept 16 field and target routes for 7 roles at 1440 px (Admin Rahul, Sales Exec Karan, Sales Manager Rohan, Accounts Swati, Coordinator Meera, Engineer Ravi, Store Prakash), ran interactive flows, and did a phone pass at 390 px. Every sweep finished with **TOTAL PROBLEMS: 0** (no console errors or exceptions) and no horizontal scroll at 390 px.

#### Findings

| # | Page / action | BRD ref | Expected (BRD) | Found | Severity | Status |
|---|---|---|---|---|---|---|
| 1 | Target vs Actual / Leaderboards: order value | TGT-02, BR-47 | Achievement computed from orders, one consistent basis | All-products targets summed `grandTotal` (incl. GST, freight). Category targets summed line net (excl. GST). Category targets did not add up to the total (unit test: 1,180,000 vs 1,000,000 + 45,000). Leaderboard and Deal of the Month used `grandTotal`. | Major | Fixed: `orderNetValue` (net of discount, before GST/freight) used everywhere. The basis itself is an assumption (BRD gap). |
| 2 | Target vs Actual: verify numbers | TGT-02 | Actual = booked orders in period | Checked by hand against seed orders: Karan Oct = SO-37 + SO-57 (booked). SO-20 (pending approval) is excluded. A new test recomputes actual independently from `salesOrders`. | — | Pass (after #1) |
| 3 | Targets: Sales Manager creating targets, including their own | TGT-01, matrix §2.2 (Sales mgr: V Team) | View only | Rohan could create and edit team targets, including a target for himself | Major | Fixed: `targets: p('team','none',false,false,true)` |
| 4 | Targets: Engineer | matrix (Engineer: V Own) | See own targets and scorecard | No targets permission at all ("No access") | Minor | Fixed: `targets: p('own')` |
| 5 | Targets: Division head creates a target for another division | TGT-01, ADM-02 | Write within division scope only | Neha (Ink) created a Textile division target | Major | Fixed: write-scope check in target hooks |
| 6 | Leaderboards / Weekly Activity Scorecard | TGT-03/04, matrix (Coordinator / Store / SCM / Profiling: Targets —) | No access | Service and page had no permission check. Coordinator and Store saw rankings and scorecards. | Major | Fixed: service throws forbidden; pages show NoAccess |
| 7 | Target vs Actual: Export for Incentives | TGT-05, ADM-07 | Export audit-logged | CSV was built client-side with no audit entry | Minor | Fixed: `exportAchievement` service writes an audit entry and checks the export permission |
| 8 | Mock GPS detection | ATT-02, BR-42 | Detect fake GPS | Blocked, but nothing was recorded. The Exception Dashboard "Mock Location" item could never fire for a new attempt. | Major | Fixed: attempt is audited and flagged on the day's attendance, and shows on the Exception Dashboard (checked in the browser) |
| 9 | Exception Dashboard: future date / before shift | ATT-10 | Exceptions only for days that have happened | Picking a future date listed everyone as "No Check-in". Today, before shift start + grace, everyone also showed as "No Check-in". | Major | Fixed |
| 10 | Field visit linked to lead / opportunity / ticket | ATT-05 | Visit linked to account, lead, opportunity or ticket | Only a customer could be chosen. No UI could link a visit to a lead, opportunity or ticket. | Major | Fixed: "Linked to" picker in Log Visit (open records of the chosen customer, scope-checked). Deep link `/field-visits?mode=checkin&log=1&link=<resource>:<id>`. Service rejects links the user can't see. The activity lands on the linked record's timeline. |
| 11 | Log Visit tap count | BRD 2.2 (three taps or fewer) | ≤ 3 taps | Log Visit → Save Visit = 2 taps (customer and purpose pre-filled). Check-in = 1 tap. | — | Pass |
| 12 | Field visit: two sites at once | ATT-05 | Geo check-in/out per site | A second planned visit could be checked in while still at the first site | Minor | Fixed |
| 13 | Field visit: planned in the past; visit for someone else | ATT-05 | — | A planned visit could be dated 2020. The engine checks only the create permission, not the owner scope. | Minor | Fixed (hook checks; other-employee create also blocked) |
| 14 | Beat Plan: duplicates / moving into the past | ATT-06 | Planned vs actual integrity | Same site on the same day could be planned twice. Editing could move a plan into the past. | Minor | Fixed |
| 15 | Beat Plan: a logged visit marks the beat Visited | ATT-06 | Planned vs actual | Works (test added) | — | Pass |
| 16 | Expense: zero amount | ATT-08 | Valid amount | ₹0 claims were accepted | Minor | Fixed (> 0) |
| 17 | Expense: duplicate conveyance for the same day | ATT-08, BR-46 | Tracked km claimed once | Two conveyance claims for the same date were accepted | Major | Fixed |
| 18 | Expense form: conveyance Amount | BR-46 (amount = km × rate) | Amount calculated | The form required a typed Amount that the service then overwrote (checked in the browser) | Minor | Fixed: Amount is required only for non-conveyance types |
| 19 | Expense: edit after submit; approval chain; self-approval; reject without note | ATT-08 | Manager → Accounts | All correct. Accounts cannot decide level 1, own requests are refused, a reject note is required. | — | Pass |
| 20 | Payroll Export | ATT-08, CLAUDE.md (confirm irreversible) | Confirmation before marking claims Exported | No confirmation | Minor | Fixed: confirm dialog with count and total (checked in the browser) |
| 21 | Leave: edit after approval / edit without re-validation | ATT-09 | Approved leave locked | An approved leave could be re-dated without re-approval, and attendance was not updated. A pending leave could be stretched to 40 days, or into overlaps. | Major | Fixed: only pending leaves are editable. Edits are re-validated and the approval card summary is refreshed. |
| 22 | Regularisation: edit after approval; check-out = check-in | ATT-04 | Locked once decided; check-out after check-in | Approved requests stayed editable. Check-out equal to check-in was accepted. | Major | Fixed |
| 23 | Whitespace-only reason / description / site | §5 | Required means not blank | Accepted. The shared `isEmpty` does not trim. | Minor | Fixed in my hooks; shared fix needs another owner (below) |
| 24 | Check-in: double check-in; check-out before check-in; check-in after check-out; double-click | ATT-01, BR-44 | Blocked | All blocked with clear messages. Double-click left one record (browser). | — | Pass |
| 25 | Geofence 150 m / outside / on tour | ATT-02, BR-42 | 200 m radius | Correct | — | Pass |
| 26 | Shift arithmetic at boundaries | ATT-03, BR-43 | Grace 15, half-day < 4.5 h | 09:45 → on time; 09:46 → late 16 min. 270 min → Present; 269 min → Half-day. 18:29 out → early 1 min. All correct. | — | Pass |
| 27 | Offline check-in | NFR-15 | Queued with tap time, replayed | Correct (test added). The queue lives in memory, so a refresh loses it (documented "tab only"). | — | Pass |
| 28 | Late column shows "N/A" when on time | Wording | "On time" | `EmptyValue` ignores its `label` for visible text, so "N/A" was shown | Wording | Fixed in my pages; shared component noted below |
| 29 | Route Map status chip said "Check-in" | Wording | Status in Title Case | Field label used as a status | Wording | Fixed: "Checked In" / "Not Checked In" |
| 30 | Route privacy / consent | ATT-07, BR-45, NFR-11 | Consent before capture; scope | Consent is required before first check-in. Out-of-scope routes are refused. | — | Pass |
| 31 | ATT-07 "configurable interval" | ATT-07 | Interval setting | No setting exists. Tracking is simulated (check-in, visits, check-out). | Minor | Needs other owner (policies.ts) |
| 32 | ATT-08 "bill upload" | ATT-08 | Upload | Text file-name field. The engine has no file field type. | Minor | Needs other owner / Simulated |
| 33 | Conveyance km above tracked km | ATT-08 | Distance from tracked km | Manual km can exceed the tracked route without justification | — | BRD gap (no rule given) |
| 34 | Scorecard "demos" | TGT-03 | Demos per week | Counts demo records plus activities of type demo, so a logged demo activity for the same demo double-counts. Engineers' service visits (serviceVisits) are not counted as visits. | Minor | BRD gap |
| 35 | Cancel an approved leave whose dates are past | ATT-09 | — | Allowed. Removes the past leave marks, so those days become "No Check-in". | Minor | BRD gap |
| 36 | Seed: some conveyance claims are tiny (₹4.40 for 1.1 km) | Demo realism | — | Comes from short simulated routes. Not changed, because the seed RNG order is shared. | Minor | Noted |
| 37 | Sidebar shows Team Attendance / Exception Dashboard / Targets pages to roles with no or own-only scope | — | — | Pages render scoped data or NoAccess correctly | Minor | Needs other owner (sidebar.ts) |

#### Totals

- Checks run: about 95 (service probes: 60+; browser: 7 roles × 16 routes, plus interactive flows and the 390 px pass).
- Passed without change: 13 rows above, plus the route and role sweeps.
- Defects found: 27. Fixed: 22. Needs another owner: 3. BRD gaps: 3 (rows 33–35, plus the assumption in row 1). Noted only: 1.

#### Coverage (pages and actions × roles)

- **Attendance:** check-in (simulated / device / mock), on tour, selfie, check-out, consent, regularise dialog (validation, Esc), apply-leave dialog, last 7 days. Roles: Karan, Swati (office geofence), Rahul, Rohan, Meera, Ravi, Prakash.
- **Team Attendance:** date navigation, status filter, late / on-time display, inspector. Roles: Rohan (team), Rahul / Swati (all), Meera (division), Karan / Ravi (own).
- **Exception Dashboard:** tabs, mock-location row, future date. Roles: Rohan, Rahul, Ravi, Prakash.
- **Route Map:** people picker and person route. Roles: Rohan, Rahul, Karan (own redirect), Ravi.
- **Field Visits:** check-in mode, Log Visit (link picker, 2-tap save), planned check-in / check-out, list mode, deep link, Esc. Roles: Karan, Rohan, Rahul, Prakash.
- **Beat Plan:** week view and list. Roles: Karan, Rohan, Rahul. Meera is denied.
- **Expense Claims:** new form validation and conveyance pricing, submit, approval levels, Payroll Export (select, confirm, cancel). Roles: Karan, Rohan, Swati, Meera, Ravi.
- **Leave Applications and Attendance Regularisation:** lists, create, overlap, edit lock, approval.
- **Targets:** list and create scope. Roles: Rahul, Rohan, Karan, Neha, Ravi, Meera, Prakash.
- **Target vs Actual:** month and quarter, drill-down, export.
- **Weekly Activity Scorecard and Leaderboards & Recognition:** all 7 roles.

#### Tests added or changed

- `src/test/field.qa.test.ts` (new, 15 tests): shift boundaries, mock-GPS flag, future-day exceptions, visit linking, one site at a time, beat-plan rules, expense > 0 and duplicate conveyance, leave and regularisation edit locks, target permission matrix and scope, order-value basis with an independent recompute, scorecard / leaderboard gating, audited export, approval chain, beat marked Visited, offline replay.
- `src/test/field.rules.test.ts`: the order-value expectation changed from 1,180,000 to 1,045,000 (net basis).
- Field suites: 33 / 33 pass. Full suite: the only failure is `service.qa.test.ts > P8`, which is not in my area. `tsc -b` is clean for my files. `eslint` is clean on my paths.

#### Files changed (all owned)

- `src/domain/modules/field/rules.ts`
- `src/services/field/field.ts`
- `src/services/api/field.ts`
- `src/domain/extensions/field.tsx`
- `src/domain/modules/field.ts`
- `src/modules/field/AttendancePages.tsx`
- `src/modules/field/PerformancePages.tsx`
- `src/modules/field/VisitPages.tsx`
- `src/constants/labels.ts` (only the `const field` and `const targets` sections)
- `src/test/field.qa.test.ts`
- `src/test/field.rules.test.ts`

Note: while I was working, somebody else committed the working tree, including my in-progress files: HEAD~1 contains a temporary `src/test/field.probe.test.ts`, and HEAD deletes it. I did not commit anything.

#### Exact edits needed in files I don't own

1. **`src/services/validation.ts` `isEmpty`:** treat whitespace-only strings as empty.
   `return v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);`
2. **`src/components/primitives/display.tsx` `EmptyValue`:** the visible text is always "N/A" and ignores `label`. Render `{label}` when a non-default label is passed, or add a separate `text` prop.
3. **`src/services/policies.ts`, plus the Configurable Rules page:** add `trackingIntervalMin` (default 15) for ATT-07 "configurable interval". The field service can then show it on Route Map.
4. **`src/services/runtime.ts` `createRecord`:** after `beforeCreate`, enforce `canUpdateRecord(actor, res, {...candidate, workspaceId})`. Today any resource with an editable owner or division field can be created outside the actor's write scope. Field and Targets now guard this in their own hooks.
5. **`src/domain/sidebar.ts`:**
   - Add `capability: 'field.team'` to `teamAttendance`, `exceptionDashboard` and `routeMap` (optional; the pages are scoped).
   - Hide the Targets & Recognition module for roles with no `targets` read (Coordinator, SCM, Store, Profiling).
6. **Lead / Opportunity / Ticket record actions (their owners):** add a "Log Visit" button linking to `/field-visits?mode=checkin&log=1&link=leads:<id>` (or `opportunities:<id>`, `tickets:<id>`). This completes the ATT-05 hand-off from those pages.
7. **Metadata engine:** add a `file` field type so the expense "Bill / receipt" field can be a real (simulated) upload instead of a typed file name.
8. **`docs/REQUIREMENTS.md`:**
   - FR-111: note "one conveyance claim per day; amount computed".
   - FR-114: Sales manager is view-only, Engineer views own targets.
   - FR-115: order value = net of discount before GST (Assumption).
   - FR-110: configurable interval not yet built.
   - §2.2 matrix footnote: Targets writes are scope-checked.

### Appendix: QA: Dashboards & Reports (4.13), Administration (4.14), Common (§5), app shell

Dev server 5218, CDP 9418, screenshots in scratchpad/qa/admin-run. Role sweeps: System Administrator (all 101 sidebar destinations plus events view), Sales Executive (every admin URL directly), Service Head, Engineer, Accounts, SCM, Profiling, Division Head and Sales Manager (service level).

#### Findings

| # | Page / action | BRD ref | Expected (BRD) | Found | Severity | Status |
|---|---|---|---|---|---|---|
| 1 | Dashboard KPIs (Order Value, Pipeline, Win Rate, New Leads, Quote-to-Order, Open Tickets, Overdue, Resolved, SLA %, MTTR, CSAT, PM overdue) | App. C, 4.13 | Recomputing them by hand from the raw records gives the same figures | Same figures for Admin (all), Sales Manager (team), Sales Executive (own) and Service Head, over 30 days and 1 year | — | Pass (test added) |
| 2 | KPI Summary: all 16 Appendix C KPIs | App. C | Correct definitions | Lead response, conversion, win rate, pipeline/weighted, Q2O, backlog, collections/overdue, repeat %, FTF, PM %, AMC renewal %, attach rate all match a hand recompute. Repeat flag checked: same machine, same category, ≤30 days | — | Pass |
| 3 | Day bucketing of UTC timestamps (createdAt "…Z") | COM-11 IST | IST calendar day | Used the UTC date, so records created 00:00–05:30 IST were counted on the previous day ("Today" missed them) | Minor | Fixed (kpis.dayOf, filter.ts date operators) |
| 4 | Drill-down New Leads → Leads list | 4.13 | Opens the matching filtered list | `createdAt` was not a filterable field, so the filter was silently ignored (44 → 150 rows) | Major | Fixed (system date fields Created on / Last updated on are filterable on every list) |
| 5 | Drill-downs Order Value / Sales Orders Booked, Win Rate, Delivered, Outstanding, the four Profiling tiles | 4.13 | List row count = KPI | Lists were unfiltered or missing the status/date filter (e.g. 17 vs 15, 35 vs 16, 61 vs 7) | Major | Fixed. Test asserts row count = KPI for every count KPI across 9 roles |
| 6 | SLA compliance denominator | App. C | "÷ total tickets" | Uses resolved tickets in the range. Open tickets already past SLA are shown separately ("x past SLA") | — | BRD gap (assumption kept) |
| 7 | Order backlog includes Delivered / Installation | App. C | "not yet delivered/installed" | Delivered machine orders still count until installed | — | BRD gap (assumption kept) |
| 8 | KPI card labels cut off at 1440 px ("Open Service Ti…") | Wording | Readable | Ellipsis with no tooltip | Minor | Fixed (2-line clamp plus tooltip) |
| 9 | Report export | ADM-07, §2.2 | X only for Admin, Management, Division Head, Service leadership, Accounts | Sales Manager could export | Major | Fixed (reports.ts capability) |
| 10 | CRM Adoption report as Sales Executive | NFR-23, COM-01 | Shows only people within scope | Listed every user; colleagues showed as "Inactive" because their data was out of scope | Major | Fixed (rows follow the activity-log scope) |
| 11 | Report export is audited; every report runs for every role | COM-08/09 | — | Correct | — | Pass (test) |
| 12 | Direct URL /<resource>/<id>/edit outside scope or without update rights | COM-01 | No data and no form | Edit User opened read-only with a Save Draft button for a Sales Executive. An out-of-scope task showed an empty form with Save & Issue. An out-of-scope lead revealed its status ("Not editable") | Major | Fixed (Not found / No access) |
| 13 | Full-page form buttons for resources with no Issue step | Wording | Save | Showed "Save Draft / Save & Issue" on tasks and users | Minor | Fixed |
| 14 | Admin URLs as Sales Executive | COM-01 | Blocked | All configuration pages show No Access. Users, products, price lists and T&C templates are read-only (needed for quoting and lookups). Demo Settings is open to every role (prototype page) | — | Pass / BRD gap note |
| 15 | ADM-08 deactivation | ADM-08, BR-53 | Transfer on exit, then deactivate | Impossible for any real user: attendance, activity log, targets, beat plans and delivered dispatches counted as "open records" | Blocker | Fixed (personal history excluded; per-resource closed states) |
| 16 | Bulk Ownership Transfer covers only companies, contacts, leads, opportunities and tasks | ADM-08, BR-52 | Leaver's open work can be handed over | Open quotations, orders, payment milestones, rate contracts and tickets must be reassigned one by one | Minor | Needs other owner (customers) |
| 17 | A deactivated user can still sign in or be switched to | ADM-08 | Blocked | Was allowed | Major | Fixed (session.ts, settings.ts) |
| 18 | Role switcher sign-ins audited | COM-09 | Every login logged | The comment said "audited" but nothing was logged | Major | Fixed |
| 19 | MFA for Admin and Management only; wrong OTP rejected | NFR-07 | — | Correct. The role switcher skips the OTP (demo convenience) | — | Pass / BRD gap |
| 20 | Roles & Permissions: widening scope changes what the user sees | ADM-02 | Changes list, search and dashboard; Reset restores; System Administrator locked | Correct | — | Pass (test) |
| 21 | Configurable Rules: first-contact SLA hours | ADM-04 | Changes behaviour | Not Attended Leads changes accordingly; non-admins cannot change it. Every policy key has a consumer | — | Pass (test) |
| 22 | Global search: company, contact, mobile, GSTIN, serial no., quotation/order/ticket ID and number | COM-06 | Found and scope-respecting | Correct. A Sales Executive cannot find others' leads or quotations | — | Pass (test) |
| 23 | Help / guided tour | COM-12 | Easy to reach for every role | Only reachable through "What is real?" or the disabled-looking AI button | Minor | Fixed (account menu → Help & Guided Tour). Per-role tour verified as Sales Executive |
| 24 | Integrations: simulate lead, ERP sync, WhatsApp, email | §6 | Records created and logged | Lead and two tickets created; entries appear in Audit Trail and System Events | — | Pass |
| 25 | Tasks & Calendar: drag own event; recurring; scope | OPP-08 | Moves and persists | Drag persisted (19-10 → 24-10). Derived items cannot be dragged. The toast appears twice in the DOM (toast plus live region) | — | Pass |
| 26 | Shell at 390 px | NFR usability | No page-level horizontal scroll | None on 13 pages; wide tables scroll inside their container | — | Pass |
| 27 | Record page at 390 px | Common | Usable | Main column was about 2 px wide | Major | Fixed (app.css media rule) |
| 28 | Rail: brand at top, profile at bottom, middle scrolls; banner only over the content | Shell | — | Correct at heights 640 and 900 | — | Pass |
| 29 | Sidebar Engineer Stock link for roles without access | COM-01 | Hidden | Shown, leading to a No Access page | Minor | Fixed (capability) |
| 30 | No Access text lower-cased the BRD names | Wording | Names as-is | e.g. "warranty claims (oem)" | Wording | Fixed |

Requests from other QA agents, all done in files I own (some in shared engine files at the coordinator's request):
- `beforeDelete` hook
- `editBlocked` reason, plus a terminal-state lock on Edit
- `transitionBlocked` guard (shown as the disabled reason and enforced)
- `Transition.when`
- Readable permission messages
- Transition and board toasts use the record title ("Moved X to Y")
- Out-of-scope relations show "Restricted"
- `isEmpty` treats whitespace-only text as empty
- Details tab respects `visibleWhen`
- Action buttons wrap their labels
- Default record tab (`registerDefaultRecordTab`)
- `saveWarnings` hook (save again to proceed)
- `ServiceError.fieldLinks` (link under a field error)
- GST split into equal CGST/SGST halves
- Save / "saved" for resources without an Issue step

#### Totals
- Checks run: about 120 (49 vitest tests in my files, about 70 browser steps).
- Defects found: 19.
- Fixed: 17 (all of those in files I own).
- Needs another owner: 1 (#16).
- BRD gaps noted: 4.
- The rest passed.

#### Tests added
- `src/test/reports.handcheck.test.ts`, 11 tests: hand recompute of KPIs, drill-down counts, IST days, report scope and export.
- `src/test/authz.test.ts`, 3 tests: search, scope, Roles & Permissions end to end.
- `src/test/catalog.test.ts`, 7 tests: MFA, deactivation, ADM-08 end to end, configurable rule, hooks, GST, transition guards.

Full suite: 319 pass. The only failures are in `src/test/e2e.lifecycle.test.ts` (untracked, another agent's file). It fails at step 7: `createOrder` returns "Please fix the highlighted fields". That comes from the in-progress orders work, not from these changes; I checked by reverting `isEmpty`.

#### Files changed
- `src/services/reports/kpis.ts`
- `src/services/reports/overview.ts`
- `src/services/reports/defs/kpis.ts`
- `src/domain/modules/reports.ts`
- `src/services/filter.ts`
- `src/services/runtime.ts`
- `src/services/views.ts`
- `src/services/session.ts`
- `src/services/settings.ts`
- `src/services/validation.ts`
- `src/services/types.ts`
- `src/services/lookups.ts`
- `src/services/resourceHooks.ts`
- `src/services/catalog/admin.ts`
- `src/metadata/types.ts`
- `src/pages/WorkPages.tsx`
- `src/pages/ResourcePage.tsx`
- `src/components/resource/{ViewControls,RecordInspector,RecordForm,FormFields,BoardView,extensions}`
- `src/components/shell/AppShell.tsx`
- `src/modules/dashboard/{widgets.tsx,dashboard.css}`
- `src/domain/sidebar.ts`
- `src/styles/app.css` (two rules)
- `src/constants/labels.ts` (common, plus `toasts.moved`, `form.editing`, `form.warnings*`, `login.deactivated`, `login.auditSwitched`, `account.help`, `systemFields`)
- Three test files

#### Edits needed in files I don't own
1. `src/services/customers/operations.ts` TARGETS: add quotations (ownerId, open = not terminal), salesOrders, paymentMilestones (status ≠ received), rateContracts (active), sampleDispatches, amcContracts and tickets (assigneeId, open). Then "transfer on exit" clears every BR-53 blocker in one step.
2. Modules can now register `editBlocked`, `transitionBlocked`, `Transition.when`, `beforeDelete`, `saveWarnings`, `fieldLinks` and `registerDefaultRecordTab` (Customer 360° View → `registerDefaultRecordTab('customers', 'overview')`).
3. docs/REQUIREMENTS.md:
   - FR-149: drill-downs are list-exact.
   - §2.2: Sales manager Reports = V (export removed).
   - BR-53: personal history does not block deactivation.

### Appendix: E2E lifecycle QA: Contact Pool to engineer-spotted lead (BRD §3, §3.1, §2.2)

Run date: 19-10-2026 (simulated clock moved forward and then reset to 0).
Branch: feature/crm-modules (working tree, other QA agents editing at the same time).

What I ran:
- **Service level:** `src/test/e2e.lifecycle.test.ts` (new file, 20 sequential steps plus 1 strict test). Run it with `npx vitest run src/test/e2e.lifecycle.test.ts`. Current result: 20 passed, 1 skipped.
  - `E2E_STRICT=1` turns every carry-forward gap below into a soft assertion. It currently fails with 7 gaps.
  - `E2E_SNAP_DIR=<dir>` writes the store after each step so the browser walk can open that exact state.
- **Browser:** headless Chrome over CDP on dev server :5219, CDP port 9419. Each stage's snapshot was loaded as the role that owns the step, then the hand-off screen was opened and checked. Widths were 1440 and 390.
  - Steps: `qa/e2e-run/steps.json` and `steps-phone.json`.
  - Logs: `qa/e2e-run/run1.log`.
  - Screenshots: `qa/e2e-run/shots/b01…b25-1440.png` and `p01…p06-390.png`.
  - Result: 0 console errors or exceptions, no horizontal scroll at 390 px on New Sales Order, Installation Job, My Jobs, Service Ticket, Renewals or Customer Portal.

Record used throughout: contact CT-1138 Neha Sandhu → company C-1058 "Shree Laxmi Digital Prints Pvt Ltd". The chain then runs LD-2627-00151 → OPP-2627-00102 → QT/TX/26-27/0018 → SO/TX/26-27/0007 → SC/TX/26-27/0004 → INV/TX/26-27/00006 → DSP → INS-2627-00004 → machine M-1120 TX32-E2E-0001 → warranty and PM → AMC/26-27/0023 → TKT-2627-00221 → REQ-2627-00061 → LD-2627-00152.

#### Step table

Roles used:
- **SE:** Sales Executive Karan Singh
- **SM:** Sales Manager Rohan Desai
- **DH:** Division Head Suresh Iyer
- **MD:** Vikram Shah
- **ACC:** Accounts Swati Deshmukh
- **SCM:** Import / SCM Rajesh Agarwal
- **COORD:** Service Coordinator Meera Iyer
- **ENG:** Service Engineer Ravi Kumar
- **SVM:** National Service Manager Sanjay Verma
- **SH:** Service Head Manoj Pillai
- **STORE:** Store In-charge Prakash Jadhav
- **ADMIN:** System Administrator Rahul Mehta

| # | Step | BRD ref | Role | Expected | Actual | Re-entry? | Owner |
|---|---|---|---|---|---|---|---|
| 1 | Contact Pool → Convert to Lead | §3.1 r1, BR-04, CUS-05 | SE | Lead created with the contact; company created inline; contact marked Converted | Lead LD-2627-00151 created, contact linked and set to "Converted", company C-1058 created inline (Prospect). Dialog pre-fills division, product type, owner and next follow-up (b02). Company name, territory and state are typed, because the pool contact has no company. State is not derived from the contact's city (Jaipur). | no (minor: state) | customers |
| 2 | Follow-up on the lead | LEAD-09 | SE | Activity logged; status Contacted | Logging the call moved the lead to Contacted on its own; next follow-up kept | no | leads |
| 3 | Qualified → Opportunity | §3.1 r2, LEAD-10 | SE | Opportunity carries all lead data, activities and documents | OPP-2627-00102 at Needs Assessment with customer, contact, owner, division, product type, territory, BANT in Notes, competitors, decision maker and "From lead". The Activity History tab shows the lead's discovery call (b04). Leads have no documents feature, so there is nothing to carry (BRD gap). | no | leads / opportunities |
| 4 | Demo, then Proposal | OPP-02/04 | SE | Demo linked; stages move; probability changes | DEM-1027 booked on the opportunity; stage Demo → Proposal; probability 50 % | no | opportunities |
| 5 | Quotation with 18 % discount → approval chain | QUO-06, BR-17 | SE → SM → DH → MD | Sales Manager → Division Head → Management; each approver notified; requester cannot decide | Quote pre-filled from the opportunity (customer, contact, place of supply 24 from billing state, terms template). Rohan, Suresh and Vikram each notified in turn and each approved; Karan could not decide. Status Approved. | no | quotations |
| 6 | Sent → Accepted (PO) → Won | QUO-10, OPP-02 | SE | Send respects consent; PO captured; opportunity Won automatically | The contact has no email consent (DPDP block works), so the quote was sent by WhatsApp. Accepted with PO SLDP/PO/2026/118 and file SLDP-PO-118.pdf. Opportunity Won automatically; Generate Sales Order button shown (b03). | no | quotations |
| 7 | Generate Sales Order, pre-filled | SO-01, BR-20, §3.1 r3 | SE | Order pre-filled from the quotation, including the PO captured at acceptance | Customer, lines, discount, terms, place of supply and quotation/opportunity links all carry over. **The customer PO number and PO copy are empty and must be typed again** (b05, D1). Double submit gives one order (fixed by the orders owner during the run). | **YES** | orders |
| 8 | SO approval: reporting manager, then Accounts finance check; contract; ERP | SO-04/05/09, BR-23/24 | SM, ACC, SE | Manager approves, then Accounts; Generate Sales Contract enabled; ERP push | Approvals ran in order: "Sales Manager — Rohan Desai", then "Finance Check (Accounts)" by Swati, each notified. Finance check was triggered by an overdue amount (set as the simulated ERP sync). Status Payment Pending; erpPushedAt set on approval; contract SC/TX/26-27/0004 carries value, customer and terms; Push to ERP gave INV/TX/26-27/00006 and an e-way bill no. The owner was notified (b08). | no | orders |
| 9 | Advance received → Order Processing → Ready for Dispatch | SO-07/08 | ACC, SCM | Advance gates Processing; Import / SCM fields; Ready for Dispatch | Receipt recorded, so status Payment Received. Rajesh entered PO to principal, ETA, customs Cleared, machine ready and PDI; order went Processing → Ready for Dispatch; it appears on /order-processing (b09). | no | orders |
| 10 | Dispatch → Delivered (POD) → installation job and handover | INS-01/02/05, BR-26, §3.1 r5 | SCM | LR number and e-way bill; customer told of dispatch; POD and photo; installation job created automatically; handover form issued to the sales owner | Dispatch reused the invoice no. and e-way bill from the ERP push (no re-typing); WhatsApp intimation queued. POD and delivery photo required. INS-2627-00004 created with customer, SO, product and division (b10). The sales owner is now notified (fixed by the orders owner during the run). **The coordinator gets two notifications for the same job** (D4). | no | orders / installed |
| 11 | Handover → readiness → install → job card → OTP sign-off | INS-03..07, BR-27/28, §3.1 r6 | SE, COORD, ENG | Sales owner fills the handover; readiness gates the steps; machine, warranty, PM schedule and training created on sign-off; SO Completed | **The Sales Executive cannot edit the handover** (D3), so the coordinator filled it. Engineer was assigned and notified; checklist shared; readiness → Site Ready (SO goes to Installation) → In Progress → job-card steps → Trial & Training → OTP sign-off. Machine M-1120 created with serial, heads, width, software, install and purchase dates and SO ref. Warranty 19-10-2026 → 18-10-2027; training record created; SO Completed; sales owner notified. **Only 1 PM visit is created for a 12-month warranty at 2 visits a year** (D6). **Scheduled with no installation site** (D5). | no | installed |
| 12 | Clock moved to warranty end − 90 days | §3.1 r7, IB-05 | ADMIN, system | Reminders to sales and service owners plus a renewal (AMC) opportunity | **Nothing happens: the renewal sweep only reads AMC/CMC contracts** (D2) | n/a | installed |
| 13 | AMC after warranty: 90 / 60 / 30 days | IB-04/05, §3.1 r7 | SVM, system | Reminder at each threshold to both owners; one renewal opportunity; customer reminded | **The AMC sold in advance stays Draft and cannot be activated before its start date** (D7); it was activated on the start date. At T−90, T−60 and T−30 Karan and Sanjay each received one reminder (3 each), remindersSent became "90,60,30", status Due for Renewal, and one renewal opportunity was created (renewal, machine, owner Karan). It is listed on /renewal-pipeline and in the inbox (b17, b18). | no | installed |
| 14 | Ticket via Customer Portal | SRV-01/02, BR-29 | Customer | Customer found by serial; warranty / AMC status shown automatically; desk notified | Portal identified the customer by serial and pre-selected the machine (b14). The ticket was created with coverage **Warranty**, SLA due times, division from the machine, desk notification and acknowledgement message. The ticket page shows the "Warranty / AMC status: Warranty" banner (b16). The portal itself shows no coverage to the customer (D8, minor). | no | service |
| 15 | Assign → My Jobs → accept, travel, check-in, work | SRV-05/06 | COORD, ENG | Assigned; engineer notified; job in My Jobs; arrival time recorded | Assigned and engineer notified; listed in My Jobs (b15); Accept → Start Travel → Check-in gave In Progress and arrivedAt | no | service |
| 16 | Spares requisition → approve → issue → receive → consume | SPR-03/04, BR-38 | ENG, SVM, STORE | Machine, customer and basis taken from the ticket; Waiting for Parts; approval; issue; consume | Requisition pre-filled machine, customer and division, with basis Warranty from coverage. Ticket went to Waiting for Parts. Approved by service leadership, issued by Store with stock reduced, received, consumed as Warranty. Ticket back to In Progress. | no | spares |
| 17 | Resolve with OTP → job card and feedback link → rating 2 → Closed | SRV-08/12, BR-35, §3.1 r8 | ENG, Customer | Customer Confirmation; job card and feedback link sent; rating ≤ 2 alerts the Service Manager; Closed | Check-out with OTP moved the ticket to Customer Confirmation; the outbox has ticket.resolved (feedback link) and ticket.jobcard. Feedback 2 ★ "resolved" closed the ticket and sent an escalation to the service heads (+2). Visible in Manoj's inbox (b22). | no | service |
| 18 | Engineer "Opportunity Spotted" | SRV-14, BR-37, §3.1 r9 | ENG | Lead with source Referral and the engineer as referrer; owner notified | LD-2627-00152 created with source Referral, referrer type Engineer, referrer Ravi, owner = account owner Karan (notified), and requirement text naming the ticket (b19) | no | service |
| 19 | Consumables: leakage list and repeat data | CON-01/03, BR-39 | SE | A machine customer with no ink orders is on the leakage list | Customer listed on /leakage-list (b20). The consumables view returns machines, orders, reorder data and leaking = true. No repeat order is possible because the customer has no previous consumables order (expected). | no | spares |
| 20 | Dashboards before and after | App. C | SE, SM, SH, ACC | KPIs move for each role | Karan: Order Value ₹6.48 L → ₹34.05 L, Win Rate 0 → 33 %, Quote-to-Order 0 → 33 %, Target vs Actual 0.08 → 0.66, New Leads 8 → 10. Rohan: Order Value +₹27.6 L, Win Rate 67 → 71 %. Manoj: Tickets Resolved 27 → 28, SLA 81.5 → 82.1 %, MTTR 35.6 → 34.3 h, CSAT 3.3 → 3.2. Swati: Payments Received +₹8.27 L. | no | reports |
| 21 | Audit trail | COM-09, BR-50 | ADMIN | Every record in the chain has audit entries | Audit entries per record: lead 4, opportunity 4, quote 9, SO 17, installation 12, machine 1, AMC 7, ticket 12, requisition 7, spotted lead 1 | no | core |

Re-entry found: 1 (D1, PO on the sales order). Every other hand-off carries data forward without re-typing.

#### Defects (owner file + suggested fix)

| ID | Severity | Step | BRD | Defect | Owner file(s) | Suggested fix |
|---|---|---|---|---|---|---|
| D1 | **Major (re-entry)** | 7 | §2.2, §3.1 r3, SO-02, BR-21 | The PO number, PO date and PO copy captured on Accept quotation are not pre-filled on Generate Sales Order, so the sales executive types them again. Seen in the browser (b05: empty PO number, "No file chosen"). | `src/services/orders/orders.ts` (`OrderDraft`, `draftFromQuotation`); `src/modules/orders/NewOrderPage.tsx` (`OrderForm`, `useState` po, line ~132) | Add `po?: { customerPoNo: string; customerPoDate: string; poFileName: string }` to `OrderDraft`, filled from `q.customerPoNo / q.customerPoDate / q.poFileName` when present. In the `useEffect` that seeds `lines`, also run `if (draft.data.po?.customerPoNo) setPo({ ...draft.data.po, poFileSize: 0 })`. Keep `validatePo` so it stays editable and validated. |
| D2 | **Major** | 12 | §3.1 r7, §5.3, IB-05 | Warranty nearing expiry produces no reminders and no renewal (AMC) opportunity. `planRenewalSweep` / `runRenewalSweep` read only `amcContracts`. | `src/services/installed/logic.ts` (`planRenewalSweep`, `runRenewalSweep`, `ensureRenewalOpportunity`) | Extend the plan with warranties where `endDate − today ≤ max(renewalReminderDays)` and the machine has no AMC/CMC starting after the warranty. Send one reminder per threshold (track `remindersSent` on the warranty) to the account owner (`customers.ownerId`) and the service desk (`serviceDesk(divisionId)`), plus the customer message. Create one `oppType: 'renewal'` opportunity (name "AMC – <serial> – <customer>", machineId, value from policy or 0) and store its id on the warranty. |
| D3 | **Major** | 11 | BR-26, INS-04 | The Sales-to-Service handover form "for the sales owner to fill" cannot be filled by the sales owner. Sales Executive update on `installations` throws "Your role cannot edit this installation job". The UI shows the Handover tab read-only, while the Actions-panel Edit button appears enabled (b12). | `src/domain/modules/installed.ts` (role matrix line ~27 `sales_exec: … installations: p('division')`); `src/domain/extensions/installed.tsx` (`beforeUpdate`) | Give `sales_exec` (and `sales_manager`) update on installations whose sales order they own, limited to `hoExpectations`, `hoCommitments` and `hoKeyContacts`. Use a field-level permission or a `beforeUpdate` guard that rejects other fields for sales roles. Alternatively add a dedicated "Fill Handover" record action for the SO owner. |
| D4 | Minor | 10 | INS-05 | The coordinator gets two "new installation job" notifications per delivery: one from `createInstallationJob`'s planner loop and one from the `installations` `afterCreate` hook. | `src/services/orders/orders.ts` (`createInstallationJob`, planners loop) and `src/domain/extensions/installed.tsx` (`afterCreate`) | Keep one source. Simplest: in `createInstallationJob` notify only `service_head` (or nobody) and leave coordinators to `afterCreate`. |
| D5 | Minor | 11 | BR-02 | An installation is scheduled (engineer and date) with no installation-site address. A pool-converted company has no address and the SO allows an empty site ("No addresses on file for this customer", b05). | `src/domain/extensions/installed.tsx` (`installations.beforeUpdate`/`beforeTransition`); `src/modules/orders/NewOrderPage.tsx` / `createOrder` | Block `scheduledAt`/`engineerId` (or Site Ready) when `siteAddressId` is empty or the address lacks lat/lng, with a link to add a site in Customer 360. On machine orders, warn on the SO form when there is no installation site. |
| D6 | Minor | 11 | BR-28, INS-07, SRV-11 | A 12-month warranty with 2 PM visits a year generates only 1 PM visit (19-04-2027). The month-12 visit (19-10-2027) falls one day after the warranty end (18-10-2027) and the loop condition `due <= end` drops it. | `src/services/installed/logic.ts` (`generatePmVisits`) | Generate `count = round(monthsBetween(start, end + 1 day) × perYear / 12)` visits at `addMonths(start, k × step)`, clamping the last one to `end`. |
| D7 | Minor | 13 | IB-04 | An AMC sold before warranty end (start date in the future) can only be saved as Draft. "Activate" is refused before the start date and nothing activates it on that date, so renewals and PM for it depend on someone remembering. | `src/services/installed/logic.ts` (`runRenewalSweep`) / `src/domain/extensions/installed.tsx` (`amcContracts.beforeTransition`) | Either allow Activate for future-dated contracts (coverage already uses dates), or add `plan.activate` in the renewal sweep for draft contracts with `startDate ≤ today` and `value > 0`, which also generates their PM visits. |
| D8 | Minor / BRD gap | 14 | SRV-02 | After identification the Customer Portal does not show the machine's warranty / AMC status to the customer. The ticket record shows it to staff. | `src/modules/service/pages/PublicPages.tsx` | Show the coverage tag (e.g. "Warranty until 18-10-2027") under the machine picker using `coverageFor`. |
| D9 | Minor | 11 | IB-01 field rule | The serial number field rejects lowercase ("Use 4–30 capital letters…") even though the `installations` hook upper-cases it. Validation runs before the hook. | `src/domain/modules/installed/resources.ts` (`SERIAL` pattern) | Make the pattern case-insensitive, or upper-case `serialNo` in the field `normalize`/onChange so the hook's upper-casing actually applies. |
| D10 | Minor (re-entry of known data) | 1 | BR-04 | The Convert to Lead dialog for a pool contact without a company leaves "State" empty although the contact's city is known (Jaipur → Rajasthan). | `src/modules/customers/*` convert dialog; `src/services/customers/operations.ts` | Pre-select billing state (and territory where a territory covers the city) from `contact.city` / `contact.state`. |
| G1 | BRD gap | 3 | §3.1 r2 "documents" | Leads have no documents/attachments, so "documents carried to the opportunity" cannot be exercised. Quotations and Customer 360 have Documents tabs; leads and opportunities do not. | leads / opportunities | Add a Documents tab (file metadata, COM-04) on leads and show lead documents on the opportunity, as the Activity History tab now does for activities. Otherwise mark it in REQUIREMENTS as Deferred. |
| G2 | BRD gap | 8 / 11 | — | The company stays "Prospect" after its first order and installation (b23). BRD does not say when the category changes. | customers / orders | Suggest moving the category to "Active" on first confirmed SO (audit-logged), or record it as an assumption in REQUIREMENTS. |

Fixed by module owners during this run (confirmed by re-running the test):
- The opportunity now gets product type, territory and BANT notes from the lead.
- The opportunity Activity History merges the lead's activities.
- A double submit on Generate Sales Order with the same idempotency key returns the existing order instead of an error.
- Delivery now notifies the sales owner about the installation job and handover.

#### Checks that passed (highlights)

- Approval chains reach exactly the right people in order, the requester can never decide, and each approver gets an "approval needed" notification:
  - Quotation discount: Sales Manager → Division Head → MD.
  - Sales order: reporting manager → Accounts.
- DPDP consent blocks sending email to a contact without email consent.
- ERP numbers (invoice, e-way bill) flow into the dispatch without re-typing.
- Delivery gates are enforced: dispatch and delivery dates, POD and photo.
- Readiness and job-card gates are enforced: BR-27, and all steps before Trial & Training.
- Sign-off creates the machine, warranty, PM visit(s) and training record, and completes the SO, in one commit.
- Coverage is derived on the ticket (Warranty).
- The requisition takes machine, customer and basis from the ticket; the Waiting for Parts round-trip works.
- Low rating escalates to the service heads.
- The engineer's referral lead carries the right referrer and notifies the account owner.
- The leakage list picks up the new machine customer.
- KPIs move for Sales Executive, Sales Manager, Service Head and Accounts.
- Every record in the chain has audit entries.
- Browser: 0 console errors or warnings across 50+ steps at 1440 px and 390 px; no horizontal scroll.

#### Files

- Added `src/test/e2e.lifecycle.test.ts`. Lint is clean and it adds no tsc errors. This is the only repo file I touched.
- Browser artefacts: `scratchpad/qa/e2e-run/` contains `gen.py`, `steps*.json`, `cdp-e2e.mjs`, `run1.log`, `snap-*.json`, `ids.json` and `shots/`. `cdp-e2e.mjs` is a copy of the shared driver with a 20 s per-command timeout and dialog auto-accept; the shared one was not changed.
