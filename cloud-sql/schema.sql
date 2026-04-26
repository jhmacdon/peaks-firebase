-- Peaks PostGIS Schema
-- Cloud SQL for PostgreSQL 15+ with PostGIS + pg_trgm
-- All geographic types use geography (spherical, meters) not geometry (planar)
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
CREATE TYPE destination_feature AS ENUM ('volcano', 'fire-lookout', 'summit', 'trailhead', 'hut', 'lookout', 'lake');
CREATE TYPE completion_mode AS ENUM ('none', 'straight', 'reverse');
CREATE TYPE route_shape AS ENUM ('out_and_back', 'loop', 'point_to_point', 'lollipop');
CREATE TYPE session_destination_relation AS ENUM ('reached', 'goal');

-- =============================================================================
-- Tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- destinations
-- Peaks, trailheads, and other points of interest.
-- PointZ carries elevation as Z coordinate for consistency, but elevation
-- is also stored as a plain column for non-spatial queries and indexing.
-- ---------------------------------------------------------------------------
CREATE TABLE destinations (
    id              TEXT PRIMARY KEY,
    name            TEXT,
    search_name     TEXT,              -- lowercased, normalized for trigram search
    elevation       DOUBLE PRECISION,  -- meters
    prominence      DOUBLE PRECISION,  -- meters
    location        geography(PointZ, 4326),
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

    -- activity averages (denormalized stats: popularity by month/day)
    averages        JSONB,             -- { months: {jan: 5, ...}, days: {mo: 3, ...}, lastUpdated: "..." }

    -- historical offsets from Firestore (pre-migration data not in session_destinations)
    session_count_offset INT NOT NULL DEFAULT 0,
    success_count_offset INT NOT NULL DEFAULT 0,
    averages_offset      JSONB,        -- same shape as averages; merged with averages in API responses

    -- source-specific metadata (e.g. CAI shelter details, import provenance)
    metadata        JSONB,

    explicitly_saved BOOLEAN NOT NULL DEFAULT FALSE,
    recency         TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- lists
-- User-curated collections of destinations (e.g. "Washington Volcanos").
-- ---------------------------------------------------------------------------
CREATE TABLE lists (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    owner           TEXT NOT NULL DEFAULT 'peaks',

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

    -- external references
    external_links  JSONB,             -- [{ type: "wta", id: "..." }, { type: "usfs", id: "..." }]

    completion      completion_mode NOT NULL DEFAULT 'none',
    shape           route_shape,       -- out_and_back, loop, point_to_point, lollipop
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active')),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
-- route_destinations
-- Join table: which destinations a route visits, with ordering.
-- ---------------------------------------------------------------------------
CREATE TABLE route_destinations (
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    ordinal         INT NOT NULL DEFAULT 0,
    PRIMARY KEY (route_id, destination_id)
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
-- Groups repeated attempts of the same climb/route by a user.
-- ---------------------------------------------------------------------------
CREATE TABLE session_groups (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    name            TEXT,
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

    -- health metrics time series
    health_data     JSONB,             -- { calories: [{date, calories}], heartRates: [{date, heartRate}] }

    -- processing
    group_id        TEXT REFERENCES session_groups(id) ON DELETE SET NULL,
    processed_at    TIMESTAMPTZ,
    processing_state TEXT NOT NULL DEFAULT 'idle'
        CHECK (processing_state IN ('idle', 'pending', 'processing', 'completed', 'failed')),
    processing_error TEXT,

    -- status flags
    ended           BOOLEAN NOT NULL DEFAULT FALSE,
    is_public       BOOLEAN NOT NULL DEFAULT FALSE,
    uploaded_to_strava BOOLEAN NOT NULL DEFAULT FALSE,

    -- Materialized GPS track (LineStringZ from tracking_points ORDER BY time).
    -- Populated by processSession; used for destination matching, route
    -- matching, and reverse-matching new destinations against historical
    -- sessions in a single GIST-indexed query.
    path            GEOGRAPHY(LineStringZ, 4326),

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
    time            BIGINT NOT NULL,   -- Unix timestamp in milliseconds
    segment_number  INT NOT NULL DEFAULT 0,

    location        geography(PointZ, 4326),
    elevation       DOUBLE PRECISION,  -- denormalized Z for fast non-spatial queries

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
-- session_routes
-- Which routes were followed during a session.
-- ---------------------------------------------------------------------------
CREATE TABLE session_routes (
    session_id      TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
    coverage        DOUBLE PRECISION,
    PRIMARY KEY (session_id, route_id)
);

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

-- =============================================================================
-- Indexes
-- =============================================================================

-- Spatial (GIST) on all geography columns
CREATE INDEX idx_destinations_location      ON destinations USING GIST (location);
CREATE INDEX idx_destinations_boundary      ON destinations USING GIST (boundary) WHERE boundary IS NOT NULL;
CREATE INDEX idx_routes_path                ON routes       USING GIST (path);
CREATE INDEX idx_tracking_points_location   ON tracking_points USING GIST (location);
CREATE INDEX idx_session_markers_location   ON session_markers USING GIST (location);

-- Trigram (GIN) for fuzzy text search on destinations
CREATE INDEX idx_destinations_search_name   ON destinations USING GIN (search_name gin_trgm_ops);

-- GIN on array columns for containment queries (e.g. WHERE features @> '{summit}')
CREATE INDEX idx_destinations_features      ON destinations USING GIN (features);
CREATE INDEX idx_destinations_activities    ON destinations USING GIN (activities);

-- B-tree for common lookups and foreign keys
CREATE INDEX idx_destinations_owner         ON destinations (owner);
CREATE INDEX idx_destinations_type          ON destinations (type);

CREATE INDEX idx_routes_owner               ON routes (owner);

CREATE INDEX idx_plans_user_id              ON plans (user_id, updated_at DESC);
CREATE INDEX idx_plan_destinations_dest     ON plan_destinations (destination_id);
CREATE INDEX idx_plan_routes_route          ON plan_routes (route_id);
CREATE INDEX idx_plan_party_user            ON plan_party (user_id);

CREATE INDEX idx_session_groups_user_id     ON session_groups (user_id);
CREATE INDEX idx_tracking_sessions_user_id  ON tracking_sessions (user_id, start_time DESC);
CREATE INDEX idx_tracking_sessions_group    ON tracking_sessions (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX idx_tracking_sessions_dedup    ON tracking_sessions (source, external_id)
    WHERE source IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX idx_tracking_sessions_sync     ON tracking_sessions (user_id, server_updated_at ASC, id ASC);
CREATE INDEX idx_tracking_sessions_processing ON tracking_sessions (user_id, processing_state, server_updated_at DESC);

CREATE INDEX idx_session_markers_session    ON session_markers (session_id);
CREATE INDEX idx_session_tombstones_sync    ON session_tombstones (user_id, server_updated_at ASC, session_id ASC);

CREATE INDEX idx_list_destinations_dest     ON list_destinations (destination_id);
CREATE INDEX idx_route_destinations_dest    ON route_destinations (destination_id);
CREATE INDEX idx_session_destinations_dest  ON session_destinations (destination_id);
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

CREATE TRIGGER trg_plans_updated           BEFORE UPDATE ON plans               FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_destinations_updated    BEFORE UPDATE ON destinations       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_lists_updated           BEFORE UPDATE ON lists              FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_routes_updated          BEFORE UPDATE ON routes             FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_tracking_sessions_updated BEFORE UPDATE ON tracking_sessions FOR EACH ROW EXECUTE FUNCTION update_tracking_session_timestamps();
CREATE TRIGGER trg_session_groups_updated  BEFORE UPDATE ON session_groups     FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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

CREATE TRIGGER trg_session_routes_touch_session
AFTER INSERT OR UPDATE OR DELETE ON session_routes
FOR EACH ROW EXECUTE FUNCTION touch_related_tracking_session();

CREATE TRIGGER trg_session_markers_touch_session
AFTER INSERT OR UPDATE OR DELETE ON session_markers
FOR EACH ROW EXECUTE FUNCTION touch_related_tracking_session();

-- =============================================================================
-- Auto-link sessions when a new destination is inserted
-- Mirrors the destination-matching logic in processSession so that adding a
-- destination retroactively links all ended sessions whose GPS track passes
-- within the feature-appropriate threshold distance.
-- =============================================================================

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
            ELSE ST_DWithin(
                   NEW.location,
                   tp.location,
                   CASE WHEN 'summit'    = ANY(NEW.features) THEN 30
                        WHEN 'trailhead' = ANY(NEW.features) THEN 100
                        ELSE 50 END
                 )
          END
    ON CONFLICT (session_id, destination_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_destination_link_sessions
AFTER INSERT ON destinations
FOR EACH ROW EXECUTE FUNCTION link_sessions_on_destination_insert();

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
