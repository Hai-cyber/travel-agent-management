# Test Plan

Test scopes, strategy, and acceptance criteria.

# Test Plan (MVP)

- Unit:
	- schedule compute (nights → arrival/departure via tour_stops)
	- reminder cadence generator (monthly + 14d/7d/3d before tour start)
- Integration:
	- create tour_stop → add 5 nhóm service item (linked to tour_stop_id)
	- create tour with day1 toggles → day1 tasks created as expected
	- calendar endpoints:
		- config read/write
		- ICS feed generation
		- Google sync preview payload
	- reminder candidate listing + mark-sent idempotency
- Contract:
	- API response envelope and route schema follow `API_SPEC.md`
	- cadence semantics use tour start date (not task due date)
- E2E (next):
	- connect UI shell to service CRUD + calendar/reminder endpoints
	- mobile-ops quick actions and thread-note logging (CHK-304)

> NOTE: Canonical itinerary is now tour_stops (not destinations). All operational service items must reference tour_stop_id. Legacy destination_id linkage is retained for business intent only.

## Pricing model upgrade
- Canonical pricing uses tenant_seasons, pricing_segments, pax_bands, and tour_prices. Flat season/pax fields are deprecated.