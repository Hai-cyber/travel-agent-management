-- =========================
-- TENANT
-- =========================
INSERT OR IGNORE INTO tenants (id, slug, name, created_at)
VALUES ('ten-demo-001', 'demo-agency', 'Demo Travel Agency', strftime('%s','now'));

-- =========================
-- TOUR
-- =========================
INSERT OR IGNORE INTO tours (id, name, description, created_at)
VALUES (1, 'Demo Tour', 'First tour', strftime('%s','now'));

-- =========================
-- DESTINATION
-- =========================
INSERT OR IGNORE INTO destinations (id, code, name, is_active, created_at)
VALUES (1, 'demo-destination', 'Demo Destination', 1, strftime('%s','now'));

-- =========================
-- DESTINATION TEXT
-- =========================
INSERT OR IGNORE INTO destination_texts (id, destination_id, lang_code, title, summary, content, created_at)
VALUES (
  1,
  1,
  'vi',
  'Điểm đến demo',
  'Mô tả ngắn demo',
  'Nội dung dài demo cho destination đầu tiên.',
  strftime('%s','now')
);

-- =========================
-- TOUR STOP
-- =========================
INSERT OR IGNORE INTO tour_stops (
  id, tenant_id, tour_id, destination_id,
  label, day_from, day_to, nights,
  meal_breakfast, meal_lunch, meal_dinner,
  description, sort_order, created_at
)
VALUES (
  1, 'ten-demo-001', 1, 1,
  'Hanoi Arrival', 1, 1, 1,
  0, 0, 1,
  'Arrival in Hanoi', 1, strftime('%s','now')
);

-- =========================
-- SERVICE TYPES
-- =========================
INSERT OR IGNORE INTO service_types (id, code, name, sort_order, is_active, created_at)
VALUES ('svc-accommodation', 'accommodation', 'Accommodation', 1, 1, strftime('%s','now'));

INSERT OR IGNORE INTO service_types (id, code, name, sort_order, is_active, created_at)
VALUES ('svc-meals', 'meals', 'Meals', 2, 1, strftime('%s','now'));

INSERT OR IGNORE INTO service_types (id, code, name, sort_order, is_active, created_at)
VALUES ('svc-guide', 'guide', 'Guide', 3, 1, strftime('%s','now'));

INSERT OR IGNORE INTO service_types (id, code, name, sort_order, is_active, created_at)
VALUES ('svc-local-transport', 'local_transport', 'Local Transport', 4, 1, strftime('%s','now'));

INSERT OR IGNORE INTO service_types (id, code, name, sort_order, is_active, created_at)
VALUES ('svc-intercity-transport', 'intercity_transport', 'Intercity Transport', 5, 1, strftime('%s','now'));

-- =========================
-- SERVICE FLAGS
-- =========================
INSERT OR IGNORE INTO tour_stop_service_flags (
  id, tenant_id, tour_stop_id, service_type_id, is_enabled, created_at
)
VALUES ('flag-001', 'ten-demo-001', 1, 'svc-accommodation', 1, strftime('%s','now'));

INSERT OR IGNORE INTO tour_stop_service_flags (
  id, tenant_id, tour_stop_id, service_type_id, is_enabled, created_at
)
VALUES ('flag-002', 'ten-demo-001', 1, 'svc-meals', 1, strftime('%s','now'));

-- =========================
-- ACCOMMODATION
-- =========================
INSERT OR IGNORE INTO stop_accommodations (
  id, tenant_id, tour_stop_id,
  person_in_charge, hotel_name,
  contact_name, contact_phone, contact_email,
  address,
  check_in, check_out,
  room_type, guests,
  notes, stage, status,
  position, created_at
)
VALUES (
  'acc-001', 'ten-demo-001', 1,
  'Anna', 'Demo Hotel Hanoi',
  'Supplier A', '+84900000001', 'supplier@example.com',
  '123 Hanoi',
  strftime('%s','now'), strftime('%s','now') + 86400,
  'Deluxe', 2,
  'Demo accommodation for Hanoi Arrival',
  'pending', 'planned',
  1, strftime('%s','now')
);

-- =========================
-- PRICING
-- =========================
INSERT OR IGNORE INTO tenant_seasons (
  id, tenant_id, name,
  start_month, start_day,
  end_month, end_day,
  sort_order, is_active, notes, created_at
)
VALUES (
  'season-high', 'ten-demo-001', 'High Season',
  10, 1, 4, 30,
  1, 1, 'Recurring high season', strftime('%s','now')
);

INSERT OR IGNORE INTO pricing_segments (
  id, tenant_id, code, name, description, sort_order, is_active, created_at
)
VALUES (
  'segment-standard', 'ten-demo-001', 'standard', 'Standard',
  '3-4 star hotels, shared touring style, value-focused package.',
  1, 1, strftime('%s','now')
);

INSERT OR IGNORE INTO pax_bands (
  id, tenant_id, name, min_pax, max_pax, sort_order, is_active, created_at
)
VALUES (
  'pax-2', 'ten-demo-001', '2 Pax', 2, 2, 1, 1, strftime('%s','now')
);

INSERT OR IGNORE INTO tour_prices (
  id, tenant_id, tour_id,
  season_id, segment_id, pax_band_id,
  base_currency,
  adult_shared_room_price,
  adult_single_room_price,
  child_shared_with_parents_price,
  notes, is_active, created_at
)
VALUES (
  'price-001', 'ten-demo-001', 1,
  'season-high', 'segment-standard', 'pax-2',
  'USD',
  256, 320, 150,
  'Demo Standard pricing for 2 pax in high season',
  1, strftime('%s','now')
);

-- =========================
-- COMMUNICATION
-- =========================
INSERT OR IGNORE INTO comm_threads (
  id, tenant_id, entity_type, entity_id
)
VALUES (
  'thread-acc-001', 'ten-demo-001', 'stop_accommodation', 'acc-001'
);

INSERT OR IGNORE INTO comm_messages (
  id, tenant_id, thread_id,
  channel, direction, subject,
  body, to_addr, from_addr, created_by, created_at
)
VALUES (
  'msg-001', 'ten-demo-001', 'thread-acc-001',
  'email', 'outbound', 'Hotel confirm',
  'Please confirm',
  'supplier@example.com', 'agent@example.com', 'user-demo',
  strftime('%s','now')
);

-- =========================
-- TASK
-- =========================
INSERT OR IGNORE INTO tasks (
  id, tenant_id,
  booking_id,
  service_entity_type, service_entity_id,
  title, due_at, status, last_notice_at
)
VALUES (
  'task-001', 'ten-demo-001',
  'booking-demo-001',
  'stop_accommodation', 'acc-001',
  'Confirm hotel',
  strftime('%s','now') + 86400,
  'pending',
  NULL
);

-- =========================
-- REMINDER LOG
-- =========================
INSERT OR IGNORE INTO task_reminder_logs (
  id, tenant_id, task_id, reminder_key, sent_at
)
VALUES (
  'reminder-001', 'ten-demo-001', 'task-001', '30d', strftime('%s','now')
);

-- =========================
-- CALENDAR CONFIG
-- =========================
INSERT OR IGNORE INTO tenant_calendar_configs (
  tenant_id, google_calendar_id, ios_calendar_url, timezone, flags_json, updated_at
)
VALUES (
  'ten-demo-001',
  'demo-google-calendar',
  'webcal://demo.example.com/calendar.ics',
  'Asia/Ho_Chi_Minh',
  '{"google":true,"ios":true}',
  strftime('%s','now')
);