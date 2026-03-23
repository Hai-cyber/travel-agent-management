# Current State Snapshot

Last updated: 2026-03-22

## What exists now
- Repo has strong documentation coverage for brief, architecture, domain model, API spec, test plan, checkpoints, and Copilot rules.
- Runtime is Cloudflare Workers module worker.
- D1 binding is `DB`.
- KV binding is `TOUR_PRESETS`.
- Tests now validate schedule, tours/destinations CRUD, tasks, communication threads, calendar/reminders, suppliers, itinerary, mobile ops, domain onboarding, publish gate, billing restrictions, site studio, growth/SEO, and demo endpoints.

## Code reality vs product intent
### Product intent
A tour-operations MVP centered on destinations, computed schedules, 5 service groups, communication threads, tasks/reminders, pricing, visual config, and itinerary composition.

### Current code reality
- `src/index.js` now exposes MVP API handlers for tours, destinations, operational service items, tasks, and communication threads/messages.
- `test/index.spec.js` still covers demo endpoints, and additional suites cover domain APIs.
- Core domain slices for CHK-103 and CHK-201 through CHK-209 plus CHK-401 through CHK-405 are implemented in worker code.
- UI/admin shell has undergone significant operations refinement:
	- compact top control panel for test operations
	- global language/currency controls in agent-admin
	- tenant-level admin date-format control (`dd.mm.yyyy hh:mm`)
	- tenant admin IA is now organized as `Tour Studio`, `Site Studio`, and `Ops`
	- GrapesJS is now embedded inside Site Studio as the primary hosted-layout editor
	- only Tour Studio uses split-screen live preview; Site Studio is full-width for editing and Ops is single-column
	- drag-drop ordering for active Builder blocks and utilities
	- editable Builder content models for hero, FAQ, testimonials, and final CTA
	- pricing tiers with season-window/pax/class and live right-panel preview
	- traveler auto locale + auto currency display behavior
	- pricing composer now uses date pickers for season start/end and class-linked tier selection
	- Builder template/block/utility selections now persist via tenant site config APIs
	- public site and public tour detail payloads now expose explicit `builder` objects for downstream renderers
- Hosted-site strategy is now pivoting toward GrapesJS-style external editing with tenant-owned HTML/CSS/project storage and Worker-side domain rendering

## Important gaps
1. Service-item CRUD now exists, but service-item tasks and communication are still not consolidated into one operational timeline view.
2. Service mini-cards currently behave like local UI entries; they still need to bind directly to the new service CRUD endpoints.
3. Task/calendar sync exists as backend foundation, but tenant OAuth/live push jobs are not implemented yet.
4. Reminder cadence exists in backend endpoints, but scheduler automation and delivery channels are not wired yet.
5. Multilingual public-site behavior is now a product requirement, but current implementation is still single-language oriented.
6. `docs/GLOSSARY.md` needs cleanup and completion.
7. Some docs mix placeholders and real content.
8. Codebase planning mentions TypeScript direction, but runtime code is JavaScript.
9. Auto translation is currently EN/VI baseline mapping in traveler UI; full dynamic i18n coverage is still partial.

## Immediate recommendation
Treat the repo as:
- **Docs-first domain baseline is ready**
- **Backend MVP foundation is active for core operations slices**

That means AI assistants should still verify runtime coverage by checkpoint instead of assuming all documented features exist.

## Current implementation status by checkpoint
- `[CHK-000]` Context seed: effectively done
- `[CHK-101]` D1 schema & migrations v1: done (canonical schema doc + dedicated migration file)
- `[CHK-102]` Demo seed: done (insert-only seed with deterministic timestamps, validated execution)
- `[CHK-103]` `recomputeSchedule`: done (helper + persist service + 6 unit tests)
- `[CHK-201]` CRUD tour/destination/service items: done (tour/destination CRUD + operational service-item CRUD + 27 integration tests)
- `[CHK-204]` Multi-tenant guardrails: done (tenant scoping on all queries + header auth)
- `[CHK-202]` Booking → tasks + cron reminders: done (generateTasksForTour + 4 task endpoints + 14 tests)
- `[CHK-203]` threads/email/note handling: done (thread/message services + 4 endpoints + 15 tests)
- `[CHK-205]` API contract hardening: done (shared JSON parsing/error helpers + pagination validation + 7 contract tests)
- `[CHK-206]` Worker observability baseline: done (request IDs, structured request logs, trace headers + 4 observability tests)
- `[CHK-207]` Day-1 pickup + welcome flow: done (tour-create toggles + auto-generated Day-1 tasks)
- `[CHK-208]` Task calendar sync + reminder cadence: done (calendar config + ICS feed + reminder-candidate cadence endpoints)
- `[CHK-209]` Supplier system baseline: done (supplier CRUD + service-item supplier_id linkage validation)
- `[CHK-301]` UI shell MVP: done (static 3-tab shell in public asset with tour/pricing/visual flows)
- `[CHK-302]` mini-card service groups: done (destination mini-cards for all 5 service groups in the static shell)
- `[CHK-303]` itinerary preview: done (markdown/html preview endpoint with destination-text toggle + language fallback)
- `[CHK-304]` mobile ops surface: done (mobile task feed, quick actions, quick-note logging, status updates, and latest thread context in shell)
- `[CHK-401]` domain onboarding flow: done (tenant hostname claim, pending verification instructions, and verified status transition endpoints)
- `[CHK-402]` publish gate: done (tenant publish checklist endpoints + enforcement on `status=on_sale`; full suite green at 105/105)
- `[CHK-403]` tenancy and billing restrictions: done (tenant billing status endpoints + publish/new-booking blocking when unpaid or trial-expired; full suite green at 110/110)
- `[CHK-404]` site studio MVP scope: done (tenant site config + multilingual legal/tour content + public listing/detail/search endpoints; full suite green at 115/115)
- `[CHK-405]` growth & SEO module: done (tenant growth config + SEO metadata/slugs + sitemap/robots + lead/event capture hooks; full suite green at 120/120)

## Definition of “done enough” for next step
The next meaningful implementation slice should be:
- choose one checkpoint
- define exact files touched
- define tests first
- implement only that slice
- update `03_PROGRESS_LEDGER.md`

## Recent implementation notes (2026-03-22)
- Added booking-settings schema support for pricing tiers and currency controls:
	- `pricing_tiers`
	- `date_time_format`
	- `pricing_currency_mode`
	- `pricing_base_currency`
	- `usd_to_vnd_rate`
- Admin pricing flow now uses class-title selection from class presets (free-text title removed).
- Class presets are now definition-oriented in admin UI; pricing values are configured in Pricing tiers.
- Admin shell now includes a local Studio layer for tab/card layout customization with browser persistence.
- Builder template, block, and utility selections now persist to `tenant_site_configs` through `/api/site/config`.
- Builder content models also persist to `tenant_site_configs` through `builder_content_json`.
- New hosted layout storage layer now exists via `tenant_site_layouts` for self-hosted HTML/CSS/project payloads.
- Current admin-shell direction is to keep itinerary/pricing in Tour Studio, website editing in Site Studio, and field execution in Ops.
- Legacy custom Builder controls have been removed from Site Studio UI; GrapesJS plus placeholder reference is now the main website-editing path.
- The legacy Builder-specific client code in `public/index.html` has been substantially removed so the shell now aligns more closely with the actual UI model.
- Legacy `builder_*` fields in `tenant_site_configs` and related public payloads remain only as backward-compatibility data for older consumers.
- Admin bookings/mobile views now respect tenant date formatting via booking settings.
- Pricing tiers are now bound to class presets by `class_id`, not only display title text.
- Default baseline class was renamed from `class_casual` / `Casual` to `class_standard` / `Standard`.
- Full suite is currently green at 133/133 tests.
