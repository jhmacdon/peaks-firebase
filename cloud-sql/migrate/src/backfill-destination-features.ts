import db from "./db";

/**
 * Backfill `features` for peaks-owned destinations that came over from the
 * 2026-03-13 Firestore migration with an empty features array (`{}`).
 *
 * Root issue: the Firestore source docs for ~1,349 destinations had no
 * `features` field, so `migrate-destinations.ts mapFeatures([])` produced `{}`.
 * That means correctly-bagged summits never render/count as peaks in the app.
 *
 * Approach (per user directive: tag KNOWN summits only — "Everest Camps wouldn't
 * be summits"): cross-reference each destination against OpenStreetMap via
 * Overpass. Assign `summit` only when OSM has a `natural=peak`/`hill` node that
 * matches by name or sits within a tight radius of our coordinate; assign
 * `volcano,summit` for `natural=volcano`. Everything OSM can't confirm is left
 * untouched (empty) rather than guessed.
 *
 * Usage:
 *   tsx src/backfill-destination-features.ts            # dry run (no writes)
 *   tsx src/backfill-destination-features.ts --apply    # write classifications
 *   ... --radius=150 --tight=50 --batch=25 --limit=0
 */

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

interface OverpassElement {
  type: "node" | "way";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
interface OverpassResponse { elements: OverpassElement[] }

interface Dest {
  id: string;
  name: string;
  lat: number;
  lng: number;
  elevation: number | null;
  prominence: number | null;
}

function arg(name: string, def: number): number {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!m) return def;
  const v = parseInt(m.split("=")[1], 10);
  return Number.isNaN(v) ? def : v;
}
const APPLY = process.argv.includes("--apply");
const RADIUS = arg("radius", 150);     // max search radius (m) for a name match
const TIGHT = arg("tight", 50);        // radius (m) for a coord-only match
const BATCH = arg("batch", 25);        // destinations per Overpass query
const LIMIT = arg("limit", 0);         // 0 = all

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")  // strip diacritics
    .replace(/\b(mount|mt\.?|mountain|peak|pk\.?|benchmark|bm)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Meters between two lat/lng using the haversine formula.
function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function fetchOverpassWithRetry(query: string, retries = 4): Promise<OverpassResponse> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(OVERPASS_ENDPOINT, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "peaks-feature-backfill (https://github.com/jhmacdon/peaks-firebase)",
        },
      });
      if (res.ok) return res.json();
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt));
        continue;
      }
      throw new Error(`Overpass HTTP ${res.status}`);
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt));
    }
  }
  throw new Error("unreachable");
}

// One Overpass query covering a whole batch: every summit-like natural node
// within RADIUS of any destination in the batch.
function buildBatchQuery(batch: Dest[]): string {
  const clauses = batch
    .map((d) =>
      `node(around:${RADIUS},${d.lat},${d.lng})["natural"~"^(peak|volcano|hill)$"];` +
      `node(around:${RADIUS},${d.lat},${d.lng})["mountain_pass"="yes"];`
    )
    .join("\n  ");
  return `[out:json][timeout:90];\n(\n  ${clauses}\n);\nout tags center;`;
}

type Klass = { features: string[]; reason: string };

function classify(dest: Dest, nodes: OverpassElement[]): Klass | null {
  const targetName = normalizeName(dest.name);
  type Cand = { natural: string; name: string | undefined; dist: number };
  const cands: Cand[] = [];
  for (const el of nodes) {
    const nat = el.tags?.natural;
    if (nat !== "peak" && nat !== "volcano" && nat !== "hill") continue;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const dist = distM(dest.lat, dest.lng, lat, lng);
    if (dist > RADIUS) continue;
    cands.push({ natural: nat, name: el.tags?.name, dist });
  }
  if (cands.length === 0) return null;

  const toFeatures = (nat: string): string[] =>
    nat === "volcano" ? ["volcano", "summit"] : ["summit"];

  // 1) Name match anywhere within RADIUS (strongest signal).
  const named = cands
    .filter((c) => c.name && normalizeName(c.name) === targetName && targetName.length > 0)
    .sort((a, b) => a.dist - b.dist)[0];
  if (named) return { features: toFeatures(named.natural), reason: `name-match @${Math.round(named.dist)}m` };

  // 2) Coordinate match within the tight radius (same-source coords, no name).
  const close = cands.filter((c) => c.dist <= TIGHT).sort((a, b) => a.dist - b.dist)[0];
  if (close) return { features: toFeatures(close.natural), reason: `coord-match @${Math.round(close.dist)}m` };

  return null;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"} | radius=${RADIUS}m tight=${TIGHT}m batch=${BATCH}`);

  const limitSql = LIMIT > 0 ? `LIMIT ${LIMIT}` : "";
  const { rows } = await db.query(
    `SELECT id, name,
            ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
            elevation, prominence
     FROM destinations
     WHERE owner='peaks' AND (features IS NULL OR features='{}') AND name IS NOT NULL
     ORDER BY elevation DESC NULLS LAST ${limitSql}`
  );
  const dests: Dest[] = rows.map((r) => ({
    id: r.id, name: r.name, lat: r.lat, lng: r.lng, elevation: r.elevation, prominence: r.prominence,
  }));
  console.log(`Loaded ${dests.length} empty-feature destinations`);

  const byFeature: Record<string, number> = {};
  let matched = 0;
  let unmatched = 0;
  let unmatchedWithProm = 0;
  const samples: string[] = [];
  const unmatchedSamples: string[] = [];

  for (let i = 0; i < dests.length; i += BATCH) {
    const batch = dests.slice(i, i + BATCH);
    let resp: OverpassResponse;
    try {
      resp = await fetchOverpassWithRetry(buildBatchQuery(batch));
    } catch (err) {
      console.error(`  batch ${i}-${i + batch.length} failed: ${(err as Error).message}; skipping`);
      continue;
    }
    const nodes = resp.elements;

    for (const dest of batch) {
      const k = classify(dest, nodes);
      if (!k) {
        unmatched++;
        if (dest.prominence != null) unmatchedWithProm++;
        if (unmatchedSamples.length < 25) {
          unmatchedSamples.push(`    ? ${dest.name} (elev=${dest.elevation ?? "?"}, prom=${dest.prominence ?? "?"})`);
        }
        continue;
      }
      matched++;
      const key = `{${k.features.join(",")}}`;
      byFeature[key] = (byFeature[key] || 0) + 1;
      if (samples.length < 30) samples.push(`    ✓ ${dest.name} → ${key} [${k.reason}]`);
      if (APPLY) {
        await db.query(
          `UPDATE destinations SET features = $2::destination_feature[]
           WHERE id = $1 AND (features IS NULL OR features='{}')`,
          [dest.id, k.features]
        );
      }
    }
    process.stdout.write(`\r  processed ${Math.min(i + BATCH, dests.length)}/${dests.length} (matched=${matched}, unmatched=${unmatched})   `);
    await new Promise((r) => setTimeout(r, 1200)); // Overpass etiquette
  }

  console.log("\n\n=== RESULTS ===");
  console.log(`matched:   ${matched}`);
  for (const [k, n] of Object.entries(byFeature).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k}: ${n}`);
  }
  console.log(`unmatched: ${unmatched} (of which ${unmatchedWithProm} have a prominence value — likely summits OSM didn't return)`);
  console.log("\n--- sample matches ---\n" + samples.join("\n"));
  console.log("\n--- sample unmatched ---\n" + unmatchedSamples.join("\n"));
  if (!APPLY) console.log("\nDRY RUN — no rows written. Re-run with --apply to persist.");

  await db.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
