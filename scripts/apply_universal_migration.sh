#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-local}"
DB_NAME="${DB_NAME:-travel_agent_db}"

json_field() {
  local field_name="$1"
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0, 'utf8')); const row=data?.[0]?.results?.[0] ?? {}; process.stdout.write(String(row['$field_name'] ?? 0));"
}

rescue_local_tenant_email_migration() {
  local preflight_json email_present applied

  preflight_json="$(npx wrangler d1 execute "$DB_NAME" --local --json --command "SELECT (SELECT COUNT(*) FROM pragma_table_info('tenants') WHERE name='email') AS email_present, (SELECT COUNT(*) FROM d1_migrations WHERE name='0024_tenant_email.sql') AS applied;")"
  email_present="$(printf '%s' "$preflight_json" | json_field email_present)"
  applied="$(printf '%s' "$preflight_json" | json_field applied)"

  if [[ "$email_present" == "1" && "$applied" == "0" ]]; then
    echo "[rescue] tenants.email already exists locally; marking 0024_tenant_email.sql as applied"
    npx wrangler d1 execute "$DB_NAME" --local --command "INSERT INTO d1_migrations (name) VALUES ('0024_tenant_email.sql');"
  fi
}

rescue_local_historical_schema_drift() {
  local preflight_json
  local terms_accepted terms_accepted_at stripe_customer_id onboarding_step tenant_pages

  preflight_json="$(npx wrangler d1 execute "$DB_NAME" --local --json --command "SELECT (SELECT COUNT(*) FROM pragma_table_info('tenants') WHERE name='terms_accepted') AS terms_accepted, (SELECT COUNT(*) FROM pragma_table_info('tenants') WHERE name='terms_accepted_at') AS terms_accepted_at, (SELECT COUNT(*) FROM pragma_table_info('tenants') WHERE name='stripe_customer_id') AS stripe_customer_id, (SELECT COUNT(*) FROM pragma_table_info('tenants') WHERE name='onboarding_step') AS onboarding_step, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tenant_pages') AS tenant_pages, (SELECT COUNT(*) FROM d1_migrations WHERE name='0025_add_publish_fields.sql') AS applied_0025, (SELECT COUNT(*) FROM d1_migrations WHERE name='0026_onboarding_step.sql') AS applied_0026, (SELECT COUNT(*) FROM d1_migrations WHERE name='0027_tenant_pages.sql') AS applied_0027;")"

  terms_accepted="$(printf '%s' "$preflight_json" | json_field terms_accepted)"
  terms_accepted_at="$(printf '%s' "$preflight_json" | json_field terms_accepted_at)"
  stripe_customer_id="$(printf '%s' "$preflight_json" | json_field stripe_customer_id)"
  onboarding_step="$(printf '%s' "$preflight_json" | json_field onboarding_step)"
  tenant_pages="$(printf '%s' "$preflight_json" | json_field tenant_pages)"
  applied_0025="$(printf '%s' "$preflight_json" | json_field applied_0025)"
  applied_0026="$(printf '%s' "$preflight_json" | json_field applied_0026)"
  applied_0027="$(printf '%s' "$preflight_json" | json_field applied_0027)"

  if [[ "$terms_accepted" == "1" && "$terms_accepted_at" == "1" && "$stripe_customer_id" == "1" && "$applied_0025" == "0" ]]; then
    echo "[rescue] publish-gate tenant columns already exist locally; marking 0025_add_publish_fields.sql as applied"
    npx wrangler d1 execute "$DB_NAME" --local --command "INSERT INTO d1_migrations (name) VALUES ('0025_add_publish_fields.sql');"
  fi

  if [[ "$onboarding_step" == "1" && "$applied_0026" == "0" ]]; then
    echo "[rescue] tenants.onboarding_step already exists locally; marking 0026_onboarding_step.sql as applied"
    npx wrangler d1 execute "$DB_NAME" --local --command "INSERT INTO d1_migrations (name) VALUES ('0026_onboarding_step.sql');"
  fi

  if [[ "$tenant_pages" == "1" && "$applied_0027" == "0" ]]; then
    echo "[rescue] tenant_pages already exists locally; marking 0027_tenant_pages.sql as applied"
    npx wrangler d1 execute "$DB_NAME" --local --command "INSERT INTO d1_migrations (name) VALUES ('0027_tenant_pages.sql');"
  fi
}

rescue_remote_legacy_pricing_foundation() {
  local preflight_json applied_0004 has_tour_prices has_legacy_season has_canonical_season_id

  preflight_json="$(npx wrangler d1 execute "$DB_NAME" --remote --json --command "SELECT (SELECT COUNT(*) FROM d1_migrations WHERE name='0004_add_pricing_foundation.sql') AS applied_0004, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tour_prices') AS has_tour_prices, (SELECT COUNT(*) FROM pragma_table_info('tour_prices') WHERE name='season') AS has_legacy_season, (SELECT COUNT(*) FROM pragma_table_info('tour_prices') WHERE name='season_id') AS has_canonical_season_id;")"

  applied_0004="$(printf '%s' "$preflight_json" | json_field applied_0004)"
  has_tour_prices="$(printf '%s' "$preflight_json" | json_field has_tour_prices)"
  has_legacy_season="$(printf '%s' "$preflight_json" | json_field has_legacy_season)"
  has_canonical_season_id="$(printf '%s' "$preflight_json" | json_field has_canonical_season_id)"

  if [[ "$applied_0004" == "0" && "$has_tour_prices" == "1" && "$has_legacy_season" == "1" && "$has_canonical_season_id" == "0" ]]; then
    echo "[rescue] remote legacy tour_prices detected; backing it up so 0004_add_pricing_foundation.sql can recreate the canonical schema"
    npx wrangler d1 execute "$DB_NAME" --remote --command "CREATE TABLE IF NOT EXISTS tour_prices_legacy_backup (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, tour_id TEXT NOT NULL, season TEXT, pax_from INTEGER, pax_to INTEGER, adult_price REAL, child_price REAL, infant_price REAL, single_supp REAL, weekend_surcharge REAL, currency TEXT DEFAULT 'VND', effective_from INTEGER, effective_to INTEGER); INSERT OR IGNORE INTO tour_prices_legacy_backup (id, tenant_id, tour_id, season, pax_from, pax_to, adult_price, child_price, infant_price, single_supp, weekend_surcharge, currency, effective_from, effective_to) SELECT id, tenant_id, tour_id, season, pax_from, pax_to, adult_price, child_price, infant_price, single_supp, weekend_surcharge, currency, effective_from, effective_to FROM tour_prices; DROP TABLE tour_prices;"
  fi
}

migrate_remote_legacy_pricing_backup() {
  local preflight_json backup_rows applied_0004

  preflight_json="$(npx wrangler d1 execute "$DB_NAME" --remote --json --command "SELECT (SELECT COUNT(*) FROM d1_migrations WHERE name='0004_add_pricing_foundation.sql') AS applied_0004, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tour_prices_legacy_backup') AS has_backup, (SELECT COUNT(*) FROM tour_prices_legacy_backup) AS backup_rows;")"

  applied_0004="$(printf '%s' "$preflight_json" | json_field applied_0004)"
  backup_rows="$(printf '%s' "$preflight_json" | json_field backup_rows)"

  if [[ "$applied_0004" == "1" && "$backup_rows" != "0" ]]; then
    echo "[rescue] importing legacy remote pricing rows into the canonical pricing foundation"
    npx wrangler d1 execute "$DB_NAME" --remote --command "INSERT OR IGNORE INTO tenant_seasons (id, tenant_id, name, start_month, start_day, end_month, end_day, sort_order, is_active, notes, created_at) SELECT 'legacy-season-' || tenant_id || '-' || COALESCE(season, 'default'), tenant_id, CASE WHEN COALESCE(season, '') = '' THEN 'Legacy Default Season' ELSE 'Legacy ' || season END, 1, 1, 12, 31, 0, 1, 'Migrated from legacy tour_prices.season', COALESCE(CAST(effective_from / 1000 AS INTEGER), CAST(strftime('%s','now') AS INTEGER)) FROM tour_prices_legacy_backup; INSERT OR IGNORE INTO pricing_segments (id, tenant_id, code, name, description, sort_order, is_active, created_at) SELECT 'legacy-segment-' || tenant_id, tenant_id, 'LEGACY', 'Legacy Standard', 'Migrated from legacy tour_prices rows', 0, 1, COALESCE(CAST(MIN(effective_from) / 1000 AS INTEGER), CAST(strftime('%s','now') AS INTEGER)) FROM tour_prices_legacy_backup GROUP BY tenant_id; INSERT OR IGNORE INTO pax_bands (id, tenant_id, name, min_pax, max_pax, sort_order, is_active, created_at) SELECT 'legacy-band-' || tenant_id || '-' || COALESCE(CAST(pax_from AS TEXT), '1') || '-' || COALESCE(CAST(pax_to AS TEXT), '2'), tenant_id, COALESCE(CAST(pax_from AS TEXT), '1') || '-' || COALESCE(CAST(pax_to AS TEXT), '2') || ' pax', COALESCE(pax_from, 1), CASE WHEN COALESCE(pax_to, COALESCE(pax_from, 1) + 1) <= COALESCE(pax_from, 1) THEN COALESCE(pax_from, 1) + 1 ELSE COALESCE(pax_to, COALESCE(pax_from, 1) + 1) END, 0, 1, COALESCE(CAST(effective_from / 1000 AS INTEGER), CAST(strftime('%s','now') AS INTEGER)) FROM tour_prices_legacy_backup; INSERT OR IGNORE INTO tour_prices (id, tenant_id, tour_id, season_id, segment_id, pax_band_id, base_currency, adult_shared_room_price, adult_single_room_price, child_shared_with_parents_price, notes, is_active, created_at) SELECT id, tenant_id, tour_id, 'legacy-season-' || tenant_id || '-' || COALESCE(season, 'default'), 'legacy-segment-' || tenant_id, 'legacy-band-' || tenant_id || '-' || COALESCE(CAST(pax_from AS TEXT), '1') || '-' || COALESCE(CAST(pax_to AS TEXT), '2'), COALESCE(currency, 'VND'), adult_price, CASE WHEN single_supp IS NULL THEN NULL ELSE adult_price + single_supp END, child_price, 'Migrated from legacy pricing foundation', 1, COALESCE(CAST(effective_from / 1000 AS INTEGER), CAST(strftime('%s','now') AS INTEGER)) FROM tour_prices_legacy_backup;"
  fi
}

case "$TARGET" in
  local)
    rescue_local_tenant_email_migration
    rescue_local_historical_schema_drift
    npx wrangler d1 migrations apply "$DB_NAME" --local
    ;;
  preview|remote)
    rescue_remote_legacy_pricing_foundation
    npx wrangler d1 migrations apply "$DB_NAME" --remote
    migrate_remote_legacy_pricing_backup
    ;;
  *)
    echo "Usage: $0 [local|preview|remote]" >&2
    exit 1
    ;;
esac
