# Calendar QA — Tasks & Calendar (`/calendar`, OPP-08, FR-034)

Redesign of the calendar to Google Calendar / Outlook quality, built on the existing FullCalendar engine and the template tokens.
Last full run: 54 browser checks + 17 unit tests, all passing. `npm run build`, `npm run lint` (0 errors, 0 warnings) and `npm test` (370 tests) pass; no console errors in any run.

Re-run: `npx vitest run src/test/calendar.test.ts` and, with the app on a dev server, `BASE_URL=http://localhost:5175 npx tsx e2e/calendar-stress.mts qa-out` (writes `results.json` and screenshots).

## 1. Decisions taken (from the audit)

| # | Question | Decision |
|---|---|---|
| 1 | Left-border rule (`calendar.css` "owner rule 32: no coloured bar in front") vs the brief | The brief wins for the calendar only: soft fill + 3px left edge in the type colour. The CSS comment was rewritten. |
| 2 | Past dates | Kept Q-33: create and move may not start in the past. A drop in the past reverts at once with a message; the quick-create popover does not open on a past day. |
| 3 | "This and following" | Implemented by splitting the series: the old series ends the day before, a new series (linked by `seriesId`) starts at the picked occurrence. On the first occurrence it is the same as "all". |
| 4 | Reminders (LEAD-09) | Simulated: a "Reminder" field (none / 15 min / 1 h / 1 day) on every event, shown in the detail popover. Nothing is sent (no backend). |
| 5 | Libraries | None added. |
| 6 | Saturday | Non-working: business hours are Mon–Fri 09:00–18:00; weekends and out-of-hours are shaded. |

Interpretation note: "Wide defaults to Agenda" was read as "narrow (phone) defaults to Agenda"; desktop opens on Month.

## 1b. Declutter pass (after review of the month view)

Month showed 3 full chips per cell plus dozens of auto-generated follow-ups, so it read as heavy. Now: items from other modules (tasks, demos, PM visits, follow-ups) are **off by default** (toggle "Tasks, demos, PM visits & follow-ups" under Show); month cells show **2 events** then "+N more"; your own one-off events sort first, daily stand-ups last; chips use lighter fills and regular weight; weekend shading is fainter. Re-run: 54/54 browser checks, lint and typecheck clean.

## 2. Feature list

**Layout**
- Collapsible left panel: Create, mini month (dots on days with events), "My calendars" (six event types with colour legend and filter), People (assigned-user filter), Show (status filters, items from other modules). The panel starts closed below 1180px wide.
- Toolbar: panel toggle, Today, ‹ ›, range title, Month / Week / Day / Agenda. Search sits beside the "Today's agenda" strip above it.
- Today's agenda strip: number of events today and the next one (or "all over").
- One scroll area; the grid keeps the same height in all four views (no layout jump); views fade in over 180 ms (off with reduced motion).

**Reading events**
- Soft fill + strong left edge per type, text in the primary text colour (AA on every tint). Past events: fill and edge dimmed, text kept readable. Cancelled: struck through.
- Month: time + title on one line, clean ellipsis, "+N more" popover. Week/Day: title, time and linked record; events of 30 min or less show the title only. At most 2 overlapping events sit side by side, the rest go to "+N more".
- Full text (title + linked record) in the tooltip and the accessible label of every chip.
- Today highlighted, weekends and non-working hours shaded, current-time line in Week/Day; full 24 h grid (scrolls to 08:00).
- Empty period → friendly empty state with "Create event"; filters/search that hide everything → "No events match" with "Clear filters".

**Interaction**
- Click a slot or drag across slots → quick-create popover (title, type, date, time, all-day) with **More options** (carries the typed title into the full dialog). Nothing is lost if the save fails.
- Click an event → detail popover (title, time, repeat rule, type, status, assignee, attendees, linked record, location, reminder, notes). Edit/Delete are shown only to people who may change the event.
- Drag and resize to reschedule → toast with **Undo** (restores the exact previous state, including series and "this event" copies). A failed save reverts the event and offers **Retry**.
- Recurring events: this / this and following / all, on edit, move and delete.
- Shortcuts: `T` today, `M W D A` views, `←` `→` navigate, `C` create, `/` search. Ignored while typing or when a dialog or popover is open. Events are reachable with Tab and open with Enter.
- Double-submit guard on Create/Save (one event, not two).

**Data** (all through the simulated service, 300–800 ms)
- 70+ seed events (IST): recurring rituals, all-day, multi-day (one crosses the month end), a 22-event day, six bookings at the same time, an event crossing midnight, a 120-character title with long notes, past / today / next month, with reminders. Plus read-only items from other modules.
- Roles: 12 roles; create/edit/delete follow the role's permission and scope; the read-only role (Store) gets a disabled Create and no edit actions.

## 3. Test matrix

Browser checks (`e2e/calendar-stress.mts`, Chromium) and unit tests (`src/test/calendar.test.ts`).

| Area | Scenario | Result |
|---|---|---|
| Data shapes | Empty month → empty state + Create event | Pass |
| | 1 event (search to one) → one chip, "1 match" | Pass |
| | 38 events in one day → "+35 more", popover lists all, nothing overflows the cell | Pass |
| | 6 overlapping events at one time → 2 columns + "+more", no chip narrower than 48 px | Pass |
| | Multi-day event across week and month boundary → continues out of Oct and into Nov | Pass |
| | Event crossing midnight → shown on both days | Pass |
| | All-day + timed on the same day | Pass |
| | Very long title/notes → ellipsis, full tooltip, no overflow | Pass |
| Validation | End before start / zero duration (quick-create, dialog, service) | Pass |
| | Title empty, whitespace-only, over 120 characters | Pass |
| | Overlap for the same user → warning, not a block | Pass |
| | Create on a past day → blocked with a message | Pass |
| | Drag to a past day → reverts with a message | Pass |
| Recurrence | Edit offers this / this and following / all; this-and-following splits the series | Pass |
| | Delete one occurrence keeps the series; delete this and following ends it; delete single asks to confirm | Pass |
| | Undo of a "this event only" change; first-occurrence "following" = whole series | Pass (unit) |
| Reliability | Rapid double-click on Save → exactly one event | Pass |
| | Slow service (3 s) → loader, then the calendar | Pass |
| | Failed load → error + Retry → recovers | Pass |
| | Failed save → popover stays open with the text, error shown, Retry saves exactly one event | Pass |
| | Failed drag → event reverts, Retry re-applies | Pass |
| | Drag → Undo; resize → Undo restores duration | Pass |
| Accessibility | Keyboard: all shortcuts, search typing not hijacked, Tab to event + Enter | Pass |
| | Contrast ≥ 4.5:1 for 6 types × normal/past × title/time, light and dark (min 7.6 / 7.1) | Pass |
| | Chip text 12 px, 3 px left edge | Pass |
| Responsive | Phone (390 px) opens Agenda, no horizontal scroll | Pass |
| | Zoom 125 % (1152×720) and 150 % (960×600): toolbar intact, no horizontal scroll, grid ≥ 400 px | Pass |
| | Grid height identical across Month/Week/Day/Agenda | Pass |
| Roles | Admin, Management, Division head, Sales manager, Sales exec, Service head, Engineer, Coordinator, SCM, Accounts, Profiling: Create enabled; Edit only on events they may change; module items never editable | Pass |
| | Store (read-only): Create disabled, click/`C` do not open quick-create, no Edit/Delete anywhere | Pass |
| | Unit: every role's create/edit/delete follows its permission | Pass |

## 4. Issues found during the stress run, and fixes

| Issue | Fix |
|---|---|
| Month chips of timed events rendered as unstyled dot events (no fill or edge) | `eventDisplay="block"` |
| Past events lost their colour (a CSS variable referencing itself) | Separate `--ev-bg-now` / `--ev-solid-now` variables |
| Toolbar wrapped onto two rows in Week view, so the grid changed height between views | Search moved next to the Today strip; toolbar never wraps above 760 px; side panel starts closed below 1180 px |
| 3 overlapping events squeezed into unreadable slivers (< 40 px) | At most 2 columns, the rest under "+more" |
| Events after 21:00 and the part of an overnight event after midnight were invisible | Grid now 00:00–24:00 |
| Saturday treated as a working day | Business hours Mon–Fri |
| Read-only roles saw disabled Edit/Delete buttons | Actions are hidden entirely |
| A failed or conflicting move could not be retried | Retry action on the failure toast |
| Detail popover put focus on the Close button (stray tooltip) | Focus goes to Edit |
| Seed had 50 events and an end time that wrapped past midnight onto the same day | 70+ events; end date rolls over correctly |

## 5. Known limitations

- Reminders are stored and shown, never delivered (no backend). Google/Outlook sync is out of scope (needs OAuth).
- Items from other modules (tasks, demos, PM visits, installations, follow-ups) are read-only here; reschedule them from their own record.
- Undo after dragging a recurring event with "this and following" (removes the new series and restores the old end date) is implemented but only unit-covered for "this event only"; it has no browser test.
- Quick-create keeps one date; cross-midnight timed events need "More options".
- Overlap detection is per person and ignores all-day events; it warns, never blocks.
- Delete has a confirmation but no Undo (a non-admin cannot restore from the recycle bin).
- Dragging on touch screens needs a 350 ms long press (FullCalendar behaviour).
- Calendar times are IST wall-clock regardless of the browser zone (Q-33).
- The page loads the whole calendar once and filters in the browser; fine for the demo data, a real backend would page by date range.
- Browser checks ran in Chromium only.
