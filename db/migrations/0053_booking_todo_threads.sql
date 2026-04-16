-- Migration: 0053_booking_todo_threads.sql
-- Communication thread per todo item.
-- One thread per todo; entries are channel-tagged messages logged
-- when the agent contacts a supplier / adds a note.

CREATE TABLE IF NOT EXISTS booking_todo_threads (
  id          TEXT    PRIMARY KEY,
  tenant_id   TEXT    NOT NULL,
  todo_id     TEXT    NOT NULL,
  order_id    TEXT    NOT NULL,
  -- channel values: phone | whatsapp | zalo | email | note
  channel     TEXT    NOT NULL DEFAULT 'note',
  -- direction: out (agent initiated) | in (reply received) | note (internal)
  direction   TEXT    NOT NULL DEFAULT 'out',
  message     TEXT    NOT NULL,
  sent_by     TEXT    NOT NULL DEFAULT 'agent',
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (todo_id)  REFERENCES booking_order_todos(id),
  FOREIGN KEY (order_id) REFERENCES booking_orders(id)
);

CREATE INDEX IF NOT EXISTS idx_btt_todo    ON booking_todo_threads(todo_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_btt_order   ON booking_todo_threads(order_id, tenant_id);
