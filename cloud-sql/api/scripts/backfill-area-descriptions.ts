/**
 * Fill protected-area descriptions from exact Wikipedia title matches, with a
 * plain catalog fallback for areas that do not have a matching page. Source
 * text stays linked and licensed in the stored attribution fields.
 *
 * Run through the Cloud SQL proxy:
 *   DB_HOST=127.0.0.1 DB_PORT=5433 DB_NAME=peaks DB_USER=peaks-api \
 *   DB_PASS=... npx tsx scripts/backfill-area-descriptions.ts --dry-run
 *
 * Flags:
 *   --dry-run  print a sample without writing
 *   --force    replace descriptions that already have text
 */

import db from "../src/db";
import {
  buildAreaDescription,
  selectSourceDescription,
} from "../src/area-description";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const BATCH_SIZE = 250;
const WIKIPEDIA_BATCH_SIZE = 40;
const WIKIPEDIA_REQUEST_DELAY_MS = 1100;
const WIKIPEDIA_MAX_ATTEMPTS = 6;
const WIKIPEDIA_LICENSE = "CC BY-SA 4.0";
const WIKIPEDIA_USER_AGENT = "PeaksAreaDescriptions/1.0 (https://github.com/jhmacdon/peaks-firebase)";

interface AreaRow {
  id: string;
  name: string;
  kind: string;
  manager: string | null;
  state_codes: string[];
  peak_names: string[];
}

interface SourceDescription {
  description: string;
  sourceName: string;
  sourceURL: string;
  sourceLicense: string;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWikipediaBatch(url: URL): Promise<any> {
  for (let attempt = 0; attempt < WIKIPEDIA_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      headers: { "Api-User-Agent": WIKIPEDIA_USER_AGENT },
    });
    if (response.ok) return response.json();

    const canRetry = response.status === 429 || response.status >= 500;
    if (!canRetry || attempt === WIKIPEDIA_MAX_ATTEMPTS - 1) {
      throw new Error(`Wikipedia returned HTTP ${response.status}`);
    }

    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : Math.min(30_000, 2 ** attempt * 2000);
    process.stdout.write(`\nWikipedia returned HTTP ${response.status}; retrying in ${delay / 1000}s.\n`);
    await pause(delay);
  }
  throw new Error("Wikipedia request stopped without a response");
}

async function fetchWikipediaDescriptions(names: string[]): Promise<Map<string, SourceDescription>> {
  const descriptions = new Map<string, SourceDescription>();
  const uniqueNames = [...new Set(names)];

  for (let index = 0; index < uniqueNames.length; index += WIKIPEDIA_BATCH_SIZE) {
    const batch = uniqueNames.slice(index, index + WIKIPEDIA_BATCH_SIZE);
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query",
      format: "json",
      prop: "extracts|info|pageprops",
      inprop: "url",
      ppprop: "disambiguation",
      exintro: "1",
      explaintext: "1",
      redirects: "1",
      titles: batch.join("|"),
    }).toString();

    const payload = await fetchWikipediaBatch(url);
    const normalized = new Map<string, string>(
      (payload.query?.normalized ?? []).map((entry: any) => [entry.from, entry.to])
    );
    const redirects = new Map<string, string>(
      (payload.query?.redirects ?? []).map((entry: any) => [entry.from, entry.to])
    );
    const pages = Object.values(payload.query?.pages ?? {}) as any[];
    const pagesByTitle = new Map(pages.map((page) => [page.title, page]));

    for (const name of batch) {
      let title = normalized.get(name) ?? name;
      const visited = new Set<string>();
      while (redirects.has(title) && !visited.has(title)) {
        visited.add(title);
        title = redirects.get(title)!;
      }
      const page = pagesByTitle.get(title);
      if (!page || page.missing !== undefined || page.pageprops?.disambiguation !== undefined) continue;
      const description = selectSourceDescription(page.extract ?? "");
      if (!description || typeof page.fullurl !== "string") continue;
      descriptions.set(name, {
        description,
        sourceName: "Wikipedia",
        sourceURL: page.fullurl,
        sourceLicense: WIKIPEDIA_LICENSE,
      });
    }

    process.stdout.write(
      `\rWikipedia: ${Math.min(index + WIKIPEDIA_BATCH_SIZE, uniqueNames.length)}/${uniqueNames.length}`
    );
    await pause(WIKIPEDIA_REQUEST_DELAY_MS);
  }
  process.stdout.write("\n");
  return descriptions;
}

async function main(): Promise<void> {
  const result = await db.query<AreaRow>(
    `SELECT a.id, a.name, a.kind::text AS kind, a.manager, a.state_codes,
            ARRAY(
              SELECT d.name
              FROM destination_areas da
              JOIN destinations d ON d.id = da.destination_id
              WHERE da.area_id = a.id AND d.name IS NOT NULL
              ORDER BY d.prominence DESC NULLS LAST,
                       d.elevation DESC NULLS LAST,
                       d.name
              LIMIT 3
            ) AS peak_names
     FROM areas a
     WHERE ($1::boolean OR NULLIF(BTRIM(a.description), '') IS NULL)
     ORDER BY a.name, a.id`,
    [FORCE]
  );

  const wikipediaDescriptions = await fetchWikipediaDescriptions(result.rows.map((area) => area.name));
  const rows = result.rows.map((area) => {
    const sourced = wikipediaDescriptions.get(area.name);
    return {
      id: area.id,
      description: sourced?.description ?? buildAreaDescription({
        name: area.name,
        kind: area.kind,
        manager: area.manager,
        stateCodes: area.state_codes,
        peakNames: area.peak_names,
      }),
      source_name: sourced?.sourceName ?? null,
      source_url: sourced?.sourceURL ?? null,
      source_license: sourced?.sourceLicense ?? null,
    };
  });

  console.log(
    `${rows.length} area descriptions ready; ${wikipediaDescriptions.size} use Wikipedia`
      + `${DRY_RUN ? " (dry run)" : ""}.`
  );
  for (const row of rows.slice(0, 20)) {
    console.log(`${row.id}\t${row.source_name ?? "catalog"}\t${row.description}`);
  }
  if (DRY_RUN) {
    await db.end();
    return;
  }

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    await db.query(
      `UPDATE areas a
       SET description = values.description,
           description_source_name = values.source_name,
           description_source_url = values.source_url,
           description_source_license = values.source_license,
           updated_at = now()
       FROM jsonb_to_recordset($1::jsonb) AS values(
         id text,
         description text,
         source_name text,
         source_url text,
         source_license text
       )
       WHERE a.id = values.id`,
      [JSON.stringify(batch)]
    );
    process.stdout.write(`\r${Math.min(index + BATCH_SIZE, rows.length)}/${rows.length} written`);
  }
  process.stdout.write("\n");
  await db.end();
}

main().catch((error) => {
  console.error("Area description backfill failed:", error);
  process.exit(1);
});
