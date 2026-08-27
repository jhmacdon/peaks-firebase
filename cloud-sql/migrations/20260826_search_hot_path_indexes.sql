-- Keep search on small text indexes instead of scanning the geometry-heavy
-- destination, route, and area heaps. Existing empty destination search names
-- came from one global summit import; all current writers already provide this
-- field. Backfill those rows before making the invariant explicit.
--
-- Cost impact: under 20 MB of added indexes on the existing Cloud SQL disk,
-- less than $0.01/month and no fixed infrastructure cost.

BEGIN;

UPDATE destinations
SET search_name = lower(name)
WHERE (search_name IS NULL OR btrim(search_name) = '')
  AND name IS NOT NULL
  AND btrim(name) <> '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM destinations
    WHERE search_name IS NULL OR btrim(search_name) = ''
  ) THEN
    RAISE EXCEPTION 'destinations still contain missing search_name values';
  END IF;
END;
$$;

COMMIT;

-- Add and validate the proof before SET NOT NULL. PostgreSQL can then avoid a
-- heap scan while holding the stronger ALTER TABLE lock.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'destinations'::regclass
      AND conname = 'destinations_search_name_nonempty'
  ) THEN
    ALTER TABLE destinations
      ADD CONSTRAINT destinations_search_name_nonempty
      CHECK (search_name IS NOT NULL AND btrim(search_name) <> '') NOT VALID;
  END IF;
END;
$$;

ALTER TABLE destinations
  VALIDATE CONSTRAINT destinations_search_name_nonempty;

ALTER TABLE destinations
  ALTER COLUMN search_name SET NOT NULL;

-- Production is missing the index from the older short-query migration. Keep
-- it here as an idempotent repair so two-character searches never scan all
-- destination rows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_destinations_search_name_fts
ON destinations
USING GIN (
  to_tsvector('simple', COALESCE(NULLIF(search_name, ''), lower(name)))
);

-- Only 475 of 15,473 production routes are active. Partial indexes keep route
-- name search off the 62 MB route heap and remain tiny as superseded routes grow.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_routes_active_name_trgm
ON routes USING GIN (lower(name) gin_trgm_ops)
WHERE status = 'active';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_routes_active_name_prefix
ON routes (lower(name) text_pattern_ops)
INCLUDE (id)
WHERE status = 'active';

-- Two-character area queries use a lowercase prefix and can use this compact
-- B-tree instead of walking the trigram index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_areas_search_name_prefix
ON areas (search_name text_pattern_ops);

ANALYZE destinations;
ANALYZE routes;
ANALYZE areas;
