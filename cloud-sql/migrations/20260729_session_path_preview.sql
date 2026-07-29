-- A small, stored copy of each session path for protected-area map previews.
-- It replaces per-session point downloads on area detail screens. Generated
-- storage keeps every existing and future path writer in sync automatically.
--
-- Cost: no new service or instance. This adds only the simplified geometry to
-- the existing Cloud SQL disk and lowers Cloud Run query work and egress.

ALTER TABLE tracking_sessions
  ADD COLUMN IF NOT EXISTS path_preview GEOMETRY(LineString, 4326)
  GENERATED ALWAYS AS (
    ST_Simplify(ST_Force2D(path::geometry), 0.00025)
  ) STORED;

GRANT SELECT ON tracking_sessions TO "peaks-api";
