---
description: "Use when working on property availability, reservation planning, room allocation, allotments, room rack, planning grid, room-unit occupancy, or property-engine inventory logic. Keeps agents anchored to the runtime availability model and prevents drift to older planning docs."
name: "Property Availability Runtime Truth"
applyTo: "src/routes/properties/**, public/property-staff.html, public/properties-engine.html, docs/ai/01_CURRENT_STATE.md, docs/ai/31_PROPERTY_AVAILABILITY_AND_ALLOCATION.md, docs/ai/43_PROPERTY_PHASE1_SCHEMA_DRAFT.md"
---
# Property Availability Runtime Truth

- Treat `src/routes/properties/availability.js` as the implementation source of truth for current runtime availability behavior.
- Use `docs/ai/01_CURRENT_STATE.md` as the runtime documentation source of truth.
- Treat `docs/ai/31_PROPERTY_AVAILABILITY_AND_ALLOCATION.md` and `docs/ai/43_PROPERTY_PHASE1_SCHEMA_DRAFT.md` as approved target-model docs, not as sufficient proof that a behavior already exists in runtime.

## Current runtime invariants

- Availability is night-based: a stay consumes nights from `check_in` through `check_out - 1`.
- Sellable inventory starts from active `room_units` whose `operational_status` is not `maintenance` or `out_of_order`.
- Blocking inventory is subtracted from sellable inventory using:
  - overlapping `reservation_allocations` with `allocation_status IN ('soft_allocated', 'locked')`
  - overlapping active, unexpired `inventory_holds`
  - overlapping active `property_allotments`
- `reservation_allocations` is the lane-level occupancy truth for rack/planning decisions. Do not replace it with `property_reservations` header-only logic.
- Pricing is separate from availability. `property_room_rates`, seasonal overrides, weekday pricing rules, pricing profiles, and `pricing_snapshot` must not redefine inventory truth.

## Preserve the shared execution path

- Keep availability, planning, hold creation, reservation create, and rebook anchored to the shared calculation flow rather than forking logic.
- Do not let commit paths trust stale client-side availability. Re-run server-side availability/planning before inventory-affecting writes.
- Preserve the distinction between:
  - sellable availability at room-type level
  - concrete room-unit lane fit through stay-plan segments

## Current runtime plan vocabulary

- Current runtime plan types include `contiguous_same_type`, `contiguous_upgrade`, `split_same_type`, `split_mixed_category`, and `roh_multi_category`.
- If docs use slightly different target names such as `split_with_upgrade`, do not silently rename runtime plan types unless the implementation, consumers, and docs are updated together.

## When changing this model

- Update `src/routes/properties/availability.js` first.
- Then update `docs/ai/01_CURRENT_STATE.md` if runtime behavior changed.
- Then update `docs/ai/03B_PROGRESS_LEDGER_HOTEL_PROPERTY.md` when the change is checkpoint-relevant.
- Do not claim future property-engine behaviors as implemented until code and runtime docs both show them.