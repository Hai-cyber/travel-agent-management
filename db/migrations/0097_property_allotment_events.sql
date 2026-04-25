-- Migration 0097: property allotment lifecycle audit trail

CREATE TABLE IF NOT EXISTS property_allotment_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  allotment_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_user_id TEXT,
  payload_json TEXT,
  created_at INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (allotment_id) REFERENCES property_allotments(id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_property_allotment_events_allotment_time
  ON property_allotment_events (tenant_id, property_id, allotment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_allotment_events_action
  ON property_allotment_events (tenant_id, property_id, action, created_at DESC);