# SHARED KERNEL SCHEMA DRAFT

> RUNTIME NOTE:
> This document records the target schema direction for the shared kernel used by the tour engine and property engine.
> The current rescue runtime implements only parts of this direction.
> Actual implemented runtime slices remain listed in `01_CURRENT_STATE.md`.

## Purpose

This document translates the shared-kernel architecture into a first schema draft.

Its job is to define:

- which entities belong in the platform kernel
- which fields are shared candidates
- which tables should stay out of engine-specific domains

This is a draft for implementation planning, not a promise that all entities already exist.

## Core rule

Put an entity in the shared kernel only if:

1. both engines can use it
2. the entity keeps the same meaning across both engines

If either condition fails, the entity belongs in the engine-specific schema.

## Shared kernel schema families

### 1. Tenant and identity

#### `tenants`
- `id`
- `name`
- `slug`
- `status`
- `created_at`
- `updated_at`

#### `users`
- `id`
- `email`
- `name`
- `phone`
- `status`
- `created_at`

#### `memberships`
- `id`
- `tenant_id`
- `user_id`
- `role`
- `status`
- `created_at`

#### `auth_sessions`
- `id`
- `user_id`
- `tenant_id`
- `session_token_hash`
- `expires_at`
- `created_at`

### 2. Tenant policy and settings

#### `tenant_settings`
- `id`
- `tenant_id`
- `key`
- `value_json`
- `updated_at`
- `updated_by`

Use this for shared policy/config patterns such as:

- packaging/tier flags
- reminder defaults
- shared notification behavior
- engine-level defaults where a key/value model is acceptable

Do not use this table as an excuse to avoid canonical schema when a domain object deserves its own table.

### 3. Staff and assignment primitives

#### `staff_assignments`
- `id`
- `tenant_id`
- `user_id`
- `scope_type`
- `scope_id`
- `role`
- `permissions_json`
- `created_at`

This supports shared assignment patterns while still allowing engine-specific scopes.

Examples:

- scope to a property
- scope to a tour product or ops surface

### 4. Inbound capture and draft layer

#### `inbound_records`
- `id`
- `tenant_id`
- `source`
- `source_ref`
- `source_payload`
- `status`
- `received_at`
- `created_at`

#### `draft_records`
- `id`
- `tenant_id`
- `inbound_record_id`
- `draft_type`
- `draft_payload`
- `status`
- `reviewed_by`
- `reviewed_at`
- `created_at`

`draft_type` examples:

- `tour_booking`
- `property_reservation`

Kernel owns the pattern, not the final booking truth.

### 5. Shared task and reminder layer

#### `tasks`
- `id`
- `tenant_id`
- `engine_type`
- `entity_type`
- `entity_id`
- `title`
- `description`
- `status`
- `assigned_user_id`
- `due_at`
- `meta_json`
- `created_at`
- `updated_at`

#### `task_reminders`
- `id`
- `tenant_id`
- `task_id`
- `reminder_key`
- `scheduled_at`
- `sent_at`
- `status`

The generation logic can differ by engine, but the task/reminder primitives stay shared.

### 6. Timeline and communication layer

#### `threads`
- `id`
- `tenant_id`
- `engine_type`
- `entity_type`
- `entity_id`
- `subject`
- `created_at`

#### `thread_entries`
- `id`
- `tenant_id`
- `thread_id`
- `channel`
- `direction`
- `message`
- `meta_json`
- `created_by`
- `created_at`

This gives both engines one communication/timeline pattern.

### 7. Audit layer

#### `audit_log`
- `id`
- `tenant_id`
- `actor`
- `action`
- `entity_type`
- `entity_id`
- `field_name`
- `old_value`
- `new_value`
- `meta_json`
- `created_at`

This should become the platform-wide convention even if existing runtime has older variants.

### 8. Shared financial primitives

#### `payment_records`
- `id`
- `tenant_id`
- `engine_type`
- `entity_type`
- `entity_id`
- `payment_method`
- `amount`
- `currency`
- `status`
- `external_ref`
- `notes`
- `received_by`
- `received_at`

#### `financial_adjustments`
- `id`
- `tenant_id`
- `engine_type`
- `entity_type`
- `entity_id`
- `adjustment_type`
- `amount`
- `currency`
- `reason`
- `created_by`
- `created_at`

These are shared primitives only. Full folio logic remains property-engine specific.

### 9. Publish and distribution primitives

#### `publish_packages`
- `id`
- `tenant_id`
- `engine_type`
- `entity_type`
- `entity_id`
- `package_json`
- `status`
- `created_at`
- `updated_at`

#### `external_source_mappings`
- `id`
- `tenant_id`
- `engine_type`
- `entity_type`
- `entity_id`
- `external_source`
- `external_ref`
- `mapping_json`
- `created_at`

These support distribution helper and future sync-readiness without forcing channel-manager logic now.

## Engine-owned schema families

### Tour-engine owned
- `tours`
- `tour_stops`
- service-item tables
- tour pricing tables
- tour-booking truth tables

### Property-engine owned
- `properties`
- `room_types`
- `room_units`
- `property_reservations`
- `reservation_allocations`
- `stay_plans`
- folio tables
- room-state / housekeeping / maintenance tables

## Important modeling rule

Shared kernel tables may reference engine-owned entities through:

- `engine_type`
- `entity_type`
- `entity_id`

This polymorphic pattern is acceptable at the kernel layer because the kernel is cross-domain by design.

However, engine-owned schemas should prefer explicit foreign keys inside their own domain whenever possible.

## Suggested enum/value conventions

### `engine_type`
- `tour`
- `property`

### common task status
- `open`
- `in_progress`
- `done`
- `cancelled`

### common thread direction
- `out`
- `in`
- `note`

### common draft status
- `draft`
- `needs_review`
- `confirmed`
- `ignored`
- `rejected`

## Migration strategy

Recommended order for schema work:

1. align or wrap existing runtime tables to the shared-kernel conventions where feasible
2. add missing shared-kernel tables only where reuse is real
3. do not pause engine work waiting for perfect kernel purity
4. prefer migration-safe convergence over big-bang schema rewrites

## Non-goals

This schema draft does not try to:

- fully redesign current rescue runtime tables
- finalize every column type/index
- replace engine-specific schema drafts

Its purpose is to prevent duplicated platform primitives before the two engines grow further apart.

## Companion docs

- `39_SHARED_KERNEL_BETWEEN_TOUR_AND_PROPERTY.md`
- `38_PLATFORM_PACKAGING_AND_TIERS.md`
- `36_PROPERTY_ENGINE_IMPLEMENTATION_ROADMAP.md`
- `37_TOUR_ENGINE_DISTRIBUTION_AND_BOOKING_INGEST.md`
- `42_DB_MIGRATION_PROPOSAL_SHARED_TOUR_PROPERTY.md`