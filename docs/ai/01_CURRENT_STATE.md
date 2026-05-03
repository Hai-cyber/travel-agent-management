
> RUNTIME NOTE: This file must not claim features as implemented unless 01_CURRENT_STATE.md confirms them. Only the runtime and endpoints listed below are actually implemented; all others are planned/target design.

# Current State Snapshot

Last updated: 2026-04-26 (synced after B2B allotment rework preview/apply/split and the planner-side block editor shipped)

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
- Cron trigger: `*/15 * * * *` → `purgeExpiredOrders(env)` + `runTrialMaintenance(env)` + `runTodoReminders(env)` + `runScheduledHousekeepingAutomation(env)`; `0 8 * * *` additionally runs `runPropertyNightAuditForDate()` for the previous date plus `runOpsDailyDigest(env)`
- Local dev: `npx wrangler dev` on `http://127.0.0.1:8787`
- i18n: Accept-Language → `translate()`, dual-price formatter, `resolveLocaleFromAcceptLanguage()`
- Currency/runtime note: booking email dispatches (`dispatchBookingCreatedEmail`, `dispatchNewBookingAgentEmail`, `dispatchProofUploadedEmail`, `dispatchBookingConfirmedEmail`) now receive the tenant's `booking_currency` from D1 instead of `null`; `bookingEmails.js` `|| 'USD'` fallback is now only a safety net. Storefront formatter/invoice USD-primary legacy in non-email surfaces is still transitional.
- Routing: Hono `app.route()` for entity management + URLPattern `patterns[]` for stop/pricing routes in `index.js`
- All IDs: `nanoid()`, all queries: `prepare().bind()` with `WHERE tenant_id = ?`

### D1 Tables (repo migrations 0001–0103 present in repo; later migrations now add shared-kernel/property foundation, property availability core, room operations, folio core, guest-photo + shift-handover support, hot-path property indexes, housekeeping task kind/service-date support, property allotments, planner-only pricing profiles, deterministic weekday pricing rules, B2B guest-folio execution metadata, allotment pricing-profile binding, and the exploratory universal-hotel to property link in addition to domain purchase, richer booking todo fields/threads, promo codes, and tenant calendar secrets)
`tours`, `destinations`, `tour_destinations`, `destination_texts`, `tenants`,
`tour_stops`, `stop_accommodations`, `stop_meals`, `stop_guides`,
`stop_local_transports`, `stop_intercity_legs`, `stop_service_tasks`, `tasks`,
`tenant_seasons`, `pricing_segments`, `pax_bands`, `tour_prices`,
`booking_drafts`, `tenant_audit_log`, `booking_orders`, `booking_order_todos`, `site_templates`,
`tenant_universal_sites`, `tenant_universal_theme_tokens`, `tenant_universal_contacts`,
`tenant_universal_pages`, `tenant_universal_menu_items`, `tenant_universal_tour_pages`,
`tenant_universal_hotels`, `users`, `memberships`, `auth_sessions`, `password_reset_tokens`, `app_settings`,
`tenant_review_cases`, `tenant_risk_events`, `tenant_asset_inventory`, `tenant_asset_scan_results`,
`tenant_domain_purchases`, `booking_todo_threads`, `promo_codes`, `tenant_settings`,
`staff_assignments`, `inbound_records`, `draft_records`, `properties`, `room_types`,
`room_units`, `property_reservations`, `inventory_holds`, `reservation_stay_plans`,
`reservation_stay_plan_segments`, `reservation_allocations`, `room_state_events`,
`housekeeping_tasks`, `maintenance_issues`, `folios`, `folio_lines`, `property_allotments`, `property_pricing_profiles`,
`property_weekday_pricing_rules`

Hotel/property boundary note:
- `tenant_universal_hotels` belongs to the universal storefront/catalog layer and remains transitional presentation/runtime support.
- `tenant_universal_hotels.property_id` now acts as the exploratory bridge from the universal hotel/catalog layer into the standalone property engine for hotel-mode stay search and booking-commit flows.
- The standalone property engine starts at `properties`, `room_types`, `room_units`, `property_reservations`, `inventory_holds`, `reservation_stay_plans`, and `reservation_allocations`.
- Do not treat `tenant_universal_hotels` as the canonical hospitality engine just because the word `hotel` appears in the table name.

Key tenant columns: `subscription_status`, `custom_domain`, `payment_config_json`,
`total_revenue_tracked`, `commission_threshold`, `exchange_rate`, `target_currency` (secondary display currency storage),
`booking_currency`, `market_skin_key`, `primary_market`, `notification_config`, `payment_methods`, `subdomain`, `template_id`, `site_config`, `product_tier_key`,
`trust_status`, `public_indexing_enabled`, `custom_domain_verified_at`, `promo_activated`, `calendar_secret`

### API Endpoints

Tenant business endpoints are scoped via `X-Tenant-ID` unless otherwise noted.

**Auth / Onboarding / SaaS Marketing**
- `GET /api/auth/session` — cookie-backed session status for tenant admin UIs
- `POST /api/auth/login` — email/password sign-in; production requires a valid Cloudflare Turnstile token
- `POST /api/auth/forgot-password` — prepares a password reset token for an existing account; response stays generic, while local dev and the authenticated same-user path can expose a debug reset URL; production requires a valid Cloudflare Turnstile token, applies a soft email/IP cooldown window, and POSTs a signed email-ready payload to a verified Google Apps Script mailer behind `PASSWORD_RESET_WEBHOOK_URL`
- `GET /api/auth/turnstile-config` — public auth-page config endpoint that tells the frontend whether login/signup/forgot-password Turnstile protection is enabled and exposes the public site key/action when configured
- `GET /api/auth/reset-password/:token` — validates a password reset token and returns masked email context for the reset form
- `POST /api/auth/reset-password` — updates the password, revokes existing auth sessions for that user, and consumes the reset token
- `POST /api/auth/signup-onboarding` — email signup that now requires `product_tier_key`, accepts optional `market_skin_key`, requires a valid Turnstile token in production, applies quiet email/IP soft throttling, logs hashed risk events, and redirects new tenants into the guided dashboard flow
- `POST /api/auth/google` — Google sign-in via GIS ID token; production requires a valid Turnstile token
- `POST /api/auth/signup-google` — Google signup with `product_tier_key` and optional `market_skin_key`; production requires a valid Turnstile token
- `POST /api/auth/login` also applies quiet email/IP soft throttling and logs hashed risk events so obvious credential-stuffing and scripted retries are slowed without adding visible friction for normal operators
- `GET /api/auth/product-tiers` — public localized tier catalog used by signup and pricing CTAs
- `GET /api/auth/market-skins` — public curated market-skin catalog used by signup and future onboarding surfaces, now including EUR presets for Germany, France, and Spain
- `GET /api/marketing-site` — public pricing/marketing content payload sourced from D1 `app_settings`
- `GET|PUT /api/admin/marketing-site` — protected SaaS marketing page editor API

**Billing / SaaS Subscription Lifecycle**
- `POST /api/billing/checkout` — creates a Stripe Checkout Session in subscription mode for the tenant
- `POST /api/billing/portal` — creates a Stripe Customer Portal session for invoice/card/cancel management
- `POST /api/billing/webhook` — Stripe webhook handler for subscription activation, suspension/cancellation, and payment-success email dispatch
- `GET /api/billing/status` — returns current subscription + trial status for dashboard/billing UI, plus `product_tier_key` and self-serve membership target options
- `POST /api/membership-billing/intents` — creates or reuses a manual membership settlement intent for allowed targets (`starter_landing -> tour/hotel/suite`, `tour_operator_pro -> suite`, `hotel_operator_pro -> suite`)
- `GET /api/membership-billing/intents/current` — returns the current tenant membership settlement intent for the billing pane
- `POST /api/membership-billing/intents/:intentId/mark-submitted` — tenant marks a manual settlement intent as sent and moves it into admin review
- `GET /api/admin/membership-billing/intents` — admin review queue for membership settlement intents
- `POST /api/admin/membership-billing/intents/:intentId/{approve|reject|void}` — admin review actions for membership settlement intents
- Production D1 has now applied `0104_membership_billing_intents.sql`, so the live platform is no longer relying on the temporary missing-table rescue path for membership intents.
- Subscription enforcement middleware in `src/index.js` now blocks mutating API calls for `SUSPENDED`, `CANCELLED`, and expired-trial tenants, while keeping `/api/billing/*` paths exempt for reactivation
- Tenant-admin tier-access runtime is now also aligned to packaging: `starter_landing` can view the workspace shell and website editor but is softly redirected into the billing pane when touching operational features; `tour_operator_pro` is blocked from hotel/property surfaces unless upgraded to suite; `hotel_operator_pro` is blocked from tour-business surfaces unless upgraded to suite; `tour_hotel_suite` can use both sides.
- Current limitation: provider-agnostic tenant membership settlement now exists in runtime with a manual-bank-transfer baseline, but proof upload and non-manual provider plugins are not implemented yet. Legacy Stripe subscription checkout and portal flows still exist alongside the new membership layer during rollout.

**Service Items (CHK-R09/R10)**
- `POST/GET/PATCH /api/stops/:stopId/{accommodations|meals|guides|local-transports|intercity-legs}`

**Task System (CHK-R11)**
- Task generation is working locally: service-item `POST` creates rows in `stop_service_tasks`
- Service-item `GET` returns embedded tasks for each item
- `PATCH /api/tasks/:taskId` is working locally again after the route was remounted into the live Hono router; verified on 2026-04-02 with direct PowerShell API calls against `stop-001`

**Pricing Engine (CHK-R12/foundation)**
- `GET /api/pricing/calculate` — single segment or compare-all mode
- `POST/GET/PATCH/DELETE /api/pricing/{tenant-seasons|pricing-segments|pax-bands|tour-prices}`
- `POST /api/pricing/duplicate-season`
- `POST /api/pricing/tenant-seasons/:id/copy`
- `GET /api/pricing/metadata`

**Tenants (CHK-R14/R15/R17)**
- `PATCH /api/tenants/settings` — updateable: `exchange_rate`, `target_currency` (or clearer alias `secondary_display_currency`), `booking_currency`, `default_locale`, `market_skin_key`, `primary_market`, `pricing_policy`, `infant_policy_text`, `custom_domain`, `subscription_status`, `payment_config_json`, `subdomain`, `onboarding_step`
- `GET /api/tenants/settings` — includes read-only: `total_revenue_tracked`, `commission_threshold`, `product_tier_key`
- Tenant settings responses now also expose the curated storefront currency basket, curated market-skin presets, currently-supported runtime UI locales, and a computed `secondary_display_currency` alias for the stored `target_currency` field
- `GET /api/tenants/audit-log` — last 100 entries for `custom_domain` / `payment_config_json` changes
- Platform subdomains are now validated and effectively one-time lockable: once a tenant saves `subdomain`, later changes are rejected
- Platform-owned labels are now reserved for SaaS, support, marketing, billing, and infrastructure use; tenant attempts to claim names such as `app`, `auth`, `api`, `blog`, `billing`, `status`, `preview`, `cdn`, `docs`, or other reserved platform namespaces are rejected with policy metadata and brand-safe suggestions
- Subdomain validation now enforces a 3-63 character pattern, and suspicious labels are blocked for manual review when they contain high-risk auth/finance/authority keywords, resemble protected finance brands, or look randomly generated; review attempts can emit signed webhook alerts via `SUBDOMAIN_REVIEW_WEBHOOK_URL`
- Tenant settings responses now include a `subdomain_policy` object so dashboard onboarding can render the active apex domain, reserved labels, and suggestion suffixes without hardcoding them
- Tenant trust control is now a first-class runtime concept: tenants carry `trust_status`, `public_indexing_enabled`, `custom_domain_verified_at`, and durable `tenant_review_cases`, allowing signup to stay low-friction while public exposure follows a ladder of `PREVIEW_ONLY -> PROBATION -> TRUSTED -> SUSPENDED/QUARANTINED`
- New tenants start as `PREVIEW_ONLY`; a clean first subdomain claim auto-promotes them to `PROBATION`, platform subdomains in probation are served with forced `noindex`, and custom domains only resolve after a tenant is `TRUSTED` and the current domain has been manually verified
- `POST /api/tenant/publish-site` now acts as a showcase-publish gate: TRIAL or ACTIVE tenants with terms accepted, a configured domain, and trust approval can publish public content without enabling commerce first; suspicious or blocked publish attempts still open review cases, downgrade trust, disable indexing, and return structured review details instead of publishing
- `POST /api/tenant/publish-site` also rate-limits repeated publish attempts by trust tier, records `publish_attempt` / `publish_throttled` events in `tenant_risk_events`, and returns `429` before full publish work when behavior looks automated
- `POST /api/tenant/publish-site` now supports dynamic universal publishing: tenants served directly from `tenant_universal_sites` / `tenant_universal_pages` no longer require legacy `sandbox/{tenantId}` files in `TOUR_PAGES`; publish marks `site_published_at`, writes `SITE_PUBLISH`, and leaves legacy R2 promotion only for template-sandbox tenants
- When Cloudflare AI is configured, publish-time moderation now also runs a second-pass scorer over normalized tenant content and merges that result with rule-based heuristics before deciding `ALLOW`, `REVIEW`, `BLOCK`, or `QUARANTINE`
- Publish moderation input is now built from the real universal site source of truth (home-page hero block, SEO metadata, contacts, and menu rows) rather than empty legacy `site_config` JSON for universal tenants; raw object braces are no longer injected into the AI prompt, which removed false positives such as `combined text contains suspicious characters {}`
- Low-risk AI-only `REVIEW` results no longer force tenant publish review by themselves: manual review now requires a meaningful score threshold or corroborating rule-based evidence instead of blindly trusting `recommended_action = REVIEW`
- Admin ops can manually re-run AI moderation through `POST /api/admin/tenants/:id/moderate-ai`, and flagged moderation events can send Telegram alerts when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are configured
- `POST /api/admin/tenants/:id/send-review-alert` now re-sends the latest open review case to Telegram, and Telegram moderation messages now include signed `Approve` / `Disapprove` action links handled by `GET /api/tenant/review-action/:action`
- `GET /api/admin/tenants/:id/broken-assets` scans five D1 JSON surfaces (`tours.content_data`, `tenant_universal_hotels.gallery_json`, `tenant_universal_tour_pages.content_override_json`, `tenant_universal_pages.blocks_json`, `tenants.site_config`) for dead `/api/tenant/assets/...` URLs; classifies each as `deleted`, `blocked`, `not_in_r2`, or `not_in_inventory_or_r2`; add `?check_r2=1` to also HEAD-check assets against TOUR_PAGES R2
- The `tenant_universal_hotels` surface in this scan is storefront/catalog JSON, not property-engine room inventory or reservation state.
- Sensitive tenant-editor routes now require a real authenticated tenant session in addition to tenant scoping, including template structure, publish readiness, config save, template switching, snippet loading, preview, soft publish, and publish flows
- `/api/tenant/pages` routes (pages.js: CRUD for universal site pages) are now in `PROTECTED_API_PREFIXES` — previously they only checked `X-Tenant-ID` with no session auth
- `POST /api/tenants/request-trust-upgrade` — PROBATION/PREVIEW_ONLY tenants can submit a review-case request for trust promotion; idempotent (7-day dedup); SUSPENDED/QUARANTINED receive 403; TRUSTED receive `already_trusted: true`
- `GET /api/tenants/review-status` now self-heals stale moderation state before returning UI payloads: low-risk publish/asset AI cases are re-evaluated against current content, resolved when current evidence no longer supports review, and non-moderation cases such as `trust_upgrade_request` are filtered out of the tenant-facing `Manual Review Status` panel
- `public/dashboard.html` custom-domain section is now visible to PROBATION and PREVIEW_ONLY operators (previously hidden until TRUSTED); shows a locked upgrade panel with the trust request button until TRUSTED status is reached
- `public/dashboard.html` launch flow now includes tenant-side moderation tooling: `Manual Review Status` shows AI vs rules provenance, low-signal trust-upgrade requests no longer appear as abuse warnings, and operators can trigger `Approve Review` / `Send Telegram Test` for real moderation cases from the dashboard
- `PATCH /api/tenant/config` now records a durable risk event, applies tenant-age/trust-aware save-rate scoring, runs rule + Cloudflare AI moderation on normalized site content, can open review cases, and can apply a soft trust hold that preserves editing while reducing public exposure
- `GET /api/tenant/assets` now merges R2 file listing with D1 asset-inventory metadata so tenant UIs can see moderation state, visibility, risk score, and reasons
- `POST /api/tenant/assets/upload` now computes SHA-256, applies upload velocity checks, runs rule-based asset scanning plus Cloudflare AI asset moderation, correlates cross-tenant asset reuse, stores inventory and scan results in D1, and blocks obviously malicious uploads such as active-content phishing SVGs before R2 persistence
- Low-risk AI-only asset reviews no longer auto-floor to `risk_score=60` / `AUTHENTICATED_ONLY`; stale AI-only asset cases are resolved when there is no rule evidence and no meaningful cross-tenant hash reuse, so tenant dashboards stop surfacing weak OCR/branding guesses as live warnings
- `GET /api/tenant/assets/:tenantId/:filename` now enforces asset visibility from D1 inventory, returning `404` for blocked/deleted assets and requiring an authenticated same-tenant session for `AUTHENTICATED_ONLY` assets
- `DELETE /api/tenant/assets/:filename` now marks the asset inventory row as deleted in addition to removing the underlying object

**Site Studio (CHK-R20 to R24/R29-R33)**
- `GET /:path` on custom subdomain/domain — `resolveTenantByHost()` + `serveSitePage()` HTMLRewriter pipeline. Platform subdomains can render showcase content on `TRIAL` or `ACTIVE`; custom domains still require `ACTIVE` + `TRUSTED` + verification.
- Worker static assets now run in `run_worker_first` mode. Tenant subdomain homepages are resolved by the Worker first and only fall back to bundled assets on `404`, which fixed `abc.tours-market.com` incorrectly serving the marketing-shell `public/index.html` instead of the tenant universal homepage

**Universal Site / Taxonomy Discovery (CHK-R35 to R45)**
- `GET /api/universal/site/config` — returns current universal site bundle, including runtime theme/menu/page data
- `GET /api/universal/public/hotels/:hotelKey` — host-resolved public hotel read endpoint; returns one active `tenant_universal_hotels` record for the current host plus its explicitly linked `properties` summary (`property_id`, address/timezone/currency defaults, room-type count, sellable room-unit count) and the resolved commercial policy for the current host.
- `POST /api/universal/public/hotels/:hotelKey/stay-search` — host-resolved public hotel stay-search endpoint; reuses the shared property availability and pricing engines against the linked `property_id`, then returns room-type options with availability payload, best-plan fit, shortage dates, and frozen quote totals for the requested stay. New hotel links and first-class hotel-mode rendering now point to the dedicated universal `hotels` page, where `public/property-stay-search.js` mounts when `?hotel=<hotelKey>` is present; the older `accommodation` query-param path remains only as a transitional compatibility surface. Public hotel routes now bypass the global authenticated API gate correctly, prefer `X-Forwarded-Host` before `Host` for host resolution, and resolve hotel keys case-insensitively so canonical lowercase URLs still match older mixed-case catalog rows.
- `POST /api/universal/public/hotels/:hotelKey/booking-commit` — host-resolved public hotel booking wrapper; allowed only when `public_booking_enabled` is true for the current host, then reuses the shared property hold and reservation handlers to create a short `soft_hold` and immediately commit a canonical `property_reservation` with source `direct_web`. `resolveTenantByHost()` now also carries `terms_accepted` into the public commercial-policy calculation so verified custom-domain commerce can actually unlock when the tenant has accepted terms.
- `GET /api/universal/taxonomy/catalog` — returns the canonical top-level interest taxonomy (`adventure`, `culture`, `beach`, `sport`, `food`, `nature`) plus planned sub-interests
- `GET /api/universal/taxonomy/interest-pages` — lists tenant-scoped auto-generated interest collection pages and their publication rules
- `GET|PUT /api/universal/taxonomy/tours/:tourId` — reads or replaces tenant-scoped taxonomy tags and discovery profile metadata for a tour
- `GET|PUT /api/universal/taxonomy/destinations/:destinationId` — reads or replaces tenant-scoped taxonomy tags and discovery profile metadata for a destination
- Auto-generated interest collection pages are now scaffolded into `tenant_universal_pages` / `tenant_universal_interest_pages` as standard pages with rule-driven listing blocks bound to `taxonomy.interest.<interest>.tour_listing`
- `GET /api/tenant/config` — public site config endpoint
- `PATCH /api/tenant/config` — deep-merge, selector validation, tenant-scoped
- `GET /api/tenant/snippets` — extracts all `<section>` blocks from R2 template
- `GET /api/tenant/preview` — live re-render without R2 cache (`?tid=`)
- Canvas page: siteStudio.js injects VE Canvas Layout Guard CSS (sticky header, flex body, #canvas flex-grow)
- `cfg.header_height` — server-side `padding-top` injection on `#canvas`

**Tour Publishing (CHK-R13/R14/R15)**
- `POST /api/tours/:id/publish` — subscription gate, renders HTML to R2 `TOUR_PAGES`
- `POST /api/tours/:id/switch-template`
- `GET /api/tours/:id/preview` — live re-render in preview mode (no R2 cache)

**Booking Drafts (quote cart)**
- `POST /api/bookings/draft` — server-side reprice, 24h TTL, authoritative quote snapshot now includes quoted amount/currency/base-currency/rate fields
- `GET /api/bookings/draft/:draftId`

**Booking Orders — Bank Transfer (CHK-R18 / CHK-R53)**
- `POST /api/bookings/order` — legal + commercial firewall. Public booking is only allowed on a verified custom domain after commercial activation (`ACTIVE`, `TRUSTED`, terms accepted, custom domain verified, and at least one enabled payment method). Platform subdomains and `/p/:tenantId/:slug` public paths are showcase-only.
- `GET /api/bookings/orders` — agent order list; accepts `?status=` filter + `?limit=`; returns masked orders (tenant-scoped)
- `GET /api/bookings/order/:id` — agent view; `maskOrder` now also exposes `secure_token` and `price_snapshot_json`; guest fields `name/email/phone` are masked until `identity_unlocked = 1`
- `GET /api/bookings/order/:id/proof-url` — streams R2 proof image directly from `BOOKING_PROOFS` bucket with tenant-scope check; returns `Content-Type` from r2 `httpMetadata`; `Cache-Control: private, max-age=300`
- `POST /api/bookings/order/:id/proof` — stores to R2, moves order to `PROOF_UPLOADED`, keeps identity locked until confirm
- `POST /api/bookings/order/:id/confirm-receipt` — sets `identity_unlocked = 1`, increments `total_revenue_tracked`, writes `tenant_audit_log` row
- `GET /api/bookings/order/:orderId/todos?seed=1` — lists per-order service checklist todos; `?seed=1` auto-seeds one todo per `tour_stop` (formatted as `"Label (Day X–Y)"`) if table is empty for that order; all rows scoped by `tenant_id`
- `POST /api/bookings/order/:orderId/todos` — add a custom task (stop_id=NULL, sort_order=999) to an order's checklist
- `PATCH /api/bookings/order/:orderId/todos/:todoId` — toggle `done`/undone; sets `done_at` timestamp on mark-done or null on uncheck
- Todo seeding is now deterministic and richer: `src/lib/bookingOps.js` builds one structured todo per configured service item, falls back to placeholders for missing services, and avoids race-condition duplicates by deriving todo IDs from the natural key `(order, stop, serviceType, item)`
- `GET /api/bookings/order/:orderId/todos/:todoId/thread` / `POST /api/bookings/order/:orderId/todos/:todoId/thread` — thread timeline per service todo, with first outbound contact auto-advancing status `pending -> contacted`

**Ops / Calendar / Reminder Layer**
- `public/ops.html` — dedicated ops board surface for grouped stop/service todos outside the main dashboard
- `GET /api/calendar/:secret.ics` — tenant-level iCal/webcal feed for upcoming service todos with embedded `VALARM` reminders
- `GET /api/calendar/:secret/:orderId.ics` — order-scoped iCal feed for a single booking
- `runTodoReminders(env)` sends reminder nudges on +30d after booking and at D-30 / D-14 / D-7 / D-3 before travel; `runOpsDailyDigest(env)` sends grouped daily digest emails

**Domains / Registrar Flow**
- `GET /api/domains/search?q=example.com` — RDAP availability check + registrar/base/platform price display
- `POST /api/domains/purchase` — creates a Stripe one-time Checkout Session for a domain purchase with platform markup enforced server-side
- `GET /api/domains/purchases` — lists a tenant's domain purchase attempts/history
- `POST /api/domains/stripe-webhook` — Stripe webhook for paid domain purchases; on success it continues into Cloudflare Registrar provisioning and D1 purchase-state updates

**Property Availability Baseline (CHK-R83)**
- Availability invariants in current runtime:
  - inventory is night-based and consumes `[check_in, ..., check_out - 1]`
  - sellable supply starts from active `room_units` whose `operational_status` is not `maintenance` or `out_of_order`
  - nightly remaining inventory is current sellable room-unit count minus overlapping `reservation_allocations` (`soft_allocated`, `locked`), minus active unexpired `inventory_holds`, minus active blocking `property_allotments`
  - `reservation_allocations` is the lane-level occupancy source of truth for rack/planning confidence; reservation headers alone do not decide room occupancy
  - pricing layers (`room_rates`, seasons, weekday rules, pricing profiles, `pricing_snapshot`) do not define availability; they are commercial overlays on top of inventory truth
- These routes belong to the standalone property engine and are intentionally separate from universal hotel/catalog/storefront surfaces such as `tenant_universal_hotels` or `public/product-modules.html`.
- `GET /api/properties` — lists tenant-scoped property builder records with room-type and room-unit counts
- `POST /api/properties` — creates a property builder record with availability policy defaults and tenant-scoped property identity (`name`, `slug`, timezone/currency, check-in/out defaults, split/upgrade policy flags)
- `PATCH /api/properties/:propertyId` — updates property builder fields and availability policy settings through dynamic SQL
- `GET /api/properties/:propertyId/room-types` — lists room types for a property with per-type unit counts
- `POST /api/properties/:propertyId/room-types` — creates a room type for inventory/availability modeling
- `PATCH /api/properties/:propertyId/room-types/:roomTypeId` — updates room type builder fields (`code`, `name`, occupancy, sort order, active`)
- `GET /api/properties/:propertyId/room-units` — lists physical room units for a property
- `POST /api/properties/:propertyId/room-units` — creates a single physical room unit
- `POST /api/properties/:propertyId/room-units/bulk-create` — quantity-style builder helper; creates many room units in one call from `count/start_number/prefix`
- `PATCH /api/properties/:propertyId/room-units/:roomUnitId` — updates room-unit builder fields such as room number, floor, active flag, and `operational_status`; inventory truth changes here feed directly into availability
- `GET /api/properties/:propertyId/room-rates` — lists the minimal commercial rate layer for a property's room types
- `POST /api/properties/:propertyId/room-rates` — creates one base nightly rate anchor for a room type
- `PATCH /api/properties/:propertyId/room-rates/:roomRateId` — updates the base nightly rate layer (`rate_name`, `currency`, `nightly_amount`, `active`) without changing availability math
- `GET /api/properties/:propertyId/rate-seasons` — lists date-window pricing seasons ranked by `sort_order`
- `POST /api/properties/:propertyId/rate-seasons` — creates a pricing season for one property
- `PATCH /api/properties/:propertyId/rate-seasons/:seasonId` — updates season name/date window/sort order/active flag
- `GET /api/properties/:propertyId/season-room-rates` — lists seasonal nightly prices per `(season, room_type)` pair
- `GET /api/properties/:propertyId/pricing-profiles` — authenticated internal pricing-profile read for one property; returns planner-only commercial overlays such as ROH/group/tour-company profiles with optional room-type scope
- `POST /api/properties/:propertyId/pricing-profiles` — manager-scoped create path for planner-only pricing profiles; stores one profile with `planner_only` visibility and one of `fixed_nightly_amount`, `delta_amount`, or `delta_percent`
- `PATCH /api/properties/:propertyId/pricing-profiles/:pricingProfileId` — manager-scoped patch path for planner-only pricing profiles; validates scope and pricing-mode consistency before update
- `DELETE /api/properties/:propertyId/pricing-profiles/:pricingProfileId` — manager-scoped delete path for planner-only pricing profiles
- `GET /api/properties/:propertyId/weekday-pricing-rules` — manager-scoped deterministic weekday-pricing read for one property; returns property-wide or room-type-scoped weekday rules ordered for explainable commercial layering
- `POST /api/properties/:propertyId/weekday-pricing-rules` — manager-scoped create path for deterministic weekday pricing rules; stores one day-of-week rule with `fixed_nightly_amount`, `delta_amount`, or `delta_percent`
- `PATCH /api/properties/:propertyId/weekday-pricing-rules/:weekdayPricingRuleId` — manager-scoped patch path for weekday pricing rules; validates weekday range, scope, and pricing-mode consistency before update
- `DELETE /api/properties/:propertyId/weekday-pricing-rules/:weekdayPricingRuleId` — manager-scoped delete path for weekday pricing rules
- `POST /api/properties/:propertyId/season-room-rates` — creates a seasonal nightly price override for one room type inside one season
- `PATCH /api/properties/:propertyId/season-room-rates/:seasonRoomRateId` — updates seasonal nightly price overrides
- `POST /api/properties/:propertyId/rates/quote` — admin pricing quote endpoint; resolves stay-night pricing by season first, then falls back to the active base rate when no season applies. Base and seasonal rates can now also define included adults/children plus extra-adult/extra-child surcharges. The quote path supports both multi-room aggregate occupancy math through `rooms_requested` and explicit per-room assignment pricing through `room_guest_assignments`; it can now apply a deterministic weekday rule layer before optionally overlaying a planner-only `pricing_profile_id`, and reservation create/rebook reuse the same pricing resolver to freeze that quoted result into `pricing_snapshot`.
- `POST /api/properties/:propertyId/availability` — tenant-scoped property availability read model for phase-1 inventory truth; returns `nightly_remaining`, `shortage_dates`, ranked `stay_plans`, same-type nearby date options, and other-room-type options based on `room_units`, `inventory_holds`, and `reservation_allocations`
- `POST /api/properties/:propertyId/availability/hold` — direct-booking soft-hold baseline; reruns availability first, creates an `inventory_holds` row only when no shortage remains, then returns refreshed availability after the new hold is applied
- `POST /api/properties/:propertyId/availability/hold/:holdId/release` — authenticated admin release path for active holds; marks the hold `released` without touching availability math or reservation truth
- `POST /api/properties/:propertyId/reservations` — direct-commit property reservation path; reruns availability/planner logic with optional `hold_id` exclusion plus optional `preferred_room_unit_id` and `allotment_id`, selects the best concrete stay plan, freezes the server-resolved commercial decision into `pricing_snapshot`, creates a `confirmed` `property_reservations` row plus linked `reservation_stay_plans`, `reservation_stay_plan_segments`, and `reservation_allocations`, and consumes the referenced hold or allotment when provided. Current local smoke for this slice explicitly verifies preferred-lane fallback, allotment-backed reservation creation, planner-only pricing-profile snapshots, and frozen weekday-adjusted pricing snapshots.
- `GET /api/properties/:propertyId/addon-service-presets` — tenant-scoped property addon catalog read; returns reusable addon service presets for one property. Business rule: addon sales stay onsite-only by default; airport pickup is the only pre-arrival exception surfaced by the catalog policy
- `POST /api/properties/:propertyId/addon-service-presets` — tenant-scoped property addon catalog create; saves one reusable addon service preset with type, pricing mode, scope, and default price metadata
- `POST /api/properties/:propertyId/addon-service-presets/seed-defaults` — seeds a curated default addon catalog for one property, skipping any preset whose `code` already exists on that property
- `PATCH /api/properties/:propertyId/addon-service-presets/:presetId` — tenant-scoped property addon catalog patch; updates only provided preset fields
- `GET /api/properties/:propertyId/reservations` — staff-board reservation list endpoint; filters one property's operational reservations by `board_date`, `status`, and `limit`, then returns arrival/departure/stayover summary flags for front-desk use
- `GET /api/properties/:propertyId/reservations/:reservationId` — returns canonical property reservation truth plus selected stay plan and all reservation allocations for tenant-scoped operational reads
- `GET /api/properties/:propertyId/reservations/:reservationId/guest-photo` — authenticated guest-photo fetch for one reservation; streams the persisted image back from Worker-managed R2 storage when a primary guest photo exists
- `POST /api/properties/:propertyId/reservations/:reservationId/guest-photo` — authenticated guest-photo upload for one reservation; stores one primary guest image in R2 and persists the object key on the reservation row
- `GET /api/properties/:propertyId/shift-handover` — authenticated current handover note read for one property; returns the latest free-text note plus updater identity and timestamp for shift turnover
- `PATCH /api/properties/:propertyId/shift-handover` — authenticated current handover note write for one property; updates the live outgoing-shift note without reopening generic property configuration patch scope
- `PATCH /api/properties/:propertyId/room-units/:roomUnitId/flags` — authenticated staff-scoped room overlay patch; updates `do_not_disturb` and `room_service_requested` without broad room-configuration permissions
- `GET /api/properties/:propertyId/room-units/:roomUnitId/availability-calendar` — authenticated per-room month-view availability read; returns one room unit's reserved/available day map for the current staff sidebar confidence view
- `GET /api/properties/:propertyId/room-rack-summary` — authenticated rack-summary read; now uses `reservation_allocations` as the source of truth and returns allocation-backed `current_guest_name`, `current_check_out`, `arrival_today`, `departure_today`, `open_nights`, and `why_not_assignable` hints for the staff rack confidence layer
- `GET /api/properties/:propertyId/planning-grid` — authenticated multi-room planning calendar read; returns a per-unit per-date slot matrix plus normalized reservation rows and active allotment overlays so staff can compare arrivals, occupied lanes, departures, turnovers, and operator blocks across many rooms at once
- `PATCH /api/properties/:propertyId/reservations/:reservationId` — authenticated property room-assignment patch for single-room stays; persists `assigned_room_unit_id`, rewires the current stay-plan segment and room-night allocations to that room unit, and removes same-type rack ambiguity
- `GET /api/properties/:propertyId/reservations/:reservationId/folio` — returns or lazily opens the default folio for one reservation, including posted lines and a live summary (`charge_total`, `payment_total`, `balance_due`, `status`)
- `POST /api/properties/:propertyId/reservations/:reservationId/folio/lines` — posts manual front-desk folio charge rows (`service_charge` or `fee`) onto the reservation folio
- `POST /api/properties/:propertyId/reservations/:reservationId/folio/payments` — records a folio settlement row as `line_type = 'payment'` and recalculates folio status/balance
- `POST /api/properties/:propertyId/folios/night-audit` — authenticated manager-triggered room-charge posting for one property and one `audit_date`; reads `pricing_snapshot.nightly_breakdown` first for frozen reservation pricing and only falls back to the live pricing engine for older reservations that lack a compatible nightly snapshot, where that live fallback now includes deterministic weekday pricing rules before posting `room_charge` lines idempotently via `note = night_audit:YYYY-MM-DD`
- `GET /api/properties/:propertyId/housekeeping-tasks` — authenticated housekeeping board read; returns active housekeeping task rows with room, guest, `task_kind`, priority, actor role, latest room-state feed, and effective room-state projection for both departure-clean and occupied-room stayover-refresh work
- `POST /api/properties/:propertyId/housekeeping-tasks/sync` — authenticated housekeeping sync path; backfills departure-clean tasks for checked-out stays on the selected `board_date`, and only backfills stayover-refresh tasks when that `board_date` matches the property's local today
- `PATCH /api/properties/:propertyId/housekeeping-tasks/:taskId` — authenticated housekeeping task patch; updates task status/assignee/note, supports manager-only `room_state` transitions for inspection flow, and records `room_state_events` only for real room-state changes rather than stayover-refresh pseudo states
- `GET /api/properties/:propertyId/availability/holds` — authenticated active-holds board read; returns all still-active, unexpired inventory holds for one property with room-type labels and expiry timestamps so front desk can release the right lane without guessing ids
- `POST /api/properties/:propertyId/reservations/:reservationId/cancel` — minimal cancellation baseline; marks the reservation `cancelled`, stamps `cancelled_at/cancel_reason`, discards selected stay-plan state, releases active allocations, and reopens availability for the cancelled stay
- `POST /api/properties/:propertyId/reservations/:reservationId/rebook` — authenticated admin rebook path for `confirmed` reservations; recalculates availability while excluding the current reservation's allocations, discards the old selected plan, freezes a fresh server-resolved `pricing_snapshot` for the new stay, then writes a new locked stay plan/allocation set on the same reservation
- `POST /api/properties/:propertyId/reservations/:reservationId/check-in` — authenticated admin status transition from `confirmed` to `checked_in`
- `POST /api/properties/:propertyId/reservations/:reservationId/check-out` — authenticated admin status transition from `checked_in` to `checked_out`
- `POST /api/properties/:propertyId/reservations/:reservationId/early-check-out` — authenticated admin exit path from `checked_in`; shortens `check_out`, releases future room-night allocations, and trims future stay-plan segments
- `POST /api/properties/:propertyId/reservations/:reservationId/no-show` — authenticated admin status transition from `confirmed` to `no_show`; discards the selected stay plan and releases active allocations
- `POST /api/properties/:propertyId/reservations/:reservationId/undo-status` — authenticated admin undo baseline for `checked_in -> confirmed`, `checked_out -> checked_in`, and `no_show -> confirmed`; the checked-out restore path can now rebuild the stay after an early check-out when inventory is still available
- Property-engine authenticated guards now reject tenant `provider` seats at the backend boundary; planning, reservation, folio, and housekeeping handler families run through an operational staff gate instead of allowing every tenant-scoped session through the old broad `requireTenantActor` path. Pricing configuration surfaces are now further hardened: pricing profile, weekday-rule, room-rate, addon-preset, season, and seasonal-room-rate listing endpoints require manager-or-owner access, while live rate quoting remains on the operational path.

Property builder scope note:
- This builder layer is intentionally inventory-first: property identity, room types, and room-unit quantity/configuration are now part of the availability backbone.
- Property pricing v2 now exists as a separate commercial layer on top of that backbone: base nightly rate + date-window seasons + seasonal room-type overrides + deterministic weekday pricing rules + planner-only pricing profiles + occupancy-aware quote resolution, including a multi-room aggregate quote baseline and explicit per-room guest-assignment pricing. Availability still does not depend on price data, but reservation create/rebook now freeze the resolved commercial decision into `pricing_snapshot`, and night audit reads that snapshot before any live-rate fallback.
- Property reservation lifecycle now also has a dedicated audit trail in `property_reservation_events`, which powers operational history and safer undo paths for checkout/no-show corrections.
- `public/property-staff.html` now also exposes a persisted Shift Handover card in Support and room-level DND / Room Service toggles in the guest sheet. Rack cells render these room flags as overlay chips (`DND`, `RS`) on the affected units.

**Promotions / Testing Bypass Controls**
- `promo_codes` + `promo_activated` runtime support now exists for admin-issued promo codes and tenant-side activation flows
- Current code includes a promo-activated bypass path intended for controlled testing; this exists in runtime and should be treated as an explicit operational/testing surface, not as the general commercial policy default

**Guest Portal — no auth required (CHK-R19 / CHK-R53)**
- `GET /bookings/public/:token` — HTTP 302 redirect to `/booking-portal.html?token=TOKEN`
- `GET /api/bookings/public/:token` — guest views booking status, pax, total; JOINs `tours` + `tenants` to return `tour_title`, `tenant_name`, `pax_triple`; verified in production on 2026-04-13
- `POST /api/bookings/public/:token/proof` — guest uploads bank slip via secure token; MIME allowlist + 10 MB cap; moves order to `PROOF_UPLOADED`

**Booking Emails (CHK-R53)**
- `src/lib/bookingEmails.js` — `dispatchNewBookingAgentEmail(env, agentEmail, order)` fires on new booking creation; guest identity (name/email/phone) is omitted from the email body and replaced with an amber 🔒 locked notice; revealed only after agent confirms receipt in dashboard

### Frontend Assets
- `public/index.html` — live SaaS pricing / trust landing page for 4 tiers
- `public/login.html` / `public/signup.html` — localized auth entry points with product tier selection on signup; signup now also lets new tenants choose a curated market-skin preset before onboarding writes tenant defaults and starter content; login now includes a forgot-password path
- Real locale packs are now present for `ja`, `ko`, `en-GB`, `en-AU`, `de`, `fr`, and `es`; `/api/i18n` resolves them exactly via Accept-Language instead of collapsing everything to base `en`
- Booking widget (`public/tour-booking-view.js`) is fully localized across all 9 supported locales (en, vi, zh, th, de, fr, es, ja, ko): traveller-type labels (`traveller_adult`, `traveller_infant`, `traveller_adult_shared/private/triple`), phase-1 sentence fragments (`phase1_travel_on`, `phase1_we_are`, `phase1_adults_and`, `phase1_children`, `phase1_staying_in`, `phase1_double/triple_rooms_and`, `phase1_single_rooms`), tier/table labels (`pricing_tier`, `traveller_type`, `price_per_person`, `qty`, `subtotal`, `good_to_know`, `calculate_final_price`, `total_for_group`, `band_summary`), and live-price notice
- Public pricing table column headers (`Segment`, `Season`, `Pax`, `Adult`, `Child`, `Infant`) are now localized via `systemCopy.pricing.*` — no hardcoded English strings remain in `renderPricing()`
- `universal_site.pricing` locale section extended with `adult`, `child`, `infant`, `segment`, `season`, `pax` keys across all 9 locales
- `DEFAULT_MESSAGES` in `tour-booking-view.js` includes English fallbacks for all traveller keys so no locale can display a raw technical key
- `public/reset-password.html` — localized request/reset page for password recovery tokens
- `public/booking-portal.html` — guest-facing booking status portal (no auth); shows status badge, booking details table, deadline countdown, drag-and-drop proof upload; per-status sections (awaiting/uploaded/confirmed/expired/cancelled); fetches `GET /api/bookings/public/:token`
- `public/dashboard.html` — tenant admin dashboard; **sidebar-as-pane-controller** pattern: 3 `[data-pane]` content divs (`start-here` default, `orders`, `order-detail`); clicking sidebar order filters calls `showPane('orders')` and loads orders; `📋` detail button on every order row opens `order-detail` pane; order detail shows guest/tour/payment header + per-order service checklist (`booking_order_todos`) seeded from `tour_stops`; todos checkable via PATCH API; custom tasks addable inline; back button returns to orders list; stat cards show real counts; confirm-receipt flow unlocks guest identity in-page; proof image viewer uses blob() URL.
- `public/dashboard.html` now also contains a billing pane, review-case tooling, launch-guide refactor, partial ops shortcuts, provider-agnostic membership target selection, and tier-aware soft locks that send users into the billing pane when they touch features outside their current package; the upgrade entry is now a compact yellow `Upgrade` trigger beside the language selector, opening a single-choice modal that leads directly into the billing pane and auto-creates/reuses the selected membership intent.
- `public/ops.html` — richer operations board for grouped service todos, contact actions, status lifecycle, re-seed support, and operational cleanup fixes landed through CHK-R82
- `public/ops.html` now also enforces tour-surface tier access in-page: `starter_landing` and `hotel_operator_pro` may preview the shell but operational clicks route to the billing pane upgrade path.
- `public/properties-engine.html` — tenant-facing property configuration surface; includes property content framing, inventory structure, pricing setup, config-side operational tools, planner-only pricing-profile CRUD, and a new addon service preset catalog in the `Pricing` workspace. That catalog now states the commercial rule explicitly: addons are onsite-only except airport pickup. The page now uses parent tabs (`Content`, `Inventory`, `Pricing`, `Ops`) plus room-type tabs to reduce workspace sprawl on dense tenant configuration work, and the Quote panel can now test a selected pricing profile directly.
- `public/properties-engine.html` now also enforces hotel-surface tier access in-page: `hotel_operator_pro` and `tour_hotel_suite` may use the property engine; `starter_landing` and `tour_operator_pro` may preview the shell but are routed into the billing pane when they try to operate it.
- `public/team.html`, `public/suppliers.html`, and `public/inbox.html` now also enforce package-aware soft locks: `starter_landing` can still view these surfaces, but team management and tour-business workflows route into the billing pane until the tenant upgrades.
- `public/property-staff.html` — staff-facing property operations surface; separates Rack, Planning, Front Desk, Housekeeping, Maintenance, Guest Support, and POS/folio boundary lanes from tenant configuration. Uses the property reservation board feed plus current reservation detail/status actions, room-unit operational status controls, allocation-backed rack/planning data, a read-only view of the tenant-configured addon preset catalog in the `POS / Folio` lane, and planner-side operator block controls in the Plan tab.
- `public/property-staff.html` now also includes a live Room Rack kiosk workflow with persisted room assignment for single-room stays; the guest sheet `Actions` tab can save room assignment directly and `Check In` can carry that assignment in the same action.
- `public/property-staff.html` now also supports walk-in creation directly from a vacant rack cell plus persisted folio posting in the guest sheet: preset/custom service charges, manual payment recording, live balance-due summary, and invoice print now run on top of `folios` + `folio_lines` instead of session-only state.
- `public/property-staff.html` now also includes a compact top-right live operations clock, a rack-style Housekeeping board, and a multi-room Planning tab. Rack cells can show allocation-backed availability truth plus housekeeping overlays, the Housekeeping tab can now distinguish `departure_clean` from `stayover_refresh`, staff can advance stayovers through `Refresh Needed -> Refreshing -> Refreshed`, and managers still control `Ready for Inspection -> Inspected -> Clean` for turnover rooms. Night audit continues to post room-rate charges into folios through runtime rather than leaving room charges manual-only. The desk also now restores operator UI preferences like collapsed sidebar state and the selected planning horizon from browser storage.
- Planning is now reservation-first rather than walk-in-first: empty Plan cells open the guest sheet in `Create Reservation` mode only, use reservation copy instead of walk-in copy, and no longer imply immediate check-in semantics. Vacant Rack rooms still default to operational walk-in mode, but now expose an explicit switch between `New Reservation` and `Walk-in + Check In` so planning and front-desk operations stop sharing the same mental model by accident.
- Rack-driven turnover work is now more explicit as well: current stays expose `Extend / Change Stay` and `New Reservation After Stay` actions in the guest sheet, so extending the existing booking and creating the next single-room booking no longer depend on a generic `Rebook` label.
- Backend planning now also has a non-mutating reservation planner at `POST /api/properties/:propertyId/reservations/plan`. It reuses the allocation engine to return candidate stay plans, shortage dates, overlap conflicts, hold conflicts, maintenance conflicts, preferred-room conflict/fallback metadata, and recommendation buckets without committing inventory yet. When the request includes `allotment_id`, the same preview also returns `allotment_consumption` so the desk can see blocked-room decrement/release consequences before commit.
- The guest-sheet reservation form now consumes that planner directly. Reservation mode exposes a `Rooms` field, planner-only `Pricing Profile` selector, and a planner preview panel so staff can see candidate plans, selected-plan nightly commercial totals, preferred-lane conflicts, blocking overlaps, allotment-consumption summaries, and alternate recommendations before creating the reservation. It now also supports a manual scarcity-preview overlay with explicit threshold, surcharge-per-night, and total-cap inputs; this surcharge is preview-only and does not flow into reservation commit or night-audit freeze. Walk-in mode stays single-room only and bypasses the bulk-planning semantics.
- Property allotments now exist as a first-class runtime concept through `property_allotments` plus `GET/POST/PATCH /api/properties/:propertyId/allotments` and `POST /api/properties/:propertyId/allotments/:allotmentId/release`. Active, unexpired operator blocks now reduce room-type availability directly, show up in planning conflicts as `operator_allotment`, render as dedicated overlay rows plus releaseable pills directly in the Plan tab, and can now be intentionally consumed into guest reservations through `allotment_id` on the planner/create path instead of only blocking generic free-sell supply.
- B2B allotment rework now has a first rescue-runtime workflow in addition to baseline `PATCH`: `POST /api/properties/:propertyId/allotments/:allotmentId/rework-preview`, `POST /api/properties/:propertyId/allotments/:allotmentId/rework-apply`, and `POST /api/properties/:propertyId/allotments/:allotmentId/split`. The planner-side block ledger now reuses the Plan form as a compact `create / edit / split` editor so managers can preview and apply ROH/non-ROH block reshapes without leaving the Plan tab. The approved policy remains documented in `docs/ai/45_PROPERTY_B2B_ALLOTMENT_REWORK_POLICY.md`.
- B2B rooming execution has also moved beyond the earlier model-only baseline: `PATCH /api/properties/:propertyId/allotments/:allotmentId/rooming-list/:entryId` can now store `reservation_id`, consume any `pending_guest_folio` charge rows for that rooming entry into the linked reservation folio when a concrete reservation target exists, and automatically synchronize the parent allotment between `confirmed` and `in_house` based on whether any rooming entry is currently `checked_in`. `public/property-staff.html` now also shows recent allotment event history inline inside the planner block editor, includes a compact rooming execution panel for editing rooming labels, payer scope, reservation linkage, rooming status, and per-entry guest-folio routing counts, and now renders confirmed/in-house allotment rooming entries directly in the Front Desk board so operator rooms can be checked in/out without inventing retail reservations.
- Plan-triggered reservation creation now treats the clicked room lane as a soft preference rather than a hard assignment. The preview reports whether the preferred lane is honored, why it conflicts when it is not, and which fallback lanes the planner selected so staff can stage a reservation without accidentally force-binding the blocked room.
- Active, blocking allotment pills in the Plan tab now also expose a `Reserve` entry point that opens an allotment-backed reservation draft. `property_allotments` can now also carry an optional planner-only `pricing_profile_id`, the planner-side allotment form can create/edit that commercial selection directly, the applied profile now renders inline on the allotment pill/editor, and allotment-backed reservation drafts auto-preselect that profile unless the desk overrides it before commit. Final reservation create still submits `allotment_id`, reruns shared planning, and successful responses now surface the post-commit `allotment_consumption` summary so operators can see whether blocked rooms were decremented or fully released.
- `Extend / Change Stay` now also has a non-mutating preview path at `POST /api/properties/:propertyId/reservations/:reservationId/extend-plan`. The guest sheet shows whether the guest can remain in place, what room-date conflicts block the extension, and which planner recommendations remain viable before the desk commits the rebook mutation.
- `public/property-staff.html` now also exposes active inventory holds in Guest Support and adds direct `Post Early Arrival Fee` / `Post Late Checkout Fee` actions in the guest sheet. These actions read the configured addon preset fee fields and post them to the reservation folio through the existing folio line runtime.
- `public/property-staff.html` now also persists guest photos through the Worker runtime instead of session-only memory. Uploading a guest image stores it in R2 and returns a reservation-backed `guest_photo_url`, which the rack and guest sheet reuse after reload.
- Property reservation detail and board payloads now expose `allocated_room_unit_ids` / `allocated_room_numbers`, so the Room Rack can place one multi-room reservation across multiple occupied units instead of collapsing everything to a single assigned room lane.
- `public/properties-engine.html` now exposes `early_arrival_fee` and `late_checkout_fee` on addon presets so the tenant can configure operational fee amounts without editing raw JSON.
- `public/property-staff.html` now also uses a more explicit operational rack language: `Open Now`, `Reserved`, `Occupied`, `Departing Today`, and `Checked-out` as the primary room states, housekeeping remains a separate legend/strip, available-style rooms can show allocation-backed `n nights` / arrival timing / next-guest hints, and clicking a room opens a month-view room availability sidebar with reserved vs available day coloring for assignment confidence.
- `public/templates/default.html` — tour page template with all placeholders
- `public/booking-widget.js` — full booking flow widget (CHK-R16)
- `public/widget.js` — lightweight embed widget (CHK-R19)
- `public/tour-config.html` — agent admin UI (CHK-R25/R26/R80/R81)
- `public/product-modules.html` — dedicated destination / universal-hotel-catalog / gallery module manager distinct from quick skin editing; this is storefront/catalog tooling, not the standalone property-engine reservation/inventory UI
- `public/saas-admin.html` — protected editor for public pricing/marketing copy
- `public/billing/success.html` / `public/billing/cancel.html` — post-checkout success/cancel landing pages for SaaS billing
- `public/pricing.html`, `public/terms.html`, `public/privacy.html`, `public/contact.html` — public SaaS marketing/legal pages are now part of the runtime product surface, not placeholders
- `public/inject.js` — Site Studio client injection layer (CHK-R22)
- `public/visual-editor.html` — Visual Editor split-layout shell (CHK-R23/R29-R33)
  - Drag-and-drop snippets from sidebar onto canvas iframe (CHK-R31)
  - Button/Link editor panel: click any `<a>` in preview → text+URL fields (CHK-R33)
  - Drop zone: animated empty-state, auto-hides on first snippet insert (CHK-R30)
  - Canvas device preview toggles: `Laptop` and `Mobile`; mobile mode constrains the iframe to phone width for layout verification (CHK-R34)
- `public/editor-bridge.js` — iframe postMessage bridge (CHK-R23/R29-R33)
  - CSS-first header overlap fix: `body>header{position:sticky!important}` guard (CHK-R29)
  - `HEADER_HEIGHT_MEASURED` → parent persists to `cfg.header_height` (CHK-R29)
  - `wireBtns()` + `BUTTON_CLICK` + `applyBtn()` for link editing (CHK-R33)
  - 12-column snippet grid editing: section host detection, persisted `col-span-X`, snap resizing, translucent resize overlay, and block-level `Move / Copy / Delete` rail (CHK-R34)
  - Drag-reorder within the current section grid via placeholder-based drop logic; cleaned HTML persists through `SECTION_HTML_UPDATED` (CHK-R34)

### Universal Site API foundation (CHK-R35)
- Legacy Site Studio remains intact.
- New parallel namespace: `/api/universal/*`
- Default storefront UI is the `tour-luxury` shell, treated as the `Six Senses Immersive Frame` visual baseline rather than a Cruip legacy storefront.
- New D1 scaffold tables: `tenant_universal_sites`, `tenant_universal_theme_tokens`, `tenant_universal_contacts`, `tenant_universal_pages`, `tenant_universal_menu_items`, `tenant_universal_tour_pages`
- New temporary D1 entity table for decorative accommodation/runtime editing: `tenant_universal_hotels`
- Current hotel runtime truth is still transitional: `tenant_universal_hotels` is presentation/runtime support and should not be treated as the future canonical hospitality engine
- Universal hotel/catalog boundary: these surfaces support storytelling, showcase cards, and storefront editing; they do not represent room inventory, night allocations, or property reservation truth.
- New library: `src/lib/universalSite.js`
  - defines 3 groups: `tour_operator`, `stay_accommodation`, `transport_service`
  - defines 5 stabilized variants: `tour-adventure`, `tour-luxury`, `stay-boutique`, `stay-resort`, `transfer-private`
  - `tour-luxury` maps to the `Six Senses Immersive Frame` storefront baseline with Cormorant Garamond headings and Source Sans 3 body copy
  - seeds standard pages, menu items, theme tokens, contact schema, and editor schema
- New routes: `src/routes/universalSites.js`
  - `GET /api/universal/health`
  - `GET /api/universal/site/variants`
  - `GET /api/universal/site/bootstrap`
  - `GET/PATCH /api/universal/site/config`
  - `GET/PUT /api/universal/site/theme`
  - `GET/PUT /api/universal/site/contact`
  - `GET/PUT /api/universal/site/menu`
  - `GET/POST /api/universal/site/pages`
  - `PATCH /api/universal/site/pages/:pageId`
  - `POST /api/universal/tours/:tourId/page/sync`
  - `GET /api/universal/tours/:tourId/page`
- Theme architecture now exists under `src/lib/themes/`
  - `src/lib/themes/index.js` resolves the active storefront skin
  - `src/lib/themes/six-senses.js` preserves the first saved premium skin module
  - `GET /api/universal/site/config` returns `active_theme` so the admin and storefront can stay in sync
- `GET /api/universal/site/config` now returns a structured editor schema for frontend-driven controls (`text`, `rich_text`, `color`, `image_upload`, `link`, `toggle`, `repeater`)
- Travel universal tour pages are scaffolded as auto-bound records keyed by `tour_id`; runtime CTA intent defaults are now `Explore` (discovery), `Check availability` (booking), and `Contact us` (contact)
- Public storefront rendering now defaults to the Six Senses-style luxury editorial chrome: invisible fixed header on first paint, Cormorant Garamond wordmark/headings, and a floating `Book Now` CTA on scroll
- Universal storefront hero rendering now forces tenant-aware CTA context: home/listing discovery CTAs resolve through public page paths like `/p/:tenantId/:slug`, while `tour_detail` hero CTAs resolve to booking intent and anchor to `#booking-engine`
- Public storefront rendering supports preview-first contextual editing metadata, hotel/tour/destination/contact quick-edit handoff, and an expanded Website Design system panel for chrome toggles and site-level settings
- Website Design System Panel now also persists tenant market settings (`market_skin_key`, `booking_currency`, `default_locale`) through `/api/tenants/settings` alongside the universal site config save flow
- Child rooming policy is now room-based rather than adult-ratio based: each shared double room allows 1 child and each private room allows 2 children, with both booking UIs and backend pricing returning a rooming-capacity warning when the chosen room mix is exceeded
- Universal storefront system chrome now follows `market_skin_key/default_locale` as the source of truth: locale presets supply CTA labels, header/login labels, map/search labels, drawer title, and footer kicker by default; tenant-saved literals only apply as explicit overrides, and tenant settings updates now purge universal public cache so locale/currency changes appear immediately
- Broader non-editable storefront fallbacks now also follow the selected skin locale: luxury search empty states, gallery/story fallbacks, itinerary/service-flow headings, hero fallback labels, and footer/navigation fallback notes render from locale presets rather than staying hardcoded English when the tenant cannot edit them
- Navigation labels, footer legal page links, and system page titles now treat prior default labels from any supported storefront locale as non-custom defaults; when tenants switch skin locale, these high-traffic labels re-localize to the new skin language unless the tenant entered a real custom override
- Public customer booking flow now follows the storefront skin locale as well: the check-availability drawer inherits the effective `html lang` from the universal site renderer, uses localized booking UI copy and rooming messages, and public secure-token booking/proof endpoints now resolve guest-facing status and upload messages from the tenant's `default_locale` before any browser-language fallback
- Public booking UI is now policy-aware: showcase surfaces must not expose booking checkout at all, while commercial booking is only exposed on verified custom domains after commercial activation. Demo checkout on public showcase surfaces is no longer part of the intended direction.
- Pricing overlap resolution is now driven by `tenant_seasons.sort_order`, so when High Season and Low Season overlap, the higher-priority season wins regardless of which row happens to have the largest raw price
- Booking UI now places `Good to know` after `Grand total`, and the public `Check availability` slot shows a minimum-price teaser with canonical pricing copy instead of a system-placeholder sentence
- Current runtime truth for skins: the storefront shell is still powered by the preserved `six-senses` runtime module, but there are now multiple luxury variants riding that shell instead of a single hardcoded preset
- `tour-luxury` remains the original Six Senses immersive frame, and `tour-luxury-riviera` adds a second luxury mood with different preset imagery, theme tokens, and typography
- This keeps operations multi-skin in practice even while the luxury renderer stays shared underneath
- Architectural direction is now explicitly locked: `accommodation` is tour-only and exists to strengthen tour storytelling and stop/service context, while `properties` belongs to the hotel-only engine and must not be auto-derived from tour accommodation fields

### Managed responsive chrome (CHK-R34)
- `src/lib/siteStudio.js` and `src/routes/pages.js` render managed minimal headers with a mobile menu toggle.
- On narrow screens, customer-facing header collapses to logo + `☰ Menu` or icon-only `☰` on very small widths.
- Tapping the toggle expands the primary nav and chrome action buttons in-place; desktop keeps the full horizontal header.

### Universal storefront search
- The Six Senses hero search panel is now wired as a real GET search flow instead of a static mock.
- The primary field is `Destination or interest`, given the widest input space in the search grid.
- Search submits into the tours listing page and filters runtime cards by destination text plus taxonomy tags/interests already assigned at the unit level.

### Luxury multi-skin operation
- `public/universal-admin.html` now chooses among real luxury variants from the variant catalog instead of showing a single cosmetic Six Senses sample marker.
- Saving a selected luxury skin switches the tenant `variant_key` and applies the corresponding preset scaffold, so the chosen skin becomes the actual runtime storefront.

### Scripts
- `npm run db:migrate:local` — reconciles the `0012_stop_services_config.sql` ledger row if `tour_stops.services_config` already exists locally, then runs `wrangler d1 migrations apply travel_agent_db --local`
- `npm run backfill:tenant-seed` — audits/builds SQL for missing legacy tenant seed gaps
- `npm run backfill:tenant-seed:apply` — applies the remote SQL backfill for missing stop/price/service minimums
- `npm run clean:wrangler` / `npm run dev:clean` — clears Wrangler temp cache before local dev when needed
- `npm test` / `npm run test:local` — Windows-runnable smoke flow: reconciles/applies local migrations, refreshes seed pricing data, ensures `ten-demo-001` is ACTIVE and booking-compliant with an enabled electronic gateway plus bank transfer, starts a dedicated local Wrangler dev instance on port `8790` or the next free port when `8790` is already occupied, verifies tenant route boot health, Cloudflare AI fallback behavior, subdomain policy enforcement, asset moderation (safe SVG allow + malicious SVG block), task patch on `stop-001`, seeded pricing calculate for `tour-001` / `segment-standard`, booking proof + confirm + audit row end to end, forgot-password request + signed webhook delivery + token validation + password reset + sign-in with the new password, and newer billing/domain/ops smoke slices as they are added to the script
- `docs/PASSWORD_RESET_WEBHOOK.md` — production contract for the reset-email webhook payload, headers, HMAC signature, and current Google Apps Script production receiver setup
- `docs/GOOGLE_APPS_SCRIPT_PASSWORD_RESET.md` — receiver implementation notes and verified Google Apps Script rollout details
- `scripts/syncAllSnippets.mjs` — full Cruip extractor (CHK-R32)
  - 24 deep categories: hero-video, gallery-grid, booking-form, travel-itinerary, map-section + originals
  - Hybrid multi-label tagging (one snippet → N categories)
  - Image path: relative → R2 absolute URL; empty src → Unsplash by category
  - Hero padding: `padding-top:80px` injected into `<section>` opening tag
  - Editable markers: `data-ve-text` on headings/paragraphs; `data-ve-btn` on anchors
  - Run: `node scripts/syncAllSnippets.mjs --r2-base https://pub-xxx.r2.dev [--clear]`
- `scripts/seed-site-templates.mjs` — uploads template files to SITE_TEMPLATES R2
- `scripts/seed-snippets-from-templates.mjs` — legacy extractor (superseded by syncAllSnippets.mjs)

### tour-config.html detail (CHK-R25/R26/R43/R80/R81)
  - **Inline help system (CHK-R80)**: each tab has contextual `(?)` help popover buttons; clicking opens a `.help-popover` tooltip with guidance text; amber `.help-popover--warn` variant for caution notes; `tour_config.help.*` i18n block (25 keys) across all 9 locales
  - **Itinerary day inline edit (CHK-R81)**: each day row in the Content tab has a `.btn-icon-edit` pencil button; clicking pre-fills the Add Day form in edit mode; save button relabels to "Save Changes"; cancel resets to add mode; `_itinEditIndex` state tracks active edit
  - **Stops tab**: per-stop inline service toggles (Hotel, B/L/D meals, Guide, Local Transport, Intercity Transport), description textarea
  - **Content tab**: richer draft payload editing for `hero_desc`, `tour_desc`, `destination_*`, `accommodation_*`, hero image, and gallery images
  - **Unit-level taxonomy editing**: the Content tab now lets operators assign canonical interests, sub-interests, and a primary interest directly on the selected tour via `GET|PUT /api/universal/taxonomy/tours/:tourId`
  - **Tenant media upload**: content tab image fields now upload through `/api/tenant/assets/upload`, route through a shared local-drive-or-tenant-gallery picker, render inline preview blocks for hero, destination, accommodation, and gallery media, and block oversized local uploads (>8 MB or >6000px longest side)
  - **Media ownership rules**: gallery images stay gallery-level unless explicitly chosen for hero/destination/accommodation; module-level remove actions clear only that field, while gallery remove actions delete only the selected gallery entry from the draft
  - **Preview tab**: saves current draft content, syncs `/api/universal/tours/:tourId/page`, and prefers the universal draft detail render via `/api/universal/render/:tenantId`, with legacy `/api/tours/:id/preview` kept as fallback
  - **Price Config tab**:
    - **Left panel (65%)**: Season editor, Pax Bands, Segments, Tour Prices, Pricing Definitions editor (4 default rules, localStorage-persisted)
    - **Right panel (35%) — Customer Booking View**:
      - Phase 1: Conversational sentence inputs (travel date, adults, children, double rooms, single rooms); room auto-suggest + validation hint; "Calculate Final Price" CTA
      - Phase 2: Segment tier tabs; full-height 4-row pax table (Shared Adult ×2, Private Adult ×1, Child ×1, Infant ×1) with ± qty steppers; "Good to Know" Pricing Definitions fine print
      - Compact mode: Phase 1 collapses to one-line summary bar after CTA; "Edit" to re-expand
      - Sticky layout: scrollable content area, pinned footer with grand total always visible
      - **Surplus room logic (CHK-R26)**: sole-occupancy supplement auto-applied when `totalRooms ≥ adults`; amber note below table; ±2 shared stepper; full two-way sync table↔sentence
      - Grand total = strict local sum `(shared×price)+(private×price)+(child×price)` — never from backend

### product-modules.html detail
  - **Destinations mode**: destination-source editing now includes unit-level taxonomy assignment on the canonical backing tour record, so operators can classify destinations where they actually manage destination copy and imagery
  - Destination modules still remain tour-backed today; true standalone destination entity tagging is available by API, but the main user workflow currently runs through destination modules in `product-modules.html?mode=destinations`
  - **Hotels / Gallery / Destination media UX**: module image fields and gallery rows now use the tenant media picker, support direct remove actions in preview, use optimized preview rendering with local-dev fallback, and keep gallery-row previews intentionally compact so operators can inspect many images at once
  - Boundary note: the "hotel" side of Product Modules still edits universal catalog/storefront content, not `properties`, `room_types`, `room_units`, or property-engine reservations.

### Test Scripts
- `test/test_booking_orders.sh` — 15 assertions across 3 test groups (identity lock, proof unlock, revenue trigger)
- `test/test_pricing.sh`, `test/test_tasks.sh`, `test/test_all_services.sh` and per-group scripts

## Local verification on 2026-04-03

Verified against `npx wrangler dev` on local Wrangler dev (`http://127.0.0.1:8788` in this session) with direct API calls from PowerShell.

### Confirmed working in local runtime
- `GET /`
- `GET /api/tenants/settings`
- `GET /api/tours`
- `GET /api/tours-preview`
- `GET /api/pricing/metadata`
- `GET /api/pricing/calculate`
- `PATCH /api/payments/settings`
- `POST /api/bookings/order`
- `GET /api/bookings/order/:id`
- `POST /api/bookings/order/:id/proof`
- `POST /api/bookings/order/:id/confirm-receipt`
- `GET /api/bookings/public/:token`
- `POST/GET/PATCH /api/stops/stop-001/accommodations`
- `PATCH /api/tasks/:taskId`

### Confirmed defects in local runtime
- No currently reproduced runtime defects in the task, pricing-calculate, booking, and password-reset flows covered by `npm test` on 2026-04-03

### Notes on test method
- Windows verification now has a first-class entrypoint: `npm test`
- The smoke runner is Node-based and does not require `bash`
- It starts a dedicated local Wrangler dev instance on port `8790` unless `SMOKE_BASE_URL` is provided explicitly; if that port is busy, the smoke runner now shifts to the next free local port automatically

## Live verification on 2026-04-03

- Remote D1 migrations were checked with `npx wrangler d1 migrations apply travel_agent_db --remote --config ./wrangler.jsonc` and there were no pending migrations
- Production deploy completed successfully via `npm run deploy`
- Live Worker version after deploy: `b908bca5-3ad4-4814-8583-010ef1c88931`
- Verified live responses:
  - `https://tours-market.com/` → `200 OK`
  - `https://tours-market.com/api/auth/product-tiers` → localized active/future tier catalog returned correctly
  - `https://tours-market.com/api/marketing-site` → public marketing payload returned correctly from runtime
- Wrangler emitted one operational warning during deploy: because multiple environments exist in `wrangler.jsonc`, future production deploys should explicitly pass `--env=""` (or an explicit target env) to avoid ambiguity

## Planned / Target (not yet implemented)
- Full removal of USD-centric compatibility fields: runtime still keeps older fields like `grand_total_usd` and older formatter/enrichment helpers while migration continues
- Full market-skin storefront wiring: curated market-skin presets exist in runtime/catalogs, but their locale packs and storefront-specific copy/skin behavior are not yet fully applied end to end
- Multi-skin expansion beyond Six Senses: more storefront skins will be added under `src/lib/themes/`, with each tenant selecting its active skin through tenant site configuration
- Tenant creation seed packs: tours, storefront hotel cards, galleries, destinations, and related decorative/runtime content should be normalized so a new tenant can be created with preloaded seed data and a chosen skin in one step
- Skin-aware tenant bootstrap/load flow: tenant chooses a skin, then matching seed content is loaded automatically rather than manually assembled after creation
- Growth/SEO API baseline
- Mobile ops surface
- Allotment / seat management (referenced in purge cron TODO)
- Full CHK-R79 completion: inline editing for supplier/contact/date/person-in-charge on rich service todo cards remains incomplete even though the underlying todo/thread/status infrastructure is now present

## Present in code but not comprehensively documented/verified in the older local pass sections
- Site Studio live domain rendering and editor surface
- Tour publish / switch-template endpoints
- Public guest proof upload route
- Category management UI and routes
- External payment webhooks
- Domain purchase flow, calendar feeds, richer ops board interactions, and promo-code runtime slices landed after the older verification notes and should be verified against the current smoke/live process rather than treated as absent


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
5. fix the known task-routing and booking audit-log defects before expanding reminders/comms/growth surfaces

---

## Working interpretation rule for AI assistants
When in doubt:

- trust current rescue runtime over legacy docs
- trust canonical `DATA_MODEL.sql` over older schema references
- do not mark a checkpoint as done unless it is rebuilt and verified in the current repo
