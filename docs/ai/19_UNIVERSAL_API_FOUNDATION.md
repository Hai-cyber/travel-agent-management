# UNIVERSAL API FOUNDATION

Last updated: 2026-03-31
Branch: `pivot/universal-template`

## Intent

Keep current Site Studio as `legacy`.

Build a second public-site system in parallel under:
- `/api/universal/*`

The universal system reuses shared business engines already built:
- `tour builder`
- `pricing engine`
- existing tenant model
- existing booking engine strategy for travel-agent tour pages

## Runtime boundary

### Legacy layer
- existing Site Studio routes and visual editor
- existing template render flow
- existing tenant template configuration

### New layer
- universal site schema
- universal page/menu/theme/contact APIs
- variant registry for 3 industry groups and 5 concrete variants
- auto-bound travel tour public page records

Legacy is not removed.
Universal is additive.

## New migration

`db/migrations/0029_universal_site_foundation.sql`

Tables:
- `tenant_universal_sites`
- `tenant_universal_theme_tokens`
- `tenant_universal_contacts`
- `tenant_universal_pages`
- `tenant_universal_menu_items`
- `tenant_universal_tour_pages`

## New library

`src/lib/universalSite.js`

Provides:
- group registry
- 8 variant registry
- standard page registry
- default menu/theme/contact/page seed builders
- slug helper
- auto tour page key helper

## New API routes

`src/routes/universalSites.js`

Registered at:
- `/api/universal`

### Foundation endpoints
- `GET /api/universal/health`
- `GET /api/universal/site/variants`
- `GET /api/universal/site/bootstrap`

### Site config
- `GET /api/universal/site/config`
- `PATCH /api/universal/site/config`

### Theme
- `GET /api/universal/site/theme`
- `PUT /api/universal/site/theme`

### Contact schema
- `GET /api/universal/site/contact`
- `PUT /api/universal/site/contact`

### Menu schema
- `GET /api/universal/site/menu`
- `PUT /api/universal/site/menu`

### Page schema
- `GET /api/universal/site/pages`
- `POST /api/universal/site/pages`
- `PATCH /api/universal/site/pages/:pageId`

### Travel auto-page binding
- `POST /api/universal/tours/:tourId/page/sync`
- `GET /api/universal/tours/:tourId/page`

## Seed behavior

The first read to the universal API auto-seeds a default universal site for the tenant.

Default seed today:
- group: `tour_operator`
- variant: `tour-adventure`
- default pages
- default header menu
- default theme tokens
- default contact schema
- editor schema for frontend-driven form rendering

This is a foundation scaffold, not the final editor UX.

## Critical guarantees

- New universal API does not replace legacy Site Studio.
- Existing business engines remain shared and canonical.
- Tour-operator public pages are still bound to `tour_id`.
- Booking CTA binding is stored in universal tour page records, not left as free text only.

## Next step

Next implementation layer should map the editor UI onto these APIs instead of modifying legacy Site Studio further.