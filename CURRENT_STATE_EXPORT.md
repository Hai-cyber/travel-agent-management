# CURRENT_STATE_EXPORT.md

> **Generated:** 2026-04-02 | **Branch:** `rescue-minimum` | **Last local verification:** 2026-04-02
> Source of truth: `docs/ai/01_CURRENT_STATE.md` + `docs/ai/03_PROGRESS_LEDGER.md`
> This export is a convenience snapshot. If any section here conflicts with those docs, those docs win.

---

## Project Structure

```
src/
  index.js                    — Hono app + URLPattern router + tenant middleware + CORS
  routes/
    bookings.js               — Drafts, orders, proof upload, guest portal, cron purge
    categories.js             — Tour categories CRUD
    payments.js               — Payment webhooks, notify settings, payment methods toggle
    pricing.js                — Pricing engine (seasons, segments, pax bands, tour prices, calculate)
    serviceItems.js           — 5-group stop service item CRUD
    tasks.js                  — Task status management
    tenants.js                — Tenant settings, audit log, site config
    tours.js                  — Tour CRUD + stops CRUD + publish/preview/switch-template
  lib/
    notifications.js          — notifyAgent() — Telegram + webhook push (non-blocking)
    publishGuard.js           — checkPublishPermission(), preview/live render helpers
    siteStudio.js             — resolveTenantByHost(), serveSitePage() HTMLRewriter pipeline
  services/
    serviceItems.js           — Service item business logic
    tasks.js                  — Task generation + templates per service group
  utils/
    formatter.js              — formatMoney, formatDateTime, translate, resolveLocaleFromAcceptLanguage
  locales/                    — i18n string tables (en, vi)
```

---

## 4. Runtime Summary

- Cloudflare Worker runtime and local D1 database are working under `wrangler dev`
- Pricing, tenants, tours, booking-order creation, proof upload, guest portal GET, service-item accommodations CRUD, and task patching were verified locally by 2026-04-02
- Universal storefront runtime is now multi-skin-ready in structure, with theme modules under `src/lib/themes/` and Six Senses preserved as the first real skin module/runtime baseline
- Website Design is now the preview-first storefront admin path; expanded system settings drive storefront chrome toggles, menu visibility, floating buttons, page visibility, logo/fonts/colors, and broader contact/system controls
- Service item CRUD API (CHK‑R09):
  - All 5 groups implemented: accommodations, meals, guides, local-transports, intercity-legs
  - Accommodations `POST/GET/PATCH` verified locally on 2026-03-30
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
  - `PATCH /api/tasks/:taskId` is restored and verified locally in the Windows smoke flow on 2026-04-02
- Preview endpoints:
  - /api/tours-preview
  - /api/destinations-preview
  - /api/tour-destinations-preview
  - /api/destination-texts-preview
  - /api/tours-with-destinations

## Known local runtime defects (2026-04-02)

- No currently reproduced defects in the task, pricing-calculate, and booking flows covered by `npm test`

## Key Files
- docs/ai/01_CURRENT_STATE.md — Source of runtime truth
- docs/ai/03_PROGRESS_LEDGER.md — Progress and checkpoint log
- src/lib/themes/index.js — Theme registry/resolver for the universal storefront runtime
- src/lib/themes/six-senses.js — First committed premium storefront skin module
- public/universal-admin.html — Preview-first Website Design admin with contextual edit + expanded system panel
- scripts/apply-local-migrations.mjs — local D1 reconcile + migrate wrapper for Windows-friendly setups
- scripts/smoke-local.mjs — Node smoke runner used by `npm test` for task patch, pricing calculate, and booking confirm coverage
- src/routes/serviceItems.js — Service item API handlers
- src/routes/tasks.js — Task API handlers
- src/services/serviceItems.js — Service item logic
- src/services/tasks.js — Task logic
- test/ — Test scripts for all service item groups and tasks

This file is a historical export, not the live runtime source of truth. For current status, see `docs/ai/01_CURRENT_STATE.md` and `docs/ai/03_PROGRESS_LEDGER.md`.
