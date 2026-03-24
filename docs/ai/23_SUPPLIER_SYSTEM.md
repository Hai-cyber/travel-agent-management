# SUPPLIER SYSTEM

## Purpose
Manage external service providers (hotel, guide, transport).

## Supplier

- id
- tenant_id
- name
- type
- contact
- notes


## Usage

- service items reference supplier_id
- service items are linked to tour_stop_id (canonical itinerary segment)

> NOTE: Legacy "destination" logic is retained for business intent but is not canonical for itinerary modeling. All operational service items must reference tour_stop_id.

## Principle

- supplier is generic
- no inventory in MVP

## Future

- optional modules:
  - hotel inventory
  - availability
  - pricing
