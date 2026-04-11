BEGIN;

-- Tighten the destination auto-link trigger to use reduced proximity thresholds:
--   summit:    50m → 30m
--   trailhead: 150m → 100m
--   other:     100m → 50m

CREATE OR REPLACE FUNCTION link_sessions_on_destination_insert()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO session_destinations (session_id, destination_id, relation, source)
    SELECT DISTINCT tp.session_id, NEW.id, 'reached'::session_destination_relation, 'auto'
    FROM tracking_points tp
    JOIN tracking_sessions ts ON ts.id = tp.session_id
    WHERE ts.ended = true
      AND ST_DWithin(
            NEW.location,
            tp.location,
            CASE WHEN 'summit'    = ANY(NEW.features) THEN 30
                 WHEN 'trailhead' = ANY(NEW.features) THEN 100
                 ELSE 50 END
          )
    ON CONFLICT (session_id, destination_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
