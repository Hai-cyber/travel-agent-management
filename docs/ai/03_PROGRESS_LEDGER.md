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
| CHK-R10 | Validation | done | Required-field validation for POST; unknown-field and empty-body validation for PATCH; no changes to service layer. | 2026-03-25 | 100% complete. |
| CHK-R11 | Task System | done | Task templates generate, GET embeds tasks, and `PATCH /api/tasks/:taskId` is mounted through Hono again and verified live on 2026-04-02. | 2026-04-02 | Verified with direct PowerShell API calls on Windows using auth bearer session + tenant-scoped stop fixture. |
| CHK-R25 | Booking View UX — Phase 1/2 conversational flow | done | Conversational sentence inputs, room-based pax distribution, live price calculator, compact mode, sticky scrollable layout, Pricing Definitions | 2026-03-27 | `public/tour-config.html` only, no backend changes |
| CHK-R26 | Booking View — Surplus Room Pricing Logic | done | Sole-occupancy supplement auto-applied; ±2 shared stepper; two-way sync table↔sentence; surplus hint below table | 2026-03-27 | `public/tour-config.html` only |
| CHK-R27 | Seed data applied + Bug fixes | done | `seed_foundation.sql` + `seed_test.sql` applied to local D1: 2 seasons, 3 segments, 3 pax bands, 10 price rows. Fixed `ReferenceError: adults is not defined` in `calculateTourPrice` (pricing.js:1046). Fixed tour-config.html auto-reconnect on localStorage load. | 2026-03-28 | All add-tour/add-stop/add-price ops verified. Calculate endpoint returns correct invoice. |
| CHK-R28 | Tour Copy + Delete | done | `DELETE /api/tours/:id` (cascades tour_prices→tour_stops→tours, best-effort R2 cleanup). `POST /api/tours/:id/copy` (deep-clone tour+stops+prices in one D1 batch, new id+slug, status=draft). Both scoped by tenant_id. Copy/Delete buttons added to tour-config.html detail card. | 2026-03-28 | Tenant isolation verified: cross-tenant delete returns 404. |
| CHK-R29 | Visual Editor — Header Overlap Fix (CSS-first) | done | siteStudio.js injects VE Canvas Layout Guard `<style>`: `body{display:flex;flex-direction:column}`, `body>header{position:sticky!important;top:0;z-index:9999}`, `#canvas{flex-grow:1}`. Supports all Tailwind header positions (absolute/sticky/fixed/static). cfg.header_height injected as `padding-top` server-side. editor-bridge.js rewritten: `_getHeaderEl()` accepts all positions; `_applyHeaderOffset()` uses padding-top on `#canvas` (no margin-collapse); `HEADER_HEIGHT_MEASURED` fires to parent; visual-editor.html persists height to `cfg.header_height`. | 2026-03-30 | Bulletproof 3-layer strategy: CSS→JS fallback→server-side padding |
| CHK-R30 | Visual Editor — Drop Zone Fix (animation stop) | done | Drop zone overlay: on section insert, `opacity→0` → `transitionend` → `display:none` + `animationPlayState:paused`. On show: `display:flex` + rAF → `opacity:1`. Created with `display:none` + `animationPlayState:paused` from birth. Zero GPU waste after first snippet added. | 2026-03-30 | Fixes lingering bounce animation covering snippets |
| CHK-R31 | Visual Editor — Drag-and-Drop Snippets | done | Snippet cards rendered with `draggable=true`; `.dnd-overlay` div added to `.canvas` (`position:absolute;inset:0;z-index:500`) as parent-frame drop target (bypasses iframe event boundary). `dragstart` → saves `S.dragSnip/dragCard`, shows overlay; `drop` → calls `insertSnippet()`; `dragend` → clears overlay. CSS: `.snip-card.dragging`, `.dnd-overlay.active/.over` states. | 2026-03-30 | Solves cross-frame drag limitation of iframes |
| CHK-R32 | Snippet Engine — syncAllSnippets.mjs | done | `scripts/syncAllSnippets.mjs` rebuilt as a deep-crawl extractor. It now scans top-level sections plus nested standalone blocks and micro-components (buttons, forms, input groups, icon boxes, card/grid layouts), strips demo scripts/Alpine attrs, rewrites asset paths to absolute R2 URLs, injects `data-ve-*` editor markers, and regenerates `public/snippets/index.json`. Current output: 240 snippets across 20 Cruip templates, default 12 per category. Run: `node scripts/syncAllSnippets.mjs --r2-base https://pub-xxx.r2.dev --clear`. | 2026-03-30 | Visual Editor sidebar now prefers the generated manifest over runtime section extraction |
| CHK-R33 | Visual Editor — Button/Link Editor | done | `editor-bridge.js`: `wireBtns()` intercepts `a[data-ve-btn], a.btn, a[class*="btn-"]` clicks → sends `BUTTON_CLICK {selector,text,href,sectionId}`. `applyBtn()` handles incoming `APPLY_BTN` from parent. `visual-editor.html`: new `#panel-btn` in sidebar (reuses 🖼 Image tab). Fields: Button Text + Link URL. Apply → `sendFrame(APPLY_BTN)`. `switchTab('img')` routes to `panelBtn` vs `panelImg` based on `S.btnEdit`. | 2026-03-30 | Click any button in preview → sidebar opens link editor instantly |
| CHK-R34 | Visual Editor — Grid Layout + Device Preview | done | `editor-bridge.js` now upgrades editable sections into 12-column grid hosts, applies/persists `col-span-X`, supports snap-resize with translucent overlay, and adds per-component action rail for move/copy/delete plus drag-reorder inside the grid. `visual-editor.html` adds `Laptop`/`Mobile` preview modes that resize the iframe. Managed chrome in `siteStudio.js` and `pages.js` collapses to logo + `☰ Menu` on mobile and expands customer-facing nav/actions on demand. | 2026-03-30 | Saves clean section HTML without editor overlays; drag/reorder stays within the current section grid |
| CHK-R35 | Universal Site API Foundation | done | Legacy Site Studio kept intact. New parallel namespace `/api/universal/*` added with D1 foundation tables, stabilized group vocabulary (`tour_operator`, `stay_accommodation`, `transport_service`), editor-schema aware site config, real tour sync mapping from `tours/tour_stops/tour_prices`, and auto-bound travel tour public page records. Shared business engines remain canonical. | 2026-03-31 | Branch pivot only; stabilized foundation for new system, not final editor UX |
| CHK-R36 | Universal Automation Active | done | Legacy create/copy tour routes now schedule non-blocking universal sync via `c.executionCtx.waitUntil(...)`; preview renderer `/api/universal/render/:tenantId` added for visual verification; local smoke script covers migration + GET/PATCH/sync/render checks. | 2026-03-31 | Automation active for travel tours; frontend editor UI still pending |
| CHK-R37 | Public Render + Live Update Hooks | done | Added public route `/p/:tenantId/:slug` with Cache API edge caching and SEO meta generation, moved editor bundle assembly into the universal lib, and extended auto-sync hooks to legacy tour update, stop create/update/delete, and `tour-prices` create/update/delete. | 2026-03-31 | Public cache is invalidated from universal sync for travel pages |
| CHK-R38 | 8 Variants Launch | done | Expanded universal registry to 8 variants across `tour_operator`, `stay_accommodation`, and `transport_service`; public route now renders from JSON blocks using variant-specific layout profiles; added heuristic onboarding mock `POST /api/universal/site/bootstrap`; image markup uses Cloudflare `/cdn-cgi/image/` resizing URLs for responsive delivery. | 2026-03-31 | Variant switch now changes public layout immediately after cache purge |
| CHK-R39 | Multi-Skin Runtime Preservation | done | Runtime storefront/theme logic is now modularized under `src/lib/themes/`; Six Senses is preserved as the first real skin module, `active_theme` is returned by universal config, and the preview-first Website Design admin can drive skin-aware storefront chrome/system toggles. | 2026-04-02 | Foundation is ready for additional skins; only Six Senses is implemented today |
| CHK-R40 | Seed-Aware Tenant Direction Saved | in_progress | Direction is now documented: future tenant creation should preload normalized seed packs for tours, hotels, gallery, destinations, and related storefront content based on the selected skin. | 2026-04-02 | Architecture direction is saved in docs/handoff, but auto-seeded tenant creation is not built yet |

### 2026-03-25
- CHK‑R09 (Service Items CRUD) completed 100%: routing, service layer, schema alignment, D1 integration, manual testing. All groups (accommodations, meals, guides, local transports, intercity legs) fully CRUD-able via Worker API. No Node modules, no require(), no schema errors. Foundation is robust and clean.

### 2026-03-30
- Local verification performed against `npx wrangler dev` on Windows using direct PowerShell API calls because `bash` was not installed in the environment.
- Confirmed working locally: root Worker response, tenant settings, tours list, preview endpoint, pricing metadata, pricing calculate, payment settings toggle, booking order creation, proof upload, guest portal GET, and accommodations `POST/GET/PATCH` on `stop-001`.
- Booking docs corrected: proof upload does not unlock identity. Identity remains masked until `confirm-receipt` succeeds.
- Local migration ledger is not clean: `npx wrangler d1 migrations apply travel_agent_db --local` attempts to re-run `0012_stop_services_config.sql` and fails on duplicate column `services_config`.
### 2026-04-02
- CHK-R11 restored to `done`: `src/routes/tasks.js` now mounts `PATCH /api/tasks/:taskId` directly into Hono, and a live local verification flow confirmed create service item → embedded task → task patch to `done` on `stop-001`.
- CHK-R18 restored to `done`: `src/routes/bookings.js` now writes `tenant_audit_log` rows with the required `field_name`, `changed_at`, and `changed_by` fields during confirm/manual unlock audit events; live local verification confirmed `POST /api/bookings/order/:id/confirm-receipt` returns `CONFIRMED` and persists the audit row.
- Local migration replay hardening completed: `scripts/apply-local-migrations.mjs` now reconciles the `0012_stop_services_config.sql` ledger row before `wrangler d1 migrations apply`, and the wrapper runs cleanly on Windows as `npm run db:migrate:local`.
- Windows smoke verification is now standardized: `npm test` / `npm run test:local` runs a Node-based smoke flow that refreshes local fixtures, reuses or starts Wrangler dev, verifies `PATCH /api/tasks/:taskId`, verifies seeded `GET /api/pricing/calculate` output for high-season standard pricing, then verifies booking proof upload + `confirm-receipt` + audit row end to end.
- CHK-R39 completed: runtime storefront skin logic is now preserved in `src/lib/themes/`, with `src/lib/themes/six-senses.js` as the first committed skin module and `src/lib/themes/index.js` as the resolver/registry layer.
- Website Design now replaces the older Universal Admin/Visual Editor entrypoint in the main dashboard path; the preview-first admin exposes contextual quick edit plus an expanded System Panel for site-level chrome toggles and storefront controls.
- Six Senses runtime truth is now preserved in docs as the current storefront baseline: invisible/fixed header on first paint, Cormorant Garamond-led editorial shell, floating Book Now CTA, and skin-aware system settings.
- CHK-R40 moved to `in_progress`: future tenant creation should combine skin selection with normalized seed loading for tours, hotels, galleries, destinations, and related storefront content; this workflow is now explicitly saved in the repo docs so it can be implemented next instead of rediscovered.

- CHK-R29: Visual Editor header overlap fixed with CSS-first 3-layer strategy (sticky flex + JS fallback + server-side padding-top from cfg.header_height). Covers all Cruip header positions: absolute (stellar-html), sticky (mosaic-html), static (open-pro-html).
- CHK-R30: Drop zone animation stops correctly after first snippet insert (`display:none` + `animationPlayState:paused` via `transitionend`).
- CHK-R31: Real drag-and-drop on snippet cards. `.dnd-overlay` placed in parent frame over iframe to bypass cross-frame drag event restriction.
- CHK-R32: `scripts/syncAllSnippets.mjs` rebuilt for deep crawl. It now extracts 240 snippets from 20 Cruip templates by scanning sections, nested standalone blocks, and reusable micro-components (buttons, forms, input groups, icon boxes, card grids); rewrites all assets to absolute R2 URLs; strips demo JS/Alpine attrs; and injects `data-ve-*` editor markers.
- CHK-R33: Button/Link editor in Visual Editor sidebar. Click any `<a>` button in iframe → `#panel-btn` slides open with text+URL fields.
- CHK-R34: Visual Editor canvas now supports responsive `Laptop`/`Mobile` preview modes. In mobile preview, managed customer-facing headers collapse to logo + `☰ Menu`, with a tap-to-open nav/actions panel.
- CHK-R34: `editor-bridge.js` now turns snippet sections into 12-column editable grids with persisted `col-span-X`, right-edge resize handles with smart snapping, translucent grid overlay during resize, and per-component `Move / Copy / Delete` controls.
- CHK-R34: Component handlers support drag-reorder inside the current grid using an in-grid placeholder; drop commits `SECTION_HTML_UPDATED` with editor overlays stripped before save.
 
### 2026-03-31
- CHK-R35: Universal Site pivot stabilized in parallel with legacy Site Studio. Added `0029_universal_site_foundation.sql` plus `/api/universal/*` routes for config, theme, contact, menu, pages, editor schema, and travel tour-page sync.
- CHK-R35: `src/lib/universalSite.js` now uses the stabilized vocabulary `tour_operator`, `stay_accommodation`, `transport_service` and defines 5 concrete variants across those groups.
- CHK-R35: `src/lib/universalSiteSync.js` is the single source of truth for tour-page synchronization, mapping `tours`, `tour_stops`, `tour_prices`, `pricing_segments`, `tenant_seasons`, and `pax_bands` into universal page payloads.
- CHK-R35: Legacy Site Studio is explicitly preserved; the new universal system is additive and reuses shared engines (`tour builder`, `pricing engine`) rather than forking business logic.
- CHK-R36: `src/routes/tours.js` now triggers universal sync automatically after legacy tour create and copy using `c.executionCtx.waitUntil(...)`, so universal tour pages are generated without manual sync clicks.
- CHK-R36: Added preview renderer `GET /api/universal/render/:tenantId` using Tailwind CDN to visually verify synced title, about section, itinerary, pricing, and gallery output.
- CHK-R36: Added `test/test_universal_api.sh` smoke script with migration commands and curl cases for `GET /api/universal/site/config`, `PATCH /api/universal/site/config`, manual sync, and preview render checks.
- CHK-R37: Added public route `/p/:tenantId/:slug` with SEO meta tags derived from synced universal content and Cache API edge caching for fast public delivery.
- CHK-R37: `src/routes/tours.js` now schedules background sync not only for create/copy, but also for tour update and stop create/update/delete.
- CHK-R37: `src/routes/pricing.js` now schedules background sync for `tour-prices` create/update/delete by passing `ctx` through the manual `patterns[]` dispatcher in `src/index.js`.
- CHK-R37: `src/lib/universalSite.js` now exports a store-ready bundle helper so React/Vue/Next can consume one object for `editor_schema` + `editor_model`.
- CHK-R38: The universal variant registry now exposes 8 launch templates with distinct layout profiles, not just theme token differences.
- CHK-R38: `/p/:tenantId/:slug` now renders component blocks from JSON (`hero`, `gallery`, `features`, `itinerary`, `pricing_spotlight`, `contact`, `legal`) and changes presentation immediately when `variant_key` changes.
- CHK-R38: `POST /api/universal/site/bootstrap` now performs a heuristic onboarding mock, choosing a variant from the 8-template registry and returning a prefilled editor bundle with sample text and placeholder images.
- CHK-R38: Public image markup now uses Cloudflare Image Resizing URLs (`/cdn-cgi/image/fit=...,width=...,format=auto,...`) for responsive delivery aligned with Edge caching.
| CHK-R12 | Public/site/growth rebuild | not_started | not rebuilt yet | 2026-03-24 | old docs exist, new runtime not yet restored |
| CHK-R13 | Headless Publishing (R2) | done | Tour CRUD + generateTourPage + R2 publish/switch-template | 2026-03-26 | migration 0012, src/routes/tours.js, R2 binding TOUR_PAGES |
| CHK-R14 | Subscription Control + Custom Domain | done | Subscription gate on publish; pay-button injection; custom domain routing in fetch handler | 2026-03-27 | migration 0013, src/lib/publishGuard.js, tenants.js expanded |
| CHK-R15 | Preview/Whitelabel Identity Separation + Audit Trail | done | renderMode param; preview banner; disabled pay button in preview; white-label live pages; D1 audit log for custom_domain + payment_config_json | 2026-03-26 | migration 0014, publishGuard preview helpers, GET /audit-log |
| CHK-R16 | Booking Widget (booking-widget.js) | done | Floating button, side drawer, DatePicker, pax inputs, live itemized invoice, segment compare, Save → short-link | 2026-03-26 | public/booking-widget.js, auto-embedded in default.html |
| CHK-R17 | Tenant Revenue Tracking Schema | done | total_revenue_tracked + commission_threshold on tenants; read-only in GET /settings | 2026-03-26 | migration 0015 |
| CHK-R18 | Bank Transfer Order + Identity Lock | done | Order create/proof flow works, proof upload keeps identity locked until confirm, and `confirm-receipt` now returns success while unlocking identity, incrementing revenue, and writing a compatible audit row. | 2026-04-02 | Verified live on local Wrangler dev with a fresh booking order and audit-log query. |
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
- `maskOrder()` — current runtime returns a `guest` object with masked `***` values until identity unlock, not full omission.
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
| `POST` | `/order/:id/proof` | Upload bank slip / PDF (10 MB, allowlisted MIME) → stores proof in R2, keeps identity locked, sets `PROOF_UPLOADED` |
| `POST` | `/order/:id/confirm-receipt` | Agent action unlocks identity, increments `tenants.total_revenue_tracked`, and records the confirm event in `tenant_audit_log` |

**Local verification update (2026-04-02):**
- `POST /order` worked locally and returned a real `order_id`
- `GET /order/:id` returned masked guest fields while awaiting proof
- `POST /order/:id/proof` worked locally and left `identity_unlocked = 0`
- `POST /order/:id/confirm-receipt` now returns `CONFIRMED`, unlocks identity, increments tenant revenue, and writes an `IDENTITY_UNLOCK_CONFIRM_RECEIPT` audit row with `field_name = booking_order.status`

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

### CHK-R26 — Booking View: Surplus Room Pricing Logic (2026-03-27)

**File:** `public/tour-config.html` (JS/CSS/HTML changes only, no backend migrations)

**Rule:** A double room is only billed at the *Shared Rate* when **fully occupied by 2 people**. Any double with sole occupancy is billed at the **Private/Single Supplement rate**.

**Formula:**
```
totalRooms = doubles + singles
IF totalRooms >= adults  →  sharedPax = 0,  privatePax = adults          (everyone gets own room)
ELSE                     →  fullyOccupied = min(doubles, adults − totalRooms)
                             sharedPax = fullyOccupied × 2,  privatePax = adults − sharedPax
```

**Example:** 3 adults + 3 double rooms → `totalRooms(3) ≥ adults(3)` → Shared = 0, Private = 3 ✓

**Changes implemented:**
| Function | Change |
|---|---|
| `syncPhase1ToPax()` | Rewritten — applies surplus rule; sharedPax always even |
| `syncTableToPax()` | Snaps shared qty to nearest even; maps privatePax → singles in sentence |
| `renderPaxRows()` | Shared row stepper uses delta ±2 (must move in pairs) |
| `updateRoomStatusPill()` | Rewritten — shows `N shared doubles + M private rooms → X adults confirmed` |
| `updateSurplusHint()` | **New function** — shows amber note below table when sole-occupancy supplement applies |
| `runCalc()` | Calls `updateSurplusHint()` after local total is set |
| `validateRooms()` | Updated messaging — surplus rooms show blue informational note |

**BigTotal guarantee:**
```
BigTotal = (shared_qty × shared_price) + (private_qty × private_price) + (child_qty × child_price)
```
Always a strict local sum — never derived from backend `grand_total`.

**UI element added:** `#bv-surplus-hint` div below price table (amber banner, visible only when supplement applies).

```bash
# No migration required — frontend-only change
# Verify in browser: http://127.0.0.1:8787/tour-config.html
# Test: 3 adults + 3 doubles → table shows Adult (Shared)=0, Adult (Private)=3
```

---

### CHK-R25 — Booking View UX: Phase 1/2 Conversational Flow (2026-03-27)

**File:** `public/tour-config.html` (JS/CSS/HTML changes only)

**Phase 1 — Conversational Sentence:**
- Inline `.bv-conv-input` fields: travel date, adult count, child count, double rooms, single rooms
- `autoSuggestRooms(adults)` — auto-fills room split on adult count change
- `validateRooms()` — inline hint with capacity/shortage feedback
- `btn-calc-price` CTA — disabled until pricing loaded; triggers `syncPhase1ToPax()` → Phase 2

**Phase 2 — Results:**
- Segment tier tab strip (`#seg-tabs`)
- Full-height pax table (4 rows: Shared Adult, Private Adult, Child, Infant) with ± qty steppers
- "Good to Know" section (`#bv-defs`) — Pricing Definitions rendered as fine print

**Compact mode:** After CTA click → Phase 1 collapses to `#bv-compact` one-line summary bar with "Edit" button

**Sticky layout:** `#bv-panel-inner` flex-column; `#bv-panel-body` scrollable; `#bv-panel-footer` pinned; grand total always visible

**Two-way sync:** Table ± stepers call `syncTableToPax()` → updates sentence inputs + room counts; compact bar text rebuilds via `buildCompactSummary()`

**Pricing Definitions:** Left-panel editor textarea (`#pricing-defs-editor`); 4 default rules; `localStorage` persistence with migration guard; rendered via `renderDefs()`

**Math model:**
- `_calcCurrency = 'EUR'`; `fmtMoney(n)` uses explicit `Intl.NumberFormat` with `de-DE` locale
- Grand total = strict local sum; API call only fetches season/band labels (status pill), never overrides total
- Stale-closure protection via `paxSnap` + segment ID guard on API response

```bash
# No migration required — frontend-only change
# Verify: http://127.0.0.1:8787/tour-config.html → Price Config tab
```

---

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

### CHK-R36 — Price Config tab: Customer Booking View (2026-current)
- Checkpoint: CHK-R36
- Status: done
- Commit: 4e38506
- Files changed:
  - `public/tour-config.html` — Replaced flat admin grid with customer-facing Booking View + collapsible admin section
- Summary:
  - **Booking View card** (top): Segment tabs as pricing tier buttons → auto-selects first segment on load. 4-row pax table (Adult Shared, Adult Private, Child with parents, Infant) with ±qty controls, unit price from raw `_pricingData.prices`, and live subtotal column. Travel date input triggers `POST /api/pricing/calculate` for season-aware grand total + applied season/pax-band footnote. Fallback to raw total if calculate returns an error (e.g. season not matched).
  - **Admin section** (collapsible `<details>` with arrow): 2-col grid Seasons + Pax Bands; Segments table (inline rename); Tour Prices table + Add row form. All existing IDs preserved.
  - New CSS: `.seg-tab`, `.seg-tab.active`, `.qty-wrap`, `.qty-btn`, `.qty-val`
- Verification:
  ```bash
  # Open tour config, select a tour → Price Config tab
  npx wrangler dev  →  http://localhost:8787/tour-config.html
  # Segment tabs appear; select one → pax rows show unit prices
  # ± qty buttons update counts; travel date triggers live season-aware total
  # Manage section expands via ▶ arrow; seasons/pax bands/segments/prices all editable
  ```

### YYYY-MM-DD
- Checkpoint:
- Status:
- Files changed:
  - path/to/file
- Summary:
- Risks / TODO:
- Verification:
