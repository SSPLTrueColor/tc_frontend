# Integrations, Connectors & Data Operations
## Scope
Connector Marketplace, reusable provider definitions, org-scoped connections, health, mapping and event/action registry. Do **not** add a standalone API Management product console. Provider APIs and authentication are necessary underlying implementation mechanisms, not excluded capabilities.

## Connection lifecycle
Draft -> authorization required -> testing -> active/degraded/reauthorization required/paused/disconnected. Support OAuth with appropriate state/PKCE, encrypted secrets, revocation, rotating credentials, tenant-specific consent, least privileges, verified webhooks, rate limits, version compatibility and agent tool controls.

## Mapping and sync
Canonical mapping to resource fields/masters and external identity map keyed by provider/account/external ID. Read-only one-way import by default; bidirectional only after conflict/ownership review. Support scheduled/event/manual sync, validation, checkpoint, schema drift, deletion policy, replay/idempotency and echo-loop protection.

## Data operations
CSV/XLSX imports, mapping validation, deterministic deduplication, schema checks, dry-run create/update/skip/delete impact, bulk approval, job checkpoints and reconciliation. Exports must enforce tenant/row/field permissions, formula-injection safety, time-limited delivery, audit and retention. Migrations require dependency-aware source snapshots, foreign-key/ID mapping, phased cutover and compensation instead of assuming transactional rollback across external effects.

## Agent and connector security
Tool registry binds connectorId/connectionId/allowlisted capability/actor/tenant/action policy and optional human approval. Never expose credentials directly to agent context. Prevent SSRF or arbitrary code execution in custom connectors, verify allowed destinations and sandbox engineered adapters.
