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
Date: 2026-04-04
Checkpoint: Public Booking View follow-up
Goal of session: Finish the storefront `Check availability` flow so it uses the real tour pricing behavior, matches the active storefront skin better, and leaves explicit payment hooks for the next integration step.

### What was completed this session

- Replaced the failed storefront CTA wiring experiments with a dedicated public Booking View script at `public/tour-booking-view.js`
- Mirrored the core Booking View behavior from `public/tour-config.html`: conversational sentence inputs, room auto-suggestion, room validation, segment tier tabs, local row-based total calculation, and API-backed season/band labeling
- Wired `Check availability` so desktop opens the Booking View in a sidebar and mobile navigates to the tenant booking page with the same view rendered inline for the selected tour
- Restyled the public Booking View so it uses the active storefront theme tokens/chrome more naturally instead of looking like an unrelated utility panel
- Added future payment-flow handoff hooks: the payment CTA now keeps `data-payment-*` attributes, and the booking view emits `travelagent:public-booking-quote-ready` plus `travelagent:public-booking-payment-intent`

### Files changed
```
public/tour-booking-view.js
src/routes/universalSites.js
src/lib/themes/six-senses.js
docs/ai/01_CURRENT_STATE.md
docs/ai/03_PROGRESS_LEDGER.md
docs/ai/04_SESSION_HANDOFF.md
```

### What is still not done
- The reserved payment CTA does not submit into a checkout/order flow yet; it only exposes a clean handoff surface
- Public Booking View copy is still hardcoded in English today; it is not yet moved into the shared locale catalog
- The visual polish is improved and theme-aware, but it is still a dedicated booking surface rather than a full skin-specific bespoke component per luxury variant

### Known risks / TODOs
- Future payment integration should consume the emitted booking events / `data-payment-*` payload and avoid re-parsing numbers from rendered text
- If the booking calculation rules change in `public/tour-config.html`, the storefront projection in `public/tour-booking-view.js` must be kept aligned intentionally; there is no shared extracted module yet
- Mobile currently relies on the tenant booking page inline render path; if booking page visibility/routing changes later, the mobile CTA path must be re-verified

### Suggested next prompt
```
Connect the reserved payment hook in `public/tour-booking-view.js` to a real order/checkout handoff, using the emitted quote payload instead of scraping values from the DOM.
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
