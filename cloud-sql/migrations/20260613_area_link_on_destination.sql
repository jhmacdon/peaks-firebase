-- Flag a new summit with its protected areas at creation time.
--
-- Closes the gap left by the backfill + recording trigger: a summit added AFTER
-- the backfill that is never reached by a recording would otherwise never get
-- linked. This mirrors the existing trg_destination_link_sessions pattern (which
-- links sessions when a destination is inserted) for the area side. Uses the
-- same containment + 50 m tolerance as link_summit_destinations_to_areas().
--
-- Enrichment only: wrapped in an exception block so a linking failure can never
-- abort the destination insert. INSERT-only (location edits are rare; re-run the
-- batch helper to refresh links after a bulk coordinate correction).

CREATE OR REPLACE FUNCTION link_areas_on_destination_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.location IS NULL OR NOT ('summit'::destination_feature = ANY(NEW.features)) THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO destination_areas (destination_id, area_id, relation, source)
    SELECT NEW.id, a.id, 'contained_by', 'postgis'
    FROM (SELECT ST_Force2D(NEW.location::geometry) AS geom, NEW.location::geography AS gloc) p
    JOIN LATERAL (
      SELECT a.id
      FROM areas a
      WHERE ST_DWithin(a.boundary, p.geom, 0.0016666666666666668)
        AND (
          ST_Covers(a.boundary, p.geom)
          OR ST_DWithin(a.boundary::geography, p.gloc, 50)
        )
    ) a ON true
    ON CONFLICT (destination_id, area_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'link_areas_on_destination_insert failed for destination %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_destination_link_areas ON destinations;
CREATE TRIGGER trg_destination_link_areas
AFTER INSERT ON destinations
FOR EACH ROW EXECUTE FUNCTION link_areas_on_destination_insert();
