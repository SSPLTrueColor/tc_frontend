# Settings — QA report

Scope: every Settings page after the redesign (full-width, two-column cards, left Settings nav, sticky Save bar, Danger zone).
Run: `npm run dev`, then `BASE_URL=http://localhost:5173 npm run e2e:settings` (Chromium, `e2e/settings.spec.ts`).
Last full run: **130 passed, 0 failed** (includes the People / extra-access checks). `npm run build`, `npm run lint` clean; unit tests 370 passed, 1 skipped.

## Pages

| Group | Page | Route | Built on Settings kit |
|---|---|---|---|
| My account | Profile & Appearance | `/admin/profile` | Yes (new) |
| My account | Notification Preferences | `/admin/notification-preferences` | Yes (new, Simulated) |
| My account | Security | `/admin/security` | Yes (new, Simulated) |
| People & Access | Organisation (org chart + divisions / territories) | `/admin/organisation-hierarchy` | Yes |
| People & Access | Users | `/admin/users` | No — template list grid |
| People & Access | Roles & Permissions | `/admin/roles-permissions` | Yes |
| Business rules | Approvals & Workflows | `/admin/workflows` | Yes |
| Business rules | SLA & Escalation | `/admin/sla-matrix` | Yes |
| Business rules | Lead Assignment · Lead Scoring | `/admin/lead-assignment-rules` · `/admin/lead-scoring-rules` | No — template list grid |
| Business rules | Other Rules | `/admin/configurable-rules` | Yes |
| Data & Forms | Masters | `/admin/masters` | Yes |
| Data & Forms | Products · Price Lists · Price List Items · Terms Templates · Message Templates | `/admin/products` … | No — template list grid |
| Data & Forms | Custom Fields & Layouts | `/admin/custom-fields` | Yes |
| Data tools | Import / Export · Duplicate Merge · Ownership Transfer · Recycle Bin | `/admin/bulk-import-export` … | Yes |
| Integrations & Messaging | Integrations · Sent Messages | `/admin/integrations` · `/admin/sent-messages` | Yes |
| Governance | Audit Trail · Data Protection | `/admin/audit-trail` · `/admin/data-protection` | Yes (Data Protection new, Simulated) |
| Demo | Demo Settings | `/admin/demo-settings` | Yes |

## Test matrix (all pass)

| Check | How it was tested | Pages | Result |
|---|---|---|---|
| No console errors / uncaught exceptions | Load each page as System Administrator | all 27 | Pass |
| No horizontal scroll at 1440 · 1280 · 1024 · 768 · 375 px | Resize and measure page + content area | all 27 | Pass |
| Zoom 125 % / 150 % | Emulated as 1152 px / 960 px wide viewports | all 27 | Pass (see limitations) |
| Light and dark | Both themes render; text contrast ≥ 4.5:1 on titles, help, labels, table text | all 27 | Pass |
| Every role sees only allowed settings | 12 roles × 27 pages: in nav ⇒ opens; not in nav ⇒ "No access"; no blank page | all | Pass |
| Read-only for non-admin | Sales Manager on Data Protection: inputs and switches disabled | 1 | Pass |
| Keyboard only | Tab through each page: focus moves, every stop has a visible focus ring, no trap | 19 kit pages | Pass |
| Touch targets ≥ 44 px | At 375 px every button, input, select, textarea | 19 kit pages | Pass (info icons and org-chart "+/−" use a 44 px hit area) |
| Save bar only when dirty; Cancel restores | Notification Preferences | 1 | Pass |
| Leave guard | In-app link asks "Leave without saving?"; refresh/close guarded only while dirty | 1 | Pass |
| Switching a tab keeps edits | Roles → Compare roles → Access | 1 | Pass |
| Double-click Save saves once | Audit log shows one entry | 1 | Pass |
| Toggles save instantly with toast | Daily digest | 1 | Pass |
| Invalid input | Spaces only, 1 char, emoji only, symbols only, 81 chars, 501-char details, duplicate request; `<script>` text is shown as text and never runs; retention 0 / 121 / 12.5 / empty; quiet hours same start and end; negative numbers on policy pages | 4 | Pass |
| Typed confirmation | Danger zone action disabled until `RESET` is typed exactly | 1 | Pass |
| Service failure | Failure rate 100 %: 7 data pages show an error state with Retry and do not crash; turning failures off lets the page recover | 7 | Pass |
| Slow response (3 s) | Skeleton visible, content arrives, Save disabled while saving | 1 | Pass |
| Empty / 1 record | Recycle Bin empty, Data Protection 0 and 1 request, no-match search in Sent Messages | 3 | Pass |
| 500+ records | Recycle Bin 650, Sent Messages 650, Audit Trail 1,500, Data Protection requests 600 with 126-character unbroken names: ≤ 100 rows rendered, rows visible < 4 s, no overflow at 1440 / 768 / 375 | 4 | Pass |
| Very long text | Masters label of 80 characters, long request subjects: truncate with tooltip, no overflow | 2 | Pass |

## People and extra access (Roles & Permissions)

| Check | Result |
|---|---|
| Give extra access: reason required, emoji-only reason rejected, takes effect for that person, listed, counted in "Expiring soon", removable with confirmation | Pass (browser) |
| Change role shows what is gained / lost before it applies; Cancel leaves the role unchanged | Pass (browser) |
| "Cannot see something?" explains the role and opens the give-access form pre-filled | Pass (browser) |
| Non-administrators: people are read-only (no role change, give or remove) | Pass (browser) |
| Engine: extra access only adds, ends after its date, rejects duplicates / administrators / non-admin granting, end date ≤ 180 days, extend capped, role change keeps extra access, every change audited | Pass (9 unit tests, `src/test/grants.test.ts`) |

Not built yet: second-approver for risky grants, "request access" from a blocked screen, "hide this from one person" restrictions, copy-from-colleague when adding a person (the Add person button opens the user form).

## Fixed during testing

- Hidden table helper text widened the page on phones (Approvals, Masters) — tables now contain it.
- Tab rows overflowed at 375 px — they now scroll on their own.
- Switches waited for the save before moving — they now move at once and spring back on failure.
- Buttons, inputs and selects were 30–40 px tall on phones — now 44 px.
- Notification channel grid was cut off on phones — now stacked rows.
- First layout was a narrow centred column with empty sides — now full width, two cards per row.

## Known limitations

- **Browser zoom** was emulated with narrower viewports; real browser zoom was not run.
- **Contrast** is an automated sample (titles, help text, labels, table text), not a full audit; buttons, badges and placeholders were not measured.
- **Browser Back button** cannot be intercepted (BrowserRouter); links, refresh and tab close are guarded.
- **Template list pages** (Users, Products, Price Lists, Price List Items, Terms Templates, Lead Assignment, Lead Scoring, Message Templates) were tested for render, errors and overflow only. They still use the shared list grid, not the Settings kit; they were not covered by the keyboard and touch tests.
- **Delete / purge** on a single row (e.g. Recycle Bin) uses the existing confirmation dialog; typed confirmation is used for Danger-zone actions (reset, restore defaults, sign out other devices, reset demo data).
- **Sent Messages** cannot be empty (reminders are generated at start-up), so its empty state was tested as "no matching search".
- **Language** choice is stored but labels stay English. Email, WhatsApp, push, two-step verification and signed-in devices are simulated.
- Only Chromium was run; Firefox and Safari were not.
- Roles are checked for visibility and read-only behaviour, not every field-level permission.
