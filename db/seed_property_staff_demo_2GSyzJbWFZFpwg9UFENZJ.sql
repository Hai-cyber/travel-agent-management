-- Demo seed for tenant 2GSyzJbWFZFpwg9UFENZJ / property River Suites
--
-- Purpose:
--   - expand room types, room units, and nightly rates for realistic staff-desk testing
--   - create a small set of live reservations covering occupied, departing, checked-out, and arriving flows
--   - seed housekeeping tasks so the rack can demonstrate dirty / cleaning / inspected / clean overlays

UPDATE properties
   SET status = 'active',
       timezone = 'Asia/Ho_Chi_Minh',
       currency = 'VND',
       default_check_in_time = '14:00',
       default_check_out_time = '12:00',
       address_line_1 = '26 Riverside Walk',
       city = 'Da Nang',
       country_code = 'VN',
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND id = 'M3QCy4dcy0Pr1XWeCsXmI';

UPDATE properties
   SET shift_handover_note = 'Demo handover: VIP arrival at 16:30, room 302 departing before 11:00, room 303 queued for turnover, room 202 cleaning in progress.',
       shift_handover_updated_at = unixepoch(),
       shift_handover_updated_by = NULL,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND id = 'M3QCy4dcy0Pr1XWeCsXmI';

UPDATE room_types
   SET name = 'Deluxe King',
       description = 'Updated demo deluxe inventory for front-desk testing.',
       base_capacity = 2,
       max_occupancy = 3,
       active = 1,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND id = 'I_rrS7XtC0SagyNt869n8';

INSERT INTO room_types (id, tenant_id, property_id, code, name, description, base_capacity, max_occupancy, sort_order, active, created_at, updated_at)
SELECT 'rtSup2GSyzSeedA001X', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'SUP', 'Superior Queen', 'Compact queen rooms for short city stays.', 2, 2, 2, 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (
  SELECT 1 FROM room_types WHERE id = 'rtSup2GSyzSeedA001X'
);

INSERT INTO room_types (id, tenant_id, property_id, code, name, description, base_capacity, max_occupancy, sort_order, active, created_at, updated_at)
SELECT 'rtSte2GSyzSeedA002Y', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'STE', 'River Suite', 'Large suite with lounge area and river view.', 2, 4, 3, 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (
  SELECT 1 FROM room_types WHERE id = 'rtSte2GSyzSeedA002Y'
);

INSERT INTO room_types (id, tenant_id, property_id, code, name, description, base_capacity, max_occupancy, sort_order, active, created_at, updated_at)
SELECT 'rtFam2GSyzSeedA003Z', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'FAM', 'Family Loft', 'Two-zone family room for longer stays.', 3, 5, 4, 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (
  SELECT 1 FROM room_types WHERE id = 'rtFam2GSyzSeedA003Z'
);

INSERT INTO room_types (id, tenant_id, property_id, code, name, description, base_capacity, max_occupancy, sort_order, active, created_at, updated_at)
SELECT 'rtSky2GSyzSeedA004Q', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'SKY', 'Skyline Studio', 'Top-floor studio for premium direct bookings.', 2, 3, 5, 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (
  SELECT 1 FROM room_types WHERE id = 'rtSky2GSyzSeedA004Q'
);

UPDATE property_room_rates
   SET rate_name = 'Best Flexible',
       currency = 'VND',
       nightly_amount = 2400000,
       included_adults = 2,
       included_children = 1,
       extra_adult_amount = 450000,
       extra_child_amount = 200000,
       active = 1,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND room_type_id = 'I_rrS7XtC0SagyNt869n8';

INSERT INTO property_room_rates (id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount, active, created_at, updated_at, included_adults, included_children, extra_adult_amount, extra_child_amount)
SELECT 'rrSup2GSyzSeedA100A', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSup2GSyzSeedA001X', 'Best Flexible', 'VND', 1800000, 1, unixepoch(), unixepoch(), 2, 0, 350000, 150000
WHERE NOT EXISTS (SELECT 1 FROM property_room_rates WHERE id = 'rrSup2GSyzSeedA100A');

INSERT INTO property_room_rates (id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount, active, created_at, updated_at, included_adults, included_children, extra_adult_amount, extra_child_amount)
SELECT 'rrSte2GSyzSeedA101B', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSte2GSyzSeedA002Y', 'Best Flexible', 'VND', 3600000, 1, unixepoch(), unixepoch(), 2, 2, 550000, 250000
WHERE NOT EXISTS (SELECT 1 FROM property_room_rates WHERE id = 'rrSte2GSyzSeedA101B');

INSERT INTO property_room_rates (id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount, active, created_at, updated_at, included_adults, included_children, extra_adult_amount, extra_child_amount)
SELECT 'rrFam2GSyzSeedA102C', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtFam2GSyzSeedA003Z', 'Best Flexible', 'VND', 4200000, 1, unixepoch(), unixepoch(), 3, 1, 650000, 250000
WHERE NOT EXISTS (SELECT 1 FROM property_room_rates WHERE id = 'rrFam2GSyzSeedA102C');

INSERT INTO property_room_rates (id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount, active, created_at, updated_at, included_adults, included_children, extra_adult_amount, extra_child_amount)
SELECT 'rrSky2GSyzSeedA103D', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSky2GSyzSeedA004Q', 'Best Flexible', 'VND', 5200000, 1, unixepoch(), unixepoch(), 2, 1, 700000, 250000
WHERE NOT EXISTS (SELECT 1 FROM property_room_rates WHERE id = 'rrSky2GSyzSeedA103D');

INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruSup2012GSyzSeed01', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSup2GSyzSeedA001X', '201', '2', 1, 1, 'ready', 0, 0, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruSup2012GSyzSeed01');
INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruSup2022GSyzSeed02', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSup2GSyzSeedA001X', '202', '2', 2, 1, 'ready', 0, 0, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruSup2022GSyzSeed02');
INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruSup2032GSyzSeed03', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSup2GSyzSeedA001X', '203', '2', 3, 1, 'ready', 0, 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruSup2032GSyzSeed03');
INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruSup2042GSyzSeed04', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSup2GSyzSeedA001X', '204', '2', 4, 1, 'ready', 1, 0, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruSup2042GSyzSeed04');

INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruDlx3012GSyzSeed05', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'I_rrS7XtC0SagyNt869n8', '301', '3', 1, 1, 'ready', 0, 0, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruDlx3012GSyzSeed05');
INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruDlx3022GSyzSeed06', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'I_rrS7XtC0SagyNt869n8', '302', '3', 2, 1, 'ready', 0, 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruDlx3022GSyzSeed06');
INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruDlx3032GSyzSeed07', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'I_rrS7XtC0SagyNt869n8', '303', '3', 3, 1, 'ready', 0, 0, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruDlx3032GSyzSeed07');
INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruDlx3042GSyzSeed08', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'I_rrS7XtC0SagyNt869n8', '304', '3', 4, 1, 'ready', 0, 0, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruDlx3042GSyzSeed08');

INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruSte4022GSyzSeed09', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSte2GSyzSeedA002Y', '402', '4', 2, 1, 'ready', 0, 0, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruSte4022GSyzSeed09');
INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruFam5022GSyzSeed10', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtFam2GSyzSeedA003Z', '502', '5', 2, 1, 'ready', 0, 0, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruFam5022GSyzSeed10');
INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruSky6022GSyzSeed11', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSky2GSyzSeedA004Q', '602', '6', 2, 1, 'ready', 0, 0, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruSky6022GSyzSeed11');

UPDATE room_units
   SET updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND id IN ('ruSup2012GSyzSeed01','ruSup2022GSyzSeed02','ruSup2032GSyzSeed03','ruSup2042GSyzSeed04','ruDlx3012GSyzSeed05','ruDlx3022GSyzSeed06','ruDlx3032GSyzSeed07','ruDlx3042GSyzSeed08','ruSte4022GSyzSeed09','ruFam5022GSyzSeed10','ruSky6022GSyzSeed11');

DELETE FROM housekeeping_tasks
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND id IN ('hkPnd2GSyzSeed0001A','hkPrg2GSyzSeed0002B','hkIns2GSyzSeed0003C');

DELETE FROM room_state_events
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND id IN ('rsEvt2GSyzSeed0001A','rsEvt2GSyzSeed0002B','rsEvt2GSyzSeed0003C','rsEvt2GSyzSeed0004D');

DELETE FROM property_reservations
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND id IN ('resOcc2GSyzSeed0001A','resDep2GSyzSeed0002B','resOut2GSyzSeed0003C','resArr2GSyzSeed0004D','resFam2GSyzSeed0005E');

INSERT INTO property_reservations (
  id, tenant_id, property_id, source, source_ref, source_payload, status,
  guest_name, guest_email, guest_phone, check_in, check_out, room_type_id, rooms_requested, adults, children,
  pricing_snapshot, special_requests, expected_arrival_time, expected_flight_ref, expected_arrival_channel,
  airport_transfer_requested, airport_transfer_price_snapshot, cancellation_policy_snapshot,
  confirmed_at, confirmed_by, cancelled_at, cancelled_by, cancel_reason, created_at, updated_at, assigned_room_unit_id,
  guest_photo_key, guest_photo_uploaded_at
) VALUES
(
  'resOcc2GSyzSeed0001A', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'manual_frontdesk', 'DEMO-OCC', '{"seed":"property_staff_demo"}', 'checked_in',
  'Linh Tran', 'linh.tran@example.com', '+84901234501', date('now','-1 day'), date('now','+2 day'), 'I_rrS7XtC0SagyNt869n8', 1, 2, 0,
  json_object('currency','VND','nightly_amount',2400000,'total_amount',7200000), 'Late arrival noted', '15:30', NULL, 'walk_in',
  0, NULL, NULL, unixepoch('now','-2 day'), NULL, NULL, NULL, NULL, unixepoch('now','-2 day'), unixepoch(), 'ruDlx3012GSyzSeed05', NULL, NULL
),
(
  'resDep2GSyzSeed0002B', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'manual_frontdesk', 'DEMO-DEP', '{"seed":"property_staff_demo"}', 'checked_in',
  'Minh Vo', 'minh.vo@example.com', '+84901234502', date('now','-2 day'), date('now'), 'I_rrS7XtC0SagyNt869n8', 1, 2, 0,
  json_object('currency','VND','nightly_amount',2400000,'total_amount',4800000), 'Checkout before noon', '09:30', NULL, 'direct',
  0, NULL, NULL, unixepoch('now','-3 day'), NULL, NULL, NULL, NULL, unixepoch('now','-3 day'), unixepoch(), 'ruDlx3022GSyzSeed06', NULL, NULL
),
(
  'resOut2GSyzSeed0003C', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'manual_frontdesk', 'DEMO-OUT', '{"seed":"property_staff_demo"}', 'checked_out',
  'An Nguyen', 'an.nguyen@example.com', '+84901234503', date('now','-2 day'), date('now'), 'I_rrS7XtC0SagyNt869n8', 1, 2, 1,
  json_object('currency','VND','nightly_amount',2400000,'total_amount',4800000), 'Needs quick turnover', '08:00', NULL, 'ota',
  0, NULL, NULL, unixepoch('now','-3 day'), NULL, NULL, NULL, NULL, unixepoch('now','-3 day'), unixepoch(), 'ruDlx3032GSyzSeed07', NULL, NULL
),
(
  'resArr2GSyzSeed0004D', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'direct_web', 'DEMO-ARR', '{"seed":"property_staff_demo"}', 'confirmed',
  'Bao Pham', 'bao.pham@example.com', '+84901234504', date('now'), date('now','+2 day'), 'I_rrS7XtC0SagyNt869n8', 1, 2, 0,
  json_object('currency','VND','nightly_amount',2400000,'total_amount',4800000), 'Airport pickup requested', '16:30', 'VN132', 'flight',
  1, json_object('currency','VND','amount',350000), NULL, unixepoch('now','-1 day'), NULL, NULL, NULL, NULL, unixepoch('now','-1 day'), unixepoch(), 'ruDlx3042GSyzSeed08', NULL, NULL
),
(
  'resFam2GSyzSeed0005E', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'manual_frontdesk', 'DEMO-FAM', '{"seed":"property_staff_demo"}', 'checked_in',
  'Family Le', 'family.le@example.com', '+84901234505', date('now','-1 day'), date('now','+3 day'), 'rtFam2GSyzSeedA003Z', 1, 2, 2,
  json_object('currency','VND','nightly_amount',4200000,'total_amount',16800000), 'Baby cot requested', '14:30', NULL, 'direct',
  0, NULL, NULL, unixepoch('now','-2 day'), NULL, NULL, NULL, NULL, unixepoch('now','-2 day'), unixepoch(), 'ruFam5022GSyzSeed10', NULL, NULL
);

INSERT INTO housekeeping_tasks (id, tenant_id, property_id, room_unit_id, reservation_id, priority, status, scheduled_for, started_at, completed_at, assigned_user_id, note, created_at, updated_at) VALUES
('hkPnd2GSyzSeed0001A', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'ruDlx3032GSyzSeed07', 'resOut2GSyzSeed0003C', 'departure_clean', 'pending', unixepoch(date('now')), NULL, NULL, NULL, 'Checkout completed, room needs immediate turnover.', unixepoch(), unixepoch()),
('hkPrg2GSyzSeed0002B', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'ruSup2022GSyzSeed02', NULL, 'routine', 'in_progress', unixepoch(date('now')), unixepoch('now','-2 hours'), NULL, NULL, 'Bathroom refresh and linen change in progress.', unixepoch(), unixepoch()),
('hkIns2GSyzSeed0003C', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'ruSup2032GSyzSeed03', NULL, 'routine', 'waiting_inspection', unixepoch(date('now')), unixepoch('now','-4 hours'), NULL, NULL, 'Cleaning complete, waiting for supervisor inspection.', unixepoch(), unixepoch());

INSERT INTO room_state_events (id, tenant_id, property_id, room_unit_id, reservation_id, previous_state, new_state, note, changed_by, created_at) VALUES
('rsEvt2GSyzSeed0001A', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'ruDlx3032GSyzSeed07', 'resOut2GSyzSeed0003C', 'occupied', 'dirty', 'Guest checked out and room is queued for housekeeping.', NULL, unixepoch()),
('rsEvt2GSyzSeed0002B', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'ruSup2022GSyzSeed02', NULL, 'dirty', 'cleaning', 'Housekeeper is cleaning the room.', NULL, unixepoch()),
('rsEvt2GSyzSeed0003C', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'ruSup2032GSyzSeed03', NULL, 'cleaning', 'inspected', 'Supervisor inspection is pending final release.', NULL, unixepoch()),
('rsEvt2GSyzSeed0004D', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'ruSup2012GSyzSeed01', NULL, 'inspected', 'ready', 'Room released as clean and ready for sale.', NULL, unixepoch());