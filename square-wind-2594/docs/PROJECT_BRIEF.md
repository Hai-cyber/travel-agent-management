# Project Brief

Problem statement, goals, scope, and non-goals.


# Project Brief

## Vấn đề
Tour agent cần vận hành tour theo điểm đến/số đêm; mỗi điểm có dịch vụ con; cần luồng liên lạc & nhắc việc; cần itinerary tự ghép.

## Mục tiêu MVP
- 3 tab: Cấu hình Tour / Cấu hình Giá / Visual
- Tuyến điểm: nights, arrival/departure auto
- 5 nhóm dịch vụ (mini-card) + nút “+”
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