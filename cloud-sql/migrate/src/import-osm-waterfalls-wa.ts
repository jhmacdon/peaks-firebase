import db from "./db";
import { lookupElevation } from "./lib/terrarium-elevation";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const buildQuery = (stateCode: string) => `[out:json][timeout:60];
area["ISO3166-2"="US-${stateCode}"]->.region;
(
  node["waterway"="waterfall"](area.region);
  way["waterway"="waterfall"](area.region);
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

async function fetchOverpassWithRetry(query: string, retries = 3): Promise<OverpassResponse> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(OVERPASS_ENDPOINT, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass returns HTTP 406 to requests with the default Node fetch
          // User-Agent. Set an identifying UA per Overpass etiquette.
          "User-Agent": "peaks-migrate-bulk-import (https://github.com/jhmacdon/peaks-firebase)",
        },
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

export async function importOsmWaterfalls(opts: { dryRun: boolean; stateCode: string }) {
  const stateCode = opts.stateCode.toUpperCase();
  console.log(`Fetching ${stateCode} waterfalls from Overpass...`);
  const data = await fetchOverpassWithRetry(buildQuery(stateCode));
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
        // Re-import is authoritative on name/elevation/location/features/state.
        // Admin edits to these fields will be CLOBBERED on next run; only
        // external_ids is merged (so admin-added gnis/wikidata IDs survive).
        const id = existingByOsmId.get(w.osmId)!;
        await db.query(
          `UPDATE destinations SET
             name = $2, search_name = $3, elevation = $4,
             location = ST_SetSRID(ST_MakePoint($5, $6, $7), 4326)::geography,
             country_code = 'US', state_code = $9,
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
            stateCode,
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
             'US', $10,
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
            stateCode,
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
  console.log(opts.dryRun ? `${stateCode} waterfall import (dry-run) summary:` : `${stateCode} waterfall import complete:`);
  console.log(`  Imported: ${inserted + updated} (${inserted} new, ${updated} updated)`);
  const skippedTotal = Object.values(skippedReasons).reduce((a, b) => a + b, 0);
  console.log(`  Skipped:  ${skippedTotal}`);
  for (const [reason, count] of Object.entries(skippedReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`    - ${reason}: ${count}`);
  }
}

if (process.argv[1]?.includes("import-osm-waterfalls-wa")) {
  const dryRun = process.argv.includes("--dry-run");
  // --state=XX overrides the default WA. ISO3166-2 second part (US-WA, US-OR, ...).
  const stateArg = process.argv.find((a) => a.startsWith("--state="));
  const stateCode = stateArg ? stateArg.slice("--state=".length) : "WA";
  importOsmWaterfalls({ dryRun, stateCode })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
