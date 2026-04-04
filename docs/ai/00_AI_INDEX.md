# AI Documentation Index

Purpose: give Copilot/Cline one short entry point so they stop scanning the whole repo every time.

Read order for AI assistants:
1. `00_AI_INDEX.md` (this file)
2. `01_CURRENT_STATE.md`
3. `02_WORKING_AGREEMENT.md`
4. `03_PROGRESS_LEDGER.md`
5. `04_SESSION_HANDOFF.md` (latest section only)
6. linked source-of-truth docs in `/docs`

## Project identity
- Project: tour booking / tour operations MVP for travel agents
- Runtime: Cloudflare Workers (module)
- Data: D1 + KV
- Current code reality: backend MVP slices through CHK-209, CHK-304, and CHK-401 are implemented; UI remains early-stage shell

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
- Implemented backend core: CHK-201 to CHK-209, plus CHK-401 to CHK-405
- Next backend domain extension: none (backend checkpoint baseline complete)
- Next UI evolution: bind more shell flows to backend slices as needed

## AI module map
- `21_GROWTH_SEO_MODULE.md` -> Distribution & Growth layer scope
- `23_SUPPLIER_SYSTEM.md` -> supplier abstraction principles
- `24_MOBILE_STRATEGY.md` -> desktop vs mobile product boundary
- `25_MOBILE_OPS_RULES.md` -> mobile operational interaction rules
- `26_PROPERTY_ENGINE_AND_STAFF_SEATS.md` -> approved split between tour accommodation and future property engine, plus staff-seats model

## Token-saving policy
When using Copilot/Cline, paste only:
- this file
- `01_CURRENT_STATE.md`
- the relevant checkpoint section
- exact file paths to edit

Do **not** paste the entire repo context unless the task crosses multiple checkpoints.
