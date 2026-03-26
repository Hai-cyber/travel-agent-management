> **RUNTIME NOTE:**
> Only migration **0001** is currently applied in the rescue runtime. Migrations **0002+** in this file are planned and not executed yet. See 01_CURRENT_STATE.md for runtime truth.

Update this migration plan to clearly distinguish what is already applied vs planned.

Source of truth:
- 01_CURRENT_STATE.md (only base schema is confirmed)

Task:
1. Add a "RUNTIME NOTE" near the top stating:
   - only migration 0001 is currently applied in the rescue runtime
   - migrations 0002+ in this file are planned and not executed yet.
2. In section "6. First migration to implement now", add a sentence that this migration is the next planned step and is not yet applied.
Do not change the migration content itself.

1. Current reality

Current rescue runtime is small and working. Confirmed slices:

Worker shell runs locally
D1 local works
Existing rebuilt tables include:
tours
destinations
tour_destinations
destination_texts
tenants
tour_stops
Existing preview endpoints work for current slices

Important interpretation:

tour_destinations exists, but is transitional
tour_stops is the canonical itinerary direction
old destination-based service/pricing docs are reference only, not runtime truth
2. Target design

Target canonical design is defined by docs/DATA_MODEL.sql.

The key architectural differences that matter for migration are:

Itinerary
destinations = catalog/reference only
tour_stops = actual itinerary segments inside a tour
Service operations

All operational service items must use:

tour_stop_id

not:

destination_id
Pricing

Pricing must move away from flat legacy fields and use:

tenant_seasons
pricing_segments
pax_bands
tour_prices
General rule

Migration should move the runtime gradually toward the canonical model without breaking the currently working rescue system.

3. Migration rules

These rules are mandatory.

Safety
additive only
no table drops
no destructive renames
no overwriting working tables
no bulk import from old schema
no “big bang” migration
Execution
one migration = one capability slice
each migration must be independently testable
each migration must include local verification commands
old conflicting tables may remain as transitional until usage is migrated
Interpretation
schema.sql = current runtime truth
docs/DATA_MODEL.sql = target design truth
if old docs conflict with the rescue repo, prefer rescue runtime + canonical model
4. Migration slices
Migration 0002
Filename

db/migrations/0002_add_stop_service_core.sql

Purpose

Add the stop-based service planning foundation for the new itinerary model.

Tables to create
service_types
tour_stop_service_flags
Why this slice now

This is the smallest safe next step after tour_stops.

It enables the product behavior you described:

agent creates a stop
agent toggles:
accommodation
meals
guide
local transport
intercity transport

This slice introduces the on/off planning layer before detailed operational records.

Canonical table intent
service_types

Static canonical service definitions:

accommodation
meals
guide
local_transport
intercity_transport
tour_stop_service_flags

Stores which service types are enabled for each stop.

Transitional notes
old destination-based service tables, if any appear later, remain legacy/transitional
do not wire tasks or comms yet
Verification

After applying migration:

list tables
insert 5 service types
enable 1–2 flags on existing demo tour_stop
query joined results

Example checks:

SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
SELECT * FROM service_types;
SELECT * FROM tour_stop_service_flags;
Migration 0003
Filename

db/migrations/0003_add_stop_service_detail_tables.sql

Purpose

Add the new canonical operational service-item tables linked to tour_stop_id.

Tables to create
stop_accommodations
stop_meals
stop_guides
stop_local_transports
stop_intercity_legs
Why this slice now

Once stop-level toggles exist, the next step is the detail records that power real operations.

This matches your intended flow:

enable service
fill operational details
later convert into admin work/tasks
Canonical table rule

Every table in this slice must use:

tour_stop_id

not:

destination_id
Transitional notes
do not drop or rewrite any legacy destination-based service tables yet
if similar legacy tables exist in docs, mark them as historical/reference only
no data migration from old tables in this slice
Verification

After applying migration:

list tables
insert one sample accommodation row for existing demo stop
insert one sample meal row
query service items by tour_stop_id

Example checks:

SELECT * FROM stop_accommodations;
SELECT * FROM stop_meals;
SELECT * FROM stop_guides;
SELECT * FROM stop_local_transports;
SELECT * FROM stop_intercity_legs;
Migration 0004
Filename

db/migrations/0004_add_pricing_foundation.sql

Purpose

Add the new tenant-configurable pricing foundation.

Tables to create
tenant_seasons
pricing_segments
pax_bands
tour_prices
Why this slice now

Pricing should come after stop-based itinerary/service structure is established, but before tasks/comms/site rebuild.

This slice supports your real business model:

each tenant defines seasons differently
each tenant defines segment labels differently
each tenant defines pax bands differently
price rows belong to tours
Canonical pricing rules

Do not use flat legacy pricing shape like:

season TEXT
direct pax_from/pax_to inside old simplified tour_prices

Use references instead:

season_id
segment_id
pax_band_id
Transitional notes
no currency conversion engine in this slice
no pricing UI rewrite in this slice
no market-display formatting logic in this slice
store base price values only
Verification

After applying migration:

insert one sample season
insert one sample pricing segment
insert one sample pax band
insert one sample tour price row
query joined readable output

Example checks:

SELECT * FROM tenant_seasons;
SELECT * FROM pricing_segments;
SELECT * FROM pax_bands;
SELECT * FROM tour_prices;
Migration 0005
Filename

db/migrations/0005_prepare_tasks_and_comms_alignment.sql

Purpose

Prepare later rebuild of operational task and communication flows on top of the stop-based service model.

Tables to create

Only create missing foundational tables if they do not already exist in the rescue runtime plan, such as:

comm_threads
comm_messages
tasks
Why this slice is later

Tasks and communications should not be rebuilt before:

itinerary is canonical
service items are canonical
pricing foundation is settled

Otherwise they will attach to the wrong entities.

Canonical direction

Threads and tasks should ultimately attach to:

stop-based service items
not destination-based legacy structures
Transitional notes
no full automation yet
no booking→task generation yet
no reminder cadence yet unless independently needed later
Verification
create a thread for one sample stop service item
create one task referencing one service item
query both
5. Explicit non-goals

Do not do these now:

no data migration from old destination-based structures
no dropping legacy tables
no renaming legacy tables in place
no attempt to fully restore old tasks/comms/site/growth modules
no public/site rendering work
no pricing UI work
no currency conversion engine
no locale formatting engine
no full booking engine rebuild
no “sync old docs into runtime” bulk action
6. First migration to implement now

**Note:** As of now, this migration is **not yet applied**; it is the next planned step.

The first migration that should be implemented immediately is:

0002_add_stop_service_core.sql

Reason:

smallest useful next slice
directly supports your “smart tour management” concept
builds on tour_stops
avoids premature complexity
gives a safe bridge into operational services
7. Suggested file sequence
db/migrations/0002_add_stop_service_core.sql
db/migrations/0003_add_stop_service_detail_tables.sql
db/migrations/0004_add_pricing_foundation.sql
db/migrations/0005_prepare_tasks_and_comms_alignment.sql