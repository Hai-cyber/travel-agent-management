# Architecture

System context, components, and deployment topology.


# Architecture

## Tổng quan
- Workers (API)
- D1 (SQL) – domain data
- KV – presets/snippets
- Cron/Queues – reminders & background jobs

## Luồng chính
1) Tạo tour → thêm điểm đến (nights) → auto arrival/departure.
2) CHK-207: Day-1 pickup/welcome có toggle khi tạo tour → auto task Day-1.
3) Mỗi điểm: thêm nhiều item cho 5 nhóm dịch vụ.
4) Booking chuyển booked → sinh Task từ service items.
5) CHK-208: Calendar layer xuất task sang calendar channels:
	- Google Calendar sync payload (preview/API layer)
	- iPhone-compatible feed qua ICS/webcal
6) Reminder cadence cho task còn mở:
	- monthly từ booking date
	- 14d / 7d / 3d trước tour start
7) Itinerary composer: hợp nhất điểm đến + text (nếu có) + services + media.

## Thành phần miền mới
- Supplier system (CHK-209 planned): supplier generic registry, service item tham chiếu `supplier_id`.
- Mobile ops surface (CHK-304 planned): thao tác task + liên lạc nhanh, không mang full builder.
- Domain onboarding config (CHK-401): tenant hostname claim + verification state lưu trong D1 trước khi publish gate áp dụng.
- Publish gate config (CHK-402): checklist state tách riêng theo tenant; route publish production bị chặn cho tới khi đủ điều kiện.
- Billing config (CHK-403): trial/subscription standing lưu riêng theo tenant; publish gate và `booked` transition đọc cùng một nguồn trạng thái.
- Site studio config/content (CHK-404): tenant-level theme/legal/contact/search settings + multilingual public copy tách riêng khỏi operational tour data.
- Growth/SEO config (CHK-405): tenant-level distribution metadata (SEO/social/analytics/reviews), editable tour slugs, sitemap/robots generation, and lead/event capture hooks.
- Hosted layout layer (strategy pivot): self-hosted website HTML/CSS/project payloads lưu riêng theo tenant để tích hợp external editor như GrapesJS; Worker render theo hostname đã verify và inject dữ liệu SaaS vào placeholders.

## Bảo mật
- JWT cookie (HttpOnly) (tương lai)
- Turnstile cho signup (tương lai)
- Secrets qua Wrangler