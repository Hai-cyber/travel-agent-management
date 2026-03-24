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