# AI DISPATCH

## Always Read First
- 00_AI_INDEX.md
- 01_CURRENT_STATE.md
- 07_REALITY_CHECK.md

## Read Per Session
- 03_PROGRESS_LEDGER.md
- 04_SESSION_HANDOFF.md

## Read Only If Relevant
- 06_PRODUCT_MODEL.md
- ../PROJECT_BRIEF.md
- ../ARCHITECTURE.md
- ../DOMAIN_MODEL.md
- ../API_SPEC.md
- ../TEST_PLAN.md
- 08_MONETIZATION_LOGIC.md
- 09_DOMAIN_POLICY.md
- 10_DOMAIN_ONBOARDING_FLOW.md
- 11_PUBLISHING_RULES.md
- 12_COMMUNICATION_CHANNELS.md
- 13_CRM_SCOPE.md
- 14_TENANCY_AND_BILLING.md
- 15_TOUR_AND_SITE_STRUCTURE.md
- 16_PUBLISH_GATE.md
- 17_SITE_STUDIO_SCOPE.md
- 18_CODE_CONVENTIONS.md
- 19_BILINGUAL_POLICY.md
- 21_GROWTH_SEO_MODULE.md
- 23_SUPPLIER_SYSTEM.md
- 24_MOBILE_STRATEGY.md
- 25_MOBILE_OPS_RULES.md

## Rules
- Do not scan the full repository by default
- Work by checkpoint [CHK-XXX]
- Read only files relevant to the current task
- Keep changes scoped
- Update docs minimally

## Fast routing by checkpoint
- CHK-201/202/203/207/208: `src/routes/*`, `src/services/*`, `test/*`, `docs/API_SPEC.md`
- CHK-209: `docs/ai/23_SUPPLIER_SYSTEM.md`, `docs/DOMAIN_MODEL.md`, service tables/routes/tests
- CHK-301/302/303: `public/index.html`, related tests/docs
- CHK-304: `docs/ai/24_MOBILE_STRATEGY.md`, `docs/ai/25_MOBILE_OPS_RULES.md`, mobile-oriented task/thread UI slices
- CHK-401-405: `docs/ai/*` strategy files first, then runtime slices