-- Migration 0083: Billing add-on slots for properties and staff
--
-- Purpose:
--   Track how many paid extra slots a tenant has purchased for:
--     • extra_property_slots — each slot allows +1 property beyond the 1 included
--     • extra_staff_slots    — each slot allows +1 non-owner member beyond the tier base
--
-- Pricing (applied on checkout):
--   extra_property_slots: +4.99 EUR/month per slot
--   extra_staff_slots:    +1.00 EUR/month per slot

ALTER TABLE tenants ADD COLUMN extra_property_slots INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN extra_staff_slots    INTEGER NOT NULL DEFAULT 0;
