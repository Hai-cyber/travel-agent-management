CREATE TABLE IF NOT EXISTS stop_service_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  service_item_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
