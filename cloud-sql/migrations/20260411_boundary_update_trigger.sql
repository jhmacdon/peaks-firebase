BEGIN;

-- Add 'lake' to destination_feature enum
ALTER TYPE destination_feature ADD VALUE IF NOT EXISTS 'lake';

-- When a destination's boundary or location is updated, auto-link any
-- sessions whose GPS tracks pass through the area.
-- This complements the existing INSERT trigger which only sees the state
-- at creation time.
--
-- Boundary update: match points within the polygon + 10m GPS buffer.
-- Location update (no boundary): use feature-aware distance thresholds
-- (same as the INSERT trigger).
CREATE OR REPLACE FUNCTION link_sessions_on_destination_update()
RETURNS TRIGGER AS $$
BEGIN
    -- Boundary changed
    IF NEW.boundary IS NOT NULL AND (OLD.boundary IS NULL OR OLD.boundary != NEW.boundary) THEN
        INSERT INTO session_destinations (session_id, destination_id, relation, source)
        SELECT DISTINCT tp.session_id, NEW.id, 'reached'::session_destination_relation, 'auto'
        FROM tracking_points tp
        JOIN tracking_sessions ts ON ts.id = tp.session_id
        WHERE ts.ended = true
          AND ST_DWithin(NEW.boundary, tp.location, 10)
        ON CONFLICT (session_id, destination_id) DO NOTHING;

    -- Location changed (and no boundary — boundary takes precedence)
    ELSIF NEW.boundary IS NULL AND OLD.location != NEW.location THEN
        INSERT INTO session_destinations (session_id, destination_id, relation, source)
        SELECT DISTINCT tp.session_id, NEW.id, 'reached'::session_destination_relation, 'auto'
        FROM tracking_points tp
        JOIN tracking_sessions ts ON ts.id = tp.session_id
        WHERE ts.ended = true
          AND ST_DWithin(
                NEW.location,
                tp.location,
                CASE WHEN 'summit' = ANY(NEW.features) THEN 30
                     WHEN 'trailhead' = ANY(NEW.features) THEN 100
                     ELSE 50 END
              )
        ON CONFLICT (session_id, destination_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_destination_update_link_sessions
    AFTER UPDATE OF boundary, location ON destinations
    FOR EACH ROW
    EXECUTE FUNCTION link_sessions_on_destination_update();

COMMIT;
