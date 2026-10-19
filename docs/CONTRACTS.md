# Module contracts (True Color CRM prototype)

Modules are built in parallel. This file is the agreement between them: **resource keys, cross-module
field names, status keys and hand-offs**. Field names below are binding — other modules read and write
them. A module may add more fields to its own resources freely. Requirements and rules live in
`docs/REQUIREMENTS.md`; this file only fixes the shared shape.

## 1. File ownership

Each module owns only these files (replace `<m>` with the module id):

| What | File |
|---|---|
| Resource definitions, masters, role permissions, nav | `src/domain/modules/<m>.ts` (exports `<m>Pack: ModulePack`) and optional `src/domain/modules/<m>/*.ts` |
| Hooks, approval types, record actions / banners / tabs | `src/domain/extensions/<m>.ts(x)` and optional `src/domain/extensions/<m>/*` |
| Custom pages and their routes | `src/modules/<m>/**` (`routes.tsx` exports `routes: AppRoute[]`) |
| Async page services | `src/services/api/<m>.ts` |
| Domain services (sync engine-side logic) | `src/services/<m>/**` |
| Demo data | `src/mocks/<m>.ts` (`seed(ctx)`, bump `rev` when the data shape changes) |
| Tests | `src/test/<m>.*.test.ts(x)` |
| Module CSS (only if the template classes are not enough) | `src/modules/<m>/<m>.css`, imported from `routes.tsx`; tokens only |

**Shared files are read-only for module agents**: `src/domain/pack.ts`, `src/domain/masters.ts`,
`src/domain/resources/*`, `src/services/*.ts` (top level), `src/components/**`, `src/pages/**`,
`src/App.tsx`, `src/styles/app.css`, `src/lib/**`, `docs/*.md`. If you need a shared change, put it in
your final report — the integrator applies it.

## 2. Shared building blocks (already available)

- **Resources** → automatic list (`/<key>`), side panel (`?peek=<id>`), record page (`/<key>/<id>`),
  quick create, edit drawer, board/calendar views, filters, saved views, export, audit, comments,
  activity tab. Set `form.fullPage` for documents that need a custom editor and register your own
  route for `/<key>/new` and `/<key>/:recordId/edit` (static module routes win over generic ones).
- **Lifecycle** (`lifecycle.transitions`) drives status buttons; guard and side effects with
  `registerResourceHooks(key, { beforeTransition, afterTransition, beforeCreate, afterCreate, … })`
  (`src/services/resourceHooks.ts`; hooks compose across modules). Values captured with an action go
  through `transitionRecord(actor, key, id, to, version, extra)`.
- **Hand-offs inside a commit**: `insertRecordIn(ctx, key, values)`, `patchRecordIn(ctx, key, id, patch)`
  and `recordsIn(ctx, key)` (`src/services/runtime.ts`) — audited as workflow.
- **Approvals**: levels may name an approver (`{ capability, label, approverStaffId: managerOf(ownerStaffId) }`) so only that person decides; seeds can push to `ctx.approvals`. `registerApprovalType(type, { label, onApproved, onRejected })`,
  `requestApprovalIn(ctx, {...})` / `requestApproval(actor, {...})`, `pendingApprovalFor(recordId, type)`
  (`src/services/workflow.ts`). Decisions happen in `/inbox?tab=approvals`.
- **Policies** (all configurable numbers): `getPolicies()`, `discountApprovalLevels(pct)` (`src/services/policies.ts`).
- **Lookups**: `listPriceFor`, `contractRateFor`, `gstSplit`, `amountInWords`, `coverageFor`,
  `managerOf`, `employeesWithRole`, `divisionHeadsOf`, `userOfStaff`, `staffOfUser`, `byId`,
  `recordsOfCustomer` (`src/services/lookups.ts`).
- **Notifications / messages**: `notify(d, {...})` (`ledger.ts`), `queueMessage(ctx, {...})` (`outbox.ts`, simulated email/WhatsApp/SMS/push).
- **Activities**: resource `activities`, `logActivity`, `activitiesFor`, `activitiesForCustomer`
  (`src/services/activities.ts`), and `<LogActivityDialog parent={...} requireNextFollowUp />`
  (`src/components/crm/LogActivityDialog.tsx`), `<VoiceButton>` for dictation.
- **Record extensions**: `registerRecordActions`, `registerRecordBanner`, `registerRecordTab`
  (`src/components/resource/extensions.ts`).
- **Async pages**: `useServiceQuery(() => …, deps)` (`src/hooks/useServiceQuery.ts`) and `call()`
  (`src/services/api/client.ts`) for writes from custom pages: loading → `<Skeleton>`, error →
  `<ErrorState onRetry>`, empty → `<EmptyState>`.
- **Offline (NFR-15)**: `runOrQueue(label, () => write())`, `isOffline()`, `setOffline()` (`src/services/offline.ts`) for attendance, visits and job cards; the top-bar toggle is added by the integrator.
- **Validation**: field `format` (`gstin`, `pan`, `mobile`, `email`, `pincode`, `hsn`, `sac`, `hsnSac`, `url`),
  `dateRule: 'past' | 'future'`, `compare`, `requiredWhen`, `visibleWhen`; cross-field checks in hooks
  (throw `ServiceError('validation', msg, { fieldErrors })`).
- **Ids**: `idPrefix` + `idFormat: 'fy'` → `LD-2627-00001`. Human document numbers (e.g. `QT/TX/26-27/0001`)
  go in a separate field set in `beforeCreate` (`fyLabel()` in `src/lib/fy.ts`).
- **Shared masters** (in `src/domain/masters.ts`): `division`, `state` (keys = GST codes), `territory`,
  `role`, `productType`, `productSubType`, `leadSource`, `referrerType`, `lostReason`, `activityType`,
  `customerCategory`, `segment`, `industry`, `buyingRole`, `coverage`, `taskType`, `taskPriority`.
- **Roles** (ids): `admin`, `management`, `division_head`, `sales_manager`, `sales_exec`, `service_head`,
  `engineer`, `coordinator`, `scm`, `store`, `accounts`, `profiling`.
  Approval capabilities: `approve.l1` (sales manager, service head), `approve.l2` (division head),
  `approve.l3` (management), `approve.finance` (accounts), `approve.service` (service head).
  Use the permission helper `p(read, update, create, delete, export)` from `src/domain/modules/types.ts` (do not import values from `src/domain/pack.ts` in module packs — circular).

## 3. Resources and canonical fields

`*` = required. `→ x` = relation to resource `x`. Status lists are master keys in order.

### catalog (Products, price lists, admin configuration)
- `products` (prefix `PRD`): `name*`, `sku*`, `divisionId*` (division), `productType*`, `subType` (productSubType),
  `model`, `hsnSac*`, `gstRate*` (number %: 0/5/12/18/28), `uom`, `warrantyMonths` (number), `specs` (longtext),
  `status` (`active`, `inactive`).
- `priceLists` (prefix `PL`): `name*`, `divisionId*`, `validFrom*`, `validTo*`, `status` (`draft`, `active`, `expired`).
- `priceListItems` (prefix `PLI`): `priceListId*` → priceLists, `productId*` → products, `listPrice*` (money),
  `landedCost` (money, sensitivity `financial`).

### customers
- `customers` (prefix `C`): `name*`, `legalName`, `gstin` (format gstin), `pan`, `industry`, `segmentTags` (multi segment),
  `category*` (customerCategory), `website`, `divisionIds*` (multi division), `territoryId*` (territory),
  `billingState*` (state), `ownerId*` → employees, `parentId` → customers, `dealerId` → customers, `keyAccount` (boolean),
  `creditLimit`, `outstanding`, `overdue` (money, read-only "from ERP"), `erpSyncedAt`, `lastActivityAt`, `status` (`active`, `inactive`).
  `ownerField: 'ownerId'`, `divisionField: 'divisionIds'`.
- `addresses` (prefix `ADR`): `customerId*`, `addressType*` (`billing`, `shipping`, `installation`), `label`, `line1*`, `city*`,
  `state*`, `pincode*`, `lat`, `lng`.
- `contacts` (prefix `CT`): `name*`, `customerId` (empty = contact pool), `designation`, `department`, `mobile`, `whatsapp`,
  `email`, `buyingRole`, `consentWhatsapp`, `consentEmail`, `consentSms` (booleans), `ownerId`, `divisionIds`,
  `poolStatus` (`new`, `contacted`, `converted`), `source` (leadSource).

### leads
- `leads` (prefix `LD`, fy): `customerId*`, `contactId*`, `divisionId*`, `sourceId*` (leadSource), `campaign`, `eventName`,
  `referrerType`, `referrerEmployeeId` → employees, `referrerCustomerId` → customers, `productType*`, `subType`,
  `requirement` (longtext), `budget` (money), `decisionMaker`, `timeline`, `currentSetup`, `ownerId*`, `status*`
  (`new`, `contacted`, `qualified`, `nurture`, `disqualified`), `nextFollowUpAt*` (date), `nurtureUntil`,
  `disqualifyReason` (lostReason), `firstContactAt` (datetime), `lastActivityAt`, `opportunityId` → opportunities, `score`.

### opportunities
- `opportunities` (prefix `OPP`, fy): `name*`, `customerId*`, `contactId`, `leadId` → leads, `divisionId*`,
  `oppType` (`new_machine`, `upgrade`, `consumables`, `amc`, `renewal`), `productId` → products, `value*` (money),
  `expectedCloseDate*`, `stage*` (`needs_assessment`, `demo`, `proposal`, `negotiation`, `won`, `lost`),
  `probability` (number), `competitors`, `ownerId*`, `decisionMakers`, `lostReason`, `lostToCompetitor`, `lostToPrice`,
  `wonAt`, `lastActivityAt`, `nextFollowUpAt`, `machineId` → machines, `amcContractId` → amcContracts.
- `demos` (prefix `DEM`), `sampleRequests` (prefix `SR`) — owned fields.

### quotations
- `quotations` (prefix `QT`, fy): `quoteNo` (e.g. `QT/TX/26-27/0001`), `opportunityId*`, `customerId*`, `contactId`, `divisionId*`,
  `ownerId*`, `quoteDate*`, `validUntil*`, `placeOfSupply*` (state), `revision` (number, 0 = R0), `rootId`, `isLatest` (boolean),
  `status*` (`draft`, `pending_approval`, `approved`, `sent`, `negotiation`, `accepted`, `rejected`, `expired`, `superseded`),
  `lines` (JSON array of **QuoteLine**), `subtotal`, `discountTotal`, `freight`, `insurance`, `taxable`, `cgst`, `sgst`, `igst`,
  `grandTotal` (money), `maxDiscountPct`, `paymentTerms`, `deliveryTerms`, `warrantyTerms`, `installationTerms`,
  `acceptedAt`, `customerPoNo`, `customerPoDate`, `poFileName`, `sentAt`.
- **QuoteLine**: `{ productId, description, lineType, qty, listPrice, discountPct, discountAmt, hsnSac, gstRate, landedCost? }`.

### orders (sales orders, payments, contracts, dispatch)
- `salesOrders` (prefix `SO`, fy): `orderNo`, `quotationId` (required unless `orderKind` = `consumables` repeat), `opportunityId`,
  `customerId*`, `divisionId*`, `ownerId*`, `orderKind*` (`machine`, `consumables`), `orderDate*`, `customerPoNo*`,
  `customerPoDate*`, `poFileName*`, `lines` (QuoteLine[]), `grandTotal*`, `productId` (main machine) → products,
  `siteAddressId` → addresses, `status*` (`pending_approval`, `confirmed`, `payment_pending`, `payment_received`,
  `processing`, `ready_for_dispatch`, `dispatched`, `delivered`, `installation`, `completed`, `on_hold`, `cancelled`),
  `holdReason`, `cancelReason`, `invoiceNo`, `invoiceDate`, `ewayBill`, `erpPushedAt`, `deliveredAt`, `completedAt`.
- `paymentMilestones` (prefix `PM`): `salesOrderId*`, `label*`, `percent`, `amount*`, `dueDate*`, `receivedAmount`, `receivedAt`,
  `status` (`due`, `partly_received`, `received`, `overdue`).
- `salesContracts` (prefix `SC`), `dispatches` (prefix `DSP`: `salesOrderId*`, `dispatchDate*`, `transporter*`, `lrNumber*`,
  `ewayBill`, `expectedDelivery*`, `actualDelivery`, `status`).

### installed (installations, installed base, warranty, AMC)
- `installations` (prefix `INS`, fy): `salesOrderId*`, `customerId*`, `siteAddressId`, `productId`, `engineerId` → employees,
  `scheduledAt`, `status*` (`scheduled`, `site_ready`, `in_progress`, `trial_training`, `signed_off`), `machineId` (set on sign-off),
  `serialNo`, `signedOffAt`.
- `machines` (prefix `M`): `serialNo*` (unique), `productId*`, `model`, `customerId*`, `siteAddressId`, `divisionId*`,
  `printHeads`, `printWidth`, `softwareVersion`, `installDate*`, `purchaseDate`, `salesOrderId`, `status` (`active`, `relocated`, `scrapped`).
- `warranties` (prefix `W`): `machineId*`, `startDate*`, `endDate*`, `coverageType` (`parts_labour`, `labour`), `exclusions`.
- `amcContracts` (prefix `AMC`, fy): `contractNo`, `customerId*`, `machineId*`, `contractType*` (`amc`, `cmc`), `startDate*`,
  `endDate*`, `pmVisitsPerYear*`, `value*`, `status*` (`draft`, `active`, `due_for_renewal`, `renewed`, `expired`, `lost`),
  `lostReason`, `renewedById`, `ownerId` → employees (sales), `serviceOwnerId` → employees.
- `trainingRecords` (prefix `TR`): `customerId*`, `machineId`, `date*`, `topics*`, `trainees`, `retrainingRequested`.

### service (tickets, PM, knowledge base, feedback)
- `tickets` (prefix `TKT`, fy): `customerId*`, `machineId` → machines (optional for Ink/Paper/Fabric), `contactId`, `channel*`,
  `reportedAt*`, `description*`, `category*`, `subCategory`, `ticketType*`, `priority*` (`critical`, `high`, `medium`, `low`),
  `coverage` (coverage, set automatically), `divisionId*`, `assigneeId` → employees, `status*` (`open`, `assigned`, `accepted`,
  `in_progress`, `waiting_parts`, `waiting_customer`, `resolved`, `customer_confirmation`, `closed`, `reopened`),
  `responseDueAt`, `arrivalDueAt`, `resolutionDueAt`, `respondedAt`, `arrivedAt`, `resolvedAt`, `closedAt`, `slaBreached`,
  `repeatOfId`, `rootCause`, `rating`, `feedbackComment`, `reopenCount`. `ownerField: 'assigneeId'`, `divisionField: 'divisionId'`.
- `pmVisits` (prefix `PMV`): `machineId*`, `customerId*`, `amcContractId`, `dueDate*`, `status*` (`due`, `done`, `overdue`, `missed`),
  `ticketId`, `engineerId`. **Created by installed** (sign-off / contract activation) via `insertRecordIn`.
- `serviceVisits`, `knowledgeArticles` — owned fields.

### spares (spare parts, requisitions, claims) and consumables
- `spareParts` (prefix `SP`): `partNo*` (unique), `description*`, `compatibleModels`, `hsn*`, `price*`, `warrantyApplicable`,
  `stockMain` (read-only "from ERP"), `minLevel`, `critical`.
- `requisitions` (prefix `REQ`, fy): `ticketId*` → tickets, `machineId`, `engineerId*`, `partId*` → spareParts, `qty*`, `status*`
  (`requested`, `approved`, `rejected`, `issued`, `received`, `consumed`, `returned`), `basis` (`warranty`, `chargeable`), …
- `warrantyClaims` (prefix `WC`), `rateContracts` (prefix `RC`: `customerId*`, `productId*`, `rate*`, `validFrom*`, `validTo*`,
  `status`), `sampleDispatches` (prefix `SD`).

### field (attendance, visits, expenses, leave, targets)
- `attendance`, `regularisations`, `fieldVisits` (`customerId`, `parentResource`, `parentId` link to lead/opportunity/ticket),
  `beatPlans`, `expenseClaims`, `leaves`, `targets` (`scopeType` `user|team|division`, `employeeId`, `divisionId`, `period`,
  `periodStart`, `metric`, `targetValue`).

### reports (built last)
- Role dashboards and the report catalogue read the resources above **through services only**.

## 4. Hand-offs (who writes what)

| Trigger | Owner of the trigger | Writes |
|---|---|---|
| Contact "Convert to lead" | customers | `leads` (status `new`) — customers calls `insertRecordIn(ctx, 'leads', …)` |
| Lead qualified | leads | `opportunities` (stage `needs_assessment`), sets `leads.opportunityId` |
| Engineer "Opportunity spotted" | service | `leads` (source `referral`, referrerType `engineer`) |
| Quotation accepted | quotations | `opportunities.stage = won` (+ `wonAt`) |
| Opportunity won + accepted quotation | orders | "Generate sales order" reads the latest accepted quotation |
| SO delivered (machine order) | orders | `installations` (status `scheduled`) |
| Installation signed off | installed | `machines`, `warranties`, `pmVisits`; SO → `completed` (`patchRecordIn`) |
| AMC due for renewal | installed | `opportunities` (oppType `renewal`, `amcContractId`) |
| Ticket raised | service | reads `coverageFor(machineId)` |
| Requisition consumed | spares | nothing outside spares |
| Achievement | field (targets) | reads `salesOrders` (status ≥ confirmed) and `paymentMilestones.receivedAmount` |

## 5. Definition of done per module

1. Every FR mapped to the module in REQUIREMENTS.md is implemented (or explicitly marked Simulated / Deferred with a reason).
2. Full CRUD where the FR implies it; lifecycle transitions with guards and side effects; approvals where required.
3. Business rules (BR-xx) and field validations enforced in the service layer (hooks / validators), not only in the UI.
4. Every page: loading, empty and error states; search, filter, sort, pagination on lists (resource lists get this for free);
   confirmation on destructive actions; toasts on success/failure; role-based visibility; works at 390 px.
5. Seed data: realistic Indian companies, names, ₹ values, dates relative to `ctx.today`.
6. `npx tsc --noEmit -p tsconfig.json` shows no errors in the module's files; `npx vitest run src/test/<m>*` passes;
   pages checked in headless Chrome with no console errors.
