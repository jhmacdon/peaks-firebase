# WA Waterfall Bulk Import + external_ids Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `external_ids JSONB` column to destinations so a single row can carry IDs from multiple external providers (OSM, GNIS, Wikidata, AllTrails), wire the admin OSM-nearby flow to populate it, and use it as the dedup key for a bulk import of all named WA waterfalls from OpenStreetMap (~430 destinations) with elevation enriched from free AWS Terrarium DEM tiles.

**Architecture:** Standalone TypeScript script (`cloud-sql/migrate/src/import-osm-waterfalls-wa.ts`) modeled on the existing `import-cai-huts.ts` precedent. Schema change is one column + one GIN index. Reusable Terrarium elevation helper (`cloud-sql/migrate/src/lib/terrarium-elevation.ts`) caches tiles in memory; the import script's only data-source-specific code is the Overpass query and the OSM tag → destination mapping. Dedup uses a pre-loaded `Map<osm_id, destination_id>` from `external_ids->>'osm'` so re-runs upsert correctly without primary-key entanglement.

**Tech Stack:** PostgreSQL 15 + PostGIS, TypeScript, Node 20, OpenStreetMap Overpass API, AWS Open Data Terrarium DEM tiles, `pngjs` for PNG decoding.

**Spec:** `docs/superpowers/specs/2026-04-28-import-wa-waterfalls-design.md`

**Testing note:** This codebase has no unit-test infrastructure for `cloud-sql/migrate/` or `web/` (the CAI hut import precedent shipped without tests; web shipped without tests). The verification pattern is build + lint + functional smoke. The elevation helper, which has non-trivial math, gets a lightweight in-script smoke check rather than a separate test framework.

**Migration ordering note:** Task 1 lands the `external_ids` column. Task 3 (admin flow update) and Task 5 (import script) BOTH depend on the migration being applied to the prod database. Before pushing Task 3 to `main`, the prod migration must be applied — Task 1's verification step covers this.

---

## File Map

**Create:**
- `cloud-sql/migrations/20260428_destination_external_ids.sql` — DB migration adding column + GIN index
- `cloud-sql/migrate/src/lib/external-ids.ts` — `ExternalIdProvider` / `ExternalIds` types for the migrate package
- `cloud-sql/migrate/src/lib/terrarium-elevation.ts` — reusable elevation lookup helper
- `cloud-sql/migrate/src/import-osm-waterfalls-wa.ts` — main import script
- `web/src/lib/destination-types.ts` — `ExternalIdProvider` / `ExternalIds` types for the web app

**Modify:**
- `cloud-sql/schema.sql` — add `external_ids` column to `destinations` table and add the GIN index in the index section
- `web/CLAUDE.md` — note the new column in the destinations row description (cloud-sql/CLAUDE.md has no per-table description to update)
- `web/src/lib/actions/destinations.ts` — extend `createDestination` to accept and write `external_ids` + add OSM-ID duplicate guard
- `web/src/app/admin/destinations/new/page.tsx` — thread `osm_id` from `OSMSuggestion` through `confirm` state into the `createDestination` call
- `cloud-sql/migrate/package.json` — add `pngjs` + `@types/pngjs` deps and `import:wa-waterfalls` script

---

## Task 1: Add `external_ids` column and GIN index to destinations

**Files:**
- Create: `cloud-sql/migrations/20260428_destination_external_ids.sql`
- Modify: `cloud-sql/schema.sql` (around line 70 — insert column after `metadata`; add index in indexes section)
- Modify: `web/CLAUDE.md` (one-line update to the destinations row in the "Key tables" section)

(`cloud-sql/CLAUDE.md` does not have a per-table description line for `destinations`, so there's nothing analogous to update there.)

- [ ] **Step 1: Create the migration file**

Write `cloud-sql/migrations/20260428_destination_external_ids.sql`:

```sql
-- Add external_ids JSONB to destinations so a single row can carry IDs from
-- multiple external providers (OSM, GNIS, Wikidata, AllTrails, etc.) without
-- one being load-bearing as the primary key. Used by bulk imports for dedup
-- and by future admin tooling to link existing rows to external sources.
ALTER TABLE destinations
  ADD COLUMN IF NOT EXISTS external_ids JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS destinations_external_ids_idx
  ON destinations USING gin (external_ids);
```

- [ ] **Step 2: Update `cloud-sql/schema.sql`**

In `cloud-sql/schema.sql`, locate the `destinations` `CREATE TABLE` block (starts line 34). Find the `metadata` line (around line 70):

```sql
    -- source-specific metadata (e.g. CAI shelter details, import provenance)
    metadata        JSONB,
```

Add immediately after it (before `explicitly_saved`):

```sql

    -- IDs from external providers (osm, gnis, wikidata, alltrails, ...).
    -- Used by bulk imports for dedup and by admin tooling to link rows to sources.
    external_ids    JSONB NOT NULL DEFAULT '{}',
```

Then locate the section of the file that defines indexes for `destinations` (search for `CREATE INDEX` near the destinations block). Add this index alongside the existing destination indexes:

```sql
CREATE INDEX IF NOT EXISTS destinations_external_ids_idx
  ON destinations USING gin (external_ids);
```

If the destinations index section isn't immediately obvious, place it directly after the last destinations-related `CREATE INDEX` statement.

- [ ] **Step 3: Update `web/CLAUDE.md`**

In `web/CLAUDE.md`, find this line (around line 135 in the "Key tables" section):

```
- `destinations` — peaks, trailheads, POIs (PointZ geography, features array, activities array)
```

Replace with:

```
- `destinations` — peaks, trailheads, POIs (PointZ geography, features array, activities array, external_ids JSONB for cross-source linking)
```

- [ ] **Step 4: Apply the migration to the prod database**

Pre-conditions:
- Cloud SQL Auth Proxy must be running: `cloud-sql-proxy donner-a8608:us-central1:peaks-db --port 5432 &`
- Wait for it: `until nc -z 127.0.0.1 5432 2>/dev/null; do sleep 1; done`

Run:

```bash
PGPASSWORD="$(gcloud secrets versions access latest --secret=peaks-db-postgres-password --project=donner-a8608)" \
  /opt/homebrew/opt/libpq/bin/psql -h 127.0.0.1 -p 5432 -U postgres -d peaks \
  -f cloud-sql/migrations/20260428_destination_external_ids.sql
```

Expected output: `ALTER TABLE` then `CREATE INDEX`. (Or `NOTICE: ... already exists, skipping` if re-applied.)

If the proxy can't be started or you don't have access, STOP HERE and report `BLOCKED — needs migration applied to prod before continuing`. Do not push later tasks until the migration is live.

- [ ] **Step 5: Verify the column landed**

```bash
PGPASSWORD="$(gcloud secrets versions access latest --secret=peaks-db-postgres-password --project=donner-a8608)" \
  /opt/homebrew/opt/libpq/bin/psql -h 127.0.0.1 -p 5432 -U postgres -d peaks \
  -c "\\d destinations" | grep external_ids
```

Expected: one line showing `external_ids | jsonb | not null default '{}'::jsonb`.

Also verify the index:

```bash
PGPASSWORD="$(gcloud secrets versions access latest --secret=peaks-db-postgres-password --project=donner-a8608)" \
  /opt/homebrew/opt/libpq/bin/psql -h 127.0.0.1 -p 5432 -U postgres -d peaks \
  -c "\\di destinations_external_ids_idx"
```

Expected: one row showing the index name and `gin` access method.

- [ ] **Step 6: Stop the proxy if you started it**

```bash
pkill -f cloud-sql-proxy
```

- [ ] **Step 7: Commit**

```bash
git add cloud-sql/migrations/20260428_destination_external_ids.sql cloud-sql/schema.sql web/CLAUDE.md
git commit -m "DB: add external_ids column and GIN index to destinations"
```

---

## Task 2: Define `ExternalIdProvider` / `ExternalIds` types in both packages

**Files:**
- Create: `web/src/lib/destination-types.ts`
- Create: `cloud-sql/migrate/src/lib/external-ids.ts`

- [ ] **Step 1: Create the web type module**

Write `web/src/lib/destination-types.ts`:

```ts
export type ExternalIdProvider = 'osm' | 'gnis' | 'wikidata' | 'alltrails';

export type ExternalIds = Partial<Record<ExternalIdProvider, string>>;
```

- [ ] **Step 2: Create the migrate type module**

The directory `cloud-sql/migrate/src/lib/` does not exist yet. Create it as part of this step.

Write `cloud-sql/migrate/src/lib/external-ids.ts` (identical content — duplication matches the codebase's existing precedent for cross-package type sharing):

```ts
export type ExternalIdProvider = 'osm' | 'gnis' | 'wikidata' | 'alltrails';

export type ExternalIds = Partial<Record<ExternalIdProvider, string>>;
```

- [ ] **Step 3: Verify both packages still build**

Run:

```bash
cd web && npm run build
```

Expected: Next.js build succeeds with no errors. (The new file is untouched by anything yet but should still compile cleanly.)

Then:

```bash
cd cloud-sql/migrate && npm run build
```

Expected: `tsc` exits with no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/destination-types.ts cloud-sql/migrate/src/lib/external-ids.ts
git commit -m "Types: add ExternalIdProvider union for cross-source destination IDs"
```

---

## Task 3: Wire admin OSM-nearby flow to write OSM IDs and guard duplicates

**Pre-condition:** Task 1's migration must be applied to the prod database before pushing this task. If the migration was applied in Task 1 step 5, you're good. If you skipped that step, apply it now before continuing.

**Files:**
- Modify: `web/src/lib/actions/destinations.ts:375-414` (`createDestination`) and where appropriate to add a duplicate-by-OSM-ID guard
- Modify: `web/src/app/admin/destinations/new/page.tsx:127-140` (`handleSelectOSM`) and `:177-200` (`handleSave`) to thread the OSM ID through

- [ ] **Step 1: Extend `createDestination` to accept and write `external_ids`**

In `web/src/lib/actions/destinations.ts`, locate the `createDestination` function (starts at line 375). Replace the entire function body — through line 414 — with this version:

```ts
export async function createDestination(input: {
  name: string;
  lat: number;
  lng: number;
  elevation: number | null;
  features: string[];
  type?: string;
  external_ids?: ExternalIds;
}): Promise<{ id: string } | { duplicate: { id: string; name: string | null } }> {
  // Duplicate guard: if any external_ids key matches an existing row, surface
  // the existing destination instead of creating a duplicate.
  if (input.external_ids) {
    for (const [provider, providerId] of Object.entries(input.external_ids)) {
      if (!providerId) continue;
      const existing = await db.query<{ id: string; name: string | null }>(
        `SELECT id, name FROM destinations WHERE external_ids->>$1 = $2 LIMIT 1`,
        [provider, providerId]
      );
      if (existing.rows.length > 0) {
        return { duplicate: existing.rows[0] };
      }
    }
  }

  const id = generateId();
  const searchName = normalizeSearchName(input.name);
  const destType = input.type || "point";

  // Reverse geocode for country/state
  let country_code: string | null = null;
  let state_code: string | null = null;
  try {
    const geo = await reverseGeocodePoint(input.lat, input.lng);
    country_code = geo.country_code;
    state_code = geo.state_code;
  } catch {
    // Non-fatal — location data is nice-to-have
  }

  const roundedEle = input.elevation != null ? Math.round(input.elevation) : null;
  const externalIdsJson = JSON.stringify(input.external_ids ?? {});

  await db.query(
    `INSERT INTO destinations (id, name, search_name, location, elevation, features, owner, type, country_code, state_code, external_ids)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5, COALESCE($6::double precision, 0)), 4326)::geography,
             $6, $7::destination_feature[], 'peaks', $8::destination_type, $9, $10, $11::jsonb)`,
    [id, input.name, searchName, input.lng, input.lat, roundedEle, input.features, destType, country_code, state_code, externalIdsJson]
  );

  // Tag any existing sessions whose track passes through the new destination.
  // Non-fatal — backfill failure shouldn't block the create response.
  backfillDestinationToSessions(id).catch((err) =>
    console.error("backfillDestinationToSessions failed for", id, err)
  );

  return { id };
}
```

- [ ] **Step 2: Add the `ExternalIds` import at the top of the file**

In `web/src/lib/actions/destinations.ts`, find the existing import block at the top of the file. Add this import at an appropriate point in the import section:

```ts
import type { ExternalIds } from "@/lib/destination-types";
```

(If you're not sure where to place it, put it after the last existing `@/lib/...` import. If there are none, put it after the last relative import.)

- [ ] **Step 3: Update `handleSelectOSM` in the admin "new destination" page**

In `web/src/app/admin/destinations/new/page.tsx`, the `setConfirm` state currently has fields `name, lat, lng, elevation, features, type, source`. We need to add `osmId` to it.

Locate the `confirm` state declaration (search for `const [confirm, setConfirm]`). It's typed as a `useState` with an inline shape. Add `osmId?: string;` to the shape. The full updated `useState` line should be roughly (preserve the surrounding code exactly):

```tsx
const [confirm, setConfirm] = useState<{
  name: string;
  lat: number;
  lng: number;
  elevation: number | null;
  features: string[];
  type: string;
  source: string;
  osmId?: string;
} | null>(null);
```

Then locate `handleSelectOSM` (line 127) and replace it with:

```tsx
const handleSelectOSM = (s: OSMSuggestion) => {
  setConfirm({
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    elevation: s.elevation,
    features: s.feature ? [s.feature] : [],
    type: "point",
    source: `OSM (${s.osm_tags})`,
    osmId: String(s.osm_id),
  });
  setBoundary(null);
  setShowBoundaryEditor(false);
  setStep("confirm");
};
```

- [ ] **Step 4: Update `handleSave` to pass the OSM ID and handle the duplicate response**

In `web/src/app/admin/destinations/new/page.tsx`, locate `handleSave` (line 177). Replace the `createDestination` call and surrounding logic. The current call looks like:

```tsx
const result = await createDestination({
  name: confirm.name.trim(),
  lat: confirm.lat,
  lng: confirm.lng,
  elevation: confirm.elevation,
  features: confirm.features,
  type: confirm.type,
});
if (boundary) {
  await updateDestinationBoundary(result.id, boundary);
}
const name = confirm.name.trim();
setToasts((prev) => [
  ...prev,
  { id: result.id, name, destId: result.id },
]);
```

Replace with:

```tsx
const result = await createDestination({
  name: confirm.name.trim(),
  lat: confirm.lat,
  lng: confirm.lng,
  elevation: confirm.elevation,
  features: confirm.features,
  type: confirm.type,
  external_ids: confirm.osmId ? { osm: confirm.osmId } : undefined,
});
if ("duplicate" in result) {
  setToasts((prev) => [
    ...prev,
    {
      id: result.duplicate.id,
      name: `Already exists: ${result.duplicate.name ?? "(unnamed)"}`,
      destId: result.duplicate.id,
    },
  ]);
  setSaving(false);
  return;
}
if (boundary) {
  await updateDestinationBoundary(result.id, boundary);
}
const name = confirm.name.trim();
setToasts((prev) => [
  ...prev,
  { id: result.id, name, destId: result.id },
]);
```

- [ ] **Step 5: Verify the web project builds and lints cleanly**

```bash
cd web && npm run build
```

Expected: Next.js build succeeds with no errors.

```bash
cd web && npm run lint
```

Expected: zero errors. Pre-existing `<img>` warnings are acceptable per `web/CLAUDE.md`.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/actions/destinations.ts web/src/app/admin/destinations/new/page.tsx
git commit -m "Admin: write OSM IDs to external_ids and guard duplicates on OSM import"
```

---

## Task 4: Build the Terrarium elevation helper

**Files:**
- Create: `cloud-sql/migrate/src/lib/terrarium-elevation.ts`
- Modify: `cloud-sql/migrate/package.json` (add `pngjs` + `@types/pngjs` deps)

- [ ] **Step 1: Add `pngjs` and `@types/pngjs` dependencies**

```bash
cd cloud-sql/migrate && npm install pngjs && npm install --save-dev @types/pngjs
```

Expected: package.json gets `"pngjs": "^7.x.x"` in dependencies and `"@types/pngjs": "^6.x.x"` in devDependencies, plus a package-lock.json update.

- [ ] **Step 2: Create the helper file**

Write `cloud-sql/migrate/src/lib/terrarium-elevation.ts`:

```ts
import { PNG } from "pngjs";

const TILE_ENDPOINT = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const ZOOM = 12;
const TILE_SIZE = 256;

interface DecodedTile {
  data: Uint8Array; // RGBA, length = TILE_SIZE * TILE_SIZE * 4
}

const tileCache = new Map<string, DecodedTile>();

function lngLatToTile(lat: number, lng: number, z: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z;
  const xExact = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yExact =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xExact);
  const y = Math.floor(yExact);
  const px = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((xExact - x) * TILE_SIZE)));
  const py = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((yExact - y) * TILE_SIZE)));
  return { x, y, px, py };
}

async function fetchTileWithRetry(z: number, x: number, y: number, retries = 3): Promise<Uint8Array | null> {
  const url = `${TILE_ENDPOINT}/${z}/${x}/${y}.png`;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return new Uint8Array(await res.arrayBuffer());
      }
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      return null;
    } catch {
      if (attempt === retries - 1) return null;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  return null;
}

function decodePng(bytes: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const png = new PNG();
    png.parse(Buffer.from(bytes), (err, data) => {
      if (err) return reject(err);
      resolve(new Uint8Array(data.data));
    });
  });
}

async function getTile(z: number, x: number, y: number): Promise<DecodedTile | null> {
  const key = `${z}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached) return cached;
  const raw = await fetchTileWithRetry(z, x, y);
  if (!raw) return null;
  try {
    const decoded = await decodePng(raw);
    const tile: DecodedTile = { data: decoded };
    tileCache.set(key, tile);
    return tile;
  } catch {
    return null;
  }
}

/**
 * Look up elevation in meters for a (lat, lng) pair using AWS Open Data
 * Terrarium DEM tiles. Returns null on persistent fetch/decode failure;
 * the caller decides whether to skip the row.
 */
export async function lookupElevation(lat: number, lng: number): Promise<number | null> {
  const { x, y, px, py } = lngLatToTile(lat, lng, ZOOM);
  const tile = await getTile(ZOOM, x, y);
  if (!tile) return null;
  const idx = (py * TILE_SIZE + px) * 4;
  const r = tile.data[idx];
  const g = tile.data[idx + 1];
  const b = tile.data[idx + 2];
  return Math.round((r * 256 + g + b / 256) - 32768);
}
```

- [ ] **Step 3: Smoke-check the helper against known coordinates**

This verifies the math without adding a test framework. Run from `cloud-sql/migrate`:

```bash
cd cloud-sql/migrate && npx tsx -e "
import { lookupElevation } from './src/lib/terrarium-elevation';
(async () => {
  // Mt. Rainier summit: known ~4392 m
  const rainier = await lookupElevation(46.853, -121.7603);
  console.log('Mt. Rainier:', rainier, 'm (expect ~4300-4400)');
  if (rainier == null || rainier < 4000 || rainier > 4500) {
    console.error('FAIL: Rainier out of range');
    process.exit(1);
  }
  // Death Valley Badwater Basin: known ~ -86 m
  const badwater = await lookupElevation(36.2538, -116.8323);
  console.log('Badwater Basin:', badwater, 'm (expect -100 to 0)');
  if (badwater == null || badwater < -120 || badwater > 20) {
    console.error('FAIL: Badwater out of range');
    process.exit(1);
  }
  // Same coord twice should hit cache (no observable effect, but verifies it doesn't crash)
  const rainier2 = await lookupElevation(46.853, -121.7603);
  console.log('Mt. Rainier (cached):', rainier2);
  console.log('OK');
})();
"
```

Expected: prints three lines with reasonable elevations and `OK`. Process exits 0. If either elevation is null or out of range, the script exits 1 — fix the helper before continuing.

- [ ] **Step 4: Verify the migrate package builds**

```bash
cd cloud-sql/migrate && npm run build
```

Expected: `tsc` exits with no errors.

- [ ] **Step 5: Commit**

```bash
git add cloud-sql/migrate/src/lib/terrarium-elevation.ts cloud-sql/migrate/package.json cloud-sql/migrate/package-lock.json
git commit -m "Migrate: add Terrarium DEM elevation helper for bulk imports"
```

---

## Task 5: Build the WA waterfall import script

**Pre-condition:** The migration from Task 1 must be applied to the prod DB before running this script (the script reads `external_ids->>'osm'` from `destinations`).

**Files:**
- Create: `cloud-sql/migrate/src/import-osm-waterfalls-wa.ts`
- Modify: `cloud-sql/migrate/package.json` (add `import:wa-waterfalls` script)

- [ ] **Step 1: Create the import script**

Write `cloud-sql/migrate/src/import-osm-waterfalls-wa.ts`:

```ts
import db from "./db";
import { lookupElevation } from "./lib/terrarium-elevation";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const QUERY = `[out:json][timeout:60];
area["ISO3166-2"="US-WA"]->.wa;
(
  node["waterway"="waterfall"](area.wa);
  way["waterway"="waterfall"](area.wa);
);
out tags center;`;

const ELEVATION_CONCURRENCY = 5;

interface OverpassElement {
  type: "node" | "way";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

interface Waterfall {
  osmId: string;
  name: string;
  lat: number;
  lng: number;
}

function generateId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 20; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function fetchOverpassWithRetry(retries = 3): Promise<OverpassResponse> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(OVERPASS_ENDPOINT, {
        method: "POST",
        body: `data=${encodeURIComponent(QUERY)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (res.ok) return res.json();
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      throw new Error(`Overpass HTTP ${res.status}`);
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  throw new Error("unreachable");
}

async function parallelMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

export async function importOsmWaterfallsWa(opts: { dryRun: boolean }) {
  console.log("Fetching WA waterfalls from Overpass...");
  const data = await fetchOverpassWithRetry();
  console.log(`  Got ${data.elements.length} elements`);

  const skippedReasons: Record<string, number> = {};
  function skip(reason: string) {
    skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
  }

  const waterfalls: Waterfall[] = [];
  for (const el of data.elements) {
    const name = el.tags?.name?.trim();
    if (!name) {
      skip("no-name");
      continue;
    }
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) {
      skip("no-coords");
      continue;
    }
    waterfalls.push({ osmId: String(el.id), name, lat, lng });
  }
  console.log(`  After name+coord filter: ${waterfalls.length}`);

  // Pre-load existing-ID lookup map.
  console.log("Pre-loading existing OSM-id → destination_id map...");
  const osmIds = waterfalls.map((w) => w.osmId);
  const existing = await db.query<{ id: string; osm_id: string }>(
    `SELECT id, external_ids->>'osm' AS osm_id
     FROM destinations
     WHERE external_ids ? 'osm'
       AND external_ids->>'osm' = ANY($1::text[])`,
    [osmIds]
  );
  const existingByOsmId = new Map<string, string>();
  for (const row of existing.rows) {
    existingByOsmId.set(row.osm_id, row.id);
  }
  console.log(`  Found ${existingByOsmId.size} existing rows to update`);

  // Look up elevation in parallel with caching.
  console.log(`Looking up elevations (concurrency=${ELEVATION_CONCURRENCY})...`);
  const withElevation = await parallelMap(
    waterfalls,
    async (w) => ({ ...w, elevation: await lookupElevation(w.lat, w.lng) }),
    ELEVATION_CONCURRENCY
  );

  let inserted = 0;
  let updated = 0;
  const sampleRows: Array<{ name: string; lat: number; lng: number; elevation: number; path: "insert" | "update" }> = [];

  for (const w of withElevation) {
    if (w.elevation == null) {
      skip("elevation-failed");
      continue;
    }
    const path: "insert" | "update" = existingByOsmId.has(w.osmId) ? "update" : "insert";
    if (sampleRows.length < 10) {
      sampleRows.push({ name: w.name, lat: w.lat, lng: w.lng, elevation: w.elevation, path });
    }

    if (opts.dryRun) {
      if (path === "insert") inserted++;
      else updated++;
      continue;
    }

    try {
      if (path === "update") {
        const id = existingByOsmId.get(w.osmId)!;
        await db.query(
          `UPDATE destinations SET
             name = $2, search_name = $3, elevation = $4,
             location = ST_SetSRID(ST_MakePoint($5, $6, $7), 4326)::geography,
             country_code = 'US', state_code = 'WA',
             features = ARRAY['waterfall']::destination_feature[],
             external_ids = external_ids || $8::jsonb,
             updated_at = NOW()
           WHERE id = $1`,
          [
            id,
            w.name,
            w.name.toLowerCase(),
            w.elevation,
            w.lng,
            w.lat,
            w.elevation,
            JSON.stringify({ osm: w.osmId }),
          ]
        );
        updated++;
      } else {
        const id = generateId();
        await db.query(
          `INSERT INTO destinations (
             id, name, search_name, elevation, prominence,
             location, geohash,
             type, activities, features,
             country_code, state_code,
             hero_image,
             external_ids, metadata, owner,
             created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, NULL,
             ST_SetSRID(ST_MakePoint($5, $6, $7), 4326)::geography, NULL,
             'point', '{outdoor-trek}', '{waterfall}',
             'US', 'WA',
             NULL,
             $8::jsonb, $9::jsonb, 'peaks',
             NOW(), NOW()
           )`,
          [
            id,
            w.name,
            w.name.toLowerCase(),
            w.elevation,
            w.lng,
            w.lat,
            w.elevation,
            JSON.stringify({ osm: w.osmId }),
            JSON.stringify({ source: "osm" }),
          ]
        );
        inserted++;
      }
    } catch (err: any) {
      console.error(`  Error ${path} ${w.name} (osm ${w.osmId}): ${err.message}`);
      skip("db-error");
    }
  }

  console.log("");
  console.log(opts.dryRun ? "Dry-run sample (first 10):" : "Sample of processed rows (first 10):");
  for (const r of sampleRows) {
    console.log(`  [${r.path}] ${r.name}  (${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}) ele=${r.elevation}m`);
  }

  console.log("");
  console.log(opts.dryRun ? "WA waterfall import (dry-run) summary:" : "WA waterfall import complete:");
  console.log(`  Imported: ${inserted + updated} (${inserted} new, ${updated} updated)`);
  const skippedTotal = Object.values(skippedReasons).reduce((a, b) => a + b, 0);
  console.log(`  Skipped:  ${skippedTotal}`);
  for (const [reason, count] of Object.entries(skippedReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`    - ${reason}: ${count}`);
  }
}

if (process.argv[1]?.includes("import-osm-waterfalls-wa")) {
  const dryRun = process.argv.includes("--dry-run");
  importOsmWaterfallsWa({ dryRun })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] **Step 2: Add the npm script**

In `cloud-sql/migrate/package.json`, the existing scripts block contains entries like `"import:cai-huts": "tsx src/import-cai-huts.ts"`. Add a new entry to the `scripts` object:

```json
"import:wa-waterfalls": "tsx src/import-osm-waterfalls-wa.ts"
```

Place it adjacent to the other `import:` entries (the position in the JSON object doesn't matter functionally, but adjacent is conventional).

- [ ] **Step 3: Verify the migrate package builds**

```bash
cd cloud-sql/migrate && npm run build
```

Expected: `tsc` exits with no errors.

- [ ] **Step 4: Commit**

```bash
git add cloud-sql/migrate/src/import-osm-waterfalls-wa.ts cloud-sql/migrate/package.json
git commit -m "Migrate: add WA waterfall OSM import script"
```

---

## Task 6: End-to-end verification — dry-run, real import, and spot checks

**Pre-condition:** Cloud SQL Auth Proxy must be running (you can start it via `cloud-sql-proxy donner-a8608:us-central1:peaks-db --port 5432 &` then wait with `until nc -z 127.0.0.1 5432; do sleep 1; done`). The Task 1 migration must already be applied. The DB env vars must be set so the migrate package's `db.ts` can connect.

**Files:** none (verification only)

- [ ] **Step 1: Set up DB env for the migrate package**

The migrate package's `db.ts` reads connection info from env vars. Set them in your shell:

```bash
export DB_HOST=127.0.0.1
export DB_PORT=5432
export DB_NAME=peaks
export DB_USER=postgres
export DB_PASS="$(gcloud secrets versions access latest --secret=peaks-db-postgres-password --project=donner-a8608)"
```

(If the migrate package uses different env var names, check `cloud-sql/migrate/src/db.ts` and adjust accordingly. The CAI hut import doc in `cloud-sql/SETUP.md` uses these exact names.)

- [ ] **Step 2: Run the dry-run**

```bash
cd cloud-sql/migrate && npm run import:wa-waterfalls -- --dry-run
```

Expected output (numbers approximate):
- `Got ~876 elements`
- `After name+coord filter: ~430`
- `Found 0 existing rows to update` (today there are zero waterfall destinations)
- 10 sample rows printed, all `[insert]`, with WA-area coords (~46-49 lat, ~-117 to -124 lng) and reasonable elevations (mostly 100-2000m)
- `Imported: ~430 (~430 new, 0 updated)`
- `Skipped: small number, mostly elevation-failed if any`

If the count is dramatically off (e.g., 0 or 5000), STOP and investigate before continuing — the Overpass query or the filter is broken.

- [ ] **Step 3: Run the real import**

```bash
cd cloud-sql/migrate && npm run import:wa-waterfalls
```

Expected: same shape as dry-run but with real DB writes. Total run time roughly 1-3 minutes (dominated by elevation lookups + per-row trigger overhead).

- [ ] **Step 4: SQL spot-checks**

```bash
PGPASSWORD="$DB_PASS" /opt/homebrew/opt/libpq/bin/psql -h 127.0.0.1 -p 5432 -U postgres -d peaks <<'SQL'
-- Total WA waterfalls
SELECT count(*) AS wa_waterfalls
FROM destinations
WHERE 'waterfall' = ANY(features) AND state_code = 'WA';

-- Snoqualmie Falls — should be present with elevation and external_ids
SELECT name, ROUND(ST_Y(location::geometry)::numeric, 4) AS lat,
       ROUND(ST_X(location::geometry)::numeric, 4) AS lng,
       elevation, external_ids
FROM destinations
WHERE name = 'Snoqualmie Falls';

-- Confirm the GIN index is being used (just sanity, plan should show Bitmap Index Scan)
EXPLAIN SELECT id FROM destinations WHERE external_ids->>'osm' = '12345';
SQL
```

Expected:
- `wa_waterfalls`: ~400+
- Snoqualmie Falls present with non-null elevation roughly 122m (give or take ~30m), `external_ids` like `{"osm": "<numeric-id>"}`
- EXPLAIN shows `Bitmap Index Scan on destinations_external_ids_idx` (or, on a small table, a seq scan — that's also OK; the index will be used as the table grows)

- [ ] **Step 5: Re-run to verify the update path works**

```bash
cd cloud-sql/migrate && npm run import:wa-waterfalls
```

Expected: `Imported: ~430 (0 new, ~430 updated)` — proves the dedup-by-OSM-ID flow works.

- [ ] **Step 6: Stop the proxy**

```bash
pkill -f cloud-sql-proxy
```

- [ ] **Step 7: Push if not already pushed**

If you haven't pushed Tasks 1-5 yet:

```bash
git push origin main
```

Watch CI:

```bash
gh run list --limit 1
gh run watch <id>
```

Expected: both `deploy-functions` and `deploy-api` jobs pass. Verify with:

```bash
curl -s "https://peaks-api-qownl77soa-uc.a.run.app/health"
```

Expected: `{"status":"ok"}`

- [ ] **Step 8: Visual smoke test (optional, browser required)**

Visit the deployed admin destinations page in a browser, filter `feature=waterfall`, confirm WA entries render. Also exercise the admin OSM-nearby flow on a known WA waterfall — confirm the duplicate guard fires (should toast "Already exists: <name>" instead of creating a new row).
