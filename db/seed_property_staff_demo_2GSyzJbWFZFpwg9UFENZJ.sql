-- River Suites 12-month seed for tenant 2GSyzJbWFZFpwg9UFENZJ
--
-- Purpose:
--   - create a stable but varied test fixture for the staff desk and planning grid
--   - guarantee same-day turnover cases on occupied rooms
--   - add full room pricing coverage for Single, Double, Superior, Deluxe, Family, Suite
--   - add two pricing seasons: High Season overrides Low Season on overlap dates
--   - keep the seed idempotent so it can be re-applied safely for testing

UPDATE properties
   SET status = 'active',
       timezone = 'Asia/Ho_Chi_Minh',
       currency = 'VND',
       default_check_in_time = '14:00',
       default_check_out_time = '12:00',
       address_line_1 = '26 Riverside Walk',
       city = 'Da Nang',
       country_code = 'VN',
       shift_handover_note = 'River Suites test seed active: room 302 has same-day turnover, room 303 is dirty after checkout, room 202 is cleaning, room 203 is waiting inspection.',
       shift_handover_updated_at = unixepoch(),
       shift_handover_updated_by = NULL,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND id = 'M3QCy4dcy0Pr1XWeCsXmI';

UPDATE room_types
   SET code = 'DLX',
       name = 'Deluxe',
       description = 'Full river-view deluxe room for front-desk and planning-grid testing.',
       base_capacity = 2,
       max_occupancy = 3,
       sort_order = 4,
       active = 1,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND id = 'I_rrS7XtC0SagyNt869n8';

UPDATE room_types
   SET code = 'SUP',
       name = 'Superior',
       description = 'Superior queen room for short city stays and compact business travel.',
       base_capacity = 2,
       max_occupancy = 2,
       sort_order = 3,
       active = 1,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND id = 'rtSup2GSyzSeedA001X';

UPDATE room_types
   SET code = 'STE',
       name = 'Suite',
       description = 'Suite with lounge area and premium river view.',
       base_capacity = 2,
       max_occupancy = 4,
       sort_order = 6,
       active = 1,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND id = 'rtSte2GSyzSeedA002Y';

UPDATE room_types
   SET code = 'FAM',
       name = 'Family',
       description = 'Two-zone family room for longer stays and multi-child bookings.',
       base_capacity = 3,
       max_occupancy = 5,
       sort_order = 5,
       active = 1,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND id = 'rtFam2GSyzSeedA003Z';

UPDATE room_types
   SET code = 'SKY',
       name = 'Skyline Studio',
       description = 'Top-floor premium studio retained as an extra testable rate tier.',
       base_capacity = 2,
       max_occupancy = 3,
       sort_order = 7,
       active = 1,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND id = 'rtSky2GSyzSeedA004Q';

INSERT INTO room_types (id, tenant_id, property_id, code, name, description, base_capacity, max_occupancy, sort_order, active, created_at, updated_at)
SELECT 'rtSgl2GSyzSeedA005S', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'SGL', 'Single', 'Compact single room for solo travelers.', 1, 1, 1, 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (
  SELECT 1 FROM room_types WHERE id = 'rtSgl2GSyzSeedA005S'
);

INSERT INTO room_types (id, tenant_id, property_id, code, name, description, base_capacity, max_occupancy, sort_order, active, created_at, updated_at)
SELECT 'rtDbl2GSyzSeedA006D', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'DBL', 'Double', 'Classic double room for couples and short leisure stays.', 2, 2, 2, 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (
  SELECT 1 FROM room_types WHERE id = 'rtDbl2GSyzSeedA006D'
);

UPDATE property_room_rates
   SET rate_name = 'Best Flexible',
       currency = 'VND',
       nightly_amount = 1150000,
       included_adults = 1,
       included_children = 0,
       extra_adult_amount = 450000,
       extra_child_amount = 150000,
       active = 1,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND room_type_id = 'rtSgl2GSyzSeedA005S';

INSERT INTO property_room_rates (id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount, active, created_at, updated_at, included_adults, included_children, extra_adult_amount, extra_child_amount)
SELECT 'rrSgl2GSyzSeedA099S', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSgl2GSyzSeedA005S', 'Best Flexible', 'VND', 1150000, 1, unixepoch(), unixepoch(), 1, 0, 450000, 150000
WHERE NOT EXISTS (
  SELECT 1 FROM property_room_rates WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ' AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI' AND room_type_id = 'rtSgl2GSyzSeedA005S'
);

UPDATE property_room_rates
   SET rate_name = 'Best Flexible',
       currency = 'VND',
       nightly_amount = 1550000,
       included_adults = 2,
       included_children = 0,
       extra_adult_amount = 300000,
       extra_child_amount = 150000,
       active = 1,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND room_type_id = 'rtDbl2GSyzSeedA006D';

INSERT INTO property_room_rates (id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount, active, created_at, updated_at, included_adults, included_children, extra_adult_amount, extra_child_amount)
SELECT 'rrDbl2GSyzSeedA100D', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtDbl2GSyzSeedA006D', 'Best Flexible', 'VND', 1550000, 1, unixepoch(), unixepoch(), 2, 0, 300000, 150000
WHERE NOT EXISTS (
  SELECT 1 FROM property_room_rates WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ' AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI' AND room_type_id = 'rtDbl2GSyzSeedA006D'
);

UPDATE property_room_rates
   SET rate_name = 'Best Flexible',
       currency = 'VND',
       nightly_amount = 1850000,
       included_adults = 2,
       included_children = 0,
       extra_adult_amount = 350000,
       extra_child_amount = 150000,
       active = 1,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND room_type_id = 'rtSup2GSyzSeedA001X';

INSERT INTO property_room_rates (id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount, active, created_at, updated_at, included_adults, included_children, extra_adult_amount, extra_child_amount)
SELECT 'rrSup2GSyzSeedA100A', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSup2GSyzSeedA001X', 'Best Flexible', 'VND', 1850000, 1, unixepoch(), unixepoch(), 2, 0, 350000, 150000
WHERE NOT EXISTS (
  SELECT 1 FROM property_room_rates WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ' AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI' AND room_type_id = 'rtSup2GSyzSeedA001X'
);

UPDATE property_room_rates
   SET rate_name = 'Best Flexible',
       currency = 'VND',
       nightly_amount = 2450000,
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
SELECT 'rrDlx2GSyzSeedA101L', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'I_rrS7XtC0SagyNt869n8', 'Best Flexible', 'VND', 2450000, 1, unixepoch(), unixepoch(), 2, 1, 450000, 200000
WHERE NOT EXISTS (
  SELECT 1 FROM property_room_rates WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ' AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI' AND room_type_id = 'I_rrS7XtC0SagyNt869n8'
);

UPDATE property_room_rates
   SET rate_name = 'Best Flexible',
       currency = 'VND',
       nightly_amount = 4300000,
       included_adults = 3,
       included_children = 2,
       extra_adult_amount = 650000,
       extra_child_amount = 250000,
       active = 1,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND room_type_id = 'rtFam2GSyzSeedA003Z';

INSERT INTO property_room_rates (id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount, active, created_at, updated_at, included_adults, included_children, extra_adult_amount, extra_child_amount)
SELECT 'rrFam2GSyzSeedA102C', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtFam2GSyzSeedA003Z', 'Best Flexible', 'VND', 4300000, 1, unixepoch(), unixepoch(), 3, 2, 650000, 250000
WHERE NOT EXISTS (
  SELECT 1 FROM property_room_rates WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ' AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI' AND room_type_id = 'rtFam2GSyzSeedA003Z'
);

UPDATE property_room_rates
   SET rate_name = 'Best Flexible',
       currency = 'VND',
       nightly_amount = 3850000,
       included_adults = 2,
       included_children = 1,
       extra_adult_amount = 550000,
       extra_child_amount = 250000,
       active = 1,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND room_type_id = 'rtSte2GSyzSeedA002Y';

INSERT INTO property_room_rates (id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount, active, created_at, updated_at, included_adults, included_children, extra_adult_amount, extra_child_amount)
SELECT 'rrSte2GSyzSeedA101B', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSte2GSyzSeedA002Y', 'Best Flexible', 'VND', 3850000, 1, unixepoch(), unixepoch(), 2, 1, 550000, 250000
WHERE NOT EXISTS (
  SELECT 1 FROM property_room_rates WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ' AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI' AND room_type_id = 'rtSte2GSyzSeedA002Y'
);

UPDATE property_room_rates
   SET rate_name = 'Best Flexible',
       currency = 'VND',
       nightly_amount = 5200000,
       included_adults = 2,
       included_children = 1,
       extra_adult_amount = 700000,
       extra_child_amount = 250000,
       active = 1,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND room_type_id = 'rtSky2GSyzSeedA004Q';

INSERT INTO property_room_rates (id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount, active, created_at, updated_at, included_adults, included_children, extra_adult_amount, extra_child_amount)
SELECT 'rrSky2GSyzSeedA103D', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSky2GSyzSeedA004Q', 'Best Flexible', 'VND', 5200000, 1, unixepoch(), unixepoch(), 2, 1, 700000, 250000
WHERE NOT EXISTS (
  SELECT 1 FROM property_room_rates WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ' AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI' AND room_type_id = 'rtSky2GSyzSeedA004Q'
);

DELETE FROM property_room_rate_season_prices
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND season_id IN ('prsLow2GSyzSeed12m01', 'prsHigh2GSyzSeed12m02');

DELETE FROM property_rate_seasons
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND id IN ('prsLow2GSyzSeed12m01', 'prsHigh2GSyzSeed12m02');

INSERT INTO property_rate_seasons (id, tenant_id, property_id, name, start_date, end_date, sort_order, active, created_at, updated_at)
VALUES
('prsLow2GSyzSeed12m01', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'Low Season', date('now'), date('now','+12 months','-1 day'), 20, 1, unixepoch(), unixepoch()),
('prsHigh2GSyzSeed12m02', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'High Season', date('now','start of month','+1 month'), date('now','start of month','+5 months','-1 day'), 10, 1, unixepoch(), unixepoch());

INSERT INTO property_room_rate_season_prices (id, tenant_id, property_id, season_id, room_type_id, currency, nightly_amount, active, created_at, updated_at, included_adults, included_children, extra_adult_amount, extra_child_amount)
VALUES
('srLowSgl2GSyzSeed12A', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'prsLow2GSyzSeed12m01', 'rtSgl2GSyzSeedA005S', 'VND', 990000, 1, unixepoch(), unixepoch(), 1, 0, 450000, 150000),
('srLowDbl2GSyzSeed12B', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'prsLow2GSyzSeed12m01', 'rtDbl2GSyzSeedA006D', 'VND', 1290000, 1, unixepoch(), unixepoch(), 2, 0, 300000, 150000),
('srLowSup2GSyzSeed12C', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'prsLow2GSyzSeed12m01', 'rtSup2GSyzSeedA001X', 'VND', 1680000, 1, unixepoch(), unixepoch(), 2, 0, 350000, 150000),
('srLowDlx2GSyzSeed12D', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'prsLow2GSyzSeed12m01', 'I_rrS7XtC0SagyNt869n8', 'VND', 2250000, 1, unixepoch(), unixepoch(), 2, 1, 450000, 200000),
('srLowFam2GSyzSeed12E', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'prsLow2GSyzSeed12m01', 'rtFam2GSyzSeedA003Z', 'VND', 3990000, 1, unixepoch(), unixepoch(), 3, 2, 650000, 250000),
('srLowSte2GSyzSeed12F', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'prsLow2GSyzSeed12m01', 'rtSte2GSyzSeedA002Y', 'VND', 3550000, 1, unixepoch(), unixepoch(), 2, 1, 550000, 250000),
('srLowSky2GSyzSeed12G', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'prsLow2GSyzSeed12m01', 'rtSky2GSyzSeedA004Q', 'VND', 4850000, 1, unixepoch(), unixepoch(), 2, 1, 700000, 250000),
('srHighSgl2GSyzSeed12H', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'prsHigh2GSyzSeed12m02', 'rtSgl2GSyzSeedA005S', 'VND', 1350000, 1, unixepoch(), unixepoch(), 1, 0, 450000, 150000),
('srHighDbl2GSyzSeed12I', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'prsHigh2GSyzSeed12m02', 'rtDbl2GSyzSeedA006D', 'VND', 1750000, 1, unixepoch(), unixepoch(), 2, 0, 300000, 150000),
('srHighSup2GSyzSeed12J', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'prsHigh2GSyzSeed12m02', 'rtSup2GSyzSeedA001X', 'VND', 2280000, 1, unixepoch(), unixepoch(), 2, 0, 350000, 150000),
('srHighDlx2GSyzSeed12K', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'prsHigh2GSyzSeed12m02', 'I_rrS7XtC0SagyNt869n8', 'VND', 2990000, 1, unixepoch(), unixepoch(), 2, 1, 450000, 200000),
('srHighFam2GSyzSeed12L', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'prsHigh2GSyzSeed12m02', 'rtFam2GSyzSeedA003Z', 'VND', 5150000, 1, unixepoch(), unixepoch(), 3, 2, 650000, 250000),
('srHighSte2GSyzSeed12M', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'prsHigh2GSyzSeed12m02', 'rtSte2GSyzSeedA002Y', 'VND', 4690000, 1, unixepoch(), unixepoch(), 2, 1, 550000, 250000),
('srHighSky2GSyzSeed12N', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'prsHigh2GSyzSeed12m02', 'rtSky2GSyzSeedA004Q', 'VND', 6250000, 1, unixepoch(), unixepoch(), 2, 1, 700000, 250000);

INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruSgl1112GSyzSeed12A', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSgl2GSyzSeedA005S', '111', '1', 1, 1, 'ready', 0, 0, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruSgl1112GSyzSeed12A');
INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruSgl1122GSyzSeed12B', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSgl2GSyzSeedA005S', '112', '1', 2, 1, 'ready', 0, 0, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruSgl1122GSyzSeed12B');
INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruDbl1212GSyzSeed12C', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtDbl2GSyzSeedA006D', '121', '1', 3, 1, 'ready', 0, 0, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruDbl1212GSyzSeed12C');
INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruDbl1222GSyzSeed12D', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtDbl2GSyzSeedA006D', '122', '1', 4, 1, 'ready', 0, 0, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruDbl1222GSyzSeed12D');
INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruSte4032GSyzSeed12E', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtSte2GSyzSeedA002Y', '403', '4', 3, 1, 'ready', 0, 0, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruSte4032GSyzSeed12E');
INSERT INTO room_units (id, tenant_id, property_id, room_type_id, room_number, floor_label, sort_order, active, operational_status, do_not_disturb, room_service_requested, created_at, updated_at)
SELECT 'ruFam5032GSyzSeed12F', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'rtFam2GSyzSeedA003Z', '503', '5', 3, 1, 'ready', 0, 0, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM room_units WHERE id = 'ruFam5032GSyzSeed12F');

UPDATE room_units
   SET operational_status = 'out_of_order',
       do_not_disturb = 0,
       room_service_requested = 0,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND id = 'BMeYfvK8jQTx34LTo9SrE';

UPDATE room_units
   SET operational_status = 'maintenance',
       do_not_disturb = 0,
       room_service_requested = 0,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND id = 'THfvaAu5xHuNh9oGBujxv';

UPDATE room_units
   SET room_service_requested = CASE WHEN id = 'ruSup2032GSyzSeed03' THEN 1 ELSE room_service_requested END,
       do_not_disturb = CASE WHEN id = 'ruSup2042GSyzSeed04' THEN 1 ELSE do_not_disturb END,
       updated_at = unixepoch()
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND id IN ('ruSup2032GSyzSeed03', 'ruSup2042GSyzSeed04');

DELETE FROM folio_lines
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND folio_id IN (
     SELECT id
       FROM folios
      WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
        AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
        AND reservation_id IN (
          SELECT id
            FROM property_reservations
           WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
             AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
             AND (source_ref LIKE 'DEMO-%' OR source_ref LIKE 'RVS12M-%')
        )
   );

DELETE FROM folios
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND reservation_id IN (
     SELECT id
       FROM property_reservations
      WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
        AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
        AND (source_ref LIKE 'DEMO-%' OR source_ref LIKE 'RVS12M-%')
   );

DELETE FROM property_reservation_events
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND reservation_id IN (
     SELECT id
       FROM property_reservations
      WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
        AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
        AND (source_ref LIKE 'DEMO-%' OR source_ref LIKE 'RVS12M-%')
   );

DELETE FROM housekeeping_tasks
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND (
     id IN ('hkPnd2GSyzSeed0001A', 'hkPrg2GSyzSeed0002B', 'hkIns2GSyzSeed0003C')
     OR id LIKE 'hkRvs12m%'
     OR reservation_id IN (
       SELECT id
         FROM property_reservations
        WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
          AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
          AND (source_ref LIKE 'DEMO-%' OR source_ref LIKE 'RVS12M-%')
     )
   );

DELETE FROM room_state_events
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND (
     id LIKE 'rsEvt2GSyzSeed%'
     OR id LIKE 'rseRvs12m%'
     OR reservation_id IN (
       SELECT id
         FROM property_reservations
        WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
          AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
          AND (source_ref LIKE 'DEMO-%' OR source_ref LIKE 'RVS12M-%')
     )
   );

DELETE FROM reservation_allocations
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND reservation_id IN (
     SELECT id
       FROM property_reservations
      WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
        AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
        AND (source_ref LIKE 'DEMO-%' OR source_ref LIKE 'RVS12M-%')
   );

DELETE FROM reservation_stay_plan_segments
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND reservation_id IN (
     SELECT id
       FROM property_reservations
      WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
        AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
        AND (source_ref LIKE 'DEMO-%' OR source_ref LIKE 'RVS12M-%')
   );

DELETE FROM reservation_stay_plans
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND reservation_id IN (
     SELECT id
       FROM property_reservations
      WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
        AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
        AND (source_ref LIKE 'DEMO-%' OR source_ref LIKE 'RVS12M-%')
   );

DELETE FROM property_reservations
 WHERE tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
   AND property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
   AND (source_ref LIKE 'DEMO-%' OR source_ref LIKE 'RVS12M-%');

WITH RECURSIVE
months(month_index, month_start) AS (
  SELECT 1, date('now', 'start of month', '+1 month')
  UNION ALL
  SELECT month_index + 1, date(month_start, '+1 month')
    FROM months
   WHERE month_index < 11
),
saleable_units AS (
  SELECT
    ru.id AS room_unit_id,
    ru.room_number,
    replace(replace(lower(ru.room_number), '-', ''), ' ', '') AS room_number_key,
    ru.room_type_id,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(CAST(NULLIF(ru.floor_label, '') AS INTEGER), 0), ru.room_number, ru.id
    ) AS room_rank
  FROM room_units ru
  WHERE ru.tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
    AND ru.property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
    AND ru.active = 1
    AND ru.operational_status = 'ready'
),
future_seed_base AS (
  SELECT
    su.room_unit_id,
    su.room_number,
    su.room_number_key,
    su.room_type_id,
    su.room_rank,
    m.month_index,
    m.month_start,
    date(m.month_start, printf('+%d days', ((su.room_rank * 5) + (m.month_index * 3)) % 15 + 2)) AS primary_check_in,
    ((su.room_rank + m.month_index) % 3) + 2 AS primary_nights,
    ((su.room_rank * 2 + m.month_index) % 3) + 1 AS follow_nights,
    CASE
      WHEN su.room_type_id = 'rtSgl2GSyzSeedA005S' THEN 1
      WHEN su.room_type_id = 'rtFam2GSyzSeedA003Z' THEN 2
      ELSE 2
    END AS adults,
    CASE
      WHEN su.room_type_id = 'rtFam2GSyzSeedA003Z' THEN 2
      WHEN su.room_type_id = 'rtDbl2GSyzSeedA006D' AND ((su.room_rank + m.month_index) % 4) = 0 THEN 1
      ELSE 0
    END AS children,
    CASE
      WHEN m.month_index BETWEEN 1 AND 4 THEN
        CASE su.room_type_id
          WHEN 'rtSgl2GSyzSeedA005S' THEN 1350000
          WHEN 'rtDbl2GSyzSeedA006D' THEN 1750000
          WHEN 'rtSup2GSyzSeedA001X' THEN 2280000
          WHEN 'I_rrS7XtC0SagyNt869n8' THEN 2990000
          WHEN 'rtFam2GSyzSeedA003Z' THEN 5150000
          WHEN 'rtSte2GSyzSeedA002Y' THEN 4690000
          WHEN 'rtSky2GSyzSeedA004Q' THEN 6250000
          ELSE 2450000
        END
      ELSE
        CASE su.room_type_id
          WHEN 'rtSgl2GSyzSeedA005S' THEN 990000
          WHEN 'rtDbl2GSyzSeedA006D' THEN 1290000
          WHEN 'rtSup2GSyzSeedA001X' THEN 1680000
          WHEN 'I_rrS7XtC0SagyNt869n8' THEN 2250000
          WHEN 'rtFam2GSyzSeedA003Z' THEN 3990000
          WHEN 'rtSte2GSyzSeedA002Y' THEN 3550000
          WHEN 'rtSky2GSyzSeedA004Q' THEN 4850000
          ELSE 2250000
        END
    END AS nightly_amount
  FROM saleable_units su
  CROSS JOIN months m
),
future_primary AS (
  SELECT
    printf('resRvs12m%s%sA', strftime('%Y%m', month_start), room_number_key) AS reservation_id,
    CASE WHEN ((room_rank + month_index) % 3) = 0 THEN 'direct_web' ELSE 'manual_frontdesk' END AS source,
    printf('RVS12M-%s-%s-A', strftime('%Y%m', month_start), upper(room_number_key)) AS source_ref,
    json_object('seed', 'river_suites_12m', 'pattern', 'A', 'month_index', month_index, 'room_number', room_number) AS source_payload,
    CASE WHEN ((room_rank + month_index) % 5) = 0 THEN 'pending_payment' ELSE 'confirmed' END AS status,
    printf('Seed Guest %s %02dA', room_number, month_index) AS guest_name,
    printf('seed-%s-%02dA@river.test', room_number_key, month_index) AS guest_email,
    printf('+8491%07d', room_rank * 100 + month_index) AS guest_phone,
    primary_check_in AS check_in,
    date(primary_check_in, printf('+%d days', primary_nights)) AS check_out,
    room_type_id,
    room_unit_id,
    adults,
    children,
    nightly_amount,
    CASE
      WHEN ((room_rank + month_index) % 6) = 0 THEN 'Airport pickup coordination'
      WHEN ((room_rank + month_index) % 5) = 0 THEN 'Early check-in requested'
      WHEN ((room_rank + month_index) % 4) = 0 THEN 'High floor preferred'
      ELSE 'Quiet room preferred'
    END AS special_requests,
    CASE
      WHEN ((room_rank + month_index) % 3) = 0 THEN '18:30'
      WHEN ((room_rank + month_index) % 2) = 0 THEN '15:00'
      ELSE '14:30'
    END AS expected_arrival_time,
    CASE WHEN ((room_rank + month_index) % 4) = 0 THEN 'flight' ELSE 'direct' END AS expected_arrival_channel,
    CASE WHEN ((room_rank + month_index) % 7) = 0 THEN 1 ELSE 0 END AS airport_transfer_requested
  FROM future_seed_base
),
future_follow AS (
  SELECT
    printf('resRvs12m%s%sB', strftime('%Y%m', month_start), room_number_key) AS reservation_id,
    CASE WHEN ((room_rank + month_index) % 2) = 0 THEN 'manual_frontdesk' ELSE 'direct_web' END AS source,
    printf('RVS12M-%s-%s-B', strftime('%Y%m', month_start), upper(room_number_key)) AS source_ref,
    json_object('seed', 'river_suites_12m', 'pattern', 'B', 'month_index', month_index, 'room_number', room_number) AS source_payload,
    CASE WHEN ((room_rank + month_index) % 4) = 0 THEN 'pending_payment' ELSE 'confirmed' END AS status,
    printf('Seed Guest %s %02dB', room_number, month_index) AS guest_name,
    printf('seed-%s-%02dB@river.test', room_number_key, month_index) AS guest_email,
    printf('+8492%07d', room_rank * 100 + month_index) AS guest_phone,
    date(primary_check_in, printf('+%d days', primary_nights)) AS check_in,
    date(date(primary_check_in, printf('+%d days', primary_nights)), printf('+%d days', follow_nights)) AS check_out,
    room_type_id,
    room_unit_id,
    adults,
    children,
    nightly_amount,
    'Same-day turnover follow-up reservation' AS special_requests,
    CASE WHEN ((room_rank + month_index) % 2) = 0 THEN '16:00' ELSE '17:30' END AS expected_arrival_time,
    CASE WHEN ((room_rank + month_index) % 5) = 0 THEN 'flight' ELSE 'direct' END AS expected_arrival_channel,
    CASE WHEN ((room_rank + month_index) % 9) = 0 THEN 1 ELSE 0 END AS airport_transfer_requested
  FROM future_seed_base
  WHERE ((room_rank + month_index) % 2) = 0
    AND date(date(primary_check_in, printf('+%d days', primary_nights)), printf('+%d days', follow_nights)) <= date(month_start, '+25 days')
),
current_manual(
  reservation_id, source, source_ref, source_payload, status, guest_name, guest_email, guest_phone,
  check_in, check_out, room_type_id, room_unit_id, adults, children, nightly_amount,
  special_requests, expected_arrival_time, expected_arrival_channel, airport_transfer_requested
) AS (
  VALUES
  ('resRvs12mNow301A', 'manual_frontdesk', 'RVS12M-NOW-301-A', json_object('seed', 'river_suites_12m', 'pattern', 'NOW', 'room_number', '301'), 'checked_in', 'Linh Tran', 'linh.tran@river.test', '+84901234501', date('now', '-1 day'), date('now', '+2 day'), 'I_rrS7XtC0SagyNt869n8', 'ruDlx3012GSyzSeed05', 2, 0, 2250000, 'Late arrival noted', '15:30', 'walk_in', 0),
  ('resRvs12mNow302B', 'manual_frontdesk', 'RVS12M-NOW-302-B', json_object('seed', 'river_suites_12m', 'pattern', 'NOW', 'room_number', '302', 'turnover', 'out'), 'checked_in', 'Minh Vo', 'minh.vo@river.test', '+84901234502', date('now', '-2 day'), date('now'), 'I_rrS7XtC0SagyNt869n8', 'ruDlx3022GSyzSeed06', 2, 0, 2250000, 'Checkout before noon', '09:30', 'direct', 0),
  ('resRvs12mNow302C', 'direct_web', 'RVS12M-NOW-302-C', json_object('seed', 'river_suites_12m', 'pattern', 'NOW', 'room_number', '302', 'turnover', 'in'), 'confirmed', 'Bao Pham', 'bao.pham@river.test', '+84901234503', date('now'), date('now', '+3 day'), 'I_rrS7XtC0SagyNt869n8', 'ruDlx3022GSyzSeed06', 2, 0, 2250000, 'Airport pickup requested', '16:30', 'flight', 1),
  ('resRvs12mNow303D', 'manual_frontdesk', 'RVS12M-NOW-303-D', json_object('seed', 'river_suites_12m', 'pattern', 'NOW', 'room_number', '303', 'post_checkout', 1), 'checked_out', 'An Nguyen', 'an.nguyen@river.test', '+84901234504', date('now', '-2 day'), date('now'), 'I_rrS7XtC0SagyNt869n8', 'ruDlx3032GSyzSeed07', 2, 1, 2250000, 'Needs quick turnover', '08:00', 'ota', 0),
  ('resRvs12mNow402E', 'direct_web', 'RVS12M-NOW-402-E', json_object('seed', 'river_suites_12m', 'pattern', 'NOW', 'room_number', '402'), 'pending_payment', 'Suite Guest', 'suite.guest@river.test', '+84901234505', date('now', '+1 day'), date('now', '+4 day'), 'rtSte2GSyzSeedA002Y', 'ruSte4022GSyzSeed09', 2, 1, 3550000, 'Extra pillows requested', '17:00', 'direct', 0),
  ('resRvs12mNow502F', 'manual_frontdesk', 'RVS12M-NOW-502-F', json_object('seed', 'river_suites_12m', 'pattern', 'NOW', 'room_number', '502'), 'checked_in', 'Family Le', 'family.le@river.test', '+84901234506', date('now', '-1 day'), date('now', '+3 day'), 'rtFam2GSyzSeedA003Z', 'ruFam5022GSyzSeed10', 2, 2, 3990000, 'Baby cot requested', '14:30', 'direct', 0),
  ('resRvs12mNow111G', 'direct_web', 'RVS12M-NOW-111-G', json_object('seed', 'river_suites_12m', 'pattern', 'NOW', 'room_number', '111'), 'confirmed', 'Solo Nguyen', 'solo.nguyen@river.test', '+84901234507', date('now', '+5 day'), date('now', '+7 day'), 'rtSgl2GSyzSeedA005S', 'ruSgl1112GSyzSeed12A', 1, 0, 990000, 'Near elevator is acceptable', '19:00', 'direct', 0)
),
all_seed_reservations AS (
  SELECT * FROM current_manual
  UNION ALL
  SELECT * FROM future_primary
  UNION ALL
  SELECT * FROM future_follow
)
INSERT INTO property_reservations (
  id, tenant_id, property_id, source, source_ref, source_payload, status,
  guest_name, guest_email, guest_phone, check_in, check_out, room_type_id, rooms_requested, adults, children,
  pricing_snapshot, special_requests, expected_arrival_time, expected_flight_ref, expected_arrival_channel,
  airport_transfer_requested, airport_transfer_price_snapshot, cancellation_policy_snapshot,
  confirmed_at, confirmed_by, cancelled_at, cancelled_by, cancel_reason, created_at, updated_at, assigned_room_unit_id,
  guest_photo_key, guest_photo_uploaded_at
)
SELECT
  reservation_id,
  '2GSyzJbWFZFpwg9UFENZJ',
  'M3QCy4dcy0Pr1XWeCsXmI',
  source,
  source_ref,
  source_payload,
  status,
  guest_name,
  guest_email,
  guest_phone,
  check_in,
  check_out,
  room_type_id,
  1,
  adults,
  children,
  json_object(
    'currency', 'VND',
    'nightly_amount', nightly_amount,
    'total_amount', nightly_amount * CAST((julianday(check_out) - julianday(check_in)) AS INTEGER),
    'seed', 'river_suites_12m'
  ),
  special_requests,
  expected_arrival_time,
  NULL,
  expected_arrival_channel,
  airport_transfer_requested,
  CASE WHEN airport_transfer_requested = 1 THEN json_object('currency', 'VND', 'amount', 350000) ELSE NULL END,
  NULL,
  CASE WHEN status IN ('confirmed', 'checked_in', 'checked_out') THEN unixepoch() ELSE NULL END,
  NULL,
  NULL,
  NULL,
  NULL,
  unixepoch(),
  unixepoch(),
  room_unit_id,
  NULL,
  NULL
FROM all_seed_reservations;

WITH RECURSIVE
months(month_index, month_start) AS (
  SELECT 1, date('now', 'start of month', '+1 month')
  UNION ALL
  SELECT month_index + 1, date(month_start, '+1 month')
    FROM months
   WHERE month_index < 11
),
saleable_units AS (
  SELECT
    ru.id AS room_unit_id,
    ru.room_number,
    replace(replace(lower(ru.room_number), '-', ''), ' ', '') AS room_number_key,
    ru.room_type_id,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(CAST(NULLIF(ru.floor_label, '') AS INTEGER), 0), ru.room_number, ru.id
    ) AS room_rank
  FROM room_units ru
  WHERE ru.tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
    AND ru.property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
    AND ru.active = 1
    AND ru.operational_status = 'ready'
),
future_seed_base AS (
  SELECT
    su.room_unit_id,
    su.room_number,
    su.room_number_key,
    su.room_type_id,
    su.room_rank,
    m.month_index,
    m.month_start,
    date(m.month_start, printf('+%d days', ((su.room_rank * 5) + (m.month_index * 3)) % 15 + 2)) AS primary_check_in,
    ((su.room_rank + m.month_index) % 3) + 2 AS primary_nights,
    ((su.room_rank * 2 + m.month_index) % 3) + 1 AS follow_nights
  FROM saleable_units su
  CROSS JOIN months m
),
future_primary AS (
  SELECT
    printf('resRvs12m%s%sA', strftime('%Y%m', month_start), room_number_key) AS reservation_id,
    room_type_id,
    room_unit_id,
    primary_check_in AS check_in,
    date(primary_check_in, printf('+%d days', primary_nights)) AS check_out
  FROM future_seed_base
),
future_follow AS (
  SELECT
    printf('resRvs12m%s%sB', strftime('%Y%m', month_start), room_number_key) AS reservation_id,
    room_type_id,
    room_unit_id,
    date(primary_check_in, printf('+%d days', primary_nights)) AS check_in,
    date(date(primary_check_in, printf('+%d days', primary_nights)), printf('+%d days', follow_nights)) AS check_out
  FROM future_seed_base
  WHERE ((room_rank + month_index) % 2) = 0
    AND date(date(primary_check_in, printf('+%d days', primary_nights)), printf('+%d days', follow_nights)) <= date(month_start, '+25 days')
),
current_manual(reservation_id, room_type_id, room_unit_id, check_in, check_out) AS (
  VALUES
  ('resRvs12mNow301A', 'I_rrS7XtC0SagyNt869n8', 'ruDlx3012GSyzSeed05', date('now', '-1 day'), date('now', '+2 day')),
  ('resRvs12mNow302B', 'I_rrS7XtC0SagyNt869n8', 'ruDlx3022GSyzSeed06', date('now', '-2 day'), date('now')),
  ('resRvs12mNow302C', 'I_rrS7XtC0SagyNt869n8', 'ruDlx3022GSyzSeed06', date('now'), date('now', '+3 day')),
  ('resRvs12mNow303D', 'I_rrS7XtC0SagyNt869n8', 'ruDlx3032GSyzSeed07', date('now', '-2 day'), date('now')),
  ('resRvs12mNow402E', 'rtSte2GSyzSeedA002Y', 'ruSte4022GSyzSeed09', date('now', '+1 day'), date('now', '+4 day')),
  ('resRvs12mNow502F', 'rtFam2GSyzSeedA003Z', 'ruFam5022GSyzSeed10', date('now', '-1 day'), date('now', '+3 day')),
  ('resRvs12mNow111G', 'rtSgl2GSyzSeedA005S', 'ruSgl1112GSyzSeed12A', date('now', '+5 day'), date('now', '+7 day'))
),
all_seed_reservations AS (
  SELECT * FROM current_manual
  UNION ALL
  SELECT * FROM future_primary
  UNION ALL
  SELECT * FROM future_follow
)
INSERT INTO reservation_stay_plans (
  id, tenant_id, property_id, reservation_id, plan_type, score, move_count, upgrade_segments,
  public_visible, is_selected, status, meta_json, created_at, updated_at
)
SELECT
  reservation_id || '-plan',
  '2GSyzJbWFZFpwg9UFENZJ',
  'M3QCy4dcy0Pr1XWeCsXmI',
  reservation_id,
  'contiguous_same_type',
  10,
  0,
  0,
  1,
  1,
  'locked',
  json_object('seed', 'river_suites_12m', 'room_unit_id', room_unit_id),
  unixepoch(),
  unixepoch()
FROM all_seed_reservations;

WITH RECURSIVE
months(month_index, month_start) AS (
  SELECT 1, date('now', 'start of month', '+1 month')
  UNION ALL
  SELECT month_index + 1, date(month_start, '+1 month')
    FROM months
   WHERE month_index < 11
),
saleable_units AS (
  SELECT
    ru.id AS room_unit_id,
    ru.room_number,
    replace(replace(lower(ru.room_number), '-', ''), ' ', '') AS room_number_key,
    ru.room_type_id,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(CAST(NULLIF(ru.floor_label, '') AS INTEGER), 0), ru.room_number, ru.id
    ) AS room_rank
  FROM room_units ru
  WHERE ru.tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
    AND ru.property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
    AND ru.active = 1
    AND ru.operational_status = 'ready'
),
future_seed_base AS (
  SELECT
    su.room_unit_id,
    su.room_number,
    su.room_number_key,
    su.room_type_id,
    su.room_rank,
    m.month_index,
    m.month_start,
    date(m.month_start, printf('+%d days', ((su.room_rank * 5) + (m.month_index * 3)) % 15 + 2)) AS primary_check_in,
    ((su.room_rank + m.month_index) % 3) + 2 AS primary_nights,
    ((su.room_rank * 2 + m.month_index) % 3) + 1 AS follow_nights
  FROM saleable_units su
  CROSS JOIN months m
),
future_primary AS (
  SELECT
    printf('resRvs12m%s%sA', strftime('%Y%m', month_start), room_number_key) AS reservation_id,
    room_type_id,
    room_unit_id,
    primary_check_in AS check_in,
    date(primary_check_in, printf('+%d days', primary_nights)) AS check_out
  FROM future_seed_base
),
future_follow AS (
  SELECT
    printf('resRvs12m%s%sB', strftime('%Y%m', month_start), room_number_key) AS reservation_id,
    room_type_id,
    room_unit_id,
    date(primary_check_in, printf('+%d days', primary_nights)) AS check_in,
    date(date(primary_check_in, printf('+%d days', primary_nights)), printf('+%d days', follow_nights)) AS check_out
  FROM future_seed_base
  WHERE ((room_rank + month_index) % 2) = 0
    AND date(date(primary_check_in, printf('+%d days', primary_nights)), printf('+%d days', follow_nights)) <= date(month_start, '+25 days')
),
current_manual(reservation_id, room_type_id, room_unit_id, check_in, check_out) AS (
  VALUES
  ('resRvs12mNow301A', 'I_rrS7XtC0SagyNt869n8', 'ruDlx3012GSyzSeed05', date('now', '-1 day'), date('now', '+2 day')),
  ('resRvs12mNow302B', 'I_rrS7XtC0SagyNt869n8', 'ruDlx3022GSyzSeed06', date('now', '-2 day'), date('now')),
  ('resRvs12mNow302C', 'I_rrS7XtC0SagyNt869n8', 'ruDlx3022GSyzSeed06', date('now'), date('now', '+3 day')),
  ('resRvs12mNow303D', 'I_rrS7XtC0SagyNt869n8', 'ruDlx3032GSyzSeed07', date('now', '-2 day'), date('now')),
  ('resRvs12mNow402E', 'rtSte2GSyzSeedA002Y', 'ruSte4022GSyzSeed09', date('now', '+1 day'), date('now', '+4 day')),
  ('resRvs12mNow502F', 'rtFam2GSyzSeedA003Z', 'ruFam5022GSyzSeed10', date('now', '-1 day'), date('now', '+3 day')),
  ('resRvs12mNow111G', 'rtSgl2GSyzSeedA005S', 'ruSgl1112GSyzSeed12A', date('now', '+5 day'), date('now', '+7 day'))
),
all_seed_reservations AS (
  SELECT * FROM current_manual
  UNION ALL
  SELECT * FROM future_primary
  UNION ALL
  SELECT * FROM future_follow
)
INSERT INTO reservation_stay_plan_segments (
  id, tenant_id, property_id, reservation_id, stay_plan_id, segment_order,
  room_type_id, room_unit_id, check_in, check_out, segment_type, upgrade_applied, ops_notes, created_at
)
SELECT
  reservation_id || '-seg-01',
  '2GSyzJbWFZFpwg9UFENZJ',
  'M3QCy4dcy0Pr1XWeCsXmI',
  reservation_id,
  reservation_id || '-plan',
  1,
  room_type_id,
  room_unit_id,
  check_in,
  check_out,
  'base',
  0,
  'Seeded contiguous test stay',
  unixepoch()
FROM all_seed_reservations;

WITH RECURSIVE
months(month_index, month_start) AS (
  SELECT 1, date('now', 'start of month', '+1 month')
  UNION ALL
  SELECT month_index + 1, date(month_start, '+1 month')
    FROM months
   WHERE month_index < 11
),
saleable_units AS (
  SELECT
    ru.id AS room_unit_id,
    ru.room_number,
    replace(replace(lower(ru.room_number), '-', ''), ' ', '') AS room_number_key,
    ru.room_type_id,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(CAST(NULLIF(ru.floor_label, '') AS INTEGER), 0), ru.room_number, ru.id
    ) AS room_rank
  FROM room_units ru
  WHERE ru.tenant_id = '2GSyzJbWFZFpwg9UFENZJ'
    AND ru.property_id = 'M3QCy4dcy0Pr1XWeCsXmI'
    AND ru.active = 1
    AND ru.operational_status = 'ready'
),
future_seed_base AS (
  SELECT
    su.room_unit_id,
    su.room_number,
    su.room_number_key,
    su.room_rank,
    m.month_index,
    m.month_start,
    date(m.month_start, printf('+%d days', ((su.room_rank * 5) + (m.month_index * 3)) % 15 + 2)) AS primary_check_in,
    ((su.room_rank + m.month_index) % 3) + 2 AS primary_nights,
    ((su.room_rank * 2 + m.month_index) % 3) + 1 AS follow_nights
  FROM saleable_units su
  CROSS JOIN months m
),
future_primary AS (
  SELECT
    printf('resRvs12m%s%sA', strftime('%Y%m', month_start), room_number_key) AS reservation_id,
    room_unit_id,
    primary_check_in AS check_in,
    date(primary_check_in, printf('+%d days', primary_nights)) AS check_out
  FROM future_seed_base
),
future_follow AS (
  SELECT
    printf('resRvs12m%s%sB', strftime('%Y%m', month_start), room_number_key) AS reservation_id,
    room_unit_id,
    date(primary_check_in, printf('+%d days', primary_nights)) AS check_in,
    date(date(primary_check_in, printf('+%d days', primary_nights)), printf('+%d days', follow_nights)) AS check_out
  FROM future_seed_base
  WHERE ((room_rank + month_index) % 2) = 0
    AND date(date(primary_check_in, printf('+%d days', primary_nights)), printf('+%d days', follow_nights)) <= date(month_start, '+25 days')
),
current_manual(reservation_id, room_unit_id, check_in, check_out) AS (
  VALUES
  ('resRvs12mNow301A', 'ruDlx3012GSyzSeed05', date('now', '-1 day'), date('now', '+2 day')),
  ('resRvs12mNow302B', 'ruDlx3022GSyzSeed06', date('now', '-2 day'), date('now')),
  ('resRvs12mNow302C', 'ruDlx3022GSyzSeed06', date('now'), date('now', '+3 day')),
  ('resRvs12mNow303D', 'ruDlx3032GSyzSeed07', date('now', '-2 day'), date('now')),
  ('resRvs12mNow402E', 'ruSte4022GSyzSeed09', date('now', '+1 day'), date('now', '+4 day')),
  ('resRvs12mNow502F', 'ruFam5022GSyzSeed10', date('now', '-1 day'), date('now', '+3 day')),
  ('resRvs12mNow111G', 'ruSgl1112GSyzSeed12A', date('now', '+5 day'), date('now', '+7 day'))
),
all_seed_reservations AS (
  SELECT * FROM current_manual
  UNION ALL
  SELECT * FROM future_primary
  UNION ALL
  SELECT * FROM future_follow
),
allocation_seed(reservation_id, room_unit_id, stay_date, check_out) AS (
  SELECT reservation_id, room_unit_id, check_in, check_out
    FROM all_seed_reservations
  UNION ALL
  SELECT reservation_id, room_unit_id, date(stay_date, '+1 day'), check_out
    FROM allocation_seed
   WHERE date(stay_date, '+1 day') < check_out
)
INSERT INTO reservation_allocations (
  id, tenant_id, property_id, reservation_id, stay_plan_id, room_unit_id, stay_date, allocation_status, created_at, updated_at
)
SELECT
  reservation_id || '-alloc-' || replace(stay_date, '-', ''),
  '2GSyzJbWFZFpwg9UFENZJ',
  'M3QCy4dcy0Pr1XWeCsXmI',
  reservation_id,
  reservation_id || '-plan',
  room_unit_id,
  stay_date,
  'locked',
  unixepoch(),
  unixepoch()
FROM allocation_seed;

INSERT INTO housekeeping_tasks (id, tenant_id, property_id, room_unit_id, reservation_id, priority, status, scheduled_for, started_at, completed_at, assigned_user_id, note, created_at, updated_at)
VALUES
('hkRvs12mDirty303A', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'ruDlx3032GSyzSeed07', 'resRvs12mNow303D', 'departure_clean', 'pending', unixepoch(date('now')), NULL, NULL, NULL, 'Checkout completed, room needs immediate turnover.', unixepoch(), unixepoch()),
('hkRvs12mClean202B', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'ruSup2022GSyzSeed02', NULL, 'routine', 'in_progress', unixepoch(date('now')), unixepoch('now', '-2 hours'), NULL, NULL, 'Bathroom refresh and linen change in progress.', unixepoch(), unixepoch()),
('hkRvs12mInspect203C', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'ruSup2032GSyzSeed03', NULL, 'routine', 'waiting_inspection', unixepoch(date('now')), unixepoch('now', '-4 hours'), NULL, NULL, 'Cleaning complete, waiting for supervisor inspection.', unixepoch(), unixepoch());

INSERT INTO room_state_events (id, tenant_id, property_id, room_unit_id, reservation_id, previous_state, new_state, note, changed_by, created_at)
VALUES
('rseRvs12mDirty303A', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'ruDlx3032GSyzSeed07', 'resRvs12mNow303D', 'occupied', 'dirty', 'Guest checked out and room is queued for housekeeping.', NULL, unixepoch()),
('rseRvs12mClean202B', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'ruSup2022GSyzSeed02', NULL, 'dirty', 'cleaning', 'Housekeeper is cleaning the room.', NULL, unixepoch()),
('rseRvs12mInspect203C', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'ruSup2032GSyzSeed03', NULL, 'cleaning', 'inspected', 'Supervisor inspection is pending final release.', NULL, unixepoch()),
('rseRvs12mReady201D', '2GSyzJbWFZFpwg9UFENZJ', 'M3QCy4dcy0Pr1XWeCsXmI', 'ruSup2012GSyzSeed01', NULL, 'inspected', 'ready', 'Room released as clean and ready for sale.', NULL, unixepoch());
