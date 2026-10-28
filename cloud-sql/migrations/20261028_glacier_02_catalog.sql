-- Rainier pilot. No new infrastructure; expected fixed cost $0/month.
-- Run as postgres after 20261028_glacier_01_feature.sql has committed.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Keep existing Polygon values. Do not rewrite them all as MultiPolygon.
ALTER TABLE public.destinations ALTER COLUMN boundary TYPE geography(Geometry,4326)
  USING boundary::geography(Geometry,4326);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='destinations_glacier_shape') THEN
    ALTER TABLE public.destinations ADD CONSTRAINT destinations_glacier_shape CHECK (
      NOT ('glacier'::destination_feature=ANY(features)) OR
      (type='region' AND boundary IS NOT NULL AND GeometryType(boundary::geometry) IN ('POLYGON','MULTIPOLYGON'))
    ) NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.destination_glacier_facts (
  destination_id TEXT PRIMARY KEY REFERENCES public.destinations(id) ON DELETE CASCADE,
  parent_mountain_id TEXT NOT NULL REFERENCES public.destinations(id),
  kind TEXT NOT NULL CHECK (kind IN ('glacier','snowfield')),
  nps_name TEXT,
  observed_year SMALLINT CHECK (observed_year BETWEEN 1800 AND 2200),
  area_km2 DOUBLE PRECISION CHECK (area_km2 > 0),
  area_uncertainty_km2 DOUBLE PRECISION CHECK (area_uncertainty_km2 >= 0),
  head_elevation_m DOUBLE PRECISION,
  terminus_elevation_m DOUBLE PRECISION,
  elevation_range_m DOUBLE PRECISION CHECK (elevation_range_m >= 0),
  length_km DOUBLE PRECISION CHECK (length_km > 0),
  average_slope_deg DOUBLE PRECISION CHECK (average_slope_deg BETWEEN 0 AND 90),
  flow_direction_deg DOUBLE PRECISION CHECK (flow_direction_deg >= 0 AND flow_direction_deg < 360),
  flow_direction_label TEXT,
  type_code TEXT, type_label TEXT,
  estimated_volume_km3 DOUBLE PRECISION CHECK (estimated_volume_km3 > 0),
  volume_uncertainty_km3 DOUBLE PRECISION CHECK (volume_uncertainty_km3 >= 0),
  rank_on_mountain SMALLINT CHECK (rank_on_mountain > 0),
  area_history JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(area_history)='array'),
  area_history_scope TEXT,
  percent_change_since_earliest DOUBLE PRECISION,
  provenance JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(provenance)='object'),
  -- OSM snapshot date is NOT the NPS fact observation year.
  outline_observed_at DATE NOT NULL,
  outline_source_url TEXT NOT NULL,
  outline_source_sha256 TEXT NOT NULL CHECK (outline_source_sha256 ~ '^[0-9a-f]{64}$'),
  outline_revision INTEGER NOT NULL DEFAULT 1 CHECK (outline_revision > 0),
  geometry_credit TEXT NOT NULL DEFAULT '© OpenStreetMap contributors',
  geometry_license TEXT NOT NULL DEFAULT 'ODbL-1.0',
  facts_credit TEXT NOT NULL DEFAULT 'Beason et al. (2023), National Park Service',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (destination_id <> parent_mountain_id),
  CHECK (head_elevation_m IS NULL OR terminus_elevation_m IS NULL OR head_elevation_m >= terminus_elevation_m)
);
CREATE INDEX IF NOT EXISTS destination_glacier_facts_parent_idx ON public.destination_glacier_facts(parent_mountain_id);

-- Parent links for areas use areas.parent_area_id. Destinations have no generic
-- parent relation: the extension's FK is the mountain link, not destination_areas.
CREATE TABLE IF NOT EXISTS public.route_glacier_crossings (
  route_id TEXT NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES public.destination_glacier_facts(destination_id) ON DELETE CASCADE,
  pass_index INTEGER NOT NULL CHECK (pass_index >= 0),
  segment_number INTEGER NOT NULL,
  entered_distance_m DOUBLE PRECISION NOT NULL CHECK (entered_distance_m >= 0),
  exited_distance_m DOUBLE PRECISION NOT NULL,
  crossed_distance_m DOUBLE PRECISION NOT NULL CHECK (crossed_distance_m > 0),
  entered_at TIMESTAMPTZ, exited_at TIMESTAMPTZ,
  entry_elevation_m DOUBLE PRECISION, exit_elevation_m DOUBLE PRECISION,
  min_elevation_m DOUBLE PRECISION, max_elevation_m DOUBLE PRECISION,
  starts_inside BOOLEAN NOT NULL, ends_inside BOOLEAN NOT NULL,
  entry_location geometry(Point,4326) NOT NULL, exit_location geometry(Point,4326) NOT NULL,
  outline_revision INTEGER NOT NULL, matcher_version INTEGER NOT NULL,
  PRIMARY KEY(route_id,destination_id,pass_index),
  CHECK (exited_distance_m > entered_distance_m),
  CHECK (min_elevation_m IS NULL OR max_elevation_m IS NULL OR min_elevation_m <= max_elevation_m)
);
CREATE INDEX IF NOT EXISTS route_glacier_crossings_destination_idx ON public.route_glacier_crossings(destination_id,route_id);
CREATE TABLE IF NOT EXISTS public.session_glacier_crossings (
  LIKE public.route_glacier_crossings INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
  session_id TEXT NOT NULL REFERENCES public.tracking_sessions(id) ON DELETE CASCADE,
  PRIMARY KEY(session_id,destination_id,pass_index),
  FOREIGN KEY(destination_id) REFERENCES public.destination_glacier_facts(destination_id) ON DELETE CASCADE,
  CHECK (entered_at IS NULL OR exited_at IS NULL OR exited_at >= entered_at)
);
-- LIKE does not copy foreign keys or indexes; remove the route-only column.
ALTER TABLE public.session_glacier_crossings DROP COLUMN IF EXISTS route_id;
CREATE INDEX IF NOT EXISTS session_glacier_crossings_destination_idx ON public.session_glacier_crossings(destination_id,session_id);

ALTER TABLE public.routes ADD COLUMN IF NOT EXISTS glacier_match_input_hash TEXT;
ALTER TABLE public.routes ADD COLUMN IF NOT EXISTS glacier_matched_at TIMESTAMPTZ;
ALTER TABLE public.tracking_sessions ADD COLUMN IF NOT EXISTS glacier_match_input_hash TEXT;
ALTER TABLE public.tracking_sessions ADD COLUMN IF NOT EXISTS glacier_matched_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS public.route_glacier_rematch_queue (
  route_id TEXT PRIMARY KEY REFERENCES public.routes(id) ON DELETE CASCADE,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Preserve every component and hole, even for small/thin outlines. Two metres
-- is a conservative pilot display tolerance. Matching always uses exact parts.
CREATE OR REPLACE FUNCTION public.destinations_refresh_boundary_display()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.features IS NOT DISTINCT FROM NEW.features
    AND public.ST_AsBinary(OLD.boundary) IS NOT DISTINCT FROM public.ST_AsBinary(NEW.boundary) THEN RETURN NEW; END IF;
  IF 'glacier'::public.destination_feature=ANY(NEW.features) AND NEW.boundary IS NOT NULL THEN
    NEW.boundary_display := public.ST_Multi(public.ST_Transform(public.ST_SimplifyPreserveTopology(
      public.ST_Transform(NEW.boundary::public.geometry,32610),2),4326))::public.geography;
  ELSE NEW.boundary_display := public.destination_display_boundary(NEW.boundary);
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.destinations_refresh_boundary_display() OWNER TO postgres;
DROP TRIGGER IF EXISTS trg_destinations_boundary_display ON public.destinations;
CREATE TRIGGER trg_destinations_boundary_display BEFORE INSERT OR UPDATE OF boundary,features ON public.destinations
  FOR EACH ROW EXECUTE FUNCTION public.destinations_refresh_boundary_display();

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['destination_glacier_facts','route_glacier_crossings','session_glacier_crossings','route_glacier_rematch_queue'] LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO postgres',tbl);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO "peaks-api"',tbl);
  END LOOP;
END $$;
COMMIT;
ALTER TABLE public.destinations VALIDATE CONSTRAINT destinations_glacier_shape;
