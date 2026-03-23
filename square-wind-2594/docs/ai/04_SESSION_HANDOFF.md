# Session Handoff Log

Purpose: end each coding session with a tiny handoff so the next Copilot/Cline prompt does not need the entire repo history.

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
Date: 2026-03-22
Checkpoint: CHK-404 follow-up / site config compatibility clarification
Goal of session: make old Builder persistence explicit as backward compatibility rather than active product model
What was completed:
- refactored `src/routes/site-studio.js` so legacy `builder_*` fields are handled as compatibility data internally
- kept legacy `builder` payloads in `/public/site` and `/public/tours/:id` so older consumers are not broken
- added test coverage confirming modern site-config updates preserve legacy Builder payload without requiring it to be resent
- updated API and AI docs to mark `builder_*` as deprecated compatibility fields and `/api/site/layout` as the primary website editing path
Files changed:
- Runtime/API:
	- `src/routes/site-studio.js`
- Tests:
	- `test/site-studio.spec.js`
- Docs:
	- `docs/API_SPEC.md`
	- `docs/ai/01_CURRENT_STATE.md`
	- `docs/ai/03_PROGRESS_LEDGER.md`
	- `docs/ai/04_SESSION_HANDOFF.md`
What is still not done:
- no browser automation exists for GrapesJS interactions in the admin shell
- asset-pipeline support for tenant-uploaded media/files is still not implemented
- old Builder-era DB columns still remain in schema for backward compatibility; no migration has removed them
Known risks / TODOs:
- GrapesJS currently loads from CDN; if you want stricter control, we should vendor or pin assets more deliberately later
- placeholder contract must stay stable so hosted layouts do not break when SaaS data changes
- if no downstream consumers still need `builder` payloads later, we can plan a controlled deprecation/removal phase
Suggested next prompt:
Audit whether any live downstream consumer still depends on `builder` payloads from `/public/site` or `/public/tours/:id`; if not, design a safe deprecation plan for the old Builder-era schema and response fields.

---

## Latest Handoff
Date: 2026-03-22
Checkpoint: CHK-404 follow-up / shell layout refinement + sanitization
Goal of session: make the shell fit actual operator behavior and remove dead Site Studio client code
What was completed:
- changed shell behavior so only `Tour Studio` keeps split-screen live preview
- made `Site Studio` full-width so GrapesJS has more working space
- made `Ops` single-column with no preview split
- removed the remaining dormant Builder-era client code paths from `public/index.html`
- revalidated page syntax and reran hosted-layout backend tests
Files changed:
- Public UI:
	- `public/index.html`
- Docs:
	- `docs/ai/01_CURRENT_STATE.md`
	- `docs/ai/03_PROGRESS_LEDGER.md`
	- `docs/ai/04_SESSION_HANDOFF.md`
What is still not done:
- no browser automation exists for GrapesJS interactions in the admin shell
- asset-pipeline support for tenant-uploaded media/files is still not implemented
- backend/site-config compatibility strategy for old Builder-era persisted fields has not been formally cleaned up yet
Known risks / TODOs:
- GrapesJS currently loads from CDN; if you want stricter control, we should vendor or pin assets more deliberately later
- placeholder contract must stay stable so hosted layouts do not break when SaaS data changes
- next cleanup could review whether unused Builder-era persistence fields should remain only for backward compatibility
Suggested next prompt:
Review Site Studio persistence compatibility: inspect old Builder-era site-config fields, decide whether they stay for backward compatibility only, and remove any remaining UI/runtime coupling that is no longer needed.

---

## Latest Handoff
Date: 2026-03-22
Checkpoint: CHK-404 follow-up / Site Studio cleanup
Goal of session: remove the old custom Builder UI so Site Studio has one clear editing path
What was completed:
- removed the legacy custom Builder controls from Site Studio UI
- kept GrapesJS as the single primary website editor
- added a placeholder reference panel covering `{{TOUR_LIST}}`, site tokens, contact tokens, and domain token usage
- repurposed the Site Studio preview panel to reflect hosted layout status instead of old Builder block/template state
- revalidated page syntax and reran hosted-layout backend tests
Files changed:
- Public UI:
	- `public/index.html`
- Docs:
	- `docs/ai/01_CURRENT_STATE.md`
	- `docs/ai/03_PROGRESS_LEDGER.md`
	- `docs/ai/04_SESSION_HANDOFF.md`
What is still not done:
- no browser automation exists for GrapesJS interactions in the admin shell
- asset-pipeline support for tenant-uploaded media/files is still not implemented
- old Builder-related backend/site-config persistence still exists in code but is no longer represented in Site Studio UI
Known risks / TODOs:
- GrapesJS currently loads from CDN; if you want stricter control, we should vendor or pin assets more deliberately later
- placeholder contract must stay stable so hosted layouts do not break when SaaS data changes
- next cleanup could remove or isolate obsolete Builder-specific client/runtime code paths that are no longer used by the UI
Suggested next prompt:
Clean up obsolete Builder-specific client code in `public/index.html` and, if still needed, decide whether Builder-related tenant site-config fields should be retained only for backward compatibility or removed from the UI model entirely.

---

## Latest Handoff
Date: 2026-03-22
Checkpoint: CHK-404 follow-up / GrapesJS embed
Goal of session: make Site Studio real by embedding GrapesJS on top of the hosted layout API
What was completed:
- embedded GrapesJS directly into Site Studio in `public/index.html`
- added hosted layout controls in the admin shell:
	- load layout
	- seed travel template
	- save draft layout
	- publish layout
- wired the editor to `/api/site/layout` using stored `html`, `css`, `project_data`, and `status`
- seeded a travel starter template with `{{TOUR_LIST}}`, `{{SITE_TITLE}}`, and contact placeholders
- GrapesJS became the main Site Studio editor
- validated page syntax and reran hosted-layout backend tests
Files changed:
- Public UI:
	- `public/index.html`
- Docs:
	- `docs/ai/01_CURRENT_STATE.md`
	- `docs/ai/03_PROGRESS_LEDGER.md`
	- `docs/ai/04_SESSION_HANDOFF.md`
What is still not done:
- no browser automation exists for GrapesJS interactions in the admin shell
- asset-pipeline support for tenant-uploaded media/files is still not implemented
Known risks / TODOs:
- GrapesJS currently loads from CDN; if you want stricter control, we should vendor or pin assets more deliberately later
- placeholder contract must stay stable so hosted layouts do not break when SaaS data changes
- current travel starter template is a good bootstrap, but template packs and tenant media handling are still pending
Suggested next prompt:
Reduce Site Studio transitional complexity: keep GrapesJS as the main editor, move legacy Builder controls into a collapsed “Advanced Legacy Controls” area, and add a small placeholder reference panel for `{{TOUR_LIST}}`, contact tokens, and site tokens.

---

## Latest Handoff
Date: 2026-03-22
Checkpoint: CHK-404 follow-up / tenant admin IA restructure
Goal of session: align the tenant admin shell with the new product split before embedding GrapesJS
What was completed:
- restructured the admin shell into three top-level sections:
	- `Tour Studio`
	- `Site Studio`
	- `Ops`
- merged Tour Config and Pricing/Bookings under one Tour Studio surface with an internal switcher
- renamed Builder-facing website workspace to Site Studio
- kept Mobile Ops separate under Ops instead of mixing it into website editing
- aligned the internal shell layout manager with the new section IDs and locking rules
- deployed the updated admin shell
Files changed:
- Public UI:
	- `public/index.html`
- Docs:
	- `docs/ai/01_CURRENT_STATE.md`
	- `docs/ai/03_PROGRESS_LEDGER.md`
	- `docs/ai/04_SESSION_HANDOFF.md`
What is still not done:
- GrapesJS is still not embedded yet
- Site Studio still contains transitional custom Builder controls until GrapesJS replaces them
- there is still no browser-level UI test coverage for this shell structure
Known risks / TODOs:
- old mental model references to `builder` and `mobile` tabs should be considered outdated going forward
- transitional custom Builder UI should not receive major new investment now that Site Studio is the GrapesJS target
- nested Tour Studio switching is client-side only and has no persisted sub-tab preference yet
Suggested next prompt:
Embed GrapesJS inside Site Studio in `public/index.html`, load/save its HTML/CSS/project payload through `/api/site/layout`, and keep Tour Studio and Ops unchanged.

---

## Latest Handoff
Date: 2026-03-22
Checkpoint: CHK-404 follow-up / hosted layout foundation
Goal of session: pivot site-building strategy toward GrapesJS-style self-hosted layouts with Worker-side domain rendering
What was completed:
- added hosted layout persistence layer separate from site config:
	- new table `tenant_site_layouts`
	- `GET /api/site/layout`
	- `POST /api/site/layout`
- implemented verified custom-domain rendering in Worker:
	- resolves tenant from `tenant_domain_configs`
	- reads published HTML/CSS/project payload from `tenant_site_layouts`
	- injects live placeholders such as `{{TOUR_LIST}}`, `{{SITE_TITLE}}`, and contact fields
- added migration `0022_site_layouts.sql`
- added focused tests for layout storage and hostname rendering
- validated full suite and prepared the repo for GrapesJS admin integration next
Files changed:
- Runtime/API:
	- `src/index.js`
	- `src/routes/site-layouts.js`
- Migrations:
	- `db/migrations/0022_site_layouts.sql`
- Tests:
	- `test/site-layouts.spec.js`
- Docs:
	- `docs/API_SPEC.md`
	- `docs/ARCHITECTURE.md`
	- `docs/ai/01_CURRENT_STATE.md`
	- `docs/ai/03_PROGRESS_LEDGER.md`
	- `CHECKPOINTS.md`
	- `docs/ai/04_SESSION_HANDOFF.md`
What is still not done:
- GrapesJS itself is not yet embedded into the admin shell
- published hosted layouts currently support initial placeholder injection only, not full component/data binding
- current custom Builder UI still exists and should be treated as transitional until GrapesJS admin is integrated
Known risks / TODOs:
- custom-domain rendering currently handles the main hosted page path, not a full asset pipeline for per-tenant static uploads
- placeholder strategy needs a controlled contract so templates stay stable as SaaS data evolves
- strategy pivot means we should avoid investing heavily in the old custom Builder surface from this point onward
Suggested next prompt:
Integrate GrapesJS into the Builder tab in `public/index.html`, load/save via `/api/site/layout`, seed it with a travel homepage template that includes `{{TOUR_LIST}}`, and keep existing site-config APIs unchanged.

---

## Latest Handoff
Date: 2026-03-22
Checkpoint: CHK-404 follow-up / Builder public payloads + content models
Goal of session: complete the next three Builder slices together by exposing Builder publicly, adding block ordering, and adding editable content models
What was completed:
- explicit Builder payload exposure added:
	- `/public/site` now returns top-level `builder`
	- `/public/tours/:id` now returns top-level `builder`
- Builder ordering upgraded in admin shell:
	- drag-drop ordering for active page blocks
	- drag-drop ordering for active utilities
	- remove actions from active lists while keeping library toggles
- Builder content models added and persisted:
	- `builder_content_json` column added
	- content editors for `hero`, `faq`, `testimonials`, and `cta`
	- Builder preview now reflects edited content
- remote migration `0021_site_builder_content.sql` applied and live deploy completed
- validated focused site-studio suite and full regression suite
Files changed:
- Runtime/API:
	- `src/routes/site-studio.js`
- Public UI:
	- `public/index.html`
- Migrations:
	- `db/migrations/0021_site_builder_content.sql`
- Tests:
	- `test/site-studio.spec.js`
- Docs:
	- `docs/API_SPEC.md`
	- `docs/ai/01_CURRENT_STATE.md`
	- `docs/ai/03_PROGRESS_LEDGER.md`
	- `CHECKPOINTS.md`
	- `docs/ai/04_SESSION_HANDOFF.md`
What is still not done:
- public site renderers still do not fully compose pages from Builder config; payloads are now ready, but final renderer consumption is still pending
- Builder content editors are fixed-shape models, not fully dynamic repeatable CMS schemas
- local shell layout persistence remains separate from tenant-persisted Builder content/layout decisions
Known risks / TODOs:
- frontend and backend Builder defaults must stay aligned to avoid surprising fallbacks
- utilities are ordered and persisted, but public consumers still decide whether ordering materially affects rendering
- Builder save path now touches both visual theme data and Builder content, so partial future edits should preserve merge behavior carefully
Suggested next prompt:
Use the new public `builder` payload to render a first real public-site composition layer in the existing public read path, starting with hero + FAQ + testimonials + CTA blocks only, while leaving growth and booking APIs unchanged.

---

## Latest Handoff
Date: 2026-03-22
Checkpoint: CHK-404 follow-up / Builder persistence
Goal of session: persist Builder templates, blocks, and utilities through tenant site config APIs
What was completed:
- extended site studio backend config storage:
	- added `builder_template`
	- added `builder_blocks_json`
	- added `builder_utilities_json`
- updated `/api/site/config` to load/save Builder state
- wired Builder tab in admin shell to:
	- fetch persisted site config on load
	- save template/block/utility choices explicitly via `Save Builder Config`
	- map builder visual controls into persisted site theme/color/font settings
- added migration `0020_site_builder_config.sql`
- applied remote D1 migrations so live Builder persistence works end-to-end
- validated focused site-studio tests and full suite, then redeployed
Files changed:
- Runtime/API:
	- `src/routes/site-studio.js`
- Public UI:
	- `public/index.html`
- Migrations:
	- `db/migrations/0020_site_builder_config.sql`
- Tests:
	- `test/site-studio.spec.js`
- Docs:
	- `docs/API_SPEC.md`
	- `docs/ai/01_CURRENT_STATE.md`
	- `docs/ai/03_PROGRESS_LEDGER.md`
	- `docs/ai/04_SESSION_HANDOFF.md`
What is still not done:
- Builder block ordering is still implicit from local arrays; no dedicated drag-drop website block ordering UI yet
- block-level field editing is still shallow; templates/blocks are selectable but not full CMS content models
- public site rendering does not yet consume persisted Builder config for real site output composition
Known risks / TODOs:
- Builder persistence now depends on site config schema being kept aligned across environments
- local Studio shell layout persistence is still browser-local and separate from tenant-persisted Builder content state
- font persistence currently uses a simple tone-to-font-family mapping, not a broad typography system
Suggested next prompt:
Use persisted Builder config in the public-site read path only: make `/public/site` and/or public tour payload expose Builder template/blocks/utilities clearly for downstream renderers, without changing unrelated growth or booking behavior.

---

## Latest Handoff
Date: 2026-03-22
Checkpoint: CHK-301..CHK-304 UI follow-up hardening
Goal of session: stabilize admin shell customization, tenant date formatting, and pricing/preset wiring after refinement pass
What was completed:
- added local Studio module in admin shell:
	- rename/reorder/hide/restore for tabs and major cards
	- browser-persisted local layout state
- expanded pricing preview and fixed currency behavior:
	- wider preview panel
	- richer right-panel pricing detail
	- admin/traveler currency display now follows selected base/display settings more consistently
- added tenant-level admin date formatting:
	- new booking-settings field `date_time_format`
	- migration `0019_booking_datetime_format.sql`
	- admin booking/mobile surfaces render `dd.mm.yyyy hh:mm`
- fixed pricing configuration flow:
	- season start/end now use date pickers
	- pricing title selector now reflects edited class presets
	- pricing tiers now bind by `class_id`
	- default class renamed from `class_casual` / `Casual` to `class_standard` / `Standard`
- validated full regression suite and redeployed live worker
Files changed:
- Runtime/API:
	- `src/routes/booking-settings.js`
- Public UI:
	- `public/index.html`
	- `public/book.html`
- Migrations:
	- `db/migrations/0019_booking_datetime_format.sql`
- Tests:
	- `test/bookings.spec.js`
- Docs:
	- `CHECKPOINTS.md`
	- `docs/ai/01_CURRENT_STATE.md`
	- `docs/ai/03_PROGRESS_LEDGER.md`
	- `docs/ai/04_SESSION_HANDOFF.md`
What is still not done:
- full traveler EN/VI translation coverage is still partial
- pricing tiers still do not have inline edit mode; current UX remains add/delete/save oriented
- existing older saved tiers may need one admin re-save to ensure `class_id` is explicitly persisted for all rows
Known risks / TODOs:
- admin date format currently supports only `dd.mm.yyyy hh:mm`; additional formats would need explicit formatter support
- currency conversion still depends on manual `USD/VND` rate maintenance by admin
- studio layout is local-browser persistence only; it is not tenant-synced across operators yet
Suggested next prompt:
Extend pricing maintenance only: add inline edit for existing pricing tiers in `public/index.html`, preserve `class_id` binding, and keep backend APIs unchanged.

---

## Latest Handoff
Date: 2026-03-22
Checkpoint: CHK-301..CHK-304 refinement pass (post-core completion)
Goal of session: finalize test-phase admin/traveler UX flow for destination operations, pricing tiers, and global language/currency controls
What was completed:
- compacted top admin/session surface into a dense operations header
- added stage-specific links for test/preview/live admin + traveler views
- destination UX updates in tour config:
	- compact service toggles
	- drag-handle-only sorting
	- edit/delete controls per destination
	- bottom add-destination composer
- itinerary preview now supports day-range labels by night count
- pricing moved to tier-first model with live/removable preview:
	- season + date window + pax band + class title + shared/single/child prices
	- delete actions in editor and right pricing preview
- moved global language/currency controls to single inline row in agent-admin:
	- language
	- traveler currency mode
	- tier input currency
	- USD/VND rate
- traveler UI now auto-selects locale/currency (EN/VI + USD/VND baseline behavior)
Files changed:
- Runtime/API:
	- `src/index.js`
	- `src/routes/booking-settings.js`
	- `src/routes/bookings.js`
- Public UI:
	- `public/index.html`
	- `public/book.html`
- Migrations:
	- `db/migrations/0017_booking_pricing_tiers.sql`
	- `db/migrations/0018_booking_currency_locale.sql`
- Tests:
	- `test/bookings.spec.js`
- Docs:
	- `CHECKPOINTS.md`
	- `docs/ai/01_CURRENT_STATE.md`
	- `docs/ai/03_PROGRESS_LEDGER.md`
	- `docs/ai/04_SESSION_HANDOFF.md`
What is still not done:
- expand traveler i18n from baseline labels/messages to full-page translation coverage
- optional explicit traveler language switcher UI (EN/VI) on top of auto-detect
- optional inline edit mode for pricing tiers (currently add/delete + save)
Known risks / TODOs:
- staged links currently route by query semantics for testing context; true multi-environment URL separation still depends on deployment strategy
- currency conversion depends on manual `USD/VND` rate configuration by admin
Suggested next prompt:
Implement full traveler EN/VI translation pass for all user-facing labels/messages, then add a small language toggle (`Auto/EN/VI`) while preserving auto-detect as default.

---

## Latest Handoff
Date: 2026-03-21
Checkpoint: CHK-000 / planning
Goal of session: consolidate current project reality and create AI-friendly control docs
What was completed:
- reviewed exported project context
- identified mismatch between docs maturity and implementation maturity
- prepared compact docs for AI onboarding, progress tracking, and handoff
Files changed:
- `00_AI_INDEX.md`
- `01_CURRENT_STATE.md`
- `02_WORKING_AGREEMENT.md`
- `03_PROGRESS_LEDGER.md`
- `04_SESSION_HANDOFF.md`
What is still not done:
- place these files into repo root or `docs/ai/`
- start first real implementation slice, likely `CHK-103` or `CHK-201`
Known risks / TODOs:
- docs may drift again unless ledger is updated after each session
- avoid prompting AI with both old and new control docs if they conflict
Suggested next prompt:
Implement `CHK-103` only. Read `00_AI_INDEX.md`, `01_CURRENT_STATE.md`, `/docs/DOMAIN_MODEL.md`, and `/docs/API_SPEC.md`. Add `recomputeSchedule(tourId)` plus focused tests. Do not touch unrelated files.

---

## Latest Handoff
Date: 2026-03-22
Checkpoint: CHK-404 complete
Goal of session: implement site studio MVP backend slice with multilingual public-site support
What was completed:
- CHK-404 implemented:
	- tenant site configuration endpoints for theme/color/font/header/footer/contact/search and default public language
	- multilingual legal-page storage and retrieval with language fallback
	- multilingual tour public content storage and retrieval with language fallback
	- public-site read endpoints for site payload, tour listing with basic search, and tour detail
- added migration for site studio schema:
	- tenant site config table
	- tenant legal pages table
	- tenant tour public content table
- added focused CHK-404 tests and validated full-suite compatibility
- synced docs and checkpoint trackers to reflect CHK-404 completion
Files changed:
- Runtime/API:
	- `src/index.js`
	- `src/routes/site-studio.js`
- Tests:
	- `test/site-studio.spec.js`
- Migrations:
	- `db/migrations/0008_site_studio.sql`
- Docs:
	- `docs/API_SPEC.md`
	- `docs/ARCHITECTURE.md`
	- `docs/DOMAIN_MODEL.md`
	- `docs/DATA_MODEL.sql`
	- `docs/ai/00_AI_INDEX.md`
	- `docs/ai/01_CURRENT_STATE.md`
	- `docs/ai/03_PROGRESS_LEDGER.md`
	- `docs/ai/07_REALITY_CHECK.md`
	- `docs/ai/04_SESSION_HANDOFF.md`
What is still not done:
- CHK-405 Growth & SEO module
- calendar OAuth/live push and reminder scheduler delivery automation
- full UI binding for site studio admin flows in shell
Known risks / TODOs:
- public endpoints currently rely on `X-Tenant-ID` for tenant resolution; domain-hostname resolution layer is still pending
- search is intentionally basic and in-memory per tenant response flow for MVP
- site studio UI controls are not yet connected to new backend APIs
Suggested next prompt:
Implement CHK-405 only. Add tenant-level Growth & SEO APIs with multilingual metadata and basic lead-capture/analytics hooks, plus focused tests and doc updates. Keep site studio and publish/billing behavior unchanged.

---

## Latest Handoff
Date: 2026-03-22
Checkpoint: CHK-405 complete
Goal of session: implement distribution/growth backend baseline after site studio
What was completed:
- CHK-405 implemented:
	- tenant growth configuration endpoints (analytics/social/review/trust/contact hooks)
	- editable tour slugs per tenant
	- multilingual tour SEO metadata storage with language fallback
	- public slug-based tour endpoint for SEO/social payload
	- public `/sitemap.xml` and `/robots.txt`
	- lead capture endpoint and growth event capture endpoint
- migration added for growth schema tables
- focused CHK-405 tests added and full suite regression pass completed
- docs/checkpoint trackers updated to mark CHK-405 done
Files changed:
- Runtime/API:
	- `src/index.js`
	- `src/routes/growth.js`
- Tests:
	- `test/growth.spec.js`
- Migrations:
	- `db/migrations/0009_growth_seo.sql`
- Docs:
	- `docs/API_SPEC.md`
	- `docs/ARCHITECTURE.md`
	- `docs/DOMAIN_MODEL.md`
	- `docs/DATA_MODEL.sql`
	- `docs/ai/00_AI_INDEX.md`
	- `docs/ai/01_CURRENT_STATE.md`
	- `docs/ai/03_PROGRESS_LEDGER.md`
	- `docs/ai/07_REALITY_CHECK.md`
	- `docs/ai/04_SESSION_HANDOFF.md`
What is still not done:
- admin UI wiring for new CHK-404/CHK-405 APIs
- richer structured data generation (Tour/Product/Offer/Review markup) in public render path
- domain-hostname-based tenant resolution for truly public unauthenticated site serving
Known risks / TODOs:
- current public endpoints still rely on `X-Tenant-ID` in MVP backend testing model
- growth event schema is intentionally minimal and may need expansion for attribution/reporting
- sitemap currently includes on-sale tours with explicit slug only
Suggested next prompt:
Implement UI wiring only: add a Growth & SEO tab in `public/index.html` that manages `/api/growth/config`, `/api/growth/tours/:id/slug`, and `/api/growth/tours/:id/seo` for the selected tour, with basic validation and save feedback. Do not change backend APIs.

---

## Latest Handoff
Date: 2026-03-21
Checkpoint: CHK-209 complete (with CHK-303 and CHK-304 also complete)
Goal of session: complete remaining near-term execution slices and lock docs/test alignment
What was completed:
- CHK-303 implemented:
	- new itinerary endpoint `GET /api/tours/:id/itinerary`
	- supports `format=markdown|md|html`, `includeDestinationText`, and `lang` override with fallback
	- new tests in `test/itinerary.spec.js` (5 tests)
- CHK-304 implemented end-to-end:
	- backend mobile ops endpoints in `src/routes/mobile.js`
	- UI tab wired in `public/index.html` with mobile task list, quick actions, note logging, status update, and latest thread context
	- mobile tests in `test/mobile.spec.js` (4 tests)
- CHK-209 implemented:
	- supplier CRUD endpoints (`POST/GET/PATCH /api/suppliers`)
	- optional service-item `supplier_id` linkage + in-tenant validation
	- migration `db/migrations/0004_suppliers.sql`
	- tests in `test/suppliers.spec.js` (3 tests)
- docs synchronized across API/state/ledger/model and checkpoints
- full test suite green at 97/97
Files changed:
- Runtime/API:
	- `src/index.js`
	- `src/routes/itinerary.js`
	- `src/routes/mobile.js`
	- `src/routes/suppliers.js`
	- `src/routes/service-items.js`
- Tests:
	- `test/itinerary.spec.js`
	- `test/mobile.spec.js`
	- `test/suppliers.spec.js`
- Migrations:
	- `db/migrations/0004_suppliers.sql`
- Docs:
	- `docs/API_SPEC.md`
	- `docs/ARCHITECTURE.md`
	- `docs/DOMAIN_MODEL.md`
	- `docs/DATA_MODEL.sql`
	- `docs/PROJECT_BRIEF.md`
	- `docs/TEST_PLAN.md`
	- `docs/ai/00_AI_INDEX.md`
	- `docs/ai/01_CURRENT_STATE.md`
	- `docs/ai/03_PROGRESS_LEDGER.md`
	- `docs/ai/07_REALITY_CHECK.md`
	- `docs/ai/20_AI_DISPATCH.md`
	- `docs/ai/23_SUPPLIER_SYSTEM.md`
	- `docs/ai/24_MOBILE_STRATEGY.md`
	- `docs/ai/25_MOBILE_OPS_RULES.md`
	- `CHECKPOINTS.md`
What is still not done:
- CHK-401 Domain onboarding flow
- CHK-402 Publish gate
- CHK-403 Tenancy/billing restrictions
- CHK-404 Site studio MVP scope
- CHK-405 Growth & SEO module
- Calendar OAuth/live push + scheduler delivery automation are still pending beyond baseline APIs
Known risks / TODOs:
- UI shell remains static-heavy; not all backend slices are fully bound in UX
- keep strict tenant scoping on all new routes and any future joins
- avoid checkpoint drift: always update `03_PROGRESS_LEDGER.md` and `01_CURRENT_STATE.md` in same session
Suggested next prompt:
Use this prompt exactly:

```
Resume from checkpoint CHK-401 only.

First read:
1) docs/ai/00_AI_INDEX.md
2) docs/ai/01_CURRENT_STATE.md
3) docs/ai/03_PROGRESS_LEDGER.md
4) CHECKPOINTS.md
5) docs/API_SPEC.md
6) docs/ARCHITECTURE.md
7) docs/DOMAIN_MODEL.md

Current reality constraints:
- CHK-103, CHK-201..CHK-209, CHK-301..CHK-304 are already done.
- Full test suite is green at 97 tests.
- Do not refactor unrelated files.

Task:
Implement CHK-401 (Domain onboarding flow) in smallest safe slice:
- define/extend data model for domain onboarding states (`no_domain`, `pending`, `verified`)
- add minimal API endpoints for onboarding + verification status retrieval/update
- enforce tenant isolation and API contract consistency
- add focused tests first/alongside changes

Done criteria:
- CHK-401 endpoints work and tests pass
- `docs/API_SPEC.md`, `docs/ai/01_CURRENT_STATE.md`, and `docs/ai/03_PROGRESS_LEDGER.md` updated
- run full test suite and report summary counts
```
