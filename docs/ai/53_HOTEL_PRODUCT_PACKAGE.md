# HOTEL PRODUCT PACKAGE

> RUNTIME NOTE:
> This document records the approved packaging and productization direction for the hotel/property side of the platform.
> It is a commercial/product-definition document, not proof that every hotel feature described here is already fully implemented in runtime.
> Actual implemented slices must still be checked in `01_CURRENT_STATE.md`.

## Purpose

This document defines what the hotel product should mean commercially.

Its job is to turn the growing property runtime into a sellable product package with a clear scope, clear promises, and clear boundaries.

## Core rule

The hotel package should be sold as a focused hotel operating and direct-booking stack for SMEs.

Do not sell it as:

- a full PMS replacement for large chains
- a channel manager suite
- a certified OTA connectivity platform
- a full accounting or ERP system

It should be sold as strong enough to run sellable hotel operations without pretending to be everything.

## Commercial naming

Preferred package naming remains:

- `Hotel Pro`

This should map to the existing product-tier direction where `hotel_pro` means the hotel/property engine is unlocked.

## What `Hotel Pro` should include

The first credible package should combine three layers.

### 1. Hotel public product layer

Includes:

- hotel-first public layout
- room category presentation
- amenities and policy presentation
- gallery and location blocks
- stay search and room-result discovery
- booking commit path on custom domains

This is the guest-facing sales layer.

### 2. Hotel operating layer

Includes:

- property setup
- room types and room units
- night-based availability
- holds
- reservation lifecycle
- arrivals / departures / rack visibility
- housekeeping and room-state workflow
- folio baseline

This is the internal operations layer.

### 3. Hotel B2B/operator layer

Includes:

- allotments
- rooming list model
- master-vs-guest charge routing
- guest-folio execution path for deferred B2B charges

This is what makes the hotel product stronger for mixed retail + operator business.

## Publish minimum for `Hotel Pro`

The package should not be considered commercially presentable until the tenant can publish a hotel page that includes at minimum:

- property summary
- hero stay search
- room-type cards
- room-type imagery
- amenities
- policies / house rules
- gallery
- map / location

This is the minimum publishable hotel content bundle.

## Commerce rule

Hotel direct booking must follow the same platform commerce policy as the rest of the system.

That means:

- platform-owned surfaces are showcase-only
- verified custom domains are the commercial surface
- electronic gateway requirement still applies to commerce activation

`Hotel Pro` does not weaken those rules.

## Staff-seat positioning

Hotel product packaging should explain staff access simply.

Recommended position:

- tenant is the business boundary
- staff users are seats under the tenant
- hotel operations can be run by role-aware staff, not only by the owner/admin

Do not position staff seats as separate tenant instances.

## Who the package is for

Best-fit customers:

- independent hotels
- boutique stays
- resorts with direct sales focus
- villas / lodges with real room inventory
- hybrid travel businesses that also run stay operations

## What the package should promise

Safe commercial promise:

- publish a credible hotel website
- present rooms properly
- check live availability
- accept direct bookings on a verified commercial domain
- run front-desk and room operations
- support B2B/operator allotment workflows at an SME-credible level

## What the package should not promise yet

Do not promise:

- certified Booking.com / Expedia / Agoda sync
- full two-way channel management
- enterprise multi-property headquarters tooling
- full restaurant POS suite
- accounting exports beyond the lightweight operational scope already defined elsewhere

## Relationship to other tiers

### `starter_landing`

- showcase-only website builder
- no real hotel commerce

### `tours_pro`

- tour-led business only
- hotel engine not unlocked as the main operating layer

### `hotel_pro`

- hotel/property engine unlocked
- direct-booking and room operations focus
- membership activation should still run through the shared provider-agnostic tenant membership flow, not a separate hotel-only billing stack

### `all_in_one`

- combined tour + hotel suite
- for operators who genuinely run both sides
- membership should be activated as one deliberate suite-level tenant membership, not as two unrelated subscriptions glued together

## Membership completion dependency

`Hotel Pro` packaging is not commercially complete until the shared platform membership flow can activate `hotel_pro` without requiring Stripe as the only path.

`all_in_one` packaging is not commercially complete until that same shared flow can activate the combined suite as one tenant membership.

The checkpoint track for that work belongs to the shared platform ledger because it is a platform billing concern, not a hotel-only runtime concern.

## Relationship to hybrid tenants

For hybrid tenants, the package story should stay explicit.

Examples:

- tour-first business that also runs rooms
- hotel-first business that also sells experiences or tours

The product story should explain that both engines can coexist without collapsing them into one confusing generic model.

## Product-page explanation guidance

When described publicly, the hotel product should be framed through outcomes rather than internal table names or checkpoints.

Preferred themes:

- sell rooms directly
- show room categories clearly
- manage availability and desk operations
- support operator rooming and mixed billing

Avoid public explanations based on:

- migrations
- internal checkpoint numbers
- technical schema names

## Packaging checklist for “sellable enough”

The hotel product is only packaged clearly enough when all of these can be stated simply:

1. what the guest sees
2. what the hotel team can operate
3. what the B2B/operator workflow can handle
4. where commerce is legally allowed
5. what is intentionally not promised yet

## Required implementation outputs for the packaging step

This packaging step should not be considered complete until all of these are decided:

- `Hotel Pro` scope statement
- publish minimum bundle
- commerce boundary statement
- staff-seat positioning statement
- best-fit customer definition
- explicit non-promises

## Non-goals for this document

- final public pricing page copy
- final landing-page design
- runtime tier-gating implementation

This document exists to make the hotel product understandable and commercially coherent first.