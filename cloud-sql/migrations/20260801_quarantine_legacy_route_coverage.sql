-- Quarantine routes created by the retired named-route coverage importer.
--
-- That importer treated a named OSM hiking relation passing within 250 m of a
-- summit as a complete summit route. It saved the full relation as active
-- without a trailhead, reviewed source provenance, route segments, shape, or
-- gain. Superseding preserves route, session, and plan rows while removing the
-- unreviewed lines from active route selection.

BEGIN;

WITH candidates AS (
  SELECT r.id
  FROM routes r
  WHERE r.owner = 'peaks'
    AND r.status = 'active'
    AND r.id ~ '^osm-route-[0-9]+-[0-9a-f]{10}$'
    AND r.provenance IS NULL
    AND r.completion = 'none'
    AND r.shape IS NULL
    AND r.gain IS NULL
    AND r.gain_loss IS NULL
    AND jsonb_typeof(r.external_links) = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(r.external_links) link
      WHERE link->>'type' = 'osm'
        AND link->>'id' ~ '^relation/[0-9]+$'
    )
    AND NOT EXISTS (
      SELECT 1 FROM route_segments rs WHERE rs.route_id = r.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM route_destinations rd
      JOIN destinations d ON d.id = rd.destination_id
      WHERE rd.route_id = r.id
        AND 'trailhead'::destination_feature = ANY(d.features)
    )
)
UPDATE routes r
SET status = 'superseded',
    updated_at = now()
FROM candidates
WHERE r.id = candidates.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM routes r
    WHERE r.owner = 'peaks'
      AND r.status = 'active'
      AND r.id ~ '^osm-route-[0-9]+-[0-9a-f]{10}$'
      AND r.provenance IS NULL
      AND r.completion = 'none'
      AND r.shape IS NULL
      AND r.gain IS NULL
      AND r.gain_loss IS NULL
      AND jsonb_typeof(r.external_links) = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(r.external_links) link
        WHERE link->>'type' = 'osm'
          AND link->>'id' ~ '^relation/[0-9]+$'
      )
      AND NOT EXISTS (
        SELECT 1 FROM route_segments rs WHERE rs.route_id = r.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM route_destinations rd
        JOIN destinations d ON d.id = rd.destination_id
        WHERE rd.route_id = r.id
          AND 'trailhead'::destination_feature = ANY(d.features)
      )
  ) THEN
    RAISE EXCEPTION 'legacy route-coverage rows remain active';
  END IF;
END
$$;

COMMIT;
