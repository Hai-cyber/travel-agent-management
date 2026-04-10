-- Migration: add tour_type to tours table
-- Values: 'package' (default, multi-day with overnight stay) | 'day_tour' (no overnight)
ALTER TABLE tours ADD COLUMN tour_type TEXT NOT NULL DEFAULT 'package';
