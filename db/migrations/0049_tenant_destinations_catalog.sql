-- Migration: 0049_tenant_destinations_catalog.sql
-- The tenant_destinations, tour_destination_links, and tour_hotel_links tables
-- were adopted into migration 0045_show_on_home.sql (via CREATE TABLE IF NOT EXISTS)
-- so that local DBs can be built from scratch. This file is intentionally a no-op
-- and serves only to mark the schema intent in the migration ledger.
SELECT 1;
