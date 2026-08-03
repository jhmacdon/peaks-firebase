-- Keep completed v1 audits distinguishable so seed can queue them under v2.

ALTER TABLE IF EXISTS route_catalog_audit_jobs
  ADD COLUMN IF NOT EXISTS audit_rule_version INTEGER;

UPDATE route_catalog_audit_jobs
SET audit_rule_version = 1
WHERE audit_rule_version IS NULL;

ALTER TABLE route_catalog_audit_jobs
  ALTER COLUMN audit_rule_version SET DEFAULT 2;

ALTER TABLE route_catalog_audit_jobs
  ALTER COLUMN audit_rule_version SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'route_catalog_audit_jobs_audit_rule_version_positive'
      AND conrelid = 'route_catalog_audit_jobs'::regclass
  ) THEN
    ALTER TABLE route_catalog_audit_jobs
      ADD CONSTRAINT route_catalog_audit_jobs_audit_rule_version_positive
      CHECK (audit_rule_version > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_route_catalog_audit_rule_version
  ON route_catalog_audit_jobs (audit_rule_version, state);
