-- 0008_tenant_pricing_policy.sql
-- Thêm pricing_policy vào tenants để Agent tự quản lý qua Admin UI.
-- PRIORITY_HIGH_SEASON: khi giao mùa, chọn season có giá cao nhất.
-- PRIORITY_LOW_SEASON:  khi giao mùa, chọn season có giá thấp nhất.

ALTER TABLE tenants ADD COLUMN pricing_policy TEXT NOT NULL DEFAULT 'PRIORITY_HIGH_SEASON';
