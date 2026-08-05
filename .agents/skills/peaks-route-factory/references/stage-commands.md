# Stage commands

Run every command from the firebase repo root. Replace angle-bracket values
only with fields from the claimed job or saved result. Queue commands always
start with `.agents/skills/peaks-route-factory/scripts/route_jobs.sh`; never
prefix that path with `cloud-sql/migrate/`.

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

Find reusable source IDs through the preflighted database wrapper. Run the
wrapper directly: do not add `bash`, `zsh`, `sandbox_permissions`, a raw
database command, or a raw public-source request.

Start with OSM:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  .claude/skills/peaks-standard-route-backfill/scripts/find_osm_trail_geometry.sh \
  --destination-id <destination-id> --radius-m 8000 --format table
```

Use the USGS public-domain catalog when OSM does not provide a complete,
correct route:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  .claude/skills/peaks-standard-route-backfill/scripts/find_public_trail_geometry.sh \
  --destination-id <destination-id> --radius-m 20000 --format table
```

Expand either radius only when route facts require it and never beyond that
helper's accepted limit. Keep full source payloads out of model context and
git; use only the compact table to choose source IDs.

For researched OSM way IDs:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/scripts/run-tsx.sh \
  .claude/skills/peaks-standard-route-backfill/scripts/build_osm_route_candidate.mts \
  --destination-id <destination-id> --trailhead-id <trailhead-id> \
  --way-ids <comma-separated-osm-way-ids> \
  --format geojson \
  --output cloud-sql/migrate/route-candidates/luna/<destination-id>.geojson
```

For researched USGS National Map object IDs:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/scripts/run-tsx.sh \
  .claude/skills/peaks-standard-route-backfill/scripts/build_usgs_route_candidate.mts \
  --destination-id <destination-id> --trailhead-id <trailhead-id> \
  --object-id <object-id> \
  --output cloud-sql/migrate/route-candidates/luna/<destination-id>.geojson
```

Repeat `--object-id` for each USGS object. Render every candidate:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/scripts/run-tsx.sh \
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
  cloud-sql/migrate/scripts/run-tsx.sh \
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

The queue normalizes that repo-root artifact path inside the migration package.
The shorter `route-candidates/luna/<destination-id>.geojson` form is also
accepted, but use the repo-root form above so the builder, audit, and transition
all receive the same path.

## Import

```bash
.agents/skills/peaks-route-factory/scripts/route_jobs.sh \
  materialize --destination-id <destination-id> --lease-token <lease-token> \
  --output /private/tmp/peaks-route-worker/<destination-id>-<lease-token>.geojson

.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/scripts/run-tsx.sh \
  .claude/skills/peaks-standard-route-backfill/scripts/cache_route_terrain_tiles.mts \
  --candidate /private/tmp/peaks-route-worker/<destination-id>-<lease-token>.geojson \
  --output-dir /private/tmp/peaks-route-worker/terrain
```

Run this once without the final apply flags:

```bash
PEAKS_ELEVATION_SOURCE=terrain-cache \
PEAKS_TERRAIN_TILE_CACHE=/private/tmp/peaks-route-worker/terrain \
  .agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/scripts/run-tsx.sh \
  .claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts \
  --candidate /private/tmp/peaks-route-worker/<destination-id>-<lease-token>.geojson \
  --destination-id <destination-id> \
  --trailhead-id <trailhead-id> \
  --name "<route-name>" \
  --route-shape <route-shape> \
  --source-url '<type>=<direct-identity-url>'
```

After it passes, run the full apply command:

```bash
PEAKS_ELEVATION_SOURCE=terrain-cache \
PEAKS_TERRAIN_TILE_CACHE=/private/tmp/peaks-route-worker/terrain \
  .agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/scripts/run-tsx.sh \
  .claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts \
  --candidate /private/tmp/peaks-route-worker/<destination-id>-<lease-token>.geojson \
  --destination-id <destination-id> \
  --trailhead-id <trailhead-id> \
  --name "<route-name>" \
  --route-shape <route-shape> \
  --source-url '<type>=<direct-identity-url>' \
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
When the claimed job has `replacement_route_id`, pass
`--replace-active-route <replacement-route-id>` to both importer runs. This
keeps the old route active while the new route is pending review.
If the job already names an older pending route from a failed review, add
`--replace-pending-route <older-route-id>` to both importer runs.

## Review

Run the checker that matches the candidate source:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/scripts/run-tsx.sh \
  .claude/skills/peaks-osm-route-approval/scripts/check_pending_osm_routes.mts \
  --route-id <pending-route-id> --format json \
  > /private/tmp/peaks-route-worker/<destination-id>-source-check.json
```

For a USGS candidate, use:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/scripts/run-tsx.sh \
  .claude/skills/peaks-osm-route-approval/scripts/check_pending_usgs_routes.mts \
  --route-id <pending-route-id> --format json \
  > /private/tmp/peaks-route-worker/<destination-id>-source-check.json
```

When the job has `replacement_route_id`, add
`--replace-active-route <replacement-route-id>` to the matching checker. The
checker validates that exact active route, ignores it as the planned legacy
replacement, and still rejects another live route with the same name. The
queue repeats this check from its durable replacement binding before it
accepts `approved`.

Spawn `peaks_route_reviewer` with the pending route ID, candidate result,
identity and access URLs, rendered-map note, and checker JSON. Save its output
using the review schema at
`/private/tmp/peaks-route-worker/<destination-id>-review.json`. Then:

Do not make up `summit_contact`, `elevation_profile`, or `segment_assembly`.
The reviewer may omit those three fields and their five count-only
measurements. The exact `transition ... --to approved` command below queries
`peaks_route_passes_publish_integrity(route_id, destination_id, 'pending')`
inside its leased database transaction and inserts the fresh machine gates and
counts before it validates or stores the result. A route more than five
metres from any linked summit, an out-and-back or point-to-point route whose
end misses its final summit, a flat profile, or a segment assembly that differs
from the route path must go to `needs_revision`.

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

Wait no more than five minutes for the reviewer. If it has not returned,
heartbeat once, send one short completion prompt, and wait no more than two
more minutes. Then close the reviewer and release the lease with a retry; do
not hold a route job through repeated review waits.

For a fixable failed review:

```bash
.agents/skills/peaks-route-factory/scripts/route_jobs.sh \
  transition --destination-id <destination-id> --lease-token <lease-token> \
  --to needs_revision --route-id <pending-route-id> \
  --result-file /private/tmp/peaks-route-worker/<destination-id>-review.json \
  --apply
```

After a confirmed checker or reviewer-tool fix, a supervisor may return an
unchanged pending route from `needs_revision` to `pending_review` with the
human-only `requeue` command. It validates that the saved route is still
Peaks-owned and pending. Luna never runs `requeue`.

For unclear reuse rights or current access, use `waiting_rights` or
`waiting_access` instead and include both `--blocker-code <short-code>` and
`--message "<exact facts needed>"`. Use `needs_human` for conflicting facts or
a production repair. These states require a human requeue.

## Publish

The activation wrapper is idempotent. It reports success without writing when
a stopped run already activated the saved route. For a one-for-one rebuild, it
marks the job's named legacy route `superseded` in the same transaction that
activates the reviewed replacement. For a shared legacy route, it covers only
the claimed destination link and keeps the old route active until the final
repair link receives valid active coverage. Run:

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
- `rebuild`: summit contact, elevation profile, provenance, or segment
  assembly failed. The active legacy route remains live while the job moves to
  research for an OSM or USGS replacement.
- `retry`: only public parity failed; the job retries after 30 minutes.
- `needs_human`: ownership, activation, or destination order conflicts.

## End early

```bash
.agents/skills/peaks-route-factory/scripts/route_jobs.sh \
  release --lease-token <lease-token> --message "<short cause>" \
  --retry-minutes 15
```
