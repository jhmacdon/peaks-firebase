# Peaks Cloud SQL

PostgreSQL 15+ with PostGIS + pg_trgm. Contains the database schema, Cloud Run API (Express), and Firestore migration scripts.

## Structure

```
schema.sql          # Baseline DDL: enums, tables, indexes, triggers
                    # NOT the whole current schema — see Testing below
SETUP.md            # Provisioning guide (Cloud SQL, Cloud Run, migration)
test-db/            # Test database: provision.sh, grants.sql, README.md
api/                # Cloud Run Express API (Firebase Auth + PostGIS queries)
  src/
    index.ts        # Express app, route mounting, /health endpoint
    db.ts           # pg Pool (Unix socket in Cloud Run, TCP locally)
    auth.ts         # requireAuth middleware (Firebase Admin verifyIdToken)
    routes/
      destinations.ts  # GET /:id, /nearby, /viewport, /:id/lists
      routes.ts        # Route CRUD
      sessions.ts      # Session queries
      lists.ts         # List queries
      search.ts        # GET /search?q= (pg_trgm fuzzy + geo-biased ranking)
                       # GET /search/features?features=&activities=&lat=&lng=
migrate/            # One-time Firestore → PostGIS backfill
  src/
    index.ts                 # Orchestrator (--only flag for individual tables)
    firebase.ts              # Firebase Admin init
    db.ts                    # pg Pool for migration
    migrate-destinations.ts  # Destinations + list_destinations
    migrate-lists.ts         # Lists
    migrate-routes.ts        # Routes + route_destinations
    migrate-sessions.ts      # Tracking sessions + session_destinations/routes
    migrate-points.ts        # Tracking points (bulk insert)
    import-cai-huts.ts       # CAI shelter import script
```

## Database

### Enums
- `destination_type`: point, region
- `destination_feature`: volcano, fire-lookout, summit, trailhead, hut, lookout, lake, landform, viewpoint, waterfall, campsite
- `area_kind`: national_park, national_monument, national_forest, national_grassland, wilderness, national_recreation_area, national_conservation_area, wildlife_refuge, wild_and_scenic_river, other_federal_area
- `activity_type`: outdoor-trek, outdoor-moto, ski
- `completion_mode`: none, straight, reverse
- `route_shape`: out_and_back, loop, point_to_point, lollipop
- `session_destination_relation`: reached, goal

### Key design decisions
- **Geography not geometry**: all spatial columns use `geography(*, 4326)` (spherical math, meters) not `geometry` (planar)
- **3D types**: `PointZ` and `LineStringZ` carry elevation as Z coordinate
- **Elevation denormalized**: stored both as Z in geography AND as plain `DOUBLE PRECISION` column for non-spatial queries
- **Segments are source of truth**: routes materialize their path/stats from ordered segments; recompute on change
- **Route distance is one-way**: for out_and_back, total hiking distance = `distance * 2`
- **Segment direction**: `route_segments.direction` is `forward` or `reverse` (CHECK constraint, not enum)
- **Areas are separate from destinations**: official protected-area and land-management units live in `areas` with `geometry(MultiPolygon, 4326)` boundaries; `destination_areas` links summits to every containing area.
- **Session areas come from track segments**: `session_areas` stores protected areas crossed by each saved tracking-point segment. `area_boundary_parts` keeps exact, indexed polygon subdivisions so matching stays within the session-processing budget. A changed PAD-US import refreshes existing PostGIS session links in small batches.
- **Text IDs**: all PKs are `TEXT` (20-char alphanumeric, matching Firebase document ID style)
- **`search_name`**: lowercased/normalized copy of `name` for trigram search (indexed with `gin_trgm_ops`)
- **`updated_at` triggers**: automatic on destinations, areas, lists, routes, tracking_sessions

### PostGIS patterns
```sql
-- Nearby (meters)
ST_DWithin(location, ST_MakePoint(lng, lat)::geography, radius_meters)

-- Extract lat/lng from geography
ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng

-- Bounding box
ST_Intersects(location, ST_MakeEnvelope(minLng, minLat, maxLng, maxLat, 4326)::geography)

-- Create point
ST_GeomFromText('POINT Z(lng lat ele)', 4326)::geography

-- Route elevation profile
ST_DumpPoints(path::geometry)  -- returns (path, geom) records
```

**Important**: `ST_MakePoint` takes `(lng, lat)` — longitude first, latitude second.

### Enum casting in queries
```sql
-- Single value match
$1::destination_feature = ANY(features)

-- Array containment
features @> $1::destination_feature[]

-- Insert with array
ARRAY[$1]::destination_feature[]

-- Always cast with explicit type when using COALESCE on numeric columns
COALESCE($1::double precision, 0)
```

## Database role conventions

All schema objects (tables, indexes, functions, triggers) **must be owned by `postgres`**. The `peaks-api` role is the runtime user — it has DML rights (SELECT/INSERT/UPDATE/DELETE) on application tables, but no DDL rights. Migrations run as `postgres`.

This convention exists because Cloud SQL's `postgres` is `cloudsqlsuperuser`, not a true superuser, so it cannot bypass the "must be owner of object" rule for `CREATE OR REPLACE FUNCTION` or `ALTER FUNCTION`. If a function gets accidentally created as `peaks-api` (this happened once during initial bootstrap with `link_sessions_on_destination_insert`), every subsequent migration touching it must `SET ROLE peaks-api` first or the apply fails with `must be owner of function`. Fix the ownership instead — see `cloud-sql/migrations/20260503_fix_trigger_function_owner.sql` for the three-step ownership-transfer dance (Cloud SQL forbids both directions of cross-role membership at once, so direct connection as the current owner is required, not `SET ROLE`).

## Testing (do not regress)

The DB-backed suites in `api/src/__tests__/` write to fifteen tables. They must
never reach production. Full detail in `test-db/README.md`; the rules:

- **`TEST_DATABASE_URL` gates the suites AND supplies the connection.** When it
  is set, `db.ts` ignores `DB_HOST`/`DB_NAME`/`DB_USER`/`DB_PASS` entirely rather
  than merging them. Never reintroduce a gate that is separate from the
  connection — the old `DATABASE_URL` flag turned on eleven files of writes while
  the connection still came from `DB_*`, which on a developer machine is
  production.
- **The database name must end in `_test`.** Enforced in `db.ts` and again in
  `test-db/provision.sh` before it drops anything. Pinned by
  `api/src/__tests__/test-database-guard.test.ts`. Don't relax it; make a new
  database instead.
- **`schema.sql` is a baseline, not the current schema.** It is missing
  everything later migrations added and never folded back —
  `link_sessions_on_destination_update`, `areas_refresh_boundary_display`,
  destination place-copy and hero-credit columns, `areas.parent_area_id`, the
  destination search vector — and it carries no `GRANT`s. Provisioning applies
  `schema.sql` + `migrations/` + `grants.sql`, which together reproduce live
  `peaks`: 41 tables, 1 application view, 392 columns, 22 triggers (measured
  2026-08-19 via a provision run, `spatial_ref_sys` included). Prod
  additionally carries nine legacy June-2026 dedupe backup and worklist tables
  that the provisioner rightly omits.
- **A migration that fails provisioning is a real conflict** with `schema.sql`.
  Reconcile the two. Don't extend the skip list in `provision.sh`.
- **Pool max drops to 2 under `NODE_ENV=test`.** Each test file is its own
  process with its own pool; the instance allows 25 connections total. This is
  what lets the api suite run in parallel instead of `--test-concurrency=1`.

## Postgres → wire type policy (do not regress)

`node-postgres` has default type parsers that are safe for JS but surprising for any typed client (Swift, Kotlin, Dart, older JS code paths that assume numbers). The API has had one catastrophic outage from this class of bug and the mitigation **must** stay in place:

- **`BIGINT` (OID 20, `INT8`) returns as a JS String by default** to preserve 64-bit precision. We register `types.setTypeParser(20, parseInt)` in `api/src/db.ts` so `BIGINT` comes over as a `Number`. The only BIGINT column in use today is `tracking_points.time` (a unix-seconds timestamp well below 2^53), so precision loss is impossible. Do NOT remove this parser without auditing every client — iOS parses the points endpoint with `d["time"] as? Int`, which silently produces `0` for every point when the API emits a string, which collapses the entire session timeline + flyover day/night pipeline to nonsense times.
- **`TIMESTAMPTZ` returns as a JS Date** — fine, serializes to ISO8601 via `res.json`, iOS reads it via `PeaksAPI.parseDate` which handles ISO.
- **`NUMERIC` / `DECIMAL` returns as a JS String** (also for precision). If you ever add a NUMERIC column, register a parser or cast to `::float8` in the query, or clients that don't expect a string *will* silently break.
- **If a new BIGINT column needs true >2^53 precision** (sequence IDs, file sizes), give it its own targeted parser or return it via `::text` in the specific SELECT. Don't remove the global BIGINT → Number parser without auditing every existing consumer first.
- **Regression test**: `api/src/__tests__/bigint-parser.test.ts` (Node's built-in test runner) registers the parsers, runs a dummy BIGINT value through `types.getTypeParser(20)`, and asserts it comes out as a `number`. Wired into the deploy workflow's `test` step so a parser regression is caught before Cloud Run rollout.

## API

Express app deployed to Cloud Run. Node 20, Firebase Admin for auth.

### Build & run
```bash
cd api
npm install
npm run build        # tsc → dist/
npm run dev          # tsx watch (local dev)
npm start            # production (node dist/index.js)
```

### Deploy
```bash
npm run build
gcloud run deploy peaks-api --source=. --region=us-central1
```

Cost-relevant flags (`--min-instances`, `--cpu-throttling`, memory/CPU) are pinned in
`.github/workflows/deploy.yml` and governed by the **"Infrastructure cost discipline"**
section of the repo-root `CLAUDE.md` — read it before changing any of them, and never
add background work that relies on an in-process timer (use the Cloud Scheduler →
`/internal/sweep` pattern instead).

### Auth pattern
All `/api/*` routes go through `requireAuth` middleware. Clients send `Authorization: Bearer <firebase-id-token>`. The middleware calls `admin.auth().verifyIdToken()` and sets `req.uid`.

### Connection
- **Cloud Run**: connects via Unix socket at `/cloudsql/INSTANCE_CONNECTION_NAME`
- **Local dev**: set `DB_HOST=127.0.0.1` to use TCP via Cloud SQL Auth Proxy
- **Tests**: `TEST_DATABASE_URL` overrides all of the above (see Testing)
- Pool max: 8 by default, 4 in Cloud Run, 2 under `NODE_ENV=test` (`DB_POOL_MAX` overrides)

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (no auth) |
| POST | `/internal/sweep` | Stuck-session sweep; Cloud Scheduler job `peaks-api-sweep` every 2 min (OIDC-verified `peaks-sweeper@` SA, not Firebase auth) |
| GET | `/api/destinations/:id` | Destination detail |
| GET | `/api/destinations/nearby?lat=&lng=&radius=&limit=` | Nearby destinations |
| GET | `/api/destinations/viewport?minLat=&maxLat=&minLng=&maxLng=` | Map viewport query |
| GET | `/api/destinations/:id/lists` | Lists containing destination |
| GET | `/api/search?q=&lat=&lng=&limit=` | Fuzzy text search (pg_trgm + geo ranking) |
| GET | `/api/search/features?features=&activities=&lat=&lng=&radius=` | Filter by features/activities |
| GET | `/api/routes/...` | Route queries |
| GET | `/api/sessions/...` | Session queries |
| GET | `/api/sessions/:id/areas` | Protected areas crossed by saved session track segments |
| GET | `/api/sessions/changes?updated_since=&after_id=&limit=` | Incremental session sync feed with tombstones |
| GET | `/api/sessions/:id/comparisons` | "Your Efforts": prior overlapping sessions + shared-segment stats (owner-only) |
| GET | `/api/sessions/:id/comparisons/:otherId` | Effort curves for the race chart (owner-only) |
| GET | `/api/lists/...` | List queries |

## Migration

One-time Firestore → PostGIS backfill. Reads from Firestore, writes to PostgreSQL.

Schema changes for existing databases live in `cloud-sql/migrations/`.

```bash
cd migrate
npm install

# Start Cloud SQL Auth Proxy first
cloud-sql-proxy PROJECT_ID:us-central1:peaks-db &

# Set env vars
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=peaks DB_USER=postgres DB_PASS=...

# Run all tables
npm run migrate

# Or individual tables
npm run migrate:destinations
npm run migrate:routes
npm run migrate:sessions
npm run migrate:points

# CAI hut import
npm run import:cai-huts
```

## Peakbagger list audit/import

The Peakbagger importer reads a saved browser audit, resolves each source peak
to one summit destination, and shows a dry-run diff. It stops on missing or
unclear rows and never drops an unresolved source peak.

```bash
cd migrate
npm run import:peakbagger-lists -- --input=/tmp/peakbagger-list-candidates.json
npm run import:peakbagger-lists -- --input=/tmp/peakbagger-list-candidates.json --apply
```

The reviewed 2026-08-18 scope and held lists are in
`docs/data-audits/peakbagger-lists-2026-08-18.md`.

## Named viewpoint audit/import

The viewpoint importer reads one saved OpenStreetMap snapshot and a complete
set of review decisions. It supports a US state or a country. A country job may
use a fixed bounding box and named scope for a mountain region. An ISO 3166-2
subdivision gives a tighter boundary when the region follows a state or
province. The importer can also add a small set of named hiking turnarounds
whose OSM points have no name. A country plus an OSM boundary relation can
define a national park or other mapped hiking area. International runs make a
second live OSM identity check inside the chosen country and region.
`--skip-scope-verification` permits an offline dry-run, but its report cannot
be applied. Dry-run is the default. Apply needs the reviewed report and its
SHA-256, and stops if the source, reviews, scope check, planned writes, or
target rows changed after review.

```bash
cd migrate
npm run expand:viewpoint-coverage -- \
  --state=WA \
  --input=/tmp/US-WA.viewpoints.overpass.json \
  --candidate-reviews=/tmp/review-1.json,/tmp/review-2.json,/tmp/review-3.json \
  --supplement=data/wa-viewpoint-supplements-2026-08-19.json \
  --report=/tmp/wa-viewpoint-dry-run.json

npm run expand:viewpoint-coverage -- \
  --state=WA \
  --input=/tmp/US-WA.viewpoints.overpass.json \
  --candidate-reviews=/tmp/review-1.json,/tmp/review-2.json,/tmp/review-3.json \
  --supplement=data/wa-viewpoint-supplements-2026-08-19.json \
  --apply \
  --review-report=/tmp/wa-viewpoint-dry-run.json \
  --expected-report-sha256=<reviewed-report-sha256>

# A bounded country scope intersects the country boundary with these bounds.
npm run expand:viewpoint-coverage -- \
  --country=IT \
  --scope=dolomites \
  --bbox=46.20,10.80,47.20,13.10 \
  --input=/tmp/dolomites.viewpoints.overpass.json \
  --candidate-reviews=/tmp/dolomites.review.json \
  --report=/tmp/dolomites-viewpoint-dry-run.json

# Use an ISO subdivision when it is the safer regional boundary.
npm run expand:viewpoint-coverage -- \
  --subdivision=IN-HP \
  --input=/tmp/himachal-pradesh.viewpoints.overpass.json \
  --candidate-reviews=/tmp/himachal-pradesh.review.json \
  --report=/tmp/himachal-pradesh-viewpoint-dry-run.json

# A reviewed OSM relation can define a protected hiking area.
npm run expand:viewpoint-coverage -- \
  --country=NP \
  --scope=sagarmatha \
  --osm-relation=3531450 \
  --input=/tmp/sagarmatha.viewpoints.overpass.json \
  --candidate-reviews=/tmp/sagarmatha.review.json \
  --report=/tmp/sagarmatha-viewpoint-dry-run.json
```

The importer adds type-qualified OSM IDs, keeps all existing destination data,
and links old ended sessions only when both the saved path and a real tracking
point pass the destination radius. It honors saved session-destination
rejections. The first reviewed scope is in
`docs/data-audits/wa-viewpoints-2026-08-19.md`. The 49-state follow-up is in
`docs/data-audits/us-viewpoints-2026-08-19.md`. The first international review
is in `docs/data-audits/global-hiking-viewpoints-2026-08-20.md`.

## Destination elevation fraction audit

Use the read-only fraction audit after a storage precision change. It checks
every integer-looking Peaks destination against exact OpenStreetMap and
Wikidata IDs, caches the provider replies, and writes one result per row.

```bash
cd migrate
npm run audit:destination-elevation-fractions -- \
  --cache-dir=/tmp/peaks-destination-elevation-fractions/cache \
  --report=/tmp/peaks-destination-elevation-fractions/report.json
```

The command has no apply mode. A candidate must have a nearby exact provider
identity, direct metre evidence, agreement between direct metre sources, and a
positive change below one metre that keeps the stored whole-metre part. Foot
conversions stay in a separate review class. The same OSM fraction must predate
the row or its recorded OSM ID backfill. Terrain estimates never qualify.
The audit adds no service or monthly cost.

The reviewed 2026-08-10 report has SHA-256
`80153b5afc9a3f59a2fe157e70b36a70c4f525a2d22305d433de3d0a39719006`
and exactly 117 candidates. Use the separate guarded command to check that
file and the live rows. Its default mode is read-only.

```bash
npm run apply:destination-elevation-fractions -- \
  --report=/absolute/path/final-report.json \
  --expected-report-sha256=80153b5afc9a3f59a2fe157e70b36a70c4f525a2d22305d433de3d0a39719006 \
  --expected-candidate-count=117 \
  --format=json
```

The preflight checks every current integer value, PointZ value, XY coordinate,
exact OSM ID, identity proof, and source-history cutoff. It also reports all
catalog fingerprints affected through shared routes and any route or segment
summit vertex still pinned to the old integer. It requires the exact reviewed
115-destination catalog scope (set SHA-256
`0148b3dfaab0322255d1196c2b2df558fc37c3e14956a2d482c20ba4c033f742`)
and its reviewed job pre-state. It also snapshots counts and hashes for linked
sessions, explicit rejections, destination-area links, nearby tracking
sessions, and their points.

Before data apply, deploy
`20260810_session_link_update_xy_guard.sql`. It patches the old destination
update function only when its body matches the reviewed production function,
keeps the rejection anti-join, and marks the new XY-only guard. It refuses
unknown drift. A PointZ change in Z alone must not rerun historical session
matching. The guarded data command checks the function body, marker, and exact
enabled trigger before its first update.

Apply requires `--apply` plus exact database, Cloud SQL instance, and
instance-named Unix socket flags. It takes one serializable transaction and an
advisory lock, locks all 117 destination rows and every affected catalog job,
and stops if any guard or active catalog lease fails. It updates the scalar and
PointZ together without changing XY, records the source proof in
`metadata.elevation_fraction_repair`, and queues only affected catalog jobs
with the normal catalog candidate SQL. It never runs the global catalog
retirement query or writes an unreviewed 116th catalog job. It repeats the
session and tracking hashes after all changes and rolls back on any difference.
Before commit, it also recomputes the normal catalog candidates and requires all
115 pinned jobs to be queued with the current fingerprint and no result, audit
time, error, or lease evidence.
Route-elevation and standard-route fingerprints do not use
destination elevation or `updated_at`, so this change does not queue them.
For the two reviewed standard routes whose summit vertex is still the old
integer, the same transaction changes only that exact PointZ in the route and
its sole segment. It requires pinned before/after path, XY, other-point, and
other-field hashes, applies the same sub-metre destination delta, rebuilds the
canonical elevation string and gain/loss, then checks every hash again. It
updates the two queued route-elevation fingerprints and adds a receipt to the
two standard-route jobs without changing their state. The repair adds no
service or monthly cost.

## Peak catalog coverage audit

Use the read-only coverage auditor to compare the summit catalog with named
OpenStreetMap `natural=peak` nodes for any US state or ISO country. It matches by OSM ID, then
within 150 m, then by normalized identical name within 1 km. Unmatched peaks are
ranked using aggregate ended-session path proximity at 30/100/250 m; reports do
not include user or session IDs.

```bash
cd migrate
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=peaks DB_USER=postgres DB_PASS=...

# Human-readable report
npm run audit:peak-coverage -- --state=WA

# Country audit
npm run audit:peak-coverage -- --country=CA

# Machine-readable review queue; optionally restrict candidate elevation
npm run audit:peak-coverage -- --state=WA --format=json --limit=200 --min-elevation=1000

# Limit the live Overpass reference set to a region (minLng,minLat,maxLng,maxLat)
npm run audit:peak-coverage -- --state=WA --bbox=-122,48.2,-120.5,49 --min-elevation=1000

# Re-run from a saved Overpass JSON response instead of making a network request
npm run audit:peak-coverage -- --state=WA --input=/path/wa-named-peaks.json
```

The auditor never inserts or updates destinations. Treat `track_proven`
candidates as the first review tier, but still validate coordinates, elevation,
aliases, and nearby catalog rows before adding a migration. Directional peaks,
generic numbered points, and nodes close to an existing destination are flagged
for manual review rather than automatic import.

Use the expansion runner for resumable jurisdiction passes. It is dry-run by
default. Automatic additions require an elevation plus either topographic
prominence greater than 300 ft or a conservative popularity signal (a Peaks
session within 30 m, an OSM Wikipedia tag, or at least five Wikipedia
sitelinks in Wikidata). Existing alias/subpeak/near-destination guards still
apply. Safe normalized-name matches within 500 m or very-close spatial matches
backfill OSM and Wikidata IDs; ambiguous matches remain in the report.
When OSM contains duplicate same-name nodes within 150 m, the runner keeps one
before the insert and records the skipped node in the report.

```bash
cd migrate

# Review one state; cache the OSM response and retain the decision report
npm run expand:peak-coverage -- --state=OR \
  --cache-dir=/tmp/peaks-coverage/osm \
  --report-dir=/tmp/peaks-coverage/reports

# Apply a reviewed state or resume the complete US pass
npm run expand:peak-coverage -- --state=OR --apply \
  --cache-dir=/tmp/peaks-coverage/osm \
  --report-dir=/tmp/peaks-coverage/reports
npm run expand:peak-coverage -- --all-states --apply \
  --cache-dir=/tmp/peaks-coverage/osm \
  --report-dir=/tmp/peaks-coverage/reports

# The same runner supports --country, --countries, and --all-countries.
# Large network-bound batches may use --concurrency=2 through 4. Applies still
# take a shared database lock, so each scope checks the last committed writes.
# Add --resume to an apply batch with --report-dir to skip scopes that already
# have a completed apply report. Cached OSM and Wikidata files make proof runs
# repeatable without fetching those sources again.
```

Large countries that time out as one Overpass area fall back to their ISO
3166-2 subdivisions. Antarctica, Bonaire/Saba/Sint Eustatius, Palestine,
Svalbard/Jan Mayen, and the US outlying islands use explicit OSM territory
relations because OSM has no single ISO 3166-1 administrative relation for
those scopes. Antarctica falls back once more to ISO's south-of-60° boundary
when an Overpass instance cannot turn its continent relation into an area.

Destination insert triggers use transition tables and the existing GiST
indexes on session paths and tracking points. A path match remains only a
candidate: one real tracking point must still fall inside the destination's
exact match radius. The lateral proof stops after the first matching point.

Reports use separate `.apply.json` and `.dry-run.json` names, plus a latest
copy, so a proof run does not erase the write record.

Peakbagger ascent counts are a targeted manual popularity fallback. Do not
bulk-crawl Peakbagger; its browser capture workflow and low-rate guardrails are
documented in the `peaks-ascent-backfill` skill.

## Lake catalog coverage

The lake expansion runner imports named OpenStreetMap objects that carry the
explicit `natural=water` and `water=lake` tags. It does not treat every named
water body as a lake, so ponds, reservoirs, rivers, basins, and wastewater
features stay out of this pass. The runner is dry-run by default, keeps cached
Overpass snapshots and review reports, and never deletes a destination.

```bash
cd migrate

# Review Washington with a repeatable source snapshot and report.
npm run expand:lake-coverage -- --state=WA \
  --cache-dir=/tmp/peaks-lake-coverage/osm \
  --report-dir=/tmp/peaks-lake-coverage/reports

# Apply only the exact reviewed report and source snapshot.
npm run expand:lake-coverage -- --state=WA --apply \
  --cache-dir=/tmp/peaks-lake-coverage/osm \
  --report-dir=/tmp/peaks-lake-coverage/reports \
  --review-report=/tmp/peaks-lake-coverage/reports/US-WA.dry-run.json \
  --expected-report-sha256=<sha256>

# Expand after the Washington proof. Multi-state passes support 1-4 workers.
npm run expand:lake-coverage -- --states=OR,ID --concurrency=2 \
  --cache-dir=/tmp/peaks-lake-coverage/osm \
  --report-dir=/tmp/peaks-lake-coverage/reports
```

OSM IDs are namespaced as `osm_node`, `osm_way`, or `osm_relation`. A safe
same-name nearby match may add the missing ID and state to a legacy lake, but it
does not replace its name, location, elevation, boundary, copy, or images.
Ambiguous matches stay in the report. New closed ways and reconstructable
multipolygon relations use `ST_PointOnSurface` plus their largest valid polygon;
unusable geometry falls back to a reported point destination. Apply uses one
transaction and a shared advisory lock, and checks that the reviewed decision
fingerprint still matches before it writes. This adds no service and no monthly
cost.

### Named route candidate discovery

Use the route discovery report after the peak catalog has settled. It finds
explicit OSM `route=hiking|foot` relations whose geometry comes within 250 m of
a summit. Its second source is a public Peaks recording whose user-supplied
name identifies a summit that the same recording reached. It never reads
private recordings or derives a route name.

A nearby named relation is not a summit route. Long-distance trails often pass
near many summits. This command is dry-run discovery only. It cannot write
routes. Build and publish each useful candidate through the standard-route
pipeline, which requires a real trailhead, source provenance, segments,
independent review, and public verification.

```bash
cd migrate

# Full dry run; four workers, resumable source cache, and an unresolved list.
npm run audit:route-coverage -- \
  --concurrency=4 \
  --cache-dir=/tmp/peaks-route-coverage/osm \
  --report=/tmp/peaks-route-coverage/dry-run.json

# A bounded smoke run is marked partial.
npm run audit:route-coverage -- --batch-limit=1
```

Candidate IDs are stable hashes of the relation and connected way chain.
Reports count covered and unresolved summits without exposing user IDs.

## Protected area imports

Protected-area and land-management context is imported from USGS PAD-US into `areas`, then linked to summit destinations through `destination_areas`.

Input should be NDJSON or GeoJSONL exported from PAD-US 4.1 for production-size imports; small GeoJSON FeatureCollections are accepted for fixtures and ad hoc checks. The importer intentionally does not depend on local GIS CLIs such as `ogr2ogr`; export PAD-US data outside the script, then run:

```bash
cd migrate
npm run import:padus-areas -- --input=/path/padus-federal-areas.ndjson --dry-run
```

Before applying and linking, point the Cloud SQL Auth Proxy and DB env vars from the Migration section at the target DB, and apply protected-area migrations through `cloud-sql/migrations/20260728_session_area_sync.sql`. Apply mode checks the required session-area tables, boundary helper, and sync triggers before it starts a transaction. The dry run only parses and normalizes input; it does not verify DB readiness.

```bash
npm run import:padus-areas -- --input=/path/padus-federal-areas.ndjson --apply --link-destinations
```

Use `--replace-links` only when intentionally rebuilding all `source='postgis'` destination-area links:

```bash
npm run import:padus-areas -- --input=/path/padus-federal-areas.ndjson --apply --link-destinations --replace-links
```

Post-import smoke check:

```sql
SELECT d.name AS destination, a.name AS area, a.kind
FROM destinations d
JOIN destination_areas da ON da.destination_id = d.id
JOIN areas a ON a.id = da.area_id
WHERE lower(d.name) IN ('mount rainier', 'mt rainier')
ORDER BY a.kind, a.name;
```

Run this against the same DB target used for the import. Expected: Mount Rainier links to Mount Rainier National Park.

### Boundary tolerance (50 m)

Summit↔area linking is NOT strict containment. A summit links to an area when it is
`ST_Covers`-contained OR within **50 m** of the boundary, because PAD-US boundaries and summit
coordinates each carry ~10–50 m of positional error and many peaks sit *on* a park boundary line
(crests are common boundaries). The canonical case: Mount Whitney's summit is ~0.5 m outside
Sequoia NP / Inyo NF / John Muir Wilderness, which all meet at the crest there. 50 m was chosen
from a clean gap between real boundary mismatches (≤ ~48 m) and genuine non-members (Mount Mitchell
is 306 m from Pisgah NF). The tolerance lives in `link_summit_destinations_to_areas(replace_existing,
tolerance_m DEFAULT 50)`, in both area-linking triggers, and in the importer's
`AREA_LINK_TOLERANCE_M` — keep them in sync. Migration: `20260613_area_link_tolerance.sql`.

### Auto-linking triggers

Summits are flagged with their areas automatically, so you rarely need to re-run the batch helper:
- `trg_destination_link_areas` (AFTER INSERT ON destinations) — links a new summit at creation.
- `trg_session_destination_link_areas` (AFTER INSERT ON session_destinations) — links a summit the
  moment a recording reaches it ("incoming recordings checked + flagged").

Both are wrapped in an exception block so a linking failure can never abort the underlying insert.
Migrations: `20260613_area_link_on_destination.sql`, `20260613_area_link_on_session_destination.sql`.

## Trailhead facts import

Parking, fee, bathroom and access-road facts for existing trailheads, imported
from the normalized US Forest Service and National Park Service JSONL in
`docs/trailheads/data/` (that directory lives in the `peaks` checkout, not this
repo). The importer never creates a destination: a fact with no trailhead to
hang on is reported, not invented.

```bash
cd migrate
npm run import:trailhead-facts -- --data-dir=/path/to/peaks/docs/trailheads/data --sample-payloads=5
npm run import:trailhead-facts -- --data-dir=/path/to/peaks/docs/trailheads/data --apply
```

`--sample-payloads=N` makes a dry run print the N richest would-be payloads
with the destination each lands on — read those before approving an apply.

A source row is imported only when both gates pass: a destination with the
`trailhead` feature within **250 m**, and the name gate. The name gate passes on
either of two rules:

- **similarity** at or above the threshold (0.5 with `pg_trgm`, 0.7 for the JS
  token-overlap fallback; both override with `--name-threshold`);
- **token containment** — every token of the shorter normalized name appears in
  the longer one, and the shorter has at least two tokens.

Containment exists because Peaks appends qualifiers the agency does not
("Parking", "Picnic Area", "Day Use"), which trigram similarity punishes:
"Windy Peak Trailhead/Long Swamp" against "Windy Peak Trailhead" scores 0.344 at
0.0 m. Measured over the production dry run's 175 near-misses it recovers 40
rows across 28 pairs with no wrong match, and still rejects pairs that merely
share a word (Willow Lake / Willow Creek, Ape Canyon / Lava Canyon). The
two-token floor is what keeps "Butte" out of "Driveway Butte".

On a fee or bathroom row both rules try the EDW `site_name` and the
`public_site_name` — 16 percent of raw rows (1,151 of 7,357) yield a second,
genuinely different name once normalized, and Peaks catalogs trailheads under
the public one. A page row offers the one name printed on the page.

Rejected rows go to `import-unmatched-{fees,bathrooms,pages}.jsonl` in the data
directory with the reason, the nearest candidate, and which name scored best.
Matches go to `import-matched.jsonl` with the rule that carried each one, so
containment matches can be audited apart from threshold matches; the run summary
prints the same split.

The importer also reads the raw EDW pull
(`<data-dir>/raw/usfs-rec-sites-trailheads.jsonl`, `--raw-rec-sites` overrides)
and refuses to run without it. The normalized files drop two fields it needs:
`fee_charged` (the fee guard below) and `public_site_name` (the name gate).

**Every input file is required, and one that is present and empty fails the
same way a missing one does** — `assertNotEmpty`, one test per file. Zero rows
means the command that writes it did not run, ran against nothing, or was
truncated; importing that as a source with nothing to say logs the run as a
success and leaves `check:data-freshness` green on the failure it exists to
catch. The guard started on the raw pull, spread to the two derived files with
the NPS import, and now covers the three extraction files too.

The raw pull covers recreation **sites** only. The 1,243 fee rows from the
recreation-**opportunities** dataset have no raw counterpart, so their no-fee
claims rest on their quote text alone with nothing to cross-check: 632 rows
today, counted as `fee_required_false_quote_only` and printed in the run
summary. They also go through the gate under one name only.

Writes merge per leaf into `destinations.amenities` as `TrailheadAmenities`
(`migrate/src/lib/amenities.ts`), each leaf carrying its own source. Unrelated
blocks survive, unchanged rows are not rewritten, and a leaf owned by a source
outside `MANAGED_SOURCE_KINDS` is never overwritten. Conflicts: `fee_required`
true beats false, an explicit page capacity beats any other capacity, and
otherwise the agency dataset (`usfs_edw`) beats the web page (`usfs_web`).

**Never write `fee_required: false` without a verbatim quote, and never when
the raw row says `fee_charged='Y'`.** Both halves matter. The `fee_charged='N'`
flag is a lying default, so a no-fee claim needs source text — but the quote
alone proves little, since 2,551 of the 3,254 false rows quote the EDW
boilerplate "No fees are required for this site", 66 of them on records the
same dataset marks as charging (22 with an explicit STANDARD AMENITY FEE). The
stricter claim wins. Both guards live in `feeLeafCandidates` in
`migrate/src/trailhead-facts-utils.ts`.

### The third gated source: Forest Service site pages

`usfs_pages` reads `<data-dir>/fs-page-sections-full.jsonl` (`--sections=FILE`
overrides) and fills two parking leaves: `capacity_vehicles` from the page's
stated capacity, `fills_early_note` from its sentence about the lot filling.
Envelopes are `usfs_web` / US Forest Service / the page url / public domain,
stamped with the day part of `fetched_at`. **These are the only two facts in
this importer that no agency dataset publishes anywhere**, which is why a
web page is worth reading at all.

**Every row carries the page's own coordinates and goes through the same two
gates as a fee row.** It did not always. The registry has no coordinates, so a
page used to borrow the point of the same-named EDW trailhead, guarded by
Forest Service region equality. That mechanism located 710 pages, imported one
fact between them, and a cross-check against the extracted coordinates found
**all 98 of its far-outlier borrows to be wrong attaches**. It is gone, and so
are its four skip reasons (`no_edw_name_location`, `region_unknown`,
`region_mismatch`, `ambiguous_name_location`) and the region field that fed
them. A page with no coordinate of its own is counted under `no_coordinates`
and dropped — nothing infers one.

The rest of the row is read and none of it is imported. `fee_text`,
`restroom_text` and `road_text` are prose about facts the EDW, MVUM and
RoadCore datasets already publish as fields, and corroborating one against the
other is its own piece of work; `verbatim_spans` is the evidence a person
auditing the extraction reads, and `elevation_ft` belongs to the destination
rather than to its amenities. Two envelope guards are pinned by tests: a
`fetched_at` whose day part is not a real calendar day is refused rather than
trimmed into one, and a url that is not an `http(s)` link never becomes a
tappable source.

**Two of those unimported fields are read as guards, and a guard may only take
a fact away or make it smaller** — the same rule the road importer's single read
of its `derivation` block obeys. Three fire, all pinned by tests:

- **A capacity whose own words say truck, trailer, RV or stock is dropped.** The
  page counted rigs and there is no leaf for rigs; a multiplier would be a
  guess. Five rows in the file, two of them matched (Edds Mountain 6, Bear Pot 4).
- **A capacity stated as a range publishes the low end.** The extraction keeps
  the high end, and over-claiming parking is what strands a driver. Two rows
  ("10-15 cars", "fits 1-2 cars"), neither matched today.
- **A `fills_early_note` that appears word for word inside `road_text` is
  dropped, unless the sentence itself says fill, full, crowd or overflow.** The
  extraction found no sentence about the lot filling and lifted one out of the
  paragraph about how to get there. The substring rule fires on 51 rows and the
  exception readmits exactly two of them — Dog Mountain's "There are about 70
  spots fill quickly on weekends" and Max Patch's "You may not park on the road
  if the parking lot is full", both real facts a page happened to write inside
  its directions. The other 49 are directions or a sentence about how much room
  there is; none is readmitted. Three touch matched rows, of which two lose
  their whole row (Suntop, Tunnel Creek) and one keeps a capacity leaf (Corral
  Pass, whose note only repeats the capacity the leaf already carries). The
  exception's words carry word boundaries on purpose: a bare `full` also
  matches "carefully".

A capacity is also required to be a **positive whole number** rather than merely
non-negative: `0` renders as "0 vehicles", which reads as "there is no parking
here", and half a space is an extraction that went wrong. Fees keep the looser
check, because $0.00 and $5.50 are both real. Nothing in the file trips it today.

The registry (`fs-trailhead-page-registry.jsonl`) is still the crawl's source
of truth for which pages exist. The importer does not read it, and does not
read the older partial `fs-page-sections.jsonl` either. Refresh the pages by
re-running the Codex T6 work order (`docs/trailheads/codex-handoff-2.md`) and
then this importer.

### The fourth source: access roads

`usfs_roads` reads `<data-dir>/trailhead-road-access.jsonl`, written by
`roads:derive` (see "Access-road processing store" below), and fills the
`road_access` block. It is the one source that goes through **no gate at all**:
the derivation walked the road network starting from the production trailhead
rows, so every row carries the destination id it belongs to and the write is by
exact id. The only question left is whether that destination is still there and
still carries the `trailhead` feature — an id that has gone, or has stopped
being a trailhead, is counted and reported, never written.

The file is required like the raw EDW pull: a refresh that rewrote the fee and
bathroom files but not this one is an incomplete refresh, and importing three
quarters of it quietly would hide that. `--road-access=FILE` overrides the
path.

Five binding rules, all pinned by tests in `import-trailhead-facts.test.ts`:

- **A row with any `skip_reason` is skipped whole**, including the facts it does
  carry. An `unranked_path` row still publishes a surface and a road reference;
  importing those under a skip reason would read as a complete answer.
- **`derivation` is never imported, and `path_miles` least of all.** The audit
  block is read for exactly one thing — the gate-window evidence count — and
  written nowhere.
- **A window whose path holds a segment MVUM never described is refused**, with
  a warning naming the destination. `buildApproachRow` already withholds these,
  so one arriving here means that gate regressed.
- **A gate date must be a real `YYYY-MM-DD` day**, never reformatted or guessed
  at, and **the window must sit within a year of the run**. Nothing in
  production trips the range guard today; it stands against a derived file kept
  across a year boundary, or an anchoring bug upstream.
- **A leaf whose source kind is not one of `usfs_roadcore`, `usfs_mvum`,
  `blm_gtlf` is refused**, and each leaf's envelope is rebuilt field by field
  rather than copied — the file is a file, and `amenities` is unvalidated JSONB.

Refusals drop one leaf, not the row: a trailhead whose dates are refused still
gets its vehicle, surface and road reference. Rejected rows go to
`import-rejected-roads.jsonl` with the reason.

### The National Park Service pair: `nps_pois` and `nps_parking`

The Forest Service sources stop at the forest boundary, so a trailhead in a
national park had nothing. Two key-free NPS layers fill that in, joined by
`normalize:nps-trailhead-facts` and imported by exact id like the road facts:

```bash
cd migrate
npm run normalize:nps-trailhead-facts -- \
  --data-dir=/path/to/peaks/docs/trailheads/data --show=<destination-id>
```

It reads the catalog once, read-only, for trailhead ids, names and coordinates,
joins each trailhead to the nearest usable toilet POI and the nearest usable
parking polygon within **150 m**, and writes `nps-trailhead-facts.jsonl` — one
row per trailhead that got at least one of them, keyed by destination id, with
the join evidence in a `diagnostics` block the importer never reads. Today 32
trailheads get a restroom, 37 a lot, 15 both, 54 rows in all. The gate is 150 m
rather than the 250 m the fee and bathroom sources match at because this join
has no name to check itself against — only the distance.

Three binding rules, all pinned by tests:

- **NPS is presence-only** (`docs/trailheads/research-bathrooms.md` §3.2). It
  records the restrooms it has mapped and says nothing about the ones it has
  not, so nothing writes `bathrooms.status: absent`, and a trailhead the join
  found nothing for gets **no row at all** — an emitted row saying "considered,
  found nothing" is that forbidden negative written where a later reader takes
  it for one. `npsBathroomLeafCandidates` refuses a non-`present` status again
  on arrival, block and all, including a `type` that arrives without a status.
- **A count never comes from an area; a range may.** `research-parking.md` §2.5
  offered polygon area as a proxy at 30 m² a space and admitted the ratio had
  never been calibrated. It has been now — `migrate/src/parking-capacity.ts` and
  `migrate/docs/parking-capacity-calibration.md` — and it yields a bucket, not a
  number: `parking.capacity_range`, one of `under_10`, `10_to_25`, `25_to_50`,
  `50_to_100`, `100_plus`. `capacity_vehicles` is not merely absent from the NPS
  allow-list: a row carrying one is **refused by name**, because a number nobody
  counted, in the leaf counted numbers live in, reads exactly like a counted
  one. No code path converts between the two in either direction.

  The area obeys the contract in that module's header, kept in `npsLotCapacity`:
  the **nearest exterior part** of the feature (a multi-part feature is not one
  lot), **net of that part's interior rings** (gross-for-net moves 229 of the
  layer's buckets), measured **geodesically** on the WGS84 ellipsoid — checked
  against `ST_Area(geom::geography)` over 160 lots at a median 0.9 parts per
  million and a worst 17.9 inside the gates, and pinned by tests. Ring winding
  says which ring is which, except where a ring wound like an exterior is drawn
  inside one, which is read as a hole (14 rings in 11 features, all slivers
  under a square metre, no bucket moved — tidying, not a correction).
  `diagnostics.area` records `area_rank` (largest-first ordering, this code's)
  and `source_ring_index` (the layer's own ring number); only the second means
  anything outside this process.

  **The buckets are computed and not published.** The held-out re-validation
  cannot run — none of the 137 Forest Service pages with a stated capacity has
  an NPS lot within 200 m, and the OSM pull behind the calibration was deleted
  under ODbL — so `CAPACITY_RANGE_EMISSION_DEFAULT` is `false` and every run
  reports the ranges in its diagnostics instead. The gate is human:
  `npm run spotcheck:nps-capacity` writes 60 stratified lots **and all 37 that
  would actually publish** to `docs/trailheads/data/nps-capacity-spotcheck.{jsonl,md}`,
  each with a satellite link. Rows flagged `road?` — the layer draws some access
  roads and parking loops as parking polygons, and area says nothing useful
  about a carriageway — are scored but **excluded from the fraction**. At 80%
  correct-or-adjacent with a few exact `100_plus` hits, flip the default and
  pass `--capacity-range` (`--no-capacity-range` forces it shut).

  **Opening that gate is a one-way door for the data.** `mergeTrailheadAmenities`
  only ever sets a leaf; nothing removes one. A range that has been applied
  cannot be withdrawn by re-running with the gate shut — it simply stops being
  refreshed and stays on the row.
- **A candidate the layer disowns is stepped past, never negated.** `POISTATUS`
  in {`Planned`, `Not Existing`, `Decommissioned`, `Temporarily Closed`} — the
  POI layer only, the parking layer has no such field — plus `OPENTOPUBLIC=No`
  and `ISEXTANT=False`, which both layers carry. `npsFeatureAnomaly` also fails
  closed on a present-but-non-string value: a boolean `false` in `OPENTOPUBLIC`
  says the lot is shut as plainly as `"No"` does, and string-coercing it to `""`
  would publish it as visitor parking.
- **A lot whose name says it belongs to the staff is stepped past**, from a
  token list built off the layer's own spellings (121 names hold `maintenance`,
  101 `concession`, 80 `quarters`, 63 `residence`, and `main?t\w*` covers the
  four misspellings including `maitenance`). `LOTTYPE` is null on 5,448 of
  6,740 rows and `OPENTOPUBLIC` is Unknown on 6,091, so the name is the only
  signal: Longmire's yard sits 88 m from the Eagle Peak trailhead. The list
  errs wide on purpose — a false positive costs one trailhead its parking row,
  a false negative publishes a maintenance yard as somewhere to park.

**Conflict rule: an explicit agency claim beats an NPS spatial join on the same
leaf.** A Forest Service row saying `Vault toilet(s)` is the agency describing a
site it named; an NPS leaf is a restroom that happens to be within 150 m of a
point. It is enforced in `preferCandidate` for two candidates in the same run
and again in `mergeTrailheadAmenities` against a leaf already stored — the
second covers the run where last quarter's Forest Service row no longer clears
the name gate and the spatial join is the only candidate left.

`LOTNAME` is filled on 1,314 lots and `MAPLABEL` on 5,672, and every lot this
join matches today has a MAPLABEL and no LOTNAME — Paradise's upper lot
included — so the label is load-bearing, not a nicety. A name becomes a note
only when it says more than "Parking Lot" (375 rows) does, and a label the
source truncated with a trailing `*` is refused rather than trimmed into
"PARKI". The published note is title-cased — the layer shouts, and a detail
sheet should not — while `diagnostics.lot_name` keeps the original. A name that
already carries one lowercase letter is left exactly as the agency wrote it, so
codes like "SD (U)" survive.

Two more facts the normalizer reads that the type field alone would lose. Where
`POITYPE` is generic and the point's own `POINAME` names the fixture — "Kautz
Creek Vault Toilet", typed `Restroom` — the name sets the type, and
`diagnostics.type_from_poi_name` records that it did; a specific type is never
overruled by a name, and a name holding two fixture words is refused rather
than guessed at. And a restroom flagged `SEASONAL=Yes` with no `SEASDESC` gets
the one word the layer actually said, `season_note: "Seasonal"` — thin, and
still the difference between planning around a closure and never hearing of it.

Rejected rows go to `import-rejected-nps-pois.jsonl` and
`import-rejected-nps-parking.jsonl`: one file in, two sources out, because a
refused restroom and a refused lot are different failures.

Each run records a `data_source_runs` row per source (`--no-log` skips it;
a dry run is logged as `dry_run`, so it never counts as a refresh). Check
staleness with:

```bash
npm run check:data-freshness
```

It exits non-zero when a required source — `usfs_fees`, `usfs_bathrooms`,
`usfs_pages`, `usfs_roads`, `nps_pois` or `nps_parking` — is more than 90 days
past its last successful import or has never run. The NPS pair covers fewer
trailheads than anything else on that list and is required anyway: a spatial
join with no name behind it is true only while both ends stay put, and it
covers the busiest trailheads Peaks has. `usfs_pages` is required again after
one release outside the list — the single-leaf yield that demoted it was the
old borrowing mechanism's, not the pages'; with each page's own coordinates the
source carries real coverage, and a rewritten agency page goes stale without
saying so. Quarterly cadence and the full refresh sequence:
`migrate/docs/trailhead-data-refresh.md`.

## Access-road processing store

Phase 2 of the trailhead work: USFS RoadCore, USFS MVUM and BLM GTLF, loaded
and normalized so a later task can derive each trailhead's access vehicle,
surface and gate window. **Road segments never enter the `peaks` database** —
only the derived per-trailhead facts will. Processing happens in a local DuckDB
file, by default `<data-dir>/processing/roads.duckdb` (about 4.5 GB, beside the
raw downloads in the `peaks` checkout).

```bash
cd migrate
npm run roads:import -- --data-dir=/path/to/peaks/docs/trailheads/data
npm run roads:import -- --data-dir=... --only=topology --snap-tolerance=20
npm run roads:derive -- --data-dir=/path/to/peaks/docs/trailheads/data --sample=20
```

A full run deletes the store and rebuilds it from the three source files in
about 30 seconds; `--only=` rebuilds single stages (`roadcore, mvum, blm,
normalize, seasons, link, topology`). Row counts print against the download
manifest, so a short load is obvious. There is no GDAL on the host and none is
needed — DuckDB's spatial extension reads both geodatabases out of their zip
files through `/vsizip`.

Cloud SQL was the alternative and was rejected on measurement: pgRouting 3.6.2
is available there, but the instance is a `db-f1-micro` serving production with
3.1 GB used of a 10 GB disk that cannot shrink. Full reasoning, the table
inventory, and the traversal handover: `migrate/docs/roads-processing-store.md`.

**Two rules from `docs/trailheads/research-roads.md` §A3 are binding and both
are pinned by tests.** Break either and the app publishes a confident wrong
answer, which is worse than no answer.

- **Vehicle needed comes from `OPER_MAINT_LEVEL` or the BLM observed class,
  never from an MVUM permission flag.** 82.1% of segments MVUM marks open to
  passenger vehicles are built to high-clearance standard only — FR 8040-500 to
  the Mount Adams South Climb trailhead is tagged "yearlong, passenger vehicle
  open, 01/01-12/31" while the same database rates it high-clearance. The MVUM
  permission columns load into `raw_mvum` and go no further. Levels 3, 4 and 5
  are all passenger car; the difference is comfort, not capability.
- **`yearlong` and a lone `01/01-12/31` mean no seasonal data, not open all
  year.** A window is stored only where the cleaned flag is `seasonal` *and*
  the dates are narrower than the whole year. `seasonWindowsForClass` returns
  `null`, never an empty list, so "no window recorded" cannot be read as
  "closed all year".

Two more rules the traversal task must obey, both in `roads/graph.ts` and both
pinned by `roads-approach-summary.test.ts`:

- **Store `limitingSegmentKey`, never `edgeId`.** 46% of edge ids carry an
  `@piece` suffix from the noding, and piece numbers and node ids are
  positional, so a source refresh renumbers them and every stored reference
  quietly moves. `segmentKey` is `<source>:<GLOBALID or OBJECTID>` — the
  agency's own id, and the only thing that keeps a Tier-1 answer auditable.
- **An unknown edge poisons the whole path.** 55% of BLM edges have no
  `vehicleRank` (BLM's observed class is literally "Unknown" on nearly half its
  network) and 3,071 edges have no length. A plain maximum over that reports
  the second-worst *known* edge as the answer, and a plain sum counts a missing
  length as zero. `summarizeApproach` returns null for any answer whose path
  holds an unrated edge, with counts saying why. Render unknown as unknown.

BLM's `OBSRVE_ROUTE_USE_CLASS` is applied from the reviewed map at
`migrate/data/blm-route-use-class-map.jsonl` — version-controlled here because
it is a reviewed judgement rather than downloaded data, and the default the
loader reads (`--map=FILE` overrides; a data-directory copy is derived). Don't
rebuild it. Each of its 26
rows carries **two** reviewed decisions: `canonical_class` (what vehicle) and
`drivable` (whether it is a road at all). Both are needed — the class folds a
motorcycle single-track into `unknown`, which is right for "what vehicle" and
useless for "is this a road". A value the map cannot answer for, whether it is
unmapped or merely missing its `drivable` flag, is **kept out of the graph and
reported in the run summary**, so a refresh that adds a spelling gets reviewed
instead of silently becoming a road. 334 routes are excluded today: 306 by the
reviewed class, 28 by `PLAN_ALLOW_MODE_TRNSPRT` (`MTC_ONLY`,
`MTC_ATV_UTV_ONLY` — that check reads a different field so it stays in code).
Plan against 43.5% usable class (48,301 of 111,149), not the 87.3% "populated"
figure — 48,784 of the populated rows say literally "Unknown".

The graph is noded, not just endpoint-snapped. Snapping endpoints alone left
165,323 components with the largest holding 0.4% of nodes, because a spur that
joins the middle of a road shares no endpoint with it. Segments are also split
where they pass within the tolerance of a junction, at the single closest
vertex — splitting at every vertex inside the tolerance produced half a million
self-loop stubs. `metresBetweenSql` mirrors `metresBetween` for the 25-million
vertex pass that has to run in SQL, and a test asserts the two agree.

**The graph's real coverage number is anchor reach, not connectedness**, and
the run prints it: only 3,673 of 49,873 components hold a maintenance level 4/5
road, covering 32% of nodes. A walk inside an unanchored component runs to the
end and returns nothing however well-stitched that component is. Adding TIGER
S1500 so a state highway also counts as an anchor is the change most likely to
move it.

`roads:derive` walks that graph once per trailhead and writes one JSONL row per
trailhead to `<data-dir>/trailhead-road-access.jsonl`, each leaf shaped like
`TrailheadRoadAccess` in `lib/amenities.ts` and carrying its own source. It
reads the production database once, read-only, for trailhead ids, names and
coordinates. Today 568 of 918 trailheads snap and **328 reach an anchor and get
a full answer** (36% of the catalog); 104 of those carry a gate window. Six
rules it obeys, all pinned by `roads-approach-derivation.test.ts`:

- **A gate date is stored as `YYYY-MM-DD`.** The source has no year and the
  window recurs, but the iOS client parses ISO first and treats `MM/DD` as a
  provider fallback. A window through New Year closes in the next year.
  **February 29 is never published** — it exists one year in four, so a leap day
  moves one day the way that cannot overstate access (opens March 1, closes
  February 28).
- **Windows are intersected, never picked from** — across every MVUM segment
  the link returns and across every segment on the path. A segment with no
  window is left out rather than treated as open; an intersection covering the
  whole year is stored as no window at all.
- **Levels 3, 4 and 5 store `high_clearance: not_required`**, per §A3, with the
  surface leaf carrying the roughness. An ATV-only or unmaintained path stores
  no vehicle leaf at all.
- **`limiting_segment_key` in the audit block is the agency id**; the human
  `limiting_segment_ref` is derived from it ("FR 8040-500"), and `snap_edge_id`
  is positional and for debugging only. Where several segments tie at the worst
  rank the one named is the first on the path — the first rough road a driver
  meets, not the last.
- **An ATV-only or unmaintained path publishes no leaf at all** — not the
  surface, not the gate window, not the limiting road. "Dirt road, gate opens
  in April" is true of a route no highway vehicle belongs on and reads as an
  invitation. `skip_reason: not_car_passable` carries the reason instead.
- **`derivation` is diagnostic; never publish `path_miles`.** With no state
  highways in these sources the walk runs on to the next level 4/5 forest road,
  so South Climb derives 39.17 miles against about 13 real ones. It becomes a
  publishable number when TIGER lands. Likewise **no `seasonal_window` is
  emitted when `season_segments_without_evidence` is above zero** — a segment
  MVUM never described is not the same as one it describes without a gate. The
  gate is in `buildApproachRow`, so a copy-shaped importer cannot publish
  around it; the importer checks again and treats a window arriving with a gap
  as a validation failure (1 window withheld today).

The default path preference is `--prefer=easiest` — the gentlest way out, not
the shortest. It matches `nearest` on 320 of 328 answers and finds a
passenger-car way out on the other 8 for 3.11 extra miles across the catalog;
those rows carry `derivation.differs_from_nearest`. Watch item: an unranked
edge searches as worse than the worst real rank, so `easiest` routes around
unranked ground — once BLM trailheads appear it could answer confidently where
`nearest` would honestly answer nothing. Revisit at the first desert-peak data,
together with `season_restricted_without_dates`: a mixed path can publish an
MVUM window off its Forest Service segments while a BLM stretch of the same
drive is restricted on dates nobody has. Both ask what a mixed path may claim,
and both trip on the first BLM-served trailhead.

A second noding pass — projecting dangling endpoints onto the centrelines they
nearly touch — was measured against the 240 trailheads that snap without
reaching an anchor and **not implemented**: it would lift 12 of them at the
graph's own 10 m tolerance, and 20 only at 30 m, where parallel switchbacks
start welding together. For 194 of those 240 the nearest level 4/5 road is over
3 km away in a straight line, so the gap is coverage, not stitching.

## Session comparisons ("Your Efforts")

Pairwise overlap between a user's sessions, stored in `session_comparisons`
(session_a = earlier). Computed post-commit in processSession Step 8 via a
checkpoint/corridor model (`api/src/comparison-geometry.ts` — pure JS over
sampled points; PostGIS is only the planar candidate prefilter). ALL tunables
live in `api/src/comparison-params.ts`, each mapped to `MATCHER_VERSION`
(geometry — re-run `scripts/backfill-comparisons.ts` after a bump) or
`LEGS_VERSION` (summit-leg splits — run `scripts/recompute-comparison-legs.ts`,
much cheaper). Never tune a value without bumping its version. The dwell
radius (`SUMMIT_DWELL_RADIUS_M`) is deliberately separate from
`destination_match_radius()` — tuning it never changes which destinations a
session is tagged with.

## Local Development

```bash
# Start Cloud SQL Auth Proxy (required for both API and web admin)
cloud-sql-proxy PROJECT_ID:us-central1:peaks-db

# Then either:
cd api && npm run dev     # API on port 8080
# or use the web admin (../web) which connects directly via pg pool
```
