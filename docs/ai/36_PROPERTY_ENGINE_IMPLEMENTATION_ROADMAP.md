# PROPERTY ENGINE IMPLEMENTATION ROADMAP

> RUNTIME NOTE:
> This document records the recommended build order for the future property engine.
> The current rescue runtime does **not** implement this engine yet.

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