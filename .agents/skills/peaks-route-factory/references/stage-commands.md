# Stage commands

Run every command from the firebase repo root. Replace angle-bracket values
only with fields from the claimed job or saved result.

## Common

```bash
.agents/skills/peaks-route-factory/scripts/route_jobs.sh \
  heartbeat --lease-token <lease-token> --lease-minutes 90
```

## Research

Create the small worker directories:

```bash
mkdir -p /private/tmp/peaks-route-worker \
  cloud-sql/migrate/route-candidates/luna
```

Create the candidate in
`cloud-sql/migrate/route-candidates/luna/<destination-id>.geojson`. Read the
standard-route backfill skill, then use one complete builder command.

For researched OSM way IDs:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-standard-route-backfill/scripts/build_osm_route_candidate.mts \
  --destination-id <destination-id> --trailhead-id <trailhead-id> \
  --way-ids <comma-separated-osm-way-ids> \
  --format geojson \
  --output cloud-sql/migrate/route-candidates/luna/<destination-id>.geojson
```

For researched USGS National Map object IDs:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-standard-route-backfill/scripts/build_usgs_route_candidate.mts \
  --destination-id <destination-id> --trailhead-id <trailhead-id> \
  --object-id <object-id> \
  --output cloud-sql/migrate/route-candidates/luna/<destination-id>.geojson
```

Repeat `--object-id` for each USGS object. Render every candidate:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-standard-route-backfill/scripts/render_route_candidate_local_map.mts \
  --geojson cloud-sql/migrate/route-candidates/luna/<destination-id>.geojson \
  --output /private/tmp/peaks-route-worker/<destination-id>.png \
  --tile-cache /private/tmp/peaks-route-worker/osm-map-tiles
```

Inspect that PNG. If a permitted private comparison GPX is already available,
run `compare_route_reference.mts`; never copy its points into the candidate.
Write the compact candidate JSON from the candidate result schema to
`/private/tmp/peaks-route-worker/<destination-id>-candidate.json`. Then:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/node_modules/.bin/tsx \
  .agents/skills/peaks-route-factory/scripts/audit_route_candidates.mts \
  --file cloud-sql/migrate/route-candidates/luna/<destination-id>.geojson \
  --format summary

.agents/skills/peaks-route-factory/scripts/route_jobs.sh \
  transition --destination-id <destination-id> --lease-token <lease-token> \
  --to candidate_ready \
  --artifact-path cloud-sql/migrate/route-candidates/luna/<destination-id>.geojson \
  --result-file /private/tmp/peaks-route-worker/<destination-id>-candidate.json \
  --apply
```

## Import

```bash
.agents/skills/peaks-route-factory/scripts/route_jobs.sh \
  materialize --destination-id <destination-id> --lease-token <lease-token> \
  --output /private/tmp/peaks-route-worker/<destination-id>-<lease-token>.geojson

.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-standard-route-backfill/scripts/cache_route_terrain_tiles.mts \
  --candidate /private/tmp/peaks-route-worker/<destination-id>-<lease-token>.geojson \
  --output-dir /private/tmp/peaks-route-worker/terrain
```

Run this once without the final apply flags:

```bash
PEAKS_ELEVATION_SOURCE=terrain-cache \
PEAKS_TERRAIN_TILE_CACHE=/private/tmp/peaks-route-worker/terrain \
  .agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts \
  --candidate /private/tmp/peaks-route-worker/<destination-id>-<lease-token>.geojson \
  --destination-id <destination-id> \
  --trailhead-id <trailhead-id> \
  --name "<route-name>" \
  --route-shape <route-shape> \
  --source-url <type>=<direct-identity-url>
```

After it passes, run the full apply command:

```bash
PEAKS_ELEVATION_SOURCE=terrain-cache \
PEAKS_TERRAIN_TILE_CACHE=/private/tmp/peaks-route-worker/terrain \
  .agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts \
  --candidate /private/tmp/peaks-route-worker/<destination-id>-<lease-token>.geojson \
  --destination-id <destination-id> \
  --trailhead-id <trailhead-id> \
  --name "<route-name>" \
  --route-shape <route-shape> \
  --source-url <type>=<direct-identity-url> \
  --result-file /private/tmp/peaks-route-worker/<destination-id>-import.json \
  --apply --acknowledge-geometry-license --acknowledge-map-review
```

The importer writes the route ID to that result file. Then:

```bash
.agents/skills/peaks-route-factory/scripts/route_jobs.sh \
  transition --destination-id <destination-id> --lease-token <lease-token> \
  --to pending_review --route-id <pending-route-id> \
  --result-file /private/tmp/peaks-route-worker/<destination-id>-import.json \
  --apply
```

An exact retry reuses the pending route instead of creating a duplicate.
If the job already names an older pending route from a failed review, add
`--replace-pending-route <older-route-id>` to both importer runs.

## Review

Run the checker that matches the candidate source:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-osm-route-approval/scripts/check_pending_osm_routes.mts \
  --route-id <pending-route-id> --format json \
  > /private/tmp/peaks-route-worker/<destination-id>-source-check.json
```

For a USGS candidate, use:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-osm-route-approval/scripts/check_pending_usgs_routes.mts \
  --route-id <pending-route-id> --format json \
  > /private/tmp/peaks-route-worker/<destination-id>-source-check.json
```

Spawn `peaks_route_reviewer` with the pending route ID, candidate result,
identity and access URLs, rendered-map note, and checker JSON. Save its output
using the review schema at
`/private/tmp/peaks-route-worker/<destination-id>-review.json`. Then:

```bash
.agents/skills/peaks-route-factory/scripts/route_jobs.sh \
  transition --destination-id <destination-id> --lease-token <lease-token> \
  --to approved --route-id <pending-route-id> \
  --result-file /private/tmp/peaks-route-worker/<destination-id>-review.json \
  --apply
```

Use `needs_revision` with that result when any gate fails.
A checker FAIL exits with status 2 after writing its JSON. That is a review
result, not a reason to rerun the checker.

For a fixable failed review:

```bash
.agents/skills/peaks-route-factory/scripts/route_jobs.sh \
  transition --destination-id <destination-id> --lease-token <lease-token> \
  --to needs_revision --route-id <pending-route-id> \
  --result-file /private/tmp/peaks-route-worker/<destination-id>-review.json \
  --apply
```

For unclear reuse rights or current access, use `waiting_rights` or
`waiting_access` instead and include both `--blocker-code <short-code>` and
`--message "<exact facts needed>"`. Use `needs_human` for conflicting facts or
a production repair. These states require a human requeue.

## Publish

The activation wrapper is idempotent. It reports success without writing when
a stopped run already activated the saved route. Run:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  .claude/skills/peaks-standard-route-backfill/scripts/accept_pending_route_with_segments.sh \
  --route-id <route-id> --destination-id <destination-id> \
  --lease-token <lease-token>

.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  .claude/skills/peaks-standard-route-backfill/scripts/accept_pending_route_with_segments.sh \
  --route-id <route-id> --destination-id <destination-id> \
  --lease-token <lease-token> --apply \
  --acknowledge-map-review --acknowledge-segment-plan
```

If the plan reports splits or affected routes, the wrapper refuses scheduled
activation. Move the job to `needs_human` for web-admin segment review.

Then:

```bash
.agents/skills/peaks-route-factory/scripts/route_jobs.sh \
  transition --destination-id <destination-id> --lease-token <lease-token> \
  --to published --route-id <route-id> --apply
```

## Verify

Do not run the verifier and choose a transition yourself. This command runs
the live checks and clears the lease with the safe result:

```bash
.agents/skills/peaks-route-factory/scripts/route_jobs.sh \
  verify --destination-id <destination-id> --lease-token <lease-token> \
  --apply
```

The returned `action` is final for this run:

- `verified`: all gates passed.
- `rebuild`: the active legacy route remains live while the job moves to
  research for an OSM or USGS replacement.
- `retry`: only public parity failed; the job retries after 30 minutes.
- `needs_human`: ownership, activation, or destination order conflicts.

## End early

```bash
.agents/skills/peaks-route-factory/scripts/route_jobs.sh \
  release --lease-token <lease-token> --message "<short cause>" \
  --retry-minutes 15
```
