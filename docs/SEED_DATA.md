# Seed Data

Source and strategy for sample data and fixtures.


# Seed & Fixtures

## D1
- Migration file: `/db/migrations/0001_schema_v1.sql`
- Seed file: `/db/seeds.sql` (insert-only, deterministic timestamps)
- Run schema first:
  - `npx wrangler d1 execute <db_name> --file ./db/migrations/0001_schema_v1.sql`
- Run seed second:
  - `npx wrangler d1 execute <db_name> --file ./db/seeds.sql`

> NOTE: Canonical itinerary is now tour_stops (not destinations). All operational service items must reference tour_stop_id. Legacy destination_id linkage is retained for business intent only.

## KV
- Namespace: `KV_PRESETS`
- Keys:
  - `SERVICE_PRESET` (types, default_fields)
  - `ITINERARY_SNIPPETS_VI` (intro, tips locale)

## Pricing model upgrade
- Canonical pricing uses tenant_seasons, pricing_segments, pax_bands, and tour_prices. Flat season/pax fields are deprecated.

> NOTE: Pricing upgrade tables (tenant_seasons, pricing_segments, pax_bands, tour_prices) are NOT part of the current seed; they will be added in later migrations.

Add a short NOTE near the bottom of this file:

- Clarify that pricing upgrade tables (tenant_seasons, pricing_segments, pax_bands, tour_prices) are NOT part of the current seed and will be added in later migrations.

Do not change anything else.
