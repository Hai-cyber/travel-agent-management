# CURRENT_STATE_EXPORT.md

> **Generated:** 2026-03-28 | **Branch:** `rescue-minimum` | **Last verified checkpoint:** CHK-R36b
> Source of truth: `docs/ai/01_CURRENT_STATE.md` + `docs/ai/03_PROGRESS_LEDGER.md`

---

## 1. Runtime Platform

| Item | Value |
|---|---|
| Runtime | Cloudflare Workers (module syntax) |
| Local dev | `npx wrangler dev` → `http://127.0.0.1:8787` |
| Database | D1 (SQLite) — binding `DB`, name `travel_agent_db` |
| KV | binding `TOUR_PRESETS` |
| R2 buckets | `TOUR_PAGES` (tour-pages), `BOOKING_PROOFS` (booking-proofs), `SITE_TEMPLATES` (site-templates) |
| Cron trigger | `*/15 * * * *` → `purgeExpiredOrders(env)` |
| Node compat | `nodejs_compat` + `global_fetch_strictly_public` |
| i18n | Accept-Language → `translate()`, dual-price formatter, `resolveLocaleFromAcceptLanguage()` |
| Routing | Hono `app.route()` for entity management + URLPattern `patterns[]` for stop/pricing routes |
| IDs | `nanoid()` everywhere |
| Queries | `prepare().bind()` with `WHERE tenant_id = ?` on every SELECT/UPDATE/DELETE |

---

## 2. D1 Schema — All Migrations Applied (0001–0022)

| Migration | Description |
|---|---|
| 0001 | Foundation — `tours`, `destinations`, `tour_destinations`, `destination_texts`, `tenants`, `tour_stops` |
| 0002 | Stop service core (service flags) |
| 0003 | Stop service detail tables — `stop_accommodations`, `stop_meals`, `stop_guides`, `stop_local_transports`, `stop_intercity_legs` |
| 0004 | Pricing foundation — `tenant_seasons`, `pricing_segments`, `pax_bands`, `tour_prices` |
| 0005 | Tasks & comms alignment prep — `tasks`, `comm_threads`, `comm_messages` |
| 0006 | Tenant currency (`exchange_rate`, `target_currency`) |
| 0007 | Tenant locale (`default_locale`, `base_currency`) |
| 0008 | Tenant pricing policy (`pricing_policy`) |
| 0009 | Infant pricing (`infant_policy_text`) |
| 0010 | Booking drafts (`booking_drafts`) |
| 0011 | Tasks table finalized |
| 0012a | Stop services config (`tour_stop_service_flags` expanded) |
| 0012b | Tour publishing columns — `slug`, `content_data`, `template_id`, `published_at`, `published_url` on `tours` |
| 0013 | Tenant subscription — `subscription_status`, `custom_domain`, `payment_config_json` |
| 0014 | Tenant audit log — `tenant_audit_log` (settings changes) |
| 0015 | Tenant revenue tracking — `total_revenue_tracked`, `commission_threshold` |
| 0016 | Booking orders — `booking_orders` table |
| 0017 | Booking order token — `secure_token` column on `booking_orders` |
| 0018 | Site Studio foundation — `subdomain`, `template_id`, `site_config` on `tenants`; `site_templates` catalog |
| 0019 | Tour categories — `tour_categories`, `category_id` on `tours`, `homepage_layout` in `site_config` |
| 0020 | Universal payments — `notification_config` on `tenants`; extended `booking_orders` (`AWAITING_PAYMENT`, `PAID`, 8 payment methods) |
| 0021 | Payment methods toggle + Pay-on-Arrival — `payment_methods` JSON on `tenants`; `booking_orders_v2` with `PENDING_ARRIVAL` + `manual_unlock_at` |
| 0022 | Tenant audit log evolution — adds `actor`, `action`, `entity_type`, `entity_id`, `meta_json`, `created_at` columns |

---

## 3. Source Files

```
src/
  index.js                    — Hono app + URLPattern router + tenant middleware + CORS
  routes/
    bookings.js               — Drafts, orders, proof upload, guest portal, cron purge
    categories.js             — Tour categories CRUD
    payments.js               — Payment webhooks, notify settings, payment methods toggle
    pricing.js                — Pricing engine (seasons, segments, pax bands, tour prices, calculate)
    serviceItems.js           — 5-group stop service item CRUD
    tasks.js                  — Task status management
    tenants.js                — Tenant settings, audit log, site config
    tours.js                  — Tour CRUD + stops CRUD + publish/preview/switch-template
  lib/
    notifications.js          — notifyAgent() — Telegram + webhook push (non-blocking)
    publishGuard.js           — checkPublishPermission(), preview/live render helpers
    siteStudio.js             — resolveTenantByHost(), serveSitePage() HTMLRewriter pipeline
  services/
    serviceItems.js           — Service item business logic
    tasks.js                  — Task generation + templates per service group
  utils/
    formatter.js              — formatMoney, formatDateTime, translate, resolveLocaleFromAcceptLanguage
  locales/                    — i18n string tables (en, vi)
```

---

## 4. Public Frontend Assets

| File | Description |
|---|---|
| `public/dashboard.html` | Agent dashboard home — i18n EN/VI/ZH, tour list entry point |
| `public/tour-config.html` | Agent admin UI — 5-tab: Tour / Content / Stops / Price Config / Preview+Publish |
| `public/booking-widget.js` | Full guest booking widget — drawer, invoice, segment compare, draft save/load |
| `public/widget.js` | Lightweight embed — "Book Now" button, price modal, calls `/api/pricing/calculate` |
| `public/inject.js` | Site Studio client injection — i18n, custom selectors, feature toggles |
| `public/visual-editor.html` | Visual editor UI — click-to-select, postMessage, CSS selector generation |
| `public/editor-bridge.js` | postMessage bridge — click-to-element selection + CSS selector generator |
| `public/templates/default.html` | Tour page HTML template with all `{{PLACEHOLDER}}` tokens |
| `public/category-manager.html` | Tour categories management UI |
| `public/index.html` | Public landing / demo page |

---

## 5. Implemented Checkpoints (DONE)

### Infrastructure & Baseline
| CHK | Title | Date |
|---|---|---|
| CHK-R00 | Rescue baseline — local Worker + D1 shell | 2026-03-24 |
| CHK-R01 | Tours base table + preview | 2026-03-24 |
| CHK-R02 | Destinations catalog | 2026-03-24 |
| CHK-R03 | `tour_destinations` relation | 2026-03-24 |
| CHK-R04 | Destination texts | 2026-03-24 |
| CHK-R05 | Tour aggregate preview | 2026-03-24 |
| CHK-R06 | Tenants foundation + multi-tenant direction | 2026-03-24 |
| CHK-R07 | `tour_stops` as canonical itinerary entity | 2026-03-24 |

### Core Backend
| CHK | Title | Date |
|---|---|---|
| CHK-R09 | Service Items CRUD — all 5 groups (accommodations, meals, guides, local-transports, intercity-legs) | 2026-03-25 |
| CHK-R10 | Input validation — POST required-field + PATCH unknown-field guards | 2026-03-25 |
| CHK-R11 | Task System — templates, auto-generate on POST, PATCH status | 2026-03-25 |

### Tour Publishing & Tenancy
| CHK | Title | Date |
|---|---|---|
| CHK-R13 | Headless tour publishing to R2 (`TOUR_PAGES`), `switch-template` | 2026-03-26 |
| CHK-R14 | Subscription gate + custom domain routing + payment config injection | 2026-03-27 |
| CHK-R15 | Preview/live render separation, whitelabel, D1 audit log for settings | 2026-03-26 |
| CHK-R17 | Tenant revenue tracking schema (`total_revenue_tracked`, `commission_threshold`) | 2026-03-26 |

### Booking Engine
| CHK | Title | Date |
|---|---|---|
| CHK-R16 | Booking widget v1 (`booking-widget.js`) — drawer, invoice, segment compare, draft save | 2026-03-26 |
| CHK-R18 | Bank transfer order + identity lock + proof upload + cron purge + revenue tracking | 2026-03-26 |
| CHK-R19 | Guest portal (token-gated) + `widget.js` lightweight embed | 2026-03-26 |

### Pricing Engine
| CHK | Title | Date |
|---|---|---|
| CHK-R12 | Pricing foundation: seasons, segments, pax bands, tour prices, `/calculate`, `/metadata`, duplicate/copy season | 2026-03-25 |
| CHK-R25 | Booking View UX — conversational Phase 1/2, room distribution, compact mode, sticky footer | 2026-03-27 |
| CHK-R26 | Surplus room pricing logic — sole-occupancy supplement, two-way table↔sentence sync | 2026-03-27 |
| CHK-R36 | Price Config tab: customer Booking View replaces flat admin grid | 2026-03-27 |
| CHK-R36b | Season/segment full CRUD in UI — editable dates, Add Season/Segment forms | 2026-03-27 |

### Site Studio
| CHK | Title | Date |
|---|---|---|
| CHK-R20 | Site Studio schema — `subdomain`, `template_id`, `site_config`, `site_templates` catalog | 2026-03-26 |
| CHK-R21 | Worker domain router — `resolveTenantByHost()` + `serveSitePage()` HTMLRewriter pipeline | 2026-03-26 |
| CHK-R22 | Client injection layer — `inject.js`, `GET /api/tenant/config`, feature toggles | 2026-03-26 |
| CHK-R23 | Visual Editor — `editor-bridge.js`, `visual-editor.html`, `PATCH /api/tenant/config`, `GET /api/tenant/preview` | 2026-03-26 |

### Universal Payments
| CHK | Title | Date |
|---|---|---|
| CHK-R27 | Universal payment webhooks — 6 instant provider adapters, signature validation, instant identity unlock, Telegram notify, audit log | 2026-03-27 |
| CHK-R28 | Payment method toggle API + Pay-on-Arrival status (`PENDING_ARRIVAL`) | 2026-03-27 |
| CHK-R29 | Under construction kill switch — site blocked until ≥1 electronic gateway enabled | 2026-03-27 |
| CHK-R30 | Audit log evolution — `actor`, `action`, `entity_type`, `entity_id` columns; per-order unlock trail | 2026-03-27 |

### Admin Dashboard
| CHK | Title | Date |
|---|---|---|
| CHK-R24 | Tour categories schema — `tour_categories`, soft FK on `tours`, `homepage_layout` | 2026-03-26 |
| CHK-R31 | Tour Config Dashboard UI + Tour Stops CRUD (`GET/POST/PATCH/DELETE /api/tours/:id/stops`) | 2026-03-26 |

---

## 6. Full API Endpoint Inventory (Runtime Truth)

### Tenant
| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/tenants/settings` | Returns tenant config + read-only revenue fields |
| `PATCH` | `/api/tenants/settings` | Updates: exchange_rate, target_currency, pricing_policy, infant_policy_text, custom_domain, subscription_status, payment_config_json |
| `GET` | `/api/tenants/audit-log` | Last 100 audit entries |
| `GET` | `/api/tenant/config` | Public (no auth) — inject.js config endpoint |
| `PATCH` | `/api/tenant/config` | Deep-merge site_config; CSS selector validation |
| `GET` | `/api/tenant/preview` | Preview tenant page with `?tid=` |

### Tours
| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/tours` | Create tour |
| `GET` | `/api/tours` | List tours for tenant |
| `PATCH` | `/api/tours/:id` | Update tour fields |
| `DELETE` | `/api/tours/:id` | Delete tour |
| `POST` | `/api/tours/:id/publish` | Subscription gate, renders HTML → R2 |
| `POST` | `/api/tours/:id/switch-template` | Re-render with new template → R2 |
| `GET` | `/api/tours/:id/preview` | Live re-render, no R2 cache |
| `GET` | `/api/tours/:id/stops` | List stops |
| `POST` | `/api/tours/:id/stops` | Create stop |
| `PATCH` | `/api/tours/:id/stops/:stopId` | Update stop (dynamic PATCH) |
| `DELETE` | `/api/tours/:id/stops/:stopId` | Delete stop |

### Service Items (5 groups)
`{group}` = `accommodations` | `meals` | `guides` | `local-transports` | `intercity-legs`

| Method | Path |
|---|---|
| `POST` | `/api/stops/:stopId/{group}` |
| `GET` | `/api/stops/:stopId/{group}` |
| `PATCH` | `/api/stops/:stopId/{group}/:itemId` |

### Tasks
| Method | Path | Notes |
|---|---|---|
| `PATCH` | `/api/tasks/:taskId` | Update task status |

### Pricing Engine
| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/pricing/calculate` | Single segment or compare-all mode |
| `GET` | `/api/pricing/metadata` | Segments + seasons list |
| `POST` | `/api/pricing/duplicate-season` | Duplicate season with new name |
| `POST` | `/api/pricing/tenant-seasons/:id/copy` | Copy season |
| `POST/GET/PATCH/DELETE` | `/api/pricing/tenant-seasons` | Seasons CRUD |
| `POST/GET/PATCH/DELETE` | `/api/pricing/pricing-segments` | Segments CRUD |
| `POST/GET/PATCH/DELETE` | `/api/pricing/pax-bands` | Pax bands CRUD |
| `POST/GET/PATCH/DELETE` | `/api/pricing/tour-prices` | Tour prices CRUD |

### Bookings
| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/bookings/draft` | Server-side reprice, 24h TTL |
| `GET` | `/api/bookings/draft/:draftId` | Retrieve draft |
| `POST` | `/api/bookings/order` | Create order — ACTIVE subscription required; returns `guest_portal_token` |
| `GET` | `/api/bookings/order/:id` | Agent view; identity hidden until unlocked |
| `POST` | `/api/bookings/order/:id/proof` | Upload bank slip → identity unlock |
| `POST` | `/api/bookings/order/:id/confirm-receipt` | Agent confirms → CONFIRMED + revenue tracked |
| `GET` | `/api/bookings/public/:token` | Guest portal (no auth) |
| `POST` | `/api/bookings/public/:token/proof` | Guest uploads bank slip (no auth) |

### Payments
| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/payments/webhook/:provider` | Instant payment webhook — MoMo, ZaloPay, VNPay, Stripe, PayPal, GrabPay |
| `POST` | `/api/payments/notify/settings` | Set Telegram/webhook notification config |
| `PATCH` | `/api/payments/settings` | Toggle payment methods; first call seeds 9-entry default catalogue |

### Categories
| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/tours/categories` | List categories |
| `POST` | `/api/tours/categories` | Create category |
| `PATCH` | `/api/tours/categories/:id` | Update category |
| `DELETE` | `/api/tours/categories/:id` | Delete category |

---

## 7. Booking Order State Machine

```
Group B (Manual — Bank Transfer / Cash):
  AWAITING_PROOF ──[proof upload]────► PROOF_UPLOADED  (identity_unlocked = 1)
  PROOF_UPLOADED ──[agent confirm]───► CONFIRMED        (+revenue)
  AWAITING_PROOF ──[deadline]────────► EXPIRED          (cron purge, identity NULLed)

Group A (Instant — Electronic Gateway):
  AWAITING_PAYMENT ──[webhook success]─► PAID           (identity_unlocked = 1, +revenue)
  AWAITING_PAYMENT ──[webhook failure]─► CANCELLED

Pay-on-Arrival:
  PENDING_ARRIVAL ──[agent manual unlock]─► identity_unlocked = 1
```

Payment deadline: 48h standard; extends to 72h if 48h mark falls on Saturday/Sunday UTC.

Supported payment methods (9): `BANK_TRANSFER`, `CASH_AT_OFFICE`, `PAY_ON_ARRIVAL`, `CREDIT_CARD`, `MOMO`, `ZALOPAY`, `VNPAY`, `PAYPAL`, `GRABPAY`

---

## 8. In Progress

| Item | Status | Notes |
|---|---|---|
| CHK-R36 full verification | in_progress | Price Config tab full CRUD flow not yet fully verified in running dev server (see `04_SESSION_HANDOFF.md` for test checklist) |
| CHK-R08 | in_progress | Canonical docs reset still ongoing |

---

## 9. Not Yet Implemented (Planned)

| Area | Description |
|---|---|
| Comms / threads | `comm_threads` + `comm_messages` tables exist in schema but no CRUD API built |
| Calendar & reminders | `tenant_calendar_configs` table exists; no `GET/PATCH /api/tenants/calendar-config` or reminder cadence scheduler |
| Domain onboarding | Automated DNS verification flow (TXT record) |
| Publish gate checklist | `GET /api/tours/:id/publish-readiness` returning per-gate pass/fail |
| Billing / invoicing | Invoice generation, billing status endpoints |
| Growth / SEO API | Sitemap generation, SEO meta management |
| Mobile ops surface | Mobile-optimised task+thread quick-actions |
| Allotment / seat management | Seat inventory tracking (referenced in purge cron TODO) |
| Supplier system | Supplier catalog + service item linkage |
| CRM | Guest/customer records, communication history |

---

## 10. Key Business Rules (Enforced in Code)

- **Tenant isolation**: every query includes `WHERE tenant_id = ?`
- **Subscription gate**: `POST /api/bookings/order` + `POST /api/tours/:id/publish` return `403 SUBSCRIPTION_INACTIVE` for Trial/Suspended tenants
- **Electronic gateway mandate**: tenant site returns Under Construction page until ≥1 of Stripe/PayPal/MoMo/ZaloPay/VNPay/GrabPay is enabled
- **Revenue integrity**: `total_revenue_tracked` only incremented when `meta.changes > 0` — prevents double-counting
- **Identity lock**: guest PII (`name`, `email`, `phone`) not returned until `identity_unlocked = 1`
- **GDPR purge**: expired order identities NULLed by scheduled cron (`*/15 * * * *`)
- **Proof MIME allowlist**: `image/jpeg`, `image/png`, `application/pdf`; 10 MB cap
- **Surplus room logic**: sole-occupancy supplement auto-applied when `totalRooms >= adults`
- **Grand total**: computed client-side — never overridden by backend response
- **Webhook security**: always returns HTTP 200 to provider; signature verified silently when `webhook_secret` is set

---

## 11. Test Assets

| File | Description |
|---|---|
| `test/service-items.test.js` | Vitest unit tests |
| `test/test_all_services.sh` | Full integrated service items test |
| `test/test_booking_orders.sh` | 15 assertions — identity lock, proof unlock, revenue trigger |
| `test/test_pricing.sh` | Pricing engine |
| `test/test_tasks.sh` | Task status update |
| `test/test_guides.sh` | Guides group |
| `test/test_meals.sh` | Meals group |
| `test/test_local_transports.sh` | Local transports group |
| `test/test_intercity_legs.sh` | Intercity legs group |

---

## 12. Suggested Next Steps (Priority Order)

1. **Verify CHK-R36 end-to-end** in running dev server — add season → segment → pax band → tour price → calculate in Booking View. Mark done once all pass.
2. **Comms API** — `GET/POST /api/bookings/order/:id/messages` (or `/api/threads`) using existing `comm_threads`/`comm_messages` tables.
3. **Calendar config** — `GET/PATCH /api/tenants/calendar-config` for `tenant_calendar_configs`; reminder cadence cron.
4. **Publish gate checklist** — `GET /api/tours/:id/publish-readiness` returning per-gate pass/fail checklist.
5. **Domain onboarding** — DNS TXT record verification linked to `custom_domain`.
