# Protected Areas for Peaks

**Date:** 2026-06-11
**Status:** Approved

## Goal

Add first-class backend support for official land-management and protected-area context around peaks. Peaks like Mount Rainier should be linked to the areas that contain them, such as Mount Rainier National Park, and the source geometry should be accurate enough to support containment queries rather than name-based guesses.

## Rationale

The current `destinations` model represents things users visit: summits, trailheads, huts, lakes, waterfalls, campsites, and other points or small regions. National parks, monuments, forests, wilderness areas, refuges, and conservation areas are different. They are jurisdictional or management areas that can contain many destinations and can overlap each other.

Keeping these units in a dedicated `areas` model avoids overloading `destinations.boundary`, which is currently `geography(Polygon, 4326)` and is too narrow for PAD-US units that are often multipart. It also preserves many-to-many relationships: one summit can sit inside a national park, a wilderness area, and a national forest or proclamation boundary.

## Source

Use the U.S. Geological Survey Protected Areas Database of the United States (PAD-US) 4.1 as the seed source.

Official references:

- USGS PAD-US Data Download: https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-download
- USGS PAD-US Data Overview: https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview
- USGS PAD-US Data History: https://www.usgs.gov/programs/gap-analysis-project/pad-us-data-history
- USGS PAD-US Data Manual: https://www.usgs.gov/programs/gap-analysis-project/pad-us-data-manual

PAD-US 4.1 is the latest version listed by USGS as of this design. The data-download page states that PAD-US 4.1 is available and that downloads are provided nationally or by state/territory in ArcGIS Geodatabase format. The data-history page lists version 4.1 as released in March 2025.

## Scope

### In scope

- New Postgres schema for `areas`.
- New join table from `destinations` to `areas`.
- Import/backfill tooling for outdoor-relevant U.S. federal PAD-US area units.
- PostGIS containment linking from summit destinations to containing areas.
- API read support so destination detail can expose linked areas.
- Verification queries and smoke checks, including Mount Rainier -> Mount Rainier National Park.

### Out of scope

- UI changes in iOS or web beyond whatever existing clients get from the API response.
- User-created custom areas.
- State, local, tribal, nonprofit, or private protected areas in the first seed pass.
- Marine-only areas unless they are relevant to terrestrial peak context.
- Solving all overlapping PAD-US semantics for public-facing ranking. Store all links first; rank/filter display later if needed.

## Area coverage

The first seed pass includes outdoor-relevant federal units, not only the headline park/forest categories:

- National Parks
- National Monuments
- National Forests and National Grasslands
- Wilderness Areas
- National Recreation Areas
- National Conservation Areas and similar BLM conservation units
- National Wildlife Refuges where the geometry is terrestrial and useful for peak context
- Wild and Scenic River polygons where represented as polygonal PAD-US areas
- Similar PAD-US federal designations with clear outdoor/land-management relevance

The importer should filter from PAD-US attributes such as `Mang_Name`, `Own_Name`, `Des_Tp`, `Loc_Ds`, `Category`, `FeatClass`, `Pub_Access`, and related source identifiers. Exact filter values should be logged during dry runs so the first import can be audited before writing.

## Data model

Create a new `area_kind` enum:

```sql
CREATE TYPE area_kind AS ENUM (
  'national_park',
  'national_monument',
  'national_forest',
  'national_grassland',
  'wilderness',
  'national_recreation_area',
  'national_conservation_area',
  'wildlife_refuge',
  'wild_and_scenic_river',
  'other_federal_area'
);
```

Create a new `areas` table:

```sql
CREATE TABLE areas (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    search_name     TEXT NOT NULL,
    kind            area_kind NOT NULL,
    designation     TEXT,
    manager         TEXT,
    owner           TEXT,
    country_code    TEXT NOT NULL DEFAULT 'US',
    state_codes     TEXT[] NOT NULL DEFAULT '{}',

    source          TEXT NOT NULL,
    source_id       TEXT NOT NULL,
    source_version  TEXT NOT NULL,
    source_updated_at TIMESTAMPTZ,

    boundary        geography(MultiPolygon, 4326) NOT NULL,
    centroid        geography(Point, 4326) NOT NULL,
    bbox_min_lat    DOUBLE PRECISION NOT NULL,
    bbox_max_lat    DOUBLE PRECISION NOT NULL,
    bbox_min_lng    DOUBLE PRECISION NOT NULL,
    bbox_max_lng    DOUBLE PRECISION NOT NULL,

    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (source, source_id)
);
```

Create indexes:

```sql
CREATE INDEX idx_areas_boundary ON areas USING GIST (boundary);
CREATE INDEX idx_areas_centroid ON areas USING GIST (centroid);
CREATE INDEX idx_areas_search_name ON areas USING GIN (search_name gin_trgm_ops);
CREATE INDEX idx_areas_kind ON areas (kind);
```

Create a join table:

```sql
CREATE TABLE destination_areas (
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    area_id         TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    relation        TEXT NOT NULL DEFAULT 'contained_by',
    source          TEXT NOT NULL DEFAULT 'postgis',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (destination_id, area_id)
);
```

`destination_areas` is the durable reference from a peak to its areas. Do not add an `area_ids` array to `destinations`; the join table preserves referential integrity and supports overlapping areas cleanly.

## Import path

Add `cloud-sql/migrate/src/import-padus-areas.ts`.

The importer should support:

- `--dry-run` for counts, filters, sample rows, and overlap diagnostics with no writes.
- `--input=<path>` for local GeoJSON or newline-delimited GeoJSON exported from PAD-US.
- `--apply` for writing.
- `--link-destinations` for running or re-running the summit containment backfill after area import.

The runtime should not depend on `ogr2ogr` or other system GIS binaries because they are not installed in this workspace and would make the script brittle. The practical path is:

1. Download PAD-US nationally or by state/territory from USGS.
2. Export the relevant PAD-US feature classes to GeoJSON or NDJSON outside the script when needed.
3. Let the Node importer parse GeoJSON/NDJSON, normalize fields, dissolve logical units, and upsert into Postgres.

If the PAD-US web services provide a stable ArcGIS REST query endpoint for the required feature classes, the importer can later add a `--source=web-service` mode. The first implementation should keep the import deterministic by consuming local exported data.

## Normalization

The importer should normalize a PAD-US feature into:

- `name`: preferred PAD-US unit name.
- `kind`: mapped from designation/manager/category fields.
- `designation`: original standardized designation type where available.
- `manager`: PAD-US manager name.
- `owner`: PAD-US owner name.
- `state_codes`: all states touched by the final dissolved geometry.
- `source`: `padus`.
- `source_version`: `4.1`.
- `source_id`: a stable PAD-US identifier if present; otherwise a deterministic hash of normalized name, kind, designation, manager, and source record identifiers.
- `metadata`: raw PAD-US fields needed for audit and future remapping.

The script should dissolve multipart records by stable logical identity so one real area becomes one `MultiPolygon`. For example, a national forest with many parcels should become a single `areas` row with a multipart boundary rather than hundreds of separate rows.

Geometry handling:

- Accept `Polygon` and `MultiPolygon`.
- Convert all stored boundaries to `MultiPolygon`.
- Reject invalid, empty, or non-area geometries.
- Use PostGIS `ST_MakeValid`, `ST_CollectionExtract(..., 3)`, `ST_Multi`, and `ST_SimplifyPreserveTopology` only if simplification is explicitly configured. The default import should store the authoritative shape without simplification.
- Compute centroid and bbox from the stored boundary in SQL.

## Linking

Add a backfill query that links summit destinations to all containing areas:

```sql
INSERT INTO destination_areas (destination_id, area_id, relation, source)
SELECT d.id, a.id, 'contained_by', 'postgis'
FROM destinations d
JOIN areas a ON ST_Covers(a.boundary, d.location)
WHERE d.location IS NOT NULL
  AND 'summit'::destination_feature = ANY(d.features)
ON CONFLICT (destination_id, area_id) DO NOTHING;
```

Use `ST_Covers` rather than `ST_Contains` so points on a boundary still link.

Do not delete existing links by default. Add a separate `--replace-links` flag if a future re-import needs to remove stale `source='postgis'` links before rebuilding.

## API

Add linked-area read support to destination detail. The destination response can include:

```json
"areas": [
  {
    "id": "...",
    "name": "Mount Rainier National Park",
    "kind": "national_park",
    "designation": "National Park",
    "manager": "National Park Service"
  }
]
```

The API should not return area boundary GeoJSON inside normal destination detail responses. Boundaries are large and should be fetched by a future dedicated endpoint if the UI needs to draw them.

## Verification

Automated checks:

- Add a migration/API test fixture that inserts a tiny `areas` polygon and a summit destination inside it, runs the linking query, and verifies a `destination_areas` row is created.
- Add a fixture for a point exactly on the polygon boundary to prove `ST_Covers` handles boundary points.
- Build the migrate package: `cd cloud-sql/migrate && npm run build`.
- Build and test the API after response changes: `cd cloud-sql/api && npm run build && npm run lint && npm test`.

Real-data smoke checks after import:

```sql
SELECT d.name AS destination, a.name AS area, a.kind
FROM destinations d
JOIN destination_areas da ON da.destination_id = d.id
JOIN areas a ON a.id = da.area_id
WHERE lower(d.name) IN ('mount rainier', 'mt rainier')
ORDER BY a.kind, a.name;
```

Expected: includes `Mount Rainier National Park`.

Report:

- Number of imported areas by `kind`.
- Number of summit destinations linked to at least one area.
- Number of summit destinations with no linked area.
- Top 25 summit destinations by linked-area count, to catch noisy overlap categories.
- Areas with invalid or skipped geometry, grouped by reason.

## Risks

- **PAD-US overlaps are meaningful but noisy.** A summit may link to many designations. Store all links first; later UI/API ranking can decide which areas to display most prominently.
- **Multipart geometry size can be large.** Store authoritative shapes in Postgres, but do not embed boundaries in common API responses.
- **Stable identity may vary by feature class.** Prefer PAD-US stable identifiers when available; use deterministic fallback IDs only when needed and preserve raw source fields in `metadata`.
- **Full national import may be heavy.** Support state/territory inputs and idempotent upserts so the import can run incrementally.
- **Source updates can shift boundaries.** Keep `source_version` and import diagnostics so PAD-US 4.2+ can be compared deliberately rather than silently replacing geometry.
