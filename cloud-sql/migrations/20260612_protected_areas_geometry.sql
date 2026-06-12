-- Store protected-area boundaries as geometry, not geography.
-- These are large official PAD-US polygons used for containment and GeoJSON
-- output, where planar 4326 geometry avoids expensive geodetic conversion.

DROP INDEX IF EXISTS idx_areas_boundary;
DROP INDEX IF EXISTS idx_areas_centroid;

ALTER TABLE areas
  ALTER COLUMN boundary TYPE geometry(MultiPolygon, 4326)
    USING boundary::geometry,
  ALTER COLUMN centroid TYPE geometry(Point, 4326)
    USING centroid::geometry;

CREATE INDEX IF NOT EXISTS idx_areas_boundary
  ON areas USING GIST (boundary);

CREATE INDEX IF NOT EXISTS idx_areas_centroid
  ON areas USING GIST (centroid);

CREATE OR REPLACE FUNCTION link_summit_destinations_to_areas(replace_existing BOOLEAN DEFAULT false)
RETURNS INTEGER AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  IF replace_existing THEN
    DELETE FROM destination_areas WHERE source = 'postgis';
  END IF;

  INSERT INTO destination_areas (destination_id, area_id, relation, source)
  SELECT d.id, a.id, 'contained_by', 'postgis'
  FROM (
    SELECT id, geom, ST_X(geom) AS lng, ST_Y(geom) AS lat
    FROM (
      SELECT id, ST_Force2D(location::geometry) AS geom
      FROM destinations
      WHERE location IS NOT NULL
        AND 'summit'::destination_feature = ANY(features)
    ) summit_points
  ) d
  JOIN LATERAL (
    SELECT id
    FROM areas a
    WHERE d.lng BETWEEN a.bbox_min_lng AND a.bbox_max_lng
      AND d.lat BETWEEN a.bbox_min_lat AND a.bbox_max_lat
      AND a.boundary && d.geom
      AND ST_Covers(a.boundary, d.geom)
  ) a ON true
  ON CONFLICT (destination_id, area_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;
