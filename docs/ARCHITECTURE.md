
> RUNTIME NOTE: This document describes TARGET PRODUCT DESIGN.
> Current rescue repo only implements a small subset (see 01_CURRENT_STATE.md).

# Architecture

System context, components, and deployment topology.


# Architecture

## Tổng quan
- Workers (API)
- D1 (SQL) – domain data
- KV – presets/snippets
- Cron/Queues – reminders & background jobs


## Luồng chính (canonical)
0) Publish/public exposure tách thành 2 mode:
	- showcase publish trên platform subdomain
	- commercial publish trên verified custom domain
1) Tạo tour → thêm tour_stops (itinerary segments, ordered, each may reference a catalog destination) → auto arrival/departure.
2) CHK-207: Day-1 pickup/welcome có toggle khi tạo tour → auto task Day-1.
3) Mỗi tour_stop: thêm nhiều item cho 5 nhóm dịch vụ (service items linked to tour_stop_id).
4) Booking chuyển booked → sinh Task từ service items.
5) CHK-208: Calendar layer xuất task sang calendar channels:
	- Google Calendar sync payload (preview/API layer)
	- iPhone-compatible feed qua ICS/webcal
6) Reminder cadence cho task còn mở:
	- monthly từ booking date
	- 14d / 7d / 3d trước tour start
7) Itinerary composer: hợp nhất tour_stops + text (nếu có) + services + media.

> NOTE: Legacy "destination" flows are retained for business intent but are not canonical for itinerary modeling. All operational service items must reference tour_stop_id.

## Pricing model upgrade
- Canonical pricing uses tenant_seasons, pricing_segments, pax_bands, and tour_prices. Flat season/pax fields are deprecated.

## Thành phần miền mới
- Supplier system (CHK-209 planned): supplier generic registry, service item tham chiếu `supplier_id`.
- Mobile ops surface (CHK-304 planned): thao tác task + liên lạc nhanh, không mang full builder.
- Domain onboarding config (CHK-401): tenant hostname claim + verification state lưu trong D1 trước khi publish gate áp dụng.
- Publish gate config (CHK-402): checklist state tách riêng theo tenant; route publish production bị chặn cho tới khi đủ điều kiện.
- Billing config (CHK-403): trial/subscription standing lưu riêng theo tenant; publish gate và `booked` transition đọc cùng một nguồn trạng thái.
- Site studio config/content (CHK-404): tenant-level theme/legal/contact/search settings + multilingual public copy tách riêng khỏi operational tour data.
- Growth/SEO config (CHK-405): tenant-level distribution metadata (SEO/social/analytics/reviews), editable tour slugs, sitemap/robots generation, and lead/event capture hooks.
- Hosted layout layer (strategy pivot): self-hosted website HTML/CSS/project payloads lưu riêng theo tenant để tích hợp external editor như GrapesJS; Worker render theo hostname đã verify và inject dữ liệu SaaS vào placeholders.
- Discovery pivot: taxonomy-first collections should become the primary public discovery model. Canonical interest tags and rules-based collection pages should scale tour discovery better than relying on free-form Site Studio composition for every category page. See `docs/ai/22_INTEREST_TAXONOMY_AND_COLLECTIONS.md`.

## Bảo mật
- JWT cookie (HttpOnly) (tương lai)
- Turnstile is now active on production forgot-password, signup, and login; backend Siteverify remains required for all three flows
- Turnstile widget hostnames must be explicitly authorized in Cloudflare Hostname Management; production hit client error `110200` until `tours-market.com` was added to the widget allowlist
- Secrets qua Wrangler

## Commercial publishing rule
- Platform subdomains are not merchant surfaces. They can publish content but must stay showcase-only.
- Verified custom domains are the only surfaces allowed to expose booking/payment flows.
- Commercial activation is a separate gate on top of publish: tenant must be `ACTIVE`, `TRUSTED`, have terms accepted, use a verified custom domain, and enable at least one payment method.