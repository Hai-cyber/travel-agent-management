-- Migration 0090: Housekeeping task kind + service date
--
-- Purpose:
--   - distinguish departure cleaning from occupied-room stayover refresh tasks
--   - make 9:00 local stayover refresh generation idempotent per property/room/date

ALTER TABLE housekeeping_tasks ADD COLUMN task_kind TEXT NOT NULL DEFAULT 'departure_clean';
ALTER TABLE housekeeping_tasks ADD COLUMN service_date TEXT;

UPDATE housekeeping_tasks
   SET service_date = date(scheduled_for, 'unixepoch')
 WHERE service_date IS NULL
   AND scheduled_for IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_housekeeping_tasks_kind_service_date
  ON housekeeping_tasks (tenant_id, property_id, task_kind, service_date, status);
