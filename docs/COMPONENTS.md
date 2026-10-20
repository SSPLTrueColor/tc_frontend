# Components — what to use, and when

Rule: **a page never writes raw `<input>`, `<textarea>`, `<table>` or `className="btn …"`.** ESLint fails the build if it does
(`eslint.config.js`; the only table exceptions are listed there). Open **Settings → Demo → Component Gallery** (`/admin/component-gallery`)
to see every component in every state. If a page looks different from the gallery, the page is wrong.

Spacing is `var(--sp-1…6)` (4 · 8 · 12 · 16 · 24 · 32 px) only. Colours come from tokens (`src/tokens/tokens.css`); raw `#hex` / `rgb()` is allowed only in `tokens.css`
(and print layouts such as the quotation PDF). Font sizes: `--fs-primary` 18, `--fs-secondary` 16, `--fs-supportive` 13.

## Actions

| Component | Import | Use it for | Rules |
|---|---|---|---|
| `Button` | `primitives/Button` | Anything that does something | `variant`: `primary` (filled, **one per page / dialog**, always the last button on the right), `secondary` (default), `ghost` (quiet, e.g. "Clear"), `danger` (delete / discard). `icon`, `loading` (spinner + disabled), `disabledReason` (greys it out **and says why**). Default size is 32 px (`size="default"` = 40 px for form footers). |
| `IconButton` | `primitives/Button` | Icon-only actions (edit, close, row actions) | Needs `label` (tooltip + accessible name). `variant`: `ghost` / `secondary`. `pressed` for toggles. |
| `LinkButton` | `primitives/controls` | Navigation that looks like a button ("Open order", "Back to ticket") | Same variants as `Button`. Use a plain link (`rel-link`) inside text. |
| `FileButton` | `primitives/controls` | "Upload" / "Replace" | A button wrapped around a hidden file input. |
| `Menu` / `Popover` | `primitives/overlay` | Secondary actions behind "⋯"; filters | More than 2 secondary actions → put them in a ⋯ menu (Hick's law). |

## Fields

| Component | Use it for | Notes |
|---|---|---|
| `TextField` | text, number, email, tel, time | 40 px in forms. `dense` = 32 px for toolbars and table cells. `invalid` sets the error look. Never mix 32 and 40 px in one row. |
| `SearchInput` | List and table search | Always `type="search"`, always dense. Give it an `aria-label`. |
| `Textarea` | Multi-line text | Same look as `TextField`. |
| `Checkbox`, `Radio` | Many-of / one-of choices in a form | Wrap in `<label className="check">`. |
| `Switch` | An instant on / off | `label` is the accessible name; `text` is an optional visible caption. Saves immediately, so show a toast. |
| `SegmentedControl` | 2–5 exclusive choices shown together (view mode, period, method) | More than 5 → `SelectMenu`. Options can carry an `icon` and a `title` tooltip. |
| `SelectMenu` / `MultiSelectMenu` | Pick from a list | `searchable` above ~8 options. |
| `DatePicker` / `DateRangePicker` | Dates and ranges | Never a native date input. |
| `SettingsField` | Label + control + helper / error | Label above, helper **or** error below (an error replaces the helper). Validate on blur, again on save. |

## Status and feedback

| Component | Use it for | Rules |
|---|---|---|
| `StatusChip` | The status of a record or request | Tone from `domain/statusTones.ts` (or the master value). **success** finished · **warning** waiting / due soon · **danger** failed / rejected / overdue · **info** in progress · **neutral** inactive / withdrawn · **accent** highlight. Never invent a local status → tone map. |
| `Badge` | A count or a label (not a status) | "3 extra", "Customised". |
| `InlineAlert` | A message about the whole page or form | `info`, `success`, `warning`, `danger`. |
| `useToast()` | The result of an action | Success after save; `'danger'` on failure. Toggles save at once and toast. |
| `EmptyState` | A list with no rows | Say what goes here, and offer the action that creates the first one. |
| `ErrorState` | A load that failed | Always with a Retry. |
| `NoAccess` | A page the role cannot open | |
| `Skeleton`, `SkeletonLine`, `SkeletonBlock` | Loading | Build the placeholder in the **same frame** as the real content so nothing jumps. One pulse, respects reduced motion. |

## Tables and lists

| Component | Use it for |
|---|---|
| `DataGrid` (via `ResourcePage`) | Lists of records (views, filters, bulk actions, row actions). |
| `DataTable` | A computed list: sortable headers, optional search, one pagination, loading / error / empty / no-match states. |
| `Table` | A short static table (facts, matrix). No sorting or paging. |
| `Pagination` / `usePaged` | The **only** list footer: "1–25 of 140 leads", numbered pages, rows per page. |

A list page is always: **filter bar → table → pagination**.

The filter bar is drawn by `DataTable` in one order: **search · `filters` · "Clear filters" ………… `summary`**. Pass `filters` (the dropdowns), `activeFilters` + `onClearFilters`, and `summary` ("12 orders"). `ListPage` (`components/shell`) is the page frame around it: header → optional KPI strip / tabs (`kpis`) → table.
Reports: every report page has `ReportSwitcher` (left rail, or a dropdown on narrow screens) plus previous / next buttons; `/reports` opens the last report used, `/reports?all=1` is the catalogue, and `/reports/<category>` opens that category's first report.

## Overlays

| Component | Use it for | Rules |
|---|---|---|
| `Dialog` | A short task (title, body, footer actions) | Primary action last. Closes with Cancel / Esc. |
| `Drawer` | A longer form or a record | |
| `confirmDelete({ title, message, tone, typedWord, onConfirm })` | **Anything that deletes, removes, discards or cannot be undone** | `tone: 'danger'` (default) or `'primary'` for a plain yes / no. `typedWord` makes the user type a word (reset all data, sign out everywhere). `onConfirm` may be async: spinner, stays open on failure. |

## Pages

| Component | Use it for | Rules |
|---|---|---|
| `PageHeader` | Page title | Title is shown in the top bar (never scrolls away). Detail and nested pages add a breadcrumb. One line of description, then actions on the right: **one primary action per page**. |
| `SettingsPage`, `SettingsSection`, `SaveBar`, `DangerZone`, `ToggleRow` | Every Settings page | See `docs/SETTINGS-QA.md`. Forms save with the SaveBar (appears only when dirty, warns on leaving); toggles save instantly; reset / delete live in the Danger zone. |
| `useUnsavedGuard(dirty)` | Any form | Warns on refresh and on in-app links while there are unsaved changes. |

## Click-saving patterns (apply on every list)
Inline edit in table cells · quick-create at the top of the list · row actions on hover · bulk actions on selection · remembered filters and last-used values · keyboard shortcuts for the frequent actions (shown in tooltips).

## Adding a component
1. Check the gallery: does one already do this?
2. Put it in `src/components/primitives/` (generic) or `src/components/<area>/`.
3. Add it to the gallery page in every state, and to this file.

## List page layout (one rhythm for every list)

Every list — menu lists (`ResourcePage`) and computed lists (`ListPage` + `DataTable`) — uses the same vertical rhythm, set once in `app.css` (`.page-resource .page-main > …`):

| Block | Size |
|---|---|
| top padding | 12 |
| description row (`page-intro`, actions on the right, at most one primary button) | 32 |
| gap | 8 |
| KPI cards (`KpiStrip`, `.rp-kpis`) | then 12 |
| tabs / saved-views row (full width, 1 px line under it) | 44 |
| filter row (search · Filters · page-specific tools · count · columns) | 48 |
| table — full width, no radius, rows scroll inside | fills the page |
| footer — count on the left, page numbers + rows per page on the right | pinned to the bottom |

Build a computed list as `<ListPage title description actions kpis>` → `<DataTable …/>`. Put tabs and `KpiStrip` in `kpis`; put date / period / person pickers in `tools`; put filters in `filters`. For bulk actions pass `selection` (page-controlled, with `canSelect`). Do not wrap the table in your own `content-surface` or `page` div.
