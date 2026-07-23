BEGIN;

-- Keep destination enrichment automatic while making multi-row inserts use
-- one spatial query for the whole inserted set.
CREATE OR REPLACE FUNCTION link_sessions_on_destination_insert()
RETURNS TRIGGER AS $$
BEGIN
  WITH bounds AS (
    SELECT ST_Expand(
             ST_Envelope(ST_Collect(COALESCE(
               d.boundary::geometry,
               ST_Force2D(d.location::geometry)
             ))),
             2
           ) AS geom
    FROM new_destinations d
    WHERE d.boundary IS NOT NULL OR d.location IS NOT NULL
  )
  INSERT INTO session_destinations (session_id, destination_id, relation, source)
  SELECT DISTINCT tp.session_id, d.id, 'reached'::session_destination_relation, 'auto'
  FROM bounds b
  JOIN new_destinations d ON true
  JOIN tracking_sessions ts
    ON ts.ended = true
   AND ts.path IS NOT NULL
   AND ts.path && b.geom::geography
   AND CASE
         WHEN d.boundary IS NOT NULL THEN ST_DWithin(d.boundary::geography, ts.path, 10)
         ELSE ST_DWithin(d.location, ts.path, destination_match_radius(d.features))
       END
  JOIN tracking_points tp
    ON tp.session_id = ts.id
   AND CASE
         WHEN d.boundary IS NOT NULL THEN ST_DWithin(d.boundary::geography, tp.location, 10)
         ELSE ST_DWithin(d.location, tp.location, destination_match_radius(d.features))
       END
  ON CONFLICT (session_id, destination_id) DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_destination_link_sessions ON destinations;
CREATE TRIGGER trg_destination_link_sessions
AFTER INSERT ON destinations
REFERENCING NEW TABLE AS new_destinations
FOR EACH STATEMENT
EXECUTE FUNCTION link_sessions_on_destination_insert();

CREATE OR REPLACE FUNCTION link_areas_on_destination_insert()
RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    WITH bounds AS (
      SELECT ST_Expand(
               ST_Envelope(ST_Collect(ST_Force2D(d.location::geometry))),
               2
             ) AS geom
      FROM new_destinations d
      WHERE d.location IS NOT NULL
        AND 'summit'::destination_feature = ANY(d.features)
    )
    INSERT INTO destination_areas (destination_id, area_id, relation, source)
    SELECT d.id, a.id, 'contained_by', 'postgis'
    FROM bounds b
    JOIN areas a ON a.boundary && b.geom
    JOIN new_destinations d
      ON ST_DWithin(
           a.boundary,
           ST_Force2D(d.location::geometry),
           0.0016666666666666668
         )
    CROSS JOIN LATERAL (
      SELECT ST_Force2D(d.location::geometry) AS geom, d.location::geography AS gloc
    ) p
    WHERE d.location IS NOT NULL
      AND 'summit'::destination_feature = ANY(d.features)
      AND (
        ST_Covers(a.boundary, p.geom)
        OR ST_DWithin(a.boundary::geography, p.gloc, 50)
      )
    ON CONFLICT (destination_id, area_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'link_areas_on_destination_insert failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_destination_link_areas ON destinations;
CREATE TRIGGER trg_destination_link_areas
AFTER INSERT ON destinations
REFERENCING NEW TABLE AS new_destinations
FOR EACH STATEMENT
EXECUTE FUNCTION link_areas_on_destination_insert();

CREATE OR REPLACE FUNCTION link_areas_on_session_destination_insert()
RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    INSERT INTO destination_areas (destination_id, area_id, relation, source)
    SELECT sd.destination_id, a.id, 'contained_by', 'postgis'
    FROM new_session_destinations sd
    JOIN destinations d ON d.id = sd.destination_id
    JOIN LATERAL (
      SELECT a.id
      FROM areas a
      WHERE ST_DWithin(a.boundary, ST_Force2D(d.location::geometry), 0.0016666666666666668)
        AND (
          ST_Covers(a.boundary, ST_Force2D(d.location::geometry))
          OR ST_DWithin(a.boundary::geography, d.location, 50)
        )
    ) a ON true
    WHERE sd.relation = 'reached'
      AND d.location IS NOT NULL
      AND 'summit'::destination_feature = ANY(d.features)
    ON CONFLICT (destination_id, area_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'link_areas_on_session_destination_insert failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_session_destination_link_areas ON session_destinations;
CREATE TRIGGER trg_session_destination_link_areas
AFTER INSERT ON session_destinations
REFERENCING NEW TABLE AS new_session_destinations
FOR EACH STATEMENT
EXECUTE FUNCTION link_areas_on_session_destination_insert();

COMMIT;
