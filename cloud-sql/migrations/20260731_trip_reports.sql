-- Trip Reports cutover target.
--
-- Deployment order:
--   1. Apply this migration.
--   2. Run the idempotent Firestore import and verify its audit counts.
--   3. Deploy the API/web cutover.
--   4. Release the iOS client.
--
-- The IF NOT EXISTS form also lets the disposable test database apply this
-- after schema.sql, where the same definitions form the maintained baseline.

CREATE TABLE IF NOT EXISTS trip_reports (
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

CREATE TABLE IF NOT EXISTS trip_report_conditions (
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

CREATE TABLE IF NOT EXISTS trip_report_photos (
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

CREATE TABLE IF NOT EXISTS trip_report_destinations (
    report_id       TEXT NOT NULL REFERENCES trip_reports(id) ON DELETE CASCADE,
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    PRIMARY KEY (report_id, destination_id)
);

CREATE TABLE IF NOT EXISTS trip_report_routes (
    report_id       TEXT NOT NULL REFERENCES trip_reports(id) ON DELETE CASCADE,
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    PRIMARY KEY (report_id, route_id)
);

CREATE TABLE IF NOT EXISTS trip_report_flags (
    report_id       TEXT NOT NULL REFERENCES trip_reports(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL,
    reason          TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (report_id, user_id)
);

CREATE TABLE IF NOT EXISTS trip_report_photo_deletions (
    storage_path    TEXT PRIMARY KEY,
    queued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts        INT NOT NULL DEFAULT 0,
    last_error      TEXT
);

CREATE INDEX IF NOT EXISTS idx_trip_reports_recent
    ON trip_reports (activity_date DESC, id DESC)
    WHERE moderation_state = 'published';
CREATE INDEX IF NOT EXISTS idx_trip_report_destinations_destination
    ON trip_report_destinations (destination_id, report_id);
CREATE INDEX IF NOT EXISTS idx_trip_report_routes_route
    ON trip_report_routes (route_id, report_id);
CREATE INDEX IF NOT EXISTS idx_trip_report_photos_report
    ON trip_report_photos (report_id, ordinal);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peaks-api') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE
            ON trip_reports,
               trip_report_conditions,
               trip_report_photos,
               trip_report_destinations,
               trip_report_routes,
               trip_report_flags,
               trip_report_photo_deletions
            TO "peaks-api"';
    END IF;
END
$$;
