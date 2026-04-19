-- Migration 0060: Property foundation
--
-- Purpose:
--   - add the top-level property entity for the future property engine
--   - store property-scoped policies required by availability-first rollout
--
-- Notes:
--   - product scope may begin with one property per tenant
--   - schema supports multiple properties per tenant for future expansion

CREATE TABLE IF NOT EXISTS properties (
  id                               TEXT PRIMARY KEY,
  tenant_id                        TEXT    NOT NULL,
  name                             TEXT    NOT NULL,
  slug                             TEXT    NOT NULL,
  status                           TEXT    NOT NULL DEFAULT 'active'
                                           CHECK (status IN ('draft', 'active', 'inactive')),
  timezone                         TEXT    NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  currency                         TEXT    NOT NULL DEFAULT 'VND',
  default_check_in_time            TEXT    NOT NULL DEFAULT '14:00',
  default_check_out_time           TEXT    NOT NULL DEFAULT '11:00',
  split_stay_enabled               INTEGER NOT NULL DEFAULT 1,
  split_stay_public_visible        INTEGER NOT NULL DEFAULT 0,
  allow_upgrade_to_preserve_stay   INTEGER NOT NULL DEFAULT 1,
  upgrade_mode                     TEXT    NOT NULL DEFAULT 'suggest_only'
                                           CHECK (upgrade_mode IN ('off', 'suggest_only', 'auto_if_penalty_better')),
  max_room_moves_per_reservation   INTEGER NOT NULL DEFAULT 1,
  max_upgrade_segments_per_stay    INTEGER NOT NULL DEFAULT 1,
  max_upgrade_level_jump           INTEGER NOT NULL DEFAULT 1,
  same_day_turnover_sellable       INTEGER NOT NULL DEFAULT 0,
  created_at                       INTEGER NOT NULL,
  updated_at                       INTEGER NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_properties_tenant_status
  ON properties (tenant_id, status);
