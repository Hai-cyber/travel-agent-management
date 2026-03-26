> RUNTIME NOTE: This document describes TARGET DESIGN for this module.
> The current rescue runtime does NOT implement these flows yet. Actual implemented slices are listed in 01_CURRENT_STATE.md.
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

# COMMUNICATION CHANNELS

## Supported Channels (MVP)

### Native
- Email (send + log)

### Deep Link + Manual Log
- WhatsApp
- Zalo
- Facebook
- Phone call


## Thread Model

- Each service item (linked to tour_stop_id) has:
  - one thread
  - message timeline

> NOTE: Legacy "destination" logic is retained for business intent but is not canonical for itinerary modeling. All operational service items must reference tour_stop_id.

## Message Types

- outbound
- inbound
- note

## Logging Rule

All communication MUST be logged into thread.

## Future (Phase 2)

- WhatsApp Cloud API integration
- Zalo OA integration (optional)
- Facebook messaging API (optional)