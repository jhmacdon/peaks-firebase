-- Route Partial History: a session_routes row can now describe a STRETCH of a
-- route rather than the whole thing, so each row records which stretch.
--
-- covered_intervals is an array of [start, end] pairs — fractions of the route
-- linestring in [0, 1], sorted and non-overlapping, merged with a gap tolerance
-- of max(100 m, 2% of route length) so a GPS dropout does not shred one hike
-- into fragments. NULL means the row predates this column; a consumer treats
-- NULL on a coverage >= 0.70 row as the whole route.
--
-- Nullable with no default, so on Postgres 11+ this is a catalog-only change:
-- no table rewrite, no lock held while rows are touched. No new index — every
-- read is already keyed by (session_id, route_id) (the primary key) or by
-- route_id (idx_session_routes_route). A few MB of disk on the existing
-- instance: $0/month recurring.
--
-- Apply manually as postgres (CI does not run migrations):
--   psql -h 127.0.0.1 -U postgres -d peaks \
--     -f cloud-sql/migrations/20260825_session_route_covered_intervals.sql

BEGIN;

ALTER TABLE session_routes
    ADD COLUMN IF NOT EXISTS covered_intervals JSONB;

COMMIT;
