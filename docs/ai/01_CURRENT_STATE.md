
> RUNTIME NOTE: This file must not claim features as implemented unless 01_CURRENT_STATE.md confirms them. Only the runtime and endpoints listed below are actually implemented; all others are planned/target design.

# Current State Snapshot

Last updated: 2026-03-26

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

### Infrastructure
- Cloudflare Workers runtime, D1 SQLite (binding: `DB`), R2 (bindings: `TOUR_PAGES`, `BOOKING_PROOFS`)
- KV (binding: `TOUR_PRESETS`)
- Cron trigger: `*/15 * * * *` → `purgeExpiredOrders(env)`
- Local dev: `npx wrangler dev` on `http://127.0.0.1:8787`
- i18n: Accept-Language → `translate()`, dual-price formatter, `resolveLocaleFromAcceptLanguage()`
- Routing: Hono `app.route()` for entity management + URLPattern `patterns[]` for stop/pricing routes in `index.js`
- All IDs: `nanoid()`, all queries: `prepare().bind()` with `WHERE tenant_id = ?`

### D1 Tables (migrations 0001–0017)
`tours`, `destinations`, `tour_destinations`, `destination_texts`, `tenants`,
`tour_stops`, `stop_accommodations`, `stop_meals`, `stop_guides`,
`stop_local_transports`, `stop_intercity_legs`, `tasks`,
`tenant_seasons`, `pricing_segments`, `pax_bands`, `tour_prices`,
`booking_drafts`, `tour_pages` (R2-backed), `tenant_audit_log`,
`booking_orders`

Key tenant columns: `subscription_status`, `custom_domain`, `payment_config_json`,
`total_revenue_tracked`, `commission_threshold`, `exchange_rate`, `target_currency`

### API Endpoints (all tenant-scoped via `X-Tenant-ID` header)

**Service Items (CHK-R09/R10)**
- `POST/GET/PATCH /api/stops/:stopId/{accommodations|meals|guides|local-transports|intercity-legs}`

**Task System (CHK-R11)**
- `PATCH /api/tasks/:taskId` — update task status

**Pricing Engine (CHK-R12/foundation)**
- `GET /api/pricing/calculate` — single segment or compare-all mode
- `POST/GET/PATCH/DELETE /api/pricing/{tenant-seasons|pricing-segments|pax-bands|tour-prices}`
- `POST /api/pricing/duplicate-season`
- `POST /api/pricing/tenant-seasons/:id/copy`
- `GET /api/pricing/metadata`

**Tenants (CHK-R14/R15/R17)**
- `PATCH /api/tenants/settings` — updateable: `exchange_rate`, `target_currency`, `pricing_policy`, `infant_policy_text`, `custom_domain`, `subscription_status`, `payment_config_json`
- `GET /api/tenants/settings` — includes read-only: `total_revenue_tracked`, `commission_threshold`
- `GET /api/tenants/audit-log` — last 100 entries for `custom_domain` / `payment_config_json` changes

**Tour Publishing (CHK-R13/R14/R15)**
- `POST /api/tours/:id/publish` — subscription gate, renders HTML to R2 `TOUR_PAGES`
- `POST /api/tours/:id/switch-template`
- `GET /api/tours/:id/preview` — live re-render in preview mode (no R2 cache)

**Booking Drafts (quote cart)**
- `POST /api/bookings/draft` — server-side reprice, 24h TTL
- `GET /api/bookings/draft/:draftId`

**Booking Orders — Bank Transfer (CHK-R18)**
- `POST /api/bookings/order` — legal firewall (ACTIVE only), server reprice, identity locked; returns `guest_portal_token`
- `GET /api/bookings/order/:id` — agent view; identity omitted until `identity_unlocked=1`
- `POST /api/bookings/order/:id/proof` — agent-side upload; MIME allowlist, 10 MB cap, R2 → identity unlock
- `POST /api/bookings/order/:id/confirm-receipt` — 2-step idempotent; increments `total_revenue_tracked`

**Guest Portal — no auth required (CHK-R19)**
- `GET /api/bookings/public/:token` — guest views own booking status, pax, total, upload link
- `POST /api/bookings/public/:token/proof` — guest uploads bank slip via token URL

### Frontend Assets
- `public/templates/default.html` — tour page template with all placeholders
- `public/booking-widget.js` — full booking flow widget (CHK-R16): floating button, drawer, invoice panel, segment compare, draft save/load
- `public/widget.js` — lightweight embed widget (CHK-R19): Book Now button, price-check modal, calls `/api/pricing/calculate`

### Test Scripts
- `test/test_booking_orders.sh` — 15 assertions across 3 test groups (identity lock, proof unlock, revenue trigger)
- `test/test_pricing.sh`, `test/test_tasks.sh`, `test/test_all_services.sh` and per-group scripts

## Planned / Target (not yet implemented)
- Calendar endpoints and reminder cadence
- Domain onboarding flow (automated DNS verification)
- Publish gate checklist endpoints
- Billing/invoicing status endpoints
- Site studio API baseline
- Growth/SEO API baseline
- Mobile ops surface
- Allotment / seat management (referenced in purge cron TODO)


### Current rebuilt database reality
Confirmed tables in the rescue rebuild:
- `tours`
- `destinations`
- `tour_destinations`
- `destination_texts`
- `tenants`
- `tour_stops`

### Current sample data confirmed
- 1 demo tour exists (`tour-001`, tenant `ten-demo-001`)
- Pricing seed: `season-high`, `season-low`, segments `segment-standard/vip/boutique`, pax bands `band-01/02/03`, tour prices for High/Low season
- Demo tenant: `ten-demo-001` (slug: `demo`), `subscription_status = 'TRIAL'` by default — set to `'ACTIVE'` in tests

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
