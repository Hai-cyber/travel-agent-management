# PROPERTY RESERVATION INTAKE AND BOOKING SOURCES

> RUNTIME NOTE:
> This document records the approved target direction for property reservation intake.
> The current rescue runtime does **not** implement this module yet.

## Purpose

This document defines how the future property engine should accept bookings from multiple sources while preserving one canonical reservation model.

The design goal is:

- simple to ship
- commercially useful early
- compatible with later OTA/channel expansion
- never dependent on fragile sync as the first step

## Core principle

Different booking sources may exist, but there should be only **one reservation core**.

The engine should not create separate booking systems for:

- direct website bookings
- OTA/imported bookings
- manual/front-desk bookings

All of them should converge into one canonical property reservation model.

## Canonical funnel

Every inbound booking source should flow through the same states:

1. `inbound_record`
2. `draft`
3. `validated_reservation`
4. `allocated_stay`
5. `folio / operational lifecycle`

This means source differs, but reservation truth does not.

## Three booking sources locked for v1

### 1. Direct booking
- guest books via the property's own system
- availability is checked live
- hold may be created during checkout
- on confirmation, reservation becomes canonical directly

### 2. Imported draft booking
- booking originates outside the platform
- example: forwarded Booking.com / Agoda / Expedia email
- system parses the inbound record into a draft
- human confirms before it becomes a real reservation

### 3. Manual booking
- front desk / phone / Zalo / Facebook / agent booking
- staff creates the reservation by hand
- may start directly as draft or validated reservation depending on workflow policy

## Why imported draft comes before real sync

The engine should prefer `draft ingestion` before full OTA sync.

Reasons:

- lower implementation risk
- lower overbooking risk
- better human control in the early product phase
- faster time to market

The principle remains:

> do not sync the world first; ingest the world into one workflow first.

## Canonical reservation object

Every confirmed property booking should become one `property_reservation` record, regardless of source.

Required canonical fields should include:

- `id`
- `tenant_id`
- `property_id`
- `source`
- `source_ref`
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

Operational arrival fields should also be supported early:

- `expected_arrival_time`
- `expected_flight_ref`
- `expected_arrival_channel` (flight / self-arrival / transfer / unknown)
- `airport_transfer_requested`
- `airport_transfer_price_snapshot`

Optional support fields can be added later, but these should anchor the model.

## Source taxonomy

The source should be explicit and structured.

Recommended values:

- `direct_web`
- `direct_widget`
- `ota_forwarded`
- `manual_frontdesk`
- `manual_phone`
- `manual_agent`
- `manual_message`

Source must describe where the booking came from, not how it was later reviewed.

## Source reference rules

Every non-direct booking should preserve external traceability.

### `source_ref`
- OTA reservation number
- email booking reference
- phone reference note if no external ID exists

### `source_payload`
- raw source data or normalized parsed draft payload
- useful for audit and later troubleshooting

The reservation should never lose its original source trail.

## Draft model

The system should support a pre-reservation draft layer for uncertain or external bookings.

### Draft use cases
- forwarded OTA email parsed by system
- reservation agent creates a partial booking and finishes later
- manual intake where dates/source need review

### Draft actions
- confirm
- edit + confirm
- ignore
- reject

### Rule
Drafts are operational work items, not live inventory truth.

Inventory should only be consumed when draft policy explicitly creates a hold, or when the draft is confirmed.

## Reservation state model

A simple state model should be enough for early property operations.

### Draft-side
- `received`
- `draft`
- `needs_review`
- `ignored`
- `rejected`

### Reservation-side
- `pending_payment`
- `confirmed`
- `cancelled`
- `no_show`
- `checked_in`
- `checked_out`

Do not overload one state machine to handle both intake review and stay lifecycle.

## Holds during intake

The intake system should support temporary inventory protection without forcing immediate confirmation.

### `soft_hold`
- used in direct booking checkout
- short TTL

### `review_hold`
- optional policy for imported drafts or manual bookings
- gives staff short protected time to confirm the booking

This should be property-policy driven, not mandatory for every source.

## Confirm flow by source

### Direct booking
1. availability check
2. soft hold
3. payment / commit step
4. reservation confirmed
5. allocation and folio pipeline starts

### Imported draft
1. inbound record received
2. parsed into draft
3. staff reviews and edits
4. availability rechecked at confirm time
5. reservation confirmed

### Manual booking
1. staff enters dates / room type / guest data
2. staff captures expected arrival time and transfer need when relevant
2. availability checked immediately
3. reservation created as draft or confirmed based on policy

## Availability recheck rule

Every draft confirmation must re-run availability before creating the final reservation.

This is mandatory because:

- the draft may be stale
- another reservation may have consumed inventory after the draft arrived
- a hold may have expired

This prevents intake from bypassing availability.

## Intake and stay plans

Once availability returns a result, the intake layer should store:

- whether contiguous stay is possible
- whether split stay is possible
- whether upgrade-preserve is possible
- which stay plan was selected or proposed

This allows reservation intake and front desk allocation to stay consistent.

## Manual booking UX expectations

Manual booking is important enough to be first-class, not a side utility.

The flow should support:

- walk-in guest
- phone booking
- WhatsApp/Zalo/Facebook inquiry converted by staff
- offline agency booking

The UI should make manual entry fast:

- guest identity
- dates
- room type
- guest count
- expected arrival time to property
- expected flight / transport note when relevant
- airport transfer yes/no
- source
- notes

Nothing more should be required for v1.

## Arrival timing is first-class operational data

The property engine should treat `expected arrival time to hotel` as meaningful operational data, not a free-text afterthought.

Why this matters:

- late arrivals affect front desk readiness
- same-day turnover risk increases when arrival timing is known
- airport transfer service depends on arrival timing and flight reference
- housekeeping/front desk can prioritize rooms more accurately

## Default arrival/departure policy

The reservation intake layer should respect property-level defaults.

Recommended defaults:

- `default_check_in_time = 14:00`
- `default_check_out_time = 11:00`

These must remain tenant-configurable.

The UI should prefill them where relevant, but not hardcode them permanently.

## Airport transfer capture

Airport transfer should be supported as an early optional service because it influences both operations and folio posting.

The reservation intake layer should support:

- whether transfer is requested
- arrival or departure direction
- expected flight / transport reference
- tenant-configured transfer price snapshot at booking time

This should feed both operations and billing later.

## Imported booking draft UX expectations

Imported drafts should optimize for review speed, not raw completeness.

The UI should show:

- source badge
- parsed dates
- parsed guest name
- parsed booking ref
- parsed room type / amount if available
- confidence or review warning markers

Then staff should be able to:

- correct the data
- confirm the reservation
- discard the draft

## Commercial policy decisions to keep explicit

The following should remain configurable and visible in docs:

- `review_hold_enabled`
- `review_hold_ttl_minutes`
- `manual_booking_auto_confirm`
- `draft_confirmation_requires_availability_recheck`
- `allow_split_stay_confirmation_from_draft`
- `allow_upgrade_preserve_confirmation_from_draft`

## Interaction with cancellation, modification, and rebooking

Reservation intake should connect cleanly to later reservation lifecycle logic.

### Cancellation
- imported and manual reservations cancel through the same canonical reservation model

### Modification
- all sources use the same modification logic once confirmed

### Rebooking
- all sources may rebook into a new canonical reservation when needed

Source should remain part of the history, but not create different lifecycle logic.

## What v1 should not do yet

The first version should not require:

- real-time OTA sync
- partner certifications
- channel manager-grade conflict resolution
- auto-accepting every external inbound booking without review

Those can come later after the reservation core is stable.

## Recommended v1 implementation order

1. manual booking flow
2. direct booking flow with hold
3. imported booking draft flow
4. draft confirmation with availability recheck
5. stay-plan selection persistence

This order keeps the engine commercially useful without taking on channel sync risk too early.

## Companion docs

- `30_PROPERTY_ENGINE_OVERVIEW.md` — overall property engine scope
- `31_PROPERTY_AVAILABILITY_AND_ALLOCATION.md` — night-based availability and stay-plan logic