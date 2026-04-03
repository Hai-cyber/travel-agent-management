INSERT OR IGNORE INTO tenant_seasons (
  id,
  tenant_id,
  name,
  start_month,
  start_day,
  end_month,
  end_day,
  sort_order,
  is_active,
  notes,
  created_at
)
SELECT DISTINCT
  substr('starter-season-' || t.tenant_id, 1, 120),
  t.tenant_id,
  'Year Round',
  1,
  1,
  12,
  31,
  0,
  1,
  'Backfilled default season',
  unixepoch()
FROM tours t
WHERE NOT EXISTS (
  SELECT 1
  FROM tour_prices tp
  WHERE tp.tenant_id = t.tenant_id
    AND tp.tour_id = t.id
);

INSERT OR IGNORE INTO pricing_segments (
  id,
  tenant_id,
  code,
  name,
  description,
  sort_order,
  is_active,
  created_at
)
SELECT DISTINCT
  substr('starter-segment-' || t.tenant_id, 1, 120),
  t.tenant_id,
  'fit',
  'FIT',
  'Backfilled default independent traveler segment',
  0,
  1,
  unixepoch()
FROM tours t
WHERE NOT EXISTS (
  SELECT 1
  FROM tour_prices tp
  WHERE tp.tenant_id = t.tenant_id
    AND tp.tour_id = t.id
);

INSERT OR IGNORE INTO pax_bands (
  id,
  tenant_id,
  name,
  min_pax,
  max_pax,
  sort_order,
  is_active,
  created_at
)
SELECT DISTINCT
  substr('starter-pax-2-' || t.tenant_id, 1, 120),
  t.tenant_id,
  '2-4 Guests',
  2,
  4,
  0,
  1,
  unixepoch()
FROM tours t
WHERE NOT EXISTS (
  SELECT 1
  FROM tour_prices tp
  WHERE tp.tenant_id = t.tenant_id
    AND tp.tour_id = t.id
);

INSERT OR IGNORE INTO pax_bands (
  id,
  tenant_id,
  name,
  min_pax,
  max_pax,
  sort_order,
  is_active,
  created_at
)
SELECT DISTINCT
  substr('starter-pax-4-' || t.tenant_id, 1, 120),
  t.tenant_id,
  '5-8 Guests',
  5,
  8,
  1,
  1,
  unixepoch()
FROM tours t
WHERE NOT EXISTS (
  SELECT 1
  FROM tour_prices tp
  WHERE tp.tenant_id = t.tenant_id
    AND tp.tour_id = t.id
);

INSERT INTO tour_stops (
  id,
  tenant_id,
  tour_id,
  destination_id,
  label,
  day_from,
  day_to,
  nights,
  meal_breakfast,
  meal_lunch,
  meal_dinner,
  description,
  services_config,
  sort_order,
  created_at
)
SELECT
  lower(hex(randomblob(16))),
  t.tenant_id,
  t.id,
  NULL,
  CASE
    WHEN trim(coalesce(t.title, '')) <> '' THEN trim(t.title) || ' arrival'
    ELSE 'Starter itinerary stop'
  END,
  1,
  CASE
    WHEN CAST(coalesce(t.duration_text, '') AS INTEGER) >= 2 THEN CAST(t.duration_text AS INTEGER) - 1
    ELSE 1
  END,
  CASE
    WHEN CAST(coalesce(t.duration_text, '') AS INTEGER) >= 2 THEN CAST(t.duration_text AS INTEGER) - 1
    ELSE 1
  END,
  1,
  0,
  1,
  CASE
    WHEN json_valid(t.content_data) THEN coalesce(
      json_extract(t.content_data, '$.hero_desc'),
      json_extract(t.content_data, '$.tour_desc'),
      'Starter itinerary stop for ' || coalesce(nullif(trim(t.title), ''), 'tour')
    )
    ELSE 'Starter itinerary stop for ' || coalesce(nullif(trim(t.title), ''), 'tour')
  END,
  json_object(
    'hotel', 1,
    'guide', 1,
    'local', json_array('car7'),
    'intercity', json_array(),
    'pub', json_object('hotel', 1, 'guide', 1, 'local', 1, 'intercity', 1)
  ),
  0,
  unixepoch()
FROM tours t
WHERE NOT EXISTS (
  SELECT 1
  FROM tour_stops ts
  WHERE ts.tenant_id = t.tenant_id
    AND ts.tour_id = t.id
);

UPDATE tour_stops
SET services_config = json_object(
  'hotel', 1,
  'guide', 1,
  'local', json_array('car7'),
  'intercity', CASE
    WHEN EXISTS (
      SELECT 1
      FROM tour_stops ts2
      WHERE ts2.tenant_id = tour_stops.tenant_id
        AND ts2.tour_id = tour_stops.tour_id
        AND coalesce(ts2.sort_order, 0) > coalesce(tour_stops.sort_order, 0)
    ) THEN json_array('car7')
    ELSE json_array()
  END,
  'pub', json_object('hotel', 1, 'guide', 1, 'local', 1, 'intercity', 1)
)
WHERE services_config IS NULL
   OR trim(services_config) = ''
   OR trim(services_config) = '{}';

INSERT INTO stop_accommodations (
  id,
  tenant_id,
  tour_stop_id,
  person_in_charge,
  hotel_name,
  contact_name,
  contact_phone,
  contact_email,
  address,
  check_in,
  check_out,
  room_type,
  guests,
  notes,
  stage,
  status,
  position,
  created_at
)
SELECT
  lower(hex(randomblob(16))),
  ts.tenant_id,
  ts.id,
  'Operations Desk',
  trim(coalesce(nullif(ts.label, ''), 'Starter')) || ' Hotel',
  'Supplier Desk',
  '+84000000000',
  'ops@travelagent.local',
  trim(coalesce(nullif(ts.label, ''), 'Vietnam')) || ', Vietnam',
  unixepoch(),
  unixepoch() + (CASE WHEN coalesce(ts.nights, 0) > 0 THEN ts.nights ELSE 1 END) * 86400,
  'Deluxe',
  2,
  'Backfilled accommodation service',
  'pending',
  'planned',
  coalesce(ts.sort_order, 0),
  unixepoch()
FROM tour_stops ts
WHERE NOT EXISTS (SELECT 1 FROM stop_accommodations sa WHERE sa.tenant_id = ts.tenant_id AND sa.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_meals sm WHERE sm.tenant_id = ts.tenant_id AND sm.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_guides sg WHERE sg.tenant_id = ts.tenant_id AND sg.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_local_transports sl WHERE sl.tenant_id = ts.tenant_id AND sl.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_intercity_legs si WHERE si.tenant_id = ts.tenant_id AND si.tour_stop_id = ts.id);

INSERT INTO stop_guides (
  id,
  tenant_id,
  tour_stop_id,
  person_in_charge,
  guide_name,
  contact_name,
  phone,
  email,
  address,
  languages,
  time_from,
  time_to,
  notes,
  stage,
  status,
  position,
  created_at
)
SELECT
  lower(hex(randomblob(16))),
  ts.tenant_id,
  ts.id,
  'Guide Coordinator',
  trim(coalesce(nullif(ts.label, ''), 'Starter')) || ' Local Guide',
  'Guide Desk',
  '+84000000001',
  'guide@travelagent.local',
  trim(coalesce(nullif(ts.label, ''), 'Vietnam')) || ', Vietnam',
  'English, Vietnamese',
  unixepoch() + 9 * 3600,
  unixepoch() + 17 * 3600,
  'Backfilled guide service',
  'pending',
  'planned',
  coalesce(ts.sort_order, 0),
  unixepoch()
FROM tour_stops ts
WHERE NOT EXISTS (SELECT 1 FROM stop_accommodations sa WHERE sa.tenant_id = ts.tenant_id AND sa.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_meals sm WHERE sm.tenant_id = ts.tenant_id AND sm.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_guides sg WHERE sg.tenant_id = ts.tenant_id AND sg.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_local_transports sl WHERE sl.tenant_id = ts.tenant_id AND sl.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_intercity_legs si WHERE si.tenant_id = ts.tenant_id AND si.tour_stop_id = ts.id);

INSERT INTO stop_local_transports (
  id,
  tenant_id,
  tour_stop_id,
  person_in_charge,
  mode,
  supplier,
  contact_name,
  driver_name,
  phone,
  email,
  address,
  pickup_time,
  pickup_place,
  dropoff_place,
  notes,
  stage,
  status,
  position,
  created_at
)
SELECT
  lower(hex(randomblob(16))),
  ts.tenant_id,
  ts.id,
  'Transport Desk',
  'car7',
  trim(coalesce(nullif(ts.label, ''), 'Starter')) || ' Local Transport',
  'Dispatch Team',
  trim(coalesce(nullif(ts.label, ''), 'Starter')) || ' Driver',
  '+84000000002',
  'transport@travelagent.local',
  trim(coalesce(nullif(ts.label, ''), 'Vietnam')) || ', Vietnam',
  unixepoch() + 8 * 3600,
  trim(coalesce(nullif(ts.label, ''), 'City Center')) || ' center',
  trim(coalesce(nullif(ts.label, ''), 'Hotel')) || ' hotel',
  'Backfilled local transport service',
  'pending',
  'planned',
  coalesce(ts.sort_order, 0),
  unixepoch()
FROM tour_stops ts
WHERE NOT EXISTS (SELECT 1 FROM stop_accommodations sa WHERE sa.tenant_id = ts.tenant_id AND sa.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_meals sm WHERE sm.tenant_id = ts.tenant_id AND sm.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_guides sg WHERE sg.tenant_id = ts.tenant_id AND sg.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_local_transports sl WHERE sl.tenant_id = ts.tenant_id AND sl.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_intercity_legs si WHERE si.tenant_id = ts.tenant_id AND si.tour_stop_id = ts.id);

INSERT INTO stop_meals (
  id,
  tenant_id,
  tour_stop_id,
  person_in_charge,
  meal_type,
  restaurant_name,
  contact_name,
  contact_phone,
  contact_email,
  address,
  meal_datetime,
  notes,
  stage,
  status,
  position,
  created_at
)
SELECT
  lower(hex(randomblob(16))),
  ts.tenant_id,
  ts.id,
  'Operations Desk',
  'breakfast',
  trim(coalesce(nullif(ts.label, ''), 'Starter')) || ' Breakfast Host',
  'Supplier Desk',
  '+84000000010',
  'meal@travelagent.local',
  trim(coalesce(nullif(ts.label, ''), 'Vietnam')) || ', Vietnam',
  unixepoch() + 7 * 3600,
  'Backfilled breakfast service',
  'pending',
  'planned',
  0,
  unixepoch()
FROM tour_stops ts
WHERE coalesce(ts.meal_breakfast, 0) = 1
  AND NOT EXISTS (SELECT 1 FROM stop_accommodations sa WHERE sa.tenant_id = ts.tenant_id AND sa.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_meals sm WHERE sm.tenant_id = ts.tenant_id AND sm.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_guides sg WHERE sg.tenant_id = ts.tenant_id AND sg.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_local_transports sl WHERE sl.tenant_id = ts.tenant_id AND sl.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_intercity_legs si WHERE si.tenant_id = ts.tenant_id AND si.tour_stop_id = ts.id);

INSERT INTO stop_meals (
  id,
  tenant_id,
  tour_stop_id,
  person_in_charge,
  meal_type,
  restaurant_name,
  contact_name,
  contact_phone,
  contact_email,
  address,
  meal_datetime,
  notes,
  stage,
  status,
  position,
  created_at
)
SELECT
  lower(hex(randomblob(16))),
  ts.tenant_id,
  ts.id,
  'Operations Desk',
  'lunch',
  trim(coalesce(nullif(ts.label, ''), 'Starter')) || ' Lunch Partner',
  'Supplier Desk',
  '+84000000011',
  'meal@travelagent.local',
  trim(coalesce(nullif(ts.label, ''), 'Vietnam')) || ', Vietnam',
  unixepoch() + 12 * 3600,
  'Backfilled lunch service',
  'pending',
  'planned',
  1,
  unixepoch()
FROM tour_stops ts
WHERE coalesce(ts.meal_lunch, 0) = 1
  AND NOT EXISTS (SELECT 1 FROM stop_accommodations sa WHERE sa.tenant_id = ts.tenant_id AND sa.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_meals sm WHERE sm.tenant_id = ts.tenant_id AND sm.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_guides sg WHERE sg.tenant_id = ts.tenant_id AND sg.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_local_transports sl WHERE sl.tenant_id = ts.tenant_id AND sl.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_intercity_legs si WHERE si.tenant_id = ts.tenant_id AND si.tour_stop_id = ts.id);

INSERT INTO stop_meals (
  id,
  tenant_id,
  tour_stop_id,
  person_in_charge,
  meal_type,
  restaurant_name,
  contact_name,
  contact_phone,
  contact_email,
  address,
  meal_datetime,
  notes,
  stage,
  status,
  position,
  created_at
)
SELECT
  lower(hex(randomblob(16))),
  ts.tenant_id,
  ts.id,
  'Operations Desk',
  'dinner',
  trim(coalesce(nullif(ts.label, ''), 'Starter')) || ' Dinner Partner',
  'Supplier Desk',
  '+84000000012',
  'meal@travelagent.local',
  trim(coalesce(nullif(ts.label, ''), 'Vietnam')) || ', Vietnam',
  unixepoch() + 18 * 3600,
  'Backfilled dinner service',
  'pending',
  'planned',
  2,
  unixepoch()
FROM tour_stops ts
WHERE coalesce(ts.meal_dinner, 0) = 1
  AND NOT EXISTS (SELECT 1 FROM stop_accommodations sa WHERE sa.tenant_id = ts.tenant_id AND sa.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_meals sm WHERE sm.tenant_id = ts.tenant_id AND sm.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_guides sg WHERE sg.tenant_id = ts.tenant_id AND sg.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_local_transports sl WHERE sl.tenant_id = ts.tenant_id AND sl.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_intercity_legs si WHERE si.tenant_id = ts.tenant_id AND si.tour_stop_id = ts.id);

INSERT INTO stop_intercity_legs (
  id,
  tenant_id,
  tour_stop_id,
  person_in_charge,
  mode,
  supplier,
  contact_name,
  phone,
  email,
  address,
  depart_time,
  depart_point,
  arrive_point,
  ticket_ref,
  notes,
  stage,
  status,
  position,
  created_at
)
SELECT
  lower(hex(randomblob(16))),
  ts.tenant_id,
  ts.id,
  'Transport Desk',
  'car7',
  trim(coalesce(nullif(ts.label, ''), 'Starter')) || ' Intercity Transfer',
  'Dispatch Team',
  '+84000000003',
  'intercity@travelagent.local',
  trim(coalesce(nullif(ts.label, ''), 'Vietnam')) || ', Vietnam',
  unixepoch() + 18 * 3600,
  trim(coalesce(nullif(ts.label, ''), 'Current Stop')) || ' departure point',
  'Next itinerary stop',
  'BF-' || printf('%02d', coalesce(ts.sort_order, 0) + 1),
  'Backfilled intercity transfer',
  'pending',
  'planned',
  coalesce(ts.sort_order, 0),
  unixepoch()
FROM tour_stops ts
WHERE EXISTS (
    SELECT 1
    FROM tour_stops ts2
    WHERE ts2.tenant_id = ts.tenant_id
      AND ts2.tour_id = ts.tour_id
      AND coalesce(ts2.sort_order, 0) > coalesce(ts.sort_order, 0)
  )
  AND NOT EXISTS (SELECT 1 FROM stop_accommodations sa WHERE sa.tenant_id = ts.tenant_id AND sa.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_meals sm WHERE sm.tenant_id = ts.tenant_id AND sm.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_guides sg WHERE sg.tenant_id = ts.tenant_id AND sg.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_local_transports sl WHERE sl.tenant_id = ts.tenant_id AND sl.tour_stop_id = ts.id)
  AND NOT EXISTS (SELECT 1 FROM stop_intercity_legs si WHERE si.tenant_id = ts.tenant_id AND si.tour_stop_id = ts.id);

INSERT INTO tour_prices (
  id,
  tenant_id,
  tour_id,
  season_id,
  segment_id,
  pax_band_id,
  base_currency,
  adult_shared_room_price,
  adult_single_room_price,
  child_shared_with_parents_price,
  notes,
  is_active,
  created_at
)
SELECT
  lower(hex(randomblob(16))),
  t.tenant_id,
  t.id,
  substr('starter-season-' || t.tenant_id, 1, 120),
  substr('starter-segment-' || t.tenant_id, 1, 120),
  substr('starter-pax-2-' || t.tenant_id, 1, 120),
  'USD',
  max(
    CASE
      WHEN json_valid(t.content_data) AND CAST(json_extract(t.content_data, '$.base_price') AS INTEGER) > 0
        THEN CAST(json_extract(t.content_data, '$.base_price') AS INTEGER)
      ELSE 980
    END,
    250
  ),
  max(
    CAST(round((CASE
      WHEN json_valid(t.content_data) AND CAST(json_extract(t.content_data, '$.base_price') AS INTEGER) > 0
        THEN CAST(json_extract(t.content_data, '$.base_price') AS INTEGER)
      ELSE 980
    END) * 1.25) AS INTEGER),
    350
  ),
  max(
    CAST(round((CASE
      WHEN json_valid(t.content_data) AND CAST(json_extract(t.content_data, '$.base_price') AS INTEGER) > 0
        THEN CAST(json_extract(t.content_data, '$.base_price') AS INTEGER)
      ELSE 980
    END) * 0.5) AS INTEGER),
    150
  ),
  'Backfilled starter pricing for ' || coalesce(nullif(trim(t.title), ''), 'tour'),
  1,
  unixepoch()
FROM tours t
WHERE NOT EXISTS (
  SELECT 1
  FROM tour_prices tp
  WHERE tp.tenant_id = t.tenant_id
    AND tp.tour_id = t.id
);