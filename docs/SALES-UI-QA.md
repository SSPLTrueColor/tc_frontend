# Sales UI review validation — 20 October 2026

## Delivered

- Eight navigation workspaces retain existing routes, saved views and role checks.
- Shared All / Leads / Opportunities / Pipeline navigation; `/sales` combines permitted lead/opportunity rows without counting qualified leads twice.
- Qualification quick action on lead boards, mobile cards and the All table; existing BANT validation and atomic conversion service retained; repeated submission guarded.
- Inline editing retains field validation and now explicitly confirms successful changes.
- Neutral text links without underlines, muted slate status/priority chips and quieter card surfaces. Board filters appear separately from cards.
- Quotation Lead relation and Open Lead action; direct-customer opportunity exception shown honestly.
- Standard quotation lists show active family entries; read-only version snapshots, comparison and existing document links remain available from history. History labels v1… with Active/Previous, timestamp and author. Under Revision is a derived board group, not an approval bypass.
- Existing sales order, contract, dispatch, installation and service transitions retained.

## Checks

- Full Vitest suite: 40 files passed; 389 tests passed; one pre-existing opt-in lifecycle assertion skipped. The lifecycle trace reported no carry-forward gaps.
- Build: TypeScript and Vite production build pass. Vite reports the existing large-bundle advisory.
- ESLint: no errors; two existing unused-disable warnings in order processing/payment schedule pages.
- Browser smoke: sales view, shared navigation, lead-card qualification dialog and six key resource routes at 1440, 768 and 390 px; no captured console errors or document overflow after responsive navigation settles.
- Browser quotation check: originating Lead action, active revision marker and Under Revision board group.
- Regression tests: role-scoped sales aggregation, converted-lead deduplication, navigation grouping, quotation origin permissions and revision-group semantics.

## Scope limits

This is a local frontend simulation. Existing quote snapshots remain separate internal records linked by root ID so accepted sales orders can retain exact historical revision references; the standard UI presents one active family entry. No data reset or destructive migration was performed. No live messages, integrations or production deployment were performed. Anish/Dhruvi review and additional reporting enhancements remain pending. Browser smoke coverage is targeted, not an exhaustive audit of every role and route.

Latest visual correction: every status, priority, tag and badge capsule is one soft pill (tinted fill + same-hue text, 6px radius, no border) coloured by the value's tone. Board cards carry a stage-colour stripe and truncate long values inside the card; the filter panel keeps every control inside it; the Filters button shows an active count and active filters sit in a labelled bar with Clear All.

Stage moves: the icon-only arrow buttons are replaced by one labelled "Change Stage ▾" / "Change Status ▾" dropdown (`MoveStageButton`) on board cards, list rows, mobile cards and the record drawer. It lists only the record's lifecycle transitions (OPP-02 flow for opportunities), through the same guarded transition API with confirmations; Lost stays on "Mark Lost" (FR-031). Stage moves were removed from the ⋯ row menu so there is one place for them.

Compact Sales sidebar: four collapsible sections (Leads, Opportunities & Pipeline, Quotations, Consumables), one row per record list or page; only the section containing the current page opens by default. Saved views are no longer sidebar rows — they remain tabs on each list and are still found by "Find a page". Every page route stays in the sidebar (CLAUDE.md "every route reachable from sidebar"); other workspaces are unchanged (`sectioned` flag in `src/domain/sidebar.ts`).
