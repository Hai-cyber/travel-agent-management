# Progress Ledger

Purpose: keep one stable entry point for progress tracking while the real checkpoint history is now split into clearer domain ledgers.

## Use these files

- `03A_PROGRESS_LEDGER_TOUR_PLATFORM.md`
  Tour engine + shared platform/runtime work.
  Use for tours, pricing, booking drafts/orders, ops board, dashboard, auth, billing, publishing, universal site, and other shared platform surfaces.

- `03B_PROGRESS_LEDGER_HOTEL_PROPERTY.md`
  Hotel/property engine work.
  Use for properties, room inventory, availability, holds, property reservations, room ops, housekeeping, maintenance, folio, and later hotel/property surfaces.

- `03C_PROGRESS_LEDGER_COMBINED_ARCHIVE.md`
  Preserved combined history from before the split.
  Use only when older notes matter and the split ledgers do not provide enough historical context.

## Working rule

- If the task primarily touches `tours`, `booking_orders`, `tour-config`, `dashboard`, `universal site`, `billing`, `auth`, or other shared platform surfaces, update `03A_PROGRESS_LEDGER_TOUR_PLATFORM.md`.
- If the task primarily touches `properties`, `room_types`, `room_units`, `property_reservations`, `inventory_holds`, `reservation_allocations`, `room_state_events`, `housekeeping_tasks`, `maintenance_issues`, `folios`, or other hotel/property surfaces, update `03B_PROGRESS_LEDGER_HOTEL_PROPERTY.md`.
- Do not add new checkpoint updates to this file.
- Do not duplicate the same checkpoint in both split ledgers unless the checkpoint is genuinely cross-domain.

## Status legend

- `not_started`
- `in_progress`
- `blocked`
- `done`
- `legacy_only`

## Why this split exists

- The tour/platform runtime is now much larger than the hotel/property runtime.
- Keeping both in one file made hotel/property progress hard to scan.
- The archive file preserves old combined history without forcing every future task to load it.