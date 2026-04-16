# EMAIL INGESTION & BOOKING DRAFT MODULE

> **RUNTIME NOTE:**
> This document records the **approved product direction** for email-based booking ingestion.
> The current runtime does **NOT** implement this module yet.
> This is a **Phase 2 feature** — deliberately deferred until the core tour + operations engine is stable.
> Actual implemented slices are listed in `01_CURRENT_STATE.md`.

---

## Strategic Context

### Why this module, why now (as a design decision)

Direct OTA sync (Booking.com, Agoda, Expedia) was explicitly evaluated and **rejected for the near term** for the following reasons:

| Approach | Complexity | Risk |
|---|---|---|
| OTA API sync (Booking.com Connectivity Partner API) | Very high — requires application, certification, hotel client proof | Overbooking, double-booking, real-time rate/availability errors |
| Channel manager integration (SiteMinder, Cloudbeds) | Medium — but adds a dependency layer | Tied to third-party uptime and pricing |
| **Email ingestion (this module)** | **Low** | **User holds control — AI only suggests** |

The email-based approach is the **80% value / 20% effort** path. It solves the real operational pain (not losing bookings, centralising data, enabling workflow) without the infrastructure risk of sync systems.

**Guiding principle:**
> Don't sync the world. Ingest the inbox and make it actionable.

---

## Core Concept

```
Forward booking email → AI extracts fields → Draft created → Staff reviews → Confirm
```

This is the TripIt model applied to travel operations:
- AI does not decide — it proposes
- Staff always confirms before the record becomes a live booking
- The system is "never wrong" because a human is the last gate

---

## Problem This Solves

| Pain | How this solves it |
|---|---|
| Staff copy-paste from Booking.com/Agoda email into spreadsheet | Email → auto-structured draft |
| Booking slips through because nobody saw the email | Every forwarded email creates a task |
| Team uses 5 different channels, bookings land everywhere | One inbox, one workflow |
| Can't afford OTA sync complexity at this stage | No sync needed — email is the source of truth |
| AI parsing might be wrong | Draft + confirm model — staff reviews before commit |

---

## Product Positioning

**Not:** a channel manager, PMS, OTA sync tool, or inventory engine.

**Is:** an operational inbox for travel bookings.

Positioning options:
- *"Turn booking emails into structured operations"*
- *"Never miss a booking again"*
- *"Forward. Review. Confirm. Done."*

---

## System Flow

### 1. Email Input
- Staff forwards confirmation email to a tenant-specific address:
  `{tenant-slug}@inbox.tours-market.com`
- Or (Phase 3): Gmail/IMAP integration reads labelled inbox automatically

### 2. Detection Layer (rule-based, fast)
- Identify source from sender domain / subject pattern:
  - `booking.com` → source = `booking_com`
  - `agoda.com` → source = `agoda`
  - `expedia.com` → source = `expedia`
  - anything else → source = `unknown`

### 3. Extraction Layer (hybrid: rule + AI)
- **Layer A — Regex / pattern matching** (fast, zero cost, deterministic):
  - booking/reference ID
  - check-in / check-out dates
  - guest name
- **Layer B — AI fallback** (only when Layer A misses fields):
  - parse remaining fields from natural language
  - assign `confidence_score` per field

> **Rule:** AI is never the sole authority. Rule-based output takes priority. AI fills gaps.

### 4. Draft Created
- Record saved with `status = 'draft'`
- Raw email stored as attachment
- Parsed fields stored as JSON
- Confidence score attached
- Task created automatically: *"Review draft booking — [source] [guest name if parsed]"*

### 5. Staff Action (3 choices)
| Action | Result |
|---|---|
| ✅ Confirm | Draft promoted to live `booking_order` record; ops tasks generated |
| ✏️ Edit + Confirm | Staff corrects any field, then confirms |
| ❌ Ignore / Discard | Draft discarded; raw email still retained for audit |

### 6. After Confirmation
- Booking record created (or linked to existing tour order if match found)
- Standard ops tasks generated (check-in prep, guide assign, follow-up)
- Staff notified

---

## Data Model

### Table: `email_ingest_drafts`

```sql
CREATE TABLE IF NOT EXISTS email_ingest_drafts (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',  -- draft | confirmed | ignored
  source        TEXT,                            -- booking_com | agoda | expedia | unknown
  raw_email     TEXT,                            -- full raw email body (stored as-is)
  raw_subject   TEXT,
  raw_from      TEXT,
  raw_received_at INTEGER,                       -- unix timestamp
  parsed_data   TEXT,                            -- JSON: extracted fields + confidence scores
  confidence    REAL,                            -- 0.0–1.0 overall extraction confidence
  linked_order_id TEXT,                          -- FK to booking_orders after confirm
  reviewed_by   TEXT,                            -- user who confirmed / ignored
  reviewed_at   INTEGER,
  created_at    INTEGER NOT NULL
);
```

### `parsed_data` JSON shape (canonical)

```json
{
  "guest_name":        { "value": "John Smith",    "confidence": 0.95 },
  "check_in":          { "value": "2026-05-12",    "confidence": 0.92 },
  "check_out":         { "value": "2026-05-15",    "confidence": 0.92 },
  "property_name":     { "value": "ABC Hotel",     "confidence": 0.88 },
  "booking_ref":       { "value": "BDC-123456",    "confidence": 0.99 },
  "room_type":         { "value": "Deluxe Double", "confidence": 0.70 },
  "total_amount":      { "value": 450.00,          "confidence": 0.65 },
  "currency":          { "value": "USD",           "confidence": 0.80 },
  "num_guests":        { "value": 2,               "confidence": 0.60 },
  "special_requests":  { "value": null,            "confidence": null }
}
```

Fields with `confidence < 0.6` should be highlighted in the UI for staff review.

---

## AI Extraction Design

### Prompt strategy (stable, no hallucination)

```
You are extracting booking data from a confirmation email.
Return ONLY valid JSON. Do not add fields not listed below.
If a field cannot be found with confidence, set value to null.

Fields to extract:
- guest_name (string)
- check_in (ISO date YYYY-MM-DD)
- check_out (ISO date YYYY-MM-DD)
- property_name (string)
- booking_ref (string)
- room_type (string or null)
- total_amount (number or null)
- currency (3-letter code or null)
- num_guests (integer or null)
- special_requests (string or null)

Email:
---
{raw_email_text}
---
```

> Do not ask the model to infer, guess, or fill blanks. Explicit nulls are correct.

### Source-specific regex patterns (to build out)

| Source | Booking ref pattern | Date pattern |
|---|---|---|
| Booking.com | `Booking number[:\s]+(\d{10})` | `\d{1,2}\s+\w+\s+\d{4}` |
| Agoda | `Booking ID[:\s]+(\d{8,12})` | similar |
| Expedia | `Itinerary\s*#\s*(\d+)` | similar |

---

## API Endpoints (planned)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/email-ingest` | Inbound email webhook (from email relay / Cloudflare Email Routing) |
| `GET` | `/api/email-drafts` | List drafts for tenant (filterable by status) |
| `GET` | `/api/email-drafts/:id` | Single draft + raw email |
| `PATCH` | `/api/email-drafts/:id` | Update parsed fields (staff edits before confirm) |
| `POST` | `/api/email-drafts/:id/confirm` | Confirm → create booking_order |
| `POST` | `/api/email-drafts/:id/ignore` | Discard draft |

---

## Infrastructure

### Email routing (Cloudflare Email Routing)
- Each tenant gets an address: `{tenant-slug}@inbox.tours-market.com`
- Cloudflare Email Routing → Worker receives the raw email
- Worker calls `POST /api/email-ingest` with raw MIME payload

### AI inference
- Cloudflare Workers AI (preferred — zero external API key, low cost) or OpenAI as fallback
- Model: `@cf/mistral/mistral-7b-instruct-v0.1` or similar instruction-tuned model
- Only called when rule-based extraction has gaps

---

## Roadmap

### Phase 1 — Ingest + Draft (ship fast)
- [ ] Cloudflare Email Routing → Worker webhook
- [ ] Store raw email + create `email_ingest_draft`
- [ ] Rule-based source detection
- [ ] Basic regex extraction (booking ref, dates, guest name)
- [ ] Create ops task: *"Review draft booking"*
- [ ] Dashboard: draft inbox list + detail view
- [ ] Confirm / Edit+Confirm / Ignore actions

### Phase 2 — AI + Confidence UI
- [ ] AI extraction for missed fields
- [ ] `confidence_score` per field
- [ ] UI highlights low-confidence fields in yellow
- [ ] Overall confidence badge on draft card

### Phase 3 — Auto-ingest
- [ ] Gmail OAuth integration (no forward needed)
- [ ] IMAP polling for shared mailboxes
- [ ] Auto-label "booking email" detection

### Phase 4 — After user validation (only if needed)
- [ ] Booking.com Connectivity Partner API
- [ ] Channel manager integration (SiteMinder / Cloudbeds)
- [ ] Real-time availability sync

---

## What This Module Is NOT

- ❌ Not an OTA sync system
- ❌ Not a channel manager
- ❌ Not a PMS / POS / inventory engine
- ❌ Not a replacement for Booking.com or Agoda
- ❌ Not a real-time availability system

---

## Design Constraints

1. **AI only proposes, human confirms.** No booking is ever created without staff action.
2. **Raw email is always stored.** Even if parsing fails completely, the audit trail exists.
3. **Graceful degradation.** If AI is unavailable, draft is still created with empty `parsed_data` and a task to review manually.
4. **No inventory.** This module does not track room availability. It only captures confirmed reservation emails.
5. **No OTA write-back.** This is read-only ingestion. The system never modifies data on Booking.com/Agoda.

---

## Relationship to Other Modules

| Module | Relationship |
|---|---|
| `booking_orders` | Confirmed draft → creates or links to a booking order |
| `booking_order_todos` | Confirmation triggers standard ops task seeding |
| `tour_stops` / `stop_accommodations` | Optional: auto-match property name to configured stop accommodation |
| `26_PROPERTY_ENGINE_AND_STAFF_SEATS.md` | Long-term: confirmed drafts may feed a standalone property reservation engine |

---

## Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-16 | OTA API sync deferred indefinitely | Requires Booking.com certification, sync complexity (availability/rate/reservation triple sync) is high-risk at this stage |
| 2026-04-16 | Email ingestion chosen as Phase 2 path | 80% value at 20% effort. Email IS the source of truth for most small operators. User keeps control via confirm gate. |
| 2026-04-16 | AI hybrid (rule-first, AI-fallback) chosen | Deterministic rule parsing for common fields; AI only for gaps. Avoids hallucination on critical date/ID fields. |
| 2026-04-16 | Draft → Confirm model mandatory | Inspired by TripIt. AI is never authoritative. Staff is always last gate before record is live. |
