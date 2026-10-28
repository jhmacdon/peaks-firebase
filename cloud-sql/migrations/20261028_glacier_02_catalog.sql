-- Glacier catalog (first import: Mount Rainier). No new infrastructure; expected fixed cost $0/month.
-- Run as postgres after 20261028_glacier_01_feature.sql has committed.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Leave destinations.boundary and its triggers unchanged. It holds the
-- largest polygon; the extension stores every OSM component and hole.
CREATE TABLE IF NOT EXISTS public.destination_glacier_facts (
  destination_id TEXT PRIMARY KEY REFERENCES public.destinations(id) ON DELETE CASCADE,
  parent_mountain_id TEXT NOT NULL REFERENCES public.destinations(id),
  outline geography(MultiPolygon,4326) NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('glacier','snowfield')),
  -- The glacier's name in the facts source's inventory, when it differs.
  inventory_name TEXT,
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
  -- Outline snapshot date is NOT the facts' observation year.
  outline_observed_at DATE NOT NULL,
  outline_source_url TEXT NOT NULL,
  outline_source_sha256 TEXT NOT NULL CHECK (outline_source_sha256 ~ '^[0-9a-f]{64}$'),
  outline_revision INTEGER NOT NULL DEFAULT 1 CHECK (outline_revision > 0),
  geometry_credit TEXT NOT NULL CHECK (btrim(geometry_credit)<>''),
  geometry_license TEXT NOT NULL CHECK (btrim(geometry_license)<>''),
  -- Credits and source links come from each import's manifest, never a default.
  facts_credit TEXT NOT NULL CHECK (btrim(facts_credit)<>''),
  facts_source_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (destination_id <> parent_mountain_id),
  CHECK (head_elevation_m IS NULL OR terminus_elevation_m IS NULL OR head_elevation_m >= terminus_elevation_m)
);
CREATE INDEX IF NOT EXISTS destination_glacier_facts_parent_idx ON public.destination_glacier_facts(parent_mountain_id);
CREATE INDEX IF NOT EXISTS destination_glacier_facts_outline_idx ON public.destination_glacier_facts USING GIST(outline);

-- Keep glacier pieces apart from destination_boundary_parts: its existing
-- trigger rebuilds only the largest polygon used by older clients/writers.
CREATE TABLE IF NOT EXISTS public.glacier_outline_parts (
  destination_id TEXT NOT NULL REFERENCES public.destination_glacier_facts(destination_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  outline_part geography(Polygon,4326) NOT NULL,
  PRIMARY KEY(destination_id,ordinal)
);
CREATE INDEX IF NOT EXISTS glacier_outline_parts_outline_idx ON public.glacier_outline_parts USING GIST(outline_part);

CREATE OR REPLACE FUNCTION public.refresh_glacier_outline_parts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND public.ST_AsEWKB(OLD.outline::public.geometry)
    IS NOT DISTINCT FROM public.ST_AsEWKB(NEW.outline::public.geometry) THEN RETURN NULL; END IF;
  DELETE FROM public.glacier_outline_parts WHERE destination_id=NEW.destination_id;
  INSERT INTO public.glacier_outline_parts(destination_id,ordinal,outline_part)
    SELECT NEW.destination_id,(row_number() OVER ()-1)::int,piece
    FROM public.ST_Dump(NEW.outline::public.geometry) component
    CROSS JOIN LATERAL public.destination_boundary_pieces(component.geom::public.geography) piece;
  RETURN NULL;
END $$;
ALTER FUNCTION public.refresh_glacier_outline_parts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.refresh_glacier_outline_parts() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_glacier_outline_parts ON public.destination_glacier_facts;
CREATE TRIGGER trg_glacier_outline_parts AFTER INSERT OR UPDATE OF outline ON public.destination_glacier_facts
  FOR EACH ROW EXECUTE FUNCTION public.refresh_glacier_outline_parts();

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

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['destination_glacier_facts','glacier_outline_parts','route_glacier_crossings','session_glacier_crossings','route_glacier_rematch_queue'] LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO postgres',tbl);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO "peaks-api"',tbl);
  END LOOP;
END $$;
COMMIT;
