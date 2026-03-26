# > **RUNTIME NOTE:** This document describes the full target domain model. Only a subset is implemented in the rescue runtime.

# ## Implemented Entities (Rescue Runtime)
# - Tenant
# - Tour
# - TourStop
# - Destination
# - DestinationText
# - service_types
# - tour_stop_service_flags
# - stop_accommodations
# - stop_meals
# - stop_guides
# - stop_local_transports
# - stop_intercity_legs
# - tenant_seasons
# - pricing_segments
# - pax_bands
# - tour_prices
# - comm_threads
# - comm_messages
# - tasks
# - task_reminder_logs
# - tenant_calendar_configs

# ## Planned Entities (Not Implemented Yet)
# - User
# - Membership
# - Supplier
# - Booking
# - Thread/Message
# - TaskReminderLog (CHK-208)
# - TenantDomainConfig (CHK-401)
# - TenantPublishConfig (CHK-402)
# - TenantBillingConfig (CHK-403)
# - TenantSiteConfig (CHK-404)
# - TenantSitePage (CHK-404)
# - TourPublicContent (CHK-404)
# - TenantGrowthConfig (CHK-405)
# - TourGrowthSlug (CHK-405)
# - TourGrowthSeoMeta (CHK-405)
# - GrowthLead (CHK-405)
# - GrowthEvent (CHK-405)
# - Pricing & Policy (beyond canonical tables)
# - Visual & Media
# - Everything else in this file not listed above
# Domain Model

Core entities, relationships, and business rules.



# Domain Model (tóm tắt)

## Thực thể chính
- Tenant, User, Membership
- Tour {title, start_date, duration_text, status}
- TourStop {tour_id, destination_id (optional), label, day_from, day_to, nights, description, sort_order}
  - Canonical itinerary segment (replaces old tour→destinations model)
- Destination {name, code} (catalog/reference only; not itinerary)
- DestinationText {summary, details, notes}
- Supplier {id, tenant_id, name, type, contact, notes}
- Service Items (linked to tour_stop_id, not destination_id):
  - Accommodation {tour_stop_id, hotel_name, check_in/out, contact, address, stage, status}
  - Meals {tour_stop_id, meal_type, restaurant_name, meal_datetime, contact, address, stage, status}
  - Guide {tour_stop_id, guide_name, time_from/to, languages, contact, address, stage, status}
  - LocalTransport {tour_stop_id, mode, pickup_time/place, dropoff_place, contact, address, stage, status}
  - IntercityLeg {tour_stop_id, mode, depart_time/point, arrive_point, ticket_ref, contact, address, stage, status}
- Thread/Message {channel, direction, subject, body, to/from}
- Task {service ref, booking_id, title, due_at, status}
- TaskReminderLog {task_id, reminder_key, sent_at} (CHK-208)
- TenantCalendarConfig {google_calendar_id, ios_calendar_url, timezone, flags} (CHK-208)
- TenantDomainConfig {hostname, status, verification_record_type, verification_record_name, verification_record_value, verified_at} (CHK-401)
- TenantPublishConfig {payment_method_added, terms_accepted, commission_agreement_accepted, updated_at} (CHK-402)
- TenantBillingConfig {trial_started_at, trial_ends_at, subscription_status, updated_at} (CHK-403)
- TenantSiteConfig {theme, primary_color, font_family, header_title, footer_text, contact_email, contact_phone, whatsapp_url, default_public_lang, search_enabled} (CHK-404)
- TenantSitePage {page_key, lang, title, content} (CHK-404)
- TourPublicContent {tour_id, lang, headline, summary, body} (CHK-404)
- TenantGrowthConfig {google_analytics_id, facebook_pixel_id, tripadvisor_url, google_reviews_url, whatsapp_url, call_phone, contact_email, trust_badges} (CHK-405)
- TourGrowthSlug {tour_id, slug} (CHK-405)
- TourGrowthSeoMeta {tour_id, lang, meta_title, meta_description, keywords, og_title, og_description, og_image, snippet_template} (CHK-405)
- GrowthLead {tour_id, channel, name, email, phone, message, created_at} (CHK-405)
- GrowthEvent {tour_id, event_name, channel, metadata, created_at} (CHK-405)
- Pricing & Policy (see pricing model upgrade note below)
- Visual & Media

> NOTE: Legacy "destination" logic is retained for business intent in some flows, but is no longer canonical for itinerary modeling. All operational service items must reference tour_stop_id.

> Pricing model upgrade: Flat season/pax fields are deprecated. Canonical pricing now uses tenant_seasons, pricing_segments, pax_bands, and tour_prices.

## Quan hệ (rút gọn)
Tenant 1—* Tour  
Tour 1—* TourStop
TourStop → Destination (optional reference)

> RUNTIME NOTE: This document is split by CURRENT RUNTIME of the rescue repo. Only entities confirmed in 01_CURRENT_STATE.md are considered implemented. All others are planned/target design.

# Domain Model

Core entities, relationships, and business rules.

# Domain Model (tóm tắt)

## Implemented entities (rescue runtime)
- Tenant
- User
- Membership
- Tour
- TourStop (canonical itinerary segment)
- Destination (catalog/reference only)
- DestinationText

## Planned entities (not yet in rescue runtime)
- Supplier
- Service Items (Accommodation, Meals, Guide, LocalTransport, IntercityLeg)
- Thread/Message
- Task
- TaskReminderLog (CHK-208)
- TenantCalendarConfig (CHK-208)

> RUNTIME NOTE: This document shows the full target domain model. Only a subset is implemented in the rescue repo (see below).

# Domain Model (tóm tắt)

## Implemented entities (rescue runtime)
- Tenant
- Tour
- TourStop (canonical itinerary segment)
- Destination (catalog/reference only)
- DestinationText

## Planned entities (not yet implemented)
- User, Membership
- Supplier
- Service Items (Accommodation, Meals, Guide, LocalTransport, IntercityLeg)
- Thread/Message
- Task
- TaskReminderLog (CHK-208)
- TenantCalendarConfig (CHK-208)
- TenantDomainConfig (CHK-401)
- TenantPublishConfig (CHK-402)
- TenantBillingConfig (CHK-403)
- TenantSiteConfig (CHK-404)
- TenantSitePage (CHK-404)
- TourPublicContent (CHK-404)
- TenantGrowthConfig (CHK-405)
- TourGrowthSlug (CHK-405)
- TourGrowthSeoMeta (CHK-405)
- GrowthLead (CHK-405)
- GrowthEvent (CHK-405)
- Pricing & Policy
- Visual & Media

> NOTE: Legacy "destination" logic is retained for business intent in some flows, but is no longer canonical for itinerary modeling. All operational service items must reference tour_stop_id.

> Pricing model upgrade: Flat season/pax fields are deprecated. Canonical pricing now uses tenant_seasons, pricing_segments, pax_bands, and tour_prices.

## Quan hệ (rút gọn)
Tenant 1—* Tour  
Tour 1—* TourStop
TourStop → Destination (optional reference)
TourStop 1—* ServiceItems
Destination 1—* (Accommodation|Meals|Guide|Local|Intercity)  
(Each service item) 1—1 Thread 1—* Message  
Tour 1—* Task (qua `booking_id`)  
Task 1—* TaskReminderLog  
Tenant 1—1 TenantCalendarConfig  
Tenant 1—1 TenantDomainConfig  
Tenant 1—1 TenantPublishConfig  
Tenant 1—1 TenantBillingConfig  
Tenant 1—1 TenantSiteConfig  
Tenant 1—* TenantSitePage  
Tour 1—* TourPublicContent  
Tenant 1—1 TenantGrowthConfig  
Tour 1—1 TourGrowthSlug  
Tour 1—* TourGrowthSeoMeta  
Tour 1—* GrowthLead  
Tour 1—* GrowthEvent  
Supplier 1—* ServiceItems (qua `supplier_id`)