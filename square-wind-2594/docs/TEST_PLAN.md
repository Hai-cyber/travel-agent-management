# Test Plan

Test scopes, strategy, and acceptance criteria.

# Test Plan (MVP)

- Unit:
	- schedule compute (nights → arrival/departure)
	- reminder cadence generator (monthly + 14d/7d/3d before tour start)
- Integration:
	- create destination → add 5 nhóm service item
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