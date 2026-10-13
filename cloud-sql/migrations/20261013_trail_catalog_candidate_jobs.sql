-- Local, bounded candidate work. No hosted process or monthly compute cost.
BEGIN;
CREATE TABLE IF NOT EXISTS trail_catalog_candidate_jobs (
  source_key TEXT PRIMARY KEY,
  batch_key TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  review_hash TEXT NOT NULL CHECK (review_hash ~ '^[a-f0-9]{64}$'),
  artifact JSONB NOT NULL,
  proposed_route_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','leased','pending','rejected')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  route_id TEXT REFERENCES routes(id),
  rejection_reason TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((state='leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state<>'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK ((state='pending' AND route_id IS NOT NULL) OR (state<>'pending' AND route_id IS NULL))
);
CREATE INDEX IF NOT EXISTS trail_catalog_candidate_jobs_claim ON trail_catalog_candidate_jobs(batch_key, state, lease_expires_at, created_at);
GRANT SELECT,INSERT,UPDATE ON trail_catalog_candidate_jobs TO "peaks-route-factory";
GRANT SELECT ON trail_catalog_candidate_jobs TO "peaks-route-reviewer";
COMMIT;
