# Tour / Platform Progress Ledger

Purpose: track rescue-rebuild progress for the tour engine and the shared platform/runtime surfaces that are already powering the current product.

Scope includes:
- tours and tour pricing
- booking drafts and booking orders
- supplier/service items and ops board
- universal site / publishing / storefront
- tenant/admin/auth/billing/platform operations

Status legend:
- `not_started`
- `in_progress`
- `blocked`
- `done`
- `legacy_only`

## Active focus

| Checkpoint | Title | Status | Code reality | Last update | Notes |
|---|---|---|---|---|---|
| CHK-R08 | Canonical docs reset | in_progress | docs are still being normalized from combined historical notes into clearer rescue-runtime truth | 2026-03-24 | Current split keeps `03_PROGRESS_LEDGER.md` as frozen history and routes new updates into `03A/03B` |
| CHK-R79 | Rich service todos — structured cards, communication threads, 5-state lifecycle, auto-reminders | in_progress | grouped stop rendering, rich cards, thread history, reseed support, and reminder flow already exist; remaining work is filter/edit acceleration and audit/integrity tightening | 2026-04-19 | Main remaining tour/platform runtime gap |

## Foundations and core tour engine

| Checkpoint | Title | Status | Code reality | Last update | Notes |
|---|---|---|---|---|---|
| CHK-R00 | Rescue baseline / local worker shell | done | local Worker + D1 baseline verified | 2026-03-24 | `/`, `/api/db-check`, `/api/tables` working |
| CHK-R01 | Tours base table + preview | done | `tours` exists and preview route works | 2026-03-24 | demo tour confirmed |
| CHK-R02 | Destinations catalog + preview | done | `destinations` exists and preview route works | 2026-03-24 | catalog direction chosen |
| CHK-R03 | Transitional tour_destinations relation | done | relation table exists and join preview works | 2026-03-24 | transitional only, not final itinerary model |
| CHK-R04 | Destination texts + preview | done | `destination_texts` exists and preview route works | 2026-03-24 | demo VI text confirmed |
| CHK-R05 | Tour aggregate preview | done | `/api/tours-with-destinations` works | 2026-03-24 | useful rescue preview, not final domain API |
| CHK-R07 | Canonical itinerary entity: tour_stops | done | `tour_stops` exists and demo row confirmed | 2026-03-24 | canonical itinerary direction locked |
| CHK-R09 | Service Items CRUD | done | all 5 groups implemented with POST/GET/PATCH | 2026-03-25 | schema-aligned and tenant-scoped |
| CHK-R10 | Validation | done | required-field and patch validation are live | 2026-03-25 | no service-layer rewrite needed |
| CHK-R11 | Task System | done | task templates generate, GET embeds tasks, PATCH works again through Hono | 2026-04-02 | verified live locally |
| CHK-R25 | Booking View UX — Phase 1/2 conversational flow | done | conversational booking sentence inputs, live price calculator, compact mode, sticky layout | 2026-03-27 | `public/tour-config.html` only |
| CHK-R26 | Booking View — Surplus Room Pricing Logic | done | sole-occupancy supplement and table↔sentence sync live | 2026-03-27 | `public/tour-config.html` only |
| CHK-R27 | Seed data applied + Bug fixes | done | local D1 seeded; pricing bugfixes verified | 2026-03-28 | calculate endpoint returns correct invoice |
| CHK-R28 | Tour Copy + Delete | done | copy/delete routes and UI controls working | 2026-03-28 | tenant isolation verified |
| CHK-R50 | Day Tour pricing mode | done | tour pricing/runtime supports `day_tour` mode without room logic | 2026-04-10 | booking/public pricing adapted |

## Storefront / universal site / publishing

| Checkpoint | Title | Status | Code reality | Last update | Notes |
|---|---|---|---|---|---|
| CHK-R29 | Visual Editor — Header Overlap Fix | done | header offset/padding strategy stabilized | 2026-03-30 | CSS-first + JS fallback |
| CHK-R30 | Visual Editor — Drop Zone Fix | done | overlay animation stops cleanly after first insert | 2026-03-30 | GPU waste removed |
| CHK-R31 | Visual Editor — Drag-and-Drop Snippets | done | parent-frame overlay DnD works | 2026-03-30 | iframe boundary issue solved |
| CHK-R32 | Snippet Engine — syncAllSnippets.mjs | done | manifest extraction rebuilt | 2026-03-30 | 240 snippets generated |
| CHK-R33 | Visual Editor — Button/Link Editor | done | preview click -> sidebar button editor flow works | 2026-03-30 | runtime bridge active |
| CHK-R34 | Visual Editor — Grid Layout + Device Preview | done | 12-col grid edit + laptop/mobile preview active | 2026-03-30 | saves clean HTML |
| CHK-R35 | Universal Site API Foundation | done | parallel `/api/universal/*` foundation is live | 2026-03-31 | legacy site studio preserved |
| CHK-R36 | Universal Automation Active | done | auto-sync hooks and preview renderer active | 2026-03-31 | local smoke covers sync/render |
| CHK-R37 | Public Render + Live Update Hooks | done | public route, cache invalidation, auto-sync hooks active | 2026-03-31 | cache purged from sync |
| CHK-R38 | 8 Variants Launch | done | 8 layout variants available | 2026-03-31 | image resizing via `/cdn-cgi/image/` |
| CHK-R39 | Multi-Skin Runtime Preservation | done | theme runtime modularized; Six Senses preserved | 2026-04-02 | additional skins still future |
| CHK-R40 | Starter Tenant Seed Bootstrap | done | onboarding seeds starter tours/stops/pricing/hotels/pages | 2026-04-03 | new tenants no longer empty |
| CHK-R43 | Tour Draft Media Upload + Live Preview | done | richer draft content + media upload + preview sync | 2026-04-03 | live deploy verified |
| CHK-R45 | Taxonomy Discovery Foundation | done | tenant-scoped taxonomy and interest-page scaffolding live | 2026-04-04 | search/ranking UI still future |
| CHK-R47 | Broken-Asset Diagnostic + Layout Polish | done | admin broken-asset scan + itinerary/hotel/price polish | 2026-04-08 | verified live |
| CHK-R49 | Hotel sorting + Named Photo Libraries | done | hotel metadata + named media libraries active | 2026-04-10 | product modules uses catalog flows |
| CHK-R64 | Showcase-only platform subdomains + commercial activation on custom domains | done | showcase vs commerce boundary enforced | 2026-04-15 | tenant subdomains render correctly |

## Boundary notes

- `CHK-R47` stays in this ledger even though the title mentions hotel polish, because that work targeted storefront rendering and universal content surfaces rather than the standalone property engine.
- `CHK-R49` stays in this ledger intentionally because it is based on the universal catalog model (`tenant_universal_hotels`, media libraries, product modules, tour-content linking), not the property-engine model (`properties`, `room_types`, `room_units`, `property_reservations`).
- In short: if the word `hotel` means catalog/showcase/storefront content, it belongs here; if it means room inventory, night allocation, reservation lifecycle, or property ops, it belongs in `03B_PROGRESS_LEDGER_HOTEL_PROPERTY.md`.

## Platform / tenant / auth / billing / ops

| Checkpoint | Title | Status | Code reality | Last update | Notes |
|---|---|---|---|---|---|
| CHK-R06 | Tenants foundation | done | tenants table + multi-tenant baseline restored | 2026-03-24 | demo tenant exists |
| CHK-R41 | Product Tier Catalog + Signup Selection | done | tier catalog + onboarding selection working | 2026-04-03 | hotel tiers still roadmap |
| CHK-R42 | SaaS Pricing Marketing Page + Admin Editor | done | marketing page and protected editor share D1 content | 2026-04-03 | no code edits needed for copy changes |
| CHK-R44 | Password Recovery Flow | done | forgot/reset flow, webhook delivery, smoke coverage complete | 2026-04-03 | production Turnstile enforced |
| CHK-R46 | Tenant Booking Currency + Market Skin Foundation | done | tenant booking currency/locale/market-skin runtime exists | 2026-04-05 | cleanup still follow-up |
| CHK-R51 | Booking widget full i18n — all 9 locales | done | booking widget localized across 9 locales | 2026-04-10 | no hardcoded English pricing headers |
| CHK-R52 | Email delivery verified — info@tours-market.com sender | done | production mail sender path verified | 2026-04-13 | Gmail alias requirement noted |
| CHK-R53 | Booking lifecycle email notifications | done | booking created / proof / confirmed email flows active | 2026-04-13 | recipient routing verified |
| CHK-R54 | Auth guard hardening + Custom-domain upgrade UX + Booking currency propagation | done | auth guard gaps closed and upgrade UX added | 2026-04-14 | local smoke passes |
| CHK-R56 | Dashboard pane system + Order detail view + booking_order_todos | done | order detail pane + todo checklist shipped | 2026-04-14 | migration 0050 applied remotely |
| CHK-R57 | Dashboard pane system hotfix | done | `showPane()` / cache declaration fixed | 2026-04-14 | pane navigation repaired |
| CHK-R58 | Trial countdown banner + Upgrade button restored + i18n localized | done | banner and billing CTA logic fixed | 2026-04-14 | 11 locales updated |
| CHK-R70 | Launch guide UX refactor + full i18n | done | launch guide simplified and localized | 2026-04-15 | frontend only |
| CHK-R71 | Stripe-ready legal pages + commission model | done | legal/public pricing pages shipped | 2026-04-15 | static pages + tier config |
| CHK-R72a | Homepage rewrite — minimal, product-focused | done | homepage simplified to product-focused landing | 2026-04-15 | static marketing surface |
| CHK-R72b | signup.html — restyle to match pricing page | done | signup styling aligned | 2026-04-15 | visual only |
| CHK-R72c | signup.html — blue accents + pre-select Pro tier | done | Pro default tier preselect live | 2026-04-15 | URL param still wins |
| CHK-R73 | pricing.html — copy rewrite for clarity and Stripe compliance | done | pricing copy simplified and Stripe-safe | 2026-04-15 | no schema changes |
| CHK-R74 | Refund policy expansion + payment trust badges | done | trust badges and fuller refund policy live | 2026-04-15 | static pages only |
| CHK-R74b | Consolidate all contact emails to info@tours-market.com | done | public contact addresses unified | 2026-04-15 | Gmail alias requirement |
| CHK-R74c | POST /api/contact — implement platform contact form endpoint | done | Worker endpoint and webhook dispatch active | 2026-04-15 | production confirmed |
| CHK-R74d | Contact form security — honeypot + Turnstile + rate limit | done | contact abuse protections live | 2026-04-15 | KV reuse only |
| CHK-R75 | Trust Admin UI — Review Cases tab | done | review-case admin tab active | 2026-04-16 | frontend-only |
| CHK-R76 | Post-payment app — full billing lifecycle | done | checkout success/cancel pages + portal + payment emails live | 2026-04-16 | Stripe portal config required |
| CHK-R77 | Billing safety — enforcement, notifications, trial cron, dashboard banners | done | billing guardrails and cron lifecycle live | 2026-04-16 | webhook events documented |
| CHK-R78 | Post-confirmation operational flow — auto-confirm instant payments, auto-seed todos, dashboard reload | done | confirmation flow now seeds ops todos and refreshes dashboard state | 2026-04-16 | idempotent seeding |
| CHK-R80 | tour-config — help (?) popovers | done | contextual help popovers shipped | 2026-04-17 | frontend-only |
| CHK-R81 | tour-config — itinerary day inline edit | done | day inline edit shipped | 2026-04-17 | frontend-only |
| CHK-R82 | Ops board bug fixes — duplicate todos, day sync, delete buttons | done | operational bugfix pass completed | 2026-04-17 | verified in production |

## Remaining tour / platform work

- Main active gap remains CHK-R79 filter/edit acceleration and integrity tightening.
- Combined historical notes remain preserved in `03_PROGRESS_LEDGER.md` until the split migration is considered complete.