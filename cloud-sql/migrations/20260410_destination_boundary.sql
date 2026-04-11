BEGIN;

-- Add optional polygon boundary for area-based destinations (lakes, camps, etc.)
ALTER TABLE destinations
    ADD COLUMN IF NOT EXISTS boundary geography(Polygon, 4326);

CREATE INDEX IF NOT EXISTS idx_destinations_boundary
    ON destinations USING GIST (boundary) WHERE boundary IS NOT NULL;

-- Update the auto-link trigger to use boundary when available.
-- If a destination has a boundary polygon, match any tracking point within
-- 10m of the shape (GPS error buffer). Otherwise fall back to the existing
-- feature-aware point distance thresholds.
CREATE OR REPLACE FUNCTION link_sessions_on_destination_insert()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO session_destinations (session_id, destination_id, relation, source)
    SELECT DISTINCT tp.session_id, NEW.id, 'reached'::session_destination_relation, 'auto'
    FROM tracking_points tp
    JOIN tracking_sessions ts ON ts.id = tp.session_id
    WHERE ts.ended = true
      AND CASE WHEN NEW.boundary IS NOT NULL
            THEN ST_DWithin(NEW.boundary, tp.location, 10)
            ELSE ST_DWithin(
                   NEW.location,
                   tp.location,
                   CASE WHEN 'summit'    = ANY(NEW.features) THEN 30
                        WHEN 'trailhead' = ANY(NEW.features) THEN 100
                        ELSE 50 END
                 )
          END
    ON CONFLICT (session_id, destination_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
