# Hotel / Property Progress Ledger

Purpose: track rescue-rebuild progress for the standalone hotel/property engine so those checkpoints stop getting buried inside the much larger tour/platform ledger.

Scope includes:
- properties, room inventory, and room availability
- property reservation intake and direct booking commit flow
- room-state history, housekeeping, maintenance
- folio / property billing surfaces
- future property-only operations and distribution helpers

Status legend:
- `not_started`
- `in_progress`
- `blocked`
- `done`
- `legacy_only`

## Verified property checkpoints

| Checkpoint | Title | Status | Code reality | Last update | Notes |
|---|---|---|---|---|---|
| CHK-R83 | Property availability API baseline | done | property-engine migrations `0057`–`0070` are in repo; `POST /api/properties/:propertyId/availability` and `POST /api/properties/:propertyId/availability/hold` are live through `src/routes/properties.js` + `patterns[]` in `src/index.js` | 2026-04-19 | verified locally with migrated D1 + `db/seed_property_availability_smoke.sql`; hold flow rechecks inventory before insert |
| CHK-R84 | Property reservation commit baseline | done | `POST /api/properties/:propertyId/reservations` creates a confirmed `property_reservations` row, linked stay plan rows, stay plan segments, and locked allocations; referenced hold is consumed when present | 2026-04-19 | verified locally via `availability -> hold -> reservations -> availability`; current baseline supports `rooms_requested = 1` only |

## Property runtime that now exists

- Shared/property migrations `0057`–`0070` now cover:
  - `tenant_settings`
  - `staff_assignments`
  - `inbound_records`
  - `draft_records`
  - `properties`
  - `room_types`
  - `room_units`
  - `property_reservations`
  - `inventory_holds`
  - `reservation_stay_plans`
  - `reservation_stay_plan_segments`
  - `reservation_allocations`
  - `room_state_events`
  - `housekeeping_tasks`
  - `maintenance_issues`
  - `folios`
  - `folio_lines`
- Local smoke fixture exists at `db/seed_property_availability_smoke.sql`
- Verified routes currently are:
  - `POST /api/properties/:propertyId/availability`
  - `POST /api/properties/:propertyId/availability/hold`
  - `POST /api/properties/:propertyId/reservations`

## Current limits of the verified property baseline

- direct-commit path only
- no separate admin/manual confirm route yet
- no guest/public hotel booking UI yet
- room-type-level hold granularity only
- reservation create baseline verified only for `rooms_requested = 1`
- no cancel/release lifecycle endpoint yet

## Boundary notes

- This ledger is only for the standalone property engine built on `properties`, `room_types`, `room_units`, `inventory_holds`, `property_reservations`, `reservation_stay_plans`, and `reservation_allocations`.
- Universal catalog/storefront checkpoints that happen to mention hotels still belong in `03A_PROGRESS_LEDGER_TOUR_PLATFORM.md` when they operate on `tenant_universal_hotels`, product modules, universal pages, or public site rendering.
- In practice, `CHK-R47` and `CHK-R49` are intentionally **not** repeated here because they are catalog/storefront work, not property-engine runtime work.

## Recommended next property slices

- add reservation read + cancel baseline so the property reservation lifecycle stops at a clean minimum complete surface
- add hold release / expiry management endpoint for operational correction paths
- extend reservation commit beyond `rooms_requested = 1`
- add room-state and housekeeping operational routes on top of migrations `0066`–`0068`
- connect folio header/line runtime on top of migrations `0069`–`0070`