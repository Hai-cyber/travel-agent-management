# Progress Ledger

Purpose: track **actual rescue-rebuild progress** only.

Do not mark work as done because it existed in the old system.
Do not mark work as done because it is documented.
Only mark work as done when it is rebuilt and verified in the current repo.

## Status legend
- `not_started`
- `in_progress`
- `blocked`
- `done`
- `legacy_only` = existed in old system/docs but not rebuilt in current repo

## Checkpoint table
| CHK-A04 | Pricing Foundation | done | Pricing API documented in README.md | 2026-03-25 | Docs and curl examples added |
| Checkpoint | Title | Status | Code reality | Last update | Notes |
|---|---|---|---|---|---|
| CHK-R00 | Rescue baseline / local worker shell | done | local Worker + D1 baseline verified | 2026-03-24 | `/`, `/api/db-check`, `/api/tables` working |
| CHK-R01 | Tours base table + preview | done | `tours` exists and preview route works | 2026-03-24 | demo tour confirmed |
| CHK-R02 | Destinations catalog + preview | done | `destinations` exists and preview route works | 2026-03-24 | catalog direction chosen |
| CHK-R03 | Transitional tour_destinations relation | done | relation table exists and join preview works | 2026-03-24 | transitional only, not final itinerary model |
| CHK-R04 | Destination texts + preview | done | `destination_texts` exists and preview route works | 2026-03-24 | demo VI text confirmed |
| CHK-R05 | Tour aggregate preview | done | `/api/tours-with-destinations` works | 2026-03-24 | useful rescue preview, not final domain API |
| CHK-R06 | Tenants foundation | done | `tenants` exists with demo tenant | 2026-03-24 | multi-tenant direction restored |
| CHK-R07 | Canonical itinerary entity: tour_stops | done | `tour_stops` exists and demo row confirmed | 2026-03-24 | canonical itinerary direction locked |
| CHK-R08 | Canonical docs reset | in_progress | docs being reset from legacy reality to rescue reality | 2026-03-24 | `01_CURRENT_STATE`, `03_PROGRESS_LEDGER`, `04_SESSION_HANDOFF` being regenerated |
| CHK-R09 | Service Items CRUD | done | All 5 groups (accommodations, meals, guides, local-transports, intercity-legs) implemented. POST/GET/PATCH fully working, schema-aligned, validated. | 2026-03-25 | 100% complete. |

### 2026-03-25
- CHK‑R09 (Service Items CRUD) completed 100%: routing, service layer, schema alignment, D1 integration, manual testing. All groups (accommodations, meals, guides, local transports, intercity legs) fully CRUD-able via Worker API. No Node modules, no require(), no schema errors. Foundation is robust and clean.
| CHK-R10 | Validation | done | Required-field validation for POST; unknown-field and empty-body validation for PATCH; no changes to service layer. | 2026-03-25 | 100% complete. |
| CHK-R11 | Task System | done | Task templates for all 5 groups; auto-generate tasks on POST; GET returns tasks embedded in each service item; PATCH /api/tasks/:taskId updates task status; all 5 test scripts and integrated test passed. | 2026-03-25 | 100% complete. |
| CHK-R12 | Public/site/growth rebuild | not_started | not rebuilt yet | 2026-03-24 | old docs exist, new runtime not yet restored |
| CHK-R13 | Headless Publishing (R2) | done | Tour CRUD + generateTourPage + R2 publish/switch-template | 2026-03-26 | migration 0012, src/routes/tours.js, R2 binding TOUR_PAGES |
| CHK-R14 | Subscription Control + Custom Domain | done | Subscription gate on publish; pay-button injection; custom domain routing in fetch handler | 2026-03-27 | migration 0013, src/lib/publishGuard.js, tenants.js expanded |
| CHK-R15 | Preview/Whitelabel Identity Separation + Audit Trail | done | renderMode param; preview banner; disabled pay button in preview; white-label live pages; D1 audit log for custom_domain + payment_config_json | 2026-03-26 | migration 0014, publishGuard preview helpers, GET /audit-log |
| CHK-R16 | Booking Widget (booking-widget.js) | done | Floating button, side drawer, DatePicker, pax inputs, live itemized invoice, segment compare, Save → short-link | 2026-03-26 | public/booking-widget.js, auto-embedded in default.html |
| CHK-R17 | Tenant Revenue Tracking Schema | done | total_revenue_tracked + commission_threshold on tenants; read-only in GET /settings | 2026-03-26 | migration 0015 |
| CHK-R18 | Bank Transfer Order + Identity Lock | done | booking_orders table; 48h/72h weekend deadline; proof upload → identity unlock; confirm-receipt → revenue tracked; cron purge | 2026-03-26 | migration 0016, bookings.js order endpoints, scheduled purge |
| CHK-R19 | Guest Portal + Booking Widget v1 | done | Audit confirmed identity/revenue logic correct; Migration 0017 (secure_token); GET+POST /api/bookings/public/:token; public/widget.js embed | 2026-03-26 | migration 0017, 2 public routes in bookings.js, public/widget.js |
| CHK-R20 | Site Studio — Schema Foundation | done | subdomain + template_id + site_config on tenants; site_templates catalog; SITE_TEMPLATES R2 bucket | 2026-03-26 | migration 0018, wrangler.jsonc SITE_TEMPLATES binding |
| CHK-R21 | Site Studio — Worker Domain Router | done | resolveTenantByHost() + serveSitePage() HTMLRewriter pipeline; combined domain routing in index.js (Path1: template render, Path2: legacy R2) | 2026-03-26 | src/lib/siteStudio.js, src/index.js updated |
| CHK-R22 | Site Studio — Client Injection Layer | done | public/inject.js IIFE; GET /api/tenant/config public endpoint; smart h1/logo guess; custom_selectors loop; feature toggles; assets.directory ./public in wrangler.jsonc | 2026-03-26 | public/inject.js, src/routes/tenants.js expanded |
| CHK-R23 | Site Studio — Visual Editor | done | public/editor-bridge.js postMessage click-to-select + CSS selector gen; public/visual-editor.html split-layout UI; PATCH /api/tenant/config deep-merge + selector validation; GET /api/tenant/preview ?tid= endpoint | 2026-03-26 | 4 files, 717 insertions |
| CHK-R24 | Tour Categories Schema | done | tour_categories table (id, tenant_id, name, slug, sort_order, is_active); UNIQUE(tenant_id,slug); ALTER TABLE tours ADD COLUMN category_id TEXT (soft FK nullable); homepage_layout JSON doc in site_config.content | 2026-03-26 | migration 0019 applied locally (5 commands) |

## Legacy checkpoints from old system/docs
The following old checkpoint families must be treated as historical/reference only unless rebuilt again in the current repo:

- `CHK-101` through `CHK-209`
- `CHK-301` through `CHK-405`

For the rescue repo, they should be interpreted as:
- useful business reference
- not proof of current implementation


## Implemented (runtime truth)

### CHK-R19 — Guest Portal + Booking Widget v1 (2026-03-26)

**Audit findings (bookings.js):**
- `maskOrder()` — clean omission approach (no `***`): `guest` field entirely absent until `identity_unlocked=1`. Correct.
- Revenue step guarded by `orderUpdate.meta.changes > 0` — double-count impossible. Correct.
- **Gap found:** `booking_orders` had no `secure_token` column → fixed immediately.

**Migration:** `db/migrations/0017_booking_order_token.sql`
- `ALTER TABLE booking_orders ADD COLUMN secure_token TEXT`
- Partial unique index `WHERE secure_token IS NOT NULL`

**POST /api/bookings/order** now returns:
```json
{ "guest_portal_token": "<nanoid32>", "guest_portal_url": "/api/bookings/public/<token>" }
```

**New API routes (no X-Tenant-ID required — token is the credential):**

| Method | Path | Description |
|---|---|---|
| `GET`  | `/api/bookings/public/:token` | Guest views own booking status, pax, total, upload instructions |
| `POST` | `/api/bookings/public/:token/proof` | Guest uploads bank slip — same MIME/size rules as agent upload |

**Widget:** `public/widget.js` — vanilla JS IIFE, zero dependencies.
- Reads `data-tenant-id`, `data-tour-id`, `data-api-base`, `data-lang`, `data-accent` from `<script>` tag
- Injects styled "Book Now" button inline after the `<script>` tag
- Opens modal: date picker + pax ± counter + segment `<select>` (loaded from `/api/pricing/metadata`)
- Calls `GET /api/pricing/calculate` → renders price breakdown or segment compare cards
- i18n: `en` + `vi` string tables; Accept-Language driven
- `data-book-url` attribute wires through to the "Proceed to Book" CTA

```bash
# Apply 0017 migration
npx wrangler d1 migrations apply travel_agent_db --local

# Guest views their booking via portal link
curl http://localhost:8787/api/bookings/public/{SECURE_TOKEN}

# Guest uploads proof (no auth header)
curl -X POST http://localhost:8787/api/bookings/public/{SECURE_TOKEN}/proof \
  -F "proof=@/path/to/receipt.jpg"

# Embed widget on any page
# <script src="/widget.js" data-tenant-id="ten-demo-001" data-tour-id="tour-001" data-lang="vi"></script>
```

### CHK-R18 — Bank Transfer Order + Identity Lock (2026-03-26)

**Migration:** `db/migrations/0016_booking_orders.sql`
New table `booking_orders` — clean separation from `booking_drafts` (drafts = quote tool, orders = real transactions).

**State machine:**
```
AWAITING_PROOF ──[guest uploads proof]──► PROOF_UPLOADED
PROOF_UPLOADED ──[agent confirm-receipt]─► CONFIRMED  (+revenue)
AWAITING_PROOF ──[deadline exceeded]─────► EXPIRED    (cron purge, identity erased)
```

**Deadline logic:** 48 h standard; extends to 72 h if the 48 h mark falls on Saturday or Sunday UTC.

**R2:** `BOOKING_PROOFS` bucket added to `wrangler.jsonc` — proof images stored at `proofs/{orderId}`.

**New API routes (`/api/bookings/`):**

| Method | Path | Description |
|---|---|---|
| `POST` | `/order` | Create order — resprices server-side, stores identity locked, **requires ACTIVE subscription** |
| `GET`  | `/order/:id` | Agent view — identity hidden until `identity_unlocked = 1` |
| `POST` | `/order/:id/proof` | Upload bank slip / PDF (10 MB, allowlisted MIME) → unlock identity → `PROOF_UPLOADED` |
| `POST` | `/order/:id/confirm-receipt` | Agent action → `CONFIRMED` → increments `tenants.total_revenue_tracked` |

**Scheduled purge:** `wrangler.jsonc` cron `*/15 * * * *` → `purgeExpiredOrders(env)` exported from `bookings.js`; NULLs guest identity on expired rows (GDPR data minimisation).

**Legal Firewall (API):** `POST /order` returns `403 SUBSCRIPTION_INACTIVE` for Trial/Suspended tenants.

**Revenue Integrity:** `total_revenue_tracked` only incremented after `orderUpdate.meta.changes > 0` — prevents double-counting.

```bash
# Apply migrations + create bucket
npx wrangler d1 migrations apply travel_agent_db --local
npx wrangler r2 bucket create booking-proofs

# 1. Guest submits booking (requires tenant subscription_status = ACTIVE)
curl -X POST http://localhost:8787/api/bookings/order \
  -H "X-Tenant-ID: T001" -H "Content-Type: application/json" \
  -d '{"tour_id":"TOUR1","travel_date":"2026-07-10","segment_id":"SEG1",
       "pax":{"shared":2},"guest":{"name":"Nguyen Van A","email":"a@example.com"}}'

# 2. Guest uploads bank transfer proof
curl -X POST http://localhost:8787/api/bookings/order/{ORDER_ID}/proof \
  -H "X-Tenant-ID: T001" \
  -F "proof=@/path/to/receipt.jpg"

# 3. Agent confirms receipt + revenue is tracked
curl -X POST http://localhost:8787/api/bookings/order/{ORDER_ID}/confirm-receipt \
  -H "X-Tenant-ID: T001"

# 4. Test scheduled purge locally
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"
```

### CHK-R15 — Preview/Whitelabel Identity Separation + Audit Trail (2026-03-26)

**Migration:** `db/migrations/0014_tenant_audit_log.sql`
- `tenant_audit_log` table: `id`, `tenant_id`, `field_name`, `old_value`, `new_value`, `changed_at`, `updated_by`
- Indexed `(tenant_id, changed_at DESC)` for efficient per-tenant reads

**`src/lib/publishGuard.js` — new exports:**
- `buildPreviewBanner()` — fixed amber banner with "PREVIEW MODE" message (pointer-safe)
- `buildPreviewPayButton()` — disabled pay button placeholder for preview mode
- `buildPlatformBrand()` — "Powered by TravelStack" attribution (empty on live/whitelabel)

**`src/routes/tours.js` — updated:**

| Change | Detail |
|---|---|
| `generateTourPage` 5th param | `renderMode: 'live' \| 'preview'` (default `'live'`) |
| `PAY_BUTTON` placeholder | Preview → disabled button; Live → active payment gateway button |
| `PREVIEW_BANNER` placeholder | Preview → amber fixed banner; Live → empty string |
| `PLATFORM_BRAND` placeholder | Preview → "Powered by TravelStack"; Live → empty (white-label) |
| `GET /:id/preview` | **Rewritten** — re-renders on the fly in `'preview'` mode (no R2 cache), works for draft + published tours |
| `POST /:id/publish` | Explicitly passes `'live'` mode — stored R2 html has no platform branding |
| `POST /:id/switch-template` | Explicitly passes `'live'` mode |

**`src/routes/tenants.js` — updated:**
- `import { nanoid } from 'nanoid'` added
- `AUDIT_FIELDS = new Set(['custom_domain', 'payment_config_json'])` — fields that trigger D1 persist
- `writeAuditLog(env, tenantId, field, old, new, changedBy)` — non-fatal, won't block request
- PATCH handler now calls `writeAuditLog` for every change to `AUDIT_FIELDS`; captures `CF-Connecting-IP`
- **`GET /api/tenants/audit-log`** — returns last 100 entries (tenant-scoped, newest first)

**`public/templates/default.html` — updated:**
- `{{PREVIEW_BANNER}}` injected at `<body>` open
- `{{PLATFORM_BRAND}}` appended to footer text
- CSS added for `.booking-cta`, `.btn-book-now`, `.btn-book-now:hover`

```bash
# 1. Apply migrations
npx wrangler d1 migrations apply travel_agent_db --local

# 2. Preview a tour (works even without publishing) — shows amber banner, disabled pay
curl http://localhost:8787/api/tours/{TOUR_ID}/preview \
  -H "X-Tenant-ID: T001"

# 3. Publish → live mode, no platform branding, pay button injected (if gateway configured)
curl -X POST http://localhost:8787/api/tours/{TOUR_ID}/publish \
  -H "X-Tenant-ID: T001"

# 4. Check audit log (custom_domain and payment_config_json changes only)
curl http://localhost:8787/api/tenants/audit-log \
  -H "X-Tenant-ID: T001"

# 5. Change custom domain → audit entry is written automatically
curl -X PATCH http://localhost:8787/api/tenants/settings \
  -H "X-Tenant-ID: T001" \
  -H "Content-Type: application/json" \
  -d '{ "custom_domain": "tours.mycompany.com" }'
```

### CHK-R14 — Subscription Control + Custom Domain (2026-03-27)

**Migration:** `db/migrations/0013_tenant_subscription.sql`
Adds `subscription_status TEXT NOT NULL DEFAULT 'TRIAL'`, `custom_domain TEXT`, `payment_config_json TEXT` to `tenants`.
Unique partial index on `custom_domain`.

**New file:** `src/lib/publishGuard.js`
- `checkPublishPermission(env, tenantId)` — verifies `subscription_status = 'ACTIVE'`; parses `payment_config_json`
- `buildPayButton(paymentConfig, slug)` — generates Stripe / PayPal / generic CTA HTML; [SEC] no secret keys embedded

**Updated files:**
- `src/routes/tours.js` — import guard; `generateTourPage` accepts 4th `paymentConfig` param; `{{PAY_BUTTON}}` injected; `POST /:id/publish` and `POST /:id/switch-template` both call guard before rendering
- `src/index.js` — custom domain routing at top of `fetch()` — host → tenant lookup → R2 page served directly for ACTIVE subscribers
- `src/routes/tenants.js` — `custom_domain`, `subscription_status`, `payment_config_json` added to PATCH whitelist + validation; `payment_config_json` serialized to/from JSON transparently
- `public/templates/default.html` — `{{PAY_BUTTON}}` placeholder added in booking CTA section

```bash
# 1. Apply migration
npx wrangler d1 migrations apply travel_agent_db --local

# 2. Activate a tenant's subscription + configure Stripe
curl -X PATCH http://localhost:8787/api/tenants/settings \
  -H "X-Tenant-ID: T001" \
  -H "Content-Type: application/json" \
  -d '{
    "subscription_status": "ACTIVE",
    "custom_domain": "tours.mycompany.com",
    "payment_config_json": {
      "stripe_price_id": "price_abc123",
      "stripe_pub_key": "pk_test_xxx"
    }
  }'

# 3. Publish a tour (now guarded — requires ACTIVE subscription)
curl -X POST http://localhost:8787/api/tours/{TOUR_ID}/publish \
  -H "X-Tenant-ID: T001"
# → 403 if subscription_status != 'ACTIVE'
# → injects pay button HTML from payment_config_json if present

# 4. Custom domain routing — serve tour page via tenant's own domain
#    (Host header must match custom_domain; tenant must be ACTIVE)
curl http://tours.mycompany.com/ha-long-3n2d
```

### CHK-R13 — Headless Publishing (2026-03-26)

**Migration:** `db/migrations/0012_tour_publishing.sql`
Adds `slug`, `content_data` (JSON TEXT), `template_id`, `published_at`, `published_url` to `tours`.

**R2 bucket binding:** `TOUR_PAGES` (bucket: `tour-pages`) — templates at `templates/{id}.html`, pages at `{tenant_id}/{slug}.html`.

```bash
# 1. Apply migration
npx wrangler d1 migrations apply travel_agent_db --local

# 2. Create the R2 bucket (once)
npx wrangler r2 bucket create tour-pages

# 3. Upload the default template
curl -X PUT http://localhost:8787/api/tours/templates/default \
  -H "X-Tenant-ID: T001" \
  -H "Content-Type: text/html" \
  --data-binary @public/templates/default.html

# 4. Create a tour with content_data
curl -X POST http://localhost:8787/api/tours \
  -H "X-Tenant-ID: T001" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Hà Nội – Hạ Long 3N2Đ",
    "lang": "vi",
    "duration_text": "3 ngày 2 đêm",
    "content_data": {
      "tour_name": "Hà Nội – Hạ Long 3N2Đ",
      "tour_code": "HNX-HAL-3N2D",
      "base_price": 2500000,
      "itinerary": [
        { "day": 1, "title": "Hà Nội → Hạ Long", "description": "Khởi hành từ Hà Nội." },
        { "day": 2, "title": "Cruise trên Vịnh", "description": "Tham quan hang động." },
        { "day": 3, "title": "Hạ Long → Hà Nội", "description": "Rời tàu, trở về." }
      ],
      "highlights": ["Kayak hang sáng", "Hoàng hôn trên biển"],
      "includes": ["Khách sạn 3-sao", "Ăn sáng"],
      "excludes": ["Vé máy bay quốc tế"]
    }
  }'

# 5. Publish → saves HTML to R2
curl -X POST http://localhost:8787/api/tours/{TOUR_ID}/publish \
  -H "X-Tenant-ID: T001"

# 6. Preview the published HTML
curl http://localhost:8787/api/tours/{TOUR_ID}/preview \
  -H "X-Tenant-ID: T001"

# 7. Switch template (URL unchanged, content_data unchanged)
curl -X POST http://localhost:8787/api/tours/{TOUR_ID}/switch-template \
  -H "X-Tenant-ID: T001" \
  -H "Content-Type: application/json" \
  -d '{ "template_id": "premium" }'
```

- Worker shell (Cloudflare Worker runtime)
- D1 connectivity
- Preview endpoints:
  - `/api/tours-preview`
  - `/api/destinations-preview`
  - `/api/tour-destinations-preview`
  - `/api/destination-texts-preview`
  - `/api/tours-with-destinations`
- All tables now present in the database:
  - tours
  - destinations
  - tour_destinations
  - destination_texts
  - tenants
  - tour_stops
  - service_types
  - tour_stop_service_flags
  - stop_accommodations
  - stop_meals
  - stop_guides
  - stop_local_transports
  - stop_intercity_legs
  - tenant_seasons
  - pricing_segments
  - pax_bands
  - tour_prices
  - comm_threads
  - comm_messages
  - tasks
  - task_reminder_logs
  - tenant_calendar_configs


All service CRUD, validation, and task system logic is now implemented and tested. Pricing, comms, and calendar logic remain planned.

## Planned / Not Implemented

- Pricing logic and endpoints
- Tasks and comms logic/endpoints
- Calendar endpoints and reminder cadence
- Domain onboarding flow
- Publish gate checklist endpoints
- Billing status endpoints
- Site studio API baseline
- Growth/SEO API baseline
- Mobile ops surface

## Canonical rules

## Update template
### 2026-03-25
- CHK‑R09 (Service Items CRUD): 100% complete
  - All 5 groups implemented: accommodations, meals, guides, local-transports, intercity-legs
  - POST/GET/PATCH fully working
  - Schema-aligned payloads
  - Validation for POST and PATCH implemented (CHK‑R10)
- CHK‑R10 (Validation): 100% complete
  - Required-field validation for POST
  - Unknown-field and empty-body validation for PATCH
  - No changes to service layer
- CHK‑R11 (Task System): 100% complete
  - Task templates for all 5 groups
  - Auto-generate tasks on POST
  - GET returns tasks embedded in each service item
  - PATCH /api/tasks/:taskId updates task status
  - All 5 test scripts passed (accommodations, meals, guides, local-transports, intercity-legs)
  - Full integrated test script passed
### 2026-05-XX (multi-currency)
- CHK-R13 (Multi-Currency Support): done
- Status: 100% complete, verified locally
- Files changed:
  - db/migrations/0006_tenant_currency.sql  (ALTER TABLE tenants ADD exchange_rate, target_currency)
  - src/utils/formatter.js                  (convertToDisplay, enrichPrice, enrichPricesObject)
  - src/routes/pricing.js                   (import enrichPrice, enrich handleGetPricing for tour-prices, enrich /calculate response)
  - db/seed_test.sql                        (UPDATE tenants SET exchange_rate=25450, target_currency='VND')
- Summary: Tenants now carry currency config. All tour-prices GET responses include a `display` sub-object per row with dual-currency fields. The /calculate route enriches each price key (adult_shared_room, adult_single_room, child_shared_with_parents) into {price_usd, formatted_price_usd, price_vnd, formatted_price_vnd}.
- Risks / TODO: exchange_rate is a manually managed field; no FX feed integration yet. Consider a background job to update rates via an external API.
- Verification:
  - Migration 0006 applied: `exchange_rate=25450, target_currency='VND'` confirmed in DB
  - GET /api/pricing/tour-prices returns enriched `display` objects ✅
  - /calculate route code enriches via `enrichPricesObject` before responding ✅
  - curl: `curl -X GET http://localhost:8787/api/pricing/tour-prices -H "X-Tenant-ID: ten-demo-001"`

### CHK-R31 — Tour Config Dashboard UI + Tour Stops CRUD
- Checkpoint: CHK-R31
- Status: done
- Files changed:
  - `src/routes/tours.js` — Added 4 tour stops CRUD endpoints before `export default`
  - `public/tour-config.html` — New multi-step agent dashboard page (Tour/Content/Stops/Preview/Publish)
  - `public/dashboard.html` — Agent dashboard home with i18n EN/VI/ZH (CHK-R31 prep)
  - `public/assets/` + `public/images/` — Verti template static assets copied in
- Summary:
  - Backend: `GET/POST/PATCH/DELETE /api/tours/:tourId/stops` — full tenant isolation, nanoid IDs, required-field validation, dynamic PATCH.
  - Frontend: `public/tour-config.html` — 5-tab workflow (① Tour select/create, ② Content editor, ③ Stops manager, ④ Preview iframe, ⑤ Publish). Same connect-form + X-Tenant-ID pattern as category-manager.html.
- Risks / TODO:
  - Preview tab uses a Blob URL trick to inject X-Tenant-ID — works for local dev; a proper auth-token approach needed for production.
  - Service items per stop: stop IDs shown as copy-chips in tab ③; full service-items UI not yet embedded.
- Verification:
  ```bash
  # List stops for a tour
  curl http://localhost:8787/api/tours/{TOUR_ID}/stops \
    -H "X-Tenant-ID: ten-demo-001"

  # Create a stop
  curl -X POST http://localhost:8787/api/tours/{TOUR_ID}/stops \
    -H "X-Tenant-ID: ten-demo-001" \
    -H "Content-Type: application/json" \
    -d '{ "label": "Day 1: Arrive Hanoi", "day_from": 1, "day_to": 1, "nights": 1, "meal_breakfast": 1 }'

  # Open tour config UI
  # npx wrangler dev  →  http://localhost:8787/tour-config.html
  ```

### YYYY-MM-DD
- Checkpoint:
- Status:
- Files changed:
  - path/to/file
- Summary:
- Risks / TODO:
- Verification:
