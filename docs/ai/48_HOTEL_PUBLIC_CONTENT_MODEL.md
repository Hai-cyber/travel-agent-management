# HOTEL PUBLIC CONTENT MODEL

> RUNTIME NOTE:
> This document records the approved public content model for hotel-mode tenants.
> It is a product/content architecture document, not proof that the final hotel publishing model already exists in runtime.
> Actual implemented slices must still be verified in `01_CURRENT_STATE.md`.

## Purpose

This document defines the public content model required for hotel-mode tenants to sell rooms credibly.

Its purpose is to stop hotel presentation from depending on loosely inferred catalog rows or mixed tour/hotel content fields.

## Core rule

Hotel public content must treat room-selling information as first-class content.

That means the public layer must explicitly support:

- room-type imagery
- room-type descriptions
- room-type occupancy facts
- amenities
- policies
- property/location content

Do not rely on one generic hotel description plus one generic gallery and assume that is enough for hotel commerce.

## Current architectural boundary

The current runtime boundary remains:

- `properties`, `room_types`, `room_units`, reservations, availability, and pricing belong to the property engine
- `tenant_universal_hotels` belongs to the public storefront/catalog layer and remains transitional presentation support

This content model should respect that boundary.

The public model should consume property-engine truth where needed, but it must not turn `tenant_universal_hotels` into a fake reservation engine.

## Required public content levels

The hotel public model should operate at two levels.

### 1. Property-level content

This describes the property as a whole.

Required property-level content:

- property headline / short summary
- property description
- property gallery
- property address / location framing
- amenity overview
- policy overview
- optional neighborhood / nearby highlights

### 2. Room-type-level content

This describes what the guest can actually choose.

Required room-type-level content:

- room-type name
- room-type short description
- room-type detailed description
- room-type lead image
- room-type gallery
- occupancy facts
- bed / layout notes when relevant
- included amenity highlights
- room-specific CTA target

The public hotel product will not feel credible until room-type content is explicit.

## Property-level content objects

The public hotel product should support these property-level presentation objects.

### `property_public_profile`

Suggested fields:

- `property_id`
- `public_title`
- `short_summary`
- `long_description`
- `tagline`
- `hero_media`
- `gallery`
- `location_summary`
- `map_label`
- `neighborhood_copy`

### `property_amenity_bundle`

Suggested fields:

- `property_id`
- `amenity_groups[]`
- `amenity_items[]`
- `featured_amenities[]`

Recommended amenity groups:

- essentials
- room comfort
- wellness
- dining
- family
- transport
- business
- accessibility

### `property_policy_bundle`

Suggested fields:

- `property_id`
- `check_in_time`
- `check_out_time`
- `cancellation_summary`
- `child_policy_summary`
- `extra_bed_summary`
- `breakfast_summary`
- `transfer_summary`
- `pet_policy_summary`
- `smoking_policy_summary`

This bundle should be public-copy friendly, not just raw internal settings.

## Room-type-level content objects

### `room_type_public_profile`

Suggested fields:

- `room_type_id`
- `public_title`
- `short_summary`
- `long_description`
- `lead_image`
- `gallery`
- `size_text`
- `bed_text`
- `view_text`
- `occupancy_summary`
- `featured_points[]`

### `room_type_amenity_bundle`

Suggested fields:

- `room_type_id`
- `amenity_items[]`
- `featured_amenities[]`

Room-type amenities must be separable from property-wide amenities.

Example:
- property has pool and shuttle
- suite has lounge access and bathtub

Those cannot be represented cleanly if every amenity is flattened into one property blob.

## Media ownership rules for hotel mode

Hotel media must be explicit about ownership and level.

Minimum levels:

- property hero media
- property gallery media
- room-type lead media
- room-type gallery media

Rule:
- property gallery media should not silently double as room-type lead imagery unless explicitly assigned
- room-type media should not be forced into one shared hotel gallery with no distinction

The hotel product needs visual clarity about what belongs to the property and what belongs to a specific room category.

## Relationship to operational truth

Public content may decorate operational truth, but must not contradict it.

Examples:

- room-type title/description can be editorial
- occupancy claims must still respect `room_types.max_occupancy`
- policy presentation can be public-copy friendly
- stay search and booking results must still come from shared property availability/pricing truth

## Relationship to hybrid tenants

For `hybrid_operator`, hotel public content should still be first-class when hotel-first mode is selected.

That means:

- room-type content must not be hidden inside tour itineraries
- hotel gallery must not depend on tour destination media
- amenities and policies must remain hotel-level objects even if tours are also sold on the same site

## Transitional runtime note

Current exploratory runtime pieces such as:

- `tenant_universal_hotels.gallery_json`
- content tab `accommodation_*` fields
- mixed accommodation cards in universal site runtime

can remain as transitional scaffolding.

But they are not sufficient as the final hotel content model.

The final model needs explicit room-type-level publishing content rather than generic hotel card copy alone.

## Required implementation outputs for `NEXT-P18C`

The checkpoint should not be considered complete until all of these are decided:

- property-level hotel content object shape
- room-type-level public content object shape
- property vs room media ownership rules
- property amenity bundle structure
- room-type amenity bundle structure
- policy bundle structure
- content editing boundary between editorial public copy and operational truth

## Non-goals for this checkpoint

- stay-search interaction design
- booking commit flow
- payments
- staff authorization
- OTA export or channel-sync content contracts

This checkpoint is about hotel public content structure first.