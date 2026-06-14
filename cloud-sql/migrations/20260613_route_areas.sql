-- Link routes to the protected / land-management areas they pass through.
--
-- Mirrors destination_areas / link_summit_destinations_to_areas, but a route is
-- a line (routes.path geography(LineStringZ,4326)) rather than a point. We drop
-- the Z with ST_Force2D and work in 4326 geometry (routes.path::geometry is
-- already SRID 4326, so no ST_Transform is needed). A route can pass through
-- many overlapping areas, so route_areas is many-to-many like destination_areas.
--
-- DB-SAFETY: areas now contains a few enormous repaired Alaska MultiPolygons
-- (millions of vertices), and ST_Intersects against those is costly, so we keep
-- the cheap `a.boundary && route_geom` bbox prefilter ahead of the exact
-- ST_Intersects. relation is 'contained_by' when the whole route is covered by
-- the area, else 'intersects'.

BEGIN;

CREATE TABLE IF NOT EXISTS route_areas (
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    area_id         TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    relation        TEXT NOT NULL DEFAULT 'intersects',
    source          TEXT NOT NULL DEFAULT 'postgis',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (route_id, area_id)
);

CREATE INDEX IF NOT EXISTS route_areas_area_id_idx ON route_areas(area_id);

CREATE OR REPLACE FUNCTION link_routes_to_areas(replace_existing BOOLEAN DEFAULT false)
RETURNS INTEGER AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  IF replace_existing THEN
    DELETE FROM route_areas WHERE source = 'postgis';
  END IF;

  INSERT INTO route_areas (route_id, area_id, relation, source)
  SELECT r.id, a.id,
         CASE WHEN ST_Covers(a.boundary, r.geom) THEN 'contained_by'
              ELSE 'intersects' END,
         'postgis'
  FROM (
    SELECT id, ST_Force2D(path::geometry) AS geom
    FROM routes
    WHERE path IS NOT NULL
  ) r
  JOIN LATERAL (
    SELECT id, boundary
    FROM areas a
    WHERE a.boundary && r.geom
      AND ST_Intersects(a.boundary, r.geom)
  ) a ON true
  ON CONFLICT (route_id, area_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;

COMMIT;
