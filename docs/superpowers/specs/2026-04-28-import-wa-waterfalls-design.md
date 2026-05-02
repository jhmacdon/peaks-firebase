# Bulk Import Washington Waterfalls from OSM

**Date:** 2026-04-28
**Status:** Approved

## Goal

Seed the destinations table with all named waterfalls in Washington state, sourced from OpenStreetMap, with elevation populated via free AWS-hosted Terrarium tiles. Establish a reusable elevation-lookup helper so subsequent bulk imports (other states, other features) can reuse it.

## Rationale

The `waterfall` destination feature shipped today (commit `593aa54` and follow-ups). The DB currently has zero waterfall-feature destinations. A bulk seed of WA waterfalls gives users discoverable content immediately and exercises the new feature end-to-end.

OpenStreetMap is the only practical source for a comprehensive state-wide waterfall list. A live Overpass probe returned 876 waterfalls in WA, of which 430 are named. Only 11 of the 876 carry an OSM `ele` tag, so elevation lookup against an external DEM is essential, not optional — without it nearly every imported destination would have null elevation.

## Scope

### In scope

- New script `cloud-sql/migrate/src/import-osm-waterfalls-wa.ts` to fetch WA waterfalls from Overpass, look up elevation, and upsert into `destinations`.
- New helper `cloud-sql/migrate/src/lib/terrarium-elevation.ts` exposing `lookupElevation(lat, lng): Promise<number | null>` against AWS Open Data Terrarium tiles.
- New npm script `import:wa-waterfalls`.
- `--dry-run` flag for the import script (prints counts and a sample, skips DB writes).

### Out of scope

- Hero images (OSM does not carry image refs; admin can curate per-destination later).
- Search-name normalization beyond `name.toLowerCase()` — matches the existing `import-cai-huts.ts` precedent.
- Other states or other features. This is WA waterfalls specifically. Future imports can copy the pattern, and the elevation helper is the only piece designed for reuse.
- Admin UI integration. This is a developer-run script via `npm run import:wa-waterfalls`.
- Disabling the `link_sessions_on_destination_insert` trigger for bulk-insert performance. We accept the per-row trigger overhead for v1; can tune if it proves slow.

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

### `cloud-sql/migrate/src/lib/terrarium-elevation.ts`

Single export:

```ts
export async function lookupElevation(lat: number, lng: number): Promise<number | null>;
```

Internal:
- In-module `tileCache: Map<string, Uint8Array>` — keyed `${z}/${x}/${y}`, value is the raw RGBA decoded PNG bytes.
- Tile fetch with retry: up to 3 attempts on network errors or `5xx`/`429`, exponential backoff (1s, 2s, 4s).
- PNG decoding via the `pngjs` npm package (small, no native deps; we'll add it as a `cloud-sql/migrate` dep).
- Returns `null` on persistent failure rather than throwing — caller decides whether to skip the row.
- Concurrency control is the *caller's* responsibility (see below). The helper itself is not concurrency-aware beyond cache hits being trivially safe to interleave.

### `cloud-sql/migrate/src/import-osm-waterfalls-wa.ts`

Mirrors the structure of `import-cai-huts.ts`:

1. **Argument parsing**: `--dry-run` boolean flag.
2. **Fetch Overpass** with retry: 60s timeout in the query, 3 retries on the HTTP layer with exponential backoff. On final failure, exit non-zero.
3. **Filter** to elements where `tags.name` is non-empty and (`el.lat != null || el.center != null`). Track skipped reasons (`no-name`, `no-coords`).
4. **Elevation lookup** with concurrency limit 5 (mirrors `parallelMap` in `import-cai-huts.ts`). Skip rows where elevation lookup returns `null` (track `elevation-failed`).
5. **Insert**: per-row `ON CONFLICT (id) DO UPDATE`. SQL shape mirrors `import-cai-huts.ts`:
   ```sql
   INSERT INTO destinations (
     id, name, search_name, elevation, prominence,
     location, geohash,
     type, activities, features,
     country_code, state_code,
     hero_image,
     metadata, owner,
     created_at, updated_at
   ) VALUES (
     $1, $2, $3, $4, NULL,
     ST_SetSRID(ST_MakePoint($5, $6, $7), 4326)::geography, NULL,
     'point', '{outdoor-trek}', '{waterfall}',
     'US', 'WA',
     NULL,
     $8, 'peaks',
     NOW(), NOW()
   )
   ON CONFLICT (id) DO UPDATE SET
     name = EXCLUDED.name,
     search_name = EXCLUDED.search_name,
     elevation = EXCLUDED.elevation,
     location = EXCLUDED.location,
     country_code = EXCLUDED.country_code,
     state_code = EXCLUDED.state_code,
     features = EXCLUDED.features,
     metadata = EXCLUDED.metadata,
     updated_at = NOW();
   ```
   - `id` = `osm-waterfall-${osm_id}` (e.g., `osm-waterfall-12345678`).
   - `search_name` = `name.toLowerCase()`.
   - `metadata` JSON: `{ source: "osm", osm_type: "node" | "way", osm_id }`.
   - `activities` set to `{outdoor-trek}` matching the CAI hut precedent (waterfalls are typically hiked-to).
6. **Dry-run**: if flag set, skip the INSERT, print "[dry-run] would insert: name (lat, lng, ele)" for the first 10, plus the full counts.
7. **Final report**: `Imported: N, Skipped: M`, broken down by skip reason, descending.

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
                   ┌──────────────────────┐
                   │ For each, with       │
                   │ concurrency=5:       │
                   │   lookupElevation()  │ ◀── AWS Terrarium tile cache
                   │   (skip if null)     │
                   └──────────────────────┘
                         │
                         ▼
                   destinations table
                   (UPSERT keyed on osm-waterfall-${osm_id})
                         │
                         ▼
                   link_sessions_on_destination_insert trigger
                   (matches existing sessions within 50m)
```

## Error handling

- **Overpass fails**: 3 retries with exponential backoff at the script's HTTP layer; exit non-zero on persistent failure. Nothing inserted.
- **Tile fetch fails for a single waterfall**: retried 3 times in the helper; if still failing, helper returns `null`, the script skips the row with reason `elevation-failed`. Other rows continue.
- **DB insert fails for a single row**: catch + log + skip with reason `db-error`. Other rows continue.
- **Process killed mid-run**: safe — every successful row is committed (autocommit), and re-running upserts cleanly. Partial state never corrupts.

## Verification

1. `npm run import:wa-waterfalls -- --dry-run` — confirm reasonable count (~400+), confirm first 10 entries look like real waterfalls with sane elevations (200–2000m typical for WA), no spurious entries.
2. Real run: `npm run import:wa-waterfalls`. Expect "Imported: ~400" with most skips being `elevation-failed` if any.
3. SQL spot-checks against prod (via local Cloud SQL Auth Proxy):
   ```sql
   SELECT count(*) FROM destinations WHERE 'waterfall' = ANY(features) AND state_code = 'WA';
   -- expect ~400+

   SELECT name, ST_Y(location::geometry), ST_X(location::geometry), elevation
   FROM destinations
   WHERE id = 'osm-waterfall-' || (
     SELECT (metadata->>'osm_id')::text FROM destinations WHERE name = 'Snoqualmie Falls' LIMIT 1
   );
   -- expect Snoqualmie Falls present with non-null elevation around 122m
   ```
4. Visit deployed admin destinations page, filter feature = `waterfall`, confirm WA entries render.

## Risks

- **Overpass rate limiting**: the public Overpass instance throttles aggressive use. One ~2s query per import run is well within limits. If 429s start appearing, switch to `https://overpass.kumi.systems/api/interpreter` as a fallback (no API change).
- **Terrarium tile bucket cost / availability**: AWS Open Data; free public S3, no budget concern. If S3 returns 5xx for sustained periods, the script will skip rows with `elevation-failed` rather than abort — re-running later will fill in the gaps thanks to the upsert.
- **Trigger overhead**: 430 inserts each run the `link_sessions_on_destination_insert` trigger. Acceptable for v1; revisit if observed run time exceeds ~10 minutes.
- **Future re-runs surface OSM corrections**: a waterfall renamed in OSM will get a new `name` on the next import (its `osm_id` and thus our `id` is stable). This is desired behavior.
