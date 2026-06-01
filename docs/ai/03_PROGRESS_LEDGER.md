# Progress Ledger

Purpose: keep one stable entry point for progress tracking while the real checkpoint history is now split into clearer domain ledgers.

## Use these files

- `03A_PROGRESS_LEDGER_TOUR_PLATFORM.md`
  Tour engine + shared platform/runtime work.
  Use for tours, pricing, booking drafts/orders, ops board, dashboard, auth, billing, publishing, universal site, and other shared platform surfaces.

- `03B_PROGRESS_LEDGER_HOTEL_PROPERTY.md`
  Hotel/property engine work.
  Use for properties, room inventory, availability, holds, property reservations, room ops, housekeeping, maintenance, folio, and later hotel/property surfaces.

- `03C_PROGRESS_LEDGER_COMBINED_ARCHIVE.md`
  Preserved combined history from before the split.
  Use only when older notes matter and the split ledgers do not provide enough historical context.

## Working rule

- If the task primarily touches `tours`, `booking_orders`, `tour-config`, `dashboard`, `universal site`, `billing`, `auth`, or other shared platform surfaces, update `03A_PROGRESS_LEDGER_TOUR_PLATFORM.md`.
- If the task primarily touches `properties`, `room_types`, `room_units`, `property_reservations`, `inventory_holds`, `reservation_allocations`, `room_state_events`, `housekeeping_tasks`, `maintenance_issues`, `folios`, or other hotel/property surfaces, update `03B_PROGRESS_LEDGER_HOTEL_PROPERTY.md`.
- Recent tour runtime additions routed into `03A_PROGRESS_LEDGER_TOUR_PLATFORM.md`: `GET/POST/PATCH /api/pricing/gift-cards` and optional `gift_card_id_code` support on `/api/pricing/calculate`, `/api/bookings/draft`, and `/api/bookings/order`. Sample curl: `curl -X POST http://localhost:8787/api/pricing/gift-cards -H "Content-Type: application/json" -H "X-Tenant-Id: demo-luxury" -d "{\"tour_id\":\"tour_demo\",\"recipient_email\":\"guest@example.com\",\"recipient_phone\":\"+84901123456\",\"face_value\":200,\"notes\":\"VIP recovery\"}"`
- Recent tour runtime additions routed into `03A_PROGRESS_LEDGER_TOUR_PLATFORM.md`: `GET/POST/PATCH /api/pricing/discount-coupons` and optional `discount_coupon_code` support on `/api/pricing/calculate`, `/api/bookings/draft`, and `/api/bookings/order`. Sample curl: `curl -X POST http://localhost:8787/api/pricing/discount-coupons -H "Content-Type: application/json" -H "X-Tenant-Id: ten-demo-001" -d "{\"tour_id\":\"tour-001\",\"code\":\"FAMILY10\",\"label\":\"Family referral\",\"discount_type\":\"amount\",\"discount_value\":50,\"currency\":\"USD\",\"max_uses\":25}"`
- Recent shared-platform admin addition: `POST /api/admin/tenants/:id/send-manual-payment-link` sends a manually reviewed payment-link email to the tenant via the existing GAS webhook. Sample curl: `curl -X POST http://localhost:8787/api/admin/tenants/ten-demo-001/send-manual-payment-link -H "Content-Type: application/json" -H "X-Admin-Secret: $ADMIN_SECRET" -d "{\"purpose\":\"domain_request\",\"request_label\":\"Domain: yourbrand.com\",\"amount_label\":\"EUR 9.98\",\"payment_link\":\"https://wise.com/pay/r/example\",\"note\":\"We confirm manually after funds arrive.\"}"`
- Recent property runtime additions routed into `03B_PROGRESS_LEDGER_HOTEL_PROPERTY.md`: `POST /api/properties/:propertyId/allotments`, `POST /api/properties/:propertyId/allotments/:allotmentId/release`, and `POST /api/properties/:propertyId/reservations/:reservationId/extend-plan`. Use that ledger for the sample curls and checkpoint notes.
- Do not add new checkpoint updates to this file.
- Do not duplicate the same checkpoint in both split ledgers unless the checkpoint is genuinely cross-domain.

## Status legend

- `not_started`
- `in_progress`
- `blocked`
- `done`
- `legacy_only`

## Why this split exists

- The tour/platform runtime is now much larger than the hotel/property runtime.
- Keeping both in one file made hotel/property progress hard to scan.
- The archive file preserves old combined history without forcing every future task to load it.