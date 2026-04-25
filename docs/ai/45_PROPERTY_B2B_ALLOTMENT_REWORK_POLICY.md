# PROPERTY B2B ALLOTMENT REWORK POLICY

> RUNTIME NOTE:
> Current rescue runtime already ships `PATCH /api/properties/:propertyId/allotments/:allotmentId`, persisted `property_allotment_allocations`, confirm flow, rooming-list placeholders, and master/deferred folio routing.
> It does **not** yet ship a safe preview-and-apply rework flow for confirmed allotments. This document defines the approved target policy for that next slice.

## Purpose

This document defines how B2B / operator allotments may be edited after they have entered inventory-affecting states.

It exists to resolve the gap between:

- real commercial operations, where sales must be able to increase, decrease, reshape, or split operator blocks before guests are in house
- technical inventory truth, where persisted room allocations, planner lanes, rooming placeholders, and folio scaffolding must remain coherent after every change

## Problem statement

The current property runtime has reached a meaningful B2B baseline:

- operator blocks exist as `property_allotments`
- concrete room allocations exist as `property_allotment_allocations`
- confirmed blocks seed rooming-list entries and master-folio headers
- rack/planner/inventory now reflect those concrete allocations

However, the runtime still lacks a controlled edit model for inventory-shape changes after a block is allocated or confirmed.

The missing problem is not whether blocks should be editable.

The missing problem is how to make those edits without breaking:

- inventory truth
- concrete room-lane allocations
- rooming-list alignment
- audit trail clarity
- commercial meaning of the original commitment

## Core stance

### `in_house` is inventory-locked

Once an allotment is `in_house`, inventory shape is not editable.

Allowed changes are limited to soft metadata only.

### All earlier states are editable

`draft`, `active`, `allocated`, and `confirmed` remain editable.

But they are not all editable with the same mechanism.

The correct model is:

- `draft` / `active`: direct edit is acceptable
- `allocated` / `confirmed`: edit must become a rework flow with preview + transactional apply

## Distinguish ROH from non-ROH

### ROH confirmed allotments

Confirmed ROH blocks are commercially defined by pool rules rather than a single hard commercial category.

Therefore, confirmed ROH blocks may be reworked broadly as long as the updated request still respects the ROH policy and inventory truth.

Allowed rework inputs:

- `rooms_blocked`
- `check_in`
- `check_out`
- `roh_capacity_filter`
- `release_date`
- operator metadata and notes

Required runtime behavior:

- preview new pool fit
- preserve still-valid concrete allocations where possible
- release excess allocations when demand shrinks
- allocate additional lanes when demand grows
- re-run inventory checks before commit

### non-ROH confirmed allotments

Confirmed non-ROH blocks are commercially tied to a room category promise.

Therefore, the edit policy must preserve that meaning.

Allowed in-place rework:

- room count changes within the same room type
- date-range changes within the same room type
- full-block upgrade into one higher category, if policy allows and availability passes
- metadata changes

Not allowed as a naive in-place mutation:

- downgrade into a lower category without an explicit override policy
- turning one confirmed single-category block into a mixed-category block inside the same record

If a confirmed non-ROH block must become multiple categories, the system should split or reshape the block rather than silently mutating the original record into a mixed promise.

## Commercial promise rule

One allotment record should continue to represent one commercial promise.

That principle is what decides whether a change is an in-place edit or a restructure.

### In-place edit

Use in-place edit when the commitment remains one promise:

- same room type, different count
- same room type, different dates
- full upgrade to one higher room type
- ROH pool changes that remain one ROH promise

### Split / reshape

Use split or reshape when the commitment stops being one promise:

- `4 DLX` becomes `2 DLX + 2 SUP`
- one part remains in the original category while another moves to a different category
- a single confirmed non-ROH block becomes mixed-category inventory

In that case the runtime should:

- reduce or close the original allotment appropriately
- create one or more child/sibling allotments for the new category commitments
- link them through a shared `group_id`, `source_ref`, or future restructure reference
- record the split in the event trail

## State-by-state policy

### `draft`

- editable directly
- allocation preview optional
- no persisted room allocations need to be preserved

### `active`

- editable directly
- if the change affects inventory shape, preview is recommended before commit
- no confirmed contractual lock yet

### `allocated`

- editable, but through preview + apply
- existing `property_allotment_allocations` must be diffed, not discarded blindly
- room count shrink/grow and date/type changes may release and reallocate lanes

### `confirmed`

- editable, but only through rework preview + transactional apply
- rooming placeholders, master folio, and charge routing remain attached to the allotment lifecycle and must survive or be migrated coherently
- no naive PATCH should be treated as final target behavior for inventory-shape changes

### `in_house`

- inventory shape locked
- metadata-only edits allowed
- rooming execution and live occupancy now outrank commercial reshaping

## Required runtime workflow

Edits that touch inventory shape for `allocated` or `confirmed` should use a two-step flow.

### Step 1: preview

Client submits a proposed change set.

Preview returns:

- normalized proposed shape
- whether the change can be applied
- lanes that can be preserved
- lanes that must be released
- lanes that must be newly allocated
- rooming entries affected
- folio / payer-scope consequences when relevant
- warnings and conflicts

### Step 2: apply

Apply runs the same validation again, then commits transactionally:

- update master allotment row
- release obsolete concrete allocations
- allocate new concrete lanes
- reseed or remap rooming placeholders as required
- preserve master folio identity where possible
- record one clear rework event trail

## Required preview vocabulary

The preview response should distinguish these outcomes clearly:

- `preserved_allocations`
- `released_allocations`
- `new_allocations`
- `rooming_entries_to_keep`
- `rooming_entries_to_cancel`
- `rooming_entries_to_create`
- `requires_split`
- `requires_upgrade_policy`
- `conflicts`
- `warnings`

## UI guidance

### Planner / block ledger

The block ledger above the planner should remain the primary management surface.

Recommended controls:

- `Expand`
- `Edit`
- `Split`
- `Release`
- `Allocate Rooms`
- `Confirm`

### Edit side sheet

The edit UI should use a side sheet with three sections:

- commercial metadata
- inventory shape
- materialization impact

If the user changes inventory shape on an `allocated` or `confirmed` block, the side sheet should switch into preview mode before allowing apply.

### Split side sheet

For confirmed non-ROH blocks, a dedicated split action is preferable to forcing users through destructive release/recreate steps.

Example:

- source block: `4 DLX confirmed`
- split result: `2 DLX confirmed` + `2 SUP confirmed`

That is a cleaner commercial and audit model than mutating one record into mixed-category state.

## Current runtime gap this policy is meant to close

Current rescue runtime facts:

- `PATCH /api/properties/:propertyId/allotments/:allotmentId` exists
- persisted room allocations exist
- confirmed blocks are visible in rack/planner/housekeeping
- rooming placeholders and master folios exist

Current missing behavior:

- no preview/apply rework flow
- no split/reshape flow for confirmed non-ROH commitments
- no explicit policy matrix enforced by state + block type

## Implementation order

1. Document and freeze the policy matrix for ROH vs non-ROH edits.
2. Add preview endpoint for allotment rework.
3. Add apply endpoint for in-place rework.
4. Add split/reshape endpoint for confirmed non-ROH blocks.
5. Add planner-side edit / split UI in `public/property-staff.html`.
6. Extend smoke coverage to exercise grow, shrink, date-shift, full-upgrade, and split scenarios.

## Non-goals for the first slice

- guest check-in execution changes for `in_house`
- full contract engine or amendment approval workflow
- reworking guest folios in the same slice as allotment rework
- solving downgrade policy beyond explicit rejection or manual override messaging
