-- Durable leases and receipts for bounded trail metadata refreshes.
-- Cost: no new worker, service, or schedule; expected added cost ~$0/month.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS trail_catalog_refresh_jobs (
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  refresh_kind TEXT NOT NULL CHECK (refresh_kind IN ('metadata', 'names')),
  state TEXT NOT NULL CHECK (state IN ('working', 'complete', 'blocked')),
  review_sha256 TEXT NOT NULL CHECK (review_sha256 ~ '^[0-9a-f]{64}$'),
  review_fingerprint TEXT NOT NULL CHECK (review_fingerprint ~ '^[0-9a-f]{64}$'),
  applied_fingerprint TEXT CHECK (applied_fingerprint ~ '^[0-9a-f]{64}$'),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '{}',
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (refresh_kind, route_id),
  CHECK ((state = 'working' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'working' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON trail_catalog_refresh_jobs TO "peaks-api";
COMMIT;
