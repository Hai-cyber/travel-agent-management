# Progress Ledger

Purpose: track **actual rescue-rebuild progress** only.

Do not mark work as done because it existed in the old system.
Do not mark work as done because it is documented.
Only mark work as done when it is rebuilt and verified in the current repo.

## Status legend
- `not_started`
- `in_progress`
- `blocked`
- `done`
- `legacy_only` = existed in old system/docs but not rebuilt in current repo

## Checkpoint table
| Checkpoint | Title | Status | Code reality | Last update | Notes |
|---|---|---|---|---|---|
| CHK-R00 | Rescue baseline / local worker shell | done | local Worker + D1 baseline verified | 2026-03-24 | `/`, `/api/db-check`, `/api/tables` working |
| CHK-R01 | Tours base table + preview | done | `tours` exists and preview route works | 2026-03-24 | demo tour confirmed |
| CHK-R02 | Destinations catalog + preview | done | `destinations` exists and preview route works | 2026-03-24 | catalog direction chosen |
| CHK-R03 | Transitional tour_destinations relation | done | relation table exists and join preview works | 2026-03-24 | transitional only, not final itinerary model |
| CHK-R04 | Destination texts + preview | done | `destination_texts` exists and preview route works | 2026-03-24 | demo VI text confirmed |
| CHK-R05 | Tour aggregate preview | done | `/api/tours-with-destinations` works | 2026-03-24 | useful rescue preview, not final domain API |
| CHK-R06 | Tenants foundation | done | `tenants` exists with demo tenant | 2026-03-24 | multi-tenant direction restored |
| CHK-R07 | Canonical itinerary entity: tour_stops | done | `tour_stops` exists and demo row confirmed | 2026-03-24 | canonical itinerary direction locked |
| CHK-R08 | Canonical docs reset | in_progress | docs being reset from legacy reality to rescue reality | 2026-03-24 | `01_CURRENT_STATE`, `03_PROGRESS_LEDGER`, `04_SESSION_HANDOFF` being regenerated |
| CHK-R09 | Stop-based service model | not_started | not rebuilt yet | 2026-03-24 | service items must move to `tour_stop_id` |
| CHK-R10 | Pricing foundation | not_started | not rebuilt yet | 2026-03-24 | `tenant_seasons`, `pricing_segments`, `pax_bands`, `tour_prices` |
| CHK-R11 | Tasks/comms rebuild | not_started | not rebuilt yet | 2026-03-24 | rebuild later on top of stop-based service model |
| CHK-R12 | Public/site/growth rebuild | not_started | not rebuilt yet | 2026-03-24 | old docs exist, new runtime not yet restored |

## Legacy checkpoints from old system/docs
The following old checkpoint families must be treated as historical/reference only unless rebuilt again in the current repo:

- `CHK-101` through `CHK-209`
- `CHK-301` through `CHK-405`

For the rescue repo, they should be interpreted as:
- useful business reference
- not proof of current implementation

## Change log

### 2026-03-24
- reset project reality from old-system completion claims to rescue-rebuild truth
- confirmed working rescue slices:
  - tours
  - destinations
  - tour_destinations
  - destination_texts
  - tenants
  - tour_stops
- confirmed working rescue preview endpoints:
  - `/api/tours-preview`
  - `/api/destinations-preview`
  - `/api/tour-destinations-preview`
  - `/api/destination-texts-preview`
  - `/api/tours-with-destinations`
- locked canonical direction:
  - `destinations` = catalog/reference
  - `tour_stops` = itinerary segments
- marked stop-based services and pricing as next major rebuild slices

## Update template
### YYYY-MM-DD
- Checkpoint:
- Status:
- Files changed:
  - path/to/file
- Summary:
- Risks / TODO:
- Verification:
