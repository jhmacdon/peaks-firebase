-- Precompute vertices and cumulative distance for the three continent-scale
-- Triple Crown routes. Their importer owns these rows and replaces them with
-- each centerline update. Other route writes and old route data are untouched.
--
-- Cost: no new service or worker. About 185,000 rows should remain under 60 MB
-- with the index, or under $0.01/month if Cloud SQL storage were priced alone.

BEGIN;

CREATE TABLE IF NOT EXISTS triple_crown_route_points (
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    idx             INT NOT NULL,
    pt              geometry(Point, 4326) NOT NULL,
    along_m         DOUBLE PRECISION NOT NULL CHECK (along_m >= 0),
    PRIMARY KEY (route_id, idx),
    CHECK (route_id IN ('triple-crown-pct', 'triple-crown-at', 'triple-crown-cdt'))
);

CREATE INDEX IF NOT EXISTS idx_triple_crown_route_points_pt
  ON triple_crown_route_points USING GIST (pt);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON triple_crown_route_points TO "peaks-api";

COMMIT;
