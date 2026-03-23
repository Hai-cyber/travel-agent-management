-- CHK-208 calendar sync + reminder cadence support

CREATE TABLE IF NOT EXISTS tenant_calendar_configs (
	tenant_id TEXT PRIMARY KEY,
	google_calendar_id TEXT,
	ios_calendar_url TEXT,
	timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
	auto_sync_enabled INTEGER NOT NULL DEFAULT 1,
	monthly_reminder_enabled INTEGER NOT NULL DEFAULT 1,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_reminder_logs (
	task_id TEXT NOT NULL,
	reminder_key TEXT NOT NULL,
	sent_at INTEGER NOT NULL,
	PRIMARY KEY (task_id, reminder_key)
);
