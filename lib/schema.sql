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
