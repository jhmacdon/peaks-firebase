-- HRRR-Smoke point samples at upcoming plan locations.
-- Written by the peaks-smoke-job Cloud Run Job 4x/day; read by
-- GET /api/plans/:id/air-quality. Rows are keyed by ~3 km grid cell
-- (cell_key = "{round(lat/0.03)}:{round(lng/0.03)}") and forecast valid hour.
-- Design: docs/superpowers/specs/2026-08-06-plan-air-quality-design.md
--
-- Apply manually as postgres (CI does not run migrations):
--   psql -h 127.0.0.1 -U postgres -d peaks -f cloud-sql/migrations/20260806_smoke_forecasts.sql

BEGIN;

CREATE TABLE IF NOT EXISTS smoke_forecasts (
    cell_key     TEXT NOT NULL,
    valid_at     TIMESTAMPTZ NOT NULL,
    run_at       TIMESTAMPTZ NOT NULL,
    smoke_ug_m3  DOUBLE PRECISION NOT NULL,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (cell_key, valid_at)
);

CREATE INDEX IF NOT EXISTS idx_smoke_forecasts_valid_at
    ON smoke_forecasts (valid_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON smoke_forecasts TO "peaks-api";

COMMIT;
