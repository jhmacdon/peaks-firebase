-- Requeue completed audit results under the path-derived elevation-stat rules.

ALTER TABLE route_catalog_audit_jobs
  ALTER COLUMN audit_rule_version SET DEFAULT 3;
