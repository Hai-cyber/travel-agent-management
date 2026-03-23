# Checkpoints

Milestones, progress notes, and validation checkpoints.


# Checkpoints & Milestones

## M0 – Context Seed
- [CHK-000] Seed docs, codebase map, Copilot contract, and AI operating files.

## M1 – Domain & Data Baseline
- [CHK-101] Canonical D1 schema v1 aligned with source-of-truth docs.
- [CHK-102] Deterministic demo seed data (VN baseline: SGN-HAN-SAPA).
- [CHK-103] Schedule recompute core (start_date + nights -> arrival/departure).

## M2 – API MVP
- [CHK-201] CRUD APIs for tours, destinations, and service items.
- [CHK-202] Booking -> task generation and reminder pipeline.
- [CHK-203] Thread/message handling (email outbound + note/inbound log).
- [CHK-204] Multi-tenant guardrails (tenant scoping in all data paths).
- [CHK-205] API contract hardening (validation + response/error consistency).
- [CHK-206] Worker observability baseline (structured logs, traceability).
- [CHK-207] Day-1 arrival operations (pickup + welcome) with auto-created todos and defaults.
- [CHK-208] Task calendar sync + reminder cadence (Google Calendar + iPhone Calendar-compatible feed; monthly + 14d/7d/3d reminders for remaining unconfirmed tasks before tour starts).
- [CHK-209] Supplier system baseline (generic supplier registry + service item `supplier_id` linkage).

## M3 – UI Ops MVP
- [CHK-301] UI shell: 3 tabs (Tour config / Pricing / Visual) with basic flows.
- [CHK-302] Service mini-cards for 5 groups with add/edit interactions.
	- Direction clarified: mini-card toggles become operational todos with auto-filled scheduling defaults.
- [CHK-303] Itinerary preview (merged output, with/without destination text).
	- Must consider multilingual public output, not single-language rendering only.
- [CHK-304] Mobile ops surface (task execution + communication quick actions, not full builder parity).

## M4 – Domain Onboarding, Publish, Billing, Site
- [CHK-401] Domain onboarding flow and verification states.
- [CHK-402] Publish gate enforcement (preview vs production rules).
- [CHK-403] Tenancy and billing restrictions (trial/subscription gating).
- [CHK-404] Site studio MVP scope (theme, legal pages, contact, search).
	- Must support multilingual public websites per tenant/tour.

## M5 – Growth & Distribution
- [CHK-405] Growth & SEO module (tenant-level Distribution layer: SEO + Social + Reviews + Analytics + Lead Capture).

## Product direction notes (2026-03-21)
- Public websites must support multiple languages.
- Tour Day-1 should support extra operational toggles: pickup + welcome.
- Service mini-cards should evolve into todo/task workflows.
- Scheduling-related fields should be auto-filled from tour start date + destination order/nights.
- Service operations must always capture responsible person, contact details, address, notes, and communication stage.
- Communication channels must include email, Zalo, Messenger, and SMS.
- Communication logs should be consolidated at the task/service level.
- All operational todos should sync to tenant calendar from booking date onward.
- Calendar target channels: Google Calendar direct sync and iPhone Calendar-compatible sync (ICS/webcal path).
- Reminder cadence for remaining unconfirmed tasks:
	- monthly reminder
	- 14 days before tour starts
	- 7 days before tour starts
	- 3 days before tour starts
- Growth strategy must be modeled as Distribution & Growth (SEO + Social + Messaging + Reviews), not SEO-only.
- Supplier model should stay generic in MVP (no inventory module by default).
- Mobile product scope is operations-first (tasks, communication, quick actions), not full builder replication.

## Execution log (2026-03-22)
- UI ops shell refinement pass completed under CHK-301..CHK-304 scope:
	- compact single-panel admin header for test operations
	- stage-specific test/preview/live links for admin and traveler surfaces
	- destination UX improvements: compact service toggles, drag-handle reorder, edit/delete actions
	- itinerary day-range preview labels (e.g. Day 7-8)
	- Pricing tab moved to tier model: season window + pax band + class-title + shared/single/child prices
	- pricing tier delete and live right-panel pricing preview on Pricing tab
	- global agent-admin controls for language, traveler currency mode, tier input currency, and FX rate
	- traveler page auto locale (EN/VI baseline) + auto currency display (USD/VND) based on global mode and locale
- UI ops follow-up hardening completed under same CHK-301..CHK-304 surface:
	- local Studio tab for admin shell layout customization (rename/reorder/hide/restore)
	- tenant-level admin date format persisted through booking settings
	- admin mobile/booking cards now render `dd.mm.yyyy hh:mm`
	- season start/end now use date pickers in Pricing
	- class presets now drive pricing tier selection via `class_id`
	- baseline preset renamed from `Casual` / `class_casual` to `Standard` / `class_standard`
	- Builder now supports drag-drop ordering for active blocks/utilities and editable content models for hero/FAQ/testimonials/CTA
	- persisted Builder config is now exposed through public-site and public-tour payloads for downstream renderers
- Hosted-site foundation added as strategy pivot on top of CHK-404:
	- tenant-level HTML/CSS/project layout storage for external editor integration
	- Worker-side custom-domain rendering for verified hostnames
	- initial placeholder injection path for live tour/site data

## Recommended Execution Order
1. CHK-101
2. CHK-102
3. CHK-103
4. CHK-201
5. CHK-204
6. CHK-202
7. CHK-203
8. CHK-205
9. CHK-206
10. CHK-207
11. CHK-208
12. CHK-209
13. CHK-301
14. CHK-302
15. CHK-303
16. CHK-304
17. CHK-401
18. CHK-402
19. CHK-403
20. CHK-404
21. CHK-405

> Dùng mã `[CHK-XYZ]` trong commit/PR/tiêu đề task để giữ mối liên hệ giữa code và tài liệu.