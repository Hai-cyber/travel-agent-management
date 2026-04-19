-- Migration 0073: Property rate occupancy adjustments
--
-- Purpose:
--   - extend property pricing v2 with occupancy-aware quote math
--   - keep occupancy surcharge logic on the pricing layer only

ALTER TABLE property_room_rates ADD COLUMN included_adults INTEGER NOT NULL DEFAULT 2;
ALTER TABLE property_room_rates ADD COLUMN included_children INTEGER NOT NULL DEFAULT 0;
ALTER TABLE property_room_rates ADD COLUMN extra_adult_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE property_room_rates ADD COLUMN extra_child_amount REAL NOT NULL DEFAULT 0;

ALTER TABLE property_room_rate_season_prices ADD COLUMN included_adults INTEGER NOT NULL DEFAULT 2;
ALTER TABLE property_room_rate_season_prices ADD COLUMN included_children INTEGER NOT NULL DEFAULT 0;
ALTER TABLE property_room_rate_season_prices ADD COLUMN extra_adult_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE property_room_rate_season_prices ADD COLUMN extra_child_amount REAL NOT NULL DEFAULT 0;