
> RUNTIME NOTE: This document describes TARGET PRODUCT DESIGN.
> Current rescue repo only implements a small subset (see 01_CURRENT_STATE.md).

# Project Brief

Problem statement, goals, scope, and non-goals.



# Project Brief

## Vấn đề
Tour agent cần vận hành tour theo các tour_stops (itinerary segments, mỗi cái có thể tham chiếu điểm đến catalog/reference); mỗi tour_stop có dịch vụ con; cần luồng liên lạc & nhắc việc; cần itinerary tự ghép.

> NOTE: Legacy "destination" logic retained for business intent but not canonical for itinerary modeling.

## Mục tiêu MVP
- 3 tab: Cấu hình Tour / Cấu hình Giá / Visual
- Itinerary: tour_stops (ordered, nights, arrival/departure auto)
- 5 nhóm dịch vụ (mini-card) + nút “+” (service items linked to tour_stop_id)
- Thread liên lạc theo từng item
- Booking booked→ auto To-Do + reminders
- Day-1 ưu tiên: pickup + welcome toggle và auto task
- Calendar sync baseline:
	- Google sync payload path
	- iPhone-compatible ICS feed
- Reminder cadence cho task còn mở:
	- monthly từ booking date
	- 14d / 7d / 3d trước tour start
- Preview Itinerary (có/không text điểm)

## Hướng mở rộng đã chốt
- Supplier system (generic, không inventory trong MVP)
- Mobile ops-first surface (task + communication quick actions, không replicate full builder)

## Pricing model upgrade
- Canonical pricing uses tenant_seasons, pricing_segments, pax_bands, and tour_prices. Flat season/pax fields are deprecated.