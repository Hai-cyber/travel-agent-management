# HOTEL PUBLIC LAYOUT SCAFFOLD

> RUNTIME NOTE:
> This document records the approved scaffold for the hotel-first public product surface.
> It is a target-layout and information-architecture document, not proof that the final hotel public runtime already exists.
> Actual implemented slices must still be verified in `01_CURRENT_STATE.md`.

## Purpose

This document defines the first-class public layout scaffold for hotel-mode tenants.

Its job is to prevent the hotel product from degrading into:

- a tour-first homepage with hotel widgets inserted
- a patched `accommodation` listing page standing in for a real hotel site
- a purely cosmetic skin variation without hotel-first information architecture

## Core rule

`hotel_operator` must render a hotel-first public surface.

That means the page hierarchy, block order, search placement, CTA pattern, and listing model must be organized around selling room nights, not around discovering tours.

## Applies to

- `hotel_operator`
- `hybrid_operator` when the tenant selects hotel-first public motion

It does not replace the tour-first scaffold for `tour_operator`.

## Homepage structure

The hotel homepage should be built in this order.

### 1. Hero with stay search

The hero must contain:

- property name
- short positioning statement
- location cue
- primary stay-search module

Hero search fields should include at minimum:

- check-in
- check-out
- adults
- children
- rooms

Primary CTA intent:
- check availability

Secondary CTA intent:
- view room categories
- contact property

The hotel homepage must not bury stay search below story sections.

### 2. Room category strip or section

Immediately after the hero, the tenant should present room categories.

Each room card should support:

- room-type name
- one lead image
- short summary
- occupancy summary
- starting price or "from" price when available
- CTA to view room details or check this room

This section is the hotel equivalent of the tour product grid.

### 3. Amenities overview

Amenities should appear high on the page.

The first scaffold should support:

- property-wide amenities list or matrix
- category groupings such as wellness, dining, family, transport, business, and room comfort

This should not be hidden in a footer or long-form body block.

### 4. Gallery band

The public hotel scaffold should include a visual gallery close to the top third of the page.

Purpose:
- create trust
- show the physical product
- support room-selling rather than only editorial mood

Preferred order:
- property highlights first
- room imagery second

### 5. Policies and stay facts

Hotel public pages need an explicit operational facts band.

Minimum facts:

- check-in time
- check-out time
- cancellation policy summary
- child / extra bed note
- breakfast inclusion or exclusion
- transfer note when relevant

This is not decorative copy. It reduces booking ambiguity.

### 6. Location and nearby context

The hotel scaffold should include:

- map/location block
- nearby highlights or area positioning
- transfer / airport note when relevant

This can come after rooms and amenities, but before the final CTA band.

### 7. Final CTA / reassurance band

The bottom part of the homepage should restate the main commercial motion.

Primary CTA:
- check availability

Secondary CTA:
- contact property

Optional reassurance:
- verified domain
- secure booking note
- best-rate or direct-booking note if the product later supports that positioning honestly

## Navigation scaffold

The hotel-first navigation should default to these concepts, not to tour-first discovery labels.

Recommended top-level items:

- rooms
- amenities
- gallery
- location
- policies
- contact

Optional additions:

- offers
- experiences
- dining
- wellness

Do not default hotel mode to tour-first labels such as:

- tours
- itineraries
- departures
- destinations

unless the tenant is actually hybrid and has chosen a combined navigation intentionally.

## Hotel detail surfaces

The scaffold should support two public levels:

### A. Property homepage
- brand/property overview
- global stay search
- room category discovery

### B. Room detail surface
- room-specific gallery
- room description
- occupancy/capacity
- included amenities
- stay search anchored to this room type

The homepage should not be forced to carry every room detail inline if that makes scanning worse.

## Hybrid hotel-first scaffold

For `hybrid_operator` in hotel-first mode:

- homepage still follows the hotel scaffold
- tours/experiences should appear as a secondary section, not as the lead discovery pattern

Recommended placement:
- below room categories or below amenities

Reason:
- hybrid should preserve one primary public motion, not split attention equally on the first screen

## CTA hierarchy

Hotel mode CTA hierarchy should be:

1. check availability
2. view room details
3. contact property

Tour-mode CTA hierarchy should remain separate.

This avoids leaking tour CTA language into hotel-mode pages.

## Relationship to search and booking

This scaffold must exist before the final public booking commit path is considered complete.

Meaning:

- `NEXT-P18D` search/results should live inside this scaffold
- `NEXT-P18E` booking commit should start from this scaffold

Do not finalize booking UX on a page whose layout architecture is still temporary.

## Relationship to current exploratory slices

Exploratory runtime slices such as:

- `GET /api/universal/public/hotels/:hotelKey`
- `POST /api/universal/public/hotels/:hotelKey/stay-search`
- `public/property-stay-search.js`

can remain useful as backend and interaction foundations.

But the final hotel public surface must absorb them into the hotel scaffold rather than leaving them attached to a patched universal `accommodation` page forever.

## Required implementation outputs for `NEXT-P18B`

The checkpoint should not be considered complete until all of these are decided:

- homepage block order for hotel mode
- default hotel navigation model
- hero stay-search placement
- room category section structure
- amenity section structure
- gallery section structure
- policies/facts section structure
- location section structure
- CTA hierarchy
- hybrid hotel-first default placement for tours/experiences

## Non-goals for this checkpoint

- booking commit flow
- payment flow
- actor authorization
- OTA/channel sync
- visual skin forks beyond what the hotel-first layout itself requires

This checkpoint is about information architecture and public scaffold first.