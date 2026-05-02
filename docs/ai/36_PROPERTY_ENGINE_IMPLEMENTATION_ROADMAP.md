# PROPERTY ENGINE IMPLEMENTATION ROADMAP

> RUNTIME NOTE:
> This document records the recommended build order for the future property engine.
> The current rescue runtime already implements a large part of this engine; use this roadmap as ship-order guidance for what remains and for how the hotel/public product should now evolve.

## Purpose

This document turns the property engine design set into an execution-friendly roadmap.

It exists so the team can answer:

- what must be built first
- what can wait
- what should not be mixed too early
- how to ship a commercially strong first version without overbuilding

## Core rule

Build property engine from the inside out.

That means:

1. availability first
2. reservation intake second
3. operations third
4. folio/POS fourth
5. distribution helper after the core is stable

Do not invert this order.

## Phase map

### Phase 0 — Lock design truth

Goal:
- freeze naming
- freeze policies
- freeze domain boundaries

Required outputs:
- approved property engine docs
- approved availability policies
- approved split-stay and upgrade-preserve rules
- approved intake source model

Must not do yet:
- schema sprawl
- UI prototyping detached from the model
- premature OTA/channel promises

## Phase 1 — Availability core

Goal:
- make inventory trustworthy

Build:
- `property`
- `room_type`
- `room_unit`
- night-based availability logic
- contiguous-first stay-plan engine
- split-stay ranking
- upgrade-preserve ranking
- holds (`soft_hold`, optional `manual_hold`)

Acceptance criteria:
- availability always thinks in stay nights
- split lane vs split stay is cleanly separated
- engine returns shortage dates and nearby alternatives
- engine can rank contiguous, split, and upgrade-preserve plans

Do not do yet:
- outlet POS
- external sync
- housekeeping optimization

## Phase 2 — Reservation intake

Goal:
- get all booking sources into one canonical reservation flow

Build:
- direct booking intake
- manual booking intake
- imported draft intake
- draft confirm/reject flow
- availability recheck at confirm time
- stay-plan selection persistence

Acceptance criteria:
- all sources end in one canonical `property_reservation`
- no draft can bypass availability recheck
- source, source_ref, and source_payload remain traceable

Do not do yet:
- auto-accept external sync bookings
- source-specific reservation logic trees

## Phase 3 — Allocation and room operations

Goal:
- turn reservations into reliable physical room execution

Build:
- soft allocation
- locked allocation at arrival/check-in
- arrivals/departures board
- floor map
- room state machine
- housekeeping board
- maintenance blocking flow
- room move workflow for split stay

Acceptance criteria:
- room state is separate from reservation state
- split stay is visible operationally
- same-day turnover pressure is visible
- maintenance blocks sellable inventory

Do not do yet:
- workforce routing
- mobile-first rewrite

## Phase 4 — Simple folio/POS

Goal:
- give front desk a credible commercial settlement workflow

Build:
- folio per reservation
- booking-derived room charges
- manual add-on/service postings
- payment records
- checkout summary
- settlement and adjustment flow

Acceptance criteria:
- charges and payments are distinct records
- OTA-collected stays can still carry extras
- front desk can settle and close out clearly

Do not do yet:
- restaurant POS
- accounting ledger ambitions

## Phase 5 — Distribution helper

Goal:
- help tenants sell externally without taking sync risk too early

Build:
- listing helper
- room-type publish helper
- amenity mapping helper
- draft-based external booking ingestion support
- sync-readiness fields

Acceptance criteria:
- external distribution can be assisted without bypassing reservation core
- listing quality improves
- OTA/email bookings can enter review flow cleanly

Do not do yet:
- full two-way channel manager
- certified OTA connectivity claims

## Phase 6 — Controlled expansion

Only begin this phase after the earlier layers are stable.

Possible additions:
- rate plans
- package inventory
- group reservations
- owner/complimentary stays
- multiple folios
- tax exports
- sync health dashboards
- real OTA/channel sync

## Critical build dependencies

### Dependency 1
Operations depends on allocation.

Without stable allocation and room-state rules, floor map and housekeeping become cosmetic.

### Dependency 2
Folio depends on reservation truth.

Without a canonical reservation core, billing becomes fragmented.

### Dependency 3
Distribution helper depends on intake truth.

Without a strong intake workflow, external bookings create chaos instead of leverage.

### Dependency 4
Real sync depends on availability truth.

If availability is weak, sync multiplies damage.

## Minimal commercial v1

If the team wants the smallest viable commercial property product, it should stop after Phase 4.

That means:
- availability works
- reservations from 3 sources work
- room map and room-state operations work
- simple folio and checkout work

This is already sellable.

## Rescue runtime ship order from the current repo state

The current rescue runtime is already materially beyond the early Phase-4 baseline.
For the next shipping cycle, the team should not restart from the abstract phase map above.
It should instead follow this commercial completion order:

1. tenant experience modes
2. hotel-first public layout scaffold
3. hotel public content model
4. hotel stay search + availability results
5. hotel booking commit path
6. property staff authorization hardening
7. close the remaining B2B/operator guest-folio execution gap (`CHK-R132`)
8. hotel publish/content package using the existing shell/runtime stack
9. hotel packaging / pricing / productization docs
10. only then decide whether deeper visual forks are truly necessary

## Tenant experience modes

The current rescue repo now serves more than one commercial tenant shape.
For public product work, the team should treat tenant experience mode as a first-class product decision.

### Locked modes

- `tour_operator`
- `hotel_operator`
- `hybrid_operator`

### Why this matters

These modes do not differ only by styling.
They differ by:

- homepage information architecture
- primary search intent
- listing entity model
- CTA behavior
- publish defaults
- onboarding defaults

The hotel product must not be implemented as a temporary tour-shell variation once room-selling becomes a first-class product line.

## Refined hotel-first completion order

`NEXT-P18` should now be treated as a structured hotel-first track, not a single storefront task.

### `NEXT-P18A` — tenant experience modes

Goal:
- lock `tour-only`, `hotel-only`, and `hybrid` public product modes

Required outputs:
- mode-aware onboarding defaults
- mode-aware navigation and homepage defaults
- mode-aware publish scaffolds

### `NEXT-P18B` — hotel public layout scaffold

Goal:
- build a true hotel-first public layout

Required outputs:
- hero stay search
- room-category sections
- hotel-first navigation and CTA structure
- property/gallery/amenity/policy blocks in hotel order

### `NEXT-P18C` — hotel public content model

Goal:
- make room-selling content first-class

Required outputs:
- room-type imagery
- room-type descriptions
- amenity and policy presentation model
- property/location presentation model

### `NEXT-P18D` — hotel stay search + availability results

Goal:
- place availability-first discovery inside the hotel layout

Required outputs:
- stay-search UI inside hotel mode
- room-option results from shared property availability/pricing truth
- no drift into parallel hotel booking logic

### `NEXT-P18E` — hotel booking commit path

Goal:
- close the hotel revenue loop only after the layout and content model are correct

Required outputs:
- hold/commit flow
- guest booking form
- custom-domain commerce gating
- canonical reservation creation

### Why this order now

- The product-shape gap is now larger than the engine gap: the property runtime is already strong internally, but hotel tenants need a first-class public experience rather than a patched tour-shell accommodation page.
- Operational trust is the next constraint after public booking: the current tenant-admin-heavy gate is enough for development, but not strong enough for a real property team.
- B2B/operator execution should be closed before visual expansion: `CHK-R132` is now a strong rescue slice, but not yet the final enough-to-sell execution model.
- Hotel-specific visual forks should come last: first solve the hotel-first layout and information architecture problem inside the current shared runtime before deciding whether an additional skin split is justified.

### Current ship rule

Do not continue deeper hotel booking work before:

- tenant experience modes are locked
- the hotel-first layout scaffold exists
- the hotel public content model exists

Do not open a parallel hotel-only skin project before:

- `NEXT-P18A` through `NEXT-P18E` are materially complete
- property staff permissions are hardened
- `CHK-R132` is operationally closed enough to sell
- the hotel offer is documented clearly enough to price and present externally

## Recommended staffing mindset

During build, treat these as separate concerns even if one team handles all of them:

- inventory truth
- intake truth
- operational truth
- billing truth
- external-distribution boundary

This prevents shortcuts in one layer from corrupting the others.

## Decision checkpoints before implementation

Before coding begins, the team should explicitly confirm:

1. split stay public policy
2. upgrade-preserve policy
3. same-day turnover sellability
4. manual booking auto-confirm vs draft policy
5. folio settlement rules at checkout
6. distribution helper boundary vs real sync boundary

## Companion docs

- `30_PROPERTY_ENGINE_OVERVIEW.md`
- `31_PROPERTY_AVAILABILITY_AND_ALLOCATION.md`
- `32_PROPERTY_RESERVATION_INTAKE_AND_BOOKING_SOURCES.md`
- `33_PROPERTY_OPERATIONS_APP.md`
- `34_PROPERTY_SIMPLE_FOLIO_AND_POS.md`
- `35_PROPERTY_DISTRIBUTION_HELPER.md`
- `41_ENGINE_PHASE1_EXECUTION_CHECKLISTS.md`