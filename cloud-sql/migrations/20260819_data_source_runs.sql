-- Durable log of automated trailhead data-source runs (fetch / normalize /
-- import / check), so freshness of parking, road-access, and bathroom facts
-- can be tracked and reported instead of inferred from destinations.updated_at
-- — which changes on any row edit, not just a source refresh.
--
-- One row per run attempt. status = 'dry_run' covers a run that touched no
-- data on purpose (several cloud-sql/migrate importers already take a
-- --dry-run flag); data_source_freshness deliberately excludes it so a dry
-- run can never make a source look fresh.
--
-- data_source_freshness reports one row per source that has ever run: the
-- latest finished_at of a successful, non-dry-run 'import' or 'normalize'
-- run, how many days old that is, and whether it has gone stale (no such run
-- in the last 90 days). A source with no successful run yet still gets a row,
-- with a NULL last_successful_at and is_stale = true.
--
-- Apply manually as postgres (CI does not run migrations):
--   psql -h 127.0.0.1 -U postgres -d peaks -f cloud-sql/migrations/20260819_data_source_runs.sql

BEGIN;

CREATE TABLE IF NOT EXISTS data_source_runs (
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

CREATE INDEX IF NOT EXISTS idx_data_source_runs_source_started_at
    ON data_source_runs (source, started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON data_source_runs TO "peaks-api";
GRANT USAGE, SELECT ON SEQUENCE data_source_runs_id_seq TO "peaks-api";

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

GRANT SELECT ON data_source_freshness TO "peaks-api";

COMMIT;
