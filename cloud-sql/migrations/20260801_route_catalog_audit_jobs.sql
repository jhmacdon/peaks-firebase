-- Durable one-destination-at-a-time route catalog audits.

CREATE TABLE IF NOT EXISTS route_catalog_audit_jobs (
  destination_id     TEXT PRIMARY KEY REFERENCES destinations(id) ON DELETE CASCADE,
  destination_name   TEXT NOT NULL,
  state              TEXT NOT NULL DEFAULT 'queued'
                     CHECK (state IN (
                       'queued', 'auditing', 'passed',
                       'needs_repair', 'needs_human', 'out_of_scope'
                     )),
  priority           INTEGER NOT NULL DEFAULT 0,
  route_count        INTEGER NOT NULL DEFAULT 0,
  audit_rule_version INTEGER NOT NULL DEFAULT 2
                     CONSTRAINT route_catalog_audit_jobs_audit_rule_version_positive
                     CHECK (audit_rule_version > 0),
  catalog_fingerprint TEXT NOT NULL,
  attempt_count      INTEGER NOT NULL DEFAULT 0,
  lease_owner        TEXT,
  lease_token        TEXT,
  lease_expires_at   TIMESTAMPTZ,
  last_error         TEXT,
  final_result       JSONB,
  audited_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (
      state = 'auditing'
      AND lease_owner IS NOT NULL
      AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
    )
    OR
    (
      state <> 'auditing'
      AND lease_owner IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_route_catalog_audit_claim
  ON route_catalog_audit_jobs (state, priority DESC, updated_at, destination_id);

CREATE INDEX IF NOT EXISTS idx_route_catalog_audit_rule_version
  ON route_catalog_audit_jobs (audit_rule_version, state);

CREATE INDEX IF NOT EXISTS idx_route_catalog_audit_lease
  ON route_catalog_audit_jobs (lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;
