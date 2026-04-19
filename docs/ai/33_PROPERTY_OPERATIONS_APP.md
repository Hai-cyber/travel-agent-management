# PROPERTY OPERATIONS APP

> RUNTIME NOTE:
> This document records the approved target direction for the property operations app.
> The current rescue runtime does **not** implement this module yet.

## Purpose

This document defines the operational layer that sits on top of:

- availability
- reservation intake
- allocation

The goal is to make day-to-day property work practical without forcing the first version to become a heavy PMS.

## Core principle

The operations app is the daily working surface for the property team.

Its job is not to re-decide availability.
Its job is to turn confirmed reservations and stay plans into smooth real-world execution.

This means the operations app must make it easy to answer:

- who arrives today?
- who departs today?
- which room is in what state?
- which room must be cleaned next?
- where is maintenance blocking sellable inventory?
- where does a split stay or upgrade require human coordination?

## Why this layer matters commercially

Availability may sell the room, but operations protects the guest experience.

This layer is commercially important because it prevents:

- missed check-ins
- dirty-room arrivals
- forgotten room moves
- maintenance conflicts
- same-day turnover failures

## Three core boards

The first version should be centred around three operational boards.

### 1. Arrivals / departures board
- today arrivals
- today departures
- tomorrow arrivals
- unassigned or risky stays
- split-stay handoff warnings

### 2. Room map by floor
- floor
- room number
- room type
- room state
- current/next reservation context

### 3. Housekeeping / maintenance board
- dirty rooms
- rooms in cleaning
- rooms ready for arrival
- rooms in maintenance / out-of-order

These three boards are enough to make the product feel operationally real.

## Room map by floor

The room map should be the visual core of the operations app.

Each room card should show:

- `room_number`
- `floor`
- `room_type`
- current operational state
- guest/stay context if occupied or arriving
- next action hint when relevant

### Example states visible on map
- `occupied`
- `dirty`
- `cleaning`
- `ready`
- `inspected`
- `maintenance`
- `out_of_order`

The map should support quick scanning before it supports deep editing.

## Reservation state vs room state

These must remain separate.

### Reservation state examples
- `confirmed`
- `checked_in`
- `checked_out`
- `cancelled`
- `no_show`

### Room operational state examples
- `ready`
- `occupied`
- `dirty`
- `cleaning`
- `inspected`
- `maintenance`
- `out_of_order`

### Rule
Reservation events can change room state, but room state is not the same thing as reservation state.

Example:

- guest checks out
- reservation becomes `checked_out`
- room becomes `dirty`, not `checked_out`

## Canonical room state transitions

The simple operational flow should be:

1. `ready`
2. `occupied`
3. `dirty`
4. `cleaning`
5. `inspected`
6. `ready`

Parallel blocking states:

- `maintenance`
- `out_of_order`

### Practical rule
- `occupied` blocks sellability for the relevant stay nights
- `dirty` and `cleaning` affect operational readiness
- `maintenance` and `out_of_order` block sellability and allocation

## Arrivals / departures board

This board should be optimized for shift-start clarity.

### Arrivals view should show
- guest name
- arrival date
- expected arrival time to property
- room type booked
- allocated room if assigned
- payment or folio warning if relevant
- split-stay or upgrade note if relevant
- airport transfer note if relevant

### Departures view should show
- guest name
- room number
- departure date
- folio/payment settlement warning if relevant
- housekeeping next-state trigger

### Important flags
- `unallocated arrival`
- `split stay handoff today`
- `upgrade-preserve stay`
- `same-day turnover pressure`
- `late arrival expected`
- `airport transfer coordination needed`

## Split stay operational handling

Because split stay is commercially valid, the operations app must make it visible.

The app should show:

- move date
- from room
- to room
- whether upgrade is involved
- whether staff support is required

This should not be buried inside reservation detail.

It should appear as a first-class operational warning on the relevant arrival/departure day.

## Upgrade-preserve operational handling

If the engine used upgrade to preserve a smoother stay, operations should see that explicitly.

Examples:

- complimentary one-night upgrade to avoid room move
- upgrade applied on final night due to overlap

The ops surface should show this as a stay-plan note, not as a hidden pricing anomaly.

## Housekeeping board

The housekeeping board should be optimized around work sequencing, not guest sales logic.

### First version should support
- rooms needing cleaning now
- rooms in progress
- rooms waiting inspection
- rooms ready
- arrival-priority rooms

### Useful fields per room
- room number
- floor
- room type
- current state
- next arrival date/time if any
- priority level

## Housekeeping priorities

The first version should use simple priorities.

### Suggested priority buckets
- `arrival_today_high`
- `arrival_today_normal`
- `departure_clean`
- `routine`
- `blocked_maintenance`

This is enough for v1; no need for workforce optimization yet.

## Maintenance board

Maintenance must be visible because it affects availability truth.

### Maintenance should support
- issue opened
- room blocked
- ETA or target restore date
- return to service

### Canonical states
- `maintenance`
- `out_of_order`
- `returned_to_ready`

### Rule
Any room in maintenance/out-of-order must be excluded from normal sellable allocation.

## Same-day turnover policy

This is where operations and availability meet.

The operations app should make same-day turnover visible, because this is one of the highest-risk operational edges.

### Needed signals
- departure today + arrival today on same room
- room not yet cleaned
- inspection not completed
- expected arrival time is near / already passed

### Policy relationship
If property policy allows same-day turnover sales, the operations app must highlight those rooms as high priority.

## Expected arrival time handling

Expected arrival time to the property should be visible on operational boards because guests do not always arrive at a generic check-in boundary.

This should influence:

- room preparation priority
- front desk staffing attention
- airport transfer coordination
- late-arrival awareness

The operations app does not need a full transport module in v1, but it should surface arrival timing clearly.

## Airport transfer operational handling

If a reservation includes airport transfer, the operations app should surface:

- arrival vs departure transfer
- expected flight / transport reference
- expected arrival time to property
- whether transfer is already coordinated or still pending

This is especially important for tenants that sell both lodging and airport pickup as one hospitality workflow.

## Front desk actions

The first operations app should support a narrow but valuable set of front-desk actions.

- mark checked in
- mark checked out
- soft-assign room
- lock room assignment
- move room when stay plan requires it
- mark room dirty
- mark room ready
- move room to maintenance/out-of-order

Avoid adding too many side workflows before these are solid.

## Room move workflow

Split stay or operational reassignment requires a visible room move workflow.

### Minimal room move flow
1. identify move-required stay
2. show current room and next room
3. confirm move completed
4. update room states and stay plan segment lock

This can remain lightweight in v1, but it must exist explicitly.

## Suggested data concepts

The operations app likely needs these supporting concepts.

- `room_state_event`
- `housekeeping_task`
- `maintenance_issue`
- `room_move_event`
- `property_shift_note` (optional later)

These do not all need full CRUD in v1, but the concepts should be preserved in the design.

## Mobile boundary

The first build should remain desktop-first.

### Desktop-first reasons
- floor map is visually dense
- arrivals/departures need multi-column context
- room-move operations benefit from larger layout

### Mobile later
- housekeeping task updates
- room ready / dirty toggles
- maintenance photo/reporting

## What v1 should not do yet

The first version should avoid:

- complex staff rostering
- route optimization for housekeeping
- full incident management
- deep cross-property command center
- outlet POS embedded into room operations

Those are expansion layers, not day-1 requirements.

## Recommended v1 implementation order

1. room map by floor with room states
2. arrivals/departures board
3. housekeeping board
4. maintenance blocking flow
5. split-stay / room-move operational warnings

This order gives operational usefulness quickly while staying aligned with the availability core.

## Companion docs

- `30_PROPERTY_ENGINE_OVERVIEW.md` — overall property engine scope
- `31_PROPERTY_AVAILABILITY_AND_ALLOCATION.md` — availability and stay-plan rules
- `32_PROPERTY_RESERVATION_INTAKE_AND_BOOKING_SOURCES.md` — booking intake and source model