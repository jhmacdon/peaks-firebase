-- Link summits that sit ON a park boundary line, not just strictly inside it.
--
-- PAD-US boundaries and summit coordinates each carry ~10-50 m of positional
-- error, so crest-line peaks were missed by strict ST_Covers. The canonical
-- case: Mount Whitney's summit is ~0.5 m OUTSIDE Sequoia NP / Inyo NF / John
-- Muir Wilderness (all three meet at the Sierra crest there), so it linked to
-- nothing. Empirically there is a clean gap between genuine boundary mismatches
-- (<= ~48 m, e.g. Guadalupe Peak's overlapping Wilderness) and genuine
-- non-members (Mount Mitchell is 306 m from Pisgah NF), so 50 m is the cut.
--
-- Link a summit to an area if it is ST_Covers-contained OR within tolerance_m
-- meters of the boundary. The planar ST_DWithin gate (degrees, GIST-indexed)
-- prunes to near-boundary candidates; the exact geography ST_DWithin does the
-- precise meter cut on that small set.

DROP FUNCTION IF EXISTS link_summit_destinations_to_areas(boolean);

CREATE OR REPLACE FUNCTION link_summit_destinations_to_areas(
  replace_existing BOOLEAN DEFAULT false,
  tolerance_m DOUBLE PRECISION DEFAULT 50
)
RETURNS INTEGER AS $$
DECLARE
  inserted_count INTEGER;
  -- Generous planar pre-gate in degrees. Over-covers longitude compression at
  -- high latitude (50 m ~= 0.0013 deg lng at 70N); the exact geography check
  -- below makes the precise cut, so the gate only needs to never under-select.
  gate_deg DOUBLE PRECISION := GREATEST(tolerance_m / 30000.0, 0.0002);
BEGIN
  IF replace_existing THEN
    DELETE FROM destination_areas WHERE source = 'postgis';
  END IF;

  INSERT INTO destination_areas (destination_id, area_id, relation, source)
  SELECT d.id, a.id, 'contained_by', 'postgis'
  FROM (
    SELECT id, geom, gloc, ST_X(geom) AS lng, ST_Y(geom) AS lat
    FROM (
      SELECT id,
             ST_Force2D(location::geometry) AS geom,
             location::geography AS gloc
      FROM destinations
      WHERE location IS NOT NULL
        AND 'summit'::destination_feature = ANY(features)
    ) summit_points
  ) d
  JOIN LATERAL (
    SELECT id
    FROM areas a
    WHERE d.lng BETWEEN a.bbox_min_lng - gate_deg AND a.bbox_max_lng + gate_deg
      AND d.lat BETWEEN a.bbox_min_lat - gate_deg AND a.bbox_max_lat + gate_deg
      AND ST_DWithin(a.boundary, d.geom, gate_deg)
      AND (
        ST_Covers(a.boundary, d.geom)
        OR ST_DWithin(a.boundary::geography, d.gloc, tolerance_m)
      )
  ) a ON true
  ON CONFLICT (destination_id, area_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;
