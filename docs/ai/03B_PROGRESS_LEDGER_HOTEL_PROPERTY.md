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
| CHK-R85 | Property reservation read + cancel baseline | done | Added `GET /api/properties/:propertyId/reservations/:reservationId` and `POST /api/properties/:propertyId/reservations/:reservationId/cancel`. The read route returns canonical reservation truth plus selected stay plan and allocation rows. The cancel route marks the reservation `cancelled`, writes `cancelled_at/cancel_reason`, clears selected stay-plan state by moving it to `discarded`, releases `locked`/`soft_allocated` room-night allocations, and thereby restores availability for the cancelled stay. | 2026-04-19 | Verified locally with live Worker requests on port 8791 against `db/seed_property_availability_smoke.sql`: `availability -> hold -> reservations -> get -> cancel -> availability` returned released allocations and reopened standard-room availability from `1/0` back to `2/1` for `2026-05-01 -> 2026-05-03`. |
| CHK-R86 | Property builder inventory backbone | done | Added tenant-scoped builder endpoints for `properties`, `room_types`, and `room_units`, including `POST /api/properties`, `PATCH /api/properties/:propertyId`, room-type create/list/update, room-unit create/list/update, and `POST /api/properties/:propertyId/room-units/bulk-create` as the quantity-style helper. This completes the missing bridge between schema-only inventory tables and the live availability engine: tenants can now configure property identity and physical sellable inventory through runtime APIs instead of SQL fixtures. | 2026-04-19 | Verified locally with live Worker requests on port 8791: created a fresh property, added one room type, bulk-created 3 units, then confirmed `POST /availability` returned `3/3` remaining nights. After patching one unit to `operational_status = 'maintenance'`, availability immediately dropped to `2/2`, proving builder-configured inventory now drives availability truth directly. |
| CHK-R87 | Property builder UI + minimal room-rate layer | done | Added migration `0071_property_room_rates.sql` plus tenant-scoped `GET/POST/PATCH /api/properties/:propertyId/room-rates` for one active base nightly rate anchor per room type. Replaced the old placeholder `public/properties-engine.html` with a real builder/admin page that uses `tid` + session cookie auth to manage properties, room types, single/bulk room units, base rates, and inline availability tests from one surface. Builder/rate/reservation-read/cancel endpoints now require an authenticated tenant actor, while public availability/hold/create-reservation paths remain open for direct-booking flow. | 2026-04-19 | Verified locally with live Worker requests on port 8791 using a real signed-up tenant session cookie: signup → create property → create room type → bulk-create 3 units → create room rate → availability returns `3/3` → patch one unit to `maintenance` → availability drops to `2/2`. `GET /properties-engine?tid=<tenantId>` returned `200 OK`. |

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
  - `GET /api/properties`
  - `POST /api/properties`
  - `PATCH /api/properties/:propertyId`
  - `GET /api/properties/:propertyId/room-types`
  - `POST /api/properties/:propertyId/room-types`
  - `PATCH /api/properties/:propertyId/room-types/:roomTypeId`
  - `GET /api/properties/:propertyId/room-units`
  - `POST /api/properties/:propertyId/room-units`
  - `POST /api/properties/:propertyId/room-units/bulk-create`
  - `PATCH /api/properties/:propertyId/room-units/:roomUnitId`
  - `GET /api/properties/:propertyId/room-rates`
  - `POST /api/properties/:propertyId/room-rates`
  - `PATCH /api/properties/:propertyId/room-rates/:roomRateId`
  - `POST /api/properties/:propertyId/availability`
  - `POST /api/properties/:propertyId/availability/hold`
  - `POST /api/properties/:propertyId/reservations`
  - `GET /api/properties/:propertyId/reservations/:reservationId`
  - `POST /api/properties/:propertyId/reservations/:reservationId/cancel`

## Current limits of the verified property baseline

- only a minimal one-rate-per-room-type base nightly rate layer exists; there is still no seasonal pricing, rate-plan matrix, package pricing, or per-date override engine
- direct-commit path only
- no separate admin/manual confirm route yet
- no guest/public hotel booking UI yet
- room-type-level hold granularity only
- reservation create baseline verified only for `rooms_requested = 1`
- no property reservation update/rebook/check-in/check-out lifecycle endpoints yet

## Boundary notes

- This ledger is only for the standalone property engine built on `properties`, `room_types`, `room_units`, `inventory_holds`, `property_reservations`, `reservation_stay_plans`, and `reservation_allocations`.
- Universal catalog/storefront checkpoints that happen to mention hotels still belong in `03A_PROGRESS_LEDGER_TOUR_PLATFORM.md` when they operate on `tenant_universal_hotels`, product modules, universal pages, or public site rendering.
- In practice, `CHK-R47` and `CHK-R49` are intentionally **not** repeated here because they are catalog/storefront work, not property-engine runtime work.

## Recommended next property slices

- add reservation read + cancel baseline so the property reservation lifecycle stops at a clean minimum complete surface
- add hold release / expiry management endpoint for operational correction paths
- extend reservation commit beyond `rooms_requested = 1`
- expand the room-rate layer from single base nightly rates into real rate plans / seasonal overrides only after the inventory backbone remains stable
- add room-state and housekeeping operational routes on top of migrations `0066`–`0068`
- connect folio header/line runtime on top of migrations `0069`–`0070`