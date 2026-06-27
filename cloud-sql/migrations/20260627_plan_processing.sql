-- Plan processing lifecycle + materialized geometry.
--
-- Plans gain the same processing_state machine sessions have. A plan's matching
-- geometry lives in plans.path, supplied by the client on create/update: user-
-- imported routes never reach the PostGIS routes table (it is admin-populated
-- and GET-only), so we cannot assemble a user plan's path from plan_routes. The
-- client already has the full concatenated geometry, so it sends it.
--
-- Auto-matched reached destinations live in plan_reached_destinations, SEPARATE
-- from plan_destinations (user-chosen goals), so re-processing (which clears
-- source='auto') never clobbers the user's goals.

BEGIN;

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS path GEOGRAPHY(LineString, 4326),
  ADD COLUMN IF NOT EXISTS distance DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS gain DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS processing_state TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_error TEXT,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'plans' AND constraint_name = 'plans_processing_state_check'
  ) THEN
    ALTER TABLE plans ADD CONSTRAINT plans_processing_state_check
      CHECK (processing_state IN ('idle','pending','processing','completed','failed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS plan_reached_destinations (
  plan_id         TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  ordinal         INT NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'auto',
  PRIMARY KEY (plan_id, destination_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_reached_dest_dest
  ON plan_reached_destinations(destination_id);
CREATE INDEX IF NOT EXISTS idx_plans_processing_state
  ON plans(processing_state) WHERE processing_state IN ('pending','processing');
CREATE INDEX IF NOT EXISTS idx_plans_path ON plans USING GIST(path);

COMMIT;
