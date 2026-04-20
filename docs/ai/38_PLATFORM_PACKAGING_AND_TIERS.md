# PLATFORM PACKAGING AND TIERS

> RUNTIME NOTE:
> This document records the approved target commercial packaging direction for the platform.
> The current rescue runtime does **not** implement this packaging layer yet.
> Actual implemented runtime slices remain listed in `01_CURRENT_STATE.md`.

## Purpose

This document defines how the platform should be packaged commercially.

The goal is to keep the product:

- lightweight
- smart
- usable by SMEs and owner-operators
- modular without becoming an ERP bundle

## Core principle

The platform is one product with:

- one shared operating kernel
- one `tour engine`
- one `property engine`

Commercial packaging may expose different tiers, but the product should not be described as unrelated software products glued together.

## Shared product narrative

This platform should be positioned as:

> a lightweight business operating system for tours and stays

This means the platform helps operators:

- capture inbound bookings
- organize operations
- manage service/inventory truth
- support direct selling and external demand channels

## Why tiering matters

Tiering should help the platform sell to different business shapes without forcing every tenant into the full product at day one.

Examples:

- a tour-only operator
- a stay-only operator
- a mixed operator selling both tours and lodging

## Tier direction

### Tier 1
- lightweight starter
- basic product setup and publishing surface

### Tier 2
- tour engine focused
- tour booking + operations value

### Tier 3
- property engine focused
- hotel/stay operations value

### Tier 4
- combined `tour + hotel suite`
- one tenant uses both engines under one operational surface

## Tier 4 decision

Tier 4 should be treated as a **deliberate combined suite**, not as:

- two unrelated subscriptions stuck together
- a temporary upsell bundle with no product logic
- a full ERP claim

Tier 4 exists for operators who genuinely run both sides of the business:

- tours
- stays / hotel / villa / lodge operations

## What Tier 4 should mean in product terms

Tier 4 should include:

- tour engine access
- property engine access
- shared tenant/staff identity
- shared draft-ingest/inbox handling direction
- shared operational coordination direction where useful
- optional unified billing/folio direction when hotel guest also buys tours under the same tenant

## What Tier 4 should NOT mean

Tier 4 should not imply:

- full ERP scope
- full accounting suite
- guaranteed channel-manager behavior
- total cross-domain automation from day one

The combined suite must remain lightweight and practical.

## Why Tier 4 is commercially valid

This combined tier is justified because many SMEs operate in blended ways.

Examples:

- boutique stay + local tours
- villa operator + airport transfer + excursions
- travel agency with accommodation operations
- owner-led hospitality business selling both rooms and experiences

These operators do not want enterprise software.
They want one lightweight system that understands both sides of the business.

## Shared kernel for all tiers

All tiers should still inherit one shared kernel.

Examples:

- tenant and staff seats
- inbound booking draft/ingest concepts
- task / reminder / communication timeline concepts
- audit and policy settings
- lightweight billing direction

This keeps the platform coherent even when tiers differ.

## Packaging rule

Tiering should change:

- access scope
- module availability
- commercial packaging

It should not create different product truths.

## Practical positioning guidance

The platform should be sold as:

- simple enough for SMEs and owner-operators
- powerful enough to coordinate fragmented bookings and operations
- modular enough to support tour-only, stay-only, or mixed businesses

## Recommended commercial wording

Preferred framing:

- `Tour Suite`
- `Hotel Suite`
- `Tour + Hotel Suite`

Avoid framing such as:

- `ERP`
- `all-in-one enterprise suite`
- `channel manager + PMS + OTA stack`

## Concrete tier map (runtime)

These are the four `product_tier_key` values stored in `tenants.product_tier_key` (column already exists, default `'starter_landing'`).

| `product_tier_key` | Commercial name | Engines unlocked | Payment config | Custom domain |
|---|---|---|---|---|
| `starter_landing` | Tier 1 — Landing | Website builder only | ❌ gated | ❌ gated |
| `tours_pro` | Tier 2 — Tours Pro | Tour engine + booking form | ✅ | ✅ |
| `hotel_pro` | Tier 3 — Hotel Pro | Property engine + reservations | ✅ | ✅ |
| `all_in_one` | Tier 4 — All-in-One | Tour + Hotel + all modules | ✅ | ✅ |

### Feature gate rules

- `starter_landing` tenants can **see** all dashboard UI surfaces (low risk — empty data)
- `starter_landing` tenants are **blocked at the API** from saving payment config or activating a booking form
- `custom_domain` column remains `NULL` until tier ≥ `tours_pro` or `hotel_pro`
- Hotel-only sidebar items carry `data-tier="hotel"` in HTML — hidden on `tours_pro`
- Tour-only sidebar items carry `data-tier="tours"` in HTML — hidden on `hotel_pro`
- Shared items (Dashboard, Calendar, Reports, Team) carry no `data-tier` — always visible

### Implementation decision log

**Decision (2026-04-20):** Tier gating deferred until after the hotel engine is complete.

Reason: hotel sidebar items and ops pages are still being built. Defining gates against half-built surfaces creates constant maintenance drag. Better to mark up `data-tier` as pages are built, then do a single gating pass at the end.

**What to do as you build hotel pages:**
- Add `data-tier="hotel"` to every hotel-only sidebar `<li>` as it is created.
- Add `data-tier="tours"` to every tours-only sidebar `<li>`.
- Leave shared items unmarked.

**What the gating pass will do (deferred checkpoint CHK-R113):**
1. Expose `product_tier_key` in `GET /api/billing/status` response (1 line in `billing.js`)
2. Dashboard JS reads the key and hides/shows `[data-tier]` items accordingly
3. Payment config save API rejects `starter_landing` tenants (1 guard in `payments.js`)
4. Booking form activation rejects `starter_landing` tenants (1 guard in `bookings.js`)

No DB migration needed — the column already exists.

## Companion docs

- `06_PRODUCT_MODEL.md` — overall product model and layers
- `08_MONETIZATION_LOGIC.md` — pricing/monetization direction
- `30_PROPERTY_ENGINE_OVERVIEW.md` — property engine scope
- `37_TOUR_ENGINE_DISTRIBUTION_AND_BOOKING_INGEST.md` — tour-side distribution and booking ingest direction
- `39_SHARED_KERNEL_BETWEEN_TOUR_AND_PROPERTY.md` — shared kernel direction between the two engines