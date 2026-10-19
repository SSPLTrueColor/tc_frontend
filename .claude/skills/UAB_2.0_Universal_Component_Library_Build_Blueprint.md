---
title: UAB 2.0 — Universal Component Library and Domain Experience Factory
version: "1.0-build-blueprint"
date: "2026-10-14"
status: "Implementation blueprint; not an additional locked design approval"
authoritative_design_source: "UAB_2.0_Master_Specification_Enforced.md"
product: "Universal Admin Builder"
---

# UAB 2.0 — Universal Component Library & Domain Experience Factory

> **EXECUTION INSTRUCTION FOR AN AI BUILDER / ENGINEERING TEAM**  
> Build a reusable, tested, configurable **Soft Enterprise** component library, a domain-independent administrative application runtime, and executable **domain experience packs**. The authoritative functional and visual contract is `UAB_2.0_Master_Specification_Enforced.md` (all 28 locked areas plus enforcement amendment). **Read that document completely before implementation** and record deviations. This blueprint operationalizes it; it does not modify any locked decision. Do not claim the library is finished merely because this Markdown exists. Do not create only screenshots or a static theme template. Deliver running software, test evidence, example domains, and versioned artifacts.

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

## 1. Product thesis

**One kernel, one design language, many domain-specific experiences.** Think of premium admin-panel templates, but replace copied domain demos and hand-authored feature silos with a configurable runtime and reusable components. A user selecting `education`, `healthcare-operations`, `manufacturing`, `jewelry`, `matrimonial`, or a **new unknown domain** should get a coherent operational application with appropriate modules, pages, field schemas, workflows, navigation, role-based views, realistic clearly synthetic linked data, and working permitted interactions. The same Soft Enterprise shell, design tokens, accessibility and primitives underpin all output.

**Domain-specific does not mean superficial re-skinning.** Domain packs may define information architecture, terminology, field metadata, validation, relationships, status lifecycles, specialized approved compositions, dashboards, default views, policies, automations, example stories and data. Domain packs must not fork the core button, field, grid, inspector, navigation, permission or event semantics. A healthcare screen is not a school screen with labels changed.

**Delivery modes:** (1) preview/demo with explicitly synthetic state, (2) real API-backed configured application, (3) production platform with identity, server RBAC, workflows and audit. User must be able to tell which mode is active. No pretend transactions, diagnosis, payments, appointments, message sends, agent actions or authorizations.

**Out of scope:** inventing a compulsory product offering for every customer; standalone API-management product console; claiming medically regulated software certification; copying commercial templates/assets without rights; replacing an existing brand or codebase without authorization.

## 2. Source-of-truth and precedence

1. Security, privacy, applicable law and accessibility obligations.
2. Explicit project requirements, existing verified brand and technical constraints — **including the Owner overrides (rules 1–34) above, which win over the master specification's locked values.**
3. Approved `UAB_2.0_Master_Specification_Enforced.md` — **locked requirements**.
4. This implementation blueprint — **engineering instructions**, not a new lock.
5. Domain-pack metadata — domain content and legitimate composition choices.
6. Engineer/AI preferences — only where unspecified.

Tag choices as **LOCKED** (directly in master spec), **PROPOSED** (new recommended defaults, subject to approval), **DERIVED** (logical consequence), or **DOMAIN** (specific to a pack). Maintain `docs/decision-ledger.md` with source/justification and explicit authorized deviations. Never silently invent new locked token values.

## 3. Target architecture: reusable, not copied

```text
@uab/tokens                 -> generated CSS variables, JSON tokens, TS exports
@uab/primitives             -> accessible buttons, inputs, dialog, menu, overlay, tooltip
@uab/composites             -> fields, search, filter builder, View Bar, data cells, toolbars
@uab/shell                  -> IconRail, ContextSidebar, Workspace, Inspector, responsive shell
@uab/resource-runtime       -> metadata-based CRUD, Grid, Form, Details, relationships, views
@uab/workspace-experiences  -> dashboards, work inbox, tasks, calendar, files, communications
@uab/config-studio          -> resource, master, form, view, page and workflow configuration
@uab/domain-sdk             -> declarative schemas, views, flows, mock factories, validators
@uab/domain-education      -> school operations experience pack
@uab/domain-healthcare     -> administrative care operations pack (no clinical claims)
@uab/domain-manufacturing  -> production and plant operations pack
@uab/domain-jewelry        -> inventory, lot and sales operations pack
@uab/domain-matrimonial    -> matchmaking administration pack with sensitive-data protection
@uab/domain-unknown        -> generic metadata-only pack used for universality test
apps/storybook              -> component explorer with live states and interaction stories
apps/domain-showcase        -> picker + runnable domain demos on common runtime
apps/golden-education      -> visual benchmark and complete vertical walkthrough
packages/test-kit           -> contracts, a11y, visual snapshots, domain fixtures
```

Implement in a monorepo with package boundaries and typed public exports. **Proposed stack, not locked:** React + TypeScript + Vite for showcase and Storybook; accessible headless foundations where practical; TanStack Table/virtualization for large grids; Playwright + axe for UI testing; Vitest for unit/contracts; MSW or equivalent for mocks. Existing repositories may use other approved frameworks. Tokens, schemas and contracts should be transportable, not inextricably tied to a React implementation. Avoid custom building accessible combobox/dialog primitives when a mature accessible base can serve them.

### 3.1 Five logical layers preserved

- **Foundation:** tenancy, identity, org/workspace graph, RBAC, field schema, storage, audit.
- **Execution/integration:** event outbox, durable orchestration, connector adapters, agent gateway.
- **Shared services:** work, scheduling, documents, communication, search, reporting, notification.
- **Configuration:** manifests, masters, forms/views/pages, policies, versioned publish.
- **Experience:** navigation, resource surfaces, dashboard, inspector, configuration studio.

Do not create separate deployed microservices merely because these layers exist. Support preview with test adapters, but production adapters must enforce server-side invariants.

## 4. Canonical Soft Enterprise tokens — no visual improvisation

All components consume primitive → semantic → component tokens. No duplicated magic numbers in domain packs. The following values are **LOCKED** from the master specification unless a specific note says otherwise.

```yaml
uab:
  visualLanguage: Soft Enterprise
  iconography: { family: Lucide-style, defaultSize: 16px }
  layout:
    iconRail: { minWidth: 56px, maxWidth: 64px, recommendedWidth: 60px }
    contextSidebar: { defaultWidth: 240px, resizable: true }
    navigationRow: { height: 34px, fontSize: 13px, iconSize: 16px }
    viewBar: { minHeight: 38px, maxHeight: 42px, variant: underline, addViewVisible: true }   # OWNER OVERRIDE rules 3/7: underline tabs 32px (icon + name), icon-only "+", tabs line + tools line
    inspector: { defaultWidth: 480px, expandedMin: 680px, expandedMax: 760px }   # OWNER OVERRIDE rule 28: 560px modal side drawer, no ×, footer Cancel · Edit
  controls:
    height: { compact: 36px, default: 40px, touch: 44px }   # OWNER OVERRIDE rule 7: compact = 32px
  typography:   # OWNER OVERRIDE rule 8: exactly three sizes
    { primary: 18px, secondary: 16px, supportive: 13px }
  radius: { control: 7px, panel: 12px, dialog: 14px }
  iconRailSkins:
    softCharcoal: { background: '#24252D', icon: '#AAAAB7', selectedBackground: '#3B354F', selectedIcon: '#CFBFFF' }
    midnightNavy: { background: '#1C2535' }
    graphiteBlack: { background: '#15161A' }
    softLight: { scheme: light-neutral }
  interaction:
    persistentQuickComment: true
    quickCommentPlacement: inspector-bottom-every-tab
```

### 4.1 Incomplete tokens — define, test, propose, approve

The locked specification does **not** provide a fully complete semantic palette, typography scale, shadows, spacing steps, breakpoints, focus ring, field padding or every state color. Create a complete proposed tokens file, with separate status annotations. Suggested *starting values for review only*: spacing base 4px, body font 14px, muted 12px, title 20px; never call these approved solely because they are here. Choose fonts available to the app without distributing restricted font binaries. Use neutral accessible palette and low-shadow surfaces; contrast-test every state. Maintain `tokens/locked.json` separate from `tokens/proposed.json`. Compile to CSS custom properties, JSON, TS and visual token documentation. Run token linting against all packages.

### 4.2 Token lifecycle and themes

Themes = semantic mapping on stable primitives. Theme variations may adjust neutral/accent palette and rail skin; they may not change control heights, default component anatomy or interaction contracts without an explicit variant. Include light/dark/high-contrast/reduced-motion modes, loading/hover/focus/active/selected/disabled/error/success/warning states. Theme tests: contrast, focused and hover state visibility, no unstyled flash, OS preference and persisted choice.

## 5. Canonical application shell contract

```text
ApplicationViewport
├── GlobalIconRail          [desktop 56–64px; default Soft Charcoal; no indicator bar beside the active icon — rule 32]
│   ├── Organization/workspace switch
│   ├── Pinned module icons
│   ├── Global search/command entry
│   ├── Work Inbox / notifications
│   ├── AI entry (where enabled)
│   └── Settings/profile
├── ContextSidebar          [default 240px resizable; 34px balanced rows]
│   ├── Module title / quick create
│   ├── Module resource hierarchy
│   ├── Saved views and personal/team/org pins
│   ├── Collapsible subgroups
│   └── (Collapse toggle in the sidebar header, top — owner override rule 10)
├── WorkspaceCanvas         [fluid, scroll ownership explicit]
│   ├── (Top bar: page title + ⓘ tooltip left, global search centre — no breadcrumb row)
│   ├── Line 1: ViewBar (underline tabs with a sliding underline, icon-only "+", full-width line under it) + Export + primary action — rules 3, 11, 18
│   ├── Line 2: search · Filters ⌄ · Columns ⌄ — rule 25
│   ├── Filter-chip line + bulk actions on its right — rule 22
│   └── Grid (frozen pagination footer, rule 5), board, calendar (fills the screen, rule 31), form, report, dashboard or page
└── OptionalRecordInspector [480px/expanded; full-width mobile]   ← OWNER OVERRIDE rule 28: modal 560px side drawer over a backdrop (portal), header = top-bar height, no ×, footer Cancel · Edit
    ├── Record header/actions
    ├── Details / Related / Activity / Comments
    └── ONE persistent QuickComment at bottom of EVERY tab
```

Behavioral requirements: deep-linkable org/workspace/module/resource/view/record; browser Back/Forward; persisted sidebar width and selection by authorized identity; permission-filtered nav; keyboard and screen-reader landmarks; sensible overflow and overlays; mobile off-canvas context nav and full-width inspector; no unusably narrow canvas forced by desktop rail+sidebar. Personal URL routes resolve to authorized IDs; slugs are not permission checks.

## 6. Component registry: required build coverage

Each registered component must have (a) typed props, (b) token references, (c) visual anatomy, (d) variants and states, (e) keyboard/focus semantics, (f) role/permission implications if any, (g) responsive contract, (h) unit/interaction/a11y tests, (i) golden stories/screenshots, (j) mock/live boundary and (k) known limitations.

### 6.1 Primitives

*(Owner override — rules 9, 12, 13, 14, 15, 23, 24, 26, 30: build and use the shared `SelectMenu`, `MultiSelectMenu`, `DatePicker`, `DateRangePicker`, global `TooltipLayer`, `InfoTip`, `DateText`, `EmptyValue`, `OverflowChips`, `FadeScroller` and `confirmDelete`/`ConfirmHost`; never native `<select>`, date inputs, `title` tooltips or `window.confirm`.)*

`Button`, `IconButton`, `Input`, `Textarea`, `Select`, `Combobox`, `Checkbox`, `Radio`, `Switch`, `DatePicker`, `TimePicker`, `NumberInput`, `MoneyInput`, `FilePicker`, `Badge`, `StatusChip`, `Avatar`, `Tooltip`, `Popover`, `Menu`, `Dialog`, `AlertDialog`, `Drawer`, `Sheet`, `Toast`, `Tabs`, `Breadcrumb`, `Progress`, `Skeleton`, `Spinner`, `EmptyState`, `ErrorState`, `Pagination`, `Separator`, `Surface`, `Stack`, `GridLayout`. Every icon-only control has a name and discoverable tooltip where appropriate. No dead controls.

### 6.2 Shell and navigation

`IconRail`, `ContextSidebar`, `ModuleNavigationGroup`, `PinnedNavigation`, `WorkspaceHeader`, `Breadcrumbs` *(not used on pages — rule 1)*, `ViewBar`, `ViewTab`, `AddView`, `GlobalSearch`, `CommandPalette`, `OrganizationSwitcher`, `WorkspaceSwitcher`, `WorkInboxEntry`, `NotificationBell`, `ResponsiveNavigationDrawer`.

### 6.3 Resource runtime and data surfaces

`UniversalDataGrid`, `DataGridToolbar`, `ColumnManager`, `AdvancedFilterBuilder`, `FilterChip`, `SortBuilder`, `GroupBuilder`, `RowActions`, `BulkActions` *(on the filter-chip line — rule 22)*, `CellRendererRegistry`, `SavedViewManager`, `BoardView`, `CalendarView`, `TimelineView`, `GalleryView`, `RecordInspector`, `RecordDetail`, `RelationshipPanel`, `ActivityTimeline`, `CommentThread`, `QuickComment`, `AttachmentsPanel`, `AuditDiff`, `EntityReference`, `InlineEditableCell`.

**Seven required row variants:** dense, two-line, rich, tree, grouped, master-detail, responsive/mobile. **Ten typed-renderer categories:** text, number/decimal/money, date/time, boolean, status/master, person, relation, media/file, progress/metric, compound summary (extend via typed plugin registry, not one-off layout forks). Respect masks, nulls, units and locale.

### 6.4 Forms, configuration and workspace experiences

*(Owner override — rules 27–29: section titles hidden, no number spinners, affixes inside inputs, fields 1→2→3 per row by container width; every dialog/drawer closes with a footer Cancel and has no ×.)*

`QuickCreate`, `FormDrawer`, `FullPageForm`, `WizardForm`, `InlineEditForm`, `Repeater/LineItems`, `FormFieldRenderer`, `ConditionalSection`, `FormErrorSummary`, `UnsavedChangesGuard`, `PageBuilderCanvas`, `PageTemplateRegistry`, `WidgetRegistry`, `DashboardGrid`, `MetricCard`, `ChartWidget`, `ReportBuilder`, `TaskBoard`, `WorkItemInspector`, `CalendarScheduler`, `AvailabilityGrid`, `ApprovalInbox`, `WorkflowCanvas`, `EventTrace`, `ConnectorStatus`, `ImportMappingWizard`, `ExportRequest`, `MasterValueManager`, `ResourceStudio`, `PermissionMatrix`, `RoleEditor`, `EffectiveAccessPreview`, `AuditLogViewer`, `ThemeStudio`, `HelpDrawer`, `OnboardingTour`.

### 6.5 Optional governed AI communication experience

`ConversationWorkspace`, `MessageBubble`, `HumanVsAgentIdentityBadge`, `MentionComposer`, `AgentActionProposal`, `ApprovalCheckpoint`, `EmbeddedLearningActivity`, `ContextualCompanionPanel`, `AgentTraceSummary`. Agents never silently impersonate users or claim to have acted when only suggesting. These are **proposed experience components**, not retroactively locked additions.

## 7. Reference behavior contracts (must be implemented, not sketched)

### 7.1 View Bar / saved views

~~Underline tabs 38–42px~~ **32px underline tabs (icon + name, 2px accent underline on the active one, ⋮ on hover) on line 1 with the primary action and a full-width line under them; tools on line 2; icon-only "+" after the last tab; Add/Rename/Duplicate as anchored panels; delete confirmed first** *(owner override — rules 3, 11, 18, 30)*; visible `+`; list/board/calendar/timeline/gallery modes where relevant; personal/team/org ownership; rename/duplicate/reorder/default/share/pin with scope permissions; selected view reflected in link and persisted by actor. Save view definitions with filter/sort/group/columns/density/visibility and validated resource version. Unauthorized shared views must not leak records.

### 7.2 Data Grid / filters / column manager

*(Owner override — rules 4, 5, 13–17, 20–22, 25, 26: table look, frozen pagination footer, tooltips on truncation, "16 Oct, 2026" dates, "N/A" empties, left-aligned columns, borderless table (row lines only), clean white header row with one bottom line, plain titled table expansion (no card), "+N" chips, bulk actions on the chip line, simple Filters form panel with Apply + Advanced conditions, multi-select with checkboxes.)* Use one metadata schema for typed cells, sort/filter operators, masked display, export and inline edit. Server query adapter performs sorting/filtering/grouping/pagination/aggregation for real large data; test virtualization where applicable. Advanced typed AND/OR filter groups, relative dates and dependent master values. Column manager can search, pin, resize, reorder, hide and restore; persist per view and identity. Sticky action columns remain operable; keyboard selection and bulk actions obey RBAC.

### 7.3 Record Inspector / communication

~~Right-side 480px nonmodal inspector~~ **Modal 560px side drawer over a dimmed backdrop, opened exactly like the edit drawer: header = top-bar height with the 18px title + status chip and prev/next/expand/full-page/pin icons, no ×, footer Cancel · Edit (Cancel · Save changes while editing)** *(owner override — rule 28)*; optional expand 680–760px; Details/Related/Activity/Comments. Exactly one bottom persistent `QuickComment` composer across **all four tabs**, including Comments. Tab switch must not erase draft or duplicate composer. Reply, mention, attach and external-send operations are controlled by actor/channel permissions. Display internal versus external labels clearly. Deep link and previous/next record behavior verified.

### 7.4 Form Builder

Drive QuickCreate, FormDrawer, FullPageForm, WizardForm, Repeater and InlineEdit from **canonical versioned field definitions**. *(Owner override — rule 9, 23, 24, 26–29: custom dropdowns / date pickers, help only in ⓘ, hidden section titles, no spinners, inside affixes, responsive 1→2→3 columns, no × and footer Cancel)* Support all required field types, labels/help, defaults, required/nullable, computed, conditional visibility, dependent masters, cross-field validation, number/money units, date/time and timezone, relations, attachments, line items, sensitivity, field masks, optimistic concurrency and drafts. A user toggling visibility does not change data sensitivity. Validators run locally for UX and authoritatively on server in API/live mode. Wizard can move back/forward while preserving input; submit must reject stale version/duplicate commits. Successful create appears consistently in grid, inspector, search and related views.

### 7.5 Workflow and agents

Represent state machines and EDA events as versioned types; durable outbox + idempotency for live mode. Workflow approvals never equal task completion. Human signoff required for protected actions; AI action suggestions visibly distinguish proposal → approved → executed. In preview mode simulate with an explicit banner and immutable test event history, not fake production execution.

## 8. Domain Experience Pack contract

The domain pack is **executable configuration**, not a folder of screenshots. Each pack exports:

```ts
type DomainPack = {
  id: string; version: string; label: string; description: string;
  capabilities: string[];
  modules: ModuleDefinition[];
  resources: ResourceDefinition[];             // canonical typed fields
  relationships: RelationshipDefinition[];
  masters: MasterDefinition[];                 // immutable value keys
  lifecycles: StateMachineDefinition[];
  roles: RoleDefinition[];                      // sample permissions
  navigation: NavigationDefinition;             // consistent UAB shell
  views: ViewDefinition[];                      // list/board/calendar/etc
  forms: FormDefinition[];                      // bindings to resource schema
  pages: PageDefinition[];                      // approved layout templates
  dashboards: DashboardDefinition[];
  workflows: WorkflowDefinition[];             // versioned; simulation-safe
  eventSchemas: EventSchemaDefinition[];
  demoFactory: (seed: number) => DemoDataset;   // deterministic, linked data
  demoJourneys: TestJourney[];
  dataSensitivityPolicy: SensitivityPolicy;
};
```

`*Definition` types must be strongly typed with runtime validation; this block expresses the required shape, not ready-to-compile code. Pack identity and field IDs remain stable independent of labels. Production policy supplied by organizations supersedes illustrative demo roles.

### 8.1 Pack generation pipeline

1. **Select domain and operational scope.** Example `manufacturing / discrete assembly / production + inventory`, not just “manufacturing.” For vague inputs, generate a clearly labeled representative demo scope; do not imply all sector processes exist.
2. **Create capability map.** Outcomes, actors, jobs to be done, resources, relationships, masters, lifecycles, guarded actions and approvals.
3. **Generate domain manifest.** Typed schemas + UI bindings + RBAC + workflows + events + settings.
4. **Resolve layouts via component registry.** Choose appropriate grids, forms, boards, calendars, timelines and dashboards. Reuse tokens; do not fork base components.
5. **Seed realistic deterministic synthetic data.** Referentially valid, culturally neutral names where feasible, no real patient/student/member private data. Seed makes meaningful empty, active, blocked, overdue and completed states.
6. **Build task-oriented page flow.** Overview → list/view → filters/record → edit/action → event → inbox/report. Include creation and correction/exception flows, not only happy path.
7. **Run universal and domain-specific checks.** Permission-safe navigation, functional CRUD where supported, visual baselines, a11y and event invariants.
8. **Present a domain showcase.** Explain what is operational, simulated or excluded; export manifest and tests.

### 8.2 Domain matrix — different business meaning, same UAB design

| Domain | Representative modules/resources | Domain-specific visuals/flows | Sensitive or special concern |
|---|---|---|---|
| Education | Students, Guardians, Classes, Sections, Timetable, Attendance, Fees, Staff | Student detail with linked attendance/fees; teacher class register; fee collection review | Minor data, guardianship and teacher/finance scopes |
| Healthcare operations | Patient registry, Appointments, Staff, Rooms, Billing, Referral Queue | Scheduling board, capacity/room allocation, check-in status | Health-data sensitivity; **no clinical diagnosis or certification claims** |
| Manufacturing | Work Orders, BOM, Machines, Production Runs, Quality Inspections, Inventory | Production board, machine availability, lot tracing, defect workflow | Traceability and quality signoff; scheduling capacity |
| Jewelry | Catalog, Metal Lots, Stone Lots, Orders, Workshop Jobs, Certificates, Sales | Variant/attribute details, weight/purity fields, certification documents, job stages | Precise units/pricing, inventory chain of custody |
| Matrimonial | Profiles, Matching Preferences, Consent, Match Queue, Interactions, Moderation | Consent-gated profile search, match board, private messaging, review queue | High sensitivity, consent, abuse reporting; **no demographic profiling defaults** |
| CRM | Leads, Accounts, Contacts, Opportunities, Activities | Pipeline board, account relationship inspector | Customer segmentation and outbound permissions |
| HRMS | Employees, Teams, Leave, Payroll Summaries, Approvals | Org-aware people grid, leave calendar, confidential fields | Salary masking and employment privacy |
| Inventory | Items, Warehouses, Stock Movements, Reorder Rules | Quantity/status cells, warehouse filters, stock transfers | Transaction integrity and prevention of negative stock |
| Legal operations | Matters, Contacts, Deadlines, Documents, Time Entries | Matter timeline, deadlines calendar, versioned documents | Privilege and confidentiality |
| Nonprofit | Programs, Beneficiaries, Cases, Grants, Volunteers | Case queue, outcomes dashboard, grant milestones | Beneficiary protection |
| Custom unknown | User-supplied resources/relationships/flows | Registry-derived list/form/inspector with no hardcoded modules | Infer nothing sensitive; force explicit policies |

These are **demonstration scopes**, not claims that each pack implements a complete certified ERP for its sector.

## 9. Golden reference apps and minimum end-to-end stories

### 9.1 Education reference — primary visual benchmark

Build and visually certify:
- Dashboard (teacher/admin/finance variants) with meaningful data and compact widgets.
- Students directory with View Bar, filters, column manager, density, bulk actions, create and edit.
- Student Inspector with Related (class, guardian, attendance, fees), Activity, Comments and persistent Quick Comment.
- Classes and timetable calendar; attendance marking with guardrails.
- Fees list with outstanding/paid statuses and role-restricted finance details. **No pretend payment processing**.
- Tasks/Inbox/notifications, workflow approval example, permission preview.
- Resource/Form/Master configuration studio with draft → validate → preview → publish in mock or real mode according to capabilities.
- Design System Studio with live token values, component variants and test status.

**Golden journey EDU-01:** Switch Admin → Students → search/filter → open Inspector → switch all tabs while retaining draft comment → create student via validated form → confirm list and detail consistency → teacher role loses finance-only fields → open permitted deep link after reload → inspect audit/event summary where implemented. Each step records screenshot and automated assertion.

### 9.2 Other reference journeys

- **HC-01:** Receptionist schedules a room-bound appointment, detects overlap, reschedules, confirms calendar visibility; doctor-only fields inaccessible to receptionist.
- **MFG-01:** Planner creates work order from BOM, assigns line, quality inspector records outcome, authorized approver releases batch; double submission does not double-post movements.
- **JEW-01:** Register lot with purity/weight unit, create workshop job, trace lot to finished product and certificate; unauthorized role cannot alter valuation.
- **MAT-01:** Candidate creates consent-gated profile, matching operations proposes shortlist, recipient visibility respects consent, reviewer can block/report; private contacts never appear in public search.
- **CUSTOM-01:** Load arbitrary resources `Exhibitions`, `Artifacts`, `Loans`, `Conservators` with new masters; generate navigation/list/create/filter/inspector without changing shared component code.

### 9.3 Golden stories per component

Every component has at least: default, compact, disabled, loading, empty, error, populated, keyboard focus, hover/selected, mobile/overflow and relevant permissions. The Record Inspector also needs draft-preservation and Comments-tab-no-duplication stories; Form Builder needs conditional fields, invalid submission, draft return, conflict; navigation needs collapsed/resized/pinned/forbidden/deep link stories.

## 10. Quality gates — release fails on unverified critical behavior

| Gate | Pass criterion | Evidence artifact |
|---|---|---|
| G01 Document traceability | All 28 locked areas mapped to component/package + tests or explicit not-yet-implemented | `coverage/locked-decisions.csv` |
| G02 Token compliance | Approved constants match source; no unreviewed values in shared UI; contrast audited | token diff + lint |
| G03 Shell fidelity | Rail, sidebar, View Bar and Inspector anatomy/dimensions correct at target viewports — measured against the **Owner overrides** (rules 1–34), not the superseded locked values | DOM measurements + screenshots |
| G04 Component contract | Required states, behavior and no duplicate Quick Comment | Storybook + interaction tests |
| G05 Form/schema coherence | Same typed field controls grid/form/filter/search/inspector with masking; validates | contract tests |
| G06 Navigation/deep link | Browser Back/Forward/reload, org/workspace scoped routes, selection persistence | Playwright |
| G07 Responsive | 1440px desktop, intermediate tablet, 390px phone; no clipped required actions | screenshots + automated assertions |
| G08 Accessibility | Axe scan, keyboard use, focus order/trap/return, zoom 200%, reduced motion | a11y logs/manual results |
| G09 Security | Backend denial for tenant/row/field/export/search/agent bypass; UI alone cannot pass | API negative tests |
| G10 Workflow/EDA | Versioned events, outbox, retries/idempotency, approval separation | integration/failure injection |
| G11 Domain independence | Education, healthcare, manufacturing, jewelry, matrimonial, and unknown pack instantiate without core forks | fixtures + scenario runs |
| G12 Data integrity | Deterministic fake data with valid IDs/relations/lifecycles; realistic failures | seeding validation |
| G13 Visual drift | Golden baseline screenshot diffs reviewed; no unauthorized component style drift | visual CI results |
| G14 Artifact quality | Packages build; exported manifests versioned; docs and changelog present | CI build and release report |

**Measurement protocol:** DOM geometry and token asserts are stricter than screenshot impressions. Screenshots alone cannot prove functional behavior. Define baseline image thresholds only after golden references are approved; review expected anti-aliasing/font/environment variation. Fail P0 invariants immediately; report P1/P2 failures with owners. Never mark blocked, skipped or mocked security as passed.

## 11. Developer experience and actual builder instructions

### 11.1 Mandatory sequence

1. Load `UAB_2.0_Master_Specification_Enforced.md`; extract exact locked decisions and pending proposals. Generate traceability matrix.
2. Inventory existing repo if provided; preserve its brands/routes/dependencies and define migration scope. Otherwise scaffold package graph in §3.
3. Author tokens: `locked`, `proposed`, `semantic`, `component` plus generated CSS/TS. Build token inspection page and tests.
4. Build primitives with accessibility and all common states; release no compositional components before primitives reach acceptance.
5. Implement shell and navigation; test both desktop and mobile before adding domains.
6. Build resource runtime against metadata schemas; implement View Bar → Grid → Filter/Column → Forms → Inspector → Quick Comment as one coherent slice.
7. Build configuration studio; draft/validate/publish must reconcile dependent views/filters/forms/workflows.
8. Add shared work, scheduling, communication, document, dashboards, workflow and AI/connector surfaces in module increments; never fake unauthorized backend outcomes.
9. Build **education** golden reference using only public packages; then add **healthcare, manufacturing, jewelry, matrimonial and custom unknown** domain packs. No copying old domain JSX into another pack.
10. Run unit, contract, interaction, Playwright, axe, screenshot and API security tests for modes supported. Capture proof and list untested behaviors.
11. Publish a versioned component library and domain-pack catalog, plus runnable domain showcase and change log; only then construct or update a skill that calls this library.

### 11.2 Anti-drift constraints for AI code generation

- MUST import approved components/tokens; do not generate bespoke `Button`, `Input`, `Modal`, `Sidebar` styles in domain code.
- MUST use domain schemas for field types/labels/options/sensitivity and lifecycle instead of conditionals such as `if (domain === 'school')` inside shared components.
- MUST maintain one authoritative record, audit and event ownership model; do not synchronize duplicate mutable truths across demo modules.
- MUST use actual layout and accessibility tests, not subjective aesthetic claims.
- MUST show controlled error/empty/loading states and document mock data.
- MUST resolve domain-specific compound components via a typed extension registry, with their own contracts and stories.
- MUST separate permissions from visual hiding. Real backend mode requires negative tests.
- MUST report unsupported business flows and any policy approximations prominently.
- MUST NOT import licensed visual assets or system font files without authorization.
- MUST apply the Owner overrides (rules 1–34) — e.g. 32px compact controls, 18/16/13px type only, 32px underline view tabs, borderless tables, no accent indicator lines, no breadcrumb, no × on popups (footer Cancel), modal record drawer, delete confirmations, custom dropdowns/date pickers, "16 Oct, 2026" dates and "N/A" empties. Verify them in G02/G03/G13.

### 11.3 Generation contract example

```json
{
  "domainPack": "manufacturing",
  "scope": ["work-orders", "inventory", "quality"],
  "mode": "preview",
  "designSystem": "soft-enterprise@2",
  "theme": "soft-charcoal",
  "seed": 4102,
  "roles": ["planner", "operator", "quality-reviewer"],
  "features": ["dashboard", "grid", "forms", "inspector", "saved-views", "workflows"],
  "output": ["runnable-app", "manifest", "scenario-tests", "quality-report"]
}
```

The example specifies a *preview*: workflows and records are synthetic, not real stock postings. Validate such requests against the pack's capability registry; report unavailable modules instead of silently pretending support.

## 12. Public component and pack compatibility contracts

Use semantic versions for `@uab/*` packages and each domain pack. Maintain minimum compatible kernel and schema version; migrations for renamed immutable IDs are forbidden without explicit mapping and approval. Component registry entries include `id`, `version`, `propSchema`, `supportedModes`, `a11yContract`, `visualContract`, `permissions`, `tests` and `deprecation`. Domain packages publish manifest, data fixture checksum, demo journeys, screenshots and known gaps. Golden screenshot updates require human approval; separate intentional visual changes from renderer noise.

## 13. Implementation milestones and release criteria

| Milestone | Deliverable | Exit condition |
|---|---|---|
| M0 — Audit | coverage matrix from locked master and repo inventory | No untracked locked components |
| M1 — Tokens/Primitives | token generator, primitive library, Storybook | Token and a11y tests pass |
| M2 — Shell | dual nav, view bar, deep links, responsive inspector | Browser shell contracts pass |
| M3 — Resource engine | schemas, grid, filters, form builder, Quick Comment, permission adapters | Education EDU-01 passes |
| M4 — Shared capabilities | dashboards, work, docs, scheduling, inbox, workflow/config | Ownership and mock/live distinctions verified |
| M5 — Domain packs | Education, healthcare, manufacturing, jewelry, matrimonial, unknown | Every listed pack/journey exercised |
| M6 — Release | packages, showcase, golden screenshots, docs, quality report | All P0 gates pass; failures disclosed |

**Minimum viable first commercializable template:** M0–M3 plus one complete domain showcase is a meaningful start. **Do not label it the full UAB 2.0 platform** until remaining approved capabilities are implemented and tested. Deliver library versions as incremental packages rather than a monolithic release promise.

## 14. Definition of done / evidence checklist

A builder delivering work against this document must provide:

- [ ] Source tree and exact build/test commands
- [ ] Component Storybook with states, sizes and interactive examples
- [ ] JSON/YAML tokens, generated CSS variables and TS exports
- [ ] Canonical application shell and configurable manifest/runtime
- [ ] Education golden example with coherent data and working actions
- [ ] At least four additional named domain packs and one unknown-domain fixture
- [ ] Deep-link, form, grid, filter, Quick Comment and role-switch test evidence
- [ ] Desktop/tablet/phone captures and accessible interaction results
- [ ] Server security evidence **or** a clearly marked preview-only status
- [ ] Event/workflow durability tests **or** a clearly marked simulation-only status
- [ ] Full 28-area coverage and deviation matrix
- [ ] Versioned releases and migration compatibility notes
- [ ] No dead UI controls or unlabelled simulated actions

### Required final status report

```markdown
# UAB Component Library Build Report
- Source reference: [master filename + checksum]
- Built packages and versions:
- Domain packs implemented:
- Actual runnable journeys:
- Design tokens: LOCKED / PROPOSED / overrides:
- Visual acceptance: passed / failed / blocked:
- Functional acceptance: passed / failed / blocked:
- Accessibility: passed / failed / blocked:
- Backend permissions: verified / simulated / not tested:
- Workflow durability: verified / simulated / not tested:
- Deviations from 28 locked areas:
- Unimplemented approved capabilities:
- Repository URL/artifacts and reproducible commands:
- Approval required before declaring golden reference:
```

## 15. Architectural decision: template vs builder vs enterprise platform

**Phase A — Template system:** reusable shell, tokens, primitives, components, compelling functional demo and a few reference packs. Distributable like premium admin templates.

**Phase B — Domain experience factory:** typed manifests + generators + deterministic data + workflows/views/forms; rapidly produce differentiated domain applications while preserving component fidelity. This is the strongest intermediate product concept.

**Phase C — Configurable platform:** secure multi-tenant runtime, backend identity/RBAC, durable EDA, connectors, imports, audit, publish governance and agents. Much greater operational and security investment. Do not confuse a beautiful template with a deployable enterprise platform.

**Commercial/IP note:** A curated library, themed application demos and domain packs may be distributed or licensed, subject to dependency, icon, asset and data-source licenses. Differentiation should come from working use-case journeys, precise visual consistency, trusted schemas, integration adapters and quality evidence—not number of example dashboards.

---

## Appendix A — Normative coverage map (all 28 locked design areas)

1. Soft Enterprise visual language → `@uab/tokens`, primitives, stories, G02/G13.
2. Icon Rail → shell skins and navigation tests.
3. Navigation & Workspace Shell → shell, URL/personal-state tests.
4. Universal Data Grid → resource runtime/grid.
5. Universal View Bar → saved views and scope contract.
6. Advanced Filter Builder → typed filter AST and validation.
7. Column Manager → search/pin/hide/reorder/resize persistence.
8. Record Inspector → single Quick Comment invariant.
9. Universal Cell/Row Presentation → renderer and row registries.
10. Universal Forms & Inline Editing → form runtime, conditional/repeater and validation.
11. Global Search & Command Palette → authorized search/deep links.
12. Notifications, Inbox & Activity → distinct work and notification ownership.
13. Workflow/Event/Automation Engine → EDA, durable workflows, audit and retry tests.
14. Dashboard, Analytics & Reporting → typed widget/metric/drill/report registry.
15. Resource, Field & Master Studio → versioned canonical metadata.
16. RBAC & Organization Permission Studio → deny-by-default server and previews.
17. Organization, Identity & Workspace → tenant/organization/workspace and memberships.
18. Page Builder & Workspace Layout → approved component templates and versioning.
19. File, Media & Document Management → library, versions, secure previews/generation.
20. Communication, Collaboration & Comments → messages, mentions, internal/external isolation.
21. Tasks, Activities & Work Management → work items and timelines; not approvals.
22. Calendar, Scheduling & Resource Planning → timezone, conflicts, capacity.
23. Integration & Connector Management → connectors/mapping/sync; no standalone API-console.
24. Audit, Monitoring & Administration → audit versus telemetry versus activity.
25. Settings, Personalization & Localization → scoped precedence/themes/locales.
26. Import, Export & Migration Studio → dry-run, dedup, security, recovery.
27. Help, Onboarding & Guidance → contextual role-aware help and verified onboarding.
28. Architecture & Design-System Consolidation → five layers, ownership, metadata, EDA, governance.

## Appendix B — First runnable demo menu

A showcase should offer a **Domain Gallery** with thumbnails and an honest capabilities label. Selecting a domain changes visible modules, sample users, resource schemas, process dashboards, terminology, relationships, sample event history and workflow journeys, **not** the underlying Soft Enterprise UI. Add `Create custom domain` to prove the generic engine does not depend on the named pack list. Demo data/reset controls are prominent, and all domain samples show `Synthetic data — preview only` unless backed by a trusted real service.

## Appendix C — Inputs required when executing this blueprint

- Authoritative master: `UAB_2.0_Master_Specification_Enforced.md` (do not proceed without it).
- Existing code/repository if any, to avoid destructive replacement.
- Requested domain and operational slice; default to Education first for golden benchmark and other packs for proof.
- Deployment mode and authentication/data-source expectations; default to nonproduction preview when unspecified.
- Brand overrides/constraints if existing; default to Soft Enterprise.
- Scope and approval for backend work, connectors, paid services and any real user information.

**Final instruction:** Build this as a **universal UI/runtime and domain-pack catalog**, not a collection of independently styled ERP clones. First certify the common parts; then prove that domain composition, workflows and data change while the design system stays consistent. Only after that build succeeds should this library be packaged into a revised UAB skill.
