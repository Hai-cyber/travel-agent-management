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

## Companion docs

- `06_PRODUCT_MODEL.md` — overall product model and layers
- `08_MONETIZATION_LOGIC.md` — pricing/monetization direction
- `30_PROPERTY_ENGINE_OVERVIEW.md` — property engine scope
- `37_TOUR_ENGINE_DISTRIBUTION_AND_BOOKING_INGEST.md` — tour-side distribution and booking ingest direction
- `39_SHARED_KERNEL_BETWEEN_TOUR_AND_PROPERTY.md` — shared kernel direction between the two engines