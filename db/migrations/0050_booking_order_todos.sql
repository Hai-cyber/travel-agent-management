-- Migration: 0050_booking_order_todos.sql
-- Service checklist / todo items per booking order.
-- Option B (proper table): queryable, supports future done_by / notification hooks.

CREATE TABLE IF NOT EXISTS booking_order_todos (
  id         TEXT    PRIMARY KEY,
  tenant_id  TEXT    NOT NULL,
  order_id   TEXT    NOT NULL,
  stop_id    INTEGER,              -- NULL for custom (manually added) tasks
  title      TEXT    NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  done_at    INTEGER,              -- unix seconds, set when marked done
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (order_id) REFERENCES booking_orders(id)
);

CREATE INDEX IF NOT EXISTS idx_bot_order_tenant ON booking_order_todos(order_id, tenant_id);
