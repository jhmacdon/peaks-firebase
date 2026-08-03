-- Durable repair ledger for active Peaks routes whose linked summits do not
-- meet the five-metre path contact rule. This is storage and on-demand CLI
-- work only; expected backend run-rate change: near $0/month.

BEGIN;

CREATE TABLE IF NOT EXISTS route_integrity_repairs (
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
    (state = 'covered'
      AND replacement_route_id IS NOT NULL
      AND covered_at IS NOT NULL)
    OR
    (state <> 'covered'
      AND replacement_route_id IS NULL
      AND covered_at IS NULL)
  ),
  CONSTRAINT route_integrity_repairs_retired_check CHECK (
    state <> 'retired' OR last_error IS NULL
  )
);

CREATE OR REPLACE FUNCTION touch_route_integrity_repair()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_route_integrity_repairs_updated
  ON route_integrity_repairs;

CREATE TRIGGER trg_route_integrity_repairs_updated
BEFORE UPDATE ON route_integrity_repairs
FOR EACH ROW EXECUTE FUNCTION touch_route_integrity_repair();

CREATE INDEX IF NOT EXISTS idx_route_integrity_repairs_claim
  ON route_integrity_repairs (state, created_at, route_id, destination_id)
  WHERE state = 'queued';

CREATE INDEX IF NOT EXISTS idx_route_integrity_repairs_destination
  ON route_integrity_repairs (destination_id, state, created_at, route_id);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON route_integrity_repairs TO "peaks-api";

COMMENT ON TABLE route_integrity_repairs IS
  'Active bad routes seed every linked summit. Inactive routes retain covered history; other rows retire.';

COMMIT;
