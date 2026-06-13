-- Check + flag incoming recordings against protected areas at the DB layer.
--
-- When a recording reaches a SUMMIT (a session_destinations row with
-- relation='reached'), link that summit to its containing/adjacent protected
-- areas, using the same containment + 50 m boundary tolerance as
-- link_summit_destinations_to_areas(). This guarantees every reached summit is
-- flagged with its park/forest/wilderness regardless of which API revision is
-- deployed (the per-session app-level path in processing.ts is complementary).
--
-- Enrichment only: the body is wrapped in an exception block so a linking
-- failure can NEVER abort the session_destinations insert (which would fail
-- recording ingestion). Mirrors the existing trg_destination_link_sessions
-- trigger pattern. The 0.00166667 deg planar gate is 50 m / 30000 (generous;
-- the exact geography check makes the precise meter cut).

CREATE OR REPLACE FUNCTION link_areas_on_session_destination_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.relation <> 'reached' THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO destination_areas (destination_id, area_id, relation, source)
    SELECT NEW.destination_id, a.id, 'contained_by', 'postgis'
    FROM destinations d
    JOIN LATERAL (
      SELECT a.id
      FROM areas a
      WHERE ST_DWithin(a.boundary, ST_Force2D(d.location::geometry), 0.0016666666666666668)
        AND (
          ST_Covers(a.boundary, ST_Force2D(d.location::geometry))
          OR ST_DWithin(a.boundary::geography, d.location, 50)
        )
    ) a ON true
    WHERE d.id = NEW.destination_id
      AND d.location IS NOT NULL
      AND 'summit'::destination_feature = ANY(d.features)
    ON CONFLICT (destination_id, area_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'link_areas_on_session_destination_insert failed for destination %: %',
      NEW.destination_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_session_destination_link_areas ON session_destinations;
CREATE TRIGGER trg_session_destination_link_areas
AFTER INSERT ON session_destinations
FOR EACH ROW EXECUTE FUNCTION link_areas_on_session_destination_insert();
