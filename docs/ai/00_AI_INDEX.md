# AI Documentation Index

Purpose: give Copilot/Cline one short entry point so they stop scanning the whole repo every time.

Read order for AI assistants:
1. `00_AI_INDEX.md` (this file)
2. `01_CURRENT_STATE.md`
3. `02_WORKING_AGREEMENT.md`
4. `03_PROGRESS_LEDGER.md` (split router)
5. `03A_PROGRESS_LEDGER_TOUR_PLATFORM.md` or `03B_PROGRESS_LEDGER_HOTEL_PROPERTY.md` depending on task domain
6. `03C_PROGRESS_LEDGER_COMBINED_ARCHIVE.md` only when older combined history is actually needed
7. `04_SESSION_HANDOFF.md` (latest section only)
8. linked source-of-truth docs in `/docs`

## Project identity
- Project: tour booking / tour operations MVP for travel agents
- Runtime: Cloudflare Workers (module)
- Data: D1 + KV
- Current code reality: rescue runtime is materially beyond the early MVP baseline. Core tenant/site publishing, booking lifecycle, billing lifecycle, domain purchase flow, calendar feeds, and ops-board slices are implemented; the main notable in-progress area is CHK-R79 rich service todo editing UX.

## Source of truth
Business/domain truth stays in:
- `/docs/PROJECT_BRIEF.md`
- `/docs/ARCHITECTURE.md`
- `/docs/DOMAIN_MODEL.md`
- `/docs/API_SPEC.md`
- `/docs/TEST_PLAN.md`

AI behavior / guardrails:
- `/CONTRACT_COPILOT.md`
- `/README_COPILOT.md`
- `/CHECKPOINTS.md`

## Rules for AI agents
- Do not invent fields, routes, tables, statuses, or flows outside the source-of-truth docs.
- Before coding, state which checkpoint is being worked on.
- Prefer editing existing files over creating parallel alternatives.
- When context is missing, write `TODO([CHK-XXX])` instead of guessing.
- Keep responses compact: plan -> files touched -> code -> tests.
- Avoid scanning the whole repository if the task is limited to one checkpoint.

## Task routing
- Schema / migrations -> docs + `db/` + checkpoint `[CHK-101]`
- Seed / demo data -> `db/` + `kv/` + `[CHK-102]`
- Schedule computation -> service/helper + `[CHK-103]`
- CRUD API -> `src/` + tests + `[CHK-201]`
- Booking/tasks/reminders -> cron/queue logic + `[CHK-202]`
- Threads/messages -> messaging handlers + `[CHK-203]`
- Day-1 operations -> tours + tasks + `[CHK-207]`
- Calendar sync / cadence reminders -> tasks + calendar routes + `[CHK-208]`
- Supplier system baseline -> schema + service item linkage + `[CHK-209]`
- UI tabs/cards/preview -> `[CHK-301]` to `[CHK-303]`
- Mobile ops surface -> task-thread quick actions + `[CHK-304]`
- Growth & distribution layer -> site studio + publishing surface + `[CHK-405]`

## Checkpoint pointers
- Implemented rescue checkpoints now extend through CHK-R82, with CHK-R79 still marked in progress in the ledger
- Next backend/domain follow-up: finish CHK-R79 inline editing and service-assignment gaps rather than inventing a parallel ops model
- Next UI evolution: keep binding the existing dashboard, ops board, billing pane, and tour-config surfaces to the already-shipped backend slices
- Progress ledger is now split for readability:
	- `03A_PROGRESS_LEDGER_TOUR_PLATFORM.md` = tour engine + shared platform/runtime
	- `03B_PROGRESS_LEDGER_HOTEL_PROPERTY.md` = hotel/property engine
	- `03_PROGRESS_LEDGER.md` = short router + usage rules
	- `03C_PROGRESS_LEDGER_COMBINED_ARCHIVE.md` = preserved combined history for old notes only

## AI module map
- `21_GROWTH_SEO_MODULE.md` -> Distribution & Growth layer scope
- `26_PROPERTY_ENGINE_AND_STAFF_SEATS.md` -> Standalone property/hotel engine (future, not implemented)
- `30_PROPERTY_ENGINE_OVERVIEW.md` -> Simplified commercial property engine scope and ship order
- `31_PROPERTY_AVAILABILITY_AND_ALLOCATION.md` -> Canonical night-based availability, allocation, split-stay, and upgrade-preserve model
- `32_PROPERTY_RESERVATION_INTAKE_AND_BOOKING_SOURCES.md` -> Direct, imported-draft, and manual reservation intake model
- `33_PROPERTY_OPERATIONS_APP.md` -> Floor map, room states, housekeeping, maintenance, and room-move operations
- `34_PROPERTY_SIMPLE_FOLIO_AND_POS.md` -> Booking-derived charges, manual postings, payments, and checkout settlement
- `35_PROPERTY_DISTRIBUTION_HELPER.md` -> Listing helper, draft-ingestion boundary, and future channel-sync scope
- `36_PROPERTY_ENGINE_IMPLEMENTATION_ROADMAP.md` -> Execution order and checkpoints for building the property engine
- `37_TOUR_ENGINE_DISTRIBUTION_AND_BOOKING_INGEST.md` -> Tour-side distribution helper and booking email-ingest boundary
- `38_PLATFORM_PACKAGING_AND_TIERS.md` -> Commercial packaging direction, including Tier 4 as the combined tour + hotel suite
- `39_SHARED_KERNEL_BETWEEN_TOUR_AND_PROPERTY.md` -> Shared platform kernel direction between the tour engine and property engine
- `40_SHARED_KERNEL_SCHEMA_DRAFT.md` -> First schema draft for the shared kernel between tour and property
- `41_ENGINE_PHASE1_EXECUTION_CHECKLISTS.md` -> Phase-1 build checklists for property availability core and tour stabilization
- `42_DB_MIGRATION_PROPOSAL_SHARED_TOUR_PROPERTY.md` -> Migration-safe DB proposal for shared kernel, tour stabilization, and property phase-1 tables
- `43_PROPERTY_PHASE1_SCHEMA_DRAFT.md` -> Concrete phase-1 property schema for availability, reservations, stay plans, allocations, and holds
- `44_FIRST_ACTUAL_MIGRATION_SET_PROPOSAL.md` -> Concrete first migration batch proposal with names from 0057 to 0065
- `46_TENANT_EXPERIENCE_MODES.md` -> Public product-mode truth for tour-only, hotel-only, and hybrid tenants
- `47_HOTEL_PUBLIC_LAYOUT_SCAFFOLD.md` -> Hotel-first homepage/navigation/block-order truth for `NEXT-P18B`
- `48_HOTEL_PUBLIC_CONTENT_MODEL.md` -> Hotel public content truth for room-type imagery, amenities, policies, and media ownership in `NEXT-P18C`
- `49_HOTEL_STAY_SEARCH_AND_RESULTS.md` -> Hotel stay-search/result behavior truth for `NEXT-P18D`
- `50_HOTEL_BOOKING_COMMIT_PATH.md` -> Hotel public booking commit truth for `NEXT-P18E`
- `51_PROPERTY_STAFF_AUTHORIZATION_MODEL.md` -> Property staff role and backend-authorization truth for `NEXT-P19`
- `52_B2B_GUEST_FOLIO_EXECUTION_MODEL.md` -> Enough-to-sell execution truth for `CHK-R132` / `NEXT-P20`
- `53_HOTEL_PRODUCT_PACKAGE.md` -> Commercial packaging truth for `hotel_pro` / `NEXT-P21` and `NEXT-P22`
- `54_MEMBERSHIP_SETTLEMENT_AND_PROVIDER_MODEL.md` -> Provider-agnostic tenant membership settlement truth for `tours_pro`, `hotel_pro`, and `all_in_one`
- `55_MEMBERSHIP_SETTLEMENT_PHASE1_IMPLEMENTATION_SPEC.md` -> concrete phase-1 runtime spec for `CHK-R134` and `CHK-R135`
- `56_MEMBERSHIP_SETTLEMENT_PHASE1_CODE_PLAN.md` -> file-by-file execution plan for the first implementation slice
- `29_EMAIL_INGESTION_AND_BOOKING_DRAFT.md` -> Email → Draft → Confirm booking ingestion (Phase 2, not implemented)
- `23_SUPPLIER_SYSTEM.md` -> supplier abstraction principles
- `24_MOBILE_STRATEGY.md` -> desktop vs mobile product boundary
- `25_MOBILE_OPS_RULES.md` -> mobile operational interaction rules
- `26_PROPERTY_ENGINE_AND_STAFF_SEATS.md` -> approved split between tour accommodation and future property engine, plus staff-seats model
- `28_MULTI_CURRENCY_AND_MARKET_SKINS.md` -> tenant-controlled storefront currency direction, curated currency basket, and market-skin architecture

## Token-saving policy
When using Copilot/Cline, paste only:
- this file
- `01_CURRENT_STATE.md`
- the relevant checkpoint section
- exact file paths to edit

Do **not** paste the entire repo context unless the task crosses multiple checkpoints.
