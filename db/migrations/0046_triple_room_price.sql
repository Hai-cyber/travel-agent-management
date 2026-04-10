-- Migration 0046: Add triple room pricing support
-- Adds a nullable adult_triple_room_price column to tour_prices.
-- NULL = use adult_shared_room_price as fallback on the API side.
ALTER TABLE tour_prices ADD COLUMN adult_triple_room_price INTEGER;
