# Domain-neutral Application Examples
These are **fixtures** to prove reuse, not hardcoded mandatory modules.

| CRM | HRMS | Inventory / Manufacturing |
|---|---|---|
| Leads and customer accounts | Employees, departments | Products, warehouses, batches |
| Sales pipeline and follow-ups | Leave and joining checklists | Stock movements and inspections |
| Saved table/board views | Employee directory and filtered lists | Grouped stock views and reconciliations |
| Record activity/comment | Restricted HR notes | Batch comments and QC attachments |
| Lead assignment and task EDA | Leave approval distinct from task | Stock update triggers and capacity planning |

## Minimal vertical slice
Implement: Lead Resource -> grid/filter/saved view -> form -> inspector with persistent Quick Comment -> task -> event -> audit. Then create HRMS Employee (field masking, department masters) and Inventory Item (units, calculated data, relationships) from same primitives. Compare config vs code changes to identify hardcoded assumptions.

## Delivery mode examples
- Frontend-only prototype: show working mock data, saved views only locally if true, no fake auth or backend claims.
- Existing repo module update: inspect and preserve framework/brand; extend existing routes/service layer, avoid replacing unrelated modules.
- Full platform: require explicit permission for database, workers and integrations; build metadata/runtime/authorization before advanced modules.
