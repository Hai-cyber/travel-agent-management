-- 0006_tenant_currency.sql
-- Thêm cấu hình đa tiền tệ vào tenant context
-- Cloudflare D1 (SQLite): ALTER TABLE chỉ hỗ trợ ADD COLUMN

ALTER TABLE tenants ADD COLUMN exchange_rate   REAL NOT NULL DEFAULT 1.0;
ALTER TABLE tenants ADD COLUMN target_currency TEXT NOT NULL DEFAULT 'USD';
