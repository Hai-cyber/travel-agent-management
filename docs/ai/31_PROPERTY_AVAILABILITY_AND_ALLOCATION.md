# PROPERTY AVAILABILITY AND ALLOCATION

> RUNTIME NOTE:
> This document defines the approved target model for the future property availability engine.
> The current rescue runtime does **not** implement this engine yet.

## Purpose

This document locks the canonical model for:

- availability
- allocation
- split stay
- upgrade-to-preserve logic
- cancellation / modification / rebooking behavior as they affect inventory

This is the core of the future property engine.

## Canonical time model

Availability is **night-based**.

- `check_in` does not consume inventory by itself
- `check_out` does not consume inventory
- consumed inventory is the set of `stay_nights = [check_in, ..., check_out - 1]`

Example:

- stay `17 -> 19` consumes nights `17` and `18`
- stay `18 -> 20` consumes nights `18` and `19`

All availability calculations must use this night model.

## Core concepts

### `room_type`
- the commercial category sold to the customer
- example: Standard, Deluxe, Suite

### `room_unit`
- one real physical room
- example: `STD-101`, `DLX-302`

### `lane`
- the time axis of one `room_unit`
- each physical room is one lane

### `brick`
- one `room_unit` on one `stay_date`

### `block`
- the booking demand across all requested stay nights

### `stay_plan`
- the concrete way a reservation can be fulfilled
- one or more segments across room units and room types

## Split rules

Two concepts must not be mixed.

### `split_lane`
- different bookings can occupy different lanes over time
- always allowed

### `split_stay`
- the same reservation is fulfilled across more than one room unit and/or room type during the stay
- commercially valid
- not the default preferred outcome

## Required preference order

Availability and allocation must rank outcomes in this order.

1. contiguous stay, same requested room type
2. contiguous stay with small upgrade
3. split stay, same room type
4. split stay with upgrade
5. no sellable stay plan, but nearby alternatives

## Why split stay must remain in the engine

Split stay must exist in the engine because it is commercially valid in real property operations.

Examples:

- one room move is acceptable if it saves the booking
- one-night upgrade may be preferable to moving the guest twice
- front desk needs a ranked list of feasible operational plans, not just yes/no availability

However, split stay should not outrank contiguous stay by default.

## Public vs desk visibility

The engine should produce availability for two audiences.

### Public/customer-facing
- show contiguous stays first
- show split stay only if property policy allows it
- show nearby dates and other room types when unavailable

### Desk/internal-facing
- show the full ranked plan set
- include room moves, upgrade suggestions, and operational notes

## Required property policies

These policies should exist at the property level.

- `split_stay_enabled`
- `split_stay_public_visible`
- `allow_upgrade_to_preserve_stay`
- `upgrade_mode`: `off | suggest_only | auto_if_penalty_better`
- `max_room_moves_per_reservation`
- `max_upgrade_segments_per_stay`
- `max_upgrade_level_jump`

## Upgrade to preserve smooth stay

This policy exists to avoid messy split stays when a small upgrade produces a smoother operational outcome.

### Principle
- if requested room type cannot stay contiguous
- and a small upgrade can preserve the stay better than a room move
- engine should rank the upgrade plan above the split plan when policy allows

### Typical use case
- Standard requested for 4 nights
- no contiguous Standard lane exists
- one final night in Deluxe would preserve a smooth stay

In that case the desk view should prefer:

- `contiguous with small upgrade`

over:

- `split same type with room move`

### Commercial handling
In early versions, this should default to:

- `complimentary smoothing upgrade`

Later, properties may support:

- guest-confirmed paid upgrade
- partial surcharge logic

## Availability answer model

The engine should answer more than `available: true/false`.

### Required outputs

1. `nightly_remaining`
- remaining sellable inventory per stay night for the requested room type

2. `shortage_dates`
- the nights that break the requested stay

3. `stay_plans`
- ranked candidate plans for the reservation

4. `same_type_nearby_options`
- nearby dates with the same duration and room type

5. `other_room_type_options`
- same requested dates in another room type

## Stay plan model

A `stay_plan` should contain:

- `plan_type`
- `score`
- `move_count`
- `upgrade_segments`
- `public_visible`
- `segments[]`
- `ops_notes[]`

### Example `plan_type` values
- `contiguous_same_type`
- `contiguous_upgrade`
- `split_same_type`
- `split_with_upgrade`

### Example segment
- `room_type_id`
- `room_unit_id`
- `check_in`
- `check_out`

## Ranking rules

The engine should rank plans with a penalty model.

### Low penalty
- contiguous same type

### Medium penalty
- contiguous with small upgrade
- one room move, same type

### Higher penalty
- split with multiple moves
- split with larger upgrade jumps

### Hard limits
- reject plans beyond `max_room_moves_per_reservation`
- reject plans beyond `max_upgrade_level_jump`

The exact numeric penalty values can evolve later, but the preference order above should remain stable.

## Sellable availability vs allocation fit

Two checks must be distinguished.

### Sellable availability
- can the property commercially offer a stay plan for the requested nights and rooms?

### Allocation fit
- can the engine map that sellable stay plan to concrete room-unit segments?

In a clean room-unit model, a sellable plan must correspond to a feasible allocation plan.

## Example — split lane vs split stay

Room type `Standard` has 5 room units.

### Existing reservations
- reservation A: `17 -> 19`, quantity `2`
- reservation B: `18 -> 20`, quantity `3`

### Night occupancy
- night 17: `2 / 5`
- night 18: `5 / 5`
- night 19: `3 / 5`

### Interpretation
- night 18 is full
- night 19 still has 2 lanes free

If another reservation requests `20 -> 21`, quantity `1`, it can still fit because night 20 is free on at least one lane.

This is normal `split_lane` behavior, not split stay.

## Example — commercial split stay

Customer requests:

- room type: `Standard`
- stay: `10 -> 14`
- quantity: `1`

Contiguous Standard is not possible.

The engine may return:

1. `contiguous_upgrade`
- Deluxe for `10 -> 14`

2. `split_same_type`
- Standard room A for `10 -> 12`
- Standard room C for `12 -> 14`

3. `split_with_upgrade`
- Standard for `10 -> 13`
- Deluxe for `13 -> 14`

Desk users should see all three ranked.
Public users should see only those allowed by policy.

## Allocation lifecycle

Allocation should support three practical levels.

### `unallocated`
- reservation exists, but no room unit is fixed yet

### `soft_allocated`
- room unit/plan chosen, still changeable

### `locked`
- allocation locked for arrival/check-in operations

### Practical rule
- direct booking may confirm at room-type level first
- room-unit lock can happen closer to arrival or at check-in

## Holds

Availability requires inventory holds.

### `soft_hold`
- short TTL
- used for checkout/payment flow

### `manual_hold`
- internal operational hold
- created by front desk or reservation agent

Holds should reduce sellable availability while active.

## Cancellation

Cancellation must release the correct future nights.

Required fields include:

- `cancel_reason`
- `cancelled_at`
- `cancelled_by`
- `cancellation_policy_snapshot`

The cancellation policy must be snapshotted at booking time, not looked up dynamically later.

## Modification

Modification should not destroy the old reservation before the new one fits.

### Modification flow
1. create modification request
2. check availability for the proposed change
3. rank stay plans for the new request
4. if accepted, replace old allocation with new allocation
5. keep full audit trail of the change

This applies to:

- date change
- quantity change
- room type change

## Rebooking

Rebooking is not the same as modification.

### Modification
- same reservation identity continues

### Rebooking
- old reservation closes
- new reservation is created
- both remain linked in audit/history

Use rebooking when the new stay is materially different enough that preserving one reservation identity is less clear than creating a linked new one.

## Operational state interaction

Room operational state must remain separate from reservation state.

### Room state examples
- `ready`
- `occupied`
- `dirty`
- `cleaning`
- `inspected`
- `maintenance`
- `out_of_order`

### Reservation state examples
- `confirmed`
- `checked_in`
- `checked_out`
- `cancelled`
- `no_show`

Operational room state influences sellable availability, especially for same-day turnover and maintenance.

## Nearby alternative logic

When a requested stay cannot be sold, the engine should propose:

1. same room type, nearby dates, same duration
2. same dates, other room types
3. internal split-stay candidates if policy allows

This means the response explains *why* the stay cannot be sold and *what can be sold instead*.

## Minimal v1 algorithm

To keep the first engine shippable:

1. search contiguous same-type plans
2. search contiguous small-upgrade plans
3. search one-move split same-type plans
4. search one-move split-with-upgrade plans
5. rank and return

Do not start with a heavy optimizer.

## Final decisions locked by this document

1. availability is night-based
2. lane = room unit
3. split lane is always allowed
4. split stay is commercially valid
5. contiguous stay remains preferred
6. small upgrade to preserve smooth stay is valid and policy-driven
7. availability responses must include shortage explanation and alternatives
8. modification must not destroy the old reservation before the new one fits