-- 0007_tenant_locale.sql
-- Thêm cấu hình locale và đồng tiền gốc vào tenant context
-- default_locale: BCP 47 (vi-VN, en-US) — dùng cho Intl.NumberFormat, Intl.DateTimeFormat, translate()
-- base_currency:  đồng tiền cơ sở mà tất cả giá được lưu trong DB (mặc định USD)

ALTER TABLE tenants ADD COLUMN default_locale  TEXT NOT NULL DEFAULT 'en-US';
ALTER TABLE tenants ADD COLUMN base_currency   TEXT NOT NULL DEFAULT 'USD';
