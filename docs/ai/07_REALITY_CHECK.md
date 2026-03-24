# REALITY CHECK (ANTI-HALLUCINATION)


## Implemented
- Cloudflare Worker runtime with structured observability
- Tours + tour_stops CRUD with tenant guardrails (tour_stops are canonical itinerary segments)
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

> NOTE: Legacy "destination" logic is retained for business intent but is not canonical for itinerary modeling. All operational service items must reference tour_stop_id.

> Pricing model upgrade: Flat season/pax fields are deprecated. Canonical pricing now uses tenant_seasons, pricing_segments, pax_bands, and tour_prices.

> AI doc control: Do not assume legacy-doc completion is canonical for itinerary or pricing; always check for tour_stops and new pricing model.

## NOT Implemented (DO NOT ASSUME)

### UI / Product Surface
- UI shell is not yet fully connected to all backend operational APIs
- Consolidated task + communication timeline UI is missing
- Itinerary preview/composer UI is missing (TODO [CHK-303])

### Platform / Tenant Lifecycle


### Growth / Distribution


### Integrations
- Calendar OAuth/live push jobs for Google/iPhone channels are not fully wired
- Reminder automation scheduler delivery is not yet wired (candidate APIs exist)

## Rule

Copilot MUST NOT assume any feature exists unless listed in "Implemented".

If missing:
- ask OR
- mark TODO with [CHK-XXX]