# Bulk Import Washington Waterfalls from OSM

**Date:** 2026-04-28
**Status:** Approved

## Goal

Seed the destinations table with all named waterfalls in Washington state, sourced from OpenStreetMap, with elevation populated via free AWS-hosted Terrarium tiles. Establish two pieces of reusable infrastructure that future bulk imports will need: an `external_ids` column on the destinations table (so destinations can carry IDs from multiple external providers without one being load-bearing as the primary key), and a Terrarium elevation lookup helper.

## Rationale

The `waterfall` destination feature shipped today (commit `593aa54` and follow-ups). The DB currently has zero waterfall-feature destinations. A bulk seed of WA waterfalls gives users discoverable content immediately and exercises the new feature end-to-end.

OpenStreetMap is the only practical source for a comprehensive state-wide waterfall list. A live Overpass probe returned 876 waterfalls in WA, of which 430 are named. Only 11 of the 876 carry an OSM `ele` tag, so elevation lookup against an external DEM is essential, not optional.

A first draft tied the destination's primary key directly to OSM (`id = osm-waterfall-${osm_id}`). That approach doesn't scale: the same waterfall might later be matched to a GNIS, Wikidata, or AllTrails ID, and admin-added rows have random IDs with no link back to OSM, making future bulk imports unable to deduplicate against them. Adding an `external_ids` JSONB column solves both problems and is small enough to ship alongside this import.

## Scope

### In scope

- **Schema change**: add `external_ids JSONB NOT NULL DEFAULT '{}'` to `destinations`, with a GIN index for `external_ids->>'<provider>'` lookups.
- **Migration file** + schema.sql + CLAUDE.md doc updates (mirroring how the recent enum addition cascaded).
- **Provider key type**: a single TypeScript union `ExternalIdProvider = 'osm' | 'gnis' | 'wikidata' | 'alltrails'` defined in both `web/src/lib/destination-types.ts` and `cloud-sql/migrate/src/lib/external-ids.ts` (the codebase has no shared-types module across packages — duplication matches existing precedent).
- **Admin OSM-nearby flow update**: when admins import an OSM suggestion via the existing flow, write `external_ids: { osm: String(osm_id) }` alongside the existing fields. ~3 lines in `web/src/lib/actions/destinations.ts`. Without this, every admin OSM-add is a future deduplication headache.
- **Import script** `cloud-sql/migrate/src/import-osm-waterfalls-wa.ts` to fetch WA waterfalls from Overpass, look up elevation, and insert into `destinations` (deduping by `external_ids->>'osm'`).
- **Helper** `cloud-sql/migrate/src/lib/terrarium-elevation.ts` exposing `lookupElevation(lat, lng): Promise<number | null>` against AWS Open Data Terrarium tiles.
- **npm script** `import:wa-waterfalls`.
- **`--dry-run` flag** for the import script (prints counts and a sample, skips DB writes).

### Out of scope

- Hero images (OSM does not carry image refs; admin can curate per-destination later).
- Search-name normalization beyond `name.toLowerCase()` — matches the existing `import-cai-huts.ts` precedent.
- Other states or other features. This is WA waterfalls specifically. Future imports can copy the pattern, and the elevation helper + `external_ids` column are the only pieces designed for reuse.
- Admin UI integration. This is a developer-run script via `npm run import:wa-waterfalls`.
- Disabling the `link_sessions_on_destination_insert` trigger for bulk-insert performance. Accept the per-row trigger overhead for v1; tune if it proves slow.
- Backfilling `external_ids` for existing destinations.
- Spatial+name fuzzy dedup against admin-added rows lacking OSM IDs. Tomorrow's problem; today there are zero waterfall-feature destinations to dedupe against, so it's moot for this import.
- DB CHECK constraint on `external_ids` keys. The TypeScript union enforces consistency at code-review time without requiring a migration for every new provider.

## Schema change

### Migration

New file: `cloud-sql/migrations/20260428_destination_external_ids.sql`

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

### Schema.sql

Add the column to the `destinations` `CREATE TABLE` block, immediately after `metadata` for grouping (both are JSONB), and add the GIN index in the indexes section.

### Documentation

Update `cloud-sql/CLAUDE.md` and `web/CLAUDE.md` "Key tables" sections to mention `external_ids` on the `destinations` row.

### Provider key type

The codebase has no cross-package types module. Define the union in two places (acceptable per existing duplication precedent — same pattern as `destination_feature` enum string lists):

`web/src/lib/destination-types.ts` (new file):

```ts
export type ExternalIdProvider = 'osm' | 'gnis' | 'wikidata' | 'alltrails';

export type ExternalIds = Partial<Record<ExternalIdProvider, string>>;
```

`cloud-sql/migrate/src/lib/external-ids.ts` (new file):

```ts
export type ExternalIdProvider = 'osm' | 'gnis' | 'wikidata' | 'alltrails';

export type ExternalIds = Partial<Record<ExternalIdProvider, string>>;
```

Values are always strings — OSM IDs in particular can exceed `Number.MAX_SAFE_INTEGER`, and treating all provider IDs uniformly as strings avoids per-provider numeric coercion bugs.

### Admin OSM-nearby flow update

In `web/src/lib/actions/destinations.ts`, the import path that creates a destination from an `OSMSuggestion` (the function around line 350 referenced by the admin "new destination" page's OSM section). Currently inserts without `external_ids`. Change the INSERT to include `external_ids = $N::jsonb` and pass `JSON.stringify({ osm: String(wpt.osm_id) })`.

If the same OSM ID already exists in `external_ids->>'osm'`, the admin flow should surface a "already imported" message instead of creating a duplicate. Implementation: pre-check via `SELECT id FROM destinations WHERE external_ids->>'osm' = $1` before insert; if found, return early with a clear error (e.g., "Already exists as <name>"). This is small and worth doing now.

## Data Source

### Overpass query

```
[out:json][timeout:60];
area["ISO3166-2"="US-WA"]->.wa;
(
  node["waterway"="waterfall"](area.wa);
  way["waterway"="waterfall"](area.wa);
);
out tags center;
```

Verified live at design time: returns 876 elements (~430 with names) in roughly 2 seconds. Endpoint: `https://overpass-api.de/api/interpreter` (POST, `data=` form field URL-encoded).

### AWS Terrarium tiles

- Endpoint: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`
- No auth required. Public S3 bucket via the AWS Open Data Registry.
- PNG-encoded RGB elevation. Decoding: `height_meters = (R * 256 + G + B / 256) - 32768`.
- Use zoom 12. At Washington's latitude this is ~38 m/pixel — comfortably finer than waterfall-location accuracy.
- Tile coordinate math (Web Mercator):
  ```ts
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  // pixel within tile:
  const px = Math.floor((((lng + 180) / 360) * n - x) * 256);
  const py = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n - y) * 256);
  ```
- Cache decoded tiles in-memory keyed on `${z}/${x}/${y}`. WA at z=12 covers roughly 50–80 unique tiles, so 430 lookups are nearly all cache hits after warmup.

## Architecture

### `cloud-sql/migrate/src/lib/external-ids.ts`

Type-only module:

```ts
export type ExternalIdProvider = 'osm' | 'gnis' | 'wikidata' | 'alltrails';
export type ExternalIds = Partial<Record<ExternalIdProvider, string>>;
```

### `cloud-sql/migrate/src/lib/terrarium-elevation.ts`

Single export:

```ts
export async function lookupElevation(lat: number, lng: number): Promise<number | null>;
```

Internal:
- In-module `tileCache: Map<string, Uint8Array>` — keyed `${z}/${x}/${y}`, value is the raw RGBA decoded PNG bytes.
- Tile fetch with retry: up to 3 attempts on network errors or `5xx`/`429`, exponential backoff (1s, 2s, 4s).
- PNG decoding via the `pngjs` npm package (small, no native deps; added as a `cloud-sql/migrate` dep).
- Returns `null` on persistent failure rather than throwing — caller decides whether to skip the row.
- Concurrency control is the *caller's* responsibility. The helper itself is not concurrency-aware beyond cache hits being trivially safe to interleave.

### `cloud-sql/migrate/src/import-osm-waterfalls-wa.ts`

Mirrors the structure of `import-cai-huts.ts` with the new dedup pattern:

1. **Argument parsing**: `--dry-run` boolean flag.
2. **Fetch Overpass** with retry: 60s timeout in the query, 3 retries on the HTTP layer with exponential backoff. On final failure, exit non-zero.
3. **Filter** to elements where `tags.name` is non-empty and (`el.lat != null || el.center != null`). Track skipped reasons (`no-name`, `no-coords`).
4. **Pre-load existing-ID lookup**:
   ```sql
   SELECT id, external_ids->>'osm' AS osm_id
   FROM destinations
   WHERE external_ids ? 'osm'
     AND external_ids->>'osm' = ANY($1::text[]);
   ```
   `$1` is the array of OSM IDs (as strings) from the filtered Overpass results. Build a `Map<osmId, destinationId>` from the result. Empty map is fine — that means everything is new.
5. **Elevation lookup** with concurrency limit 5 (mirrors `parallelMap` in `import-cai-huts.ts`). Skip rows where elevation lookup returns `null` (track `elevation-failed`).
6. **Insert / update**: per-row branch on whether the OSM ID exists in the lookup map.
   - **Update path** (existing destination):
     ```sql
     UPDATE destinations SET
       name = $2, search_name = $3, elevation = $4,
       location = ST_SetSRID(ST_MakePoint($5, $6, $7), 4326)::geography,
       country_code = 'US', state_code = 'WA',
       features = ARRAY['waterfall']::destination_feature[],
       external_ids = external_ids || $8::jsonb,
       updated_at = NOW()
     WHERE id = $1;
     ```
     Note `external_ids` is merged (`||`) rather than overwritten, in case the existing row already has other provider IDs.
   - **Insert path** (new destination):
     ```sql
     INSERT INTO destinations (
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
       $8, $9, 'peaks',
       NOW(), NOW()
     );
     ```
     - `id` is a 20-char alphanumeric string. The migrate package has no existing `generateId()` (CAI huts uses synthetic prefixed IDs like `cai-hut-${id_cai}`; the Firestore migration reuses doc IDs). Inline a small helper at the top of the import script, mirroring the implementation in `web/src/lib/route-utils.ts:51`:
       ```ts
       function generateId(): string {
         const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
         let s = "";
         for (let i = 0; i < 20; i++) s += chars[Math.floor(Math.random() * chars.length)];
         return s;
       }
       ```
     - `search_name` = `name.toLowerCase()`.
     - `external_ids` = `JSON.stringify({ osm: String(osm_id) })`.
     - `metadata` JSON: `{ source: "osm" }` (just provenance — the OSM ID lives in `external_ids` now, and `osm_type` was never load-bearing).
     - `activities` set to `{outdoor-trek}` matching the CAI hut precedent.
7. **Dry-run**: if flag set, skip the INSERT/UPDATE. Print counts and the first 10 would-be rows including which path (insert vs update) they'd take.
8. **Final report**: `Imported: N (X new, Y updated), Skipped: M`, broken down by skip reason, descending.

### `web/src/lib/destination-types.ts`

Same definitions as the migrate-side module:

```ts
export type ExternalIdProvider = 'osm' | 'gnis' | 'wikidata' | 'alltrails';
export type ExternalIds = Partial<Record<ExternalIdProvider, string>>;
```

### Admin OSM-nearby flow

In `web/src/lib/actions/destinations.ts`:

1. Pre-insert duplicate check: `SELECT id, name FROM destinations WHERE external_ids->>'osm' = $1`. If a row is found, return `{ status: 'duplicate', existing_id, existing_name }` and skip the insert. Surface as a clear toast in the admin UI.
2. The INSERT statement gains an `external_ids` column with value `JSON.stringify({ osm: String(wpt.osm_id) })`.

### npm script

In `cloud-sql/migrate/package.json`:

```json
"import:wa-waterfalls": "tsx src/import-osm-waterfalls-wa.ts"
```

Run via `npm run import:wa-waterfalls -- --dry-run` first, then without the flag for the real run.

### Dependencies

Add `pngjs` (and `@types/pngjs`) to `cloud-sql/migrate/package.json`. Both are small, widely-used, no native compilation.

## Data flow

```
Overpass API ──fetch──▶ filter (named, has-coords)
                         │
                         ▼
                   Pre-load existing-ID lookup
                   (SELECT … WHERE external_ids->>'osm' = ANY)
                         │
                         ▼
                   ┌──────────────────────┐
                   │ For each, with       │
                   │ concurrency=5:       │
                   │   lookupElevation()  │ ◀── AWS Terrarium tile cache
                   │   (skip if null)     │
                   └──────────────────────┘
                         │
                         ▼
              ┌──────────┴──────────┐
              ▼                     ▼
        OSM ID in map?        Not in map?
              │                     │
              ▼                     ▼
           UPDATE                 INSERT
           by id                  with new id
                         │
                         ▼
                   destinations table
                         │
                         ▼
                   link_sessions_on_destination_insert trigger
                   (matches existing sessions within 50m on INSERT only;
                    UPDATE path does not re-fire the trigger by default)
```

## Error handling

- **Overpass fails**: 3 retries with exponential backoff at the script's HTTP layer; exit non-zero on persistent failure. Nothing inserted.
- **Tile fetch fails for a single waterfall**: retried 3 times in the helper; if still failing, helper returns `null`, the script skips the row with reason `elevation-failed`. Other rows continue.
- **DB insert/update fails for a single row**: catch + log + skip with reason `db-error`. Other rows continue.
- **Process killed mid-run**: safe — every successful row is committed (autocommit), and re-running upserts cleanly (existing rows are matched via `external_ids->>'osm'` and updated). Partial state never corrupts.

## Verification

1. Apply migration locally first against the proxy:
   ```bash
   psql -h 127.0.0.1 -p 5432 -U postgres -d peaks -f cloud-sql/migrations/20260428_destination_external_ids.sql
   psql -h 127.0.0.1 -p 5432 -U postgres -d peaks -c "\d destinations" | grep external_ids
   ```
2. `npm run import:wa-waterfalls -- --dry-run` — confirm reasonable count (~400+), confirm first 10 entries look like real waterfalls with sane elevations (200–2000m typical for WA). All should report "would insert (new)" since today there are zero existing waterfall destinations.
3. Real run: `npm run import:wa-waterfalls`. Expect "Imported: ~400 (~400 new, 0 updated)" with most skips being `elevation-failed` if any.
4. SQL spot-checks:
   ```sql
   SELECT count(*) FROM destinations
     WHERE 'waterfall' = ANY(features) AND state_code = 'WA';
   -- expect ~400+

   SELECT name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
          elevation, external_ids
   FROM destinations
   WHERE name = 'Snoqualmie Falls';
   -- expect Snoqualmie Falls present with non-null elevation around 122m
   --   and external_ids = {"osm": "<numeric-id>"}
   ```
5. Re-run the import script (without `--dry-run`) to verify the update path: should report "Imported: ~400 (0 new, ~400 updated)" the second time.
6. Visit deployed admin destinations page, filter feature = `waterfall`, confirm WA entries render.
7. Manually exercise the admin OSM-nearby flow on an OSM ID already in the DB — confirm the duplicate guard fires.

## Risks

- **Overpass rate limiting**: the public Overpass instance throttles aggressive use. One ~2s query per import run is well within limits. If 429s start appearing, switch to `https://overpass.kumi.systems/api/interpreter` as a fallback (no API change).
- **Terrarium tile bucket cost / availability**: AWS Open Data; free public S3, no budget concern. If S3 returns 5xx for sustained periods, the script will skip rows with `elevation-failed` rather than abort — re-running later will fill in the gaps thanks to the upsert.
- **Trigger overhead**: ~430 inserts each run the `link_sessions_on_destination_insert` trigger. Acceptable for v1; revisit if observed run time exceeds ~10 minutes. Subsequent re-runs hit the UPDATE path, which doesn't fire the insert trigger.
- **GIN index size**: with 5924 destinations today and `external_ids` defaulting to `'{}'`, the index will be small initially and grow only as imports/admins add provider IDs. Standard JSONB GIN; no concerns at this scale.
- **Future re-runs surface OSM corrections**: a waterfall renamed in OSM will get a new `name` on the next import (its `osm_id` and thus our `external_ids->>'osm'` is stable). This is desired behavior.
