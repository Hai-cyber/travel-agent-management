> **RUNTIME NOTE:**
> This file describes the **TARGET DESIGN** for the Mobile Strategy module. The current rescue runtime does **NOT** implement these flows yet. Actual implemented slices are listed in 01_CURRENT_STATE.md.

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

# MOBILE STRATEGY

## Principle

Mobile is for operations, not configuration.

## Desktop

- tour builder
- pricing
- site studio

## Mobile

- tasks
- service details
- communication threads
- quick actions (call, chat)


## Rule

Do NOT replicate full builder on mobile.

> NOTE: Canonical itinerary is now tour_stops (not destinations). All operational service items must reference tour_stop_id. Legacy destination_id linkage is retained for business intent only.

## Goal

- fast actions
- minimal input
- real-time usage
