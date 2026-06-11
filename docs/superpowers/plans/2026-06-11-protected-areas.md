# Protected Areas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add official protected-area and land-management areas to the Postgres backend, seed them from PAD-US, link summit destinations to containing areas, and expose linked areas from destination detail.

**Architecture:** Add a dedicated `areas` table with authoritative `MultiPolygon` boundaries and a `destination_areas` join table. Import PAD-US GeoJSON/NDJSON through the migrate package, using pure normalization helpers for test coverage and PostGIS for geometry validity, dissolving, bbox, and containment linking. Keep destination records unchanged; the reference from a peak to a park/forest/monument is the join row.

**Tech Stack:** PostgreSQL 15, PostGIS, pg_trgm, Node 20, TypeScript, node:test, Express, node-postgres.

**Spec:** `docs/superpowers/specs/2026-06-11-protected-areas-design.md`

---

## File Map

**Create:**

- `cloud-sql/migrations/20260611_protected_areas.sql` — enum, tables, indexes, trigger, and link helper function.
- `cloud-sql/migrate/src/padus-area-utils.ts` — pure PAD-US normalization, GeoJSON shape conversion, and SQL text builders.
- `cloud-sql/migrate/src/import-padus-areas.ts` — CLI importer and destination-link runner.
- `cloud-sql/migrate/src/__tests__/padus-area-utils.test.ts` — unit tests for importer helpers.
- `cloud-sql/api/src/__tests__/destination-areas-response.test.ts` — unit tests for destination detail SQL and response mapping.

**Modify:**

- `cloud-sql/schema.sql` — add the from-scratch DDL matching the migration.
- `cloud-sql/CLAUDE.md` — document `area_kind`, `areas`, and `destination_areas`.
- `cloud-sql/migrate/package.json` — add `test` and `import:padus-areas` scripts.
- `cloud-sql/api/src/routes/destinations.ts` — include linked areas on destination detail through testable helpers.

---

## Task 1: Database Schema

**Files:**

- Create: `cloud-sql/migrations/20260611_protected_areas.sql`
- Modify: `cloud-sql/schema.sql`
- Modify: `cloud-sql/CLAUDE.md`

- [ ] **Step 1: Create the migration**

Create `cloud-sql/migrations/20260611_protected_areas.sql`:

```sql
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'area_kind') THEN
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
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS areas (
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

CREATE TABLE IF NOT EXISTS destination_areas (
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    area_id         TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    relation        TEXT NOT NULL DEFAULT 'contained_by',
    source          TEXT NOT NULL DEFAULT 'postgis',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (destination_id, area_id)
);

CREATE INDEX IF NOT EXISTS idx_areas_boundary
  ON areas USING GIST (boundary);

CREATE INDEX IF NOT EXISTS idx_areas_centroid
  ON areas USING GIST (centroid);

CREATE INDEX IF NOT EXISTS idx_areas_search_name
  ON areas USING GIN (search_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_areas_kind
  ON areas (kind);

CREATE INDEX IF NOT EXISTS idx_destination_areas_area
  ON destination_areas (area_id);

DROP TRIGGER IF EXISTS trg_areas_updated ON areas;
CREATE TRIGGER trg_areas_updated
BEFORE UPDATE ON areas
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION link_summit_destinations_to_areas(replace_existing BOOLEAN DEFAULT false)
RETURNS INTEGER AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  IF replace_existing THEN
    DELETE FROM destination_areas WHERE source = 'postgis';
  END IF;

  INSERT INTO destination_areas (destination_id, area_id, relation, source)
  SELECT d.id, a.id, 'contained_by', 'postgis'
  FROM destinations d
  JOIN areas a ON ST_Covers(a.boundary, d.location)
  WHERE d.location IS NOT NULL
    AND 'summit'::destination_feature = ANY(d.features)
  ON CONFLICT (destination_id, area_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;

COMMIT;
```

- [ ] **Step 2: Update `cloud-sql/schema.sql` custom types**

Add this enum immediately after the existing `destination_feature` enum:

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

- [ ] **Step 3: Update `cloud-sql/schema.sql` tables**

Add the `areas` and `destination_areas` tables after `list_destinations` and before `segments`:

```sql
-- ---------------------------------------------------------------------------
-- areas
-- Official land-management and protected-area units from authoritative sources
-- such as USGS PAD-US. Areas are context around destinations, not destinations
-- themselves, and can overlap each other.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- destination_areas
-- Join table linking destinations, primarily summits, to containing official
-- areas. A destination can be contained by multiple overlapping areas.
-- ---------------------------------------------------------------------------
CREATE TABLE destination_areas (
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    area_id         TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    relation        TEXT NOT NULL DEFAULT 'contained_by',
    source          TEXT NOT NULL DEFAULT 'postgis',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (destination_id, area_id)
);
```

- [ ] **Step 4: Update `cloud-sql/schema.sql` indexes and triggers**

Add these indexes next to the existing destination/list indexes:

```sql
CREATE INDEX idx_areas_boundary         ON areas USING GIST (boundary);
CREATE INDEX idx_areas_centroid         ON areas USING GIST (centroid);
CREATE INDEX idx_areas_search_name      ON areas USING GIN (search_name gin_trgm_ops);
CREATE INDEX idx_areas_kind             ON areas (kind);
CREATE INDEX idx_destination_areas_area ON destination_areas (area_id);
```

Add the trigger next to the other `updated_at` triggers:

```sql
CREATE TRIGGER trg_areas_updated          BEFORE UPDATE ON areas              FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

Add this function near the existing destination/session link helper functions:

```sql
CREATE OR REPLACE FUNCTION link_summit_destinations_to_areas(replace_existing BOOLEAN DEFAULT false)
RETURNS INTEGER AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  IF replace_existing THEN
    DELETE FROM destination_areas WHERE source = 'postgis';
  END IF;

  INSERT INTO destination_areas (destination_id, area_id, relation, source)
  SELECT d.id, a.id, 'contained_by', 'postgis'
  FROM destinations d
  JOIN areas a ON ST_Covers(a.boundary, d.location)
  WHERE d.location IS NOT NULL
    AND 'summit'::destination_feature = ANY(d.features)
  ON CONFLICT (destination_id, area_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 5: Update `cloud-sql/CLAUDE.md`**

In the Enums section, add:

```md
- `area_kind`: national_park, national_monument, national_forest, national_grassland, wilderness, national_recreation_area, national_conservation_area, wildlife_refuge, wild_and_scenic_river, other_federal_area
```

In the Key design decisions section, add:

```md
- **Areas are separate from destinations**: official protected-area and land-management units live in `areas` with `geography(MultiPolygon, 4326)` boundaries; `destination_areas` links summits to every containing area.
```

- [ ] **Step 6: Apply and verify the migration locally when DB access is available**

Run:

```bash
cd /Users/josiahm/projects/peaks/firebase
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U postgres -d peaks -f cloud-sql/migrations/20260611_protected_areas.sql
```

Expected: `BEGIN`, object creation notices only if re-applied, and `COMMIT`.

Verify:

```bash
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U postgres -d peaks -c "
SELECT typname FROM pg_type WHERE typname = 'area_kind';
SELECT table_name FROM information_schema.tables WHERE table_name IN ('areas', 'destination_areas');
SELECT proname FROM pg_proc WHERE proname = 'link_summit_destinations_to_areas';
"
```

Expected: rows for `area_kind`, `areas`, `destination_areas`, and `link_summit_destinations_to_areas`.

- [ ] **Step 7: Commit**

```bash
cd /Users/josiahm/projects/peaks/firebase
git add cloud-sql/migrations/20260611_protected_areas.sql cloud-sql/schema.sql cloud-sql/CLAUDE.md
git commit -m "DB: add protected areas schema"
```

---

## Task 2: PAD-US Normalization Helpers

**Files:**

- Create: `cloud-sql/migrate/src/__tests__/padus-area-utils.test.ts`
- Create: `cloud-sql/migrate/src/padus-area-utils.ts`
- Modify: `cloud-sql/migrate/package.json`

- [ ] **Step 1: Add the migrate test script**

In `cloud-sql/migrate/package.json`, change the `scripts` object to include:

```json
"test": "NODE_ENV=test node --test --import tsx src/__tests__/*.test.ts",
"import:padus-areas": "tsx src/import-padus-areas.ts"
```

Keep the existing scripts; only add these two entries.

- [ ] **Step 2: Write the failing normalization tests**

Create `cloud-sql/migrate/src/__tests__/padus-area-utils.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildLinkDestinationsSql,
  geometryToMultiPolygon,
  normalizePadusFeature,
  shouldImportPadusFeature,
} from "../padus-area-utils";

const square = {
  type: "Polygon" as const,
  coordinates: [[
    [-121.9, 46.7],
    [-121.6, 46.7],
    [-121.6, 46.95],
    [-121.9, 46.95],
    [-121.9, 46.7],
  ]],
};

test("normalizes a PAD-US national park feature", () => {
  const area = normalizePadusFeature({
    type: "Feature",
    geometry: square,
    properties: {
      Unit_Nm: "Mount Rainier National Park",
      Des_Tp: "National Park",
      Mang_Name: "National Park Service",
      Own_Name: "National Park Service",
      State_Nm: "Washington",
      State_Nm2: "",
      GIS_Acres: 236380.1,
      PADUS_ID: "NPS-MORA",
    },
  }, "4.1");

  assert.equal(area?.name, "Mount Rainier National Park");
  assert.equal(area?.searchName, "mount rainier national park");
  assert.equal(area?.kind, "national_park");
  assert.equal(area?.designation, "National Park");
  assert.equal(area?.manager, "National Park Service");
  assert.deepEqual(area?.stateCodes, ["WA"]);
  assert.equal(area?.source, "padus");
  assert.equal(area?.sourceVersion, "4.1");
  assert.equal(area?.sourceRecordId, "NPS-MORA");
  assert.match(area?.sourceId ?? "", /^padus-/);
  assert.doesNotMatch(area?.sourceId ?? "", /^padus41-/);
  assert.equal(area?.groupKey, "national_park|mount rainier national park|national park|national park service");
});

test("keeps outdoor-relevant federal wilderness and rejects local parks", () => {
  const wilderness = {
    type: "Feature" as const,
    geometry: square,
    properties: {
      Unit_Nm: "Alpine Lakes Wilderness",
      Des_Tp: "Wilderness Area",
      Mang_Name: "Forest Service",
      Own_Name: "Forest Service",
      State_Nm: "Washington",
    },
  };
  const localPark = {
    type: "Feature" as const,
    geometry: square,
    properties: {
      Unit_Nm: "Volunteer Park",
      Des_Tp: "Local Park",
      Mang_Name: "City Land",
      Own_Name: "City Land",
      State_Nm: "Washington",
    },
  };

  assert.equal(shouldImportPadusFeature(wilderness), true);
  assert.equal(shouldImportPadusFeature(localPark), false);
});

test("converts polygons to multipolygons and preserves multipolygons", () => {
  assert.deepEqual(geometryToMultiPolygon(square), {
    type: "MultiPolygon",
    coordinates: [square.coordinates],
  });

  const multi = {
    type: "MultiPolygon" as const,
    coordinates: [square.coordinates],
  };
  assert.deepEqual(geometryToMultiPolygon(multi), multi);
});

test("builds destination-area link SQL through the schema helper function", () => {
  const keep = buildLinkDestinationsSql(false);
  assert.equal(keep.trim(), "SELECT link_summit_destinations_to_areas(false) AS inserted_count;");
  assert.doesNotMatch(keep, /DELETE FROM destination_areas/);
  assert.doesNotMatch(keep, /INSERT INTO destination_areas/);
  assert.doesNotMatch(keep, /WITH /);

  const replace = buildLinkDestinationsSql(true);
  assert.equal(replace.trim(), "SELECT link_summit_destinations_to_areas(true) AS inserted_count;");
  assert.doesNotMatch(replace, /DELETE FROM destination_areas/);
  assert.doesNotMatch(replace, /INSERT INTO destination_areas/);
  assert.doesNotMatch(replace, /WITH /);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
cd /Users/josiahm/projects/peaks/firebase/cloud-sql/migrate
npm test
```

Expected: failure because `../padus-area-utils` does not exist.

- [ ] **Step 4: Implement `padus-area-utils.ts`**

Create `cloud-sql/migrate/src/padus-area-utils.ts`:

```ts
import crypto from "crypto";

export type AreaKind =
  | "national_park"
  | "national_monument"
  | "national_forest"
  | "national_grassland"
  | "wilderness"
  | "national_recreation_area"
  | "national_conservation_area"
  | "wildlife_refuge"
  | "wild_and_scenic_river"
  | "other_federal_area";

export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface GeoJsonMultiPolygon {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

export type GeoJsonAreaGeometry = GeoJsonPolygon | GeoJsonMultiPolygon;

export interface GeoJsonFeature {
  type: "Feature";
  geometry: GeoJsonAreaGeometry | null;
  properties: Record<string, unknown> | null;
}

export interface NormalizedPadusArea {
  name: string;
  searchName: string;
  kind: AreaKind;
  designation: string | null;
  manager: string | null;
  owner: string | null;
  stateCodes: string[];
  source: "padus";
  sourceVersion: string;
  sourceId: string;
  sourceRecordId: string;
  groupKey: string;
  geometry: GeoJsonMultiPolygon;
  metadata: Record<string, unknown>;
}

const STATE_CODES: Record<string, string> = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
  "District of Columbia": "DC",
};

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

export function normalizeSearchName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stableId(prefix: string, parts: string[]): string {
  const hash = crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 20);
  return `${prefix}-${hash}`;
}

function mapKind(props: Record<string, unknown>): AreaKind | null {
  const designationText = [
    text(props.Des_Tp),
    text(props.Loc_Ds),
    text(props.Unit_Nm),
    text(props.Category),
  ].filter(Boolean).join(" ").toLowerCase();
  const managerText = [
    text(props.Mang_Name),
    text(props.Own_Name),
  ].filter(Boolean).join(" ").toLowerCase();

  if (/\bnational monument\b/.test(designationText)) return "national_monument";
  if (/\bnational recreation area\b/.test(designationText)) return "national_recreation_area";
  if (/\bnational conservation area\b/.test(designationText)) return "national_conservation_area";
  if (/\bnational grassland\b/.test(designationText)) return "national_grassland";
  if (/\bnational forest\b/.test(designationText)) return "national_forest";
  if (/\bnational park\b/.test(designationText)) return "national_park";
  if (/\bwilderness\b/.test(designationText)) return "wilderness";
  if (/\bwildlife refuge\b/.test(designationText)) return "wildlife_refuge";
  if (/\bwild( |-)and( |-)scenic river\b/.test(designationText)) return "wild_and_scenic_river";
  if (/\bblm\b|\bbureau of land management\b|\bnational landscape conservation system\b/.test(`${designationText} ${managerText}`)) {
    return "other_federal_area";
  }
  return null;
}

function isFederal(props: Record<string, unknown>): boolean {
  const haystack = [
    text(props.Mang_Name),
    text(props.Own_Name),
    text(props.Mang_Type),
    text(props.Own_Type),
  ].filter(Boolean).join(" ").toLowerCase();

  return /\bfederal\b|\bnational park service\b|\bforest service\b|\bbureau of land management\b|\bfish and wildlife service\b|\busfs\b|\bnps\b|\bblm\b|\bfws\b/.test(haystack);
}

function stateCodes(props: Record<string, unknown>): string[] {
  const values = [
    text(props.State_Nm),
    text(props.State_Nm2),
    text(props.State_Nm3),
    text(props.State),
    text(props.STATE),
  ].filter(Boolean) as string[];
  const out = new Set<string>();
  for (const value of values) {
    for (const part of value.split(/[;,]/)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const upper = trimmed.toUpperCase();
      if (/^[A-Z]{2}$/.test(upper)) out.add(upper);
      else if (STATE_CODES[trimmed]) out.add(STATE_CODES[trimmed]);
    }
  }
  return Array.from(out).sort();
}

export function geometryToMultiPolygon(geometry: GeoJsonAreaGeometry): GeoJsonMultiPolygon {
  if (geometry.type === "MultiPolygon") return geometry;
  return { type: "MultiPolygon", coordinates: [geometry.coordinates] };
}

export function shouldImportPadusFeature(feature: GeoJsonFeature): boolean {
  const props = feature.properties ?? {};
  if (!feature.geometry) return false;
  if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") return false;
  return isFederal(props) && mapKind(props) !== null;
}

export function normalizePadusFeature(
  feature: GeoJsonFeature,
  sourceVersion: string
): NormalizedPadusArea | null {
  if (!shouldImportPadusFeature(feature)) return null;

  const props = feature.properties ?? {};
  const name = text(props.Unit_Nm) ?? text(props.Name) ?? text(props.NAME);
  const kind = mapKind(props);
  if (!name || !kind || !feature.geometry) return null;

  const designation = text(props.Des_Tp) ?? text(props.Loc_Ds);
  const manager = text(props.Mang_Name);
  const owner = text(props.Own_Name);
  const searchName = normalizeSearchName(name);
  const groupKey = [
    kind,
    searchName,
    normalizeSearchName(designation ?? ""),
    normalizeSearchName(manager ?? ""),
  ].join("|");

  const sourceRecordId =
    text(props.PADUS_ID) ??
    text(props.PADUSID) ??
    text(props.GIS_ID) ??
    text(props.OBJECTID) ??
    stableId("record", [groupKey, JSON.stringify(props)]);

  return {
    name,
    searchName,
    kind,
    designation,
    manager,
    owner,
    stateCodes: stateCodes(props),
    source: "padus",
    sourceVersion,
    sourceId: stableId("padus", [groupKey]),
    sourceRecordId,
    groupKey,
    geometry: geometryToMultiPolygon(feature.geometry),
    metadata: { padus: props },
  };
}

export function buildLinkDestinationsSql(replaceExisting: boolean): string {
  return `SELECT link_summit_destinations_to_areas(${replaceExisting ? "true" : "false"}) AS inserted_count;`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
cd /Users/josiahm/projects/peaks/firebase/cloud-sql/migrate
npm test
```

Expected: all `padus-area-utils` tests pass.

- [ ] **Step 6: Run the migrate build**

Run:

```bash
cd /Users/josiahm/projects/peaks/firebase/cloud-sql/migrate
npm run build
```

Expected: TypeScript compiles with no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/josiahm/projects/peaks/firebase
git add cloud-sql/migrate/package.json cloud-sql/migrate/src/__tests__/padus-area-utils.test.ts cloud-sql/migrate/src/padus-area-utils.ts
git commit -m "Migrate: add PAD-US area normalization"
```

---

## Task 3: PAD-US Import CLI

**Files:**

- Create: `cloud-sql/migrate/src/import-padus-areas.ts`
- Modify: `cloud-sql/migrate/src/__tests__/padus-area-utils.test.ts`
- Modify: `cloud-sql/migrate/src/padus-area-utils.ts`

- [ ] **Step 1: Add failing tests for GeoJSON parsing**

In `cloud-sql/migrate/src/__tests__/padus-area-utils.test.ts`, update the existing import from `../padus-area-utils` to include `parseGeoJsonFeatures`:

```ts
import {
  buildLinkDestinationsSql,
  geometryToMultiPolygon,
  normalizePadusFeature,
  parseGeoJsonFeatures,
  shouldImportPadusFeature,
} from "../padus-area-utils";
```

Then append this test to the same file:

```ts
test("parses feature collections and NDJSON features", () => {
  const collectionText = JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: square, properties: { Unit_Nm: "A", Des_Tp: "National Park", Mang_Name: "National Park Service" } }],
  });
  const collection = parseGeoJsonFeatures(collectionText);
  assert.equal(collection.length, 1);

  const ndjson = [
    JSON.stringify({ type: "Feature", geometry: square, properties: { Unit_Nm: "A", Des_Tp: "National Park", Mang_Name: "National Park Service" } }),
    JSON.stringify({ type: "Feature", geometry: square, properties: { Unit_Nm: "B", Des_Tp: "National Forest", Mang_Name: "Forest Service" } }),
  ].join("\n");
  const parsedNdjson = parseGeoJsonFeatures(ndjson);
  assert.equal(parsedNdjson.length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/josiahm/projects/peaks/firebase/cloud-sql/migrate
npm test
```

Expected: failure because `parseGeoJsonFeatures` is not exported.

- [ ] **Step 3: Implement GeoJSON parsing**

Append to `cloud-sql/migrate/src/padus-area-utils.ts`:

```ts
export function parseGeoJsonFeatures(contents: string): GeoJsonFeature[] {
  const trimmed = contents.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
      return parsed.features as GeoJsonFeature[];
    }
    if (parsed.type === "Feature") {
      return [parsed as GeoJsonFeature];
    }
    throw new Error("GeoJSON input must be a FeatureCollection or Feature");
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parsed = JSON.parse(line);
      if (parsed.type !== "Feature") {
        throw new Error("NDJSON input lines must be GeoJSON Feature objects");
      }
      return parsed as GeoJsonFeature;
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd /Users/josiahm/projects/peaks/firebase/cloud-sql/migrate
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Create the importer CLI**

Create `cloud-sql/migrate/src/import-padus-areas.ts`:

```ts
import fs from "fs";
import db from "./db";
import {
  buildLinkDestinationsSql,
  normalizePadusFeature,
  parseGeoJsonFeatures,
  type NormalizedPadusArea,
} from "./padus-area-utils";

interface Args {
  input: string | null;
  sourceVersion: string;
  apply: boolean;
  dryRun: boolean;
  linkDestinations: boolean;
  replaceLinks: boolean;
}

function parseArgs(argv: string[]): Args {
  const inputArg = argv.find((a) => a.startsWith("--input="));
  const versionArg = argv.find((a) => a.startsWith("--source-version="));
  const apply = argv.includes("--apply");
  return {
    input: inputArg ? inputArg.slice("--input=".length) : null,
    sourceVersion: versionArg ? versionArg.slice("--source-version=".length) : "4.1",
    apply,
    dryRun: argv.includes("--dry-run") || !apply,
    linkDestinations: argv.includes("--link-destinations"),
    replaceLinks: argv.includes("--replace-links"),
  };
}

function usage(): string {
  return [
    "Usage:",
    "  tsx src/import-padus-areas.ts --input=/path/padus.geojson --dry-run",
    "  tsx src/import-padus-areas.ts --input=/path/padus.geojson --apply",
    "  tsx src/import-padus-areas.ts --input=/path/padus.geojson --apply --link-destinations",
    "  tsx src/import-padus-areas.ts --input=/path/padus.geojson --apply --link-destinations --replace-links",
  ].join("\n");
}

function groupAreas(areas: NormalizedPadusArea[]): Map<string, NormalizedPadusArea[]> {
  const groups = new Map<string, NormalizedPadusArea[]>();
  for (const area of areas) {
    const list = groups.get(area.groupKey);
    if (list) list.push(area);
    else groups.set(area.groupKey, [area]);
  }
  return groups;
}

async function createTempTable(): Promise<void> {
  await db.query(`
    CREATE TEMP TABLE padus_area_import_parts (
      group_key text NOT NULL,
      id text NOT NULL,
      name text NOT NULL,
      search_name text NOT NULL,
      kind area_kind NOT NULL,
      designation text,
      manager text,
      owner_name text,
      country_code text NOT NULL,
      state_codes text[] NOT NULL,
      source text NOT NULL,
      source_id text NOT NULL,
      source_version text NOT NULL,
      source_record_id text NOT NULL,
      metadata jsonb NOT NULL,
      geom geometry(MultiPolygon, 4326) NOT NULL
    ) ON COMMIT DROP
  `);
}

async function insertParts(areas: NormalizedPadusArea[]): Promise<void> {
  for (const area of areas) {
    await db.query(
      `INSERT INTO padus_area_import_parts (
         group_key, id, name, search_name, kind, designation, manager,
         owner_name, country_code, state_codes, source, source_id,
         source_version, source_record_id, metadata, geom
       ) VALUES (
         $1, $2, $3, $4, $5::area_kind, $6, $7,
         $8, 'US', $9::text[], $10, $11,
         $12, $13, $14::jsonb,
         ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($15), 4326)), 3))
       )`,
      [
        area.groupKey,
        area.sourceId,
        area.name,
        area.searchName,
        area.kind,
        area.designation,
        area.manager,
        area.owner,
        area.stateCodes,
        area.source,
        area.sourceId,
        area.sourceVersion,
        area.sourceRecordId,
        JSON.stringify(area.metadata),
        JSON.stringify(area.geometry),
      ]
    );
  }
}

async function upsertAreas(): Promise<number> {
  const result = await db.query(`
    WITH dissolved AS (
      SELECT
        group_key,
        min(id) AS id,
        min(name) AS name,
        min(search_name) AS search_name,
        min(kind::text)::area_kind AS kind,
        min(designation) AS designation,
        min(manager) AS manager,
        min(owner_name) AS owner_name,
        'US' AS country_code,
        ARRAY(
          SELECT DISTINCT code
          FROM padus_area_import_parts p2, unnest(p2.state_codes) AS code
          WHERE p2.group_key = p.group_key
          ORDER BY code
        ) AS state_codes,
        min(source) AS source,
        min(source_id) AS source_id,
        min(source_version) AS source_version,
        jsonb_build_object(
          'source_record_ids', jsonb_agg(DISTINCT source_record_id),
          'parts', jsonb_agg(metadata)
        ) AS metadata,
        ST_Multi(ST_Union(geom)) AS geom
      FROM padus_area_import_parts p
      GROUP BY group_key
    ),
    prepared AS (
      SELECT
        id, name, search_name, kind, designation, manager, owner_name,
        country_code, state_codes, source, source_id, source_version,
        metadata,
        ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3)) AS geom
      FROM dissolved
      WHERE NOT ST_IsEmpty(geom)
    )
    INSERT INTO areas (
      id, name, search_name, kind, designation, manager, owner,
      country_code, state_codes, source, source_id, source_version,
      boundary, centroid,
      bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng,
      metadata, created_at, updated_at
    )
    SELECT
      id, name, search_name, kind, designation, manager, owner_name,
      country_code, state_codes, source, source_id, source_version,
      geom::geography,
      ST_Centroid(geom)::geography,
      ST_YMin(Box2D(geom)),
      ST_YMax(Box2D(geom)),
      ST_XMin(Box2D(geom)),
      ST_XMax(Box2D(geom)),
      metadata,
      NOW(), NOW()
    FROM prepared
    ON CONFLICT (source, source_id) DO UPDATE SET
      name = EXCLUDED.name,
      search_name = EXCLUDED.search_name,
      kind = EXCLUDED.kind,
      designation = EXCLUDED.designation,
      manager = EXCLUDED.manager,
      owner = EXCLUDED.owner,
      state_codes = EXCLUDED.state_codes,
      source_version = EXCLUDED.source_version,
      boundary = EXCLUDED.boundary,
      centroid = EXCLUDED.centroid,
      bbox_min_lat = EXCLUDED.bbox_min_lat,
      bbox_max_lat = EXCLUDED.bbox_max_lat,
      bbox_min_lng = EXCLUDED.bbox_min_lng,
      bbox_max_lng = EXCLUDED.bbox_max_lng,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
  `);
  return result.rowCount ?? 0;
}

async function linkDestinations(replaceLinks: boolean): Promise<number> {
  const result = await db.query<{ inserted_count: number | string }>(
    buildLinkDestinationsSql(replaceLinks)
  );
  const value = result.rows[0]?.inserted_count ?? 0;
  return typeof value === "number" ? value : parseInt(value, 10);
}

async function report(): Promise<void> {
  const byKind = await db.query(
    `SELECT kind, count(*)::int AS count FROM areas GROUP BY kind ORDER BY kind`
  );
  console.log("Areas by kind:");
  for (const row of byKind.rows) {
    console.log(`  ${row.kind}: ${row.count}`);
  }

  const linked = await db.query(`
    SELECT count(DISTINCT destination_id)::int AS linked_destinations,
           count(*)::int AS links
    FROM destination_areas
  `);
  console.log(`Linked summit destinations: ${linked.rows[0].linked_destinations}`);
  console.log(`Destination-area links: ${linked.rows[0].links}`);
}

export async function importPadusAreas(args: Args): Promise<void> {
  if (!args.input) {
    throw new Error(`${usage()}\n\n--input is required`);
  }

  const contents = fs.readFileSync(args.input, "utf8");
  const features = parseGeoJsonFeatures(contents);
  const normalized = features
    .map((feature) => normalizePadusFeature(feature, args.sourceVersion))
    .filter((area): area is NormalizedPadusArea => area !== null);
  const groups = groupAreas(normalized);

  console.log(`Read features: ${features.length}`);
  console.log(`Importable PAD-US area parts: ${normalized.length}`);
  console.log(`Dissolved logical areas: ${groups.size}`);

  const byKind = new Map<string, number>();
  for (const area of normalized) {
    byKind.set(area.kind, (byKind.get(area.kind) ?? 0) + 1);
  }
  for (const [kind, count] of Array.from(byKind.entries()).sort()) {
    console.log(`  ${kind}: ${count}`);
  }

  if (args.dryRun) {
    console.log("DRY RUN - no rows written. Re-run with --apply to persist.");
    return;
  }

  await db.query("BEGIN");
  try {
    await createTempTable();
    await insertParts(normalized);
    const upserted = await upsertAreas();
    console.log(`Upserted areas: ${upserted}`);

    if (args.linkDestinations) {
      const linked = await linkDestinations(args.replaceLinks);
      console.log(`Inserted destination-area links: ${linked}`);
    }

    await db.query("COMMIT");
    await report();
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

if (process.argv[1]?.includes("import-padus-areas")) {
  const args = parseArgs(process.argv.slice(2));
  importPadusAreas(args)
    .then(() => db.end())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(err);
      await db.end();
      process.exit(1);
    });
}
```

- [ ] **Step 6: Run migrate tests and build**

Run:

```bash
cd /Users/josiahm/projects/peaks/firebase/cloud-sql/migrate
npm test
npm run build
```

Expected: tests pass and TypeScript compiles with no errors.

- [ ] **Step 7: Dry-run against a small local fixture**

Create `/tmp/padus-sample.ndjson`:

```bash
cat > /tmp/padus-sample.ndjson <<'EOF'
{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[-121.9,46.7],[-121.6,46.7],[-121.6,46.95],[-121.9,46.95],[-121.9,46.7]]]},"properties":{"Unit_Nm":"Mount Rainier National Park","Des_Tp":"National Park","Mang_Name":"National Park Service","Own_Name":"National Park Service","State_Nm":"Washington","PADUS_ID":"NPS-MORA-1"}}
{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[-121.8,46.75],[-121.7,46.75],[-121.7,46.85],[-121.8,46.85],[-121.8,46.75]]]},"properties":{"Unit_Nm":"Mount Rainier National Park","Des_Tp":"National Park","Mang_Name":"National Park Service","Own_Name":"National Park Service","State_Nm":"Washington","PADUS_ID":"NPS-MORA-2"}}
EOF
```

Run:

```bash
cd /Users/josiahm/projects/peaks/firebase/cloud-sql/migrate
npm run import:padus-areas -- --input=/tmp/padus-sample.ndjson --dry-run
```

Expected output includes:

```text
Read features: 2
Importable PAD-US area parts: 2
Dissolved logical areas: 1
DRY RUN - no rows written. Re-run with --apply to persist.
```

- [ ] **Step 8: Commit**

```bash
cd /Users/josiahm/projects/peaks/firebase
git add cloud-sql/migrate/src/__tests__/padus-area-utils.test.ts cloud-sql/migrate/src/padus-area-utils.ts cloud-sql/migrate/src/import-padus-areas.ts
git commit -m "Migrate: import PAD-US protected areas"
```

---

## Task 4: Destination Detail API Areas

**Files:**

- Create: `cloud-sql/api/src/__tests__/destination-areas-response.test.ts`
- Modify: `cloud-sql/api/src/routes/destinations.ts`

- [ ] **Step 1: Write failing API helper tests**

Create `cloud-sql/api/src/__tests__/destination-areas-response.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildDestinationDetailQuery,
  mapDestinationDetailRow,
} from "../routes/destinations";

test("destination detail query includes linked areas without area boundaries", () => {
  const query = buildDestinationDetailQuery("dest-1");

  assert.match(query.text, /FROM destination_areas da/);
  assert.match(query.text, /JOIN areas a ON a\.id = da\.area_id/);
  assert.match(query.text, /json_agg/);
  assert.match(query.text, /'kind', a\.kind/);
  assert.doesNotMatch(query.text, /a\.boundary/);
  assert.deepEqual(query.values, ["dest-1"]);
});

test("mapDestinationDetailRow merges averages and defaults areas to empty array", () => {
  const row: any = {
    id: "dest-1",
    name: "Mount Rainier",
    averages: { months: { jun: 1 }, days: { sa: 1 }, lastUpdated: "2026-06-01T00:00:00.000Z" },
    averages_offset: { months: { jun: 2 }, days: { su: 1 }, lastUpdated: "2026-06-02T00:00:00.000Z" },
    areas: null,
  };

  const mapped = mapDestinationDetailRow(row);

  assert.deepEqual(mapped.averages.months, { jun: 3 });
  assert.deepEqual(mapped.averages.days, { sa: 1, su: 1 });
  assert.equal(mapped.averages.lastUpdated, "2026-06-02T00:00:00.000Z");
  assert.deepEqual(mapped.areas, []);
  assert.equal(Object.prototype.hasOwnProperty.call(mapped, "averages_offset"), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/josiahm/projects/peaks/firebase/cloud-sql/api
npm test
```

Expected: failure because `buildDestinationDetailQuery` and `mapDestinationDetailRow` are not exported.

- [ ] **Step 3: Export the destination detail helpers**

In `cloud-sql/api/src/routes/destinations.ts`, change:

```ts
function mergeAverages(
```

to:

```ts
export function mergeAverages(
```

Add this helper above `router.get("/:id", ...)`:

```ts
export function buildDestinationDetailQuery(id: string): { text: string; values: unknown[] } {
  return {
    text: `SELECT d.id, d.name, d.elevation, d.prominence, d.type,
            d.activities, d.features, d.owner,
            d.country_code, d.state_code,
            d.hero_image, d.hero_image_attribution, d.hero_image_attribution_url,
            d.averages, d.averages_offset, d.explicitly_saved, d.recency,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            ST_Z(d.location::geometry) AS elev_z,
            CASE WHEN d.boundary IS NOT NULL
                 THEN ST_AsGeoJSON(d.boundary)::json END AS boundary,
            d.bbox_min_lat, d.bbox_max_lat, d.bbox_min_lng, d.bbox_max_lng,
            d.created_at, d.updated_at,
            COALESCE(stats.session_count, 0) + d.session_count_offset AS session_count,
            COALESCE(stats.success_count, 0) + d.success_count_offset AS success_count,
            COALESCE(area_rows.areas, '[]'::json) AS areas
     FROM destinations d
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS session_count,
              COUNT(*) FILTER (WHERE sd.relation = 'reached') AS success_count
       FROM session_destinations sd WHERE sd.destination_id = d.id
     ) stats ON true
     LEFT JOIN LATERAL (
       SELECT json_agg(
         json_build_object(
           'id', a.id,
           'name', a.name,
           'kind', a.kind,
           'designation', a.designation,
           'manager', a.manager,
           'relation', da.relation,
           'source', da.source
         )
         ORDER BY a.kind, a.name
       ) AS areas
       FROM destination_areas da
       JOIN areas a ON a.id = da.area_id
       WHERE da.destination_id = d.id
     ) area_rows ON true
     WHERE d.id = $1`,
    values: [id],
  };
}

export function mapDestinationDetailRow(row: any): any {
  row.averages = mergeAverages(row.averages, row.averages_offset);
  delete row.averages_offset;
  row.areas = Array.isArray(row.areas) ? row.areas : [];
  return row;
}
```

- [ ] **Step 4: Replace the inline destination detail query**

In `cloud-sql/api/src/routes/destinations.ts`, replace the body of `router.get("/:id", ...)` through the `db.query(...)` call with:

```ts
router.get("/:id", async (req, res: Response) => {
  const { id } = req.params;
  const query = buildDestinationDetailQuery(id);
  const result = await db.query(query.text, query.values);
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Destination not found" });
    return;
  }
  res.json(mapDestinationDetailRow(result.rows[0]));
});
```

- [ ] **Step 5: Run API tests**

Run:

```bash
cd /Users/josiahm/projects/peaks/firebase/cloud-sql/api
npm test
```

Expected: all API tests pass. Integration tests that require `DATABASE_URL` skip cleanly if `DATABASE_URL` is not set.

- [ ] **Step 6: Build and lint the API**

Run:

```bash
cd /Users/josiahm/projects/peaks/firebase/cloud-sql/api
npm run build
npm run lint
```

Expected: build succeeds and lint reports no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/josiahm/projects/peaks/firebase
git add cloud-sql/api/src/routes/destinations.ts cloud-sql/api/src/__tests__/destination-areas-response.test.ts
git commit -m "API: include protected areas on destination detail"
```

---

## Task 5: Real PAD-US Import Runbook and Smoke Checks

**Files:**

- Modify: `cloud-sql/CLAUDE.md`

- [ ] **Step 1: Add the import runbook to `cloud-sql/CLAUDE.md`**

Add this section after the Migration section:

````md
## Protected area imports

Protected-area and land-management context is imported from USGS PAD-US into `areas`, then linked to summit destinations through `destination_areas`.

Input should be GeoJSON or NDJSON exported from PAD-US 4.1. The importer intentionally does not depend on local GIS CLIs such as `ogr2ogr`; export PAD-US data outside the script, then run:

```bash
cd cloud-sql/migrate
npm run import:padus-areas -- --input=/path/padus-federal-areas.ndjson --dry-run
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

Expected: Mount Rainier links to Mount Rainier National Park.
````

- [ ] **Step 2: Run final package verification**

Run:

```bash
cd /Users/josiahm/projects/peaks/firebase/cloud-sql/migrate
npm test
npm run build
cd /Users/josiahm/projects/peaks/firebase/cloud-sql/api
npm run build
npm run lint
npm test
```

Expected: all commands pass. If local DB integration tests are skipped because `DATABASE_URL` is unset, record that in the handoff.

- [ ] **Step 3: Optional local smoke run with sample fixture**

If a local Postgres/PostGIS database is available with the new migration applied, run:

```bash
cd /Users/josiahm/projects/peaks/firebase/cloud-sql/migrate
npm run import:padus-areas -- --input=/tmp/padus-sample.ndjson --apply --link-destinations
```

Expected: sample areas upsert successfully. The destination link count may be `0` unless a local summit fixture falls within the sample polygon.

- [ ] **Step 4: Commit**

```bash
cd /Users/josiahm/projects/peaks/firebase
git add cloud-sql/CLAUDE.md
git commit -m "Docs: protected area import runbook"
```

---

## Final Verification Checklist

- [ ] `cloud-sql/migrations/20260611_protected_areas.sql` applies cleanly.
- [ ] `cloud-sql/schema.sql` matches the migrated schema for fresh database builds.
- [ ] `cd cloud-sql/migrate && npm test && npm run build` passes.
- [ ] `cd cloud-sql/api && npm run build && npm run lint && npm test` passes.
- [ ] PAD-US sample dry run reports two parts dissolved into one logical area.
- [ ] Production/dev real-data import dry run reports area counts by kind before any writes.
- [ ] After real-data apply, Mount Rainier links to Mount Rainier National Park.
- [ ] Existing uncommitted user changes outside these task files remain untouched.
