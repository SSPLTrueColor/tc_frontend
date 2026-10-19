# True Color CRM — Requirements & Traceability (Frontend Prototype)

Source: `docs/BRD.md` (RFQ dated 08-10-2026). This file is the single traceability list for the prototype.
Every BRD requirement appears here exactly once with a prototype ID, the screen that covers it, and its status.

**Conventions**

- `FR-xxx` = functional requirement, `NFR-xx` = non-functional, `BR-xx` = business rule, `Q-xx` = open question.
  FR IDs use three digits because the BRD has more than 99 functional items. The BRD's own ID is kept in the `BRD` column.
- **Approach** (how the frontend covers it):
  - **Built**: works fully in the browser (UI + logic in the service layer).
  - **Simulated**: the user-visible behaviour works, but the external part (ERP, WhatsApp, GPS, OCR, PDF engine, push, e-sign) is faked by a mock service and is clearly labelled in the UI.
  - **N/A**: not applicable to a frontend-only prototype (reason given).
  - **Deferred**: frontend-applicable but intentionally left out of the first prototype pass (reason given).
- **Status**: `Not started` → `In progress` → `Done`. Updated after each module.
- Priority is the BRD's: **M** = Must, **S** = Should, **C** = Could.
- Routes are listed in §3. "Assumption" marks a value the BRD does not give; each one is also in §7.

---

## 1. Requirements

### 1.1 Functional requirements

#### Customer & Contact Master (BRD 4.1)

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-001 | CUS-01 | M | Company record: name, legal name, GSTIN (validated), PAN, industry/segment, category, website, divisions, territory/hub, owner | `/customers/new`, `/customers/:id/edit` | Built | Done (GSTIN format+checksum+state+PAN in hook) |
| FR-002 | CUS-02 | M | Multiple addresses (billing / shipping / installation site), each geo-tagged | Customer 360 → Addresses tab | Simulated (lat/long entered or mock "Use my location"; no map tiles) | Done — geo Simulated (`/addresses`, 360 Contacts & sites) |
| FR-003 | CUS-03 | M | Multiple contacts: name, designation, department, mobile, WhatsApp, email, buying role, communication consent | Customer 360 → Contacts tab | Built | Done (consent; mobile or email required) |
| FR-004 | CUS-04 | M | Configurable classification (Prospect, Active, Existing/Inactive, Dealer, Distributor) + segment tags | Customer form; `/admin/masters/customer-categories` | Built | Done |
| FR-005 | CUS-05 | M | Contact pool (phone book, Excel/CSV, visiting-card OCR, manual) + "Convert to Lead" | `/contacts`, `/contacts/:id` | Simulated (CSV import real; phone book and OCR use sample data) | Done — phone book & OCR Simulated (`/contacts?view=v_ct_pool`, `/contacts/import`, Convert to lead) |
| FR-006 | CUS-06 | M | Duplicate detection (GSTIN, mobile, email, fuzzy name) on create/import; admin merge with audit | Customer form warning; `/admin/duplicates` | Built | Done (blocking exact match, fuzzy ≥0.85 warning, `/admin/duplicates` merge) |
| FR-007 | CUS-07 | M | Customer 360: leads, opps, quotes, orders, ERP payment status, machines, warranty/AMC, tickets, feedback, unified timeline | `/customers/:id` | Built (ERP figures from mock ERP service) | Done (360 tabs: Contacts & sites, Timeline, Sales, Machines & service, Account) |
| FR-008 | CUS-08 | S | Parent–child group linkage; dealer → end-customer linkage | Customer form + 360 "Related" panel | Built | Done (cycle-safe) |
| FR-009 | CUS-09 | S | Credit limit, outstanding, overdue read-only from ERP | Customer 360 header | Simulated (mock ERP) | Simulated (Refresh from ERP) |
| FR-010 | CUS-10 | M | Bulk ownership transfer (accounts, open leads, opps, tasks) with history | `/admin/transfer` | Built | Done (`/admin/transfer`, preview + reason + audit) |
| FR-011 | CUS-11 | S | Key Account flag + one-page account plan | Customer 360 → Account plan tab | Built | Done (Account tab) |
| FR-012 | CUS-12 | M | Reports: customer-wise sales, machine history, warranty expiry, AMC renewals due, dormant customers | `/reports/:reportId` | Built | Done (`/reports`: customer-sales, machine-history, warranty-expiry, amc-renewals-due, dormant-customers) |

#### Lead Management (BRD 4.2)

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-013 | LEAD-01 | M | Lead from existing or new contact; inline company/contact create; auto Lead ID; core fields | `/leads/new` | Built | Done (`/leads/new`, inline company/contact) |
| FR-014 | LEAD-02 | M | Configurable lead sources (incl. event name, referrer type); source/campaign/referrer on every lead | Lead form; `/admin/masters/lead-sources` | Built | Done (BR-06 exhibition/referral rules) |
| FR-015 | LEAD-03 | M | Auto capture via website / Meta / Google Ads webhooks with dedupe + auto-assign | `/admin/integrations` ("Simulate incoming lead") | Simulated | Simulated (`/admin/integrations` incoming web/Meta/Google lead, dedupe, auto-assign) |
| FR-016 | LEAD-04 | S | IndiaMART lead API capture | `/admin/integrations` | Simulated | Simulated (`/admin/integrations` IndiaMART) |
| FR-017 | LEAD-05 | S | Exhibition Excel import; visiting-card scan at stall | `/leads/import` | Simulated (CSV real; OCR sample cards) | Done — card scan Simulated (`/leads/import`) |
| FR-018 | LEAD-06 | M | Product requirement: type, sub-type, dynamic spec fields per sub-type (Textile fields defined) | Lead form → Requirement section | Built (non-textile spec fields are placeholders, see Q-11) | Done (textile spec fields; placeholders for other sub-types, Q-11) |
| FR-019 | LEAD-07 | M | Manual assignment (division-filtered) + rule-based auto-assign with round-robin; hierarchy visibility | Lead form/list bulk action; `/admin/assignment-rules` | Built | Done (`/assignmentRules`, round-robin, division-head fallback) |
| FR-020 | LEAD-08 | M | First-contact SLA (default 24 h); escalation to manager; "Not attended leads" list | `/leads?view=not-attended`; dashboard widget | Built (SLA evaluated against the simulated clock) | Done (Not attended view, escalation sweep on simulated clock) |
| FR-021 | LEAD-09 | M | Log call/email/WhatsApp/meeting; next follow-up date mandatory; reminders; overdue list | Lead detail → Activity; `/follow-ups` | Built (reminders = in-app + outbox log) | Done (Log activity + mandatory next follow-up, `/follow-ups`, reminders in-app + outbox) |
| FR-022 | LEAD-10 | M | BANT-lite qualification; convert to Opportunity carrying data/history | Lead detail → Qualify dialog | Built | Done (Qualify → opportunity, lead read-only) |
| FR-023 | LEAD-11 | M | Mandatory disqualify/loss reason from master; Nurture with re-contact date | Lead detail → status actions | Built | Done (disqualify reason, nurture date, manager-only reactivation) |
| FR-024 | LEAD-12 | S | Referrer recorded; referrer notified on conversion; referral report | Lead form; `/reports/referrals` | Built (notification in-app) | Done (referrer notified on conversion) |
| FR-025 | LEAD-13 | C | Rule-based lead scoring | Lead list column + `/admin/lead-scoring` | Built | Done (`/leadScoringRules`, 12 rules) |
| FR-026 | LEAD-14 | M | Reports: conversion % (month/user/product/source/campaign), ageing, first response, pending follow-ups, lost reasons, exec performance | `/reports/:reportId` | Built | Done (lead conversion, ageing, first response, pending follow-ups, lost leads, exec performance) |

#### Opportunity & Pipeline (BRD 4.3)

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-027 | OPP-01 | M | Opportunity from lead or directly for existing customer; products, value, close date, stage, probability, competitors, owner, decision makers | `/opportunities/new`, `/opportunities/:id` | Built | Done |
| FR-028 | OPP-02 | M | Configurable stages with entry/exit criteria; stage probability drives weighted forecast | `/admin/workflows/opportunity` | Built | Done (entry rules in service; criteria fixed in code, not admin-editable) |
| FR-029 | OPP-03 | M | Kanban (drag & drop) + list; filters by division, owner, stage, hub, category, close month | `/opportunities` | Built | Done (drag & drop board + filtered views) |
| FR-030 | OPP-04 | S | Demo booking (centre/site), demo-machine calendar, sample print request to Profiling, results/feedback | `/demos`, Opportunity → Demos tab | Built | Done (`/demos` calendar, double-booking blocked, `/sampleRequests` to Profiling) |
| FR-031 | OPP-05 | M | Won enables "Generate Sales Order"; Lost needs reason + competitor/price | Opportunity status actions | Built | Done (Generate sales order gated on accepted quotation; Mark lost dialog) |
| FR-032 | OPP-06 | M | Stagnation alert (no update in N days or past close date) | Opportunity list badge; notifications | Built | Done (stagnant flag, banner, daily sweep notifications) |
| FR-033 | OPP-07 | S | Monthly/quarterly forecast (weighted + commit) by user/division/category | `/opportunities/forecast` | Built | Done (`/opportunities/forecast`, computed) |
| FR-034 | OPP-08 | S | Tasks & calendar for meetings/demos/follow-ups; two-way Google/Outlook sync | `/calendar` | Built (calendar) / N/A (external sync: needs OAuth + backend) | Done — `/calendar` on FullCalendar (month/week/day/agenda, drag-create, drag/resize reschedule, recurrence with this/all, overlap warning, IST, Monday start); Google/Outlook sync N/A |

#### Quotation Management (BRD 4.4)

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-035 | QUO-01 | M | Auto number (division-wise series), date, validity, customer, contact, executive, linked opportunity | `/quotations/new` | Built | Done (QT/<DIV>/26-27/0001 series, from opportunity) |
| FR-036 | QUO-02 | M | Product selection from product & price master: model, configuration, accessories, options | Quotation editor → Lines | Built | Done (product picker, configuration lines) |
| FR-037 | QUO-03 | M | Extra line types: RIP software, ink, consumables, spares kit, installation, training, ext. warranty, AMC | Quotation editor → Lines | Built | Done (12 line types) |
| FR-038 | QUO-04 | M | Qty, list price, discount (% / amount), freight/insurance, GST (CGST+SGST vs IGST by place of supply, HSN/SAC), total, amount in words | Quotation editor → Totals | Built | Done (GST CGST+SGST/IGST, HSN/SAC, amount in words; totals recomputed server-side) |
| FR-039 | QUO-05 | M | Price lists by division/product with validity; only authorised roles edit; sales cannot edit list price | `/price-lists`, `/price-lists/:id` | Built | Done (`/priceLists` Draft→Active→Expired, items tab, overlap rejected, division-head scope) |
| FR-040 | QUO-06 | M | Discount approval matrix (thresholds by division/product, levels); approve/reject with comments; reminders | `/approvals`; `/admin/workflows/approvals` | Built (email-link approval simulated) | Done (BR-17 bands → approval levels, reminders, withdraw) |
| FR-041 | QUO-07 | M | Commercial terms from templates, editable within permissions | Quotation editor → Terms; `/admin/masters/terms-templates` | Built | Done (`/termsTemplates` per division) |
| FR-042 | QUO-08 | M | Branded PDF per division; attachments; send by email/WhatsApp with sent date logged | `/quotations/:id/print`; Send dialog | Simulated (print-to-PDF via browser; send logged to outbox) | Simulated (`/quotations/:id/print`, send via outbox with consent check) |
| FR-043 | QUO-09 | M | Versions R0, R1…; change log; side-by-side compare; only latest active | `/quotations/:id/compare` | Built | Done (revisions, `/quotations/:id/compare`) |
| FR-044 | QUO-10 | M | Statuses incl. automatic Expired on validity end | Quotation list/detail | Built (expiry checked on load against the simulated clock) | Done (auto-expiry on simulated clock) |
| FR-045 | QUO-11 | S | Customer acceptance by PO upload or electronic acceptance | Quotation → Mark accepted dialog | Simulated (file name stored, no real upload) | Simulated (PO file metadata or e-acceptance → opportunity Won) |
| FR-046 | QUO-12 | S | Landed cost / margin visible only to Management & Accounts | Quotation editor (field-level permission) | Built | Done (landed cost & margin financial-only) |
| FR-047 | QUO-13 | C | ROI / payback calculator attachable to quotation | Quotation → ROI tab | Built | Done (ROI tab) |
| FR-048 | QUO-14 | M | Reports: quotation value, pending approvals, quote-to-order, lost with reasons, discount analysis | `/reports/:reportId` | Built | Done (quotation value, pending approvals, quote-to-order, lost quotations, discount analysis) |

#### Sales Order & Sales Contract (BRD 4.5)

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-049 | SO-01 | M | "Generate Sales Order" once opp Won; prefilled from accepted quotation | Opportunity/Quotation action → `/orders/new?quotation=` | Built | Done (`/orders/new?quotation=`, Won + accepted latest quotation only) |
| FR-050 | SO-02 | M | Auto order no., customer PO no./date, PO copy upload (mandatory), linked quotation | Order form | Simulated (upload stores file metadata only) | Simulated (PO no./date/file required; file metadata only) |
| FR-051 | SO-03 | M | Editable SO; differences vs quotation highlighted; beyond tolerance re-triggers approval | Order form → "Changes vs quotation" panel | Built | Done (changes vs quotation highlighted; tolerance re-triggers approval) |
| FR-052 | SO-04 | M | Approval by reporting manager + finance check on credit/advance; configurable multi-level matrix | `/approvals` | Built | Done (named reporting-manager approver + Accounts finance check) |
| FR-053 | SO-05 | M | After approval, "Generate Sales Contract": all SO details + terms; per-division templates, versioned, PDF | `/orders/:id/contract`, `/orders/:id/contract/print` | Simulated (print-to-PDF) | Done (contract tab, versioned, `/orders/:id/contract/print`) |
| FR-054 | SO-06 | C | Customer e-signature of contract | Contract → "Send for e-sign" | Simulated (OTP shown on screen) | Simulated (on-screen OTP e-sign) |
| FR-055 | SO-07 | M | Payment schedule (advance, milestones, balance, due dates); receipts/outstanding from ERP; reminders | Order → Payments tab | Simulated (receipts from mock ERP) | Done — receipts Simulated (payments tab, 100% schedule, `/orders/payments` reminders) |
| FR-056 | SO-08 | M | Import/SCM processing status: PO to principal, shipment ETA, customs, machine readiness, PDI | Order → Processing tab | Built | Done (Processing tab, SCM-only edit) |
| FR-057 | SO-09 | M | Approved SO pushed to ERP; invoice no./date and e-way bill returned | Order → ERP panel | Simulated ("Sync from ERP" fills invoice data) | Simulated (ERP push + Sync from ERP) |
| FR-058 | SO-10 | M | Hold / cancellation with reason and approval | Order status actions; `/approvals` | Built | Done (hold/resume/cancel with reason + approval) |
| FR-059 | SO-11 | M | Reports: order value, backlog, pending, delayed dispatch, payment overdues, sales performance | `/reports/:reportId` | Built | Done (order value, backlog, pending, delayed dispatches, payment status, sales performance) |

#### Dispatch, Delivery, Installation & Commissioning (BRD 4.6)

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-060 | INS-01 | M | Dispatch details (date, transporter, LR, challan, invoice ref, e-way bill); intimation to customer | Order → Dispatch tab; `/dispatches` | Simulated (intimation to outbox) | Done — intimation Simulated (`/dispatches`, delayed view) |
| FR-061 | INS-02 | M | Expected vs actual delivery; confirmation with photo and signed POD | Dispatch detail | Simulated (photo = file metadata) | Done (POD required; machine delivery → installation job) |
| FR-062 | INS-03 | M | Site readiness checklist shared with customer, engineer-verified before scheduling | Installation → Readiness tab | Built | Done (7-item readiness checklist, shared with customer, gates Site ready) |
| FR-063 | INS-04 | M | Sales-to-Service handover form | Installation → Handover tab | Built | Done (handover form required before start) |
| FR-064 | INS-05 | M | Installation job auto-created on delivery; engineer assignment, schedule, customer notification | `/installations`, `/installations/:id` | Built (notification to outbox) | Done (auto-created from delivery; assignment + notifications) |
| FR-065 | INS-06 | M | Job card: checklist, trial results, parameters, photos/videos, training, customer sign-off (OTP/signature) | Installation → Job card tab | Simulated (OTP shown on screen; signature pad on canvas) | Simulated (job card; photos as file metadata; OTP / canvas signature sign-off) |
| FR-066 | INS-07 | M | On sign-off: installed-base record, warranty start, PM schedule generated | Automatic (service layer) | Built | Done (sign-off → machine, warranty, PM visits, training, SO completed in one commit) |
| FR-067 | INS-08 | S | Training records and re-training requests per customer | Customer 360 → Training tab | Built | Done (`/trainingRecords`, Customer 360 Training tab) |

#### Installed Base, Warranty & AMC (BRD 4.7)

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-068 | IB-01 | M | Machine record: model, serial, configuration, software version, site, dates, SO ref, current owner (resale/relocation) | `/machines`, `/machines/:id` | Built | Done (`/machines`, relocation/transfer with ownership history) |
| FR-069 | IB-02 | S | Component serials (print heads) with replacement history | Machine → Components tab | Built | Done (Components tab with replacement history) |
| FR-070 | IB-03 | M | Warranty type, dates, coverage, exclusions; auto check on ticket creation | Machine → Warranty tab; ticket form banner | Built | Done (`/warranties`, coverage banner on machine) |
| FR-071 | IB-04 | M | AMC/CMC contracts: number, type, validity, machines, PM visits, SLA terms, value, billing schedule | `/contracts`, `/contracts/:id` | Built | Done (`/amcContracts`, AMC/26-27/0001, activation generates PM visits; one machine per contract) |
| FR-072 | IB-05 | M | Reminders at 90/60/30 days; renewal quotation; renewal pipeline; lost-renewal reasons | `/renewals` | Built | Done (`/renewals`, 90/60/30 reminders, renewal opportunity, renew/lost/expire) |
| FR-073 | IB-06 | S | Usage readings (print counters, ink consumption) per visit | Machine → Readings tab; ticket job card | Built | Done (Readings tab) |
| FR-074 | IB-07 | M | Reports: warranty expiry, AMC due/renewed/lost, machines without contract, base by model/region | `/reports/:reportId` | Built | Done (warranty expiry, AMC status/renewal %, machines without contract, installed base) |

#### Service Ticket Management (BRD 4.8)

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-075 | SRV-01 | M | Channels: phone (coordinator), WhatsApp, email, customer portal, engineer app; auto number; identify by mobile/serial | `/tickets/new` (channel field); `/portal/new-ticket` | Built (coordinator + engineer) / Simulated (WhatsApp/email "incoming" generator; minimal portal page) | Done — WhatsApp/email Simulated (coordinator, engineer app, public `/portal/new-ticket`) |
| FR-076 | SRV-02 | M | Ticket details incl. category/sub-category, priority, media; warranty/AMC status shown | Ticket form/detail | Built | Done (category → sub-category, coverage banner) |
| FR-077 | SRV-03 | M | Ticket types (Breakdown, Installation, PM, Remote, Training, Relocation, Chargeable, Spare-only) | Ticket form | Built | Done |
| FR-078 | SRV-04 | M | Priority Critical/High/Medium/Low; SLA targets per priority × contract type | Ticket form; `/admin/sla` | Built | Done (SLA targets from `/admin/policies`) |
| FR-079 | SRV-05 | M | Manual assignment + suggestions (territory, skill, availability, workload); engineer calendar and map | `/dispatch-board` | Built (map = territory grid, no tiles) | Done (`/dispatch-board`: suggestions by skill, territory, workload, leave; territory grid, no map tiles) |
| FR-080 | SRV-06 | M | Engineer app flow: accept, travel, geo check-in, diagnosis, work, parts, photos, check-out, OTP/signature; offline sync | `/my-jobs`, `/my-jobs/:id` (mobile layout) | Simulated (GPS mock; offline toggle queues writes) | Done — GPS & photos Simulated (`/my-jobs`, offline queue) |
| FR-081 | SRV-07 | M | Remote support record; convert to site visit | Ticket → Remote session panel | Built | Done (remote session, convert to site visit) |
| FR-082 | SRV-08 | M | Job card PDF auto-generated and sent | `/tickets/:id/job-card` | Simulated (print view + outbox) | Simulated (`/tickets/:id/job-card` print + outbox) |
| FR-083 | SRV-09 | M | SLA clocks (response, arrival, resolution); pause on Waiting for Customer; escalation matrix + alerts | Ticket detail SLA panel; notifications | Built (simulated clock) | Done (response/arrival/resolution clocks, pause only waiting-for-customer, escalation sweep) |
| FR-084 | SRV-10 | M | Chargeable service quotation, customer approval, billing request to ERP | Ticket → Chargeable tab | Simulated (ERP request logged) | Done — ERP billing Simulated (quote → customer approval → billing request) |
| FR-085 | SRV-11 | M | PM schedule per contract, model checklist, due/overdue, completion | `/pm-schedule` | Built | Done (`/pm-schedule`) |
| FR-086 | SRV-12 | M | Feedback link at closure; 1–5 rating; low rating alerts manager; closure confirmation | `/feedback/:token` (public page); ticket feedback panel | Built (link opened from outbox) | Done (public `/feedback/:token`, low rating alert, auto-close) |
| FR-087 | SRV-13 | M | Repeat complaint flag (same machine + category within N days) with root cause | Ticket detail badge + field | Built | Done (repeat flag, root cause before close) |
| FR-088 | SRV-14 | M | "Opportunity spotted" by engineer creates lead with engineer as referrer | `/my-jobs/:id` action | Built | Done (Opportunity spotted → lead, engineer referrer) |
| FR-089 | SRV-15 | M | Re-open within configurable period after closure | Ticket status action | Built | Done (re-open window, clocks restart) |
| FR-090 | SRV-16 | S | Knowledge base searchable by model/error code; engineer contributions with approval | `/knowledge-base`, `/knowledge-base/:id` | Built | Done (`/knowledgeArticles`, approval to publish) |
| FR-091 | SRV-17 | M | Reports: ageing, SLA compliance, MTTR, FTFR, downtime, repeats, MTBF, PM compliance, productivity, CSAT | `/reports/:reportId` | Built | Done (open tickets & ageing, SLA compliance, MTTR, FTFR, downtime, repeats, MTBF, PM compliance, engineer productivity, CSAT) |

#### Spare Parts & Engineer Stock (BRD 4.9)

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-092 | SPR-01 | M | Spares master (part no., description, models, HSN, price, warranty applicability) synced from ERP | `/spares` | Simulated (seeded as "from ERP", read-only) | Simulated (`/spareParts` synced from ERP; min level/critical editable) |
| FR-093 | SPR-02 | M | Main-store stock visibility | `/spares` stock column | Simulated (mock ERP stock) | Simulated (main-store stock, Sync stock from ERP, `/spares/stock-alerts`) |
| FR-094 | SPR-03 | M | Requisition from ticket; approval; store issue with courier details; receipt acknowledgement | `/requisitions`, `/requisitions/:id` | Built | Done (`/requisitions`, ticket Parts tab; service-head approval, store issue, receipt; ticket waiting_parts) |
| FR-095 | SPR-04 | M | Consumption against ticket/machine (warranty or chargeable); defective return tracking | Requisition detail; ticket parts panel | Built | Done (warranty/chargeable consumption, defective & unused returns) |
| FR-096 | SPR-05 | S | OEM warranty claims (claim no., status) | `/warranty-claims` | Built | Done (`/warrantyClaims`) |
| FR-097 | SPR-06 | S | Minimum-level alerts; import requirement visibility to SCM | `/spares?view=below-min`; notifications | Built | Done (below-min view + alerts to store/SCM) |

#### Consumables & Repeat Business (BRD 4.10)

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-098 | CON-01 | M | Consumables customers linked to machines where applicable; non-machine customers too | Customer 360 → Consumables tab | Built | Done (Customer 360 Consumables tab) |
| FR-099 | CON-02 | M | Quick repeat order from previous order; customer rate contracts with validity | `/rate-contracts`; Order → "Repeat" action | Built | Done (`/rateContracts`; repeat order `/orders/new?repeatOf=` uses rate contract → price list) |
| FR-100 | CON-03 | M | Leakage list: machine customers not buying company consumables | `/consumables/leakage` | Built | Done (`/consumables/leakage`) |
| FR-101 | CON-04 | S | Reorder prediction; due reminder; missed-reorder alert | `/consumables/reorders` | Built (average interval rule) | Done (`/consumables/reorders`, due/missed, reminders) |
| FR-102 | CON-05 | S | Sample/trial dispatch tracking with results | `/consumables/samples` | Built | Done (`/sampleDispatches`) |
| FR-103 | CON-06 | C | Dealer/distributor orders and secondary sales | `/consumables/dealer-sales` | Deferred (Could; no data model for secondary sales in BRD, see Q-24) | Deferred (Q-24: no data source for secondary sales) |

#### Field Force: Attendance, Visits & Expenses (BRD 4.11)

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-104 | ATT-01 | M | Check-in/out with time, GPS, optional selfie; status (present, half-day, leave, on tour) | `/attendance` | Simulated (browser geolocation if allowed, else mock; selfie = camera-free placeholder) | Done — GPS & selfie Simulated (`/attendance` one-tap check-in/out) |
| FR-105 | ATT-02 | M | Geo-fenced office attendance; mock-GPS detection | `/attendance`; `/admin/geofences` | Simulated (distance check against office coordinates; "mock location" demo toggle) | Simulated (office geofence, mock-GPS block) |
| FR-106 | ATT-03 | M | Working hours, late entry, early exit per shift policy | `/attendance/team` | Built | Done (`/attendance/team`, shift policy) |
| FR-107 | ATT-04 | M | Regularisation request with reason + manager approval | `/attendance` → Regularise; `/approvals` | Built | Done (regularisation approval) |
| FR-108 | ATT-05 | M | Field visits: customer/site, purpose, geo check-in/out, remarks, next action, linked record | `/visits`, `/visits/:id` | Simulated (GPS) | Done (`/visits`, 3-tap log, linked to records & timeline) |
| FR-109 | ATT-06 | S | Weekly beat plan; manager planned vs actual | `/visits/plan` | Built | Done (`/visits/plan`, planned vs actual) |
| FR-110 | ATT-07 | S | Location tracking between check-in/out; route map; distance | `/attendance/:userId/route` | Simulated (seeded GPS points drawn as SVG polyline) | Simulated (`/attendance/:staffId/route`, SVG route + km) |
| FR-111 | ATT-08 | S | T&E claims: distance-based conveyance, bill upload, limits, approval, export | `/expenses`, `/expenses/:id` | Built (upload = metadata) | Done — bill upload Simulated (manager → Accounts approval, payroll CSV export) |
| FR-112 | ATT-09 | C | Leave application/approval or HRMS integration | `/leaves` | Built (HRMS: N/A) | Done (`/leaves`; HRMS N/A) |
| FR-113 | ATT-10 | M | Reports: daily/monthly attendance, visit reports, exception dashboard | `/reports/:reportId`; `/attendance/exceptions` | Built | Done (`/attendance/exceptions` + attendance daily/monthly, field visits reports) |

#### Targets, Performance & Recognition (BRD 4.12)

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-114 | TGT-01 | M | Targets by user/team/division/category, monthly/quarterly/annual, multiple metrics | `/targets` | Built | Done (`/targets`) |
| FR-115 | TGT-02 | M | Achievement auto-calculated from orders and payments; target vs actual with drill-down | `/targets/achievement` | Built | Done (`/targets/achievement`, computed, drill-down) |
| FR-116 | TGT-03 | M | Weekly activity scorecard per role | `/scorecard` | Built | Done (`/scorecard`) |
| FR-117 | TGT-04 | S | Leaderboards and recognition within division | `/leaderboard` | Built | Done (`/leaderboard`, Deal of the Month, badges) |
| FR-118 | TGT-05 | C | Incentive rules or achievement export | `/targets/achievement` → Export | Built (export only; incentive rules Deferred, see Q-25) | Done (export only; incentive rules Deferred, Q-25) |

#### Administration & Configuration (BRD 4.14)

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-119 | ADM-01 | M | Configurable hierarchy (divisions, departments, managers) drives visibility and approvals | `/admin/organisation` | Built | Done (`/admin/organisation`) |
| FR-120 | ADM-02 | M | Permissions at module, record (own/team/division/all), field and action level | `/admin/roles`, `/admin/roles/:id` | Built | Partial — read-only matrix + effective-access preview (`/admin/access`); editing roles Deferred (needs a server-side authorization service) |
| FR-121 | ADM-03 | M | Masters (products & prices, types/specs, territories, industries, sources, lost reasons, complaint categories, checklists, T&C, GST/HSN) | `/admin/masters`, `/admin/masters/:master` | Built | Partial — masters via Configuration studio (`/admin/studio`); catalog masters added |
| FR-122 | ADM-04 | M | Configurable workflows and approval matrices | `/admin/workflows` | Built (limited to statuses/thresholds/approver levels defined here) | Done (`/admin/policies`: thresholds, approvers, SLA matrix, escalation; approval engine) |
| FR-123 | ADM-05 | M | Custom fields and form layouts per division | `/admin/custom-fields` | Built (custom fields render on Customer, Lead, Opportunity, Ticket forms) | Partial — custom fields via Configuration studio (`/admin/studio`); per-division form layouts Deferred |
| FR-124 | ADM-06 | M | Notification templates for email, WhatsApp, SMS, in-app | `/admin/notification-templates` | Built (templates fill the outbox) | Done (`/notificationTemplates`, 14 templates) |
| FR-125 | ADM-07 | M | Bulk import/export with templates and validation; export role-restricted and logged | `/admin/import-export` | Built (CSV) | Done (`/admin/import-export`, CSV templates + row validation) |
| FR-126 | ADM-08 | M | User lifecycle: create, deactivate, transfer records on exit | `/admin/users`, `/admin/users/:id` | Built | Done (employees; deactivation blocked while owning open records — BR-53) |
| FR-127 | ADM-09 | M | Any further configuration arising after implementation | — | N/A (contractual, open-ended) | — |
| FR-128 | ADM-10 | M | Developer support when self-configuration is not possible | — | N/A (contractual) | — |

#### Common Requirements (BRD 5)

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-129 | COM-01 | M | Role and hierarchy based access (see §2) | All screens; sign-in + role switcher | Built (in-browser enforcement, not a security boundary) | Done (simulated sign-in, role switcher, Own/Team/Division/All scopes in every module) |
| FR-130 | COM-02 | M | Single customer and machine record shared by all modules | Data model (§4) | Built | Done (one shared store; all modules reference the same customer and machine records) |
| FR-131 | COM-03 | M | Notifications: follow-ups, approvals, dues, SLA breaches, expiries via in-app/push/email/WhatsApp | Bell + `/notifications`; `/admin/outbox` | Built (in-app) / Simulated (push/email/WhatsApp to outbox) | Done — push/email/WhatsApp Simulated (in-app bell + inbox; outbox) |
| FR-132 | COM-04 | M | Documents attached to records with version history and size limits | "Documents" tab on records | Simulated (metadata only, size limit validated; no file bytes stored beyond small previews) | Partial — file metadata (PO, POD, photos, bills) on records with size limits; generic Documents tab with version history Deferred |
| FR-133 | COM-05 | M | Full activity timeline on customer, lead, opportunity, machine | "Timeline" tab on those records | Built | Done (Activity/Timeline tabs, Customer 360 timeline) |
| FR-134 | COM-06 | M | Global search (customer, contact, mobile, GSTIN, serial, quote/order/ticket ID); saved filters | Ctrl K palette; saved views on lists | Built | Done (Ctrl K search across resources; saved views on every list) |
| FR-135 | COM-07 | M | Android/iOS apps; offline for attendance, visits, job cards; camera, GPS, voice | Responsive web + `/my-jobs`, `/attendance`, `/visits` | Simulated (responsive web, offline toggle, Web Speech API where supported); native apps N/A | Simulated (responsive web at 390 px, offline queue, voice dictation; native apps N/A) |
| FR-136 | COM-08 | M | Excel import/export, templates, validation, role-restricted, logged | `/admin/import-export`; list "Export" buttons | Built (CSV) | Done (CSV import/export, role-restricted, audited) |
| FR-137 | COM-09 | M | Audit trail: create/change (old/new), approvals, exports, logins, deletes | `/admin/audit`; record History tab | Built | Done (all creates, edits, status changes, approvals, exports, sign-ins) |
| FR-138 | COM-10 | M | Soft delete → recycle bin; restore/permanent delete by admin | `/admin/recycle-bin` | Built | Done (`/admin/recycle-bin`) |
| FR-139 | COM-11 | M | INR, lakh/crore, DD-MM-YYYY, IST, Indian states, GST rules | Global formatters | Built | Done |
| FR-140 | COM-12 | M | In-app help, video tutorials, tool-tips, first-login walkthrough per role | Help drawer; tour overlay | Built (videos: placeholder cards) | Partial — help drawer + ⓘ tooltips; first-login walkthrough and video tutorials Deferred |

#### Integrations (BRD 6) — no BRD IDs; numbered here

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-141 | §6 ERP | M | Two-way ERP: masters, SO push, invoices, receipts, outstanding, credit, spares stock | `/admin/integrations`; ERP panels on records | Simulated (mock ERP service with "Sync now") | Simulated (`/admin/integrations` ERP sync) |
| FR-142 | §6 Zoho | M | One-time migration from Zoho CRM | — | N/A (data migration, backend) | — |
| FR-143 | §6 Web/Meta/Google | M | Automatic lead capture | `/admin/integrations` | Simulated (same as FR-015) | Simulated (same as FR-015) |
| FR-144 | §6 IndiaMART | S | Automatic lead capture | `/admin/integrations` | Simulated (same as FR-016) | Simulated (same as FR-016) |
| FR-145 | §6 WhatsApp | M | Two-way WhatsApp: quotes, reminders, updates, feedback links, ticket logging | `/admin/outbox`; "Simulate incoming WhatsApp" | Simulated | Simulated (incoming WhatsApp → ticket; outbound in outbox) |
| FR-146 | §6 Email | M | Send/receive mail, email-to-ticket, calendar sync | `/admin/outbox`; "Simulate incoming email" | Simulated (calendar sync N/A) | Simulated (incoming email → ticket); calendar sync N/A |
| FR-147 | §6 Maps | M | Geo-tagging, routes, distance, map views | Map panels | Simulated (coordinates + SVG plots; no tile provider since no new libraries) | Simulated (coordinates, geo check-in, SVG route and territory grid; no map tiles) |
| FR-148 | §6 E-sign | C | E-signature for contracts and sign-offs | Contract, job card | Simulated (same as FR-054) | Simulated (on-screen OTP e-sign for contracts and sign-offs) |

#### Dashboards (BRD 4.13) — no BRD ID

| ID | BRD | Pri | Requirement (condensed) | Screen / route | Approach | Status |
|---|---|---|---|---|---|---|
| FR-149 | 4.13 | M | Role-, module- and decision-based dashboards; customisable later | `/dashboard` (per role), `/reports` | Built (fixed role dashboards; widget customisation Deferred, see Q-26) | Done (`/dashboard` role dashboard: global date range Today/7D/30D/This month/Custom, KPI cards with % change vs previous period, Recharts trend/donut/funnel, top performers, agenda, activity feed and alerts, all computed from scoped records and linking to filtered lists; `/reports/kpi-summary`; user customisation Deferred, Q-26) |

### 1.2 Non-functional requirements

Frontend simulation for each NFR is in §6.

| ID | BRD | Requirement | Approach | Status |
|---|---|---|---|---|
| NFR-01 | §7 Architecture | Web + Android/iOS apps; modular, API-first; dev/UAT/prod environments | Simulated | Simulated (modular packs, async service layer per module) |
| NFR-02 | §7 Hosting | Cloud in an India region, TC-owned account | N/A | — |
| NFR-03 | §7 Performance | 95% of screens < 3 s on 4G; reports (1 year) < 10 s; 150 concurrent users | Simulated | Done (simulated 300–800 ms latency, loading states) |
| NFR-04 | §7 Availability | 99.5% monthly uptime | N/A | — |
| NFR-05 | §7 Scalability | 300 users, 5 years of data | Simulated | Simulated (≈2.7 MB seed: ~57 customers, 150 leads, 90 opportunities, 119 machines, 220 tickets) |
| NFR-06 | §7 Security | TLS 1.2+, AES-256 at rest | N/A | — |
| NFR-07 | §7 Security | MFA for admin and management | Simulated | Done |
| NFR-08 | §7 Security | Password policy and session timeout | Simulated | Done (idle timeout; no passwords) |
| NFR-09 | §7 Security | Role, record and field-level security | Built (client-side) | Done (row scope + field masking in the service layer for all modules) |
| NFR-10 | §7 Security | OWASP Top 10 protection; VAPT before go-live and annually | N/A (partly Built: no unsafe HTML, validated inputs) | — |
| NFR-11 | §7 Data protection | DPDP Act 2023: consent (location, communications), purpose limitation, retention, correction/erasure requests | Simulated | Simulated (location consent before first check-in, contact consent fields) |
| NFR-12 | §7 Backup | Daily backups (30 days), RPO ≤ 24 h, RTO ≤ 8 h, quarterly restore test | N/A (partly Simulated: export/import of full demo data) | Done (export/import JSON, reset) |
| NFR-13 | §7 Audit logs | Retained ≥ 3 years; not editable by any user | Built (append-only in UI) | Done |
| NFR-14 | §7 Usability | Adoption rules (§2.2); consistent screens; 5–6" phones; accessible contrast | Built | Done |
| NFR-15 | §7 Mobile + §2.2 | Android 10+/iOS 15+ or PWA; offline sync with conflict handling; battery-efficient location | Simulated | Simulated (offline queue for attendance, visits, job cards; top-bar toggle) |
| NFR-16 | §7 Browsers | Latest two versions of Chrome, Edge, Safari | Built | Partial (verified on Chrome; Edge/Safari not tested) |
| NFR-17 | §7 Maintainability | Documented code, TC-owned repo, version control, automated deploys, release notes | Built (partly N/A: deployments) | Done (TypeScript, git, docs/REQUIREMENTS.md + CONTRACTS.md); deployments N/A |
| NFR-18 | §7 Ownership | Full IP to TC; no lock-in; complete data export at any time | Built (export) / N/A (IP) | Done (CSV per list, full JSON export) |
| NFR-19 | §2.2 | Frequent mobile actions in ≤ 3 taps | Built | Done (check-in 1 tap, visit 3 taps at 390 px) |
| NFR-20 | §2.2 | Minimum mandatory fields; capture once and reuse through the chain | Built | Done (hand-offs prefill lead → opportunity → quotation → order → installation → machine) |
| NFR-21 | §2.2 | Voice-to-text notes; large fonts; clear icons; Hindi option for engineer app | Simulated (voice) / Deferred (Hindi) | Simulated (voice dictation via Web Speech API); Hindi Deferred |
| NFR-22 | §2.2 | Data returns value: today's plan, reminders, history, own scorecard | Built | Done (Today's plan on `/dashboard`) |
| NFR-23 | §2.2 | Accountability: overdue lists, SLA alerts, adoption reports | Built | Done (`/reports/crm-adoption`, overdue lists, SLA alerts) |
| NFR-24 | §8 | Data migration from Zoho, Excel registers, ERP, employee list | N/A (partly Built: CSV import templates) | — |
| NFR-25 | §9.3 | Role-based training, train-the-trainer, videos, quick-reference cards, adoption reviews | N/A (partly Built: help drawer, walkthrough, adoption report) | — |
| NFR-26 | §10 | 6-month warranty; support SLAs P1–P4; support contract scope | N/A | — |
| NFR-27 | §11 | Vendor deliverables (SRS, prototype, apps, docs, VAPT, source) | N/A (this prototype is deliverable 2) | — |

---

## 2. Roles and permission matrix

### 2.1 Roles

The BRD lists roles three different ways (§2.1, COM-01, Appendix B) and they do not match (see Q-01). The prototype uses the union below.
Visibility follows the hierarchy: **Own** → **Team** (own + direct and indirect reports) → **Division** → **All**.

| Role ID | Role | BRD positions | Default scope | Demo users (seed) |
|---|---|---|---|---|
| `admin` | System administrator | CRM admin (IT/MIS) | All + configuration | 1 |
| `management` | Management | MD, Chairman, CFO & Director, EA to MD | All | 2 |
| `division_head` | Division head | GM Sales Textile, GM Ink, VP Commercial, Head Paper | Division | 4 |
| `sales_manager` | Sales manager | RSM / NSM / Sales Managers (Textile, POD, Label) | Team | 3 |
| `sales_exec` | Sales executive | Ink, Paper, Fabric sales teams | Own | 4 |
| `service_head` | Service leadership | Service Head, National Service Manager, Service Managers | All service (Division for Service Managers, Assumption) | 2 |
| `engineer` | Service engineer | Textile, POD, Label engineers | Own (assigned jobs) | 5 |
| `coordinator` | Coordinator | Service/sales coordinators, Fabric coordinators | Division | 2 |
| `scm` | Import / SCM | Import Head, SCM Executives | All (orders, spares) | 1 |
| `store` | Store in-charge | Store In-charge | All (spares) | 1 |
| `accounts` | Accounts | Accounts | All (financial view) | 1 |
| `profiling` | Profiling | Profiling Manager | Sample requests only | 1 |

### 2.2 Permission matrix (proposed)

Appendix B is blank in the BRD ("to be provided at the time of development"). This is a **proposed** matrix for the prototype. It will be implemented as configuration in `/admin/roles` so True Colors can change it.

Legend: **C** create, **E** edit, **V** view, **A** approve, **D** delete (soft), **X** export. Scope: Own / Team / Div / All. — = no access.

| Role | Customers & contacts | Leads & opps | Quotations | Orders & contracts | Dispatch & install | Service tickets | Base, warranty & AMC | Spares | Consumables | Attendance & visits | Targets | Reports | Admin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Admin | CEVDX All | CEVDX All | CEVDX All | CEVDX All | CEVDX All | CEVDX All | CEVDX All | CEVDX All | CEVDX All | V All | CEV All | VX All | Full |
| Management | VX All | V A X All | V A X All (sees margin) | V A X All | V All | V All | V All | V All | V All | V A All | CEV All | VX All | — |
| Division head | CEVX Div | CEVX Div, A | CEV A X Div | CEV A X Div | V Div | V Div | V Div | — | CEV Div | V A Div | CEV Div | VX Div | — |
| Sales manager | CEV Team | CEV Team, A (reassign) | CEV A Team (level 1) | CEV A Team (level 1) | V Team | V Team | V Team | — | CEV Team | V A Team | V Team | V Team | — |
| Sales executive | CEV Own | CEV Own | CEV Own | CEV Own | V Own | C (opportunity-spotted lead) V Own | V Own | — | CEV Own | CEV Own | V Own | V Own | — |
| Service leadership | V All | V All (referrals) | V All (service quotes: CEV) | V All | CEV All, A | CEVDX All, A | CEVX All | V All, A (requisitions) | V All | V A (service team) | V Service | VX Service | — |
| Service engineer | V (assigned sites) | C (opportunity spotted) | C (chargeable service quote draft) | — | CEV assigned jobs | CEV assigned | V assigned machines | C requisition, V own | — | CEV Own | V Own | V Own | — |
| Coordinator | CEV Div | CEV Div | V Div | V Div | CEV Div | CEV Div (assign) | CEV Div | C requisition, V Div | CEV Div | V Div | — | V Div | — |
| Import / SCM | V All | — | V All | E processing tab only, V All | CEV dispatch | — | V All | V All, E min levels | — | CEV Own | — | V SCM | — |
| Store in-charge | — | — | — | V All | V dispatch | V linked tickets | — | CEV issue/receipt All | — | CEV Own | — | V Spares | — |
| Accounts | V All | — | V All (sees margin) | V All, A (finance check) | V All | V chargeable only | V contracts | V All | V All | V All, A (expenses) | V All | VX All | — |
| Profiling | V All | V opps with samples | — | — | — | — | — | — | E sample results | CEV Own | — | — | — |

Field-level rules: landed cost / margin (QUO-12) visible only to Management, Accounts, Admin. List price is read-only for everyone except Admin and Division head (QUO-05). Export (X) is always audit-logged (ADM-07). Permanent delete is Admin-only (COM-10).

Approval levels (QUO-06, SO-04): Level 1 Sales manager → Level 2 Division head → Level 3 Management (MD). Finance check on sales orders: Accounts.

**As built — deviations from the proposed matrix (recorded during module build):**
- Service tickets: sales managers and sales executives see their **division's** tickets read-only (tickets are owned by the assigned engineer, so "own customers" cannot be expressed as a row scope yet). Accounts and Store can read all tickets.
- Installed base (machines, installations, warranties): sales roles see their **division** rather than only their own customers, for the same reason.
- Sales-order approval level 1 goes to the owner's **named reporting manager** (moving up one level when the manager is the requester); quotation discount approvals use capability levels (approve.l1/l2/l3) filtered by division.
- Business policies (`/admin/policies`) are editable by Admin only.

---

## 3. Modules → screens → routes

Flat routes (no org/workspace prefix). Every resource list is `/<resource>`, with `?view=`, `?peek=<id>` (side panel), `/new`, `/<id>` and `/<id>/edit`. Every list route supports search, filter, sort, pagination and saved views. Every detail route has a Timeline / History tab where relevant.

| # | Module (sidebar) | Screen | Route | Covers |
|---|---|---|---|---|
| 0 | Shell | Sign in (simulated, pick demo user + MFA OTP for admin/management) | `/login` | FR-129, NFR-07 |
| 0 | Shell | Role dashboard (today's plan, reminders, KPIs) | `/dashboard` | FR-149, NFR-22 |
| 0 | Shell | Work inbox: notifications, approvals (discount, SO, hold/cancel, regularisation, expense, requisition, KB article), my tasks | `/inbox` (`?tab=notifications\|approvals\|tasks`) | FR-131, 040, 052, 058, 107, 111 |
| 0 | Shell | Tasks (calls, meetings, visits, demos, follow-ups) | `/tasks`, `/tasks/:id` | FR-021, 034 |
| 0 | Shell | Calendar (tasks, demos, meetings, PM visits) | `/calendar` | FR-034 |
| 0 | Shell | Follow-ups due / overdue | `/follow-ups` | FR-021 |
| 1 | Customers | Customer list | `/customers` | FR-001–012 |
| 1 | Customers | New / edit customer | `/customers/new`, `/customers/:id/edit` | FR-001, 004, 006 |
| 1 | Customers | Customer 360 (Overview, Contacts, Addresses, Timeline, Sales, Machines, Tickets, Consumables, Training, Account plan, Documents) | `/customers/:id` | FR-002, 003, 007–011, 067, 098 |
| 1 | Customers | Contact pool | `/contacts` | FR-005 |
| 1 | Customers | Contact detail | `/contacts/:id` | FR-005 |
| 2 | Sales | Leads list (views: All, Mine, Not attended, Nurture due) | `/leads` | FR-013–026 |
| 2 | Sales | New lead | `/leads/new` | FR-013, 014, 018 |
| 2 | Sales | Lead detail | `/leads/:id` | FR-019–024 |
| 2 | Sales | Lead import | `/leads/import` | FR-017 |
| 2 | Sales | Pipeline (Kanban / list) | `/opportunities` | FR-029 |
| 2 | Sales | New opportunity | `/opportunities/new` | FR-027 |
| 2 | Sales | Opportunity detail | `/opportunities/:id` | FR-027, 030–032 |
| 2 | Sales | Forecast | `/opportunities/forecast` | FR-033 |
| 2 | Sales | Demos & samples | `/demos` | FR-030 |
| 3 | Quotations | Quotation list | `/quotations` | FR-035–048 |
| 3 | Quotations | New / edit quotation (editor) | `/quotations/new`, `/quotations/:id/edit` | FR-035–041, 046, 047 |
| 3 | Quotations | Quotation detail | `/quotations/:id` | FR-042–045 |
| 3 | Quotations | Version compare | `/quotations/:id/compare` | FR-043 |
| 3 | Quotations | Print / PDF view | `/quotations/:id/print` | FR-042 |
| 3 | Quotations | Price lists | `/price-lists`, `/price-lists/:id` | FR-039 |
| 4 | Orders | Sales order list (views: Backlog, Payment overdue, Delayed) | `/orders` | FR-049–059 |
| 4 | Orders | New order from quotation / repeat order | `/orders/new` | FR-049–051, 099 |
| 4 | Orders | Order detail (Details, Changes vs quote, Payments, Processing, ERP, Dispatch, Contract) | `/orders/:id` | FR-052, 055–058, 060 |
| 4 | Orders | Sales contract + print | `/orders/:id/contract`, `/orders/:id/contract/print` | FR-053, 054 |
| 4 | Orders | Dispatches | `/dispatches` | FR-060, 061 |
| 5 | Installations | Installation jobs | `/installations` | FR-062–066 |
| 5 | Installations | Installation detail (Readiness, Handover, Job card, Sign-off) | `/installations/:id` | FR-062–066 |
| 6 | Installed base | Machines | `/machines` | FR-068–074 |
| 6 | Installed base | Machine detail (Warranty, Contracts, Components, Readings, Tickets, Timeline) | `/machines/:id` | FR-068–070, 073 |
| 6 | Installed base | AMC / CMC contracts | `/contracts`, `/contracts/:id` | FR-071 |
| 6 | Installed base | Renewals pipeline | `/renewals` | FR-072 |
| 7 | Service | Tickets (views: Open, SLA at risk, Breached, Repeat) | `/tickets` | FR-075–091 |
| 7 | Service | New ticket | `/tickets/new` | FR-075–078 |
| 7 | Service | Ticket detail (SLA, Visits, Remote, Parts, Chargeable, Feedback, Timeline) | `/tickets/:id` | FR-079–089 |
| 7 | Service | Job card print | `/tickets/:id/job-card` | FR-082 |
| 7 | Service | Dispatch board (engineer calendar + territory map) | `/dispatch-board` | FR-079 |
| 7 | Service | PM schedule | `/pm-schedule` | FR-085 |
| 7 | Service | Knowledge base | `/knowledge-base`, `/knowledge-base/:id` | FR-090 |
| 7 | Service | Engineer: My jobs (mobile layout) | `/my-jobs`, `/my-jobs/:id` | FR-080, 088 |
| 7 | Service | Customer feedback (public, no shell) | `/feedback/:token` | FR-086 |
| 7 | Service | Customer portal: raise ticket (public, no shell) | `/portal/new-ticket` | FR-075 |
| 8 | Spares | Spares & stock | `/spares` | FR-092, 093, 097 |
| 8 | Spares | Requisitions | `/requisitions`, `/requisitions/:id` | FR-094, 095 |
| 8 | Spares | OEM warranty claims | `/warranty-claims` | FR-096 |
| 9 | Consumables | Rate contracts | `/rate-contracts` | FR-099 |
| 9 | Consumables | Reorders due / missed | `/consumables/reorders` | FR-101 |
| 9 | Consumables | Leakage list | `/consumables/leakage` | FR-100 |
| 9 | Consumables | Samples & trials | `/consumables/samples` | FR-102 |
| 10 | Field force | My attendance (check-in/out, regularise) | `/attendance` | FR-104, 105, 107 |
| 10 | Field force | Team attendance + exceptions | `/attendance/team`, `/attendance/exceptions` | FR-106, 113 |
| 10 | Field force | Route map | `/attendance/:userId/route` | FR-110 |
| 10 | Field force | Visits | `/visits`, `/visits/:id` | FR-108 |
| 10 | Field force | Beat plan | `/visits/plan` | FR-109 |
| 10 | Field force | Expenses | `/expenses`, `/expenses/:id` | FR-111 |
| 10 | Field force | Leaves | `/leaves` | FR-112 |
| 11 | Performance | Targets | `/targets` | FR-114 |
| 11 | Performance | Achievement | `/targets/achievement` | FR-115, 118 |
| 11 | Performance | Scorecard | `/scorecard` | FR-116 |
| 11 | Performance | Leaderboard | `/leaderboard` | FR-117 |
| 12 | Reports | Report catalogue | `/reports` | FR-012, 026, 048, 059, 074, 091, 113 |
| 12 | Reports | Report viewer (filters, table, chart, export) | `/reports/:reportId` | same |
| 13 | Admin | Employees (users, roles, reporting manager, divisions) | `/employees`, `/employees/:id` | FR-126 |
| 13 | Admin | Organisation (divisions, departments, hierarchy, territories) | `/admin/organisation` | FR-119 |
| 13 | Admin | Roles & permissions | `/admin/access` | FR-120 |
| 13 | Admin | Configuration studio (masters, custom fields, publish history) | `/admin/studio` | FR-121, 123 |
| 13 | Admin | Event trace | `/admin/events` | FR-137 |
| 13 | Admin | Masters | `/admin/masters`, `/admin/masters/:master` | FR-121 |
| 13 | Admin | Workflows & approval matrices | `/admin/workflows`, `/admin/workflows/:workflow` | FR-028, 040, 122 |
| 13 | Admin | SLA configuration | `/admin/sla` | FR-078, 083 |
| 13 | Admin | Assignment rules / lead scoring | `/admin/assignment-rules`, `/admin/lead-scoring` | FR-019, 025 |
| 13 | Admin | Custom fields | `/admin/custom-fields` | FR-123 |
| 13 | Admin | Notification templates | `/admin/notification-templates` | FR-124 |
| 13 | Admin | Outbox (simulated email/WhatsApp/SMS/push) | `/admin/outbox` | FR-131, 145, 146 |
| 13 | Admin | Integrations (ERP sync, simulate incoming leads/messages) | `/admin/integrations` | FR-015, 016, 141–146 |
| 13 | Admin | Import / export | `/admin/import-export` | FR-125, 136 |
| 13 | Admin | Duplicates & merge | `/admin/duplicates` | FR-006 |
| 13 | Admin | Ownership transfer | `/admin/transfer` | FR-010 |
| 13 | Admin | Geofences | `/admin/geofences` | FR-105 |
| 13 | Admin | Audit log | `/admin/audit` | FR-137 |
| 13 | Admin | Recycle bin | `/admin/recycle-bin` | FR-138 |
| 13 | Admin | Settings (simulated clock, offline toggle, reset demo data, export/import all data) | `/admin/settings` | NFR-12, 15, 18 |

---

## 4. Entities, fields, relationships, statuses

`*` = required. All entities also have: `id`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `deletedAt` (soft delete), `version` (optimistic concurrency).
IDs use readable series. Indian financial year (FY) runs April–March, e.g. `26-27`.

### 4.1 Entity list and relationships

| Entity | Key fields | Relationships |
|---|---|---|
| **Division** | code* (TX, INK, POD, LBL, PPR, FAB), name* | has many Users, Price lists |
| **Territory / Hub** | name*, state*, cities | belongs to Division (many-to-many) |
| **User** | name*, email*, mobile*, roleId*, divisionIds*, managerId, territoryIds, skills (models), active | manager = User (hierarchy) |
| **Company (Customer)** `CUS-00001` | name*, legalName, gstin, pan, industry, segmentTags[], category*, website, divisionIds*, territoryId*, ownerId*, parentCompanyId, dealerId, keyAccount, accountPlan{}, erp{creditLimit, outstanding, overdue, syncedAt} | has many Addresses, Contacts, Leads, Opportunities, Quotations, Orders, Machines, Tickets, RateContracts |
| **Address** | type* (billing/shipping/installation), line1*, city*, state*, pincode*, lat, lng | belongs to Company |
| **Contact** `CON-00001` | name*, designation, department, mobile*, whatsapp, email, buyingRole, consent{whatsapp, email, sms, at}, companyId (null = contact pool), source, poolStatus | belongs to Company (optional) |
| **Lead** `LD-2627-00001` | companyId*, contactIds*[1..n], city, state, industry, segment, divisionId*, sourceId*, campaign, eventName, referrer{type, id}, requirement{productType*, subType, specs{}}, bant{need, budget, decisionMaker, timeline, currentSetup}, ownerId*, assigneeId*, status*, nextFollowUpAt*, nurtureUntil, disqualifyReasonId, firstContactAt, score | → Opportunity (on qualify) |
| **Activity** | type* (call, email, whatsapp, meeting, visit, note, status_change), subject, notes, at*, byUserId*, parent{type, id}*, nextFollowUpAt | on Lead, Opportunity, Company, Machine, Ticket |
| **Task** | title*, dueAt*, assigneeId*, parent, done | calendar items |
| **Opportunity** `OPP-2627-00001` | companyId*, leadId, name*, products[]*, value*, expectedCloseDate*, stageId*, probability, competitors[], ownerId*, decisionMakerContactIds[], type (new, upgrade, consumables, AMC, renewal), lostReasonId, lostTo{competitor, price}, lastActivityAt | has many Quotations, Demos; → SalesOrder |
| **Demo** | opportunityId*, location* (centre/site), machineId (demo machine), at*, status, results, feedback | |
| **SampleRequest** | opportunityId or companyId*, artwork, fabricDetails, assignedTo (profiling), status, results | |
| **Product** | sku*, name*, divisionId*, type* (Machine/Ink/Paper/Fabric/Spares/Service/Software), subType, hsnSac*, gstRate*, specs{} | |
| **PriceList** | divisionId*, name*, validFrom*, validTo*, items[{productId, listPrice*, landedCost}] | |
| **Quotation** `QT/TX/26-27/0001` | number*, opportunityId*, companyId*, contactId*, ownerId*, date*, validUntil*, placeOfSupplyState*, revision (R0…), isLatest, status*, lines[], freight, insurance, terms{payment, delivery, warranty, installation, validity}, totals{subtotal, discount, taxable, cgst, sgst, igst, total, inWords}, attachments[], sentLog[], acceptance{type, poNumber, file, at} | belongs to Opportunity; versions share a root id |
| **QuotationLine** | productId*, description, qty*, listPrice*, discountType, discountValue, hsnSac*, gstRate*, lineType* | |
| **Approval** | subject{type, id}*, kind* (discount, sales_order, hold, cancel, regularisation, expense, requisition, kb_article), level*, approverRoleId / approverId, status* (pending, approved, rejected), comment, decidedAt, remindedAt | generic, used by all approval flows |
| **SalesOrder** `SO/TX/26-27/0001` | number*, quotationId*, opportunityId, companyId*, customerPoNumber*, customerPoDate*, poFile*, lines[], totals, status*, holdReason, cancelReason, paymentSchedule[], processing{poToPrincipal, shipmentEta, customs, readiness, pdi}, erp{invoiceNo, invoiceDate, ewayBill, pushedAt}, contractId | → SalesContract, Dispatch, InstallationJob |
| **PaymentMilestone** | label*, percent / amount*, dueDate*, receivedAmount, receivedAt (from ERP) | belongs to SalesOrder |
| **SalesContract** `SC/TX/26-27/0001` | salesOrderId*, templateId*, version*, terms{…}, inkCommitments, amcTerms, signedAt, signature | |
| **Dispatch** | salesOrderId*, date*, transporter*, lrNumber*, challanNo, invoiceRef, ewayBill, expectedDelivery*, actualDelivery, podFile, podPhoto | |
| **InstallationJob** `INS-2627-0001` | salesOrderId*, companyId*, siteAddressId*, engineerIds[], scheduledAt, status*, readinessChecklist[], handover{expectations, commitments, keyContacts}, jobCard{steps[], trialResults, parameters, media[], training[{topic, trainees}]}, signOff{method, otp/signature, at} | → InstalledMachine |
| **InstalledMachine** `serial no.` | serialNo* (unique), model*, productId*, config{printHeads, width}, softwareVersion, companyId* (current owner), siteAddressId*, installDate*, purchaseDate, salesOrderId, ownerHistory[], components[{type, serial, installedAt, replacedAt}], readings[] | has Warranty, Contracts, Tickets, PM visits |
| **Warranty** | machineId*, type*, start*, end*, coverage* (parts/labour/both), exclusions | |
| **AmcContract** `AMC/26-27/0001` | number*, type* (AMC/CMC), companyId*, machineIds*[], start*, end*, pmVisitsPerYear*, slaTermsId, value*, billingSchedule[], status*, lostReason, renewedById | |
| **ServiceTicket** `TKT-2627-00001` | number*, channel*, companyId*, machineId (optional for consumables, see Q-13), contactId*, reportedAt*, description*, categoryId*, subCategoryId, type*, priority*, coverage (warranty/AMC/CMC/none, derived), assigneeId, status*, sla{responseDue, arrivalDue, resolutionDue, pausedMs, breached[]}, visits[], remote{steps, duration, sessionRef}, partsUsed[], chargeable{quote, approved, billingRequestedAt}, rootCause, repeatOfId, closedAt, reopenedCount, feedback{rating, comment, at} | |
| **Visit (job visit)** | ticketId*, engineerId*, travelStartAt, checkIn{at, lat, lng}, diagnosis, workDone, checkOut, media[], signOff | |
| **PmSchedule / PmVisit** | contractId or warrantyMachineId*, machineId*, dueDate*, checklistId*, status (due, done, overdue, missed), ticketId | |
| **KnowledgeArticle** | title*, models[], errorCodes[], symptoms, solution*, authorId, status (draft, pending, published) | |
| **SparePart** | partNo* (unique), description*, compatibleModels[], hsn*, price*, warrantyApplicable, stockMain (ERP), minLevel, critical | |
| **SpareRequisition** `REQ-2627-0001` | ticketId*, machineId, engineerId*, lines[{partId, qty}]*, status*, approvalId, issue{courier, docketNo, at}, receivedAt, consumption[{partId, qty, basis (warranty/chargeable)}], returns[{partId, condition (defective/unused), returnedAt}] | |
| **WarrantyClaim** | partId*, requisitionId, oem*, claimNo, status (raised, accepted, rejected, credited) | |
| **RateContract** | companyId*, divisionId*, items[{productId, rate}], validFrom*, validTo* | |
| **SampleDispatch** | companyId*, productId*, qty, dispatchedAt, trialResult, feedback | |
| **Attendance** | userId*, date*, checkIn{at, lat, lng, selfie, mock}, checkOut{…}, status* (present, half_day, leave, on_tour), lateBy, earlyBy, workMinutes | |
| **Regularisation** | attendanceId*, reason*, requestedTimes, approvalId | |
| **FieldVisit** | userId*, companyId*, siteAddressId, purpose*, plannedFor, checkIn, checkOut, remarks, nextAction, linked{type, id} | |
| **BeatPlan** | userId*, weekStart*, entries[{date, companyId, purpose}] | |
| **ExpenseClaim** `EXP-2627-0001` | userId*, period*, lines[{date, type, km, amount, billFile}], total, status (draft, submitted, approved, rejected, exported), approvalId | |
| **Leave** | userId*, from*, to*, type*, reason, status | |
| **Target** | scope{type (user/team/division), id}*, period{type, start}*, productCategory, metrics{orderValue, qty, collections, newCustomers, activities} | |
| **Notification** | userId*, kind*, title*, link, readAt, channel | |
| **OutboxMessage** | channel* (email, whatsapp, sms, push), to*, templateId, body*, relatedTo, sentAt | simulated delivery |
| **Document** | parent{type, id}*, name*, size*, mime*, version*, uploadedBy | metadata only |
| **AuditEntry** | at*, userId*, action*, entity{type, id}, changes[{field, old, new}], ip (n/a) | append-only |
| **SavedView** | userId, resource*, name*, filters, sort, columns | |
| **Masters / Config** | lead sources, lost/disqualify reasons, industries, segments, customer categories, complaint categories, checklists, T&C templates, GST/HSN, opportunity stages, approval matrices, SLA matrix, assignment rules, custom fields, notification templates | |

### 4.2 Status workflows and transitions

Transitions not listed are rejected by the service layer. "Guard" = what must be true before the transition.

**Lead**

| From | To | Guard / side effect |
|---|---|---|
| New | Contacted | First activity logged (sets `firstContactAt`, stops first-contact SLA) |
| New, Contacted | Qualified | BANT-lite fields filled (need, timeline, decision maker required). Creates Opportunity (stage Needs Assessment) carrying contacts, requirement, activities and documents. Lead becomes read-only |
| New, Contacted | Nurture | `nurtureUntil` date* in future |
| Nurture | Contacted | Manual reactivation, or auto-reminder on `nurtureUntil` |
| New, Contacted, Nurture | Disqualified | Reason* from master |
| Disqualified | Contacted | Manager only (Assumption, see Q-07) |

**Opportunity**: Needs Assessment → Demo/Sample → Proposal/Quotation → Negotiation → Won | Lost

| From | To | Guard / side effect |
|---|---|---|
| any open stage | any later open stage | Exit criteria of current stage met (configurable); skipping Demo allowed (Assumption) |
| any open stage | previous open stage | Allowed, logged |
| Proposal/Quotation, Negotiation | Won | Has an Accepted quotation (see Q-05). Enables "Generate Sales Order" |
| any open stage | Lost | Lost reason*, competitor lost to*, competitor price (optional) |
| Won, Lost | — | Terminal (reopen: Admin only) |

**Quotation**: Draft → Pending Approval → Approved → Sent → Under Negotiation → Accepted | Rejected | Expired

| From | To | Guard / side effect |
|---|---|---|
| Draft | Pending Approval | Any line discount above the user's threshold. Creates Approval(s) at the required level(s) |
| Draft | Approved | No discount above threshold (auto-approved, logged) |
| Pending Approval | Approved / Draft | All levels approved / any level rejects (back to Draft with comment) |
| Approved | Sent | Send action (email/WhatsApp logged to outbox) or "Mark as sent" |
| Sent | Under Negotiation | Customer responds with changes |
| Sent, Under Negotiation | Accepted | PO upload or electronic acceptance. Sets opportunity to Won (if not already) |
| Sent, Under Negotiation | Rejected | Reason* |
| Draft…Under Negotiation | Expired | Automatic when `validUntil` < today |
| any non-terminal | (new revision R n+1 in Draft) | "Revise": previous revision becomes read-only and inactive |

**Sales order**: Confirmed → Payment Pending/Received → Processing → Ready for Dispatch → Dispatched → Delivered → Installation → Completed; Hold / Cancelled with approval

Interpretation (see Q-04): a separate approval state is added in front of Confirmed. The prototype uses: `Pending Approval → Confirmed → Payment Pending → Payment Received → Processing → Ready for Dispatch → Dispatched → Delivered → Installation → Completed`, plus `On Hold` and `Cancelled`.

| From | To | Guard / side effect |
|---|---|---|
| (new) | Pending Approval | PO number, PO date, PO file required. Approval chain: reporting manager (+ finance check by Accounts) |
| Pending Approval | Confirmed | All approvals done. Enables "Generate Sales Contract"; pushes to ERP (simulated) |
| Confirmed | Payment Pending | Payment schedule has an advance due |
| Confirmed, Payment Pending | Payment Received | Advance received (from ERP sync). Orders with no advance go Confirmed → Processing |
| Payment Received | Processing | SCM starts processing |
| Processing | Ready for Dispatch | Machine readiness + PDI done (machine orders); stock ready (consumables) |
| Ready for Dispatch | Dispatched | Dispatch record: date, transporter, LR, e-way bill |
| Dispatched | Delivered | Actual delivery date + POD. Machine orders auto-create InstallationJob |
| Delivered | Installation | Installation job scheduled (machine orders) |
| Installation | Completed | Installation signed off. Consumables orders go Delivered → Completed |
| any before Dispatched | On Hold | Reason* + approval |
| On Hold | previous status | Approval |
| any before Dispatched | Cancelled | Reason* + approval; terminal |
| edits beyond tolerance | Pending Approval | Re-approval (SO-03) |

**Installation job**: Scheduled → Site Ready → In Progress → Trial & Training → Signed Off (see Q-14 on ordering)

| From | To | Guard / side effect |
|---|---|---|
| (auto on delivery) | Scheduled | Engineer(s) and date set; customer notified (outbox) |
| Scheduled | Site Ready | All readiness checklist items verified by engineer |
| Site Ready | In Progress | Engineer check-in |
| In Progress | Trial & Training | Installation steps completed |
| Trial & Training | Signed Off | Trial results + training records + customer OTP/signature. Creates InstalledMachine, Warranty (start = sign-off date), PM schedule; order → Completed |

**AMC contract**: Draft → Active → Due for Renewal → Renewed | Expired | Lost

| From | To | Guard / side effect |
|---|---|---|
| Draft | Active | Start date reached and value set; PM visits generated |
| Active | Due for Renewal | Automatic at 90 days before end; reminders at 90/60/30 days; renewal opportunity created |
| Due for Renewal | Renewed | New contract created and linked |
| Due for Renewal | Lost | Lost reason* |
| Due for Renewal | Expired | Automatic when end date passes with no decision |

**Service ticket**: Open → Assigned → Accepted → In Progress → Waiting for Parts / Waiting for Customer → Resolved → Customer Confirmation → Closed (Re-opened)

| From | To | Guard / side effect |
|---|---|---|
| Open | Assigned | Engineer set (coordinator/manager). Response SLA met at first assignment/contact |
| Assigned | Accepted | Engineer accepts (or rejects → Open) |
| Accepted | In Progress | Travel start or remote session start. Site check-in stops arrival SLA |
| In Progress | Waiting for Parts | Spare requisition raised |
| In Progress | Waiting for Customer | Reason*. SLA clock paused |
| Waiting for … | In Progress | Parts received / customer responds. SLA clock resumes |
| In Progress | Resolved | Work done, parts consumption recorded, customer sign-off (OTP/signature). Stops resolution SLA; job card generated |
| Resolved | Customer Confirmation | Feedback link sent automatically |
| Customer Confirmation | Closed | Customer confirms/rates, or auto-close after N days (Assumption: 3) |
| Customer Confirmation | In Progress | Customer says "not resolved" |
| Closed | Re-opened → In Progress | Within re-open window (Assumption: 15 days); counts against FTFR |

**Spares requisition**: Requested → Approved → Issued/Dispatched → Received → Consumed | Returned

| From | To | Guard / side effect |
|---|---|---|
| Requested | Approved / Rejected | Service manager approval |
| Approved | Issued | Store: courier, docket no. Main-store stock decremented (mock) |
| Issued | Received | Engineer acknowledges |
| Received | Consumed | Consumption against ticket/machine with basis (warranty/chargeable). Defective part return created if part is returnable |
| Received | Returned | Unused part returned to store |

Other statuses: Approval (pending → approved / rejected), Expense claim (draft → submitted → approved / rejected → exported), Leave (pending → approved / rejected / cancelled), KB article (draft → pending → published), Warranty claim (raised → accepted / rejected → credited), PM visit (due → done; overdue / missed automatic), Demo (requested → scheduled → done / cancelled), Sample request (requested → in progress → results shared).

---

## 5. Business rules and field validations

### 5.1 Field formats (shared validators)

| Field | Rule | Message |
|---|---|---|
| GSTIN | 15 chars, `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`; first two digits = valid state code (01–38) matching the billing state; chars 3–12 = PAN if PAN is given; checksum digit valid | "Enter a valid 15-character GSTIN" / "GSTIN state does not match billing state" |
| PAN | `^[A-Z]{5}[0-9]{4}[A-Z]$` | "Enter a valid PAN (e.g. ABCDE1234F)" |
| Mobile / WhatsApp | 10 digits starting 6–9; optional `+91` prefix stored normalised | "Enter a 10-digit Indian mobile number" |
| Email | standard email pattern, lower-cased | "Enter a valid email" |
| Pincode | `^[1-9][0-9]{5}$` | "Enter a 6-digit pincode" |
| State | from Indian states/UT master | — |
| HSN / SAC | HSN 4, 6 or 8 digits; SAC 6 digits starting `99` | "Enter a valid HSN/SAC code" |
| Website | URL with http(s) | — |
| Dates | Display and entry DD-MM-YYYY; stored ISO; IST | — |
| Money | INR, 2 decimals, ≥ 0, displayed with lakh/crore grouping (₹12,34,567.00) | — |
| Percent | 0–100, up to 2 decimals | — |
| Machine serial | Required for machines, unique across installed base, uppercase alphanumeric with `-` / `/` | "Serial number already exists on another machine" |
| Lat / Lng | −90..90 / −180..180, within India bounding box (warning only) | — |
| File upload | Allowed types per field; max 10 MB per file (Assumption, COM-04 does not give a figure) | "File is larger than 10 MB" |
| Rating | Integer 1–5 | — |
| Free-text notes | Max 2,000 chars; voice-to-text fills the same field | — |

### 5.2 Rules by module

| ID | Rule | Source |
|---|---|---|
| BR-01 | Duplicate check on Company create/import: exact GSTIN, mobile, email → blocking warning with link to existing; fuzzy name match (normalised, similarity ≥ 0.85) → non-blocking warning. Merge is Admin-only and audit-logged | CUS-06 |
| BR-02 | Company: at least one address; installation-site addresses need lat/lng before an installation or ticket visit can be scheduled | CUS-02 |
| BR-03 | Contact: at least one of mobile or email; WhatsApp/email messages only sent where consent = yes | CUS-03, NFR-11 |
| BR-04 | Contact pool → "Convert to Lead" pre-fills lead; if the contact has no company, the company is created inline | CUS-05, §3.1 |
| BR-05 | Lead: mandatory = company, ≥ 1 contact, division, source, product type, owner, next follow-up date. Everything else optional | LEAD-01, §2.2 |
| BR-06 | Lead source "Exhibition" requires event name; source "Referral" requires referrer type and referrer | LEAD-02 |
| BR-07 | Every lead/opportunity update must set next follow-up date ≥ today, except on Qualified, Disqualified, Won, Lost (Assumption, see Q-08) | LEAD-09 |
| BR-08 | First-contact SLA default 24 h from creation (configurable). Breach → notification to owner's manager and listed in "Not attended" | LEAD-08 |
| BR-09 | Auto-assignment: match rule by division + product type + territory; inside the matched team, round-robin by least recent assignment; no match → division head queue | LEAD-07 |
| BR-10 | Lead dedupe on create (mobile/email/GSTIN against existing open leads in same division) → warning | LEAD-03 |
| BR-11 | Opportunity stage probability defaults: Needs Assessment 10%, Demo/Sample 25%, Proposal 50%, Negotiation 75%, Won 100%, Lost 0% (Assumption, configurable) | OPP-02 |
| BR-12 | Stagnation: open opportunity with no activity for 14 days (configurable) or past expected close date → alert to owner and manager | OPP-06 |
| BR-13 | Quotation number series per division per FY: `QT/<DIV>/<FY>/<seq 4>`; revision suffix `-R1`, `-R2` | QUO-01, QUO-09 |
| BR-14 | Quotation validity default 30 days from date (Assumption, configurable per division) | QUO-07 |
| BR-15 | Line price = price-list price valid on quotation date; sales users cannot change list price; discount ≤ list price and 0–100% | QUO-05 |
| BR-16 | GST: if place-of-supply state = True Colors' GST state → CGST + SGST (rate/2 each); else IGST. Freight taxed at the rate of the main supply (Assumption). Amount in words in Indian system (lakh, crore) | QUO-04, COM-11 |
| BR-17 | Discount approval thresholds (Assumption, configurable per division/product): ≤ 5% none; > 5% to 10% Sales manager; > 10% to 15% Division head; > 15% Management. Highest line discount decides. Reminder to approver after 24 h pending | QUO-06 |
| BR-18 | Only the latest quotation revision can be sent, accepted or used for an order | QUO-09 |
| BR-19 | Margin = (net price − landed cost) / net price; field hidden unless role has field permission | QUO-12 |
| BR-20 | Generate Sales Order enabled only when opportunity = Won and an Accepted quotation exists; consumables repeat orders may be created from a previous order or rate contract without an opportunity (Assumption, see Q-05) | SO-01, CON-02 |
| BR-21 | Sales order: customer PO number, PO date (≤ today), PO file required | SO-02 |
| BR-22 | SO changes vs quotation: any line added/removed, or total value changed by more than ±2% (Assumption), or discount increased → back to Pending Approval | SO-03 |
| BR-23 | SO approval: reporting manager of the owner; then finance check by Accounts if advance < 30% or customer overdue > 0 (Assumption) | SO-04 |
| BR-24 | Sales contract can only be generated from a Confirmed (approved) SO; new versions keep history | SO-05 |
| BR-25 | Payment milestones must total 100% of order value; reminders 7 days before and on/after due date (Assumption) | SO-07 |
| BR-26 | Delivery of a machine order auto-creates an installation job and a handover form for the sales owner to fill | INS-04, INS-05 |
| BR-27 | Installation cannot move to In Progress until every readiness checklist item is verified | INS-03 |
| BR-28 | Sign-off creates InstalledMachine (serial unique), Warranty (start = sign-off date, duration from product master; default 12 months, Assumption), and PM schedule (visits per warranty/contract terms) | INS-07 |
| BR-29 | Ticket coverage derived at creation: active CMC > AMC > warranty > none, by machine and date; shown as a banner | IB-03, SRV-02 |
| BR-30 | SLA targets from matrix priority × coverage. Default (Assumption, "1-4-8" read as response 1 h / on-site 4 h / resolution 8 h for Critical under warranty/CMC, see Q-12); other priorities scale up | SRV-04, SRV-09 |
| BR-31 | SLA clock pauses only in Waiting for Customer (not Waiting for Parts) | SRV-09 |
| BR-32 | Escalation on breach: Service Manager → Service Head (+4 h) → GM (+8 h) → MD (+24 h) (Assumption, configurable) | SRV-09 |
| BR-33 | Repeat complaint: same machine + same category within 30 days (configurable) → flag + root-cause field mandatory before close | SRV-13 |
| BR-34 | Re-open allowed within 15 days of closure (Assumption, configurable) | SRV-15 |
| BR-35 | Feedback rating ≤ 2 (Assumption) → alert to Service Manager | SRV-12 |
| BR-36 | Chargeable visit/quote required when coverage = none or parts not covered; billing request only after customer approval | SRV-10 |
| BR-37 | "Opportunity spotted" creates lead with source Referral → Service engineer, referrer = engineer; engineer notified on conversion | SRV-14, LEAD-12 |
| BR-38 | Requisition quantity ≥ 1; issue qty ≤ approved qty ≤ main-store stock (warning if stock insufficient → import visibility to SCM) | SPR-03, SPR-06 |
| BR-39 | Leakage: customer with ≥ 1 installed machine and no consumables order in the last 90 days (Assumption) | CON-03 |
| BR-40 | Reorder due date = last order date + average interval of last 3 orders; "missed" when 7 days overdue (Assumption) | CON-04 |
| BR-41 | Rate contract rate overrides price list for that customer while valid; overlapping contracts for the same product not allowed | CON-02 |
| BR-42 | Check-in requires location (or explicit "location unavailable" reason); office staff must be inside geofence radius (default 200 m, Assumption); mock location flag blocks check-in | ATT-01, ATT-02 |
| BR-43 | Shift default 09:30–18:30, grace 15 min, half-day < 4.5 h worked (Assumption, configurable) | ATT-03 |
| BR-44 | Only one open check-in per user per day; check-out after check-in | ATT-01 |
| BR-45 | Location tracking runs only between check-in and check-out and only after location consent | ATT-07, NFR-11 |
| BR-46 | Conveyance = km × rate per vehicle type (Assumption: ₹4/km two-wheeler, ₹9/km car); amounts above policy limit need justification | ATT-08 |
| BR-47 | Achievement: order value from Confirmed+ orders by order date; collections from ERP receipts; new customers = first order in period | TGT-02 |
| BR-48 | Record visibility = role scope (Own/Team/Division/All) using manager chain; applied in every list, search, report and export | ADM-01, ADM-02 |
| BR-49 | All deletes are soft; restore and permanent delete are Admin-only | COM-10 |
| BR-50 | Every create/update/status change/approval/export/login/delete writes an audit entry with old/new values; audit entries cannot be edited or deleted | COM-09, NFR-13 |
| BR-51 | Dormant customer: no order and no activity for 180 days (Assumption, configurable) | CUS-12 |
| BR-52 | Ownership transfer moves the account and its open leads, opportunities and tasks; closed records keep their original owner; history entry on each | CUS-10, ADM-08 |
| BR-53 | Deactivating a user with open records requires a transfer first | ADM-08 |

### 5.3 Automatic hand-offs (BRD §3.1)

| Trigger | System action | Rule |
|---|---|---|
| Contact → Convert to Lead | Lead with contact + company | BR-04 |
| Lead qualified | Opportunity with all data, activities, documents | Lead workflow |
| Quotation accepted / opp Won | "Generate Sales Order" enabled, prefilled | BR-20 |
| SO approved | "Generate Sales Contract" enabled; ERP push | BR-24 |
| Machine delivered | Installation job + handover form | BR-26 |
| Installation signed off | Installed base, warranty, PM schedule | BR-28 |
| Warranty/AMC nearing expiry | Reminders + renewal opportunity | AMC workflow |
| Ticket closed | Job card + feedback link; low rating escalation | BR-35 |
| Engineer "Opportunity spotted" | Lead with engineer as referrer | BR-37 |

---

## 6. NFR simulation plan

| NFR | How it is handled in the frontend prototype |
|---|---|
| NFR-01 Architecture | Modular `src/modules/<module>`; every data call goes through `src/services/<module>.ts` with async signatures a REST API would have, so a backend can replace services one at a time. Native apps and environments: N/A (one responsive web app; mobile screens are web layouts) |
| NFR-02 Hosting | N/A: no server. Static build can be hosted anywhere |
| NFR-03 Performance | Services add 300–800 ms latency to show realistic loading states. Lists paginate (25/page) and reports run on up to 1 year of seeded data. Real 4G timing and concurrency: N/A |
| NFR-04 Availability | N/A: no server. The UI shows error states with Retry; a demo setting injects random service failures to show them |
| NFR-05 Scalability | Seed sized for a realistic demo (≈ 60 users, 400 customers, 1,500 leads, 120 machines, 600 tickets; Assumption). Lists stay paginated/virtualised so volume does not break the UI. True scale: N/A |
| NFR-06 TLS / encryption | N/A: no network or server storage |
| NFR-07 MFA | Simulated: Admin and Management sign-in shows an OTP step; the OTP is displayed on screen |
| NFR-08 Password policy / session timeout | Simulated: idle timeout (default 30 min, set shorter in demo settings) locks the session and returns to `/login`. Password policy N/A (no passwords; demo users) |
| NFR-09 Role/record/field security | Built: enforced in the service layer (not just hidden in UI): scope filtering, field masking (margin), action checks. Labelled as a model of server rules, not a security boundary |
| NFR-10 OWASP / VAPT | N/A. Frontend hygiene only: no `dangerouslySetInnerHTML`, all inputs validated, no secrets in code |
| NFR-11 DPDP Act | Simulated: consent fields on contacts (communications) and a location-consent prompt before first check-in; notice text in help; "Data request" action on a contact (correction / erasure) that creates an admin task and uses soft delete + anonymise. Retention rules: N/A (described only) |
| NFR-12 Backup & recovery | N/A. Partly simulated: Admin can export all demo data to a JSON file and import it back, plus "Reset demo data" |
| NFR-13 Audit logs | Built: append-only audit store; no edit/delete UI or service function. 3-year retention: N/A (browser storage) |
| NFR-14 Usability | Built: template design system, consistent list/detail/form patterns, token contrast, responsive down to 360 px width |
| NFR-15 Mobile / offline | Simulated: PWA-style responsive screens for engineer and field flows. A global "Offline" toggle (top bar) queues writes from attendance, visits and job cards; going online syncs them and shows a conflict dialog if the record changed meanwhile. Native OS targets and battery use: N/A |
| NFR-16 Browsers | Built for latest Chrome, Edge, Safari; verified on Chrome; others to be spot-checked |
| NFR-17 Maintainability | Built: TypeScript, git repo, README, this traceability file. Automated deployments and release notes: N/A for the prototype |
| NFR-18 Ownership / data export | Built: CSV export per list; full JSON export in admin settings. IP: N/A |
| NFR-19 ≤ 3 taps | Built: mobile quick-action bar (Check in, Log visit, Add follow-up, Update ticket) on engineer/sales home; each flow measured during review |
| NFR-20 Minimum fields / reuse | Built: required fields kept to BR-05 style minimums; every hand-off pre-fills the next record |
| NFR-21 Voice, fonts, Hindi | Voice: Simulated via browser Web Speech API (mic button on notes; disabled with reason where unsupported). Large fonts/icons: Built. Hindi: Deferred (needs translated strings from TC, see Q-20) |
| NFR-22 Data returns value | Built: role dashboard with today's plan, due follow-ups, reminders, own scorecard |
| NFR-23 Accountability | Built: overdue lists, SLA alerts, "Not attended" leads, CRM adoption report |
| NFR-24 Data migration | N/A. CSV import templates for customers, contacts, leads, machines are Built (FR-125) |
| NFR-25 Training | N/A. In-app help, tooltips and first-login walkthrough Built (FR-140) |
| NFR-26 Support & warranty | N/A (contractual) |
| NFR-27 Deliverables | N/A (this prototype covers "UI/UX prototype for web and mobile") |

**Simulated clock:** many rules depend on time (SLA, expiry, renewals, reminders, stagnation). Admin settings has a "demo date/time" offset so these can be shown in a demo without waiting. All time logic uses one `now()` function.

---

## 7. Open questions and contradictions

| ID | Topic | Issue in the BRD | Prototype assumption |
|---|---|---|---|
| Q-01 | Roles | Three different role lists: §2.1 (9 groups incl. System administrator, Support functions), COM-01 (9 roles, single "Sales", single "Service", has Admin), Appendix B (10 rows, no Admin, splits sales manager/executive and service leadership/engineer). Profiling Manager appears only in §2.1 | Union of 12 roles (§2.1 of this file) |
| Q-02 | Permission matrix | Appendix B is intentionally blank ("will provide at the time of development") | Proposed matrix in §2.2, editable in admin |
| Q-03 | Opportunity stages vs 8-stage process | §3.2 lists 8 stages (Prospecting … Onboarding); OPP-02 has 5 + Won/Lost. "Closing" and "Onboarding" are not opportunity stages | Opportunity uses OPP-02 stages; Prospecting = contact pool, Qualification = lead, Closing = SO, Onboarding = installation |
| Q-04 | Sales order statuses | Flow starts at "Confirmed" but SO-04 requires approval first; "Payment Pending/Received" is one combined step; "Installation" is both an SO status and a separate job | Added "Pending Approval" before Confirmed; split payment into two; SO "Installation" mirrors the job |
| Q-05 | SO trigger | §3.1 says "Quotation accepted **/** opportunity Won"; SO-01 says "once the opportunity is Won". Repeat consumables orders (CON-02) have no opportunity | Need opp Won + accepted quotation; repeat orders exempt |
| Q-06 | PO at order | SO-02 makes PO copy mandatory, but QUO-11 allows electronic acceptance instead of PO | PO still mandatory on SO |
| Q-07 | Lead back-transitions | Flow shows no way back from Disqualified or Nurture | Nurture → Contacted allowed; Disqualified → Contacted manager-only |
| Q-08 | Next follow-up "on every update" | LEAD-09 makes it mandatory on every update, which conflicts with closing a lead (Disqualified/Qualified) | Not required on terminal statuses |
| Q-09 | Quotation revisions | No rule for which status a new revision starts in, whether approval repeats, or whether Expired quotes can be revised | New revision starts in Draft and goes through approval again; Expired can be revised |
| Q-10 | Company GST state | CGST+SGST vs IGST needs True Colors' own GST registration state(s); not given. Multiple GSTINs (branches) possible | Single GSTIN in Maharashtra (Assumption) |
| Q-11 | Spec fields | Only Textile spec fields defined; other sub-types "to be finalised" (§13 #4) | 3–5 placeholder fields per sub-type, editable in masters |
| Q-12 | SLA "1-4-8" | KPI table mentions "True 1-4-8 criteria" without defining it; SLA defaults "agreed in SRS" | 1 h response / 4 h on-site / 8 h resolution for Critical |
| Q-13 | Tickets without machines | SRV-02 needs machine serial, but §13 #7 says Ink/Paper/Fabric customers also raise technical tickets | Machine optional when division is Ink/Paper/Fabric |
| Q-14 | Installation order | INS-03 says readiness must be verified before installation is **scheduled**; status flow puts Scheduled before Site Ready | Follow the status flow; "Scheduled" date is provisional until Site Ready |
| Q-15 | Warranty length | No default warranty period by product | 12 months, per-product override |
| Q-16 | Requisition end states | Flow ends in "Consumed \| Returned", but SPR-04 tracks defective returns of consumed parts — both happen | Consumed with a linked defective-return record |
| Q-17 | Engineer stock | Module is "Spare Parts & Engineer Stock" but SPR-02 only asks for main-store stock | Main store only; engineer van stock Deferred |
| Q-18 | Division heads | 6 indicative users but 4 positions; 6 divisions (POD and Label share one VP; Fabric has no head listed) | 4 division heads; Fabric under Textile GM (Assumption) |
| Q-19 | Customer category | "Existing/Inactive Customer" combines two states; dormant customers (CUS-12) is also a computed state | Keep as one master value; "Dormant" is computed, not a category |
| Q-20 | Hindi | Hindi for engineer app only (§2.2, §13 #12) vs training in English and Hindi | Deferred until TC provides translations |
| Q-21 | Location tracking window | ATT-07: only between check-in and check-out; §7 Mobile: only during working hours | Between check-in and check-out (stricter) |
| Q-22 | Repeat complaint period | SRV-13 configurable; KPI fixes 30 days | Configurable, default 30 |
| Q-23 | Customer portal | SRV-01 lists a customer portal/app as a channel, but no portal requirements or users exist anywhere else | Minimal public "raise a ticket" page only |
| Q-24 | Secondary sales | CON-06 mentions dealer secondary sales visibility with no data source | Deferred |
| Q-25 | Incentive rules | TGT-05 gives no rule examples | Export only |
| Q-26 | Dashboards | 4.13 asks the developer to propose dashboards; no KPIs per role except Appendix C | Role dashboards built from Appendix C KPIs |
| Q-27 | Phasing | §9.1 has no phase content; §12.2 refers to Phase 1/2/3 | Build order in §8 below |
| Q-28 | Approval thresholds | Values not given (§13 #5: "three levels, configurable") | BR-17 values |
| Q-29 | ERP | ERP system unknown (§13 #1); field list for sync not defined | Mock ERP service with the fields named in the BRD |
| Q-30 | Duplicate threshold | "Fuzzy match" not quantified | Similarity ≥ 0.85 on normalised name |
| Q-31 | File size limit | COM-04 requires limits but gives none | 10 MB per file |
| Q-32 | Date format | The template's design skill (rule 14) shows dates as "16 Oct, 2026"; BRD COM-11 (Must) requires DD-MM-YYYY | DD-MM-YYYY everywhere ("16-10-2026"); tooltip "Fri, 16-10-2026 08:30 AM". One function (`lib/dates.ts`) to change if TC prefers the skill format |
| Q-33 | Past scheduling | The BRD only forbids past dates for follow-ups (BR-07); the calendar brief asks to block past create/edit "if BRD rules require it" | New calendar events, and edits that move an event, may not start in the past (BR-07 generalised). Editing details or marking a past event completed/cancelled is allowed. Calendar times are Asia/Kolkata wall-clock regardless of the browser zone |

---

## 8. Build order

Each step ends with `npm run build` passing, no console errors, routes reachable from the sidebar, and this file updated.

| Step | Scope | FRs |
|---|---|---|
| 0 ✅ | Foundation: simulated login + role switcher (12 roles, seeded users and hierarchy), permission service, service-layer conventions (latency, errors), localStorage store + reset, audit, notifications + outbox, approvals engine, simulated clock, formatters (INR, DD-MM-YYYY), shared validators, list/detail/form patterns from the template | FR-129–140 (base), NFR-07–09, 13 |
| 1 ✅ | Masters & admin core: organisation, users, roles, masters, products & price lists | FR-039, 119–121, 126 |
| 2 ✅ | Customers & contact pool, duplicates, 360 (shell tabs) | FR-001–012 |
| 3 ✅ | Leads | FR-013–026 |
| 4 ✅ | Opportunities, pipeline, forecast, demos | FR-027–034 |
| 5 ✅ | Quotations & approvals | FR-035–048 |
| 6 ✅ | Sales orders, contracts, dispatch | FR-049–061 |
| 7 ✅ | Installations → installed base, warranty, AMC, renewals | FR-062–074 |
| 8 ✅ | Service tickets, SLA, PM, KB, engineer app, feedback | FR-075–091 |
| 9 ✅ | Spares | FR-092–097 |
| 10 ✅ | Consumables | FR-098–103 |
| 11 ✅ | Field force | FR-104–113 |
| 12 ✅ | Targets & performance | FR-114–118 |
| 13 ✅ | Dashboards & reports | FR-149 + all report FRs |
| 14 ✅ | Remaining admin (workflows, custom fields, templates, import/export, integrations, recycle bin) | FR-122–125, 141–148 |
