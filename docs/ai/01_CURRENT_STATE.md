
> RUNTIME NOTE: This file must not claim features as implemented unless 01_CURRENT_STATE.md confirms them. Only the runtime and endpoints listed below are actually implemented; all others are planned/target design.

# Current State Snapshot

Last updated: 2026-03-25

## Purpose of this file
This file describes the **actual current reality of the new rescue rebuild repo**.
It must not describe the old system as if it already exists in runtime.

If old documentation says a feature exists but the current rescue repo does not visibly implement it, treat that feature as **not built**.

---

## Current runtime reality

### Platform
- Runtime: Cloudflare Workers
- Local dev: `wrangler dev`
- Base URL: `http://127.0.0.1:8787`
- D1 binding: `DB`


## Implemented (rescue runtime truth)
- Cloudflare Worker runtime
- D1 with tables: tours, destinations, tour_destinations, destination_texts, tenants, tour_stops, stop_accommodations, stop_meals, stop_guides, stop_local_transports, stop_intercity_legs, tasks
- Preview endpoints:
  - /api/tours-preview
  - /api/destinations-preview
  - /api/tour-destinations-preview
  - /api/destination-texts-preview
  - /api/tours-with-destinations
- Service item CRUD API (CHK‑R09):
  - All 5 groups implemented: accommodations, meals, guides, local-transports, intercity-legs
  - POST/GET/PATCH fully working
  - Schema-aligned payloads
  - Validation for POST and PATCH implemented (CHK‑R10)
- Validation (CHK‑R10):
  - Required-field validation for POST
  - Unknown-field and empty-body validation for PATCH
  - No changes to service layer
- Task System (CHK‑R11):
  - Task templates for all 5 groups
  - Auto-generate tasks on POST
  - GET returns tasks embedded in each service item
  - PATCH /api/tasks/:taskId updates task status
  - All 5 test scripts passed (accommodations, meals, guides, local-transports, intercity-legs)
  - Full integrated test script passed

## Planned / Target (not implemented in rescue repo yet)
- Calendar endpoints and reminder cadence
- Domain onboarding flow
- Publish gate checklist endpoints
- Billing status endpoints
- Site studio API baseline
- Growth/SEO API baseline
- Mobile ops surface


### Current rebuilt database reality
Confirmed tables in the rescue rebuild:
- `tours`
- `destinations`
- `tour_destinations`
- `destination_texts`
- `tenants`
- `tour_stops`

### Current sample data confirmed
- 1 demo tour exists
- 1 demo destination exists
- 1 tour-destination relation exists
- 1 destination text exists
- 1 demo tenant exists
- 1 demo tour stop exists

---

## Canonical architecture direction

### Itinerary rule
The old destination-centric model is **not canonical** for the rebuild.

The new canonical direction is:

- `destinations` = catalog/reference only
- `tour_stops` = actual itinerary segments inside a tour

Examples of `tour_stops`:
- `Hanoi Arrival`
- `Hanoi City Tour`

These are itinerary blocks, not plain destination records.

### Service-item rule
Operational service items must eventually belong to:
- `tour_stop_id`

not:
- `destination_id`

### Pricing rule
Flat pricing fields from old docs are not canonical.

Canonical pricing direction is:
- `tenant_seasons`
- `pricing_segments`
- `pax_bands`
- `tour_prices`

### AI reality-control rule
Do not assume:
- old checkpoint docs
- old API docs
- old schema docs
- old completed ledgers

mean that the current rescue repo already implements those features.

If a feature is not visibly present in the current codebase and working local routes/schema, treat it as **not built**.

---

## What is intentionally still transitional

### Transitional table
- `tour_destinations`

This table was useful in early rescue steps but is **not** the long-term canonical itinerary model.

Canonical itinerary model:
- `tours -> tour_stops`

---

## What is not yet canonical runtime

The following may exist in old docs, old reports, or old ledgers, but must not be treated as current rescue runtime truth unless re-implemented and verified:

- old destination-based service item CRUD
- old task generation flow
- old thread/message flow
- old supplier system
- old publish/domain/billing/site/growth runtime modules
- old GrapesJS/site-studio runtime
- old mobile ops runtime
- old pricing runtime

---

## Immediate next architectural direction
The rebuild should proceed in this order:

1. lock canonical docs
2. keep `schema.sql` minimal and honest
3. add new stop-based service layer
4. add new pricing layer
5. later reconnect tasks/comms/site/public flows

---

## Working interpretation rule for AI assistants
When in doubt:

- trust current rescue runtime over legacy docs
- trust canonical `DATA_MODEL.sql` over older schema references
- do not mark a checkpoint as done unless it is rebuilt and verified in the current repo
