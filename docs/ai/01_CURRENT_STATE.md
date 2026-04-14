
> RUNTIME NOTE: This file must not claim features as implemented unless 01_CURRENT_STATE.md confirms them. Only the runtime and endpoints listed below are actually implemented; all others are planned/target design.

# Current State Snapshot

Last updated: 2026-04-14 (CHK-R56/R57: dashboard pane system + order detail + booking_order_todos + showPane hotfix; deployed `02cec6b7`)

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
- Currency/runtime note: booking email dispatches (`dispatchBookingCreatedEmail`, `dispatchNewBookingAgentEmail`, `dispatchProofUploadedEmail`, `dispatchBookingConfirmedEmail`) now receive the tenant's `booking_currency` from D1 instead of `null`; `bookingEmails.js` `|| 'USD'` fallback is now only a safety net. Storefront formatter/invoice USD-primary legacy in non-email surfaces is still transitional.
- Routing: Hono `app.route()` for entity management + URLPattern `patterns[]` for stop/pricing routes in `index.js`
- All IDs: `nanoid()`, all queries: `prepare().bind()` with `WHERE tenant_id = ?`

### D1 Tables (repo migrations 0001–0050; local runtime verified against current dev DB, and remote production D1 verified through 0050; 0050 = booking_order_todos)
`tours`, `destinations`, `tour_destinations`, `destination_texts`, `tenants`,
`tour_stops`, `stop_accommodations`, `stop_meals`, `stop_guides`,
`stop_local_transports`, `stop_intercity_legs`, `stop_service_tasks`, `tasks`,
`tenant_seasons`, `pricing_segments`, `pax_bands`, `tour_prices`,
`booking_drafts`, `tenant_audit_log`, `booking_orders`, `booking_order_todos`, `site_templates`,
`tenant_universal_sites`, `tenant_universal_theme_tokens`, `tenant_universal_contacts`,
`tenant_universal_pages`, `tenant_universal_menu_items`, `tenant_universal_tour_pages`,
`tenant_universal_hotels`, `users`, `memberships`, `auth_sessions`, `password_reset_tokens`, `app_settings`,
`tenant_review_cases`, `tenant_risk_events`, `tenant_asset_inventory`, `tenant_asset_scan_results`

Key tenant columns: `subscription_status`, `custom_domain`, `payment_config_json`,
`total_revenue_tracked`, `commission_threshold`, `exchange_rate`, `target_currency` (secondary display currency storage),
`booking_currency`, `market_skin_key`, `primary_market`, `notification_config`, `payment_methods`, `subdomain`, `template_id`, `site_config`, `product_tier_key`,
`trust_status`, `public_indexing_enabled`, `custom_domain_verified_at`

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
- `POST /api/tenant/publish-site` now inherits the trust ladder and runs a lightweight abuse scan over tenant site content before publish; suspicious or blocked publish attempts open review cases, downgrade trust, disable indexing, and return structured review details instead of publishing
- `POST /api/tenant/publish-site` also rate-limits repeated publish attempts by trust tier, records `publish_attempt` / `publish_throttled` events in `tenant_risk_events`, and returns `429` before full publish work when behavior looks automated
- When Cloudflare AI is configured, publish-time moderation now also runs a second-pass scorer over normalized tenant content and merges that result with rule-based heuristics before deciding `ALLOW`, `REVIEW`, `BLOCK`, or `QUARANTINE`
- Admin ops can manually re-run AI moderation through `POST /api/admin/tenants/:id/moderate-ai`, and flagged moderation events can send Telegram alerts when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are configured
- `GET /api/admin/tenants/:id/broken-assets` scans five D1 JSON surfaces (`tours.content_data`, `tenant_universal_hotels.gallery_json`, `tenant_universal_tour_pages.content_override_json`, `tenant_universal_pages.blocks_json`, `tenants.site_config`) for dead `/api/tenant/assets/...` URLs; classifies each as `deleted`, `blocked`, `not_in_r2`, or `not_in_inventory_or_r2`; add `?check_r2=1` to also HEAD-check assets against TOUR_PAGES R2
- Sensitive tenant-editor routes now require a real authenticated tenant session in addition to tenant scoping, including template structure, publish readiness, config save, template switching, snippet loading, preview, soft publish, and publish flows
- `/api/tenant/pages` routes (pages.js: CRUD for universal site pages) are now in `PROTECTED_API_PREFIXES` — previously they only checked `X-Tenant-ID` with no session auth
- `POST /api/tenants/request-trust-upgrade` — PROBATION/PREVIEW_ONLY tenants can submit a review-case request for trust promotion; idempotent (7-day dedup); SUSPENDED/QUARANTINED receive 403; TRUSTED receive `already_trusted: true`
- `public/dashboard.html` custom-domain section is now visible to PROBATION and PREVIEW_ONLY operators (previously hidden until TRUSTED); shows a locked upgrade panel with the trust request button until TRUSTED status is reached
- `PATCH /api/tenant/config` now records a durable risk event, applies tenant-age/trust-aware save-rate scoring, runs rule + Cloudflare AI moderation on normalized site content, can open review cases, and can apply a soft trust hold that preserves editing while reducing public exposure
- `GET /api/tenant/assets` now merges R2 file listing with D1 asset-inventory metadata so tenant UIs can see moderation state, visibility, risk score, and reasons
- `POST /api/tenant/assets/upload` now computes SHA-256, applies upload velocity checks, runs rule-based asset scanning plus Cloudflare AI asset moderation, correlates cross-tenant asset reuse, stores inventory and scan results in D1, and blocks obviously malicious uploads such as active-content phishing SVGs before R2 persistence
- `GET /api/tenant/assets/:tenantId/:filename` now enforces asset visibility from D1 inventory, returning `404` for blocked/deleted assets and requiring an authenticated same-tenant session for `AUTHENTICATED_ONLY` assets
- `DELETE /api/tenant/assets/:filename` now marks the asset inventory row as deleted in addition to removing the underlying object

**Site Studio (CHK-R20 to R24/R29-R33)**
- `GET /:path` on custom subdomain/domain — `resolveTenantByHost()` + `serveSitePage()` HTMLRewriter pipeline

**Universal Site / Taxonomy Discovery (CHK-R35 to R45)**
- `GET /api/universal/site/config` — returns current universal site bundle, including runtime theme/menu/page data
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
- `POST /api/bookings/order` — legal firewall (ACTIVE only), server reprice, identity locked; snapshots `grand_total_amount` + `booking_currency`; returns `guest_portal_token`; `adult_triple_room_count` included in both pricing and `buildPaxSummary`; triggers `dispatchNewBookingAgentEmail` (guest identity hidden in email until agent confirms)
- `GET /api/bookings/orders` — agent order list; accepts `?status=` filter + `?limit=`; returns masked orders (tenant-scoped)
- `GET /api/bookings/order/:id` — agent view; `maskOrder` now also exposes `secure_token` and `price_snapshot_json`; guest fields `name/email/phone` are masked until `identity_unlocked = 1`
- `GET /api/bookings/order/:id/proof-url` — streams R2 proof image directly from `BOOKING_PROOFS` bucket with tenant-scope check; returns `Content-Type` from r2 `httpMetadata`; `Cache-Control: private, max-age=300`
- `POST /api/bookings/order/:id/proof` — stores to R2, moves order to `PROOF_UPLOADED`, keeps identity locked until confirm
- `POST /api/bookings/order/:id/confirm-receipt` — sets `identity_unlocked = 1`, increments `total_revenue_tracked`, writes `tenant_audit_log` row
- `GET /api/bookings/order/:orderId/todos?seed=1` — lists per-order service checklist todos; `?seed=1` auto-seeds one todo per `tour_stop` (formatted as `"Label (Day X–Y)"`) if table is empty for that order; all rows scoped by `tenant_id`
- `POST /api/bookings/order/:orderId/todos` — add a custom task (stop_id=NULL, sort_order=999) to an order's checklist
- `PATCH /api/bookings/order/:orderId/todos/:todoId` — toggle `done`/undone; sets `done_at` timestamp on mark-done or null on uncheck

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
- `public/templates/default.html` — tour page template with all placeholders
- `public/booking-widget.js` — full booking flow widget (CHK-R16)
- `public/widget.js` — lightweight embed widget (CHK-R19)
- `public/tour-config.html` — agent admin UI (CHK-R25/R26)
- `public/product-modules.html` — dedicated destination / hotel / gallery module manager distinct from quick skin editing
- `public/saas-admin.html` — protected editor for public pricing/marketing copy
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
- The public booking drawer now includes a customer-facing checkout step: guests can enter contact details, pick an available payment method sourced from public tenant config, create a booking order directly from the drawer, and receive a guest-portal follow-up link; when a tenant has no electronic gateway configured, the drawer automatically falls back to a `DEMO` checkout mode instead of hard-blocking the customer flow
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
- `npm test` / `npm run test:local` — Windows-runnable smoke flow: reconciles/applies local migrations, refreshes seed pricing data, ensures `ten-demo-001` is ACTIVE and booking-compliant with an enabled electronic gateway plus bank transfer, starts a dedicated Wrangler dev instance on `8790`, verifies tenant route boot health, Cloudflare AI fallback behavior, subdomain policy enforcement, asset moderation (safe SVG allow + malicious SVG block), task patch on `stop-001`, seeded pricing calculate for `tour-001` / `segment-standard`, booking proof + confirm + audit row end to end, and forgot-password request + signed webhook delivery + token validation + password reset + sign-in with the new password
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

### tour-config.html detail (CHK-R25/R26/R43)
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
- It starts a dedicated local Wrangler dev instance on port `8790` unless `SMOKE_BASE_URL` is provided explicitly

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
- Tenant creation seed packs: tours, hotels, galleries, destinations, and related decorative/runtime content should be normalized so a new tenant can be created with preloaded seed data and a chosen skin in one step
- Skin-aware tenant bootstrap/load flow: tenant chooses a skin, then matching seed content is loaded automatically rather than manually assembled after creation
- Calendar endpoints and reminder cadence
- Domain onboarding flow (automated DNS verification)
- Publish gate checklist endpoints
- Billing/invoicing status endpoints
- Growth/SEO API baseline
- Mobile ops surface
- Allotment / seat management (referenced in purge cron TODO)

## Present in code but not exercised in the 2026-03-30 local pass
- Site Studio live domain rendering and editor surface
- Tour publish / switch-template endpoints
- Public guest proof upload route
- Category management UI and routes
- External payment webhooks


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
