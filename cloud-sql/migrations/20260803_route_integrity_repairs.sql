-- Durable repair ledger for active Peaks routes whose linked summits do not
-- meet the five-metre path contact rule. This is storage and on-demand CLI
-- work only; expected backend run-rate change: near $0/month.

BEGIN;

-- One fail-closed predicate is shared by activation, final verification, and
-- repair retirement. It compares the materialized route to the ordered,
-- direction-aware segment assembly point by point, including Z values.
CREATE OR REPLACE FUNCTION peaks_route_passes_publish_integrity(
  candidate_route_id TEXT,
  required_destination_id TEXT DEFAULT NULL,
  required_status TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
WITH candidate AS (
  SELECT r.*
  FROM routes r
  WHERE r.id = candidate_route_id
), ordered_segments AS (
  SELECT rs.ordinal,
         rs.direction,
         s.path,
         s.gain AS stored_gain,
         s.gain_loss AS stored_loss,
         segment_elevation_stats.gain AS computed_gain,
         segment_elevation_stats.loss AS computed_loss,
         s.provenance,
         CASE rs.direction
           WHEN 'reverse' THEN ST_Reverse(s.path::geometry)
           ELSE s.path::geometry
         END AS directed_path
  FROM route_segments rs
  LEFT JOIN segments s ON s.id = rs.segment_id
  LEFT JOIN LATERAL route_elevation_stats(s.path)
    AS segment_elevation_stats ON true
  WHERE rs.route_id = candidate_route_id
  ORDER BY rs.ordinal
), chained_segments AS (
  SELECT *, lag(directed_path) OVER (ORDER BY ordinal) AS prior_path
  FROM ordered_segments
), segment_checks AS (
  SELECT count(*)::int AS segment_count,
         count(*) = count(DISTINCT ordinal)
           AND min(ordinal) = 0
           AND max(ordinal) = count(*) - 1 AS ordinals_valid,
         COALESCE(bool_and(
           path IS NOT NULL
           AND encode_route_elevation_profile(path) IS NOT NULL
           AND stored_gain IS NOT DISTINCT FROM computed_gain
           AND stored_loss IS NOT DISTINCT FROM computed_loss
           AND is_valid_route_provenance(provenance)
           AND provenance IS NOT DISTINCT FROM (SELECT provenance FROM candidate)
         ), false) AS rows_valid
  FROM ordered_segments
), chain_checks AS (
  SELECT COALESCE(bool_and(
           prior_path IS NULL
           OR (
             ST_DWithin(
               ST_EndPoint(prior_path)::geography,
               ST_StartPoint(directed_path)::geography,
               0.1
             )
             AND abs(
               ST_Z(ST_EndPoint(prior_path))
               - ST_Z(ST_StartPoint(directed_path))
             ) <= 0.01
           )
         ), false) AS connected
  FROM chained_segments
), segment_points AS (
  SELECT ordered_segments.ordinal,
         (dumped).path[1]::int AS segment_vertex,
         (dumped).geom AS geom
  FROM ordered_segments
  CROSS JOIN LATERAL ST_DumpPoints(ordered_segments.directed_path) AS dumped
  WHERE ordered_segments.ordinal = 0 OR (dumped).path[1] > 1
), assembled AS (
  SELECT ST_SetSRID(
           ST_MakeLine(geom ORDER BY ordinal, segment_vertex),
           4326
         ) AS path
  FROM segment_points
), route_points AS (
  SELECT (dumped).path[1]::int AS vertex,
         (dumped).geom AS geom
  FROM candidate
  CROSS JOIN LATERAL ST_DumpPoints(candidate.path::geometry) AS dumped
), assembled_points AS (
  SELECT (dumped).path[1]::int AS vertex,
         (dumped).geom AS geom
  FROM assembled
  CROSS JOIN LATERAL ST_DumpPoints(assembled.path) AS dumped
), assembly_checks AS (
  SELECT count(*) FILTER (
           WHERE route_points.geom IS NOT NULL
             AND assembled_points.geom IS NOT NULL
             AND abs(ST_X(route_points.geom) - ST_X(assembled_points.geom)) <= 1e-9
             AND abs(ST_Y(route_points.geom) - ST_Y(assembled_points.geom)) <= 1e-9
             AND abs(ST_Z(route_points.geom) - ST_Z(assembled_points.geom)) <= 0.01
         )::int AS matching_points,
         count(route_points.geom)::int AS route_points,
         count(assembled_points.geom)::int AS assembled_points
  FROM route_points
  FULL JOIN assembled_points USING (vertex)
), destination_checks AS (
  SELECT count(*) FILTER (
           WHERE 'summit'::destination_feature = ANY(d.features)
         )::int AS summit_count,
         COALESCE(bool_and(
           CASE WHEN 'summit'::destination_feature = ANY(d.features)
             THEN d.location IS NOT NULL
               AND (SELECT path FROM candidate) IS NOT NULL
               AND ST_DWithin((SELECT path FROM candidate), d.location, 5)
             ELSE true
           END
         ), false) AS all_summits_contacted,
         count(*) = count(DISTINCT rd.ordinal)
           AND min(rd.ordinal) = 0
           AND max(rd.ordinal) = count(*) - 1 AS ordinals_valid
  FROM route_destinations rd
  JOIN destinations d ON d.id = rd.destination_id
  WHERE rd.route_id = candidate_route_id
), final_destination AS (
  SELECT d.features, d.location
  FROM route_destinations rd
  JOIN destinations d ON d.id = rd.destination_id
  WHERE rd.route_id = candidate_route_id
  ORDER BY rd.ordinal DESC
  LIMIT 1
)
SELECT COALESCE((
  SELECT c.owner = 'peaks'
    AND (required_status IS NULL OR c.status = required_status)
    AND c.path IS NOT NULL
    AND is_valid_route_provenance(c.provenance)
    AND c.elevation_string IS NOT NULL
    AND c.elevation_string = encode_route_elevation_profile(c.path)
    AND route_elevation_profile_has_real_range(c.path)
    AND c.gain IS NOT DISTINCT FROM elevation_stats.gain
    AND c.gain_loss IS NOT DISTINCT FROM elevation_stats.loss
    AND destination_checks.summit_count >= 1
    AND destination_checks.all_summits_contacted
    AND destination_checks.ordinals_valid
    AND (
      required_destination_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM route_destinations required_rd
        JOIN destinations required_destination
          ON required_destination.id = required_rd.destination_id
        WHERE required_rd.route_id = c.id
          AND required_rd.destination_id = required_destination_id
          AND 'summit'::destination_feature = ANY(required_destination.features)
      )
    )
    AND (
      c.shape IS NULL
      OR c.shape::text NOT IN ('out_and_back', 'point_to_point')
      OR EXISTS (
        SELECT 1
        FROM final_destination
        WHERE 'summit'::destination_feature = ANY(final_destination.features)
          AND final_destination.location IS NOT NULL
          AND ST_DWithin(
            ST_EndPoint(c.path::geometry)::geography,
            final_destination.location,
            5
          )
      )
    )
    AND segment_checks.segment_count >= 1
    AND segment_checks.ordinals_valid
    AND segment_checks.rows_valid
    AND chain_checks.connected
    AND assembly_checks.route_points >= 2
    AND assembly_checks.route_points = assembly_checks.assembled_points
    AND assembly_checks.route_points = assembly_checks.matching_points
  FROM candidate c
  CROSS JOIN segment_checks
  CROSS JOIN chain_checks
  CROSS JOIN assembly_checks
  CROSS JOIN destination_checks
  CROSS JOIN LATERAL route_elevation_stats(c.path) elevation_stats
), false);
$$;

GRANT EXECUTE ON FUNCTION peaks_route_passes_publish_integrity(TEXT, TEXT, TEXT)
  TO "peaks-api";

CREATE TABLE IF NOT EXISTS route_integrity_repairs (
  route_id              TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  destination_id        TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  state                 TEXT NOT NULL DEFAULT 'queued',
  reason                TEXT NOT NULL,
  summit_gap_meters     DOUBLE PRECISION,
  replacement_route_id  TEXT REFERENCES routes(id) ON DELETE SET NULL,
  covered_at            TIMESTAMPTZ,
  evidence              JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (route_id, destination_id),
  CONSTRAINT route_integrity_repairs_state_check CHECK (
    state IN ('queued', 'covered', 'retired', 'needs_human')
  ),
  CONSTRAINT route_integrity_repairs_gap_check CHECK (
    summit_gap_meters IS NULL OR summit_gap_meters >= 0
  ),
  CONSTRAINT route_integrity_repairs_coverage_check CHECK (
    (state = 'covered'
      AND replacement_route_id IS NOT NULL
      AND covered_at IS NOT NULL)
    OR
    (state <> 'covered'
      AND replacement_route_id IS NULL
      AND covered_at IS NULL)
  ),
  CONSTRAINT route_integrity_repairs_retired_check CHECK (
    state <> 'retired' OR last_error IS NULL
  )
);

CREATE OR REPLACE FUNCTION touch_route_integrity_repair()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_route_integrity_repairs_updated
  ON route_integrity_repairs;

CREATE TRIGGER trg_route_integrity_repairs_updated
BEFORE UPDATE ON route_integrity_repairs
FOR EACH ROW EXECUTE FUNCTION touch_route_integrity_repair();

CREATE INDEX IF NOT EXISTS idx_route_integrity_repairs_claim
  ON route_integrity_repairs (state, created_at, route_id, destination_id)
  WHERE state = 'queued';

CREATE INDEX IF NOT EXISTS idx_route_integrity_repairs_destination
  ON route_integrity_repairs (destination_id, state, created_at, route_id);

CREATE OR REPLACE FUNCTION settle_route_integrity_replacement(
  old_route_id TEXT,
  current_destination_id TEXT,
  new_route_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  repair_count INTEGER;
  remaining_count INTEGER;
  current_state TEXT;
  current_replacement TEXT;
  covered_link RECORD;
  resulting_status TEXT;
BEGIN
  IF old_route_id = new_route_id THEN
    RAISE EXCEPTION 'A route cannot replace itself';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'peaks-route-replacement:' || old_route_id,
    0
  ));

  PERFORM 1 FROM routes
  WHERE id = old_route_id AND owner = 'peaks' AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Old replacement route is not active and Peaks-owned';
  END IF;

  PERFORM 1 FROM routes
  WHERE id = new_route_id AND owner = 'peaks' AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'New route is not active and Peaks-owned';
  END IF;

  PERFORM rd.route_id
  FROM route_destinations rd
  JOIN destinations d ON d.id = rd.destination_id
  WHERE rd.route_id IN (old_route_id, new_route_id)
  ORDER BY rd.route_id, rd.destination_id
  FOR UPDATE OF rd, d;
  PERFORM rs.route_id
  FROM route_segments rs
  JOIN segments s ON s.id = rs.segment_id
  WHERE rs.route_id IN (old_route_id, new_route_id)
  ORDER BY rs.route_id, rs.ordinal
  FOR UPDATE OF rs, s;

  IF NOT peaks_route_passes_publish_integrity(
    new_route_id, current_destination_id, 'active'
  ) THEN
    RAISE EXCEPTION 'New route does not pass publish integrity';
  END IF;

  PERFORM 1
  FROM route_integrity_repairs
  WHERE route_id = old_route_id
  ORDER BY destination_id
  FOR UPDATE;
  SELECT count(*)::int INTO repair_count
  FROM route_integrity_repairs
  WHERE route_id = old_route_id;

  IF repair_count = 0 AND peaks_route_passes_publish_integrity(
    old_route_id, NULL, 'active'
  ) THEN
    UPDATE routes SET status = 'superseded'
    WHERE id = old_route_id AND owner = 'peaks' AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Old replacement route changed before retirement';
    END IF;
    RETURN 'superseded';
  END IF;

  IF NOT peaks_route_passes_publish_integrity(
    old_route_id, NULL, 'active'
  ) THEN
    INSERT INTO route_integrity_repairs (
      route_id, destination_id, state, reason, summit_gap_meters, evidence
    )
    SELECT old_route.id,
           summit.id,
           'queued',
           CASE
             WHEN old_route.path IS NULL THEN 'route_path_missing'
             WHEN summit.location IS NULL THEN 'destination_location_missing'
             WHEN ST_DWithin(old_route.path, summit.location, 5)
               THEN 'shared_route_integrity_failure'
             ELSE 'summit_path_gap'
           END,
           CASE WHEN old_route.path IS NOT NULL AND summit.location IS NOT NULL
             THEN ST_Distance(old_route.path, summit.location) END,
           jsonb_build_object('derived_during_activation', true)
    FROM routes old_route
    JOIN route_destinations old_rd ON old_rd.route_id = old_route.id
    JOIN destinations summit ON summit.id = old_rd.destination_id
    WHERE old_route.id = old_route_id
      AND 'summit'::destination_feature = ANY(summit.features)
    ON CONFLICT (route_id, destination_id) DO NOTHING;

    PERFORM 1
    FROM route_integrity_repairs
    WHERE route_id = old_route_id
    ORDER BY destination_id
    FOR UPDATE;
    SELECT count(*)::int INTO repair_count
    FROM route_integrity_repairs
    WHERE route_id = old_route_id;
    IF repair_count = 0 THEN
      RAISE EXCEPTION 'Bad replacement route has no linked summit repair rows';
    END IF;
  END IF;

  SELECT state, replacement_route_id
  INTO current_state, current_replacement
  FROM route_integrity_repairs
  WHERE route_id = old_route_id
    AND destination_id = current_destination_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repair is not bound to the current destination link';
  END IF;
  IF current_state = 'covered' AND current_replacement <> new_route_id THEN
    RAISE EXCEPTION 'Repair link is already covered by another route';
  END IF;

  UPDATE route_integrity_repairs
  SET state = 'covered', replacement_route_id = new_route_id,
      covered_at = now(),
      evidence = evidence || jsonb_build_object(
        'validation', 'activation_publish_integrity_passed',
        'replacement_route_id', new_route_id
      ),
      last_error = NULL
  WHERE route_id = old_route_id
    AND destination_id = current_destination_id;

  PERFORM replacement.id
  FROM routes replacement
  JOIN (
    SELECT DISTINCT replacement_route_id
    FROM route_integrity_repairs
    WHERE route_id = old_route_id AND state = 'covered'
  ) covered ON covered.replacement_route_id = replacement.id
  ORDER BY replacement.id
  FOR UPDATE OF replacement;

  PERFORM rs.route_id
  FROM route_segments rs
  JOIN segments s ON s.id = rs.segment_id
  WHERE rs.route_id IN (
    SELECT replacement_route_id
    FROM route_integrity_repairs
    WHERE route_id = old_route_id AND state = 'covered'
  )
  ORDER BY rs.route_id, rs.ordinal
  FOR UPDATE OF rs, s;

  FOR covered_link IN
    SELECT destination_id, replacement_route_id
    FROM route_integrity_repairs
    WHERE route_id = old_route_id AND state = 'covered'
    ORDER BY destination_id
  LOOP
    IF NOT peaks_route_passes_publish_integrity(
      covered_link.replacement_route_id,
      covered_link.destination_id,
      'active'
    ) THEN
      UPDATE route_integrity_repairs
      SET state = 'queued', replacement_route_id = NULL, covered_at = NULL,
          evidence = evidence || jsonb_build_object(
            'requeued_invalid_coverage', now()
          ),
          last_error = 'Covered replacement no longer passes publish integrity'
      WHERE route_id = old_route_id
        AND destination_id = covered_link.destination_id;
    END IF;
  END LOOP;

  SELECT count(*)::int INTO remaining_count
  FROM route_integrity_repairs
  WHERE route_id = old_route_id AND state <> 'covered';

  IF remaining_count = 0 THEN
    UPDATE routes SET status = 'superseded'
    WHERE id = old_route_id AND owner = 'peaks' AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Old replacement route changed before final retirement';
    END IF;
    resulting_status := 'superseded';
  ELSE
    resulting_status := 'active';
  END IF;
  RETURN resulting_status;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON route_integrity_repairs TO "peaks-api";

GRANT EXECUTE ON FUNCTION settle_route_integrity_replacement(TEXT, TEXT, TEXT)
  TO "peaks-api";

COMMENT ON TABLE route_integrity_repairs IS
  'Active bad routes seed every linked summit. Inactive routes retain covered history; other rows retire.';

COMMIT;
