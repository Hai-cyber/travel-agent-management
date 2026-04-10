-- Add star_rating (1–5, nullable) and region to tenant_universal_hotels
ALTER TABLE tenant_universal_hotels ADD COLUMN star_rating INTEGER DEFAULT NULL;
ALTER TABLE tenant_universal_hotels ADD COLUMN region TEXT NOT NULL DEFAULT '';
