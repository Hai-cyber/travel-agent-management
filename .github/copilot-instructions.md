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

## 1A. Property Availability Truth (Strict)
- **Runtime truth order**: For property availability, trust `src/routes/properties/availability.js` first, then `docs/ai/01_CURRENT_STATE.md`, then the planning docs such as `docs/ai/31_PROPERTY_AVAILABILITY_AND_ALLOCATION.md` and `docs/ai/43_PROPERTY_PHASE1_SCHEMA_DRAFT.md`.
- **Do not drift to planning docs**: `31_PROPERTY_AVAILABILITY_AND_ALLOCATION.md` and `43_PROPERTY_PHASE1_SCHEMA_DRAFT.md` describe the approved model, but they are not enough to claim current runtime behavior by themselves.
- **Night model**: Availability is night-based. A stay consumes `[check_in, ..., check_out - 1]`; `check_in` and `check_out` are not themselves consumed as standalone inventory events.
- **Inventory truth**: Current runtime availability is computed from active sellable `room_units`, minus overlapping `reservation_allocations` (`soft_allocated` and `locked`), minus active unexpired `inventory_holds`, minus active blocking `property_allotments`.
- **Allocation truth**: `reservation_allocations` is the lane-level source of truth for occupancy and rack/planning confidence. Do not substitute reservation headers for allocation truth when availability or room occupancy is being decided.
- **Commercial separation**: Pricing does not decide availability. Price resolution, pricing profiles, weekday rules, and `pricing_snapshot` are commercial overlays on top of availability; they must not mutate sellable inventory logic.
- **Recheck before commit**: Hold creation, reservation create, rebook, and planning flows must rerun the shared availability calculation rather than trusting a previously returned availability payload.
- **When changing the model**: If property availability behavior changes, update the implementation, `01_CURRENT_STATE.md`, and the relevant property ledger entry together so future agents do not inherit stale assumptions.

## 2. Pricing Module Logic
- **Hierarchy**: Seasons -> Segments -> Pax Bands -> Tour Prices.
- **Validation**: 
    - `tenant-seasons` requires: name, start_month, start_day, end_month, end_day.
    - `pricing-segments` requires: name, code.
    - Always check for missing fields and return 400 Bad Request before hitting DB.
- **Updates**: Use dynamic SQL for PATCH to update only provided fields.

## 3. Implementation Workflow
- **Before coding**: Analyze impact on both `index.js` and the specific route file.
- **Module shape**: Prefer modular extraction when it meaningfully keeps route files light and easier to reason about.
- **Do not over-split**: Avoid fragmenting logic into too many small modules; optimize for system stability, straightforward debugging, and easier future maintenance.
- **Further splitting**: Do not keep splitting modules beyond the current need unless the user explicitly asks for another split step.
- **Registration**: When adding a new handler in `routes/`, always:
    1. Export the named handler function.
    2. Update the `index.js` imports.
    3. Register the method/pattern in the `patterns` array.
- **Post-implementation**: Update `@docs/ai/03_PROGRESS_LEDGER.md` with the new endpoint and a sample `curl` command.

## 4. Internationalization Rules
- **Source Language**: English is the canonical source language for all new user-facing copy.
- **Translations**: Vietnamese and Chinese are translations of the English source, not separate originals.
- **Catalog First**: Put user-facing strings in shared locale JSON files. Do not hardcode visible UI text in source when it belongs in i18n.
- **Keys in Code**: Source code should reference translation keys and resolved locale values, not duplicated literal text across languages.
- **Consistency**: When adding or changing copy, update the English catalog first, then keep `vi` and `zh` aligned.
- **Fallbacks**: If a translation is missing, fall back to English rather than inventing inconsistent copy inline.

## 5. Commercial Activation Policy (Non-negotiable)
- **Platform subdomain** = showcase only. Zero payment, zero commerce, zero bank transfer, zero lead-gen forms that initiate a transaction.
- **Electronic gateway required**: `commercialActivationEnabled` in `publishGuard.js` requires `electronicGatewayConfigured` (Stripe, MoMo, VNPay, ZaloPay, PayPal, GrabPay, or Credit Card). Bank transfer (`BANK_TRANSFER`) alone is NEVER sufficient to unlock commerce.
- **Bank transfer = supplementary only**: tenants may add bank transfer as an additional payment option AFTER an electronic gateway is already active.
- **Reason**: bank transfer is untrackable — platform cannot enforce commission, cannot detect cancellations, and it signals an unmodern commerce surface to end-customers.
- **CF Registrar flow**: when a tenant registers a domain through the platform Cloudflare Registrar integration, the domain purchase checkout charges CF domain cost + 30% platform markup, auto-verifies the domain on success, and the tenant proceeds directly to commercial activation without a DNS wait period.
- **BYOD domain flow**: tenant brings their own domain → sets DNS → platform verifies → manual trust review → commercial activation.

## 6. Communication Tone
- Be a Senior Lead Developer: Concise, focused on performance, and proactive in spotting security flaws (like missing tenant isolation).