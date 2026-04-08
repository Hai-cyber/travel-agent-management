# Session Handoff Log

Purpose: end each session with a tiny handoff that reflects the **current rescue rebuild reality**, not the old system.

Rule:
If a capability existed only in the old repo/docs but is not rebuilt in the current repo, do not describe it as active.

---

## Handoff Template
Date:
Checkpoint:
Goal of session:
What was completed:
Files changed:
What is still not done:
Known risks / TODOs:
Suggested next prompt:

---

## Latest Handoff
Date: 2026-04-08
Checkpoint: CHK-R48 — Product Modules catalog architecture (destinations + hotels + junction tables)
Goal of session: Decouple destinations and hotels from tours into reusable catalog tables with junction links. Replace inline hotel cards in Tour Content with catalog pickers.

### What was completed

**DB migration** (`scripts/migrate-catalog-tables.sql`) applied to production D1:
- `tenant_destinations` — standalone destination catalog per tenant (name, description, region, gallery_json, status, sort_order)
- `tour_destination_links` — M:N junction between tours and destinations (sort_order)
- `tour_hotel_links` — M:N junction between tours and hotels (nights, sort_order)

**API routes** added to `src/routes/universalSites.js`:
- `GET/POST /api/universal/destinations` — destination catalog CRUD
- `GET/PATCH/DELETE /api/universal/destinations/:id`
- `GET/POST /api/universal/tours/:tourId/destination-links`
- `DELETE /api/universal/destination-links/:id`
- `GET/POST /api/universal/tours/:tourId/hotel-links` (with `nights` field)
- `PATCH/DELETE /api/universal/hotel-links/:id`

**Product Modules UI** (`public/product-modules.html`):
- "Properties" tab renamed to "Hotels"; removed "Linked Tour" dropdown from hotel editor
- Destinations tab now manages `tenant_destinations` catalog (name, region, description, gallery, status/delete support)
- State extended with `destinations[]`, `selectedDestinationId`, `currentDestination`
- `loadSourceData()` now fetches `/api/universal/destinations` alongside tours/hotels
- `createDestinationModule()` POSTs to new catalog endpoint (no longer creates a ghost tour)
- `saveDestinationModule()` PATCHes catalog endpoint with gallery-url textarea serialization
- `saveHotelModule()` / `createHotelModule()` no longer send `tour_id`

**Tour Content** (`public/tour-config.html`):
- Inline hotel add form replaced by **Linked Destinations** + **Linked Hotels** catalog picker sections
- `loadCatalogs()` fetches hotel + destination catalogs on page load and populates `<select>` dropdowns
- `loadTourLinks(tourId)` called on `selectTour()` — fetches both link lists and renders inline lists
- `renderLinkedHotels()` / `renderLinkedDestinations()` — show linked items with unlink (×) button
- `btn-link-hotel` / `btn-link-dest` — POST to junction endpoints with `nights` field for hotels
- Legacy `renderHotelCards()` / `btn-add-hotel` inline form removed

**Sync** (`src/lib/universalSiteSync.js`):
- Hotel slide source changed from `WHERE tour_id = ?` to `JOIN tour_hotel_links` (junction-first)
- Backward-compat fallback: if no junction links exist, legacy `tour_id`-linked hotels are used

### Files changed
```
scripts/migrate-catalog-tables.sql    (new)
src/routes/universalSites.js          (new routes + normalizeDestination)
src/lib/universalSiteSync.js          (junction-first hotel query + legacy fallback)
public/product-modules.html           (Destinations catalog tab, Hotels renamed, no tour_id)
public/tour-config.html               (catalog pickers replace inline hotel form)
```

### What is still not done
- Destinations tab in Product Modules has no taxonomy/interest tagging (intentionally deferred)
- `tour_destination_links` data is not yet consumed by sync (destinations don't appear in tour page blocks yet — use `content_data.destination_*` fields for now)
- Tour Content UI: destination link sort_order reordering and hotel link nights editing are not yet exposed (links are created in order, nights editable only at link time)

### Known risks / TODOs
- `tenant_destinations` gallery is stored as JSON array `[{id,src,alt,caption}]` matching hotel gallery format
- Backward-compat: all existing hotel rows with `tour_id` still work via sync fallback — no data migration needed
- New hotels created via Product Modules no longer receive `tour_id`; this is intentional

### Suggested next prompt
"Surface linked destinations in the tour sync, so the tour page shows a destinations carousel similar to the hotel carousel. Use `tour_destination_links JOIN tenant_destinations` the same way hotels are now queried."

---
Goal of session: Implement `GET /api/admin/tenants/:id/broken-assets` and record the interrupted 2026-04-07 anti-abuse session.

### What was completed this session

- Added `GET /api/admin/tenants/:id/broken-assets` to `src/routes/admin.js` (admin-secret protected)
  - Scans **five D1 surfaces** for `/api/tenant/assets/{tenantId}/...` URL patterns:
    `tours.content_data`, `tenant_universal_hotels.gallery_json`,
    `tenant_universal_tour_pages.content_override_json`, `tenant_universal_pages.blocks_json`,
    and `tenants.site_config`
  - Bulk-loads the tenant's full `tenant_asset_inventory` in one query and classifies URLs as
    `deleted`, `blocked`, `not_in_r2`, or `not_in_inventory_or_r2`
  - Accepts `?check_r2=1` to HEAD-check each URL against TOUR_PAGES R2 for deep validation of
    untracked or inventory-live assets
  - Returns structured report: `broken[]` with reason + inventory state + references per surface,
    and `live[]` with optional notes for untracked assets
  - [SEC] tenantId sourced from URL param only, never from request body; protected by admin middleware

### Files changed
```
src/routes/admin.js
docs/ai/04_SESSION_HANDOFF.md
```

---

## Formal 2026-04-07 Handoff (written retroactively)
Date: 2026-04-07
Checkpoint: Tenant anti-abuse phase 1 + Cloudflare AI moderation pivot
Goal of session: Ship subdomain abuse-review policy, tenant trust ladder enforcement, and switch AI moderation from Gemini to Cloudflare AI.

### What was completed
- Fixed `scripts/smoke-local.mjs`: added `fetch failed` retry logic (3 attempts: 250 ms / 750 ms / 1500 ms) and accepted `webhook` or `log_only` as valid password-reset delivery modes so local smoke passes on Windows again
- Added `src/lib/subdomainPolicy.js`:
  - 3–63 character platform subdomains with strict character validation
  - Reserved group blocking (marketing, commercial, product, operations, technical namespaces)
  - Phishing-sensitive keyword detection (auth, finance, government, payment categories)
  - High-entropy label heuristic (random-looking subdomains sent to manual review)
  - Protected finance-brand similarity check
  - Webhook alerting via `SUBDOMAIN_REVIEW_WEBHOOK_URL` with `SUBDOMAIN_REVIEW_WEBHOOK_SECRET`
  - Brand-safe suggestion suffixes returned to tenants on rejection
- Added `db/migrations/0040_tenant_trust_and_review.sql`:
  - `trust_status`, `public_indexing_enabled`, `custom_domain_verified_at` columns on tenants
  - `tenant_review_cases` table for durable review audit trail
  - `tenant_risk_events` table for silent abuse-risk ledger
  - `tenant_asset_inventory` and `tenant_asset_scan_results` tables for asset moderation
- Enforced trust ladder at runtime: `PREVIEW_ONLY → PROBATION → TRUSTED → SUSPENDED/QUARANTINED`
  - New tenants start `PREVIEW_ONLY`; clean first subdomain claim auto-promotes to `PROBATION`
  - Probation sites forced `noindex`; custom domains only resolve after `TRUSTED` + domain verified
  - Publish now runs content-abuse scan, rate-limits by trust tier, and returns `429` on automated behavior
- Pivoted AI moderation from Gemini to Cloudflare AI in `src/lib/aiModeration.js`:
  - Prefers Workers `AI` binding, falls back to Cloudflare REST credentials
  - Same normalized moderation contract (`ALLOW`, `REVIEW`, `BLOCK`, `QUARANTINE`)
  - Telegram alert support via `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
- Remote D1 migration `0041` applied and verified on production

### Files changed
```
db/migrations/0040_tenant_trust_and_review.sql
src/lib/subdomainPolicy.js
src/lib/aiModeration.js
src/lib/trustAbuse.js
src/routes/tenants.js
src/routes/onboarding.js
src/index.js
scripts/smoke-local.mjs
docs/ai/01_CURRENT_STATE.md
docs/ai/03_PROGRESS_LEDGER.md
```

### What was still not done at session end
- No admin diagnostic for broken asset URLs persisted in D1 (fixed 2026-04-08)
- Dead asset URLs from pre-2026-04-06 deletes still not bulk-swept
- Product-modules gallery still requires explicit Save after image pick
- No formal handoff was written (written retroactively 2026-04-08)

### Known risks / TODOs
- `DELETE /api/tenant/assets/:filename` cleanup still only sweeps `tours.content_data`; other surfaces (`tenant_universal_pages`, `tenant_universal_hotels`, `site_config`) require a separate pass or the new admin diagnostic to surface then manually repair
- Existing tenants may still carry pre-cleanup dead asset references; use `GET /api/admin/tenants/:id/broken-assets` to identify them before building automated repair scripts
- Trust-ladder enforcement changes affect existing paying tenants if their `trust_status` is `NULL`; NULL is treated as `PREVIEW_ONLY`, so operators added before the migration may be unexpectedly restricted

### Suggested next prompt
```
Run GET /api/admin/tenants/ten-demo-001/broken-assets?check_r2=1 against local dev to verify
the diagnostic returns correct results, then plan a bulk-repair pass for any dead asset URLs
discovered across tour content_data and other surfaces.
```

---

## Latest Handoff (pre-2026-04-08)
Date: 2026-04-06
Checkpoint: Tenant media preview root-cause repair
Goal of session: restore reliable tenant-uploaded image preview/render paths, support exact `1-1` pax bands live, and stop deleted tenant assets from leaving dead gallery references behind in product modules.

### What was completed this session

- Applied and verified remote D1 migration `0039_allow_exact_pax_band_ranges.sql`, so production `pax_bands` now allow exact ranges such as `1-1`
- Added room-based child-capacity validation to pricing (`1 child per shared double room`, `2 children per private room`) and re-ran the local pricing smoke until the pricing section passed again
- Deployed the pricing fix to production and verified live `1-1` pax-band creation on a real production tenant instead of the non-existent demo tenant
- Traced the tenant-media preview failure to the preview optimizer layer: same-origin `/api/tenant/assets/...` URLs were healthy, but wrapping them in `/cdn-cgi/image/...` produced `404`, so uploaded photos could exist without rendering in compact previews
- Patched `public/product-modules.html`, `public/universal-admin.html`, and `src/routes/universalSites.js` so tenant asset API URLs bypass `cdn-cgi/image` and render through their raw asset URLs instead
- Added stronger product-modules media tooling: inline broken-image placeholders, live gallery preview, tenant-gallery delete buttons, and open-form cleanup that clears dead asset references from visible fields immediately after delete
- Hardened backend delete semantics in `src/routes/tenants.js`: deleting a tenant asset now also removes stale references from tour `content_data` (`gallery_images`, `home_gallery_images`, `hero_image`, `destination_image`) so product modules and storefront renders do not keep pointing at `404` URLs
- Fixed the first backend cleanup implementation after production logs exposed a D1 `LIKE or GLOB pattern too complex` failure on filenames containing wildcard characters; cleanup now scans tenant tours by `tenant_id` and filters matches in JS instead of using SQL `LIKE`
- Repaired the affected production tenant record during debugging so `Hanoi -Halong` no longer points at the dead `WT32mjC3s0o-.png` gallery URL

### Files changed
```
db/integrity_check_pricing.sql
db/migrations/0004_add_pricing_foundation.sql
db/migrations/0039_allow_exact_pax_band_ranges.sql
docs/ai/03_PROGRESS_LEDGER.md
docs/ai/04_SESSION_HANDOFF.md
public/product-modules.html
public/universal-admin.html
scripts/smoke-local.mjs
src/routes/pricing.js
src/routes/tenants.js
src/routes/universalSites.js
```

### What is still not done
- The full local smoke suite is not completely green yet because password-reset smoke remains flaky/unrelated outside the pricing/media scope
- Product-modules gallery flow still relies on the operator to save the module after choosing new images; upload alone does not rewrite persisted `content_data` until save is clicked
- There is still no automated production sweep for old dead tenant asset URLs that predate the new delete cleanup behavior

### Known risks / TODOs
- Existing tenants can still have old dead asset URLs in D1 from before the cleanup patch; those records must be resaved or cleaned manually once discovered
- Any future frontend helper that re-wraps `/api/tenant/assets/...` in `cdn-cgi/image` will reintroduce the same preview failure, so tenant asset URLs should stay on the raw path unless the delivery architecture changes
- `DELETE /api/tenant/assets/:filename` currently cleans tour content only; if future tenant-managed assets are persisted in other D1 JSON surfaces, the cleanup sweep must be expanded intentionally

### Suggested next prompt
```
Audit the remaining tenant-media surfaces for stale asset references, then add a small admin diagnostic that lists broken `/api/tenant/assets/...` URLs still persisted in D1 so operators can repair them without raw SQL.
```

---

Date: 2026-04-05
Checkpoint: CHK-R46 tenant booking currency + market skin foundation
Goal of session: Lock the new product direction for tenant-controlled storefront currency and market skins, then ship the first real runtime slices for booking currency settings, quote/order snapshots, and market-skin catalogs.

### What was completed this session

- Added a dedicated architecture note at `docs/ai/28_MULTI_CURRENCY_AND_MARKET_SKINS.md` to lock the product direction: code stays English, tenant storefront currency should be tenant-controlled, and market skins should bundle language/currency/copy defaults
- Updated the AI docs so `00_AI_INDEX.md`, `01_CURRENT_STATE.md`, `03_PROGRESS_LEDGER.md`, and `14_TENANCY_AND_BILLING.md` now reflect the same multi-currency / market-skin direction
- Added `src/lib/tenantMarketCatalog.js` with the curated tenant storefront currency basket: `USD`, `EUR`, `VND`, `CNY`, `JPY`, `KRW`, `GBP`, `AUD`, `SGD`, `THB`
- Added `src/lib/marketSkins.js` with curated market presets such as `global-default`, `vietnam-domestic`, `china-outbound`, `japan-premium`, `korea-premium`, `uk-curated`, and `australia-outbound`
- Opened tenant settings for `booking_currency`, `default_locale`, `market_skin_key`, and `primary_market`, while still exposing curated runtime catalogs for currencies, market skins, and UI locales
- Added `db/migrations/0037_tenant_booking_currency_and_market_skin.sql` to introduce tenant booking-currency fields and booking draft/order snapshot columns
- Changed pricing calculate responses so authoritative totals now use tenant `booking_currency`, while older compatibility fields remain present during the migration period
- Changed booking drafts and booking orders so they now snapshot authoritative amount/currency/base-currency/rate fields alongside legacy USD compatibility fields
- Added a public `GET /api/auth/market-skins` catalog and wired signup to submit `market_skin_key` for both email and Google onboarding
- Updated onboarding + starter bootstrap so a selected market skin now sets tenant defaults (`booking_currency`, `default_locale`, `primary_market`), starter universal site variant, and starter seed language/currency context
- Expanded `public/universal-admin.html` System Panel so operators can edit `market_skin_key`, `booking_currency`, and `default_locale` through `/api/tenants/settings` without leaving Website Design
- Added real locale packs for `ja`, `ko`, `en-GB`, and `en-AU`, and upgraded `/api/i18n` locale resolution so Accept-Language can hit those exact variants instead of collapsing to base English
- Expanded locale coverage further with real packs for `de`, `fr`, and `es`, and added EUR market presets for Germany, France, and Spain to the shared market-skin catalog
- Hardened local runtime diagnostics: smoke now checks tenant route mounts immediately after Worker boot, and dashboard startup no longer produces a misleading early `404 /api/tenant/config` before tenant context exists
- Fixed pricing overlap semantics so season priority comes from `tenant_seasons.sort_order` rather than raw price magnitude, seeded an explicit High/Low overlap window, added smoke coverage for the overlap rule, and updated booking/pricing UI so `Good to know` follows `Grand total` while `Check availability` shows a minimum-price teaser with canonical pricing copy
- Replaced the earlier child-cap ratio with a room-based rule: each shared double room allows 1 child and each private room allows 2 children; admin/public booking UIs and backend pricing now enforce the same rooming-capacity warning, and smoke covers both reject and allow paths
- Clarified money semantics in runtime and docs: `booking_currency` is storefront truth, while `target_currency` survives only as storage for optional `secondary_display_currency`
- Extended locale catalogs and the `public/tour-config.html` pricing display currency selector so admin-facing pricing work can already use the expanded currency basket

### Files changed
```
docs/ai/00_AI_INDEX.md
docs/ai/01_CURRENT_STATE.md
docs/ai/03_PROGRESS_LEDGER.md
docs/ai/04_SESSION_HANDOFF.md
docs/ai/14_TENANCY_AND_BILLING.md
docs/ai/28_MULTI_CURRENCY_AND_MARKET_SKINS.md
db/migrations/0037_tenant_booking_currency_and_market_skin.sql
db/migrations/0038_max_children_per_two_adults.sql
src/lib/marketSkins.js
src/lib/tenantMarketCatalog.js
src/index.js
src/locales/en-au.json
src/locales/en-gb.json
src/locales/de.json
src/locales/es.json
src/locales/fr.json
src/locales/ja.json
src/locales/ko.json
src/lib/tenantBootstrap.js
src/lib/universalSiteSync.js
src/routes/bookings.js
src/routes/onboarding.js
src/routes/pricing.js
src/routes/tenants.js
src/utils/formatter.js
src/locales/en.json
src/locales/vi.json
src/locales/zh.json
public/signup.html
public/tour-config.html
public/universal-admin.html
public/dashboard.html
public/tour-booking-view.js
public/booking-view-core.js
scripts/smoke-local.mjs
src/routes/universalSites.js
src/lib/universalSite.js
db/seed_test.sql
```

### What is still not done
- Full removal of USD-centric compatibility fields is not finished yet (`grand_total_usd`, older formatter helpers, older enriched price fields still exist for compatibility)
- The new locale packs are real and exact-matchable now, but they still rely on English fallback for untouched long-tail admin/runtime strings rather than having 100% translated coverage
- The product still needs a deliberate decision on whether secondary display currency should appear broadly on storefront pages or only in selected quote/invoice surfaces

### Known risks / TODOs
- `target_currency` is now semantically pinned as secondary display currency storage; future cleanup should decide whether the legacy column is renamed in schema or simply preserved behind the clearer API alias forever
- `total_revenue_tracked` is still a single numeric tenant field without explicit revenue currency metadata; if the product later supports real finance reporting across multiple booking currencies, that field needs a clearer accounting model
- The smoke suite currently validates success-state behavior, not the full new locale and quote/order currency payload contracts, so API-level assertions for exact locale resolution, `booking_currency`, `grand_total_amount`, and `secondary_display_currency` should be added next

### Suggested next prompt
```
Push the new locale and money semantics into customer-facing storefront surfaces: decide where secondary display currency should appear, extend translated coverage for the new locale packs, and add API smoke assertions for exact locale resolution plus booking/secondary display currency payloads.
```

---

Date: 2026-04-04
Checkpoint: Architecture clarification follow-up
Goal of session: Lock the terminology and tenancy direction for future standalone hospitality expansion so the repo no longer mixes tour accommodation with a future hotel/property engine.

### What was completed this session

- Added a dedicated architecture note at `docs/ai/26_PROPERTY_ENGINE_AND_STAFF_SEATS.md`
- Locked the naming split between:
  - tour side: `tour`, `tour_stop`, `stop_accommodation`
  - future hospitality side: `property`, `property_reservation`, `property_inventory`, `property_staff`
- Recorded the tenancy decision that staff login should be modeled as add-on seats/memberships inside a tenant, not as separate tenants
- Clarified that current `tenant_universal_hotels` usage remains transitional runtime/storytelling support and is not the canonical future hospitality engine
- Updated AI docs so `00_AI_INDEX.md`, `01_CURRENT_STATE.md`, and `14_TENANCY_AND_BILLING.md` all reflect the same concept boundary

### Files changed
```
docs/ai/00_AI_INDEX.md
docs/ai/01_CURRENT_STATE.md
docs/ai/14_TENANCY_AND_BILLING.md
docs/ai/26_PROPERTY_ENGINE_AND_STAFF_SEATS.md
docs/ai/04_SESSION_HANDOFF.md
```

### What is still not done
- No property engine schema has been implemented yet
- No property availability / reservation / POS / staff-assignment tables exist yet
- Current hotel UI/runtime still remains transitional and tour-adjacent only

### Known risks / TODOs
- Future contributors may still over-interpret `tenant_universal_hotels` as a canonical hotel engine unless the new property-domain note is read first
- Staff-seat pricing and limits are still a design direction only; no runtime enforcement exists yet
- Property-scoped RBAC has not been designed in schema form yet, only conceptually approved

### Suggested next prompt
```
Write a migration-safe schema proposal for the first `property` domain slice, including `property`, `property_staff_assignment`, and the minimum reservation/availability tables, without touching the current tour pricing engine.
```

---

Date: 2026-04-04
Checkpoint: CHK-R39 / CHK-R43 follow-up
Goal of session: Stabilize tenant-media authoring flows in the admin UIs, replace tour-only CTA wording with shared intent-based defaults, and repair the resulting storefront regression on production.

### What was completed this session

- Reworked media authoring in `public/tour-config.html` and `public/product-modules.html` around a tenant-gallery-first picker so operators can upload from local drive or reuse tenant-hosted images without pasting raw URLs by hand
- Added explicit media ownership behavior: gallery images stay gallery-level unless deliberately assigned to hero/destination/accommodation, module-level remove buttons clear only that module field, and gallery remove buttons delete only the selected gallery entry
- Added local upload guards for image size/dimensions and switched admin previews to optimized image URLs with local-dev fallback so previews remain fast without breaking local rendering
- Shrunk compact gallery previews in `product-modules.html` so agents can scan many images in one screen, while keeping larger previews intact for module-level editing contexts
- Introduced shared CTA intent defaults in the universal site layer: `Explore` for discovery, `Check availability` for booking, and `Contact us` for contact
- Replaced legacy tour-only fallback copy (`I like this tour`) in universal blueprint defaults, sync snapshot fallback, runtime booking slot rendering, and editor schema with the new CTA-intent system
- Forced universal hero behavior by context: home/listing hero CTAs now resolve to tenant-aware public listing paths, while `tour_detail` hero CTAs now resolve to booking intent and `#booking-engine`
- Fixed a production `Internal Server Error` introduced during the CTA refactor: `renderPublicHtml()` referenced `buildPageHref` / `headerPrimaryPageKey` before initialization, so the live fix moved CTA path helpers before hero rendering and redeployed production successfully

### Files changed
```
public/tour-config.html
public/product-modules.html
src/lib/universalSite.js
src/lib/universalSiteSync.js
src/routes/universalSites.js
src/lib/themes/six-senses.js
docs/ai/01_CURRENT_STATE.md
docs/ai/03_PROGRESS_LEDGER.md
docs/ai/04_SESSION_HANDOFF.md
```

### What is still not done
- Remote URL image validation is still weaker than local upload validation; true remote size/dimension enforcement still needs a backend metadata/proxy check
- Contact-intent CTA is defined at schema/runtime level, but only a subset of storefront CTA surfaces currently consume the shared resolver
- Media picker / preview logic is still duplicated across `tour-config.html` and `product-modules.html`; it is not yet extracted into a shared frontend module

### Known risks / TODOs
- Future CTA edits must respect render ordering inside `renderPublicHtml()`; helper values needed by hero render should be defined before any block render path runs, otherwise Worker-side `ReferenceError` regressions can surface as production `500`s
- Wrangler still warns that multiple environments exist when deploy is run without an explicit `--env`; deployments are succeeding, but explicit target selection should be standardized before the next risky rollout
- Admin media preview performance is improved, but storefront/public image optimization should still be reviewed separately so public delivery follows the same safety/performance rules without relying on admin-only assumptions

### Suggested next prompt
```
Extract the duplicated tenant-media picker / preview / remove behavior from `public/tour-config.html` and `public/product-modules.html` into a shared frontend module, then add backend validation for remote image URLs so pasted external images are checked before they enter tenant-managed content.
```

---

Date: 2026-04-04
Checkpoint: CHK-R45 taxonomy discovery foundation
Goal of session: Build the first production-grade foundation for taxonomy-first discovery so interests drive auto-generated collection pages instead of relying on free-form page building.

### What was completed this session

- Added `db/migrations/0036_interest_taxonomy_foundation.sql` with tenant-scoped discovery profiles and interest-tag mapping tables for tours and destinations, plus universal interest-page state
- Added `src/lib/interestTaxonomy.js` as the canonical taxonomy layer with fixed top-level interests (`adventure`, `culture`, `beach`, `sport`, `food`, `nature`), planned sub-interests, payload validation, and auto-page scaffolding helpers
- Extended `src/routes/universalSites.js` so universal site runtime now builds `interest_runtime` collections and resolves listing bindings of the form `taxonomy.interest.<interest>.tour_listing`
- Added protected taxonomy endpoints for catalog lookup and tenant-scoped tagging: `GET /api/universal/taxonomy/catalog`, `GET /api/universal/taxonomy/interest-pages`, `GET|PUT /api/universal/taxonomy/tours/:tourId`, and `GET|PUT /api/universal/taxonomy/destinations/:destinationId`
- Added auto-generated interest collection pages into the existing `tenant_universal_pages` pipeline instead of building a second page engine; these pages are scaffolded as standard pages and become visible once enough tours carry a matching top-level interest tag
- Surfaced taxonomy editing directly inside unit-level authoring flows: `public/tour-config.html` now edits tour interests in the Content tab, and `public/product-modules.html?mode=destinations` now edits destination-source taxonomy on the canonical backing tour record
- Replaced the Six Senses hero search mock with a real destination-or-interest search flow: the first field is wider, submits to the tours listing page, and filters listing cards by destination text plus taxonomy tags already assigned to tours
- Locked overwrite-oriented universal bootstrap persist by default: `POST /api/universal/site/bootstrap` now requires explicit overwrite confirmation before it can rewrite a tenant scaffold, and the manual universal API test skips destructive persist mode unless opted in
- Added a second Six Senses-derived luxury variant (`tour-luxury-riviera`) with different preset imagery, theme colors, and typography, and rewired `public/universal-admin.html` so operators choose among real luxury variants instead of a single hardcoded sample label
- Verified that the existing local smoke suite still passes unchanged after the taxonomy foundation landed

### Files changed
```
db/migrations/0036_interest_taxonomy_foundation.sql
src/lib/interestTaxonomy.js
src/routes/universalSites.js
public/tour-config.html
public/product-modules.html
public/universal-admin.html
src/lib/universalSite.js
src/lib/themes/six-senses.js
scripts/reset_local_six_senses_preset.mjs
docs/ai/01_CURRENT_STATE.md
docs/ai/22_INTEREST_TAXONOMY_AND_COLLECTIONS.md
docs/ai/03_PROGRESS_LEDGER.md
docs/ai/04_SESSION_HANDOFF.md
```

### What is still not done
- Search/ranking still does not consume taxonomy; the current build covers schema, APIs, auto-generated collection pages, and the first unit-level authoring surfaces only
- Search now consumes destination text and taxonomy tags for the storefront tours flow, but there is still no broader faceted search or ranking model yet
- True standalone destination-entity editing UI is still missing; current destination workflow applies taxonomy through destination-source modules backed by tours
- Destination-tag data is stored and retrievable, but current auto-generated interest pages are still driven by tour tags rather than destination-led page sections

### Known risks / TODOs
- Auto-generated interest pages are intentionally scaffolded into the existing universal page pipeline, so later manual editing rules need a clear policy for which fields remain system-owned versus curator-owned
- The first runtime binding only targets `tour_listing` by top-level interest; sub-interest pages, score-driven ordering, and facet search still need separate implementation work
- Production rollout gap was real: live universal schema loading failed until remote D1 migration `0036_interest_taxonomy_foundation.sql` was applied. The storefront schema now loads on production, but the full `choose skin` reset flow still needs a separate pass if further runtime errors appear.

### Suggested next prompt
```
Now that production D1 migration 0036 is applied and universal site config loads again, continue tracing the remaining `choose skin` reset flow on the real production tenant and isolate the next backend failure before changing more UI code.
```

---

Date: 2026-04-02
Checkpoint: Multi-skin storefront preservation + Website Design handoff
Goal of session: Preserve the real storefront direction in code and docs: save Six Senses as the first skin module, keep the runtime multi-skin-ready, expand Website Design system settings, and record the future seed-by-skin tenant workflow.

### What was completed this session

- Preserved the runtime multi-skin storefront architecture under `src/lib/themes/`, with `src/lib/themes/six-senses.js` saved as the first committed storefront skin module and `src/lib/themes/index.js` acting as the resolver/registry
- Kept Six Senses as the actual storefront truth by aligning the `tour-luxury` baseline, active theme resolution, preview-first render pipeline, and Website Design admin around that shell
- Expanded Website Design system settings so the panel now controls much more of the storefront chrome and behavior: header toggles, hero toggles, floating CTA/contact controls, footer/social visibility, menu-tab visibility, logo/fonts/colors, page visibility, and broader contact settings
- Cleaned the dashboard path so older Design Website / Visual Editor / Site Studio clutter is removed in favor of Website Design, System Settings, and Tours & Pricing flows
- Saved the future architecture direction in docs: more skins are planned, tenants will choose different skins, and tenant creation should eventually preload normalized seed packs for tours, hotels, galleries, destinations, and related storefront data based on that chosen skin

### Files changed
```
src/lib/themes/index.js
src/lib/themes/six-senses.js
src/lib/universalSite.js
src/lib/universalSiteSync.js
src/routes/universalSites.js
public/universal-admin.html
public/dashboard.html
public/tour-config.html
db/migrations/0031_universal_hotels.sql
scripts/backfill-universal-luxury.mjs
docs/ai/01_CURRENT_STATE.md
docs/ai/03_PROGRESS_LEDGER.md
docs/ai/04_SESSION_HANDOFF.md
CURRENT_STATE_EXPORT.md
```

### What is still not done
- Additional storefront skins beyond Six Senses are not implemented yet
- Tenant creation does not yet auto-load normalized seed packs by selected skin
- Seed normalization for tours, hotels, galleries, destinations, and related storefront content is still a planned next build step

### Known risks / TODOs
- The runtime is now multi-skin-ready in structure, but only one real skin module exists today; future skins should follow the same registry/module contract instead of hard-coding variant behavior back into the route layer
- Seed data is still split between canonical tour records, temporary hotel records, and universal runtime projections; tenant-bootstrap automation should only be built after those seed packs are normalized cleanly
- Temporary hotel storage is intentionally transitional and may be replaced once canonical hotel/domain modeling is formalized

### Suggested next prompt
```
Build the next storefront skin module under src/lib/themes/, then design a seed-pack system so tenant creation can choose a skin and automatically preload tours, hotels, galleries, destinations, and matching storefront content in one flow.
```

---

Date: 2026-03-26
Checkpoint: CHK-R36 + CHK-R36b
Git commits: `4e38506`, `2d14b0b` on branch `rescue-minimum`
Goal of session: Redesign the Price Config tab in `public/tour-config.html` to show a customer-facing Booking View (segment tiers, per-pax-type qty controls, live price calculator) instead of the flat admin grid; then add full CRUD for seasons and segments.

### What was completed this session

**CHK-R36 — Price Config tab: Customer Booking View**
- `public/tour-config.html` — replaced 3-column admin grid with:
  - **Booking View card** (top): segment tier buttons (auto-select first on load), 4-row pax table (Adult Shared Room, Adult Private Room, Child with parents, Infant) with ±qty steppers and unit price / subtotal columns, travel date input (triggers `POST /api/pricing/calculate` for season-aware total + footnote showing applied season + pax band)
  - **Collapsible admin `<details>`** (bottom): 2-col grid Seasons + Pax Bands; Segments; Tour Prices table. All existing IDs preserved.
  - New CSS: `.seg-tab`, `.seg-tab.active`, `.qty-wrap`, `.qty-btn`, `.qty-val`

**CHK-R36b — Season/Segment full CRUD + editable dates**
- Season dates (start/end month+day) now render as 4 editable `<input type="number">` fields — each fires `PATCH /api/pricing/tenant-seasons/:id` on blur
- **Add Season form**: Name + from month/from day/to month/to day → `POST /api/pricing/tenant-seasons`
- **Add Segment form**: Label + Code (auto-uppercased) → `POST /api/pricing/pricing-segments`
- Both season and segment rows already had delete (`×`) buttons from previous session
- Fixed `updatePricingItem` to correctly handle numeric field values

### Files changed
```
public/tour-config.html   (+264 -76 CHK-R36; +70 -7 CHK-R36b)
docs/ai/03_PROGRESS_LEDGER.md
docs/ai/01_CURRENT_STATE.md
docs/ai/04_SESSION_HANDOFF.md
```

### What is still not done / testing in progress
- Agent has not finished testing the Price Config tab in the running dev server — visual verification partially done, full CRUD flow (add season, add pax band, add segment, add tour price, run calculate) still pending
- `wrangler dev` runs on port 8787; ensure it is running before testing: `npx wrangler dev`
- Apply local migrations if needed: `npx wrangler d1 migrations apply travel_agent_db --local`

### Known risks
- Season date PATCH sends values as strings from `<input type="number">`; backend `coerceNumeric()` handles the int conversion — verify on first edit
- `POST /api/pricing/calculate` requires an existing tour price row matching the selected segment + date's season + pax count band; if no matching row, fallback total is shown (raw sum from base price row)
- Segment tabs auto-select the first segment on `loadPricing()` — if the tenant has no segments yet, the tab area shows a help message pointing to the Manage section

### Suggested next prompt
```
Read:
1. docs/ai/01_CURRENT_STATE.md
2. docs/ai/03_PROGRESS_LEDGER.md

Open http://localhost:8787/tour-config.html
Connect with tenant ten-demo-001, select a tour.
Go to Price Config tab and test:
1. Add a season (name, dates)
2. Add a segment (label, code)
3. Add a pax band
4. Add a tour price row linking them
5. In Booking View, select the new segment, set qty, pick a travel date → verify grand total appears
6. Delete a season and a segment — confirm loadPricing() refreshes cleanly

If all pass, CHK-R36 is DONE. Proceed to the next planned feature.
```

---

## Handoff Archive

### 2026-03-26 — CHK-R18 + CHK-R19
Date: 2026-03-26
Checkpoint: CHK-R18 + CHK-R19
Git commit: `0583b86` on branch `rescue-minimum`
Goal of session: Implement bank transfer order system with identity lock, proof upload, revenue tracking, scheduled purge; then add Guest Portal (token-gated) and Booking Widget v1.

What was completed: `booking_orders` table, 4 order endpoints, `purgeExpiredOrders` cron, `secure_token` migration, `GET/POST /api/bookings/public/:token`, `public/widget.js` embed widget, test suite `test/test_booking_orders.sh`.

Files changed: `src/routes/bookings.js`, `db/migrations/0016_booking_orders.sql`, `db/migrations/0017_booking_order_token.sql`, `public/widget.js`, `wrangler.jsonc`, `src/index.js`, `test/test_booking_orders.sh`
