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

## KV
- Namespace: `KV_PRESETS`
- Keys:
  - `SERVICE_PRESET` (types, default_fields)
  - `ITINERARY_SNIPPETS_VI` (intro, tips locale)