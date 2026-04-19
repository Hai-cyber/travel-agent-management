# DB MIGRATION PROPOSAL FOR SHARED TOUR + PROPERTY PLATFORM

> RUNTIME NOTE:
> This document records a migration-safe database proposal for evolving the current rescue schema toward the shared-kernel + dual-engine direction.
> It is a planning document, not a claim that these migrations already exist.

## Purpose

This document bridges three layers:

- current rescue schema reality
- shared-kernel target direction
- future tour + property engine growth

The goal is to show:

- which current tables should be reused
- which should be wrapped or converged
- which new tables should be introduced
- what migration order is safest

## Core rule

Prefer **migration-safe convergence** over schema replacement.

That means:

- reuse existing tables when their meaning is still correct
- add wrapper/convention layers where exact renaming would be risky
- create new tables only where there is clear cross-engine reuse or genuinely new domain scope

Do not perform a big-bang rewrite of the rescue schema.

## Current reusable foundations

The current repo already contains useful building blocks.

### Reuse directly or with minor extension

#### `tenants`
- already exists
- should remain the top-level business boundary
- can keep carrying `product_tier_key` from `0032_product_tiers.sql`

#### `users`
- already exists in current auth/runtime direction
- should remain the shared identity table

#### `auth_sessions`
- already exists via `0030_auth_sessions.sql`
- should be reused as the canonical session table

#### `booking_drafts`
- already exists via `0010_booking_drafts.sql`
- should remain tour-engine specific booking draft truth
- should not be renamed into a generic kernel draft table immediately

#### `app_settings`
- already exists via `0033_app_settings.sql`
- should remain platform-level settings, distinct from tenant-level settings

## Current tables that should be converged, not replaced immediately

### `tenant_audit_log`
- exists through current migrations and runtime usage
- should gradually converge toward one platform-wide `audit_log` convention
- do not break existing runtime consumers early

### `stop_service_tasks`
- exists from `0011_tasks.sql`
- currently tour-oriented and too narrow for the desired kernel task model
- should be treated as a legacy/specialized task table
- later steps can add a shared `tasks` table instead of mutating this one aggressively

### `booking_todo_threads`
- exists from `0053_booking_todo_threads.sql`
- currently attached to booking-order todo operations
- should be treated as a useful engine-specific communication table
- future shared thread/timeline schema can coexist first and converge later

### `booking_orders`
- already exists and should remain tour-booking truth
- do not try to generalize this into a cross-engine reservation table

## New shared-kernel tables proposed

These are worth adding because they solve real shared-platform needs.

### Phase K1 — tenant-level shared configuration

#### `tenant_settings`
Purpose:
- shared tenant-level key/value JSON settings

Use for:
- reminder defaults
- draft-review policies
- engine default settings that do not yet justify full tables
- packaging/tier flags beyond `product_tier_key` when needed

Do not use for:
- canonical engine entities
- replacing every structured config table forever

### Phase K2 — shared assignment primitives

#### `staff_assignments`
Purpose:
- shared staff-to-scope assignment pattern

Supports:
- property-scoped assignments later
- tour/product/ops-surface assignment later

### Phase K3 — shared inbound capture primitives

#### `inbound_records`
Purpose:
- generic inbound source envelope for both engines

Examples:
- email ingest
- forwarded booking info
- external source traceability

#### `draft_records`
Purpose:
- generic review/confirm pattern for cross-engine draft handling

Important rule:
- this does not replace engine-owned final booking/reservation truth
- it only standardizes the draft/review pattern

### Phase K4 — shared task/reminder primitives

#### `tasks`
Purpose:
- unified task identity across engines

#### `task_reminders`
Purpose:
- unified reminder scheduling/logging across engines

Migration rule:
- add these tables before attempting any migration away from `stop_service_tasks`
- tour runtime can keep its existing specialized tasks while shared tasks are proven out

### Phase K5 — shared thread/timeline primitives

#### `threads`
#### `thread_entries`

Purpose:
- shared cross-engine timeline/communication model

Migration rule:
- coexist first with `booking_todo_threads`
- do not break current todo-thread runtime just to reach purity

### Phase K6 — shared financial primitives

#### `payment_records`
#### `financial_adjustments`

Purpose:
- shared payment and adjustment primitives usable by:
  - tour side commercial records
  - property side folio/payment direction

Important rule:
- this is not a full accounting rewrite
- this is a shared primitive layer only

### Phase K7 — shared publish/distribution primitives

#### `publish_packages`
#### `external_source_mappings`

Purpose:
- support publish/export packages
- preserve external mapping/sync-readiness across both engines

## New property-engine tables proposed

These should remain property-owned, not kernel-owned.

### Phase P1 — property identity and inventory
- `properties`
- `room_types`
- `room_units`

### Phase P2 — reservation truth
- `property_reservations`
- `reservation_stay_plans`
- `reservation_allocations`
- optional `inventory_holds`

### Phase P3 — operations
- `room_state_events`
- `housekeeping_tasks`
- `maintenance_issues`
- `room_move_events`

### Phase P4 — folio layer
- `folios`
- `folio_lines`

Property folio tables stay property-owned even if payment primitives are shared.

## Tour-engine schema direction

Tour engine should continue to preserve its current core truth around:

- `tours`
- `tour_stops`
- service-item tables
- pricing tables
- `booking_orders`
- booking-order operational todo surfaces

The main near-term goal is stabilization, not tour schema reinvention.

## Recommended migration order

### Wave 1 — low-risk shared platform additions
1. add `tenant_settings`
2. add `staff_assignments`
3. add `inbound_records`
4. add `draft_records`

Reason:
- these do not force existing runtime rewrites
- they establish shared platform primitives early

### Wave 2 — shared workflow primitives
5. add `tasks`
6. add `task_reminders`
7. add `threads`
8. add `thread_entries`

Reason:
- creates a future-safe workflow layer
- lets engines adopt gradually

### Wave 3 — shared financial and distribution primitives
9. add `payment_records`
10. add `financial_adjustments`
11. add `publish_packages`
12. add `external_source_mappings`

Reason:
- helps Tier 4 direction without forcing full unification too early

### Wave 4 — property engine phase 1 tables
13. add `properties`
14. add `room_types`
15. add `room_units`
16. add `property_reservations`
17. add `reservation_stay_plans`
18. add `reservation_allocations`
19. add `inventory_holds` if required by implementation choice

Reason:
- matches the agreed availability-first property roadmap

### Wave 5 — property operations and folio tables
20. add `room_state_events`
21. add `housekeeping_tasks`
22. add `maintenance_issues`
23. add `room_move_events`
24. add `folios`
25. add `folio_lines`

## Existing-table mapping guidance

### Keep as canonical for now
- `tenants`
- `users`
- `auth_sessions`
- `booking_drafts`
- `booking_orders`

### Keep, but converge later by convention
- `tenant_audit_log`
- `stop_service_tasks`
- `booking_todo_threads`

### Add new instead of mutating hard
- `tasks`
- `threads`
- `payment_records`
- `inbound_records`
- `draft_records`
- all property-engine tables

## Naming guidance

Use plural table naming for new schema additions when possible and keep names explicit.

Preferred examples:
- `property_reservations`
- `reservation_stay_plans`
- `payment_records`

Avoid vague names such as:
- `records`
- `items`
- `entries`

unless the domain prefix is strong enough to keep meaning clear.

## Risks to avoid

1. forcing `booking_orders` into a generic reservation table too early
2. rewriting current tasks/threads tables before a replacement is proven
3. putting property inventory objects into the shared kernel
4. using `tenant_settings` as a dumping ground for missing schema
5. attempting tier-driven capability gating in schema before workflow truth is stable

## Practical outcome

If followed, this proposal gives the team:

- a stable reuse path for current rescue runtime
- a clean place to add shared platform primitives
- a safe runway for property-engine phase 1 work
- a way to keep tour stabilization and property build running in parallel

## Companion docs

- `39_SHARED_KERNEL_BETWEEN_TOUR_AND_PROPERTY.md`
- `40_SHARED_KERNEL_SCHEMA_DRAFT.md`
- `41_ENGINE_PHASE1_EXECUTION_CHECKLISTS.md`
- `38_PLATFORM_PACKAGING_AND_TIERS.md`