-- CHK-R109: Email ingest — stores inbound emails parsed from Cloudflare Email Routing
-- or any other webhook that forwards raw email data to POST /api/email/ingest

CREATE TABLE IF NOT EXISTS email_drafts (
  id           TEXT    PRIMARY KEY,
  tenant_id    TEXT    REFERENCES tenants(id),   -- NULL = platform-level / unrouted
  received_at  INTEGER NOT NULL,

  -- Envelope
  from_email   TEXT,
  from_name    TEXT,
  to_email     TEXT,
  subject      TEXT,

  -- Parsed body content
  body_text    TEXT,
  body_html    TEXT,

  -- AI / auto-extract hints (JSON object with keys: tour_interest, pax, dates, budget, phone)
  parsed_json  TEXT,

  -- Workflow state
  status       TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','replied','archived')),
  assigned_to  TEXT    REFERENCES users(id),
  notes        TEXT,

  -- Metadata
  raw_headers  TEXT,   -- JSON object of relevant headers
  source       TEXT    NOT NULL DEFAULT 'webhook',   -- 'webhook' | 'cloudflare_email' | 'test'
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_drafts_tenant     ON email_drafts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_drafts_status     ON email_drafts (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_email_drafts_received   ON email_drafts (received_at DESC);
