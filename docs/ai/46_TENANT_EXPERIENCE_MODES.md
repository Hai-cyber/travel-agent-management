# TENANT EXPERIENCE MODES

> RUNTIME NOTE:
> This document records the approved product-direction truth for how public tenant experiences should diverge.
> It is a design/control document for public product architecture, not proof that every mode is already fully implemented in runtime.
> Actual implemented public behavior must still be checked in `01_CURRENT_STATE.md`.

## Purpose

This document defines the public-facing product modes for tenants.

The platform no longer serves only one type of operator.
It now needs to support at least three public business shapes:

- tour-only
- hotel-only
- hybrid tour + hotel

These shapes are not just styling variants.
They change the information architecture, discovery pattern, booking intent, and publish defaults.

## Core rule

Treat tenant experience mode as a first-class product decision.

Do not let public UX drift into:

- one generic shell with small conditional patches
- hotel UX hidden inside tour pages
- hybrid UX guessed implicitly from whichever content happens to exist

The public mode must be chosen deliberately and then drive the tenant's default public surface.

## Locked public experience modes

### 1. `tour_operator`

Use when the tenant primarily sells tours, packages, itineraries, and destination-led products.

Primary public intent:
- discover tours
- compare itineraries
- browse destinations
- request or create tour bookings

Homepage emphasis:
- featured tours
- destination storytelling
- itinerary and pricing discovery

Primary entities:
- tours
- destinations
- itinerary/service modules

Primary CTA pattern:
- explore tours
- view itinerary
- book this journey

### 2. `hotel_operator`

Use when the tenant primarily sells room nights and property stays.

Primary public intent:
- search stay dates
- compare room categories
- understand amenities and policies
- reserve a stay

Homepage emphasis:
- stay search in hero
- room categories
- room imagery
- amenities
- policies
- gallery
- map/location

Primary entities:
- property
- room type
- amenities
- policies
- stay search results

Primary CTA pattern:
- check availability
- see room options
- reserve your stay

### 3. `hybrid_operator`

Use when the tenant legitimately sells both hotel stays and tours.

Primary public intent:
- either stay-first or tour-first, depending on the tenant's chosen primary business motion

Rule:
- hybrid mode must still choose one primary public motion by default
- do not collapse hotel and tour into one equally-weighted generic homepage by accident

Primary options for hybrid default:
- hotel-first hybrid
- tour-first hybrid

The second business line can still be linked prominently, but the first screen must privilege one search/discovery pattern.

## Product consequences of mode selection

Experience mode must influence at least these layers:

- onboarding defaults
- dashboard launch defaults
- publish scaffold defaults
- homepage structure
- navigation model
- listing cards
- search widgets
- CTA labels and flows

This means mode is not a cosmetic token.
It is a product configuration that shapes the public experience.

## Hotel-mode non-negotiables

For `hotel_operator`, the public surface must be hotel-first.

That means:

- stay search is above the fold
- room categories are first-class sections
- room-type imagery is first-class content
- amenities and policies are first-class content
- availability-first discovery is native to the layout

Do not ship hotel mode as:

- a patched `accommodation` listing page inside a tour shell
- a tour homepage with one hotel search widget inserted
- a theme-only variation that leaves the underlying public IA tour-first

## Hybrid-mode non-negotiables

For `hybrid_operator`, require a primary public motion.

Allowed examples:

- hotel-first homepage + tours as secondary discovery
- tour-first homepage + stays as secondary discovery

Not allowed:

- a homepage that tries to make hotel search, tour discovery, room cards, itinerary cards, and generic marketing all equal at once

The homepage must choose a lead commercial motion.

## Implementation rule

When public hotel work is planned, solve the problem in this order:

1. mode selection
2. layout scaffold
3. content model
4. search/result experience
5. booking commit flow

Do not start by grafting booking flow onto a page whose public IA is still wrong.

## Relationship to existing runtime

Current exploratory runtime slices such as:

- `GET /api/universal/public/hotels/:hotelKey`
- `POST /api/universal/public/hotels/:hotelKey/stay-search`
- `public/property-stay-search.js`

can remain as useful foundation work.

But they must be treated as inputs to the hotel-mode surface, not as proof that the final hotel public product architecture is already correct.

## Immediate checkpoint mapping

- `NEXT-P18A` = lock tenant experience modes
- `NEXT-P18B` = hotel public layout scaffold
- `NEXT-P18C` = hotel public content model
- `NEXT-P18D` = hotel stay search + availability results
- `NEXT-P18E` = hotel booking commit path

## Practical decision standard

Before adding or shipping any new public hotel UI, ask:

- does this belong to `hotel_operator`, `tour_operator`, or `hybrid_operator`?
- does it strengthen the correct primary public motion?
- is it layout architecture, content model, search/results, or booking commit?

If the answer is unclear, the mode decision is not locked yet and implementation should pause.