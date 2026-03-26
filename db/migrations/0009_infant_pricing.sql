-- 0009_infant_pricing.sql
-- Hỗ trợ giá Trẻ sơ sinh (Infants 0-2 tuổi) trong Pricing Engine.
-- infant_price: giá per-infant, mặc định 0 (miễn phí).
-- infant_policy_text: điều khoản áp dụng của tenant (ngồi chung, babycots...).

ALTER TABLE tour_prices ADD COLUMN infant_price REAL NOT NULL DEFAULT 0;
ALTER TABLE tenants     ADD COLUMN infant_policy_text TEXT;
