# FIRST ACTUAL MIGRATION SET PROPOSAL

> RUNTIME NOTE:
> This document proposes the first concrete migration set for evolving the rescue schema toward the shared-kernel + property phase-1 direction.
> It is a planning document only. These migrations do **not** exist yet.

## Purpose

This document converts the schema and migration-planning docs into a concrete first migration batch.

It answers:

- which migration files should exist first
- what each migration should contain
- which migrations are safe to do now
- which migrations should wait

## Guiding principle

The first migration set should do two things only:

1. establish low-risk shared-kernel primitives that do not break current runtime
2. establish property-engine phase-1 schema for availability and reservation truth

It should **not** try to solve:

- full task/thread unification
- property room operations history
- folio tables
- channel sync structures

## Current migration baseline

The current migration folder ends at:

- `0056_tenant_calendar_secret.sql`

So the next proposed migration names start at `0057`.

## Proposed migration batch

### `0057_tenant_settings.sql`

Purpose:
- add shared tenant-level settings storage

Should create:
- `tenant_settings`

Why now:
- low risk
- useful for shared policies and property defaults
- does not collide with current engine truth tables

Suggested payload:
- `id`
- `tenant_id`
- `key`
- `value_json`
- `updated_at`
- `updated_by`

## `0058_staff_assignments.sql`

Purpose:
- add shared assignment primitive usable by both engines

Should create:
- `staff_assignments`

Why now:
- low risk
- future-safe for property staff scopes
- does not force current runtime rewrites

Suggested payload:
- `id`
- `tenant_id`
- `user_id`
- `scope_type`
- `scope_id`
- `role`
- `permissions_json`
- `created_at`

## `0059_inbound_records_and_draft_records.sql`

Purpose:
- add shared inbound capture and draft-review primitives

Should create:
- `inbound_records`
- `draft_records`

Why now:
- aligns with both tour booking ingest and future property imported reservations
- does not replace existing `booking_drafts`

Important rule:
- `booking_drafts` stays as tour-engine draft truth for now
- this migration adds a shared cross-engine intake envelope only

## `0060_property_foundation.sql`

Purpose:
- add top-level property entities and policy surface

Should create:
- `properties`

Why now:
- property engine cannot start without a property root entity
- property-level policies belong here, not scattered through `tenant_settings`

Suggested payload highlights:
- tenant linkage
- slug/name/status
- timezone/currency
- default check-in/check-out
- split-stay / upgrade-preserve policy fields

## `0061_property_room_inventory.sql`

Purpose:
- add commercial and physical room inventory tables

Should create:
- `room_types`
- `room_units`

Why now:
- these are the minimum inventory surfaces needed for lane-based availability

Important rule:
- keep `room_units` property-owned
- do not generalize them into shared kernel tables

## `0062_property_reservations.sql`

Purpose:
- add canonical property reservation truth

Should create:
- `property_reservations`

Why now:
- direct/manual/imported reservation flows need one property truth table

Suggested payload highlights:
- guest fields
- date range
- room_type_id
- rooms_requested
- source/source_ref/source_payload
- arrival timing / flight / transfer fields
- cancellation snapshot fields

## `0063_inventory_holds.sql`

Purpose:
- add temporary inventory protection for property availability flows

Should create:
- `inventory_holds`

Why now:
- direct booking checkout and review-hold behavior need explicit inventory protection

Important rule:
- room-type-level holds are enough for the first pass

## `0064_property_stay_plans.sql`

Purpose:
- add stay-plan candidate/selection structure

Should create:
- `reservation_stay_plans`
- `reservation_stay_plan_segments`

Why now:
- the approved availability model depends on ranking contiguous, split, and upgrade-preserve plans

Important rule:
- candidate plans may exist before final room-unit allocation is locked

## `0065_property_reservation_allocations.sql`

Purpose:
- add room-night allocation truth

Should create:
- `reservation_allocations`

Why now:
- lane occupancy by night needs one explicit truth table
- this is the practical core of availability execution

Important rule:
- this table should be the source of truth for selected/locked occupancy by room-night

## Why this batch stops at `0065`

This first batch should stop before:

- room-state history
- housekeeping
- maintenance
- folio tables
- shared task/thread replacement

Reason:
- property phase 1 is availability-first
- broader workflow unification should not block inventory truth

## Migrations deliberately deferred

The following should wait until after the first batch stabilizes.

### Deferred shared-kernel migrations
- shared `tasks`
- shared `task_reminders`
- shared `threads`
- shared `thread_entries`
- `payment_records`
- `financial_adjustments`
- `publish_packages`
- `external_source_mappings`

### Deferred property migrations
- `room_state_events`
- `housekeeping_tasks`
- `maintenance_issues`
- `room_move_events`
- `folios`
- `folio_lines`

## Why shared tasks/threads are deferred

Although they are part of the target kernel, they touch existing runtime more directly.

Current runtime already uses:

- `stop_service_tasks`
- `booking_todo_threads`

So those migrations should wait until the team decides whether to:

- coexist
- wrap
- or gradually migrate behavior

That is a wider runtime decision than the first property-availability push needs.

## Suggested implementation order inside the first batch

1. `0057_tenant_settings.sql`
2. `0058_staff_assignments.sql`
3. `0059_inbound_records_and_draft_records.sql`
4. `0060_property_foundation.sql`
5. `0061_property_room_inventory.sql`
6. `0062_property_reservations.sql`
7. `0063_inventory_holds.sql`
8. `0064_property_stay_plans.sql`
9. `0065_property_reservation_allocations.sql`

This order allows the team to stop early after any migration and still keep the schema coherent.

## Validation expectations for this batch

Before writing SQL, the team should verify:

- tenant isolation fields exist on every new table
- property phase-1 indexes are sufficient for availability queries
- `check_out` is always treated as exclusive end
- stay-plan tables can represent both candidate and selected plans
- room-unit uniqueness is scoped by property, not tenant-wide globally

## Execution note

This document does not require that every proposed migration be implemented immediately.

It exists to keep the naming and batching coherent when implementation starts.

## Companion docs

- `42_DB_MIGRATION_PROPOSAL_SHARED_TOUR_PROPERTY.md`
- `43_PROPERTY_PHASE1_SCHEMA_DRAFT.md`
- `41_ENGINE_PHASE1_EXECUTION_CHECKLISTS.md`
- `40_SHARED_KERNEL_SCHEMA_DRAFT.md`