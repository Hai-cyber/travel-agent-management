-- Migration 0082: Property address fields
--
-- Purpose:
--   Add physical address columns to the properties table so each
--   property location can be precisely identified for guests,
--   invoices, and multi-location billing.

ALTER TABLE properties ADD COLUMN address_line_1  TEXT;
ALTER TABLE properties ADD COLUMN address_line_2  TEXT;
ALTER TABLE properties ADD COLUMN city            TEXT;
ALTER TABLE properties ADD COLUMN state_province  TEXT;
ALTER TABLE properties ADD COLUMN postal_code     TEXT;
ALTER TABLE properties ADD COLUMN country_code    TEXT;
