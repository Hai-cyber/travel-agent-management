-- 0038_max_children_per_two_adults.sql
-- Tenant-configurable cap for child-with-parents pricing.

ALTER TABLE tenants ADD COLUMN max_children_per_two_adults INTEGER NOT NULL DEFAULT 1;

UPDATE tenants
   SET max_children_per_two_adults = COALESCE(max_children_per_two_adults, 1)
 WHERE max_children_per_two_adults IS NULL;