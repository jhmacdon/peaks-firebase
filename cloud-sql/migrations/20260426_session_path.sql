-- Materialize each session's GPS track as a single linestring so spatial
-- queries (destination matching, route matching, reverse-match new
-- destinations against historical sessions) can use a single GIST index
-- lookup instead of scanning tracking_points and rebuilding the line on
-- every query.
--
-- Population is lazy-on-process — see processSession in api/src/processing.ts.
-- A one-shot backfill in cloud-sql/migrate populates path for sessions that
-- already had tracking_points before this migration shipped.

ALTER TABLE tracking_sessions
    ADD COLUMN IF NOT EXISTS path GEOGRAPHY(LineStringZ, 4326);

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_path
    ON tracking_sessions USING GIST (path);
