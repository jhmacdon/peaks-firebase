import {
  deterministicPhotoCandidateId,
  type DestinationPhotoManifestCandidate,
} from "./destination-photo-candidates";
import { isFreeLicense, namesMatch } from "./lib/wikipedia";

export const LISTED_PHOTO_MIN_WIDTH = 1_600;
export const LISTED_PHOTO_MIN_HEIGHT = 900;
export const LISTED_PHOTO_GEOSEARCH_RADIUS_METERS = 1_500;
export const LISTED_PHOTO_WIKIDATA_RADIUS_METERS = 5_000;
export const LISTED_PHOTO_MAX_ARTICLE_IMAGES = 24;

export type Queryable = {
  query(text: string, values?: unknown[]): Promise<{
    rows: Record<string, unknown>[];
    rowCount?: number | null;
  }>;
};

export type ListedPhotoGapRow = {
  id: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
  wikidata_id: string | null;
  list_ids: string[];
  list_names: string[];
  existing_source_page_urls: string[];
  existing_source_page_urls_without_sha: string[];
  existing_media_sha1s: string[];
  has_pending_candidate: boolean;
};

export type WikimediaCoordinates = {
  lat: number;
  lng: number;
};

export type WikidataArticleIdentity = {
  wikidataId: string;
  articleTitle: string;
  coordinates: WikimediaCoordinates | null;
};

export type WikipediaSearchHit = {
  title: string;
  coordinates: WikimediaCoordinates;
};

export type WikipediaArticle = {
  title: string;
  wikidataId: string | null;
  coordinates: WikimediaCoordinates | null;
  leadImageTitle: string | null;
  imageTitles: string[];
};

export type WikimediaImageMetadata = {
  fileTitle: string;
  fileTitleAliases: string[];
  imageUrl: string | null;
  sourcePageUrl: string | null;
  photographer: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
  width: number | null;
  height: number | null;
  mime: string | null;
  mediaType: string | null;
  mediaSha1: string | null;
};

export type ListedPhotoClient = {
  resolveWikidataArticle(wikidataId: string): Promise<WikidataArticleIdentity | null>;
  searchWikipediaArticles(
    name: string,
    lat: number,
    lng: number
  ): Promise<WikipediaSearchHit[]>;
  fetchWikipediaArticle(title: string): Promise<WikipediaArticle | null>;
  fetchImageMetadata(fileTitles: string[]): Promise<WikimediaImageMetadata[]>;
};

export type ListedPhotoCandidate = DestinationPhotoManifestCandidate & {
  id: string;
  matchedArticleTitle: string;
  matchedWikidataId: string;
  catalogWikidataId: string | null;
  catalogLat: number;
  catalogLng: number;
  mediaSha1: string;
  reviewHistoryFingerprint: string;
};

export type ListedPhotoPlan =
  | {
      kind: "candidate";
      candidate: ListedPhotoCandidate;
      rejectedImages: string[];
    }
  | {
      kind: "skip" | "miss";
      code: string;
      reason: string;
      rejectedImages?: string[];
    };

export const LISTED_PHOTO_GAPS_SQL = `WITH listed AS (
  SELECT d.id,
         d.name,
         ST_Y(d.location::geometry) AS lat,
         ST_X(d.location::geometry) AS lng,
         d.external_ids->>'wikidata' AS wikidata_id,
         array_agg(DISTINCT l.id ORDER BY l.id) AS list_ids,
         array_agg(DISTINCT l.name ORDER BY l.name) AS list_names
    FROM destinations d
    JOIN list_destinations ld ON ld.destination_id = d.id
    JOIN lists l ON l.id = ld.list_id AND l.owner = 'peaks'
   WHERE d.owner = 'peaks'
     AND (
       NULLIF(btrim(d.hero_image), '') IS NULL
       OR NULLIF(btrim(d.hero_image_attribution), '') IS NULL
       OR NULLIF(btrim(d.hero_image_attribution_url), '') IS NULL
     )
   GROUP BY d.id
), history AS (
  SELECT destination_id,
         array_agg(source_page_url ORDER BY created_at, id) AS existing_source_page_urls,
         array_agg(source_page_url ORDER BY created_at, id)
           FILTER (WHERE media_sha1 IS NULL) AS existing_source_page_urls_without_sha,
         array_agg(media_sha1 ORDER BY created_at, id)
           FILTER (WHERE media_sha1 IS NOT NULL) AS existing_media_sha1s,
         bool_or(status = 'pending') AS has_pending_candidate
    FROM destination_photo_candidates
   GROUP BY destination_id
)
SELECT listed.id,
       listed.name,
       listed.lat,
       listed.lng,
       listed.wikidata_id,
       listed.list_ids,
       listed.list_names,
       COALESCE(history.existing_source_page_urls, ARRAY[]::text[]) AS existing_source_page_urls,
       COALESCE(history.existing_source_page_urls_without_sha, ARRAY[]::text[])
         AS existing_source_page_urls_without_sha,
       COALESCE(history.existing_media_sha1s, ARRAY[]::text[]) AS existing_media_sha1s,
       COALESCE(history.has_pending_candidate, false) AS has_pending_candidate
  FROM listed
  LEFT JOIN history ON history.destination_id = listed.id
 ORDER BY listed.name ASC NULLS LAST, listed.id ASC`;

const USABLE_COVER_SQL = `NULLIF(btrim(d.hero_image), '') IS NOT NULL
  AND NULLIF(btrim(d.hero_image_attribution), '') IS NOT NULL
  AND NULLIF(btrim(d.hero_image_attribution_url), '') IS NOT NULL`;

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => nullableText(item))
    .filter((item): item is string => item !== null);
}

export function serializeListedPhotoGapRow(row: Record<string, unknown>): ListedPhotoGapRow {
  return {
    id: nullableText(row.id) ?? "",
    name: nullableText(row.name),
    lat: nullableNumber(row.lat),
    lng: nullableNumber(row.lng),
    wikidata_id: nullableText(row.wikidata_id),
    list_ids: stringArray(row.list_ids),
    list_names: stringArray(row.list_names),
    existing_source_page_urls: stringArray(row.existing_source_page_urls),
    existing_source_page_urls_without_sha: stringArray(
      row.existing_source_page_urls_without_sha
    ),
    existing_media_sha1s: stringArray(row.existing_media_sha1s),
    has_pending_candidate: row.has_pending_candidate === true,
  };
}

export async function loadListedPhotoGaps(db: Queryable): Promise<ListedPhotoGapRow[]> {
  const result = await db.query(LISTED_PHOTO_GAPS_SQL);
  return result.rows.map(serializeListedPhotoGapRow);
}

export function distanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const earthRadius = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(bLat - aLat);
  const deltaLng = toRadians(bLng - aLng);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(aLat)) *
      Math.cos(toRadians(bLat)) *
      Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function normalizedWords(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^file:/, "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/\bmt\.?\b/g, "mount")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function fileTitleNamesDestination(destinationName: string, fileTitle: string): boolean {
  const file = ` ${normalizedWords(fileTitle)} `;
  const fullName = normalizedWords(destinationName);
  if (!fullName) return false;
  if (file.includes(` ${fullName} `)) return true;

  const shortName = fullName
    .split(" ")
    .filter((word) => !["mount", "mountain", "peak", "summit"].includes(word))
    .join(" ");
  return shortName.length >= 4 && file.includes(` ${shortName} `);
}

const PHOTO_FILE_EXTENSION = /\.(?:jpe?g|png|webp|tiff?)$/i;
const NON_PHOTO_FILE_WORDS =
  /\b(?:locator|location map|map blank|route map|topographic map|topo map|flag|logo|icon|symbol|coat of arms|wikidata|commons logo)\b/i;

export function rankedArticlePhotoTitles(
  article: WikipediaArticle,
  destinationName: string,
  maxImages = LISTED_PHOTO_MAX_ARTICLE_IMAGES
): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();
  const add = (title: string | null, lead: boolean) => {
    if (!title || !PHOTO_FILE_EXTENSION.test(title) || NON_PHOTO_FILE_WORDS.test(title)) return;
    if (!lead && !fileTitleNamesDestination(destinationName, title)) return;
    const key = normalizedWords(title);
    if (!key || seen.has(key) || titles.length >= maxImages) return;
    seen.add(key);
    titles.push(title);
  };

  add(article.leadImageTitle, true);
  for (const title of article.imageTitles) add(title, false);
  return titles;
}

function canonicalHttpsUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function sourcePageKey(value: string): string | null {
  const url = canonicalHttpsUrl(value);
  if (!url) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = url.pathname;
  }
  const hostname = url.hostname.toLowerCase();
  const fileMatch = pathname.match(/^\/wiki\/(File:.+)$/i);
  if (
    fileMatch &&
    (hostname === "commons.wikimedia.org" || hostname === "en.wikipedia.org")
  ) {
    return `wikimedia:${fileMatch[1].replace(/_/g, " ").trim().toLowerCase()}`;
  }
  return `${hostname}${pathname.replace(/_/g, " ").toLowerCase()}`;
}

export function fileTitleFromWikimediaSourcePage(value: string): string | null {
  const url = canonicalHttpsUrl(value);
  if (!url) return null;
  const hostname = url.hostname.toLowerCase();
  if (hostname !== "commons.wikimedia.org" && hostname !== "en.wikipedia.org") return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const match = pathname.match(/^\/wiki\/(File:.+)$/i);
  return match ? match[1].replace(/_/g, " ").trim() : null;
}

function isAllowedWikimediaImageUrl(value: string | null): value is string {
  const url = canonicalHttpsUrl(value);
  return url?.hostname.toLowerCase() === "upload.wikimedia.org";
}

function sourceKind(value: string | null): "wikimedia_commons" | "wikipedia" | null {
  const url = canonicalHttpsUrl(value);
  if (!url) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (!/^\/wiki\/File:/i.test(pathname)) return null;
  const hostname = url.hostname.toLowerCase();
  if (hostname === "commons.wikimedia.org") return "wikimedia_commons";
  if (hostname === "en.wikipedia.org") return "wikipedia";
  return null;
}

function normalizedLicenseName(value: string): string {
  return value
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Commons sometimes returns an http Creative Commons deed URL with a locale
 * suffix. The review table requires HTTPS. Keep the exact license family and
 * version from Commons, but store its stable canonical HTTPS license page.
 */
export function canonicalWikimediaLicenseUrl(value: string | null): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hostname.toLowerCase().replace(/^www\./, "") !== "creativecommons.org"
  ) {
    return null;
  }

  const match = url.pathname.toLowerCase().match(
    /^\/(licenses\/(?:by|by-sa)\/\d+(?:\.\d+)*|publicdomain\/(?:zero|mark)\/\d+(?:\.\d+)*)(?:\/deed(?:\.[a-z-]+)?)?\/?$/
  );
  return match ? `https://creativecommons.org/${match[1]}/` : null;
}

export function hasCompatibleLicenseRecord(
  licenseName: string | null,
  licenseUrl: string | null
): boolean {
  if (!licenseName || !isFreeLicense(licenseName)) return false;
  const canonical = canonicalWikimediaLicenseUrl(licenseUrl);
  const url = canonical ? new URL(canonical) : null;
  if (!url) return false;

  const path = url.pathname.toLowerCase().replace(/\/+$/, "");
  const name = normalizedLicenseName(licenseName);
  const pathParts = path.match(
    /^\/(licenses\/(by-sa|by)|publicdomain\/(zero|mark))\/(\d+(?:\.\d+)*)$/
  );
  if (!pathParts) return false;
  const family = pathParts[2] ?? pathParts[3];
  const urlVersion = pathParts[4];
  const nameVersion = name.match(/\b(\d+(?:\.\d+)*)\b/)?.[1] ?? null;

  if (family === "by-sa") {
    return /\bcc(?: |-)?by(?: |-)?sa\b/.test(name) && nameVersion === urlVersion;
  }
  if (family === "by") {
    return (
      /\bcc(?: |-)?by\b/.test(name) &&
      !/\bsa\b/.test(name) &&
      nameVersion === urlVersion
    );
  }
  if (family === "zero") {
    return (
      /\bcc0\b|creative commons zero/.test(name) &&
      (nameVersion === urlVersion || (nameVersion === null && urlVersion === "1.0"))
    );
  }
  if (family === "mark") {
    return (
      /public domain|\bpd\b/.test(name) &&
      (nameVersion === urlVersion || (nameVersion === null && urlVersion === "1.0"))
    );
  }
  return false;
}

function exactPhotographer(value: string | null): value is string {
  if (!value?.trim()) return false;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return !(
    /\b(?:unknown|anonymous|unidentified|unspecified|various)\b/.test(normalized) ||
    /\bnot (?:known|stated|provided|available|identified|specified|supplied|named|given)\b/.test(normalized) ||
    /\b(?:author|artist|photographer) (?:not known|not stated|not named|unknown)\b/.test(normalized) ||
    /\bno (?:named |identified |specified )?(?:author|artist|photographer)\b/.test(normalized) ||
    /\bno (?:author|artist|photographer) (?:named|identified|specified|provided)\b/.test(normalized) ||
    /\bno\b.*\b(?:author|artist|photographer)\b.*\b(?:provided|named|identified|specified|available)\b/.test(normalized) ||
    /\bnot applicable\b/.test(normalized) ||
    /\bsee (?:the )?(?:source|file|original)\b/.test(normalized) ||
    /\bsee above\b/.test(normalized) ||
    /\bmultiple (?:authors|artists|photographers)\b/.test(normalized) ||
    /^(?:n\/?a|none|own work|uploader|the uploader|original uploader|self|self made|uncredited|no data available|original source|wikimedia commons)$/i.test(normalized)
  );
}

export function normalizedWikimediaSha1(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{40}$/.test(normalized) ? normalized : null;
}

export function listedPhotoReviewHistoryFingerprint(
  sourcePageUrls: string[],
  mediaSha1s: string[]
): string {
  const sourcePageKeys = [...new Set(
    sourcePageUrls
      .map(sourcePageKey)
      .filter((key): key is string => key !== null)
  )].sort();
  const normalizedMediaSha1s = [...new Set(
    mediaSha1s
      .map(normalizedWikimediaSha1)
      .filter((sha1): sha1 is string => sha1 !== null)
  )].sort();
  return JSON.stringify({
    reviewCount: sourcePageUrls.length,
    sourcePageKeys,
    mediaSha1s: normalizedMediaSha1s,
  });
}

export function imageMetadataRejection(
  image: WikimediaImageMetadata
): string | null {
  if (!isAllowedWikimediaImageUrl(image.imageUrl)) return "image URL is not on upload.wikimedia.org";
  if (!sourceKind(image.sourcePageUrl)) return "source page is not an exact Commons/Wikipedia File page";
  if (image.mediaType?.toUpperCase() !== "BITMAP") return "source is not a bitmap photo";
  if (!image.mime || !["image/jpeg", "image/png", "image/webp"].includes(image.mime.toLowerCase())) {
    return `unsupported image MIME type ${image.mime ?? "missing"}`;
  }
  if (!exactPhotographer(image.photographer)) return "photographer metadata is missing or generic";
  if (!normalizedWikimediaSha1(image.mediaSha1)) {
    return "durable Wikimedia SHA-1 metadata is missing or invalid";
  }
  if (!hasCompatibleLicenseRecord(image.licenseName, image.licenseUrl)) {
    return "license name and URL do not form an approved CC/PD record";
  }
  if (
    image.width === null ||
    image.height === null ||
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < LISTED_PHOTO_MIN_WIDTH ||
    image.height < LISTED_PHOTO_MIN_HEIGHT
  ) {
    return `image is smaller than ${LISTED_PHOTO_MIN_WIDTH}x${LISTED_PHOTO_MIN_HEIGHT}`;
  }
  return null;
}

type StableArticleOutcome =
  | { kind: "article"; article: WikipediaArticle }
  | { kind: "miss"; code: string; reason: string };

async function resolveStableArticle(
  row: ListedPhotoGapRow,
  client: ListedPhotoClient
): Promise<StableArticleOutcome> {
  const name = row.name?.trim();
  if (!name || row.lat === null || row.lng === null) {
    return {
      kind: "miss",
      code: "catalog_identity_incomplete",
      reason: "destination needs a name and coordinates",
    };
  }

  if (row.wikidata_id) {
    if (!/^Q\d+$/.test(row.wikidata_id)) {
      return {
        kind: "miss",
        code: "wikidata_id_invalid",
        reason: `stored Wikidata id ${row.wikidata_id} is not valid`,
      };
    }
    const identity = await client.resolveWikidataArticle(row.wikidata_id);
    if (!identity || identity.wikidataId !== row.wikidata_id || !identity.coordinates) {
      return {
        kind: "miss",
        code: "wikidata_identity_incomplete",
        reason: "stored Wikidata item needs an English article and coordinates",
      };
    }
    const identityDistance = distanceMeters(
      row.lat,
      row.lng,
      identity.coordinates.lat,
      identity.coordinates.lng
    );
    if (identityDistance > LISTED_PHOTO_WIKIDATA_RADIUS_METERS) {
      return {
        kind: "miss",
        code: "wikidata_identity_too_far",
        reason: `stored Wikidata item is ${(identityDistance / 1_000).toFixed(1)} km away`,
      };
    }
    const article = await client.fetchWikipediaArticle(identity.articleTitle);
    if (
      !article ||
      article.wikidataId !== row.wikidata_id ||
      !namesMatch(name, article.title) ||
      !article.coordinates
    ) {
      return {
        kind: "miss",
        code: "wikipedia_identity_mismatch",
        reason: "English article does not confirm the stored Wikidata identity, name, and coordinates",
      };
    }
    const articleDistance = distanceMeters(
      row.lat,
      row.lng,
      article.coordinates.lat,
      article.coordinates.lng
    );
    if (articleDistance > LISTED_PHOTO_WIKIDATA_RADIUS_METERS) {
      return {
        kind: "miss",
        code: "wikipedia_identity_too_far",
        reason: `English article is ${(articleDistance / 1_000).toFixed(1)} km away`,
      };
    }
    return { kind: "article", article };
  }

  const hits = (await client.searchWikipediaArticles(name, row.lat, row.lng)).filter(
    (hit) =>
      namesMatch(name, hit.title) &&
      distanceMeters(row.lat!, row.lng!, hit.coordinates.lat, hit.coordinates.lng) <=
        LISTED_PHOTO_GEOSEARCH_RADIUS_METERS
  );
  const uniqueTitles = [...new Map(hits.map((hit) => [hit.title, hit])).values()];
  if (uniqueTitles.length !== 1) {
    return {
      kind: "miss",
      code: uniqueTitles.length === 0 ? "no_exact_article" : "ambiguous_article",
      reason:
        uniqueTitles.length === 0
          ? "no exact nearby English Wikipedia article"
          : `${uniqueTitles.length} exact nearby English Wikipedia articles`,
    };
  }

  const article = await client.fetchWikipediaArticle(uniqueTitles[0].title);
  if (
    !article ||
    !/^Q\d+$/.test(article.wikidataId ?? "") ||
    !namesMatch(name, article.title) ||
    !article.coordinates
  ) {
    return {
      kind: "miss",
      code: "wikipedia_identity_incomplete",
      reason: "nearby article needs a stable Wikidata id, exact name, and coordinates",
    };
  }
  const articleDistance = distanceMeters(
    row.lat,
    row.lng,
    article.coordinates.lat,
    article.coordinates.lng
  );
  if (articleDistance > LISTED_PHOTO_GEOSEARCH_RADIUS_METERS) {
    return {
      kind: "miss",
      code: "wikipedia_identity_too_far",
      reason: `nearby article is ${(articleDistance / 1_000).toFixed(1)} km away`,
    };
  }
  return { kind: "article", article };
}

export async function planListedPhotoCandidate(
  row: ListedPhotoGapRow,
  client: ListedPhotoClient
): Promise<ListedPhotoPlan> {
  if (row.has_pending_candidate) {
    return {
      kind: "skip",
      code: "pending_review",
      reason: "destination already has a pending photo candidate",
    };
  }

  const stable = await resolveStableArticle(row, client);
  if (stable.kind === "miss") return stable;
  const article = stable.article;
  const fileTitles = rankedArticlePhotoTitles(article, row.name ?? "");
  if (fileTitles.length === 0) {
    return {
      kind: "miss",
      code: "no_named_article_photo",
      reason: "exact article has no lead or destination-named bitmap image",
    };
  }

  const existingKeys = new Set(
    row.existing_source_page_urls
      .map(sourcePageKey)
      .filter((key): key is string => key !== null)
  );
  const existingMediaSha1s = new Set(
    row.existing_media_sha1s
      .map(normalizedWikimediaSha1)
      .filter((sha1): sha1 is string => sha1 !== null)
  );
  const historicalFileTitles = [...new Set(
    row.existing_source_page_urls_without_sha
      .map(fileTitleFromWikimediaSourcePage)
      .filter((title): title is string => title !== null)
  )];
  if (historicalFileTitles.length > 0) {
    const historicalMetadata = await client.fetchImageMetadata(historicalFileTitles);
    const historicalMetadataByTitle = new Map<string, WikimediaImageMetadata>();
    for (const image of historicalMetadata) {
      for (const title of [image.fileTitle, ...image.fileTitleAliases]) {
        historicalMetadataByTitle.set(normalizedWords(title), image);
      }
    }
    for (const title of historicalFileTitles) {
      const image = historicalMetadataByTitle.get(normalizedWords(title));
      const sha1 = normalizedWikimediaSha1(image?.mediaSha1 ?? null);
      if (!image || !sha1) {
        return {
          kind: "miss",
          code: "historical_source_identity_unresolved",
          reason: `reviewed Wikimedia source no longer resolves to a durable image identity: ${title}`,
        };
      }
      existingMediaSha1s.add(sha1);
    }
  }
  const leadKey = article.leadImageTitle ? normalizedWords(article.leadImageTitle) : null;
  const metadata = await client.fetchImageMetadata(fileTitles);
  const metadataByTitle = new Map<string, WikimediaImageMetadata>();
  for (const image of metadata) {
    for (const title of [image.fileTitle, ...image.fileTitleAliases]) {
      metadataByTitle.set(normalizedWords(title), image);
    }
  }
  const rejectedImages: string[] = [];

  for (const fileTitle of fileTitles) {
    const image = metadataByTitle.get(normalizedWords(fileTitle));
    if (!image) {
      rejectedImages.push(`${fileTitle}: no image metadata`);
      continue;
    }
    const rejection = imageMetadataRejection(image);
    if (rejection) {
      rejectedImages.push(`${fileTitle}: ${rejection}`);
      continue;
    }
    const sourceKey = sourcePageKey(image.sourcePageUrl!);
    const mediaSha1 = normalizedWikimediaSha1(image.mediaSha1);
    if (!sourceKey || !mediaSha1 || existingKeys.has(sourceKey) || existingMediaSha1s.has(mediaSha1)) {
      rejectedImages.push(`${fileTitle}: source already reviewed or pending`);
      continue;
    }

    const isLead = leadKey !== null && normalizedWords(fileTitle) === leadKey;
    const matchedWikidataId = article.wikidataId!;
    const sourcePageUrl = image.sourcePageUrl!;
    const candidate: ListedPhotoCandidate = {
      id: deterministicPhotoCandidateId(row.id, sourcePageUrl),
      destinationId: row.id,
      destinationName: row.name!,
      imageUrl: image.imageUrl!,
      sourcePageUrl,
      sourceKind: sourceKind(sourcePageUrl)!,
      photographer: image.photographer!,
      licenseName: image.licenseName!,
      licenseUrl: image.licenseUrl!,
      imageWidth: image.width!,
      imageHeight: image.height!,
      focalX: 50,
      focalY: 50,
      notes:
        `Identity checked against English Wikipedia article ${article.title} ` +
        `(${matchedWikidataId}); ${isLead ? "article lead image" : "file title names the destination"}. ` +
        "Framing requires human review.",
      matchedArticleTitle: article.title,
      matchedWikidataId,
      catalogWikidataId: row.wikidata_id,
      catalogLat: row.lat!,
      catalogLng: row.lng!,
      mediaSha1,
      reviewHistoryFingerprint: listedPhotoReviewHistoryFingerprint(
        row.existing_source_page_urls,
        row.existing_media_sha1s
      ),
    };
    return { kind: "candidate", candidate, rejectedImages };
  }

  return {
    kind: "miss",
    code: "no_usable_new_source",
    reason: "article photos were already reviewed or failed source, credit, license, or size checks",
    rejectedImages,
  };
}

export type QueueCandidateResult =
  | "inserted"
  | "already_covered"
  | "pending_review"
  | "source_seen"
  | "history_changed"
  | "identity_changed";

export async function queueListedPhotoCandidate(
  client: Queryable,
  candidate: ListedPhotoCandidate
): Promise<QueueCandidateResult> {
  const state = await client.query(
    `SELECT d.name,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            d.external_ids->>'wikidata' AS wikidata_id,
            (${USABLE_COVER_SQL}) AS has_usable_cover,
            EXISTS (
              SELECT 1
                FROM destination_photo_candidates pending
               WHERE pending.destination_id = d.id
                 AND pending.status = 'pending'
            ) AS has_pending_candidate
       FROM destinations d
      WHERE d.id = $1
        AND d.owner = 'peaks'
        AND EXISTS (
          SELECT 1
            FROM list_destinations ld
            JOIN lists l ON l.id = ld.list_id AND l.owner = 'peaks'
           WHERE ld.destination_id = d.id
        )
      FOR UPDATE`,
    [candidate.destinationId]
  );
  const current = state.rows[0];
  if (!current) throw new Error(`listed Peaks destination disappeared: ${candidate.destinationId}`);
  if (current.has_usable_cover === true) return "already_covered";
  if (current.has_pending_candidate === true) return "pending_review";
  const currentName = nullableText(current.name);
  const currentLat = nullableNumber(current.lat);
  const currentLng = nullableNumber(current.lng);
  const currentWikidataId = nullableText(current.wikidata_id);
  const wikidataChanged = candidate.catalogWikidataId
    ? currentWikidataId !== candidate.catalogWikidataId
    : currentWikidataId !== null && currentWikidataId !== candidate.matchedWikidataId;
  if (
    wikidataChanged ||
    currentName !== candidate.destinationName ||
    currentLat === null ||
    currentLng === null ||
    distanceMeters(candidate.catalogLat, candidate.catalogLng, currentLat, currentLng) > 25
  ) {
    return "identity_changed";
  }

  const sources = await client.query(
    `SELECT source_page_url, media_sha1
       FROM destination_photo_candidates
      WHERE destination_id = $1
      ORDER BY created_at, id`,
    [candidate.destinationId]
  );
  const candidateKey = sourcePageKey(candidate.sourcePageUrl);
  const candidateMediaSha1 = normalizedWikimediaSha1(candidate.mediaSha1);
  const currentHistoryFingerprint = listedPhotoReviewHistoryFingerprint(
    sources.rows
      .map((row) => nullableText(row.source_page_url))
      .filter((source): source is string => source !== null),
    sources.rows
      .map((row) => nullableText(row.media_sha1))
      .filter((sha1): sha1 is string => sha1 !== null)
  );
  if (currentHistoryFingerprint !== candidate.reviewHistoryFingerprint) {
    return "history_changed";
  }
  if (
    !candidateKey ||
    !candidateMediaSha1 ||
    sources.rows.some((row) => {
      const source = nullableText(row.source_page_url);
      const mediaSha1 = normalizedWikimediaSha1(nullableText(row.media_sha1));
      return (source ? sourcePageKey(source) === candidateKey : false) || mediaSha1 === candidateMediaSha1;
    })
  ) {
    return "source_seen";
  }

  const result = await client.query(
    `INSERT INTO destination_photo_candidates (
       id, destination_id, image_url, source_page_url, source_kind,
       photographer, license_name, license_url,
       image_width, image_height, focal_x, focal_y, notes, media_sha1,
       candidate_origin
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               'listed_photo_backfill')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      candidate.id,
      candidate.destinationId,
      candidate.imageUrl,
      candidate.sourcePageUrl,
      candidate.sourceKind,
      candidate.photographer,
      candidate.licenseName,
      candidate.licenseUrl,
      candidate.imageWidth,
      candidate.imageHeight,
      candidate.focalX,
      candidate.focalY,
      candidate.notes ?? null,
      candidateMediaSha1,
    ]
  );
  if (result.rowCount === 1) return "inserted";

  const conflict = await client.query(
    `SELECT (${USABLE_COVER_SQL}) AS has_usable_cover,
            EXISTS (
              SELECT 1
                FROM destination_photo_candidates pending
               WHERE pending.destination_id = d.id
                 AND pending.status = 'pending'
            ) AS has_pending_candidate,
            EXISTS (
              SELECT 1
                FROM destination_photo_candidates seen
               WHERE seen.destination_id = d.id
                 AND (
                   seen.source_page_url = $2
                   OR seen.media_sha1 = $3
                 )
            ) AS has_seen_source
       FROM destinations d
      WHERE d.id = $1`,
    [candidate.destinationId, candidate.sourcePageUrl, candidateMediaSha1]
  );
  const currentConflict = conflict.rows[0];
  if (currentConflict?.has_usable_cover === true) return "already_covered";
  if (currentConflict?.has_pending_candidate === true) return "pending_review";
  if (currentConflict?.has_seen_source === true) return "source_seen";
  throw new Error(`photo candidate insert hit an unknown uniqueness conflict: ${candidate.id}`);
}
