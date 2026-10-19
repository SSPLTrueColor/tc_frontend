# Security, Tenant, Identity, Permissions & Governance
## Identity model
Distinguish tenant/security boundary, legal organization, flexible organization chart/graph, workspace collaboration scope and global person identity with tenant-scoped memberships. Support guest, service and AI identities with distinct lifecycle, delegation, expiry, offboarding, session revocation and owner transfer.

## Effective authorization
Deny by default on server; evaluate actor + tenant + membership + resource action + row scope (own/team/dept/branch/org) + field view/edit/mask/hide + lifecycle + workflow policy + connector/tool grants. Dynamically registered resources can be assigned to org-defined custom roles; test permission matrices and effective-access previews. Avoid cross-org inference via counts, autocomplete, exports, search or logs.

## Data protection
Classify fields and attachments, mask sensitive data, minimize event payloads and search indexes, encrypt secrets, govern retention/legal hold, audit privileged actions, guard backup/export access, manage signed downloads, validate uploads and render document previews safely.

## High-impact actions
Re-authenticate or require higher assurance where policy demands; confirm destructive and external actions with meaningful consequences. Approval, send, delete, bulk import and payment-like actions must be explicitly authorized and idempotent when retried. Privileged user cannot silently bypass required separation of duties unless an audited break-glass policy is defined.

## Audit evidence vs operational telemetry
Audit needs integrity/retention controls; activity feed is user-focused; logs/traces/metrics have separate retention and access. Failed monitoring must not silently erase critical audit evidence. Provide tenant-safe diagnostics and controlled recovery.
