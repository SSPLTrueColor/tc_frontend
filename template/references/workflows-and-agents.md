# Event-driven Workflows, Jobs, Tasks & Governed Agents
## Event contract
Versioned envelopes including eventId, eventType, version, tenantId, actorId/type, target resource ID, occurredAt, correlationId, causationId, traceId, idempotencyKey and privacy/classification metadata. Validate and minimize payloads. Business commits and outbox publication must be durable.

## EDA and orchestration
Triggers: business event, external connector event, manual, scheduled. Conditions: AND/OR, scoped expressions, time windows. Actions: record mutations, notifications, work items, document generation, connector tools, nested events, waits, parallel/conditional branches and human checkpoints. Include loop prevention, idempotent execution, retry with backoff, dead-letter management, replay authorization and compensating steps where necessary.

## Strict ownership
- Workflow Runtime owns run/step lifecycle and formal approval decisions; Work Service owns tasks and activities; Notification Service owns delivery; Communication Service owns messages; Audit ledger owns evidence.
- A completed task is not an approved business record. A delivered notification is not completion of a workflow. An AI-generated proposal is not an executed authorized action.
- EDA event schema versions and producer/consumer compatibility must be validated before publication.

## Work management
Tasks, activities, subtasks, projects/milestones, dependencies (reject cycles), accountable owner + multiple assignees/watchers, configured status and priority, recurrence, SLA/business calendar, list/board/calendar/timeline/workload views, time tracking where requested. Protect work ownership on deprovisioning.

## AI tool gateway
Agent as distinct identity with tenant, owner, delegated scope, expiry, per-connection allowlisted tools, row/field permissions, quotas/cost ceilings, human approvals and complete audit. Prompt injection from retrieved documents or connector results cannot grant tools or change policies. Keep untrusted content separate from authority. No raw provider secrets in prompts. Agent cannot silently impersonate human, send external messages or mutate protected records without explicit policy.
