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
- `destination_feature`: volcano, fire-lookout, summit, trailhead, hut, lookout
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
- **Text IDs**: all PKs are `TEXT` (20-char alphanumeric, matching Firebase document ID style)
- **`search_name`**: lowercased/normalized copy of `name` for trigram search (indexed with `gin_trgm_ops`)
- **`updated_at` triggers**: automatic on destinations, lists, routes, tracking_sessions

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

### Auth pattern
All `/api/*` routes go through `requireAuth` middleware. Clients send `Authorization: Bearer <firebase-id-token>`. The middleware calls `admin.auth().verifyIdToken()` and sets `req.uid`.

### Connection
- **Cloud Run**: connects via Unix socket at `/cloudsql/INSTANCE_CONNECTION_NAME`
- **Local dev**: set `DB_HOST=127.0.0.1` to use TCP via Cloud SQL Auth Proxy
- Pool max: 10 connections

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (no auth) |
| GET | `/api/destinations/:id` | Destination detail |
| GET | `/api/destinations/nearby?lat=&lng=&radius=&limit=` | Nearby destinations |
| GET | `/api/destinations/viewport?minLat=&maxLat=&minLng=&maxLng=` | Map viewport query |
| GET | `/api/destinations/:id/lists` | Lists containing destination |
| GET | `/api/search?q=&lat=&lng=&limit=` | Fuzzy text search (pg_trgm + geo ranking) |
| GET | `/api/search/features?features=&activities=&lat=&lng=&radius=` | Filter by features/activities |
| GET | `/api/routes/...` | Route queries |
| GET | `/api/sessions/...` | Session queries |
| GET | `/api/sessions/changes?updated_since=&after_id=&limit=` | Incremental session sync feed with tombstones |
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

## Local Development

```bash
# Start Cloud SQL Auth Proxy (required for both API and web admin)
cloud-sql-proxy PROJECT_ID:us-central1:peaks-db

# Then either:
cd api && npm run dev     # API on port 8080
# or use the web admin (../web) which connects directly via pg pool
```
