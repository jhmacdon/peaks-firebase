-- Let the route factory review a replacement before it removes a legacy
-- standard route from public results.
--
-- The new route remains pending through review. Publication then marks the old
-- route superseded and the approved route active in one transaction. Existing
-- plan and session links to the old route remain intact.

BEGIN;

ALTER TABLE routes
  DROP CONSTRAINT IF EXISTS routes_status_check;

ALTER TABLE routes
  ADD CONSTRAINT routes_status_check
  CHECK (status IN ('pending', 'active', 'superseded'));

ALTER TABLE standard_route_backfill_jobs
  ADD COLUMN IF NOT EXISTS replacement_route_id
    TEXT REFERENCES routes(id) ON DELETE SET NULL;

UPDATE standard_route_backfill_jobs j
SET replacement_route_id = j.published_route_id
FROM routes r
WHERE j.replacement_route_id IS NULL
  AND j.published_route_id = r.id
  AND j.state <> 'verified'
  AND r.owner = 'peaks'
  AND r.status = 'active'
  AND (
    NOT is_valid_route_provenance(r.provenance)
    OR NOT EXISTS (
      SELECT 1
      FROM route_segments rs
      JOIN segments s ON s.id = rs.segment_id
      WHERE rs.route_id = r.id
        AND s.path IS NOT NULL
        AND s.provenance IS NOT DISTINCT FROM r.provenance
    )
  );

COMMIT;
