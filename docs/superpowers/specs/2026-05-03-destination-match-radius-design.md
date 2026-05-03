# Per-Feature Destination Match Radius

**Date:** 2026-05-03
**Status:** Approved

## Goal

Give `waterfall` and `viewpoint` destinations a generous "reached" radius (200m) so the auto-link trigger credits hikers who saw the destination, not just those who stood on its OSM coordinate. Centralize the per-feature radius lookup as a single Postgres function so future tuning touches one place instead of three.

## Rationale

Both `waterfall` and `viewpoint` are "destination = visible thing" features: a hiker has effectively reached them when they can see what the destination represents, which can be 100-300m away. The current 50m default treats them as point-precise the way summits and trailheads are, missing the case "I came around the bend, saw the falls, took a photo, and turned around" that's common for waterfalls and is the entire point of viewpoints.

The CASE expression that drives radius today is duplicated across three call sites (the auto-link trigger function, the web-side backfill helper, and the API session-processing query). Adding two more cases to all three is the wrong direction; centralizing is the right time.

## Scope

### In scope

- New SQL function `destination_match_radius(features destination_feature[]) RETURNS int LANGUAGE sql IMMUTABLE`.
- Migration that defines the function, updates the auto-link trigger function body to call it, and backfills `session_destinations` for the 430 already-imported WA waterfall destinations using the new 200m radius.
- Schema update (`cloud-sql/schema.sql`) so a from-scratch DB build matches the migrated state.
- Update of two TypeScript-side call sites (`web/src/lib/destination-backfill.ts`, `cloud-sql/api/src/processing.ts`) to call the new function instead of inlining the CASE.
- Verification SQL post-migration.

### Out of scope

- Tuning radii for `lake`, `hut`, `volcano`, `landform`, `lookout`, `fire-lookout` — they stay at the existing default (50m).
- Per-destination radius overrides (e.g., a column on the destinations table for tall-falls vs short-falls). Future work; not justified by current feedback.
- Re-firing the trigger via PG-level replay. The explicit backfill INSERT is simpler and more auditable.
- Backfilling `session_destinations` for viewpoints — there are zero viewpoint destinations in production today, so nothing to backfill.

## Radius values

| Feature | Old radius | New radius | Reason |
|---|---|---|---|
| `summit` | 30m | 30m (no change) | Must be on top |
| `trailhead` | 100m | 100m (no change) | Parking lot variance |
| `waterfall` | 50m (default) | **200m** | Visible/audible from a distance |
| `viewpoint` | 50m (default) | **200m** | Defined by what it shows, not where it is |
| (boundary present) | 10m of polygon | 10m of polygon (no change) | Polygon already encodes shape |
| (everything else) | 50m | 50m (no change) | Default |

200m is the chosen middle ground:
- Wider (300-500m) starts crediting hikers on parallel trails or in adjacent valleys, which we explicitly do not want.
- Narrower (100m) misses the "saw it from up the trail" case that motivates the change.

Asymmetric radii (e.g., 300m for waterfall, 200m for viewpoint) are deliberately avoided — there's no signal that distinguishing them helps anyone today, and the function is trivial to retune later if data shows it matters.

## Architecture

### New SQL function

```sql
CREATE OR REPLACE FUNCTION destination_match_radius(features destination_feature[])
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN 'summit'    = ANY(features) THEN 30
    WHEN 'trailhead' = ANY(features) THEN 100
    WHEN 'waterfall' = ANY(features) THEN 200
    WHEN 'viewpoint' = ANY(features) THEN 200
    ELSE 50
  END;
$$;
```

`IMMUTABLE` lets Postgres inline the function during planning — no measurable per-row overhead vs the inline CASE expression. The `LANGUAGE sql` (rather than `plpgsql`) keeps it body-pure so the planner can fold it.

### Trigger function update

`link_sessions_on_destination_insert` (currently in `cloud-sql/schema.sql:516-537`) becomes:

```sql
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
            ELSE ST_DWithin(NEW.location, tp.location, destination_match_radius(NEW.features))
          END
    ON CONFLICT (session_id, destination_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

The boundary fallback (10m of polygon) stays inline — it's structurally different (geometry vs distance threshold) and would not benefit from being part of `destination_match_radius`.

### Web backfill helper update

`web/src/lib/destination-backfill.ts:33-39`: replace the inline CASE in the SQL with `destination_match_radius(d.features)`. Update the JSDoc comment block above the function (lines 13-17) to reference the function instead of repeating the radius table.

### API session-processing update

`cloud-sql/api/src/processing.ts:34-42` (the `matchDestinations` function): same inline-CASE replacement. Update the comment at lines 21-22 (`Per-feature thresholds: ...`) to point to the SQL function as the source of truth.

### Backfill SQL (runs as part of the migration)

```sql
INSERT INTO session_destinations (session_id, destination_id, relation, source)
SELECT s.id, d.id, 'reached', 'auto'
FROM tracking_sessions s
JOIN destinations d ON (d.owner = 'peaks' OR d.owner = s.user_id)
WHERE 'waterfall' = ANY(d.features)
  AND s.path IS NOT NULL
  AND ST_DWithin(s.path, d.location, 200)
ON CONFLICT (session_id, destination_id) DO NOTHING;
```

Why this is safe and correct:
- `ON CONFLICT DO NOTHING` makes it idempotent — re-running the migration won't duplicate rows.
- The 200m hardcoded value matches the function's new waterfall radius; using `destination_match_radius(d.features)` here would also work but the literal makes the intent of this one-shot backfill clearer in the migration history.
- No viewpoint backfill needed (zero viewpoint destinations exist today).
- Does NOT trigger `link_sessions_on_destination_insert` because that's an INSERT trigger on `destinations`, not `session_destinations`.

## Files

**Create:**
- `cloud-sql/migrations/20260503_destination_match_radius.sql` — defines the function, updates the trigger function body, runs the waterfall backfill INSERT.

**Modify:**
- `cloud-sql/schema.sql` — add the function definition immediately above the existing `link_sessions_on_destination_insert` definition; update the trigger function body to use it.
- `cloud-sql/api/src/processing.ts` — replace inline CASE with the function call; update the comment that lists per-feature thresholds.
- `web/src/lib/destination-backfill.ts` — same replacement; same comment update.

## Verification

1. Apply migration via the Cloud SQL Auth Proxy (same flow as previous migrations).
2. Confirm function exists and returns expected values:
   ```sql
   SELECT destination_match_radius(ARRAY['summit']::destination_feature[]);    -- 30
   SELECT destination_match_radius(ARRAY['trailhead']::destination_feature[]); -- 100
   SELECT destination_match_radius(ARRAY['waterfall']::destination_feature[]); -- 200
   SELECT destination_match_radius(ARRAY['viewpoint']::destination_feature[]); -- 200
   SELECT destination_match_radius(ARRAY['lake']::destination_feature[]);      -- 50
   SELECT destination_match_radius('{}'::destination_feature[]);               -- 50
   ```
3. Confirm the auto-link trigger still works for non-waterfall inserts (no regression). Insert a test summit destination near a known session; verify the link gets created.
4. Confirm the backfill credited additional sessions. **Capture the count BEFORE applying the migration**:
   ```sql
   SELECT count(*) FROM session_destinations sd
   JOIN destinations d ON d.id = sd.destination_id
   WHERE 'waterfall' = ANY(d.features) AND d.state_code = 'WA';
   ```
   After migration, re-run the same query. Difference = sessions newly credited by the 200m radius. Expected: small but non-zero, since prior to today the waterfall feature didn't exist so very few hikes have been auto-linked at all.
5. Spot-check Snoqualmie Falls (it's a high-traffic destination, likely sessions exist near it): `SELECT count(*) FROM session_destinations WHERE destination_id = (SELECT id FROM destinations WHERE name = 'Snoqualmie Falls' LIMIT 1);`
6. After deploy, verify the API session-processing path also uses the new radius (process a fresh test session and confirm waterfall matching at >50m works).
7. `cd web && npm run build && npm run lint`; `cd cloud-sql/api && npm run build && npm run lint && npm test` (ensures the BIGINT-parser regression test still passes).

## Risks

- **Radius too generous in dense waterfall corridors**: The Columbia River Gorge has multiple waterfalls within ~400m of each other. A single hike past one might now credit two adjacent waterfalls. Acceptable tradeoff — those hikes did pass through the visible-distance zone of both — but worth flagging if user feedback later says it feels wrong.
- **Trigger function replacement is online**: `CREATE OR REPLACE FUNCTION` swaps the function body atomically; new inserts immediately use the new logic. No downtime.
- **Backfill INSERT scans tracking_sessions × waterfall destinations**: 5924 destinations × ~hundreds of sessions × spatial join, gated by GIST index on `tracking_sessions.path`. Sub-second total based on similar prior backfills.
- **The IMMUTABLE marker on `destination_match_radius` is correct only because the function depends on its argument and nothing else** (no GUC, no table reads, no `now()`). If a future change introduces non-determinism, the marker must be downgraded to `STABLE` or `VOLATILE` or query plans will silently use stale results.
