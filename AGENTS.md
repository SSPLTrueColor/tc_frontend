# Project: True Color — Frontend Simulation Prototype

## Goal

Clickable, working frontend prototype of the BRD (docs/BRD.md).
NO backend. All data simulated. Must feel like a real product in a demo.

## Stack (fixed — do not add alternatives)

- React 18 + Vite, TypeScript
- Router: react-router-dom v6
- UI: ONLY components/styles from /template [Use same as Template]
- Do NOT install new UI, CSS, or state libraries without asking.

## Design rules

- Follow /template exactly: layout, sidebar, header, colors, typography, spacing, tables, forms, modals.
- Follow the frontend skills in .Codex/skills/ for every UI task.
- Reuse template components first; create new ones only if missing, in the same style.

## Architecture rules

- src/mocks/ → seed data (JSON/JS), realistic Indian names, ₹, dates, IDs
- src/services/ → one file per module; async functions returning Promises with 300–800ms delay
  (same signatures a real API would have, so backend swap = replace service only)
- src/store/ → persist CRUD changes to localStorage; "Reset demo data" action in settings
- src/modules/<module>/ → pages + module components
- src/components/ → shared components
- Components never import mock data directly — always via services.

## Every screen must have

- Loading, empty, error states
- Form validation per BRD rules (required, formats, ranges, duplicates)
- Search, filter, sort, pagination on lists
- Confirmation on delete / irreversible actions
- Toast on success/failure
- Role-based visibility (simulated login with role switcher)
- Responsive (desktop first, usable on tablet/mobile)

## Traceability

- docs/REQUIREMENTS.md lists every FR/NFR with ID, screen, status.
- Update status after each module. Nothing from BRD is skipped silently —
  mark "Simulated", "Not applicable to frontend", or "Deferred" with reason.

## Done = `npm run build` passes, no console errors, every route reachable from sidebar.
