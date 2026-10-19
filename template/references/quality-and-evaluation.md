# Acceptance & Evaluation
## Commands and reporting
Run actual project lint/typecheck/unit tests/build where available; report exact results. Inspect at desktop 1440 and phone 390 widths, dark mode, overlays, reduced motion, 200% zoom, forced colors, keyboard navigation and at least one touch mode if tooling supports. If browser unavailable, list manual checks outstanding. Test mock service consistency and differentiate mock/local/API/live modes.

## Non-negotiable product contracts
1. URL refresh, deep link, Back/Forward and authorization remain correct.
2. Create/edit actions validate and update data without stale or duplicate submissions.
3. Resource field configured once surfaces coherently in list/form/filter/search/inspector/report according to capability and permission.
4. Saved view personal/team/org scopes persist under correct identity and policy.
5. Record Inspector Quick Comment survives tab transitions and is not duplicated in Comments.
6. Workflow task completion does not bypass human approval; notification read does not imply task completion.
7. Event retry does not re-execute committed payment-like steps, external sends or financial effects.
8. Tenant, record and field access remain enforced for UI queries, autocomplete, agent tools, exports, search and logs.
9. Schema draft/validate/preview/publish rejects breaking changes with dependencies.
10. Calendar overlap and pooled capacity respect server-side atomic constraints.
11. Import dry-run reflects the selected schema and rechecks before commit; export never reveals masked fields.
12. Documentation and guided tours show only currently authorized, version-compatible controls.

## Evaluation matrix
- CRM: lead, account, tasks, pipeline and saved views.
- HRMS: employee field masking, leave approval, org scopes.
- Inventory: numeric quantities, masters, relationships, grouped/virtualized grid.
For each, test create, list, filter, edit, inspector, navigation, RBAC, event handling and audit. Add connector/agent attack-path checks if used.

## Skill-level evaluation prompts
- “Build a CRM prototype with sample leads, forms, list/board view, saved views, inspector and Quick Comment, preserving existing Vite project.”
- “Add HRMS to an existing app using the same components but employee-specific permissions and department masters.”
- “Create configurable Inventory resource with conditional fields and grouped stock view; do not duplicate grid/form engines.”
- “Rework navigation into a 56-64px icon rail and resizable 240px context sidebar, preserving deep links.”
- “Design a workflow with human approval and a supervised agent task; prove retries cannot double-send.”
- “Import sample CSV with mapping, duplicate detection and dry-run, but do not mutate production data.”

## Skill QA gate
A skill package passing structural validation means the skill *loads*. It does not mean an actual generated product works. Require at least three independent domain fixtures, manual or automated visual review and security test scenarios before calling the platform production-ready.
