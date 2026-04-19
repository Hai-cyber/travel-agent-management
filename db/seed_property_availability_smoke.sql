-- Property availability smoke fixture
--
-- Purpose:
--   - seed a minimal property dataset for local availability + hold endpoint verification
--   - keep the fixture idempotent so it can be re-applied during smoke runs

DELETE FROM reservation_allocations WHERE tenant_id = 'ten-demo-001' AND property_id = 'prop-demo-001';
DELETE FROM reservation_stay_plan_segments WHERE tenant_id = 'ten-demo-001' AND property_id = 'prop-demo-001';
DELETE FROM reservation_stay_plans WHERE tenant_id = 'ten-demo-001' AND property_id = 'prop-demo-001';
DELETE FROM inventory_holds WHERE tenant_id = 'ten-demo-001' AND property_id = 'prop-demo-001';
DELETE FROM property_reservations WHERE tenant_id = 'ten-demo-001' AND property_id = 'prop-demo-001';
DELETE FROM room_units WHERE tenant_id = 'ten-demo-001' AND property_id = 'prop-demo-001';
DELETE FROM room_types WHERE tenant_id = 'ten-demo-001' AND property_id = 'prop-demo-001';
DELETE FROM properties WHERE tenant_id = 'ten-demo-001' AND id = 'prop-demo-001';

INSERT INTO properties (
  id, tenant_id, name, slug, status, timezone, currency,
  default_check_in_time, default_check_out_time,
  split_stay_enabled, split_stay_public_visible,
  allow_upgrade_to_preserve_stay, upgrade_mode,
  max_room_moves_per_reservation, max_upgrade_segments_per_stay, max_upgrade_level_jump,
  same_day_turnover_sellable, created_at, updated_at
) VALUES (
  'prop-demo-001', 'ten-demo-001', 'Smoke Lagoon Lodge', 'smoke-lagoon-lodge', 'active', 'Asia/Ho_Chi_Minh', 'USD',
  '14:00', '11:00',
  1, 0,
  1, 'suggest_only',
  1, 1, 1,
  0, 1760000000, 1760000000
);

INSERT INTO room_types (
  id, tenant_id, property_id, code, name, description, base_capacity, max_occupancy, sort_order, active, created_at, updated_at
) VALUES
  ('rt-standard-001', 'ten-demo-001', 'prop-demo-001', 'STD', 'Standard', 'Standard room', 2, 2, 10, 1, 1760000000, 1760000000),
  ('rt-deluxe-001', 'ten-demo-001', 'prop-demo-001', 'DLX', 'Deluxe', 'Deluxe room', 2, 2, 20, 1, 1760000000, 1760000000);

INSERT INTO room_units (
  id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, created_at, updated_at
) VALUES
  ('ru-std-101', 'ten-demo-001', 'prop-demo-001', 'rt-standard-001', '101', '1', 10, 1, 'ready', 1760000000, 1760000000),
  ('ru-std-102', 'ten-demo-001', 'prop-demo-001', 'rt-standard-001', '102', '1', 20, 1, 'ready', 1760000000, 1760000000),
  ('ru-dlx-201', 'ten-demo-001', 'prop-demo-001', 'rt-deluxe-001', '201', '2', 10, 1, 'ready', 1760000000, 1760000000);

INSERT INTO property_reservations (
  id, tenant_id, property_id, source, source_ref, source_payload, status,
  guest_name, guest_email, guest_phone,
  check_in, check_out, room_type_id, rooms_requested, adults, children,
  pricing_snapshot, special_requests,
  expected_arrival_time, expected_flight_ref, expected_arrival_channel,
  airport_transfer_requested, airport_transfer_price_snapshot, cancellation_policy_snapshot,
  confirmed_at, confirmed_by, cancelled_at, cancelled_by, cancel_reason,
  created_at, updated_at
) VALUES (
  'pres-demo-001', 'ten-demo-001', 'prop-demo-001', 'manual_frontdesk', 'smoke-ref-001', '{}', 'confirmed',
  'Smoke Guest', 'smoke@example.com', '+84000000000',
  '2026-05-02', '2026-05-03', 'rt-standard-001', 1, 2, 0,
  '{"total":100}', NULL,
  '16:00', NULL, 'self-arrival',
  0, NULL, '{"policy":"flex"}',
  1760000000, NULL, NULL, NULL, NULL,
  1760000000, 1760000000
);

INSERT INTO reservation_stay_plans (
  id, tenant_id, property_id, reservation_id, plan_type, score, move_count, upgrade_segments,
  public_visible, is_selected, status, meta_json, created_at, updated_at
) VALUES (
  'rsp-demo-001', 'ten-demo-001', 'prop-demo-001', 'pres-demo-001', 'contiguous_same_type', 10, 0, 0,
  1, 1, 'locked', '{}', 1760000000, 1760000000
);

INSERT INTO reservation_stay_plan_segments (
  id, tenant_id, property_id, reservation_id, stay_plan_id, segment_order,
  room_type_id, room_unit_id, check_in, check_out, segment_type, upgrade_applied, ops_notes, created_at
) VALUES (
  'rsps-demo-001', 'ten-demo-001', 'prop-demo-001', 'pres-demo-001', 'rsp-demo-001', 1,
  'rt-standard-001', 'ru-std-101', '2026-05-02', '2026-05-03', 'base', 0, NULL, 1760000000
);

INSERT INTO reservation_allocations (
  id, tenant_id, property_id, reservation_id, stay_plan_id, room_unit_id, stay_date, allocation_status, created_at, updated_at
) VALUES (
  'ra-demo-001', 'ten-demo-001', 'prop-demo-001', 'pres-demo-001', 'rsp-demo-001', 'ru-std-101', '2026-05-02', 'locked', 1760000000, 1760000000
);