/**
 * Backfill destinations.description + source credit (and, when the licence
 * allows, hero_image + attribution) from Wikipedia.
 *
 * Re-runnable and idempotent: rows that already carry a description are skipped
 * unless --force is passed, so a partial run can simply be run again. Matching
 * is coordinate-anchored — Wikidata sitelink first, then a 1500 m geosearch
 * whose title must still pass namesMatch — because a wrong article is worse
 * than no article.
 *
 * Licensing: article prose is stored as CC BY-SA 4.0 with a link back to the
 * page. A lead image is only stored when Commons reports a free licence
 * (isFreeLicense); otherwise the hero columns are left untouched and the
 * refusal is logged and counted.
 *
 * Shape: the per-row decision (planRow) and the UPDATE (writeRow) are pure of
 * network and pool wiring so they can be unit-tested against fixtures; main()
 * is the only part that talks to Wikipedia and Cloud SQL.
 *
 * Usage:
 *   cloud-sql-proxy donner-a8608:us-central1:peaks-db --port 5432
 *
 *   cd cloud-sql/migrate
 *   DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=peaks DB_USER=peaks-api \
 *   DB_PASS=$(gcloud secrets versions access latest --secret=peaks-db-password \
 *     --project=donner-a8608) \
 *     npx tsx src/backfill-destination-descriptions.ts --dry-run --limit 20
 *
 * Flags:
 *   --dry-run          Print what would change; write nothing. DEFAULT-SAFE: on
 *                      unless --commit is passed.
 *   --commit           Actually write. Required for any UPDATE to run.
 *   --limit N          Cap the number of destinations considered (default 100).
 *   --ids a,b,c        Only these destination ids (bypasses the ordering).
 *   --force            Re-fetch rows that already have a description.
 *   --min-prominence N Only summits with prominence >= N metres (default 300).
 */

import db from "./db";
import {
  DEFAULT_SUMMARY_MAX_CHARS,
  buildImageAttribution,
  buildPlaceCopy,
  isFreeLicense,
  namesMatch,
  parseImageInfoResponse,
  parseSummaryResponse,
  type WikipediaImageCredit,
  type WikipediaSummary,
} from "./lib/wikipedia";

const USER_AGENT = "peaks-description-backfill (https://github.com/jhmacdon/peaks-firebase)";
const REQUEST_DELAY_MS = 350; // stay well inside Wikimedia's courtesy limits
const GEOSEARCH_RADIUS_M = 1500;

export type CandidateRow = {
  id: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
  wikidata_id: string | null;
  has_description: boolean;
  has_hero_image: boolean;
};

/** Everything the per-row decision needs from Wikipedia, so tests can fake it. */
export type WikipediaClient = {
  titleFromWikidata(wikidataId: string): Promise<string | null>;
  titleFromGeosearch(name: string, lat: number, lng: number): Promise<string | null>;
  fetchSummary(title: string): Promise<WikipediaSummary | null>;
  fetchImageCredit(fileTitle: string): Promise<WikipediaImageCredit | null>;
};

export type PlannedWrite = {
  matchedTitle: string;
  description: string;
  sourceName: string;
  sourceUrl: string;
  sourceLicense: string;
  heroImage: string | null;
  heroAttribution: string | null;
  heroAttributionUrl: string | null;
};

export type RowOutcome =
  | { kind: "skip"; reason: string }
  | { kind: "miss"; reason: string }
  | { kind: "write"; write: PlannedWrite; imageSkipReason?: string };

/** Anything that can run a parameterised statement — pg.Pool, or a test double. */
export type Queryable = {
  query(text: string, values?: any[]): Promise<any>;
};

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function stringFlag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function intFlag(name: string, fallback: number): number {
  const raw = stringFlag(name);
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url: string): Promise<any | null> {
  try {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** The live client: one Wikimedia call per method, each followed by a courtesy pause. */
export const wikimediaClient: WikipediaClient = {
  /** Wikidata Q-id → English Wikipedia article title. */
  async titleFromWikidata(wikidataId: string): Promise<string | null> {
    const url =
      "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks" +
      `&sitefilter=enwiki&ids=${encodeURIComponent(wikidataId)}`;
    const json = await getJson(url);
    await sleep(REQUEST_DELAY_MS);
    const title = json?.entities?.[wikidataId]?.sitelinks?.enwiki?.title;
    return typeof title === "string" && title.length > 0 ? title : null;
  },

  /** Nearest same-named article within GEOSEARCH_RADIUS_M, or null. */
  async titleFromGeosearch(name: string, lat: number, lng: number): Promise<string | null> {
    const url =
      "https://en.wikipedia.org/w/api.php?action=query&format=json&list=geosearch" +
      `&gscoord=${lat}%7C${lng}&gsradius=${GEOSEARCH_RADIUS_M}&gslimit=20`;
    const json = await getJson(url);
    await sleep(REQUEST_DELAY_MS);
    const hits = json?.query?.geosearch;
    if (!Array.isArray(hits)) return null;
    for (const hit of hits) {
      const title = typeof hit?.title === "string" ? hit.title : "";
      if (title.length > 0 && namesMatch(name, title)) return title;
    }
    return null;
  },

  async fetchSummary(title: string): Promise<WikipediaSummary | null> {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      title.replace(/ /g, "_")
    )}`;
    const json = await getJson(url);
    await sleep(REQUEST_DELAY_MS);
    return parseSummaryResponse(json);
  },

  async fetchImageCredit(fileTitle: string): Promise<WikipediaImageCredit | null> {
    const url =
      "https://en.wikipedia.org/w/api.php?action=query&format=json&prop=imageinfo" +
      `&iiprop=url%7Cextmetadata&titles=${encodeURIComponent(fileTitle)}`;
    const json = await getJson(url);
    await sleep(REQUEST_DELAY_MS);
    return parseImageInfoResponse(json);
  },
};

/**
 * Decide what, if anything, this destination should be given. No writes, no
 * logging — the caller reports and, in commit mode, applies the result.
 */
export async function planRow(
  row: CandidateRow,
  client: WikipediaClient,
  options: { force: boolean; maxChars?: number }
): Promise<RowOutcome> {
  const maxChars = options.maxChars ?? DEFAULT_SUMMARY_MAX_CHARS;

  if (row.has_description && !options.force) {
    return { kind: "skip", reason: "already has a description" };
  }
  const name = row.name ?? "";
  if (name.length === 0 || row.lat === null || row.lng === null) {
    return { kind: "skip", reason: "no name or no location" };
  }

  let title: string | null = null;
  if (row.wikidata_id) {
    title = await client.titleFromWikidata(row.wikidata_id);
  }
  if (!title) {
    title = await client.titleFromGeosearch(name, row.lat, row.lng);
  }
  if (!title) {
    return { kind: "miss", reason: "no confident article match" };
  }

  const summary = await client.fetchSummary(title);
  if (!summary || !namesMatch(name, summary.title)) {
    return { kind: "miss", reason: `summary rejected (title "${title}")` };
  }

  const copy = buildPlaceCopy(summary, maxChars);
  if (!copy) {
    return { kind: "miss", reason: "no creditable copy" };
  }

  let heroImage: string | null = null;
  let heroAttribution: string | null = null;
  let heroAttributionUrl: string | null = null;
  let imageSkipReason: string | undefined;

  if (summary.leadImageTitle && (!row.has_hero_image || options.force)) {
    const credit = await client.fetchImageCredit(summary.leadImageTitle);
    if (!credit) {
      imageSkipReason = `no readable credit for ${summary.leadImageTitle}`;
    } else if (!isFreeLicense(credit.licenseShortName)) {
      // parseImageInfoResponse deliberately does not judge licences, so this is
      // the only gate standing between a non-free photo and the database.
      imageSkipReason = `non-free licence "${credit.licenseShortName}"`;
    } else {
      heroImage = credit.imageUrl;
      heroAttribution = buildImageAttribution(credit);
      heroAttributionUrl = credit.descriptionUrl;
    }
  }

  return {
    kind: "write",
    imageSkipReason,
    write: {
      matchedTitle: summary.title,
      description: copy.description,
      sourceName: copy.sourceName,
      sourceUrl: copy.sourceUrl,
      sourceLicense: copy.sourceLicense,
      heroImage,
      heroAttribution,
      heroAttributionUrl,
    },
  };
}

/**
 * COALESCE on the hero columns keeps an image an earlier run stored when this
 * run found none; the description columns always move together, so a row can
 * never end up with copy and no credit.
 */
export const UPDATE_SQL = `UPDATE destinations
        SET description                = $2,
            description_source_name    = $3,
            description_source_url     = $4,
            description_source_license = $5,
            hero_image                 = COALESCE($6, hero_image),
            hero_image_attribution     = COALESCE($7, hero_image_attribution),
            hero_image_attribution_url = COALESCE($8, hero_image_attribution_url)
      WHERE id = $1`;

export async function writeRow(
  client: Queryable,
  id: string,
  write: PlannedWrite
): Promise<void> {
  // Last line of defence: nothing uncredited reaches the table, whatever the
  // caller believed it had assembled.
  if (
    write.description.trim().length === 0 ||
    write.sourceName.trim().length === 0 ||
    write.sourceUrl.trim().length === 0 ||
    write.sourceLicense.trim().length === 0
  ) {
    throw new Error(`refusing to write uncredited description for ${id}`);
  }
  if (write.heroImage && (!write.heroAttribution || !write.heroAttributionUrl)) {
    throw new Error(`refusing to write unattributed hero image for ${id}`);
  }

  await client.query(UPDATE_SQL, [
    id,
    write.description,
    write.sourceName,
    write.sourceUrl,
    write.sourceLicense,
    write.heroImage,
    write.heroAttribution,
    write.heroAttributionUrl,
  ]);
}

async function loadCandidates(): Promise<CandidateRow[]> {
  const ids = stringFlag("ids");
  if (ids) {
    const list = ids.split(",").map((value) => value.trim()).filter(Boolean);
    const result = await db.query<CandidateRow>(
      `SELECT d.id, d.name,
              ST_Y(d.location::geometry) AS lat,
              ST_X(d.location::geometry) AS lng,
              d.external_ids->>'wikidata' AS wikidata_id,
              (d.description IS NOT NULL) AS has_description,
              (d.hero_image IS NOT NULL) AS has_hero_image
         FROM destinations d
        WHERE d.id = ANY($1::text[])`,
      [list]
    );
    return result.rows;
  }

  const result = await db.query<CandidateRow>(
    `SELECT d.id, d.name,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            d.external_ids->>'wikidata' AS wikidata_id,
            (d.description IS NOT NULL) AS has_description,
            (d.hero_image IS NOT NULL) AS has_hero_image
       FROM destinations d
      WHERE 'summit' = ANY(d.features)
        AND d.name IS NOT NULL
        AND d.location IS NOT NULL
        AND COALESCE(d.prominence, 0) >= $1
      ORDER BY d.prominence DESC NULLS LAST, d.elevation DESC NULLS LAST
      LIMIT $2`,
    [intFlag("min-prominence", 300), intFlag("limit", 100)]
  );
  return result.rows;
}

async function main() {
  const commit = hasFlag("commit");
  const force = hasFlag("force");
  console.log(
    `Wikipedia place-copy backfill — mode=${commit ? "COMMIT" : "DRY RUN"} force=${force}`
  );

  const rows = await loadCandidates();
  console.log(`${rows.length} candidate destination(s)`);

  let written = 0;
  let skipped = 0;
  let unmatched = 0;
  let images = 0;
  let imagesRefused = 0;

  for (const row of rows) {
    const outcome = await planRow(row, wikimediaClient, { force });
    const name = row.name ?? "";

    if (outcome.kind === "skip") {
      skipped += 1;
      continue;
    }
    if (outcome.kind === "miss") {
      unmatched += 1;
      console.log(`  MISS  ${row.id} ${name} — ${outcome.reason}`);
      continue;
    }

    const { write } = outcome;
    if (write.heroImage) images += 1;
    if (outcome.imageSkipReason) {
      imagesRefused += 1;
      console.log(`  IMAGE SKIP ${row.id} ${name} — ${outcome.imageSkipReason}`);
    }

    console.log(
      `  WRITE ${row.id} ${name} ← ${write.matchedTitle}` +
        (write.heroImage ? ` (+image ${write.heroAttribution})` : "")
    );
    console.log(`        "${write.description}"`);

    if (commit) {
      await writeRow(db, row.id, write);
    }
    written += 1;
  }

  console.log(
    `\nDone. written=${written} images=${images} imagesRefused=${imagesRefused} ` +
      `skipped=${skipped} unmatched=${unmatched}` +
      (commit ? "" : "  (DRY RUN — pass --commit to write)")
  );

  await db.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
}
