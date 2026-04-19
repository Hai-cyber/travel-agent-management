# SHARED KERNEL BETWEEN TOUR AND PROPERTY

> RUNTIME NOTE:
> This document records the approved target direction for the shared kernel used by both the tour engine and the property engine.
> The current rescue runtime implements only parts of this direction.
> Actual implemented runtime slices remain listed in `01_CURRENT_STATE.md`.

## Purpose

This document defines the common platform layer that should be shared by:

- `tour engine`
- `property engine`

The goal is to let the platform serve multiple SME business shapes without turning into two disconnected products.

## Core principle

The platform should have:

- one shared kernel
- one tour engine
- one property engine

The engines may differ in domain logic, but they should not rebuild identity, workflow, communication, or billing primitives separately.

## Why this matters

Without a shared kernel, the product will drift into:

- duplicate concepts
- duplicate settings
- duplicate activity logs
- incompatible booking workflows
- different staff/role models for each engine

That creates commercial confusion and technical drag.

## What belongs in the shared kernel

The shared kernel should hold platform-wide primitives that are not specific to one engine.

### 1. Tenant and identity
- `tenant`
- `user`
- `membership`
- `auth_session`
- tenant policy/config surfaces

### 2. Staff and access
- seat model
- tenant roles
- scoped operational permissions
- future engine-specific assignments

### 3. Inbound capture / draft concepts
- inbound record
- draft review flow
- confirm / ignore / reject patterns
- source/source_ref/source_payload conventions

### 4. Tasks, reminders, and timelines
- task/todo primitives
- reminder cadence concepts
- timeline/event logging
- human follow-up patterns

### 5. Communication and thread model
- multi-channel thread concepts
- outbound/inbound entry logging
- note/audit communication layer

### 6. Audit and policy layer
- field-change audit concepts
- actor/changed_by conventions
- tenant policy settings

### 7. Lightweight financial primitives
- payment record concepts
- adjustment/refund concepts
- invoice/folio compatibility direction

### 8. Distribution / publish boundary
- publish package concepts
- external source traceability
- sync-readiness fields and guardrails

## What should NOT be in the shared kernel

The shared kernel should not absorb domain logic that belongs only to one engine.

### Tour-only domain logic
- itinerary / `tour_stops`
- tour pricing model
- service-item schedule derivation
- tour operations tied to itinerary

### Property-only domain logic
- room inventory lanes
- stay-plan allocation
- room-state machine
- housekeeping / maintenance execution
- room folio settlement details

If the kernel becomes a dumping ground for engine-specific logic, the architecture will blur again.

## Shared kernel design rule

Put a concept in the shared kernel only if both of these are true:

1. both engines can use it
2. the concept keeps the same meaning across both engines

If the meaning changes materially between domains, it should stay engine-specific.

## Booking truth vs engine-specific booking logic

The shared kernel may define generic inbound-booking and draft concepts.

But:

- tour booking confirmation still belongs to tour booking logic
- property reservation confirmation still belongs to property reservation logic

The kernel defines the intake pattern.
The engine defines the booking truth.

## Shared task and reminder concepts

Both engines should be able to share:

- task identity
- status concepts
- assignment concepts
- reminder concepts
- thread attachment concepts

But each engine may define different task-generation rules.

Example:

- tour engine generates tasks from itinerary/service items
- property engine generates tasks from arrivals, room readiness, transfer coordination, and housekeeping flow

## Shared communication model

Both engines benefit from a unified communication pattern.

Examples:

- outbound contact logging
- notes
- channel markers
- human-readable timeline of interaction

The meaning of a thread entry should remain stable even if the domain context differs.

## Shared policy model

The kernel should also provide one coherent way to express tenant-level policies.

Examples:

- default check-in/check-out settings
- reminder rules
- split-stay visibility policy
- draft confirmation rules
- commercial packaging / tier access

Some policies may still be engine-specific, but the storage and configuration pattern should be shared.

## Shared billing direction

The platform should not force one billing engine too early, but shared primitives are still useful.

Examples:

- payment records
- manual adjustments
- audit trail for financial changes

This is especially important for the `tour + hotel suite` direction, where a tenant may later want:

- one guest-facing financial surface
- one tenant-level commercial record
- optional unified invoice directions

## Relationship to packaging

Tiering and packaging should sit on top of the shared kernel.

That means:

- Tier 2 may expose the tour engine more fully
- Tier 3 may expose the property engine more fully
- Tier 4 may expose both engines together

But all of them should still inherit one coherent tenant/staff/workflow foundation.

## Implementation rule for future coding

When building new features, always decide first:

1. is this kernel-level or engine-level?
2. does it keep the same meaning in both engines?
3. will putting it in the kernel reduce duplication without blurring domain truth?

If the answer to 2 is no, it should stay out of the kernel.

## Practical examples

### Good shared-kernel candidates
- draft review flow
- task timeline entry model
- payment record primitive
- tenant role assignment pattern
- audit-log conventions

### Bad shared-kernel candidates
- `tour_stop`
- `room_unit`
- `stay_plan`
- tour season/pax pricing
- housekeeping state transitions

## Final rule

The shared kernel should make the platform feel like one product.

It should not erase the fact that:

- tours and stays are different domains
- each engine still needs its own canonical truth

The right architecture is:

- one platform
- one shared kernel
- two domain engines
- modular commercial packaging on top

## Companion docs

- `38_PLATFORM_PACKAGING_AND_TIERS.md` — packaging and tier direction
- `30_PROPERTY_ENGINE_OVERVIEW.md` — property engine scope
- `37_TOUR_ENGINE_DISTRIBUTION_AND_BOOKING_INGEST.md` — tour engine distribution and booking-ingest direction
- `26_PROPERTY_ENGINE_AND_STAFF_SEATS.md` — staff-seat and access direction
- `40_SHARED_KERNEL_SCHEMA_DRAFT.md` — first schema draft for the shared platform kernel