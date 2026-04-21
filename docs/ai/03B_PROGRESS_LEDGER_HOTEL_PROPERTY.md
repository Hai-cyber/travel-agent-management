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
| CHK-R91 | Property pricing v2 — multi-room occupancy quote baseline | done | Extended `POST /api/properties/:propertyId/rates/quote` from single-room occupancy surcharge math to a multi-room aggregate quote baseline. The quote path now multiplies nightly base totals by `rooms_requested`, aggregates included adults/children across all requested rooms, and applies extra-adult/extra-child surcharges only to guest counts beyond that aggregate included capacity. It also rejects guest mixes that exceed `room_types.max_occupancy * rooms_requested`. | 2026-04-19 | Verified locally with authenticated tenant session cookie on port 8794: base rate `100 USD`, included `2 adults`, extra adult `20 USD`, extra child `10 USD`; quote for `2 rooms`, `5 adults`, `1 child`, `2026-11-01 -> 2026-11-03` returned nightly base total `200 USD`, nightly surcharge `30 USD`, and final total `460 USD` (`400 USD` base + `60 USD` surcharge). |
| CHK-R92 | Property lifecycle v2 — early check-out, no-show, undo-status, and admin UI controls | done | Added new authenticated admin endpoints: `POST /api/properties/:propertyId/reservations/:reservationId/early-check-out`, `POST /api/properties/:propertyId/reservations/:reservationId/no-show`, and `POST /api/properties/:propertyId/reservations/:reservationId/undo-status`. Early check-out shortens `check_out`, releases future allocations, and trims future selected-plan segments. No-show discards the selected stay plan and releases active allocations. Undo-status currently supports `checked_in -> confirmed` and `no_show -> confirmed`, with the no-show restore path rechecking availability and attaching a fresh selected stay plan. `public/properties-engine.html` now includes hold-release, reservation lookup, rebook, early check-out, and lifecycle action controls on the same builder/admin surface. | 2026-04-19 | Verified locally with authenticated tenant session cookie on port 8794. `no-show` returned `200` and `undo-status` restored the reservation to `confirmed` with a relocked selected plan. `early-check-out` from a checked-in stay changed `check_out` from `2026-11-23` to `2026-11-22` and returned the future allocation for `2026-11-22` as `released`. Builder page `GET /properties-engine?tid=<tenantId>` returned `200 OK` after the new lifecycle controls were added. |
| CHK-R93 | Property pricing v2 — explicit per-room guest assignment quote | done | Extended `POST /api/properties/:propertyId/rates/quote` again so the occupancy engine can switch from aggregate room-count math to explicit per-room guest assignment pricing when `room_guest_assignments` is provided. Each room assignment now receives its own nightly base, occupancy adjustment, and nightly total in the quote output while the API still returns the aggregated stay totals. | 2026-04-19 | Verified locally with authenticated tenant session cookie on port 8795. Quote for `2 rooms`, `5 adults`, `1 child`, `2026-12-01 -> 2026-12-03` with assignments `Room A = 2 adults + 1 child`, `Room B = 3 adults` returned room-level nightly totals `110 USD` and `120 USD`, plus stay total `460 USD` (`400 USD` base + `60 USD` surcharge). |
| CHK-R94 | Property lifecycle v3 — reservation event trail and checked-out undo baseline | done | Added migration `0074_property_reservation_events.sql` plus lifecycle event recording for reservation create, rebook, cancel, check-in, check-out, early check-out, no-show, and undo actions. Reservation reads now return `events[]` so operational history is explicit. `POST /api/properties/:propertyId/reservations/:reservationId/undo-status` now also supports `checked_out -> checked_in`; when the checked-out state came from an early check-out, the restore path uses the recorded event payload to recover the previous `check_out`, rebuild a fresh selected stay plan, and relock room-night allocations when inventory is still available. `public/properties-engine.html` was reorganized into parent tabs (`Availability`, `Ops`) plus room-type tabs to keep lifecycle and availability surfaces dense but navigable. | 2026-04-19 | Verified locally with authenticated tenant session cookie on port 8795. Standard checkout undo restored reservation status from `checked_out` to `checked_in` and appended an `undo_status` event. Early-check-out undo restored `check_out` from `2026-12-22` back to `2026-12-23`, rebuilt locked allocations for the recovered night, and returned a clear event trail including `early_check_out` and `undo_status`. Builder page `GET /properties-engine?tid=<tenantId>` returned `200 OK` after the tabbed UI refactor. |
| CHK-R95 | Property UI split — tenant config vs staff operations | done | Formalized the separation between tenant-facing property configuration and staff-facing property operations. Added `GET /api/properties/:propertyId/reservations` as a staff-board feed filtered by `board_date`, `status`, and `limit`, then created `public/property-staff.html` as a separate staff workspace with tabs for front desk, housekeeping baseline, maintenance, guest support, and POS/folio boundary. `public/properties-engine.html` now links directly to the staff workspace so property configuration and shift operations are no longer collapsed into one surface. | 2026-04-19 | Verified locally on port 8798. `GET /property-staff` and `GET /properties-engine` both returned `200 OK`. An authenticated smoke flow created tenant/property/room/reservation data and `GET /api/properties/:propertyId/reservations?board_date=2026-12-24&status=all` returned a live front-desk reservation summary with `arrival_today = true`. |
| CHK-R96 | Property addon service presets for tenant config | done | Added migration `0075_property_addon_service_presets.sql` plus tenant-scoped property addon catalog APIs: `GET/POST/PATCH /api/properties/:propertyId/addon-service-presets` and `POST /api/properties/:propertyId/addon-service-presets/seed-defaults`. `public/properties-engine.html` now lets tenants seed common presets or define custom addon services such as airport pickup, breakfast upgrade, extra bed, late checkout, laundry, or spa passes. The catalog now enforces the commercial rule at the backend layer: addons are onsite-only by default, and airport pickup is the only pre-arrival exception. `public/property-staff.html` shows the configured addon catalog read-only in the `POS / Folio` lane so staff can see what should later be postable into folios without mixing config into staff operations. | 2026-04-19 | Verified locally on port 8800. Seeded defaults now returned 5 presets, with only `AIRPORT-PICKUP` carrying `prearrival_exception = true`. A custom `SPA-PASS` create returned `onsite_only = true` and `prearrival_exception = false`. |
| CHK-R97 | Properties-engine UI — CRUD actions for all item types | done | Added Edit/Copy/Del action buttons to all list items in `properties-engine.html`: room types, room units, base rates, rate seasons, seasonal room rates, and addon presets. Each row now has an inline action bar. Edit fills the corresponding form and puts it into update (PATCH) mode with a teal submit button and Cancel to restore create mode. Copy pre-fills the form as a new item. Delete confirms then calls the resource-specific DELETE endpoint. Added `clearEditMode`, `setEditMode`, and `fillForm` helpers. Action buttons for room units show Edit + Del only (no Copy, as bulk-create is the preferred path for units). Properties list was refactored from a flat button to a card div with an inner select-button and a separate action row so Edit/Copy/Del fit cleanly below each property card. | 2026-04-21 | Deployed `9ede6a46`. Delete JSON parse error fixed (empty 204 body no longer throws). |
| CHK-R98 | Backend DELETE routes for all property builder resources | done | Added 7 DELETE handler functions in `src/routes/properties.js` and registered their routes in `src/index.js`: `DELETE /api/properties/:propertyId`, `DELETE .../room-types/:roomTypeId`, `DELETE .../room-units/:roomUnitId`, `DELETE .../room-rates/:roomRateId`, `DELETE .../addon-service-presets/:presetId`, `DELETE .../rate-seasons/:seasonId`, `DELETE .../season-room-rates/:seasonRoomRateId`. Each handler verifies tenant, requires manager role, returns 404 if not found, and returns 204 No Content on success. Previously all DELETE calls fell through to a 404 with empty body causing the "Delete failed: Delete failed" client error. | 2026-04-21 | Deployed `3f48217e`. |

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
  - `DELETE /api/properties/:propertyId`
  - `GET /api/properties/:propertyId/room-types`
  - `POST /api/properties/:propertyId/room-types`
  - `PATCH /api/properties/:propertyId/room-types/:roomTypeId`
  - `DELETE /api/properties/:propertyId/room-types/:roomTypeId`
  - `GET /api/properties/:propertyId/room-units`
  - `POST /api/properties/:propertyId/room-units`
  - `POST /api/properties/:propertyId/room-units/bulk-create`
  - `PATCH /api/properties/:propertyId/room-units/:roomUnitId`
  - `DELETE /api/properties/:propertyId/room-units/:roomUnitId`
  - `GET /api/properties/:propertyId/room-rates`
  - `POST /api/properties/:propertyId/room-rates`
  - `PATCH /api/properties/:propertyId/room-rates/:roomRateId`
  - `DELETE /api/properties/:propertyId/room-rates/:roomRateId`
  - `GET /api/properties/:propertyId/rate-seasons`
  - `POST /api/properties/:propertyId/rate-seasons`
  - `PATCH /api/properties/:propertyId/rate-seasons/:seasonId`
  - `DELETE /api/properties/:propertyId/rate-seasons/:seasonId`
  - `GET /api/properties/:propertyId/season-room-rates`
  - `POST /api/properties/:propertyId/season-room-rates`
  - `PATCH /api/properties/:propertyId/season-room-rates/:seasonRoomRateId`
  - `DELETE /api/properties/:propertyId/season-room-rates/:seasonRoomRateId`
  - `POST /api/properties/:propertyId/rates/quote`
  - `POST /api/properties/:propertyId/availability`
  - `POST /api/properties/:propertyId/availability/hold`
  - `POST /api/properties/:propertyId/availability/hold/:holdId/release`
  - `GET /api/properties/:propertyId/addon-service-presets`
  - `POST /api/properties/:propertyId/addon-service-presets`
  - `POST /api/properties/:propertyId/addon-service-presets/seed-defaults`
  - `PATCH /api/properties/:propertyId/addon-service-presets/:presetId`
  - `DELETE /api/properties/:propertyId/addon-service-presets/:presetId`
  - `POST /api/properties/:propertyId/reservations`
  - `GET /api/properties/:propertyId/reservations`
  - `GET /api/properties/:propertyId/reservations/:reservationId`
  - `POST /api/properties/:propertyId/reservations/:reservationId/cancel`
  - `POST /api/properties/:propertyId/reservations/:reservationId/rebook`
  - `POST /api/properties/:propertyId/reservations/:reservationId/check-in`
  - `POST /api/properties/:propertyId/reservations/:reservationId/check-out`
  - `POST /api/properties/:propertyId/reservations/:reservationId/early-check-out`
  - `POST /api/properties/:propertyId/reservations/:reservationId/no-show`
  - `POST /api/properties/:propertyId/reservations/:reservationId/undo-status`

## Current limits of the verified property baseline

- seasonal pricing v2 plus a multi-room aggregate occupancy-aware quote baseline now exist, but there is still no multi-plan rate catalog, per-room guest assignment matrix, package pricing, CTA/public quote flow, or per-date manual override UI beyond season windows
- direct-commit path only
- no separate admin/manual confirm route yet
- no guest/public hotel booking UI yet
- room-type-level hold granularity only
- reservation create baseline verified only for `rooms_requested = 1`
- no admin/manual confirm route yet, no actor-aware authorization model beyond the current tenant-admin gate, and no richer post-stay settlement flow tied to folios yet

## Boundary notes

- This ledger is only for the standalone property engine built on `properties`, `room_types`, `room_units`, `inventory_holds`, `property_reservations`, `reservation_stay_plans`, and `reservation_allocations`.
- Universal catalog/storefront checkpoints that happen to mention hotels still belong in `03A_PROGRESS_LEDGER_TOUR_PLATFORM.md` when they operate on `tenant_universal_hotels`, product modules, universal pages, or public site rendering.
- In practice, `CHK-R47` and `CHK-R49` are intentionally **not** repeated here because they are catalog/storefront work, not property-engine runtime work.

## Recommended next property slices

- extend reservation commit beyond `rooms_requested = 1`
- expand pricing v2 from seasons + per-room guest assignment pricing into richer rate plans, calendar overrides, and package/rule layers only after the current season model stays stable
- connect addon presets to actual folio posting, cashier posting rules, and public/agent upsell surfaces while preserving the onsite-only policy and the airport-pickup-only pre-arrival exception
- add real housekeeping task state, maintenance work orders, and folio/POS runtime behind the new staff-facing property operations shell
- add richer lifecycle event browsing/filtering in the UI instead of raw JSON payload inspection
- add room-state and housekeeping operational routes on top of migrations `0066`–`0068`
- connect folio header/line runtime on top of migrations `0069`–`0070`