\set ON_ERROR_STOP on
\pset pager off
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='60s';
SET LOCAL application_name='peaks-trail-catalog-schema-review';
DO $$
BEGIN
  IF session_user<>'postgres' OR current_user<>session_user THEN
    RAISE EXCEPTION 'Connect directly as the schema owner postgres; no API/worker or SET ROLE session'; END IF;
  IF current_database()<>'peaks' THEN RAISE EXCEPTION 'This reviewed bundle targets the peaks database'; END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='routes'
      AND column_name IN ('kind','aliases','objective_destination_id','trailhead_destination_id','search_name','slug'))<>6 THEN
    RAISE EXCEPTION 'Phase 1 route metadata schema is incomplete'; END IF;
END $$;
-- System tuple identities detect row writes without reading toasted paths.
CREATE TEMP TABLE trail_schema_rows_before(table_name TEXT,tuple_id TEXT,tuple_version TEXT) ON COMMIT DROP;
INSERT INTO trail_schema_rows_before SELECT 'routes',ctid::text,xmin::text FROM public.routes;
INSERT INTO trail_schema_rows_before SELECT 'segments',ctid::text,xmin::text FROM public.segments;
INSERT INTO trail_schema_rows_before SELECT 'route_segments',ctid::text,xmin::text FROM public.route_segments;
INSERT INTO trail_schema_rows_before SELECT 'route_destinations',ctid::text,xmin::text FROM public.route_destinations;
CREATE TEMP TABLE trail_schema_protected_functions ON COMMIT DROP AS
  SELECT p.oid,p.proname,md5(pg_get_functiondef(p.oid)) AS definition_hash FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  AND p.proname IN ('is_valid_route_provenance','activate_standard_route_factory','enforce_peaks_route_cover_activation');
DO $$
BEGIN
  IF (SELECT count(DISTINCT proname) FROM trail_schema_protected_functions)<>3 THEN
    RAISE EXCEPTION 'Missing canonical provenance, independent activation, or cover gate'; END IF;
END $$;
CREATE TEMP TABLE trail_schema_jobs_before(job_count BIGINT) ON COMMIT DROP;
DO $$ DECLARE n BIGINT:=0;
BEGIN
  IF to_regclass('public.trail_catalog_candidate_jobs') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.trail_catalog_candidate_jobs' INTO n; END IF;
  INSERT INTO trail_schema_jobs_before VALUES(n);
END $$;
-- PINNED MIGRATION: cloud-sql/migrations/20261013_trail_catalog_candidate_jobs.sql
-- SHA256: 5dd0ef6fae492184906a0b2dbdecf31fd710451891e9e03d273d06ec9181399f
-- Local, bounded candidate work. No hosted process or monthly compute cost.

CREATE TABLE IF NOT EXISTS trail_catalog_candidate_jobs (
  source_key TEXT PRIMARY KEY,
  batch_key TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  review_hash TEXT NOT NULL CHECK (review_hash ~ '^[a-f0-9]{64}$'),
  artifact JSONB NOT NULL,
  proposed_route_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','leased','pending','rejected')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  route_id TEXT REFERENCES routes(id),
  rejection_reason TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((state='leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state<>'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK ((state='pending' AND route_id IS NOT NULL) OR (state<>'pending' AND route_id IS NULL))
);
CREATE INDEX IF NOT EXISTS trail_catalog_candidate_jobs_claim ON trail_catalog_candidate_jobs(batch_key, state, lease_expires_at, created_at);
GRANT SELECT,INSERT,UPDATE ON trail_catalog_candidate_jobs TO "peaks-route-factory";
GRANT SELECT ON trail_catalog_candidate_jobs TO "peaks-route-reviewer";

-- PINNED MIGRATION: cloud-sql/migrations/20261013_trail_catalog_operator_destination_guard.sql
-- SHA256: 95c4326bd0f2c655b79944453955c77eb65ae3e51a6349740127e5a4aca763cc
-- Keep real superusers distinct from route workers in disposable PostGIS.
-- PostgreSQL reports superusers as members of every role. Cloud SQL postgres
-- is not a superuser; its existing worker-role checks stay unchanged.
-- A real superuser already has permission to alter or remove this trigger.
-- Cost: one trigger-function replacement; ~$0/month added fixed cost.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION guard_standard_route_worker_destination_write()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper)
     AND (pg_has_role(session_user,'peaks-route-factory','member')
       OR pg_has_role(session_user,'peaks-route-reviewer','member')) THEN
    RAISE EXCEPTION 'route worker database roles may lock but not change destinations';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- PINNED MIGRATION: cloud-sql/migrations/20261013_trail_catalog_publish_integrity.sql
-- SHA256: d343d3c3d3efc9f517d1b1e5e74ab50eb6e14bafe169d58b4cadc61890e7c8ed
-- Kind-aware contact and source coverage for named catalog routes.
-- Cost: existing Cloud SQL functions only; expected fixed increase ~$0/month.
-- No row rewrite, activation, rights-validator, review, or cover-gate change.

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
          AND (segment_provenance->'osm_way_ids') <@ (route_provenance->'osm_way_ids')
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
    AND (r.provenance->'osm_way_ids') <@ COALESCE((
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


-- PINNED MIGRATION: cloud-sql/migrations/20261013_trail_catalog_wa_trailheads.sql
-- SHA256: 0519fe52704d8989ca6524a5b8fd3ac6e659b57392a5873c01c918b31ec151a7
-- Add the reviewed Skyline and northern Tipsoo Lake trail entrances.
-- Source and identity evidence: docs/data-audits/trail-catalog-wa-2026-10-13/.
-- Matches the existing 20260730 standard-route trailhead record pattern.
-- Cost: two destination rows and the existing rematch triggers; ~$0/month fixed.
-- Does not move or rename an existing place or activate a route.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('trail_catalog_wa_trailhead_import',0));
CREATE TEMP TABLE trail_catalog_wa_trailhead_input ON COMMIT DROP AS
SELECT value AS item FROM jsonb_array_elements($fixture$[
  {
    "id": "C21AD354B7FEA99C277F",
    "name": "Skyline Trailhead",
    "elevation": 1654.41796875,
    "location": {
      "type": "Point",
      "coordinates": [
        -121.7364531,
        46.7864184,
        1654.41796875
      ],
      "srid": 4326
    },
    "external_ids": {
      "osm": "13122759855"
    },
    "metadata": {
      "source": "openstreetmap",
      "source_url": "https://www.openstreetmap.org/node/13122759855",
      "source_way_url": "https://www.openstreetmap.org/way/439627173",
      "source_license": "ODbL 1.0",
      "source_license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
      "source_attribution": "© OpenStreetMap contributors",
      "source_snapshot": {
        "path": "sources/osm-skyline-map.json",
        "sha256": "e8c4a3781026c438c4a2d8101e0dea87a7745e8a6ad0bfc4149cfa8f31b50a82",
        "url": "https://api.openstreetmap.org/api/0.6/map.json?bbox=-121.741,46.781,-121.729,46.793",
        "retrievedAt": "2026-10-13T05:06:19.523647+00:00"
      },
      "route_source_url": "https://www.nps.gov/mora/planyourvisit/skyline-trail.htm",
      "catalog_audit": "trail-catalog-wa-2026-10-13",
      "elevation_source": "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)",
      "elevation_source_url": "https://registry.opendata.aws/terrain-tiles/",
      "elevation_license_url": "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
      "elevation_attribution": "* ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and\n  funded under National Science Foundation awards 1043681, 1559691, and 1542736;\n* Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017;\n* Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM)\n  Österreich;\n* Canada terrain data contains information licensed under the Open Government\n  Licence – Canada;\n* Europe terrain data produced using Copernicus data and information funded by the\n  European Union - EU-DEM layers;\n* Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration\n* Mexico terrain data source: INEGI, Continental relief, 2016;\n* New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New\n  Zealand and the New Zealand Government (All rights reserved);\n* Norway terrain data © Kartverket;\n* United Kingdom terrain data © Environment Agency copyright and/or database right\n  2015. All rights reserved;\n* United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data\n  courtesy of the U.S. Geological Survey.",
      "elevation_retrieved_at": "2026-10-13T05:53:41.405Z",
      "elevation_profile": "terrain",
      "region_source_url": "https://www.nps.gov/mora/planyourvisit/skyline-trail.htm",
      "region_basis": "Named trailhead in Mount Rainier National Park, Washington, United States; reviewed from the official NPS route page."
    }
  },
  {
    "id": "6D0E779FF39C5B648D6B",
    "name": "Tipsoo Lake Trailhead",
    "elevation": 1616.5078125,
    "location": {
      "type": "Point",
      "coordinates": [
        -121.519389,
        46.8698645,
        1616.5078125
      ],
      "srid": 4326
    },
    "external_ids": {
      "osm": "2431576647"
    },
    "metadata": {
      "source": "openstreetmap",
      "source_url": "https://www.openstreetmap.org/node/2431576647",
      "source_way_url": "https://www.openstreetmap.org/way/235057030",
      "source_license": "ODbL 1.0",
      "source_license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
      "source_attribution": "© OpenStreetMap contributors",
      "source_snapshot": {
        "path": "sources/osm-relation-5194432-full.json",
        "sha256": "2d74b2d8f972a8ea2750b309d38709881a2b475ea7a024c6aabc7dea1942f2bf",
        "url": "https://api.openstreetmap.org/api/0.6/relation/5194432/full.json",
        "retrievedAt": "2026-10-13T05:07:07.682567+00:00"
      },
      "route_source_url": "https://www.nps.gov/mora/planyourvisit/natches-peak-loop.htm",
      "catalog_audit": "trail-catalog-wa-2026-10-13",
      "elevation_source": "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)",
      "elevation_source_url": "https://registry.opendata.aws/terrain-tiles/",
      "elevation_license_url": "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
      "elevation_attribution": "* ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and\n  funded under National Science Foundation awards 1043681, 1559691, and 1542736;\n* Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017;\n* Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM)\n  Österreich;\n* Canada terrain data contains information licensed under the Open Government\n  Licence – Canada;\n* Europe terrain data produced using Copernicus data and information funded by the\n  European Union - EU-DEM layers;\n* Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration\n* Mexico terrain data source: INEGI, Continental relief, 2016;\n* New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New\n  Zealand and the New Zealand Government (All rights reserved);\n* Norway terrain data © Kartverket;\n* United Kingdom terrain data © Environment Agency copyright and/or database right\n  2015. All rights reserved;\n* United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data\n  courtesy of the U.S. Geological Survey.",
      "elevation_retrieved_at": "2026-10-13T05:53:41.405Z",
      "elevation_profile": "terrain",
      "region_source_url": "https://www.nps.gov/mora/planyourvisit/natches-peak-loop.htm",
      "region_basis": "Named trailhead in Mount Rainier National Park, Washington, United States; reviewed from the official NPS route page."
    }
  }
]$fixture$::jsonb);

DO $$
DECLARE item JSONB; target geography; existing destinations%ROWTYPE;
  audit_id BIGINT; added INTEGER:=0; changed INTEGER;
BEGIN
  IF (SELECT count(*) FROM trail_catalog_wa_trailhead_input)<>2 THEN
    RAISE EXCEPTION 'Expected exactly two reviewed Washington trailheads';
  END IF;
  INSERT INTO data_source_runs(source,run_kind,status,started_at,rows_in,notes)
    VALUES('trail-catalog-wa-trailheads','import','failed',now(),2,
      'Source-bound Skyline and northern Tipsoo entrances; identity review 2026-10-13')
    RETURNING id INTO audit_id;
  FOR item IN SELECT i.item FROM trail_catalog_wa_trailhead_input i ORDER BY i.item->>'id' LOOP
    target:=ST_SetSRID(ST_MakePoint((item#>>'{location,coordinates,0}')::float8,
      (item#>>'{location,coordinates,1}')::float8,(item->>'elevation')::float8),4326)::geography;
    -- Stop on a competing identity rather than silently dropping a source row.
    IF EXISTS (SELECT 1 FROM destinations d WHERE d.id<>item->>'id' AND (
      d.external_ids @> (item->'external_ids') OR
      (d.features @> ARRAY['trailhead']::destination_feature[]
        AND d.search_name=lower(item->>'name') AND ST_DWithin(d.location,target,300)))) THEN
      RAISE EXCEPTION 'Conflicting catalog trailhead for OSM node %',item#>>'{external_ids,osm}';
    END IF;
    SELECT * INTO existing FROM destinations WHERE id=item->>'id' FOR UPDATE;
    IF FOUND AND NOT COALESCE(existing.name=item->>'name'
      AND existing.external_ids @> (item->'external_ids')
      AND existing.features @> ARRAY['trailhead']::destination_feature[]
      AND existing.owner='peaks' AND existing.country_code='US' AND existing.state_code='WA'
      AND ST_3DDistance(existing.location::geometry,target::geometry)<0.000000001
      AND existing.elevation=(item->>'elevation')::float8
      AND existing.metadata @> (item->'metadata'),false) THEN
      RAISE EXCEPTION 'Reviewed trailhead ID conflicts with current catalog: %',item->>'id';
    END IF;
    INSERT INTO destinations(id,name,search_name,elevation,prominence,location,geohash,type,
      activities,features,owner,country_code,state_code,external_ids,metadata,created_at,updated_at)
    VALUES(item->>'id',item->>'name',lower(item->>'name'),(item->>'elevation')::float8,NULL,target,NULL,'point',
      ARRAY['outdoor-trek']::activity_type[],ARRAY['trailhead']::destination_feature[],'peaks','US','WA',
      item->'external_ids',item->'metadata',now(),now())
    ON CONFLICT(id) DO NOTHING;
    GET DIAGNOSTICS changed=ROW_COUNT; added:=added+changed;
  END LOOP;
  UPDATE data_source_runs SET status='success',finished_at=now(),rows_matched=2,rows_written=added
    WHERE id=audit_id;
  RAISE NOTICE 'Washington trailheads checked: 2; inserted: %; audit: %',added,audit_id;
END $$;

-- PINNED MIGRATION: cloud-sql/migrations/20261013_trail_catalog_worker_bindings.sql
-- SHA256: 5ac7ebc0692ac4ca7a35a8a1d57b6419a233e811e4827f16b656adac8b1239ce
-- Bounded pending imports; no new service or ongoing infrastructure cost (~$0/month).
-- Candidate leases never grant activation. The existing review and cover gates remain.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION trail_catalog_artifact_path(artifact JSONB, first_index INTEGER, last_index INTEGER)
RETURNS geometry LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT ST_SetSRID(ST_MakeLine(ST_MakePoint((point->>'lng')::float8,(point->>'lat')::float8,(point->>'ele')::float8) ORDER BY ordinal),4326)
  FROM jsonb_array_elements(artifact#>'{candidate,elevatedPoints}') WITH ORDINALITY AS points(point,ordinal)
  WHERE ordinal-1 BETWEEN first_index AND last_index
$$;

CREATE OR REPLACE FUNCTION trail_catalog_span_matches(segment_path geography, segment_provenance JSONB, artifact JSONB, first_index INTEGER, last_index INTEGER, reversed BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE expected geometry; actual geometry; expected_ids JSONB; actual_ids JSONB;
BEGIN
  IF first_index IS NULL OR last_index IS NULL OR first_index<0 OR last_index<=first_index
     OR last_index>=jsonb_array_length(artifact#>'{candidate,elevatedPoints}')
     OR NOT COALESCE(route_segment_provenance_compatible(segment_provenance,artifact#>'{candidate,provenance}'),false) THEN RETURN false; END IF;
  expected := trail_catalog_artifact_path(artifact,first_index,last_index);
  actual := CASE WHEN reversed THEN ST_Reverse(segment_path::geometry) ELSE segment_path::geometry END;
  IF expected IS NULL OR actual IS NULL OR ST_NDims(actual)<>3 OR ST_NDims(expected)<>3
    OR ST_NPoints(actual)<>ST_NPoints(expected) OR ST_Length(segment_path)<=0 THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM generate_series(1,ST_NPoints(expected)) i
    WHERE NOT (abs(ST_X(ST_PointN(expected,i))-ST_X(ST_PointN(actual,i)))<=1e-9
      AND abs(ST_Y(ST_PointN(expected,i))-ST_Y(ST_PointN(actual,i)))<=1e-9
      AND abs(ST_Z(ST_PointN(expected,i))-ST_Z(ST_PointN(actual,i)))<=0.01)) THEN RETURN false; END IF;
  -- Every cited way must contribute a positive horizontal edge in this exact span.
  SELECT jsonb_agg(id ORDER BY id) INTO expected_ids FROM (
    SELECT DISTINCT (edge->>'wayId')::bigint AS id
    FROM jsonb_array_elements(artifact#>'{candidate,edges}') WITH ORDINALITY e(edge,ordinal)
    WHERE ordinal-1>=first_index AND ordinal-1<last_index
      AND ST_Distance(ST_PointN(expected,ordinal::int-first_index)::geography,
                      ST_PointN(expected,ordinal::int-first_index+1)::geography)>0
  ) ids;
  SELECT jsonb_agg(id ORDER BY id) INTO actual_ids FROM (
    SELECT DISTINCT value::bigint AS id FROM jsonb_array_elements_text(segment_provenance->'osm_way_ids')
  ) ids;
  RETURN expected_ids IS NOT NULL AND actual_ids=expected_ids;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION trail_catalog_route_matches(route_record routes, artifact JSONB)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(route_record.owner='peaks' AND route_record.status='pending'
    AND route_record.name=artifact#>>'{candidate,input,name}'
    AND route_record.kind=artifact#>>'{candidate,input,kind}'
    AND route_record.shape::text=artifact#>>'{candidate,shape}'
    AND route_record.trailhead_destination_id=artifact#>>'{candidate,trailhead,id}'
    AND route_record.objective_destination_id IS NOT DISTINCT FROM artifact#>>'{candidate,objective,id}'
    AND to_jsonb(route_record.aliases)=COALESCE(artifact#>'{candidate,input,aliases}','[]'::jsonb)
    AND route_record.state_code=COALESCE(artifact#>>'{candidate,trailhead,stateCode}',artifact#>>'{candidate,objective,stateCode}',artifact#>>'{candidate,endTrailhead,stateCode}')
    AND route_record.country_code=COALESCE(artifact#>>'{candidate,trailhead,countryCode}',artifact#>>'{candidate,objective,countryCode}',artifact#>>'{candidate,endTrailhead,countryCode}')
    AND route_record.provenance=artifact#>'{candidate,provenance}'
    AND ST_AsEWKB(route_record.path::geometry)=ST_AsEWKB(trail_catalog_artifact_path(artifact,0,jsonb_array_length(artifact#>'{candidate,elevatedPoints}')-1))
    AND route_record.elevation_source=artifact#>>'{candidate,elevationLineage,source}'
    AND route_record.elevation_source_url=artifact#>>'{candidate,elevationLineage,sourceUrl}'
    AND route_record.elevation_attribution=artifact#>>'{candidate,elevationLineage,attribution}'
    AND route_record.elevation_license_url=artifact#>>'{candidate,elevationLineage,licenseUrl}'
    AND route_record.elevation_retrieved_at=(artifact#>>'{candidate,elevationLineage,retrievedAt}')::timestamptz,false)
$$;

CREATE OR REPLACE FUNCTION trail_catalog_live_context()
RETURNS SETOF trail_catalog_candidate_jobs LANGUAGE sql VOLATILE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT job.* FROM trail_catalog_candidate_jobs job
  WHERE source_key=current_setting('peaks.trail_candidate_source_key',true)
    AND lease_token=current_setting('peaks.trail_candidate_lease_token',true)
    AND state='leased' AND lease_owner IS NOT NULL AND lease_expires_at>clock_timestamp()
  FOR SHARE
$$;

-- Row locks need UPDATE privileges. This helper locks only the three reviewed
-- place IDs from the live lease, without granting destination writes to workers.
CREATE OR REPLACE FUNCTION trail_catalog_locked_places()
RETURNS TABLE(id TEXT,name TEXT,features TEXT[],state_code TEXT,country_code TEXT,lat DOUBLE PRECISION,lng DOUBLE PRECISION,boundary JSON)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job trail_catalog_candidate_jobs%ROWTYPE; place_ids TEXT[];
BEGIN
  IF NOT pg_has_role(session_user,'peaks-route-factory','member') OR pg_has_role(session_user,'peaks-route-reviewer','member') THEN
    RAISE EXCEPTION 'catalog place locking requires one factory database role'; END IF;
  SELECT * INTO job FROM trail_catalog_live_context();
  IF NOT FOUND THEN RAISE EXCEPTION 'catalog place locking requires a live candidate lease'; END IF;
  place_ids := ARRAY[job.artifact#>>'{candidate,trailhead,id}',job.artifact#>>'{candidate,objective,id}',job.artifact#>>'{candidate,endTrailhead,id}'];
  RETURN QUERY SELECT d.id,d.name,d.features::text[],d.state_code::text,d.country_code::text,
    ST_Y(d.location::geometry),ST_X(d.location::geometry),ST_AsGeoJSON(d.boundary::geometry)::json
    FROM public.destinations d WHERE d.id=ANY(place_ids) ORDER BY d.id FOR SHARE OF d;
END $$;
REVOKE ALL ON FUNCTION trail_catalog_locked_places() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trail_catalog_locked_places() TO "peaks-route-factory";

CREATE OR REPLACE FUNCTION trail_catalog_pending_binding_valid(candidate_route_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job trail_catalog_candidate_jobs%ROWTYPE; route_record routes%ROWTYPE;
  expected_places TEXT[]; actual_places TEXT[]; reference JSONB; link RECORD;
  expected_start INTEGER:=0; reference_count INTEGER:=0;
BEGIN
  SELECT * INTO job FROM trail_catalog_candidate_jobs WHERE proposed_route_id=candidate_route_id;
  SELECT * INTO route_record FROM routes WHERE id=candidate_route_id;
  IF job.source_key IS NULL OR route_record.id IS NULL OR job.state<>'pending' OR job.route_id<>candidate_route_id
    OR job.lease_owner IS NOT NULL OR job.lease_token IS NOT NULL OR job.lease_expires_at IS NOT NULL
    OR job.result->>'routeId' IS DISTINCT FROM candidate_route_id
    OR job.result->>'sourceKey' IS DISTINCT FROM job.source_key
    OR job.result->>'name' IS DISTINCT FROM job.artifact#>>'{candidate,input,name}'
    OR job.result->>'geometryHash' IS DISTINCT FROM job.artifact#>>'{candidate,geometryHash}'
    OR job.result->>'outcome' IS DISTINCT FROM 'admitted'
    OR job.artifact#>>'{candidate,input,sourceKey}' IS DISTINCT FROM job.source_key
    OR NOT trail_catalog_route_matches(route_record,job.artifact) THEN RETURN false; END IF;
  SELECT array_agg(id ORDER BY first_ordinal) INTO expected_places FROM (
    SELECT id,min(ordinal) first_ordinal FROM unnest(ARRAY[job.artifact#>>'{candidate,trailhead,id}',job.artifact#>>'{candidate,objective,id}',job.artifact#>>'{candidate,endTrailhead,id}']) WITH ORDINALITY places(id,ordinal)
    WHERE id IS NOT NULL GROUP BY id) ids;
  SELECT array_agg(destination_id ORDER BY ordinal) INTO actual_places FROM route_destinations WHERE route_id=candidate_route_id;
  IF actual_places IS DISTINCT FROM expected_places OR jsonb_typeof(job.result->'segments') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR reference IN SELECT value FROM jsonb_array_elements(job.result->'segments') LOOP
    SELECT rs.ordinal,rs.direction,s.path,s.provenance INTO link FROM route_segments rs JOIN segments s ON s.id=rs.segment_id
      WHERE rs.route_id=candidate_route_id AND rs.ordinal=reference_count AND rs.segment_id=reference->>'segmentId';
    IF NOT FOUND OR link.direction::text IS DISTINCT FROM reference->>'direction'
      OR (reference->>'routeStartIndex')::int IS DISTINCT FROM expected_start
      OR NOT trail_catalog_span_matches(link.path,link.provenance,job.artifact,
        (reference->>'routeStartIndex')::int,(reference->>'routeEndIndex')::int,link.direction::text='reverse') THEN RETURN false; END IF;
    expected_start := (reference->>'routeEndIndex')::int;
    reference_count := reference_count+1;
  END LOOP;
  RETURN reference_count>0 AND reference_count=(SELECT count(*) FROM route_segments WHERE route_id=candidate_route_id)
    AND expected_start=jsonb_array_length(job.artifact#>'{candidate,elevatedPoints}')-1
    AND peaks_route_passes_publish_integrity(candidate_route_id,NULL,'pending');
END $$;

CREATE OR REPLACE FUNCTION guard_trail_catalog_candidate_job()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.source_key,NEW.batch_key,NEW.input_hash,NEW.review_hash,NEW.artifact,NEW.proposed_route_id)
    IS DISTINCT FROM (OLD.source_key,OLD.batch_key,OLD.input_hash,OLD.review_hash,OLD.artifact,OLD.proposed_route_id) THEN
    RAISE EXCEPTION 'reviewed trail candidate input and route ID are immutable'; END IF;
  IF COALESCE(NEW.artifact#>>'{candidate,input,sourceKey}',NEW.artifact#>>'{input,sourceKey}') IS DISTINCT FROM NEW.source_key THEN RAISE EXCEPTION 'candidate source key differs from reviewed artifact'; END IF;
  IF NEW.state='pending' AND NEW.route_id IS DISTINCT FROM NEW.proposed_route_id THEN RAISE EXCEPTION 'candidate route differs from its proposed route ID'; END IF;
  IF pg_has_role(session_user,'peaks-route-factory','member') THEN
    IF pg_has_role(session_user,'peaks-route-reviewer','member') THEN RAISE EXCEPTION 'route worker login belongs to conflicting database roles'; END IF;
    IF TG_OP='INSERT' THEN
      IF EXISTS (SELECT 1 FROM routes WHERE id=NEW.proposed_route_id) THEN RAISE EXCEPTION 'candidate cannot adopt an existing route'; END IF;
      IF NEW.attempt_count<>0 OR NOT COALESCE((
        (NEW.state='queued' AND NEW.result IS NULL AND NEW.artifact#>>'{candidate,input,sourceKey}'=NEW.source_key)
        OR (NEW.state='rejected' AND NEW.route_id IS NULL AND NULLIF(trim(NEW.rejection_reason),'') IS NOT NULL
          AND NEW.artifact#>>'{input,sourceKey}'=NEW.source_key AND NOT (NEW.artifact ? 'candidate')
          AND NEW.result->>'sourceKey'=NEW.source_key AND NEW.result->>'routeId' IS NULL)
      ),false) THEN RAISE EXCEPTION 'factory must enqueue a fresh candidate or a rejected research receipt'; END IF;
    END IF;
    IF TG_OP='UPDATE' AND NEW IS DISTINCT FROM OLD THEN
      IF OLD.state IN ('pending','rejected') THEN RAISE EXCEPTION 'finished candidate is immutable'; END IF;
      IF NOT ((NEW.state='leased' AND (OLD.state='queued' OR (OLD.state='leased' AND OLD.lease_expires_at<clock_timestamp())) AND NEW.attempt_count=OLD.attempt_count+1)
        OR (OLD.state='leased' AND OLD.lease_expires_at>clock_timestamp() AND NEW.state IN ('pending','rejected') AND NEW.attempt_count=OLD.attempt_count)) THEN
        RAISE EXCEPTION 'invalid trail candidate lease transition'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_trail_catalog_candidate_job ON trail_catalog_candidate_jobs;
CREATE TRIGGER trg_guard_trail_catalog_candidate_job BEFORE INSERT OR UPDATE ON trail_catalog_candidate_jobs
  FOR EACH ROW EXECUTE FUNCTION guard_trail_catalog_candidate_job();

CREATE OR REPLACE FUNCTION check_trail_catalog_candidate_job_final()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM trail_catalog_candidate_jobs WHERE source_key=NEW.source_key AND state='pending')
    AND NOT trail_catalog_pending_binding_valid(NEW.proposed_route_id) THEN RAISE EXCEPTION 'candidate receipt lacks exact pending route binding'; END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_check_trail_catalog_candidate_job_final ON trail_catalog_candidate_jobs;
CREATE CONSTRAINT TRIGGER trg_check_trail_catalog_candidate_job_final AFTER INSERT OR UPDATE ON trail_catalog_candidate_jobs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_trail_catalog_candidate_job_final();

-- These two functions grant the factory only receipts for this importer, owned by
-- the login that started the attempt. An unfinished attempt stays visibly failed.
CREATE OR REPLACE FUNCTION begin_trail_catalog_source_run(run_notes TEXT)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE run_id BIGINT;
BEGIN
  INSERT INTO data_source_runs(source,run_kind,status,started_at,notes)
    VALUES('trail-catalog-pilot','import','failed',clock_timestamp(),jsonb_build_object('worker',session_user,'report',run_notes)::text)
    RETURNING id INTO run_id;
  RETURN run_id;
END $$;
CREATE OR REPLACE FUNCTION finish_trail_catalog_source_run(run_id BIGINT,run_status TEXT,input_count INTEGER,matched_count INTEGER,written_count INTEGER,run_notes TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF run_status NOT IN ('success','partial','failed','dry_run') OR input_count<0 OR matched_count<0 OR written_count<0
    OR input_count IS NULL OR matched_count IS NULL OR written_count IS NULL THEN RAISE EXCEPTION 'invalid trail candidate receipt'; END IF;
  UPDATE data_source_runs SET status=run_status,finished_at=clock_timestamp(),rows_in=input_count,rows_matched=matched_count,rows_written=written_count,
    notes=jsonb_build_object('worker',session_user,'report',run_notes)::text
    WHERE id=run_id AND source='trail-catalog-pilot' AND finished_at IS NULL AND notes::jsonb->>'worker'=session_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'trail candidate receipt does not belong to this unfinished attempt'; END IF;
END $$;
REVOKE ALL ON FUNCTION begin_trail_catalog_source_run(TEXT),finish_trail_catalog_source_run(BIGINT,TEXT,INTEGER,INTEGER,INTEGER,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION begin_trail_catalog_source_run(TEXT),finish_trail_catalog_source_run(BIGINT,TEXT,INTEGER,INTEGER,INTEGER,TEXT) TO "peaks-route-factory","peaks-api";

-- Extend only candidate insertion branches; legacy activation checks below are unchanged.

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

  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=NEW.id) THEN
    IF NOT EXISTS (SELECT 1 FROM trail_catalog_live_context() job WHERE job.proposed_route_id=NEW.id
      AND trail_catalog_route_matches(NEW,job.artifact)) THEN
      RAISE EXCEPTION 'factory trail route differs from its live reviewed candidate'; END IF;
    RETURN NEW;
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

  IF EXISTS (SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=NEW.id) THEN
    IF NOT trail_catalog_pending_binding_valid(NEW.id) THEN RAISE EXCEPTION 'factory trail route escaped its pending candidate binding'; END IF;
    RETURN NULL;
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

  IF EXISTS (SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=linked_route_id) THEN
    IF TG_OP<>'INSERT' OR NOT EXISTS (
      SELECT 1 FROM trail_catalog_live_context() job JOIN routes r ON r.id=job.proposed_route_id
      WHERE job.proposed_route_id=linked_route_id AND trail_catalog_route_matches(r,job.artifact)
    ) THEN RAISE EXCEPTION 'factory trail links require their live reviewed candidate'; END IF;
    RETURN NEW;
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

  IF EXISTS (SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=linked_route_id) THEN
    IF TG_OP<>'INSERT' OR NOT trail_catalog_pending_binding_valid(linked_route_id) THEN RAISE EXCEPTION 'factory trail link escaped its pending candidate binding'; END IF;
    RETURN NULL;
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

  IF TG_OP='INSERT' AND NULLIF(current_setting('peaks.trail_candidate_source_key',true),'') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM trail_catalog_live_context() job WHERE
      trail_catalog_span_matches(NEW.path,NEW.provenance,job.artifact,
        NULLIF(current_setting('peaks.trail_candidate_span_start',true),'')::int,
        NULLIF(current_setting('peaks.trail_candidate_span_end',true),'')::int)) THEN
      RAISE EXCEPTION 'factory trail segment differs from its live reviewed source span'; END IF;
    RETURN NEW;
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
  IF EXISTS (SELECT 1 FROM route_segments linked JOIN trail_catalog_candidate_jobs job ON job.proposed_route_id=linked.route_id
    WHERE linked.segment_id=NEW.id AND trail_catalog_pending_binding_valid(linked.route_id)) THEN RETURN NULL; END IF;

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

-- This phase creates pending candidates only. API/admin writes must not bypass
-- the independent review lane by using an older direct-activation endpoint.
-- A later reviewed activation migration must replace this explicit refusal.
CREATE OR REPLACE FUNCTION guard_trail_catalog_pending_only()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.status='active' AND EXISTS (
    SELECT 1 FROM public.trail_catalog_candidate_jobs WHERE proposed_route_id=NEW.id
  ) THEN
    RAISE EXCEPTION 'trail catalog candidate requires independent review; direct activation is disabled';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_trail_catalog_pending_only ON routes;
CREATE TRIGGER trg_guard_trail_catalog_pending_only
  BEFORE INSERT OR UPDATE OF status ON routes
  FOR EACH ROW EXECUTE FUNCTION guard_trail_catalog_pending_only();


-- PINNED MIGRATION: cloud-sql/migrations/20261013_trail_catalog_z_usfs_source_coverage.sql
-- SHA256: 23d4f8134c0bed9e1d9bc3a0711e46e2667cbcab89cf2859966671596f13ff24
-- Exact USFS feature coverage on the existing pending candidate path.
-- Cost: existing Cloud SQL functions only; expected fixed increase ~$0/month.
-- No route writes, role grants, activation, review, or canonical validator change.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- URLSearchParams uses form encoding, including '+' for space and UTF-8 bytes.
CREATE OR REPLACE FUNCTION trail_catalog_form_encode(value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT COALESCE(string_agg(CASE
    WHEN octet BETWEEN 65 AND 90 OR octet BETWEEN 97 AND 122 OR octet BETWEEN 48 AND 57
      OR octet IN (42,45,46,95) THEN chr(octet)
    WHEN octet=32 THEN '+' ELSE '%' || upper(lpad(to_hex(octet),2,'0')) END,'' ORDER BY ordinal),'')
  FROM (SELECT i AS ordinal,get_byte(convert_to(value,'UTF8'),i) AS octet
    FROM generate_series(0,octet_length(convert_to(value,'UTF8'))-1) i) bytes;
$$;

CREATE OR REPLACE FUNCTION trail_catalog_form_decode(value TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE bytes BYTEA := ''::bytea; position INTEGER := 1; character TEXT;
BEGIN
  IF length(value)>4000000 THEN RETURN NULL; END IF;
  WHILE position<=length(value) LOOP
    character := substr(value,position,1);
    IF character='%' THEN
      IF substr(value,position+1,2) !~ '^[0-9A-Fa-f]{2}$' THEN RETURN NULL; END IF;
      bytes := bytes || decode(substr(value,position+1,2),'hex'); position:=position+3;
    ELSE
      bytes := bytes || convert_to(CASE WHEN character='+' THEN ' ' ELSE character END,'UTF8');
      position:=position+1;
    END IF;
  END LOOP;
  RETURN convert_from(bytes,'UTF8');
EXCEPTION WHEN character_not_in_repertoire OR untranslatable_character THEN RETURN NULL;
END $$;

-- Pin the reviewed registry, field list, parameter order, escaping, and feature
-- set. IDs are data only: no decoded expression is ever executed as SQL.
CREATE OR REPLACE FUNCTION trail_catalog_usfs_source_url(feature_ids TEXT[])
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE ids TEXT[]; clause TEXT;
BEGIN
  IF array_ndims(feature_ids) IS DISTINCT FROM 1 OR cardinality(feature_ids) NOT BETWEEN 1 AND 5000
    OR EXISTS (SELECT 1 FROM unnest(feature_ids) id WHERE id IS NULL OR length(id) NOT BETWEEN 1 AND 256
      OR id<>btrim(id) OR id ~ '[[:cntrl:]]')
    OR cardinality(feature_ids)<>(SELECT count(DISTINCT id COLLATE "C") FROM unnest(feature_ids) id)
    THEN RETURN NULL; END IF;
  SELECT array_agg(id ORDER BY id COLLATE "C") INTO ids FROM unnest(feature_ids) id;
  SELECT 'globalid IN (' || string_agg('''' || replace(id,'''','''''') || '''',',' ORDER BY ordinal) || ')'
    INTO clause FROM unnest(ids) WITH ORDINALITY entries(id,ordinal);
  RETURN 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer/0/query?where='
    || trail_catalog_form_encode(clause)
    || '&outFields=globalid%2Ctrail_name%2Ctrail_no%2Cattributesubset%2Caccessibility_status%2Callowed_terra_use%2Chiker_pedestrian_managed%2Chiker_pedestrian_accpt%2Chiker_pedestrian_disc%2Chiker_pedestrian_accpt_disc%2Chiker_pedestrian_restricted&returnGeometry=true&returnZ=false&returnM=false&outSR=4326&f=geojson';
END $$;

CREATE OR REPLACE FUNCTION trail_catalog_usfs_feature_ids(source_url TEXT)
RETURNS TEXT[] LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE prefix CONSTANT TEXT := 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer/0/query?where=';
  tail TEXT; clause TEXT; body TEXT; feature_id TEXT; ids TEXT[] := ARRAY[]::text[];
  position INTEGER:=1; closed BOOLEAN; canonical TEXT;
BEGIN
  IF length(source_url)>4000000 OR left(source_url,length(prefix))<>prefix THEN RETURN NULL; END IF;
  tail:=substr(source_url,length(prefix)+1);
  IF strpos(tail,'&')=0 THEN RETURN NULL; END IF;
  clause:=trail_catalog_form_decode(left(tail,strpos(tail,'&')-1));
  IF clause IS NULL OR left(clause,13)<>'globalid IN (' OR right(clause,1)<>')' THEN RETURN NULL; END IF;
  body:=substr(clause,14,length(clause)-14);
  WHILE position<=length(body) LOOP
    IF substr(body,position,1)<>'''' THEN RETURN NULL; END IF;
    position:=position+1; feature_id:=''; closed:=false;
    WHILE position<=length(body) LOOP
      IF substr(body,position,1)='''' THEN
        IF substr(body,position+1,1)='''' THEN feature_id:=feature_id || ''''; position:=position+2;
        ELSE position:=position+1; closed:=true; EXIT; END IF;
      ELSE feature_id:=feature_id || substr(body,position,1); position:=position+1; END IF;
      IF length(feature_id)>256 THEN RETURN NULL; END IF;
    END LOOP;
    IF NOT closed THEN RETURN NULL; END IF;
    ids:=array_append(ids,feature_id);
    IF cardinality(ids)>5000 THEN RETURN NULL; END IF;
    IF position>length(body) THEN EXIT; END IF;
    IF substr(body,position,1)<>',' OR position=length(body) THEN RETURN NULL; END IF;
    position:=position+1;
  END LOOP;
  canonical:=trail_catalog_usfs_source_url(ids);
  IF canonical IS NULL OR canonical<>source_url THEN RETURN NULL; END IF;
  RETURN ids;
END $$;

CREATE OR REPLACE FUNCTION route_segment_provenance_compatible(
  segment_provenance JSONB, route_provenance JSONB
)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(CASE WHEN COALESCE(is_valid_route_provenance(segment_provenance),false)
                   AND COALESCE(is_valid_route_provenance(route_provenance),false)
    THEN segment_provenance->>'source_kind' = route_provenance->>'source_kind'
      AND segment_provenance->'contains_osm_geometry' = route_provenance->'contains_osm_geometry'
      AND segment_provenance->>'license_name' = route_provenance->>'license_name'
      AND segment_provenance->>'license_url' = route_provenance->>'license_url'
      AND segment_provenance->>'attribution' = route_provenance->>'attribution'
      AND segment_provenance->>'elevation_source' IS NOT DISTINCT FROM route_provenance->>'elevation_source'
      AND segment_provenance->>'elevation_profile' IS NOT DISTINCT FROM route_provenance->>'elevation_profile'
      AND CASE WHEN (route_provenance->>'contains_osm_geometry')::boolean
        THEN jsonb_array_length(segment_provenance->'osm_way_ids')>0
          AND (segment_provenance->'osm_way_ids') <@ (route_provenance->'osm_way_ids')
        WHEN route_provenance->>'source_kind'='usfs-nfs-trails' THEN
          route_provenance->>'license_name'='U.S. Government work under 17 U.S.C. § 105'
          AND route_provenance->>'license_url'='https://www.govinfo.gov/content/pkg/USCODE-2023-title17/html/USCODE-2023-title17-chap1-sec105.htm'
          AND route_provenance->>'attribution'='USDA Forest Service'
          AND trail_catalog_usfs_feature_ids(segment_provenance->>'source_url')
            <@ trail_catalog_usfs_feature_ids(route_provenance->>'source_url')
        ELSE segment_provenance->>'source_url'=route_provenance->>'source_url' END
    ELSE false END,false);
$$;

CREATE OR REPLACE FUNCTION route_segments_cover_provenance(candidate_route_id TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE((SELECT CASE WHEN is_valid_route_provenance(r.provenance) THEN
    EXISTS (SELECT 1 FROM route_segments rs WHERE rs.route_id=r.id)
    AND NOT EXISTS (
      SELECT 1 FROM route_segments rs LEFT JOIN segments s ON s.id=rs.segment_id
      WHERE rs.route_id=r.id AND NOT route_segment_provenance_compatible(s.provenance,r.provenance)
    )
    AND CASE WHEN r.provenance->>'source_kind'='usfs-nfs-trails' THEN
      trail_catalog_usfs_feature_ids(r.provenance->>'source_url') <@ ARRAY(
        SELECT DISTINCT feature_id FROM route_segments rs JOIN segments s ON s.id=rs.segment_id
        CROSS JOIN LATERAL unnest(trail_catalog_usfs_feature_ids(s.provenance->>'source_url')) feature_id
        WHERE rs.route_id=r.id)
    ELSE (r.provenance->'osm_way_ids') <@ COALESCE((
      SELECT jsonb_agg(DISTINCT way.value)
      FROM route_segments rs JOIN segments s ON s.id=rs.segment_id
      CROSS JOIN LATERAL jsonb_array_elements(CASE
        WHEN jsonb_typeof(s.provenance->'osm_way_ids')='array' THEN s.provenance->'osm_way_ids'
        ELSE '[]'::jsonb END) way(value)
      WHERE rs.route_id=r.id),'[]'::jsonb) END
    ELSE false END FROM routes r WHERE r.id=candidate_route_id),false);
$$;

CREATE OR REPLACE FUNCTION trail_catalog_span_matches(segment_path geography, segment_provenance JSONB, artifact JSONB, first_index INTEGER, last_index INTEGER, reversed BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE expected geometry; actual geometry; expected_ids JSONB; actual_ids JSONB;
BEGIN
  IF first_index IS NULL OR last_index IS NULL OR first_index<0 OR last_index<=first_index
     OR last_index>=jsonb_array_length(artifact#>'{candidate,elevatedPoints}')
     OR NOT COALESCE(route_segment_provenance_compatible(segment_provenance,artifact#>'{candidate,provenance}'),false) THEN RETURN false; END IF;
  expected:=trail_catalog_artifact_path(artifact,first_index,last_index);
  actual:=CASE WHEN reversed THEN ST_Reverse(segment_path::geometry) ELSE segment_path::geometry END;
  IF expected IS NULL OR actual IS NULL OR ST_NDims(actual)<>3 OR ST_NDims(expected)<>3
    OR ST_NPoints(actual)<>ST_NPoints(expected) OR ST_Length(segment_path)<=0 THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM generate_series(1,ST_NPoints(expected)) i
    WHERE NOT (abs(ST_X(ST_PointN(expected,i))-ST_X(ST_PointN(actual,i)))<=1e-9
      AND abs(ST_Y(ST_PointN(expected,i))-ST_Y(ST_PointN(actual,i)))<=1e-9
      AND abs(ST_Z(ST_PointN(expected,i))-ST_Z(ST_PointN(actual,i)))<=0.01)) THEN RETURN false; END IF;
  -- Each source ID must contribute a positive horizontal edge in this exact span.
  IF artifact#>>'{candidate,input,source,type}'='usfs-nfs-trails'
     AND segment_provenance->>'source_kind'='usfs-nfs-trails' THEN
    IF jsonb_array_length(artifact#>'{candidate,edges}')<>jsonb_array_length(artifact#>'{candidate,elevatedPoints}')-1
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(artifact#>'{candidate,edges}') WITH ORDINALITY e(edge,ordinal)
        WHERE ordinal-1>=first_index AND ordinal-1<last_index
          AND (jsonb_typeof(edge->'featureId') IS DISTINCT FROM 'string' OR edge ? 'wayId')) THEN RETURN false; END IF;
    SELECT jsonb_agg(id ORDER BY id COLLATE "C") INTO expected_ids FROM (
      SELECT DISTINCT edge->>'featureId' AS id
      FROM jsonb_array_elements(artifact#>'{candidate,edges}') WITH ORDINALITY e(edge,ordinal)
      WHERE ordinal-1>=first_index AND ordinal-1<last_index
        AND ST_Distance(ST_PointN(expected,ordinal::int-first_index)::geography,
                        ST_PointN(expected,ordinal::int-first_index+1)::geography)>0
    ) ids;
    actual_ids:=to_jsonb(trail_catalog_usfs_feature_ids(segment_provenance->>'source_url'));
  ELSIF artifact#>>'{candidate,input,source,type}'='osm'
     AND segment_provenance->>'source_kind'='openstreetmap' THEN
    SELECT jsonb_agg(id ORDER BY id) INTO expected_ids FROM (
      SELECT DISTINCT (edge->>'wayId')::bigint AS id
      FROM jsonb_array_elements(artifact#>'{candidate,edges}') WITH ORDINALITY e(edge,ordinal)
      WHERE ordinal-1>=first_index AND ordinal-1<last_index
        AND ST_Distance(ST_PointN(expected,ordinal::int-first_index)::geography,
                        ST_PointN(expected,ordinal::int-first_index+1)::geography)>0
    ) ids;
    SELECT jsonb_agg(id ORDER BY id) INTO actual_ids FROM (
      SELECT DISTINCT value::bigint AS id FROM jsonb_array_elements_text(segment_provenance->'osm_way_ids')
    ) ids;
  ELSE RETURN false; END IF;
  RETURN COALESCE(expected_ids IS NOT NULL AND actual_ids=expected_ids,false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;

COMMENT ON FUNCTION trail_catalog_usfs_feature_ids(TEXT) IS
  'Feature IDs only from the exact reviewed USFS registry URL; malformed or noncanonical URLs return NULL.';

-- PINNED MIGRATION: cloud-sql/migrations/20261013_trail_catalog_zz_receipt_permissions.sql
-- SHA256: 6bca8d851b79168c77e820e6e05d57297261ec3f3212ca47eea97de0845127ca
-- Keep pending-only review receipts outside application write privileges.
-- Cost: existing table grants/triggers only; fixed increase ~$0/month.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Production defaults grant API DML on new tables. Override that grant here;
-- ordinary dry runs need to read receipts but cannot erase or rewrite them.
REVOKE ALL ON trail_catalog_candidate_jobs FROM PUBLIC;
REVOKE ALL ON trail_catalog_candidate_jobs FROM "peaks-api";
GRANT SELECT ON trail_catalog_candidate_jobs TO "peaks-api";
REVOKE DELETE,TRUNCATE ON trail_catalog_candidate_jobs FROM "peaks-route-factory","peaks-route-reviewer";

CREATE OR REPLACE FUNCTION guard_trail_catalog_receipt_removal()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE table_owner NAME;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO table_owner FROM pg_class WHERE oid=TG_RELID;
  IF session_user IS DISTINCT FROM table_owner THEN
    RAISE EXCEPTION 'trail catalog receipts may be removed only by the table owner during explicit repair';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_guard_trail_catalog_receipt_delete ON trail_catalog_candidate_jobs;
CREATE TRIGGER trg_guard_trail_catalog_receipt_delete BEFORE DELETE ON trail_catalog_candidate_jobs
  FOR EACH ROW EXECUTE FUNCTION guard_trail_catalog_receipt_removal();
DROP TRIGGER IF EXISTS trg_guard_trail_catalog_receipt_truncate ON trail_catalog_candidate_jobs;
CREATE TRIGGER trg_guard_trail_catalog_receipt_truncate BEFORE TRUNCATE ON trail_catalog_candidate_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION guard_trail_catalog_receipt_removal();

CREATE OR REPLACE FUNCTION guard_trail_catalog_pending_only()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND EXISTS (
    SELECT 1 FROM public.trail_catalog_candidate_jobs WHERE proposed_route_id=OLD.id
  ) THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'trail catalog candidate route identity is immutable'; END IF;
    IF NEW.status='active' THEN
      RAISE EXCEPTION 'trail catalog candidate requires independent review; direct activation is disabled'; END IF;
  END IF;
  IF NEW.status='active' AND EXISTS (
    SELECT 1 FROM public.trail_catalog_candidate_jobs WHERE proposed_route_id=NEW.id
  ) THEN
    RAISE EXCEPTION 'trail catalog candidate requires independent review; direct activation is disabled';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_trail_catalog_pending_only ON routes;
CREATE TRIGGER trg_guard_trail_catalog_pending_only
  BEFORE INSERT OR UPDATE OF id,status ON routes
  FOR EACH ROW EXECUTE FUNCTION guard_trail_catalog_pending_only();

SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE trail_schema_rows_after(table_name TEXT,tuple_id TEXT,tuple_version TEXT) ON COMMIT DROP;
INSERT INTO trail_schema_rows_after SELECT 'routes',ctid::text,xmin::text FROM public.routes;
INSERT INTO trail_schema_rows_after SELECT 'segments',ctid::text,xmin::text FROM public.segments;
INSERT INTO trail_schema_rows_after SELECT 'route_segments',ctid::text,xmin::text FROM public.route_segments;
INSERT INTO trail_schema_rows_after SELECT 'route_destinations',ctid::text,xmin::text FROM public.route_destinations;
DO $$
BEGIN
  IF EXISTS ((SELECT * FROM trail_schema_rows_before EXCEPT SELECT * FROM trail_schema_rows_after)
    UNION ALL (SELECT * FROM trail_schema_rows_after EXCEPT SELECT * FROM trail_schema_rows_before)) THEN
    RAISE EXCEPTION 'Schema bundle changed route, segment, or route-link rows'; END IF;
  IF EXISTS (SELECT 1 FROM trail_schema_protected_functions old
    WHERE md5(pg_get_functiondef(old.oid)) IS DISTINCT FROM old.definition_hash) THEN
    RAISE EXCEPTION 'Canonical provenance, independent activation, or cover gate changed'; END IF;
  IF (SELECT count(*) FROM trail_catalog_candidate_jobs)<>(SELECT job_count FROM trail_schema_jobs_before) THEN
    RAISE EXCEPTION 'Schema bundle changed candidate-job count'; END IF;
  IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.trail_catalog_candidate_jobs'::regclass)<>'postgres' THEN
    RAISE EXCEPTION 'Candidate-job table owner is not postgres'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('begin_trail_catalog_source_run','check_standard_route_factory_link_final','check_standard_route_factory_route_final','check_standard_route_factory_segment_final','check_trail_catalog_candidate_job_final','finish_trail_catalog_source_run','guard_standard_route_factory_route','guard_standard_route_factory_route_link','guard_standard_route_factory_segment','guard_standard_route_worker_destination_write','guard_trail_catalog_candidate_job','guard_trail_catalog_pending_only','guard_trail_catalog_receipt_removal','peaks_route_kind_passes_contact','peaks_route_objective_contact','peaks_route_passes_publish_integrity','route_segment_provenance_compatible','route_segments_cover_provenance','trail_catalog_artifact_path','trail_catalog_form_decode','trail_catalog_form_encode','trail_catalog_live_context','trail_catalog_locked_places','trail_catalog_pending_binding_valid','trail_catalog_route_matches','trail_catalog_span_matches','trail_catalog_usfs_feature_ids','trail_catalog_usfs_source_url')
      AND pg_get_userbyid(p.proowner)<>'postgres') THEN
    RAISE EXCEPTION 'A changed schema function is not owned by postgres'; END IF;
  IF (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('begin_trail_catalog_source_run','check_standard_route_factory_link_final','check_standard_route_factory_route_final','check_standard_route_factory_segment_final','check_trail_catalog_candidate_job_final','finish_trail_catalog_source_run','guard_standard_route_factory_route','guard_standard_route_factory_route_link','guard_standard_route_factory_segment','guard_standard_route_worker_destination_write','guard_trail_catalog_candidate_job','guard_trail_catalog_pending_only','guard_trail_catalog_receipt_removal','peaks_route_kind_passes_contact','peaks_route_objective_contact','peaks_route_passes_publish_integrity','route_segment_provenance_compatible','route_segments_cover_provenance','trail_catalog_artifact_path','trail_catalog_form_decode','trail_catalog_form_encode','trail_catalog_live_context','trail_catalog_locked_places','trail_catalog_pending_binding_valid','trail_catalog_route_matches','trail_catalog_span_matches','trail_catalog_usfs_feature_ids','trail_catalog_usfs_source_url'))<>28 THEN
    RAISE EXCEPTION 'A required schema function is missing'; END IF;
  IF NOT has_table_privilege('peaks-api','public.trail_catalog_candidate_jobs','SELECT')
    OR has_table_privilege('peaks-api','public.trail_catalog_candidate_jobs','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'API candidate-job privileges must be SELECT only'; END IF;
  IF NOT has_table_privilege('peaks-route-factory','public.trail_catalog_candidate_jobs','SELECT')
    OR NOT has_table_privilege('peaks-route-factory','public.trail_catalog_candidate_jobs','INSERT')
    OR NOT has_table_privilege('peaks-route-factory','public.trail_catalog_candidate_jobs','UPDATE')
    OR has_table_privilege('peaks-route-factory','public.trail_catalog_candidate_jobs','DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'Factory candidate-job privileges differ from the reviewed lease writer'; END IF;
  IF NOT has_table_privilege('peaks-route-reviewer','public.trail_catalog_candidate_jobs','SELECT')
    OR has_table_privilege('peaks-route-reviewer','public.trail_catalog_candidate_jobs','INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'Reviewer candidate-job privileges must be SELECT only'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl
    WHERE c.oid='public.trail_catalog_candidate_jobs'::regclass AND acl.grantee=0) THEN
    RAISE EXCEPTION 'PUBLIC has candidate-job table privileges'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O'
    AND tgname IN ('trg_guard_trail_catalog_candidate_job','trg_check_trail_catalog_candidate_job_final',
      'trg_guard_trail_catalog_pending_only','trg_guard_trail_catalog_receipt_delete','trg_guard_trail_catalog_receipt_truncate'))<>5 THEN
    RAISE EXCEPTION 'Required candidate/receipt/activation triggers are not enabled'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_check_trail_catalog_candidate_job_final'
      AND tgrelid='public.trail_catalog_candidate_jobs'::regclass AND tgdeferrable AND tginitdeferred) THEN
    RAISE EXCEPTION 'Pending job binding must be deferred to transaction commit'; END IF;
  IF trail_catalog_usfs_feature_ids(trail_catalog_usfs_source_url(ARRAY['lower','upper'])) IS DISTINCT FROM ARRAY['lower','upper']::text[]
    OR trail_catalog_usfs_feature_ids(replace(trail_catalog_usfs_source_url(ARRAY['lower']),'apps.fs.usda.gov','example.test')) IS NOT NULL THEN
    RAISE EXCEPTION 'USFS canonical URL smoke check failed'; END IF;
  IF (SELECT count(*) FROM destinations WHERE id IN ('C21AD354B7FEA99C277F','6D0E779FF39C5B648D6B')
      AND owner='peaks' AND state_code='WA' AND country_code='US' AND 'trailhead'::destination_feature=ANY(features))<>2 THEN
    RAISE EXCEPTION 'Reviewed trailhead records are missing or misclassified'; END IF;
END $$;
-- No route writes or activation tests run against production. Real role/write
-- regression tests run only in the disposable CI database.
SELECT jsonb_build_object('commit','36e0b3465ee18052b6a7b84a3a47e3c0450c2dbc','checks','passed','route_rows_unchanged',true,
  'routes',(SELECT count(*) FROM trail_schema_rows_before WHERE table_name='routes'),
  'segments',(SELECT count(*) FROM trail_schema_rows_before WHERE table_name='segments'),
  'candidate_jobs',(SELECT count(*) FROM trail_catalog_candidate_jobs),
  'trailhead_ids',ARRAY['C21AD354B7FEA99C277F','6D0E779FF39C5B648D6B']) AS validation_result;

ROLLBACK;
