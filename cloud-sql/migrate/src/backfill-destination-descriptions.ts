/**
 * Backfill destinations.description + source credit (and, when the licence
 * allows, hero_image + attribution) from Wikipedia.
 *
 * Re-runnable and idempotent, and it makes progress every run: the candidate
 * query only selects rows still missing a description or a hero image, so
 * --limit N advances instead of re-reading the same filled rows. A row whose
 * description landed but whose image failed (a timeout, a 429) is recovered on
 * a later run — the article is resolved again, only the image columns move, and
 * the stored copy is written back unchanged.
 *
 * Matching is coordinate-anchored — Wikidata sitelink first, then a 1500 m
 * geosearch whose title must still pass namesMatch — because a wrong article is
 * worse than no article. A Wikidata sitelink is trusted only as far as its
 * article's own coordinates: a mis-keyed external id or a same-name article in
 * another state is rejected beyond MAX_WIKIDATA_MATCH_METERS.
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
 *   --dry-run          Print what would change; write nothing. Refuses to run
 *                      alongside --commit. DEFAULT-SAFE: writes are off unless
 *                      --commit is passed.
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

/**
 * How far a Wikidata-resolved article may sit from the catalog summit. The
 * geosearch path is anchored by construction; the sitelink path is not, so a
 * mis-keyed external_ids->>'wikidata' would otherwise hang a Colorado article
 * on a Washington peak. Generous enough for a range article whose coordinates
 * sit on a different summit, tight enough to catch a wrong state.
 */
export const MAX_WIKIDATA_MATCH_METERS = 5000;

export type CandidateRow = {
  id: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
  wikidata_id: string | null;
  /** Existing copy, carried through untouched on the image-only recovery path. */
  description: string | null;
  description_source_name: string | null;
  description_source_url: string | null;
  description_source_license: string | null;
  has_description: boolean;
  has_hero_image: boolean;
};

/** A REST summary plus the article's own coordinates, when it publishes them. */
export type ArticleSummary = WikipediaSummary & {
  coordinates: { lat: number; lon: number } | null;
};

/** Everything the per-row decision needs from Wikipedia, so tests can fake it. */
export type WikipediaClient = {
  titleFromWikidata(wikidataId: string): Promise<string | null>;
  titleFromGeosearch(name: string, lat: number, lng: number): Promise<string | null>;
  fetchSummary(title: string): Promise<ArticleSummary | null>;
  fetchImageCredit(fileTitle: string): Promise<WikipediaImageCredit | null>;
};

/** Read `coordinates: {lat, lon}` off a REST summary reply, or null. */
export function parseSummaryCoordinates(json: any): { lat: number; lon: number } | null {
  const lat = json?.coordinates?.lat;
  const lon = json?.coordinates?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/** Great-circle distance in metres. */
export function distanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const earthRadius = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

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
  | { kind: "miss"; reason: string; imageSkipReason?: string }
  | { kind: "write"; write: PlannedWrite; imageSkipReason?: string; note?: string };

/** Skip reasons, held in one place so the run summary can count them apart. */
export const SKIP_ALREADY_FILLED = "already has a description and a hero image";
export const SKIP_NO_NAME_OR_LOCATION = "no name or no location";
export const SKIP_CREDIT_INCOMPLETE = "description present without its full credit (use --force)";

/** Anything that can run a parameterised statement — pg.Pool, or a test double. */
export type Queryable = {
  query(text: string, values?: any[]): Promise<any>;
};

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** A flag was passed with a missing or unreadable value. Raised, not swallowed:
 *  a run that quietly falls back to the default writes the wrong rows. */
export class FlagUsageError extends Error {}

/**
 * Read `--name value`, refusing to treat the next flag as the value.
 *
 * `--limit --force` used to hand "--force" back as the limit, which parsed to
 * NaN, fell back to the default 100, and ate --force along the way — a run that
 * looked normal and did something else. Both halves of that now stop the run.
 */
export function stringFlagFrom(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (value === undefined) {
    throw new FlagUsageError(`--${name} needs a value, but the arguments end there.`);
  }
  if (value.startsWith("--")) {
    throw new FlagUsageError(`--${name} needs a value, but the next argument is the flag ${value}.`);
  }
  return value;
}

export function intFlagFrom(argv: readonly string[], name: string, fallback: number): number {
  const raw = stringFlagFrom(argv, name);
  if (raw === null) return fallback;
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new FlagUsageError(`--${name} needs a whole number, but was given "${raw}".`);
  }
  return Number.parseInt(trimmed, 10);
}

function stringFlag(name: string): string | null {
  return stringFlagFrom(process.argv, name);
}

function intFlag(name: string, fallback: number): number {
  return intFlagFrom(process.argv, name, fallback);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A failed fetch and a genuine miss both end as null, so both are announced:
 * a run that quietly turns into 200 rate-limited nulls must not read as 200
 * peaks Wikipedia has never heard of.
 */
async function getJson(url: string): Promise<any | null> {
  try {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) {
      console.warn(`  FETCH ${response.status} ${response.statusText} — ${url}`);
      return null;
    }
    return await response.json();
  } catch (err) {
    console.warn(`  FETCH failed (${(err as Error).message}) — ${url}`);
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

  async fetchSummary(title: string): Promise<ArticleSummary | null> {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      title.replace(/ /g, "_")
    )}`;
    const json = await getJson(url);
    await sleep(REQUEST_DELAY_MS);
    const summary = parseSummaryResponse(json);
    if (!summary) return null;
    return { ...summary, coordinates: parseSummaryCoordinates(json) };
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

/** The copy a previous run already stored, or null when any part is missing. */
function existingCopy(row: CandidateRow): {
  description: string;
  sourceName: string;
  sourceUrl: string;
  sourceLicense: string;
} | null {
  const description = row.description ?? "";
  const sourceName = row.description_source_name ?? "";
  const sourceUrl = row.description_source_url ?? "";
  const sourceLicense = row.description_source_license ?? "";
  if (
    description.trim().length === 0 ||
    sourceName.trim().length === 0 ||
    sourceUrl.trim().length === 0 ||
    sourceLicense.trim().length === 0
  ) {
    return null;
  }
  return { description, sourceName, sourceUrl, sourceLicense };
}

/**
 * Decide what, if anything, this destination should be given. No writes, no
 * logging — the caller reports and, in commit mode, applies the result.
 *
 * Three modes: a fresh row gets copy and, licence permitting, an image; a row
 * with copy but no image gets an image-only recovery that carries its stored
 * copy through unchanged; a row with both is left alone. --force collapses all
 * three into a full rewrite.
 */
export async function planRow(
  row: CandidateRow,
  client: WikipediaClient,
  options: { force: boolean; maxChars?: number }
): Promise<RowOutcome> {
  const maxChars = options.maxChars ?? DEFAULT_SUMMARY_MAX_CHARS;

  // Recovery mode: the copy is already stored, only the image is still owed.
  const imageOnly = row.has_description && !options.force;
  if (imageOnly && row.has_hero_image) {
    return { kind: "skip", reason: SKIP_ALREADY_FILLED };
  }
  const stored = imageOnly ? existingCopy(row) : null;
  if (imageOnly && !stored) {
    // Rewriting the description columns with half a credit is worse than
    // leaving the row as it stands; --force rebuilds it properly.
    return { kind: "skip", reason: SKIP_CREDIT_INCOMPLETE };
  }

  const name = row.name ?? "";
  if (name.length === 0 || row.lat === null || row.lng === null) {
    return { kind: "skip", reason: SKIP_NO_NAME_OR_LOCATION };
  }

  let title: string | null = null;
  let fromWikidata = false;
  if (row.wikidata_id) {
    title = await client.titleFromWikidata(row.wikidata_id);
    fromWikidata = title !== null;
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

  // A sitelink carries no coordinates of its own, so the article's do the
  // anchoring. namesMatch alone would accept "Crystal Peak" in the wrong state.
  let note: string | undefined;
  if (fromWikidata) {
    if (summary.coordinates) {
      const metres = distanceMeters(
        row.lat,
        row.lng,
        summary.coordinates.lat,
        summary.coordinates.lon
      );
      if (metres > MAX_WIKIDATA_MATCH_METERS) {
        return {
          kind: "miss",
          reason: `wikidata article too far (${(metres / 1000).toFixed(1)} km)`,
        };
      }
    } else {
      note = "coordinate check unavailable (article publishes no coordinates)";
    }
  }

  const copy = stored ?? buildPlaceCopy(summary, maxChars);
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

  // Recovery came for the image alone: with no image to store there is nothing
  // to write, and the row keeps the copy it already had.
  if (stored && !heroImage) {
    return {
      kind: "miss",
      reason: `image-only recovery found nothing to store (${
        imageSkipReason ?? "article has no lead image"
      })`,
      imageSkipReason,
    };
  }

  return {
    kind: "write",
    imageSkipReason,
    note,
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
  // The mirror case: attribution with no image would credit whatever picture an
  // earlier run left behind, because the hero columns COALESCE independently.
  if (!write.heroImage && (write.heroAttribution || write.heroAttributionUrl)) {
    throw new Error(`refusing to write hero attribution with no image for ${id}`);
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

const CANDIDATE_COLUMNS = `d.id, d.name,
              ST_Y(d.location::geometry) AS lat,
              ST_X(d.location::geometry) AS lng,
              d.external_ids->>'wikidata' AS wikidata_id,
              d.description,
              d.description_source_name,
              d.description_source_url,
              d.description_source_license,
              (d.description IS NOT NULL) AS has_description,
              (d.hero_image IS NOT NULL) AS has_hero_image`;

/**
 * The rows a run should consider. Without --force the prominence-ordered branch
 * takes only rows still owed something — otherwise every rerun re-reads the same
 * filled summits and --limit N never walks down the list. --ids and --force are
 * deliberate instructions, so neither is filtered.
 */
export function buildCandidateQuery(options: {
  ids?: string[] | null;
  force: boolean;
  minProminence: number;
  limit: number;
}): { text: string; values: any[] } {
  if (options.ids && options.ids.length > 0) {
    return {
      text: `SELECT ${CANDIDATE_COLUMNS}
         FROM destinations d
        WHERE d.id = ANY($1::text[])`,
      values: [options.ids],
    };
  }

  const unfinished = options.force
    ? ""
    : "\n        AND (d.description IS NULL OR d.hero_image IS NULL)";

  return {
    text: `SELECT ${CANDIDATE_COLUMNS}
       FROM destinations d
      WHERE 'summit' = ANY(d.features)
        AND d.name IS NOT NULL
        AND d.location IS NOT NULL
        AND COALESCE(d.prominence, 0) >= $1${unfinished}
      ORDER BY d.prominence DESC NULLS LAST, d.elevation DESC NULLS LAST
      LIMIT $2`,
    values: [options.minProminence, options.limit],
  };
}

async function loadCandidates(force: boolean): Promise<CandidateRow[]> {
  const ids = stringFlag("ids");
  const { text, values } = buildCandidateQuery({
    ids: ids ? ids.split(",").map((value) => value.trim()).filter(Boolean) : null,
    force,
    minProminence: intFlag("min-prominence", 300),
    limit: intFlag("limit", 100),
  });
  const result = await db.query<CandidateRow>(text, values);
  return result.rows;
}

async function main() {
  const dryRun = hasFlag("dry-run");
  const force = hasFlag("force");
  if (dryRun && hasFlag("commit")) {
    console.error("--dry-run and --commit contradict each other; pass one or neither.");
    process.exit(1);
  }
  const commit = hasFlag("commit") && !dryRun;
  if (dryRun) console.log("dry-run: writes disabled");
  console.log(
    `Wikipedia place-copy backfill — mode=${commit ? "COMMIT" : "DRY RUN"} force=${force}`
  );

  const rows = await loadCandidates(force);
  console.log(`${rows.length} candidate destination(s)`);

  let written = 0;
  let unmatched = 0;
  let images = 0;
  let imagesRefused = 0;
  const skips = new Map<string, number>();

  for (const row of rows) {
    const outcome = await planRow(row, wikimediaClient, { force });
    const name = row.name ?? "";

    if (outcome.kind === "skip") {
      skips.set(outcome.reason, (skips.get(outcome.reason) ?? 0) + 1);
      continue;
    }
    if (outcome.kind === "miss") {
      unmatched += 1;
      if (outcome.imageSkipReason) imagesRefused += 1;
      console.log(`  MISS  ${row.id} ${name} — ${outcome.reason}`);
      continue;
    }

    const { write } = outcome;
    if (write.heroImage) images += 1;
    if (outcome.imageSkipReason) {
      imagesRefused += 1;
      console.log(`  IMAGE SKIP ${row.id} ${name} — ${outcome.imageSkipReason}`);
    }
    if (outcome.note) {
      console.log(`  NOTE  ${row.id} ${name} — ${outcome.note}`);
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

  const skipped = [...skips.values()].reduce((total, count) => total + count, 0);
  console.log(
    `\nDone. written=${written} images=${images} imagesRefused=${imagesRefused} ` +
      `skipped=${skipped} unmatched=${unmatched}` +
      (commit ? "" : "  (DRY RUN — pass --commit to write)")
  );
  for (const [reason, count] of skips) {
    console.log(`  skipped ${count} — ${reason}`);
  }

  await db.end();
}

if (require.main === module) {
  main().catch((err) => {
    // A bad flag is the operator's typo, not a crash — say what is wrong and
    // stop, without a stack trace to read past.
    if (err instanceof FlagUsageError) {
      console.error(err.message);
    } else {
      console.error("Backfill failed:", err);
    }
    process.exit(1);
  });
}
