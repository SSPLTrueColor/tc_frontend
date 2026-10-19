---
title: "True Colors Limited – Custom CRM for Sales & Service"
document_type: "Request for Quotation (RFQ) and Functional Requirements Specification"
date: "2026-10-08"
prepared_by: "True Colors Limited – Sales & Service Excellence"
issued_to: "Shortlisted software development partners"
contact: "Jay Desai – 9920074006"
classification: "Confidential – for quotation purposes only. Not to be shared beyond the bidding team."
priority_legend:
  Must: "Essential for go-live; non-compliance = proposal rejected"
  Should: "Important; expected, may be delivered in a later phase"
  Could: "Desirable; quote separately as optional item"
---

# True Colors Limited — Custom CRM for Sales & Service

**Request for Quotation and Functional Requirements Specification**

## Document Details

| Field | Value |
|---|---|
| Document | CRM Requirements for Vendor Quotation (RFQ) |
| Date | 8th October 2026 |
| Prepared by | True Colors Limited – Sales & Service Excellence |
| Issued to | Shortlisted software development partners |
| Contact for queries | Jay Desai 9920074006 |
| Classification | Confidential – for quotation purposes only. Not to be shared beyond the bidding team. |

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Organisation and Users](#2-organisation-and-users)
3. [End-to-End Process Overview](#3-end-to-end-process-overview)
4. [Functional Requirements](#4-functional-requirements)
5. [Common Requirements (All Modules)](#5-common-requirements-all-modules)
6. [Integration Requirements](#6-integration-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Data Migration](#8-data-migration)
9. [Implementation Approach, Phasing and Training](#9-implementation-approach-phasing-and-training)
10. [Support, Warranty and Maintenance](#10-support-warranty-and-maintenance)
11. [Vendor Deliverables](#11-vendor-deliverables)
12. [Proposal Submission Guidelines](#12-proposal-submission-guidelines)
13. [Points to be Confirmed During the Requirement Study](#13-points-to-be-confirmed-during-the-requirement-study)
- [Appendix A – Status Workflows](#appendix-a--status-workflows)
- [Appendix B – Indicative Role Access Matrix](#appendix-b--indicative-role-access-matrix)
- [Appendix C – Key Performance Indicators](#appendix-c--key-performance-indicators)
- [Appendix D – Glossary](#appendix-d--glossary)

---

## 1. Introduction

### 1.1 Purpose of this document

True Colors Limited invites quotations for the design, development, deployment and support of a custom-built Customer Relationship Management (CRM) system covering its sales and service functions. This document describes the business context, functional and technical requirements, and the format in which vendors should respond, so that all proposals can be compared on a like-for-like basis.

Vendors are expected to study the requirements, propose the best solution approach, and highlight any requirement that they recommend handling differently. Industry best practices have been included where relevant; vendors may suggest further improvements.

### 1.2 About True Colors Limited

True Colors Limited supplies digital printing machines, inks, papers and fabrics to the Indian market, supported by its own national service network. The business currently operates through the following divisions:

| Division | What it sells | Nature of business |
|---|---|---|
| Textile | Digital textile printing machines (sublimation and direct-to-fabric), RIP software, installation, service and spares | Capital equipment with long sales cycle, installation and multi-year service |
| Ink | Inks for installed machines and the wider market | Consumables – Machine to ink ratio, per machine consumption on installed base and open market |
| Commercial – POD | Print-on-demand printing machines | Capital equipment plus service |
| Commercial – Label | Label printing machines | Capital equipment plus service |
| Paper | Printing papers | Consumables – repeat orders; own sales, sales, accounts and SCM teams |
| Fabric | Digital printing and processing on fabrics | Fabric design to printing and processing and supply |

### 1.3 Business objectives

- **One customer and machine record:** a single database shared by every module, so that any user can see the complete history of a customer and each machine.
- **Faster lead-to-order:** no lead left unattended, disciplined follow-up, controlled quotations and approvals, and a reliable pipeline forecast.
- **Service excellence:** every complaint logged, tracked against SLA and closed with customer confirmation; preventive maintenance and AMC renewals never missed. Service is the company's main differentiator.
- **Growth from the installed base:** systematic AMC renewals, consumables cross-sell and referrals from customers and service engineers.
- **Management visibility and decision making:** real-time dashboards for management, division heads and managers, with no manual reports.
- **High adoption:** a simple, mobile-first system that an experienced field team will actually use.

### 1.4 Scope

**In scope**
- Customer and contact master, contact pool
- Leads, opportunities, quotations, sales orders, sales contracts
- Dispatch, delivery, installation and commissioning tracking
- Installed base, warranty, AMC/CMC, service tickets, preventive maintenance, spares requisition
- Consumables repeat business, targets and recognition
- Field attendance, visits and expenses; web and mobile apps; dashboards; integrations; data migration from Zoho CRM

**Out of scope (integrate only)**
- Financial accounting, invoicing and GST returns (remain in ERP)
- Inventory valuation and purchase accounting (remain in ERP)
- Payroll and full HR management
- Website and digital marketing campaign management (run by agency; leads flow in via API)
- Manufacturing / production planning

### 1.5 How to read the requirements

Each requirement carries a unique ID (e.g. `LEAD-07`) for reference in the vendor's compliance matrix, and a priority:

- **Must** – essential for go-live; a proposal that cannot meet it will be considered non-compliant.
- **Should** – important; expected in the solution, may be delivered in a later phase.
- **Could** – desirable; vendors should quote separately as optional items.

Where a requirement says **'configurable'**, the True Colors Limited administrator must be able to change it from the admin screens **without code changes or a developer release**.

---

## 2. Organisation and Users

### 2.1 User roles and indicative user count

The CRM must follow the company's reporting structure: users see their own records, managers see their team's records, division heads see their division, and management sees everything. Roles below are mapped to the current organisation structure.

| Role | Positions (current structure) | Indicative users | Primary access |
|---|---|---|---|
| Management | Managing Director, Chairman, CFO & Director, Executive Assistant to MD | 10 | Web + mobile dashboards, approvals |
| Division heads | GM Sales – Textile, GM – Ink, VP – Commercial, Head – Paper Division | 6 | Web + mobile |
| Sales managers | Regional / National Sales Managers and Sales Managers (Textile, POD, Label), incl. vacancies | 20 | Mobile-first + web |
| Sales executives | Ink, Paper and Fabric sales teams | 20 (TBC) | Mobile-first |
| Service leadership | Service Head, National Service Manager, Service Managers | 4 | Web + mobile |
| Service engineers | Textile (55) plus POD and Label engineers | 100 (TBC) | Mobile app (offline) |
| Coordinators | Service/sales coordinators, Fabric coordinators team | 25 (TBC) | Web |
| Support functions | Profiling Manager, Import Head, SCM Executives, Store In-charge, Accounts | 10 | Web |
| System administrator | CRM admin (IT/MIS) | 1–2 | Web |
| **Total** | | **≈ 150–250** | **Design for 250 users** |

> **Commercials should not bear any binding with the number of users.**

### 2.2 Adoption-first approach

Most of the sales team is 30–50: highly experienced, but stretched by long years in the field and unlikely to adopt tools that add work. After trying multiple CRMs including reputed ones, we have experienced that any system should be easy to use for the team members of all age groups and avoid lengthy procedure and exhaustive entry fields. The solution must therefore follow these design rules:

- Every frequent action (log a visit, add a follow-up, check in, update a ticket) completed in **three taps or fewer** on mobile.
- Minimum mandatory fields; information captured once and reused (contact → lead → opportunity → quotation → order → installed base).
- Voice-to-text for notes and remarks; large, readable fonts; clear icons; English interface with Hindi as an option for the engineer app.
- Data entered by the user should come back to them as value: today's plan, reminders, customer history, their own scorecard.
- Accountability built into the system (overdue lists, SLA alerts, adoption reports) instead of separate manual reports.
- Offline capability for attendance, visits and job cards in low-network areas.

---

## 3. End-to-End Process Overview

All modules must be interconnected through a single customer and machine database. A record created in one stage must carry forward automatically to the next, **without re-entry**.

**Sales cycle:**
```
Contact pool → Lead → Opportunity → Quotation → Sales order → Sales contract
```

**Fulfilment and service cycle:**
```
Dispatch & delivery → Installation & commissioning → Warranty → AMC / CMC → Service tickets & PM → Customer feedback
```

Feedback, referrals, renewals and consumables reorders feed back into new leads and opportunities.

### 3.1 Key automatic hand-offs

| Trigger | System action |
|---|---|
| Contact → 'Convert to Lead' | Lead created with contact and company data |
| Lead qualified | Opportunity created with all lead data, activities and documents |
| Quotation accepted / opportunity Won | 'Generate Sales Order' enabled; SO pre-filled from quotation |
| Sales order approved | 'Generate Sales Contract' enabled; SO pushed to ERP for invoicing |
| Machine delivered | Installation job created; Sales-to-Service handover form issued |
| Installation signed off | Installed-base record created; warranty starts; PM schedule generated |
| Warranty / AMC nearing expiry | Renewal reminders and renewal opportunity created for sales and service owners |
| Ticket closed | Job card sent; feedback link sent; low rating escalated |
| Engineer marks 'Opportunity spotted' | Lead created with engineer as referrer |

### 3.2 Sales process alignment

The lead and opportunity stages in this document map to the company's **eight-stage sales process**:

1. Prospecting (contact pool)
2. Qualification (lead)
3. Needs Assessment
4. Demo
5. Proposal (quotation)
6. Negotiation
7. Closing (sales order and contract)
8. Onboarding (installation hand-off)

---

## 4. Functional Requirements

Requirements are grouped by module. Each module lists its purpose, requirements with IDs and priorities, and status flows where applicable. Standard reports for each module are listed within the module; dashboards are covered in section 4.13.

### 4.1 Customer & Contact Master

**Purpose:** Maintain one centralised record for every customer, prospect, dealer and distributor across all divisions, with their contacts, sites and complete history.

| ID | Requirement | Priority |
|---|---|---|
| CUS-01 | Company (account) record with company name, legal name, GSTIN (format validation), PAN, industry/segment, customer category, website, division(s) served, territory/hub and account owner. | Must |
| CUS-02 | Multiple addresses per company – billing, shipping and installation sites – each site geo-tagged for field visits and engineer routing. | Must |
| CUS-03 | Multiple contact persons per company: name, designation, department, mobile, WhatsApp number, email, role in buying decision (decision maker / influencer / user / finance) and communication consent. | Must |
| CUS-04 | Customer classification (configurable): Prospect, Active Customer, Existing/Inactive Customer, Dealer, Distributor; plus segment tags such as Fashion Brand/Boutique, Job-work/Print Bureau, Trader, Mill/Processing House. | Must |
| CUS-05 | Contact pool: add contacts from the phone book (mobile app), Excel/CSV upload, visiting-card scan (OCR) or manual entry. Use the pool to prospect, plan calls and meetings before a lead exists; a 'Convert to Lead' action creates a lead for that contact. | Must |
| CUS-06 | Duplicate detection on GSTIN, mobile, email and company name (fuzzy match) at creation and import; merge function for administrators with full audit. | Must |
| CUS-07 | Customer 360° view on one screen: leads, opportunities, quotations, orders, payment status (from ERP), installed machines, warranty/AMC, service tickets, feedback and all activities on a single timeline. | Must |
| CUS-08 | Parent–child (group company) linkage and dealer/distributor-to-end-customer linkage. | Should |
| CUS-09 | Credit limit, outstanding and overdue amounts displayed read-only, synced from ERP. | Should |
| CUS-10 | Bulk transfer of account ownership (accounts, open leads, opportunities and tasks) when a user leaves or territories change, with history retained. | Must |
| CUS-11 | Key Account flag with a one-page account plan (objectives, key contacts, open opportunities, risks, next review date). | Should |
| CUS-12 | Reports: customer-wise sales, machine history, warranty expiry, AMC renewals due, dormant customers (no order or contact in a configurable period). | Must |

### 4.2 Lead Management

**Purpose:** Capture, de-duplicate, assign, follow up and qualify potential customers from every source, and measure lead conversion month-wise, salesperson-wise and product category/sub-category-wise.

| ID | Requirement | Priority |
|---|---|---|
| LEAD-01 | Lead registration from an existing contact or a new contact. If the company/contact does not exist, the salesperson can create it inline and continue without leaving the screen. Auto-generated Lead ID; fields include company, multiple contact persons, mobile, email, city, state, industry, segment, division and product interest. | Must |
| LEAD-02 | Configurable lead source master: Website, Exhibition/Trade show (with event name), Referral (customer / service engineer / employee / dealer), Dealer, Social media, Meta lead ads, Google Ads, B2B marketplaces (e.g. IndiaMART), Cold call / field prospecting, Walk-in / demo centre, Digital agency campaign. Source, campaign and referrer are captured on every lead. | Must |
| LEAD-03 | Automatic lead capture through APIs/webhooks from website forms, Meta lead ads and Google Ads, with instant creation, duplicate check and auto-assignment. | Must |
| LEAD-04 | Lead capture from B2B marketplaces (IndiaMART) through their lead APIs. | Should |
| LEAD-05 | Bulk import of exhibition leads from Excel, and on-the-spot capture at the stall by visiting-card scan in the mobile app. | Should |
| LEAD-06 | Product requirement capture: product type (Machine / Ink / Paper / Fabric / Spares / Service), sub-type (Textile / POD / Label / Other) and dynamic specification fields per sub-type. Textile: printing width, print-head configuration, fabric type, production capacity. Fields for other sub-types to be finalised during the requirement study. | Must |
| LEAD-07 | Assignment: manual assignment from a division-filtered employee list, and rule-based auto-assignment by division, product and territory/hub (with round-robin inside a team). Lead owner–assignee relationship follows the reporting hierarchy so managers see their team's leads. | Must |
| LEAD-08 | Speed-to-lead: configurable first-contact SLA (e.g. 24 hours). Untouched leads are escalated to the reporting manager and listed on a 'Not attended leads' dashboard. | Must |
| LEAD-09 | Follow-up management: log calls, emails, WhatsApp messages and meetings; next follow-up date mandatory on every update; automatic reminders (app push, email, WhatsApp); overdue follow-up list and notifications. | Must |
| LEAD-10 | Qualification (BANT-lite): customer requirement, budget, decision maker, purchase timeline, current set-up/competitor machine. A qualified lead is converted to an Opportunity carrying all data and history. | Must |
| LEAD-11 | Mandatory reason for disqualification/loss from a master list (no budget, bought competitor, not reachable, duplicate, not relevant, etc.). 'Nurture' status with a future re-contact date for leads that are not ready yet. | Must |
| LEAD-12 | Referral tracking: referrer recorded on the lead; referrer (customer or engineer) notified on conversion; referral report to support recognition schemes. | Should |
| LEAD-13 | Rule-based lead scoring (source, segment, budget, timeline, engagement) to help prioritise follow-up. | Could |
| LEAD-14 | Reports: conversion % month-wise, salesperson-wise, product category/sub-category-wise, source-wise and campaign-wise; lead ageing; first-response time; pending follow-ups; lost/disqualified leads with reasons; sales executive performance. | Must |

**Lead status:** `New → Contacted → Qualified (converted to Opportunity) | Nurture | Disqualified`

### 4.3 Opportunity & Pipeline Management

**Purpose:** Manage qualified deals through defined stages to closure, with a reliable pipeline and forecast. *(Best practice: keep unqualified leads and qualified opportunities as separate records so that pipeline value and conversion figures are accurate.)*

| ID | Requirement | Priority |
|---|---|---|
| OPP-01 | Opportunity created on lead qualification, or directly for existing customers (additional machine, upgrade, consumables contract, AMC). Fields: products, value, expected close date, stage, probability, competitors, owner, decision makers. | Must |
| OPP-02 | Configurable stages with entry/exit criteria. Default: Needs Assessment → Demo/Sample → Proposal/Quotation → Negotiation → Won / Lost. Stage-wise probability drives the weighted forecast. | Must |
| OPP-03 | Pipeline views: Kanban (drag and drop between stages) and list view, filterable by division, owner, stage, hub, product category and close month. | Must |
| OPP-04 | Demo and sample management: book a demo at the demo centre or customer site; demo machine calendar; sample print request to the Profiling team with customer artwork/fabric details; results and customer feedback recorded against the opportunity. | Should |
| OPP-05 | Marking an opportunity Won enables 'Generate Sales Order'. Marking it Lost requires a lost reason and the competitor/price lost to. | Must |
| OPP-06 | Stagnation alerts when an opportunity is not updated for a configurable number of days or is past its expected close date. | Must |
| OPP-07 | Monthly/quarterly sales forecast (weighted and commit) by user, division and product category. | Should |
| OPP-08 | Tasks and calendar for meetings, demos and follow-ups, with two-way sync to Google/Outlook calendars. | Should |

### 4.4 Quotation Management

**Purpose:** Create, approve, share, revise and track commercial quotations using controlled price lists and terms.

| ID | Requirement | Priority |
|---|---|---|
| QUO-01 | Auto quotation number (division-wise series), date, validity, customer, contact person, sales executive and linked opportunity. | Must |
| QUO-02 | Product selection from the product & price master: machine model, configuration (printing width, print heads, specifications), accessories and options. | Must |
| QUO-03 | Additional line items: software (RIP), ink, consumables, spare-parts kit, installation, training, extended warranty, AMC. | Must |
| QUO-04 | Pricing: quantity, list price, discount (% or amount), freight/insurance, GST auto-calculated (CGST+SGST or IGST by place of supply, with HSN/SAC codes), total value and amount in words. | Must |
| QUO-05 | Price lists by division and product with validity dates, maintained only by authorised roles. Sales users cannot edit list prices. | Must |
| QUO-06 | Discount approval workflow: configurable thresholds by division/product and approver level (e.g. Sales Manager/RM → GM/VP → MD). Approve or reject from web, mobile or email link with comments; reminders if pending. | Must |
| QUO-07 | Commercial terms from templates: payment terms, delivery timeline, warranty, installation terms, validity; editable within permissions. | Must |
| QUO-08 | Branded quotation PDF templates per division; attach technical specifications, brochures and other documents; send by email/WhatsApp from the CRM with sent date logged. | Must |
| QUO-09 | Revision control: versions (R0, R1, …), change log, side-by-side comparison of versions; only the latest version is active. | Must |
| QUO-10 | Status: Draft, Pending Approval, Approved, Sent, Under Negotiation, Accepted, Rejected, Expired (automatic when validity ends). | Must |
| QUO-11 | Customer acceptance captured by PO upload or electronic acceptance. | Should |
| QUO-12 | Landed cost / margin visible only to authorised roles (management, finance). | Should |
| QUO-13 | ROI / payback calculator (production capacity, cost per metre/print) that can be attached to the quotation. | Could |
| QUO-14 | Reports: quotation value, pending approvals, quote-to-order conversion, lost quotations with reasons, discount analysis by user/division. | Must |

### 4.5 Sales Order & Sales Contract

**Purpose:** Convert accepted quotations into approved sales orders and contracts, and track payment milestones through to dispatch.

| ID | Requirement | Priority |
|---|---|---|
| SO-01 | 'Generate Sales Order' button available once the opportunity is Won; customer, products, rates and terms are pulled directly from the accepted quotation. | Must |
| SO-02 | Auto order number, customer PO number/date, PO copy upload (mandatory) and linked quotation. | Must |
| SO-03 | Sales order can be customised (product, model, version, price, discount); differences from the quotation are highlighted, and changes beyond a set tolerance re-trigger approval. | Must |
| SO-04 | Approval by the direct reporting manager as per hierarchy, with a finance check on credit/advance terms; multi-level approval matrix configurable. | Must |
| SO-05 | After approval, 'Generate Sales Contract' button: contract with all sales order details plus terms for payment, delivery, loading/unloading, installation, warranty, spare parts, ink purchase commitments and prices, and AMC. Templates per division, versioned, PDF output. | Must |
| SO-06 | Electronic signature of the sales contract by the customer. | Could |
| SO-07 | Payment schedule: advance, milestone payments, balance, due dates; receipts and outstanding synced from ERP; reminders to the salesperson (and optionally the customer) before and after due dates. | Must |
| SO-08 | Order processing status updated by Import/SCM: purchase order to principal, shipment ETA, customs clearance, machine readiness, pre-dispatch inspection. | Must |
| SO-09 | Approved sales order pushed to ERP for invoicing; invoice number/date and e-way bill reference received back. | Must |
| SO-10 | Order hold/cancellation with reasons and approval. | Must |
| SO-11 | Reports: order value, order backlog, pending orders, delayed dispatches, payment status/overdues, sales performance. | Must |

**Order status:** `Confirmed → Payment Pending/Received → Processing → Ready for Dispatch → Dispatched → Delivered → Installation → Completed`

### 4.6 Dispatch, Delivery, Installation & Commissioning

**Purpose:** Hand the customer over smoothly from Sales to Service, and create the installed-base and warranty records automatically.

| ID | Requirement | Priority |
|---|---|---|
| INS-01 | Dispatch details: date, transporter, LR number, delivery challan, invoice reference, e-way bill number; dispatch intimation to the customer by WhatsApp/email. | Must |
| INS-02 | Delivery tracking: expected vs actual delivery date; delivery confirmation with photo and signed proof of delivery. | Must |
| INS-03 | Pre-installation site readiness checklist (power, earthing, UPS, temperature/humidity, space, compressed air, network) shared with the customer and verified by the engineer before installation is scheduled. | Must |
| INS-04 | Sales-to-Service handover form: customer expectations, special commitments made during the sale, key contacts. | Must |
| INS-05 | On delivery, an installation job is created automatically; engineer assignment, schedule and customer notification. | Must |
| INS-06 | Installation/commissioning job card: step checklist, trial printing results, parameters, photos/videos, training given (topics, trainees) and customer sign-off by OTP or digital signature. | Must |
| INS-07 | On sign-off the installed-base record is created with serial number, configuration and installation date; warranty start date set automatically; preventive maintenance schedule generated. | Must |
| INS-08 | Training records and re-training requests per customer. | Should |

### 4.7 Installed Base, Warranty & AMC

**Purpose:** Keep an accurate register of every machine in the field with its warranty and contract status, and turn renewals into a managed revenue stream.

| ID | Requirement | Priority |
|---|---|---|
| IB-01 | Installed-base record: machine model, serial number, configuration (print heads, width), software version, installation site, installation and purchase dates, sales order reference, current owner (supports resale/relocation). | Must |
| IB-02 | Component serial numbers (e.g. print heads) with replacement history. | Should |
| IB-03 | Warranty: type, start/end dates, coverage (parts/labour), exclusions. Warranty status checked automatically when a ticket is raised. | Must |
| IB-04 | AMC/CMC contracts: contract number, type (AMC – labour only / CMC – comprehensive), validity, machines covered, number of preventive visits, SLA terms, value and billing schedule. | Must |
| IB-05 | Renewal management: reminders 90/60/30 days before expiry to service and sales owners; renewal quotation generated from the CRM; renewal pipeline and lost-renewal reasons. | Must |
| IB-06 | Machine usage readings (print counters, ink consumption) recorded during visits, feeding consumables forecasting. | Should |
| IB-07 | Reports: warranty expiry, AMC renewals due/renewed/lost, machines without any contract (upsell list), installed base by model/region. | Must |

### 4.8 Service Ticket Management

**Purpose:** Manage breakdowns, preventive maintenance, remote support and chargeable service with clear SLAs, escalation and customer feedback.

| ID | Requirement | Priority |
|---|---|---|
| SRV-01 | Ticket logging channels: phone (by coordinator), customer WhatsApp, email-to-ticket, customer portal/app and engineer app. Auto ticket number; customer identified by mobile or machine serial number. | Must |
| SRV-02 | Ticket details: customer, machine serial number, complaint date/time and description, category/sub-category (master to be provided from current data), priority, photos/videos; warranty/AMC status shown automatically. | Must |
| SRV-03 | Ticket types: Breakdown, Installation, Preventive Maintenance, Remote Support, Training, Relocation, Chargeable Visit, Spare-part Only. | Must |
| SRV-04 | Priority: Critical (machine down), High, Medium, Low, with SLA targets per priority and contract type (warranty / AMC / CMC / no contract). | Must |
| SRV-05 | Engineer assignment: manual by coordinator/manager, with suggested assignment by territory, machine skill, availability and workload; engineer calendar and map view. | Must |
| SRV-06 | Engineer mobile app: accept job, start travel, geo-tagged site check-in, diagnosis, work performed, parts used, before/after photos and videos, check-out, customer sign-off by OTP/signature. Works offline and syncs when connected. | Must |
| SRV-07 | Remote support records: troubleshooting steps, call duration, remote session reference; convert to site visit if unresolved. | Must |
| SRV-08 | Service job card PDF generated automatically and sent to the customer by email/WhatsApp. | Must |
| SRV-09 | SLA tracking for response, on-site arrival and resolution; SLA clock pauses while 'Waiting for Customer'; escalation matrix (e.g. Service Manager → Service Head → GM → MD) with automatic alerts on breach. | Must |
| SRV-10 | Chargeable service: service quotation for out-of-warranty/non-contract visits and parts, customer approval and billing request to ERP. | Must |
| SRV-11 | Preventive maintenance: auto-generated PM schedule per contract, model-wise checklist, due/overdue lists, completion status. | Must |
| SRV-12 | Customer feedback: automatic WhatsApp/SMS link at closure; 1–5 rating and comments; low ratings alert the Service Manager; customer closure confirmation. | Must |
| SRV-13 | Repeat complaint flag (same machine and category within a configurable period, e.g. 30 days) with root-cause field. | Must |
| SRV-14 | 'Opportunity spotted' action for engineers (upgrade, new machine, consumables, AMC) that creates a lead with the engineer as referrer. | Must |
| SRV-15 | Ticket re-open within a configurable period after closure. | Must |
| SRV-16 | Knowledge base of known issues and solutions searchable by model/error code; engineers can contribute (with approval). | Should |
| SRV-17 | Reports: open tickets and ageing, SLA compliance, mean time to repair (MTTR), first-time fix rate, machine downtime, repeat complaints, mean time between failures by model, PM compliance, engineer productivity, CSAT. | Must |

**Service status:** `Open → Assigned → Accepted → In Progress → Waiting for Parts / Waiting for Customer → Resolved → Customer Confirmation → Closed` *(re-open allowed within a set period)*

### 4.9 Spare Parts & Engineer Stock

**Purpose:** Give service teams visibility and control of spare parts from requisition to consumption and defective return.

| ID | Requirement | Priority |
|---|---|---|
| SPR-01 | Spare parts master: part number, description, compatible models, HSN, price, warranty applicability (synced from ERP if ERP is the stock master). | Must |
| SPR-02 | Stock visibility at the main store. | Must |
| SPR-03 | Part requisition raised from a ticket by the engineer; approval; issue by the Store In-charge with courier/dispatch details; receipt acknowledgement. | Must |
| SPR-04 | Consumption recorded against ticket and machine as warranty or chargeable; defective part return tracking. | Must |
| SPR-05 | Warranty claims to the principal/OEM for failed parts (claim number, status). | Should |
| SPR-06 | Minimum-level alerts for critical parts and visibility of import requirements to the Import/SCM team. | Should |

### 4.10 Consumables & Repeat Business (Ink, Paper, Fabric)

**Purpose:** Support repeat-purchase businesses and protect consumables revenue from the installed base. *(Not covered in the rough draft – added because Ink, Paper and Fabric divisions sell on repeat orders.)*

| ID | Requirement | Priority |
|---|---|---|
| CON-01 | Consumables customers linked to their installed machines where applicable, as well as non-machine customers. This data is currently in two different systems. | Must |
| CON-02 | Quick repeat order from the previous order; customer-specific rate contracts with validity. | Must |
| CON-03 | Leakage list: machine customers not buying the company's ink/paper/consumables, for cross-sell follow-up. | Must |
| CON-04 | Reorder prediction from order frequency or consumption; reminder to the salesperson when a customer is due; 'missed reorder' alert. | Should |
| CON-05 | Sample/trial dispatch tracking for ink, paper and fabric, with trial results and feedback. | Should |
| CON-06 | Dealer/distributor orders and secondary sales visibility. | Could |

### 4.11 Field Force: Attendance, Visits & Expenses

**Purpose:** Track attendance, working hours and field activity of sales and service employees in a simple, privacy-respecting way.

| ID | Requirement | Priority |
|---|---|---|
| ATT-01 | Check-in/check-out with date, time, GPS location and optional selfie; status (present, half-day, leave, on tour). | Must |
| ATT-02 | Geo-fenced attendance for office-based staff; detection of mock/fake GPS locations. | Must |
| ATT-03 | Working hours, late entry and early exit calculated as per shift policy. | Must |
| ATT-04 | Attendance regularisation request with reason and manager approval. | Must |
| ATT-05 | Field visit tracking: customer/site, purpose (prospecting, follow-up, demo, service, collection), geo-tagged check-in/out at site, remarks, next action; visit linked to account, lead, opportunity or ticket. | Must |
| ATT-06 | Weekly visit (beat) plan per user; manager view of planned vs actual visits. | Should |
| ATT-07 | Location tracking only between check-in and check-out, at a configurable interval; route map and distance travelled. | Should |
| ATT-08 | Travel & expense claims: distance-based conveyance from tracked km, bill upload, policy limits, approval, export to accounts/payroll. | Should |
| ATT-09 | Leave application and approval, or integration with HRMS if one exists. | Could |
| ATT-10 | Reports: daily/monthly and employee-wise attendance, field visit reports, exception dashboard (no check-in, late, no visits logged). | Must |

### 4.12 Targets, Performance & Recognition

**Purpose:** Set targets, measure achievement automatically and recognise performance – without adding manual reporting. *(Added to support the sales-team best practices.)*

| ID | Requirement | Priority |
|---|---|---|
| TGT-01 | Targets by user, team, division and product category (monthly/quarterly/annual): order value, quantity, collections, new customers, activities. | Must |
| TGT-02 | Achievement calculated automatically from sales orders and payments; target vs actual dashboards with drill-down. | Must |
| TGT-03 | Weekly activity scorecard per role (calls, visits, demos, quotations, referrals) generated from CRM data. | Must |
| TGT-04 | Leaderboards and recognition (e.g. Deal of the Month, badges) visible within the division. | Should |
| TGT-05 | Incentive calculation rules or export of achievement data for incentive processing. | Could |

### 4.13 Dashboards & Reports

**Purpose:** Give every role the information it needs on one screen, and give management a reliable, real-time view of sales and service.

Developer to propose functional, role-based, module-based and decision-based dashboards. Customizable after initial implementation and based on progressive usage and data generation.

### 4.14 Administration & Configuration

**Purpose:** Allow True Colors' administrator to run and adapt the system without depending on the developer for routine changes.

| ID | Requirement | Priority |
|---|---|---|
| ADM-01 | Organisation hierarchy configurable (divisions, departments, reporting managers); drives record visibility and approvals. | Must |
| ADM-02 | Roles and permissions at module, record (own / team / division / all), field (e.g. cost price) and action (export, delete, approve) level. | Must |
| ADM-03 | Masters: products & price lists, product types/sub-types and specification fields, territories/hubs/states/cities, industries/segments, lead sources, lost reasons, complaint categories, checklists, terms & conditions templates, GST/HSN. | Must |
| ADM-04 | Configurable workflows and approval matrices without code changes. | Must |
| ADM-05 | Custom fields and form layouts per division. | Must |
| ADM-06 | Notification template management for email, WhatsApp, SMS and in-app messages. | Must |
| ADM-07 | Bulk import/export with templates and validation; export restricted by role and logged. | Must |
| ADM-08 | User lifecycle: create, deactivate, and transfer records on exit. | Must |
| ADM-09 | Any other configuration requirement arising after implementation. | Must |
| ADM-10 | Developer end-to-end responsibility for providing support when the self-configuration by the client cannot be performed due to capability issues. | Must |

---

## 5. Common Requirements (All Modules)

| ID | Requirement | Description |
|---|---|---|
| COM-01 | Role-based access | Access by role and hierarchy (Admin, Management, Division Head, Sales, Service, Coordinator, Accounts, Import/SCM, Store); see Appendix B. |
| COM-02 | Centralised database | One customer and machine record shared by all modules; no duplicate masters. |
| COM-03 | Automated notifications | Follow-up reminders, approvals, payment dues, SLA breaches, warranty/AMC expiry – via in-app, push, email and WhatsApp. |
| COM-04 | Document storage | Quotations, POs, contracts, invoices, job cards, photos/videos and technical documents attached to records, with version history and file-size limits. |
| COM-05 | Activity history | Complete customer interaction and transaction timeline on every customer, lead, opportunity and machine. |
| COM-06 | Global search and filters | Search by customer, contact, mobile, GSTIN, machine serial number, quotation/order/ticket ID; saved filters. |
| COM-07 | Mobile apps | Android and iOS apps for sales users, engineers and managers; offline mode for attendance, visits and job cards; camera, GPS and voice-to-text. |
| COM-08 | Data import/export | Excel import/export with templates and validation, restricted to authorised roles and logged. |
| COM-09 | Audit trail | Record creation, changes (old/new values), approvals, exports, logins and deletions logged with user and time. |
| COM-10 | Soft delete | Deleted records go to a recycle bin restorable by the admin; permanent deletion by admin only. |
| COM-11 | Indian formats | INR currency, Indian number format (lakh/crore), DD-MM-YYYY dates, IST time zone, Indian states and GST rules. |
| COM-12 | Help and guidance | In-app help, short video tutorials and tool-tips; first-login walkthrough for each role. |

---

## 6. Integration Requirements

The CRM must be built **API-first**, with documented REST APIs for all major entities, so that further integrations can be added later. Vendors should state their integration approach (real-time API, webhook or scheduled sync) for each item below.

| System | Purpose | Direction | Priority |
|---|---|---|---|
| ERP / accounting (system name to be confirmed) | Customer and item masters, sales order push, invoices, receipts, outstanding, credit limits, spares stock | Two-way | Must |
| Zoho CRM (current) | One-time migration of accounts, contacts, leads, deals and activities | Inbound | Must |
| Website forms, Meta lead ads, Google Ads | Automatic lead capture | Inbound | Must |
| IndiaMART / TradeIndia | Automatic lead capture | Inbound | Should |
| WhatsApp Business API (through an approved provider) | Quotations, reminders, dispatch and ticket updates, feedback links, ticket logging | Two-way | Must |
| Email (Microsoft 365 / Google Workspace – TBC) | Send/receive mail from CRM, email-to-ticket, calendar sync | Two-way | Must |
| Maps (Google Maps or equivalent) | Geo-tagging, routes, distance, map views | Outbound | Must |
| E-signature provider | Sales contracts and customer sign-offs | Two-way | Could |

---

## 7. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Architecture | Web application plus native or cross-platform Android/iOS apps; modular, API-first design; separate development, staging (UAT) and production environments. |
| Hosting | Cloud hosting in an India region (e.g. AWS, Azure or Google Cloud) in an account owned by True Colors; vendor to recommend sizing. On-premise option may be quoted separately. |
| Performance | 95% of screens load within 3 seconds on a 4G connection; reports up to 1 year of data within 10 seconds; supports 150 concurrent users at go-live. |
| Availability | 99.5% monthly uptime, excluding planned maintenance scheduled outside business hours with advance notice. |
| Scalability | Scales to 300 users and at least 5 years of data without redesign. |
| Security | TLS 1.2+ in transit, AES-256 encryption at rest; multi-factor authentication for admin and management roles; password policy and session timeout; role, record and field-level security; protection against OWASP Top 10; third-party vulnerability assessment and penetration test (VAPT) before go-live and annually. |
| Data protection | Compliance with India's Digital Personal Data Protection Act, 2023: notice and consent for employee location tracking and customer communications, purpose limitation, retention rules and handling of correction/erasure requests. |
| Backup & recovery | Automated daily backups retained for 30 days; recovery point objective (RPO) ≤ 24 hours; recovery time objective (RTO) ≤ 8 hours; quarterly restore test. |
| Audit logs | Retained for at least 3 years and not editable by any user. |
| Usability | Adoption-first design rules in section 2.2; consistent screens; works on phones with 5–6 inch screens; accessible colour contrast. |
| Mobile | Android 10+ and iOS 15+; offline sync with conflict handling; battery-efficient location capture only during working hours – or PWA equivalent. |
| Browsers | Latest two versions of Chrome, Edge and Safari. |
| Maintainability | Documented source code in a True Colors-owned repository; version control; automated deployments; release notes for every release. |
| Ownership | Full source code and intellectual property owned by True Colors on payment; no vendor lock-in; complete data export available at any time. |

---

## 8. Data Migration

The vendor is responsible for planning and executing data migration; True Colors will provide data extracts and validate the results.

| Data source | Scope |
|---|---|
| Zoho CRM / Service CRM | Accounts, contacts, leads, deals, activities, notes and attachments |
| Excel / existing registers | Installed base (machine, serial number, site, installation date), warranty and AMC contracts, service history where available |
| ERP | Customer master, product/spares master, price lists, open orders and outstanding |
| Organisation and employee list | Users, roles, reporting hierarchy, territories |

---

## 9. Implementation Approach, Phasing and Training

### 9.1 Suggested phasing

Vendors may propose their own plan, but should indicate how it maps to the phases below.

> **Note:** The source document does not list phase details under this section. Phase 1 / Phase 2 / Phase 3 are referenced in Section 12.2 (commercial proposal).

### 9.2 Delivery approach

- To be provided by the Developer.

### 9.3 Training and change management

- Role-based training in short sessions (60–90 minutes), in English and Hindi.
- Train-the-trainer: one CRM champion per division and per service region.
- Short video tutorials (2–3 minutes each) and one-page quick-reference cards.
- Administrator training for configuration, masters, workflows and reports.
- Adoption review at 30, 60 and 90 days using the CRM adoption report, with fixes for any friction found.

---

## 10. Support, Warranty and Maintenance

**Warranty:** defects found within **6 months of final go-live** must be fixed free of charge. After warranty, vendors should quote an annual maintenance and support contract (AMC) with the following minimum service levels:

| Severity | Example | Response | Resolution / workaround |
|---|---|---|---|
| P1 – Critical | System down or mobile app unusable for all users | To be committed by developer | TBCBD |
| P2 – High | Key function failing (e.g. quotation, tickets) for many users | TBCBD | TBCBD |
| P3 – Medium | Function impaired, workaround available | TBCBD | TBCBD |
| P4 – Low | Cosmetic issue, minor enhancement | TBCBD | TBCBD |

*(TBCBD = To be committed by developer)*

The support contract should include:
- Hosting administration (if managed by the vendor)
- Security patches
- OS/browser compatibility updates
- App-store maintenance for the mobile apps
- Monthly uptime and ticket reports
- A fixed number of enhancement hours per quarter

---

## 11. Vendor Deliverables

1. Detailed SRS, process maps and data model, signed off by True Colors.
2. UI/UX prototype for web and mobile.
3. Working web application and Android/iOS apps published under True Colors' developer accounts.
4. Integrations listed in section 6, with API documentation.
5. Data migration with reconciliation reports.
6. Test cases, test results and VAPT report (with fixes).
7. Complete source code, database scripts and deployment scripts in a True Colors-owned repository.
8. Technical documentation, administrator manual, user manuals and video tutorials.
9. Training as mentioned earlier in section 9.

---

## 12. Proposal Submission Guidelines

### 12.1 Technical proposal

- **Company profile:** years in business, team size, office locations, and relevant experience (CRM or field service systems, preferably for capital equipment or industrial customers).
- **References:** at least three similar projects, with client contact details we may call.
- **Compliance matrix:** for every requirement ID, state *Fully met / Partially met / Customisation / Not feasible*, with remarks (Excel format).
- **Solution:** architecture, technology stack, mobile approach, hosting recommendation, security approach and integration approach.
- **Plan:** phase-wise timeline, team composition with CVs of the project manager and lead developer, governance and reporting.
- **Demo:** a demonstration of a comparable system or reusable components, if available.
- **Assumptions and exclusions:** listed clearly.

### 12.2 Commercial proposal (separate document)

| # | Cost element | Basis |
|---|---|---|
| 1 | Requirement study, SRS and UI/UX prototype | Fixed price |
| 2 | Development – Phase 1, Phase 2, Phase 3 (and per module where possible) | Fixed price per phase |
| 3 | Integrations (each system separately) | Fixed price per integration |
| 4 | Data migration | Fixed price |
| 5 | Training and hypercare | Fixed price |
| 6 | Optional 'Could' items | Fixed price per item |
| 7 | Hosting (if vendor-managed) and third-party costs estimate | Monthly / annual |
| 8 | Annual support and maintenance after warranty | As per vendor |
| 9 | Change requests | Included in development cost |

Prices in **INR, with GST shown separately**; quotation validity of **at least 90 days**. Please propose **milestone-based payment terms**.

---

## 13. Points to be Confirmed During the Requirement Study

The following details will be provided by True Colors during the requirement study. Vendors should state their assumptions for each in the proposal.

| # | Point | Current assumption |
|---|---|---|
| 1 | ERP/accounting system name and its integration options | ERP exposes APIs or supports scheduled file exchange |
| 2 | Final user count by role, including POD and Label service engineers | As in section 2.1 |
| 3 | Complaint category and sub-category master | Provided from current service data |
| 4 | Specification fields for non-textile product sub-types | About 5–10 fields per sub-type |
| 5 | Discount and sales order approval thresholds | Three approval levels; values configurable |
| 6 | Service SLA targets by priority and contract type | Configurable; defaults agreed in SRS |
| 7 | Whether Ink, Paper and Fabric customers also need service tickets | Yes, for technical complaints |
| 8 | Fabric Division's order and coordination process | Similar to consumables flow in 4.10 |
| 9 | Volume of data in Zoho CRM and spreadsheets | Under 50,000 records in total |
| 10 | Hosting preference and email platform | Cloud (India region); platform to be confirmed |
| 11 | Quotation, contract and job card templates and branding | One template per division |
| 12 | Languages for the engineer app | English and Hindi |

---

## Appendix A – Status Workflows

| Record | Status flow |
|---|---|
| Lead | New → Contacted → Qualified (converted to Opportunity) \| Nurture \| Disqualified |
| Opportunity | Needs Assessment → Demo/Sample → Proposal/Quotation → Negotiation → Won \| Lost |
| Quotation | Draft → Pending Approval → Approved → Sent → Under Negotiation → Accepted \| Rejected \| Expired |
| Sales order | Confirmed → Payment Pending/Received → Processing → Ready for Dispatch → Dispatched → Delivered → Installation → Completed (Hold / Cancelled with approval) |
| Installation job | Scheduled → Site Ready → In Progress → Trial & Training → Signed Off |
| AMC contract | Draft → Active → Due for Renewal → Renewed \| Expired \| Lost |
| Service ticket | Open → Assigned → Accepted → In Progress → Waiting for Parts / Customer → Resolved → Customer Confirmation → Closed (Re-opened) |
| Spares requisition | Requested → Approved → Issued/Dispatched → Received → Consumed \| Returned (defective/unused) |

---

## Appendix B – Indicative Role Access Matrix

**Legend:** Own = own records; Team = own and team; Division = whole division; All = company-wide; View = read only; Approve = can approve; — = no access. Final matrix to be agreed during the SRS.

> We will provide at the time of development the following access matrix. *(Cells intentionally blank in source document — to be filled by True Colors.)*

| Role | Leads & Opp. | Quotes | Orders | Service | Base & AMC | Spares | Attend. | Reports |
|---|---|---|---|---|---|---|---|---|
| Management | | | | | | | | |
| Division head | | | | | | | | |
| Sales manager | | | | | | | | |
| Sales executive | | | | | | | | |
| Service leadership | | | | | | | | |
| Service engineer | | | | | | | | |
| Coordinator | | | | | | | | |
| Import / SCM | | | | | | | | |
| Store in-charge | | | | | | | | |
| Accounts | | | | | | | | |

---

## Appendix C – Key Performance Indicators

| KPI | Definition |
|---|---|
| Lead response time | Time from lead creation to first logged contact |
| Lead conversion % | Leads qualified to opportunity ÷ leads created, by month, user, source and product category |
| Win rate | Opportunities won ÷ opportunities closed (won + lost) |
| Pipeline value / weighted forecast | Sum of open opportunity values; sum of value × stage probability |
| Average sales cycle | Days from lead creation to order |
| Quote-to-order % | Quotations converted to sales orders ÷ quotations sent |
| Activity scorecard | Calls, visits, demos, quotations and referrals per user per week |
| Order backlog | Value of confirmed orders not yet delivered/installed |
| Collections and overdues | Payments received vs due; overdue amount and ageing |
| SLA compliance % | Tickets meeting response and resolution SLA ÷ total tickets. True 1-4-8 criteria |
| Mean time to repair (MTTR) | Average time from ticket creation to resolution |
| First-time fix rate | Tickets resolved on the first visit ÷ total site-visit tickets |
| Repeat complaint % | Tickets on the same machine and category within 30 days ÷ total tickets |
| PM compliance % | Preventive visits done on time ÷ visits due |
| AMC renewal % | Contracts renewed ÷ contracts due for renewal |
| Customer satisfaction (CSAT) | Average feedback rating; % of ratings 4 and above |
| Consumables attach rate | Machine customers buying company consumables ÷ total machine customers |
| CRM adoption | Active users, records updated, overdue follow-ups per user |

---

## Appendix D – Glossary

| Term | Meaning |
|---|---|
| AMC | Annual Maintenance Contract – usually covers labour and preventive visits |
| CMC | Comprehensive Maintenance Contract – covers labour and parts |
| BANT | Budget, Authority, Need, Timeline – a lead qualification method |
| CSAT | Customer satisfaction score |
| ERP | Enterprise Resource Planning (accounting, inventory and invoicing system) |
| Installed base | All machines sold and installed at customer sites |
| LR | Lorry receipt issued by the transporter |
| MTTR / MTBF | Mean time to repair / mean time between failures |
| PM | Preventive maintenance |
| POD (division) | Print-on-demand – a business line of the Commercial Division |
| RIP | Raster image processor – printing software sold with machines |
| SLA | Service level agreement – committed response and resolution times |
| SRS | Software requirements specification |
| UAT | User acceptance testing |

---

## Requirement ID Index (for AI agents / compliance matrix)

| Module | ID range | Count |
|---|---|---|
| Customer & Contact Master | CUS-01 – CUS-12 | 12 |
| Lead Management | LEAD-01 – LEAD-14 | 14 |
| Opportunity & Pipeline | OPP-01 – OPP-08 | 8 |
| Quotation Management | QUO-01 – QUO-14 | 14 |
| Sales Order & Contract | SO-01 – SO-11 | 11 |
| Dispatch, Delivery, Installation | INS-01 – INS-08 | 8 |
| Installed Base, Warranty & AMC | IB-01 – IB-07 | 7 |
| Service Ticket Management | SRV-01 – SRV-17 | 17 |
| Spare Parts & Engineer Stock | SPR-01 – SPR-06 | 6 |
| Consumables & Repeat Business | CON-01 – CON-06 | 6 |
| Field Force | ATT-01 – ATT-10 | 10 |
| Targets & Recognition | TGT-01 – TGT-05 | 5 |
| Administration & Configuration | ADM-01 – ADM-10 | 10 |
| Common Requirements | COM-01 – COM-12 | 12 |
| **Total** | | **140** |
