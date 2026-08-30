-- Separate factory and reviewer authority for the standard-route queue.
--
-- Apply as postgres before starting the workers. Create distinct LOGIN roles
-- outside this migration, grant each login exactly one marker role below, and
-- keep their passwords in separate worker environments.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peaks-route-factory') THEN
    CREATE ROLE "peaks-route-factory" NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peaks-route-reviewer') THEN
    CREATE ROLE "peaks-route-reviewer" NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public
  TO "peaks-route-factory", "peaks-route-reviewer";

GRANT SELECT ON
  destinations,
  routes,
  route_destinations,
  route_segments,
  segments,
  standard_route_backfill_jobs
  TO "peaks-route-factory", "peaks-route-reviewer";

GRANT SELECT ON
  lists,
  list_destinations,
  session_destinations,
  route_areas,
  plan_routes,
  session_routes,
  trip_report_routes,
  route_elevation_backfill_jobs,
  route_integrity_repairs
  TO "peaks-route-factory";

-- This migration can be reapplied after an earlier worker-role draft, so drop
-- every broad grant before adding only the writes used by import and publish.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  destinations,
  routes,
  route_destinations,
  route_segments,
  segments,
  route_areas
  FROM "peaks-route-factory", "peaks-route-reviewer";

GRANT INSERT, DELETE ON routes TO "peaks-route-factory";
GRANT INSERT ON route_destinations TO "peaks-route-factory";
GRANT INSERT, DELETE ON route_segments TO "peaks-route-factory";
GRANT INSERT, DELETE ON segments TO "peaks-route-factory";

-- PostgreSQL requires one UPDATE column privilege for SELECT ... FOR UPDATE.
-- The triggers below reject direct writes through each lock-only grant.
GRANT UPDATE (status) ON routes
  TO "peaks-route-factory", "peaks-route-reviewer";
GRANT UPDATE (ordinal) ON route_destinations
  TO "peaks-route-factory", "peaks-route-reviewer";
GRANT UPDATE (ordinal) ON route_segments TO "peaks-route-factory";
GRANT UPDATE (updated_at) ON segments TO "peaks-route-factory";
REVOKE UPDATE ON destinations
  FROM "peaks-route-factory", "peaks-route-reviewer";
GRANT UPDATE (id) ON destinations
  TO "peaks-route-factory", "peaks-route-reviewer";

-- A prior draft of this migration may already have installed the queue guard.
-- Remove it inside this transaction before the operator-owned legacy backfill;
-- the final definition below restores it before commit.
DROP TRIGGER IF EXISTS trg_guard_standard_route_worker_role
  ON standard_route_backfill_jobs;

-- Terminal jobs predate the durable country binding. Fill only absent values
-- from a current, valid destination country; invalid legacy data stays visible.
UPDATE public.standard_route_backfill_jobs job
SET candidate = jsonb_set(
      job.candidate,
      '{official_source_country_code}',
      to_jsonb(upper(btrim(destination.country_code))),
      true
    ),
    updated_at = clock_timestamp()
FROM public.destinations destination
WHERE destination.id = job.destination_id
  AND job.state IN ('published', 'verified')
  AND jsonb_typeof(job.candidate) = 'object'
  AND NULLIF(btrim(job.candidate ->> 'official_source_country_code'), '') IS NULL
  AND upper(btrim(destination.country_code)) ~ '^[A-Z]{2}$';

-- A required standard-route destination also requires a real trailhead at the
-- route start. Keeping this in the shared predicate makes later trailhead drift
-- invalidate both goal stats and verification, not only the publish operation.
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
), destination_checks AS (
  SELECT count(*) FILTER (
           WHERE 'summit'::destination_feature = ANY(d.features)
         )::int AS summit_count,
         COALESCE(bool_and(
           CASE WHEN 'summit'::destination_feature = ANY(d.features)
             THEN d.location IS NOT NULL
               AND (SELECT path FROM candidate) IS NOT NULL
               AND ST_DWithin((SELECT path FROM candidate), d.location, 5)
             ELSE true END
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
    AND EXISTS (
      SELECT 1
      FROM route_destinations trailhead_rd
      JOIN destinations trailhead
        ON trailhead.id = trailhead_rd.destination_id
      WHERE trailhead_rd.route_id = c.id
        AND trailhead_rd.ordinal = 0
        AND 'trailhead'::destination_feature = ANY(trailhead.features)
        AND trailhead.location IS NOT NULL
        AND ST_DWithin(
          ST_StartPoint(c.path::geometry)::geography,
          trailhead.location,
          125
        )
    )
    AND (
      c.shape IS NULL OR c.shape::text NOT IN ('out_and_back', 'point_to_point')
      OR EXISTS (
        SELECT 1 FROM final_destination
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
  TO "peaks-route-factory", "peaks-route-reviewer";

GRANT UPDATE ON standard_route_backfill_jobs
  TO "peaks-route-factory", "peaks-route-reviewer";

REVOKE INSERT, DELETE, TRUNCATE ON standard_route_backfill_jobs
  FROM "peaks-route-factory", "peaks-route-reviewer";
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON route_integrity_repairs
  FROM "peaks-route-factory", "peaks-route-reviewer";
REVOKE INSERT, UPDATE, DELETE
  ON standard_route_backfill_jobs FROM "peaks-api";

-- The generic settlement function predates worker roles. Keep it available to
-- the web role, but do not let PUBLIC or a factory login call it with arbitrary
-- route IDs. The factory wrapper below binds all three IDs to one approved,
-- live queue lease before running the existing settlement transaction.
REVOKE ALL ON FUNCTION settle_route_integrity_replacement(TEXT, TEXT, TEXT)
  FROM PUBLIC, "peaks-route-factory", "peaks-route-reviewer";
ALTER FUNCTION public.settle_route_integrity_replacement(TEXT, TEXT, TEXT)
  SET search_path = pg_catalog, public, pg_temp;
GRANT EXECUTE ON FUNCTION settle_route_integrity_replacement(TEXT, TEXT, TEXT)
  TO "peaks-api";

CREATE OR REPLACE FUNCTION settle_standard_route_factory_replacement(
  old_route_id TEXT,
  current_destination_id TEXT,
  new_route_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  is_factory BOOLEAN := pg_has_role(
    session_user,
    'peaks-route-factory',
    'member'
  );
  is_reviewer BOOLEAN := pg_has_role(
    session_user,
    'peaks-route-reviewer',
    'member'
  );
  old_route_summit_count INTEGER;
BEGIN
  IF NOT is_factory OR is_reviewer THEN
    RAISE EXCEPTION 'factory replacement settlement requires one factory database role';
  END IF;

  PERFORM 1
  FROM public.standard_route_backfill_jobs job
  JOIN public.routes old_route
    ON old_route.id = job.replacement_route_id
  JOIN public.routes new_route
    ON new_route.id = job.published_route_id
  WHERE job.destination_id = current_destination_id
    AND job.state = 'approved'
    AND job.replacement_route_id = old_route_id
    AND job.published_route_id = new_route_id
    AND job.lease_owner IS NOT NULL
    AND job.lease_token IS NOT NULL
    AND job.lease_expires_at >= clock_timestamp()
    AND old_route.owner = 'peaks'
    AND old_route.status = 'active'
    AND new_route.owner = 'peaks'
    AND new_route.status = 'active'
  FOR UPDATE OF job, old_route, new_route;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'factory replacement settlement is not bound to an approved lease';
  END IF;

  PERFORM old_link.destination_id
  FROM public.route_destinations old_link
  JOIN public.destinations old_destination
    ON old_destination.id = old_link.destination_id
  WHERE old_link.route_id = old_route_id
  ORDER BY old_link.ordinal, old_link.destination_id
  FOR UPDATE OF old_link, old_destination;

  PERFORM old_segment_link.segment_id
  FROM public.route_segments old_segment_link
  JOIN public.segments old_segment
    ON old_segment.id = old_segment_link.segment_id
  WHERE old_segment_link.route_id = old_route_id
  ORDER BY old_segment_link.ordinal, old_segment_link.segment_id
  FOR UPDATE OF old_segment_link, old_segment;

  SELECT count(DISTINCT old_link.destination_id)::integer
  INTO old_route_summit_count
  FROM public.route_destinations old_link
  JOIN public.destinations old_destination
    ON old_destination.id = old_link.destination_id
  WHERE old_link.route_id = old_route_id
    AND 'summit'::public.destination_feature = ANY(old_destination.features);
  IF old_route_summit_count > 1
     AND public.peaks_route_passes_publish_integrity(
       old_route_id,
       NULL,
       'active'
     ) THEN
    RAISE EXCEPTION
      'factory replacement cannot retire a valid route shared by multiple summits';
  END IF;

  RETURN public.settle_route_integrity_replacement(
    old_route_id,
    current_destination_id,
    new_route_id
  );
END
$$;

REVOKE ALL ON FUNCTION settle_standard_route_factory_replacement(TEXT, TEXT, TEXT)
  FROM PUBLIC, "peaks-route-reviewer", "peaks-api";
GRANT EXECUTE ON FUNCTION settle_standard_route_factory_replacement(TEXT, TEXT, TEXT)
  TO "peaks-route-factory";

-- The factory cannot publish with a raw UPDATE. This function binds the status
-- change and any replacement settlement to one reviewed route and live lease.
CREATE OR REPLACE FUNCTION activate_standard_route_factory(
  current_destination_id TEXT,
  new_route_id TEXT,
  current_lease_token TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  is_factory BOOLEAN := pg_has_role(
    session_user,
    'peaks-route-factory',
    'member'
  );
  is_reviewer BOOLEAN := pg_has_role(
    session_user,
    'peaks-route-reviewer',
    'member'
  );
  activation_job RECORD;
  candidate_route public.routes%ROWTYPE;
  actual_destinations JSONB;
  activation_destination_country_code TEXT;
  route_binding_matches BOOLEAN;
  conflicting_route_id TEXT;
  resulting_status TEXT := 'active';
BEGIN
  IF NOT is_factory OR is_reviewer THEN
    RAISE EXCEPTION 'factory activation requires one factory database role';
  END IF;
  IF current_lease_token IS NULL OR btrim(current_lease_token) = '' THEN
    RAISE EXCEPTION 'factory activation requires a lease token';
  END IF;

  SELECT job.* INTO STRICT activation_job
  FROM public.standard_route_backfill_jobs job
  WHERE job.destination_id = current_destination_id
    AND job.state = 'approved'
    AND job.published_route_id = new_route_id
    AND job.lease_owner IS NOT NULL
    AND job.lease_token = current_lease_token
    AND job.lease_expires_at >= clock_timestamp()
  FOR UPDATE OF job;
  IF EXISTS (
    SELECT 1
    FROM public.standard_route_backfill_jobs other
    WHERE other.published_route_id = new_route_id
      AND other.destination_id <> current_destination_id
  ) THEN
    RAISE EXCEPTION 'factory activation route has another queue binding';
  END IF;
  IF activation_job.replacement_route_id = new_route_id THEN
    RAISE EXCEPTION 'factory activation route cannot replace itself';
  END IF;

  SELECT route.* INTO STRICT candidate_route
  FROM public.routes route
  WHERE route.id = new_route_id
    AND route.owner = 'peaks'
    AND route.status = 'pending'
  FOR UPDATE OF route;

  route_binding_matches :=
    candidate_route.name IS NOT DISTINCT FROM
      activation_job.review #>> '{approved_route_binding,routeName}'
    AND candidate_route.shape::text IS NOT DISTINCT FROM
      activation_job.review #>> '{approved_route_binding,routeShape}'
    AND candidate_route.external_links IS NOT DISTINCT FROM
      activation_job.review #> '{approved_route_binding,identitySources}'
    AND jsonb_build_object(
      'source_kind', candidate_route.provenance->'source_kind',
      'source_url', candidate_route.provenance->'source_url',
      'license_name', candidate_route.provenance->'license_name',
      'license_url', candidate_route.provenance->'license_url',
      'attribution', candidate_route.provenance->'attribution',
      'retrieved_at', candidate_route.provenance->'retrieved_at',
      'osm_way_ids', candidate_route.provenance->'osm_way_ids',
      'osm_way_urls', candidate_route.provenance->'osm_way_urls',
      'contains_osm_geometry',
        candidate_route.provenance->'contains_osm_geometry'
    ) IS NOT DISTINCT FROM
      activation_job.review #> '{approved_route_binding,geometrySource}'
    AND encode(
      ST_AsEWKB(ST_Force2D(candidate_route.path::geometry)),
      'hex'
    ) IS NOT DISTINCT FROM encode(
      ST_AsEWKB(
        ST_Force2D(
          ST_SetSRID(
            ST_GeomFromGeoJSON(
              (activation_job.review #> '{approved_route_binding,geometry}')::text
            ),
            4326
          )
        )
      ),
      'hex'
    );
  IF route_binding_matches IS NOT TRUE THEN
    RAISE EXCEPTION 'factory activation route no longer matches reviewer approval';
  END IF;

  PERFORM linked.destination_id
  FROM public.route_destinations linked
  JOIN public.destinations destination
    ON destination.id = linked.destination_id
  WHERE linked.route_id = new_route_id
  ORDER BY linked.ordinal, linked.destination_id
  FOR UPDATE OF linked, destination;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'destinationId', linked.destination_id,
        'ordinal', linked.ordinal
      ) ORDER BY linked.ordinal, linked.destination_id
    ),
    '[]'::jsonb
  ) INTO actual_destinations
  FROM public.route_destinations linked
  WHERE linked.route_id = new_route_id;
  IF actual_destinations IS DISTINCT FROM
     activation_job.review #> '{approved_route_binding,destinations}' THEN
    RAISE EXCEPTION 'factory activation destinations no longer match reviewer approval';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.route_destinations linked
    WHERE linked.route_id = new_route_id
      AND linked.destination_id = current_destination_id
  ) THEN
    RAISE EXCEPTION 'factory activation route is not linked to its queue destination';
  END IF;

  SELECT upper(btrim(destination.country_code))
  INTO activation_destination_country_code
  FROM public.destinations destination
  WHERE destination.id = current_destination_id
    AND upper(btrim(destination.country_code)) ~ '^[A-Z]{2}$'
  FOR UPDATE OF destination;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'factory activation destination has no valid country code';
  END IF;
  IF activation_job.candidate ->> 'official_source_country_code'
       IS DISTINCT FROM activation_destination_country_code
     OR activation_job.review #>>
          '{approved_route_binding,officialSourceCountryCode}'
       IS DISTINCT FROM activation_destination_country_code THEN
    RAISE EXCEPTION 'factory activation country no longer matches reviewer approval';
  END IF;

  PERFORM linked.segment_id
  FROM public.route_segments linked
  JOIN public.segments segment ON segment.id = linked.segment_id
  WHERE linked.route_id = new_route_id
  ORDER BY linked.ordinal, linked.segment_id
  FOR UPDATE OF linked, segment;

  IF activation_job.replacement_route_id IS NOT NULL THEN
    PERFORM old_route.id
    FROM public.routes old_route
    JOIN public.route_destinations old_link
      ON old_link.route_id = old_route.id
    WHERE old_route.id = activation_job.replacement_route_id
      AND old_route.owner = 'peaks'
      AND old_route.status = 'active'
      AND old_link.destination_id = current_destination_id
    FOR UPDATE OF old_route, old_link;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'factory replacement changed before activation';
    END IF;
  END IF;

  SELECT live_route.id INTO conflicting_route_id
  FROM public.route_destinations candidate_link
  JOIN public.destinations destination
    ON destination.id = candidate_link.destination_id
  JOIN public.route_destinations live_link
    ON live_link.destination_id = destination.id
  JOIN public.routes live_route
    ON live_route.id = live_link.route_id
  WHERE candidate_link.route_id = new_route_id
    AND 'summit'::public.destination_feature = ANY(destination.features)
    AND live_route.id <> new_route_id
    AND (
      activation_job.replacement_route_id IS NULL
      OR live_route.id <> activation_job.replacement_route_id
    )
    AND live_route.owner = 'peaks'
    AND live_route.status IN ('active', 'pending')
    AND lower(live_route.name) = lower(candidate_route.name)
  ORDER BY live_route.id
  LIMIT 1
  FOR UPDATE OF live_route;
  IF FOUND THEN
    RAISE EXCEPTION 'factory activation conflicts with live route %',
      conflicting_route_id;
  END IF;

  IF NOT public.peaks_route_passes_publish_integrity(
    new_route_id,
    current_destination_id,
    'pending'
  ) THEN
    RAISE EXCEPTION 'factory activation route fails publish integrity';
  END IF;

  UPDATE public.routes
  SET status = 'active'
  WHERE id = new_route_id
    AND owner = 'peaks'
    AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'factory activation route changed before publish';
  END IF;

  IF activation_job.replacement_route_id IS NOT NULL THEN
    resulting_status := public.settle_standard_route_factory_replacement(
      activation_job.replacement_route_id,
      current_destination_id,
      new_route_id
    );
  END IF;
  RETURN resulting_status;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'factory activation is not bound to an approved live lease';
  WHEN TOO_MANY_ROWS THEN
    RAISE EXCEPTION 'factory activation binding is not unique';
END
$$;

REVOKE ALL ON FUNCTION activate_standard_route_factory(TEXT, TEXT, TEXT)
  FROM PUBLIC, "peaks-route-reviewer", "peaks-api";
GRANT EXECUTE ON FUNCTION activate_standard_route_factory(TEXT, TEXT, TEXT)
  TO "peaks-route-factory";

-- Factory table grants cover candidate import and route assembly. Status changes
-- remain valid only while one of the two bound definer functions owns the call.
CREATE OR REPLACE FUNCTION guard_standard_route_factory_route()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  is_factory BOOLEAN := pg_has_role(
    session_user,
    'peaks-route-factory',
    'member'
  );
  is_reviewer BOOLEAN := pg_has_role(
    session_user,
    'peaks-route-reviewer',
    'member'
  );
  activation_owner NAME;
  settlement_owner NAME;
  deletion_job_destination TEXT;
BEGIN
  IF NOT is_factory AND NOT is_reviewer THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF is_factory AND is_reviewer THEN
    RAISE EXCEPTION 'route worker login belongs to conflicting database roles';
  END IF;
  IF is_reviewer THEN
    RAISE EXCEPTION 'reviewer database role cannot write route records';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.owner <> 'peaks' OR NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'factory database role may insert only pending Peaks routes';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM standard_route_backfill_jobs job
      WHERE job.state = 'candidate_ready'
        AND job.lease_owner IS NOT NULL
        AND job.lease_token IS NOT NULL
        AND job.lease_expires_at >= clock_timestamp()
    ) THEN
      RAISE EXCEPTION 'factory route insert requires a live candidate lease';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.owner <> 'peaks' OR OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'factory database role cannot delete a live route';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM standard_route_backfill_jobs job
      WHERE job.published_route_id = OLD.id
        AND job.state IN ('pending_review', 'approved', 'published', 'verified')
    ) THEN
      RAISE EXCEPTION 'factory database role cannot delete a reviewed route';
    END IF;

    SELECT job.destination_id INTO deletion_job_destination
    FROM standard_route_backfill_jobs job
    JOIN route_destinations linked
      ON linked.route_id = OLD.id
     AND linked.destination_id = job.destination_id
    WHERE job.published_route_id = OLD.id
      AND job.state = 'candidate_ready'
      AND job.lease_owner IS NOT NULL
      AND job.lease_token IS NOT NULL
      AND job.lease_expires_at >= clock_timestamp()
    ORDER BY job.destination_id
    LIMIT 1
    FOR SHARE OF job;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'factory route delete is not bound to its candidate lease';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM standard_route_backfill_jobs other
      WHERE other.published_route_id = OLD.id
        AND other.state <> 'verified'
        AND other.destination_id <> deletion_job_destination
    ) THEN
      RAISE EXCEPTION 'factory route delete has another live queue binding';
    END IF;
    RETURN OLD;
  END IF;

  IF (to_jsonb(NEW) - ARRAY['status', 'updated_at'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'updated_at']) THEN
    RAISE EXCEPTION 'factory database role may change only route status';
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'active' THEN
    SELECT pg_get_userbyid(procedure.proowner) INTO activation_owner
    FROM pg_proc procedure
    WHERE procedure.oid =
      'public.activate_standard_route_factory(text,text,text)'::regprocedure;
    IF current_user <> activation_owner THEN
      RAISE EXCEPTION 'factory route activation requires the bound activation function';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'active' AND NEW.status = 'superseded' THEN
    SELECT pg_get_userbyid(procedure.proowner) INTO settlement_owner
    FROM pg_proc procedure
    WHERE procedure.oid =
      'public.settle_standard_route_factory_replacement(text,text,text)'::regprocedure;
    IF current_user <> settlement_owner THEN
      RAISE EXCEPTION 'factory route retirement requires the bound settlement function';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'factory database role cannot make this route transition';
END
$$;

DROP TRIGGER IF EXISTS trg_guard_standard_route_factory_route ON routes;
CREATE TRIGGER trg_guard_standard_route_factory_route
BEFORE INSERT OR UPDATE OR DELETE ON routes
FOR EACH ROW
EXECUTE FUNCTION guard_standard_route_factory_route();

-- Candidate rows are written before the queue handoff in the importer. Check
-- the finished transaction so a crash or raw SQL cannot leave an unbound row.
CREATE OR REPLACE FUNCTION check_standard_route_factory_route_final()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  current_route RECORD;
  binding_count INTEGER;
  reference_count INTEGER;
BEGIN
  IF NOT pg_has_role(session_user, 'peaks-route-factory', 'member') THEN
    RETURN NULL;
  END IF;
  IF pg_has_role(session_user, 'peaks-route-reviewer', 'member') THEN
    RAISE EXCEPTION 'route worker login belongs to conflicting database roles';
  END IF;

  SELECT route.owner, route.status INTO current_route
  FROM routes route
  WHERE route.id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::int INTO binding_count
  FROM standard_route_backfill_jobs job
  WHERE job.published_route_id = NEW.id
    AND job.state = 'pending_review'
    AND job.lease_owner IS NULL
    AND job.lease_token IS NULL
    AND job.lease_expires_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM route_destinations linked
      WHERE linked.route_id = NEW.id
        AND linked.destination_id = job.destination_id
    );
  SELECT count(*)::int INTO reference_count
  FROM standard_route_backfill_jobs job
  WHERE job.published_route_id = NEW.id;
  IF current_route.owner <> 'peaks'
     OR current_route.status <> 'pending'
     OR binding_count <> 1
     OR reference_count <> 1 THEN
    RAISE EXCEPTION 'factory route insert must finish as one unleased pending_review binding';
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_check_standard_route_factory_route_final ON routes;
CREATE CONSTRAINT TRIGGER trg_check_standard_route_factory_route_final
AFTER INSERT ON routes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_standard_route_factory_route_final();

-- Destination links are import-only. Segment links may also change while an
-- approved route is assembled. A missing parent on DELETE is an FK cascade.
CREATE OR REPLACE FUNCTION guard_standard_route_factory_route_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  is_factory BOOLEAN := pg_has_role(
    session_user,
    'peaks-route-factory',
    'member'
  );
  is_reviewer BOOLEAN := pg_has_role(
    session_user,
    'peaks-route-reviewer',
    'member'
  );
  linked_route_id TEXT := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.route_id
    ELSE NEW.route_id
  END;
  route_record RECORD;
  approved_lease_exists BOOLEAN;
BEGIN
  IF NOT is_factory AND NOT is_reviewer THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF is_factory AND is_reviewer THEN
    RAISE EXCEPTION 'route worker login belongs to conflicting database roles';
  END IF;
  IF is_reviewer THEN
    RAISE EXCEPTION 'reviewer database role cannot write route links';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'factory database role cannot update route links';
  END IF;

  SELECT route.owner, route.status INTO route_record
  FROM routes route
  WHERE route.id = linked_route_id
  FOR SHARE OF route;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'factory database role cannot link a missing route';
  END IF;
  IF route_record.owner <> 'peaks' OR route_record.status <> 'pending' THEN
    RAISE EXCEPTION 'factory database role may change links only on pending Peaks routes';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM standard_route_backfill_jobs job
    WHERE job.published_route_id = linked_route_id
      AND job.state = 'approved'
      AND job.lease_owner IS NOT NULL
      AND job.lease_token IS NOT NULL
      AND job.lease_expires_at >= clock_timestamp()
  ) INTO approved_lease_exists;

  IF TG_TABLE_NAME = 'route_destinations' THEN
    IF TG_OP <> 'INSERT' OR EXISTS (
      SELECT 1
      FROM standard_route_backfill_jobs job
      WHERE job.published_route_id = linked_route_id
    ) THEN
      RAISE EXCEPTION 'factory database role cannot change reviewed destinations';
    END IF;
  ELSIF NOT approved_lease_exists AND EXISTS (
    SELECT 1
    FROM standard_route_backfill_jobs job
    WHERE job.published_route_id = linked_route_id
  ) THEN
    RAISE EXCEPTION 'factory database role cannot change segment links under review';
  END IF;

  IF NOT approved_lease_exists AND NOT EXISTS (
    SELECT 1
    FROM standard_route_backfill_jobs job
    WHERE job.state = 'candidate_ready'
      AND job.lease_owner IS NOT NULL
      AND job.lease_token IS NOT NULL
      AND job.lease_expires_at >= clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'factory route link write requires a live route-job lease';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION check_standard_route_factory_link_final()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  linked_route_id TEXT := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.route_id
    ELSE NEW.route_id
  END;
  route_record RECORD;
  import_binding_exists BOOLEAN;
  activation_binding_exists BOOLEAN;
BEGIN
  IF NOT pg_has_role(session_user, 'peaks-route-factory', 'member') THEN
    RETURN NULL;
  END IF;
  IF pg_has_role(session_user, 'peaks-route-reviewer', 'member') THEN
    RAISE EXCEPTION 'route worker login belongs to conflicting database roles';
  END IF;

  SELECT route.owner, route.status INTO route_record
  FROM routes route
  WHERE route.id = linked_route_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM standard_route_backfill_jobs job
    WHERE job.published_route_id = linked_route_id
      AND job.state = 'pending_review'
      AND job.lease_owner IS NULL
      AND job.lease_token IS NULL
      AND job.lease_expires_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM route_destinations destination_link
        WHERE destination_link.route_id = linked_route_id
          AND destination_link.destination_id = job.destination_id
      )
  ) INTO import_binding_exists;

  SELECT EXISTS (
    SELECT 1
    FROM standard_route_backfill_jobs job
    WHERE job.published_route_id = linked_route_id
      AND job.state = 'approved'
      AND job.lease_owner IS NOT NULL
      AND job.lease_token IS NOT NULL
      AND job.lease_expires_at >= clock_timestamp()
      AND EXISTS (
        SELECT 1
        FROM route_destinations destination_link
        WHERE destination_link.route_id = linked_route_id
          AND destination_link.destination_id = job.destination_id
      )
  ) INTO activation_binding_exists;

  IF TG_TABLE_NAME = 'route_destinations' THEN
    IF TG_OP <> 'INSERT'
       OR route_record.owner <> 'peaks'
       OR route_record.status <> 'pending'
       OR NOT import_binding_exists THEN
      RAISE EXCEPTION 'factory destination link escaped its import binding';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF route_record.owner <> 'peaks'
       OR route_record.status <> 'active'
       OR NOT activation_binding_exists THEN
      RAISE EXCEPTION 'factory segment-link delete escaped its activation binding';
    END IF;
  ELSIF route_record.owner <> 'peaks' OR NOT (
    (route_record.status = 'pending' AND import_binding_exists)
    OR (route_record.status = 'active' AND activation_binding_exists)
  ) THEN
    RAISE EXCEPTION 'factory segment link escaped its route-job binding';
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_guard_standard_route_factory_destinations
  ON route_destinations;
CREATE TRIGGER trg_guard_standard_route_factory_destinations
BEFORE INSERT OR UPDATE OR DELETE ON route_destinations
FOR EACH ROW
EXECUTE FUNCTION guard_standard_route_factory_route_link();

DROP TRIGGER IF EXISTS trg_guard_standard_route_factory_segments
  ON route_segments;
CREATE TRIGGER trg_guard_standard_route_factory_segments
BEFORE INSERT OR UPDATE OR DELETE ON route_segments
FOR EACH ROW
EXECUTE FUNCTION guard_standard_route_factory_route_link();

DROP TRIGGER IF EXISTS trg_check_standard_route_factory_destinations_final
  ON route_destinations;
CREATE CONSTRAINT TRIGGER trg_check_standard_route_factory_destinations_final
AFTER INSERT OR DELETE ON route_destinations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_standard_route_factory_link_final();

DROP TRIGGER IF EXISTS trg_check_standard_route_factory_segments_final
  ON route_segments;
CREATE CONSTRAINT TRIGGER trg_check_standard_route_factory_segments_final
AFTER INSERT OR DELETE ON route_segments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_standard_route_factory_link_final();

-- Factory jobs create immutable segment rows. Orphan cleanup is allowed, and a
-- deferred check prevents a new segment from surviving without a bound route.
CREATE OR REPLACE FUNCTION guard_standard_route_factory_segment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  is_factory BOOLEAN := pg_has_role(
    session_user,
    'peaks-route-factory',
    'member'
  );
  is_reviewer BOOLEAN := pg_has_role(
    session_user,
    'peaks-route-reviewer',
    'member'
  );
BEGIN
  IF NOT is_factory AND NOT is_reviewer THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF is_factory AND is_reviewer THEN
    RAISE EXCEPTION 'route worker login belongs to conflicting database roles';
  END IF;
  IF is_reviewer THEN
    RAISE EXCEPTION 'reviewer database role cannot write segments';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM standard_route_backfill_jobs job
      WHERE job.state IN ('candidate_ready', 'approved')
        AND job.lease_owner IS NOT NULL
        AND job.lease_token IS NOT NULL
        AND job.lease_expires_at >= clock_timestamp()
    ) THEN
      RAISE EXCEPTION 'factory segment insert requires a live route-job lease';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'factory database role cannot edit segment records';
  END IF;
  IF EXISTS (
    SELECT 1 FROM route_segments linked WHERE linked.segment_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'factory database role cannot delete a linked segment';
  END IF;
  RETURN OLD;
END
$$;

CREATE OR REPLACE FUNCTION check_standard_route_factory_segment_final()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT pg_has_role(session_user, 'peaks-route-factory', 'member') THEN
    RETURN NULL;
  END IF;
  IF pg_has_role(session_user, 'peaks-route-reviewer', 'member') THEN
    RAISE EXCEPTION 'route worker login belongs to conflicting database roles';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM segments segment WHERE segment.id = NEW.id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM route_segments linked
    JOIN routes route ON route.id = linked.route_id
    JOIN standard_route_backfill_jobs job
      ON job.published_route_id = route.id
    WHERE linked.segment_id = NEW.id
      AND EXISTS (
        SELECT 1
        FROM route_destinations destination_link
        WHERE destination_link.route_id = route.id
          AND destination_link.destination_id = job.destination_id
      )
      AND (
        (
          route.owner = 'peaks'
          AND route.status = 'pending'
          AND job.state = 'pending_review'
          AND job.lease_owner IS NULL
          AND job.lease_token IS NULL
          AND job.lease_expires_at IS NULL
        )
        OR (
          route.owner = 'peaks'
          AND route.status = 'active'
          AND job.state = 'approved'
          AND job.lease_owner IS NOT NULL
          AND job.lease_token IS NOT NULL
          AND job.lease_expires_at >= clock_timestamp()
        )
      )
  ) THEN
    RAISE EXCEPTION 'factory segment insert escaped its route-job binding';
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_guard_standard_route_factory_segment ON segments;
CREATE TRIGGER trg_guard_standard_route_factory_segment
BEFORE INSERT OR UPDATE OR DELETE ON segments
FOR EACH ROW
EXECUTE FUNCTION guard_standard_route_factory_segment();

DROP TRIGGER IF EXISTS trg_check_standard_route_factory_segment_final
  ON segments;
CREATE CONSTRAINT TRIGGER trg_check_standard_route_factory_segment_final
AFTER INSERT ON segments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_standard_route_factory_segment_final();

-- Route inserts invoke a trigger that writes generated area links. Run that
-- trigger with its owner's rights and a fixed lookup path, not worker table DML.
ALTER FUNCTION refresh_route_area_links_on_path_write() SECURITY DEFINER;
ALTER FUNCTION refresh_route_area_links_on_path_write()
  SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION refresh_route_area_links_on_path_write()
  FROM PUBLIC, "peaks-route-factory", "peaks-route-reviewer";

CREATE OR REPLACE FUNCTION guard_standard_route_worker_destination_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF pg_has_role(session_user, 'peaks-route-factory', 'member')
     OR pg_has_role(session_user, 'peaks-route-reviewer', 'member') THEN
    RAISE EXCEPTION 'route worker database roles may lock but not change destinations';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_guard_standard_route_worker_destination_write
  ON destinations;
CREATE TRIGGER trg_guard_standard_route_worker_destination_write
BEFORE INSERT OR UPDATE OR DELETE ON destinations
FOR EACH ROW
EXECUTE FUNCTION guard_standard_route_worker_destination_write();

CREATE OR REPLACE FUNCTION guard_standard_route_worker_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  is_factory BOOLEAN := pg_has_role(
    session_user,
    'peaks-route-factory',
    'member'
  );
  is_reviewer BOOLEAN := pg_has_role(
    session_user,
    'peaks-route-reviewer',
    'member'
  );
  factory_transition_allowed BOOLEAN;
BEGIN
  -- Operator and web logins are outside the worker roles. Their existing
  -- controls still apply. A worker login must never hold both roles.
  IF NOT is_factory AND NOT is_reviewer THEN
    RETURN NEW;
  END IF;
  IF is_factory AND is_reviewer THEN
    RAISE EXCEPTION 'route worker login belongs to conflicting database roles';
  END IF;
  IF NEW.destination_id IS DISTINCT FROM OLD.destination_id THEN
    RAISE EXCEPTION 'route worker database roles cannot retarget queue jobs';
  END IF;

  IF is_factory THEN
    IF OLD.state = 'verified' THEN
      RAISE EXCEPTION 'factory database role cannot change verified jobs';
    END IF;
    IF OLD.state = 'pending_review'
       OR NEW.lease_owner = 'luna-route-reviewer-01' THEN
      RAISE EXCEPTION 'factory database role cannot write review results or leases';
    END IF;
    IF NEW.review IS DISTINCT FROM OLD.review THEN
      RAISE EXCEPTION 'factory database role cannot write review results or leases';
    END IF;
    IF OLD.state IN ('approved', 'published')
       AND (
         NEW.candidate IS DISTINCT FROM OLD.candidate
         OR NEW.candidate_path IS DISTINCT FROM OLD.candidate_path
         OR NEW.candidate_sha256 IS DISTINCT FROM OLD.candidate_sha256
         OR (
           NEW.candidate_artifact IS DISTINCT FROM OLD.candidate_artifact
           AND NOT (
             OLD.state = 'published'
             AND NEW.state = 'verified'
             AND NEW.candidate_artifact IS NULL
           )
         )
         OR NEW.trailhead_id IS DISTINCT FROM OLD.trailhead_id
         OR NEW.published_route_id IS DISTINCT FROM OLD.published_route_id
         OR (
           NEW.replacement_route_id IS DISTINCT FROM OLD.replacement_route_id
           AND NOT (
             OLD.state = 'published'
             AND NEW.state = 'needs_revision'
             AND NEW.replacement_route_id = OLD.published_route_id
           )
         )
       ) THEN
      RAISE EXCEPTION 'factory database role cannot change an approved binding';
    END IF;
    factory_transition_allowed :=
      NEW.state = OLD.state
      OR (OLD.state = 'queued' AND NEW.state IN ('researching', 'needs_human'))
      OR (OLD.state = 'researching' AND NEW.state IN (
        'candidate_ready', 'needs_geometry', 'waiting_rights',
        'waiting_access', 'needs_human'
      ))
      OR (OLD.state = 'candidate_ready' AND NEW.state IN (
        'pending_review', 'needs_revision', 'waiting_rights',
        'waiting_access', 'needs_human'
      ))
      OR (OLD.state = 'approved' AND NEW.state IN (
        'published', 'needs_revision', 'waiting_rights',
        'waiting_access', 'needs_human'
      ))
      OR (OLD.state = 'published' AND NEW.state IN (
        'verified', 'needs_revision', 'needs_human'
      ))
      OR (OLD.state IN ('needs_revision', 'needs_geometry') AND NEW.state IN (
        'researching', 'waiting_rights', 'waiting_access', 'needs_human'
      ));
    IF NOT factory_transition_allowed THEN
      RAISE EXCEPTION 'factory database role cannot make this queue transition';
    END IF;
    IF NEW.state = 'pending_review'
       AND (
         OLD.state <> 'candidate_ready'
         OR NEW.lease_owner IS NOT NULL
         OR NEW.lease_token IS NOT NULL
         OR NEW.lease_expires_at IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'factory must hand pending_review to an unleased reviewer';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.state <> 'pending_review' THEN
    RAISE EXCEPTION 'reviewer database role may update only pending_review jobs';
  END IF;
  IF NEW.state NOT IN (
    'pending_review', 'approved', 'needs_revision',
    'waiting_rights', 'waiting_access', 'needs_human'
  ) THEN
    RAISE EXCEPTION 'reviewer database role cannot make this queue transition';
  END IF;
  IF NEW.candidate IS DISTINCT FROM OLD.candidate
     OR NEW.candidate_path IS DISTINCT FROM OLD.candidate_path
     OR NEW.candidate_sha256 IS DISTINCT FROM OLD.candidate_sha256
     OR NEW.candidate_artifact IS DISTINCT FROM OLD.candidate_artifact
     OR NEW.trailhead_id IS DISTINCT FROM OLD.trailhead_id
     OR NEW.published_route_id IS DISTINCT FROM OLD.published_route_id
     OR NEW.replacement_route_id IS DISTINCT FROM OLD.replacement_route_id THEN
    RAISE EXCEPTION 'reviewer database role cannot change factory candidate data';
  END IF;
  IF NEW.state = 'pending_review'
     AND NEW.lease_owner IS NOT NULL
     AND NEW.lease_owner <> 'luna-route-reviewer-01' THEN
    RAISE EXCEPTION 'reviewer lease owner is not canonical';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_guard_standard_route_worker_role
  ON standard_route_backfill_jobs;
CREATE TRIGGER trg_guard_standard_route_worker_role
BEFORE UPDATE ON standard_route_backfill_jobs
FOR EACH ROW
EXECUTE FUNCTION guard_standard_route_worker_role();

COMMIT;
