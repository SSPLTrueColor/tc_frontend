# Metadata, Masters & Configuration Governance
## One canonical schema
Application -> Modules -> Resources -> Fields / Relationships / Masters. Reference those definitions from Grid, Form, Filter, Search, Inspector, Page Builder, Reports and permitted workflows. A view or form may control **presentation**, not redefine the field's storage type or security classification.

## Field contract
Specify immutable ID/key, label/localization, type, nullable/required, validation, default, computed/derived behavior, index/search/sort/filter capabilities, options/master reference, conditional visibility, sensitivity, field permissions, relationships and migration policy. Include effective-field capabilities for each actor; never trust client-only hidden fields.

## Master contract
Support status, priority, categories, dependent dropdowns, hierarchy, colors/icons, immutable value keys distinct from mutable labels, valid transitions, deactivation rather than deleting historical meanings; use structured resources for masters requiring rich domain data. Keep cross-resource dependency graph.

## Configuration lifecycle
Draft -> validate -> dependency analysis -> authorized preview/test -> publish immutable version -> monitor. Evaluate schema changes against formulas, saved views, migrations, workflows, reports, external mappings and document templates. Rollbacks validate data compatibility and may require forward migration. Disallow arbitrary code execution in configuration-driven page builders.

## Component registry
Approved typed component manifests with properties, layout constraints, allowed data bindings, permission guards, events, accessibility contract and version range. Examples: DataGrid, FormRenderer, Inspector, Board, Calendar, Widget, DocumentPanel. A schema must not become an ungoverned runtime language.

## Page and form experiences
Page templates: single, split, master-detail, tabbed, grid, wizard. Form modes: Quick Create, Drawer, Full Page, Wizard, Line Item/Repeater, Inline Cell. Reuse common validation, guarded state transitions, optimistic concurrency and draft preservation. Render responsive and accessible layout variants.
