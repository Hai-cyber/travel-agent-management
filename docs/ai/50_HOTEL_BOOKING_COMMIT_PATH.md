# HOTEL BOOKING COMMIT PATH

> RUNTIME NOTE:
> This document records the approved hotel public booking-commit behavior for `NEXT-P18E`.
> It is a target flow and product-contract document, not proof that the final hotel public booking path is already fully implemented in runtime.
> Exploratory runtime foundation already exists through `POST /api/universal/public/hotels/:hotelKey/booking-commit`, which currently creates a short `soft_hold` and then commits a canonical `property_reservation`; verify the exact shipped behavior in `01_CURRENT_STATE.md`.
> Actual implemented slices must still be checked in `01_CURRENT_STATE.md`.

## Purpose

This document defines how hotel-mode public users move from stay search to canonical reservation creation.

Its purpose is to prevent the public hotel booking flow from drifting into:

- a separate public reservation model
- a patched tour checkout pattern
- a host-policy violation on showcase surfaces

## Core rule

Hotel public booking must remain one canonical property reservation flow.

That means:

- search and result selection come first
- inventory is protected through the shared hold model when used
- reservation creation still lands in canonical `property_reservation`
- public booking never bypasses server-side availability recheck

## Commercial gate rule

Public hotel booking commit is allowed only on:

- verified custom domains
- with commercial activation enabled

Showcase-only surfaces may allow discovery and stay search, but must not allow real booking commit.

This rule must remain consistent with the platform commercial policy:

- platform subdomains are showcase-only
- `/p/:tenantId/:slug` style public paths are showcase-only
- verified custom domains are the commerce surface

## Recommended v1 commit model

The first hotel public booking flow should be `hold-first`.

Recommended sequence:

1. stay search
2. guest selects a room option / stay fit
3. system creates `soft_hold`
4. guest enters booking details
5. server rechecks availability against the selected stay and hold
6. canonical reservation is created
7. payment / next-step handoff follows

Why this is preferred:

- reduces race conditions
- fits the approved intake model
- gives a clear bridge between search results and commit

## Allowed fallback

If the first release absolutely cannot support hold-first UX cleanly, a tighter direct-commit fallback may exist temporarily.

But that fallback must still:

- re-run availability on the server
- create one canonical property reservation
- stay behind the same custom-domain commerce gate

The preferred direction remains hold-first.

## Public guest form

The first hotel public booking form should stay narrow and operationally useful.

Required fields:

- `guest_name`
- `guest_email`
- `guest_phone`
- `special_requests` (optional)

Early optional fields when useful:

- `expected_arrival_time`
- `expected_flight_ref`
- `airport_transfer_requested`

Do not overload v1 with full identity, passport, billing-profile, or CRM-style fields.

## Source taxonomy

The public hotel booking path should use canonical source values.

Preferred values:

- `direct_web`
- `direct_widget` only if a hotel booking widget later becomes a distinct entry point

The public flow must not invent a second source taxonomy for hotel.

## Required reservation behavior

When commit succeeds, the system must create one canonical property reservation containing at minimum:

- property id
- room type id
- stay dates
- guest counts
- guest contact data
- source
- pricing snapshot
- any selected stay-plan context needed by the engine

The public path should produce the same reservation truth shape as staff/manual paths.

## Hold behavior

If hold-first is used, the public path should rely on `soft_hold`.

Public hold expectations:

- short TTL
- source tagged as public/direct
- hold must match the chosen stay request
- commit must reject mismatched or expired holds

The public UI should treat holds as ephemeral protection, not as confirmed booking state.

## Pricing behavior

Commit must freeze server-resolved pricing truth.

That means:

- the public client does not submit trusted totals
- the server resolves the final quote/snapshot
- the resulting `pricing_snapshot` is canonical for the reservation

This keeps hotel booking aligned with the existing property pricing strategy.

## Stay-plan behavior

The commit path must preserve stay-plan truth.

Meaning:

- if the selected result was contiguous, commit that fit
- if split stay is shown publicly by policy and chosen, preserve that outcome explicitly
- if upgrade-preserve is chosen, preserve that explicitly

The public layer must not flatten these distinctions away during commit.

## Booking result states

The first public booking path should support these states clearly.

### A. Hold created

Meaning:
- inventory protected temporarily
- guest can continue to form / next step

### B. Commit succeeded

Meaning:
- canonical reservation exists
- guest sees confirmation / next commercial step

### C. Commit blocked by stale inventory

Meaning:
- availability changed before final commit
- public UI must return to availability/reselection state cleanly

### D. Commit blocked by commerce policy

Meaning:
- host is showcase-only or commerce not activated
- user may continue browsing, but cannot finish real booking

## Payment handoff boundary

This checkpoint should stop at booking commit + handoff boundary.

It should define:

- when reservation becomes `pending_payment` vs `confirmed`
- where payment next-step begins
- what confirmation payload the booking layer returns

It should not require solving every payment detail before the booking contract is clear.

Recommended early rule:

- if payment is still required, reservation may enter `pending_payment`
- if the commit model chooses immediate confirm for certain flows later, that should be explicit, not accidental

## Confirmation payload expectations

Public booking commit should return enough for:

- guest confirmation screen
- payment handoff
- later guest portal or reservation lookup expansion

Minimum useful payload:

- reservation id
- status
- property summary
- stay summary
- guest summary
- pricing summary
- next step hint

## Relationship to current exploratory runtime

The current public hotel read/search slices can remain the discovery foundation.

But `NEXT-P18E` must not be implemented by wiring those directly into a tour-style booking drawer.

Booking commit should start from the hotel-first scaffold and consume the search/result contract already defined in `49_HOTEL_STAY_SEARCH_AND_RESULTS.md`.

## Required implementation outputs for `NEXT-P18E`

The checkpoint should not be considered complete until all of these are decided:

- hold-first vs temporary fallback direct-commit rule
- public guest form shape
- custom-domain commerce gate behavior
- reservation status behavior (`pending_payment` vs `confirmed`)
- pricing snapshot freeze rule
- search-to-hold-to-commit contract
- confirmation payload contract

## Non-goals for this checkpoint

- staff authorization
- B2B/operator booking paths
- OTA/imported draft intake
- full payment gateway abstraction redesign

This checkpoint is about the public hotel booking commit path first.