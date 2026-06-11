BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'area_kind') THEN
    CREATE TYPE area_kind AS ENUM (
      'national_park',
      'national_monument',
      'national_forest',
      'national_grassland',
      'wilderness',
      'national_recreation_area',
      'national_conservation_area',
      'wildlife_refuge',
      'wild_and_scenic_river',
      'other_federal_area'
    );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS areas (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    search_name     TEXT NOT NULL,
    kind            area_kind NOT NULL,
    designation     TEXT,
    manager         TEXT,
    owner           TEXT,
    country_code    TEXT NOT NULL DEFAULT 'US',
    state_codes     TEXT[] NOT NULL DEFAULT '{}',

    source          TEXT NOT NULL,
    source_id       TEXT NOT NULL,
    source_version  TEXT NOT NULL,
    source_updated_at TIMESTAMPTZ,

    boundary        geography(MultiPolygon, 4326) NOT NULL,
    centroid        geography(Point, 4326) NOT NULL,
    bbox_min_lat    DOUBLE PRECISION NOT NULL,
    bbox_max_lat    DOUBLE PRECISION NOT NULL,
    bbox_min_lng    DOUBLE PRECISION NOT NULL,
    bbox_max_lng    DOUBLE PRECISION NOT NULL,

    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (source, source_id)
);

CREATE TABLE IF NOT EXISTS destination_areas (
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    area_id         TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    relation        TEXT NOT NULL DEFAULT 'contained_by',
    source          TEXT NOT NULL DEFAULT 'postgis',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (destination_id, area_id)
);

CREATE INDEX IF NOT EXISTS idx_areas_boundary
  ON areas USING GIST (boundary);

CREATE INDEX IF NOT EXISTS idx_areas_centroid
  ON areas USING GIST (centroid);

CREATE INDEX IF NOT EXISTS idx_areas_search_name
  ON areas USING GIN (search_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_areas_kind
  ON areas (kind);

CREATE INDEX IF NOT EXISTS idx_areas_source
  ON areas (source, source_id);

CREATE INDEX IF NOT EXISTS idx_destination_areas_area
  ON destination_areas (area_id);

DROP TRIGGER IF EXISTS trg_areas_updated ON areas;
CREATE TRIGGER trg_areas_updated
BEFORE UPDATE ON areas
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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
  FROM destinations d
  JOIN areas a ON ST_Covers(a.boundary, d.location)
  WHERE d.location IS NOT NULL
    AND 'summit'::destination_feature = ANY(d.features)
  ON CONFLICT (destination_id, area_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;

COMMIT;
