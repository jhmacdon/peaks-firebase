-- Segments a terrain review held: credible signs of hands below the scramble
-- bar. A held segment keeps its kind on every route until a decision gives it
-- an explicit kind, so a later route's review can't reset it by accident.
CREATE TABLE IF NOT EXISTS segment_terrain_holds (
  segment_id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL,
  question TEXT NOT NULL,
  plan_sha256 TEXT NOT NULL CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON segment_terrain_holds TO "peaks-api";
