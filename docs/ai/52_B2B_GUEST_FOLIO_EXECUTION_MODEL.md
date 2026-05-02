# B2B GUEST FOLIO EXECUTION MODEL

> RUNTIME NOTE:
> This document records the approved execution target for closing `CHK-R132` / `NEXT-P20`.
> It is an execution-model and workflow document, not proof that the full B2B/operator rooming workflow already exists in runtime.
> Actual implemented slices must still be verified in `01_CURRENT_STATE.md`.

## Purpose

This document defines what must exist for B2B/operator allotment execution to be considered commercially credible rather than only technically demonstrated.

Its purpose is to close the gap between:

- current planner-side compact rooming controls
- and a real operator rooming execution workflow strong enough to sell

## Current runtime baseline

The rescue runtime already has a meaningful first slice.

Existing foundations include:

- confirmed allotments with persisted concrete allocations
- rooming-list entries per allocated room
- master folio header and master-routed folio lines
- deferred guest charges for guest-scope billing
- rooming entry `reservation_id` linkage
- deferred guest-charge consumption into reservation folios when linkage exists
- parent allotment state sync between `confirmed` and `in_house`
- compact planner-side rooming execution panel
- front-desk visibility for confirmed/in-house allotment occupancy

This is a strong rescue slice.
It is not yet the final enough-to-sell execution model.

## Core rule

B2B/operator execution must allow a confirmed allotment to move through one coherent operational flow:

1. confirmed block
2. rooming entry preparation
3. concrete guest/reservation linkage
4. guest-folio execution for guest-scope charges
5. in-house operational execution
6. check-out / post-stay reconciliation

Do not leave these as disconnected planner tricks.

## What “closed enough to sell” means

`CHK-R132` / `NEXT-P20` should only be considered complete when the system supports a credible operator workflow for actual arrival-day execution.

That means the platform must no longer depend on:

- hidden compact controls only visible in a planner editor
- manual mental mapping between rooming placeholders and live desk occupancy
- guest-scope charge deferral without a reliable execution path

## Required workflow layers

### 1. Rooming preparation layer

This layer already exists partially.

It should support:

- placeholder rooming entries for each allocated room
- guest/leader label capture
- payer-scope capture
- notes per rooming entry

But the final model should also make this usable in a dedicated board, not only in a compact planner-side panel.

### 2. Reservation linkage layer

Each rooming entry must be able to link cleanly to a canonical reservation when one exists.

Rules:

- linkage must be explicit
- one rooming entry must not ambiguously point to multiple reservations
- linkage should remain auditable

The linkage step is what turns a placeholder operator occupant into a concrete guest stay with normal hotel lifecycle support.

### 3. Guest-folio execution layer

Guest-scope deferred charges must become real guest folio lines once a concrete reservation target exists.

This is the heart of `CHK-R132`.

The system must ensure:

- deferred guest charges are not stranded
- guest-scope charges do not get lost when rooming execution becomes concrete
- master-only vs guest-only vs mixed billing remains coherent

### 4. In-house desk execution layer

After rooming and linkage are concrete, the in-house desk should be able to operate these occupants without pretending they are retail reservations created manually from scratch.

Needed outcomes:

- operator room can check in
- operator room can check out
- occupancy is visible in desk/rack views
- linked guest folio can be inspected and settled where policy allows

### 5. Reconciliation layer

The workflow must preserve clarity between:

- operator-paid charges
- guest-paid charges
- deferred-but-now-consumed guest charges
- any remaining unreconciled items

Without this, mixed B2B billing becomes operationally confusing.

## Dedicated board requirement

The current compact planner-side execution panel is not enough as the final UX.

The next execution model should provide a dedicated rooming board or equivalent focused operational surface.

This dedicated surface should support:

- list of rooming entries for one allotment
- rooming status by entry
- reservation linkage visibility
- payer-scope visibility
- guest-folio routing count/status
- quick handoff into front-desk execution

The planner panel may remain useful, but it should stop being the only serious execution surface.

## Role boundary

This workflow should align with the property staff authorization model.

Recommended access:

- `property_admin`: full access
- `front_desk`: operational linkage/check-in/check-out and guest-folio execution visibility
- `reservation_agent`: reservation linkage and pre-arrival prep
- `housekeeping`: visibility only where occupancy/task context requires it

Do not leave B2B operator execution dependent on one manager-only compact panel forever.

## Canonical object rule

Even in B2B/operator execution, the system must preserve one canonical reservation core.

That means:

- rooming placeholders are not the final guest-stay truth
- concrete guest stay execution should converge into linked reservations and folios
- master folio and guest folio remain explicit billing surfaces, not improvised notes

## State expectations

The execution model should make these transitions clear.

### Allotment state
- `confirmed`
- `in_house`
- later `released` / `closed` after stay completion when appropriate

### Rooming entry state
- `pending`
- `named`
- `checked_in`
- `checked_out`
- `cancelled`

### Guest-folio execution state
- deferred guest charge exists
- deferred guest charge linked to reservation
- deferred guest charge consumed into guest folio
- deferred guest charge reconciled / settled through normal folio flow

These state changes should be visible and auditable.

## Minimum enough-to-sell outcomes

For this checkpoint to be considered commercially credible, the team should be able to demonstrate:

1. confirm operator block
2. prepare named rooming entries
3. link one or more entries to real reservations
4. consume guest-scope deferred charges into guest folios
5. execute check-in/check-out from an operational board without inventing retail reservations manually
6. inspect what was billed to master vs guest clearly

If any of those still requires ad hoc interpretation, the slice is not yet closed enough to sell.

## Relationship to current runtime

The current runtime should now be treated as:

- strong foundation for `CHK-R132`
- but still incomplete because the workflow remains too compact and manager-centric

In other words:

- model work exists
- linkage work exists
- first folio execution bridge exists
- final operator execution UX does not yet exist

## Required implementation outputs for `NEXT-P20`

The checkpoint should not be considered complete until all of these are decided:

- dedicated rooming execution surface requirement
- reservation-linkage rules per rooming entry
- guest-folio consumption rules for deferred guest charges
- front-desk/operator execution handoff
- mixed billing reconciliation visibility
- role boundary for B2B/operator execution

## Non-goals for this checkpoint

- full OTA/group contracting suite
- external operator portal
- accounting export redesign
- generic multi-property back-office overhaul

This checkpoint is about making operator/B2B execution operationally credible first.