-- Migration 0095: default ROH capacity filter on pricing profiles

ALTER TABLE property_pricing_profiles ADD COLUMN roh_capacity_filter TEXT;

UPDATE property_pricing_profiles
   SET roh_capacity_filter = 'max_2'
 WHERE room_type_id IS NULL
   AND UPPER(COALESCE(code, '')) = 'ROH'
   AND roh_capacity_filter IS NULL;