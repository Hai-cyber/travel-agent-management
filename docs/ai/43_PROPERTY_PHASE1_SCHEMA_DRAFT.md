# PROPERTY PHASE-1 SCHEMA DRAFT

> RUNTIME NOTE:
> This document records the target schema draft for property-engine phase 1.
> The current rescue runtime already ships part of this availability-first schema family (`properties`, `room_types`, `room_units`, `property_reservations`, `inventory_holds`, `reservation_stay_plans`, `reservation_stay_plan_segments`, `reservation_allocations`) plus later extensions.
> Treat this file as the phase-1 target schema reference, not as the authoritative list of what is currently shipped.
> This is a planning document aligned with the approved availability-first property roadmap.

## Purpose

This document defines the first concrete schema layer for the property engine.

Its scope is limited to phase 1:

- property identity
- room inventory
- reservation truth
- stay plans
- allocations
- inventory holds

It does **not** attempt to cover later folio, housekeeping, maintenance, or channel-sync expansion.

## Core rule

Phase 1 exists to make availability trustworthy.

That means this schema must support:

- night-based inventory
- room-type sellability
- room-unit allocation
- contiguous vs split-stay planning
- upgrade-preserve planning
- safe reservation confirmation

## Phase-1 schema families

### 1. Properties

#### `properties`
Purpose:
- top-level hospitality business unit under a tenant

Required fields:
- `id`
- `tenant_id`
- `name`
- `slug`
- `status`
- `timezone`
- `currency`
- `default_check_in_time`
- `default_check_out_time`
- `split_stay_enabled`
- `split_stay_public_visible`
- `allow_upgrade_to_preserve_stay`
- `upgrade_mode`
- `max_room_moves_per_reservation`
- `max_upgrade_segments_per_stay`
- `max_upgrade_level_jump`
- `same_day_turnover_sellable`
- `created_at`
- `updated_at`

Notes:
- one tenant may later own multiple properties
- phase 1 can still operate with one-property-per-tenant in product scope

### 2. Room types

#### `room_types`
Purpose:
- commercial room categories sold to guests

Required fields:
- `id`
- `tenant_id`
- `property_id`
- `code`
- `name`
- `description`
- `base_capacity`
- `max_occupancy`
- `sort_order`
- `active`
- `created_at`
- `updated_at`

Recommended indexes:
- `(tenant_id, property_id, active)`
- unique `(property_id, code)`

### 3. Room units

#### `room_units`
Purpose:
- physical sellable rooms / lanes

Required fields:
- `id`
- `tenant_id`
- `property_id`
- `room_type_id`
- `room_number`
- `floor_label`
- `sort_order`
- `active`
- `operational_status`
- `created_at`
- `updated_at`

`operational_status` initial values:
- `ready`
- `maintenance`
- `out_of_order`

Notes:
- more detailed room-state history belongs to later operations schema
- phase 1 only needs enough operational state to block sellability safely

Recommended indexes:
- `(tenant_id, property_id, room_type_id, active)`
- unique `(property_id, room_number)`

### 4. Property reservations

#### `property_reservations`
Purpose:
- canonical reservation truth for the property engine

Required fields:
- `id`
- `tenant_id`
- `property_id`
- `source`
- `source_ref`
- `source_payload`
- `status`
- `guest_name`
- `guest_email`
- `guest_phone`
- `check_in`
- `check_out`
- `room_type_id`
- `rooms_requested`
- `adults`
- `children`
- `pricing_snapshot`
- `special_requests`
- `expected_arrival_time`
- `expected_flight_ref`
- `expected_arrival_channel`
- `airport_transfer_requested`
- `airport_transfer_price_snapshot`
- `cancellation_policy_snapshot`
- `confirmed_at`
- `confirmed_by`
- `cancelled_at`
- `cancelled_by`
- `cancel_reason`
- `created_at`
- `updated_at`

Initial `status` values:
- `pending_payment`
- `confirmed`
- `cancelled`
- `no_show`
- `checked_in`
- `checked_out`

Important rule:
- this table is property truth
- do not generalize it into a shared cross-engine booking table

Recommended indexes:
- `(tenant_id, property_id, status, check_in)`
- `(tenant_id, property_id, check_in, check_out)`
- `(tenant_id, source, source_ref)`

### 5. Inventory holds

#### `inventory_holds`
Purpose:
- temporary inventory protection during checkout or review

Required fields:
- `id`
- `tenant_id`
- `property_id`
- `room_type_id`
- `hold_type`
- `source_type`
- `source_id`
- `check_in`
- `check_out`
- `rooms_requested`
- `status`
- `expires_at`
- `created_at`

`hold_type` initial values:
- `soft_hold`
- `manual_hold`
- `review_hold`

`status` initial values:
- `active`
- `released`
- `expired`
- `consumed`

Notes:
- phase 1 can start with room-type-level holds
- room-unit-specific hold granularity can come later if needed

### 6. Reservation stay plans

#### `reservation_stay_plans`
Purpose:
- ranked candidate or selected plans for how a reservation is fulfilled

Required fields:
- `id`
- `tenant_id`
- `property_id`
- `reservation_id`
- `plan_type`
- `score`
- `move_count`
- `upgrade_segments`
- `public_visible`
- `is_selected`
- `status`
- `meta_json`
- `created_at`
- `updated_at`

`plan_type` initial values:
- `contiguous_same_type`
- `contiguous_upgrade`
- `split_same_type`
- `split_with_upgrade`

`status` initial values:
- `candidate`
- `selected`
- `locked`
- `discarded`

Important rule:
- a reservation may have multiple candidate plans
- only one plan should be selected at a time

### 7. Reservation stay plan segments

#### `reservation_stay_plan_segments`
Purpose:
- concrete date-range segments inside one stay plan

Required fields:
- `id`
- `tenant_id`
- `property_id`
- `reservation_id`
- `stay_plan_id`
- `segment_order`
- `room_type_id`
- `room_unit_id`
- `check_in`
- `check_out`
- `segment_type`
- `upgrade_applied`
- `ops_notes`
- `created_at`

`segment_type` initial values:
- `base`
- `upgrade`
- `split_move`

Notes:
- `room_unit_id` may be null for candidate plans before full allocation is chosen
- once the plan is selected and allocated, this should become explicit

### 8. Reservation allocations

#### `reservation_allocations`
Purpose:
- room-night level allocation truth for selected plans

Required fields:
- `id`
- `tenant_id`
- `property_id`
- `reservation_id`
- `stay_plan_id`
- `room_unit_id`
- `stay_date`
- `allocation_status`
- `created_at`
- `updated_at`

`allocation_status` initial values:
- `soft_allocated`
- `locked`
- `released`

Important rule:
- this table is the clearest source for lane occupancy by night
- it should be the allocation truth once a plan is selected

Recommended indexes:
- `(tenant_id, property_id, room_unit_id, stay_date)`
- `(tenant_id, reservation_id, stay_date)`
- unique `(room_unit_id, stay_date, allocation_status)` only after implementation chooses the exact conflict strategy

## Availability computation inputs

Phase 1 availability should consider at least:

- active `room_units`
- `room_units.operational_status`
- active `inventory_holds`
- selected/locked `reservation_allocations`
- reservation date range and rooms requested

This is enough to support sellable availability without introducing a dedicated `room_nights` materialization table immediately.

## Optional derived table

### `room_nights` (optional, not required in phase 1)
This may be introduced later if query cost or reporting complexity justifies it.

Phase 1 should not depend on it.

## Recommended implementation order

1. `properties`
2. `room_types`
3. `room_units`
4. `property_reservations`
5. `inventory_holds`
6. `reservation_stay_plans`
7. `reservation_stay_plan_segments`
8. `reservation_allocations`

This order supports availability-first implementation and matches the agreed roadmap.

## Constraints and safeguards

### Tenant isolation
Every table above must carry `tenant_id` and all queries must respect it.

### Date model
All date range logic must treat:
- `check_in` as start
- `check_out` as exclusive end
- `stay_date` as consumed inventory nights only

### Domain separation
Do not attach these tables to tour itinerary/service tables directly.

Cross-engine commercial/billing relationships can come later through shared primitives, not by collapsing domain truth.

## Non-goals

This schema draft does not yet define:

- room-state history tables
- housekeeping tables
- maintenance tables
- folio tables
- channel sync tables

Those belong to later property phases.

## Companion docs

- `31_PROPERTY_AVAILABILITY_AND_ALLOCATION.md`
- `32_PROPERTY_RESERVATION_INTAKE_AND_BOOKING_SOURCES.md`
- `36_PROPERTY_ENGINE_IMPLEMENTATION_ROADMAP.md`
- `41_ENGINE_PHASE1_EXECUTION_CHECKLISTS.md`
- `42_DB_MIGRATION_PROPOSAL_SHARED_TOUR_PROPERTY.md`