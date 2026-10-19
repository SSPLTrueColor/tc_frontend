# Canonical Architecture & Contracts
## Purpose
Treat this as one platform even if a project requests only a single module. Prefer a modular monolith and background workers, with interfaces allowing future separation. Do not build five literal microservices because there are five logical layers.

## Application manifest
```ts
type ApplicationManifest = {
  id: string; version: number; key: string; label: string;
  organizationScope: string; modules: ModuleRef[];
  navigation: NavigationRef; capabilities: CapabilityRef[];
  policies: PolicyRef[]; theme: ThemeRef; status: 'draft'|'published'|'deprecated';
};
type ResourceDefinition = {
  id: string; moduleId: string; version: number; key: string; label: string;
  fields: FieldDefinition[]; relationships: RelationDefinition[];
  masters: MasterRef[]; permissions: PolicyRef; lifecycle?: StateMachineRef;
  views: ViewRef[]; forms: FormRef[]; pages: PageRef[];
  search: SearchConfig; audit: AuditConfig; eventPolicy: EventPolicy;
  status: 'draft'|'published'|'deprecated';
};
```
Names ending in `Ref` are typed stable references and must be defined per implementation; these excerpts are interfaces to align designs, not deployable full schemas.

## Ownership invariants
- A business record is not an approval run, task, notification or event. Do not store the same mutable truth in multiple domains.
- Stable immutable IDs are the identity; slugs and names are aliases with collision/redirect policies.
- All mutating operations use a known tenant, actor, scope, expected state/version, validated intent, authorization decision and audit correlation ID.
- Shared read models and materialized views can merge data; never bypass owning domain when writing.
- Where business state and outbox must commit together, use transactional outbox or equivalent durable semantics.
- Detect concurrent writes with optimistic concurrency or transaction locking according to resource.

## Design decisions
- Frontend components consume typed service interfaces, not raw ad-hoc HTTP calls. Preserve existing service layer in an existing repo.
- Backend choice is contextual; if only frontend is requested, use consistent mock service and explicitly mark local state.
- Version metadata and event envelopes, and define compatibility/deprecation contracts.
- Keep provider APIs as implementation details of connectors; standalone API Management is excluded from the agreed product scope.
