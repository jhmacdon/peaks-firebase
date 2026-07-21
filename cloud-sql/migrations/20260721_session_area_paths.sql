-- Store the protected areas crossed by each recorded session path.
--
-- processSession fills this table after it materializes tracking_sessions.path.
-- The API backfill script fills it for older sessions after this migration runs.

BEGIN;

CREATE TABLE IF NOT EXISTS session_areas (
    session_id      TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
    area_id         TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    relation        TEXT NOT NULL DEFAULT 'intersects',
    source          TEXT NOT NULL DEFAULT 'postgis',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, area_id)
);

CREATE INDEX IF NOT EXISTS session_areas_area_id_idx ON session_areas(area_id);

-- Large PAD-US polygons can contain tens of thousands of points. Intersecting
-- a long recording with the full polygon can exceed the session processing
-- limit. Indexed ST_Subdivide parts keep the exact shape but bound each check.
CREATE TABLE IF NOT EXISTS area_boundary_parts (
    area_id         TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    ordinal         INT NOT NULL,
    boundary_part   geometry(Geometry, 4326) NOT NULL,
    PRIMARY KEY (area_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_area_boundary_parts_geom
    ON area_boundary_parts USING GIST (boundary_part);

CREATE OR REPLACE FUNCTION refresh_area_boundary_parts()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM area_boundary_parts WHERE area_id = NEW.id;
    INSERT INTO area_boundary_parts (area_id, ordinal, boundary_part)
    SELECT NEW.id,
           (row_number() OVER () - 1)::int,
           parts.geom
    FROM ST_Dump(NEW.boundary) AS dumped
    CROSS JOIN LATERAL ST_Subdivide(dumped.geom, 8192) AS parts(geom);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_areas_refresh_boundary_parts ON areas;
CREATE TRIGGER trg_areas_refresh_boundary_parts
AFTER INSERT OR UPDATE OF boundary ON areas
FOR EACH ROW EXECUTE FUNCTION refresh_area_boundary_parts();

WITH missing_areas AS MATERIALIZED (
    SELECT a.id, a.boundary
    FROM areas a
    WHERE NOT EXISTS (
        SELECT 1 FROM area_boundary_parts existing WHERE existing.area_id = a.id
    )
)
INSERT INTO area_boundary_parts (area_id, ordinal, boundary_part)
SELECT a.id,
       (row_number() OVER (PARTITION BY a.id) - 1)::int,
       parts.geom
FROM missing_areas a
CROSS JOIN LATERAL ST_Dump(a.boundary) AS dumped
CROSS JOIN LATERAL ST_Subdivide(dumped.geom, 8192) AS parts(geom);

GRANT SELECT, INSERT, UPDATE, DELETE ON session_areas TO "peaks-api";
GRANT SELECT, INSERT, UPDATE, DELETE ON area_boundary_parts TO "peaks-api";

COMMIT;
