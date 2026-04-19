# TOUR ENGINE DISTRIBUTION AND BOOKING INGEST

> RUNTIME NOTE:
> This document records the approved target direction for distribution helper and booking-ingest capabilities on the tour side.
> The current rescue runtime only contains partial related slices; this full tour-engine module is **not** implemented yet.
> Actual implemented runtime slices remain listed in `01_CURRENT_STATE.md`.

## Purpose

This document ties two already-approved ideas back into the tour engine as one coherent business layer:

- distribution helper
- booking email ingest / draft intake

The purpose is to make tour selling and inbound booking capture more operationally reliable without requiring a full OTA/channel-sync architecture first.

## Core principle

For the tour engine, `distribution` and `booking ingest` should be treated as adjacent but separate capabilities.

### Distribution helper
- helps the tenant publish tours better
- helps improve direct demand and external visibility
- helps prepare assets for external channels or manual posting

### Booking ingest
- helps convert inbound booking information into structured booking drafts
- helps normalize fragmented inbound demand into one internal workflow

They reinforce each other, but they should not be collapsed into one generic “growth” or “sync” bucket.

## Why tour engine needs this layer

Tour businesses typically suffer from two related problems:

1. weak distribution consistency
- tours are described differently on each channel
- SEO/social surfaces are inconsistent
- staff manually copy and rewrite content repeatedly

2. weak inbound booking capture
- bookings arrive by email, message, OTA notice, or human forward
- staff retype details manually
- bookings are missed or delayed

The engine should therefore support both:

- getting better demand in
- turning inbound demand into structured operations

## Tour-side distribution helper

The tour-side distribution helper should remain lighter than a real channel manager.

Its purpose is to help tenants package and publish tours across external surfaces.

### Inputs
- tour title
- duration
- itinerary highlights
- media
- pricing snapshot or pricing cues
- inclusions / exclusions
- contact / lead capture links

### Outputs
- SEO-ready tour page structure
- social preview readiness
- reusable listing copy/snippets
- collection/landing-page compatibility
- external channel copy/export helpers

### Non-goal
- no real-time inventory/channel sync in the first version

## Relationship to Growth & SEO

`21_GROWTH_SEO_MODULE.md` remains the broader growth/distribution layer for tour/site surfaces.

This document narrows that idea into an engine-oriented rule:

- tour engine owns product truth
- growth/distribution layer packages that truth for acquisition surfaces

That means the distribution helper must consume canonical tour data, not invent a parallel tour model.

## Tour booking email ingest

`29_EMAIL_INGESTION_AND_BOOKING_DRAFT.md` already records the approved draft-ingestion direction.

For the tour engine, that module should be understood as a booking-ingest layer for tour sales and operations.

### Primary use cases
- OTA or marketplace booking email forwarded by staff
- customer confirmation email forwarded from a shared mailbox
- agent booking email forwarded into the system
- inbound booking information captured from fragmented channels and normalized into draft form

## Canonical rule for booking ingest

Inbound booking information should never become a live booking automatically just because it arrived by email.

The correct path is:

1. inbound email or inbound booking data received
2. parsed into `draft`
3. staff reviews / edits
4. confirmed into canonical booking record
5. operations tasks/reminders follow from the confirmed booking

This keeps the last business decision with the human operator.

## Why email ingest belongs to tour engine direction

Tour businesses often sell through mixed channels long before they can justify true integrations.

Examples:

- Booking.com / Agoda-style hotel flows are not the only model
- agent-to-agent forwards are common
- staff often rely on shared inboxes and messaging channels

So for tour engine, booking email ingest is a practical “control the inbox first” strategy.

## Distribution helper vs booking ingest

These modules should be kept distinct.

### Distribution helper does
- package tours for acquisition and external surfaces
- improve visibility and publish consistency

### Booking ingest does
- capture inbound booking information
- normalize it into drafts
- feed confirmed bookings into operations

### Important boundary
Distribution helper is about getting demand out and back in safely.
Booking ingest is about converting inbound demand into internal truth.

## Tour-side source model for booking ingest

The draft-ingest layer should support mixed inbound sources.

Suggested source values:

- `email_forward`
- `ota_notice`
- `manual_agent_forward`
- `manual_customer_forward`
- `shared_inbox_capture`

The final confirmed booking may still land in the canonical booking/order model already used by the tour engine.

## Operational value

This layer matters because it reduces:

- copy-paste booking handling
- missed follow-up
- inconsistent booking capture
- dependency on fragile integrations too early

It also helps connect sales to operations more cleanly.

### Example path
- distribution helper improves tour visibility
- inbound booking arrives by email
- booking ingest creates draft
- staff confirms booking
- ops board / reminders / tasks continue from there

## What the first version should do

The first tour-side distribution + ingest layer should support:

1. growth/distribution helper for tour publishing
2. email-based booking draft creation
3. draft review and confirmation flow
4. task/reminder creation from confirmed booking

## What it should not do yet

The first version should not require:

- real-time external inventory sync
- certified OTA integrations
- full channel-manager logic
- auto-confirming parsed emails into live bookings

## Implementation order

For the tour engine, the recommended order is:

1. canonical tour data and itinerary truth
2. tour distribution helper / growth packaging
3. booking email ingest into drafts
4. draft review + confirm flow
5. operations follow-through from confirmed booking

This keeps distribution and inbound capture attached to the existing booking/ops core instead of creating a detached sales surface.

## Companion docs

- `15_TOUR_AND_SITE_STRUCTURE.md` — tour/site separation
- `21_GROWTH_SEO_MODULE.md` — broader distribution & growth layer
- `29_EMAIL_INGESTION_AND_BOOKING_DRAFT.md` — booking email draft-ingest direction