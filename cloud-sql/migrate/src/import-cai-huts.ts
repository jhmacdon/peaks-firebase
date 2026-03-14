import db from "./db";

/**
 * Import CAI (Club Alpino Italiano) mountain huts from rifugi.cai.it API
 * into PostGIS destinations table.
 *
 * Strategy:
 * 1. Paginate /api/v1/shelters to get all shelter IDs + basic geo/altitude
 * 2. Fetch /api/v1/shelters/{id_cai} individually for full fields (status, type, etc.)
 * 3. Filter to active only, require name + location + elevation
 * 4. Insert into destinations with feature = {hut}
 */

const API_BASE = "https://rifugi.cai.it/api/v1/shelters";
const PER_PAGE = 200;
const CONCURRENCY = 5; // parallel detail fetches

interface ShelterField {
  name: string;
  value: string | null;
  data?: any;
}

interface ShelterBasic {
  id: number;
  id_cai: number;
  title: string;
  slug: string;
  geo: { type: string; coordinates: [number, number] } | null;
  published: boolean;
  deleted_at: string | null;
  altitude_geo?: number | null;
}

interface ShelterDetail extends ShelterBasic {
  fields: ShelterField[];
  media?: any[];
}

interface PaginatedResponse {
  current_page: number;
  data: ShelterBasic[];
  last_page: number;
  total: number;
}

function getField(fields: ShelterField[], name: string): string | null {
  const f = fields.find((f) => f.name === name);
  return f?.value ?? null;
}

function getFieldNum(fields: ShelterField[], name: string): number | null {
  const v = getField(fields, name);
  if (v == null) return null;
  const s = String(v);
  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? null : n;
}

async function fetchWithRetry(url: string, retries = 5): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error(`Failed after ${retries} retries: ${url}`);
}

async function fetchListPage(page: number): Promise<PaginatedResponse> {
  const url = `${API_BASE}?per_page=${PER_PAGE}&page=${page}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`List API error ${res.status}`);
  return res.json();
}

async function fetchShelterDetail(idCai: number): Promise<ShelterDetail | null> {
  try {
    const url = `${API_BASE}/${idCai}`;
    const res = await fetchWithRetry(url);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/** Process items in parallel with concurrency limit */
async function parallelMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function importCaiHuts() {
  console.log("Importing CAI mountain huts from rifugi.cai.it...\n");

  // Step 1: Get all shelter IDs from list endpoint
  console.log("Step 1: Fetching shelter list...");
  const allBasic: ShelterBasic[] = [];
  let page = 1;
  let lastPage = 1;

  while (page <= lastPage) {
    const response = await fetchListPage(page);
    allBasic.push(...response.data);
    lastPage = response.last_page;
    console.log(`  Page ${page}/${lastPage}: ${response.data.length} shelters`);
    page++;
  }

  // Filter out deleted and unpublished
  const candidates = allBasic.filter((s) => !s.deleted_at && s.published);
  console.log(`\n  Total: ${allBasic.length}, candidates (published, not deleted): ${candidates.length}`);

  // Step 2: Fetch details in parallel
  console.log("\nStep 2: Fetching shelter details...");
  let fetchCount = 0;
  const details = await parallelMap(
    candidates,
    async (shelter) => {
      const detail = await fetchShelterDetail(shelter.id_cai);
      fetchCount++;
      if (fetchCount % 50 === 0) {
        console.log(`  Fetched ${fetchCount}/${candidates.length} details...`);
      }
      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 100));
      return detail;
    },
    CONCURRENCY
  );
  console.log(`  Fetched all ${fetchCount} shelter details`);

  // Step 3: Filter and insert
  console.log("\nStep 3: Importing into PostGIS...");
  let imported = 0;
  let skipped = 0;
  const skippedReasons: Record<string, number> = {};

  function skip(reason: string) {
    skipped++;
    skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
  }

  for (const detail of details) {
    if (!detail) {
      skip("fetch-failed");
      continue;
    }

    const fields = detail.fields || [];

    // Filter: active only
    const status = getField(fields, "status");
    if (!status || !status.toLowerCase().includes("attività")) {
      skip(`inactive:${status || "null"}`);
      continue;
    }

    // Must have coordinates
    if (!detail.geo?.coordinates || detail.geo.coordinates.length < 2) {
      skip("no-coordinates");
      continue;
    }

    const [lng, lat] = detail.geo.coordinates;
    if (lat == null || lng == null || (lat === 0 && lng === 0)) {
      skip("invalid-coordinates");
      continue;
    }

    // Must have a name
    const title = detail.title?.trim();
    if (!title) {
      skip("no-name");
      continue;
    }

    // Elevation: prefer fields, fall back to list-level altitude_geo
    let elevation = getFieldNum(fields, "altitude_geo");
    if (elevation == null && detail.altitude_geo != null) {
      elevation = detail.altitude_geo;
    }
    if (elevation == null) {
      skip("no-elevation");
      continue;
    }

    // Build destination ID
    const destId = `cai-hut-${detail.id_cai}`;
    const name = toTitleCase(title);
    const searchName = name.toLowerCase();

    const countryCode = "IT";
    const provinceGeo = getField(fields, "province_geo");
    const regionGeo = getField(fields, "region_geo");
    const stateCode = provinceGeo || regionGeo || null;

    // Hero image
    let heroImage: string | null = null;
    if (detail.media && detail.media.length > 0) {
      const img = detail.media.find((m: any) => m.collection_name === "images");
      if (img?.original_url) {
        heroImage = img.original_url.replace("http://", "https://");
      }
    }

    // CAI metadata stored in averages JSONB
    const metadata: Record<string, any> = { source: "cai" };
    const shelterType = getField(fields, "type");
    const category = getField(fields, "category");
    const locality = getField(fields, "locality_geo");
    const massif = getField(fields, "massif_geo");
    const municipality = getField(fields, "municipality_geo");
    const description = getField(fields, "description_geo") || getField(fields, "site_geo");
    const beds = getFieldNum(fields, "posti_totali_service");
    const winterBeds = getFieldNum(fields, "posti_letto_invernali_service");
    const alias = getField(fields, "alias");

    if (shelterType) metadata.shelter_type = shelterType;
    if (category) metadata.category = category;
    if (locality) metadata.locality = locality;
    if (massif) metadata.massif = massif;
    if (municipality) metadata.municipality = municipality;
    if (description) metadata.description = description;
    if (beds != null) metadata.beds = beds;
    if (winterBeds != null) metadata.winter_beds = winterBeds;
    if (alias) metadata.alias = alias;
    metadata.id_cai = detail.id_cai;

    try {
      await db.query(
        `INSERT INTO destinations (
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
          'point', '{outdoor-trek}', '{hut}',
          $8, $9,
          $10,
          $11, 'peaks',
          NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          search_name = EXCLUDED.search_name,
          elevation = EXCLUDED.elevation,
          location = EXCLUDED.location,
          country_code = EXCLUDED.country_code,
          state_code = EXCLUDED.state_code,
          hero_image = EXCLUDED.hero_image,
          metadata = EXCLUDED.metadata,
          features = EXCLUDED.features,
          updated_at = NOW()`,
        [destId, name, searchName, elevation, lng, lat, elevation,
         countryCode, stateCode, heroImage,
         JSON.stringify(metadata)]
      );
      imported++;
    } catch (err: any) {
      console.error(`  Error inserting ${destId}: ${err.message}`);
      skip("db-error");
    }
  }

  console.log(`\nCAI huts import complete:`);
  console.log(`  Imported: ${imported}`);
  console.log(`  Skipped:  ${skipped}`);
  if (Object.keys(skippedReasons).length > 0) {
    for (const [reason, count] of Object.entries(skippedReasons).sort((a, b) => b[1] - a[1])) {
      console.log(`    - ${reason}: ${count}`);
    }
  }
}

/** Convert ALL CAPS TITLE to Title Case, handling Italian prepositions */
function toTitleCase(str: string): string {
  const lowercase = new Set([
    "di", "del", "della", "delle", "dei", "degli", "da", "dal", "dalla",
    "in", "al", "alla", "alle", "agli", "e", "con", "su", "per", "tra", "fra",
    "a", "il", "la", "le", "lo", "gli", "i", "un", "una", "uno",
  ]);

  return str
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      if (i === 0) return capitalize(word);
      if (lowercase.has(word)) return word;
      return capitalize(word);
    })
    .join(" ");
}

function capitalize(word: string): string {
  if (word.length === 0) return word;
  const apos = word.indexOf("'");
  if (apos >= 0 && apos < word.length - 1) {
    return word.slice(0, apos + 1) + word[apos + 1].toUpperCase() + word.slice(apos + 2);
  }
  return word[0].toUpperCase() + word.slice(1);
}

// Allow running directly
if (process.argv[1]?.includes("import-cai-huts")) {
  importCaiHuts()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
