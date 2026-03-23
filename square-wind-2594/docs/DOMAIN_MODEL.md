# Domain Model

Core entities, relationships, and business rules.


# Domain Model (tóm tắt)

## Thực thể chính
- Tenant, User, Membership
- Tour {title, start_date, duration_text, status}
- Destination {name, position, nights, arrival_date, departure_date}
- DestinationText {summary, details, notes}
- Supplier {id, tenant_id, name, type, contact, notes}
- Service Items:
  - Accommodation {hotel_name, check_in/out, contact, address, stage, status}
  - Meals {meal_type, restaurant_name, meal_datetime, contact, address, stage, status}
  - Guide {guide_name, time_from/to, languages, contact, address, stage, status}
  - LocalTransport {mode, pickup_time/place, dropoff_place, contact, address, stage, status}
  - IntercityLeg {mode, depart_time/point, arrive_point, ticket_ref, contact, address, stage, status}
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
- Pricing & Policy
- Visual & Media

## Quan hệ (rút gọn)
Tenant 1—* Tour  
Tour 1—* Destination  
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