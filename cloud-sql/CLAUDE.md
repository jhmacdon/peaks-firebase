# Peaks Cloud SQL

PostgreSQL 15+ with PostGIS + pg_trgm. Contains the database schema, Cloud Run API (Express), and Firestore migration scripts.

## Structure

```
schema.sql          # Full DDL: enums, tables, indexes, triggers
SETUP.md            # Provisioning guide (Cloud SQL, Cloud Run, migration)
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
- Pool max: 4 connections by default (`DB_POOL_MAX` can override)

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

Reports use separate `.apply.json` and `.dry-run.json` names, plus a latest
copy, so a proof run does not erase the write record.

Peakbagger ascent counts are a targeted manual popularity fallback. Do not
bulk-crawl Peakbagger; its browser capture workflow and low-rate guardrails are
documented in the `peaks-ascent-backfill` skill.

## Protected area imports

Protected-area and land-management context is imported from USGS PAD-US into `areas`, then linked to summit destinations through `destination_areas`.

Input should be NDJSON or GeoJSONL exported from PAD-US 4.1 for production-size imports; small GeoJSON FeatureCollections are accepted for fixtures and ad hoc checks. The importer intentionally does not depend on local GIS CLIs such as `ogr2ogr`; export PAD-US data outside the script, then run:

```bash
cd migrate
npm run import:padus-areas -- --input=/path/padus-federal-areas.ndjson --dry-run
```

Before applying and linking, point the Cloud SQL Auth Proxy and DB env vars from the Migration section at the target DB, and confirm `cloud-sql/migrations/20260611_protected_areas.sql` has already been applied. The dry run only parses and normalizes input; it does not verify DB schema or helper-function readiness.

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
