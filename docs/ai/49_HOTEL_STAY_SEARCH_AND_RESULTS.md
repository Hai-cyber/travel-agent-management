# HOTEL STAY SEARCH AND RESULTS

> RUNTIME NOTE:
> This document records the approved hotel-mode stay-search and result behavior for `NEXT-P18D`.
> It is a target behavior and interaction document, not proof that the final hotel public search flow is already complete in runtime.
> Exploratory runtime foundation already exists through `GET /api/universal/public/hotels/:hotelKey`, `POST /api/universal/public/hotels/:hotelKey/stay-search`, and `public/property-stay-search.js`; verify the exact shipped behavior in `01_CURRENT_STATE.md`.
> Actual implemented slices must still be checked in `01_CURRENT_STATE.md`.

## Purpose

This document defines how hotel-mode tenants should expose stay search and availability-driven room discovery.

Its purpose is to ensure hotel search becomes a native part of the hotel public surface rather than a thin widget patched into a generic page.

## Core rule

Hotel stay search must be:

- availability-first
- policy-aware
- native to the hotel layout
- backed by shared property-engine truth

Do not build a public hotel search that invents its own room logic, pricing logic, or fallback semantics outside the shared property engine.

## Search entry points

Hotel mode should support two search entry points.

### 1. Global property stay search

Placed in the hero or high on the homepage.

Purpose:
- broad discovery for all eligible room categories

Required inputs:
- check-in
- check-out
- adults
- children
- rooms requested

### 2. Room-type anchored search

Placed on room detail surfaces.

Purpose:
- search a specific room type first, while still allowing visible alternatives when policy and supply require them

This should not become a separate engine. It is a constrained entry into the same availability flow.

## Search request model

Minimum request shape:

- `check_in`
- `check_out`
- `adults`
- `children`
- `rooms_requested`

Optional later inputs:

- preferred room type
- promo code
- corporate / contract context
- arrival time hint

The first public hotel search should stay small and strong.

## Result hierarchy

Search results should answer these questions in this order:

1. can this stay fit?
2. which room categories fit best?
3. what is the total price?
4. are there shortage dates or constraints?
5. are there policy-limited alternatives such as split stay or upgrade-preserve?

Do not lead with decorative room cards while hiding fit and availability clarity.

## Result objects

Each room option shown publicly should support:

- room type summary
- availability outcome
- total stay price
- nightly hint or from-price when useful
- fit explanation
- shortage dates when relevant
- CTA to continue toward booking

## Required public result states

### A. Available contiguous fit

Show clearly:

- room fits the full stay
- total amount
- room summary
- direct CTA

This is the preferred result.

### B. Not available for full stay

Show clearly:

- this room does not fit the full request
- shortage dates or reason summary
- alternative room suggestions if available

Do not render it as silently unavailable with no explanation.

### C. Split stay available

Show only when public policy allows it.

If shown, the public UI must explain that:

- the stay is available across more than one room assignment
- a room move may be involved

Do not surface split stay as if it were a normal contiguous room fit.

### D. Upgrade-preserve fit

If the engine uses upgrade to preserve a smoother stay and policy allows it, the public UI should explain that simply.

Example intent:
- stay available with upgraded room(s) on some nights

Do not hide the difference as if the selected room type alone explained the full fit.

## Policy interaction

Public result behavior must respect property policy.

Examples:

- show split stay only if public policy allows it
- honor upgrade-preserve rules instead of inventing a separate public ranking
- do not surface blocked/internal-only planner logic

The public layer should filter and explain engine results, not rewrite the engine's semantics.

## Pricing interaction

Search results must use shared property pricing truth.

That means:

- room totals come from the property pricing engine
- public search does not invent separate price rules
- planner-only pricing overlays do not leak into public results unless policy later changes explicitly

The public search layer can summarize pricing, but it must not become a second pricing engine.

## Commerce gate interaction

Search may exist on public hotel surfaces before full commerce is unlocked.

But the result view must respect commercial activation policy:

- showcase-only surfaces may show discovery/search content
- booking commit must stay locked on non-commercial hosts
- verified custom domains with commercial activation may continue to booking

The CTA language and next step must reflect that state honestly.

## Search-to-booking handoff

Search is not the booking flow itself.

Search should hand off:

- selected room option
- stay dates
- guest counts
- any policy-relevant fit metadata

into `NEXT-P18E` booking commit.

Do not let search mutate inventory directly except through the later approved hold/commit flow.

## Relationship to current exploratory runtime

The current exploratory slices:

- `GET /api/universal/public/hotels/:hotelKey`
- `POST /api/universal/public/hotels/:hotelKey/stay-search`
- `public/property-stay-search.js`

are acceptable foundations.

But the final hotel search should not remain defined as:

- an accommodation-page query-param hack
- a standalone patched widget outside the hotel-first scaffold

Those slices should be migrated under the hotel layout once `NEXT-P18B` and `NEXT-P18C` are implemented concretely.

## Required implementation outputs for `NEXT-P18D`

The checkpoint should not be considered complete until all of these are decided:

- global property search entry behavior
- room-type anchored search behavior
- public result-state hierarchy
- split stay public behavior
- upgrade-preserve public behavior
- pricing summary behavior
- commerce-gated CTA behavior
- search-to-booking handoff contract

## Non-goals for this checkpoint

- final booking commit flow
- payments
- actor authorization
- OTA/imported booking intake UX

This checkpoint is about search and result behavior first.