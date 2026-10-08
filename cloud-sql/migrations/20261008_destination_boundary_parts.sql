-- Match sessions and plans against small indexed pieces of each destination
-- boundary instead of the whole polygon.
--
-- The 2026-08-20 lake import stored the Great Lakes and their neighbours at
-- full OSM detail: Lake Huron has 475k points, Lake of the Woods 415k, Lake
-- Superior 209k. A geography ST_DWithin against one of those runs the full
-- polygon for every session whose track enters its bounding box. Production,
-- 2026-10-08: a 16-point session took over 150 s against Lake Superior, past
-- the 120 s processing limit. The sweep retried six such sessions every few
-- minutes, and the back-to-back 120 s queries slowed every API request
-- (search took 50-70 s).
--
-- Same fix as area_boundary_parts (20260721_session_area_paths.sql): keep the
-- exact shape in indexed ST_Subdivide pieces. The same session checks the
-- Lake Superior pieces in under a second.
--
-- Pieces are densified to 0.01 degree before the cast to geography. The
-- subdivision adds straight cut lines in degree space, and over a large lake
-- such a line drifts hundreds of metres from the geodesic between its ends,
-- leaving gaps between neighbouring pieces. At 0.01 degree the drift is
-- centimetres. Source edges are short and barely change.
--
-- Cost: no new service. One-time backfill of every boundary (minutes on the
-- db-f1-micro); then one trigger run per boundary write.
--
-- Two transactions. The column add takes an exclusive lock on
-- tracking_sessions, so it commits on its own before the long backfill. The
-- backfill blocks destination writes (not reads) until it commits.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- Cap sweep retries. A session whose processing fails or times out is claimed
-- again by every sweep; without a cap, one session that cannot finish holds
-- the database indefinitely. processSession counts each claim and resets the
-- count on success; the sweep skips sessions at the cap. Uploads and forced
-- re-runs still process them.
ALTER TABLE tracking_sessions
    ADD COLUMN IF NOT EXISTS processing_attempts INT NOT NULL DEFAULT 0;

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS destination_boundary_parts (
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    ordinal         INT NOT NULL,
    boundary_part   geography NOT NULL,
    PRIMARY KEY (destination_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_destination_boundary_parts_geog
    ON destination_boundary_parts USING GIST (boundary_part);

-- Pieces of one boundary. A boundary GEOS cannot subdivide is stored whole:
-- matching stays correct, only slow, and a catalog write never fails on it.
CREATE OR REPLACE FUNCTION destination_boundary_pieces(boundary geography)
RETURNS SETOF geography AS $$
BEGIN
    IF boundary IS NULL THEN
        RETURN;
    END IF;
    BEGIN
        RETURN QUERY
        SELECT ST_Segmentize(parts.geom, 0.01)::geography
        FROM ST_Subdivide(boundary::geometry, 256) AS parts(geom);
    EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT boundary;
    END;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public, pg_temp;

-- SECURITY DEFINER: catalog writers include restricted worker roles that hold
-- no rights on this table.
CREATE OR REPLACE FUNCTION refresh_destination_boundary_parts()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM destination_boundary_parts WHERE destination_id = NEW.id;
    INSERT INTO destination_boundary_parts (destination_id, ordinal, boundary_part)
    SELECT NEW.id, (row_number() OVER () - 1)::int, piece
    FROM destination_boundary_pieces(NEW.boundary) AS piece;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_destinations_refresh_boundary_parts ON destinations;
CREATE TRIGGER trg_destinations_refresh_boundary_parts
AFTER INSERT OR UPDATE OF boundary ON destinations
FOR EACH ROW EXECUTE FUNCTION refresh_destination_boundary_parts();

INSERT INTO destination_boundary_parts (destination_id, ordinal, boundary_part)
SELECT d.id, (row_number() OVER (PARTITION BY d.id) - 1)::int, piece
FROM destinations d
CROSS JOIN LATERAL destination_boundary_pieces(d.boundary) AS piece
WHERE d.boundary IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM destination_boundary_parts existing
      WHERE existing.destination_id = d.id
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON destination_boundary_parts TO "peaks-api";

COMMIT;
