-- JS Mumbai #3 — attendance confirmation
-- Apply with:  psql "$DATABASE_URL" -f lib/schema.sql
-- Safe to re-run: every statement is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS participants (
  id                serial PRIMARY KEY,
  email             text        NOT NULL UNIQUE,   -- lowercased + trimmed; the dedupe key
  name              text,
  luma_api_id       text,
  registered_at     timestamptz,
  token             text        NOT NULL UNIQUE,
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'yes', 'no')),
  responded_at      timestamptz,
  response_ip       text,
  response_ua       text,
  token_expires_at  timestamptz NOT NULL,
  source_row        jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- the untouched CSV row
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS participants_status_idx ON participants (status);
CREATE INDEX IF NOT EXISTS participants_created_idx ON participants (created_at);

-- One row per send ATTEMPT. This table is what makes the sender resumable:
-- send-wave.ts only skips participants that already have a status='sent' row.
CREATE TABLE IF NOT EXISTS email_sends (
  id              serial PRIMARY KEY,
  participant_id  integer     NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  kind            text        NOT NULL CHECK (kind IN ('invite', 'reminder')),
  status          text        NOT NULL CHECK (status IN ('sent', 'failed')),
  message_id      text,
  error           text,
  sent_at         timestamptz NOT NULL DEFAULT now()
);

-- Makes a double-send impossible even if the script is re-run or killed mid-wave.
CREATE UNIQUE INDEX IF NOT EXISTS email_sends_once_idx
  ON email_sends (participant_id, kind) WHERE status = 'sent';

CREATE INDEX IF NOT EXISTS email_sends_kind_status_idx ON email_sends (kind, status);

-- Append-only audit of every response, including mind-changes.
CREATE TABLE IF NOT EXISTS response_events (
  id              serial PRIMARY KEY,
  participant_id  integer     NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  from_status     text        NOT NULL,
  to_status       text        NOT NULL,
  ip              text,
  user_agent      text,
  at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS response_events_participant_idx
  ON response_events (participant_id, at DESC);

-- ---------------------------------------------------------------------------
-- Door check-in (JS Mumbai #3, 26 Sep 2026)
-- ---------------------------------------------------------------------------

-- One row per Luma guest who may walk through the door. Deliberately separate
-- from `participants`: that table serves the email-RSVP flow and is keyed by
-- email, while the door is keyed by the guest key baked into the QR.
CREATE TABLE IF NOT EXISTS attendees (
  id             serial PRIMARY KEY,
  guest_key      text NOT NULL UNIQUE,   -- 'g-...', the ?pk= in the check-in QR
  luma_guest_id  text,                   -- 'gst-...'
  ticket_id      text,                   -- 'tkt-...'
  name           text,
  email          text,
  checked_in_at  timestamptz,
  checked_in_by  text,                   -- device label, so desks can be told apart
  synced_at      timestamptz NOT NULL DEFAULT now()
);

-- Partial: the count query and the admin list only ever ask for checked-in rows.
CREATE INDEX IF NOT EXISTS attendees_checked_in_idx
  ON attendees (checked_in_at) WHERE checked_in_at IS NOT NULL;

-- Append-only log of every scan, including the ones that were turned away. Tells
-- you afterwards how many unknown or foreign QRs turned up at the door, which a
-- single `checked_in_at` column can never record.
CREATE TABLE IF NOT EXISTS check_in_scans (
  id          serial PRIMARY KEY,
  guest_key   text,
  outcome     text        NOT NULL CHECK (outcome IN ('ok', 'duplicate', 'unknown', 'foreign')),
  device      text,
  -- When the phone decoded it. Differs from recorded_at for anything that sat in
  -- the offline queue, so a wifi outage stays visible in the data.
  scanned_at  timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS check_in_scans_at_idx ON check_in_scans (scanned_at DESC);
