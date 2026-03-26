-- 0010_booking_drafts.sql
-- Bảng lưu booking draft (giỏ hàng tạm thời) của khách hàng.
-- snapshot_json: bản chụp toàn bộ kết quả calculateTourPrice tại thời điểm save
--               → giá trị trusted (server-side), không phụ thuộc client.
-- expires_at:   UNIX seconds, draft tự hết hạn sau 24 giờ.

CREATE TABLE IF NOT EXISTS booking_drafts (
  id            TEXT    PRIMARY KEY,
  tenant_id     TEXT    NOT NULL,
  tour_id       TEXT    NOT NULL,
  travel_date   TEXT    NOT NULL,
  segment_id    TEXT,
  status        TEXT    NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'confirmed', 'expired', 'cancelled')),
  snapshot_json TEXT    NOT NULL,
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_booking_drafts_tenant
  ON booking_drafts(tenant_id, status, expires_at);
