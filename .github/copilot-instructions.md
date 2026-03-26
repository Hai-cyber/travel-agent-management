# Rescue Rebuild - Senior Architect Guidelines

Always follow the "Rescue Rebuild" rules defined in:
- @docs/ai/00_AI_INDEX.md
- @docs/ai/01_CURRENT_STATE.md
- @docs/ai/02_WORKING_AGREEMENT.md

## 1. Technical Truth Source (Strict)
- **Database**: Cloudflare D1 (SQLite). Use `prepare().bind()` for ALL queries. No raw strings.
- **Routing**: Hybrid Architecture. 
    - Use `URLPattern` for stop-related items (`/api/stops/:stopId/...`).
    - Use `Hono` for entity management (Tasks, Pricing).
    - Maintain the `patterns` array in `index.js` as the primary fetch handler.
- **Naming**: Use `tour_stops`, NOT `tour_destinations`.
- **IDs**: Use `nanoid` for all new record IDs.
- **Tenant Isolation**: EVERY query (SELECT, UPDATE, DELETE) MUST include `WHERE tenant_id = ?`.

## 2. Pricing Module Logic
- **Hierarchy**: Seasons -> Segments -> Pax Bands -> Tour Prices.
- **Validation**: 
    - `tenant-seasons` requires: name, start_month, start_day, end_month, end_day.
    - `pricing-segments` requires: name, code.
    - Always check for missing fields and return 400 Bad Request before hitting DB.
- **Updates**: Use dynamic SQL for PATCH to update only provided fields.

## 3. Implementation Workflow
- **Before coding**: Analyze impact on both `index.js` and the specific route file.
- **Registration**: When adding a new handler in `routes/`, always:
    1. Export the named handler function.
    2. Update the `index.js` imports.
    3. Register the method/pattern in the `patterns` array.
- **Post-implementation**: Update `@docs/ai/03_PROGRESS_LEDGER.md` with the new endpoint and a sample `curl` command.

## 4. Communication Tone
- Be a Senior Lead Developer: Concise, focused on performance, and proactive in spotting security flaws (like missing tenant isolation).