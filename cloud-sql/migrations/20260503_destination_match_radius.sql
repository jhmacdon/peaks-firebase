-- Centralize per-feature destination match radius into a SQL function so
-- the trigger, the API session-processing query, and the web backfill
-- helper all read from one source of truth. Bumps waterfall and viewpoint
-- to 200m so credit reflects "saw the destination" rather than "stood on
-- its OSM coordinate".

CREATE OR REPLACE FUNCTION destination_match_radius(features destination_feature[])
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN 'summit'    = ANY(features) THEN 30
    WHEN 'trailhead' = ANY(features) THEN 100
    WHEN 'waterfall' = ANY(features) THEN 200
    WHEN 'viewpoint' = ANY(features) THEN 200
    ELSE 50
  END;
$$;

-- Update the auto-link trigger to use the function. The boundary fallback
-- (10m of polygon) stays inline because it's structurally different.
-- Note: link_sessions_on_destination_insert is owned by peaks-api; run this
-- block as peaks-api (or grant postgres membership) if applying as superuser.
SET ROLE "peaks-api";
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
            ELSE ST_DWithin(NEW.location, tp.location, destination_match_radius(NEW.features))
          END
    ON CONFLICT (session_id, destination_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
RESET ROLE;

-- Backfill: retroactively credit sessions that passed within 50-200m of
-- already-imported waterfalls. Idempotent via ON CONFLICT.
INSERT INTO session_destinations (session_id, destination_id, relation, source)
SELECT s.id, d.id, 'reached', 'auto'
FROM tracking_sessions s
JOIN destinations d ON (d.owner = 'peaks' OR d.owner = s.user_id)
WHERE 'waterfall' = ANY(d.features)
  AND s.path IS NOT NULL
  AND ST_DWithin(s.path, d.location, 200)
ON CONFLICT (session_id, destination_id) DO NOTHING;
