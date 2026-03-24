-- 0005_prepare_tasks_and_comms_alignment.sql
-- Prepare canonical tasks, communications, reminder logs, and calendar config
-- Rescue-safe, additive only
-- No drops, no destructive renames

-- =====================================
-- COMMUNICATION THREADS PER SERVICE ITEM
-- =====================================

CREATE TABLE IF NOT EXISTS comm_threads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comm_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  to_addr TEXT,
  from_addr TEXT,
  attachments_json TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES comm_threads(id)
);

-- =====================================
-- TASKS PER SERVICE ITEM
-- =====================================

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  booking_id TEXT,
  service_entity_type TEXT,
  service_entity_id TEXT,
  title TEXT NOT NULL,
  due_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','completed','canceled')) DEFAULT 'pending',
  last_notice_at INTEGER
);

-- =====================================
-- REMINDER LOGS
-- Prevent duplicate reminders for the same task cadence key
-- =====================================

CREATE TABLE IF NOT EXISTS task_reminder_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  reminder_key TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  UNIQUE (task_id, reminder_key),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- =====================================
-- TENANT CALENDAR CONFIG
-- Used later for Google preview / ICS generation / timezone
-- =====================================

CREATE TABLE IF NOT EXISTS tenant_calendar_configs (
  tenant_id TEXT PRIMARY KEY,
  google_calendar_id TEXT,
  ios_calendar_url TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  flags_json TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Suggested verification after apply:
-- SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
-- SELECT * FROM comm_threads;
-- SELECT * FROM comm_messages;
-- SELECT * FROM tasks;
-- SELECT * FROM task_reminder_logs;
-- SELECT * FROM tenant_calendar_configs;