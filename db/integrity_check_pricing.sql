-- ============================================================
-- PRICING DATA INTEGRITY VERIFICATION SCRIPT
-- Run against local D1 after applying migration 0004
-- Usage: npx wrangler d1 execute DB --local --file=db/integrity_check_pricing.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABLE EXISTENCE
-- Expect: all 4 tables are listed
-- ------------------------------------------------------------
SELECT name FROM sqlite_master
WHERE type = 'table'
  AND name IN ('tenant_seasons', 'pricing_segments', 'pax_bands', 'tour_prices')
ORDER BY name;

-- ------------------------------------------------------------
-- 2. DUPLICATE PRICE ROWS (missing UNIQUE constraint)
-- Expect: 0 rows returned
-- A result means multiple prices exist for the same combination
-- ------------------------------------------------------------
SELECT tenant_id, tour_id, season_id, segment_id, pax_band_id,
       COUNT(*) AS duplicate_count
FROM tour_prices
GROUP BY tenant_id, tour_id, season_id, segment_id, pax_band_id
HAVING COUNT(*) > 1;

-- ------------------------------------------------------------
-- 3. CROSS-TENANT SEASON REFERENCE IN tour_prices
-- Expect: 0 rows returned
-- A result means a price row references a season from a different tenant
-- ------------------------------------------------------------
SELECT tp.id        AS price_id,
       tp.tenant_id AS price_tenant,
       ts.tenant_id AS season_tenant,
       tp.season_id
FROM tour_prices tp
JOIN tenant_seasons ts ON tp.season_id = ts.id
WHERE tp.tenant_id != ts.tenant_id;

-- ------------------------------------------------------------
-- 4. CROSS-TENANT SEGMENT REFERENCE IN tour_prices
-- Expect: 0 rows returned
-- ------------------------------------------------------------
SELECT tp.id        AS price_id,
       tp.tenant_id AS price_tenant,
       ps.tenant_id AS segment_tenant,
       tp.segment_id
FROM tour_prices tp
JOIN pricing_segments ps ON tp.segment_id = ps.id
WHERE tp.tenant_id != ps.tenant_id;

-- ------------------------------------------------------------
-- 5. CROSS-TENANT PAX BAND REFERENCE IN tour_prices
-- Expect: 0 rows returned
-- ------------------------------------------------------------
SELECT tp.id        AS price_id,
       tp.tenant_id AS price_tenant,
       pb.tenant_id AS band_tenant,
       tp.pax_band_id
FROM tour_prices tp
JOIN pax_bands pb ON tp.pax_band_id = pb.id
WHERE tp.tenant_id != pb.tenant_id;

-- ------------------------------------------------------------
-- 6. INVALID PAX BAND RANGES (min_pax > max_pax)
-- Expect: 0 rows returned
-- ------------------------------------------------------------
SELECT id, tenant_id, name, min_pax, max_pax
FROM pax_bands
WHERE min_pax > max_pax;

-- ------------------------------------------------------------
-- 7. OVERLAPPING PAX BANDS WITHIN SAME TENANT
-- Expect: 0 rows returned
-- A result means two bands in the same tenant have overlapping ranges,
-- causing ambiguous price lookups (e.g. pax=4 matches both 1-5 and 3-8)
-- ------------------------------------------------------------
SELECT a.id        AS band_a_id,
       b.id        AS band_b_id,
       a.tenant_id,
       a.min_pax   AS a_min,
       a.max_pax   AS a_max,
       b.min_pax   AS b_min,
       b.max_pax   AS b_max
FROM pax_bands a
JOIN pax_bands b ON a.tenant_id = b.tenant_id AND a.id < b.id
WHERE a.max_pax > b.min_pax
  AND b.max_pax > a.min_pax;

-- ------------------------------------------------------------
-- 8. INVALID SEASON MONTH/DAY VALUES
-- Expect: 0 rows returned
-- ------------------------------------------------------------
SELECT id, tenant_id, name,
       start_month, start_day,
       end_month, end_day
FROM tenant_seasons
WHERE start_month < 1 OR start_month > 12
   OR end_month   < 1 OR end_month   > 12
   OR start_day   < 1 OR start_day   > 31
   OR end_day     < 1 OR end_day     > 31;

-- ------------------------------------------------------------
-- 9. OVERLAPPING ACTIVE SEASONS WITHIN SAME TENANT
-- Uses (month * 100 + day) as a comparable integer within a year
-- Expect: 0 rows returned
-- A result means two active seasons overlap, causing ambiguous
-- season matching for a booking date
-- ------------------------------------------------------------
SELECT a.id        AS season_a,
       b.id        AS season_b,
       a.tenant_id,
       a.start_month, a.start_day, a.end_month, a.end_day,
       b.start_month AS b_start_month, b.start_day AS b_start_day,
       b.end_month   AS b_end_month,   b.end_day   AS b_end_day
FROM tenant_seasons a
JOIN tenant_seasons b ON a.tenant_id = b.tenant_id AND a.id < b.id
WHERE a.is_active = 1
  AND b.is_active = 1
  AND (a.start_month * 100 + a.start_day) <= (b.end_month   * 100 + b.end_day)
  AND (b.start_month * 100 + b.start_day) <= (a.end_month   * 100 + a.end_day);

-- ------------------------------------------------------------
-- 10. ACTIVE PRICE ROWS REFERENCING INACTIVE SEASONS
-- Expect: 0 rows returned
-- ------------------------------------------------------------
SELECT tp.id AS price_id, tp.season_id, ts.name AS season_name
FROM tour_prices tp
JOIN tenant_seasons ts ON tp.season_id = ts.id
WHERE tp.is_active = 1
  AND ts.is_active = 0;

-- ------------------------------------------------------------
-- 11. ACTIVE PRICE ROWS REFERENCING INACTIVE SEGMENTS
-- Expect: 0 rows returned
-- ------------------------------------------------------------
SELECT tp.id AS price_id, tp.segment_id, ps.name AS segment_name
FROM tour_prices tp
JOIN pricing_segments ps ON tp.segment_id = ps.id
WHERE tp.is_active = 1
  AND ps.is_active = 0;

-- ------------------------------------------------------------
-- 12. ACTIVE PRICE ROWS REFERENCING INACTIVE PAX BANDS
-- Expect: 0 rows returned
-- ------------------------------------------------------------
SELECT tp.id AS price_id, tp.pax_band_id, pb.name AS band_name
FROM tour_prices tp
JOIN pax_bands pb ON tp.pax_band_id = pb.id
WHERE tp.is_active = 1
  AND pb.is_active = 0;

-- ------------------------------------------------------------
-- 13. NEGATIVE OR ZERO PRICES
-- Expect: 0 rows returned
-- NOTE: NULL prices are allowed (optional price fields)
-- ------------------------------------------------------------
SELECT id,
       adult_shared_room_price,
       adult_single_room_price,
       child_shared_with_parents_price
FROM tour_prices
WHERE (adult_shared_room_price IS NOT NULL AND adult_shared_room_price <= 0)
   OR (adult_single_room_price IS NOT NULL AND adult_single_room_price <= 0)
   OR (child_shared_with_parents_price IS NOT NULL AND child_shared_with_parents_price <= 0);

-- ------------------------------------------------------------
-- 14. PRICE ROWS REFERENCING NON-EXISTENT TOURS
-- Expect: 0 rows returned
-- ------------------------------------------------------------
SELECT tp.id AS price_id, tp.tour_id
FROM tour_prices tp
LEFT JOIN tours t ON tp.tour_id = t.id
WHERE t.id IS NULL;

-- ------------------------------------------------------------
-- 15. STRUCTURAL INDEX PRESENCE CHECK
-- Expect: indexes on all FK columns of the pricing tables
-- Missing entries indicate slow join performance risk
-- ------------------------------------------------------------
SELECT name, tbl_name
FROM sqlite_master
WHERE type = 'index'
  AND tbl_name IN ('tour_prices', 'tenant_seasons', 'pricing_segments', 'pax_bands')
ORDER BY tbl_name, name;
