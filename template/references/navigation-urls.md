# Navigation, Context, URL & Workspace Shell
## Regions
`IconRail | ContextSidebar | WorkspaceCanvas | Optional RecordInspector`.
Rail carries modules, organization switching, global search, inbox, AI entrypoint and settings. The resizable second sidebar holds module pages, shortcuts, user/group pins, hierarchical pages and saved views; 34px Balanced row density. Main canvas shows views, forms, dashboards, pages and operations. Inspector uses Quick Peek/Edit/Full Detail and shares the same record service.

## Behavior
- Sidebar groups can be personal, team, organization; pinned pages/views have ownership and visibility, with permission-aware filtering.
- Persist per-user rail shortcuts, pin ordering, sidebar width/collapse, navigation density, recent/favorite pages and selected defaults. Settings Service resolves policy locks.
- On mobile display a navigable drawer and full-width details; do not clip overlay menus or trap focus inside nonmodal inspectors.
- Page headers have no breadcrumb row (owner decision); hierarchy is shown by the sidebar selection, and detail pages offer an explicit Back action that preserves return state. Global Command Palette uses Command/Ctrl+K, with filtered pages, records, views and permitted actions.

## URL contract
Proposed pattern: `/o/:orgSlug/w/:workspaceSlug/:module/:resource`, optional `/:recordId`; views use `?view=:viewKey`, table filters use shareable query parameters, inspector selection may use `?peek=:recordId`. Personal alias `/u/:userSlug/my-work` resolves to a *permitted* workspace destination. Never use a slug or query param for authorization: resolve immutable tenant/org/workspace/user IDs server-side.

Define slug uniqueness, rename redirects, unavailable routes, cross-tenant non-disclosure, record-not-found vs unauthorized responses, browser Back/Forward, direct refresh, view deletion and stale links. Avoid leaking private filters in public URLs. Preserve unsubmitted edits across contextual navigation.
