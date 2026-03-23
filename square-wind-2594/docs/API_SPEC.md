# API Spec

Endpoints, request/response schemas, and error conventions.


# API Spec (MVP)

## Tours
- POST `/api/tours` : create {title, start_date, duration_text, lang, day1_pickup_enabled?, day1_welcome_enabled?}
- GET  `/api/tours/:id`
- PATCH `/api/tours/:id` : update fields, status

### Day-1 operations (CHK-207)
- On tour creation, Day-1 pickup and welcome tasks are auto-created by default.
- Toggles:
	- `day1_pickup_enabled` (default: true)
	- `day1_welcome_enabled` (default: true)
- Generated tasks are linked by `booking_id = tourId` with `service_entity_type = day1_event`.

## Destinations
- POST `/api/tours/:id/destinations` : add destination {name, nights, position}
- PATCH `/api/destinations/:id`      : update {name?, nights?, position?} → auto recompute arrival/departure
- GET  `/api/tours/:id/destinations`

## Service Items (5 nhóm)
- POST `/api/destinations/:id/accommodations`
- POST `/api/destinations/:id/meals`
- POST `/api/destinations/:id/guides`
- POST `/api/destinations/:id/local-transports`
- POST `/api/destinations/:id/intercity-legs`
- PATCH `/api/{group}/{itemId}` : update common operational fields {status, stage, notes, contact, address, channels, times...}
- GET   `/api/destinations/:id/{group}`
- Optional linkage: service items may reference `supplier_id`

## Suppliers (CHK-209)
- POST `/api/suppliers` : create {name, type, contact?, notes?}
- GET  `/api/suppliers?type=&limit=&offset=`
- PATCH `/api/suppliers/:id` : update {name?, type?, contact?, notes?}
- Supplier type: `hotel | guide | transport | meal | other`

### Service item operational rules
- Every service item carries:
	- `person_in_charge`
	- `contact_name`
	- `contact_email`
	- `address`
	- `notes?`
	- `stage` in `contacted | pending | confirmed | canceled`
	- `communication_channels` array from `email | zalo | messenger | sms`
- Scheduling defaults should auto-fill when omitted:
	- accommodation: `check_in`, `check_out`
	- meals: `meal_datetime`
	- guides: `time_from`, `time_to`
	- local transport: `pickup_time`, `pickup_place`, `dropoff_place`
	- intercity legs: `depart_time`, `depart_point`, `arrive_point`

## Threads & Messages
- POST `/api/threads/:entityType/:entityId/email` : send + log
- POST `/api/threads/:threadId/note`              : note/call log

## Tasks (auto khi booking→booked)
- GET  `/api/tasks?tourId=&status=`
- PATCH `/api/tasks/:id` : {status, due_at?}

### Reminder cadence (CHK-208)
- GET `/api/tasks/reminders/candidates?at=`
- POST `/api/tasks/:id/reminders/mark-sent` : { reminder_key }
- Cadence for remaining unconfirmed tasks is based on tour start date:
  - monthly
  - 14d before start
  - 7d before start
  - 3d before start

## Calendar (CHK-208)
- GET  `/api/calendar/config`
- POST `/api/calendar/config`
- GET  `/api/calendar/tours/:id/tasks.ics` (iPhone Calendar-compatible feed)
- GET  `/api/calendar/tours/:id/google-sync/preview` (Google Calendar event payload preview)

## Mobile Ops (CHK-304)
- GET `/api/mobile/tasks?status=&includeClosed=&limit=&offset=`
	- mobile-focused task feed with:
		- quick contact actions (`call`, `sms`, `email`, `whatsapp`, `zalo`)
		- `thread_messages_url` for direct thread context access
		- latest thread message preview (`latest_message`)
		- resolved `thread_id`
- POST `/api/mobile/tasks/:id/note`
	- body: `{ body, channel?, created_by? }`
	- logs quick note/call-log/etc to related communication thread
- POST `/api/mobile/tasks/:id/status`
	- body: `{ status }`
	- updates task status from mobile flow (`pending|confirmed|completed|canceled`)

## Domain Onboarding (CHK-401)
- GET `/api/domain/config`
	- returns tenant domain onboarding status and verification instructions
	- default state when unset: `status = no_domain`
- POST `/api/domain/config`
	- body: `{ hostname }`
	- claims or updates a tenant hostname and returns verification TXT record details
	- stores status as `pending` unless the same hostname was already verified for the same tenant
- POST `/api/domain/verify`
	- body: `{ verification_value }`
	- marks the tenant hostname as `verified` when the submitted value matches the pending verification record

### Domain onboarding rules
- Statuses: `no_domain | pending | verified`
- Hostnames are tenant-scoped and cannot be claimed by multiple tenants
- Public publish remains gated separately in CHK-402

## Publish Gate (CHK-402)
- GET `/api/publish/gate`
	- returns tenant publish checklist state
	- preview remains available even when publish is blocked
- POST `/api/publish/gate`
	- body: `{ payment_method_added?, terms_accepted?, commission_agreement_accepted? }`
	- updates checklist state and returns resolved publish gate

### Publish gate rules
- Production publish requires all of:
	- domain verified
	- payment method added
	- terms accepted
	- commission agreement accepted
	- billing in good standing
- Preview is always allowed and is not treated as production publish
- `PATCH /api/tours/:id` with `status=on_sale` must be rejected when gate requirements are not satisfied

## Billing Restrictions (CHK-403)
- GET `/api/billing/status`
	- returns tenant billing standing
	- creates a default 6-month `trialing` billing record when none exists yet
- POST `/api/billing/status`
	- body: `{ subscription_status?, trial_started_at?, trial_ends_at? }`
	- `subscription_status` must be one of `trialing | active | unpaid`

### Billing rules
- While tenant is `trialing` and trial has not expired:
	- publish is allowed from the billing perspective
	- new bookings are allowed
- If tenant is `unpaid` or trial has expired without active subscription:
	- publish is blocked
	- new bookings are blocked
- `PATCH /api/tours/:id` with `status=booked` must be rejected when billing does not allow new bookings

## Site Studio (CHK-404)
- GET `/api/site/config`
	- returns tenant site presentation config
	- creates default config if tenant has no site settings yet
- GET `/api/site/layout`
	- returns tenant hosted layout payload for GrapesJS-style editors
	- response includes: `template_engine`, `status`, `html`, `css`, `project_data`, `published_at`
- POST `/api/site/layout`
	- body supports: `template_engine`, `status`, `html`, `css`, `project_data`
	- stores self-hosted website layout artifacts per tenant
- POST `/api/site/config`
	- body supports: `theme`, `primary_color`, `font_family`, `builder_template`, `builder_blocks`, `builder_utilities`, `builder_content`, `header_title`, `footer_text`, `contact_email`, `contact_phone`, `whatsapp_url`, `default_public_lang`, `search_enabled`
	- `builder_template`, `builder_blocks`, `builder_utilities`, and `builder_content` are deprecated compatibility fields retained for older Builder-based consumers; current Site Studio uses `/api/site/layout` for primary website editing
	- upserts tenant site settings
- GET `/api/site/pages?page_key=&lang=`
	- returns localized legal page with fallback order: requested lang -> tenant default lang -> latest available
- POST `/api/site/pages`
	- body: `{ page_key, lang, title, content }`
	- `page_key` must be one of `terms | privacy | impressum`
- GET `/api/site/tours/:id/content?lang=`
	- returns localized public tour copy with language fallback
- POST `/api/site/tours/:id/content`
	- body: `{ lang, headline?, summary?, body? }`
	- upserts localized public tour copy per tenant/tour

### Public-site endpoints
- GET `/public/site?lang=`
	- returns tenant site config and available legal-page links for selected language
	- also returns explicit `builder` payload: `template`, `blocks`, `utilities`, `content`
	- this `builder` payload is deprecated backward-compatibility output for older downstream renderers
- GET `/public/tours?lang=&q=`
	- returns public tour listing with basic keyword search
	- search matches base title and localized headline/summary
- GET `/public/tours/:id?lang=`
	- returns public tour detail payload (localized title/summary/body)
	- also includes explicit site-level `builder` payload for downstream renderers
	- this `builder` payload is deprecated backward-compatibility output for older downstream renderers

### Hosted domain rendering
- Verified custom hostnames can now be rendered directly by the Worker from stored tenant layout artifacts
- Hosted render flow reads:
	- `tenant_domain_configs` for hostname -> tenant resolution
	- `tenant_site_layouts` for stored HTML/CSS/project data
	- live SaaS tour data for placeholder injection
- Initial placeholder support includes:
	- `{{SITE_TITLE}}`
	- `{{SITE_FOOTER}}`
	- `{{PRIMARY_COLOR}}`
	- `{{CONTACT_EMAIL}}`
	- `{{CONTACT_PHONE}}`
	- `{{WHATSAPP_URL}}`
	- `{{DOMAIN_NAME}}`
	- `{{TOUR_LIST}}`

### Site studio rules
- Site layer remains separate from operational tour data workflows
- Public-site content is localized by language variant (no duplicated tours)
- Builder template/block/utility choices now persist in tenant site config for future public-site rendering
- Builder content models now persist for `hero`, `faq`, `testimonials`, and `cta`
- Hosted website layout artifacts can now be stored independently from site config, which is the intended integration point for GrapesJS or another external visual editor
- MVP still excludes full drag-drop page composition and complex CMS behavior

## Growth & SEO (CHK-405)
- GET `/api/growth/config`
	- returns tenant distribution/growth configuration
	- creates a default config when missing
- POST `/api/growth/config`
	- body supports: `google_analytics_id`, `facebook_pixel_id`, `tripadvisor_url`, `google_reviews_url`, `whatsapp_url`, `call_phone`, `contact_email`, `trust_badges_json`
- POST `/api/growth/tours/:id/slug`
	- body: `{ slug }`
	- stores editable tour slug (unique per tenant)
- GET `/api/growth/tours/:id/seo?lang=`
	- returns localized SEO metadata with language fallback
- POST `/api/growth/tours/:id/seo`
	- body: `{ lang, meta_title?, meta_description?, keywords?, og_title?, og_description?, og_image?, snippet_template? }`
	- upserts localized SEO metadata

### Growth public endpoints
- GET `/public/tours/slug/:slug?lang=`
	- resolves tour by slug and returns SEO/social metadata payload
- GET `/sitemap.xml`
	- generated from tenant tours currently in `on_sale` status with slug
- GET `/robots.txt`
	- baseline robots response with sitemap reference
- POST `/public/leads/contact`
	- body: `{ tour_id?, channel, name?, email?, phone?, message }`
	- captures lead events for contact/whatsapp/call channels
- POST `/public/events`
	- body: `{ event_name, tour_id?, channel?, metadata? }`
	- captures growth events for `view_tour | click_contact | submit_booking`

### Growth module rules
- Distribution layer is tenant-scoped and multilingual-aware for SEO metadata
- Slug is tenant-editable and unique within tenant scope
- MVP focuses on metadata, social/contact hooks, sitemap/robots, and basic lead/event logging

## Composer
- GET `/api/tours/:id/itinerary` : return itinerary preview content
	- Query params:
		- `format=markdown|md|html` (default: markdown)
		- `includeDestinationText=true|false|1|0` (default: true)
		- `lang=<locale>` (optional, fallback to tour lang then latest available destination text)
	- Response fields:
		- `tour_id`
		- `format`
		- `lang`
		- `include_destination_text`
		- `content`
