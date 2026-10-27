-- Trail grid cells the HRRR smoke job samples alongside upcoming plans.
-- Written by GET /api/routes/:id/air-quality (refreshed at most hourly per
-- cell); read and pruned after 72 hours by the peaks-smoke-job Cloud Run Job.
-- cell_key matches smoke_forecasts: "{round(lat/0.03)}:{round(lng/0.03)}",
-- with lat/lng at the cell center.
--
-- Apply manually as postgres before deploying the API or the smoke job
-- (CI does not run migrations):
--   psql -h 127.0.0.1 -U postgres -d peaks -f cloud-sql/migrations/20261027_smoke_sample_cells.sql

BEGIN;

CREATE TABLE IF NOT EXISTS smoke_sample_cells (
    cell_key      TEXT PRIMARY KEY,
    lat           DOUBLE PRECISION NOT NULL,
    lng           DOUBLE PRECISION NOT NULL,
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smoke_sample_cells_requested_at
    ON smoke_sample_cells (requested_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON smoke_sample_cells TO "peaks-api";

COMMIT;
