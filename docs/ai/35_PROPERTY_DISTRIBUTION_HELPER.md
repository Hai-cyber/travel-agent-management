# PROPERTY DISTRIBUTION HELPER

> RUNTIME NOTE:
> This document records the approved target direction for the property's distribution helper layer.
> The current rescue runtime does **not** implement this module yet.

## Purpose

This document defines the distribution layer for the future property engine.

The goal is to help tenants publish and intake bookings from larger external platforms without forcing the first version to become a full channel manager.

## Core principle

The first commercial version should support **distribution assistance**, not full external synchronization.

That means:

- help tenants prepare content and listing data for large platforms
- help tenants ingest external bookings into the canonical reservation workflow
- avoid real-time availability/rate push until the core inventory engine is stable

The guiding rule is:

> assist distribution early, synchronize distribution later.

## Why this boundary matters

Real channel sync is one of the highest-risk layers in hospitality software.

It brings:

- overbooking risk
- stale availability risk
- stale rate risk
- partner certification complexity
- third-party dependency risk

If availability, reservation intake, and operations are not already strong, channel sync will amplify failures instead of creating value.

## Canonical role of this module in v1

The first distribution helper should do three things well.

### 1. Listing helper
- prepare publishable property content
- help normalize room types, amenities, and descriptions
- generate reusable listing assets for OTA/manual posting

### 2. Booking intake helper
- accept externally-originated booking details through email/draft intake
- route them into the canonical reservation workflow

### 3. Sync readiness layer
- define the future boundary for channel sync
- do not implement full real-time sync yet

## What this module is not in v1

The first version should not be:

- a certified Booking.com connectivity product
- a live rate/availability push service
- a two-way channel manager
- a marketplace contract/billing layer

Those are future extensions.

## Listing helper

The listing helper should help the tenant produce structured publishable content.

### Inputs
- property details
- room types
- amenities
- photos
- policies
- location highlights

### Outputs
- OTA-friendly title suggestions
- room-type descriptions
- amenity mapping guidance
- image set recommendations
- policy snippets
- publish checklist

### Goal
Reduce manual friction and improve listing quality without pretending the platform is pushing directly to every OTA on day one.

## Canonical publish package

The helper should think in terms of a reusable publish package.

Suggested sections:

- `property_summary`
- `room_type_cards`
- `amenity_matrix`
- `policy_bundle`
- `media_bundle`
- `location_bundle`

This package can later become the source for actual API push or export formats.

## Amenity mapping helper

One key commercial pain is that tenants describe the same amenity differently across platforms.

The helper should standardize this.

Examples:

- `free wifi`
- `pool`
- `airport shuttle`
- `breakfast included`
- `air conditioning`
- `parking`

The first version does not need a giant ontology.
It needs a pragmatic normalized catalog and mapping suggestions.

## Room type publish helper

Because room type naming is central to availability and sales, the helper should preserve a clean mapping between:

- internal `room_type`
- external listing name
- occupancy description
- policy notes

This matters later when imported drafts need to map back into internal room types.

## Booking intake boundary

Distribution helper and reservation intake are adjacent, but not the same thing.

### Distribution helper does
- help external platform publication
- support imported booking draft flow

### Reservation intake does
- normalize inbound booking into canonical reservation flow
- confirm / reject / review
- recheck availability before final confirmation

This module should not duplicate the reservation intake engine.

## External booking draft ingestion

For the first version, externally-originated bookings should enter through a draft layer, not direct auto-confirm sync.

Examples:

- Booking.com email forward
- Agoda email forward
- Expedia email forward
- manual OTA reference entry by staff

The imported draft then follows the rules already defined in:

- `32_PROPERTY_RESERVATION_INTAKE_AND_BOOKING_SOURCES.md`

## Channel sync boundary

The future sync boundary should be documented now, even if not implemented yet.

The future sync layer may eventually support:

- availability push
- restriction push
- reservation pull/push
- cancellation propagation

But that should only be attempted after:

1. night-based availability is stable
2. allocation and stay-plan behavior are stable
3. reservation intake is canonical and reliable
4. operations app can safely handle external stays

## Sync readiness requirements

Before real sync exists, the system should already preserve the key data needed for later sync.

Examples:

- `source`
- `source_ref`
- normalized `room_type` mapping
- normalized amenity mapping
- pricing snapshot
- cancellation policy snapshot

This reduces migration pain later.

## Manual publication workflow

The first distribution workflow should remain intentionally human-assisted.

### Suggested flow
1. tenant prepares listing package
2. tenant publishes manually on OTA/platform
3. booking arrives externally
4. booking enters draft intake
5. staff confirms into canonical reservation model

This is commercially useful and dramatically safer than premature live sync.

## Why manual-assisted publication is acceptable

For early property customers, the biggest pain is often not “I need live sync today.”
It is:

- inconsistent listings
- weak room descriptions
- missed external bookings
- fragmented booking sources

Listing helper + draft intake solves a large part of that problem with much lower risk.

## Future sync modes

When the engine is mature enough, the distribution layer can expand in stages.

### Stage 1 — Export helpers
- downloadable listing/export payloads
- internal readiness checks

### Stage 2 — Semi-connected workflows
- ingest bookings from email/API into drafts
- manual approval before final confirm

### Stage 3 — Controlled sync
- availability push
- reservation ingest
- cancellation updates

### Stage 4 — True channel-manager behavior
- two-way sync
- near real-time updates
- conflict handling and recovery

The first property engine should stop well before Stage 4.

## Operational guardrails

This module should never bypass core property logic.

### Guardrails
- external booking should not skip reservation validation
- imported booking should not skip availability recheck
- distribution helper should not write around room allocation logic
- listing helper should not redefine internal room-type truth

## Recommended v1 implementation order

1. property publish package model
2. listing helper UX
3. room-type / amenity mapping helper
4. external booking draft ingestion via reservation intake
5. sync-readiness data fields

## Future expansion paths

After the core property engine is stable, the natural next steps are:

- OTA-specific templates
- listing freshness checks
- sync health dashboard
- external source conflict detection
- controlled rate/availability publishing
- certified partner/channel integrations

## Companion docs

- `30_PROPERTY_ENGINE_OVERVIEW.md` — overall property engine scope
- `31_PROPERTY_AVAILABILITY_AND_ALLOCATION.md` — availability and stay-plan rules
- `32_PROPERTY_RESERVATION_INTAKE_AND_BOOKING_SOURCES.md` — booking intake and source model
- `34_PROPERTY_SIMPLE_FOLIO_AND_POS.md` — folio, payments, and settlement boundary