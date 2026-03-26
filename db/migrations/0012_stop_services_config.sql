-- Migration 0012: Add services_config column to tour_stops
-- Stores per-stop service planning flags as a JSON blob.
-- Format: { "hotel": 1, "guide": 1, "local": ["car4","bus"], "intercity": ["train"] }
ALTER TABLE tour_stops ADD COLUMN services_config TEXT NOT NULL DEFAULT '{}';
