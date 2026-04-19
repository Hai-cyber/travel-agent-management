# ENGINE PHASE-1 EXECUTION CHECKLISTS

> RUNTIME NOTE:
> This document records the recommended phase-1 execution checklists for near-term implementation.
> It does not claim these items are already implemented.

## Purpose

This document turns the current architecture direction into actionable near-term work for:

- property availability core
- tour engine stabilization

These are the two practical tracks that can move in parallel without creating architectural drift.

## Track A — Property Availability Core

### Goal
- build the smallest trustworthy property inventory engine

### Must-have scope
- `properties`
- `room_types`
- `room_units`
- night-based availability calculation
- contiguous-first stay-plan search
- split-stay and upgrade-preserve ranking
- availability response with shortage dates and alternatives

### Checklist
- [ ] Lock canonical `stay_nights` behavior in code-facing schema notes
- [ ] Draft property schema family for `properties`, `room_types`, `room_units`, `property_reservations`
- [ ] Draft `stay_plan` and `reservation_allocation` entities
- [ ] Define tenant-configurable availability policies
- [ ] Define hold model: `soft_hold` and optional `manual_hold`
- [ ] Define API shape for availability check
- [ ] Define ranked stay-plan response shape
- [ ] Define first-fit contiguous search rules
- [ ] Define one-move split search rules
- [ ] Define small-upgrade search rules
- [ ] Define shortage explanation payload
- [ ] Define nearby alternative search rules
- [ ] Write narrow test matrix for night overlaps and lane behavior

### Minimum test cases
- [ ] same-day `check_out` does not consume inventory
- [ ] split lane works without implying split stay
- [ ] contiguous fit outranks split stay
- [ ] upgrade-preserve outranks worse split when policy allows
- [ ] shortage date is returned when one night breaks the stay
- [ ] nearby alternatives return same duration suggestions

### Stop conditions
- Do not build room map UI before availability truth is stable
- Do not build channel sync before this test matrix passes

## Track B — Tour Engine Stabilization

### Goal
- turn the nearly-complete tour engine into something testable and commercially reliable

### Must-have scope
- booking lifecycle validation
- ops-board reliability
- reminder correctness
- thread/log correctness
- inline edit/save confidence
- booking draft ingest direction alignment

### Checklist
- [ ] Run focused regression tests on booking lifecycle states
- [ ] Validate ops board filters, bulk actions, and inline save flows
- [ ] Validate reminder suppression behavior after recent outbound contact
- [ ] Validate audit behavior on booking todo updates
- [ ] Validate thread entry behavior and auto-status transitions
- [ ] Validate service meta edits against seeded/rendered state
- [ ] Validate dashboard/ops board continuity after edits
- [ ] Review task/reminder cadence against actual due logic
- [ ] Define test scenarios for email draft ingest confirm flow
- [ ] Define distribution-helper dependency points for tour publishing surfaces

### Minimum test cases
- [ ] first outbound contact moves pending todo to contacted when intended
- [ ] reminder cron skips recently contacted supplier tasks
- [ ] bulk stop actions preserve board filters correctly
- [ ] inline edit path persists person-in-charge and service meta correctly
- [ ] audit rows are written only for changed todo fields
- [ ] draft-confirm direction does not bypass booking review logic

### Stop conditions
- Do not widen into full growth/site rebuild before booking/ops stability is proven
- Do not widen into advanced mobile workflows before desktop operational flows are stable

## Shared execution rules

- prefer narrow executable validation over broad conceptual progress
- fix runtime truth before polishing large adjacent surfaces
- keep shared-kernel concepts consistent while the two tracks advance
- do not let property engine borrow tour-specific truth, or vice versa

## Near-term recommendation

If capacity is limited:

1. stabilize the tour engine enough to run with confidence
2. build only the property availability core in parallel
3. postpone wider property UI until availability and reservation truth exist

This is the lowest-risk parallel path.

## Companion docs

- `36_PROPERTY_ENGINE_IMPLEMENTATION_ROADMAP.md`
- `39_SHARED_KERNEL_BETWEEN_TOUR_AND_PROPERTY.md`
- `40_SHARED_KERNEL_SCHEMA_DRAFT.md`