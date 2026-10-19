---
title: Universal Admin Builder 2.0 — Approved Master Specification
version: "2.0-design-lock+enforcement-amendment-1+owner-overrides-1-31"
status: "Consolidated approved design specification with normative generation enforcement amendment; implementation not implied"
date: "2026-10-14"
product: "Universal Admin Builder"
design_system: "Soft Enterprise"
---

# Universal Admin Builder 2.0 — Approved Master Specification

> **Authority and scope.** This document consolidates the design decisions explicitly approved and locked through the Universal Admin Builder 2.0 design process. It describes a reusable, industry-agnostic administration application framework. It is **not** a claim that these capabilities are implemented, visually certified, or deployed. Where illustrative code or supplementary build suggestions appear, they are marked *reference contract* or *implementation recommendation* rather than additional locked decisions.

## Owner overrides — project design rules 1–34 (take precedence over every section below)

> **Read this first.** The project owner changed parts of the locked design. These 34 rules **replace** any conflicting value, component or behaviour anywhere in this document (sizes, tabs, inspector, dialogs, tables, filters, dates, forms, calendar). Each conflicting place below also carries an inline *"Owner override — rule N"* note. Full wording: `SKILL.md` → "Project design rules"; exact measurements and CSS: `references/design-system.md`. Everything not listed here stays as specified.

| # | Rule (short form) |
|---|---|
| 1 | **No breadcrumb row.** Page title in the **top bar** (left) + ⓘ; the page description lives only in the ⓘ tooltip, never as visible text. |
| 2 | **Top bar:** left = (phone menu) + title + ⓘ · **centre = global search** (Ctrl/⌘+K) · right = workspace switcher, notifications, account. |
| 3 | **Two-line view toolbar:** line 1 = underline view tabs + icon-only **"+"** (tooltip "Add view") ……… Export + primary action, with **one full-width line under it** (active tab = semibold + 2px accent underline on that line that **slides smoothly** between tabs; ⋮ on hover/active); line 2 = `[search][Filters ⌄][Columns ⌄] … [count | N selected · Change status ▾ · Export selected]`; **no "All of" chip line** — the table follows directly. Extra tabs slide under "+" with a soft light fade. All views look the same. Filter button never shows a count. Unsaved changes → compact "Unsaved ▾" menu. |
| 4 | **Table look:** compact rows; header labels muted, **regular weight**, faint sort arrows; status = coloured dot + coloured text (no pill); sticky right "Actions" column with a soft left shadow only while columns scroll under it (its 1px divider is always shown). |
| 5 | **Frozen pagination footer:** table fills the page height; footer fixed at the bottom — left "1–25 of N items", right page numbers + custom **"25 / page"** dropdown (opens upward). No "Rows per page" text. |
| 6 | **Compact page spacing** (≈8–12px vertical, 16px horizontal). |
| 7 | **One shared compact control height = 32px** (replaces the locked 36px) for every button, icon button, compact input/select and view tab; touch 44px; form inputs 40px. Set once in the token layer. |
| 8 | **Exactly three text sizes:** Primary **18px** (page/record/drawer title) · Secondary **16px** (section/panel/dialog titles, key numbers) · Supportive **13px** (everything else, incl. tables, buttons, inputs, nav, labels, tooltips). No other sizes (replaces 12px/14px values). Phones: typed fields 16px. |
| 9 | **Custom dropdowns everywhere — never a native `<select>`** (shared `SelectMenu`: search when > 8 options, ✓ on selected, flips up, popover layer above dialogs). 40px in forms, 32px elsewhere. |
| 10 | **Sidebar collapse toggle at the TOP** (panel icon in the sidebar header; when collapsed, at the top-left of the top bar). |
| 11 | **Toolbar sizing:** tools group never shrinks or clips; view tabs take only the leftover width and scroll the tab strip only (no `scrollIntoView`). |
| 12 | **One global tooltip layer** (portal, never clipped; dark bubble with arrow; `data-tooltip`, no native `title` tooltips). |
| 13 | **Truncated text always shows its full text in the tooltip**, automatically. |
| 14 | **Dates display as "16 Oct, 2026"** (date only, also for date-times); the tooltip shows "Fri, 16 Oct 2026 08:30 AM". Shared `DateText`. |
| 15 | **Empty values = italic very-light-grey "N/A"** (lighter than disabled text), no icon, never "—" or blank. Shared `EmptyValue`. |
| 16 | **Checkbox column centred** (header + rows in one straight line); **row checkboxes appear on row hover** (stay visible when checked / any selected / focused / on touch). |
| 17 | **Header & columns — borderless table:** no outer border, **no vertical lines between body cells** (the header keeps short dividers, none before Actions) — only light horizontal row lines; Actions keeps a 1px left divider + soft shadow while columns scroll under it (resize handle shows on header hover); sort arrow right of the label; sorted column = dark label + arrow (no tint); **every column left-aligned** (numbers, money, dates too); Actions pinned right, centred, width = its icons; spare width shared across data columns; **clean style: white header row with one bottom line, white rows, light row lines, soft hover** — list pages are fully white and the table runs edge to edge, no card around it). |
| 18 | **"+ Add view", Rename, Duplicate open as anchored panels** (like Columns), never centred modals; only the button whose panel is open looks pressed; segmented controls hug their content. |
| 19 | **Never show the same information twice** (tooltip text is not repeated visibly). |
| 20 | **Expandable rows:** no card and no title line — just a plain numbered table (muted headers aligned with values, light row lines, total row) indented under the chevron (accent when open); stays fixed while the table scrolls sideways, ending before Actions; last row keeps its bottom border. |
| 21 | **Multi-value cells:** chips on one line, then "+N" with a list tooltip (shared `OverflowChips`). |
| 22 | **Bulk actions at the right end of the search line (line 2)**, after a short divider: "N selected · Change status ▾ · Export selected"; no separate selection bar, no Clear button. |
| 23 | **Explanatory text only in an ⓘ InfoTip** — page/dialog/panel descriptions, form help, side notes. Visible text only for data, statuses, warnings/errors, consequences, empty states. |
| 24 | **Custom DatePicker everywhere — never a native date input:** Sunday-first weeks, round days, today ringed, ‹ month ›, Today/Clear, time row with custom dropdowns for date-times. |
| 25 | **Filter panel = simple form + Apply:** "Filters ⌄" opens a ~320px panel (Status segmented ≤ 3 values else multi-select; choice fields as multi-selects; booleans single; **two-month date range picker** with « ‹ / › »); footer Clear · Apply; "Advanced conditions" opens the AND/OR builder (480px, right-aligned, kept on screen). Panel buttons (Filters, Columns) show a ⌄/⌃ chevron. |
| 26 | **Multi-select dropdown with checkboxes** (search · Select all/Deselect all · checkbox options · footer "N selected · Clear all"; trigger shows accent chips + "+N"). |
| 27 | **Clean aligned forms:** form section titles hidden (screen-reader legend only, no divider); **no number spinner arrows**; same label-row height; "$" / "min" affixes inside the input. |
| 28 | **Every side drawer opens the same way — including the Record Inspector:** modal, from the right over a dimmed backdrop (**never a docked, non-modal panel squeezing the list**), 560px wide, header = top-bar height with an 18px title (+ status/tools for records). **No popup ever has a × icon** (drawers and dialogs); each closes with a footer **Cancel** (default Cancel when it has no actions; wizards: Cancel + Back), plus Esc / backdrop. **Edit sits in the footer next to Cancel** (Cancel · Edit); while editing the footer is Cancel · Save changes. Workflow actions are named in full ("Cancel appointment"). |
| 29 | **Form fields per row follow the container width:** 1 → 2 → 3 per row (each column ≥ 220px, max 3); long text / line items / multi-selects take the full row. |
| 30 | **Always confirm before deleting:** every delete / remove / discard opens an alert dialog (title "Delete <thing>?", one-sentence consequence, Cancel focused + red Delete). Shared `confirmDelete()` + one `ConfirmHost`; never `window.confirm`, never one-click delete. |
| 31 | **Calendar blocks never cut text** (content by block height; 15-min = one line; compact ranges "08:30–09:30 AM"; full details in tooltip); **overlapping bookings side by side**; 76px hour column; usage hints in ⓘ; booking blocks have **no coloured left line** (overlap = dashed outline); a calendar view inside a list page looks exactly like the calendar page; the calendar **fills the screen to the page bottom**, only the grid scrolls. |
| 32 | **No accent indicator lines in front of items:** no bar left of the active icon-rail icon, no coloured left border on bookings/cards, no accent line at the start of the active table row — the item's own tint shows the state. |
| 33 | **Context sidebar style:** light grey surface; tight 30px option rows (1px gap); "Find a page (N)" search at the top (filters all options into Results); plain muted sentence-case separators ("Favorites", "Pages", "Menu", "Pinned", "Recent"); rows with an icon (icon + text) and child rows indented under a collapsible group row (chevron + label + muted count) — children text-only by default or with icons per module; a ☆ on hover beside each option adds it to **Favorites at the top** (filled accent star; click again to remove); active = light accent fill + accent text; the sidebar and its resize handle always sit above the page content (sticky table cells never cover the handle). |
| 34 | **Mandatory in every project with people/profile data:** a dedicated rich view per such resource, and several-people fields always as avatar stack + people card. **Rich rows only in their own view option** (normal tables stay one-line; the rich view has a visible "2 lines | 3 lines" switch on its tools line; 3 lines adds an image section — a 40px picture at the start of the main cell): one row mixes 3-line (e.g. title / due / priority), 2-line (person avatar + name / role) and 1-line cells; several people = overlapping avatars (max 3 + "+N") with a compact hover **people card** — "N PEOPLE ASSIGNED" header band, then avatar · name · muted subtitle per person; max 5 visible, more scroll inside. |

## 0. Product charter and non-negotiable decisions

**Mission.** Build, configure, extend, and validate coherent, accessible, metadata-driven administration applications for **any** domain: education, CRM, ERP, HR, finance, manufacturing, healthcare operations, legal matter management, nonprofit administration, internal collaboration, research operations, inventory, project delivery, and yet-unknown domains. Domain-specific objects and vocabulary are configured, not hardwired into universal UI infrastructure.

**North star.** One design language, one shared metadata and authorization foundation, reusable experiences, context-specific business behavior, governed human and AI-agent collaboration.

**Not a fixed ERP/CRM template.** CRM, HRMS, and Inventory are acceptance-test examples, not restrictions or compulsory modules. Never add irrelevant domains when generating a requested application. Custom business types must work through the same resource and component contracts.

**Approved UX inspiration.** Calm clarity influenced by ChatGPT, configurable productivity patterns influenced by ClickUp/Notion, refined restraint influenced by Apple. Values, colors, and measurements here are *UAB-owned proposals*, **not** internal or proprietary design tokens from those products.

**Essential invariants:**
1. Business schema definitions are canonical; forms, grids, filters, search, detail, reports, and automation reference them.
2. Tenant and record/field security is enforced server-side; hiding UI does not grant or revoke permissions.
3. Tasks, formal approvals, workflow runs, business records, notifications, communications, audit evidence, and telemetry have **distinct** authoritative ownership.
4. Browser components may present and request actions but may not independently authorize consequential operations.
5. EDA orchestrates reliable, auditable changes; idempotency and loop controls are required.
6. Configuration uses **Draft → Validate → Dependency Review/Preview → Publish → Monitor**, with immutable published versions.
7. AI agents have explicit, scoped identities and tool grants, with human governance for consequential actions.
8. Real, mock, local-only and conceptual interactions must never be confused.
9. Preserve existing brands, technology stacks, working routes, and dependencies unless an explicit migration has been approved.
10. Default to a **modular monolith plus durable background workers** initially; five logical layers are not five mandatory deployed microservices.
11. **No standalone API Management console** in the Integration & Connector Management component; secure provider APIs remain valid implementation mechanisms.
12. Personal URLs and deep links preserve authorization; visible route slugs are not trusted identifiers.

## 1. Approved system-wide design language — Soft Enterprise

### 1.1 Visual principles
- Minimal, professional, soft, flat or lightly sectioned; strong alignment, generous enough readability, restrained pastel highlights, and very limited decorative shadow.
- High usable content density without shrinking critical touch targets or sacrificing accessibility; compactness is a **choice**, not the only responsive mode.
- Avoid dashboards consisting of excessive framed cards, decorative gradients, glass effects, overused rounded pills, or oversized empty KPI containers.
- One clear primary action per meaningful workspace; contextual secondary and row actions.
- Lucide-style line icons, nominally **16 px** in dense UI; provide accessible labels/tooltips for icon-only controls. *(Owner override — rule 12: all tooltips come from one global portal tooltip layer via `data-tooltip`; no native `title` tooltips)*
- Neutral canvases, white or near-white content surfaces, subtle borders, calm purple selection accents; semantic success/warning/error states are distinct and never color-only.

### 1.2 Locked measurements and behavior

| Element | Approved default | Notes |
|---|---|---|
| Desktop global icon rail | **56–64 px** wide | Separate selectable skins, not the same as sidebar |
| Contextual secondary sidebar | **240 px** default | Resizable; persisted per user and workspace |
| Sidebar navigation rows | **34 px** → **30 px** *(owner override — rule 33: tighter options, 1px gap)* | 13 px labels, 16 px icons, 2 px row gap |
| Sidebar selection radius | **7 px** | Subtle selected surface, text and icon state |
| Sidebar section labels | **12 px** → **13 px** *(owner override 2026-10-16: global supportive size)* | Clear nested groups and contextual hierarchy |
| Standard control height | **40 px** | Inputs, selects, buttons as applicable |
| Compact control height | **36 px** → **32 px** *(owner override 2026-10-16: all buttons/compact inputs, set once in the shared token)* | Fine-pointer dense usage |
| Touch control target | **44 px** minimum/default | Grow where WCAG or platform usage needs more |
| Control radius | **7 px** | Inputs, buttons, popovers' inner controls |
| Panel/card radius | **12 px** | Avoid excessive surrounding boxes |
| Dialog radius | **14 px** | Standard modal dialogs — no × icon; close with the footer Cancel *(owner override — rule 28)* |
| Universal View Bar | **38–42 px** → **32 px underline tabs** *(owner override — rules 3, 7)* | Icon + name underline tabs with a full-width line under them, primary action on the right; tools on a second line; icon-only "+" after the last tab |
| Record Inspector | **~480 px** → **560 px modal side drawer** *(owner override — rule 28)* | Opens over the page with a dimmed backdrop like every drawer; expands to 680–760 px; mobile full screen |
| Grid/content typography | **13–14 px** → **13 px** *(owner override — rule 8: only 18 / 16 / 13 px exist)* | Honor zoom and user accessibility settings |
| Default body typography | Readable and responsive | Do not shrink root font to cheat density |
| Icon default | **16 px** | Provide bigger hit areas than icon glyph |
| Mobile / tablet | Adaptive | Drawer navigation, accessible forms and full-width inspector |

### 1.3 Global icon rail skins — locked choices

| Skin | Background | Supporting tokens |
|---|---|---|
| **Soft Charcoal** (default) | `#24252D` | Muted icons `#AAAAB7`; selected background `#3B354F`; selected icon `#CFBFFF` |
| **Midnight Navy** | `#1C2535` | Derived accessible active/muted roles; preserve semantic selection |
| **Graphite Black** | `#15161A` | Derived accessible active/muted roles |
| **Soft Light** | Neutral pale | Accessible foreground and selection; exact derived token subject to contrast validation |

These skins apply **independently to the rail**; they must not arbitrarily recolor every workspace surface. Organization branding may override allowed semantic accent aliases while preserving accessibility.

### 1.4 Design token layers and canonical naming

**Locked token architecture:** *primitive → semantic → component aliases*. Business modules cannot hardcode divergent design tokens. Example is a *reference contract*, not a claim of a separately approved exhaustive hexadecimal palette.

```css
/* Reference token structure — supplement missing values only after contrast testing. */
:root {
  --uab-rail-width: 60px;                /* approved range 56–64 */
  --uab-sidebar-width-default: 240px;
  --uab-nav-row-h: 34px;
  --uab-nav-row-gap: 2px;
  --uab-view-tab-h: 40px;              /* approved range 38–42 — OWNER OVERRIDE rules 3/7: 32px underline tabs */
  --uab-inspector-width: 480px;        /* OWNER OVERRIDE rule 28: 560px modal drawer */
  --uab-inspector-width-expanded: 720px; /* approved 680–760 */
  --uab-control-h: 40px;
  --uab-control-h-compact: 36px;       /* OWNER OVERRIDE rule 7: 32px */
  --uab-control-h-touch: 44px;
  --uab-radius-control: 7px;
  --uab-radius-panel: 12px;
  --uab-radius-dialog: 14px;
  --uab-icon-size: 16px;
  --uab-nav-font-size: 13px;
  --uab-section-font-size: 12px;       /* OWNER OVERRIDE rule 8: 13px (sizes are 18/16/13 only) */
  --uab-rail-charcoal-bg: #24252D;
  --uab-rail-charcoal-icon: #AAAAB7;
  --uab-rail-charcoal-selected-bg: #3B354F;
  --uab-rail-charcoal-selected-icon: #CFBFFF;
  --uab-rail-navy-bg: #1C2535;
  --uab-rail-black-bg: #15161A;
  /* Additional primitive scales, semantic role pairs, and component aliases
     must be explicitly validated per light/dark/brand state. */
}
```

**Required token families.** Typography (font families without distributing vendor font files, weight, line height, size), primitive spacing grid (4 px-based units recommended), elevation/shadow, z-index layers, borders, colors (canvas/surface/text/muted/action/selected/focus/status), radii, grid density, icons, motion duration/easing, responsive breakpoints, accessibility/coarse-pointer variants, rail skins, sidebar states, tables/forms/view bar/inspector aliases, semantic chart palettes. Consumers use semantic or component aliases rather than raw hex values.

**Color and contrast.** Do not treat example pastel backgrounds as automatically accessible. Validate all foreground/background pairs in light/dark and alternate skins; text contrast ≥4.5:1 for ordinary small text, meaningful control boundaries/focus ≥3:1 where applicable. Verify high contrast/forced colors, reduced motion, text zoom to 200%, keyboard focus, screen readers, coarse-pointer targets. Selection/status is never conveyed by color alone.

### 1.5 Component state contract
Every interactive control needs documented rest, hover, focus-visible, pressed, selected, disabled, loading, empty, invalid/error, read-only, success where appropriate, high-contrast, dark-mode, touch and keyboard states. Inputs have explicit labels, optional/required semantics, hint and accessible validation. Overlays are correctly portalled/anchored and flip when space is insufficient; Escape closes only the topmost layer; modal dialogs trap focus, nonmodal inspectors do not. Return focus to invoking control when closed. Do not leave decorative nonworking controls.

## 2. Application shell, navigation and URL architecture — locked

**Four regions:** `IconRail | ContextSidebar | WorkspaceCanvas | Optional RecordInspector`.

**Icon Rail** (global): module shortcuts, organization switch, global search, Work Inbox/notifications, AI entry, settings and account controls. Four independently selectable rail skins. Current module and unread notifications must have accessible non-color indicators.

**Context Sidebar** (module/workspace): contextual modules, sections, hierarchy, app pages, personal/team/org pinned pages and views, favorites, recent items and shortcuts; 240 px resizable, 34 px Balanced default, compact option. Persist width, collapse, pins, ordering, recent/default destinations per user subject to policies.

**Main Workspace**: page title shown in the top bar with an ⓘ info-icon tooltip for the description (no breadcrumb row, no visible description text); global search centred in the top bar; Universal View Bar on line 1 (tabs + export + primary action, full-width line under it, sliding underline) and search, filter, columns on line 2 *(owner override — rule 3)*; grid, board, calendar, form, dashboard, report or page composition. *(Owner decision 2026-10-15: no breadcrumb row; page description lives in an ⓘ info-icon tooltip after the title — see SKILL.md “Project design rules”.)* Optional inspector remains nonmodal and preserves working context and drafts.

**Mobile**: not simply desktop compressed. Icon rail and sidebar may collapse into appropriate navigation drawers; inspector becomes full-width; filters can use adaptive sheets; do not produce a permanent narrow content strip.

**Keyboard:** Command/Ctrl+K palette, recognizable keyboard navigation across views and inspector, focus/ESC restoration, screen-reader labels.

**Deep links, recommended route templates:**

```text
/o/:orgSlug/w/:workspaceSlug/:module/:resource
/o/:orgSlug/w/:workspaceSlug/:module/:resource/:recordId
/o/:orgSlug/w/:workspaceSlug/:module/:resource?view=:viewKey
/o/:orgSlug/w/:workspaceSlug/:module/:resource?peek=:recordId
/u/:userSlug/my-work
```

These are illustrative URL contract patterns: aliases resolve to immutable IDs and server-authorized resources. Support slugs, ownership, rename/redirect, invalid or revoked deep link, Back/Forward, refresh, filters, saved views and inspector selection; user-specific routes never bypass organization access.

## 3. Five logical architectural layers — locked

1. **Foundation:** tenants, identity, organization/workspace graph, RBAC/field protection, canonical metadata, storage, audit.
2. **Execution & Integration:** EDA event foundation, workflow/jobs runtime, connector adapters, agent tool gateway.
3. **Shared Business Services:** work items, calendar, documents, communication, search, notification, dashboards/reporting.
4. **Configuration:** versioned applications/modules/resources, masters, forms, views, pages, policies, dependency validation and publishing.
5. **Experience:** Soft Enterprise shell, grid, board, calendar, filters, forms, inspector, command palette and help.

These are logical boundaries; a modular monolith is the initial recommended build form. Define explicit typed contracts and prohibit hidden cross-domain direct writes to another service's owned state. Scale/fault isolation may justify service extraction later.

### 3.1 Canonical manifest and resource reference contract

```ts
// Reference contract. Related *Ref and FieldDefinition types need full implementation schemas.
type ApplicationManifest = {
  id: string; key: string; label: string; version: number;
  organizationScope: string; modules: ModuleRef[];
  navigation: NavigationRef; capabilities: CapabilityRef[];
  policies: PolicyRef[]; theme: ThemeRef;
  status: 'draft' | 'published' | 'deprecated';
};
type ResourceDefinition = {
  id: string; moduleId: string; key: string; label: string; version: number;
  fields: FieldDefinition[]; relationships: RelationDefinition[];
  masters: MasterRef[]; permissions: PolicyRef;
  lifecycle?: StateMachineRef;
  views: ViewRef[]; forms: FormRef[]; pages: PageRef[];
  search: SearchConfig; audit: AuditConfig; eventPolicy: EventPolicy;
  status: 'draft' | 'published' | 'deprecated';
};
```

Immutable keys/IDs, independently localized labels, explicit relationships/masters, permissions, lifecycle transitions, typed renderers and indexing/query capabilities. One resource schema feeds grid/form/filter/search/inspector/report without redefining business meaning.

### 3.2 Ownership invariants

| Authoritative owner | Owned state | Consumers |
|---|---|---|
| Resource Runtime | Business records | Grid, Form, Inspector, Reports |
| Metadata Registry | Resource/field/master definitions | All configured experiences |
| View Registry | Saved views, view state and scopes | Grid, Board, Calendar, Navigation |
| Authorization Service | Roles, scopes, policy decisions | Queries, mutations, agents, exports |
| Work Service | Tasks, activities, milestones | Inbox, Calendar, Reports |
| Workflow Runtime | Runs, steps, approvals | Inbox, Work Item representations |
| Scheduling Service | Bookings, capacity, availability | Calendar and work planning |
| Document Service | Blob/version authority and templates | Records, communications, workflow |
| Communication Service | Messages, threads, drafts | Inspector, Inbox, Timeline |
| Notification Service | Notifications and delivery state | Bell, Inbox, Settings |
| Settings Resolver | Effective configuration and personal preferences | UI Shell and components |
| Audit Ledger | Audit evidence | Admin, Record History |
| Telemetry Platform | Logs, traces, performance | Operations screens |

Reading a notification is not approval. Completing a task is not formal approval. An AI proposal is not an executed change. A calendar event does not automatically complete a task. An activity feed is not the immutable audit ledger.

## 4. Foundational component registry — locked

**Typed approved registry:** Each component has a stable key/version, allowed properties, layout constraints, data bindings, allowed actions, accessibility contract, states, device behavior and permissions. Page Builder cannot load arbitrary executable code from a database configuration.

| Family | Representative components |
|---|---|
| Inputs | Button, text/number/email/password input, Select, Combobox, Checkbox, Radio, Switch, Date/Time Picker, Textarea, Attachment *(owner override — rules 9, 24, 26, 27: custom SelectMenu / MultiSelectMenu / DatePicker only, never native; no number spinners)* |
| Feedback | Tooltip, Popover, Menu, Toast, Inline Error, Alert, Progress, Empty/Loading/Error State, Skeleton |
| Overlays | Modal Dialog, Confirm Popover, Drawer, Full-Width Detail *(owner override — rules 28, 30: no × on any dialog/drawer, footer Cancel; deletes always use the shared alert dialog `confirmDelete`)* |
| Navigation | IconRail, ContextSidebar, Breadcrumb, ViewBar, TabBar, Command Palette *(owner override — rule 1: no breadcrumb row on pages)* |
| Content | PageHeader, Section, Tabs, Stat/KPI, Chart, Report Widget, Relation Panel |
| Data | DataGrid, CellRenderer, RowRenderer, AdvancedFilterBuilder, ColumnManager, Pagination/Virtual Scroll |
| Record | RecordInspector, QuickPeek, EditPanel, RelatedRecords, Audit/Activity Timeline, QuickComment |
| Forms | FormRenderer, FieldRenderer, Repeater/Line Items, Wizard, InlineEditor, ConditionalSection |
| Collaboration | ConversationThread, MentionPicker, WorkInbox, Notifications, Comment Composer |
| Configuration | Resource/Field/Master Studio, Page Builder, Permissions Studio, Workflow Builder |
| Operations | Job Monitor, Audit Explorer, Connection Monitor, Help Studio |

**Rule:** reuse the actual registered component in every domain instead of rebuilding visually similar but contract-incompatible counterparts.

## 5. Universal Data Grid — locked

**Responsibilities:** Dense, permission-aware, server-capable tabular views for any resource.

- TanStack Table plus virtualization is a recommended implementation for large datasets; not a mandate to migrate existing working stacks.
- Server-side sorting/filtering/grouping/aggregation/counts/export at scale; avoid client-only illusions on paginated data.
- Sticky permission-aware View/Edit/More actions; keyboard selection and focus; bulk actions only where authorized. *(Owner override — rule 4, 17, 22: Actions pinned right with centred icons and a width fitting them; bulk actions sit on the filter-chip line)*
- Column resizing, reordering, hide/show, pin, sticky, sorting, type-aware formatting, per-view persistence.
- Loading/empty/error/no-access states, pagination or virtualization, selection, row counts, compact/comfortable densities. *(Owner override — rule 5, 13–17, 21: frozen pagination footer with "25 / page"; dates "16 Oct, 2026"; empty = "N/A"; all columns left-aligned; clean white header row with one bottom line; truncated text shows a tooltip; multi-values as chips + "+N")*
- Responsive deliberate card or horizontally scrollable layout where justified.

### 5.1 Universal Cell & Row Presentation 2.1 — locked
Seven row types: **Dense, Two-Line, Rich, Tree, Grouped, Master–Detail, Mobile**. *(Owner override — rule 34: Dense rows everywhere by default; Two-Line/Rich rows only in a dedicated view option (mixed 3/2/1-line cells, person avatars, avatar stacks with a people hover card). Rules 17, 32: borderless table — no outer border, no vertical lines, row lines only; no accent bar on the active row. Rule 20: master–detail rows expand into a plain titled, numbered table (no card) that stays fixed during horizontal scroll)* Ten typed renderer categories (illustrative canonical categories): plain/compound text, numbers/currencies, date/time, status/badge, avatar/person, relation/link, boolean, progress/metric, icon/media/attachment, actions. Renderers must be metadata-typed and locale/permission-aware; nested rich values do not redefine stored field types. Conditional coloring requires accessible text/state alternatives.

## 6. Universal View Bar — locked

- Underline tabs **38–42 px**; clear selected indicator; always-visible **`+`** to add a view. *(Owner decision 2026-10-15/16: superseded by rule 3: tabs + primary action on line 1 (full-width line under it), search/filter/columns/export on line 2; `+` follows the last view, overflowing views slide under it with a slight light edge shadow. View tabs are underline tabs (icon + name, 2px accent underline on the active one) with an icon-only "+", toolbar controls 32px (touch 44px), uniform view tabs, Filter without count. Grid: dot-style statuses, compact muted headers, frozen pagination footer with rows-per-page — see SKILL.md “Project design rules”.)*
- Personal, Team and Organization view scopes. Saved view definitions include view type, selected filters, columns/layout, sort, grouping, share/pin/default and owner.
- Supported experiences: Table, List, Board, Calendar, Timeline, Gallery (additional approved types may be registered).
- Create, duplicate, rename, reorder, pin, share, delete with permission, set default, navigate via deep link; persist across reload and devices when backed by service. *(Owner override — rule 18, 30: Add view / Rename / Duplicate open as anchored panels; Delete view asks for confirmation first)*
- Avoid oversized pill-tabs; show natural restrained row of tabs consistent across modules.

## 7. Advanced Filter Builder — locked

*(Owner override — rule 25: the entry point is a simple "Filters ⌄" form panel with Apply — status segmented or multi-select, choice fields as multi-selects, two-month date range picker; this full AND/OR builder opens from its "Advanced conditions" link.)* Quick chips for common filters; advanced AND/OR groups, nested contextual conditions, comparison operators, master values, range and relative dates. Only expose schema-declared filterable fields to permitted actors. Validate server-side, serialize to saved views/deep links and explain invalid/deprecated fields gracefully. Preview filter effects when practical. Reuse same filter engine for grids, saved views, reports and work queues.

## 8. Column Manager — locked

Contextual anchored popover (not a large separate application): searchable available fields, drag/keyboard reorder, show/hide, pin left/right, width/resize, grouping when appropriate, density and reset. Respect field-level security and resource metadata; permissions must be rechecked by the data service. State persists at approved personal/view scope and updates the grid instantly where safe.

## 9. Universal Record Inspector — locked

~480 px nonmodal right drawer, expand to 680–760 px, and full-width mobile. *(Owner override — rule 28: the inspector opens as a **560 px modal side drawer** over a dimmed backdrop, exactly like the edit drawer — header = top-bar height with the 18 px title + status chip and prev/next/expand/full-page/pin icons, no ×, footer Cancel · Edit; while editing Cancel · Save changes. The full-page route keeps the in-page layout. The single Quick Comment composer stays above the footer.)* Modes **Quick Peek, Edit, Full Detail**; tabs **Details, Related, Activity, Comments**, status and contextual actions, previous/next, shareable deep link, keyboard access, back/forward. Preserve pending edits with policy-compliant drafts or leave warnings.

**Critical locked requirement:** One persistent **collapsed Quick Comment composer at the bottom of EVERY inspector tab**. The Comments tab shows the full thread and must NOT render a second composer. Comment draft state survives tab/record context changes according to the draft policy. A single canonical Communication Service handles persistence/permissions.

## 10. Universal Form Builder & Inline Editing 2.1 — locked

### 10.1 Six experiences
*(Owner override — rules 23, 27, 28, 29: help text only in ⓘ; section titles hidden; no spinners; affixes inside inputs; fields flow 1→2→3 per row by container width; dialogs/drawers have no × and close with footer Cancel.)*
1. **Quick Create** — minimal entry in popover/small dialog or narrow drawer.
2. **Drawer Form** — contextual create/edit without losing the list.
3. **Full-Page Form** — complex record editor requiring more space.
4. **Wizard** — validated steps, progress, next/back, draft, error summary.
5. **Line-Item / Repeater / Subtable** — nested structured data and dynamic totals.
6. **Inline Cell/Row Editing** — authorized changes with per-field validation and row concurrency.

### 10.2 Field catalogue
String and multi-line text, rich text, email/phone/URL, identifiers, decimal/integer/currency/percent, date/time/date range/duration, boolean, single/multi-select master, status/priority, radio/checks, relation/lookup, people/org/role, hierarchy/dependent select, tags, attachments/media/document, address/geolocation where authorized, rating, formula/calculated/derived, repeater/table, display-only/system/audit values, localized fields and configuration-defined specialized types.

**Canonical schema vs layout:** Field type, ID, validation, classification, relationships and permissions belong to resource schema; form layout controls group/order/columns/tabs/help/visibility and conditional presentation only. Form layout cannot weaken server rules.

### 10.3 Required behaviors
- Conditional show/hide and requiredness, dependencies, default/derived values and formulas with deterministic server validation.
- Shared master values and relational lookups with stable keys, hierarchy and dependent controls.
- Clear required labels, inline validation, form-level error summary, dirty-draft preservation, concurrency/version checks, state transition permission checks and recovery from failed submission.
- Quick Create, drawers, wizard and inline edit must use same mutation contract and audit semantics.
- Repeaters support add/remove/reorder rows, row validation, currency-safe totals, and complete undo/confirmation where consequential.
- Forms support accessible keyboard navigation, focus management, zoom, localization, touch targets, responsive field grids and error association.
- Dynamic forms cannot evaluate arbitrary customer-authored JS on the client or server.

## 11. Global Search & Command Palette 2.0 — locked

Command/Ctrl+K opens global/contextual search of pages, records, views, permitted actions and recent destinations. Exact ID lookup, relevance-ranked results, quick scope changes, breadcrumbs, keyboard selection and safe deep links. Tenant/resource/row/field permissions enforced by the search backend, not only hidden results. Optional AI assistance can suggest filters or query structure but cannot bypass permissions or execute unapproved actions.

## 12. Notifications, Work Inbox & Activity Center 2.0 — locked

Bell popover and unified actionable inbox for mentions, replies, assignments, approval requests, reminders, exceptions and escalations; searchable activity timeline. Deduplicate, bundle, snooze, delegate, quick reply, configurable preference/routing, audit separation. A notification can navigate to a task or approval but does not own its result. Marking notification read ≠ task complete ≠ approval. Sensitive content is minimized in notification payloads.

## 13. Workflow, Event & Automation Engine 2.1 — locked

**EDA is platform infrastructure**, not narrowly an approval product. Supports event/manual/scheduled/webhook triggers; composable AND/OR conditions; timing/debounce; waits, conditional/parallel branches, approvals, record mutations, notifications, documents, connector actions, event emission and governed agent nodes.

**Versioned event envelope reference:**

```ts
interface DomainEvent<T = unknown> {
  eventId: string; eventType: string; eventVersion: number;
  tenantId: string; actorId: string; actorType: 'user'|'service'|'agent';
  resourceId?: string; recordId?: string;
  occurredAt: string; correlationId: string; causationId?: string;
  traceId?: string; idempotencyKey: string; classification?: string;
  payload: T;
}
```

Reliable outbox, durable orchestration, idempotent steps, retry/backoff, dead-letter queue, replay restrictions, loop protection, compensation when reversing external effects, observability and human checkpoints. Workflow builder visual authoring, versioning, simulation and dry-run must never falsely claim simulated operations were actually executed. Approval decisions remain owned by Workflow Runtime, not generic task completion. Business event consumers honor schema compatibility and tenant boundaries.

## 14. Dashboard, Analytics & Reporting 2.0 — locked

Operational and analytical dashboards; semantic metrics registry with reproducible definitions, scoped queries, personal/team/org saved dashboards, responsive drag/configurable widget layout, charts, tables, pivot, grouping, calculated metrics, filters, drill-down, scheduled report delivery, freshness indicators, permission-safe exports and EDA-driven alerts. Provide accessible chart alternatives, coherent units/locale and no unauthorized inference from aggregates. Widgets registered through Page/Component Registry, not arbitrary executable page scripts.

## 15. Resource, Field & Master Configuration Studio 2.1 — locked

Dynamic app/module/resource manifests; editable versioned fields and relationships; shared/local masters (status, priority, type, category, item etc), hierarchical and dependent options, icons/colors and localizations. Master values have immutable stable keys independent of display labels; deactivation and historical validity matter. Rich masters become structured resources, not merely arrays. Validation/defaults/formula rules, conditional visibility, state transitions, permissions, audit and workflow/EDA contracts. Dependency graph checks changes against views, forms, reports, formulas, templates, document generation, events and connector maps. Draft → Validate → Preview/Test → Publish with governed rollback/migration.

## 16. RBAC & Organization Permission Studio 2.0 — locked

Organizations create/modify/clone/assign custom roles for dynamically registered resources. Effective permissions span tenant, organization membership, workspace, own/team/department/branch/org row scopes, field View/Edit/Mask/Hide, lifecycle, workflow/configuration, files, integrations and agent tools. Deny-by-default server enforcement. Preview effective actor access, delegation, audited privileged changes, separation of duties and safety controls. UI capability visibility reflects effective policy but is **not** security enforcement.

## 17. Organization, Identity & Workspace Management 2.1 — locked

Distinguish **tenant/security boundary**, legal organization(s), flexible organization graph, global identities and scoped memberships, and collaboration workspaces. Provision/invite/transfer/offboard users, guests, teams and service/AI identities; delegation, access reviews, session controls, policy inheritance, data governance, stable personal links and cross-workspace navigation. Offboarding reassigns accountable work and revokes sessions/tool grants. Never conflate personal profile, organization and workspace.

## 18. Universal Page Builder & Workspace Layout System 2.0 — locked

Six layout templates: **Single, Split, Master–Detail, Tabbed, Grid, Wizard**. Typed approved component registry, responsive composition, resource-aware data bindings, drag/drop sections or equivalent accessible layout controls, contextual actions, conditionally visible components, owner scopes, RBAC, accessibility and dependency tracking. Versioned draft/validate/preview/publish; no arbitrary remote code execution in metadata. Reuse component renderers, not screen-specific hardcoded business UI.

## 19. Universal File, Media & Document Management 2.0 — locked

Contextual record attachments; central library with folders/collections, secure file previews/search, metadata and links to multiple records, immutable version history, bulk/resumable upload, file-type and malware validation, quarantine and sandboxed conversion. Tenant/record/file authorization, secure delivery, permission-aware links with expiry/revocation, retention/legal holds and audit. Configurable document templates (invoices, quotations, orders, contracts) with conditional/repeating blocks and generation snapshots; e-signature integration readiness, document requests, expiration reminders and EDA events (`document.uploaded`, `document.approved`, `document.signed`, `document.expired`). Agents can access only explicitly scoped documents; no unrestricted corpus retrieval.

## 20. Universal Communication, Collaboration & Comments 2.0 — locked

Record-centric conversations, threaded replies, mentions, persistent Inspector Quick Comment, internal restricted notes, clearly separate authorized external messages, attached documents, follow-up tasks and unified but access-controlled communication history. Work Inbox and notifications integration, templates, delivery queued/sent/delivered/failed states, retries, audit, retention, accessibility and governed agent participation. Internal content must NEVER silently switch to external visibility. External sends require explicit account/channel/recipient/attachment context and policy-driven approvals. Agent identities remain visibly distinct from humans; suggestions and drafts aren't sent until authorized.

## 21. Universal Tasks, Activities & Work Management 2.0 — locked

Shared task/activity/work-item model; configured fields/statuses/priorities and valid transitions; accountable owners, multi-assignees and teams, watchers and supervised AI agents. Subtasks, checklists, projects, milestones and dependencies (cycle detection); recurrence, business calendars, due dates, SLAs and escalations; list/board/calendar/timeline/workload views and saved views; reusable plans, time/effort tracking when required, comments, documents, RBAC, events and cross-module metrics. Distinguish task from business record/formal approval/workflow run; agent work tracks delegated scope, tool runs, cost and human checkpoint.

## 22. Universal Calendar, Scheduling & Resource Planning 2.0 — locked

*(Owner override — rule 31: booking blocks never cut text — content by block height, one line for 15 min, compact time ranges, full details in tooltip; overlapping bookings side by side; 76 px hour column; hints in ⓘ; the calendar fills the screen to the page bottom and only the grid scrolls. Date entry uses the custom DatePicker — rule 24.)*

Configurable calendars and resources (people, rooms, machinery, vehicles, classrooms and others), appointments, shifts, business-day calendars, timezones and DST-aware recurrence/exceptions, exclusive/pooled/quantity reservations, resource capacity and availability policies. Atomic booking and overlap checks server-side, planned vs actual utilization, permitted overrides and conflict explanation. Day/week/month/agenda/resource-timeline/capacity views and saved views, EDA triggers, external calendar connector readiness, permissions and audit. A scheduled event does not itself prove completion of a task.

## 23. Universal Integration & Connector Management 2.0 — locked

**No standalone API Management product.** Marketplace of approved provider definitions, organization-level connection instances, secure consent/authentication, secret rotation/revocation, connector versioning and compatibility. Data mapping, identity matching, one-way import (safe default), outbound and explicitly governed bidirectional/scheduled/event sync, source-field ownership and conflict policy, checkpoints, retries, reconciliation and loop protection. External triggers and actions registered for EDA; connection health, incidents, audit and governed custom connector adapters. RBAC and scoped AI-agent tools with explicit approved capabilities, quotas and human checkpoints. Protect OAuth state/PKCE, signed webhook validation, SSRF and untrusted provider payloads.

## 24. Universal Audit, Monitoring & System Administration 2.0 — locked

Tamper-evident audit ledger and explorer; contextual event correlation; workflow/job/queue/connector/agent trace monitoring, agent token/tool/cost visibility, actionable incidents, alerts/runbooks, safe recovery/retry/requeue/compensation, configuration history, RBAC and tenant-safe diagnostics, retention/legal hold, disaster recovery readiness and Soft Enterprise admin surfaces. Separate protected audit evidence from user-friendly activity feeds and temporary technical telemetry. Never retry a committed payment-like operation merely because its notification failed; monitoring failures must not silently remove audit evidence.

## 25. Universal Settings, Personalization & Localization 2.0 — locked

Single Settings Center with **Platform → Organization → Workspace → Personal** scopes and deterministic effective settings; mandatory platform/security/accessibility constraints cannot be overridden. User-specific rail skin, theme (light/dark/system), density, navigation pins/width, home page, saved view defaults and allowed branding. Organization-approved logos/colors, localized language/date/timezone/number/currency display, notification channel preferences, accessibility support, secure storage, versioning, RBAC, audit and EDA settings events. A display-currency choice must not alter a financial transaction currency or booked values.

## 26. Universal Import, Export & Data Migration Studio 2.0 — locked

Guided CSV/XLSX imports and mapped resources; deterministic schema validation, row-level errors and duplicate identity policies, exact dry-run create/update/skip impacts and approval; permission-aware CSV/XLSX/JSON export; reusable templates; relationship/dependency-aware multi-resource migration, source snapshots, legacy-ID mapping, reconciliation and controlled cutover; resumable background jobs and checkpoint/retry/compensating recovery; tenant isolation, RBAC, audit and EDA. Spreadsheet formula injection protection, sensitive-field policies and time-limited downloads. AI may recommend mappings and cleansing but cannot override deterministic validation.

## 27. Universal Help, Onboarding & In-App Guidance 2.0 — locked

Contextual page/field/action help registry, searchable permission-aware documentation, role-specific onboarding and adaptive guided tours, feature discovery, progress verified using trusted EDA milestones, versioned documentation studio, localization, support requests, adoption analytics, accessible tours, restricted knowledge search and governed AI-assisted guidance. Tours only show available actions and current UI versions. No confidential diagnostics or protected user data automatically included in support requests.

## 28. Cross-system UI/UX composition requirements

### 28.1 Approved standard page patterns

| Screen | Composition |
|---|---|
| Standard List | Header + View Bar + contextual toolbar + Grid/list + optional Inspector |
| Board | Header + View Bar + configurable columns/cards + inspector |
| Calendar | Header + Views + time/resource navigation + bookings + detail |
| Dashboard | Responsive widget sections + filters + drill-down |
| Detail | Title (ⓘ description tooltip) + back action + summary/actions + tabs/relations/activity/comments |
| Configuration Studio | Sidebar or grouped navigation + metadata editors + validate/preview/publish |
| Form | Quick/drawer/full/wizard/repeater/inline modes driven by schema |
| Workflow Builder | Trigger/condition/action canvas + version/test/publish + execution preview |
| Collaboration | Thread + replies + mentions + composer + relevant action panel |
| Operations | Severity/health summary + searchable events/runs + authorized recovery |

### 28.2 Cross-domain rule
Given identical design tokens and the same semantic component manifest, rendering a student record, patient operations record, legal matter, grant application or manufacturing work order must preserve the component style and behavior. Only terminology, fields, actions, permissions, layouts and relevant views may change. Never force educational or medical domain extras into another admin application by default.

### 28.3 Prototype fidelity
An interactive conceptual sketch is **not** a functioning production component. Golden UI references for every core component should include implementation, states, responsive screenshots, keyboard paths, loading/error behavior and design-token mapping before the skill can promise visual fidelity. This was identified as a gap during post-lock testing and remains a **validation requirement**, not a claim that all golden components already exist.

## 29. Configuration and publication pipeline — locked

1. Draft typed metadata and explicit scope.
2. Check schema, policy and component compatibility.
3. Evaluate dependent filters, saved views, reports, formulas, workflows, routes, connectors, document templates and AI tool policies.
4. Preview real consequences and authorization decisions on representative records.
5. Approve according to policy; publish immutable version atomically where possible.
6. Record event/audit, observe adoption and operational errors; provide governed rollback or forward migration.

**No silent destructive schema changes.** Restrictive policy changes must invalidate stale client state and cached authorizations.

## 30. Security and AI governance — locked

- Global identity, organization membership, tenant security boundary and workspace membership are not interchangeable.
- Tenant ID, immutable actor, row scope and field effective access checked at service boundaries and every data surface (search, export, reports, logs, autocomplete, agent tools).
- Prevent inference via counts, previews, grouped analytics and suggestion lists.
- Authenticate privileged actions and preserve separation of duties; break-glass exceptions require explicit policy and audit.
- Secret vault, envelope encryption/rotations, signed time-limited document links, validated uploads and sandboxed previews.
- Agent tool grants bind identity, tenant, connection, capability, data scope, duration, quotas, human approvals and auditable action context. Retrieved documents/connector messages are untrusted data, never authority to alter permissions.
- Define data retention, legal holds, export/deletion policy, incident investigation and data minimization by classification.

## 31. Quality gates and acceptance suite — locked contracts plus implementation recommendations

### 31.1 Design-token certification
Verify primitive→semantic→component aliases resolve; exact locked sizes/radii and rail skins are present; all color pairs/states satisfy contrast; no component hardcodes contradictory measurements; rendering is consistent in light/dark/system, alternative rail themes and zoom/touch modes. Token checking alone does not prove browser accessibility.

### 31.2 Component certification
Validate interaction states (hover, focus, loading, disabled, error), keyboard paths, overlay anchoring and ESC stack, focus restoration, screen-reader semantics, viewport clipping, text wrapping, high contrast, reduced motion, internationalization, dark mode and failure handling. The persistent Inspector Quick Comment must never duplicate or lose a draft on tab switch.

### 31.3 Cross-domain acceptance matrix

| Test domain | Canonical fixture | Essential quality checks |
|---|---|---|
| CRM | Leads/Accounts | Create/edit, list/board, saved views, permitted action, audit |
| HRMS | Employees/Leave | Salary field masking, department scopes, approval vs task separation |
| Inventory | Items/Warehouses | Quantity renderers, relations, grouped grid, stock event |
| Education | Students/Classes/Teachers | Relationships, attendance, sensitive field visibility, scheduling |
| Healthcare operations | Appointments/Resources | Sensitive fields, calendar conflict, role scope and audit |
| Legal operations | Matters/Deadlines | Documents, retention, confidentiality, access and timeline |
| Nonprofit | Grants/Volunteers | Configurable masters, workflow and reporting |
| Arbitrary internal admin | Invented resource schema | Domain independence, no hardcoded business modules |

### 31.4 Executable release gates

| Gate | Minimum evidence |
|---|---|
| Structure | Skill entrypoint and referenced files found; no obsolete conflicting default packages |
| Schema | Metadata/field/master/view/form/page definitions validated and versioned |
| Visual | Desktop (~1440px) and phone (~390px) screenshots at normal/zoomed states reviewed |
| Navigation | Rail, contextual sidebar, saved views, URLs, Back/Forward and direct links |
| Data | Create/edit/filter/sort/pagination or virtualization, relation and draft handling |
| RBAC | Backend denial of tenant/record/field misuse, including exports/search/AI tools |
| EDA | Outbox, retry/idempotency, approval invariants, failure recovery |
| Configuration | Breaking dependency rejected; draft/preview/publish authorized |
| Responsive | Touch usability, no document-wide overflow, full-width inspector/mobile drawers |
| Accessibility | Keyboard/labels/focus, screen reader smoke, contrast, reduced motion, 200% text zoom |
| Reports & Operations | Data-scoped query, audit correlation and authorized recovery |
| Multi-domain | At least CRM, HRMS, Inventory plus unrelated domain fixture |

Quality results must say **Passed, Failed, Blocked or Not Tested**. A static skill evaluator or injected browser mock does not establish authenticated production behavior. If local URL navigation is blocked, document that limitation explicitly rather than asserting HTTP E2E passed.

## 32. Implementation order — locked roadmap

| Phase | Approved focus | Exit proof |
|---|---|---|
| 1. Foundation | Identity/tenant/RBAC, metadata/manifest, event/audit contracts | Authorized CRUD and policy tests |
| 2. Soft Enterprise Shell | Design tokens, primitives, rail/sidebar, routes/deep links, inspector scaffolding | Browser/accessibility/viewport checks |
| 3. Resource Experiences | Grid, views, filters, forms, inspector, comments | End-to-end vertical slice |
| 4. Configuration Studios | Resource/master/field, page builder, view/form configuration, publish | Change propagation, version dependency validation |
| 5. Business Execution | EDA/workflows, work/tasks, notification, docs, communication, scheduling | Idempotent durable activity and separated approvals |
| 6. Enterprise & AI | Connectors, import/migration, reports, monitoring, onboarding and agent gateway | Security and cross-domain certification |

**First vertical slice:** CRM Leads → metadata → grid → filter → saved view → form → inspector → Quick Comment → task → event → audit. **Second distinct domain:** HRMS Employees or Inventory Items built by configuration rather than frontend duplication. Add Education/Healthcare/Legal/Novel-domain fixtures to validate universality, not as compulsory default modules.

## 33. Skill rebuild / installation principles

- SKILL.md must route to precise reference files and reusable code or golden templates when actually available, not only descriptive claims.
- V2.0 Soft Enterprise default takes precedence over legacy neutral-enterprise V1, old single-sidebar conventions and bundled V1/V2 app assumptions.
- Legacy V1/V2 sample app bundles must **not** remain in the replacement V2.0 package (including as hidden regression fixtures), per approved consolidation direction.
- Keep standalone API Management out of the scoped features.
- Preserve existing brand and stack when adapting a real repository; otherwise generate the UAB V2.0 Soft Enterprise defaults.
- A skill ZIP being structurally valid is different from an app generated using it passing visual, browser, accessibility and backend security gates.
- No direct replacement of installed skill files is implied by this master specification; install/update is a separate explicit operation.

## 34. Traceability register — explicitly locked component catalogue

| ID | Design area | Version | Approval status |
|---|---|---|---|
| UAB-DS | Soft Enterprise Design System | V2.0 | Locked |
| UAB-RAIL | Global Icon Rail / skins | V2.0 | Locked |
| UAB-SHELL | Navigation & Workspace Shell | V2.1 | Locked |
| UAB-GRID | Universal Data Grid | V2.0 | Locked |
| UAB-VIEWS | Universal View Bar | V2.0 | Locked |
| UAB-FILTER | Advanced Filter Builder | V2.0 | Locked |
| UAB-COLUMNS | Column Manager | V2.0 | Locked |
| UAB-INSPECTOR | Universal Record Inspector | V2.0 | Locked |
| UAB-ROWS | Universal Cell & Row Presentation | V2.1 | Locked |
| UAB-FORMS | Universal Form Builder & Inline Editing | V2.1 | Locked |
| UAB-SEARCH | Global Search & Command Palette | V2.0 | Locked |
| UAB-NOTIFY | Notifications, Inbox & Activity Center | V2.0 | Locked |
| UAB-EDA | Workflow, Event & Automation Engine | V2.1 | Locked |
| UAB-ANALYTICS | Dashboard, Analytics & Reporting | V2.0 | Locked |
| UAB-MASTERS | Resource, Field & Master Configuration Studio | V2.1 | Locked |
| UAB-RBAC | RBAC & Organization Permission Studio | V2.0 | Locked |
| UAB-IDENTITY | Organization, Identity & Workspace Management | V2.1 | Locked |
| UAB-PAGE | Universal Page Builder & Layout System | V2.0 | Locked |
| UAB-DOC | File, Media & Document Management | V2.0 | Locked |
| UAB-COMMS | Communication, Collaboration & Comments | V2.0 | Locked |
| UAB-WORK | Tasks, Activities & Work Management | V2.0 | Locked |
| UAB-CALENDAR | Calendar, Scheduling & Resource Planning | V2.0 | Locked |
| UAB-CONNECT | Integration & Connector Management | V2.0 | Locked, excluding API Management |
| UAB-AUDIT | Audit, Monitoring & System Administration | V2.0 | Locked |
| UAB-SETTINGS | Settings, Personalization & Localization | V2.0 | Locked |
| UAB-DATA | Import, Export & Data Migration Studio | V2.0 | Locked |
| UAB-HELP | Help, Onboarding & In-App Guidance | V2.0 | Locked |
| UAB-ARCH | Architecture & Design-System Consolidation | V2.0 | Locked at design level |

## 35. Boundary between agreed design and subsequent exploration

The exploratory **AI-native, communication-first LMS / always-on tutor** discussion (class thread, teacher, student and agent, contextual practice, learning companion) is an illustrative possible *application* of UAB. It was **not separately locked as a new universal component or a change to the installed skill**. Likewise, recent requests to achieve exact visual parity with chat-based intelligent UI expose a desired validation goal; they do not establish that the skill already ships complete golden UI code.

## 36. Known remaining implementation and audit risks

1. Current skill instructions alone may not generate exact rendered visual parity without executable golden component implementations, screenshots and automated visual checks.
2. Full UI interactions, deep links and responsive visual fidelity must be observed in real browser test contexts; conceptual prototypes do not certify them.
3. Full canonical JSON schemas, backend authorization runtime, durable EDA, workflows and agent gateway remain implementations to be supplied/tested, not merely declared.
4. A reference Education app must demonstrate behavior before it can be treated as a certified golden UI benchmark.
5. Brand skins beyond exact four rail-background and Soft Charcoal role tokens need accessible resolved component-role values during implementation.
6. Organization/tenant/workspace boundaries and multi-tenant search/logging/exports require hostile test cases.
7. Connector sync and migration rollback/compensation require end-to-end fault-injection testing before deployment.

---

## Appendix A — Design acceptance examples (behavioral)

**A1. Dynamic field propagation.** Organization admin publishes a new validated Student/Customer/Case field; permitted grid, form, filter, search, inspector and report renderers can discover it according to metadata capabilities, while unpermitted users receive neither raw value nor inferred presence.

**A2. Shared workflow/approval.** Student enrollment approval or invoice approval creates a workflow-owned decision. A Work Inbox item may link to it, but reading notifications or completing a related task cannot approve it.

**A3. Persistent comment.** Draft a Quick Comment inside Record Inspector → switch from Details to Related to Activity to Comments → same composer and draft persist without duplicate fields.

**A4. Cross-domain visual parity.** Render Education Students and Legal Cases using the identical IconRail, ViewBar, Grid, Filter, FormDrawer and Inspector implementations. Only configurations/labels and permissions differ. Match approved measurements in viewport screenshots.

**A5. Tenant isolation.** Two tenants create records with same human-readable slug and identifier. A copied record/view URL or search/export query cannot expose the other tenant's data.

**A6. Scheduling race.** Two concurrent users request exclusive resource at the same time. Exactly one reservation succeeds without admin override; the rejected booking receives an actionable conflict explanation.

**A7. Agent permission.** A teacher AI assistant may draft a revision quiz from authorized course material but cannot edit official marks or send external parent communications without policy and required human approval.

**A8. Import safety.** CSV maps new customer data, duplicate matches, field errors and existing relationships. Dry run predicts operations, authenticated approval is revalidated at commit and retries do not duplicate accepted rows.

**A9. Visual quality.** On desktop/tablet/mobile, critical actions remain available; short labels do not clip; overlays are not occluded; light/dark/alternate rail themes pass contrast; keyboard and reduced-motion behavior works.

## Appendix B — Artifact use

This Markdown specification is intended as the **authoritative design-level input** for V2.0 skill rebuilding, education reference-app evaluation, component library implementation, design-token registry development and cross-domain quality-gate definitions. Design locks must not be silently broadened into product promises, certified test results or production deployment claims.


---

# Appendix C — Design System Enforcement & Generation Contract (Amendment 1)

> **Status and precedence.** This appendix is an **implementation-hardening amendment** accepted for inclusion on 2026-10-14. It does not change any of the 28 approved/locked component design decisions. Items explicitly labelled **LOCKED** restate those decisions. A **PROPOSED DEFAULT** fills an unresolved implementation gap and must be reviewed before claiming an additional design lock. A **QUALITY REQUIREMENT** is a reproducibility or testing requirement, not a claim that any production system presently passes it. Any conflict with a locked decision must be resolved in favor of that locked decision and documented.

## C1. Normative language, rule priority and scope

- **MUST / MUST NOT**: testable requirement, deviation only with an explicit, recorded exception from the product owner or a higher-priority safety/accessibility constraint.
- **SHOULD / SHOULD NOT**: preferred method, with a recorded reason for deviations.
- **MAY**: optional capability or implementation choice.
- **LOCKED**: approved design-level constraint, not proof of working code.
- **PROPOSED DEFAULT**: concrete starting token to prevent ambiguity, not previously approved or locked.

**Precedence:** safety, privacy, accessibility and legal obligations → explicit user instruction and preserved verified brand/system constraints → locked UAB decisions → UAB component contracts → domain metadata → implementation convenience. Neither a prompt nor domain label authorizes bypassing security or production controls.

**Universal generation contract:** The application may represent education, CRM, logistics, healthcare operations, legal services, research, community work, AI collaboration, or any other domain. Only vocabulary, authorized data types, resource schemas, workflows, content and permitted task-specific modules change. The visual grammar, primitive/component tokens, navigation principles and UX interaction expectations MUST remain consistent unless an explicit brand adaptation or accessibility requirement is recorded. Do not add unrequested CRM/ERP modules to unrelated products.

## C2. Canonical token manifest

Use one machine-readable token registry shared by CSS, component code, stories, screenshots and tests. The following YAML is a **reference contract**. Exact values tagged `locked` derive from previously approved measurements; concrete non-locked values are marked `proposed` and must not be represented as locked approvals.

```yaml
schemaVersion: 1
designSystem: SoftEnterprise
baseUnitPx: {value: 4, status: proposed}
geometry:
  iconRail:
    width: {value: 60, min: 56, max: 64, unit: px, status: locked-range}
  contextSidebar:
    defaultWidth: {value: 240, unit: px, status: locked}
    minWidth: {value: 200, unit: px, status: proposed}
    maxWidth: {value: 360, unit: px, status: proposed}
    navigationRowHeight: {value: 34, unit: px, status: locked}
  navigation:
    fontSize: {value: 13, unit: px, status: locked}
    iconSize: {value: 16, unit: px, status: locked}
  controls:
    defaultHeight: {value: 40, unit: px, status: locked}
    compactHeight: {value: 36, unit: px, status: locked}
    touchHeight: {value: 44, unit: px, status: locked}
  radius:
    control: {value: 7, unit: px, status: locked}
    panel: {value: 12, unit: px, status: locked}
    dialog: {value: 14, unit: px, status: locked}
  viewBar:
    height: {value: 40, min: 38, max: 42, unit: px, status: locked-range}
    activeStyle: {value: underline, status: locked}   # OWNER OVERRIDE rule 3: underline tabs kept, 32px tall, icon + name, icon-only "+"
  recordInspector:
    width: {value: 480, unit: px, status: locked}   # OWNER OVERRIDE rule 28: 560px modal drawer
    expandedMin: {value: 680, unit: px, status: locked}
    expandedMax: {value: 760, unit: px, status: locked}
railSkins:
  softCharcoal:
    surface: {value: '#24252D', status: locked}
    icon: {value: '#AAAAB7', status: locked}
    selectedSurface: {value: '#3B354F', status: locked}
    selectedIcon: {value: '#CFBFFF', status: locked}
  midnightNavy:
    surface: {value: '#1C2535', status: locked}
  graphiteBlack:
    surface: {value: '#15161A', status: locked}
  softLight:
    surface: {value: 'semantic-surface', status: unresolved}
spacingScale:
  xs: {value: 4, unit: px, status: proposed}
  sm: {value: 8, unit: px, status: proposed}
  md: {value: 12, unit: px, status: proposed}
  lg: {value: 16, unit: px, status: proposed}
  xl: {value: 24, unit: px, status: proposed}
  xxl: {value: 32, unit: px, status: proposed}
typography:   # owner decision 2026-10-16: exactly three global sizes
  family: {value: 'system-ui, sans-serif', status: proposed}
  primary: {value: 18, unit: px, status: owner-approved}     # page & record titles
  secondary: {value: 16, unit: px, status: owner-approved}   # section/panel/dialog titles, key numbers
  supportive: {value: 13, unit: px, status: owner-approved}  # all other text (tables, controls, nav, labels)
  lineHeightBody: {value: 1.45, status: proposed}
semanticColorRoles:
  - canvas
  - panel
  - elevated
  - textPrimary
  - textSecondary
  - textMuted
  - borderSubtle
  - accent
  - accentSubtle
  - success
  - warning
  - danger
  - focusRing
  - disabledSurface
  - disabledText
states: [rest, hover, active, selected, focusVisible, disabled, loading, error, success]
```

**Rules:** Never scatter ad hoc pixel values through shared components when the token has a canonical name. The build MUST identify undefined token usage and reject unknown role names. Color roles MUST have resolved contrast-safe values for each enabled theme. Do not assume alternate rail skins imply complete light/dark token sets. System font fallbacks MUST work without distributing proprietary font files. Token values affecting keyboard/touch accessibility may scale to satisfy platform requirements.

## C3. Canonical shell and adaptive navigation contract

**Desktop regions:** `IconRail | ContextSidebar | WorkspaceCanvas | optional RecordInspector`. Icon rail holds module switching and stable global utilities. Context sidebar holds module sections, hierarchies, pinned pages and views. The top bar holds the page title + ⓘ description tooltip (no breadcrumb row) and centred global search; WorkspaceCanvas holds the one-line view toolbar and content surface. Inspector operates on selected records without losing active workspace context. Resizable sidebar state, pins and view selection persist at the correct actor/workspace scope; shared URLs use stable identifiers and server authorization.

**Responsive behavior (QUALITY REQUIREMENT):**

| Width class | Proposed adaptation | Hard invariants |
|---|---|---|
| Wide desktop | Rail + sidebar + canvas + optional inspector, with resizable sidebar | Inspector must not obscure primary action; keyboard focus order follows reading order |
| Laptop / constrained desktop | Sidebar collapsible; inspector may overlay if content minimum reached | No truncated record actions; active resource/view remains discoverable |
| Tablet | Context sidebar becomes dismissible drawer; inspector may use a full-height overlay *(owner override — rule 28: the inspector is a modal overlay drawer at every width)* | Overlay focus management, escape behavior and restore focus |
| Phone | Rail/sidebar available through a clear navigation affordance; inspector opens full width | Main interaction area remains readable; no mandatory permanent rail consuming content width |

Breakpoints are **not previously locked**. Implementations MUST choose and document actual CSS thresholds based on minimum usable content widths and demonstrate screenshots at 1440px desktop, 768px tablet and 390px phone. Avoid arbitrary hardcoded width rules that force horizontal document overflow. Users at 200% zoom must retain navigation and primary actions.

## C4. Approved component registry and implementation recipes

Each shared component entry MUST declare: stable `componentId`, purpose, semantic roles/tokens, anatomy, required input properties, events, keyboard behavior, focus/overlay behavior, loading/empty/error/disabled states, responsive transforms, authorization constraints, and acceptance tests. The registry MUST use typed approved components; dynamic configuration cannot inject arbitrary executable code.

| Registry family | Mandatory anatomy and behavior |
|---|---|
| IconRail | *(owner override — rule 32: no indicator bar beside the active icon)* Branded top/primary navigation + accessible utility items, correct selected state, theme skin, tooltips and keyboard access |
| ContextSidebar | Sections, pinning, hierarchical items, compact 34px rows, active state, collapse/resize and persistence *(owner override — rules 10, 33: collapse toggle at the top; light grey surface, plain separators, icon rows + text-only or icon child rows with counts, "Find a page" search, ☆ favourites at the top)* |
| WorkspaceHeader | Top bar: title + ⓘ description tooltip (left, no breadcrumb row), centred global search, context actions, global command/search entry, feedback/notification affordances where applicable |
| UniversalViewBar | Underlined **32px** view tabs with icon + name *(owner override — rules 3, 11, 18)*, 2px accent underline on the active tab, icon-only "+" after the last tab, saved view scope and deep-link behavior |
| UniversalDataGrid | Typed cells, selectable rows, sticky authorized actions, server-driven capability modes and virtualized large-data strategy |
| AdvancedFilterBuilder | Typed operators, nested AND/OR groups, relative dates, chips, validation and serialized filter state |
| ColumnManager | Search, show/hide, reorder, pin, density and persisted preference scope |
| RecordInspector | Header, Details/Related/Activity/Comments tabs, navigation, ~~480px default~~ **560px modal drawer, no ×, footer Cancel · Edit** *(owner override — rule 28)*, one bottom-persistent Quick Comment |
| UniversalForm | Metadata-generated fields, validation, conditional sections, create/edit/inline/wizard modes, draft and version conflict handling |
| Dialog/Drawer/Popover/Menu | Correct overlay stacking/anchoring, focus entry/restore, escape/cancel, actionable states *(owner override — rules 28, 30: no ×, footer Cancel, drawer header = top-bar height, delete confirmations via shared alert dialog)* |
| Dashboard/Reports | Semantic metric widgets, charts and drilldowns, authorized data and configured time windows |
| PageBuilder | Typed approved sections, responsive layout constraints, safe data bindings, draft/preview/publish |
| CommandPalette | Cmd/Ctrl+K, authorized scoped search, recent entities and action intents, keyboard navigation |
| Notifications/Inbox | Distinct read, acknowledge, approve and complete semantics; EDA-backed history |
| Work/Calendar | Tasks and scheduling with lifecycle, resource/capacity checks, appropriate views |
| WorkflowStudio | Versioned triggers, conditions, actions, waits, human checkpoints and dry-run/validation |
| Config/Master/Permission Studio | Resource and field registry, dependent masters, effective access preview and governed publication |
| Collaboration/Document/Help | Record-linked threads/files/help, secure visibility and accessible status feedback |

### C4.1 Example normative recipe: Record Inspector

- **Inputs:** `resourceId`, `recordId`, `activeTab`, actor/effective permissions and versioned record data.
- **Anatomy:** title/status/record actions header; tab strip with Details, Related, Activity, Comments; scrollable tab content; fixed bottom composer region.
- **Visual:** ~~480px default~~ **560px modal side drawer with backdrop, header = top-bar height, no ×, footer Cancel · Edit** *(owner override — rule 28)*, 680–760px expanded, mobile full-width; panel radius tokens only where the panel is visually detached rather than flush.
- **Invariant:** Exactly ONE persistent Quick Comment composer at the bottom of **all** four tabs. The Comments tab cannot render a second composer. Draft is not reset on tab switches.
- **Behavior:** switch records with preservation or explicit unsaved-draft warning; prevent submitting twice; clarify read-only/permission-restricted states; provide correct focus and aria labels.
- **Acceptance:** automated test types unsent text, cycles four tabs, verifies unchanged draft and one composer; mobile screen capture verifies the action and composer are reachable.

### C4.2 Example normative recipe: Universal Form Builder

- **Single source of truth:** Field IDs/types/validation/sensitivity/masters/relationships from canonical resource metadata; a form controls presentation only.
- **Modes:** Quick Create, drawer edit, full page, multi-step wizard, inline cell/row, repeating line items and permission-scoped read-only presentation. *(Owner override — rule 9, 24, 26, 27, 29: custom dropdowns/date pickers only; section titles hidden; no spinners; affixes inside; 1→2→3 fields per row by container width)*
- **States:** pristine, dirty, invalid, submitting, success, error, conflict, autosave draft and disabled/read-only; do not treat readonly as an authorization check.
- **Conditional logic:** declarative expressions must be typed, dependency-checked and cycle-safe. Hidden fields cannot be used to bypass server validation; don't silently clear values without declared policy.
- **Validation:** client feedback for speed, server authoritative validation; cross-field, uniqueness, async dependencies and concurrency conflicts; focus first invalid field and announce errors accessibly.
- **Acceptance:** same field definition propagates to form, grid, filter, search and inspector consistently; role restrictions are upheld server-side; wizard preserves drafts as configured; invalid submissions do not mutate records.

### C4.3 Example normative recipe: Navigation + View Bar + Grid

- **Nav:** IconRail width within 56–64px, second sidebar default 240px, nav rows 34px in Balanced mode, icons 16px and labels 13px.
- **ViewBar:** ~~38–42px~~ **32px** underline tabs with icon + name *(owner override — rules 3, 7)*, visible `+`, personal/team/org ownership, reorder/rename/default/share operations according to permission.
- **Grid:** typed cell registry, column manager, grouped/tree/compact/mobile row patterns, filtering/sorting with documented server vs local mode, sticky actions only if effective permission allows.
- **Acceptance:** a single reference implementation receives Education Students, Legal Cases and Inventory Stock resource metadata; CSS and component identity remain the same while terminology, columns and actions adapt.

## C5. Anti-drift generation instructions

A UAB-compliant generator MUST:

1. Load this manifest and applicable component contracts **before** rendering screens.
2. Inventory an existing application's brand, routes, working behavior, permissions, dependencies and APIs; preserve them unless the user explicitly requests migration.
3. Emit or reuse ONE shared token layer and ONE canonical implementation per shared component family; prohibit domain-specific forks justified only by aesthetics.
4. Generate entity schemas first, then derive lists, filters, forms, inspectors, reports and authorized actions from them.
5. Explain and record intentional brand/accessibility deviations in a machine-readable exception list.
6. Produce functioning actions or visibly mock-labelled actions; never render deceptive controls that suggest unsupplied integrations, persistent saves or AI execution.
7. Never substitute unrelated oversized dashboard cards, heavy shadows, gradients or a generic single sidebar for approved patterns just because they are easier to generate.
8. Verify component anatomy and interaction states, not only screenshots. Never claim screenshot parity with a ChatGPT intelligent UI response when no actual screenshot/reference has been captured and compared.
9. Keep UI concerns separate from authorization, EDA, agent execution and audit evidence.
10. Include a post-generation conformance report listing PASS/FAIL/BLOCKED/NOT TESTED per requirement, with test commands and observed artifacts.

## C6. Domain-agnostic generation scenarios

| Scenario | Representative resources / work | Universal contracts under test |
|---|---|---|
| Education | Student, Class, Enrollment, Attendance, Fee | Views, forms, master options, inspector, scheduling, RBAC |
| CRM | Lead, Account, Opportunity | Pipeline/list views, saved filters, record threads, actions |
| HRMS | Employee, Department, Leave | Field masking, org scopes, formal approval distinction |
| Inventory | Item, Warehouse, Stock Movement | Numeric renderers, grouped grids, relationships, idempotent events |
| Healthcare operations | Facility, Appointment, Staff Assignment | Scheduling conflicts and access boundaries; no implied clinical decision-making |
| Legal operations | Matter, Client Organization, Document | Document access, retention, case activity, views |
| Nonprofit / community | Program, Volunteer, Beneficiary Case | Scoped personal data, flexible masters and work |
| AI collaboration | Conversation, Agent Task, Human Review | Communication vs task vs workflow ownership, scoped AI tools |
| Unknown domain | User-defined named resources and fields | No hardcoded education/ERP terminology; token/component invariants unchanged |

## C7. Quality gates and evidence contract

**Outcome labels:** `PASS` = executed and evidence captured; `FAIL` = observed requirement breach; `BLOCKED` = environmental limitation; `NOT_TESTED` = test not attempted. Do not equate static lint success with browser UX verification.

| Gate | Test and threshold | Required evidence |
|---|---|---|
| Token compliance | Shared components reference canonical token names; no unresolved required tokens; no unauthorized local component fork | Token validator output and inspected compiled CSS |
| Geometry and type | Rail/sidebar/rows/view bar/controls/radii/inspector within locked ranges on applicable viewport; accessible scaling can override sizes | Browser computed-style assertions + screenshots |
| Shell/navigation | IconRail/ContextSidebar/Canvas/optional Inspector functional; URLs, history, keyboard and focus intact | E2E interaction logs and deep-link tests |
| Component anatomy | Every rendered component meets its registry's required regions, states and events | Component-level tests and stories/screens |
| Form/data behavior | Create/edit/validate/draft/unsaved changes, saved views and filters behave according to mode | Scenario E2E tests and backend evidence where claimed |
| Persistent comment | Exactly one inspector Quick Comment across all tabs, preserved unsent draft | Automated tab-cycle test |
| Responsiveness | Screens at 1440/768/390px; no inaccessible primary actions or unintended page overflow; 200% zoom supported | Screenshot triptych + viewport assertions |
| Accessibility | Keyboard focus order, labels, escape/focus restoration, reduced motion, contrast and assistive labels verified | Keyboard test notes + automated checks + manual screen-reader review status |
| Authorization | Tenant, row, field, action, search, report/export and agent tool scope verified **on server** for live/backend claims | Negative tests using separate identities and scoped API calls |
| EDA/workflow | Outbox/idempotency/retries, approvals distinct from tasks, event trace visibility | Replay tests and trace/audit evidence |
| Cross-domain reuse | At least Education, HRMS, Inventory plus a non-ERP domain use same components without style drift | Component import inventory + screenshot diff/equivalence checks |
| Package integrity | All referenced assets load, examples build, tests run from clean install, no missing fonts/licenses | Clean-environment build/test output |

**Visual comparison:** Use the Education app as a **candidate**, not certified baseline until it passes inspections. Record approved screenshots per viewport, theme, density and component state with a baseline version, deterministic fixture data, stable fonts/viewport and reasonable tolerances. Pixel diffs alone do not prove usability; browser assertions plus accessibility and behavioral tests remain mandatory. A baseline change requires design review, not silent snapshot updates.

**Report schema (example):**

```yaml
uabConformanceReport:
  specification: '2.0-design-lock+enforcement-amendment-1'
  app: 'sample-domain-app'
  mode: 'synthetic-local-prototype'
  tests:
    - gate: token-compliance
      status: NOT_TESTED
      evidence: []
      notes: 'Example only; no validation has been run.'
  exceptions: []
  certified: false
```

## C8. Progressive delivery and implementation boundary

**Documentation layer:** The Markdown contract defines expectations and reproducible validation criteria; the existing 28 locks remain intact. **Reference implementation layer (future):** typed components, token files, metadata adapters, deterministic fixtures, stories and test helpers. **Verification layer (future):** lint/typecheck/unit/integration/browser/a11y/screenshot tests and recorded pass/fail outputs. **Production layer (separate):** actual multi-tenant auth, durable persistence, event/workflow runtime, connectors, incident recovery and security reviews. Never claim a later layer is complete because an earlier one was written.

**Amendment acceptance criteria:** Every locked geometry/token above is explicitly represented; no previous lock is reversed; each universal component has a registry family; domain-independent scenarios and evidence-based gates exist; exact previously unresolved theme values remain marked proposed/unresolved; the original design remains readable without this appendix. This addition is a specification-hardening change, not a new installed skill or product deployment.
