# BRD Compliance Audit & Lifecycle Stress Test

Date: 21-10-2026 · Branch: `feature/crm-modules` · Source: `docs/BRD.md`

How this was done: every clause of BRD §3, §4.1–4.14, §5, §6, §7, §8 and Appendices A–C was traced in code (file:line evidence in Parts A–E below), and the full "first contact → deal closed" lifecycle was driven through the real UI in Playwright across 4 roles (Part F, 46 steps, ~125 screenshots in the session scratchpad). No code was changed by the audit.

Baseline: `npm run build` passes (0 TS errors; 3.06 MB single JS chunk). `npm run lint` passes (0 errors, 3 warnings). Vitest service suites: 71 pass, 1 skipped, 1 fails (`src/test/service.qa.test.ts:98`, unassigned ticket queue empty). Zero console/page errors during the live run.

## 1. Summary

| Area | BRD IDs | Clauses | Correct | Partial | Missing / Wrong | Simulated / N/A / Deferred |
|---|---|---|---|---|---|---|
| A. Customer & Lead | CUS, LEAD, §3 | 95 | 61 | 22 | 4 / 0 | 8 |
| B. Opportunity, Quotation, Order | OPP, QUO, SO, App. A | 65 | 44 | 14 | 1 / 0* | 7 |
| C. Administration & Common | ADM, COM, App. B | 22 | 6 | 13 | 0 / 1 | 2 |
| D. Service side | INS, IB, SRV, SPR, CON | ~100 | 66 | 16 | 2 / 0 | 16 |
| E. Field, Targets, Reports, NFR | ATT, TGT, §4.13, §6–8, App. C | ~45 | 12 | 16 | 0 / 0 | 15 |

\* No clause is wrong as worded, but three behaviours are wrong in practice (sibling quotations stay live, accept on a Lost opportunity, won value not synced on the order path).

**Overall:** the happy path works end to end and the core numbers reconcile (opportunity value = accepted quote total = order total incl. GST and milestones). The problems that break "neat and clean" are concentrated in five places:

1. **Quotation selection does not deactivate the others.** After one quotation is accepted, siblings can still be edited, submitted, approved, sent (email/WhatsApp), moved to Negotiation (also by bulk and board drag). Accept / Generate Sales Order stay enabled and fail only after the click. Only superseded *revisions* are locked correctly.
2. **History is fragmented.** Each record shows only its own change log (relative time only). Lead activities are on a different tab, sorted by subject Z→A. Opportunity Timeline has no status, quotation or order events. Opportunity/Quotation → Sales Order links are missing.
3. **Closed-deal integrity.** An Admin can re-open a Won opportunity that has an approved Sales Order; the Sales Exec can then mark it Lost → opportunity Lost, quote Accepted, order live ₹55.2 L, dashboard "0 won". Lost opportunities leave quotations open, and a quote can still be accepted on a Lost opportunity.
4. **Configuration that saves but does nothing.** Division/State/GST/Purchase Timeline masters can never be published (key-format validator); notification templates and preferences are never read; new stages/priorities don't participate in transitions/SLA; child masters have no parent picker; quotation approvers ignore live reporting-manager changes; custom fields missing on create pages; no numbering-series setting; newly created users can't sign in.
5. **Data/KPI inconsistencies.** Activity Scorecard double-counts visits; two sales-value bases (incl. vs excl. GST); win rate vs funnel disagree; "129% of leads reach orders"; non-selected quotes counted as live; auto-logged activities stamped in UTC (previous day near midnight IST); negative numbers silently made positive.

## 2. Proposed fix plan (for approval)

### Phase 1 — Deal lifecycle integrity (your two explicit asks first)

| # | Fix | BRD |
|---|---|---|
| 1.1 | **Quotation selection.** New status **Not Selected**. When a quotation is accepted (or a Sales Order is generated from it), every other quotation and revision on that opportunity becomes Not Selected (read-only), and its pending approvals are withdrawn with an audit entry. One central guard on every quotation action (edit, submit, approve, send, accept, version, generate order, lifecycle/bulk/board transitions). Action buttons hidden on Not Selected quotes, replaced by a banner "Not selected — Q-xxxx was accepted on dd-mm-yyyy". Opportunity's Quotations tab groups **Selected / Not Selected / Superseded**. Generate Sales Order only from the accepted quote. Manager/Admin can undo the selection only while no Sales Order exists. | QUO-07/10/12, SO-01 |
| 1.2 | Opportunity value and `selectedQuotationId` sync on every win path (accept and order creation). | OPP-05, SO-01 |
| 1.3 | Mark Lost closes all open quotations (Not Selected, reason = opportunity lost); accept on a Lost opportunity is refused. Re-open of a Won opportunity is blocked while a live Sales Order exists (message tells the user to cancel the order first). | OPP-06, App. A |
| 1.4 | **Unified Deal History** on Lead, Opportunity, Quotation and Sales Order: one timeline merging activities, status changes, field edits, approvals, sends, comments and child-record events across the chain, with user and absolute IST date-time, newest first, filter by type. | COM-09, CUS-07, LEAD-10 |
| 1.5 | **Deal chain panel** on all four records: Lead → Opportunity → Quotations (selected marked) → Sales Order → Contract, every item clickable, with status chips. | §3.1, CUS-07 |
| 1.6 | Lead → Opportunity conversion carries source, campaign, referrer, sub-type, specs, budget, timeline; fix opportunity type mapping (service/spares). Conversion requires Contacted or stamps first-contact time. Convert-to-Lead dialog asks for lead source. | LEAD-08/11 |
| 1.7 | Activity timestamps in local time (fix UTC stamping); order tabs show the same date. | COM-09 |
| 1.8 | Numeric inputs: reject negatives and exponent strings, sensible upper bounds on quantity/discount/amount, with inline messages. | COM-05 |
| 1.9 | Pipeline board: show Won/Lost columns (visible filter chip for "open only"); dragging to Won/Lost explains what is required instead of silently doing nothing. | OPP-03 |
| 1.10 | Navigation polish: after save open the new record; browser Back no longer reopens a blank New Quotation (duplicate); Edit on a pending quote explains "withdraw approval to edit"; duplicate-lead warning is a clear dialog. | COM-02 |

### Phase 2 — Configuration that actually takes effect

2.1 Master key validation only on new values (unblocks Division, State, GST Rate, Purchase Timeline). 2.2 Parent picker for child masters (sub-category, territory). 2.3 Opportunity stages, probabilities and ticket priorities built from masters (new values participate in transitions and SLA); workflow-status masters locked. 2.4 Outbox messages rendered from Notification Templates. 2.5 Notification Preferences honoured (channel, quiet hours, digest). 2.6 Quotation approvers from live employee hierarchy. 2.7 Custom fields and division layouts on New Lead, Quote editor and New Order. 2.8 Numbering series settings (prefix, FY, padding) used by all document numbers. 2.9 "Export selected" goes through permission check + audit; role matrix over-exposure fixed (engineer, accounts, profiling) and delete scope uses update scope. 2.10 Newly created users can sign in; "Reset demo data" Admin-only; Publish asks for confirmation; editable per-role capabilities (approve levels, export).

### Phase 3 — Data and KPI correctness

3.1 One Activity Scorecard calculation (no double-counted visits, honours filters). 3.2 One sales-value basis everywhere (see decision D-1). 3.3 Target tile never shows another person's target. 3.4 Win rate and funnel from the same query; fix "leads reach orders %". 3.5 Not Selected quotes excluded from live-quote counts and quotation value reports. 3.6 Audit log not capped at 2,000. 3.7 Exceptions report reuses the dashboard's exception logic. 3.8 Fix failing unassigned-queue test; add regression tests for the lifecycle (selection, reopen guard, KPI after win).

### Phase 4 — Service side and field force

SRV-10 quote for chargeable parts on AMC tickets; job-card parts linked to requisitions (SRV-06/SPR-04); admin "Mark completed" cannot skip installation sign-off (INS-07); readiness verified before scheduling (INS-03); multi-machine AMC + billing schedule (IB-04); job-card readings feed machine readings (IB-06/CON-04); ticket attachments (SRV-02); arrival SLA requires check-in (SRV-09); renewal quotation pre-filled and accepting renews the contract (IB-05); phone-desk lookup by mobile/serial (SRV-01); offline queue persisted; geo-tagged visit check-out; expense limits in Policies; route-level code splitting.

### Phase 5 — Traceability

Correct `docs/REQUIREMENTS.md` rows that overclaim (LEAD-07 bulk assign, FR-062/071/073/076/083/084/101, FR-085, FR-124, NFR-13, QUO-06d) and update every status after each phase.

## 3. Decisions needed

- **D-1 Sales value basis.** Recommend: targets, leaderboard, revenue KPIs and pipeline use **value before GST**; orders and invoices additionally show the GST-inclusive total.
- **D-2 Re-open a Won deal with a live order.** Recommend: blocked; the order must be cancelled first (with reason), then Admin/Sales Manager can re-open.
- **D-3 Undo a quotation selection.** Recommend: Sales Manager/Admin only, only while no Sales Order exists; undo restores the others to their previous status.
- **D-4 Scope.** Recommend approving Phases 1–3 now (lifecycle + configuration + data), Phase 4 after.

---

# Detailed findings

The sections below are the per-area audit reports, unedited.


---

## Part A-customer-lead

## Audit A: Customer & Contact Master (BRD 4.1) + Lead Management (BRD 4.2) + §3 / §3.2 / Appendix A (Lead)

Scope: the code under `src/` as checked out on branch `feature/crm-modules` (clean). The status claims in docs/REQUIREMENTS.md were **not** taken on trust; every row below comes from reading the code.
Paths are relative to `/Users/maysolanki/Documents/True-Color/tc_frontend/`.

Key files:
- `src/domain/modules/customers.ts`, `src/domain/modules/leads.ts`, `src/domain/modules/leads/computed.ts`
- `src/domain/extensions/customers.tsx`, `src/domain/extensions/leads.ts`, `src/domain/extensions/core.ts`
- `src/services/leads/rules.ts`, `src/services/customers/{operations,duplicates,pool,view360}.ts`, `src/services/catalog/integrations.ts`
- `src/modules/leads/{NewLeadPage,LeadActions,ImportLeadsPage,NotAttendedLeadsPage,FollowUpsPage,SalesWorkspacePage}.tsx`
- `src/modules/customers/{pages,components,customer360}.tsx`, `src/components/resource/RecordInspector.tsx`

### Requirement-by-clause table

| BRD ID | Clause (short) | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| §3 | One shared customer/machine DB, every module uses it | Correct | All resources point to `customers` through `customerId`. Merge re-points every reference (`services/customers/operations.ts:35-67`) | — | — |
| §3 | Each stage carries forward to the next "without re-entry" | Partial | Contact→Lead carries contact, company, source and city (`operations.ts:234-246`). Lead→Opp: see the LEAD-10 rows | Lead→Opp drops source, campaign, referrer, sub-type, specs, budget and timeline (`rules.ts:321-345`). Copy them onto the opportunity, or show them read-only from `leadId` | High |
| §3.1 | Contact "Convert to Lead" → lead gets contact + company data | Correct | `operations.ts:189-252`. A company is created inline when the contact has none. The contact is linked and set to `poolStatus=converted`, and the owner is notified. Dialog: `modules/customers/components.tsx:113+` | Campaign and referrer are not offered in the dialog. A converted contact can never start a second lead from the pool (`operations.ts:201`) | Low |
| §3.1 | Lead qualified → Opportunity "with all lead data" | Partial | `rules.ts:312-368`. Carried: customer, contact, leadId, division, productType, requirement→notes, value, close date, currentSetup→competitors, decisionMaker→decisionMakers, owner, follow-up | Not carried: sourceId, campaign, eventName, referrer*, subType, spec* fields, budget, timeline, city, state, segment. The opportunity has no such fields (`domain/modules/opportunities.ts`) | High |
| §3.1 | …"activities" | Correct | The opportunity Timeline tab merges the lead's activities, tagged "from lead" (`domain/extensions/opportunities.tsx:216-250`) | The timeline does not show who logged each activity (`byId`). The lead's comments and change history are not reachable from the opportunity | Low |
| §3.1 | …"documents" | Missing | Leads have no attachment fields, and `customerDocuments` does not scan leads or opportunities (`services/customers/view360.ts:188-205`) | Add a simulated attachments field to leads and carry it to the opportunity on conversion | Low |
| §3.1 | Engineer "Opportunity spotted" → lead with engineer as referrer | Partial | `services/service/tickets.ts:358-387` sets source=referral, referrerType=engineer and referrerEmployeeId | Owner = `customer.ownerId`. The lead `beforeCreate` hook (`extensions/leads.ts:40-41`) throws when that owner is not in the ticket's division, so the action fails. Fall back to `autoAssign()` when the division does not match | Med |
| §3.2 | Prospecting = contact pool; Qualification = lead | Partial | Contact Pool (`/contact-pool`) and Leads exist | No screen names the 8 stages. The Sales workspace (`/sales`) mixes lead statuses with opportunity stages and gives no stage numbers. Add an "8-stage" legend or chips to the workspace and pipeline | Low |
| App. A | Lead initial status = New | Correct | `leads.ts:109-112`, default `status:'new'` | — | — |
| App. A | New → Contacted | Partial | Happens only when the first activity is logged (`extensions/leads.ts:78-86`). The board's "Contacted" move opens Log Follow-up (`LeadActions.tsx:101-102`) | Any activity type counts as first contact, including the internal type "Note". Exclude `note` from the first-contact rule | Low |
| App. A | Contacted → Qualified (converted to Opportunity) | Partial | Conversion is allowed from `new` **or** `contacted` (`rules.ts:318`, `LeadActions.tsx:50`) | A lead can be converted straight from New without any contact being logged. `firstContactAt` then stays null, so the first-response report counts the lead as never contacted (`reports/defs/leads.ts:138`). Either require Contacted, or set `firstContactAt` on conversion | Med |
| App. A | → Nurture | Correct | `rules.ts:371-379` (from new/contacted, future date required) | — | — |
| App. A | → Disqualified | Correct | `rules.ts:382-390` (from any open status, reason required) | — | — |
| App. A | Qualified is terminal / locked | Correct | `lifecycle.terminal:['qualified']` (`leads.ts:112`). `beforeUpdate` throws (`extensions/leads.ts:50`). Edit is disabled with a reason (`RecordInspector.tsx:200-205`). Delete is blocked by the opp→lead reference (`runtime.ts:409`) | — | — |
| App. A | Re-activation (Nurture / Disqualified → Contacted) | Correct | `leads.ts:116-119`. Disqualified→Contacted needs the `leads.reactivate` capability (managers) | Not in the BRD flow, but sensible. Nurture leads must be reactivated before conversion, which is not explained in the UI | Low |
| CUS-01 | Company name, legal name, industry, segment, category, website, divisions, territory/hub, owner | Correct | `domain/modules/customers.ts:44-64` | — | — |
| CUS-01 | GSTIN format validation | Correct | `extensions/customers.tsx:67-74` → `lib/validators.ts:26-34` (regex, state code, checksum, state match, PAN match). Also enforced on the inline New Lead company, because hooks run in `insertRecordIn` (`runtime.ts:466`) | — | — |
| CUS-01 | PAN | Correct | `format:'pan'` (`customers.ts:53`), `validators.ts:36` | — | — |
| CUS-02 | Multiple addresses: billing / shipping / installation | Correct | `addresses` resource with `addressType` master (`customers.ts:137-189`, master at `:270`). Sites tab in 360 | — | — |
| CUS-02 | Each site geo-tagged | Simulated / Partial | Optional lat/lng pair, validated as a pair (`extensions/customers.tsx:145`) | Inline company creation (`rules.ts:222`) and pool conversion (`operations.ts:229`) insert a placeholder billing site with `line1 = city`, `pincode = ''` and `validate:false`. This produces invalid sites. Ask for the address in those flows, or flag the site as incomplete | Med |
| CUS-03 | Multiple contacts per company with name, designation, department, mobile, WhatsApp, email | Correct | `customers.ts:206-224`. Mobile or email required, exact-duplicate block (`extensions/customers.tsx:98-110`) | — | — |
| CUS-03 | Buying role (decision maker / influencer / user / finance) | Correct | `domain/masters.ts:183` | — | — |
| CUS-03 | Communication consent | Correct | consentWhatsapp / consentEmail / consentSms (`customers.ts:215-217`) | — | — |
| CUS-04 | Configurable classification: Prospect, Active, Existing/Inactive, Dealer, Distributor | Correct | `masters.ts:160-166` (master, editable in admin masters) | — | — |
| CUS-04 | Segment tags: Fashion, Job-work, Trader, Mill | Correct | `masters.ts:167-173`, `segmentTags` multimaster | — | — |
| CUS-05 | Pool from phone book (mobile app) | Simulated | `services/customers/importContacts.ts:128-129` (sample rows), Import Contacts page `/contact-pool/import` | Labelled as simulated (`pages.tsx:517`) | — |
| CUS-05 | Excel/CSV upload | Partial | CSV only (`modules/customers/pages.tsx:506` accept=".csv") | No .xlsx. Acceptable for a prototype, but the label says "Excel". Add an "Save as CSV from Excel" hint or a simulated .xlsx | Low |
| CUS-05 | Visiting-card scan (OCR) | Simulated | `pages.tsx:478-520` | — | — |
| CUS-05 | Manual entry | Correct | `contacts` create with no `customerId` = pool contact (`services/customers/pool.ts:21`) | — | — |
| CUS-05 | Use the pool to prospect, plan calls/meetings before a lead exists | Partial | Contact record has Log Activity (`components.tsx:102`) | No "plan a call or meeting" (future task or calendar event) from a pool row. Activities are logged after the fact. Add a "Schedule call/meeting" row action that creates a task or calendar event | Low |
| CUS-05 | "Convert to Lead" creates a lead for the contact | Correct | `operations.ts:189-252`. Banner on the converted contact links to the lead (`components.tsx:298-304`) | — | — |
| CUS-06 | Duplicate on GSTIN at creation | Correct | Blocking (`extensions/customers.tsx:71-72`) | — | — |
| CUS-06 | Duplicate on mobile / email at creation | Correct | Blocking, across contacts (`extensions/customers.tsx:107-108`) | In the inline New Lead flow the hook returns `fieldErrors.mobile`, but the page reads `contact.mobile` (`NewLeadPage.tsx:262`). The message shows only at the top, not on the field | Low |
| CUS-06 | Fuzzy company-name match at creation | Partial | Live warning in New Lead inline (`NewLeadPage.tsx:65, 205-222`, substring match, not Dice) and in the pool Convert dialog (`components.tsx:137`). The standard company form only warns **after** saving, through a banner (`components.tsx:276`) | Add a live fuzzy-match warning to the Company create form, and use the one Dice matcher everywhere (`rules.ts:138-142` uses its own looser substring matcher) | Med |
| CUS-06 | …at import | Partial | Contact import uses exact mobile/email checks (`importContacts.ts:87`). Lead import warns on duplicate leads (`rules.ts:625-626`) | Lead import: a contact whose mobile already exists under another company throws in `checkContact`, which aborts the **whole** import commit (`rules.ts:652-653`). Skip that row with an error, or reuse the existing contact | Med |
| CUS-06 | Admin merge | Partial | Companies: `/admin/duplicate-merge`, confirm dialog, `mergeCustomers` (`operations.ts:50-88`) | No contact merge: contact duplicates are listed with a hint only (`pages.tsx:335`) | Med |
| CUS-06 | …with full audit | Partial | One summary audit entry plus a patch on the survivor (`operations.ts:82-85`) | Re-pointed child records are changed directly (`:63`) with no audit row or change entry on each one, so their history does not show the merge | Low |
| CUS-07 | 360°: leads, opps, quotes, orders, payment (ERP), machines, warranty/AMC, tickets, feedback | Correct | `services/customers/view360.ts:112-152`. Tabs registered at `extensions/customers.tsx:168-197` | — | — |
| CUS-07 | "All activities on a single timeline" | Partial | `customer360.tsx:585-629` shows `activities` rows only, capped at 40 with no "more" | No status changes, quote sent/accepted, order, dispatch or ticket events. Merge the audit/events stream for the customer and its child records into the timeline, and paginate | Med |
| CUS-08 | Parent-child and dealer→end-customer | Correct | `customers.ts:56-57, 75-76`. Cycle and dealer-category checks (`extensions/customers.tsx:75-92`). 360 overview lists children and end customers (`view360.ts:178-179`) | — | — |
| CUS-09 | Credit limit, outstanding, overdue read-only from ERP | Simulated | `readOnly` fields (`customers.ts:60-63`), "Refresh from ERP" (`operations.ts:257-270`) | — | — |
| CUS-10 | Bulk transfer of accounts, open leads, opps, tasks | Correct | `operations.ts:102-159`, `/admin/ownership-transfer`. Preview, required reason, closed records keep their owner | — | — |
| CUS-10 | …"when territories change" | Partial | Transfer works for **all** of one user's records only (`previewTransfer(fromStaffId)`) | No way to move a subset (e.g. one territory's accounts). Add a territory/division filter to the transfer | Med |
| CUS-10 | History retained | Correct | Per-record `patchRecordIn` audit with reason (`operations.ts:151`) | — | — |
| CUS-11 | Key Account flag + one-page plan (objectives, contacts, open opps, risks, next review) | Correct | `customers.ts:58, 67-70`. Key Account Plan tab uses `openOpportunities` (`view360.ts:162`). A new review date cannot be in the past | — | — |
| CUS-12 | Customer-wise sales, machine history, dormant (configurable) | Correct | `services/reports/defs/customers.ts` (`customer-sales`, `machine-history`, `dormant-customers` using `policies.dormantDays`, editable at `modules/catalog/PolicyPages.tsx:400`) | — | — |
| CUS-12 | Warranty expiry, AMC renewals due | Correct | `services/reports/defs/installed.ts:81-149` | Filed under Installed Base reports, not Customer reports. Add cross-links | Low |
| LEAD-01 | Register a lead from an existing contact | Correct | `NewLeadPage.tsx:153-239`. Picking a company with one contact auto-selects it | — | — |
| LEAD-01 | …or a new contact / company inline, without leaving the screen | Correct | `NewLeadPage.tsx:161-271`, `rules.ts:183-247` (pre-validates the lead so no orphan company is left behind) | — | — |
| LEAD-01 | Auto-generated Lead ID | Correct | `idPrefix:'LD'`, `idFormat:'fy'` (`leads.ts:38-39`) | — | — |
| LEAD-01 | Fields: company, **multiple contact persons** | Missing | A lead has a single `contactId` (`leads.ts:48`) | Add `contactIds` (people) or a lead-contacts relation. Carry them to the opportunity | Med |
| LEAD-01 | Mobile, email | Correct (derived) | From the linked contact. Captured inline for a new contact | Not shown in the lead list or record header. A user has to open the contact to call. Show the contact's mobile/email in the lead header | Low |
| LEAD-01 | City, state, industry, segment, division, product interest | Correct | `leads.ts:49, 67, 86-89`. Defaults from the company (`extensions/leads.ts:44-46`) | — | — |
| LEAD-02 | Configurable source master with all listed sources | Correct | `masters.ts:127-139` (website, exhibition, referral, dealer, social, meta_ads, google_ads, indiamart, cold_call, walk_in, agency) | — | — |
| LEAD-02 | Exhibition → event name | Correct | `requiredWhen` (`leads.ts:53`), whitespace trimmed | — | — |
| LEAD-02 | Referral → referrer (customer / engineer / employee / dealer) | Correct | `leads.ts:54-66` | The `referrerCustomerId` picker for type "dealer" is not filtered to dealer/distributor | Low |
| LEAD-02 | Source "Dealer" records which dealer | Missing | No dealer field unless source=referral | Show `referrerCustomerId` (filtered to dealers) when source = dealer | Med |
| LEAD-02 | Source, campaign, referrer captured on **every** lead | Partial | Source required. Campaign is optional free text. Pool conversion and lead import never set campaign | Make campaign a master or pick-list and carry it from the pool contact and the import | Low |
| LEAD-03 | API/webhook capture: website, Meta, Google | Simulated | `services/catalog/integrations.ts:76-139` ("Simulate incoming lead", `/admin/integrations`) | — | — |
| LEAD-03 | …with duplicate check | Correct | Matches open leads on mobile/email, audits, notifies the owner (`integrations.ts:93-103`) | — | — |
| LEAD-03 | …with auto-assignment | Partial | Uses `pickOwner()`, the least-loaded sales user in the division (`integrations.ts:61-68`), **not** the configured Assignment Rules (`rules.ts:64-80`) | Call `autoAssign()` so the rules and round-robin apply to web leads | Med |
| LEAD-04 | IndiaMART capture | Simulated | Same simulator, channel `indiamart` (`integrations.ts:22`) | — | — |
| LEAD-05 | Bulk import of exhibition leads from Excel | Partial | `/leads/import`. CSV only (`ImportLeadsPage.tsx:116`). Row validation, duplicate warnings, event name for the whole batch (`rules.ts:605-673`) | No .xlsx. Whole-batch abort risk (see CUS-06 import row). Fallback owner `actor.staffId` (`rules.ts:656`) can fail the owner-division check and abort the batch | Med |
| LEAD-05 | Visiting-card scan at stall | Simulated | `scanVisitingCard` (`rules.ts:676-683`) | — | — |
| LEAD-06 | Product type (Machine/Ink/Paper/Fabric/Spares/Service) | Correct | `productType` master (`masters.ts:~115-125`; also includes "software") | — | — |
| LEAD-06 | Sub-type Textile/POD/Label/Other | Correct | `masters.ts:126` | Sub-type is offered for every product type (e.g. Ink). Show it only for Machine | Low |
| LEAD-06 | Dynamic spec fields; Textile: width, heads, fabric, capacity | Correct | `leads.ts:70-73` (`visibleWhen`, `clearWhenHidden`) | — | — |
| LEAD-06 | Other sub-types to be finalised | Deferred (OK) | Placeholders `leads.ts:74-80` (Q-11) | — | — |
| LEAD-07 | Manual assignment from a division-filtered employee list | Partial | New Lead page filters by division (`NewLeadPage.tsx:58`). Sales execs cannot reassign (`leads.ts:294`) | The edit form's owner picker is not division-filtered (`leads.ts:50` only excludes inactive). The wrong choice is rejected only on save. There is no bulk reassign on the lead list, although REQUIREMENTS claims "list bulk action" (bulk tools offer only status transitions, `pages/ResourcePage.tsx:170-249`) | Med |
| LEAD-07 | Rule-based auto-assign by division, product, territory/hub | Partial | `rules.ts:64-80` | Territory is matched at **state** level (`territoriesOfState(lead.state)`). Any rule for any hub in that state matches, so an Ahmedabad rule catches Surat leads. Sales users creating leads always own them and skip the rules (`rules.ts:85-88`). Store `territoryId` on the lead (from the company) and match it exactly | Med |
| LEAD-07 | Round-robin within team | Correct | `rrPointer` rotation (`rules.ts:72-76`) | — | — |
| LEAD-07 | Hierarchy: managers see their team's leads | Correct | `team` scope through `actor.teamStaffIds` (`services/authz.ts:121-122`). sales_manager leads = team (`leads.ts:280`) | — | — |
| LEAD-08 | Configurable first-contact SLA | Correct | `policies.leadFirstContactHours`, editable at `modules/catalog/PolicyPages.tsx:349` | — | — |
| LEAD-08 | Untouched leads escalated to reporting manager | Correct | `sweepLeads` (`rules.ts:399-437`): notifies manager and owner once, audits `sla.escalated` | Escalation is in-app only (no email/WhatsApp). Runs in the browser on store changes, which is acceptable for a simulation | Low |
| LEAD-08 | "Not attended leads" dashboard | Correct | `/not-attended-leads` (`NotAttendedLeadsPage.tsx`), `notAttendedLeads()` (`rules.ts:469-497`) | — | — |
| LEAD-09 | Log calls, emails, WhatsApp, meetings | Correct | `LogActivityDialog` with the activityType master (`masters.ts:151-159`) | — | — |
| LEAD-09 | Next follow-up date mandatory on every update | Correct | Enforced in the service for activities (`extensions/leads.ts:70-77`) and the lead form (`requiredWhen` + `dateRule:'future'`, `leads.ts:91-96`). Follow-up date copied to the lead (`extensions/core.ts:28-39`) | Field visits (`visit`) are exempt by design | — |
| LEAD-09 | Automatic reminders: app push, email, WhatsApp | Partial | In-app + simulated push, once a day (`rules.ts:422-432`) | No email or WhatsApp reminder queued. Add `queueMessage` for email and WhatsApp (respecting consent and owner preferences) | Low |
| LEAD-09 | Overdue follow-up list and notifications | Correct | `/follow-ups` (`FollowUpsPage.tsx`, `followUpsFor` `rules.ts:515-541`), overdue banner (`LeadActions.tsx:368-373`), view `v_leads_followups` | — | — |
| LEAD-10 | BANT-lite: requirement, budget, decision maker, timeline, current set-up | Correct | Required in the Convert dialog (`rules.ts:290-309`, `LeadActions.tsx:123-227`). Stored on the lead | Decision maker is free text instead of a pick from the company's contacts with buying role = decision maker | Low |
| LEAD-10 | Converted to Opportunity "carrying all data and history" | Partial | Activities are carried (timeline), plus a subset of fields (see §3.1) | Fields missing (see §3.1). The lead's change history and comments are not visible from the opportunity. Add "Lead details" and "Lead history" sections to the opportunity | High |
| LEAD-10 | Lead marked converted / locked; back-link | Correct | status=qualified, `opportunityId` set, `statusNote` (`rules.ts:352`). Success banner links to the opportunity (`LeadActions.tsx:343-349`). Opportunity has read-only `leadId` (`opportunities.ts:124`) | — | — |
| LEAD-11 | Mandatory disqualify reason from master | Correct | `rules.ts:382-390`, `lostReason` master (no budget, bought competitor, not reachable, duplicate, not relevant, price, postponed, other). "Other" needs a note | Lead disqualification shares the opportunity "lost reason" master. Fine, but it cannot be configured separately | Low |
| LEAD-11 | Nurture with future re-contact date | Correct | `rules.ts:371-379`. Reminder on the date (`rules.ts:426`). Banner (`LeadActions.tsx:362-367`) | A nurture lead is not reopened automatically on the date (only a reminder is sent), and the user must click "Reactivate" before converting | Low |
| LEAD-12 | Referrer recorded | Correct | `leads.ts:54-66` | — | — |
| LEAD-12 | Referrer notified on conversion | Correct | Employee/engineer in-app, customer/dealer WhatsApp (simulated outbox) (`rules.ts:358-363`) | — | — |
| LEAD-12 | Referral report | Correct | `reports/defs/leads.ts` `referrals` (group by referrer / type) | — | — |
| LEAD-13 | Rule-based scoring (source, segment, budget, timeline, engagement) | Correct | `leads/computed.ts:23-48`, admin `leadScoringRules` | — | — |
| LEAD-14 | Conversion % month-wise, salesperson-wise, product category, source, campaign | Correct | `reports/defs/leads.ts:23-70` | — | — |
| LEAD-14 | …by product **sub-category** | Missing | `groupOptions` has no subType (`reports/defs/leads.ts:36-42`) | Add a `subType` grouping | Med |
| LEAD-14 | Lead ageing | Correct | `lead-speed/ageing` | — | — |
| LEAD-14 | First-response time | Partial | `lead-speed/response` uses `firstContactAt` | Leads converted or disqualified straight from New without a logged activity have no `firstContactAt` and are counted as never contacted (see App. A) | Low |
| LEAD-14 | Pending follow-ups | Correct | `lead-speed/followups` | — | — |
| LEAD-14 | Lost/disqualified leads with reasons | Correct | `lost-leads` (`reports/defs/leads.ts:188+`) | — | — |
| LEAD-14 | Sales executive performance | Correct | `exec-performance` | — | — |

#### Verdict counts (95 clause rows)
- **Correct: 61** (includes 1 "Correct (derived)")
- **Partial: 23** (includes 1 "Simulated / Partial", geo-tag)
- **Missing: 4** (documents carried to the opportunity, multiple contacts per lead, dealer captured for source Dealer, conversion by sub-category)
- **Simulated: 6** (phone book, OCR, ERP, web/Meta/Google capture, IndiaMART, card scan at stall)
- **Wrong: 0** as outright failures. The closest are the state-level territory matching (LEAD-07), web leads ignoring the assignment rules (LEAD-03) and conversion from New skipping Contacted, all marked Partial/Med
- **Deferred (accepted): 1** (non-textile spec fields, Q-11)

---

### History & linking findings

#### 1. Does opening a Lead show its full history and linked records?
**No.** A lead opens in the generic `RecordInspector` (`src/components/resource/RecordInspector.tsx`), at `/leads/:id` or the drawer peek. Leads register no tabs of their own; only actions and a banner (`extensions/leads.ts:89-90, 110-111`). The tabs are:

| Tab | What it shows | Problem |
|---|---|---|
| Details | Field values | — |
| Related | (a) "Linked to": every filled relation field (customer, contact, owner, referrer, **opportunity**) as links (`RecordInspector.tsx:498-517`). (b) The relationship `rel_lead_activities`, labelled **"Activity History"** (`leads.ts:108`) | The activity list is capped at **8**, shows only ID + subject + no date/by/notes. It is **sorted by `titleField` (subject) descending**, i.e. reverse-alphabetical, not by time, because activities have no `calendar.startField` (`RecordInspector.tsx:530`, `domain/resources/core.ts:181`). It also offers a generic "+ New" that opens a QuickCreate for activities, which bypasses the "Log Follow-up" dialog |
| Activity History (generic) | The audit trail: create, field edits with before→after, status transitions (`rules.ts:264-271`), SLA escalation, "Activity ACT-x logged" workflow patches, actor name, **relative** time only (`RecordInspector.tsx:581-626`) | The label clashes with the "Activity History" section under Related. The rename to "Change History" only happens when a module registers a tab with that label (`:134`), which leads do not. Calls and meetings themselves (subject/notes/outcome) are **not** in this feed. No absolute date/time is visible |
| Comments | Internal comments | Separate from everything else |

So the history is split over three places, none of them complete, and the actual follow-ups appear in the wrong order.

**Linked downstream records:**
- **Opportunity**: yes. A clickable link appears in the Qualified banner (`LeadActions.tsx:343-349`), in the record action "Open Opportunity OPP-…" (`LeadActions.tsx:37-41`) and as the `opportunityId` field (visible only when status = qualified, `leads.ts:100`).
- **Quotations / Sales Order / Contract**: **not shown on the lead at all.** The opportunity itself lists only Demos and Sample Requests as relationships (`opportunities.ts:132-135`). An order is reachable only through the "Open Sales Order" action once the opportunity is Won (`extensions/opportunities.tsx:157-175`). There is no Quotations list on the opportunity record. From a lead, the chain Lead → Opp → Quote(s) → SO cannot be followed in one place.
- **Source contact (pool)**: reachable through the `contactId` link. The contact shows a "Converted → Open lead" banner (`components.tsx:298-304`).

**Fix:** register a lead tab, "Timeline", that merges activities (with type, by, date, notes and next follow-up), audit transitions/edits and comments in time order. Rename the generic tab to "Change History" for leads. Sort Related activities by `at` desc. Add a "Deal chain" panel on lead and opportunity: Lead → Opportunity (stage) → Quotations (status, version, value) → Sales Order (status) → Contract, each clickable. Show absolute timestamps (DD-MM-YYYY HH:mm IST) next to the relative ones.

#### 2. Lead → Opportunity conversion
- **Carried over** (`rules.ts:321-345`): name (typed by the user), customerId, contactId, leadId, divisionId, productType, oppType (machine→new_machine, else consumables), requirement→notes, value, expectedCloseDate (suggested from the timeline), currentSetup→competitors, decisionMaker→decisionMakers, ownerId, nextFollowUpAt (or +3 days), lastActivityAt. BANT answers are written back onto the lead.
- **Not carried**: sourceId, campaign, eventName, referrer*, subType, every spec* field (print width, heads, fabric, capacity …), budget, timeline, city/state/segment/industry, comments, the change history and documents. The quotation step therefore has no machine specs to start from unless the user opens the old lead. `oppType` maps service/spares leads to "consumables", which is wrong for Service.
- **Lead locked**: yes. status = `qualified` is terminal, `beforeUpdate` throws `qualifiedReadOnly`, Edit is disabled with a reason, delete is blocked by the reference, Log Follow-up/Nurture/Disqualify are hidden, and the Sales workspace hides the lead in favour of the opportunity (`services/sales.ts:11`).
- **Back-link**: lead → opp (banner, action, field) and opp → lead (`leadId`, read-only relation, and "from lead LD-…" tags in the opp Timeline). Both work.
- **Notifications**: the owner is notified when someone else converts. The referrer is notified (LEAD-12).
- **Guard**: allowed from New *or* Contacted, so "Contacted" can be skipped (see App. A). Double-submit is guarded (`LeadActions.tsx:139-156`). Version conflicts are checked (`rules.ts:257`).

---

### UX confusion points (first-time user)
1. **Two things called "Activity History"** on a lead: a section in the Related tab (the actual calls, in reverse-alphabetical order) and a tab (actually the audit/change log). A new user will open the tab and not find their call.
2. **No "what next" guidance on a New lead.** Actions shown: Log Follow-up, Convert to Opportunity (primary), Nurture, Disqualify. Nothing says "log your first contact to move to Contacted". The primary button invites converting straight from New. Make Log Follow-up primary while status = New, and add a one-line stage hint ("Step 2 of 8 · Qualification").
3. **Lead title = company name** (`titleField:'customerId'`, `leads.ts:40`). Several leads for one company look identical in lists, the board, notifications and the Sales workspace. Use "Company · Product/Sub-type" as the title.
4. **The contact's phone/email are not on the lead screen.** The user who has to make the call must click through to the contact.
5. **Nurture leads cannot be converted** until "Reactivate" is clicked. Convert is hidden for Nurture with no explanation (`LeadActions.tsx:50`).
6. **Owner picker on the lead edit form lists every employee.** Choosing one outside the division fails only on save, while the New Lead page filters correctly. The behaviour is inconsistent.
7. **Edit button behaviour differs**: the header Edit opens the full-page form (`fullPage:true`), but the footer Edit in the drawer opens inline edit (`RecordInspector.tsx:125 vs 155/166`).
8. **Sales workspace strings are hard-coded English** (`SalesWorkspacePage.tsx`, `SalesWorkspaceTabs.tsx`: "Leads & Opportunities", "New Lead", "Open Opportunity", "All stages"…). This breaks the labels.ts/glossary rule, and "Stage" mixes lead statuses with opportunity stages in one filter.
9. **Contact Pool shows inline-created lead contacts as "Converted"** (`rules.ts:237`, `pool.ts:21`). Contacts that never sat in the pool show up there, which confuses the pool's meaning.
10. **Error placement in New Lead inline contact**: the duplicate mobile/email error (`fieldErrors.mobile`) never lands under the field (the page expects `contact.mobile`). The user sees only a top banner.
11. **Integration simulator is admin-only** (`integrations.manage`). A sales demo user cannot see a web lead arrive unless the role is switched.
12. **Merge page**: contact duplicates are listed, but there is no action, only a hint. This looks like a dead end.

---

### Top 10 fixes ranked
1. **Lead Timeline tab (High)**: one chronological feed on the lead with activities (type, by, absolute date/time, notes, next follow-up), status changes, edits and comments. Rename the generic tab to "Change History". Sort Related activities by `at`. (`RecordInspector.tsx:530, 134`; new `registerRecordTab('leads', …)`)
2. **Carry all lead data to the opportunity (High)**: copy source/campaign/event/referrer/subType/spec*/budget/timeline, or show a read-only "From lead" section on the opportunity. Fix the `oppType` mapping for service/spares. (`rules.ts:321-345`, `opportunities.ts`)
3. **Deal-chain panel (High)**: Lead → Opportunity → Quotation(s) → Sales Order → Contract with clickable status chips, on both the lead and the opportunity. Add a Quotations relationship to opportunities. (`opportunities.ts:132`)
4. **Enforce New → Contacted before Qualify, or stamp `firstContactAt` on conversion (Med)**: keeps the Appendix A order and the first-response KPI correct. Make Log Follow-up the primary action on New leads. (`rules.ts:318`, `LeadActions.tsx:50-53`)
5. **Fix auto-assignment (Med)**: store `territoryId` on the lead and match the rule's territory exactly, and route web/IndiaMART leads through `autoAssign()` instead of `pickOwner()`. (`rules.ts:57,67`; `integrations.ts:105`)
6. **Make lead import and the engineer referral robust (Med)**: per-row errors instead of whole-batch aborts (cross-company duplicate contacts, owner-division failures); fall back to `autoAssign` when the customer owner is outside the division. (`rules.ts:644-671`, `tickets.ts:380`)
7. **Multiple contact persons on a lead (Med)**, carried to the opportunity. Show the primary contact's mobile/email/WhatsApp in the lead header. (`leads.ts:48`)
8. **Dealer source captures the dealer (Med)**, and the referrer picker for type "dealer" is filtered to dealers/distributors. (`leads.ts:54-66`)
9. **Duplicate handling gaps (Med)**: live fuzzy (Dice) warning on the Company create form, contact merge, per-record merge audit, and one shared matcher instead of `rules.ts:138` substring. (`components.tsx:276`, `operations.ts:60-67`, `pages.tsx:335`)
10. **Reporting and transfer gaps (Med)**: conversion by sub-category (`reports/defs/leads.ts:36`); a territory filter on Ownership Transfer (`operations.ts:127-159`); a full Customer 360 timeline including transactions and status events, with pagination (`customer360.tsx:585-629`).


---

## Part B-opp-quote-order

## Audit B — Opportunity, Quotation, Sales Order & Contract (BRD §4.3, §4.4, §4.5, App. A, §3.1)

Repo: `/Users/maysolanki/Documents/True-Color/tc_frontend` (branch feature/crm-modules). Read-only audit; every verdict comes from tracing the code. docs/REQUIREMENTS.md statuses were not trusted.

Abbreviations: `opp.ts` = src/domain/modules/opportunities.ts · `oppSvc` = src/services/opportunities/index.ts · `oppExt` = src/domain/extensions/opportunities.tsx · `qt.ts` = src/domain/modules/quotations.ts · `qwf` = src/services/quotations/workflow.ts · `qExt` = src/domain/extensions/quotations.ts · `qRec` = src/modules/quotations/RecordExtensions.tsx · `so.ts` = src/domain/modules/orders.ts · `osvc` = src/services/orders/orders.ts · `rt` = src/services/runtime.ts · `RI` = src/components/resource/RecordInspector.tsx · `pol` = src/services/policies.ts

Severity: **Critical** = data integrity / wrong deal outcome · **High** = Must requirement broken or confusing in a demo · **Medium** = partial · **Low** = cosmetic.

### 1. Compliance matrix

#### §4.3 Opportunity & Pipeline

| BRD ID | Clause | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| OPP-01a | Opportunity created on lead qualification | Correct | src/services/leads/rules.ts:312-346 `qualifyLead` → `insertRecordIn('opportunities', {leadId, customerId, contactId, value, decisionMakers, competitors…})` | — | — |
| OPP-01b | …or directly for existing customers (additional machine, upgrade, consumables contract, AMC) | Correct | opp.ts:52-59 `oppType` master (new_machine, additional_machine, upgrade, consumables, amc, renewal); quick-create form opp.ts:151; route `/opportunities` | — | — |
| OPP-01c | Fields: products | Partial | opp.ts:103-104 a single `productType` and a single `productId` | BRD says "products" (plural). Add a multi-product field (relation list), or show a read-only product summary taken from the selected quotation's lines. | Medium |
| OPP-01d | value, expected close date, stage, probability, competitors, owner, decision makers | Correct | opp.ts:105-118. `competitors` and `decisionMakers` are free text. | Decision makers could link to contacts (nice to have). | Low |
| OPP-02a | Configurable stages | Partial | Stages are master values (opp.ts:44-51), but the transitions are hard-coded (opp.ts:141-148). Probabilities are configurable (pol:74, PolicyPages.tsx:352). | A stage added in Masters gets no transitions. Document this as "stage labels/probabilities configurable; flow fixed", or drive the transitions from config. | Medium |
| OPP-02b | Entry/exit criteria | Partial | oppSvc:38-46 `checkStageEntry`: Proposal needs value>0, Negotiation needs a quotation, Won needs an accepted quotation and value. Enforced up front through `transitionBlocked` (oppExt:51-58) and again in `beforeTransition` (oppExt:75-76). | Demo has no entry criteria and no stage has exit criteria. The rules are in code and cannot be configured. | Medium |
| OPP-02c | Default flow NA → Demo/Sample → Proposal → Negotiation → Won/Lost | Correct | opp.ts:40-51, 141-148 (free movement between open stages, Lost through the dialog, admin Reopen) | — | — |
| OPP-02d | Stage-wise probability drives the weighted forecast | Correct | oppExt:78 sets `probability = stageProbability(to)` on each transition. Computed field `weightedValue` at opp.ts:108-113. Forecast at oppSvc:201. | The probability can still be edited by hand (opp.ts:107), so it drifts from the stage until the next move. That is acceptable as an override, but no audit flag marks it. | Low |
| OPP-03a | Kanban with drag & drop between stages | Correct | src/modules/opportunities/PipelinePage.tsx:224 `BoardView boardField="stage"`. BoardView uses `useStageMove`, which runs guarded transitions, and dropping on Lost opens MarkLost (oppExt:266-269). Route `/pipeline`. | — | — |
| OPP-03b | List view | Correct | PipelinePage.tsx:32 LIST_COLUMNS, plus `/opportunities` saved views (opp.ts:159-206) | — | — |
| OPP-03c | Filter by division, owner, stage, hub, product category, close month | Correct | PipelinePage.tsx:58-63, 164-171; oppSvc:297-308 (hub = `territoryId`) | — | — |
| OPP-04a | Book demo at demo centre or customer site | Correct | opp.ts:234-309 `demos` (location centre/site; machine required only at the centre) | — | — |
| OPP-04b | Demo machine calendar | Correct | `/demo-machine-calendar`, oppSvc:252-279 (other owners' bookings appear as busy slots). Double booking blocked at oppExt:96-118. | — | — |
| OPP-04c | Sample print request to Profiling with artwork/fabric details | Correct | opp.ts:311-371 (assignee limited to the `profiling` role; artwork required). Assignee notified at oppExt:139. | — | — |
| OPP-04d | Results and customer feedback recorded against the opportunity | Correct | opp.ts:274-275, 337-338. Results are required to mark a demo Done or a sample Results Shared (oppExt:124-126, 140-142). Shown in the opportunity's Related tab (opp.ts:132-135). | — | — |
| OPP-05a | Marking Won enables "Generate Sales Order" | Correct | oppExt:168-177 shows the button only when stage = won, links to the existing SO if there is one, and is disabled without an accepted quotation | — | — |
| OPP-05b | Lost requires a lost reason and the competitor/price lost to | Correct | oppSvc:56-95 `markLost` requires reason and competitor; price is optional. MarkLostDialog. | **Lost does not cascade to the opportunity's open quotations** (see §2). | High |
| OPP-06 | Stagnation alert: not updated for N configurable days, or past expected close | Correct | opp.ts:74-79 `isStagnant`; days from policy (oppExt:34). Banner at oppExt:191-214; owner and manager notified by `sweepStagnation` (oppSvc:101-118); stagnant view opp.ts:178-186. | The sweep runs only when an opportunity record is opened (oppExt:190-196). Run it at app start-up as well. | Low |
| OPP-07 | Monthly/quarterly forecast (weighted and commit) by user, division, product category | Correct | oppSvc:176-216 `computeForecast`; `/sales-forecast` | Commit = Negotiation + Won (an assumption, which the code documents). | Low |
| OPP-08a | Tasks & calendar for meetings, demos, follow-ups | Correct | `/calendar` (src/modules/calendar/CalendarPage.tsx) | — | — |
| OPP-08b | Two-way sync with Google/Outlook | N/A-frontend | Not built | Mark as N/A-frontend in REQUIREMENTS; it is already noted there. | — |

#### §4.4 Quotation Management

| BRD ID | Clause | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| QUO-01a | Auto quotation number, division-wise series | Correct | qwf:149-155 `QT/<DIV>/<FY>/0001`; revisions append `-R<n>` (qwf:447) | — | — |
| QUO-01b | Date, validity, customer, contact, sales executive, linked opportunity | Correct | qt.ts:83-90 (opportunity required; customer, division and contact derived from it at qwf:83-86). Validity default comes from policy (qwf:93); `validUntil ≥ quoteDate` is checked at qt.ts:89. | — | — |
| QUO-02 | Product from the product & price master: model, configuration (width, heads, specs), accessories, options | Correct | `productOptions` qwf:232; line types machine/configuration/accessory (qt.ts:43-56); price locked from the price list (qwf:40-47). Product specs at catalog.ts:66-76. | Configuration lines are free-text lines, not structured options of the model. | Low |
| QUO-03 | Software (RIP), ink, consumables, spares kit, installation, training, extended warranty, AMC | Correct | qt.ts:43-56 (12 line types) | — | — |
| QUO-04a | Quantity, list price, discount % or amount | Correct | pricing.ts:10-55 `QuoteLine`, `lineAmounts` (amount discount takes precedence) | — | — |
| QUO-04b | Freight/insurance | Correct | qt.ts:102-103; totals at pricing.ts:113 | — | — |
| QUO-04c | GST auto (CGST+SGST vs IGST by place of supply) with HSN/SAC | Correct | pricing.ts:80-90, 113-146; HSN required at pricing.ts:169; totals recomputed in the hook (qwf:104) | — | — |
| QUO-04d | Total value and amount in words | Correct | pricing.ts:97, 146; on the PDF (QuotationPdfPage.tsx:134-137) | — | — |
| QUO-05 | Price lists by division/product with validity; only authorised roles; sales cannot edit list price | Correct (quote side) | qwf:40-47 overwrites with the price-list price; qwf:126-142 `listPriceErrors` rejects off-list prices from non-maintainers | The price-list module itself was outside this audit. | — |
| QUO-06a | Discount approval with configurable thresholds **by division/product** | Partial | pol:76-81 has **global** bands by highest line discount % only. PolicyPages.tsx:198-233 edits bands, with no division or product dimension. | Add `divisionId?` and `productType?` to bands and match the most specific one first. | High |
| QUO-06b | Approver levels SM/RM → GM/VP → MD | Correct | approvalLevels.ts (named reporting manager at L1, escalates when a level is empty); qwf:311-316 | — | — |
| QUO-06c | Approve/reject from web with comments | Correct | `/quotations/pending-approvals`; a reject comment is required (workflow.ts:138); each level is audited (workflow.ts:147, 157) | — | — |
| QUO-06d | …from mobile or email link | Partial / Missing | Mobile works only as responsive web. **No email-link approval** (grep finds no token or link flow), although REQUIREMENTS claims "simulated". | Simulate it: queue an outbox email with a `/approve/:token` deep link that opens a one-click approve/reject page. | Medium |
| QUO-06e | Reminders if pending | Correct | qwf:467-494 `runQuotationSweep` reminds after 24 h; scheduled at qExt:63-79 | — | — |
| QUO-07 | Commercial terms from templates (payment, delivery, warranty, installation, validity), editable within permissions | Correct | qt.ts:208-244 `termsTemplates` per division; copied to the quote at qwf:95-100; editable in Draft (qwf:53) | Validity is not part of the template; it comes from the policy default. | Low |
| QUO-08a | Branded PDF templates per division | Simulated | QuotationPdfPage.tsx:24-60 `BRAND` accent per division; printed through the browser | — | — |
| QUO-08b | Attach technical specs, brochures, other documents | Missing | DocumentsTab (qRec:756-784) lists only the generated PDF, the ROI and the PO copy. Nothing can be attached. | Add an attachments list (file metadata, simulated) on the quote, and default brochure/spec files from the product master. | Medium |
| QUO-08c | Send by email/WhatsApp with sent date logged | Simulated | qwf:337-366 `sendQuote` (outbox, consent check, `sentAt`/`sentVia`, activity) | **The send is allowed on non-selected sibling quotations** (see §2). | Critical |
| QUO-09a | Versions R0, R1… | Partial | Number suffix `-R<n>` (qwf:447), but the Versions tab labels them **"v1, v2"** (qRec:733) | Label as `R{revision}` to match the BRD and the quote number. | Low |
| QUO-09b | Change log | Correct | Revision note is required (qwf:436). Audit records `version.created` and superseded (qwf:439, 454); the record Changes tab shows the audit (RI:582-625). | — | — |
| QUO-09c | Side-by-side comparison of versions | Correct | `/quotations/:id/compare` (CompareVersionsPage.tsx:45-50, `compareLines` qwf:598-609) | Only versions of the **same root** can be compared; sibling alternatives on one opportunity cannot. | Medium |
| QUO-09d | Only the latest version is active | Correct | `reviseQuote` sets the old version to `superseded, isLatest:false` (qwf:439). Every action calls `load()`, which rejects non-latest (qwf:256). Edits are blocked at qwf:163. The banner explains it (qRec:537-541). | Covers revisions only, **not sibling quotations** (see §2). | — |
| QUO-10a | Statuses Draft, Pending Approval, Approved, Sent, Under Negotiation, Accepted, Rejected, Expired | Correct | qt.ts:19-36 (adds `superseded`) | A "Not selected / Lost to Qx" status is missing (see §2). | High |
| QUO-10b | Expired automatically when validity ends | Correct | qwf:471, 479-482 (sweep on every store change, against the simulated clock) | — | — |
| QUO-11 | Customer acceptance by PO upload or electronic acceptance | Simulated | qwf:379-417 `acceptQuote` (PO number, date and file type/size, or accepted-by name). Creating an order from an approved/sent quote also counts as acceptance (osvc:509-514). | Acceptance is **allowed on a Lost opportunity** (qwf:410-412 only writes an audit warning), which leaves an accepted quotation that can never be ordered (osvc:118-119). | High |
| QUO-12 | Landed cost / margin only for authorised roles | Correct | qt.ts:111-112 `sensitivity:'financial'`; masked in `getQuote` (qwf:196-202) | — | — |
| QUO-13 | ROI / payback calculator that can be attached to the quotation | Partial | RoiTab (qRec:786-862) saves its inputs on the quote; DocumentsTab lists "ROI" with no link | The ROI is not printed on the quotation PDF or sent with it. Add an optional ROI page to the PDF. | Low |
| QUO-14a | Report: quotation value | Correct | src/services/reports/defs/quotations.ts:19-60 | Sums **all latest sibling quotes**, so alternatives for one deal inflate the value. Count only the selected or most recent quote per opportunity, or add a toggle. | Medium |
| QUO-14b | Pending approvals | Correct | `/quotations/pending-approvals` (qwf:533-568) | — | — |
| QUO-14c | Quote-to-order conversion | Correct | quotations.ts:53-54 (ordered/sent) | Unselected siblings stay in the "sent" denominator, which lowers the rate. | Low |
| QUO-14d | Lost quotations with reasons | Partial | quotations.ts:73-110 (rejected + expired) | Siblings that lost to the selected quote expire silently and show as "Expired", not "Not selected". | Medium |
| QUO-14e | Discount analysis by user/division | Correct | quotations.ts:114-145 | — | — |

#### §4.5 Sales Order & Sales Contract

| BRD ID | Clause | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| SO-01a | "Generate Sales Order" available once the opportunity is Won | Partial (deliberate deviation) | oppExt:168-177. The button also appears on Approved/Sent/Negotiation quotations (qRec:97-118), and `quotationBlocker` accepts those statuses (osvc:108-131). Creating the order then marks the quote Accepted and the opp Won (osvc:509-514). | This is an owner decision (REQUIREMENTS FR-049), so it is acceptable. However, this path **does not sync the opportunity value** to the quote total (osvc:513, unlike qwf:409) and **does not close siblings**. | High |
| SO-01b | Customer, products, rates, terms pulled from the accepted quotation | Correct | `draftFromQuotation` osvc:201-231; `sanitizeLines` keeps reference prices (osvc:318-348) | — | — |
| SO-02 | Auto order number, customer PO number/date, PO copy upload (mandatory), linked quotation | Simulated | osvc:409-415 `SO/<DIV>/<FY>/0001`; `validatePo` osvc:288-298 (required, no future date, type/size); `quotationId` stored (osvc:492). Only file metadata is stored. | — | — |
| SO-03a | SO can be customised (product, model, version, price, discount) | Partial | osvc:318-348: qty, discount and add/remove product are allowed. **Price is never editable** (always from the reference or the price list). | Allow a price override with a reason, which then triggers approval when it crosses the tolerance. Otherwise document that only discount changes are allowed. | Medium |
| SO-03b | Differences from the quotation highlighted | Correct | `diffLines`/`describeDiff`, `DiffAlert` (NewOrderPage.tsx:268), `changeSummary` field | — | — |
| SO-03c | Changes beyond tolerance re-trigger approval | Correct | osvc:553-568 (lines added/removed, value change beyond `soTolerancePct`, discount increase) | — | — |
| SO-04a | Approval by the direct reporting manager per hierarchy | Correct | osvc:361-382 `managerLevel` / `orderManagerLevel` (named approver; skips self) | — | — |
| SO-04b | Finance check on credit/advance terms | Correct | osvc:371-377, 395-406 (advance below policy % or customer overdue triggers the Finance level) | — | — |
| SO-04c | Multi-level approval matrix configurable | Partial | Levels hard-coded: manager (+ finance) (osvc:405) | Add an order approval-band policy by value and division, similar to `discountBands`. | Medium |
| SO-05a | After approval, "Generate Sales Contract" button | Correct | contracts.ts:56-62 (blocked while pending/cancelled); OrderTabs.tsx:593-594 | — | — |
| SO-05b | Contract with all SO details + payment, delivery, loading/unloading, installation, warranty, spares, ink commitments & prices, AMC | Correct | so.ts:290-330 (all term fields); generated from division templates at contracts.ts:68-86 | — | — |
| SO-05c | Templates per division, versioned, PDF output | Simulated | `DIVISION_TEMPLATES` (contracts.ts:32); versions with superseding (contracts.ts:65-67); `/sales-orders/:id/contract/pdf` | — | — |
| SO-06 | Customer e-signature | Simulated | contracts.ts:99-127 (OTP shown on screen) | — | — |
| SO-07a | Payment schedule: advance, milestones, balance, due dates | Correct | `defaultSchedule` osvc:419; `saveSchedule` osvc:714 | — | — |
| SO-07b | Receipts/outstanding synced from ERP | Simulated | `recordReceipt` osvc:748 (manual "receipt", gated by the `orders.receipts` capability) | — | — |
| SO-07c | Reminders to salesperson (and optionally customer) before/after due dates | Correct | osvc:774-820 (owner notification; WhatsApp to a consenting contact) | — | — |
| SO-08 | Order processing status by Import/SCM (PO to principal, ETA, customs, readiness, PDI) | Correct | so.ts:62, 119-126; SCM-only edit through fieldOverrides (so.ts:483-490); `/order-processing` | — | — |
| SO-09 | Approved SO pushed to ERP; invoice number/date and e-way bill returned | Simulated | `erpPushedAt` set on approval (osvc:615); `pushToErp` osvc:671 fills the invoice fields | — | — |
| SO-10 | Order hold/cancellation with reasons and approval | Correct | osvc:648-668 (reason ≥ 5 chars; cancel goes up to the division head); `onCancelApproved` osvc:638-644 | Cancelling does not write anything back to the quote or opportunity (they stay Accepted/Won). Acceptable, but show "Order cancelled" on the opportunity. | Low |
| SO-11 | Reports: order value, backlog, pending, delayed dispatch, payment status/overdues, sales performance | Correct | src/services/reports/defs/orders.ts (order-value incl. owner, order-backlog with awaiting/delayed views, payment-status) | — | — |

#### Appendix A workflows and §3.1 hand-offs

| Ref | Clause | Verdict | Evidence | Gap / fix | Severity |
|---|---|---|---|---|---|
| App A – Opp | NA → Demo/Sample → Proposal → Negotiation → Won \| Lost | Correct | opp.ts:136-149 | Admin can Reopen a won opportunity even when a live SO exists (opp.ts:147). Block Reopen while an order exists. | Medium |
| App A – Quote | Draft → Pending Approval → Approved → Sent → Under Negotiation → Accepted \| Rejected \| Expired | Correct (with shortcuts) | Auto-approve within the first band (qwf:290-293); accept straight from Approved through order creation (osvc:510) | Sibling quotes have no terminal state when a sibling wins. | High |
| App A – SO | Confirmed → Payment Pending/Received → Processing → Ready → Dispatched → Delivered → Installation → Completed (Hold/Cancelled w/ approval) | Correct | so.ts:26-30, 138-151 (plus a leading Pending Approval) | — | — |
| §3.1 | Lead qualified → Opportunity with all lead data, activities and documents | Partial | rules.ts:321-346 copies the data and keeps `leadId`; the opp Timeline merges the lead's activities (oppExt:216-223) | Lead documents are not carried over (there is no document concept). | Low |
| §3.1 | Quotation accepted / opp Won → "Generate SO" enabled; SO pre-filled from quotation | Correct | qwf:406-410; oppExt:168-177; osvc:201-231 | Siblings are not deactivated (see §2). | Critical |
| §3.1 | SO approved → "Generate Sales Contract" enabled; SO pushed to ERP | Correct | osvc:603-617; OrderTabs.tsx:593 | — | — |

**Counts (65 clauses):** Correct 44 · Partial 14 · Simulated 7 (+2 noted as simulated inside other rows) · Missing 1 (QUO-08b) + 1 half-missing (QUO-06d email link) · Wrong 0 as written. Rated as behaviour, the sibling-quotation handling, acceptance on a Lost opp, and the missing opp-value sync on the order path are **Wrong** behaviours (see §2).

---

### 2. Quotation selection — current behaviour & required guards

#### Data model today
- **Revisions** share a `rootId`, with `revision` 0..n, `isLatest`, and status `superseded`. `reviseQuote` (qwf:430-457) supersedes the old version, sets `isLatest:false` and withdraws its pending approval. Every write calls `load()`, which rejects non-latest versions (qwf:256). Edits are blocked at qwf:163. **For revisions, the BRD rule "only the latest is active" holds.**
- **Sibling quotations / variants** are separate roots with the same `opportunityId`. There is **no "selected", "variant" or "not selected" concept** anywhere: no field, no status, no label. grep for `selected|notSelected|variant` in quotations finds nothing.
- `superseded` is used only for older revisions.

#### What happens when one quotation is accepted
Two acceptance paths exist:
1. `acceptQuote` (qwf:379-417), from the Mark Accepted button, the list status chip or the board drag (qExt:33-36):
   - It refuses when **another quote on the opportunity is already `accepted`** (qwf:385-386), so **two quotes cannot both be Accepted**.
   - It sets the opportunity to Won with probability 100 and **value = accepted quote grandTotal** (qwf:409).
   - It **does nothing to sibling quotations.** Siblings stay Draft, Pending Approval, Approved, Sent or Negotiation, and their pending approval requests stay open.
2. `createOrder` from an Approved/Sent/Negotiation quote (osvc:508-514):
   - It marks that quote Accepted and the opportunity Won with probability 100, but **does not update `opportunity.value`** to the quote or order total. The won value stays the early estimate, which corrupts the forecast "won", the pipeline and the dashboards.
   - It **does nothing to siblings.**

#### What a non-selected sibling can still do after another quote was accepted / the opp is Won

| Action on sibling | Code path | Result today | Expected |
|---|---|---|---|
| Edit draft lines/header | `saveQuote` → `quoteBeforeUpdate` (qwf:158-166) → `derive(isNew=false)` has no opp-stage check | **Allowed** | Block |
| Submit for approval | `submitQuote` (qwf:281-308), no opp/sibling check | **Allowed**; the approval request goes to managers | Block |
| Approve / reject pending discount | `decideQuoteApproval` → `decideApproval` → `onDiscountApproved` (qwf:571-587), no check | **Allowed**; the sibling becomes Approved | Withdraw the request automatically at selection time |
| Send to customer (email/WhatsApp/manual) | `sendQuote` (qwf:337-366) | **Allowed**; the customer receives an obsolete offer | Block |
| Mark as Sent / Mark Under Negotiation | generic lifecycle qt.ts:151-154 → `transitionRecord` (rt:353); quotations register no `transitionBlocked`. Also the bulk action ResourcePage.tsx:170-176, 262-277. | **Allowed** (single and bulk) | Block |
| Mark Accepted (button, status chip, board drag) | `acceptQuote` | Refused with an error, **but the button is still enabled** (qRec:107-118, qExt:34) | Hide/disable with a reason |
| Mark Rejected | `rejectQuote` | Allowed | Replace with an automatic "Not selected" status |
| Create new version | `reviseQuote` → `insertRecordIn` → `quoteBeforeCreate` → `derive(isNew)` throws `opportunityWon` (qwf:82), so the commit rolls back (db.ts:118-131) | Refused, but the **menu item is enabled** (qRec:136, 156) and the message is confusing | Disable with "Not selected — Qx was accepted" |
| Generate Sales Order | `quotationBlocker` (osvc:111-131): another accepted quote → blocked; a live SO for the opp → blocked | Refused, **but the primary purple "Generate Sales Order" button is still shown** (qRec:97-118); the user finds out on the New Order page | Hide/disable with a reason |
| Appear in New Order quotation picker | `eligibleQuotations` filters out blocked quotes (osvc:135-142) | Correctly hidden | — |
| ROI save | `updateRecord`, ROI keys are exempt (qwf:161-162) | Allowed | Fine (or block) |
| Expiry | `runQuotationSweep` (qwf:471) | Sibling eventually becomes **Expired**, which counts as "Lost quotation – Expired" in reports | Should become "Not selected" immediately |

#### Before any acceptance (two open siblings)
Both can be approved, sent and negotiated in parallel, which is legitimate for variants. Whichever is accepted or ordered first wins, and the second is then blocked from Accept and Order only. Nothing in the UI marks either one as the preferred or selected variant.

#### Related gaps
- **Lost opportunity**: `markLost` (oppSvc:56-95) leaves every open quotation open. They can still be sent, approved and accepted. `acceptQuote` on a lost opportunity **succeeds** with only an audit warning (qwf:410-412), and the quote then cannot be ordered (osvc:118-119), so it is stuck.
- **Admin Reopen** of a won opportunity (opp.ts:147) leaves the accepted quote Accepted and blocks every other quote from acceptance. There is no "un-select".
- **Opportunity value sync** happens only in `acceptQuote` (qwf:409). It is missing in `createOrder` (osvc:513) and after SO line edits (osvc:561). There is no live sync from the latest/selected quote while the opportunity is in Proposal or Negotiation.
- **Reports** count every latest sibling in quotation value (reports/defs/quotations.ts:14, 40-46).

#### Required guards (implementation plan)
1. **Concept**: add quote status `not_selected` (label "Not selected"), terminal and grey, to `quoteStatus` (qt.ts:19-36) and `terminal` (qt.ts:148). Add fields `selectedQuotationId` on the opportunity and `notSelectedReason` / `supersededByQuoteId` on the quote.
2. **One helper** `closeSiblingQuotes(ctx, oppId, winnerId, reason)` in qwf. For every quote with `opportunityId === oppId`, `id !== winnerId` and a status in OPEN (qwf:50), it should withdraw pending approvals (`withdrawPending`), patch `status:'not_selected'` and `supersededByQuoteId`, and write an audit entry on the sibling **and** on the opportunity.
3. **Call it** from `acceptQuote` (qwf:405-412), from `createOrder` when it auto-accepts (osvc:510-514), and from `markLost` (reason "Opportunity lost"), and set `opportunity.selectedQuotationId`. Also sync `opportunity.value` in `createOrder` (osvc:513) and optionally on SO approval or line edits.
4. **Central guard**: `assertQuoteActionable(d, q)` inside `load()` (qwf:251-258). It throws when `q.status === 'not_selected'`, when the opportunity is `won`/`lost` and q is not the selected quote, or when another quote is accepted. This covers submit, send, accept, reject, revise and backToDraft in one place. Also call it from `quoteBeforeUpdate` (qwf:158) for edits and ROI, and from `onDiscountApproved` (qwf:579) so approvals cannot complete on a dead quote.
5. **Generic engine**: register `transitionBlocked` for `quotations` in qExt:19-30, using the same helper, so Mark Sent / Mark Negotiation (single, bulk and board) are disabled with a reason. Make `registerStageMoveHandler.targets` (qExt:34) return `[]` for non-actionable quotes.
6. **acceptQuote on a Lost opportunity** must throw (replace the warning at qwf:410-412).
7. **Order blocker**: add `q.status === 'not_selected'` and `opp.selectedQuotationId && opp.selectedQuotationId !== q.id` to `quotationBlocker` (osvc:111-131).
8. **UI**: in `QuoteActions` (qRec:50-195), render no primary actions for `not_selected` and show "Open selected quotation Qx" instead. Add a `QuoteBanner` case "Not selected — QT/…/0003 was accepted on <date> by <user>; this quotation is read-only." In `OpportunityQuotesTab` (qRec:864-910), pin the selected quote at the top with a "Selected" chip, group the others under "Not selected" and "Older versions", and disable "New Quotation" with "Opportunity is won — selected quotation Qx".
9. **Admin Reopen** (opp.ts:147): block it while a live SO exists. Otherwise, on reopen, set the accepted quote back to `negotiation` and restore not-selected siblings, or leave them closed and ask the user to create new versions.
10. **Reports**: exclude `not_selected` from quotation value and from the conversion denominator, and give it its own bucket in Lost Quotations ("Lost to own alternative").

Every code path that needs the guard: `saveQuote`/`quoteBeforeUpdate`, `submitQuote`, `backToDraft`, `sendQuote`, `acceptQuote`, `rejectQuote`, `reviseQuote`, `onDiscountApproved`/`decideQuoteApproval`, generic `transitionRecord` (markSent/markNegotiation) including the bulk action in ResourcePage.tsx:170-277 and the board drag via `useStageMove`, `registerStageMoveHandler` targets, `quotationBlocker`/`eligibleQuotations`/`createOrder`, RoiTab `updateRecord`, `markLost`, opportunity reopen, `runQuotationSweep` (skip `not_selected`), and the quotation report defs.

---

### 3. History & linking findings

#### Opportunity record (`/opportunities/:id`, RecordInspector)

| Item | Present? | Where | Missing |
|---|---|---|---|
| Field-level change history (who, what, before→after) | Yes | "Changes"/"Activity History" tab, `ActivityFeed` RI:582-625 (audit for this record: transitions with stage before→after, updates with field diffs, workflow-tagged entries, actor name) | Shows only **relative** time ("3 days ago"), with no absolute date/time. No filter. Includes no events from child quotes or orders. |
| Activities timeline | Yes | "Timeline" tab oppExt:216-250 (activities on the opp plus those on the source lead) | Contains no status changes, quotation events (sent/approved/accepted), or SO events, and the entries have no "by" (user). |
| Source Lead link | Yes | `leadId` relation (opp.ts:124) appears as a clickable link in Details and Related (FieldValue.tsx:101-125) | — |
| Linked quotations | Partial | "Quotations" tab (qRec:864-910): latest version of each root, clickable, status chip | **No "Selected" marker**, superseded versions hidden, no grouping, no indication that others lost. |
| Demos / Sample requests | Yes | Related tab relationships (opp.ts:132-135) | — |
| Resulting Sales Order | Partial | Only the "Open sales order" button when Won and the accepted quote has a live SO (oppExt:155-170) | No relationship section to `salesOrders` (no `foreignKey:'opportunityId'` relationship), cancelled orders invisible, SO status not shown. Add `{resource:'salesOrders', foreignKey:'opportunityId'}` to opp.ts:132. |
| Won/Lost summary | Partial | Lost banner (oppExt:197-204) | No Won banner ("Won on <date> from QT/… worth ₹X → SO/…"). |

#### Quotation record (`/quotations/:id`)

| Item | Present? | Where | Missing |
|---|---|---|---|
| Status / edit / approval / send / accept history | Yes | Changes tab (audit): create, transitions, `approval.requested/level_approved/decided/withdrawn` (workflow.ts:112, 147, 157, 172), sent, accepted, superseded | Relative time only. |
| Approval detail per level | Yes | Approval tab qRec:667-720 (levels, decision, who, note) | — |
| Versions with who/when/note | Yes | Versions tab qRec:724-754 (each revision clickable, status, created by/at, note, Compare link) | Labelled v1/v2 instead of R0/R1. |
| Deal progress strip | Yes | `DealProgress` (DealProgress.tsx) above the banner | Hidden for non-latest versions; not shown for not-selected siblings (that state does not exist). |
| Source Lead | Yes | `leadId` computed relation (qt.ts:93) plus the "Open Lead · L-…" button (qRec:138) | — |
| Linked Opportunity | Yes | `opportunityId` relation, clickable | — |
| **Sibling quotations on the same opportunity** | **Missing** | — | Add a "Other quotations for this opportunity" section listing each sibling with Selected / Not selected / Open status. |
| Resulting Sales Order | Partial | "Open sales order" button (qRec:119-125); DealProgress shows the stage | No link in Related (quotations `relationships: []`, qt.ts:134). Add `{resource:'salesOrders', foreignKey:'quotationId'}`. |
| Documents | Partial | DocumentsTab: PDF, PO copy | No attachments (QUO-08b). |

#### Sales Order record
`quotationId` and `opportunityId` relations are clickable (so.ts:91-92). DealProgress and the diff against the quotation are shown. Milestones, dispatches and contracts appear as relationships (so.ts:133-137). This is good.

---

### 4. UX confusion points

1. On a won opportunity, a sibling quote still shows the purple **Generate Sales Order**, **Send Quotation** and **Mark Accepted** buttons with no disabled reason. They fail only after a click, or on the next page (qRec:97-118).
2. Sibling quotes stay "Sent"/"Approved" after the deal is won, then expire weeks later and appear in "Lost quotations – Expired".
3. Approvers in Pending Approvals can still approve discount requests for quotes whose opportunity was already won with another quote.
4. "Create Version" on a sibling of a won opportunity shows the error "Opportunity X is already won — it cannot get another quotation", which does not explain that a different quote was selected.
5. The opportunity Quotations tab shows one Accepted chip among others with active-looking chips. There is no "Selected" marker, and old revisions are hidden.
6. A deal won by "Generate Sales Order" from an Approved quote keeps the **estimated** opportunity value, so the forecast and dashboards differ from the order value.
7. A quote can be Accepted on a Lost opportunity and then can never be ordered (dead end, with no banner explaining it).
8. Version labels disagree: quote number `…-R1`, Versions tab "v2", BRD "R1".
9. History tabs show only relative time. "Timeline" (activities) and "Changes" (audit) are split, and neither shows the whole deal (lead → quotes → order) on one timeline.
10. On a Won opportunity there is no banner explaining which quote won and which order resulted. The user has to open tabs.
11. Compare Versions cannot compare two alternative quotations (variants) for the same opportunity, which is the usual sales comparison.

---

### 5. Top 10 fixes ranked

1. **Auto-close sibling quotations on selection** (new `not_selected` status, `closeSiblingQuotes` called from `acceptQuote`, `createOrder` and `markLost`, withdrawing pending approvals). qwf:379-417, osvc:508-514, oppSvc:56-95. Critical.
2. **Central actionability guard** in `load()`, `quoteBeforeUpdate` and `onDiscountApproved`, plus a quotations `transitionBlocked` hook (blocks send, submit, approve, revise, mark sent/negotiation including bulk and board). qwf:251-258, 158, 579; qExt:19-36. Critical.
3. **Sync opportunity value** to the accepted quote or order total on the `createOrder` path (osvc:513), and optionally on SO approval or line edits. Store `selectedQuotationId`. High.
4. **Block acceptance on a Lost opportunity** (qwf:410-412) and add `not_selected` / non-selected checks to `quotationBlocker` (osvc:111-131). High.
5. **UI states for non-selected quotes**: QuoteActions shows no primary actions, QuoteBanner explains "Not selected — Qx accepted", and OpportunityQuotesTab shows a Selected chip with grouped Not selected and Older versions. qRec:50-195, 533-585, 864-910. High.
6. **Linking**: add `salesOrders` relationships to opportunities (`opportunityId`) and quotations (`quotationId`), a sibling-quotes section on the quotation, and a Won banner on the opportunity (quote → order). opp.ts:132, qt.ts:134, oppExt:191-214. High.
7. **Unified deal history**: on the opportunity, merge the audit of the opp, its quotations and its SO with the activities into one timeline with absolute date/time and actor. Show absolute timestamps in ActivityFeed. oppExt:216-250, RI:582-625. Medium.
8. **Discount approval thresholds by division/product** (QUO-06a) and a configurable SO approval matrix (SO-04c). pol:76-81, osvc:405. High/Medium.
9. **Guard admin Reopen** while a live SO exists, and define what happens to the selected and not-selected quotes on reopen. opp.ts:147. Medium.
10. **Reports and labels**: exclude `not_selected` from quotation value and conversion, give it a Lost-quotations bucket, use R0/R1 labels, add quote attachments (QUO-08b) and an email-link approval simulation (QUO-06d). Medium/Low.


---

## Part C-admin-common

## Audit C: Administration & Configuration (§4.14), Common Requirements (§5), Roles (§2, Appendix B)

Scope: ADM-01..10, COM-01..12, §2.1 roles, Appendix B matrix (blank in the BRD, so it was checked against the proposed matrix in docs/REQUIREMENTS.md §2.2).
Method: I read the code and traced each config item from the settings page to the code that uses it. I also ran small read-only scripts (vite-node, outside the repo) to dump the effective role matrix and to run `validateDraft` against real masters. I did not run the app in a browser, so responsive and visual claims are taken from docs/SETTINGS-QA.md and are not verified here.

Verdicts: Correct / Partial / Wrong / Missing / Simulated / N/A-frontend. Severity: Critical / High / Medium / Low.

### Clause table

| BRD ID | Clause | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| ADM-01 | Org hierarchy configurable (divisions, departments, reporting managers); drives visibility and approvals | **Partial** | `/admin/organisation-hierarchy` (`src/modules/catalog/OrganisationPage.tsx`, `OrgChart.tsx`) is **view-only**: chart, divisions and territories tables, with no edit controls. You change a manager or division on the `/admin/users` record form (`src/domain/resources/core.ts:29-33`). Visibility does follow the hierarchy: `authz.actorFor` builds `teamStaffIds` from `employees.managerId` and `divisionIds` from the employee record (`src/services/authz.ts:50-66,72-85`). Sales-order approvals also follow it (`managerLevel` reads `employees`, `src/services/orders/orders.ts:361-368`). **Quotation discount approvals do not.** `quoteApprovalChain` passes the static `demoUsers` (pack managerId, roleId, divisions) to `resolveQuoteLevels` (`src/services/quotations/workflow.ts:311-313`, `approvalLevels.ts:37-50`). | (1) Quotations: build the approver list from `employees` records (as orders do), not `demoUsers`. (2) Add a **Department** field/master; the BRD names it and the code has none (`grep department` finds only contacts). (3) Add "Change manager / move" actions on the org chart, or relabel the page "Organisation (view)" and link to Users. | High |
| ADM-02 | Permissions at module, record (own/team/division/all), field (cost price) and action (export, delete, approve) level | **Partial** | Record scope and module level are editable per role, saved as a diff and applied at runtime (`src/services/catalog/access.ts:76-117`, `roleOverrides.ts:28-36`, merged in `authz.ts:59`). Field level: `fieldOverrides` editable (`access.ts:98-110`), applied in `fieldAccess` (`authz.ts:177-178`). Export and delete flags are editable and enforced (`exporter.ts:44`, `runtime.ts:394`). **Approve (and every other capability) cannot be edited per role.** Capabilities come from the shipped pack only (`authz.ts:105`, `pack.ts:135-138`); the only way to add one is a per-person time-limited grant (`grantEngine.ts:38-46`). Quotation levels are also hard-wired to roles (`QUOTE_LEVEL_ROLE`, `approvalLevels.ts:25,76`). No new roles can be created (`requireManager` requires a shipped role, `access.ts:68-72`). **Delete ignores row scope:** `deleteRecord` checks `perm.delete` and read scope, not update scope (`runtime.ts:394-397`). | Add a "Capabilities / approvals" column to the role editor (stored in `rolePermissions[role].capabilities`, merged in `applyRoleOverrides`). Make `QUOTE_LEVEL_ROLE` read from configuration. In `deleteRecord`, require `canUpdateRecord` (or a separate delete scope). Allow "Copy role → new role". | High |
| ADM-03 | Masters: products & price lists; product types/sub-types & spec fields; territories/hubs/states/cities; industries/segments; lead sources; lost reasons; complaint categories; checklists; T&C templates; GST/HSN | **Partial** | `/admin/masters` (`src/pages/AdminPages.tsx:151-324`) edits about 90 masters through Draft, Validate, Publish (`services/config.ts`). Consumers read published values: `activeMasterValues` (`registry.ts:33`) is used by `FormFields.tsx:104,133`, `MarkLostDialog.tsx:62`, `LeadActions.tsx:325`, filters, and so on. So **new lead sources and lost reasons do appear in Leads and Opportunities.** Products, price lists, T&C are resource lists and are used by quotations (`quotations/workflow.ts:40-45,96,643`). **Defects found:** (a) **Division, State, GST Rate, Purchase Timeline and print-head masters can never be published.** `validateDraft` checks the snake-case rule on every value, so the shipped keys `TX`, `INK`, `01`, `27`, `0`, `18`, `1_3m`… fail (`config.ts:129-131`). Confirmed by running it: Division 6 errors, State 36, GST Rate 5. (b) The add-value form cannot set a **parent**, so a new Complaint Sub-category never shows in the dependent dropdown (`FormFields.tsx:104` filters by parent; `validation.ts:127` rejects it). A new Territory gets no state. (c) **GST Rate master is unused**: `products.gstRate` is a number field (`domain/modules/catalog.ts:62`). (d) Missing masters: **cities, hubs** (only territory→state), **HSN master** (free text `hsnSac`), **checklists**. PM checklist is hard-coded in labels (`services/service/pm.ts:22-23`); site-readiness checklist is hard-coded (`domain/modules/installed/resources.ts:35`). **Spec fields per product type**: only free-text `specs` plus hard-coded machine fields (`catalog.ts:65-67`). Product sub-type has no parent link to type. (e) **Workflow-status masters** (`oppStage`, `leadStatus`, `quoteStatus`, `ticketStatus`, `soStatus`…) are editable like any list; see "Config items that don't take effect". | (a) Run the key regex only on **new** values (`!published.values.some(p=>p.key===v.key)`). (b) Add a Parent picker when the master has parent values. (c) Make `products.gstRate` a `master: 'gstRate'` field, or drop the master. (d) Add city/hub/HSN/checklist masters (checklist = master with parent = machine model or division) and read PM/readiness checklists from them. (e) Mark status masters `system: true`: labels, tone and order editable, but no add or deactivate. | Critical |
| ADM-04 | Configurable workflows and approval matrices without code changes | **Partial** | `/admin/workflows`, `/admin/sla-matrix`, `/admin/configurable-rules` edit `Policies` (`services/policies.ts`, `catalog/policyRules.ts:14-38`, `modules/catalog/PolicyPages.tsx`). **Every policy key has a consumer** (grep trace): discount bands → `discountApprovalLevels` → quote approval (`policies.ts:124-127`, `quotations/workflow.ts:312`); SLA → `service/sla.ts:23`; escalation → `service/tickets.ts:564`; soTolerance → `orders.ts:554`; finance check → `orders.ts:375`; stage probability → `opportunities/index.ts:28`; validity → `quotations/workflow.ts:93`; geofence/shift/conveyance → `field/field.ts:126-174`, `extensions/field.tsx:114`; maxFileMb → 5 upload sites; and the rest. **But the workflows themselves (states and transitions) are code** (`domain/modules/opportunities.ts:136-149` and every `lifecycle`). Stage probability is limited to a hard-coded `STAGE_KEYS` (`policyRules.ts:40`), and SLA to hard-coded `PRIORITY_KEYS`/`COVERAGE_KEYS` (`:41-42`). The SO approval matrix is not configurable beyond the finance-check %; the chain is hard-coded (`orders.ts:352-368`). Policy audit stores only changed key names, not old/new values (`policies.ts:118`). | Build `STAGE_KEYS`/`PRIORITY_KEYS` from the masters. Add an SO approval-by-value matrix like `discountBands`. Record before/after in `config.policies` audit. Rename the page "Approval thresholds" or add a transitions editor (at least enable/disable optional transitions per resource). | High |
| ADM-05 | Custom fields and form layouts per division | **Partial** | Custom fields: draft → publish → `config.customFields` → merged by `getResource` into a "custom" form section (`registry.ts:39-62`, `config.ts:202-209`). Default values are back-filled. Generic `RecordForm`/`RecordInspector` edit forms render them and apply per-division layouts (`RecordForm.tsx:279`, `services/formLayouts.ts:42-63`). **Not rendered on the custom create screens:** New Lead renders fixed `sectionIds` (`modules/leads/NewLeadPage.tsx:292-293`); the Quote editor and New Order page are hand-built (`QuoteEditorPage.tsx`, `NewOrderPage.tsx`). So a custom lead or quotation field cannot be filled when the record is created. Custom fields are **not per division** (`NewFieldSpec` has no division, `config.ts:59-69`). Layouts only reorder or hide sections; hiding single fields is not offered. A published custom field cannot be edited, renamed or retired (only draft fields can be removed, `config.ts:94-99`). | Render `res.form.sections` filtered by `applyFormLayout` (incl. `custom`) on New Lead, Quote editor and New Order. Add `divisions?: string[]` to custom fields and filter in the form. Add "Retire field" (hide from forms, keep data). | High |
| ADM-06 | Notification template management for email, WhatsApp, SMS, in-app | **Wrong** (saves only) | `/admin/notification-templates` is a CRUD list (`domain/modules/catalog.ts:167-196`). **No service ever reads `notificationTemplates`** (grep in `src/services`: zero hits). Every outbox message body is a hard-coded label: `queueMessage` callers in `leads/rules.ts:362,428`, `installed/logic.ts:119,198,291,539,558`, `quotations/workflow.ts`. docs/REQUIREMENTS.md FR-124 says "templates fill the outbox"; that is false. | Add `renderTemplate(event, channel, vars)` in `outbox.ts`. It looks up an active template for `{event, channel}` and fills `{{placeholders}}`, falling back to the label. Route every `queueMessage` through it and show "Template: X v3" on Sent Messages. | Critical |
| ADM-07 | Bulk import/export with templates and validation; export role-restricted and logged | **Partial** | `/admin/bulk-import-export` (`modules/catalog/ImportExportPage.tsx`): CSV template download, row validation through `validateValues` (`catalog/importer.ts:167-191`), import gated by `data.import` and create permission, export through `exportCsv` with permission check and audit (`exporter.ts:43-48`). Resource list export: `ResourcePage.tsx:162` → `exportCsv`. Reports export: checked and audited (`services/api/reports.ts:29-35`). **Leak:** every `DataTable` has row checkboxes on by default with "N selected · Export" (`components/primitives/DataTable.tsx:95,130,179-184,226`). That export has **no role check and no audit**, on about 18 pages (Not-attended leads, Follow-ups, Payment schedule, Order processing, Renewals, Stock, Knowledge base…). Demo Settings full-DB JSON export (`DemoPages.tsx:123`) is unaudited (admin-only). The BRD says Excel; the app does CSV only (`ImportExportPage.tsx:130`). No duplicate detection during import. | Make `exportSelected` call a service that checks `perm(...).export` (or a `data.export` capability) and appends an audit entry; hide the link otherwise; or set `selectable` default to false. Add .xlsx import (an xlsx writer already exists in `lib/xlsx.ts`). Flag duplicates on import (mobile/GSTIN). | High |
| ADM-08 | User lifecycle: create, deactivate, transfer records on exit | **Partial** | Deactivate is blocked while the user owns open records or has active reports (`domain/extensions/catalog.tsx:95-109`). Banner links to `/admin/ownership-transfer` (`:111-121`, `services/customers/operations.ts:90-123`). A deactivated user cannot sign in or be switched to (`session.ts:26-29`, `settings.ts:72-74`). **Create:** a new user record has **no sign-in identity**. Login and the role switcher list only the static `demoUsers` (`pages/LoginPage.tsx:24,88`, `AppShell.tsx:937`), so a newly created user can never be used, and is ignored by quotation approvals (see ADM-01). The login list shows the pack role, not the current employee role. | Derive the demo user list from active `employees` (pack users = seed only). Give new users a generated sign-in entry. Show the current role from the employee record. | Medium |
| ADM-09 | Any other configuration arising after implementation | **N/A-frontend** (contractual) | `/admin/configurable-rules` holds the extra numbers. | Contractual; nothing to build. | — |
| ADM-10 | Developer end-to-end support | **N/A-frontend** | — | Contractual. | — |
| COM-01 | Access by role & hierarchy (9 roles), Appendix B | **Partial** | All 9 BRD roles plus Profiling exist (`domain/pack.ts:40-128`, REQUIREMENTS §2.1). Services enforce read/create/update/delete/export on every record path (`runtime.ts:128,156,260,307-313,360-368,394`). Pages show NoAccess (e.g. `AdminPages.tsx:155,1277`; `PolicyPages.tsx:88`). Several mismatches against the proposed matrix; see "Role matrix mismatches". Browser-only enforcement (stated in `authz.ts:1-5`). | Fix the over-exposures listed below. | Medium |
| COM-02 | Centralised DB, no duplicate masters | **Correct** (minor) | One store (`services/db.ts`); all modules use the same customer and machine ids. Near-duplicates: `activityType`/`taskType`, unused `gstRate` master next to a numeric field. | Merge or remove the unused master. | Low |
| COM-03 | Automated notifications: follow-ups, approvals, dues, SLA breaches, warranty/AMC expiry via in-app, push, email, WhatsApp | **Simulated / Partial** | In-app `notify` (`ledger.ts`) plus simulated outbox (`outbox.ts:13-18`). Producers: follow-up reminders `leads/rules.ts:428`, payment reminders `orders.ts:776`, warranty/renewal `installed/logic.ts:539-558`, approvals `workflow.ts`. **The user's Notification Preferences (channels per event, quiet hours, digest) are saved but never read.** `getNotificationPrefs` has no callers outside `account.ts` (`services/account.ts:23`), and `quietHours` is referenced only in types/db. Templates are ignored (ADM-06). | Read the user's preferences in `notify`/`queueMessage` (drop channels the user turned off; hold during quiet hours; batch into the digest). | High |
| COM-04 | Document storage with version history and size limits | **Partial / Simulated** | Size limit from `policies.maxFileMb` checked at uploads (`ImportExportPage.tsx:65`, `orders/components.tsx:53`, `MyJobPage.tsx:156`). Customer "Documents" tab only lists file-name fields gathered from related records (`modules/customers/customer360.tsx:633-680`). There is no general way to attach files to a lead, opportunity or machine. Version history exists only as quotation revisions. | A shared `attachments` collection (record ref, name, size, version, uploadedBy) with a Documents tab on every record; "Replace" makes a new version. | Medium |
| COM-05 | Activity history on customer, lead, opportunity, machine | **Correct** | `RecordInspector.tsx:134-141,581-620` change feed on every record. Customer 360 timeline; `LogActivityDialog` uses the `activityType` master. | — | — |
| COM-06 | Global search (customer, contact, mobile, GSTIN, serial, quote/order/ticket ID) + saved filters | **Correct** (with caveat) | `services/search.ts:14-26` searches all readable resources. Fields such as `gstin` and `quoteNo` have search capability (`domain/modules/customers.ts:52`, `quotations.ts:82`). Saved views exist on lists. Caveat: roles that see contact mobile numbers masked cannot search by mobile (`authz.ts:191-194`). That is by design but not explained in the UI. | Show a hint "mobile search needs contact access". | Low |
| COM-07 | Mobile apps, offline (attendance, visits, job cards), camera, GPS, voice | **Simulated** | Responsive web. In-memory offline queue (`services/offline.ts:1-6`, lost on reload). GPS geofence check (`field/field.ts:126`). `VoiceButton` uses Web Speech. Native apps are N/A. | Persist the offline queue to localStorage so a reload doesn't lose it. | Low |
| COM-08 | Excel import/export, templates, validation, role-restricted, logged | **Partial** | Same as ADM-07: CSV only, and DataTable selection export bypasses role and audit. | See ADM-07. | High |
| COM-09 | Audit trail: create, change (old/new), approvals, exports, logins, deletes | **Partial** | `appendAudit` is called in about 99 places. Create, update with `changes` (old/new), transition, delete, restore, purge (`runtime.ts:295,331,377,415,433,443`); approvals (`workflow.ts:112,147,157,172`); login/logout/switch (`session.ts:49,55`, `settings.ts:78`); role changes with before/after (`access.ts:113`); export (`exporter.ts:46`, `api/reports.ts:34`). **Gaps:** DataTable selection export and full-DB export are not logged. Policy changes log key names only, no old/new (`policies.ts:118`). Master publish logs a summary only, with no structured old/new. The ledger keeps only the newest 2,000 entries (`ledger.ts:21`); real audit should not be truncated (fine for a demo, but say so). | Log the selection export. Add `changes` to `config.policies` and `config.published`. | Medium |
| COM-10 | Soft delete → recycle bin; restore and permanent delete admin-only | **Correct** | `runtime.ts:391-445` (recycle, `recycle.manage` for list, restore, purge; admin-only capability, `pack.ts:40`). Merge also recycles (`customers/operations.ts:83-84`). Bin at `/admin/recycle-bin`. | Delete scope issue under ADM-02. | — |
| COM-11 | INR, lakh/crore, DD-MM-YYYY, IST, Indian states, GST | **Correct** | `lib/format.ts:1-2` (en-IN INR), `lib/dates.ts:65` (`dmy`), `lib/clock.ts:30-32` (Asia/Kolkata), amount in words lakh/crore (`services/lookups.ts:64-70`), GST state codes (`domain/masters.ts:30-67`), CGST/SGST vs IGST from `companyGstState` (`QuotationPdfPage.tsx:64,136`). | — | — |
| COM-12 | In-app help, video tutorials, tool-tips, first-login walkthrough per role | **Partial** | Per-role guided tour (`components/shell/GuidedTour.tsx:1-3,25-98`, `settings.ts:63-68`). InfoTips are widespread. Videos explicitly not built (`labels.ts:344`). | Add placeholder video cards per module in Help (or mark Deferred). | Low |
| §2.1 | Roles & positions; hierarchy visibility own → team → division → all | **Correct** | `authz.ts:1-12,110-129`, REQUIREMENTS §2.1 table matches `pack.ts` roles. | — | — |
| App. B | Role access matrix (blank in BRD; proposed in REQUIREMENTS §2.2) | **Partial** | Effective matrix dumped from `appRoles`; mismatches below. Editable at `/admin/roles-permissions` (resources and fields only). | See below. | Medium |

### Config items that don't take effect

These are settings that save (with a success toast) but change nothing elsewhere, or only partly:

1. **Notification Templates** (`/admin/notification-templates`): no consumer anywhere; all message bodies are hard-coded labels (ADM-06).
2. **Notification Preferences** (`/admin/notification-preferences`): channels per event, quiet hours and digest are stored in `settings[user].notifications` and never read (`services/account.ts:23` has no callers).
3. **Division / State / GST Rate / Purchase Timeline / print-head masters**: any edit makes publish impossible, because the shipped keys fail `^[a-z][a-z0-9_]{1,39}$` (`config.ts:129-131`). You cannot add a division or rename a state.
4. **New value in a child master** (Complaint Sub-category, Territory): added with no `parent`, so it never shows in the dependent dropdown and fails validation (`FormFields.tsx:104`, `validation.ts:127`).
5. **GST Rate master**: not used by Products, which has a numeric `gstRate` field (`domain/modules/catalog.ts:62`).
6. **Opportunity Stage master**: adding a stage creates a board column (`BoardView.tsx:22`), but no transition leads to it (`domain/modules/opportunities.ts:141-148`). Its probability can't be set because the stage-probability editor iterates a fixed `STAGE_KEYS` (`policyRules.ts:40`, `PolicyPages.tsx:351`), so the default is 0%. The same applies to `leadStatus`, `quoteStatus`, `soStatus`, `ticketStatus` and other lifecycle masters.
7. **Ticket Priority / Coverage master**: a new value is not in the SLA matrix (`PRIORITY_KEYS`/`COVERAGE_KEYS` fixed), so the SLA silently falls back to `medium` (`service/sla.ts:23`).
8. **Organisation Hierarchy / Users → reporting manager**: changes visibility and SO approvals, but **not quotation discount approval L1/L2**, which use static `demoUsers` (`quotations/workflow.ts:312`).
9. **Users → create user**: the record saves but the person can never sign in or be switched to (`LoginPage.tsx:88`, `AppShell.tsx:937`).
10. **Custom fields on Leads / Quotations / Sales Orders**: published fields are absent from the New Lead page, the Quote editor and the New Order page; they show only on edit or detail.
11. **Form layouts per division**: applied only in the generic `RecordForm`, so they have no effect on the same bespoke create pages.
12. **Role & Permissions → approvals**: you cannot grant "approve" to a role at all. Quotation levels are hard-wired role ids (`QUOTE_LEVEL_ROLE`), so even a person-level `approve.l1` grant on a non-sales-manager cannot decide a quote level (`roleMayDecideQuoteLevel`, `approvalLevels.ts:76`).
13. **Workflows page → "approve.finance" on a discount band**: works (passed through unchanged, `approvalLevels.ts:55-58`). This one is fine; listed only so the trace is complete.
14. **Numbering series**: not configurable at all. Quote numbers use a hard-coded `QT/{div}/{FY}/0001` (`quotations/workflow.ts:149-155`). No settings page exists.

Verified working (settings → consumer): Lead Source and Lost Reason values (new lead form, Disqualify, Mark Lost, quote reject), Industry/Segment/Territory on customers and leads, Lead Assignment Rules (`leads/rules.ts:66-75`), Lead Scoring Rules (`extensions/leads.ts:19`), T&C templates (`quotations/workflow.ts:96`), price lists (`quotations/workflow.ts:40-45`), all 25 Policy values (traced one by one; see ADM-04), Role resource/field overrides (`authz.ts:59`), extra-access grants with expiry (`grantEngine.ts`), master deactivation (hidden from pickers, blocked on save by `inactiveMasterErrors`).

### Role matrix mismatches

Effective matrix (from `appRoles`) vs the proposed matrix in REQUIREMENTS §2.2. Notation: read/update + C/D/X flags.

| Role | Area | Proposed | Built | Issue |
|---|---|---|---|---|
| Service engineer | Customers & contacts | V assigned sites | `customers all/none`, `contacts all/none` | **Over-exposure**: every engineer can read every customer and contact. Use `own` via ticket link, or a `canRead` hook like the deal-linked one. |
| Accounts | Service tickets | V chargeable only | `tickets all/none` | Over-exposure: add a `canRead` hook (`chargeable === true`). |
| Profiling | Leads & opps | V opps with samples | `opportunities all/none` | Over-exposure: add a hook filtering by `sampleRequests.opportunityId`. |
| Import/SCM | Base & AMC | V All | `amcContracts none` | Under-access (machines is V All, AMC none). |
| Service leadership | Quotations | V All; CEV service quotes | `quotations all/none` (no create) | Service quotes cannot be raised by service heads. |
| Service leadership | Service tickets | CEVDX All | `tickets all/allCX` (no D) | Minor. |
| Coordinator | Dispatch & install | CEV Div | `dispatches division/division` (no C) | Minor. |
| Import/SCM | Dispatch | CEV dispatch | `dispatches all/all` (no C) | Minor. |
| Admin | Dispatch | CEVDX | `dispatches all/allDX` (no C) | Minor. |
| Sales manager | Quotes / Orders / Targets | no X | `quotations, salesOrders, amcContracts, targets` have X | More export than proposed. Acceptable if intended; update the doc. |
| Division head | Dispatch / Tickets / Base | V Div | have X | Same as above. |
| Management, Division head | Targets | CEV | `allCDX`, `divisionCDX` (D added) | Minor. |
| Sales manager / Division head | Approve | A level 1 / level 2 | capabilities exist, but L1 and L2 quotation approvers come from static `demoUsers` | Approval follows the pack, not the editable org (High, see ADM-01). |
| All roles | Delete | Soft delete per D flag | `deleteRecord` checks read scope, not update scope (`runtime.ts:394-397`) | A role with D plus wider read than update can delete others' records. |
| All roles | Export (X) | always logged | DataTable "Export selected" bypasses X and audit | Critical gap for ADM-07 and COM-08. |
| Any role | Demo Settings → "Reset demo data" | Admin | DangerZone is not gated (`AdminPages.tsx:1548-1558`; nav item has no capability, `settingsNav.ts:54`) | Any user (e.g. sales exec) can wipe the demo. Fine for a demo, but gate it with `demo.settings` or say it is intentional. |

UI hiding vs action guards: the service layer guards create, update, transition, delete, export, import, policies, masters, layouts, roles and grants, so hidden buttons are backed by checks. The exceptions are the DataTable selection export (client-only, no check) and Reset demo data.

### UX confusion points in Settings

1. **Masters takes three steps before anything happens.** The table is read-only until "Start draft". Then "Validate" must run before "Publish" is enabled (`AdminPages.tsx:84-99`). There is no explanation of why the page is read-only beyond an info alert. Suggest editing in place, with "Publish" running validation itself.
2. **The Masters dropdown lists about 90 masters with no grouping**, mixing business lists (Lead Source) with system status lists (Quote Status, Ticket Status) whose new values break workflows. Group by module and lock system lists.
3. **The add-value form has no key or parent field.** Keys are auto-generated from the label, and a one-letter label gives a 1-char key that fails validation with a cryptic snake_case message.
4. **The "Workflows" page doesn't edit workflows.** It holds approval thresholds and SO tolerance numbers. Users looking for stages or transitions won't find them anywhere.
5. **Stage probability shows only six fixed stages**, even after a stage is added in Masters.
6. **Organisation Hierarchy looks like the place to change reporting lines, but it is read-only.** The real edit lives in Users, which is not linked except through a person card.
7. **Roles & Permissions has four tabs** (People, Roles, Expiring, Advanced). Approvals are not on any of them; they appear only as "extra access" for one person.
8. **Notification Templates and Notification Preferences both show "Saved"** and have no effect (see above). This is the most visible demo trap.
9. **Products, Price Lists, Price List Items and T&C appear twice**: in the Settings nav and again under the Masters → "Record masters" tab.
10. **Custom fields cannot be edited or retired after publish.** The only route is a reset of demo data.
11. **Demo Settings with "Reset demo data" is shown to every role** in the Settings nav.
12. **The CSV-only "Bulk Import / Export" is labelled per the BRD as Excel**: wording vs behaviour mismatch.

### Top 10 fixes ranked

1. **Fix master validation for shipped non-snake keys** (`config.ts:129`: only check keys of newly added values). It unblocks Division, State and GST masters. *Critical, ~5 lines.*
2. **Make Notification Templates real**: render outbox messages from the active template for `{event, channel}` with placeholders, falling back to labels (`outbox.ts`). Correct REQUIREMENTS FR-124. *Critical.*
3. **Close the DataTable "Export selected" leak**: route it through a service with `perm.export`/`data.export` and `appendAudit`, or default `selectable=false` (`DataTable.tsx:130,179`). *High.*
4. **Quotation approvals from live org data**: replace `demoUsers` with active `employees` in `quoteApprovalChain`, and read `QUOTE_LEVEL_ROLE` from config (`quotations/workflow.ts:312`, `approvalLevels.ts:25`). *High.*
5. **Editable role capabilities (approve.l1/l2/l3/finance, export, etc.) per role** in Roles & Permissions, merged in `applyRoleOverrides`. *High.*
6. **Render custom fields and division layouts on New Lead, Quote editor and New Order** (use `applyFormLayout(res, division)` and include the `custom` section). Add a per-division scope to custom fields. *High.*
7. **Lock lifecycle/status masters** (system flag: rename, tone and order only), and build `STAGE_KEYS`/`PRIORITY_KEYS` from masters so stage probability and SLA follow configuration. *High.*
8. **Honour Notification Preferences** (channels, quiet hours, digest) in `notify`/`queueMessage`. *High.*
9. **Complete the ADM-03 masters**: parent picker on add-value; city, hub, HSN and checklist masters; PM and readiness checklists read from masters; product sub-type linked to type; `products.gstRate` bound to the master. *Medium-High.*
10. **Fix role-matrix over-exposure and delete scope**: engineer customers/contacts, accounts tickets, profiling opportunities hooks; `deleteRecord` requires `canUpdateRecord`; gate Reset demo data; let new users sign in (derive the login list from employees). *Medium.*


---

## Part D-service-side

## Audit D: Service side (BRD 4.6 to 4.10, Appendix A, 3.1 hand-offs)

Repo: `/Users/maysolanki/Documents/True-Color/tc_frontend` (branch feature/crm-modules). Read-only audit. I did not edit any files.
Method: I traced the service and hook code (not REQUIREMENTS.md) and ran the related vitest suites. Results: 8 files, 71 pass, **1 fail** (`src/test/service.qa.test.ts:98`, where "SRV-05 unassigned lists only tickets without a service engineer" gets 0 rows for the coordinator).

Path shorthand used in the Evidence column:
- `logic` = `src/services/installed/logic.ts`
- `ext/inst` = `src/domain/extensions/installed.tsx`
- `res/inst` = `src/domain/modules/installed/resources.ts`
- `so` = `src/services/orders/orders.ts`
- `ext/so` = `src/domain/extensions/orders.tsx`
- `tkt` = `src/services/service/tickets.ts`
- `sla` = `src/services/service/sla.ts`
- `jobs` = `src/services/service/jobs.ts`
- `pm` = `src/services/service/pm.ts`
- `board` = `src/services/service/board.ts`
- `dom/svc` = `src/domain/modules/service.ts`
- `req` = `src/services/spares/requisitions.ts`
- `stock` = `src/services/spares/stock.ts`
- `ext/spr` = `src/domain/extensions/spares.tsx`
- `dom/spr` = `src/domain/modules/spares.ts`
- `con` = `src/services/spares/consumables.ts`
- `lookups` = `src/services/lookups.ts`

Severity: **H** = a BRD Must is broken or misleading in a demo · **M** = part of a clause is missing or the logic is wrong in a realistic case · **L** = cosmetic, an edge case, or a documentation mismatch.

---

### 4.6 Dispatch, Delivery, Installation & Commissioning

| BRD ID | Clause | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| INS-01a | Dispatch details: date, transporter, LR no., delivery challan, invoice ref, e-way bill | Correct | `so:821-858` `recordDispatch` validates date (not future, not before order), transporter, LR, 12-digit e-way bill (required, typed or from ERP), challan, invoice ref (falls back to SO invoiceNo). Only allowed when SO is `ready_for_dispatch`. Route: SO record → Record Dispatch (`OrderActions.tsx:168-230`); list at `/dispatch-delivery` | Only one dispatch per SO, because the SO moves to `dispatched`. Partial or split shipments are not possible. | L |
| INS-01b | Dispatch intimation to customer by WhatsApp/email | Simulated | `so:861-867` queues WhatsApp and email in the outbox. Controlled by the "Notify customer" checkbox, which defaults to true (`OrderActions.tsx:168`). If the customer has no contact channel, the skip is audited. | Does not check the contact's consent flags, unlike `customerRecipient` (`logic:47-55`). Reuse that helper. | L |
| INS-02a | Expected vs actual delivery date | Correct | `expectedDelivery` is required at dispatch. `confirmDelivery` (`so:875-903`) checks the actual date is ≥ dispatch date and not in the future. `delayDays` field plus a "delayed" view (`orders.ts` domain:408,426) | — | — |
| INS-02b | Delivery confirmation with photo and signed POD | Simulated | `so:886-892`: the POD file (pdf/jpg/png) and the photo (jpg/png) are both mandatory, with a size limit. Only the file name is stored. | Acceptable for a prototype. Label it "file name only". | L |
| INS-03a | Site readiness checklist (power, earthing, UPS, temp/humidity, space, compressed air, network) | Correct | 7 boolean fields from `T.readiness` (`res/inst:36,64`). Readiness tab (`components.tsx:898`) | — | — |
| INS-03b | Checklist shared with customer | Simulated | `logic:113-128` `shareReadinessChecklist` sends to the outbox and stamps `readinessSharedAt`. Only shown in `scheduled` status. | Sharing is not required before verification, which is fine. It only appears in the banner's to-do list. | L |
| INS-03c | Verified by engineer **before installation is scheduled** | Partial | `ext/inst:131-141`: `→site_ready` needs all 7 items, and `→in_progress` needs readiness, an engineer and the handover. However, the job is created in status `scheduled`, and `scheduledAt` and the engineer can be set before readiness is verified (`ext/inst:115-130`). The customer is notified of the date at that point (`ext/inst:129`). | This follows the Appendix A order (Scheduled → Site Ready), which contradicts INS-03's wording. Either block `scheduledAt` (or the customer notification) until `site_ready`, or record the interpretation in REQUIREMENTS. | M |
| INS-04 | Sales-to-Service handover form: expectations, special commitments, key contacts | Correct | `logic:130-172`: all 3 fields are required with max lengths. The sales owner (SO owner, else account owner) or the service desk can fill it. `BR-26` notification is issued to the sales owner when the job is created (`ext/inst:110-111`). It is required before In Progress (`ext/inst:141`). Handover tab. | — | — |
| INS-05a | On delivery, installation job created automatically | Correct | `so:901` → `createInstallationJob` (`so:907-923`), inside the same commit as the delivery. Machine orders only, and idempotent per SO. | Consumables orders (correctly) get no job. | — |
| INS-05b | Engineer assignment, schedule | Correct | Generic edit of `engineerId` and `scheduledAt`. The engineer is notified (`ext/inst:105,128`). `assertMappedSite` requires the site to have lat/lng (`ext/inst:67-72`). | The lat/lng rule can block a demo if a seeded site has no coordinates. The error message is clear. | L |
| INS-05c | Customer notification | Simulated | `ext/inst:75-85,113,129`: outbox message when the engineer and date are set or changed | — | — |
| INS-06a | Job card: step checklist | Correct | `jcSteps` multimaster `installStep` (8 steps). `→trial_training` blocked until all steps are done (`ext/inst:143-146`) | — | — |
| INS-06b | Trial printing results, parameters | Correct | `trialResults` (required for sign-off, `logic:218`) and `parameters` (`res/inst:74-75`) | `parameters` is free text and optional. | L |
| INS-06c | Photos / videos | Simulated | `attachInstallationMedia` (`logic:175-186`) stores the file names in `mediaFiles` | Name only, with no preview. | L |
| INS-06d | Training given (topics, trainees) | Correct | `trainingTopics` and `trainees` are required for sign-off (`logic:219-220`) | — | — |
| INS-06e | Customer sign-off by OTP or digital signature | Simulated | `logic:191-202` OTP sent to the outbox and shown on screen; OTP is validated. A canvas signature is stored as a data URL (`logic:236,282`). Only in `trial_training`. Needs the `install.signoff` capability. | The OTP lives in an in-memory `Map` (`logic:188`), so it is lost on page reload. Persist it in the db or session. | L |
| INS-07a | On sign-off, installed-base record created with serial, configuration, installation date | Correct | `logic:247-262`: creates the machine with serial (unique, uppercase, checked in `logic:217`), product/model, print heads, width, software version, site, install date = today, purchase date = SO date, SO ref, installation ref. All in one commit. | No component serials (print heads) are created, so IB-02 history starts empty for new machines. Consider capturing head serials on the job card. | L |
| INS-07b | Warranty start date set automatically | Correct | `logic:263-265`: start = sign-off date, end = start + product `warrantyMonths` (default 12 from policy) − 1 day. `coverageType` is fixed to `parts_labour`. | Coverage type should come from the product or quotation warranty terms, not a hard-coded value. | L |
| INS-07c | PM schedule generated | Correct | `logic:71-94,266` `generatePmVisits`: 2 per year for warranty (`WARRANTY_PM_PER_YEAR`), spread evenly. AMC/CMC activation generates PM per contract (`ext/inst:259-263`, `logic:523-527,616`). | — | — |
| INS-07d | (hand-off) SO completed, sales notified | Correct | `logic:286-289` and `ext/so:71-78` (SO → `installation` when the job reaches site_ready, → `completed` on sign-off) | The admin-only manual "Mark completed" from `installation` (`orders.ts` domain:149) can complete a machine SO **without** a sign-off, which means no machine or warranty record. Add a guard requiring a signed-off installation job (same pattern as `ext/so:56-62`). | M |
| INS-08a | Training records per customer | Correct | `trainingRecords` resource (`res/inst:389-444`). Auto-created on sign-off (`logic:267-277`). Customer 360 Training tab (`ext/inst:292`). Route `/training-records` | — | — |
| INS-08b | Re-training requests | Correct | `retrainingStatus` (none/requested/scheduled/done); notes required when requested; service desk notified (`ext/inst:283-289`); "requests" view | — | — |

### 4.7 Installed Base, Warranty & AMC

| BRD ID | Clause | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| IB-01a | Model, serial, configuration (heads, width), software version, site, install and purchase dates, SO ref | Correct | `res/inst:154-228` machines. Serial is unique and uppercase (`ext/inst:159-183`). Route `/installed-base` | — | — |
| IB-01b | Current owner, supports resale/relocation | Correct | `logic:314-357` `moveMachine`: writes `machineMoves` history; on resale it transfers the warranty and active contracts and notifies the owners. A direct edit of `customerId` is blocked (`ext/inst:181`). History tab. | Open tickets and PM visits are not re-pointed to the new owner on resale. | L |
| IB-02 | Component serials with replacement history | Correct | `logic:360-380` `replaceComponent` keeps the old row as `replaced` with `replacedById`. Unique serial, date ≥ fitted date. Components tab. | Not linked to spares consumption: replacing a head through a requisition does not update components. | L |
| IB-03a | Warranty: type, start/end, coverage (parts/labour), exclusions | Partial | `res/inst:239-290`: `coverageType` (parts_labour / labour), dates (end ≥ start), `exclusions`, computed `warrantyStatus` | There is no warranty **type** (standard/extended/OEM) separate from coverage. Add a `warrantyType` master. | L |
| IB-03b | Warranty status checked automatically when ticket raised | Correct | `tkt:66-102` `applyTicketDefaults` → `coverageFor` (`lookups:84-90`, CMC > AMC > warranty > none at the reported date). Shown in the ticket banner (`TicketExtensions.tsx:62-75`) and the portal machine list (`tkt:484`) | `coverageFor` ignores warranty `coverageType`, so a labour-only warranty is treated as parts-covered (see SPR-04b). | M |
| IB-04a | Contract no., type (AMC labour / CMC comprehensive), validity | Correct | `logic:384-388` number `AMC/<FY>/NNNN`; `amcType` amc/cmc; dates with end ≥ start; overlap guard (`ext/inst:243-244`) | — | — |
| IB-04b | **Machines covered** (plural) | Partial | `res/inst:311`: single `machineId` (REQUIREMENTS FR-071 admits "one machine per contract") | A customer with 5 machines needs 5 contracts. Add a `machineIds` multi-relation, or a contract-lines child, then update `coverageFor`, the overlap check and PM generation. | M |
| IB-04c | Number of preventive visits | Correct | `pmVisitsPerYear` 0-12 drives `generatePmVisits` on activate or renew | — | — |
| IB-04d | SLA terms | Partial | `slaTerms` is free text defaulted from the policy (`logic:390-393`, `ext/inst:240`). Ticket SLA uses the global policy matrix by coverage type (`sla:22-35`), not the contract's terms. | Per-contract SLA is not enforced. Accept this (document it) or add numeric SLA overrides on the contract. | L |
| IB-04e | Value and **billing schedule** | Partial | `value` (min 1) and `billingFrequency` (annual / half-yearly / quarterly) only | No instalment schedule or ERP billing request is generated. Generate billing milestones (reuse `paymentMilestones`). | M |
| IB-05a | Reminders 90/60/30 days before expiry to service and sales owners | Correct | `logic:442-475,516-564` `planRenewalSweep`/`runRenewalSweep`: one reminder per threshold, to `ownerId` + `serviceOwnerId` + the customer. Warranties with no follow-on contract are included. Timer every 60 s while signed in (`ext/inst:296-306`). | Only runs while a user is signed in, on the simulated clock (fine for a demo). | — |
| IB-05b | Renewal quotation generated from CRM | Partial | `logic:640-649` `prepareRenewalQuotation` ensures a renewal opportunity, then navigates to `/quotations/new?opportunity=` (`components.tsx:1065-1090`). `editorData` (`services/quotations/workflow.ts:627-647`) only passes the opportunity. | The AMC/CMC line, value and period are not pre-filled from the contract. Accepting the renewal quote does not renew the contract (no link back). Pre-fill a service line and, on accept, offer "Renew contract". | M |
| IB-05c | Renewal pipeline | Correct | `/renewal-pipeline` (`RenewalsPage.tsx`) with buckets due / upcoming / lapsed / renewed / lost, renew and lost actions, and a renewal rate | Warranty-expiry AMC opportunities (`logic:478-507`) do not appear in this pipeline (contracts only). | L |
| IB-05d | Lost-renewal reasons | Correct | `logic:624-634` requires a `lostReason` master value and also loses the opportunity | The Lost tab has no Lost-reason column (`RenewalsPage.tsx:51-80`). Add it. | L |
| IB-06a | Usage readings (print counters, ink) **recorded during visits** | Partial | `machineReadings` resource with monotonic counter guard (`ext/inst:205-213`), added manually from the machine record. The service job card captures `printCounter`/`inkUsedMl` on the **visit** (`jobs:89-97`, `dom/svc:311-312`), but nothing copies them into `machineReadings`. | Readings entered in the engineer app never reach the Readings tab. In `saveWork`/`checkOut`, insert a `machineReadings` row (source `visit`). | M |
| IB-06b | Feeding consumables forecasting | Missing | `con:104-115` `predictReorder` uses order dates only | Use the ink consumption rate from readings as a second predictor, or at least show it on the Reorder page. | M |
| IB-07 | Reports: warranty expiry, AMC due/renewed/lost, machines without contract, base by model/region | Correct | `src/services/reports/defs/installed.ts:25,69,181` (views warranty / renewals / status incl. renewed and lost counts + renewal %, uncovered list, by model/region/coverage) | "Region" = customer state. | — |

### 4.8 Service Ticket Management

| BRD ID | Clause | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| SRV-01a | Channel: phone by coordinator | Correct | `/service-tickets/new`, `channel` defaults to phone (`dom/svc:144`) | — | — |
| SRV-01b | WhatsApp / email-to-ticket | Simulated | `tkt:515-545` `simulateIncoming` identifies the sender by mobile or email. UI: "Incoming message" button **only on Engineer Calendar** (`EngineerCalendarPage.tsx:42,178`) | Always picks the customer's **first** machine (`tkt:529`) with category `other`, which creates false repeat-complaint flags and the wrong machine. Let the user pick the machine, or leave it blank. Expose the button on the Service Tickets list as well. | M |
| SRV-01c | Customer portal / app | Simulated | Public `/customer-portal/log-ticket` (`PublicPages.tsx:136+`) | Nothing in the app links to it (not in the sidebar, no button), so demo users can't find it. | L |
| SRV-01d | Engineer app | Correct | Engineers logging a ticket become its assignee (`tkt:92`). Channel `engineer_app` | — | — |
| SRV-01e | Auto ticket number | Correct | `idPrefix 'TKT'`, `idFormat 'fy'` (`dom/svc:128-129`) | — | — |
| SRV-01f | Customer identified by mobile or machine serial | Partial | Portal and incoming: `portalIdentify` (`tkt:456-484`). Coordinator form: customer is a required picker; the machine picker is filtered by customer (`dom/svc:137-142`). | The phone desk has no "lookup by mobile/serial" box. Add a caller lookup field to the Log Ticket form that fills customer and machine. | M |
| SRV-02a | Customer, serial, complaint date/time, description | Correct | `reportedAt` auto (`tkt:69`); machine required except for Ink/Paper/Fabric divisions or spare-only (`tkt:76-78`) | — | — |
| SRV-02b | Category / sub-category | Correct | `complaintCategory` with dependent `complaintSubCategory` (`dom/svc:40-101,147-148`). The real master is pending from TC (§13). | — | — |
| SRV-02c | Priority | Correct | `ticketPriority` (`dom/svc:150`) | — | — |
| SRV-02d | **Photos / videos** on the ticket | Missing | No media field on `tickets` (`dom/svc:136-188`) and none on the portal. Photos exist only on engineer visits (`MyJobPage.tsx:265-277`). | Add `mediaFiles` (file-name metadata, as for installations) to the Log Ticket form and the portal. | M |
| SRV-02e | Warranty/AMC status shown automatically | Correct | `coverage` computed at creation, shown as a banner | — | — |
| SRV-03 | 8 ticket types | Correct | `dom/svc:68-77` all 8 | — | — |
| SRV-04 | Priority × contract-type SLA targets | Correct | `sla:22-35` `policies.sla[priority][coverage]`, editable at `/admin/sla-matrix`. A priority change re-targets running clocks (`tkt:115-121`). | — | — |
| SRV-05a | Manual assignment by coordinator/manager | Correct | `tkt:255-271` `assignTicket` (capability `ticket.assign`); response clock met on assignment | — | — |
| SRV-05b | Suggested assignment by territory, skill, availability, workload | Correct | `board:72-107` division (skill), territory, model history, open load, leave/attendance | — | — |
| SRV-05c | Engineer calendar and map view | Partial / Simulated | `/engineer-calendar`: 7-day load per engineer and a territory **grid** (`board:117+`), no map | Acceptable as simulated. Label it "Territory grid (map simulated)". | L |
| SRV-06a | Accept, start travel, geo check-in, diagnosis, work, parts, before/after photos, check-out | Correct / Simulated | `jobs:54-126`; GPS mock flag stored (`jobs:66-77`); photos stored as names | "Parts used" on the visit is **free text** (`dom/svc:308`), separate from the Spares Requisitions "Parts Used" tab. These are two parts records that never reconcile. | M |
| SRV-06b | Customer sign-off OTP/signature | Simulated | `jobs:101-126`. OTP is in memory. A signature is only a `signed` boolean (the image is not stored). | Store the signature data URL on the visit, as installations already do. | L |
| SRV-06c | Works offline and syncs | Simulated | `useStep.ts`, `services/offline.ts`: a toggle applies writes locally and lists them as pending | — | — |
| SRV-07 | Remote support: steps, duration, session ref, convert to site visit | Correct | `tkt:274-303`: logs a remote visit; outcome resolved / site_visit / continue; site_visit retypes `remote_support`→`breakdown` and alerts the desk | — | — |
| SRV-08 | Job card PDF auto-generated and sent by email/WhatsApp | Simulated | Sent at **Resolve** (`tkt:172-176,213-237`); print view `/service-tickets/:id/job-card`; resend (`tkt:392`) | The job card goes by email only if the contact has an email. WhatsApp carries only the feedback link. | L |
| SRV-09a | SLA clocks for response, arrival, resolution | Partial | `sla:28-68`. Arrival is met by check-in (`jobs:72`), **but also by any transition to In Progress** (`tkt:166`), e.g. the desk clicking "Start work" from Accepted with no site visit. | The on-site arrival SLA can be "met" without arriving on site. For site tickets, set `arrivedAt` only on check-in or remote session. | M |
| SRV-09b | Pause while Waiting for Customer | Correct | `tkt:162-163`, `sla:53-82`: pause only in `waiting_customer`; due times shifted on resume; `waiting_parts` does not pause (as the BRD says) | — | — |
| SRV-09c | Escalation matrix Service Manager → Service Head → GM → MD, auto alerts | Partial | `tkt:547-580`: levels at 0/4/8/24 h after breach (`policies.ts:93-97`). Levels 1 **and** 2 both notify `service_head` (`tkt:570`), level 3 notifies division_head, level 4 management. | Level 1 (Service Manager) should go to the coordinator or service manager role. Make each level map to a configurable role. | L |
| SRV-10a | Service quotation for out-of-warranty / non-contract visits and parts | Partial | `tkt:305-320` amount + note, sent to the customer. `chargeableBlocker` (`tkt:134-138`) only forces a quote when coverage = `none`. | **AMC (labour-only) tickets with chargeable parts never need a quote.** Spares consumption marked `chargeable` (`req:129-158`) does not feed the ticket's chargeable amount. Parts are not itemised. Sum chargeable requisitions into the quote, and require a quote when any chargeable consumption exists. | M |
| SRV-10b | Customer approval | Simulated | `tkt:322-333`: the desk records the customer's decision | No customer-side approval link (the feedback page pattern could be reused). | L |
| SRV-10c | Billing request to ERP | Simulated | `tkt:335-347` event `erp.billing_requested` and audit | — | — |
| SRV-11a | Auto-generated PM schedule per contract | Correct | `logic:71-94` on warranty sign-off, contract activation and renewal | — | — |
| SRV-11b | Model-wise checklist | Partial | `pm:22-26`: checklist by **division** (TX/POD/LBL) + common items, not by model | Key the checklist on `machine.model` with a division fallback. | L |
| SRV-11c | Due/overdue lists, completion status | Correct | sweep `tkt:582-587` due/overdue/missed (missed = 30 days overdue); `/pm-schedule` tabs; `completePm` requires every item answered and notes for failed items (`pm:79-97`); a resolved PM ticket completes the visit (`tkt:203-210`) | — | — |
| SRV-12a | Auto WhatsApp/SMS feedback link at closure | Correct | Sent at Resolve → `customer_confirmation` (`tkt:172-176,213`). Public `/feedback/:token` | Sent at Resolve rather than at Closed. This is a sensible reading because the customer's answer is the closure confirmation. Document it. | L |
| SRV-12b | 1-5 rating and comments | Correct | `tkt:419-453` validates an integer 1-5 | — | — |
| SRV-12c | Low rating alerts Service Manager | Correct | rating ≤ `lowRatingThreshold` (2) → `service_head` escalation notification (`tkt:445-447`) | "Service Manager" here maps to service_head. | L |
| SRV-12d | Customer closure confirmation | Correct | "Resolved? yes" → Closed; "no" → back to In Progress and the engineer is alerted; auto-close after `autoCloseDays` (3) (`tkt:577-579`) | — | — |
| SRV-13 | Repeat complaint flag (same machine + category within N days) with root cause | Correct | `tkt:83-90` (`repeatComplaintDays` 30, editable in `PolicyPages.tsx`). Root cause required to close (`tkt:150`, `tkt:440-441`). Banner, "Repeat complaints" view. | False positives from the incoming simulator's `category:'other'` (see SRV-01b). | L |
| SRV-14 | "Opportunity spotted" creates a lead with the engineer as referrer | Correct | `tkt:359-389`: lead `sourceId:referral`, `referrerType:engineer`, `referrerEmployeeId`; owner = account owner, who is notified; one per ticket | — | — |
| SRV-15 | Re-open within a configurable period | Correct | `tkt:152-155` (`reopenWindowDays` 15), clocks re-computed and counters reset (`tkt:185-199`) | — | — |
| SRV-16 | Knowledge base searchable by model/error code; engineer contributions with approval | Correct | `dom/svc:411-418` models, errorCodes; draft→pending raises an approval (`ext/svc` `service.tsx:44-66`); drafts hidden from others (`service.tsx:70`). `/knowledge-base` | — | — |
| SRV-17 | Reports: ageing, SLA compliance, MTTR, FTFR, downtime, repeats, MTBF by model, PM compliance, productivity, CSAT | Correct | `src/services/reports/defs/service.ts` + `kpis.ts` (`ageingBuckets, mttrHours, fixCounts, mtbfByModel, pmCounts, csat, slaCounts`); catalog aliases `reports/catalog.ts:42-50` | I did not check the numbers by hand. | — |
| Status flow | Open → Assigned → Accepted → In Progress → Waiting Parts/Customer → Resolved → Customer Confirmation → Closed (Re-opened) | Correct | `dom/svc:193-211`. `resolved` is transient: it is immediately patched to `customer_confirmation` (`tkt:171-173`). | Users never see "Resolved", so it is missing from the board columns in practice (UX). | L |

### 4.9 Spare Parts & Engineer Stock

| BRD ID | Clause | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| SPR-01 | Spares master: part no., description, compatible models, HSN, price, warranty applicability (ERP-synced) | Simulated | `dom/spr:107-132`; unique uppercase part no. (`ext/spr:124-138`); HSN format validated; "Sync stock from ERP" (`req:205-222`) | `compatibleModels` is free text, so it can't filter parts by the ticket's machine model. | L |
| SPR-02 | Stock visibility at main store | Simulated | `stock:39-80` `/main-store-stock`: on-hand, min level, in transit, with engineers, value | — | — |
| SPR-03a | Requisition raised from a ticket by the engineer | Correct | `requisitions` with `ticketId` required; engineers can raise only for themselves (`ext/spr:36-38`); closed tickets are rejected (`ext/spr:42`); ticket → `waiting_parts` (`ext/spr:59`); Parts Used tab on the ticket | Waiting Parts is set by a direct patch, not a lifecycle transition, so ticket transition hooks and audit don't run (a lower-impact side effect). | L |
| SPR-03b | Approval | Correct | Approval request with capability `approve.service` (`ext/spr:62-71`); no self-approval (`ext/spr:91`); reject needs a reason (`req:85-99`) | — | — |
| SPR-03c | Issue by Store In-charge with courier/dispatch details | Correct | `req:102-126`: issued ≤ requested ≤ main-store stock, courier and docket required, stock decremented, below-min alert | — | — |
| SPR-03d | Receipt acknowledgement | Correct | `issued → received` by the receiving engineer only (`ext/spr:93-94`); ticket released when no requisition is still open (`req:65-71`) | — | — |
| SPR-04a | Consumption recorded against ticket and machine as warranty or chargeable | Correct | `req:129-158`; machine and customer copied from the ticket (`ext/spr:46-47`); unused quantity returned to the main store | — | — |
| SPR-04b | (logic) Warranty vs chargeable basis | Partial | Suggested basis = warranty when coverage is warranty/CMC (`ext/spr:53`). A `labour`-only warranty still counts as `warranty`, because `coverageFor` ignores `coverageType`. Basis is free to override, except for non-warranty parts. | Respect warranty `coverageType`, and link chargeable consumption to the SRV-10 quote. | M |
| SPR-04c | Defective part return tracking | Correct | `defectiveReturn` pending/received/not_required; store alerted; `receiveDefective` (`req:178-185`); engineer stock shows "defective to return" (`stock:118`) | — | — |
| SPR-05 | Warranty claims to OEM (claim no., status) | Correct | `warrantyClaims` raised → accepted (claim no. required) → credited (credit note required) / rejected (`dom/spr:267-286`, `ext/spr:144-162`); prefilled from a requisition (`req:188-202`) | — | — |
| SPR-06a | Minimum-level alerts for critical parts | Correct | `req:59-62,225-259` alerts store + SCM; `/minimum-level-alerts` with critical parts first and a suggested quantity | Alerts are raised on issue/min change or by a manual sweep button, not on a schedule. | L |
| SPR-06b | Visibility of import requirements to Import/SCM | Correct | Stock-short requisition → SCM notified (`ext/spr:61`); open demand on the alerts page (`req:254-258`) | — | — |
| Title | Engineer stock | Correct | `stock:132-173` `/engineer-stock`, derived from requisitions; engineers see only their own (enforced in the service) | Partial-unused returns at consumption are not counted in "returned" (`stock:113-120`). | L |
| Workflow | Requested → Approved → Issued/Dispatched → Received → Consumed \| Returned | Correct | `dom/spr:216-217` + service actions; terminal states locked (`ext/spr:75`); Rejected added | — | — |

### 4.10 Consumables & Repeat Business

| BRD ID | Clause | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| CON-01 | Consumables customers linked to installed machines; non-machine customers too | Correct | `con:155-171` `customerConsumables` → Customer 360 Consumables tab (`ext/spr:238`), `nonMachineCustomer` flag | The "two systems" note is N/A for the frontend. | — |
| CON-02a | Quick repeat order from previous order | Correct | `/repeat-orders` (`con:207-262`) → `/sales-orders/new?repeatOf=`; `so:236-272` copies lines and prices them by rate contract, then price list, then previous price | — | — |
| CON-02b | Customer-specific rate contracts with validity | Correct | `rateContracts` with validFrom/To, computed validity, overlap check (`con:174-186`, `ext/spr:183-199`) | — | — |
| CON-03 | Leakage list: machine customers not buying consumables | Correct | `con:59-97` `/leakage-list` (no consumables order in `leakageDays` = 90) | Not split by type: a customer buying paper but no ink is not flagged. | L |
| CON-04a | Reorder prediction from order frequency **or consumption** | Partial | `con:104-115`: average of the last 3 order intervals; needs ≥ 2 orders; per customer, not per product | Consumption-based prediction is missing (see IB-06b). Predict per product family. | M |
| CON-04b | Reminder to salesperson when due; "missed reorder" alert | Partial | `con:134-152` notifies owners, but only from the **manual** "Send reminders" button (`modules/spares/pages.tsx:182`) | Not automatic. Add it to a sweep, as renewals and SLA already do. | M |
| CON-05 | Sample/trial dispatch tracking with results and feedback | Correct | `sampleDispatches` requested → dispatched → trial → results (result required) / cancelled; feedback; follow-up date; owner alerted on a non-positive result (`dom/spr:346-388`, `ext/spr:203-221`) | — | — |
| CON-06 | Dealer/distributor orders, secondary sales | Simulated | `/dealer-orders`, `prepareDealerOrder` (`con:306-328`): dealer category, end customer, no duplicate invoice | Could; fine. | — |

### 3.1 Hand-offs (service side) and Appendix A

| Hand-off / workflow | Verdict | Evidence | Gap | Sev |
|---|---|---|---|---|
| Machine delivered → installation job + handover form issued | Correct | `so:901,907-923`; `ext/inst:102-114` (coordinator, engineer and sales owner notified) | — | — |
| Installation signed off → installed base + warranty + PM schedule | Correct | `logic:231-301` (atomic) | Admin "Mark completed" bypass (INS-07d) | M |
| Warranty/AMC nearing expiry → reminders + renewal opportunity for sales and service owners | Correct | `logic:516-564`, `ensureRenewalOpportunity` `logic:396-421`, `ensureWarrantyOpportunity` `logic:478-507` | The renewal quote is not pre-filled and does not loop back (IB-05b) | M |
| Ticket closed → job card sent, feedback link sent, low rating escalated | Correct (at Resolve) | `tkt:172-176,213-237,445-447` | Timing differs from the BRD (documented interpretation) | L |
| Engineer "Opportunity spotted" → lead with engineer referrer | Correct | `tkt:359-389` | — | — |
| SO: … Dispatched → Delivered → Installation → Completed | Correct | `orders.ts` domain:139-150, `ext/so:71-78` | The SO "Start Installation" manual button duplicates the automatic move (UX) | L |
| Installation job: Scheduled → Site Ready → In Progress → Trial & Training → Signed Off | Correct | `res/inst:91-102`; Signed Off only via the sign-off dialog | INS-03c ordering | M |
| AMC: Draft → Active → Due for Renewal → Renewed \| Expired \| Lost | Correct | `res/inst:330-340`, sweep auto-activate/due/expire (`logic:523-532`); manual expiry blocked before the end date (`ext/inst:256`) | — | — |
| Service ticket | Correct | `dom/svc:193-211` | "Resolved" is never visible | L |
| Spares requisition | Correct | see SPR table | — | — |

---

### UX confusion points (first-time user)

1. **Two "Start Installation" buttons.** One is on the Sales Order (SO lifecycle, `orders.ts` domain:147) and one is on the Installation Job. The SO one only changes the SO status. It does nothing to the job, and the job's progress also moves the SO automatically. Hide the SO button, or relabel it "Mark installation started".
2. **Parts are recorded twice.** The engineer app's job card has a free-text "Parts used" field (`dom/svc:308`). The ticket's "Parts Used" tab lists Spares Requisitions. A user will type parts in the job card and expect stock to move, but it won't.
3. **Readings are recorded twice.** Print counter and ink entered on the job card are not shown on the machine's Usage Readings tab.
4. **"Resolved" never appears.** Resolving a ticket jumps straight to "Customer Confirmation", so users looking for a Resolved column or filter find nothing.
5. **WhatsApp/email simulator is hidden.** It sits on the Engineer Calendar page (`EngineerCalendarPage.tsx:42`), and the customer portal has no link anywhere. A demo-giver has to know the URL `/customer-portal/log-ticket`.
6. **The incoming-message ticket picks the customer's first machine** and category "Other". The ticket can show the wrong machine, coverage and SLA.
7. **Installation scheduling vs readiness.** The UI allows setting a date and engineer, which notifies the customer, before the site checklist is verified. That reads as "scheduled before ready", against INS-03.
8. **Site coordinates are required to schedule** (`ext/inst:67-72`). The error mentions map location, but the user is on the installation job and has to go to the customer's address to fix it.
9. **OTP is lost on reload** (installation and service sign-off OTPs live in memory). If the presenter refreshes between sending and entering the OTP, the code is rejected.
10. **Renewal quotation opens an empty editor.** It is linked to the opportunity, but the user has to add the AMC line and value by hand. Accepting the quote does not renew the contract, so users renew a second time from the contract.
11. **Lost renewals hide their reason**: there is no reason column on the Lost tab of `/renewal-pipeline`.
12. **"Send reminders" on Reorder Prediction is manual.** Users assume reminders are automatic, like renewals and SLA.
13. **AMC contract covers one machine.** A user creating "the AMC for ABC Prints' 3 printers" has to create 3 contracts, each with its own number.
14. **The Unassigned tickets view can be empty for a coordinator** (failing test `service.qa.test.ts:98`). The SRV-05 demo of "assign from the queue" may have nothing to assign. Check the seed (`src/mocks/service.ts:168`).

### Top 10 fixes ranked

1. **Feed chargeable spares into the service quote and require a quote for AMC (labour-only) parts** (`tkt:134-138`, `req:129-158`). Without this, SRV-10 is wrong whenever a ticket has a contract. **M→H for a demo of chargeable service.**
2. **Make the on-site arrival SLA honest**: set `arrivedAt` only on check-in or remote session, not on any `→ in_progress` (`tkt:166`). (SRV-09)
3. **AMC/CMC "machines covered" as multi-machine** (`res/inst:311`), and update `coverageFor`, overlap and PM generation. (IB-04b)
4. **Write job card readings into `machineReadings`** (`jobs:89-97`), and use the ink rate in reorder prediction (`con:104`). (IB-06, CON-04a)
5. **Merge job card "Parts used" with requisitions.** Replace the free text with a picker of the ticket's received requisitions and consume from there. (SRV-06, SPR-04)
6. **Add photo/video attachments to Log Ticket and the portal** (`dom/svc:136-188`). (SRV-02d)
7. **Guard the SO "Mark completed" for machine orders** until the installation job is signed off (`orders.ts` domain:149, `ext/so`). Also hide or relabel the SO "Start Installation" button. (INS-07, UX 1)
8. **Pre-fill the renewal quotation from the contract and close the loop**: on accept, renew the contract (`logic:640-649`, `quotations/workflow.ts:627`). (IB-05b)
9. **Add caller lookup (mobile/serial) on the coordinator's Log Ticket form**, and let the incoming simulator choose the machine instead of `machines[0]` (`tkt:529`). Expose the simulator on the Service Tickets list. (SRV-01)
10. **Make warranty `coverageType` count** in `coverageFor` / requisition basis (`lookups:84-90`, `ext/spr:53`), and add an automatic reorder-reminder sweep (`con:134`). (IB-03b, SPR-04b, CON-04b)

Also worth fixing (low): persist OTPs; store the service signature image; map escalation level 1 to the coordinator or service manager (`tkt:570`); key the PM checklist by model (`pm:22`); add a lost-reason column; add a billing schedule for AMC (IB-04e); fix the seed so the failing SRV-05 test passes.

### REQUIREMENTS.md accuracy (scope rows)

- FR-071 (IB-04) is marked "Done", but it lacks multi-machine coverage and a billing schedule. It should be **Partial**.
- FR-073 (IB-06) is marked "Done (Readings tab)", but visit readings are not captured and nothing feeds forecasting. It should be **Partial**.
- FR-076 (SRV-02) is marked "Done", but ticket photos/videos are missing. It should be **Partial**.
- FR-083 (SRV-09) is marked "Done", but the arrival clock can be satisfied without arriving, and escalation level 1 goes to the wrong role. It should be **Partial**.
- FR-084 (SRV-10) is marked "Done", but chargeable parts under AMC are not quoted. It should be **Partial**.
- FR-085 (SRV-11) claims "model-wise checklist", but the checklist is division-wise. This is a minor gap.
- FR-101 (CON-04) is marked "Done", but prediction is frequency-only and reminders are manual. It should be **Partial**.
- FR-062 (INS-03) is marked "Done", but the BRD's "verified before scheduled" ordering is not enforced. It should be **Partial** or carry a documented interpretation.
- Every other row in scope matches the code.


---

## Part E-field-reports-nfr

## Audit E: Field Force, Targets, Dashboards & Reports, Integrations, NFR, Migration, KPIs

Repo: `/Users/maysolanki/Documents/True-Color/tc_frontend` (branch `feature/crm-modules`, clean). Read-only audit, 2026-10-21.
Paths are relative to `src/` unless noted. Routes come from `constants/routes.ts:143-160`. Every route below is reachable from the sidebar (`domain/sidebar.ts:129-165`).
Method: code reading, plus two throw-away vitest probes run against a fresh `createDb()` seed (`scratchpad/audit/probe/*.test.ts`, kept outside the repo).

Verdict key: Correct / Partial / Wrong / Missing / Simulated / N/A-frontend. Severity: H = misleading in a demo or breaks a BRD rule; M = a visible gap; L = polish.

### 1. Clause-by-clause

#### 4.11 Field Force

| BRD ID / section | Clause | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| ATT-01 | Check-in/out with date, time, GPS, optional selfie; status present / half-day / leave / on tour | Partial (GPS Simulated) | `/attendance`. `services/field/field.ts:111-178` (check-in/out, one open check-in a day, out after in); status master `domain/modules/field.ts:26`; half-day worked out at check-out `domain/modules/field/rules.ts:36-47`; approved leave writes `leave` days `domain/extensions/field.tsx:242-249`. GPS comes from browser geolocation or a simulated point `modules/field/common.tsx:44-56` | **Selfie is only a boolean switch** (`modules/field/AttendancePages.tsx:173`, stored as `selfie: true` at `field.ts:143`). There is no capture or image. Fix: use the existing file/camera primitive (`components/primitives/controls.tsx` has a file input) with `capture="user"` and store a thumbnail data URL. | M |
| ATT-02 | Geo-fenced office attendance; mock / fake GPS detection | Simulated | `field.ts:125-127` blocks office roles outside the radius (configurable at `modules/catalog/PolicyPages.tsx:406`); mock attempts are blocked, flagged and audited (`field.ts:101-118`) and shown on `/exception-dashboard` | "Detection" is the user choosing "Mock GPS app" in a picker that every user sees (`common.tsx:61-63`). There is one hard-coded office (`rules.ts:70`), so no multi-branch geofences. Fix: move the mock source to Demo Settings, or show it only to admins with a "demo" tag. | M |
| ATT-03 | Working hours, late entry, early exit per shift policy | Correct (single shift) | `/team-attendance`; `rules.ts:36-47`; shift/grace/half-day are editable in policies (`PolicyPages.tsx:408-421`, defaults `services/policies.ts:107`) | Only one company-wide shift; no per-role or per-location shifts. Acceptable for a prototype; note it as an Assumption. | L |
| ATT-04 | Regularisation request with reason + manager approval | Correct | `/attendance` → Request Regularisation (`AttendancePages.tsx:196`); resource `domain/modules/field.ts:91-118` (reason required, out ≥ in, past date); on approval the attendance is rewritten as `regularised` (`domain/extensions/field.tsx:98-106`) | None. | — |
| ATT-05 | Field visit: customer/site, purpose (5 values), geo-tagged check-in/out at site, remarks, next action, linked to account/lead/opportunity/ticket | Partial | `/field-visits`; purposes `domain/modules/field.ts:28`; links `field.ts:424-440`; activity on the timeline `field.ts:316-336` | (1) **Check-out is not geo-tagged.** `completeVisit` (`field.ts:402-414`) and quick log (`field.ts:346-381`) store only check-in coordinates. Quick log also sets check-in = check-out, so dwell time is zero. (2) Quick log skips the "next action date cannot be past" rule that `completeVisit` enforces (`field.ts:405`). Fix: capture `checkOutLat/Lng` and validate `nextActionDate` in `logVisit`. | M |
| ATT-06 | Weekly beat plan per user; manager planned vs actual | Correct | `/beat-plan`; `field.ts:471-491` (visited / missed / pending / unplanned); a visit auto-marks its beat (`field.ts:338-343`) | None. | — |
| ATT-07 | Location tracking only between check-in and check-out at a configurable interval; route map; distance | Simulated / Partial | `/route-map`, `/route-map/:userId`; route = check-in + the day's visit check-ins + check-out (`field.ts:166-174`); SVG polyline `AttendancePages.tsx:667-677`; straight-line km `rules.ts:67`; consent gate `field.ts:61-78` | **There is no interval anywhere** (no setting, no periodic pings), so "configurable interval" is missing even as a simulation. There are no map tiles, and the distance is a haversine between stops, not road km. Fix: add a `trackingIntervalMin` policy and generate synthetic pings at that interval between check-in and check-out. | M |
| ATT-08 | T&E: distance-based conveyance from tracked km, bill upload, policy limits, approval, export to accounts/payroll | Partial | `/expense-claims`, `/expense-claims/payroll-export`; km × rate (`rules.ts:101-108`); "Fill km from tracked route" (`extensions/field.tsx:171`); two-level approval manager → Accounts (`extensions/field.tsx:157`); above-limit claims need a justification (`:123`); payroll CSV is audited (`field.ts:500-515`) | (1) **The bill "upload" is a typed text field** `billFileName` (`domain/modules/field.ts:232`; help text says "simulated upload"). (2) **Policy limits are hard-coded** (`rules.ts:99` `EXPENSE_LIMITS`) and are not in Policies, although the rates are. Fix: use a file picker that stores name, size and type (10 MB check), and move the limits into `policies.ts` and the Policy page. | M |
| ATT-09 | Leave application and approval (or HRMS) | Correct (HRMS N/A) | `/leave-applications`; overlap check `extensions/field.tsx:204`; approval marks attendance `:242-249` | Leave days include Sundays (`eachDay`), and Sundays are treated as off elsewhere (`field.ts:244`). Minor. | L |
| ATT-10 | Reports: daily/monthly and employee-wise attendance, field-visit reports, exception dashboard (no check-in, late, no visits) | Partial | Live board `/exception-dashboard` (`field.ts:238-262`) covers no check-in, late, early, not checked out, no visits and mock. Reports `/reports/field-force` → attendance daily / by employee / exceptions, field visits, hours (`services/reports/defs/field.ts`) | **The exceptions report computes exceptions differently from the dashboard** (`defs/field.ts:93-104`). It has no "no visits logged" and no "no check-in" (only days that already have an `absent` record), so history under-reports exactly the two exceptions the BRD names. Fix: build the report rows from `attendanceExceptions()` for each day in the range. "Monthly" is a date-range filter, not a month grid (acceptable). | M |

#### 4.12 Targets & Recognition

| BRD ID / section | Clause | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| TGT-01 | Targets by user / team / division / product category; month / quarter / year; order value, quantity, collections, new customers, activities | Correct | `/targets`; masters `domain/modules/field.ts:36-38`; period start normalised to FY quarter or year, duplicate check, division-membership check (`extensions/field.tsx:294-305`) | None. | — |
| TGT-02 | Achievement calculated automatically from orders and payments; target vs actual with drill-down | Partial | `/target-vs-actual`; `rules.ts:193-223` (BOOKED orders by order date, collections from `paymentMilestones.receivedAt`). Probe: adding a confirmed order for E-1012 moved order_value from ₹11,93,158 to ₹58,41,908, so it is live | **The drill-down is a popover of names and numbers only** (`modules/field/PerformancePages.tsx:139-160`). It is absent for user-level targets (`:143` returns null) and links to no orders or payments. Fix: link each member and target to `/sales-orders?owner=…&orderDate=…` (or payments for collections). | M |
| TGT-03 | Weekly activity scorecard per role (calls, visits, demos, quotations, referrals) from CRM data | Partial / **Wrong vs Appendix C report** | `/activity-scorecard`; `field.ts:608-635`; role filter `PerformancePages.tsx:261-308` | There are two different implementations (see §2 and Fix #1). The page counts quotations by `quoteDate/createdAt` (drafts included) and referrals by `referrerEmployeeId` regardless of source. The Business Scorecard uses `kpis.ts:222-239` (sent quotations, `sourceId==='referral'`, visits double-counted). Same week (12–18 Oct), page vs report: visits **66 vs 145**, quotations 14 vs 7, referrals 1 vs 3. Demos were 0 in both, so the demo column looks dead in the demo data. | H |
| TGT-04 | Leaderboards and recognition (Deal of the Month, badges) within the division | Correct | `/leaderboards`; `field.ts:648-687` (division-restricted, Deal of the Month = largest booked order in the month, 5 badge rules) | None. | — |
| TGT-05 | Incentive rules or export of achievement | Correct (export only) | Export button `PerformancePages.tsx:191-200` → `exportAchievement` (audited, permission-checked) `field.ts:579-583` | Incentive rules are Deferred (Q-25), as documented. | L |

#### 4.13 Dashboards & Reports

| BRD ID / section | Clause | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| 4.13 role-based | Dashboard per role | Correct | `/dashboard`; role → family map `services/reports/dashboard.ts:57-70`; KPIs per family `services/reports/overview.ts:422-448`; loading, error and skeleton states `pages/DashboardPage.tsx:106-128` | The sales-family "Target vs Actual" tile falls back to **`rows[0]`, an arbitrary visible target**, when the viewer has no target of their own (`overview.ts:362`). A manager sees someone else's target labelled as theirs. Fix: show the team or division target, or hide the tile. | M |
| 4.13 module-based | Reports per module | Correct | `/reports` catalogue + 8 categories (sidebar `domain/sidebar.ts:156-164`); about 30 report definitions under `services/reports/defs/*` | None. | — |
| 4.13 decision-based | Alerts and drill-downs | Correct | Alerts, agenda and feed (`overview.ts:757-800`); KPI tiles link to filtered lists (tested `test/reports.handcheck.test.ts:181`) | None. | — |
| 4.13 customisable | Customisable after implementation | Deferred | Q-26 in `docs/REQUIREMENTS.md:252` | Documented deferral. | L |
| 4.13 real-time | Reliable real-time view | Correct | `services/reports/dataset.ts:11-23` reads the live store through scoped `queryRecords`; the cache lives for one call only. Probe confirmed it (see §2) | None. | — |

#### §6 Integration Requirements (Admin → `/admin/integrations`, `services/catalog/integrations.ts`)

| BRD ID / section | Clause | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| §6 API-first | Documented REST APIs for all entities | Simulated | Async facade `services/api/*.ts` (one file per module); `docs/CONTRACTS.md` | No real endpoints (N/A). | — |
| §6 ERP | Masters, SO push, invoices, receipts, outstanding, credit, stock (two-way) | Partial (Simulated inbound only) | `syncFromErp` `integrations.ts:141` (balances + spares stock) | **Outbound "sales order push" and inbound invoices/receipts are not simulated.** The label admits this ("would also push", `constants/labels.ts` erpTip). Fix: add a "Pushed to ERP" status and timestamp on order approval, plus a simulated receipt import. | M |
| §6 Zoho | One-time migration | N/A-frontend | Listed as "Not connected" `labels.ts:8815` | Generic CSV import covers some of it (see §8). | L |
| §6 Web / Meta / Google | Automatic lead capture | Simulated | `simulateIncomingLead` `integrations.ts:76`; channels `:22` | None. | — |
| §6 IndiaMART / TradeIndia | Lead capture | Partial | IndiaMART is a channel (`integrations.ts:22`) | **TradeIndia is missing.** Fix: add a channel key. | L |
| §6 WhatsApp | Two-way: quotations, reminders, updates, feedback, ticket logging | Simulated | Inbound to ticket `integrations.ts:172`; outbound messages go through `services/outbox.ts` | None. | — |
| §6 Email | Send/receive, email-to-ticket, calendar sync | Partial | Email-to-ticket simulated (`:172`); outbox for sending | Calendar sync is "Not connected" (`labels.ts:8815+`). | L |
| §6 Maps | Geo-tagging, routes, distance, map views | Simulated | Coordinates + SVG route `AttendancePages.tsx:667` | No map view or road distance. Acceptable; label it "schematic". | L |
| §6 E-signature | Contracts / sign-offs (Could) | Simulated | On-screen one-time code (labels "Not connected" list) | None. | — |

#### §7 Non-Functional Requirements

| BRD ID / section | Clause | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| §7 Architecture | Web + apps; modular API-first; dev/UAT/prod | Simulated | Module packs `domain/modules/*`, services per module | Native apps and environments are N/A. | — |
| §7 Hosting / Availability | India cloud, 99.5% | N/A-frontend | `netlify.toml` static hosting | — | — |
| §7 Performance | 95% of screens < 3 s on 4G; 1-year reports < 10 s | Partial | 300–800 ms simulated latency `services/db.ts:17`; skeletons on all audited pages | **The production bundle is one 3.06 MB JS chunk (865 kB gzip), with no `React.lazy` anywhere** (Vite warns about it). On real 4G (≈1.5–3 Mbps effective) that alone is about 2.5–5 s before first paint, which puts the 3 s target at risk. Fix: lazy-load routes per module and split Recharts/xlsx into vendor chunks. | M |
| §7 Scalability | 300 users, 5 years | Simulated | Seed of about 2.7 MB in localStorage | Large demo stores risk hitting the localStorage quota (~5 MB). Note only. | L |
| §7 Security: TLS / AES / OWASP / VAPT | — | N/A-frontend | — | — | — |
| §7 Security: MFA admin/management | Simulated | `services/session.ts:24-41` (OTP shown on screen) | None. | — |
| §7 Security: password policy + session timeout | Simulated | Idle timeout `session.ts:65-67` (configurable, audited logout); no passwords | Password policy N/A. | L |
| §7 Security: role / record / field-level | Correct (client-side) | Row scope + masking in runtime/authz; reports use the same scope (`dataset.ts:15`); tested `reports.handcheck.test.ts:202` | Bypassable in devtools (inherent to a prototype). | — |
| §7 Data protection (DPDP) | Consent for location tracking, retention, erasure | Simulated / Partial | Location consent gate `field.ts:58-78`; Settings → Data Protection `/admin/data-protection` | **Location consent lives in a separate localStorage key** (`tc.field.locationConsent.<user>`), not in the db. "Reset demo data" (`services/db.ts:139-146`) does not clear it, and there is no "withdraw consent" on `/attendance`. Seeded users count as consented because they have past `device` check-ins (`field.ts:68`). Fix: keep consent in `db` (with audit) and add a withdraw action. | M |
| §7 Backup & recovery | Daily backups, RPO/RTO | N/A (partly Simulated) | Full JSON export/import + reset `db.ts:149-158` | None. | — |
| §7 Audit logs | Retained ≥ 3 years, not editable | **Partial / Wrong vs claim** | Append-only in the UI, but `services/ledger.ts:21` runs `if (d.audit.length > 2000) d.audit.length = 2000;` | **Old audit entries are silently dropped after 2,000.** REQUIREMENTS.md says NFR-13 "Done". Fix: drop the cap, or archive old entries to a separate key, and show "retention: 3 years (simulated)". | M |
| §7 Usability | §2.2 adoption rules; 5–6" phones; contrast | Partial | Check-in 1 tap, quick visit log (`VisitPages.tsx:215-310`); skip-link and reduced-motion (`styles/app.css:82,325`); ARIA labels on charts and SVG | `modules/field/field.css` has only **1** `@media` rule, so tablet/phone layout relies on the generic shell. Hindi Deferred. Contrast not measured. | L |
| §7 Mobile / offline | Offline sync with conflict handling | Simulated / Partial | `services/offline.ts` queue + ordered replay, conflicts reported (`:46-63`) | **The queue is in memory only** (`offline.ts:5`), so a reload while "offline" silently loses queued check-ins and visits. Offline is a manual toggle, not `navigator.onLine`. Fix: persist the queue in localStorage and listen to `online`/`offline` events. | M |
| §7 Browsers | Latest 2 of Chrome / Edge / Safari | Not verified | `docs/REQUIREMENTS.md:275` says Chrome only | Playwright config exists; add WebKit/Edge projects. | L |
| §7 Maintainability / Ownership | Docs, repo, full data export | Correct | TS, docs/, JSON export, CSV per list | None. | — |

#### §8 Data Migration

| BRD ID / section | Clause | Verdict | Evidence | Gap / proposed fix | Severity |
|---|---|---|---|---|---|
| §8 Zoho (accounts, contacts, leads, deals, activities, notes, attachments) | — | Partial (Simulated via CSV) | Generic template import for every resource the actor may create, validated like the forms and audited (`services/catalog/importer.ts:1-30`) | No attachment import; no ID-mapping or dedupe report specific to Zoho exports. Fine for a prototype. Mark it "Simulated (CSV templates)" rather than N/A. | L |
| §8 Excel registers (installed base, warranty/AMC, history) | — | Partial | Same importer | Same as above. | L |
| §8 ERP masters / open orders / outstanding | — | Partial | Importer + `syncFromErp` | — | L |
| §8 Users, roles, hierarchy, territories | — | Partial | Importer (if create permission) | — | L |

### 2. KPI / report data integrity

**Liveness: confirmed.** All dashboard and report figures come from `loadDataset()` → `queryRecords()` over the live store, scoped by role and cached for one call only (`services/reports/dataset.ts:11-23`). `mocks/reports.ts` is an empty seed, and I found no hard-coded figures in `services/reports/overview.ts`, `dashboard.ts` or `modules/dashboard/widgets.tsx`.

Probe on a fresh seed as admin, 30-day dashboard, after moving OPP-2627-00003 (₹1,50,000, Proposal) to Won:

| What changed | Before | After |
|---|---|---|
| Pipeline | ₹15,29,13,650 | ₹15,27,63,650 |
| Win rate | 50.0% | 52.9% |
| Business Scorecard win rate | moved the same way | |
| Business Scorecard pipeline | moved the same way | |
| Business Scorecard average cycle | 23 days | 39.5 days |

A won deal does **not** change revenue until a sales order is booked, which is correct. After inserting a confirmed order for the same owner:

| What changed | Before | After |
|---|---|---|
| Dashboard revenue | ₹3.79 Cr | ₹4.34 Cr |
| Backlog | moved as expected | |
| Target achievement | ₹11.9 L | ₹58.4 L |

Appendix C coverage (Business Scorecard `/reports/business-scorecard`, `services/reports/defs/overview.ts:39-117`; formulas in `services/reports/kpis.ts`):

| KPI | Computable / shown | Note |
|---|---|---|
| Lead response time | Yes | `kpis.ts:35` |
| Lead conversion % by month / user / source / category | Yes | Group-by options `defs/leads.ts:36-40` |
| Win rate | Yes | `kpis.ts:41` |
| Pipeline / weighted | Yes | `kpis.ts:51` |
| Average sales cycle | **Partial** | Measured to `opp.wonAt` (`kpis.ts:57-65`); the BRD says "lead creation to **order**". Use the first sales-order date. |
| Quote-to-order % | Yes | `kpis.ts:69` |
| Activity scorecard | **Wrong (double count) + inconsistent** | Every completed field visit also writes a `visit` activity (`field.ts:316-336`, seed `mocks/field.ts:165`). Probe: 217 of 217 completed visits have a matching activity. `kpis.ts:231` and `:234` both count them, so report visits ≈ 2× actual. The window is fixed at the last 7 days and ignores the report date and division filters (`defs/overview.ts:67`). It disagrees with `/activity-scorecard` (`field.ts:608`), and the scorecard row links to that page. |
| Order backlog | Yes | grandTotal basis |
| Collections & overdues | Yes | ageing `kpis.ts:97-111` |
| SLA compliance % | Yes (minor) | Denominator is resolved tickets, not "total tickets". Arrival is covered only through the `slaBreached` flag. |
| MTTR | Yes | Excludes pause time |
| First-time fix | Yes | Denominator is resolved site-visit tickets |
| Repeat complaint % | Yes | `repeatOfId` set on ticket create (`services/service/tickets.ts:88`) |
| PM compliance | Yes | |
| AMC renewal % | Yes | |
| CSAT avg + % ≥ 4 | Partial | The scorecard shows only the average; % ≥ 4 is in `/reports/service-quality` |
| Consumables attach rate | Yes | 365-day lookback |
| CRM adoption | Yes (separate report) | Its Business Scorecard row has an **empty value** (`defs/overview.ts:101`). Show the active-user count there. |

There are three different "order value" bases for the same person and month:

| Where | Basis |
|---|---|
| Dashboard revenue | `grandTotal`, incl. GST (`overview.ts:319`) |
| Business Scorecard booked | `grandTotal` |
| Target achievement / leaderboard / Deal of the Month | Line net, pre-GST (`rules.ts:178`). Probe: the same order is ₹46,48,750 net vs ₹54,85,525 grand |

A demo audience will see different numbers for "my sales". Pick one basis (net of GST is the usual one for targets), or label each tile "incl. GST" / "excl. GST".

Existing tests check the KPI formulas (`test/reports.kpis.test.ts`, `test/reports.handcheck.test.ts:115`), but **none check the activity-scorecard row and none check that a mutation changes the dashboard**. Both probes above are worth adding as tests.

### 3. Build & lint results

| Command | Result | Details |
|---|---|---|
| `npm run build` (`tsc -b && vite build`) | **PASS** (exit 0) | 0 TS errors. 2,560 modules, built in 2.9 s. One warning: `dist/assets/index-*.js` is 3,062.63 kB (865 kB gzip), over the 500 kB limit; no code splitting. |
| `npm run lint` (`eslint .`) | **PASS** (exit 0) | **0 errors, 3 warnings** (listed below) |

Lint warnings:
- `components/resource/NotionFilters.tsx:443`: a `useLayoutEffect` without a dependency list calls `setFit`, which can loop.
- `modules/orders/OrderProcessingPage.tsx:70` and `modules/orders/PaymentSchedulePage.tsx:88`: unused eslint-disable directives.

Logs are in `scratchpad/audit/build.log` and `lint.log`.

### 4. UX confusion points

1. **"Activity Scorecard" shows two different sets of numbers.** The Business Scorecard row (last 7 days, double-counted visits) links to `/activity-scorecard` (calendar week, different rules), and the totals don't match.
2. **Every user sees a "Mock GPS app" location source** next to "Device GPS" and "Simulated" on `/attendance` and visit logging (`common.tsx:61-63`). Real users would never pick it, and a demo viewer may think it is a feature.
3. **The selfie toggle captures nothing.** It reads as broken in a live demo.
4. **The Target tile on the dashboard can show someone else's target** for managers or admins (`rows[0]` fallback).
5. **Sales value differs between Dashboard, Business Scorecard and Target vs Actual / Leaderboard** for the same month (GST vs net).
6. **Target vs Actual "drill-down" is a name list**, not a drill-down, and it is blank for individual targets.
7. **The exception history report and the live Exception Dashboard disagree.** The report has no "no visits" and no "no check-in".
8. **Offline mode loses queued writes on reload** without warning.
9. **The Route map is an abstract polyline** with straight-line km and no basemap. It needs a "schematic" caption so viewers don't expect Google Maps.
10. **The Business Scorecard "CRM adoption" row has a blank value.**
11. The bill "upload" is a text box for a file name, while other modules use real file inputs.

### 5. Top 10 fixes ranked

1. **(H) Unify the activity scorecard.** Keep one implementation, either `kpis.activityScorecard` or `field.scorecard`. Stop double-counting visits: count `fieldVisits` only, or only activities with no `fieldVisits` parent. Respect the report's date and division filters. Use the same rules for quotations (sent) and referrals in both. Add a test asserting page total = report total.
2. **(M) Use one order-value basis** for dashboard revenue, Business Scorecard, targets and leaderboard (`overview.ts:319`, `defs/overview.ts:78`, `rules.ts:178`), or label each tile with its basis.
3. **(M) Dashboard target tile:** remove the `rows[0]` fallback (`overview.ts:362`). Show the actor's own target, then their team or division target, else hide the tile.
4. **(M) Remove the audit-log cap of 2,000** (`services/ledger.ts:21`), or archive old entries. Then correct NFR-13 in REQUIREMENTS.md.
5. **(M) Exceptions report:** derive the rows from `attendanceExceptions()` for each day so "no check-in" and "no visits" appear in the history (`defs/field.ts:93-104`).
6. **(M) Persist the offline queue** and hook the `online`/`offline` events (`services/offline.ts`). At minimum, warn before unload when writes are pending.
7. **(M) Code-split routes** (`React.lazy` per module, plus manualChunks for recharts/xlsx) to back the "< 3 s on 4G" claim.
8. **(M) Field-visit completeness:** geo-tag the check-out, enforce the next-action-date rule in quick log, and add a configurable tracking interval with synthetic pings for ATT-07.
9. **(M) Real selfie and bill capture** with the existing file input primitive, plus expense policy limits in Policies (`rules.ts:99`). Move "Mock GPS app" behind Demo Settings.
10. **(M) Target vs Actual drill-down:** link members and targets to the filtered sales orders or payments behind the actual, including user-scope targets. Also measure average sales cycle to the order date, and fill the empty CRM-adoption scorecard value.

Smaller items: add TradeIndia as a lead channel, simulate ERP order push and receipts, move location consent into the db with a withdraw action, and add WebKit/Edge Playwright projects.


---

## Part F-lifecycle-stress

## F: Lifecycle stress test (first contact to deal closed)

**How it was run:** real Chromium through Playwright, using the Vite dev server on :5199 and a persistent browser profile, so `tc.crm.db.v1` carried over between steps. I switched roles by rewriting the simulated session, as `e2e/helpers.ts` does. Scripts are in `scratchpad/audit/e2e/` (`lib.mjs` is the driver, and each step has its own `*.mjs`). Screenshots are in `scratchpad/audit/shots/`. No file under `src/` or `docs/` was touched.
**Roles:** Sales Exec u_karan (Karan Singh), Sales Manager u_rohan (Rohan Desai), Division Head u_suresh (Suresh), Admin u_rahul.
**Main records created:** contact CT-1144 Ishaan Khurana → lead LD-2627-00151 → company C-1058 Khurana Fab Prints Pvt Ltd → opportunity OPP-2627-00119 → 5 quotations → SO/TX/26-27/0007 (SO-2627-00073).

| Quotation | id | Discount | Total | Path |
|---|---|---|---|---|
| QT/TX/26-27/0018 | QT-2627-00077 | 0% | ₹1,17,41,000 | Stray draft that got saved during an abuse test (see Q0). Kept as an "other" quote. |
| QT/TX/26-27/0019 ("Q1") | QT-2627-00078 | 4% | ₹57,53,680 | Auto-approved, then sent |
| QT/TX/26-27/0020 ("Q2") | QT-2627-00079 | 8% | ₹55,18,860 | Approved by the Manager, sent, **ACCEPTED** (the selected one) |
| QT/TX/26-27/0021 ("Q3", R0) | QT-2627-00080 | 12% | ₹52,89,940 | Approved by Manager, then Division Head; superseded |
| QT/TX/26-27/0021-R1 | QT-2627-00081 | 10% | ₹54,07,350 | Revision of Q3. It was pending when Q2 was accepted. |

---

### Step log

| # | Step | Role | Expected (BRD/user) | Actual | Pass/Fail | Screenshot |
|---|---|---|---|---|---|---|
| C1 | In Admin > Masters, add Lead Source "Partner Webinar QA" and Lost reason "Board froze capex QA", then Validate and Publish | Admin | §4.14 configurable masters; publishing is a significant change, so it should be confirmed | Draft/validate/publish works and shows the toast "Configuration published". **Validate gives no feedback at all. Publish has no confirmation dialog.** The master-list picker has duplicate entries: "Quotation Status"/"Quotation status", "Template Status" ×2, "Sign-off Method" ×2. | Pass (with friction) | C-01, C-02, C-03 |
| L1 | Quick-add a contact in the Contact Pool. Try an empty form, mobile `51234` and `5123456789`, email `ishaan@@khurana`, then double-click Create. | Exec | CUS-03 formats; one record only | Every invalid input is rejected inline and in a summary. A double-click creates exactly 1 contact (CT-1144). | Pass | L-01, L-02 |
| L2 | Add a duplicate contact with the same mobile | Exec | CUS-06 duplicate detection | Blocked inline: "This mobile already belongs to contact CT-1144". | Pass | L-03 |
| L3 | Contact → Convert to Lead (empty submit, then fill, then double-click) | Exec | §3.1 lead created with contact + company; LEAD-02 source on every lead | 1 lead LD-2627-00151 and new company C-1058 are created. **The dialog has no Lead source field, and the lead silently got `cold_call`.** City is blank. An empty submit shows no visible error. You stay on the pool, and the toast has an "Open" link. | Partial | L-04, L-05 |
| L4 | Edit the lead: does the new source exist? Budget −500 and 99,999,999,999,999 | Exec | Configuration effect; ranges | **"Partner Webinar QA" appears in Lead source (config works).** Budget −500 gives "at least ₹0"; the huge budget gives "at most ₹10,00,00,00,000". Saving takes you to the `/leads?peek=` list, not back to the record. | Pass | C-04, L-07 |
| L5 | Log Follow-up (empty, then double-click save) | Exec | LEAD-09 next follow-up mandatory; status New → Contacted | "Subject is required" is shown. A double-click creates 1 activity. The status changes to **Contacted** automatically. | Pass | L-08 |
| L6 | Lead → Create Opportunity (BANT): empty, budget −100, value 999,999,999,999,999, then valid with a double-click | Exec | LEAD-10: the opportunity carries all data and history | Validation runs (async, so errors appear after a delay). Picking the timeline moves the close date to 04-01-2027, visibly. A double-click creates exactly 1 opportunity, OPP-2627-00119. The lead becomes **Qualified**, read-only, with a banner linking to the OPP. The lead's call shows in the opportunity's Activity History. | Pass | L-09, L-10, L-11 |
| O1 | Pipeline board: drag Needs Assessment → Demo/Sample | Exec | OPP-03 drag and drop | Stage moves, toast shown, probability goes 10 → 25. | Pass | O-02, O-03 |
| O2 | Drag Demo/Sample → Won | Exec | Blocked, with a reason | **Nothing happens: no toast and no reason.** The card snaps back. | Fail (UX) | O-03 |
| O3 | Record "Move to Proposal/Quotation" | Exec | | Works, probability 50. "Move to Negotiation" is disabled until a quote exists, and says why. | Pass | |
| Q0 | Quote editor abuse: qty `-2` with Save Draft | Exec | Rejected | **The minus sign is silently stripped, and a draft (qty 2, ₹1.17 Cr) is saved.** | Fail | Q-Q1-abuse |
| Q1 | Editor abuse: qty 0, `1e6`, 100000; discount −5, 101, 150 | Exec | QUO-04/06 ranges | Qty 0 is rejected. **`1e6` becomes 16. Qty 100000 is accepted with no upper bound or warning. Discount −5 silently becomes 5%.** 101 and 150 are rejected ("between 0 and 100%"). List price is not editable by Sales (QUO-05 ✓). | Partial | Q-Q1-abuse |
| Q2 | Create Q1 at 4% with Save & Submit (double-click) | Exec | ≤5% needs no approval | 1 quote is created and auto-approved: "approved — ready to send". | Pass | Q-Q1-filled, Q-Q1-after-save |
| Q3 | Create Q2 at 8% and Q3 at 12% | Exec | QUO-06 band (8% → L1; 12% → L1 and L2) | APR-1022 at L1; APR-1023 at L1 then L2. **There is no warning that the opportunity already has open quotes.** Each quote is an independent series with `isLatest=true`. | Pass (with friction) | Q-Q2-*, Q-Q3-* |
| A1 | Sales Exec tries to approve | Exec | Cannot approve | Awaiting My Approval shows 0. The rows appear under All Pending with no Approve button, and the record has no Approve. **"Edit" stays enabled on a pending quote** and leads to a dead-end page that says "create a version" (the correct action is "Pull Back to Draft"). | Pass / UX fail | A-01, A-02, P-01 |
| A2 | Division Head tries Q3 before the Manager | DH | Sequential levels | No Approve button; Awaiting shows 0. | Pass | A-03 |
| A3 | Manager double-clicks Approve on Q2 and approves Q3 at L1; DH approves Q3 at L2 | Mgr, DH | QUO-06 with comments | Q2 is approved with exactly 1 decision. Q3 is "sent to next level", and the DH's approval makes it Approved. The approval record keeps by/at/note for each level. | Pass | A-04 |
| R1 | Q3 (approved, **not accepted**): "Generate Sales Order" | Exec | SO-01: only after Won/accepted | **The button is enabled and opens a fully pre-filled SO form** (no submit was attempted from this state). | Fail | R-02 |
| R2 | Q3 → Create Version (empty note, then double-click) | Exec | QUO-09 R0/R1; only the latest is active | 1 version is created: QT/TX/26-27/0021-R1 as a draft. R0 becomes **Superseded** and read-only, with an "Open Latest Version" button. Send, version and SO are disabled on R0. | Pass | R-03, R-05 |
| R3 | Change R1 to 10% and submit | Exec | L1 approval | APR-1024 is pending with the Manager. | Pass | R-04 |
| S1 | Send Q1 and Q2 | Exec | QUO-08 sent date logged | Sent, logged as "Shared offline" because the contact has no consent. The toast wording is "sent by Shared offline". | Pass | S-Q1/Q2 |
| AC1 | Q2 Mark Accepted (empty submit, then PO plus file, double-click) | Exec | QUO-11; §3.1: Won enables SO | PO number and PO copy are required. Accepted once. **The opportunity becomes Won automatically, probability 100, and value goes from ₹35,00,000 to ₹55,18,860 (= Q2 total).** | Pass | AC-Q2-dialog, AC-Q2-after |
| X1 | **Other quote Q1 (sent): Mark Accepted** | Exec | User expectation: blocked or deactivated | The button is **enabled**. On submit, a toast error says another quote is already accepted, "only one quotation per opportunity" (blocked server-side). | Partial | X-01, X-02 |
| X2 | Q1: Mark Under Negotiation | Exec | Blocked | **Allowed.** Q1 is now "Under Negotiation" on a Won opportunity. | Fail | |
| X3 | Q1: Generate Sales Order | Exec | Not offered | **The button is shown.** The SO page then says "This quotation cannot become a sales order yet. QT/…/0020 is already accepted". | Partial | X-03 |
| X4 | **Revision R1 (pending): Manager approves after the opportunity is Won** | Mgr | Withdrawn or blocked | Still in "Awaiting My Approval". The dialog does not mention that the opportunity is Won. **The approval succeeds** and R1 becomes Approved. | Fail | X-05 |
| X5 | R1: Send | Exec | Blocked | **Allowed.** R1 becomes Sent. | Fail | X-06 |
| X6 | R1: Mark Accepted | Exec | Blocked | Blocked by a toast (BR-20). | Pass (late) | |
| X7 | Draft 0018: Submit for Approval | Exec | Blocked | **Allowed.** It is auto-approved on the Won opportunity. | Fail | |
| X8 | New Quotation on the Won opportunity | Exec | Blocked, with a reason | The opportunity's Quotations tab shows "New Quotation" disabled ("The opportunity is closed") ✓. The direct URL shows the error page "Could not open the quotation editor … not open or not visible to you" with a **useless Retry** button. | Pass / UX | X-07, X-08 |
| SO1 | Q2 → Generate Sales Order: change the discount to 20%, qty −3, reset, then double-click Generate | Exec | SO-01/02/03 | Fully pre-filled, including the PO number and PO file carried over from acceptance. A 20% discount shows "Differs from the accepted quotation; needs re-approval · −12.76% (tolerance ±2%)" and a "Changed" tag ✓. Qty −3 shows no inline error. A double-click creates exactly 1 SO, SO/TX/26-27/0007, Pending Approval. | Pass | SO-01, SO-02, SO-03 |
| SO2 | SO approval | Exec, then Mgr | SO-04 | The Exec has no Approve. The Manager approves (the dialog title shows "Approve APR-1025?" instead of the SO number). Status goes to **Payment Pending** and the order is pushed to ERP (simulated). | Pass | SO-04 |
| W1 | Close the opportunity as Won | Exec | OPP-05 | It was already Won automatically at acceptance (Negotiation was skipped). There is no separate "close Won" step. | Pass | H-opp2-* |
| LP1 | Lead Disqualify | Exec | LEAD-11 mandatory reason from the master | Reason is required. **The new reason "Board froze capex QA" is listed (config works).** Reactivate is disabled for the Exec. **Edit stays enabled on the disqualified lead**, while a qualified lead is locked. | Pass / inconsistency | C-05, LP-01 |
| LP2 | Lead Nurture | Exec | LEAD-11 re-contact date | Default 19-01-2027. Status is Nurture and Reactivate is available. | Pass | |
| LP3 | Opportunity Mark Lost (OPP-2627-00047) | Exec | OPP-05 reason and competitor | Both are required. The new lost reason is listed (config works). **"Lost at price" −50000 silently becomes 50000.** A stale "Choose a lost reason" error stays visible after a reason is picked. | Pass (with defects) | C-06, LP-03 |
| LP4 | Re-open the lost opportunity | Exec, Mgr, Admin | Controlled | Exec: disabled. **Manager: disabled ("Not available to Sales Manager").** Admin: allowed, and the opportunity returns to Needs Assessment. | Pass (policy question) | LP-04 |
| RW1 | **Admin re-opens the WON opportunity** (it has an accepted quote and an approved SO) | Admin | Blocked, or a warning plus SO handling | **Allowed. The dialog does not mention the SO.** The opportunity goes back to Needs Assessment and its ₹55.2 L shows as open pipeline again, while the SO stays live. The quote editor opens again for it. | **Fail (critical)** | RW-01, RW-02, RW-03 |
| RW2 | Exec marks that re-opened opportunity Lost | Exec | Blocked while an SO exists | **Allowed.** The result is an opportunity that is Lost, with Q2 Accepted and the SO in Payment Pending at ₹55.2 L. On the dashboard, Win Rate shows "0 won · 3 lost" while Order Value still counts ₹55.2 L. | **Fail (critical)** | RW-04, RW-05 |
| M1 | Duplicate lead via /leads/new (same customer, contact and division) | Exec | LEAD-03/CUS-06 duplicate check | The first one is created with no warning, because only a *qualified* lead existed. Later attempts show an inline "An open lead already exists … You can still create this lead" and create anyway (LD-00155 and LD-00156). Soft only, with no confirm step. | Partial | M-01 |
| M2 | Company GSTIN: 14 characters, garbage, wrong check digit, other-state GSTIN | Exec | CUS-01 format | All are rejected with specific messages (the duplicate-GSTIN check was masked by the state mismatch). | Pass | M-02, M-03 |
| M3 | Opportunity edit value: −500000, 999,999,999,999,999, 0 | Exec | Ranges | Negative and huge values are rejected. **0 is saved**, although the convert dialog rejects ≤ 0. | Partial | M-04 |
| BN1 | Save a draft quote, then browser Back | Exec | No accidental duplicate | Back returns to a **blank New Quotation editor** for the same opportunity, and saving again creates a 2nd draft (QT/0022 and QT/0023). The unsaved-changes guard on Back works. | Partial | BN-01, BN-02 |
| P1 | Exec and Manager open /admin/masters; Exec exports a report | Exec, Mgr | Appendix B | "No access to Masters". Export is disabled for both, with a reason. | Pass | |
| DB | Double-click on every primary submit (contact, lead, follow-up, opportunity, quote, approve, version, send, accept, SO) | All | One record each | Exactly one record every time. | Pass | |

---

### Quotation selection behaviour

**What the app does:** only one quotation per opportunity can be **Accepted**. This is enforced server-side (BR-20) in `acceptQuote`. Nothing else is deactivated. After Q2 was accepted and the opportunity went Won:

| Other quote (state at acceptance time) | Approve | Send | Mark Under Negotiation | Mark Accepted | Generate SO |
|---|---|---|---|---|---|
| Q1 0019 (Sent) | n/a | (already sent) | **Allowed** (now "Under Negotiation") | Button enabled → error toast | Button shown → SO page error |
| R1 0021-R1 (Pending Approval) | **Manager approved it** (still in his queue) | **Allowed** (now "Sent") | (allowed) | Button enabled → error toast | Button shown |
| 0018 (Draft) | **Submit allowed → auto-approved** | (allowed) | — | — | — |
| R0 0021 (Superseded) | — | Disabled | — | — | Hidden ✓ |
| New quotation on the Won opportunity | — | — | — | — | Blocked ✓ (tab button disabled; the URL shows an error page) |

- The only properly deactivated record is the **superseded revision** (R0). It gets a read-only banner and an "Open Latest Version" button. Sibling quotes on a Won opportunity stay fully "live". Nothing marks them Rejected, Lost, Closed or "Not selected", and no approval is withdrawn.
- **Generate Sales Order is also offered on an approved-but-not-accepted quote** (Q3 before any acceptance) and opens a pre-filled SO form. SO-01 says it should only appear after Won/accepted.
- On the opportunity's Quotations tab, the accepted quote is shown only by an "Accepted" chip among 4 rows (Sent, Under Negotiation, Approved). Nothing like "Selected for order" or greyed-out siblings shows which quote won the deal.
- **Effect on figures:** Karan's dashboard "Quotations by Status" counts the 3 dead siblings as live (Sent 3, Under Negotiation 1, Approved 1). Quote-to-Order shows 20% over 7 quotations, so one won deal with 5 quotes drags conversion down. Quotation value data holds 5 quotes worth ₹3.37 Cr for a ₹55 L deal.
- **Expected per BRD/user:** when a quote is accepted, auto-close sibling quotes (for example "Rejected — another quotation accepted" or a "Closed/Not selected" status), withdraw their pending approvals (as `reviseQuote` already does for superseded versions), and hide or disable Approve, Send, Negotiation, Accept and Generate SO on them, with a banner on each sibling saying "Opportunity won with QT/…/0020".

### History & linking per record

| Record | Full history (status, edits, approvals, who/when)? | Linked records shown and clickable? | Gaps |
|---|---|---|---|
| Lead LD-2627-00151 | Yes. Activity History has field-level diffs: creation, the source/budget/city edit, "First contact logged: New → Contacted", and conversion. Who and when are shown. | Customer, contact and owner open in a drawer. After conversion a banner links to OPP-2627-00119. | Creation is labelled "workflow … Created lead automatically" although a user did it by hand. The Related tab activity item is labelled "New". |
| Opportunity OPP-2627-00119 | Change History: creation, Demo, Proposal, then "Won: quotation QT/…/0020 accepted" with value, stage, probability and won-on diffs ✓. Activity History has the lead's call carried over ✓. | Customer, contact, owner, "From lead" (drawer), Quotations tab (4 quotes, clickable). | **No link to the Sales Order** anywhere (not in Details, Related or a tab). Quote sent/accepted activities are not rolled up into the opportunity's Activity History. "From lead" is labelled with the company name, not LD-…. The superseded R0 is not in the Quotations tab. |
| Quotation QT/…/0020 | Excellent: created, submitted, approval requested, Manager approved with note, sent, accepted with PO (with diffs). Separate Approval tab with the level chain and Versions tab ✓. | Lead, opportunity, customer, contact, T&C template; Documents (PDF, PO copy). | **The Related tab does not list the generated SO**, and history has no "SO generated" entry. Only an "Open Sales Order" action button exists. "Created quotation QT-2627-00079" uses the internal id. "Version" means 3 different things (Versions tab "v1", Details VERSION 0, System VERSION 5), while the BRD uses R0/R1. "Accepted by: Customer PO Upload" is the method, not a person. |
| Sales Order SO/TX/26-27/0007 | Activity History: created from the quotation (with PO), approval requested, approved by Rohan, then Payment Pending and pushed to ERP ✓. Approval tab ✓. Changes vs Quotation: "Same as quotation" ✓. | Quotation, opportunity, customer, product, site, 3 payment milestones (clickable). | No link to the lead. **Date inconsistency:** the Approval tab says "Requested 20-10-2026" and the ERP tab says "Pushed to ERP 20-10-2026", while Details says 21-10-2026 (the test ran at about 01:57 IST). |
| Customer 360 C-1058 | Activity History shows 5 entries. | Leads 1, Opportunities 1 (Won ₹55.19 L), Quotations 5 (including superseded), SO 1. Category auto-moved to Active Customer ✓. | Workflow-logged activities are dated **20-10-2026** and sorted *below* an 01:49 IST call that happened earlier. The opportunity row "Date" column shows the expected close date, not the won date. |

Audit entries per record: LD 5, OPP 4, quotes 0018 → 2, 0019 → 4, 0020 → 7, 0021 → 7, R1 → 8, SO 5.

### Data consistency results

Checked by reading `localStorage['tc.crm.db.v1']` and comparing with the UI.

| Check | Result |
|---|---|
| Opportunity value vs selected quote total | ✅ 5,518,860 = 5,518,860 (updated at acceptance from the 35 L estimate) |
| Lead status = converted, with link | ✅ `status: qualified` and `opportunityId: OPP-2627-00119`; UI banner and link |
| Quotation statuses | ⚠️ 0020 accepted ✓, 0021 superseded ✓, **but R1 "sent", 0019 "negotiation" and 0018 "approved" are all still open on a Won deal** |
| SO totals vs quote | ✅ grandTotal, subtotal 50,50,000, taxable 46,77,000 and IGST 8,41,860 all match; `quotationId` and `opportunityId` are set |
| Payment milestones | ✅ 30/60/10% = 16,55,658 + 33,11,316 + 5,51,886 = 55,18,860 |
| Pipeline board totals | ✅ Open pipeline (16 opportunities, ₹2.26 Cr) correctly excludes the Won deal. ❌ **The Won and Lost columns always show "0 items"** because of a hidden default filter, "Stage: Open stages", visible only inside the Filters panel. Searching the won OPP on the board returns "0 opportunities". The won deal is visible only in the /opportunities list. |
| Dashboard: did the won deal show up? | ✅ Karan: Win Rate "1 won", Top Customers Khurana ₹55.2 L, Order Value includes it. ❌ Rohan: Win Rate "5 won", but the Opportunity Funnel on the same page shows "Won 4". Suresh: 6 vs 4. The funnel percentages are odd (Proposal 100%, Negotiation 100%, Won 100%). |
| Reports | ❌ KPI scorecard says "**129% of leads reach orders booked**" (over 100%). The Quotation Value report (19 quotes, ₹15.4 Cr) includes multiple quotes per deal, so it is inflated by siblings. |
| Activity timestamps | ❌ Workflow activities are stored in UTC (`at: '2026-10-20T20:26'`), while user-logged ones are local (`'2026-10-21T01:49'`). The cause is `logActivityIn` in `src/services/quotations/workflow.ts`, which uses `nowIso().slice(0,16)`. This gives wrong dates near midnight IST and wrong sort order. |
| After admin re-open, then Lost (RW1/RW2) | ❌ The opportunity is **Lost** while the quote is **Accepted** and the SO is **Payment Pending ₹55.2 L**. Win rate drops to 0 won while order value keeps ₹55.2 L. While re-opened, the same ₹55.2 L also counted as open pipeline. |

### Console errors

**None.** No `console.error` or `pageerror` was captured on any page in any role during the whole run (more than 40 browser sessions, about 125 screenshots).

### UX friction (things a first-time user would trip on)

1. Sibling quotes on a won deal look fully actionable (Mark Accepted, Generate Sales Order and Send are all enabled) and only fail with a toast after you submit.
2. The pipeline board shows **Won/Lost columns that are always empty**, the open-only filter is hidden, and dragging to Won fails silently. A user who just won a deal cannot find it on the pipeline.
3. The Convert-to-Lead dialog never asks for the **Lead source** and silently stores "Cold Call".
4. Numeric inputs **silently drop the minus sign** (qty −2 → 2, discount −5% → 5%, lost price −50000 → 50000), and "1e6" becomes 16. The user believes they entered something else.
5. After saving a lead, quote or SO you land on a *list with a peek drawer*, not the record. Browser Back after saving a quote reopens a blank "New Quotation" editor, and a second save creates a duplicate draft.
6. "Edit" is enabled on a pending-approval quote and leads to a dead-end page that tells you to "create a version". The correct action is Pull Back to Draft.
7. "Generate Sales Order" appears on approved-but-not-accepted quotes.
8. Multiple quotes per opportunity are created with no hint ("this opportunity already has 3 open quotations"). The only "variant" mechanism is a revision, which supersedes the original, so there is no real way to send parallel options.
9. IDs are confusing: the quote header shows both QT/TX/26-27/0021 and QT-2627-00080. "Version" means three things. Approval dialogs are titled by approval id ("Approve APR-1025?"), not by the document.
10. Toast "sent by Shared offline (in person / courier)". Stale validation errors stay visible after a field is fixed (Lost reason). Every dialog's subtitle is read twice in the a11y tree (it is duplicated). The duplicate-lead warning is easy to miss inline text with no confirmation.
11. The Masters "Validate" button gives no feedback, "Publish" has no confirmation, and the master list contains duplicate names.
12. The Sales Manager cannot re-open their team's lost or won deals (only Admin can), and the Lost dialog says "An administrator can reopen it", but there is no guidance on who to ask.
13. A disqualified lead stays editable, while a qualified lead is locked.
14. The opportunity edit form allows ₹0 value; the convert dialog does not.

### Top 10 fixes ranked

1. **Block re-opening and marking Lost on an opportunity that has an accepted quote or a live SO** (or force SO cancellation first). Today you can end up with an opportunity that is Lost, a quote that is Accepted and an SO that is Payment Pending, and the dashboards contradict each other (RW1/RW2).
2. **When a quote is accepted, auto-close every sibling quotation on the opportunity** (status "Rejected — other quotation accepted" or "Closed"), withdraw their pending approvals, and remove them from approvers' queues (X1–X7).
3. **Hide or disable Approve, Send, Negotiation, Accept and Generate SO on non-selected quotes and on any quote that is not Accepted.** Show a banner: "Opportunity won with QT/…/0020" (R1, X1, X3).
4. **Fix the pipeline board:** show Won/Lost cards (or remove the empty columns), surface the "Open stages" filter as a visible chip, and explain blocked drops ("Mark Won needs an accepted quotation") (O2, D3).
5. **Fix the UTC timestamp in workflow activities** (`logActivityIn` uses `nowIso().slice(0,16)`) and the UTC date formatting in the SO Approval and ERP tabs. Dates and ordering are wrong around midnight IST.
6. **Numeric inputs must reject, not silently sanitise,** negative values and exponent notation (qty, discount, lost price), and add a sensible upper bound or confirm step for very large quantities (Q0, Q1, LP3).
7. **Link the Sales Order back** from the Quotation (Related tab plus a history entry "SO/… generated") and from the Opportunity (Related or Details, plus the accepted-quote link). Also roll quote activities up into the opportunity's Activity History.
8. **Make dashboards and reports count one quote per deal** (latest, non-superseded, non-sibling). Fix the funnel vs win-rate mismatch (5 vs 4) and the ">100% of leads reach orders" scorecard figure.
9. **Ask for the Lead source in Convert to Lead** (LEAD-02), and make the duplicate-lead warning a confirm step rather than inline text.
10. **Post-save navigation and stale editors:** after saving, go to the record (or replace the `/new` history entry), so Back doesn't reopen a blank creator. Disable Edit on pending quotes, or route it to "Pull Back to Draft". Add confirmation for Masters Publish.
