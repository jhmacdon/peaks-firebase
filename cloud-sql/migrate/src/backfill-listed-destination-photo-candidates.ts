/**
 * Find review-first cover candidates for every Peaks-owned destination on a
 * Peaks-owned list that does not yet have a usable credited cover.
 *
 * This command never writes destinations.hero_image. It resolves a stable
 * Wikipedia/Wikidata identity, accepts only exact Wikimedia source and license
 * metadata, and inserts a new pending destination_photo_candidates row. A
 * source already present in that table stays final whether pending, approved,
 * or denied.
 *
 * Dry-run is the default:
 *   npm run backfill:listed-photo-candidates
 *   npm run backfill:listed-photo-candidates -- --limit=25
 *   npm run backfill:listed-photo-candidates -- --audit-output=/tmp/listed-photos.json
 *
 * Queue reviewed candidates only with an explicit write flag:
 *   npm run backfill:listed-photo-candidates -- --apply
 */

import fs from "node:fs/promises";
import path from "node:path";
import db from "./db";
import {
  LISTED_PHOTO_GEOSEARCH_RADIUS_METERS,
  canonicalWikimediaLicenseUrl,
  loadListedPhotoGaps,
  planListedPhotoCandidate,
  queueListedPhotoCandidate,
  type ListedPhotoCandidate,
  type ListedPhotoClient,
  type ListedPhotoGapRow,
  type ListedPhotoPlan,
  type WikimediaCoordinates,
  type WikimediaImageMetadata,
  type WikidataArticleIdentity,
  type WikipediaArticle,
  type WikipediaSearchHit,
} from "./listed-destination-photo-candidates";

const USER_AGENT = "peaks-listed-photo-backfill (https://github.com/jhmacdon/peaks-firebase)";
const REQUEST_DELAY_MS = 350;
const REQUEST_TIMEOUT_MS = 20_000;
const IMAGE_INFO_BATCH_SIZE = 5;
const REQUEST_ATTEMPTS = 3;

export class ListedPhotoFlagError extends Error {}

export type ListedPhotoArgs = {
  apply: boolean;
  limit: number | null;
  auditOutput: string | null;
};

export function parseListedPhotoArgs(argv: readonly string[]): ListedPhotoArgs {
  const knownBareFlags = new Set(["--apply", "--dry-run"]);
  const knownValuePrefixes = ["--limit=", "--audit-output="];
  for (const token of argv) {
    if (
      !knownBareFlags.has(token) &&
      !knownValuePrefixes.some((prefix) => token.startsWith(prefix))
    ) {
      throw new ListedPhotoFlagError(`Unknown argument: ${token}`);
    }
  }
  if (argv.includes("--apply") && argv.includes("--dry-run")) {
    throw new ListedPhotoFlagError("--apply and --dry-run contradict each other");
  }

  const limitArgs = argv.filter((token) => token.startsWith("--limit="));
  if (limitArgs.length > 1) throw new ListedPhotoFlagError("--limit may be passed only once");
  let limit: number | null = null;
  if (limitArgs.length === 1) {
    const raw = limitArgs[0].slice("--limit=".length);
    const parsed = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(parsed) || parsed < 1) {
      throw new ListedPhotoFlagError("--limit must be a positive whole number");
    }
    limit = parsed;
  }

  const auditArgs = argv.filter((token) => token.startsWith("--audit-output="));
  if (auditArgs.length > 1) {
    throw new ListedPhotoFlagError("--audit-output may be passed only once");
  }
  const auditOutput = auditArgs.length === 0
    ? null
    : auditArgs[0].slice("--audit-output=".length).trim();
  if (auditArgs.length === 1 && !auditOutput) {
    throw new ListedPhotoFlagError("--audit-output needs a non-empty path");
  }

  return {
    apply: argv.includes("--apply"),
    limit,
    auditOutput,
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class WikimediaRequestError extends Error {
  constructor(message: string, readonly url: string) {
    super(`${message}: ${url}`);
  }
}

async function requestJson(url: URL): Promise<unknown> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
      if (response.status !== 429 && response.status < 500) break;
      const retryAfter = Number(response.headers.get("retry-after"));
      const retryDelay = Number.isFinite(retryAfter)
        ? Math.min(30_000, Math.max(1_000, retryAfter * 1_000))
        : attempt * 1_000;
      await sleep(retryDelay);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      await sleep(REQUEST_DELAY_MS);
    }
  }
  throw new WikimediaRequestError(lastError?.message ?? "request failed", url.toString());
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pageRecords(json: unknown): Record<string, unknown>[] {
  const root = objectRecord(json);
  const query = objectRecord(root?.query);
  const pages = query?.pages;
  if (Array.isArray(pages)) {
    return pages.map(objectRecord).filter((page): page is Record<string, unknown> => page !== null);
  }
  const pageObject = objectRecord(pages);
  return pageObject
    ? Object.values(pageObject)
        .map(objectRecord)
        .filter((page): page is Record<string, unknown> => page !== null)
    : [];
}

function coordinates(value: unknown): WikimediaCoordinates | null {
  const record = objectRecord(value);
  const lat = number(record?.lat) ?? number(record?.latitude);
  const lng = number(record?.lon) ?? number(record?.longitude);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function parseWikidataArticleIdentity(
  json: unknown,
  wikidataId: string
): WikidataArticleIdentity | null {
  const root = objectRecord(json);
  const entities = objectRecord(root?.entities);
  const entity = objectRecord(entities?.[wikidataId]);
  if (!entity || entity.missing !== undefined) return null;
  const sitelinks = objectRecord(entity.sitelinks);
  const enwiki = objectRecord(sitelinks?.enwiki);
  const articleTitle = text(enwiki?.title);
  const claims = objectRecord(entity.claims);
  const positionClaims = claims?.P625;
  const firstClaim = Array.isArray(positionClaims) ? objectRecord(positionClaims[0]) : null;
  const mainsnak = objectRecord(firstClaim?.mainsnak);
  const dataValue = objectRecord(mainsnak?.datavalue);
  const point = coordinates(dataValue?.value);
  if (!articleTitle) return null;
  return { wikidataId, articleTitle, coordinates: point };
}

export function parseWikipediaSearchHits(json: unknown): WikipediaSearchHit[] {
  const root = objectRecord(json);
  const query = objectRecord(root?.query);
  const hits = objectRecord(query)?.geosearch;
  if (!Array.isArray(hits)) return [];
  return hits.flatMap((raw) => {
    const hit = objectRecord(raw);
    const title = text(hit?.title);
    const point = coordinates(hit);
    return title && point ? [{ title, coordinates: point }] : [];
  });
}

function normalizedFileTitle(value: string | null): string | null {
  if (!value) return null;
  return value.toLowerCase().startsWith("file:") ? value : `File:${value}`;
}

export function parseWikipediaArticle(json: unknown): WikipediaArticle | null {
  const page = pageRecords(json)[0];
  if (!page || page.missing !== undefined || Number(page.ns) !== 0) return null;
  const title = text(page.title);
  const pageProps = objectRecord(page.pageprops);
  if (pageProps?.disambiguation !== undefined) return null;
  const wikidataId = text(pageProps?.wikibase_item);
  const rawCoordinates = Array.isArray(page.coordinates) ? page.coordinates[0] : null;
  const articleCoordinates = coordinates(rawCoordinates);
  const leadImageTitle = normalizedFileTitle(text(page.pageimage));
  const images = Array.isArray(page.images) ? page.images : [];
  const imageTitles = images
    .map((raw) => text(objectRecord(raw)?.title))
    .filter((value): value is string => value !== null);
  if (!title) return null;
  return {
    title,
    wikidataId,
    coordinates: articleCoordinates,
    leadImageTitle,
    imageTitles,
  };
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return named[lower] ?? match;
  });
}

export function plainMetadataText(value: unknown): string | null {
  const raw = text(objectRecord(value)?.value ?? value);
  if (!raw) return null;
  const plain = decodeHtmlEntities(raw.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return plain || null;
}

function canonicalWikimediaImageUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "upload.wikimedia.org" ||
      url.username ||
      url.password
    ) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function parseWikimediaImageMetadata(json: unknown): WikimediaImageMetadata[] {
  return pageRecords(json).flatMap((page) => {
    const fileTitle = text(page.title);
    const infoRows = Array.isArray(page.imageinfo) ? page.imageinfo : [];
    const info = objectRecord(infoRows[0]);
    if (!fileTitle || !info) return [];
    const extmetadata = objectRecord(info.extmetadata);
    return [{
      fileTitle,
      imageUrl: canonicalWikimediaImageUrl(info.url),
      sourcePageUrl: text(info.descriptionurl),
      photographer: plainMetadataText(extmetadata?.Artist),
      licenseName: plainMetadataText(extmetadata?.LicenseShortName),
      licenseUrl: canonicalWikimediaLicenseUrl(plainMetadataText(extmetadata?.LicenseUrl)),
      width: number(info.width),
      height: number(info.height),
      mime: text(info.mime),
      mediaType: text(info.mediatype),
    }];
  });
}

function actionApiUrl(hostname: string, params: Record<string, string>): URL {
  const url = new URL(`https://${hostname}/w/api.php`);
  for (const [name, value] of Object.entries({
    action: "query",
    format: "json",
    formatversion: "2",
    ...params,
  })) {
    url.searchParams.set(name, value);
  }
  return url;
}

export const wikimediaListedPhotoClient: ListedPhotoClient = {
  async resolveWikidataArticle(wikidataId) {
    const url = actionApiUrl("www.wikidata.org", {
      action: "wbgetentities",
      ids: wikidataId,
      props: "claims|sitelinks",
      sitefilter: "enwiki",
    });
    return parseWikidataArticleIdentity(await requestJson(url), wikidataId);
  },

  async searchWikipediaArticles(name, lat, lng) {
    const url = actionApiUrl("en.wikipedia.org", {
      list: "geosearch",
      gscoord: `${lat}|${lng}`,
      gsradius: String(LISTED_PHOTO_GEOSEARCH_RADIUS_METERS),
      gslimit: "20",
      gsnamespace: "0",
    });
    return parseWikipediaSearchHits(await requestJson(url));
  },

  async fetchWikipediaArticle(title) {
    const url = actionApiUrl("en.wikipedia.org", {
      redirects: "1",
      prop: "coordinates|pageprops|pageimages|images",
      piprop: "name",
      imlimit: "max",
      titles: title,
    });
    return parseWikipediaArticle(await requestJson(url));
  },

  async fetchImageMetadata(fileTitles) {
    const records: WikimediaImageMetadata[] = [];
    for (let index = 0; index < fileTitles.length; index += IMAGE_INFO_BATCH_SIZE) {
      const batch = fileTitles.slice(index, index + IMAGE_INFO_BATCH_SIZE);
      const url = actionApiUrl("en.wikipedia.org", {
        prop: "imageinfo",
        iiprop: "url|size|mime|mediatype|extmetadata",
        iiextmetadatalanguage: "en",
        iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl",
        titles: batch.join("|"),
      });
      records.push(...parseWikimediaImageMetadata(await requestJson(url)));
    }
    return records;
  },
};

type AuditDetail = {
  destinationId: string;
  destinationName: string | null;
  listIds: string[];
  listNames: string[];
  outcome: string;
  reason?: string;
  candidate?: Omit<ListedPhotoCandidate, "notes"> & { notes?: string };
  rejectedImages?: string[];
  queueResult?: string;
};

export type ListedPhotoAudit = {
  generatedAt: string;
  mode: "dry-run" | "apply";
  scope: "all Peaks-owned list members without a usable credited cover";
  fixedMonthlyCostUsd: 0;
  totals: {
    coverGaps: number;
    inspected: number;
    deferredByLimit: number;
    pendingReview: number;
    candidatesFound: number;
    queued: number;
    misses: number;
    requestErrors: number;
  };
  outcomes: Record<string, number>;
  details: AuditDetail[];
};

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function auditDetail(
  row: ListedPhotoGapRow,
  plan: ListedPhotoPlan
): AuditDetail {
  if (plan.kind === "candidate") {
    const { notes, ...candidate } = plan.candidate;
    return {
      destinationId: row.id,
      destinationName: row.name,
      listIds: row.list_ids,
      listNames: row.list_names,
      outcome: "candidate",
      candidate: { ...candidate, ...(notes ? { notes } : {}) },
      rejectedImages: plan.rejectedImages,
    };
  }
  return {
    destinationId: row.id,
    destinationName: row.name,
    listIds: row.list_ids,
    listNames: row.list_names,
    outcome: plan.code,
    reason: plan.reason,
    rejectedImages: plan.rejectedImages,
  };
}

export async function buildListedPhotoAudit(
  rows: ListedPhotoGapRow[],
  args: ListedPhotoArgs,
  client: ListedPhotoClient = wikimediaListedPhotoClient
): Promise<{ audit: ListedPhotoAudit; candidates: ListedPhotoCandidate[] }> {
  const details: AuditDetail[] = [];
  const candidates: ListedPhotoCandidate[] = [];
  const outcomes = new Map<string, number>();
  let inspected = 0;
  let requestErrors = 0;

  for (const row of rows) {
    if (row.has_pending_candidate) {
      const plan = await planListedPhotoCandidate(row, client);
      details.push(auditDetail(row, plan));
      increment(outcomes, "pending_review");
      continue;
    }
    if (args.limit !== null && inspected >= args.limit) {
      details.push({
        destinationId: row.id,
        destinationName: row.name,
        listIds: row.list_ids,
        listNames: row.list_names,
        outcome: "deferred_by_limit",
        reason: `not inspected because --limit=${args.limit}`,
      });
      increment(outcomes, "deferred_by_limit");
      continue;
    }

    inspected += 1;
    try {
      const plan = await planListedPhotoCandidate(row, client);
      details.push(auditDetail(row, plan));
      if (plan.kind === "candidate") {
        candidates.push(plan.candidate);
        increment(outcomes, "candidate");
      } else {
        increment(outcomes, plan.code);
      }
    } catch (error) {
      requestErrors += 1;
      const reason = error instanceof Error ? error.message : String(error);
      details.push({
        destinationId: row.id,
        destinationName: row.name,
        listIds: row.list_ids,
        listNames: row.list_names,
        outcome: "request_error",
        reason,
      });
      increment(outcomes, "request_error");
    }
  }

  const pendingReview = outcomes.get("pending_review") ?? 0;
  const deferredByLimit = outcomes.get("deferred_by_limit") ?? 0;
  const misses = details.length - pendingReview - deferredByLimit - candidates.length - requestErrors;
  const audit: ListedPhotoAudit = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? "apply" : "dry-run",
    scope: "all Peaks-owned list members without a usable credited cover",
    fixedMonthlyCostUsd: 0,
    totals: {
      coverGaps: rows.length,
      inspected,
      deferredByLimit,
      pendingReview,
      candidatesFound: candidates.length,
      queued: 0,
      misses,
      requestErrors,
    },
    outcomes: Object.fromEntries([...outcomes.entries()].sort(([a], [b]) => a.localeCompare(b))),
    details,
  };
  return { audit, candidates };
}

async function applyCandidates(
  audit: ListedPhotoAudit,
  candidates: ListedPhotoCandidate[]
): Promise<void> {
  if (audit.totals.requestErrors > 0) {
    throw new Error("refusing --apply because one or more Wikimedia requests failed");
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('listed-destination-photo-candidate-backfill'))"
    );
    for (const candidate of candidates) {
      const result = await queueListedPhotoCandidate(client, candidate);
      const detail = audit.details.find(
        (row) => row.destinationId === candidate.destinationId && row.outcome === "candidate"
      );
      if (detail) detail.queueResult = result;
      if (result === "inserted") audit.totals.queued += 1;
      audit.outcomes[`queue_${result}`] = (audit.outcomes[`queue_${result}`] ?? 0) + 1;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function writeAuditOutput(outputPath: string, audit: ListedPhotoAudit): Promise<void> {
  const absolutePath = path.resolve(process.cwd(), outputPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  console.log(`Audit written to ${absolutePath}`);
}

async function run(args: ListedPhotoArgs): Promise<ListedPhotoAudit> {
  console.log(
    `Listed destination photo candidates — ${args.apply ? "APPLY" : "DRY RUN"}; ` +
      "scope=all Peaks-owned list members missing a usable credited cover"
  );
  const rows = await loadListedPhotoGaps(db);
  const { audit, candidates } = await buildListedPhotoAudit(rows, args);
  const unsafeApply = args.apply && audit.totals.requestErrors > 0;
  if (args.apply && !unsafeApply) await applyCandidates(audit, candidates);
  if (args.auditOutput) await writeAuditOutput(args.auditOutput, audit);
  console.log(JSON.stringify(audit, null, 2));
  if (unsafeApply) {
    throw new Error("refusing --apply because one or more Wikimedia requests failed");
  }
  return audit;
}

if (require.main === module) {
  let args: ListedPhotoArgs;
  try {
    args = parseListedPhotoArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }

  run(args)
    .then((audit) => {
      if (audit.totals.requestErrors > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error("Listed destination photo backfill failed:", error);
      process.exitCode = 1;
    })
    .finally(() => db.end());
}
