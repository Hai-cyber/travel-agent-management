# PROPERTY ENGINE OVERVIEW

> RUNTIME NOTE:
> This document records the approved target direction for the standalone property engine.
> The current rescue runtime now implements a substantial part of this engine already, including availability, reservations, room operations, folios, housekeeping, allotments, and the first public-hotel bridge slices.
> Actual implemented runtime slices remain listed in `01_CURRENT_STATE.md`.

## Purpose

This document defines the **simple-to-ship, commercially strong** direction for the standalone property engine and the next commercial steps beyond the runtime that already exists.

The goal is not to build a full PMS in v1.
The goal is to ship a property operating system that can:

- sell rooms reliably
- accept bookings from multiple sources
- support front-desk room operations
- support simple folio/POS posting
- give tenants a path into larger distribution platforms later

## Core principle

`availability` is the core of the property engine.

Everything else depends on it:

- reservation intake
- allocation
- front-desk operations
- housekeeping timing
- modification / rebooking
- distribution helpers

If availability is weak, the rest of the property engine becomes operationally unreliable.

## Domain separation

This property engine remains separate from tour-side accommodation.

### Tour-side accommodation
- `stop_accommodation`
- belongs to `tour_stop`
- itinerary/service context only
- does not own room inventory

### Property engine
- `property`
- owns room inventory, room operations, reservation logic, folio/POS, and staff workflows

This split is already approved in `26_PROPERTY_ENGINE_AND_STAFF_SEATS.md` and must remain intact.

## Ship strategy

The property engine should ship in three layers.

### Layer 1 — Core sellable engine
- property availability
- reservation intake
- room allocation
- simple folio/POS

### Layer 2 — Daily operations
- arrivals / departures board
- room map by floor
- housekeeping states
- maintenance / out-of-order states

### Layer 3 — Distribution helpers
- OTA/email booking draft intake
- listing/export helpers
- future external platform/channel support

## Tenant product modes

The property engine now sits inside a platform that can serve more than one tenant shape.
Public product work should therefore recognize three tenant product modes:

- `tour-only`
- `hotel-only`
- `hybrid tour + hotel`

These are not only styling differences.
They imply different:

- homepage structures
- navigation defaults
- search intent
- listing blocks
- booking CTAs

For hotel-mode tenants, the public surface must become hotel-first rather than a temporary extension of the tour shell.

## V1 scope

The first commercial version should include:

1. single-property-per-tenant support first
2. room type + room unit + night-based availability
3. booking intake from direct / imported draft / manual sources
4. reservation lifecycle and allocation, including expected arrival metadata
5. simple folio/POS sourced from bookings plus manual postings, with optional unified invoice direction for hotel + tour tenants
6. room map by floor with operational states
7. listing/distribution helpers, but not full channel sync

## What v1 is not

The first version should **not** try to become:

- a full outlet POS
- a full channel manager
- a fully automatic OTA synchronizer
- a full accounting suite
- a generic multi-entity pricing framework shared with tours

Those can come later.

## Canonical modules

### 1. Availability
- room type
- room unit
- lane allocation
- stay plan ranking
- contiguous stay vs split stay
- upgrade to preserve smooth stay

### 2. Reservation intake
- direct booking
- OTA/email-forwarded booking draft
- manual booking
- expected arrival time to property
- expected flight details
- optional airport transfer capture
- confirm / cancel / modify / rebook

### 3. Allocation
- room-type level sellability
- room-unit level assignment
- soft allocation
- locked allocation at check-in

### 4. Simple folio / POS
- room charges
- manual charges
- add-on services manually posted by front desk
- optional unified invoice for hotel stay + tour services under one tenant
- payments
- adjustments
- checkout summary

### 5. Operations app
- arrivals / departures board
- floor map
- room state transitions
- arrival-time awareness for late/early arrivals
- housekeeping workflow
- maintenance workflow

### 6. Distribution helper
- listing helper
- OTA draft import helper
- future platform posting/sync boundary

## Canonical entities

The future property schema family should start from these concepts.

- `property`
- `room_type`
- `room_unit`
- `property_reservation`
- `reservation_allocation`
- `reservation_stay_plan`
- `folio`
- `folio_line`
- `payment_record`
- `property_staff_assignment`

Optional derived/materialized support may be added later, such as `room_night`, but the model should not depend on that table conceptually.

## Staff and access model

Staff remain part of the tenant, not separate tenants.

### Identity layer
- `user`
- `membership`
- `auth_session`

### Property-side operational roles
- `property_admin`
- `reservation_agent`
- `front_desk`
- `housekeeping_manager`
- `fnb_manager`

The property engine should consume the tenant/staff-seat model already approved in `26_PROPERTY_ENGINE_AND_STAFF_SEATS.md`.

## Commercial policies that must be explicit

The property engine should not hide these decisions in code.
They should be explicit property-level settings.

- `split_stay_enabled`
- `split_stay_public_visible`
- `allow_upgrade_to_preserve_stay`
- `upgrade_mode`
- `max_room_moves_per_reservation`
- `max_upgrade_segments_per_stay`
- `max_upgrade_level_jump`
- `default_check_in_time`
- `default_check_out_time`
- `same_day_turnover_sellable`

## Recommended implementation order

1. lock canonical naming and policies
2. add property schema family without touching tour pricing
3. add availability and allocation model
4. add reservation intake + modification/rebooking rules
5. add room map and operational state app
6. add simple folio/POS
7. add distribution helpers

## Future expansion paths

After the core is stable, the natural expansion paths are:

- rate plans and package inventory
- group reservations
- owner/complimentary stays
- maintenance planning
- housekeeping workload routing
- guest pre-arrival flows
- billing/accounting exports
- real OTA/channel sync

## Companion docs

- `26_PROPERTY_ENGINE_AND_STAFF_SEATS.md` — separation and staff-seat direction
- `31_PROPERTY_AVAILABILITY_AND_ALLOCATION.md` — canonical availability, allocation, split stay, and stay-plan rules
- `32_PROPERTY_RESERVATION_INTAKE_AND_BOOKING_SOURCES.md` — direct, imported-draft, and manual reservation intake model
- `33_PROPERTY_OPERATIONS_APP.md` — floor map, room states, housekeeping, maintenance, and room-move operations
- `34_PROPERTY_SIMPLE_FOLIO_AND_POS.md` — booking-derived charges, manual postings, payments, and checkout settlement
- `35_PROPERTY_DISTRIBUTION_HELPER.md` — listing helper, draft-ingestion boundary, and future channel-sync scope
- `36_PROPERTY_ENGINE_IMPLEMENTATION_ROADMAP.md` — execution order and phase checkpoints for building the property engine