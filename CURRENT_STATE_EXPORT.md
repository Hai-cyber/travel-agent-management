# CURRENT_STATE_EXPORT.md

## Project Structure (as of 2026-03-25)

```
AGENTS.md
package.json
schema.sql
wrangler.jsonc
db/
  dev_seed_safe.sql
  schema_snapshot.sql
  migrations/
    0002_add_stop_service_core.sql
    0003_add_stop_service_detail_tables.sql
    0004_add_pricing_foundation.sql
    0005_prepare_tasks_and_comms_alignment.sql
    0011_tasks.sql
docs/
  API_SPEC.md
  ARCHITECTURE.md
  DATA_MODEL.sql
  DECISION_LOG.md
  DOMAIN_MODEL.md
  GLOSSARY.md
  PROJECT_BRIEF.md
  SEED_DATA.md
  SYSTEM_PATCH_V1
  TEST_PLAN.md
  ai/
    00_AI_INDEX.md
    01_CURRENT_STATE.md
    02_WORKING_AGREEMENT.md
    03_PROGRESS_LEDGER.md
    04_SESSION_HANDOFF.md
    05_PROMPT_RECIPES.md
    06_PRODUCT_MODEL.md
    07_REALITY_CHECK.md
    08_MONETIZATION_LOGIC.md
    09_DOMAIN_POLICY.md
    10_DOMAIN_ONBOARDING_FLOW.md
    11_PUBLISHING_RULES.md
    12_COMMUNICATION_CHANNELS.md
    13_CRM_SCOPE.md
    14_TENANCY_AND_BILLING.md
    15_TOUR_AND_SITE_STRUCTURE.md
    16_PUBLISH_GATE.md
    17_SITE_STUDIO_SCOPE.md
    18_CODE_CONVENTIONS.md
    19_BILINGUAL_POLICY.md
    20_AI_DISPATCH.md
    21_GROWTH_SEO_MODULE.md
    23_SUPPLIER_SYSTEM.md
    24_MOBILE_STRATEGY.md
    25_MOBILE_OPS_RULES.md
    MIGRATION_PLAN_V1.md
  archive/
    01_CURRENT_STATE_old.md
    03_PROGRESS_LEDGER_old.md
    04_SESSION_HANDOFF_old.md
    DATA_MODEL_canonical_v2.sql
src/
  index.js
  routes/
    serviceItems.js
    tasks.js
  services/
    serviceItems.js
    tasks.js
test/
  service-items.test.js
  test_all_services.sh
  test_guides.sh
  test_intercity_legs.sh
  test_local_transports.sh
  test_meals.sh
  test_tasks.sh
.editorconfig
.gitignore
.prettierrc
package-lock.json
```

## Current State Summary

- Cloudflare Worker runtime, D1 database
- All core tables present: tours, destinations, tour_destinations, destination_texts, tenants, tour_stops, stop_accommodations, stop_meals, stop_guides, stop_local_transports, stop_intercity_legs, tasks
- Service item CRUD API (CHK‑R09):
  - All 5 groups implemented: accommodations, meals, guides, local-transports, intercity-legs
  - POST/GET/PATCH fully working
  - Schema-aligned payloads
  - Validation for POST and PATCH implemented (CHK‑R10)
- Validation (CHK‑R10):
  - Required-field validation for POST
  - Unknown-field and empty-body validation for PATCH
  - No changes to service layer
- Task System (CHK‑R11):
  - Task templates for all 5 groups
  - Auto-generate tasks on POST
  - GET returns tasks embedded in each service item
  - PATCH /api/tasks/:taskId updates task status
  - All 5 test scripts passed (accommodations, meals, guides, local-transports, intercity-legs)
  - Full integrated test script passed
- Preview endpoints:
  - /api/tours-preview
  - /api/destinations-preview
  - /api/tour-destinations-preview
  - /api/destination-texts-preview
  - /api/tours-with-destinations

## Key Files
- docs/ai/01_CURRENT_STATE.md — Source of runtime truth
- docs/ai/03_PROGRESS_LEDGER.md — Progress and checkpoint log
- src/routes/serviceItems.js — Service item API handlers
- src/routes/tasks.js — Task API handlers
- src/services/serviceItems.js — Service item logic
- src/services/tasks.js — Task logic
- test/ — Test scripts for all service item groups and tasks

defaults: All features above are implemented and tested as of 2026-03-25. For details, see 01_CURRENT_STATE.md and 03_PROGRESS_LEDGER.md.
