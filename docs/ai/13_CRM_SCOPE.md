> **RUNTIME NOTE:**
> This file describes the **TARGET DESIGN** for the CRM module. The current rescue runtime does **NOT** implement these flows yet. Actual implemented slices are listed in 01_CURRENT_STATE.md.

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

# CRM SCOPE (MVP)

## Purpose

Support booking and operations only.
NOT a full CRM system.

## Entities

- Customer
- Traveler
- Booking
- Supplier

## Contact Identity

Each entity may have:
- email
- phone
- zalo
- whatsapp

## Scope

- basic info storage
- link to bookings
- notes

## Out of Scope

- pipelines
- automation
- marketing campaigns

## Future

- optional Odoo integration
- export customer data