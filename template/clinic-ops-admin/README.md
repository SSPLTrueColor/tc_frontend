# Clinic Operations Admin — UAB 2.0 frontend prototype

An administrative clinic operations app (scheduling, patient registry, billing, referrals, work) built with the
Universal Admin Builder 2.0 skill: Soft Enterprise design system, IconRail + ContextSidebar shell, metadata-driven
grid/forms/inspector, saved views, simulated permissions, workflow approvals, audit and event trace.

**Delivery mode: frontend prototype.** All data is fictional and lives only in your browser's localStorage.
No backend, no external services, no real sign-in.

## Run locally

Requirements: Node.js 18+ (tested with Node 24) and npm.

```bash
cd clinic-ops-admin
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

| Command | What it does |
|---|---|
| `npm test` | Vitest contract + component tests (29 tests) |
| `npm run typecheck` | TypeScript strict check |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Serve the production build |

Start at `/` — it redirects to `/o/northwind/w/riverside/dashboard`.

## Try these journeys

1. **Switch role** — account menu (top right) → Morgan (Practice manager), Jordan (Front desk), Dr. Amara Osei
   (Clinician), Sam (Billing). Navigation, fields, masking and actions change per role.
2. **Book & conflict** — Scheduling › Day schedule → click a free slot → create. Book the same room at an
   overlapping time → rejected with an explanation. Clinician double-booking needs a manager override + reason.
3. **Register a patient** — Patients › Register patient (3-step wizard; draft autosaves locally; member ID is
   required only for non-self-pay payers).
4. **Inspector + Quick Comment** — open any record, type a comment, switch Details/Related/Activity/Comments:
   one composer, draft kept. `@` mentions notify teammates.
5. **Billing** — New invoice (full-page form with line items) → Save & issue → Record payment (manual entry) →
   Request write-off as Sam → approve as Morgan in Work inbox › Approvals (requester can't approve own).
6. **Configuration studio** (Morgan) — Start draft → add a custom field or edit a master → Validate → Publish.
   The field appears in forms, column manager, filters and the inspector.
7. **Saved views** — change filters/columns → “Save as new…” (personal/team/org by permission), set default, share link.
8. `Ctrl/⌘ + K` — search pages, views and records (exact ID lookup, e.g. `INV-1002`).

## What is prototype-only (not production)

| Area | Prototype behavior | Production needs |
|---|---|---|
| Data & persistence | Synthetic seeded data in `localStorage` (`uab.clinic-ops.db.v1`); per browser; reset from account menu | Real database + API |
| Sign-in | Role switcher with 4 demo users; no authentication | Identity provider, sessions |
| Permissions | Enforced in an **in-browser** service layer (`src/services/authz.ts`, `runtime.ts`) — faithful model, **not a security boundary** | Server-side deny-by-default enforcement + negative tests |
| PHI masking | Masked values are produced by the simulated service; Eye reveal per `sensitive_data` flag | Server-side masking of API responses and exports |
| Scheduling conflicts | Atomic only within one browser tab | Server-side atomic booking |
| Workflow / approvals | Synchronous, local; immutable-in-spirit history | Durable workflow runtime, outbox, retries |
| Audit log / Event trace | Local append-only lists; not tamper-evident; events marked “simulated”, never delivered | Tamper-evident ledger, real event bus |
| Payments | “Record payment” records money already received; **nothing is charged** | Payment processor integration |
| Messaging | Comments are internal only; external send is disabled with a reason; notifications are in-app only | Messaging provider, consent, delivery states |
| AI assistant | Rail entry present, not enabled | Governed agent gateway |
| Import | Not built | Import studio with dry-run |
| Timezones | Clinic wall-clock times, no conversion | Timezone/DST-aware scheduling |
| Clinical content | None — administrative only, no clinical decision support | — |

## Architecture (src/)

- `metadata/types.ts` — canonical contracts (Resource/Field/Master/Lifecycle/View/Role).
- `domain/clinic/` — the domain pack: masters, 7 resources, 4 roles, modules, deterministic seed (4102), extensions.
- `services/` — mock “server”: `runtime` (Resource Runtime), `authz`, `validation`, `filter`, `scheduling`,
  `workflow`, `collab` (comments/notifications), `views`, `config`, `ledger` (audit/events), `exporter`, `search`.
- `components/primitives` · `components/shell` · `components/resource` — one shared implementation per component
  family (Button, Dialog/Drawer/Popover/Menu with ESC stack and focus return, ViewBar, DataGrid, FilterBuilder,
  ColumnManager, RecordInspector, QuickComment, forms, Board, Calendar).
- `tokens/tokens.css` — primitive → semantic → component tokens; `tokens/tokens.ts` marks LOCKED vs PROPOSED.

## Verification performed

- `npm test`: 29/29 pass (masking, row/field/workspace scope, validation, idempotency, version conflicts, scheduling,
  lifecycle capabilities, approval separation of duties, config dependency checks, CSV formula guard, single
  Quick Comment across tabs).
- Production build passes; headless Chromium checks at 1440/768/390 px: rail 60px, sidebar 240px, nav rows 34px,
  view tabs 40px, inspector 480px (full width on phone), no horizontal page overflow, no console errors.
- Browser click-through (9 flows) passed: calendar booking, room conflict, deep link + Back/Forward, role masking,
  write-off request + approval, config publish propagation, Ctrl+K exact ID, dark theme.
- **Not tested:** screen reader, 200% zoom, forced-colors mode, automated axe scan, contrast measurement of the
  proposed palette, touch devices, server security (none exists).

## Known deviations / notes

- Proposed (not locked) tokens: palette, type scale, spacing, breakpoints (1100 / 760 px), Soft Light rail values.
- Row variants implemented: dense, comfortable, grouped, master-detail (invoice line items), mobile cards. Tree row variant not used (no hierarchical data).
- Native `<select>` is used for relation lookups instead of a custom combobox (accessible by default).
- phi-masking SPEC example `+91*******10` contradicts its own rule; implementation follows the rule (`+91********10`).
