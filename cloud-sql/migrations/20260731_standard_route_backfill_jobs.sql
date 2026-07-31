-- Durable work queue for the standard-route backfill.
--
-- Codex scheduled tasks may stop at any point. Leases keep two workers from
-- taking the same summit, while saved evidence makes each later run resumable.
-- This adds no always-on service and has negligible storage cost.

BEGIN;

CREATE TABLE IF NOT EXISTS standard_route_backfill_jobs (
  destination_id    TEXT PRIMARY KEY
                    REFERENCES destinations(id) ON DELETE CASCADE,
  state             TEXT NOT NULL DEFAULT 'queued',
  priority          INTEGER NOT NULL DEFAULT 0,
  target_reasons    JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence          JSONB NOT NULL DEFAULT '{}'::jsonb,
  candidate         JSONB NOT NULL DEFAULT '{}'::jsonb,
  review            JSONB NOT NULL DEFAULT '{}'::jsonb,
  trailhead_id      TEXT REFERENCES destinations(id) ON DELETE SET NULL,
  candidate_path    TEXT,
  candidate_sha256  TEXT,
  candidate_artifact JSONB,
  published_route_id TEXT REFERENCES routes(id) ON DELETE SET NULL,
  blocker_code      TEXT,
  blocker_message   TEXT,
  last_error        TEXT,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner       TEXT,
  lease_token       TEXT,
  lease_expires_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT standard_route_backfill_jobs_state_check CHECK (
    state IN (
      'queued',
      'researching',
      'candidate_ready',
      'pending_review',
      'needs_revision',
      'approved',
      'published',
      'verified',
      'needs_geometry',
      'waiting_rights',
      'waiting_access',
      'needs_human'
    )
  ),
  CONSTRAINT standard_route_backfill_jobs_lease_check CHECK (
    (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    OR
    (lease_owner IS NOT NULL AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT standard_route_backfill_jobs_candidate_hash_check CHECK (
    candidate_sha256 IS NULL OR candidate_sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_standard_route_backfill_jobs_claim
  ON standard_route_backfill_jobs (
    state,
    next_attempt_at,
    priority DESC,
    updated_at
  )
  WHERE state <> 'verified';

CREATE INDEX IF NOT EXISTS idx_standard_route_backfill_jobs_expired_lease
  ON standard_route_backfill_jobs (lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON standard_route_backfill_jobs TO "peaks-api";

COMMIT;
