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
| CHK-R88 | Property pricing v2 — seasons, seasonal room prices, and stay quote | done | Added migration `0072_property_rate_seasons.sql` plus pricing v2 APIs: `GET/POST/PATCH /api/properties/:propertyId/rate-seasons`, `GET/POST/PATCH /api/properties/:propertyId/season-room-rates`, and `POST /api/properties/:propertyId/rates/quote`. Pricing resolution is now commercial-layer only: the quote endpoint resolves each stay night by active season first (ordered by `sort_order`), then falls back to the active base room rate if no season applies. `public/properties-engine.html` now exposes season builder, seasonal room-price builder, and quote output on the same admin surface. | 2026-04-19 | Verified locally with authenticated tenant session cookie on port 8792. In-season quote (`2026-12-24 -> 2026-12-27`) returned 3 nights at the seasonal price `180 USD` each, total `540 USD`. Outside the season (`2026-12-27 -> 2026-12-29`), quote fell back to base rate `120 USD` per night, total `240 USD`. Builder page `GET /properties-engine?tid=<tenantId>` returned `200 OK`. |
| CHK-R89 | Property pricing v2 — occupancy-aware quote baseline | done | Added migration `0073_property_rate_occupancy_adjustments.sql` to extend both base and seasonal room-rate tables with `included_adults`, `included_children`, `extra_adult_amount`, and `extra_child_amount`. `POST /api/properties/:propertyId/rates/quote` now accepts `adults`, `children`, and `rooms_requested` (currently verified only for `rooms_requested = 1`) and returns nightly occupancy adjustment breakdown plus `total_base_amount`, `total_occupancy_adjustment`, and final `total_amount`. `public/properties-engine.html` now exposes these pricing controls directly in the base-rate and seasonal-rate forms plus the quote panel. | 2026-04-19 | Verified locally with authenticated tenant session cookie on port 8793: base rate `100 USD`, included `2 adults`, extra adult `20 USD`, extra child `10 USD`; quote for `3 adults + 1 child` across `2026-08-01 -> 2026-08-03` returned `200 USD` base + `60 USD` occupancy adjustment = `260 USD` total. |
| CHK-R90 | Property lifecycle baseline — hold release, rebook, check-in, check-out | done | Added authenticated admin lifecycle endpoints: `POST /api/properties/:propertyId/availability/hold/:holdId/release`, `POST /api/properties/:propertyId/reservations/:reservationId/rebook`, `POST /api/properties/:propertyId/reservations/:reservationId/check-in`, and `POST /api/properties/:propertyId/reservations/:reservationId/check-out`. Rebook recalculates availability while excluding the current reservation's allocations, discards the previous selected stay plan, releases old allocations, and attaches a fresh locked stay plan/allocation set to the existing reservation. Reservation payloads now scope `stay_plan.segments` to the selected stay plan only. | 2026-04-19 | Verified locally with authenticated tenant session cookie on port 8793: creating a soft hold reduced availability from `2/2` to `1/1`; releasing the hold restored `2/2`. A confirmed reservation for `2026-09-10 -> 2026-09-12` was rebooked to `2026-09-12 -> 2026-09-14`, old allocations moved to `released`, new allocations stayed `locked`, and the reservation then transitioned `confirmed -> checked_in -> checked_out`. |

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
  - `GET /api/properties/:propertyId/rate-seasons`
  - `POST /api/properties/:propertyId/rate-seasons`
  - `PATCH /api/properties/:propertyId/rate-seasons/:seasonId`
  - `GET /api/properties/:propertyId/season-room-rates`
  - `POST /api/properties/:propertyId/season-room-rates`
  - `PATCH /api/properties/:propertyId/season-room-rates/:seasonRoomRateId`
  - `POST /api/properties/:propertyId/rates/quote`
  - `POST /api/properties/:propertyId/availability`
  - `POST /api/properties/:propertyId/availability/hold`
  - `POST /api/properties/:propertyId/availability/hold/:holdId/release`
  - `POST /api/properties/:propertyId/reservations`
  - `GET /api/properties/:propertyId/reservations/:reservationId`
  - `POST /api/properties/:propertyId/reservations/:reservationId/cancel`
  - `POST /api/properties/:propertyId/reservations/:reservationId/rebook`
  - `POST /api/properties/:propertyId/reservations/:reservationId/check-in`
  - `POST /api/properties/:propertyId/reservations/:reservationId/check-out`

## Current limits of the verified property baseline

- seasonal pricing v2 plus a single-room occupancy-aware quote baseline now exist, but there is still no multi-plan rate catalog, multi-room occupancy matrix, package pricing, CTA/public quote flow, or per-date manual override UI beyond season windows
- direct-commit path only
- no separate admin/manual confirm route yet
- no guest/public hotel booking UI yet
- room-type-level hold granularity only
- reservation create baseline verified only for `rooms_requested = 1`
- no early-checkout partial allocation release flow, no no-show/undo transitions, and no admin/manual confirm route yet

## Boundary notes

- This ledger is only for the standalone property engine built on `properties`, `room_types`, `room_units`, `inventory_holds`, `property_reservations`, `reservation_stay_plans`, and `reservation_allocations`.
- Universal catalog/storefront checkpoints that happen to mention hotels still belong in `03A_PROGRESS_LEDGER_TOUR_PLATFORM.md` when they operate on `tenant_universal_hotels`, product modules, universal pages, or public site rendering.
- In practice, `CHK-R47` and `CHK-R49` are intentionally **not** repeated here because they are catalog/storefront work, not property-engine runtime work.

## Recommended next property slices

- extend reservation commit beyond `rooms_requested = 1`
- expand pricing v2 from seasons + single-room occupancy surcharges into richer rate plans, multi-room occupancy pricing, and package/rule layers only after the current season model stays stable
- add room-state and housekeeping operational routes on top of migrations `0066`–`0068`
- connect folio header/line runtime on top of migrations `0069`–`0070`