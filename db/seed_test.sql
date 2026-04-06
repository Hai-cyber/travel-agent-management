-- db/seed_test.sql
-- Dữ liệu test cho Pricing module
-- Thứ tự INSERT đúng theo FK: tenants → tours → tenant_seasons → pricing_segments → pax_bands → tour_prices
-- INSERT OR IGNORE: an toàn khi chạy nhiều lần

-- Đảm bảo tenant và tour gốc tồn tại (đã có trong seed_foundation.sql)
INSERT OR IGNORE INTO tenants (id, slug, name, created_at)
VALUES ('ten-demo-001', 'demo', 'Demo Agency', 1700000000);

INSERT OR IGNORE INTO tours (id, tenant_id, title, lang, status, created_at)
VALUES ('tour-001', 'ten-demo-001', 'Hà Nội - Ninh Bình 3N2Đ', 'vi', 'draft', 1700000001);

-- =========================
-- tenant_seasons (FK → tenants.id)
-- =========================
-- High Season intentionally overlaps Low Season from 05/15 → 05/31.
-- Pricing policy must choose High Season during the overlap window.
INSERT OR IGNORE INTO tenant_seasons (id, tenant_id, name, start_month, start_day, end_month, end_day, sort_order, is_active, created_at)
VALUES ('season-high', 'ten-demo-001', 'High Season', 5, 15, 8, 31, 1, 1, 1700000010);

INSERT OR IGNORE INTO tenant_seasons (id, tenant_id, name, start_month, start_day, end_month, end_day, sort_order, is_active, created_at)
VALUES ('season-low', 'ten-demo-001', 'Low Season', 1, 1, 5, 31, 2, 1, 1700000011);

UPDATE tenant_seasons
SET start_month = 5,
    start_day = 15,
    end_month = 8,
    end_day = 31,
    sort_order = 1,
    is_active = 1
WHERE id = 'season-high'
  AND tenant_id = 'ten-demo-001';

UPDATE tenant_seasons
SET start_month = 1,
    start_day = 1,
    end_month = 5,
    end_day = 31,
    sort_order = 2,
    is_active = 1
WHERE id = 'season-low'
  AND tenant_id = 'ten-demo-001';

-- =========================
-- pricing_segments (FK → tenants.id)
-- =========================
INSERT OR IGNORE INTO pricing_segments (id, tenant_id, code, name, sort_order, is_active, created_at)
VALUES ('segment-standard', 'ten-demo-001', 'STD', 'Standard', 1, 1, 1700000020);

-- Tên gọi các segment do tenant tự định nghĩa — có thể PATCH /api/pricing/pricing-segments/:id để đổi
-- Thứ tự ưu tiên: Luxury (cao nhất) > Boutique > Standard
INSERT OR IGNORE INTO pricing_segments (id, tenant_id, code, name, sort_order, is_active, created_at)
VALUES ('segment-vip', 'ten-demo-001', 'LUX', 'Luxury', 1, 1, 1700000021);

INSERT OR IGNORE INTO pricing_segments (id, tenant_id, code, name, sort_order, is_active, created_at)
VALUES ('segment-boutique', 'ten-demo-001', 'BTQ', 'Boutique', 2, 1, 1700000022);

INSERT OR IGNORE INTO pricing_segments (id, tenant_id, code, name, sort_order, is_active, created_at)
VALUES ('segment-standard', 'ten-demo-001', 'STD', 'Standard', 3, 1, 1700000020);

-- Cập nhật nếu đã tồn tại (idempotent)
UPDATE pricing_segments SET code='LUX', name='Luxury',   sort_order=1 WHERE id='segment-vip'      AND tenant_id='ten-demo-001';
UPDATE pricing_segments SET code='BTQ', name='Boutique', sort_order=2 WHERE id='segment-boutique' AND tenant_id='ten-demo-001';
UPDATE pricing_segments SET code='STD', name='Standard', sort_order=3 WHERE id='segment-standard' AND tenant_id='ten-demo-001';

-- =========================
-- pax_bands (FK → tenants.id)
-- =========================
INSERT OR IGNORE INTO pax_bands (id, tenant_id, name, min_pax, max_pax, sort_order, is_active, created_at)
VALUES ('band-01', 'ten-demo-001', '1-5 pax', 1, 5, 1, 1, 1700000030);

INSERT OR IGNORE INTO pax_bands (id, tenant_id, name, min_pax, max_pax, sort_order, is_active, created_at)
VALUES ('band-02', 'ten-demo-001', '6-15 pax', 6, 15, 2, 1, 1700000031);

INSERT OR IGNORE INTO pax_bands (id, tenant_id, name, min_pax, max_pax, sort_order, is_active, created_at)
VALUES ('band-03', 'ten-demo-001', '16-30 pax', 16, 30, 3, 1, 1700000032);

-- =========================
-- Cấu hình đa tiền tệ cho tenant demo (VND, tỷ giá tham khảo)
-- =========================
UPDATE tenants
SET exchange_rate    = 25450,
    target_currency  = 'VND',
    default_locale   = 'vi-VN',
    base_currency    = 'USD'
WHERE id = 'ten-demo-001';

-- =========================
-- tour_prices — Hà Nội - Ninh Bình 3N2Đ (USD)
-- Logic: High Season > Low Season; Single Room > Shared; nhóm nhỏ đắt hơn nhóm lớn
-- =========================
-- High Season / Standard / band-01 (1-5 pax)
INSERT OR IGNORE INTO tour_prices
  (id, tenant_id, tour_id, season_id, segment_id, pax_band_id, base_currency,
   adult_shared_room_price, adult_single_room_price, child_shared_with_parents_price,
   is_active, created_at)
VALUES
  ('price-hs-std-b1', 'ten-demo-001', 'tour-001', 'season-high', 'segment-standard', 'band-01', 'USD',
   680, 820, 410, 1, 1700001001);

-- High Season / Standard / band-02 (6-15 pax)
INSERT OR IGNORE INTO tour_prices
  (id, tenant_id, tour_id, season_id, segment_id, pax_band_id, base_currency,
   adult_shared_room_price, adult_single_room_price, child_shared_with_parents_price,
   is_active, created_at)
VALUES
  ('price-hs-std-b2', 'ten-demo-001', 'tour-001', 'season-high', 'segment-standard', 'band-02', 'USD',
   620, 760, 375, 1, 1700001002);

-- High Season / Standard / band-03 (16-30 pax)
INSERT OR IGNORE INTO tour_prices
  (id, tenant_id, tour_id, season_id, segment_id, pax_band_id, base_currency,
   adult_shared_room_price, adult_single_room_price, child_shared_with_parents_price,
   is_active, created_at)
VALUES
  ('price-hs-std-b3', 'ten-demo-001', 'tour-001', 'season-high', 'segment-standard', 'band-03', 'USD',
   580, 720, 350, 1, 1700001003);

-- Low Season / Standard / band-01 (1-5 pax)
INSERT OR IGNORE INTO tour_prices
  (id, tenant_id, tour_id, season_id, segment_id, pax_band_id, base_currency,
   adult_shared_room_price, adult_single_room_price, child_shared_with_parents_price,
   is_active, created_at)
VALUES
  ('price-ls-std-b1', 'ten-demo-001', 'tour-001', 'season-low', 'segment-standard', 'band-01', 'USD',
   590, 720, 355, 1, 1700001004);

-- Low Season / Standard / band-02 (6-15 pax)
INSERT OR IGNORE INTO tour_prices
  (id, tenant_id, tour_id, season_id, segment_id, pax_band_id, base_currency,
   adult_shared_room_price, adult_single_room_price, child_shared_with_parents_price,
   is_active, created_at)
VALUES
  ('price-ls-std-b2', 'ten-demo-001', 'tour-001', 'season-low', 'segment-standard', 'band-02', 'USD',
   540, 665, 325, 1, 1700001005);

-- Low Season / Standard / band-03 (16-30 pax)
INSERT OR IGNORE INTO tour_prices
  (id, tenant_id, tour_id, season_id, segment_id, pax_band_id, base_currency,
   adult_shared_room_price, adult_single_room_price, child_shared_with_parents_price,
   is_active, created_at)
VALUES
  ('price-ls-std-b3', 'ten-demo-001', 'tour-001', 'season-low', 'segment-standard', 'band-03', 'USD',
   500, 625, 300, 1, 1700001006);

-- High Season / VIP(Luxury) / band-01 — tier cao nhất
INSERT OR IGNORE INTO tour_prices
  (id, tenant_id, tour_id, season_id, segment_id, pax_band_id, base_currency,
   adult_shared_room_price, adult_single_room_price, child_shared_with_parents_price,
   is_active, created_at)
VALUES
  ('price-hs-vip-b1', 'ten-demo-001', 'tour-001', 'season-high', 'segment-vip', 'band-01', 'USD',
   1250, 1490, 750, 1, 1700001007);

-- Low Season / VIP(Luxury) / band-01
INSERT OR IGNORE INTO tour_prices
  (id, tenant_id, tour_id, season_id, segment_id, pax_band_id, base_currency,
   adult_shared_room_price, adult_single_room_price, child_shared_with_parents_price,
   is_active, created_at)
VALUES
  ('price-ls-vip-b1', 'ten-demo-001', 'tour-001', 'season-low', 'segment-vip', 'band-01', 'USD',
   1080, 1290, 648, 1, 1700001008);

-- High Season / Boutique / band-01 — tier giữa
INSERT OR IGNORE INTO tour_prices
  (id, tenant_id, tour_id, season_id, segment_id, pax_band_id, base_currency,
   adult_shared_room_price, adult_single_room_price, child_shared_with_parents_price,
   is_active, created_at)
VALUES
  ('price-hs-btq-b1', 'ten-demo-001', 'tour-001', 'season-high', 'segment-boutique', 'band-01', 'USD',
   950, 1150, 570, 1, 1700001009);

-- Low Season / Boutique / band-01
INSERT OR IGNORE INTO tour_prices
  (id, tenant_id, tour_id, season_id, segment_id, pax_band_id, base_currency,
   adult_shared_room_price, adult_single_room_price, child_shared_with_parents_price,
   is_active, created_at)
VALUES
  ('price-ls-btq-b1', 'ten-demo-001', 'tour-001', 'season-low', 'segment-boutique', 'band-01', 'USD',
   820, 990, 490, 1, 1700001010);

-- Xóa các row ad-hoc (giá 1.500.000 USD không thực tế) đã tạo qua API
DELETE FROM tour_prices
WHERE tenant_id = 'ten-demo-001'
  AND adult_shared_room_price = 1500000;
