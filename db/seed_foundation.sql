-- db/seed_foundation.sql
-- Dữ liệu mẫu nền tảng cho môi trường local/dev
-- Thứ tự INSERT đúng theo FK: tenants → tours → tour_stops
-- Dùng INSERT OR IGNORE để có thể chạy nhiều lần mà không lỗi

-- =========================
-- 1. Tenant mẫu
-- =========================
INSERT OR IGNORE INTO tenants (id, slug, name, created_at)
VALUES ('ten-demo-001', 'demo', 'Demo Agency', 1700000000);

-- =========================
-- 2. Tour mẫu (FK → tenants.id)
-- =========================
INSERT OR IGNORE INTO tours (id, tenant_id, title, lang, status, created_at)
VALUES ('tour-001', 'ten-demo-001', 'Hà Nội - Ninh Bình 3N2Đ', 'vi', 'draft', 1700000001);

-- =========================
-- 3. Tour stop mẫu (FK → tours.id + tenants.id)
-- =========================
INSERT OR IGNORE INTO tour_stops (id, tenant_id, tour_id, label, day_from, day_to, nights, sort_order, created_at)
VALUES ('stop-001', 'ten-demo-001', 'tour-001', 'Hà Nội', 1, 1, 1, 1, 1700000002);

INSERT OR IGNORE INTO tour_stops (id, tenant_id, tour_id, label, day_from, day_to, nights, sort_order, created_at)
VALUES ('stop-002', 'ten-demo-001', 'tour-001', 'Ninh Bình', 2, 3, 2, 2, 1700000003);
