
> RUNTIME NOTE: This document reflects the CURRENT RUNTIME of the rescue repo. Only features confirmed in 01_CURRENT_STATE.md are considered implemented. All others are planned/target design.

# REALITY CHECK (ANTI-HALLUCINATION)

## Implemented (Rescue runtime truth)
- Cloudflare Worker runtime with basic shell
- D1 with tables: tours, destinations, tour_destinations, destination_texts, tenants, tour_stops
- Preview endpoints:
	- /api/tours-preview
	- /api/destinations-preview
	- /api/tour-destinations-preview
	- /api/destination-texts-preview
	- /api/tours-with-destinations

## Planned (legacy/target, NOT implemented in rescue repo yet)
- Service-item operational CRUD (5 groups, linked to tour_stop_id)
- Task APIs + manual generation + CHK-207 day-1 task auto-creation
- CHK-208 calendar baseline:
	- tenant calendar config endpoints
	- ICS tour task feed
	- Google sync payload preview endpoint
	- reminder candidate endpoints for monthly + 14d/7d/3d before tour start
- Domain onboarding flow with tenant hostname claim + verification state
- Publish gate checklist endpoints with `on_sale` enforcement
- Billing status endpoints with unpaid/trial-expired restrictions for publish and new bookings
- Site studio API baseline for theme/legal/contact/search and multilingual public tour copy
- Growth/SEO API baseline for slugs/metadata, sitemap/robots, and lead/event capture hooks
- Thread/message handling (email + notes)
- Static UI shell (Tour/Pricing/Visual) + mini-card service UI (local data)
- AI documentation layer

## Rule

Copilot MUST NOT assume any feature exists unless listed in "Implemented".

If missing:
- ask OR
- mark TODO with [CHK-XXX]