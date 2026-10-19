# Shared Enterprise Services
## Documents
Record attachments, document library, classification, secure upload/scanning, sandboxed previews, immutable file versions, templates with conditional/repeating blocks, controlled generation, signature provider integration readiness, expiry/retention/holds, event triggers, RBAC and scoped agent access. File linked to multiple records without duplicating blob storage and version authority.

## Communication
Record-centric threaded discussions, mentions, one persistent Quick Comment in Inspector, internal notes restricted from external recipients, external messages via authorized providers, draft preservation, delivery receipts/retries, authorized history, templates, retention and audit. Never change internal notes into external messages implicitly.

## Scheduling
Appointments, shifts, resource bookings, availability, recurrence exceptions, business calendars, zones and DST, pooled/exclusive/quantity capacity, atomic overlap/conflict validation, allowed overrides and audit. Calendar event does not automatically complete task.

## Notifications & Inbox
Bell, actionable work inbox, mentions/replies/assignments/approvals/reminders, preferences and bundling. `read` does not mean `approved`, `completed` or `acknowledged`. Use EDA for delivery/event triggers.

## Audit & Operations
Separate activity feed, immutable/tamper-evident audit evidence and operational telemetry. Tenant-scoped correlation, workflow/job/queue/connector/agent traces, costs, incident ownership, safe recovery with idempotency and confirmed consequences. Protect sensitive logs; don't assume monitoring equals security verification.

## Settings, Localization & Help
Resolve effective settings with platform policy, org enforcement, workspace defaults and personal overrides; never permit user override of security/accessibility baselines. Locale-specific language, zones, dates, number and currency display; changing display currency must not rewrite financial amounts. Context help, onboarding, localized docs, guided tours, support integration, adoption metrics and human fallback.
