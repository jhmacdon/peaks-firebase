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
  `peaks` exactly (28 tables, 281 columns, 17 triggers).
- **A migration that fails provisioning is a real conflict** with `schema.sql`.
  Reconcile the two. Don't extend the skip list in `provision.sh`.
- **Pool max drops to 2 under `NODE_ENV=test`.** Each test file is its own
  process with its own pool; the instance allows 25 connections total. This is
  what lets the suite run in parallel instead of `--test-concurrency=1`.

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

The viewpoint importer reads one saved, state-wide OpenStreetMap snapshot and a
complete set of review decisions. It can also add a small set of named hiking
turnarounds whose OSM points have no name. Dry-run is the default. Apply needs
the reviewed report and its SHA-256, and stops if the source, reviews, planned
writes, or target rows changed after review.

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
```

The importer adds type-qualified OSM IDs, keeps all existing destination data,
and links old ended sessions only when both the saved path and a real tracking
point pass the destination radius. It honors saved session-destination
rejections. The first reviewed scope is in
`docs/data-audits/wa-viewpoints-2026-08-19.md`.

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
