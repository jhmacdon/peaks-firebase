-- Add 'campsite' destination feature for tent sites, established campgrounds,
-- and backcountry/dispersed camping. Adds an `amenities` JSONB column to
-- destinations so we can carry feature-specific facts (toilet type, drinking
-- water, fee, capacity, etc.) imported from OSM tags. The DB only enforces
-- JSONB validity; the schema for `amenities` is validated in TypeScript via
-- the CampsiteAmenities discriminated union (cloud-sql/migrate/src/lib/
-- amenities.ts and web/src/lib/amenities.ts).
--
-- Match radius for point-only campsites is 100m (matches trailhead — the
-- coordinate is usually the actual tent pad). Polygon campsites (developed
-- campgrounds with a `boundary`) keep the existing 10m-buffer-around-polygon
-- match path that all destinations get for free.

ALTER TYPE destination_feature ADD VALUE IF NOT EXISTS 'campsite';

ALTER TABLE destinations
  ADD COLUMN IF NOT EXISTS amenities JSONB;

CREATE INDEX IF NOT EXISTS destinations_amenities_idx
  ON destinations USING gin (amenities);

CREATE OR REPLACE FUNCTION destination_match_radius(features destination_feature[])
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN 'summit'    = ANY(features) THEN 30
    WHEN 'trailhead' = ANY(features) THEN 100
    WHEN 'waterfall' = ANY(features) THEN 200
    WHEN 'viewpoint' = ANY(features) THEN 200
    WHEN 'campsite'  = ANY(features) THEN 100
    ELSE 50
  END;
$$;
