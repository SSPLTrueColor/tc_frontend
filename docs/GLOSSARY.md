# True Color CRM — Glossary (BRD terminology)

Status: **Draft for approval** · 19-10-2026 · Source: `docs/BRD.md` (8-Oct-2026), `docs/REQUIREMENTS.md`, and the app as built on `feature/crm-modules`.

This file is the single reference for every name the app shows. After approval it becomes `src/constants/labels.ts`, and every screen reads its labels from there.

## 0. How names are chosen

When the BRD names the same thing in more than one place, this order decides:

| What | Source of truth | Why |
|---|---|---|
| Module names | §4 headings (4.1 – 4.14) | The BRD groups every requirement under these |
| Record (entity) names | Appendix A "Record" column, else the requirement that defines it | Appendix A is the BRD's formal list of records and workflows |
| Status values and stages | Appendix A, then the status line under each module | Same |
| Role names | Appendix B rows, plus "System administrator" from §2.1 | Appendix B is the access matrix the roles exist for |
| Button names | The BRD's quoted names ('Convert to Lead', 'Generate Sales Order', 'Generate Sales Contract', 'Opportunity spotted'), else the BRD verb | Quoted names are the BRD's own UI wording |
| Field labels | The wording in the requirement that lists the field | — |

**Casing (see conflict C-01):** module, page and tab names, buttons and status values use Title Case, as the BRD writes them (e.g. "Pending Approval", 'Generate Sales Order'). Field labels, placeholders, help text and toasts stay in sentence case, as in the template.

**Sidebar labels:** where a BRD module name is too long for the sidebar, a short label taken from the same name is used. The full BRD name is still the page title and breadcrumb. Both are listed in §1.

Legend for the "App today" columns: ✅ same · ✏️ rename · ➕ missing (to build) · ❓ not in BRD (your decision).

---

## 1. Modules, pages and tabs

### 1.1 Sidebar modules

The app has 12 sidebar modules today. Some combine two BRD modules (Sales = 4.2 + 4.3) and some split one (4.6 is spread over Orders and Installed base). The proposal is one sidebar module per BRD §4 module, in BRD order, with Dashboard first.

| # | BRD § | BRD module name (page title / breadcrumb) | Sidebar label | App today | |
|---|---|---|---|---|---|
| 1 | 4.13 | Dashboards & Reports → *Dashboard* | Dashboard | Home → Overview | ✏️ |
| 2 | 4.1 | Customer & Contact Master | Customers & Contacts | Customers | ✏️ |
| 3 | 4.2 | Lead Management | Leads | Sales (combined) | ✏️ split |
| 4 | 4.3 | Opportunity & Pipeline Management | Opportunities & Pipeline | Sales (combined) | ✏️ split |
| 5 | 4.4 | Quotation Management | Quotations | Quotations | ✅ |
| 6 | 4.5 | Sales Order & Sales Contract | Sales Orders & Contracts | Orders | ✏️ |
| 7 | 4.6 | Dispatch, Delivery, Installation & Commissioning | Dispatch & Installation | spread over Orders + Installed base | ✏️ new group |
| 8 | 4.7 | Installed Base, Warranty & AMC | Installed Base & AMC | Installed base | ✏️ |
| 9 | 4.8 | Service Ticket Management | Service Tickets | Service | ✏️ |
| 10 | 4.9 | Spare Parts & Engineer Stock | Spare Parts | Spares & consumables (combined) | ✏️ split |
| 11 | 4.10 | Consumables & Repeat Business | Consumables | Spares & consumables (combined) | ✏️ split |
| 12 | 4.11 | Field Force: Attendance, Visits & Expenses | Field Force | Field & performance (combined) | ✏️ split |
| 13 | 4.12 | Targets, Performance & Recognition | Targets & Recognition | Field & performance (combined) | ✏️ split |
| 14 | 4.13 | Dashboards & Reports → *Reports* | Reports | Reports | ✅ |
| 15 | 4.14 | Administration & Configuration | Administration | Administration | ✏️ title only |
| — | — | — | — | Products (catalog) | ❓ see G-B1 |

### 1.2 Pages per module, with proposed routes

Routes are kebab-case of the BRD name. Record pages keep the pattern `/<list>/:id`, `/<list>/new` and `/<list>/:id/edit`. Old routes redirect to the new ones so saved links and saved views keep working.

**1 · Dashboard (4.13)**

| Page | BRD ref | App today | Route today → proposed | |
|---|---|---|---|---|
| Dashboard | 4.13, §1.3 "real-time dashboards" | Overview | `/dashboard` → `/dashboard` | ✏️ |
| Tasks & Calendar | OPP-08 "Tasks and calendar" | Calendar (Home) | `/calendar` → `/calendar` | ✏️ page title |
| Tasks | OPP-08 | Tasks (Home) | `/tasks` → `/tasks` | ✅ |
| Activity History | COM-05 | Activities (Home) | `/activities` → `/activity-history` | ✏️ |
| Notifications & Approvals | COM-03, QUO-06, SO-04 | Work inbox | `/inbox` → `/notifications` | ❓ see G-B2 |

*(Tasks & Calendar is OPP-08, but it holds service and field events too, so it sits under Dashboard rather than Opportunities. Decision D-3.)*

**2 · Customers & Contacts (4.1)**

| Page | BRD ref | App today | Route today → proposed | |
|---|---|---|---|---|
| Companies | CUS-01, CUS-04 | Customers | `/customers` → `/companies` | ✏️ (C-02) |
| Customer 360° View | CUS-07 | customer record page | `/companies/:id` | ✏️ title |
| Contacts | CUS-03 | Contacts | `/contacts` | ✅ |
| Contact Pool | CUS-05 | a saved view inside Contacts | `/contacts?view=…` → `/contact-pool` | ➕ own page |
| Import Contacts | CUS-05 | Import contacts | `/contacts/import` → `/contact-pool/import` | ✏️ |
| Addresses / Sites | CUS-02 | Addresses | `/addresses` → `/sites` | ✏️ |

Customer 360° View tabs (CUS-07 lists them in this order). Today's tabs are Overview, Contacts, Addresses, Timeline, Sales, Machines, Tickets, Consumables, Training, Account plan and Documents.

| Proposed tab | BRD wording | Today |
|---|---|---|
| Overview | — | Overview ✅ |
| Contacts | CUS-03 "contact persons" | Contacts ✅ |
| Sites | CUS-02 "billing, shipping and installation sites" | Addresses ✏️ |
| Leads | CUS-07 "leads" | inside Sales ✏️ split |
| Opportunities | CUS-07 "opportunities" | inside Sales ✏️ split |
| Quotations | CUS-07 "quotations" | inside Sales ✏️ split |
| Sales Orders | CUS-07 "orders" | inside Sales ✏️ split |
| Payment Status | CUS-07 "payment status (from ERP)" | header only ➕ |
| Installed Machines | CUS-07 "installed machines" | Machines ✏️ |
| Warranty & AMC | CUS-07 "warranty/AMC" | inside Machines ✏️ split |
| Service Tickets | CUS-07 "service tickets" | Tickets ✏️ |
| Feedback | CUS-07 "feedback" | — ➕ |
| Consumables | 4.10 | Consumables ✅ |
| Training Records | INS-08 | Training ✏️ |
| Key Account Plan | CUS-11 "one-page account plan" | Account plan ✏️ |
| Activity History | CUS-07 "all activities on a single timeline", COM-05 | Timeline ✏️ |
| Documents | COM-04 | Documents ✅ |

**3 · Leads (4.2)**

| Page | BRD ref | App today | Route today → proposed | |
|---|---|---|---|---|
| Leads | LEAD-01 | Leads | `/leads` | ✅ |
| Not Attended Leads | LEAD-08 "'Not attended leads' dashboard" | saved view "Not attended" | `/leads?view=` → `/not-attended-leads` | ➕ own page |
| Follow-ups | LEAD-09 "overdue follow-up list" | Follow-ups | `/follow-ups` | ✅ |
| Import Leads | LEAD-05 | Import leads | `/leads/import` | ✅ |
| Referrals | LEAD-12 "referral report" | report only | → `/referrals` | ❓ keep as report (D-5) |

Lead record tabs: Details, Product Requirement (LEAD-06), Qualification (BANT) (LEAD-10), Follow-ups (LEAD-09), Activity History (COM-05), Documents.

**4 · Opportunities & Pipeline (4.3)**

| Page | BRD ref | App today | Route today → proposed | |
|---|---|---|---|---|
| Pipeline | OPP-03 "Kanban … and list view" | Opportunities (Pipeline view) | `/opportunities` → `/pipeline` | ✏️ |
| Opportunities | OPP-01 | Opportunities | `/opportunities` | ✅ (list view of Pipeline) |
| Sales Forecast | OPP-07 | Forecast | `/opportunities/forecast` → `/sales-forecast` | ✏️ |
| Demos | OPP-04 "book a demo" | Demos | `/demos` | ✅ |
| Demo Machine Calendar | OPP-04 "demo machine calendar" | Demo machines (list) | `/demoMachines` → `/demo-machine-calendar` | ✏️ (needs calendar view, G-A3) |
| Sample Print Requests | OPP-04 "sample print request to the Profiling team" | Sample requests | `/sampleRequests` → `/sample-print-requests` | ✏️ |

**5 · Quotations (4.4)**

| Page | BRD ref | App today | Route today → proposed | |
|---|---|---|---|---|
| Quotations | QUO-01 | Quotations | `/quotations` | ✅ |
| Quotation editor | QUO-02 – QUO-04 | editor | `/quotations/new`, `/:id/edit` | ✅ |
| Compare Versions | QUO-09 "side-by-side comparison of versions" | Compare revisions | `/quotations/:id/compare` | ✏️ |
| Quotation PDF | QUO-08 | print view | `/quotations/:id/print` → `/quotations/:id/pdf` | ✏️ |
| Pending Approvals | QUO-06, QUO-14 "pending approvals" | saved view + Work inbox | → `/quotations/pending-approvals` | ➕ own page |
| ROI / Payback Calculator | QUO-13 | fields inside the quotation | tab | ✏️ tab name |
| Terms & Conditions Templates | QUO-07, ADM-03 | Terms templates | `/termsTemplates` → `/admin/terms-templates` | ✏️ moves to Administration › Masters |

Quotation record tabs: Line Items, Pricing & GST, Commercial Terms, Approval, Versions, ROI / Payback Calculator, Documents, Activity History.

**6 · Sales Orders & Contracts (4.5)**

| Page | BRD ref | App today | Route today → proposed | |
|---|---|---|---|---|
| Sales Orders | SO-01 | Sales orders | `/orders`, `/salesOrders` → `/sales-orders` | ✏️ (two routes today) |
| Sales Contracts | SO-05 | Sales contracts | `/salesContracts` → `/sales-contracts` | ✏️ |
| Payment Schedule | SO-07 | Payment milestones + Payments due | `/paymentMilestones`, `/orders/payments` → `/payment-schedule` | ✏️ merge |
| Order Processing | SO-08 "Order processing status updated by Import/SCM" | saved view "Processing (SCM)" | → `/order-processing` | ➕ own page |

Sales order record tabs: Details, Changes vs Quotation (SO-03), Approval (SO-04), Payment Schedule (SO-07), Order Processing (SO-08), ERP Invoice (SO-09), Dispatch & Delivery (INS-01), Sales Contract (SO-05), Hold / Cancellation (SO-10), Activity History.

**7 · Dispatch & Installation (4.6) — new sidebar group**

| Page | BRD ref | App today | Route today → proposed | |
|---|---|---|---|---|
| Dispatch & Delivery | INS-01, INS-02 | Dispatches (under Orders) | `/dispatches` → `/dispatch-delivery` | ✏️ moves |
| Installation Jobs | INS-05, Appendix A | Installation jobs (under Installed base) | `/installations` → `/installation-jobs` | ✏️ moves |
| Training Records | INS-08 | Training records (under Installed base) | `/trainingRecords` → `/training-records` | ✏️ moves |

Installation job tabs: Site Readiness Checklist (INS-03), Sales-to-Service Handover (INS-04), Job Card (INS-06), Customer Sign-off (INS-06). Today they are Readiness, Handover, Job card and Sign-off ✏️.

**8 · Installed Base & AMC (4.7)**

| Page | BRD ref | App today | Route today → proposed | |
|---|---|---|---|---|
| Installed Base | IB-01, Appendix D | Machines | `/machines` → `/installed-base` | ✏️ |
| Warranties | IB-03 | Warranties | `/warranties` | ✅ |
| AMC / CMC Contracts | IB-04 | AMC / CMC contracts | `/amcContracts` → `/amc-cmc-contracts` | ✏️ casing |
| Renewals | IB-05 "renewal pipeline" | Renewals | `/renewals` → `/renewal-pipeline` | ✏️ |
| Component Serial Numbers | IB-02 | Machine components | `/machineComponents` → `/component-serial-numbers` | ✏️ |
| Machine Usage Readings | IB-06 | Usage readings | `/machineReadings` → `/machine-usage-readings` | ✏️ |
| Resale / Relocation History | IB-01 "supports resale/relocation" | Ownership & site history | `/machineMoves` → `/resale-relocation-history` | ✏️ |

Machine record tabs: Details, Warranty, AMC / CMC, Component Serial Numbers, Usage Readings, Service Tickets, Resale / Relocation History, Activity History.

**9 · Service Tickets (4.8)**

| Page | BRD ref | App today | Route today → proposed | |
|---|---|---|---|---|
| Service Tickets | SRV-01 | Service tickets | `/tickets` → `/service-tickets` | ✏️ |
| Log Ticket | SRV-01 "Ticket logging" | new-ticket form | `/tickets/new` → `/service-tickets/new` | ✏️ |
| Engineer Calendar & Map | SRV-05 "engineer calendar and map view" | Dispatch board | `/dispatch-board` → `/engineer-calendar` | ✏️ (C-12) |
| My Jobs | SRV-06 "Engineer mobile app: accept job" | My jobs | `/my-jobs` | ✅ |
| PM Schedule | SRV-11 "auto-generated PM schedule" | PM schedule + PM visits | `/pm-schedule`, `/pmVisits` → `/pm-schedule` | ✏️ merge |
| Site Visits | SRV-06, SRV-07 "convert to site visit" | Service visits | `/serviceVisits` → `/site-visits` | ✏️ |
| Knowledge Base | SRV-16 | Knowledge base | `/knowledge-base`, `/knowledgeArticles` → `/knowledge-base` | ✏️ one route |
| Service Job Card (PDF) | SRV-08 | job card print | `/tickets/:id/job-card` → `/service-tickets/:id/job-card` | ✏️ |
| Customer Feedback (public) | SRV-12 | feedback link | `/feedback/:token` | ✅ |
| Customer Portal – Log Ticket (public) | SRV-01 "customer portal/app" | portal | `/portal/new-ticket` → `/customer-portal/log-ticket` | ✏️ |

Ticket record tabs: Details, SLA Tracking (SRV-09), Site Visits (SRV-06), Remote Support (SRV-07), Parts Used (SPR-04), Chargeable Service (SRV-10), Customer Feedback (SRV-12), Activity History. Today they are SLA, Visits, Remote, Parts, Chargeable, Feedback and Timeline ✏️.

**10 · Spare Parts (4.9)**

| Page | BRD ref | App today | Route today → proposed | |
|---|---|---|---|---|
| Spare Parts Master | SPR-01 | Spare parts | `/spareParts` → `/spare-parts` | ✏️ |
| Main Store Stock | SPR-02 | stock column on Spare parts | → `/main-store-stock` | ➕ own page |
| Engineer Stock | 4.9 module title | — | → `/engineer-stock` | ➕ G-A1 |
| Spares Requisitions | Appendix A, SPR-03 | Part requisitions | `/requisitions` → `/spares-requisitions` | ✏️ |
| Minimum-Level Alerts | SPR-06 | Stock alerts | `/spares/stock-alerts` → `/minimum-level-alerts` | ✏️ |
| Warranty Claims (OEM) | SPR-05 | OEM warranty claims | `/warrantyClaims` → `/oem-warranty-claims` | ✏️ |

**11 · Consumables (4.10)**

| Page | BRD ref | App today | Route today → proposed | |
|---|---|---|---|---|
| Repeat Orders | CON-02 "Quick repeat order from the previous order" | 'Repeat order' button only | → `/repeat-orders` | ➕ own page |
| Rate Contracts | CON-02 | Rate contracts | `/rateContracts` → `/rate-contracts` | ✏️ |
| Leakage List | CON-03 | Consumables leakage | `/consumables/leakage` → `/leakage-list` | ✏️ |
| Reorder Prediction | CON-04 | Reorders due | `/consumables/reorders` → `/reorder-prediction` | ✏️ |
| Sample / Trial Dispatch | CON-05 | Samples & trials | `/sampleDispatches` → `/sample-trial-dispatch` | ✏️ |
| Dealer / Distributor Orders | CON-06 (Could) | Deferred (Q-24) | → `/dealer-orders` | ➕ G-A6 |

**12 · Field Force (4.11)**

| Page | BRD ref | App today | Route today → proposed | |
|---|---|---|---|---|
| Attendance (Check-in / Check-out) | ATT-01 | My day (check-in) | `/attendance` | ✏️ |
| Team Attendance | ATT-10 "employee-wise attendance" | Team attendance | `/attendance/team` → `/team-attendance` | ✏️ |
| Exception Dashboard | ATT-10 "exception dashboard" | Exceptions | `/attendance/exceptions` → `/exception-dashboard` | ✏️ |
| Attendance Regularisation | ATT-04 | Regularisations | `/regularisations` → `/attendance-regularisation` | ✏️ |
| Field Visits | ATT-05 | My visits + Field visits | `/visits`, `/fieldVisits` → `/field-visits` | ✏️ merge |
| Beat Plan | ATT-06 "Weekly visit (beat) plan … planned vs actual" | Beat plan + Beat plan vs actual | `/beatPlans`, `/visits/plan` → `/beat-plan` | ✏️ merge |
| Route Map | ATT-07 "route map and distance travelled" | not in sidebar | `/attendance/:staffId/route` → `/route-map/:userId` | ➕ sidebar entry |
| Expense Claims | ATT-08 "Travel & expense claims" | Expense claims | `/expenses`, `/expenseClaims` → `/expense-claims` | ✏️ one route |
| Payroll Export | ATT-08 "export to accounts/payroll" | Payroll export | `/expenseClaims/payroll-export` → `/expense-claims/payroll-export` | ✏️ |
| Leave Applications | ATT-09 | Leave | `/leaves` → `/leave-applications` | ✏️ |

**13 · Targets & Recognition (4.12)**

| Page | BRD ref | App today | Route today → proposed | |
|---|---|---|---|---|
| Targets | TGT-01 | Targets | `/targets` | ✅ |
| Target vs Actual | TGT-02 "target vs actual dashboards" | Target achievement | `/targets/achievement` → `/target-vs-actual` | ✏️ |
| Weekly Activity Scorecard | TGT-03 | Weekly scorecard | `/scorecard` → `/activity-scorecard` | ✏️ |
| Leaderboards & Recognition | TGT-04 | Leaderboard | `/leaderboard` → `/leaderboards` | ✏️ |

**14 · Reports (4.13)** — one report page per BRD "Reports" requirement

| Page | BRD ref | App today | Route today → proposed | |
|---|---|---|---|---|
| All Reports | 4.13 | All reports | `/reports` | ✅ |
| KPIs & CRM Adoption | Appendix C, §9.3 "CRM adoption report" | KPIs & adoption | `/reports/kpis` | ✏️ |
| Customer Reports | CUS-12 | Customers | `/reports/customers` | ✏️ |
| Lead Reports | LEAD-14 | Leads & sales team | `/reports/leads` | ✏️ |
| Quotation Reports | QUO-14 | Quotations | `/reports/quotations` | ✏️ |
| Sales Order Reports | SO-11 | Orders & collections | `/reports/orders` → `/reports/sales-orders` | ✏️ |
| Installed Base Reports | IB-07 | Installed base & AMC | `/reports/installed` → `/reports/installed-base` | ✏️ |
| Service Reports | SRV-17 | Service | `/reports/service` | ✏️ |
| Field Force Reports | ATT-10 | Field force | `/reports/field` → `/reports/field-force` | ✏️ |

**15 · Administration (4.14)**

| Page | BRD ref | App today | Route today → proposed | |
|---|---|---|---|---|
| Organisation Hierarchy | ADM-01 | Organisation | `/admin/organisation` → `/admin/organisation-hierarchy` | ✏️ |
| Users | ADM-08 "User lifecycle" | Employees | `/employees` → `/admin/users` | ✏️ (C-14) |
| Roles & Permissions | ADM-02 | Roles & access | `/admin/access` → `/admin/roles-permissions` | ✏️ |
| Masters | ADM-03 | tab inside Configuration studio | `/admin/studio` → `/admin/masters` | ✏️ split |
| Custom Fields & Form Layouts | ADM-05 | tab inside Configuration studio | → `/admin/custom-fields` | ✏️ split |
| Workflows & Approval Matrices | ADM-04 | Business policies (part) | `/admin/policies` → `/admin/workflows` | ✏️ |
| SLA Matrix | SRV-04, SRV-09 | "Service SLA matrix" section of Business policies | → `/admin/sla-matrix` | ✏️ split |
| Lead Assignment Rules | LEAD-07 | Lead assignment rules | `/admin/assignment-rules` → `/admin/lead-assignment-rules` | ✅ label |
| Lead Scoring Rules | LEAD-13 | Lead scoring rules | `/admin/lead-scoring` → `/admin/lead-scoring-rules` | ✅ label |
| Notification Templates | ADM-06 | Notification templates | `/admin/notification-templates` | ✅ |
| Bulk Import / Export | ADM-07 | Import / export | `/admin/import-export` → `/admin/bulk-import-export` | ✏️ |
| Duplicate Detection & Merge | CUS-06 | Duplicates & merge | `/admin/duplicates` → `/admin/duplicate-merge` | ✏️ |
| Bulk Ownership Transfer | CUS-10, ADM-08 | Ownership transfer | `/admin/transfer` → `/admin/ownership-transfer` | ✏️ |
| Integrations | §6 | Integrations | `/admin/integrations` | ✅ |
| Audit Trail | COM-09 | Audit log | `/admin/audit` → `/admin/audit-trail` | ✏️ |
| Recycle Bin | COM-10 | Recycle bin | `/admin/recycle-bin` | ✅ |
| Product & Price Master | QUO-02, QUO-05, ADM-03 | Products module (Products, Price lists, Price list items) | `/products`, `/priceLists` → `/admin/products`, `/admin/price-lists` | ❓ G-B1 |
| Event trace | — | Event trace | `/admin/events` | ❓ G-B3 |
| Message outbox | — | Message outbox | `/admin/outbox` | ❓ G-B4 |
| Settings (demo controls) | — | Settings | `/admin/settings` | ❓ G-B5 |

---

## 2. Records (entities) and field labels

### 2.1 Record names

| BRD record name (singular / list) | BRD ref | App today | |
|---|---|---|---|
| Company / Companies | CUS-01 (C-02) | Customer | ✏️ |
| Contact / Contacts (field label on other records: "Contact Person") | CUS-03, LEAD-01, QUO-01 | Contact; "Contact person" on lead and quotation, "Contact" on opportunity | ✏️ opportunity |
| Site (billing / shipping / installation) | CUS-02 | Address | ✏️ |
| Lead | Appendix A | Lead | ✅ |
| Opportunity | Appendix A | Opportunity | ✅ |
| Demo | OPP-04 | Demo | ✅ |
| Sample Print Request | OPP-04 | Sample request | ✏️ |
| Demo Machine | OPP-04 | Demo machine | ✅ |
| Quotation | Appendix A | Quotation | ✅ |
| Terms & Conditions Template | ADM-03 | Terms template | ✏️ |
| Sales Order | Appendix A | Sales order | ✅ (casing) |
| Payment Schedule (one line = Payment Milestone) | SO-07 "advance, milestone payments, balance" | Payment milestone | ✅ line / ✏️ page |
| Sales Contract | SO-05 | Sales contract | ✅ |
| Dispatch | INS-01 | Dispatch | ✅ |
| Installation Job | Appendix A | Installation job | ✅ |
| Training Record | INS-08 | Training record | ✅ |
| Machine (list = Installed Base) | IB-01 "Installed-base record", Appendix D | Machine | ✅ |
| Warranty | IB-03 | Warranty | ✅ |
| AMC / CMC Contract | IB-04 (Appendix A shortens it to "AMC contract") | AMC / CMC contract | ✅ |
| Component | IB-02 | Machine component | ✏️ |
| Usage Reading | IB-06 | Usage reading | ✅ |
| Service Ticket | Appendix A | Service ticket | ✅ |
| Site Visit | SRV-07 | Service visit | ✏️ |
| PM Visit | SRV-11, IB-04 "preventive visits" | PM visit | ✅ |
| Knowledge Article | SRV-16 | Knowledge article | ✅ |
| Spare Part | SPR-01 | Spare part | ✅ |
| Spares Requisition | Appendix A, SPR-03 | Part requisition | ✏️ |
| Warranty Claim (OEM) | SPR-05 | Warranty claim | ✏️ |
| Rate Contract | CON-02 | Rate contract | ✅ |
| Sample / Trial Dispatch | CON-05 | Sample dispatch | ✏️ |
| Attendance | ATT-01 | Attendance | ✅ |
| Regularisation Request | ATT-04 | Regularisation | ✏️ |
| Field Visit | ATT-05 | Field visit | ✅ |
| Beat Plan | ATT-06 | Beat plan entry | ✏️ |
| Expense Claim | ATT-08 | Expense claim | ✅ |
| Leave Application | ATT-09 | Leave | ✏️ |
| Target | TGT-01 | Target | ✅ |
| Task | OPP-08 | Task | ✅ |
| Calendar Event | OPP-08 | Calendar event | ✅ |
| Activity | COM-05, LEAD-09 | Activity | ✅ |
| User | ADM-08 | Employee | ✏️ C-14 |
| Product, Price List | QUO-02, QUO-05 | Product, Price list | ✅ |

### 2.2 Field labels that change

Only labels that differ from the BRD are listed. Every other label already matches.

| Record | Field | App today | BRD label | BRD ref |
|---|---|---|---|---|
| Customer | category | Category | Customer Category | CUS-01, CUS-04 |
| Customer | segmentTags | Segments | Segment | CUS-01 |
| Customer | territoryId | Territory / hub | Territory / Hub | CUS-01 (casing only) |
| Customer | parentId | Parent / group company | Group Company (Parent) | CUS-08 |
| Customer | dealerId | Through dealer / distributor | Dealer / Distributor | CUS-08 |
| Customer | keyAccount | Key account | Key Account | CUS-11 |
| Customer | creditLimit / outstanding / overdue | … (ERP) | Credit Limit / Outstanding / Overdue | CUS-09 (the "(ERP)" suffix becomes help text) |
| Contact | buyingRole | Buying role | Role in Buying Decision | CUS-03 |
| Contact | consent* | WhatsApp / Email / SMS consent | Communication Consent | CUS-03 |
| Lead | ownerId | Owner | Lead Owner | LEAD-07 |
| Lead | sourceId | Source | Lead Source | LEAD-02 |
| Lead | referrerType | Referred by | Referrer | LEAD-02, LEAD-12 |
| Lead | productType | Product interest | Product Type | LEAD-06 (C-08) |
| Lead | subType | Sub-type | Sub-type | ✅ |
| Lead | requirement / budget / decisionMaker / timeline / currentSetup | Customer requirement (need) / … | Customer Requirement / Budget / Decision Maker / Purchase Timeline / Current Set-up / Competitor Machine | LEAD-10 |
| Lead | nurtureUntil | Re-contact on | Re-contact Date | LEAD-11 |
| Lead | disqualifyReason | Disqualify reason | Disqualification Reason | LEAD-11 |
| Lead | nextFollowUpAt | Next follow-up | Next Follow-up Date | LEAD-09 |
| Lead | score | Score | Lead Score | LEAD-13 |
| Opportunity | name | Opportunity | Opportunity Name | OPP-01 |
| Opportunity | productType | Product category | Product Type | OPP-03 (C-08) |
| Opportunity | value | Value | Value | ✅ |
| Opportunity | expectedCloseDate | Expected close | Expected Close Date | OPP-01 |
| Opportunity | territoryId | Hub | Territory / Hub | OPP-03 (C-10) |
| Opportunity | lostToCompetitor / lostToPrice | Lost to / Competitor price | Lost to Competitor / Lost at Price | OPP-05 |
| Opportunity | stagnant | Stagnant | Stagnation Alert | OPP-06 |
| Quotation | quoteNo | Quotation no. | Quotation Number | QUO-01 |
| Quotation | ownerId | Sales executive | Sales Executive | QUO-01 ✅ |
| Quotation | validUntil | Valid until | Validity | QUO-01 |
| Quotation | revision | Revision | Version | QUO-09 (C-06) |
| Quotation | subtotal | Gross value | List Value | QUO-04 |
| Quotation | grandTotal | Total value | Total Value | QUO-04 ✅ |
| Quotation | landedCostTotal / marginPct | Landed cost / Margin % | Landed Cost / Margin | QUO-12 |
| Sales order | orderNo | Order no. | Order Number | SO-02 |
| Sales order | customerPoNo / customerPoDate / poFileName | Customer PO no. / date / PO copy | Customer PO Number / PO Date / PO Copy | SO-02 |
| Sales order | ownerId | Sales owner | Sales Executive | QUO-01 (same person carried forward) |
| Sales order | orderKind | Kind | Order Type | — (app-only field) |
| Sales order | invoiceNo / invoiceDate / ewayBill | ERP invoice no. / date / E-way bill no. | Invoice Number / Invoice Date / E-way Bill Reference | SO-09 |
| Sales order | pdiDone | Pre-dispatch inspection done | Pre-dispatch Inspection | SO-08 |
| Dispatch | lrNumber / challanNo / podFileName | LR number / Delivery challan / Signed POD | LR Number / Delivery Challan / Signed Proof of Delivery | INS-01, INS-02 |
| Installation job | engineerId | Engineer | Service Engineer | INS-05 |
| Machine | customerId | Current owner | Current Owner | IB-01 ✅ |
| Machine | siteAddressId | Site | Installation Site | IB-01 |
| Machine | installDate / purchaseDate | Installed on / Purchased on | Installation Date / Purchase Date | IB-01 |
| AMC / CMC contract | contractNo / contractType | Contract no. / Type | Contract Number / Contract Type | IB-04 |
| AMC / CMC contract | pmVisitsPerYear | PM visits / year | Number of Preventive Visits | IB-04 |
| AMC / CMC contract | billingFrequency | Billing | Billing Schedule | IB-04 |
| Service ticket | description | Complaint | Complaint Description | SRV-02 |
| Service ticket | reportedAt | Reported at | Complaint Date / Time | SRV-02 |
| Service ticket | category / subCategory | Category / Sub-category | Complaint Category / Sub-category | SRV-02, ADM-03 |
| Service ticket | ticketType | Type | Ticket Type | SRV-03 |
| Service ticket | channel | Logged via | Logging Channel | SRV-01 |
| Service ticket | assigneeId | Engineer | Service Engineer | SRV-05 |
| Service ticket | coverage | Coverage | Warranty / AMC Status | SRV-02 |
| Service ticket | repeatOfId | Repeat of | Repeat Complaint | SRV-13 |
| Service ticket | rating | Customer rating | Rating (1–5) | SRV-12 |
| Service ticket | spottedLeadId | Lead from this visit | Opportunity Spotted (Lead) | SRV-14 |
| Spares requisition | partId / engineerId | Part / Engineer | Spare Part / Service Engineer | SPR-03 |
| Spares requisition | basis | Basis | Warranty / Chargeable | SPR-04 |
| Field visit | employeeId | Visited by | User | ATT-05 |
| Attendance | — | "My day" | Check-in / Check-out | ATT-01 |
| Calendar event | assigneeId | Assigned to | Assigned User | (your calendar brief) ✅ |

---

## 3. Status values and workflow stages

Values are written as the BRD writes them. ➕ = in the app but not in the BRD (decision needed, see G-B6).

| Record | BRD flow (Appendix A) | App today | Change |
|---|---|---|---|
| Lead | New → Contacted → Qualified (converted to Opportunity) \| Nurture \| Disqualified | New, Contacted, Qualified, Nurture, Disqualified | casing only |
| Opportunity | Needs Assessment → Demo/Sample → Proposal/Quotation → Negotiation → Won \| Lost | Needs assessment, Demo / sample, Proposal / quotation, Negotiation, Won, Lost | casing only → "Demo/Sample", "Proposal/Quotation" |
| Quotation | Draft → Pending Approval → Approved → Sent → Under Negotiation → Accepted \| Rejected \| Expired | same + ➕ **Superseded** | casing; Superseded? (QUO-09 "only the latest version is active") |
| Sales Order | Confirmed → Payment Pending/Received → Processing → Ready for Dispatch → Dispatched → Delivered → Installation → Completed (Hold / Cancelled with approval) | ➕ **Pending approval**, Confirmed, Payment pending, Payment received, Processing, Ready for dispatch, Dispatched, Delivered, Installation, Completed, On hold, Cancelled | "On hold" → **Hold**; "Payment pending/received" kept as two values (C-11); Pending Approval? (SO-04 needs approval before Confirmed) |
| Installation Job | Scheduled → Site Ready → In Progress → Trial & Training → Signed Off | same | casing only |
| AMC / CMC Contract | Draft → Active → Due for Renewal → Renewed \| Expired \| Lost | same | casing only |
| Service Ticket | Open → Assigned → Accepted → In Progress → Waiting for Parts / Customer → Resolved → Customer Confirmation → Closed (Re-opened) | same | casing only |
| Spares Requisition | Requested → Approved → Issued/Dispatched → Received → Consumed \| Returned (defective/unused) | same + ➕ **Rejected** | "Issued / dispatched" → "Issued/Dispatched"; Rejected? (SPR-03 has an approval step) |

Statuses for records that have no flow in Appendix A. These are written from the requirement text; values the BRD does not mention are marked ➕.

| Record | BRD values | App values | Change |
|---|---|---|---|
| Contact (pool) | CUS-05: pool → 'Convert to Lead' | New, Contacted, Converted to lead | "Converted to Lead" |
| Customer category | CUS-04: Prospect, Active Customer, Existing/Inactive Customer, Dealer, Distributor | same wording | casing only |
| Customer segment | CUS-04: Fashion Brand/Boutique, Job-work/Print Bureau, Trader, Mill/Processing House | same + ➕ Packaging / labels, ➕ Commercial printer | keep extras? (CUS-04 says "such as", so the list is open) |
| Demo | OPP-04 (no statuses) | Requested, Scheduled, Done, Cancelled | ➕ all app-defined |
| Sample print request | OPP-04 "results … recorded" | Requested, Printing, Results shared, Cancelled | ➕ |
| Dispatch | INS-02 "delivery confirmation" | In transit, Delivered | ➕ |
| Warranty | IB-03 | Active, Expiring ≤ 90 days, Expired, Not started | ➕ (derived) |
| PM visit | SRV-11 "due/overdue lists, completion status" | Due, Overdue, Done, Missed | "Done" → **Completed** |
| Knowledge article | SRV-16 "with approval" | Draft, Pending approval, Published | ➕ |
| OEM warranty claim | SPR-05 "claim number, status" | Raised, Accepted, Rejected, Credited | ➕ |
| Sample / trial dispatch | CON-05 | Requested, Dispatched, Trial in progress, Results received, Cancelled | ➕ |
| Attendance | ATT-01: present, half-day, leave, on tour | Present, Half-day, On tour, Leave + ➕ **Absent** | keep Absent? (needed for the ATT-10 "no check-in" exception) |
| Regularisation / Leave / Expense | ATT-04 / ATT-09 / ATT-08 "approval" | Pending approval, Approved, Rejected (+ Cancelled for leave; Draft, Submitted, Exported to payroll for expenses) | ➕ |
| Field visit | ATT-05 | Planned, At site, Completed, Cancelled | ➕ |
| Beat plan | ATT-06 "planned vs actual" | Planned, Visited, Missed | ➕ |
| Task | OPP-08 | To do, In progress, Done, Cancelled | ➕ |
| Calendar event | OPP-08 | Scheduled, Completed, Cancelled | ➕ |
| Price list | QUO-05 "validity dates" | Draft, Active, Expired | ➕ |

Other value lists:

| List | BRD values | App today | Change |
|---|---|---|---|
| Ticket Type | SRV-03: Breakdown, Installation, Preventive Maintenance, Remote Support, Training, Relocation, Chargeable Visit, Spare-part Only | same | casing only |
| Ticket Priority | SRV-04: Critical (machine down), High, Medium, Low | same | ✅ |
| Contract coverage | SRV-04: warranty / AMC / CMC / no contract | CMC (comprehensive), AMC (labour), Warranty, No contract | ✏️ "AMC – labour only", "CMC – comprehensive" (IB-04) |
| Logging channel | SRV-01: phone (by coordinator), customer WhatsApp, email-to-ticket, customer portal/app, engineer app | Phone (coordinator), WhatsApp, Email, Customer portal, Engineer app | ✏️ "Email-to-ticket", "Customer Portal / App" |
| Product Type | LEAD-06: Machine, Ink, Paper, Fabric, Spares, Service | same + ➕ **Software (RIP)** | keep? (QUO-03 lists RIP software as a quotation line) |
| Sub-type | LEAD-06: Textile, POD, Label, Other | same | ✅ |
| Lead Source | LEAD-02 (11 values) | 11 values | "B2B marketplace (IndiaMART)" → "B2B Marketplaces (IndiaMART)" |
| Referrer | LEAD-02: customer / service engineer / employee / dealer | same | ✅ |
| Lost / Disqualification Reason | LEAD-11: no budget, bought competitor, not reachable, duplicate, not relevant | same + ➕ Price too high, ➕ Purchase postponed, ➕ Other | "Bought from competitor" → **Bought Competitor**; extras are allowed ("etc.") |
| Activity / follow-up type | LEAD-09: calls, emails, WhatsApp messages, meetings | Call, Email, WhatsApp, Meeting + ➕ Visit, ➕ Demo, ➕ Note | keep extras? (ATT-05 visits and OPP-04 demos appear on the timeline) |
| Role in Buying Decision | CUS-03: decision maker / influencer / user / finance | same | ✅ |
| Field Visit Purpose | ATT-05: prospecting, follow-up, demo, service, collection | same | ✅ |
| Opportunity type | OPP-01: additional machine, upgrade, consumables contract, AMC | New machine, Upgrade / additional machine, Consumables contract, AMC / CMC, AMC renewal | ✏️ "Additional Machine", "Upgrade" as two values |
| Calendar event type | OPP-08: meetings, demos, follow-ups (+ ATT-05 visits, SRV-11 PM) | Meeting, Demo, Customer visit, Call / follow-up, Service / installation, Internal / training | ✏️ **Meeting, Demo, Follow-up, Field Visit, Service Visit, Internal** (C-15) |
| Division | §1.2: Textile, Ink, Commercial – POD, Commercial – Label, Paper, Fabric | same | ✅ |
| Approval levels | QUO-06: Sales Manager/RM → GM/VP → MD | Level 1 / 2 / 3 | ✏️ show "Sales Manager", "Division Head", "Management (MD)" |
| SLA escalation | SRV-09: Service Manager → Service Head → GM → MD | Escalation level 1–4 | ✏️ show the role names |

---

## 4. Roles

| # | BRD role (Appendix B) | Positions (§2.1) | App today | |
|---|---|---|---|---|
| 1 | System Administrator | CRM admin (IT/MIS) | System administrator | casing |
| 2 | Management | MD, Chairman, CFO & Director, EA to MD | Management | ✅ |
| 3 | Division Head | GM Sales – Textile, GM – Ink, VP – Commercial, Head – Paper | Division head | casing |
| 4 | Sales Manager | RSM / NSM / Sales Managers | Sales manager | casing |
| 5 | Sales Executive | Ink, Paper, Fabric sales teams | Sales executive | casing |
| 6 | Service Leadership | Service Head, NSM, Service Managers | Service leadership | casing |
| 7 | Service Engineer | Textile, POD, Label engineers | Service engineer | casing |
| 8 | Coordinator | Service / sales / Fabric coordinators | Coordinator | ✅ |
| 9 | Import / SCM | Import Head, SCM Executives | Import / SCM | ✅ |
| 10 | Store In-charge | Store In-charge | Store in-charge | casing |
| 11 | Accounts | Accounts | Accounts | ✅ |
| 12 | — (§2.1 lists "Profiling Manager" under Support functions; Appendix B has no row) | Profiling Manager | Profiling | ❓ G-B7 |

The role switcher shows "Role — Position", for example "Division Head — GM Sales – Textile".

---

## 5. Actions and buttons

| BRD name | BRD ref | App today | |
|---|---|---|---|
| Convert to Lead | §3.1, CUS-05 (quoted) | Convert action on a pool contact (toast "Converted to a lead") | ✏️ exact label |
| Qualify → Convert to Opportunity | LEAD-10 "converted to an Opportunity" | Qualify | ✏️ "Convert to Opportunity" |
| Disqualify | LEAD-11 | Disqualify | ✅ |
| Nurture | LEAD-11 'Nurture' | Nurture | ✅ |
| Log Follow-up | LEAD-09 "log calls…", "add a follow-up" (§2.2) | Log follow-up / Log activity | ✏️ one name: **Log Follow-up** on leads and opportunities, **Log Activity** elsewhere |
| Mark Won / Mark Lost | OPP-05 "Marking an opportunity Won / Lost" | Mark won / Mark lost | casing |
| Book Demo | OPP-04 "book a demo" | Book demo | casing |
| Request Sample Print | OPP-04 | Request sample | ✏️ |
| Submit for Approval / Approve / Reject | QUO-06 | Submit for approval / Approve / Reject | casing |
| Send Quotation | QUO-08 "send by email/WhatsApp" | Send / Send again | ✏️ |
| Create Revision | QUO-09 "versions (R0, R1, …)" | Revise (new revision)… | ✏️ |
| Compare Versions | QUO-09 | Compare revisions | ✏️ |
| Mark Accepted (upload PO) | QUO-11 | Accept | ✏️ |
| Generate Sales Order | §3.1, SO-01 (quoted) | Generate sales order | casing |
| Generate Sales Contract | §3.1, SO-05 (quoted) | Generate sales contract | casing |
| Push to ERP | SO-09 "pushed to ERP" | ERP sync | ✏️ |
| Hold Order / Cancel Order | SO-10 "Order hold/cancellation" | hold action / Cancel order | ✏️ "Hold Order" |
| Repeat Order | CON-02 "Quick repeat order" | Repeat order | casing |
| Record Dispatch | INS-01 | (dispatch form) | ✏️ |
| Confirm Delivery | INS-02 "delivery confirmation" | Confirm delivery | casing |
| Verify Site Readiness | INS-03 | Verify site readiness | casing |
| Customer Sign-off | INS-06 "customer sign-off by OTP or digital signature" | Sign-off / Send code to customer | ✏️ |
| Create Renewal Quotation | IB-05 "renewal quotation generated from the CRM" | (renewal opportunity action) | ✏️ |
| Log Ticket | SRV-01 "Ticket logging" (IB-03 also says "raised") | Log ticket / New ticket | ✏️ one name: **Log Ticket** (C-07) |
| Assign Engineer | SRV-05 | Mark assigned / Assign automatically | ✏️ "Assign Engineer", "Suggest Engineer" |
| Accept Job | SRV-06 "accept job" | Accept job | casing |
| Start Travel | SRV-06 | (start travel) | casing |
| Check-in / Check-out | SRV-06, ATT-01 | Check in / Check out | ✏️ hyphen per BRD |
| Convert to Site Visit | SRV-07 | (convert action) | ✏️ |
| Opportunity Spotted | §3.1, SRV-14 (quoted 'Opportunity spotted') | Opportunity spotted… | casing |
| Re-open | SRV-15, Appendix A "Re-opened" | Re-open / Reopen (both are used) | ✏️ one spelling: **Re-open** |
| Raise Requisition | SPR-03 "requisition raised from a ticket" | Request part | ✏️ |
| Issue / Acknowledge Receipt | SPR-03 "issue by the Store In-charge… receipt acknowledgement" | Issue / Acknowledge receipt | casing |
| Request Regularisation | ATT-04 | Regularise | ✏️ |
| Apply for Leave | ATT-09 "Leave application" | New (on the Leave list) | ✏️ |
| Merge | CUS-06 "merge function" | Merge | ✅ |
| Transfer Ownership | CUS-10 | Transfer | ✏️ |

Generic buttons (New, Edit, Delete, Save, Cancel, Export, Import) keep their current names. The BRD uses the same words.

---

## 6. Conflicts — one thing, several names in the BRD

| # | Variants in the BRD (with refs) | Recommended single term | Reason |
|---|---|---|---|
| C-01 | Casing: "Sales order" (Appendix A) vs "Sales Order" (SO-01, 'Generate Sales Order'); "In Progress" vs "in progress" | **Title Case** for names, buttons and statuses; sentence case for field labels and messages | Quoted buttons and status flows are Title Case |
| C-02 | Customer · Company (CUS-01) · Account (CUS-01 "account owner", CUS-10, §8) · Prospect (CUS-04) | **Company** for the master record (list "Companies"), per CUS-01 "Company (account) record" — owner decision 19-10-2026. Its detail page keeps the BRD title **Customer 360° View** (CUS-07); "Customer" stays where the BRD uses it for the buyer on a transaction (QUO-01, SO-01, SRV-02) and in Customer Category values (CUS-04). "Account Owner" and "Key Account" stay as field names | CUS-01 (record), CUS-07 (360° view) |
| C-03 | Contact · Contact person (CUS-03, LEAD-01, QUO-01) | **Contact** (record); **Contact Person** (field on other records) | — |
| C-04 | Opportunity · Deal (§8 "deals", TGT-04 "Deal of the Month") | **Opportunity**; "Deal of the Month" stays as the name of the award | Appendix A |
| C-05 | Quotation · Quote (QUO-14 "quote-to-order") · Proposal (OPP-02 stage, §3.2) | **Quotation**; the stage stays "Proposal/Quotation" | Appendix A |
| C-06 | Version (QUO-09 "versions (R0, R1, …)", SO-05) · Revision (QUO-09 "Revision control") | **Version** (R0, R1 …) | QUO-09 names the items "versions" |
| C-07 | Service ticket · Ticket · Complaint (§1.3, SRV-02, SRV-13) · Job (SRV-06 "accept job", job card) | **Service Ticket** (record); "Complaint" only in Complaint Description / Category; "Job" only on the engineer's My Jobs screen and in "Job Card" | Appendix A; SRV-02 uses complaint for the problem, not the record |
| C-08 | Product type / sub-type (LEAD-06, ADM-03) · Product category / sub-category (LEAD-14, OPP-03, OPP-07, TGT-01, Appendix C) | **Product Type / Sub-type** | LEAD-06 defines the field and its values; the reports group by the same field |
| C-09 | Spares requisition (Appendix A) · Part requisition (SPR-03) | **Spares Requisition** | Appendix A record name |
| C-10 | Territory / hub (CUS-01, LEAD-07, ADM-03) · Hub (OPP-03) · Region (§2.1 "service region", RSM) | **Territory / Hub** | Most frequent; ADM-03 master name |
| C-11 | "Payment Pending/Received" is one stage in Appendix A, but it describes two states | Two values: **Payment Pending**, **Payment Received** | A status needs one meaning; the list still shows them as one stage group |
| C-12 | Dispatch = shipping a machine (INS-01) · the app's "Dispatch board" = assigning engineers (SRV-05 "engineer calendar and map view") | **Dispatch** only for shipments; the engineer board becomes **Engineer Calendar & Map** | Avoids two meanings of Dispatch |
| C-13 | Preventive maintenance · PM · Preventive visits (IB-04, Appendix C) | **Preventive Maintenance (PM)** on first use; **PM Visit**, **PM Schedule** | Appendix D defines PM |
| C-14 | User (§2.1, ADM-08 "User lifecycle", CUS-10) · Employee (LEAD-02 referrer, LEAD-07 "employee list", §8) | **User** for people with a CRM login (Administration › Users); **Employee** only as a Referrer value | ADM-08 owns the screen |
| C-15 | Calendar items: meetings, demos, follow-ups (OPP-08) · visits (ATT-05) · PM/service (SRV-11) | **Meeting, Demo, Follow-up, Field Visit, Service Visit, Internal** | BRD words; "Customer visit" becomes Field Visit, "Service / installation" becomes Service Visit |
| C-16 | AMC (IB-04 "AMC – labour only") · AMC/CMC (IB-04, IB-05) · AMC contract (Appendix A) · AMC = the vendor's support contract (§10) | **AMC / CMC Contract** for the customer contract | §10 is not app content |
| C-17 | Engineer · Service engineer · Field engineer | **Service Engineer** (role and field label) | §2.1, Appendix B |
| C-18 | Dashboard · Dashboards (4.13) · "Not attended leads dashboard" (LEAD-08) · "Exception dashboard" (ATT-10) · "target vs actual dashboards" (TGT-02) | **Dashboard** is the home page; the other three are pages named exactly as in the BRD | — |
| C-19 | Role names differ in §2.1 ("Division heads", "Support functions"), COM-01 ("Sales", "Service", "Store") and Appendix B | **Appendix B names** + System Administrator | See §4 |
| C-20 | Site (CUS-02 "installation sites", IB-01 "installation site") · Address (CUS-02 "Multiple addresses") | **Site** with type Billing / Shipping / Installation | Sites are geo-tagged and used for routing, so they are more than an address |

---

## 7. Gaps

### 7.A In the BRD but missing in the app (to build in Step 2)

| # | BRD page / sub-page | BRD ref | What exists today | To build |
|---|---|---|---|---|
| G-A1 | Engineer Stock | 4.9 title "Spare Parts & Engineer Stock" | nothing. Parts issued to an engineer are not tracked until consumed | Page per engineer: issued, received, consumed, in hand, defective to return; built from requisitions |
| G-A2 | Contact Pool (own page) | CUS-05 | a saved view inside Contacts | Own sidebar page with phone book / Excel / card-scan / manual add and 'Convert to Lead' |
| G-A3 | Demo Machine Calendar | OPP-04 | Demo machines list only | Calendar of demo machines with their demo bookings (re-uses the calendar) |
| G-A4 | Not Attended Leads dashboard | LEAD-08 | a saved view | Own page with SLA age, owner, escalated-to |
| G-A5 | Customer 360° tabs: Payment Status, Feedback; separate Leads / Opportunities / Quotations / Sales Orders / Warranty & AMC tabs | CUS-07 | combined "Sales" and "Machines" tabs, no Feedback tab | Split tabs and add the two missing ones |
| G-A6 | Dealer / Distributor Orders & Secondary Sales | CON-06 (Could) | Deferred (Q-24, no data source) | Build with mock dealer sales? (D-6) |
| G-A7 | Order Processing (SCM) page | SO-08 | saved view + tab on the order | Own page for Import/SCM: PO to principal, ETA, customs, readiness, PDI |
| G-A8 | Pending Approvals (Quotations) | QUO-06, QUO-14 | Work inbox + saved view | Own page under Quotations |
| G-A9 | Repeat Orders | CON-02 | 'Repeat order' button on old orders | Page listing previous consumables orders with one-tap repeat |
| G-A10 | Main Store Stock | SPR-02 | stock column on Spare Parts | Own page: stock, minimum level, in transit |
| G-A11 | Route Map in sidebar | ATT-07 | page exists but is reached only from Team Attendance | Sidebar entry with a person picker |
| G-A12 | Masters / Custom Fields & Form Layouts / Workflows & Approval Matrices / SLA Matrix as separate pages | ADM-03, 04, 05, SRV-09 | combined in Configuration studio and Business policies | Split into four pages (same functionality) |
| G-A13 | First-login walkthrough per role, video tutorials | COM-12 | Deferred in REQUIREMENTS (FR-140 Partial) | Build the walkthrough; video tutorials stay Deferred |
| G-A14 | Editable Roles & Permissions | ADM-02 | read-only matrix (FR-120 Partial) | Make the matrix editable |
| G-A15 | Per-division form layouts | ADM-05 | custom fields only (FR-123 Partial) | Division-specific section order and visibility |

### 7.B In the app but not named in the BRD — your decision: keep, rename or remove

| # | App page | What it does | Recommendation |
|---|---|---|---|
| G-B1 | **Products** module (Products, Price lists, Price list items) | Product & price master used by quotations | **Keep, rename and move** to Administration › Masters as "Product & Price Master" (QUO-02, ADM-03). Price Lists stay visible to the roles that QUO-05 lets maintain them |
| G-B2 | **Work inbox** | Notifications, approvals and my tasks in one place | **Keep, rename** to "Notifications & Approvals" (COM-03, QUO-06, SO-04) |
| G-B3 | **Event trace** (Admin) | Developer log of automatic hand-offs | **Remove from the sidebar**, or merge into Audit Trail as a filter. Not a BRD screen |
| G-B4 | **Message outbox** (Admin) | Shows the simulated email / WhatsApp / SMS that were "sent" | **Keep** (needed for the demo; it proves COM-03, QUO-08 and SRV-12 work). Rename "Sent Messages (Simulated)" |
| G-B5 | **Settings** (Admin) | Simulated clock, offline toggle, reset demo data, theme | **Keep** (CLAUDE.md requires Reset demo data). Rename "Demo Settings" |
| G-B6 | Extra status / list values marked ➕ in §3 | e.g. Superseded, Pending Approval (SO), Rejected (requisition), Absent, Software (RIP) | **Keep** the ones a BRD rule needs (listed with their reasons in §3). Each one is a single yes/no in your reply |
| G-B7 | **Profiling** role | Profiling Manager handles sample print requests (OPP-04) | **Keep** as "Profiling Manager". It is a §2.1 position, but it has no Appendix B row |
| G-B8 | Saved views ("Closing in 7 days", "By owner", "Board", …) | List shortcuts | **Keep** (COM-06 "saved filters"); names are not BRD terms, so they are not renamed |
| G-B9 | **Business policies** page | SLA targets, approval thresholds, reminder days, geofence, limits | **Split** into Workflows & Approval Matrices + SLA Matrix (G-A12); the rest becomes "Configurable Rules" |

---

## 8. Decisions needed before Step 2

1. **D-1 Casing:** Title Case for names, buttons and statuses (C-01)? The template uses sentence case today, so the whole UI will look more formal.
2. **D-2 Sidebar:** one sidebar module per BRD §4 module, 15 groups instead of 12 (§1.1)?
3. **D-3 Calendar:** keep it under Dashboard as "Tasks & Calendar"? The alternative is under Opportunities & Pipeline, where OPP-08 sits.
4. **D-4 Product type vs category** (C-08): "Product Type / Sub-type" everywhere, reports included?
5. **D-5 Referrals:** report only, or its own page under Leads?
6. **D-6 Dealer / Distributor Orders** (CON-06, Could): build with mock data, or stay Deferred?
7. **D-7 G-B1 … G-B9:** accept the recommendations, or say keep / rename / remove per item.
8. **D-8 Labels file:** you asked for `src/constants/labels.js`. The project is TypeScript, so I propose **`src/constants/labels.ts`** (same idea, with type checking for misspelt keys).
9. **D-9 Lint:** the project has no lint script today. Step 4 needs one. I propose adding ESLint with the standard React + TypeScript rules as a dev-only tool. CLAUDE.md asks before new libraries, so please confirm.
10. **D-10 Old routes:** redirect every old route to its new one, so bookmarks and stored saved views keep working?
