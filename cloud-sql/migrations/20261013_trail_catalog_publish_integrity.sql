-- Kind-aware contact and source coverage for named catalog routes.
-- Cost: existing Cloud SQL functions only; expected fixed increase ~$0/month.
-- No row rewrite, activation, rights-validator, review, or cover-gate change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- A segment keeps its own source URL and retrieval time. Rights and elevation
-- claims must agree, while OSM IDs describe only that segment's actual span.
-- Independent source-geometry review binds those spans to saved snapshot hashes;
-- this predicate does not pretend an ID alone proves where its geometry lies.
CREATE OR REPLACE FUNCTION route_segment_provenance_compatible(
  segment_provenance JSONB, route_provenance JSONB
)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN COALESCE(is_valid_route_provenance(segment_provenance), false)
                   AND COALESCE(is_valid_route_provenance(route_provenance), false)
    THEN segment_provenance->>'source_kind' = route_provenance->>'source_kind'
      AND segment_provenance->'contains_osm_geometry' = route_provenance->'contains_osm_geometry'
      AND segment_provenance->>'license_name' = route_provenance->>'license_name'
      AND segment_provenance->>'license_url' = route_provenance->>'license_url'
      AND segment_provenance->>'attribution' = route_provenance->>'attribution'
      AND segment_provenance->>'elevation_source' IS NOT DISTINCT FROM route_provenance->>'elevation_source'
      AND segment_provenance->>'elevation_profile' IS NOT DISTINCT FROM route_provenance->>'elevation_profile'
      AND CASE WHEN (route_provenance->>'contains_osm_geometry')::boolean
        THEN jsonb_array_length(segment_provenance->'osm_way_ids') > 0
          AND segment_provenance->'osm_way_ids' <@ route_provenance->'osm_way_ids'
        ELSE segment_provenance->>'source_url' = route_provenance->>'source_url' END
    ELSE false END;
$$;

CREATE OR REPLACE FUNCTION route_segments_cover_provenance(candidate_route_id TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE((SELECT CASE WHEN is_valid_route_provenance(r.provenance) THEN
    EXISTS (SELECT 1 FROM route_segments rs WHERE rs.route_id=r.id)
    AND NOT EXISTS (
      SELECT 1 FROM route_segments rs LEFT JOIN segments s ON s.id=rs.segment_id
      WHERE rs.route_id=r.id AND NOT route_segment_provenance_compatible(s.provenance,r.provenance)
    )
    AND r.provenance->'osm_way_ids' <@ COALESCE((
      SELECT jsonb_agg(DISTINCT way.value)
      FROM route_segments rs JOIN segments s ON s.id=rs.segment_id
      CROSS JOIN LATERAL jsonb_array_elements(CASE
        WHEN jsonb_typeof(s.provenance->'osm_way_ids')='array' THEN s.provenance->'osm_way_ids'
        ELSE '[]'::jsonb END) way(value)
      WHERE rs.route_id=r.id
    ), '[]'::jsonb)
    ELSE false END FROM routes r WHERE r.id=candidate_route_id), false);
$$;

-- Boundaries take precedence over a place's representative location. Pieces
-- use the same exact polygon at a bounded vertex count, including large lakes.
CREATE OR REPLACE FUNCTION peaks_route_objective_contact(
  route_path geography, objective_id TEXT, tolerance_m DOUBLE PRECISION
)
RETURNS BOOLEAN LANGUAGE SQL STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE((SELECT CASE WHEN d.boundary IS NOT NULL THEN EXISTS (
      SELECT 1 FROM destination_boundary_parts part WHERE part.destination_id=d.id
        AND ST_DWithin(route_path,part.boundary_part,tolerance_m)
    ) ELSE d.location IS NOT NULL AND ST_DWithin(route_path,d.location,tolerance_m) END
    FROM destinations d WHERE d.id=objective_id), false);
$$;

CREATE OR REPLACE FUNCTION peaks_route_kind_passes_contact(
  candidate_route_id TEXT, required_destination_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE SQL STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
WITH candidate AS (
  SELECT * FROM routes WHERE id=candidate_route_id
), linked AS (
  SELECT rd.ordinal,d.id,d.name,d.features,d.location
  FROM route_destinations rd LEFT JOIN destinations d ON d.id=rd.destination_id
  WHERE rd.route_id=candidate_route_id
), checks AS (
  SELECT count(*)>0 AND count(*)=count(DISTINCT ordinal)
      AND min(ordinal)=0 AND max(ordinal)=count(*)-1 AND bool_and(id IS NOT NULL) AS ordinals_valid,
    count(*) FILTER (WHERE 'summit'::destination_feature=ANY(features)) AS summit_count,
    COALESCE(bool_and(CASE WHEN 'summit'::destination_feature=ANY(features)
      THEN location IS NOT NULL AND ST_DWithin((SELECT path FROM candidate),location,5)
      ELSE true END),false) AS all_summits_contacted
  FROM linked
), first_place AS (SELECT * FROM linked ORDER BY ordinal LIMIT 1),
last_place AS (SELECT * FROM linked ORDER BY ordinal DESC LIMIT 1),
objective AS (SELECT linked.* FROM linked JOIN candidate ON linked.id=candidate.objective_destination_id)
SELECT COALESCE((SELECT checks.ordinals_valid AND checks.all_summits_contacted
  AND 'trailhead'::destination_feature=ANY(first_place.features)
  AND first_place.location IS NOT NULL
  AND ST_DWithin(ST_StartPoint(c.path::geometry)::geography,first_place.location,125)
  AND (c.kind IS NULL OR c.trailhead_destination_id=first_place.id)
  AND (required_destination_id IS NULL OR EXISTS (
    SELECT 1 FROM linked required_place WHERE required_place.id=required_destination_id
      AND CASE WHEN COALESCE(c.kind,'summit')='summit'
        THEN 'summit'::destination_feature=ANY(required_place.features)
        ELSE peaks_route_objective_contact(c.path,required_place.id,
          CASE WHEN 'summit'::destination_feature=ANY(required_place.features) THEN 5
               WHEN 'trailhead'::destination_feature=ANY(required_place.features) THEN 125 ELSE 250 END) END
  ))
  AND CASE COALESCE(c.kind,'summit')
    WHEN 'summit' THEN checks.summit_count>=1
      AND (c.kind IS NULL OR EXISTS (SELECT 1 FROM objective WHERE 'summit'::destination_feature=ANY(features)))
      AND (c.shape IS NULL OR c.shape::text NOT IN ('out_and_back','point_to_point') OR (
        'summit'::destination_feature=ANY(last_place.features) AND last_place.location IS NOT NULL
        AND ST_DWithin(ST_EndPoint(c.path::geometry)::geography,last_place.location,5)))
    WHEN 'destination' THEN c.shape::text IN ('out_and_back','point_to_point')
      AND c.objective_destination_id=last_place.id
      AND NULLIF(btrim(last_place.name),'') IS NOT NULL
      AND cardinality(last_place.features)>0
      AND NOT ('summit'::destination_feature=ANY(last_place.features))
      AND NOT ('trailhead'::destination_feature=ANY(last_place.features))
      AND peaks_route_objective_contact(ST_EndPoint(c.path::geometry)::geography,last_place.id,250)
    WHEN 'traverse' THEN c.shape::text='point_to_point'
      AND last_place.id<>first_place.id AND 'trailhead'::destination_feature=ANY(last_place.features)
      AND last_place.location IS NOT NULL
      AND ST_DWithin(ST_EndPoint(c.path::geometry)::geography,last_place.location,125)
      AND EXISTS (SELECT 1 FROM objective WHERE
        (id=last_place.id OR (NULLIF(btrim(name),'') IS NOT NULL AND cardinality(features)>0
          AND NOT ('trailhead'::destination_feature=ANY(features))))
        AND peaks_route_objective_contact(c.path,id,
          CASE WHEN 'summit'::destination_feature=ANY(features) THEN 5
               WHEN 'trailhead'::destination_feature=ANY(features) THEN 125 ELSE 250 END))
    WHEN 'loop' THEN c.shape::text IN ('loop','lollipop')
      AND ST_DWithin(ST_StartPoint(c.path::geometry)::geography,ST_EndPoint(c.path::geometry)::geography,0.1)
      AND abs(ST_Z(ST_StartPoint(c.path::geometry))-ST_Z(ST_EndPoint(c.path::geometry)))<=0.01
      AND (c.objective_destination_id IS NULL OR EXISTS (SELECT 1 FROM objective
        WHERE NULLIF(btrim(name),'') IS NOT NULL AND peaks_route_objective_contact(c.path,id,
          CASE WHEN 'summit'::destination_feature=ANY(features) THEN 5
               WHEN 'trailhead'::destination_feature=ANY(features) THEN 125 ELSE 250 END)))
    ELSE false END
  FROM candidate c CROSS JOIN checks CROSS JOIN first_place CROSS JOIN last_place),false);
$$;

GRANT SELECT ON destination_boundary_parts TO "peaks-route-factory", "peaks-route-reviewer";

CREATE OR REPLACE FUNCTION public.peaks_route_passes_publish_integrity(
  candidate_route_id TEXT,
  required_destination_id TEXT DEFAULT NULL,
  required_status TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
WITH candidate AS (
  SELECT r.* FROM routes r WHERE r.id = candidate_route_id
), ordered_segments AS (
  SELECT rs.ordinal, rs.direction, s.path,
         s.gain AS stored_gain,
         s.gain_loss AS stored_loss,
         segment_elevation_stats.gain AS computed_gain,
         segment_elevation_stats.loss AS computed_loss,
         s.provenance,
         CASE rs.direction WHEN 'reverse' THEN ST_Reverse(s.path::geometry)
           ELSE s.path::geometry END AS directed_path
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
           AND ST_Length(path) > 0
           AND encode_route_elevation_profile(path) IS NOT NULL
           AND stored_gain IS NOT DISTINCT FROM computed_gain
           AND stored_loss IS NOT DISTINCT FROM computed_loss
           AND is_valid_route_provenance(provenance)
           AND route_segment_provenance_compatible(provenance, (SELECT provenance FROM candidate))
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
             AND abs(ST_Z(ST_EndPoint(prior_path))
               - ST_Z(ST_StartPoint(directed_path))) <= 0.01
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
           ST_MakeLine(geom ORDER BY ordinal, segment_vertex), 4326
         ) AS path
  FROM segment_points
), route_points AS (
  SELECT (dumped).path[1]::int AS vertex, (dumped).geom AS geom
  FROM candidate
  CROSS JOIN LATERAL ST_DumpPoints(candidate.path::geometry) AS dumped
), assembled_points AS (
  SELECT (dumped).path[1]::int AS vertex, (dumped).geom AS geom
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
    AND peaks_route_kind_passes_contact(c.id, required_destination_id)
    AND route_segments_cover_provenance(c.id)
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
  CROSS JOIN LATERAL route_elevation_stats(c.path) elevation_stats
), false);
$$;

GRANT EXECUTE ON FUNCTION peaks_route_passes_publish_integrity(TEXT, TEXT, TEXT)
  TO "peaks-route-factory", "peaks-route-reviewer";

COMMIT;
