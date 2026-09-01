-- Peaks PostGIS Schema
-- Cloud SQL for PostgreSQL 15+ with PostGIS + pg_trgm
-- Point/route distance fields use geography (spherical, meters).
-- Large official protected-area boundaries use geometry for containment.
-- 3D types (PointZ, LineStringZ) carry elevation as Z coordinate

-- =============================================================================
-- Extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================================
-- Custom Types
-- =============================================================================

CREATE TYPE destination_type AS ENUM ('point', 'region');
CREATE TYPE activity_type AS ENUM ('outdoor-trek', 'outdoor-moto', 'ski');
CREATE TYPE destination_feature AS ENUM ('volcano', 'fire-lookout', 'summit', 'trailhead', 'hut', 'lookout', 'lake', 'landform', 'viewpoint', 'waterfall', 'campsite');
CREATE TYPE area_kind AS ENUM (
  'national_park',
  'national_monument',
  'national_forest',
  'national_grassland',
  'wilderness',
  'national_recreation_area',
  'national_conservation_area',
  'wildlife_refuge',
  'wild_and_scenic_river',
  'other_federal_area'
);
CREATE TYPE completion_mode AS ENUM ('none', 'straight', 'reverse');
CREATE TYPE route_shape AS ENUM ('out_and_back', 'loop', 'point_to_point', 'lollipop');
CREATE TYPE session_destination_relation AS ENUM ('reached', 'goal');

-- =============================================================================
-- Validation helpers
-- =============================================================================

-- Geometry provenance travels with both the assembled route and each source
-- segment. It is nullable only for legacy geometry whose source is unknown.
-- New provenance records must use this complete, flat shape:
-- {
--   source_kind, source_url, license_name, license_url, attribution,
--   retrieved_at, osm_way_ids, osm_way_urls, contains_osm_geometry
-- }
-- OSM-derived geometry must name every contributing way. Non-OSM records keep
-- both OSM arrays empty and contains_osm_geometry false.
CREATE FUNCTION is_valid_route_provenance(value JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) <> 'object'
      OR NOT value ?& ARRAY[
        'source_kind', 'source_url', 'license_name', 'license_url', 'attribution',
        'retrieved_at', 'osm_way_ids', 'osm_way_urls', 'contains_osm_geometry'
      ]
      OR jsonb_typeof(value->'source_kind') <> 'string'
      OR btrim(value->>'source_kind') !~ '^[a-z0-9][a-z0-9_-]*$'
      OR jsonb_typeof(value->'source_url') <> 'string'
      OR value->>'source_url' !~ '^https?://[^[:space:]]+$'
      OR jsonb_typeof(value->'license_name') <> 'string'
      OR btrim(value->>'license_name') = ''
      OR jsonb_typeof(value->'license_url') <> 'string'
      OR value->>'license_url' !~ '^https?://[^[:space:]]+$'
      OR jsonb_typeof(value->'attribution') <> 'string'
      OR btrim(value->>'attribution') = ''
      OR jsonb_typeof(value->'retrieved_at') <> 'string'
      OR value->>'retrieved_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      OR jsonb_typeof(value->'contains_osm_geometry') <> 'boolean'
      OR jsonb_typeof(value->'osm_way_ids') <> 'array'
      OR jsonb_typeof(value->'osm_way_urls') <> 'array'
    THEN false
    ELSE
      (SELECT count(*) FROM jsonb_object_keys(value)) = 9
      AND jsonb_array_length(value->'osm_way_ids') = jsonb_array_length(value->'osm_way_urls')
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(value->'osm_way_ids') WITH ORDINALITY AS way_id(value, ordinal)
        JOIN jsonb_array_elements(value->'osm_way_urls') WITH ORDINALITY AS way_url(value, ordinal)
          USING (ordinal)
        WHERE jsonb_typeof(way_id.value) <> 'number'
           OR (way_id.value #>> '{}') !~ '^[1-9][0-9]*$'
           OR jsonb_typeof(way_url.value) <> 'string'
           OR (way_url.value #>> '{}') <>
              ('https://www.openstreetmap.org/way/' || (way_id.value #>> '{}'))
      )
      AND (
        (value->>'contains_osm_geometry')::boolean
          = (jsonb_array_length(value->'osm_way_ids') > 0)
      )
      AND (
        NOT (value->>'contains_osm_geometry')::boolean
        OR (
          value->>'source_kind' = 'openstreetmap'
          AND value->>'license_name' = 'Open Data Commons Open Database License (ODbL) 1.0'
          AND value->>'license_url' = 'https://opendatacommons.org/licenses/odbl/1-0/'
          AND value->>'attribution' = '© OpenStreetMap contributors'
        )
      )
  END;
$$;

-- =============================================================================
-- Tables
-- =============================================================================

CREATE OR REPLACE FUNCTION elevation_matches_location_z(
    elevation DOUBLE PRECISION,
    location geography
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT (
        location IS NULL
        OR (
            ST_Z(location::geometry) IS NOT NULL
            AND ST_Z(location::geometry) NOT IN (
                'NaN'::DOUBLE PRECISION,
                'Infinity'::DOUBLE PRECISION,
                '-Infinity'::DOUBLE PRECISION
            )
        )
    ) AND (
        elevation IS NULL
        OR (
            location IS NOT NULL
            AND elevation NOT IN (
                'NaN'::DOUBLE PRECISION,
                'Infinity'::DOUBLE PRECISION,
                '-Infinity'::DOUBLE PRECISION
            )
            AND elevation = ST_Z(location::geometry)
        )
    );
$$;

COMMENT ON FUNCTION elevation_matches_location_z(DOUBLE PRECISION, geography) IS
    'peaks:elevation-matches-location-z:finite-float8-v1';

-- ---------------------------------------------------------------------------
-- destinations
-- Peaks, trailheads, and other points of interest.
-- PointZ carries elevation as Z coordinate for consistency, but elevation
-- is also stored as a plain column for non-spatial queries and indexing.
-- ---------------------------------------------------------------------------
CREATE TABLE destinations (
    id              TEXT PRIMARY KEY,
    name            TEXT,
    search_name     TEXT NOT NULL,     -- lowercased, normalized for trigram search
    elevation       DOUBLE PRECISION,  -- meters
    prominence      DOUBLE PRECISION,  -- meters
    location        geography(PointZ, 4326),
    CONSTRAINT destinations_elevation_matches_location_z
        CHECK (elevation_matches_location_z(elevation, location)),
    boundary        geography(Polygon, 4326),  -- optional shape for area destinations (lakes, camps, etc.)
    geohash         TEXT,
    type            destination_type NOT NULL DEFAULT 'point',
    activities      activity_type[] NOT NULL DEFAULT '{}',
    features        destination_feature[] NOT NULL DEFAULT '{}',
    owner           TEXT NOT NULL DEFAULT 'peaks',

    -- bounding box (for region-type destinations)
    bbox_min_lat    DOUBLE PRECISION,
    bbox_max_lat    DOUBLE PRECISION,
    bbox_min_lng    DOUBLE PRECISION,
    bbox_max_lng    DOUBLE PRECISION,

    -- details
    country_code    TEXT,
    state_code      TEXT,
    hero_image      TEXT,
    hero_image_attribution      TEXT,
    hero_image_attribution_url  TEXT,
    hero_image_focal_x SMALLINT NOT NULL DEFAULT 50
                       CHECK (hero_image_focal_x BETWEEN 0 AND 100),
    hero_image_focal_y SMALLINT NOT NULL DEFAULT 50
                       CHECK (hero_image_focal_y BETWEEN 0 AND 100),
    description                 TEXT,
    description_source_name     TEXT,
    description_source_url      TEXT,
    description_source_license  TEXT,
    massif_boundary             geography(Polygon, 4326),  -- curated whole-mountain ring

    -- activity averages (denormalized stats: popularity by month/day)
    averages        JSONB,             -- { months: {jan: 5, ...}, days: {mo: 3, ...}, lastUpdated: "..." }

    -- historical offsets from Firestore (pre-migration data not in session_destinations)
    session_count_offset INT NOT NULL DEFAULT 0,
    success_count_offset INT NOT NULL DEFAULT 0,
    averages_offset      JSONB,        -- same shape as averages; merged with averages in API responses

    -- source-specific metadata (e.g. CAI shelter details, import provenance)
    metadata        JSONB,

    -- IDs from external providers (osm, gnis, wikidata, alltrails, ...).
    -- Used by bulk imports for dedup and by admin tooling to link rows to sources.
    external_ids    JSONB NOT NULL DEFAULT '{}',

    -- Reviewed public pages for this exact place. The API also derives links
    -- from stable IDs above (Peakbagger, SummitPost, ListsOfJohn, etc.).
    external_links  JSONB NOT NULL DEFAULT '[]'
                    CHECK (jsonb_typeof(external_links) = 'array'),

    -- Feature-specific facts about the place (toilet type, drinking water,
    -- fee, capacity, etc.). Schema is feature-dependent and validated in
    -- TypeScript via the CampsiteAmenities discriminated union; the DB
    -- only enforces JSONB validity. Imported from OSM tags by bulk scripts.
    amenities       JSONB,

    explicitly_saved BOOLEAN NOT NULL DEFAULT FALSE,
    recency         TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT destinations_search_name_nonempty
      CHECK (search_name IS NOT NULL AND btrim(search_name) <> '')
);

-- ---------------------------------------------------------------------------
-- destination_photo_candidates
-- Reviewed source photos proposed as destination covers. A review is final:
-- pending rows have no reviewer, approved rows carry the stored Peaks image,
-- and denied rows retain their source and license record for audit history.
-- ---------------------------------------------------------------------------
CREATE TABLE destination_photo_candidates (
    id              TEXT PRIMARY KEY,
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    image_url       TEXT NOT NULL CHECK (image_url ~ '^https://[^[:space:]]+$'),
    source_page_url TEXT NOT NULL CHECK (source_page_url ~ '^https://[^[:space:]]+$'),
    source_kind     TEXT NOT NULL CHECK (btrim(source_kind) <> ''),
    photographer    TEXT NOT NULL CHECK (btrim(photographer) <> ''),
    license_name    TEXT NOT NULL CHECK (btrim(license_name) <> ''),
    license_url     TEXT NOT NULL CHECK (license_url ~ '^https://[^[:space:]]+$'),
    image_width     INT CHECK (image_width IS NULL OR image_width > 0),
    image_height    INT CHECK (image_height IS NULL OR image_height > 0),
    media_sha1      TEXT CONSTRAINT destination_photo_candidates_media_sha1_format
                    CHECK (media_sha1 IS NULL OR media_sha1 ~ '^[0-9a-f]{40}$'),
    candidate_origin TEXT NOT NULL DEFAULT 'manual'
                    CONSTRAINT destination_photo_candidates_origin_allowed
                    CHECK (candidate_origin IN ('manual', 'manifest_import', 'listed_photo_backfill')),
    focal_x         SMALLINT NOT NULL DEFAULT 50 CHECK (focal_x BETWEEN 0 AND 100),
    focal_y         SMALLINT NOT NULL DEFAULT 50 CHECK (focal_y BETWEEN 0 AND 100),
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'denied')),
    final_image_url TEXT,
    reviewed_by     TEXT,
    reviewed_at     TIMESTAMPTZ,
    review_note     TEXT,
    reviewer_comment             TEXT,
    reviewer_comment_by          TEXT,
    reviewer_comment_updated_at  TIMESTAMPTZ,
    reviewer_comment_resolved_by TEXT,
    reviewer_comment_resolved_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (destination_id, source_page_url),
    CHECK (
      (status = 'pending'
        AND final_image_url IS NULL
        AND reviewed_by IS NULL
        AND reviewed_at IS NULL)
      OR
      (status = 'approved'
        AND final_image_url IS NOT NULL
        AND reviewed_by IS NOT NULL
        AND reviewed_at IS NOT NULL)
      OR
      (status = 'denied'
        AND final_image_url IS NULL
        AND reviewed_by IS NOT NULL
        AND reviewed_at IS NOT NULL)
    )
);

CREATE INDEX idx_destination_photo_candidates_review_queue
    ON destination_photo_candidates (status, created_at, id);

CREATE UNIQUE INDEX uq_destination_photo_candidates_listed_backfill_pending
    ON destination_photo_candidates (destination_id)
    WHERE status = 'pending'
      AND candidate_origin = 'listed_photo_backfill';

CREATE UNIQUE INDEX uq_destination_photo_candidates_media_sha1
    ON destination_photo_candidates (destination_id, media_sha1)
    WHERE media_sha1 IS NOT NULL;

CREATE OR REPLACE FUNCTION guard_listed_photo_backfill_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'pending'
       AND OLD.destination_id = NEW.destination_id
       AND OLD.candidate_origin = NEW.candidate_origin THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM 1
    FROM destinations
   WHERE id = NEW.destination_id
   FOR UPDATE;

  IF NEW.candidate_origin = 'listed_photo_backfill'
     AND EXISTS (
       SELECT 1
         FROM destination_photo_candidates existing
        WHERE existing.destination_id = NEW.destination_id
          AND existing.status = 'pending'
          AND existing.id <> NEW.id
     ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER destination_photo_candidates_pending_guard
BEFORE INSERT OR UPDATE OF status, destination_id, candidate_origin
ON destination_photo_candidates
FOR EACH ROW
EXECUTE FUNCTION guard_listed_photo_backfill_pending();

CREATE INDEX idx_destination_photo_candidates_open_comments
    ON destination_photo_candidates (reviewer_comment_updated_at DESC, id)
    WHERE reviewer_comment IS NOT NULL
      AND reviewer_comment_resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- lists
-- User-curated collections of destinations (e.g. "Washington Volcanos").
-- ---------------------------------------------------------------------------
CREATE TABLE lists (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    owner           TEXT NOT NULL DEFAULT 'peaks',

    -- NULL means every current member is required. A smaller positive value
    -- supports keeper rules such as "any 13 of these 18 peaks" without
    -- changing the roster itself.
    completion_target INT,
    CONSTRAINT lists_completion_target_positive
        CHECK (completion_target IS NULL OR completion_target > 0),

    -- Curated-list display metadata (see migrations/20260821_list_metadata.sql).
    year_established INT,
    organization    TEXT,
    source_name     TEXT,
    source_url      TEXT,
    region          TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- list_destinations
-- Join table: which destinations belong to which list.
-- ---------------------------------------------------------------------------
CREATE TABLE list_destinations (
    list_id         TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    ordinal         INT NOT NULL DEFAULT 0,
    PRIMARY KEY (list_id, destination_id)
);

COMMENT ON COLUMN lists.completion_target IS
    'Required member count; NULL means every current list member is required';

-- Treat a missing, non-positive, or stale-too-large target as "all current
-- members". Reads use this helper so bad data can never make a list easier to
-- complete than its checked roster permits.
CREATE OR REPLACE FUNCTION effective_list_completion_target(
    configured_target INT,
    member_count INT
)
RETURNS INT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT CASE
        WHEN GREATEST(COALESCE(member_count, 0), 0) = 0 THEN 0
        WHEN configured_target BETWEEN 1 AND GREATEST(COALESCE(member_count, 0), 0)
            THEN configured_target
        ELSE GREATEST(COALESCE(member_count, 0), 0)
    END;
$$;

COMMENT ON FUNCTION effective_list_completion_target(INT, INT) IS
    'Returns a bounded list completion target; invalid or NULL targets require all current members';

-- ---------------------------------------------------------------------------
-- areas
-- Official land-management and protected-area units from authoritative sources
-- such as USGS PAD-US. Areas are context around destinations, not destinations
-- themselves, and can overlap each other.
-- ---------------------------------------------------------------------------
CREATE TABLE areas (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    search_name     TEXT NOT NULL,
    kind            area_kind NOT NULL,
    description     TEXT,
    description_source_name TEXT,
    description_source_url TEXT,
    description_source_license TEXT,
    designation     TEXT,
    manager         TEXT,
    owner           TEXT,
    country_code    TEXT NOT NULL DEFAULT 'US',
    state_codes     TEXT[] NOT NULL DEFAULT '{}',

    source          TEXT NOT NULL,
    source_id       TEXT NOT NULL,
    source_version  TEXT NOT NULL,
    source_updated_at TIMESTAMPTZ,

    boundary        geometry(MultiPolygon, 4326) NOT NULL,
    centroid        geometry(Point, 4326) NOT NULL,
    bbox_min_lat    DOUBLE PRECISION NOT NULL,
    bbox_max_lat    DOUBLE PRECISION NOT NULL,
    bbox_min_lng    DOUBLE PRECISION NOT NULL,
    bbox_max_lng    DOUBLE PRECISION NOT NULL,

    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (source, source_id)
);

-- Small indexed polygon pieces for exact path intersection checks. Large area
-- polygons can take more than the session processing limit when read as one
-- geometry; ST_Subdivide keeps the same boundary and makes each check bounded.
CREATE TABLE area_boundary_parts (
    area_id         TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    ordinal         INT NOT NULL,
    boundary_part   geometry(Geometry, 4326) NOT NULL,
    PRIMARY KEY (area_id, ordinal)
);

-- ---------------------------------------------------------------------------
-- destination_areas
-- Join table linking destinations, primarily summits, to containing official
-- areas. A destination can be contained by multiple overlapping areas.
-- ---------------------------------------------------------------------------
CREATE TABLE destination_areas (
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    area_id         TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    relation        TEXT NOT NULL DEFAULT 'contained_by',
    source          TEXT NOT NULL DEFAULT 'postgis',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (destination_id, area_id)
);

-- ---------------------------------------------------------------------------
-- segments
-- Atomic trail sections between two points. Source of truth for geometry.
-- A segment is always stored as one-way (start → end). Routes reference
-- segments with a direction (forward/reverse) to compose full paths.
-- Distance, gain, gain_loss are one-way values in the forward direction.
-- ---------------------------------------------------------------------------
CREATE TABLE segments (
    id              TEXT PRIMARY KEY,
    name            TEXT,
    path            geography(LineStringZ, 4326),  -- one-way geometry with elevation per vertex
    polyline6       TEXT,              -- encoded polyline (Google Polyline Algorithm) for client use

    -- one-way stats (forward direction)
    distance        DOUBLE PRECISION,  -- meters
    gain            DOUBLE PRECISION,  -- elevation gain in meters (forward)
    gain_loss       DOUBLE PRECISION,  -- elevation loss in meters (forward)

    -- Source, license, credit, retrieval time, and any OSM way IDs used to
    -- derive this segment. Validated by is_valid_route_provenance when present.
    provenance      JSONB,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- routes
-- Composed from ordered segments. path/polyline6/stats are materialized
-- (cached) from the route's segments for fast reads. Recompute on change.
-- Distance is always one-way. For out_and_back, total = distance * 2.
-- ---------------------------------------------------------------------------
CREATE TABLE routes (
    id              TEXT PRIMARY KEY,
    name            TEXT,
    path            geography(LineStringZ, 4326),  -- materialized: concatenated segment geometry
    polyline6       TEXT,              -- materialized: encoded polyline for client use
    geohashes       TEXT[],            -- geohashes along route for coarse spatial lookup
    owner           TEXT NOT NULL DEFAULT 'peaks',

    -- materialized one-way stats (recomputed from segments)
    distance        DOUBLE PRECISION,  -- one-way distance in meters
    gain            DOUBLE PRECISION,  -- one-way elevation gain in meters
    gain_loss       DOUBLE PRECISION,  -- one-way elevation loss in meters
    elevation_string TEXT,             -- human-readable elevation summary
    elevation_source TEXT,
    elevation_source_url TEXT,
    elevation_attribution TEXT,
    elevation_license_url TEXT,
    elevation_retrieved_at TIMESTAMPTZ,

    -- external references
    external_links  JSONB,             -- [{ type: "wta", id: "..." }, { type: "usfs", id: "..." }]

    -- Geometry provenance for the assembled route. Use the same record as its
    -- segments when they share one source; otherwise identify the assembled
    -- geometry source and retain exact OSM way lists on each segment.
    provenance      JSONB,

    completion      completion_mode NOT NULL DEFAULT 'none',
    shape           route_shape,       -- out_and_back, loop, point_to_point, lollipop
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('pending', 'active', 'superseded')),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Derived vertices for the three continent-scale Triple Crown routes. Their
-- guarded importer replaces these rows whenever it updates a centerline.
CREATE TABLE triple_crown_route_points (
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    idx             INT NOT NULL,
    pt              geometry(Point, 4326) NOT NULL,
    along_m         DOUBLE PRECISION NOT NULL CHECK (along_m >= 0),
    PRIMARY KEY (route_id, idx),
    CHECK (route_id IN ('triple-crown-pct', 'triple-crown-at', 'triple-crown-cdt'))
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON triple_crown_route_points TO "peaks-api";

-- ---------------------------------------------------------------------------
-- route_elevation_backfill_jobs
-- Durable, leased local work to restore valid elevation profiles for
-- Peaks-owned routes. This needs no hosted worker or scheduler.
-- ---------------------------------------------------------------------------
CREATE TABLE route_elevation_backfill_jobs (
    route_id            TEXT PRIMARY KEY REFERENCES routes(id) ON DELETE CASCADE,
    state               TEXT NOT NULL DEFAULT 'queued',
    path_fingerprint    TEXT NOT NULL,
    priority            INTEGER NOT NULL DEFAULT 0,
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    source_kind         TEXT NOT NULL DEFAULT 'unknown',
    last_error          TEXT,
    final_evidence      JSONB,
    next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_owner         TEXT,
    lease_token         TEXT,
    lease_expires_at    TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT route_elevation_backfill_jobs_state_check CHECK (
      state IN ('queued', 'working', 'retry', 'blocked', 'complete', 'out_of_scope')
    ),
    CONSTRAINT route_elevation_backfill_jobs_attempt_count_check CHECK (
      attempt_count >= 0
    ),
    CONSTRAINT route_elevation_backfill_jobs_source_kind_check CHECK (
      btrim(source_kind) <> ''
    ),
    CONSTRAINT route_elevation_backfill_jobs_lease_check CHECK (
      (state = 'working'
        AND lease_owner IS NOT NULL
        AND lease_token IS NOT NULL
        AND lease_expires_at IS NOT NULL)
      OR
      (state <> 'working'
        AND lease_owner IS NULL
        AND lease_token IS NULL
        AND lease_expires_at IS NULL)
    )
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON route_elevation_backfill_jobs TO "peaks-api";

-- ---------------------------------------------------------------------------
-- route_integrity_repairs
-- Durable ledger for bad active Peaks routes. A shared bad route has one row
-- for every linked summit, so it cannot retire until every summit is covered.
-- This uses on-demand CLI work only; expected run-rate change: near $0/month.
-- ---------------------------------------------------------------------------
CREATE TABLE route_integrity_repairs (
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
      (state = 'covered' AND replacement_route_id IS NOT NULL AND covered_at IS NOT NULL)
      OR
      (state <> 'covered' AND replacement_route_id IS NULL AND covered_at IS NULL)
    ),
    CONSTRAINT route_integrity_repairs_retired_check CHECK (
      state <> 'retired' OR last_error IS NULL
    )
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON route_integrity_repairs TO "peaks-api";

ALTER TABLE segments
  ADD CONSTRAINT segments_provenance_valid
  CHECK (provenance IS NULL OR is_valid_route_provenance(provenance));

ALTER TABLE routes
  ADD CONSTRAINT routes_provenance_valid
  CHECK (provenance IS NULL OR is_valid_route_provenance(provenance));

-- ---------------------------------------------------------------------------
-- route_segments
-- Join table: ordered segments composing a route.
-- direction: 'forward' uses segment as-is, 'reverse' flips it.
-- ---------------------------------------------------------------------------
CREATE TABLE route_segments (
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    segment_id      TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    ordinal         INT NOT NULL DEFAULT 0,
    direction       TEXT NOT NULL DEFAULT 'forward' CHECK (direction IN ('forward', 'reverse')),
    PRIMARY KEY (route_id, segment_id, ordinal)
);

-- ---------------------------------------------------------------------------
-- route_sections
-- Published human-scale divisions of a long route. Fractions use the same
-- south-to-north, one-way linestring domain as session_routes intervals.
-- ---------------------------------------------------------------------------
CREATE TABLE route_sections (
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    section_id      TEXT NOT NULL,
    ordinal         INT NOT NULL,
    label           TEXT NOT NULL CHECK (btrim(label) <> ''),
    region          TEXT,
    detail          TEXT,
    start_fraction  DOUBLE PRECISION NOT NULL CHECK (start_fraction >= 0 AND start_fraction < 1),
    end_fraction    DOUBLE PRECISION NOT NULL CHECK (end_fraction > 0 AND end_fraction <= 1),
    PRIMARY KEY (route_id, section_id),
    UNIQUE (route_id, ordinal),
    CHECK (end_fraction > start_fraction)
);

GRANT SELECT ON route_sections TO "peaks-api";

-- ---------------------------------------------------------------------------
-- route_destinations
-- Join table: which destinations a route visits, with ordering.
-- ---------------------------------------------------------------------------
CREATE TABLE route_destinations (
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    ordinal         INT NOT NULL DEFAULT 0,
    PRIMARY KEY (route_id, destination_id)
);

CREATE OR REPLACE FUNCTION canonical_elevation_token(elevation DOUBLE PRECISION)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
SET extra_float_digits = 1
AS $$
    SELECT CASE
        WHEN elevation IN (
            'NaN'::DOUBLE PRECISION,
            'Infinity'::DOUBLE PRECISION,
            '-Infinity'::DOUBLE PRECISION
        ) THEN NULL
        WHEN elevation = 0 THEN '0'
        ELSE ((elevation::text)::numeric)::text
    END;
$$;

CREATE OR REPLACE FUNCTION encode_route_elevation_profile(path geography)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    point_count BIGINT;
    valid_point_count BIGINT;
    has_nonzero_elevation BOOLEAN;
    elevation_profile TEXT;
BEGIN
    IF path IS NULL
        OR ST_IsEmpty(path::geometry)
        OR ST_GeometryType(path::geometry) <> 'ST_LineString'
        OR NOT ST_IsValid(path::geometry) THEN
        RETURN NULL;
    END IF;

    WITH points AS (
        SELECT
            (dumped).path AS point_path,
            ST_Z((dumped).geom) AS elevation
        FROM ST_DumpPoints(path::geometry) AS dumped
    ), valid_points AS (
        SELECT
            *,
            elevation IS NOT NULL
                AND elevation NOT IN (
                    'NaN'::DOUBLE PRECISION,
                    'Infinity'::DOUBLE PRECISION,
                    '-Infinity'::DOUBLE PRECISION
                ) AS has_valid_elevation
        FROM points
    )
    SELECT
        count(*),
        count(*) FILTER (WHERE has_valid_elevation),
        COALESCE(bool_or(elevation <> 0) FILTER (
            WHERE has_valid_elevation
        ), false),
        string_agg(
            canonical_elevation_token(elevation),
            '|' ORDER BY point_path
        ) FILTER (WHERE has_valid_elevation)
    INTO
        point_count,
        valid_point_count,
        has_nonzero_elevation,
        elevation_profile
    FROM valid_points;

    IF point_count < 2
        OR point_count <> valid_point_count
        OR NOT has_nonzero_elevation THEN
        RETURN NULL;
    END IF;

    RETURN replace(
        replace(encode(convert_to(elevation_profile, 'SQL_ASCII'), 'base64'), E'\n', ''),
        E'\r',
        ''
    );
END;
$$;

COMMENT ON FUNCTION encode_route_elevation_profile(geography) IS
    'peaks:route-elevation-profile:finite-float8-v1';

CREATE OR REPLACE FUNCTION route_elevation_profile_has_real_range(path geography)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT COALESCE(
        (
            SELECT point_count >= 2
                AND point_count = valid_point_count
                AND max_elevation - min_elevation >= 1
            FROM (
                SELECT count(*) AS point_count,
                       count(elevation) FILTER (WHERE elevation_is_finite)
                           AS valid_point_count,
                       max(elevation)
                           FILTER (WHERE elevation_is_finite)
                           AS max_elevation,
                       min(elevation)
                           FILTER (WHERE elevation_is_finite)
                           AS min_elevation
                FROM (
                    SELECT ST_Z((dumped).geom) AS elevation,
                           ST_Z((dumped).geom) IS NOT NULL
                               AND ST_Z((dumped).geom) NOT IN (
                                   'NaN'::DOUBLE PRECISION,
                                   'Infinity'::DOUBLE PRECISION,
                                   '-Infinity'::DOUBLE PRECISION
                               ) AS elevation_is_finite
                    FROM ST_DumpPoints(path::geometry) AS dumped
                ) valid_points
            ) elevation_range
        ),
        false
    );
$$;

CREATE OR REPLACE FUNCTION route_elevation_stats(path geography)
RETURNS TABLE(gain DOUBLE PRECISION, loss DOUBLE PRECISION)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    elevation DOUBLE PRECISION;
    previous_elevation DOUBLE PRECISION;
    pending DOUBLE PRECISION := 0;
    point_count INTEGER := 0;
BEGIN
    gain := 0;
    loss := 0;
    IF path IS NULL THEN
        gain := NULL;
        loss := NULL;
        RETURN NEXT;
        RETURN;
    END IF;
    FOR elevation IN
        SELECT ST_Z((dumped).geom)
        FROM ST_DumpPoints(path::geometry) AS dumped
        ORDER BY (dumped).path
    LOOP
        IF elevation IS NULL OR elevation IN (
            'NaN'::DOUBLE PRECISION,
            'Infinity'::DOUBLE PRECISION,
            '-Infinity'::DOUBLE PRECISION
        ) THEN
            gain := NULL;
            loss := NULL;
            RETURN NEXT;
            RETURN;
        END IF;
        point_count := point_count + 1;
        IF previous_elevation IS NULL THEN
            previous_elevation := elevation;
            CONTINUE;
        END IF;
        IF (pending >= 0 AND elevation - previous_elevation >= 0)
            OR (pending <= 0 AND elevation - previous_elevation <= 0) THEN
            pending := pending + elevation - previous_elevation;
        ELSE
            IF pending > 4 THEN gain := gain + pending;
            ELSIF pending < -4 THEN loss := loss + abs(pending);
            END IF;
            pending := elevation - previous_elevation;
        END IF;
        previous_elevation := elevation;
    END LOOP;
    IF point_count < 2 THEN
        gain := NULL;
        loss := NULL;
    ELSIF pending > 4 THEN
        gain := gain + pending;
    ELSIF pending < -4 THEN
        loss := loss + abs(pending);
    END IF;
    RETURN NEXT;
END;
$$;

-- Fail-closed publish predicate shared by activation, verification, and safe
-- repair retirement. The segment assembly must match every route XYZ point.
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
  TO "peaks-api";

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
  PERFORM 1 FROM route_integrity_repairs
  WHERE route_id = old_route_id ORDER BY destination_id FOR UPDATE;
  SELECT count(*)::int INTO repair_count
  FROM route_integrity_repairs WHERE route_id = old_route_id;
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
    PERFORM 1 FROM route_integrity_repairs
    WHERE route_id = old_route_id ORDER BY destination_id FOR UPDATE;
    SELECT count(*)::int INTO repair_count
    FROM route_integrity_repairs WHERE route_id = old_route_id;
    IF repair_count = 0 THEN
      RAISE EXCEPTION 'Bad replacement route has no linked summit repair rows';
    END IF;
  END IF;
  SELECT state, replacement_route_id
  INTO current_state, current_replacement
  FROM route_integrity_repairs
  WHERE route_id = old_route_id AND destination_id = current_destination_id;
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
  WHERE route_id = old_route_id AND destination_id = current_destination_id;
  PERFORM replacement.id
  FROM routes replacement
  JOIN (
    SELECT DISTINCT replacement_route_id
    FROM route_integrity_repairs
    WHERE route_id = old_route_id AND state = 'covered'
  ) covered ON covered.replacement_route_id = replacement.id
  ORDER BY replacement.id FOR UPDATE OF replacement;
  PERFORM rs.route_id
  FROM route_segments rs
  JOIN segments s ON s.id = rs.segment_id
  WHERE rs.route_id IN (
    SELECT replacement_route_id FROM route_integrity_repairs
    WHERE route_id = old_route_id AND state = 'covered'
  )
  ORDER BY rs.route_id, rs.ordinal FOR UPDATE OF rs, s;
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

GRANT EXECUTE ON FUNCTION settle_route_integrity_replacement(TEXT, TEXT, TEXT)
  TO "peaks-api";

-- ---------------------------------------------------------------------------
-- route_areas
-- Join table linking routes to the official areas their path passes through.
-- A route is a line, so it can both be fully contained by an area and merely
-- cross others; relation is 'contained_by' or 'intersects'. Mirrors
-- destination_areas. See link_routes_to_areas().
-- ---------------------------------------------------------------------------
CREATE TABLE route_areas (
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    area_id         TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    relation        TEXT NOT NULL DEFAULT 'intersects',
    source          TEXT NOT NULL DEFAULT 'postgis',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (route_id, area_id)
);

-- ---------------------------------------------------------------------------
-- plans
-- Trip plans with destinations, routes, and party members.
-- ---------------------------------------------------------------------------
CREATE TABLE plans (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    date            TIMESTAMPTZ,
    -- Saved routes are private unless their owner explicitly shares them.
    is_public       BOOLEAN NOT NULL DEFAULT FALSE,

    -- Matching geometry, supplied by the client on create/update (user-imported
    -- routes never reach the routes table, so a plan's path cannot be assembled
    -- server-side from plan_routes). Drives processPlan destination matching.
    -- Untyped subtype so a disjoint multi-route merge (MultiLineString) stores.
    path            GEOGRAPHY(Geometry, 4326),
    distance        DOUBLE PRECISION,
    gain            DOUBLE PRECISION,
    processing_state TEXT NOT NULL DEFAULT 'idle'
        CHECK (processing_state IN ('idle','pending','processing','completed','failed')),
    processed_at    TIMESTAMPTZ,
    processing_error TEXT,
    processing_started_at TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- plan_destinations
-- Join table: which destinations are included in a plan.
-- ---------------------------------------------------------------------------
CREATE TABLE plan_destinations (
    plan_id         TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    ordinal         INT NOT NULL DEFAULT 0,
    PRIMARY KEY (plan_id, destination_id)
);

-- ---------------------------------------------------------------------------
-- plan_routes
-- Join table: which routes are included in a plan.
-- ---------------------------------------------------------------------------
CREATE TABLE plan_routes (
    plan_id         TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    ordinal         INT NOT NULL DEFAULT 0,
    PRIMARY KEY (plan_id, route_id)
);

-- ---------------------------------------------------------------------------
-- plan_reached_destinations
-- Auto-matched destinations a plan's path reaches (source='auto'), ordered
-- along the path by processPlan. SEPARATE from plan_destinations (user-chosen
-- goals) so re-processing (which clears source='auto') never clobbers goals.
-- ---------------------------------------------------------------------------
CREATE TABLE plan_reached_destinations (
    plan_id         TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    ordinal         INT NOT NULL DEFAULT 0,
    source          TEXT NOT NULL DEFAULT 'auto',
    PRIMARY KEY (plan_id, destination_id)
);

-- ---------------------------------------------------------------------------
-- plan_party
-- Join table: party members (friends invited to the plan).
-- ---------------------------------------------------------------------------
CREATE TABLE plan_party (
    plan_id         TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_id, user_id)
);

-- ---------------------------------------------------------------------------
-- session_groups
-- Smart-link multi-day chains. Client-driven (iOS), opt-in under
-- SmartLinkFlag. A group represents a continuous adventure split across
-- multiple recordings (e.g. day 1 of a Glacier Peak attempt + day 2 from
-- camp to summit). Created either by user action ("Combine with another
-- recording" → manually_linked = true) or by auto-link rules at import
-- time (manually_linked = false). Distinct from session_attempt_groups
-- below, which groups repeat attempts of the same climb regardless of
-- continuity in time.
-- ---------------------------------------------------------------------------
CREATE TABLE session_groups (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    name            TEXT,
    manually_linked boolean NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- session_attempt_groups
-- Repeat attempts of the same climb/route by a user. Server-side, populated
-- on every session import by processSession's matchPreviousAttempts. Groups
-- sessions sharing 2+ reached destinations (or sufficiently similar GPS
-- tracks if <2 destinations). Spans years; not surfaced as merged log rows.
-- ---------------------------------------------------------------------------
CREATE TABLE session_attempt_groups (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- tracking_sessions
-- A recorded activity (hike, climb, ski tour).
-- Health data stored as JSONB since it's variable-length time series.
-- ---------------------------------------------------------------------------
CREATE TABLE tracking_sessions (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    name            TEXT,

    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ,

    -- stats
    distance        DOUBLE PRECISION,  -- meters
    total_time      INT,               -- seconds
    pace            DOUBLE PRECISION,  -- m/s
    gain            DOUBLE PRECISION,  -- elevation gain in meters
    highest_point   DOUBLE PRECISION,  -- meters
    ascent_time     INT,               -- seconds
    descent_time    INT,               -- seconds
    still_time      INT,               -- seconds

    activity_type   activity_type,

    -- import deduplication
    source          TEXT,              -- 'apple-health', 'strava', 'gpx-garmin', 'gpx-gaia', etc.
    external_id     TEXT,              -- ID from source system
    link_opt_out    boolean NOT NULL DEFAULT false,

    -- health metrics time series
    health_data     JSONB,             -- { calories: [{date, calories}], heartRates: [{date, heartRate}] }
    source_contributions JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- processing
    group_id            TEXT REFERENCES session_groups(id) ON DELETE SET NULL,
    attempt_group_id    TEXT REFERENCES session_attempt_groups(id) ON DELETE SET NULL,
    processed_at        TIMESTAMPTZ,
    processing_state TEXT NOT NULL DEFAULT 'idle'
        CHECK (processing_state IN ('idle', 'pending', 'processing', 'completed', 'failed')),
    processing_error TEXT,
    processing_started_at TIMESTAMPTZ,  -- when the current 'processing' claim was taken; lets a dead claim be recovered


    -- status flags
    ended           BOOLEAN NOT NULL DEFAULT FALSE,
    is_public       BOOLEAN NOT NULL DEFAULT FALSE,
    uploaded_to_strava BOOLEAN NOT NULL DEFAULT FALSE,

    -- Materialized GPS track (LineStringZ from tracking_points ORDER BY time).
    -- Populated by processSession; used for destination matching, route
    -- matching, and reverse-matching new destinations against historical
    -- sessions in a single GIST-indexed query.
    path            GEOGRAPHY(LineStringZ, 4326),
    path_preview    GEOMETRY(LineString, 4326)
                    GENERATED ALWAYS AS (
                        ST_Simplify(ST_Force2D(path::geometry), 0.00025)
                    ) STORED,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_path
    ON tracking_sessions USING GIST (path);

-- ---------------------------------------------------------------------------
-- tracking_points
-- Per-second GPS breadcrumbs for a session.
-- Composite PK clusters data by session for fast sequential reads.
-- PointZ carries elevation as Z, but elevation is also denormalized for
-- fast non-spatial queries (e.g. elevation profiles without PostGIS calls).
-- ---------------------------------------------------------------------------
CREATE TABLE tracking_points (
    session_id      TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
    time            BIGINT NOT NULL,   -- Unix timestamp in SECONDS (comparison model converts to ms at load)
    segment_number  INT NOT NULL DEFAULT 0,

    location        geography(PointZ, 4326),
    elevation       DOUBLE PRECISION,  -- denormalized Z for fast non-spatial queries
    CONSTRAINT tracking_points_elevation_matches_location_z
        CHECK (elevation_matches_location_z(elevation, location)),

    speed           DOUBLE PRECISION,  -- m/s
    azimuth         DOUBLE PRECISION,  -- bearing in degrees
    hdop            DOUBLE PRECISION,  -- horizontal dilution of precision
    speed_accuracy  DOUBLE PRECISION,  -- speed measurement uncertainty
    geohash         TEXT,

    PRIMARY KEY (session_id, time)
);

-- ---------------------------------------------------------------------------
-- session_destinations
-- Which destinations were reached or targeted during a session.
-- ---------------------------------------------------------------------------
CREATE TABLE session_destinations (
    session_id      TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    relation        session_destination_relation NOT NULL,  -- 'reached' or 'goal'
    source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
    PRIMARY KEY (session_id, destination_id)
);

-- ---------------------------------------------------------------------------
-- session_destination_rejections
-- "I didn't actually reach this" — a user's explicit veto of a destination on
-- one session. Deliberately NOT a session_destinations.source value:
-- processSession Step 1 deletes every source='auto' row before re-matching, so
-- a rejection stored there would be erased on the next run. Anti-joined by
-- buildSessionDestinationMatchSql (api/src/processing.ts),
-- link_sessions_on_destination_insert (below) and backfillDestinationToSessions
-- (web/src/lib/destination-backfill.ts).
-- ---------------------------------------------------------------------------
CREATE TABLE session_destination_rejections (
    session_id      TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    rejected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, destination_id)
);

-- ---------------------------------------------------------------------------
-- session_areas
-- Protected areas whose boundary the recorded GPS path passes through.
-- Built from saved tracking-point segments during processSession. A session can cross
-- several overlapping parks, forests, and wilderness areas.
-- ---------------------------------------------------------------------------
CREATE TABLE session_areas (
    session_id      TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
    area_id         TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    relation        TEXT NOT NULL DEFAULT 'intersects',
    source          TEXT NOT NULL DEFAULT 'postgis',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, area_id)
);

-- ---------------------------------------------------------------------------
-- session_routes
-- Which routes were followed during a session.
-- ---------------------------------------------------------------------------
CREATE TABLE session_routes (
    session_id      TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
    coverage        DOUBLE PRECISION,
    -- Which stretch of the route the recording covered: [[start, end], ...]
    -- fractions of the route linestring in [0, 1], sorted and non-overlapping.
    -- NULL = written before the column existed (see
    -- migrations/20260825_session_route_covered_intervals.sql).
    covered_intervals JSONB,
    PRIMARY KEY (session_id, route_id)
);

-- ---------------------------------------------------------------------------
-- trip_reports
-- Public field notes tied to one fully processed activity. source_session_id is
-- deliberately not a foreign key: deleting a private activity must not erase a
-- report that its author chose to publish, and the stable value keeps the
-- one-report-per-activity rule enforceable after that deletion.
-- ---------------------------------------------------------------------------
CREATE TABLE trip_reports (
    id                  TEXT PRIMARY KEY,
    source_session_id   TEXT,
    legacy_source_id    TEXT UNIQUE,
    user_id             TEXT NOT NULL,
    author_name         TEXT NOT NULL DEFAULT 'Peaks member',
    title               TEXT NOT NULL,
    body                TEXT NOT NULL DEFAULT '',
    activity_name       TEXT,
    activity_type       activity_type,
    activity_date       TIMESTAMPTZ NOT NULL,
    moderation_state    TEXT NOT NULL DEFAULT 'published'
        CHECK (moderation_state IN ('published', 'hidden')),
    legacy_record       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT trip_reports_source_session_unique UNIQUE (source_session_id)
);

CREATE TABLE trip_report_conditions (
    report_id       TEXT NOT NULL REFERENCES trip_reports(id) ON DELETE CASCADE,
    code            TEXT NOT NULL CHECK (code IN (
        'snow', 'ice', 'washout', 'downed_trees', 'water',
        'bugs', 'smoke', 'closure', 'route_finding'
    )),
    severity        TEXT NOT NULL DEFAULT 'notable'
        CHECK (severity IN ('info', 'notable', 'serious')),
    context         TEXT,
    ordinal         INT NOT NULL DEFAULT 0,
    PRIMARY KEY (report_id, code)
);

CREATE TABLE trip_report_photos (
    id              TEXT NOT NULL,
    report_id       TEXT NOT NULL REFERENCES trip_reports(id) ON DELETE CASCADE,
    storage_path    TEXT,
    download_url    TEXT NOT NULL,
    caption         TEXT,
    taken_at        TIMESTAMPTZ,
    ordinal         INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (report_id, id),
    CONSTRAINT trip_report_photo_storage_unique UNIQUE (storage_path)
);

CREATE TABLE trip_report_destinations (
    report_id       TEXT NOT NULL REFERENCES trip_reports(id) ON DELETE CASCADE,
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    PRIMARY KEY (report_id, destination_id)
);

CREATE TABLE trip_report_routes (
    report_id       TEXT NOT NULL REFERENCES trip_reports(id) ON DELETE CASCADE,
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    PRIMARY KEY (report_id, route_id)
);

CREATE TABLE trip_report_flags (
    report_id       TEXT NOT NULL REFERENCES trip_reports(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL,
    reason          TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (report_id, user_id)
);

CREATE TABLE trip_report_photo_deletions (
    storage_path    TEXT PRIMARY KEY,
    queued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts        INT NOT NULL DEFAULT 0,
    last_error      TEXT
);

CREATE INDEX idx_trip_reports_recent
    ON trip_reports (activity_date DESC, id DESC)
    WHERE moderation_state = 'published';
CREATE INDEX idx_trip_report_destinations_destination
    ON trip_report_destinations (destination_id, report_id);
CREATE INDEX idx_trip_report_routes_route
    ON trip_report_routes (route_id, report_id);
CREATE INDEX idx_trip_report_photos_report
    ON trip_report_photos (report_id, ordinal);

-- ---------------------------------------------------------------------------
-- session_markers
-- User-placed waypoints during a session (campsites, water sources, etc.).
-- ---------------------------------------------------------------------------
CREATE TABLE session_markers (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    session_id      TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
    location        geography(PointZ, 4326),
    name            TEXT,
    image           TEXT,              -- SF Symbol name or custom asset
    created_by      TEXT,              -- user ID of creator
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- session_comparisons
-- Pairwise session comparisons ("Your Efforts"). One row per overlapping
-- pair of a user's sessions; session_a is the EARLIER session (by
-- start_time). Populated by processSession Step 8 (matchComparisons) and
-- api/scripts/backfill-comparisons.ts. Semantics doc:
-- docs/superpowers/specs/2026-07-20-pacer-comparisons-design.md.
-- Overlap is NOT transitive, so this is deliberately pairwise (not a group
-- table like session_attempt_groups).
-- *_ms columns are unix MILLISECONDS (BIGINT, < 2^53 — safe under the global
-- OID-20 parser in api/src/db.ts; see cloud-sql/CLAUDE.md wire-type policy).
-- ---------------------------------------------------------------------------
CREATE TABLE session_comparisons (
    user_id      TEXT NOT NULL,
    session_a    TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
    session_b    TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,

    -- 'full': both sides compared over their entire pass(es) through the
    -- shared corridor (incl. out-and-back return). 'outbound': mixed topology
    -- (one side out-and-back, one single-pass) — both sides compared over the
    -- one-way traversal only.
    scope        TEXT NOT NULL CHECK (scope IN ('full', 'outbound')),

    overlap_m    DOUBLE PRECISION NOT NULL,  -- corridor meters shared
    a_frac       DOUBLE PRECISION NOT NULL,  -- overlap_m / a's corridor length
    b_frac       DOUBLE PRECISION NOT NULL,

    -- comparison window per side: wall-clock entry/exit of the shared range
    a_enter_ms   BIGINT NOT NULL,
    a_exit_ms    BIGINT NOT NULL,
    b_enter_ms   BIGINT NOT NULL,
    b_exit_ms    BIGINT NOT NULL,

    -- traveled meters (sampled cumulative distance) at window edges, for map
    -- highlighting / scope labels on iOS
    a_start_m    DOUBLE PRECISION NOT NULL,
    a_end_m      DOUBLE PRECISION NOT NULL,
    b_start_m    DOUBLE PRECISION NOT NULL,
    b_end_m      DOUBLE PRECISION NOT NULL,

    a_out_and_back BOOLEAN NOT NULL,
    b_out_and_back BOOLEAN NOT NULL,

    a_elapsed_s  INTEGER NOT NULL,
    b_elapsed_s  INTEGER NOT NULL,
    a_moving_s   INTEGER,
    b_moving_s   INTEGER,

    -- leg splits; NULL when the pair is not leg-splittable
    summit_destination_id TEXT REFERENCES destinations(id) ON DELETE SET NULL,
    a_arrival_ms   BIGINT,
    a_departure_ms BIGINT,
    b_arrival_ms   BIGINT,
    b_departure_ms BIGINT,
    a_ascent_s   INTEGER, a_dwell_s INTEGER, a_descent_s INTEGER,
    b_ascent_s   INTEGER, b_dwell_s INTEGER, b_descent_s INTEGER,

    matcher_version INTEGER NOT NULL,
    legs_version    INTEGER NOT NULL,
    computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (session_a, session_b),
    CHECK (session_a <> session_b)
);

CREATE INDEX idx_session_comparisons_user_a ON session_comparisons (user_id, session_a);
CREATE INDEX idx_session_comparisons_user_b ON session_comparisons (user_id, session_b);

-- ---------------------------------------------------------------------------
-- session_tombstones
-- Deletion log for incremental client sync.
-- ---------------------------------------------------------------------------
CREATE TABLE session_tombstones (
    session_id       TEXT NOT NULL,
    user_id          TEXT NOT NULL,
    deleted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, user_id)
);

-- ---------------------------------------------------------------------------
-- data_source_runs
-- Durable log of automated data-source runs (fetch / normalize / import /
-- check) for trailhead facts (parking, road access, bathrooms) and similar
-- imported data. status = 'dry_run' covers a run that touched no data on
-- purpose. See migrations/20260819_data_source_runs.sql.
-- ---------------------------------------------------------------------------
CREATE TABLE data_source_runs (
    id            BIGSERIAL PRIMARY KEY,
    source        TEXT NOT NULL,
    run_kind      TEXT NOT NULL CHECK (run_kind IN ('fetch', 'normalize', 'import', 'check')),
    status        TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed', 'dry_run')),
    started_at    TIMESTAMPTZ NOT NULL,
    finished_at   TIMESTAMPTZ,
    rows_in       INT,
    rows_matched  INT,
    rows_written  INT,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- Indexes
-- =============================================================================

-- Spatial (GIST) on all geography columns
CREATE INDEX idx_destinations_location      ON destinations USING GIST (location);
CREATE INDEX idx_destinations_boundary      ON destinations USING GIST (boundary) WHERE boundary IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_destinations_massif_boundary
    ON destinations USING GIST (massif_boundary) WHERE massif_boundary IS NOT NULL;
CREATE INDEX idx_areas_boundary             ON areas USING GIST (boundary);
CREATE INDEX idx_areas_centroid             ON areas USING GIST (centroid);
CREATE INDEX idx_area_boundary_parts_geom   ON area_boundary_parts USING GIST (boundary_part);
CREATE INDEX idx_segments_path              ON segments     USING GIST (path);
CREATE INDEX idx_routes_path                ON routes       USING GIST (path);
CREATE INDEX idx_tracking_points_location   ON tracking_points USING GIST (location);
CREATE INDEX idx_session_markers_location   ON session_markers USING GIST (location);

-- Trigram (GIN) for fuzzy text search on destinations
CREATE INDEX idx_destinations_search_name   ON destinations USING GIN (search_name gin_trgm_ops);
CREATE INDEX idx_destinations_search_name_fts
  ON destinations USING GIN (
    to_tsvector('simple', COALESCE(NULLIF(search_name, ''), lower(name)))
  );
CREATE INDEX idx_areas_search_name          ON areas USING GIN (search_name gin_trgm_ops);
CREATE INDEX idx_areas_search_name_prefix   ON areas (search_name text_pattern_ops);
CREATE INDEX idx_routes_active_name_trgm
    ON routes USING GIN (lower(name) gin_trgm_ops)
    WHERE status = 'active';
CREATE INDEX idx_routes_active_name_prefix
    ON routes (lower(name) text_pattern_ops)
    INCLUDE (id)
    WHERE status = 'active';

-- GIN on array columns for containment queries (e.g. WHERE features @> '{summit}')
CREATE INDEX idx_destinations_features      ON destinations USING GIN (features);
CREATE INDEX idx_destinations_activities    ON destinations USING GIN (activities);

-- GIN on external_ids JSONB for efficient dedup lookups by provider key
CREATE INDEX IF NOT EXISTS destinations_external_ids_idx
  ON destinations USING gin (external_ids);

-- GIN on amenities JSONB for filtered queries (e.g. "campsites with toilets")
CREATE INDEX IF NOT EXISTS destinations_amenities_idx
  ON destinations USING gin (amenities);

-- B-tree for common lookups and foreign keys
CREATE INDEX idx_destinations_owner         ON destinations (owner);
CREATE INDEX idx_destinations_type          ON destinations (type);
CREATE INDEX idx_areas_kind                 ON areas (kind);

CREATE INDEX idx_routes_owner               ON routes (owner);
CREATE INDEX idx_triple_crown_route_points_pt
  ON triple_crown_route_points USING GIST (pt);

CREATE INDEX idx_route_elevation_backfill_jobs_claim
  ON route_elevation_backfill_jobs (
    state,
    next_attempt_at,
    priority DESC,
    route_id
  )
  WHERE state IN ('queued', 'retry');

CREATE INDEX idx_route_elevation_backfill_jobs_lease
  ON route_elevation_backfill_jobs (lease_expires_at)
  WHERE state = 'working';

CREATE INDEX idx_route_integrity_repairs_claim
  ON route_integrity_repairs (state, created_at, route_id, destination_id)
  WHERE state = 'queued';

CREATE INDEX idx_route_integrity_repairs_destination
  ON route_integrity_repairs (destination_id, state, created_at, route_id);

CREATE INDEX idx_plans_user_id              ON plans (user_id, updated_at DESC);
CREATE INDEX idx_plan_destinations_dest     ON plan_destinations (destination_id);
CREATE INDEX idx_plan_routes_route          ON plan_routes (route_id);
CREATE INDEX idx_plan_party_user            ON plan_party (user_id);

CREATE INDEX idx_session_groups_user_id          ON session_groups (user_id);
CREATE INDEX idx_session_attempt_groups_user_id  ON session_attempt_groups (user_id);
CREATE INDEX idx_tracking_sessions_user_id       ON tracking_sessions (user_id, start_time DESC);
CREATE INDEX idx_tracking_sessions_group         ON tracking_sessions (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX idx_tracking_sessions_attempt_group ON tracking_sessions (attempt_group_id) WHERE attempt_group_id IS NOT NULL;
CREATE INDEX idx_tracking_sessions_dedup    ON tracking_sessions (source, external_id)
    WHERE source IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX idx_tracking_sessions_sync     ON tracking_sessions (user_id, server_updated_at ASC, id ASC);
CREATE INDEX idx_tracking_sessions_processing ON tracking_sessions (user_id, processing_state, server_updated_at DESC);
CREATE INDEX idx_tracking_sessions_link_opt_out ON tracking_sessions (user_id) WHERE link_opt_out = true;

CREATE INDEX idx_session_markers_session    ON session_markers (session_id);
CREATE INDEX idx_session_tombstones_sync    ON session_tombstones (user_id, server_updated_at ASC, session_id ASC);

CREATE INDEX idx_data_source_runs_source_started_at
    ON data_source_runs (source, started_at DESC);

CREATE INDEX idx_list_destinations_dest     ON list_destinations (destination_id);
CREATE INDEX idx_destination_areas_area     ON destination_areas (area_id);
CREATE INDEX route_areas_area_id_idx        ON route_areas (area_id);
CREATE INDEX session_areas_area_id_idx      ON session_areas (area_id);
CREATE INDEX idx_route_destinations_dest    ON route_destinations (destination_id);
CREATE INDEX idx_session_destinations_dest  ON session_destinations (destination_id);
CREATE INDEX idx_session_destination_rejections_dest ON session_destination_rejections (destination_id);
CREATE INDEX idx_session_routes_route       ON session_routes (route_id);

-- =============================================================================
-- Helper function: update updated_at on row modification
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_tracking_session_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    NEW.server_updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION materialize_peaks_route_elevation_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.elevation_string = encode_route_elevation_profile(NEW.path);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION touch_route_elevation_backfill_job()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION touch_route_integrity_repair()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_plans_updated           BEFORE UPDATE ON plans               FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_destinations_updated    BEFORE UPDATE ON destinations       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_areas_updated           BEFORE UPDATE ON areas              FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_lists_updated           BEFORE UPDATE ON lists              FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_routes_updated          BEFORE UPDATE ON routes             FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_tracking_sessions_updated BEFORE UPDATE ON tracking_sessions FOR EACH ROW EXECUTE FUNCTION update_tracking_session_timestamps();
CREATE TRIGGER trg_session_groups_updated  BEFORE UPDATE ON session_groups     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_session_attempt_groups_updated BEFORE UPDATE ON session_attempt_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_routes_materialize_peaks_elevation_profile
BEFORE INSERT OR UPDATE OF path, owner ON routes
FOR EACH ROW
WHEN (NEW.owner = 'peaks')
EXECUTE FUNCTION materialize_peaks_route_elevation_profile();

CREATE TRIGGER trg_route_elevation_backfill_jobs_updated
BEFORE UPDATE ON route_elevation_backfill_jobs
FOR EACH ROW EXECUTE FUNCTION touch_route_elevation_backfill_job();

CREATE TRIGGER trg_route_integrity_repairs_updated
BEFORE UPDATE ON route_integrity_repairs
FOR EACH ROW EXECUTE FUNCTION touch_route_integrity_repair();

CREATE OR REPLACE FUNCTION refresh_area_boundary_parts()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM area_boundary_parts WHERE area_id = NEW.id;
    INSERT INTO area_boundary_parts (area_id, ordinal, boundary_part)
    SELECT NEW.id,
           (row_number() OVER () - 1)::int,
           parts.geom
    FROM ST_Dump(NEW.boundary) AS dumped
    CROSS JOIN LATERAL ST_Subdivide(dumped.geom, 8192) AS parts(geom);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE TRIGGER trg_areas_refresh_boundary_parts
AFTER INSERT OR UPDATE OF boundary ON areas
FOR EACH ROW EXECUTE FUNCTION refresh_area_boundary_parts();

CREATE OR REPLACE FUNCTION touch_related_tracking_session()
RETURNS TRIGGER AS $$
DECLARE
    target_session_id TEXT;
BEGIN
    target_session_id := COALESCE(NEW.session_id, OLD.session_id);

    UPDATE tracking_sessions
    SET server_updated_at = now()
    WHERE id = target_session_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_session_destinations_touch_session
AFTER INSERT OR UPDATE OR DELETE ON session_destinations
FOR EACH ROW EXECUTE FUNCTION touch_related_tracking_session();

CREATE TRIGGER trg_session_areas_touch_session
AFTER INSERT OR UPDATE OR DELETE ON session_areas
FOR EACH ROW EXECUTE FUNCTION touch_related_tracking_session();

CREATE TRIGGER trg_session_routes_touch_session
AFTER INSERT OR UPDATE OR DELETE ON session_routes
FOR EACH ROW EXECUTE FUNCTION touch_related_tracking_session();

CREATE TRIGGER trg_session_markers_touch_session
AFTER INSERT OR UPDATE OR DELETE ON session_markers
FOR EACH ROW EXECUTE FUNCTION touch_related_tracking_session();

-- Link a summit to an area when it is ST_Covers-contained OR within tolerance_m
-- meters of the boundary. PAD-US boundaries and summit coordinates each carry
-- ~10-50 m of positional error, so crest-line peaks (e.g. Mount Whitney, ~0.5 m
-- outside Sequoia NP / Inyo NF / John Muir Wilderness) are missed by strict
-- containment alone. The planar ST_DWithin gate (degrees, GIST-indexed) prunes
-- to near-boundary candidates; the exact geography ST_DWithin makes the precise
-- meter cut. See cloud-sql/migrations/20260613_area_link_tolerance.sql.
CREATE OR REPLACE FUNCTION link_summit_destinations_to_areas(
  replace_existing BOOLEAN DEFAULT false,
  tolerance_m DOUBLE PRECISION DEFAULT 50
)
RETURNS INTEGER AS $$
DECLARE
  inserted_count INTEGER;
  gate_deg DOUBLE PRECISION := GREATEST(tolerance_m / 30000.0, 0.0002);
BEGIN
  IF replace_existing THEN
    DELETE FROM destination_areas WHERE source = 'postgis';
  END IF;

  INSERT INTO destination_areas (destination_id, area_id, relation, source)
  SELECT d.id, a.id, 'contained_by', 'postgis'
  FROM (
    SELECT id, geom, gloc, ST_X(geom) AS lng, ST_Y(geom) AS lat
    FROM (
      SELECT id,
             ST_Force2D(location::geometry) AS geom,
             location::geography AS gloc
      FROM destinations
      WHERE location IS NOT NULL
        AND 'summit'::destination_feature = ANY(features)
    ) summit_points
  ) d
  JOIN LATERAL (
    SELECT id
    FROM areas a
    WHERE d.lng BETWEEN a.bbox_min_lng - gate_deg AND a.bbox_max_lng + gate_deg
      AND d.lat BETWEEN a.bbox_min_lat - gate_deg AND a.bbox_max_lat + gate_deg
      AND ST_DWithin(a.boundary, d.geom, gate_deg)
      AND (
        ST_Covers(a.boundary, d.geom)
        OR ST_DWithin(a.boundary::geography, d.gloc, tolerance_m)
      )
  ) a ON true
  ON CONFLICT (destination_id, area_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;

-- Link routes to the areas their path passes through. A route is a line
-- (routes.path geography(LineStringZ,4326)); ST_Force2D drops the Z and
-- path::geometry is already SRID 4326. The cheap `&&` bbox prefilter prunes
-- candidates before the exact (and, against the large repaired Alaska polygons,
-- costly) ST_Intersects. relation is 'contained_by' when the whole route is
-- covered by the area, else 'intersects'.
-- See cloud-sql/migrations/20260613_route_areas.sql.
CREATE OR REPLACE FUNCTION link_routes_to_areas(replace_existing BOOLEAN DEFAULT false)
RETURNS INTEGER AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  IF replace_existing THEN
    DELETE FROM route_areas WHERE source = 'postgis';
  END IF;

  INSERT INTO route_areas (route_id, area_id, relation, source)
  SELECT r.id, a.id,
         CASE WHEN ST_Covers(a.boundary, r.geom) THEN 'contained_by'
              ELSE 'intersects' END,
         'postgis'
  FROM (
    SELECT id, ST_Force2D(path::geometry) AS geom
    FROM routes
    WHERE path IS NOT NULL
  ) r
  JOIN LATERAL (
    SELECT id, boundary
    FROM areas a
    WHERE a.boundary && r.geom
      AND ST_Intersects(a.boundary, r.geom)
  ) a ON true
  ON CONFLICT (route_id, area_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;

-- Link one route after a route insert or path change. Replacing links removes
-- only PostGIS-generated rows so manual classifications remain intact.
-- See cloud-sql/migrations/20260810_route_area_write_invariant.sql.
CREATE OR REPLACE FUNCTION link_route_to_areas(
  target_route_id TEXT,
  replace_existing BOOLEAN DEFAULT true
)
RETURNS INTEGER AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  IF replace_existing THEN
    DELETE FROM route_areas
    WHERE route_id = target_route_id
      AND source = 'postgis';
  END IF;

  INSERT INTO route_areas (route_id, area_id, relation, source)
  SELECT r.id, a.id,
         CASE WHEN ST_Covers(a.boundary, r.geom) THEN 'contained_by'
              ELSE 'intersects' END,
         'postgis'
  FROM (
    SELECT id, ST_Force2D(path::geometry) AS geom
    FROM routes
    WHERE id = target_route_id
      AND path IS NOT NULL
  ) r
  JOIN LATERAL (
    SELECT DISTINCT part.area_id
    FROM ST_Subdivide(r.geom, 512) AS route_part(geom)
    JOIN area_boundary_parts part
      ON part.boundary_part && route_part.geom
     AND ST_Intersects(part.boundary_part, route_part.geom)
  ) matched_area ON true
  JOIN areas a ON a.id = matched_area.area_id
  ON CONFLICT (route_id, area_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_route_area_links_on_path_write()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM link_route_to_areas(NEW.id, true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_route_link_areas ON routes;
CREATE TRIGGER trg_route_link_areas
AFTER INSERT OR UPDATE OF path ON routes
FOR EACH ROW
EXECUTE FUNCTION refresh_route_area_links_on_path_write();

-- =============================================================================
-- Auto-link sessions when a new destination is inserted
-- Mirrors the destination-matching logic in processSession so that adding a
-- destination retroactively links all ended sessions whose GPS track passes
-- within the feature-appropriate threshold distance.
-- =============================================================================

-- Per-feature reach threshold (meters). IMMUTABLE so Postgres inlines the
-- function during planning — no per-row overhead vs an inline CASE.
-- Source of truth for: link_sessions_on_destination_insert (this file),
-- matchDestinations (cloud-sql/api/src/processing.ts), and
-- backfillDestinationToSessions (web/src/lib/destination-backfill.ts).
CREATE OR REPLACE FUNCTION destination_match_radius(features destination_feature[])
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN 'summit'    = ANY(features) THEN 30
    WHEN 'trailhead' = ANY(features) THEN 100
    WHEN 'waterfall' = ANY(features) THEN 200
    WHEN 'viewpoint' = ANY(features) THEN 200
    WHEN 'campsite'  = ANY(features) THEN 100
    ELSE 50
  END;
$$;

CREATE OR REPLACE FUNCTION link_sessions_on_destination_insert()
RETURNS TRIGGER AS $$
BEGIN
  WITH point_session_candidates AS MATERIALIZED (
    SELECT
      destination.id AS destination_id,
      destination.location AS destination_location,
      destination_match_radius(destination.features) AS radius_m,
      ts.id AS session_id
    FROM new_destinations destination
    JOIN tracking_sessions ts
      ON destination.boundary IS NULL
     AND destination.location IS NOT NULL
     AND ts.ended = true
     AND ts.path IS NOT NULL
     AND ST_DWithin(
       destination.location,
       ts.path,
       destination_match_radius(destination.features)
     )
  ), point_matches AS MATERIALIZED (
    SELECT candidate.session_id, candidate.destination_id
    FROM point_session_candidates candidate
    JOIN LATERAL (
      SELECT 1
      FROM tracking_points tp
      WHERE tp.session_id = candidate.session_id
        AND tp.location IS NOT NULL
        AND ST_DWithin(
          candidate.destination_location,
          tp.location,
          candidate.radius_m
        )
      LIMIT 1
    ) proof ON true
  ), boundary_session_candidates AS MATERIALIZED (
    SELECT
      destination.id AS destination_id,
      destination.boundary,
      ts.id AS session_id
    FROM new_destinations destination
    JOIN tracking_sessions ts
      ON destination.boundary IS NOT NULL
     AND ts.ended = true
     AND ts.path IS NOT NULL
     AND ST_DWithin(destination.boundary::geography, ts.path, 10)
  ), boundary_matches AS MATERIALIZED (
    SELECT candidate.session_id, candidate.destination_id
    FROM boundary_session_candidates candidate
    JOIN LATERAL (
      SELECT 1
      FROM tracking_points tp
      WHERE tp.session_id = candidate.session_id
        AND tp.location IS NOT NULL
        AND ST_DWithin(candidate.boundary::geography, tp.location, 10)
      LIMIT 1
    ) proof ON true
  ), matches AS (
    SELECT * FROM point_matches
    UNION ALL
    SELECT * FROM boundary_matches
  )
  INSERT INTO session_destinations (session_id, destination_id, relation, source)
  SELECT DISTINCT
    matches.session_id,
    matches.destination_id,
    'reached'::session_destination_relation,
    'auto'
  FROM matches
  -- The user's "I didn't reach this" veto. Same anti-join as
  -- buildSessionDestinationMatchSql (api/src/processing.ts) and
  -- backfillDestinationToSessions (web/src/lib/destination-backfill.ts) —
  -- scripts/check-cross-refs.sh fails CI if one of the three drops it.
  WHERE NOT EXISTS (
    SELECT 1 FROM session_destination_rejections r
    WHERE r.session_id = matches.session_id
      AND r.destination_id = matches.destination_id
  )
  ON CONFLICT (session_id, destination_id) DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_destination_link_sessions
AFTER INSERT ON destinations
REFERENCING NEW TABLE AS new_destinations
FOR EACH STATEMENT
EXECUTE FUNCTION link_sessions_on_destination_insert();

-- =============================================================================
-- Flag incoming recordings against protected areas
-- When a recording reaches a summit (session_destinations relation='reached'),
-- link that summit to its containing/adjacent protected areas using the same
-- containment + 50 m tolerance as link_summit_destinations_to_areas(). Wrapped
-- so a linking failure can never abort the insert (recording ingestion).
-- See cloud-sql/migrations/20260613_area_link_on_session_destination.sql.
-- =============================================================================
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
      AND d.country_code = 'US'
      AND d.location IS NOT NULL
      AND 'summit'::destination_feature = ANY(d.features)
    ON CONFLICT (destination_id, area_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'link_areas_on_session_destination_insert failed: %', SQLERRM;
  END;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_session_destination_link_areas
AFTER INSERT ON session_destinations
REFERENCING NEW TABLE AS new_session_destinations
FOR EACH STATEMENT
EXECUTE FUNCTION link_areas_on_session_destination_insert();

-- Flag a new summit with its protected areas at creation time (closes the gap
-- for summits added after the backfill that are never reached by a recording).
-- See cloud-sql/migrations/20260613_area_link_on_destination.sql.
CREATE OR REPLACE FUNCTION link_areas_on_destination_insert()
RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    WITH bounds AS MATERIALIZED (
      SELECT ST_Expand(
               ST_Envelope(ST_Collect(ST_Force2D(d.location::geometry))),
               2
             ) AS geom
      FROM new_destinations d
      WHERE d.country_code = 'US'
        AND d.location IS NOT NULL
        AND 'summit'::destination_feature = ANY(d.features)
    ), candidate_areas AS MATERIALIZED (
      SELECT a.id, a.boundary
      FROM areas a
      CROSS JOIN bounds b
      WHERE a.boundary && b.geom
    )
    INSERT INTO destination_areas (destination_id, area_id, relation, source)
    SELECT d.id, a.id, 'contained_by', 'postgis'
    FROM new_destinations d
    JOIN candidate_areas a
      ON ST_DWithin(
           a.boundary,
           ST_Force2D(d.location::geometry),
           0.0016666666666666668
         )
    CROSS JOIN LATERAL (
      SELECT ST_Force2D(d.location::geometry) AS geom, d.location::geography AS gloc
    ) p
    WHERE d.country_code = 'US'
      AND d.location IS NOT NULL
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

CREATE TRIGGER trg_destination_link_areas
AFTER INSERT ON destinations
REFERENCING NEW TABLE AS new_destinations
FOR EACH STATEMENT
EXECUTE FUNCTION link_areas_on_destination_insert();

-- =============================================================================
-- Views
-- =============================================================================

-- One row per source that has ever run: the latest finished_at of a
-- successful, non-dry-run 'import' or 'normalize' run, how many days old
-- that is, and whether it has gone stale (no such run in the last 90 days).
-- A source with no successful run yet still gets a row, with a NULL
-- last_successful_at and is_stale = true.
CREATE OR REPLACE VIEW data_source_freshness AS
WITH successful_runs AS (
    SELECT source, MAX(finished_at) AS last_successful_at
    FROM data_source_runs
    WHERE run_kind IN ('import', 'normalize')
      AND status = 'success'
      AND finished_at IS NOT NULL
    GROUP BY source
)
SELECT
    known.source,
    successful_runs.last_successful_at,
    EXTRACT(DAY FROM (now() - successful_runs.last_successful_at))::INT AS days_stale,
    (
        successful_runs.last_successful_at IS NULL
        OR successful_runs.last_successful_at < now() - INTERVAL '90 days'
    ) AS is_stale
FROM (SELECT DISTINCT source FROM data_source_runs) AS known
LEFT JOIN successful_runs ON successful_runs.source = known.source;

-- =============================================================================
-- Example Queries (reference, not executed)
-- =============================================================================

-- 1. Nearby destinations within 10km of a point
--    SELECT * FROM destinations
--    WHERE ST_DWithin(location, ST_MakePoint(-121.7, 46.85)::geography, 10000);

-- 2. Fuzzy destination search with geo-biased ranking
--    SELECT *, similarity(search_name, 'mt ranier') AS sim
--    FROM destinations
--    WHERE search_name % 'mt ranier'
--    ORDER BY sim DESC, ST_Distance(location, ST_MakePoint(-121.7, 46.85)::geography) ASC
--    LIMIT 20;

-- 3. Route elevation profile
--    SELECT (dp).path[1] AS vertex_index,
--           ST_X((dp).geom) AS lng,
--           ST_Y((dp).geom) AS lat,
--           ST_Z((dp).geom) AS elevation
--    FROM (SELECT ST_DumpPoints(path::geometry) AS dp FROM routes WHERE id = 'route_123') sub
--    ORDER BY vertex_index;

-- 4. All points for a session (elevation profile by time)
--    SELECT time, elevation, speed
--    FROM tracking_points
--    WHERE session_id = 'session_123'
--    ORDER BY time;

-- 5. Dedup check on import
--    SELECT id FROM tracking_sessions
--    WHERE source = 'strava' AND external_id = '12345';

-- 6. User sessions by date
--    SELECT * FROM tracking_sessions
--    WHERE user_id = 'uid_abc'
--    ORDER BY start_time DESC;

-- 7. Map viewport (bounding box query)
--    SELECT * FROM destinations
--    WHERE ST_Intersects(location,
--      ST_MakeEnvelope(-122.0, 46.5, -121.0, 47.0, 4326)::geography);

-- 8. Filter destinations by feature + activity
--    SELECT * FROM destinations
--    WHERE features @> '{summit}'
--      AND activities @> '{outdoor-trek}';
