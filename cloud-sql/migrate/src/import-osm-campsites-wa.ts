import db from "./db";
import { lookupElevation } from "./lib/terrarium-elevation";
import { CampsiteAmenities } from "./lib/amenities";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const QUERY = `[out:json][timeout:60];
area["ISO3166-2"="US-WA"]->.wa;
(
  node["tourism"="camp_site"](area.wa);
  way["tourism"="camp_site"](area.wa);
);
out tags geom;`;

const ELEVATION_CONCURRENCY = 5;

interface OverpassGeomVertex {
  lat: number;
  lon: number;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  geometry?: OverpassGeomVertex[];
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

interface Campsite {
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  kind: "node" | "way";
  /** WKT POLYGON string — only present for way elements */
  boundaryWkt?: string;
  tags: Record<string, string>;
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
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
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

/**
 * Map OSM tags to CampsiteAmenities. Returns undefined if no relevant tags
 * were found (so we store NULL in amenities rather than an empty object).
 */
function extractAmenities(tags: Record<string, string>): CampsiteAmenities | undefined {
  const a: CampsiteAmenities = {};

  // toilet
  if (tags["toilets"] === "yes") {
    const disposal = tags["toilets:disposal"];
    if (disposal === "flush") {
      a.toilet = "flush";
    } else if (disposal === "pitlatrine") {
      a.toilet = "pit";
    } else {
      // vault_flush or no disposal tag → vault
      a.toilet = "vault";
    }
  } else if (tags["toilets"] === "no") {
    a.toilet = "none";
  }

  // drinking_water
  if (tags["drinking_water"] === "yes") {
    a.drinking_water = "yes";
  } else if (tags["drinking_water"] === "no") {
    a.drinking_water = "no";
  } else if (tags["drinking_water"] === "seasonal") {
    a.drinking_water = "seasonal";
  }

  // shower
  if (tags["shower"] === "yes") {
    a.shower = true;
  } else if (tags["shower"] === "no") {
    a.shower = false;
  }

  // fee
  if (tags["fee"] === "yes") {
    const fee: CampsiteAmenities["fee"] = { required: true };
    if (tags["charge"]) fee.amount = tags["charge"];
    a.fee = fee;
  } else if (tags["fee"] === "no") {
    a.fee = { required: false };
  }

  // reservation
  if (tags["reservation"] === "required") {
    a.reservation = "required";
  } else if (tags["reservation"] === "recommended") {
    a.reservation = "recommended";
  } else if (tags["reservation"] === "no") {
    a.reservation = "no";
  }

  // capacity
  if (tags["capacity"] !== undefined) {
    const cap = parseInt(tags["capacity"], 10);
    if (!isNaN(cap)) a.capacity = cap;
  }

  // fire_pit
  if (tags["fireplace"] === "yes") {
    a.fire_pit = true;
  } else if (tags["fireplace"] === "no") {
    a.fire_pit = false;
  }

  // tents
  if (tags["tents"] === "yes") {
    a.tents = true;
  } else if (tags["tents"] === "no") {
    a.tents = false;
  }

  // caravans
  if (tags["caravans"] === "yes") {
    a.caravans = true;
  } else if (tags["caravans"] === "no") {
    a.caravans = false;
  }

  // max_length
  if (tags["maxlength"] !== undefined) {
    const ml = parseFloat(tags["maxlength"]);
    if (!isNaN(ml)) a.max_length = ml;
  }

  // backcountry — either tag triggers
  if (tags["backcountry"] === "yes" || tags["motor_vehicle"] === "no") {
    a.backcountry = true;
  }

  // power_supply
  if (tags["power_supply"] === "yes") {
    a.power_supply = true;
  } else if (tags["power_supply"] === "no") {
    a.power_supply = false;
  }

  return Object.keys(a).length > 0 ? a : undefined;
}

/**
 * Build a closed WKT POLYGON string from Overpass geometry vertices.
 * Vertices are in lat/lon order from Overpass; WKT uses lng lat order.
 */
function buildPolygonWkt(vertices: OverpassGeomVertex[]): string {
  let verts = vertices;
  // Ensure polygon is closed (first === last)
  const first = verts[0];
  const last = verts[verts.length - 1];
  if (first.lat !== last.lat || first.lon !== last.lon) {
    verts = [...verts, first];
  }
  const coords = verts.map((v) => `${v.lon} ${v.lat}`).join(", ");
  return `POLYGON((${coords}))`;
}

export async function importOsmCampsitesWa(opts: { dryRun: boolean }) {
  console.log("Fetching WA campsites from Overpass...");
  const data = await fetchOverpassWithRetry();
  console.log(`  Got ${data.elements.length} elements`);

  const skippedReasons: Record<string, number> = {};
  function skip(reason: string) {
    skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
  }

  const campsites: Campsite[] = [];
  for (const el of data.elements) {
    // Skip relations entirely per spec
    if (el.type === "relation") {
      skip("relation-skipped");
      continue;
    }

    const name = el.tags?.name?.trim();
    if (!name) {
      skip("no-name");
      continue;
    }

    const tags = el.tags ?? {};

    if (el.type === "node") {
      if (el.lat == null || el.lon == null) {
        skip("no-coords");
        continue;
      }
      campsites.push({
        osmId: String(el.id),
        name,
        lat: el.lat,
        lng: el.lon,
        kind: "node",
        tags,
      });
    } else if (el.type === "way") {
      const geom = el.geometry;
      if (!geom || geom.length < 4) {
        skip("way-too-few-vertices");
        continue;
      }
      // Compute location as average of all vertices
      let sumLat = 0;
      let sumLng = 0;
      for (const v of geom) {
        sumLat += v.lat;
        sumLng += v.lon;
      }
      const lat = sumLat / geom.length;
      const lng = sumLng / geom.length;
      const boundaryWkt = buildPolygonWkt(geom);
      campsites.push({
        osmId: String(el.id),
        name,
        lat,
        lng,
        kind: "way",
        boundaryWkt,
        tags,
      });
    }
  }
  console.log(`  After name+coord filter: ${campsites.length}`);
  const nodeCount = campsites.filter((c) => c.kind === "node").length;
  const wayCount = campsites.filter((c) => c.kind === "way").length;
  console.log(`    nodes: ${nodeCount}, ways: ${wayCount}`);

  // Pre-load existing-ID lookup map.
  console.log("Pre-loading existing OSM-id → destination_id map...");
  const osmIds = campsites.map((c) => c.osmId);
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
    campsites,
    async (c) => ({ ...c, elevation: await lookupElevation(c.lat, c.lng) }),
    ELEVATION_CONCURRENCY
  );

  let insertedNodes = 0;
  let insertedWays = 0;
  let updatedNodes = 0;
  let updatedWays = 0;
  const sampleRows: Array<{
    name: string;
    lat: number;
    lng: number;
    elevation: number;
    kind: "node" | "way";
    path: "insert" | "update";
  }> = [];

  for (const c of withElevation) {
    if (c.elevation == null) {
      skip("elevation-failed");
      continue;
    }
    const path: "insert" | "update" = existingByOsmId.has(c.osmId) ? "update" : "insert";
    if (sampleRows.length < 10) {
      sampleRows.push({ name: c.name, lat: c.lat, lng: c.lng, elevation: c.elevation, kind: c.kind, path });
    }

    if (opts.dryRun) {
      if (path === "insert") {
        if (c.kind === "node") insertedNodes++;
        else insertedWays++;
      } else {
        if (c.kind === "node") updatedNodes++;
        else updatedWays++;
      }
      continue;
    }

    const amenities = extractAmenities(c.tags);
    const metadata = { source: "osm", osm_tags: c.tags };

    try {
      if (path === "update") {
        const id = existingByOsmId.get(c.osmId)!;
        if (c.kind === "node") {
          await db.query(
            `UPDATE destinations SET
               name = $2, search_name = $3, elevation = $4,
               location = ST_SetSRID(ST_MakePoint($5, $6, $7), 4326)::geography,
               type = 'point', boundary = NULL,
               country_code = 'US', state_code = 'WA',
               features = ARRAY['campsite']::destination_feature[],
               external_ids = external_ids || $8::jsonb,
               amenities = $9::jsonb,
               metadata = $10::jsonb,
               updated_at = NOW()
             WHERE id = $1`,
            [
              id,
              c.name,
              c.name.toLowerCase(),
              c.elevation,
              c.lng,
              c.lat,
              c.elevation,
              JSON.stringify({ osm: c.osmId }),
              amenities !== undefined ? JSON.stringify(amenities) : null,
              JSON.stringify(metadata),
            ]
          );
          updatedNodes++;
        } else {
          await db.query(
            `UPDATE destinations SET
               name = $2, search_name = $3, elevation = $4,
               location = ST_SetSRID(ST_MakePoint($5, $6, $7), 4326)::geography,
               type = 'region', boundary = ST_GeogFromText($8::text),
               country_code = 'US', state_code = 'WA',
               features = ARRAY['campsite']::destination_feature[],
               external_ids = external_ids || $9::jsonb,
               amenities = $10::jsonb,
               metadata = $11::jsonb,
               updated_at = NOW()
             WHERE id = $1`,
            [
              id,
              c.name,
              c.name.toLowerCase(),
              c.elevation,
              c.lng,
              c.lat,
              c.elevation,
              c.boundaryWkt,
              JSON.stringify({ osm: c.osmId }),
              amenities !== undefined ? JSON.stringify(amenities) : null,
              JSON.stringify(metadata),
            ]
          );
          updatedWays++;
        }
      } else {
        const id = generateId();
        if (c.kind === "node") {
          await db.query(
            `INSERT INTO destinations (
               id, name, search_name, elevation, prominence,
               location, geohash,
               type, activities, features,
               country_code, state_code,
               hero_image,
               external_ids, metadata, amenities, owner,
               created_at, updated_at
             ) VALUES (
               $1, $2, $3, $4, NULL,
               ST_SetSRID(ST_MakePoint($5, $6, $7), 4326)::geography, NULL,
               'point', '{outdoor-trek}', '{campsite}',
               'US', 'WA',
               NULL,
               $8::jsonb, $9::jsonb, $10::jsonb, 'peaks',
               NOW(), NOW()
             )`,
            [
              id,
              c.name,
              c.name.toLowerCase(),
              c.elevation,
              c.lng,
              c.lat,
              c.elevation,
              JSON.stringify({ osm: c.osmId }),
              JSON.stringify(metadata),
              amenities !== undefined ? JSON.stringify(amenities) : null,
            ]
          );
          insertedNodes++;
        } else {
          await db.query(
            `INSERT INTO destinations (
               id, name, search_name, elevation, prominence,
               location, geohash,
               type, boundary, activities, features,
               country_code, state_code,
               hero_image,
               external_ids, metadata, amenities, owner,
               created_at, updated_at
             ) VALUES (
               $1, $2, $3, $4, NULL,
               ST_SetSRID(ST_MakePoint($5, $6, $7), 4326)::geography, NULL,
               'region', ST_GeogFromText($8::text), '{outdoor-trek}', '{campsite}',
               'US', 'WA',
               NULL,
               $9::jsonb, $10::jsonb, $11::jsonb, 'peaks',
               NOW(), NOW()
             )`,
            [
              id,
              c.name,
              c.name.toLowerCase(),
              c.elevation,
              c.lng,
              c.lat,
              c.elevation,
              c.boundaryWkt,
              JSON.stringify({ osm: c.osmId }),
              JSON.stringify(metadata),
              amenities !== undefined ? JSON.stringify(amenities) : null,
            ]
          );
          insertedWays++;
        }
      }
    } catch (err: any) {
      console.error(`  Error ${path} ${c.name} (osm ${c.osmId}): ${err.message}`);
      skip("db-error");
    }
  }

  const inserted = insertedNodes + insertedWays;
  const updated = updatedNodes + updatedWays;

  console.log("");
  console.log(opts.dryRun ? "Dry-run sample (first 10):" : "Sample of processed rows (first 10):");
  for (const r of sampleRows) {
    console.log(
      `  [${r.path}][${r.kind}] ${r.name}  (${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}) ele=${r.elevation}m`
    );
  }

  console.log("");
  console.log(opts.dryRun ? "WA campsite import (dry-run) summary:" : "WA campsite import complete:");
  console.log(`  Imported: ${inserted + updated} (${inserted} new, ${updated} updated)`);
  console.log(`    nodes: ${insertedNodes + updatedNodes} (${insertedNodes} new, ${updatedNodes} updated)`);
  console.log(`    ways:  ${insertedWays + updatedWays} (${insertedWays} new, ${updatedWays} updated)`);
  const skippedTotal = Object.values(skippedReasons).reduce((a, b) => a + b, 0);
  console.log(`  Skipped:  ${skippedTotal}`);
  for (const [reason, count] of Object.entries(skippedReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`    - ${reason}: ${count}`);
  }
}

if (process.argv[1]?.includes("import-osm-campsites-wa")) {
  const dryRun = process.argv.includes("--dry-run");
  importOsmCampsitesWa({ dryRun })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
