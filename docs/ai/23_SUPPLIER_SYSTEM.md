> **RUNTIME NOTE:**
> This file describes the **TARGET DESIGN** for the Supplier System module. The current rescue runtime does **NOT** implement these flows yet. Actual implemented slices are listed in 01_CURRENT_STATE.md.

You are updating this markdown file to clearly mark it as TARGET DESIGN only.

Source of truth:
- 01_CURRENT_STATE.md

Rules:
- This module (monetization/domain/publish/billing/site studio/growth/mobile/CRM/supplier/communications) is NOT implemented in the current rescue runtime.
- This document should be kept as product/architecture intent, not runtime truth.

Task:
1. Add a "RUNTIME NOTE" near the top saying:
   - this file describes TARGET DESIGN for this module
   - the current rescue runtime does NOT implement these flows yet
   - actual implemented slices are listed in 01_CURRENT_STATE.md.
2. Do NOT change the rest of the content. Just add the note.

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
