-- Parent/sub-area relationships for protected areas.
--
-- PAD-US ships overlapping designations as independent records: Olympic
-- National Park (NPS) and the Daniel J. Evans Wilderness Area (NPS), whose
-- boundary is ~95% of the park's interior. Clients showed both as peer
-- areas with near-identical peaks/sessions.
--
-- `parent_area_id` marks an area as a sub-area of a national park when at
-- least 90% of its (display) footprint lies inside that park. Clients keep
-- showing the park and demote the child to "within <park>". Containment is
-- computed on boundary_display (planar, degree^2 ratio) — the areas being
-- compared are co-located, so the ratio matches the true areal fraction to
-- well within the 90% threshold's slack.
--
-- Only national parks are parents for now: for USFS land the wilderness is
-- usually the name people know (Alpine Lakes), so demoting wilderness under
-- national forests would hide the meaningful name.
--
-- Run as postgres. Re-run the UPDATE after a PAD-US re-import (boundaries
-- can shift); it is idempotent.

ALTER TABLE areas ADD COLUMN IF NOT EXISTS parent_area_id TEXT REFERENCES areas(id);

CREATE INDEX IF NOT EXISTS idx_areas_parent_area_id
  ON areas(parent_area_id) WHERE parent_area_id IS NOT NULL;

COMMENT ON COLUMN areas.parent_area_id IS
  'National park containing >=90% of this area''s footprint. Sub-areas are demoted in client listings in favor of the parent.';

UPDATE areas
SET parent_area_id = sub.parent_id
FROM (
  SELECT c.id AS child_id,
         (SELECT p.id
          FROM areas p
          WHERE p.kind = 'national_park'
            AND p.id <> c.id
            AND p.boundary_display && c.boundary_display
            AND ST_Area(ST_Intersection(p.boundary_display, c.boundary_display))
                >= 0.9 * ST_Area(c.boundary_display)
          ORDER BY ST_Area(p.boundary_display) ASC
          LIMIT 1) AS parent_id
  FROM areas c
  WHERE c.kind <> 'national_park'
    AND c.boundary_display IS NOT NULL
) sub
WHERE areas.id = sub.child_id
  AND areas.parent_area_id IS DISTINCT FROM sub.parent_id
  AND sub.parent_id IS NOT NULL;
