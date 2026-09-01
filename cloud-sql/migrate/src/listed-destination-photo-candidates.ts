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
  country_code: string | null;
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
  articleLanguage: WikipediaLanguage;
  coordinates: WikimediaCoordinates | null;
};

export type WikidataLeadImage = {
  wikidataId: string;
  fileTitle: string;
};

export type WikipediaLanguage = "en" | "ko";

export type WikipediaSearchHit = {
  title: string;
  language: WikipediaLanguage;
  coordinates: WikimediaCoordinates;
};

export type WikipediaArticle = {
  title: string;
  language: WikipediaLanguage;
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
  resolveWikidataArticle(
    wikidataId: string,
    preferredLanguage: WikipediaLanguage
  ): Promise<WikidataArticleIdentity | null>;
  searchWikipediaArticles(
    name: string,
    lat: number,
    lng: number,
    language: WikipediaLanguage
  ): Promise<WikipediaSearchHit[]>;
  fetchWikipediaArticle(
    title: string,
    language: WikipediaLanguage
  ): Promise<WikipediaArticle | null>;
  fetchWikidataLeadImage(
    wikidataId: string
  ): Promise<WikidataLeadImage | null>;
  fetchImageMetadata(
    fileTitles: string[],
    language: WikipediaLanguage
  ): Promise<WikimediaImageMetadata[]>;
};

export type AuditedWikidataP18Photo = {
  wikidataId: string;
  fileTitle: string;
  photographer: string;
  licenseName: string;
  licenseUrl: string;
  width: number;
  height: number;
  mediaSha1: string;
};

/**
 * Human-audited P18 files that may extend article-image discovery. Keep this
 * list closed: a Wikidata P18 claim alone is not enough to enter review.
 */
export const LISTED_PHOTO_AUDITED_WIKIDATA_P18_PHOTOS: Readonly<
  Record<string, Readonly<AuditedWikidataP18Photo>>
> = Object.freeze({
  Q5208179: Object.freeze({
    wikidataId: "Q5208179",
    fileTitle: "File:Chilseongbong at Daedunsan.jpg",
    photographer: "Yoo Chung",
    licenseName: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    width: 5_483,
    height: 2_050,
    mediaSha1: "0632cdaca83add61f33ebfde6f541b870469ff98",
  }),
  Q8533668: Object.freeze({
    wikidataId: "Q8533668",
    fileTitle: "File:Minjujisan Muju.jpg",
    photographer: "Ha98574 (Min's)",
    licenseName: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    width: 1_600,
    height: 1_200,
    mediaSha1: "551de49c173c77197d9ad0ce091470cccf367e16",
  }),
});

export type ListedPhotoCandidate = DestinationPhotoManifestCandidate & {
  id: string;
  matchedArticleTitle: string;
  matchedWikidataId: string;
  catalogWikidataId: string | null;
  catalogCountryCode: string | null;
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
         d.country_code,
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
       listed.country_code,
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
    country_code: nullableText(row.country_code)?.toUpperCase() ?? null,
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

export function wikipediaLanguageForCountry(
  countryCode: string | null
): WikipediaLanguage {
  return countryCode?.trim().toUpperCase() === "KR" ? "ko" : "en";
}

function wikipediaLanguageLabel(language: WikipediaLanguage): string {
  return language === "ko" ? "Korean" : "English";
}

export function normalizedWikimediaFileTitle(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const title = trimmed.replace(/^(?:file|파일):/iu, "").trim();
  return title ? `File:${title}` : null;
}

function explicitWikimediaFileTitle(value: string | null): string | null {
  return value && /^(?:file|파일):/iu.test(value)
    ? normalizedWikimediaFileTitle(value)
    : null;
}

function localizedWikipediaNamesMatch(
  destinationName: string,
  articleTitle: string,
  language: WikipediaLanguage
): boolean {
  if (language === "en") return namesMatch(destinationName, articleTitle);
  const fold = (value: string) => value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\([^)]*\)/g, " ")
    .match(/[\p{L}\p{N}]+/gu)
    ?.join("") ?? "";
  const destination = fold(destinationName);
  const article = fold(articleTitle);
  return destination.length > 0 && destination === article;
}

function normalizedWords(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^(?:file|파일):/u, "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/\bmt\.?\b/g, "mount")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
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
  /(?:\b(?:locator|location map|map blank|route map|topographic map|topo map|flag|logo|icon|symbol|coat of arms|wikidata|commons logo)\b|위치 ?지도|노선도|등산로 ?지도|지형도|지도|로고|아이콘|국기)/iu;

export function rankedArticlePhotoTitles(
  article: WikipediaArticle,
  destinationName: string,
  maxImages = LISTED_PHOTO_MAX_ARTICLE_IMAGES
): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();
  const add = (rawTitle: string | null, lead: boolean) => {
    const title = normalizedWikimediaFileTitle(rawTitle);
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
  const fileTitle = explicitWikimediaFileTitle(
    pathname.match(/^\/wiki\/(.+)$/u)?.[1] ?? null
  );
  if (
    fileTitle &&
    (
      hostname === "commons.wikimedia.org" ||
      hostname === "en.wikipedia.org" ||
      hostname === "ko.wikipedia.org"
    )
  ) {
    return `wikimedia:${fileTitle.replace(/_/g, " ").trim().toLowerCase()}`;
  }
  return `${hostname}${pathname.replace(/_/g, " ").toLowerCase()}`;
}

export function fileTitleFromWikimediaSourcePage(value: string): string | null {
  const url = canonicalHttpsUrl(value);
  if (!url) return null;
  const hostname = url.hostname.toLowerCase();
  if (
    hostname !== "commons.wikimedia.org" &&
    hostname !== "en.wikipedia.org" &&
    hostname !== "ko.wikipedia.org"
  ) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  return explicitWikimediaFileTitle(
    pathname.match(/^\/wiki\/(.+)$/u)?.[1]?.replace(/_/g, " ") ?? null
  );
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
  if (!explicitWikimediaFileTitle(pathname.match(/^\/wiki\/(.+)$/u)?.[1] ?? null)) {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "commons.wikimedia.org") return "wikimedia_commons";
  if (hostname === "en.wikipedia.org" || hostname === "ko.wikipedia.org") {
    return "wikipedia";
  }
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
    /^(?:미상|불명|익명|알 수 없음|정보 없음|자료 없음|본인 촬영|직접 촬영|자작|업로더|올린이)$/u.test(normalized) ||
    /(?:촬영자|사진가|작가|저자|작성자|작자)\s*(?:미상|불명|알 수 없음|명시되지 않음)/u.test(normalized) ||
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

function wikimediaFileTitleKey(value: string | null): string | null {
  return normalizedWikimediaFileTitle(value)
    ?.normalize("NFC")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase() ?? null;
}

function auditedWikidataP18MetadataRejection(
  image: WikimediaImageMetadata,
  audit: Readonly<AuditedWikidataP18Photo>
): string | null {
  if (wikimediaFileTitleKey(image.fileTitle) !== wikimediaFileTitleKey(audit.fileTitle)) {
    return "canonical File title changed from the human-audited P18 file";
  }
  const expectedSourceKey = sourcePageKey(
    `https://commons.wikimedia.org/wiki/${encodeURIComponent(audit.fileTitle)}`
  );
  if (sourcePageKey(image.sourcePageUrl ?? "") !== expectedSourceKey) {
    return "source page changed from the human-audited P18 file";
  }
  if (normalizedWikimediaSha1(image.mediaSha1) !== audit.mediaSha1) {
    return "media SHA-1 changed from the human-audited P18 file";
  }
  if (image.photographer?.trim() !== audit.photographer) {
    return "photographer changed from the human-audited P18 record";
  }
  if (
    image.licenseName?.trim() !== audit.licenseName ||
    canonicalWikimediaLicenseUrl(image.licenseUrl) !== audit.licenseUrl
  ) {
    return "license changed from the human-audited P18 record";
  }
  if (image.width !== audit.width || image.height !== audit.height) {
    return "dimensions changed from the human-audited P18 file";
  }
  return null;
}

type StableArticleOutcome =
  | { kind: "article"; article: WikipediaArticle }
  | {
      kind: "miss";
      code: string;
      reason: string;
      sameEntityArticleForAuditedP18?: WikipediaArticle;
    };

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
  const preferredLanguage = wikipediaLanguageForCountry(row.country_code);

  if (row.wikidata_id) {
    if (!/^Q\d+$/.test(row.wikidata_id)) {
      return {
        kind: "miss",
        code: "wikidata_id_invalid",
        reason: `stored Wikidata id ${row.wikidata_id} is not valid`,
      };
    }
    const identity = await client.resolveWikidataArticle(
      row.wikidata_id,
      preferredLanguage
    );
    if (!identity || identity.wikidataId !== row.wikidata_id || !identity.coordinates) {
      return {
        kind: "miss",
        code: "wikidata_identity_incomplete",
        reason:
          `stored Wikidata item needs a ${wikipediaLanguageLabel(preferredLanguage)} ` +
          "or English article and coordinates",
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
    const article = await client.fetchWikipediaArticle(
      identity.articleTitle,
      identity.articleLanguage
    );
    if (
      !article ||
      article.language !== identity.articleLanguage ||
      article.wikidataId !== row.wikidata_id
    ) {
      return {
        kind: "miss",
        code: "wikipedia_identity_mismatch",
        reason:
          `${wikipediaLanguageLabel(identity.articleLanguage)} article does not ` +
          "confirm the stored Wikidata identity and name",
      };
    }
    const localizedNameMismatch =
      article.language === preferredLanguage &&
      !localizedWikipediaNamesMatch(name, article.title, article.language);
    if (
      localizedNameMismatch &&
      !LISTED_PHOTO_AUDITED_WIKIDATA_P18_PHOTOS[row.wikidata_id]
    ) {
      return {
        kind: "miss",
        code: "wikipedia_identity_mismatch",
        reason:
          `${wikipediaLanguageLabel(identity.articleLanguage)} article does not ` +
          "confirm the stored Wikidata identity and name",
      };
    }
    const articleDistance = article.coordinates
      ? distanceMeters(
        row.lat,
        row.lng,
        article.coordinates.lat,
        article.coordinates.lng
      )
      : null;
    if (
      articleDistance !== null &&
      articleDistance > LISTED_PHOTO_WIKIDATA_RADIUS_METERS
    ) {
      return {
        kind: "miss",
        code: "wikipedia_identity_too_far",
        reason:
          `${wikipediaLanguageLabel(article.language)} article is ` +
          `${(articleDistance / 1_000).toFixed(1)} km away`,
      };
    }
    if (localizedNameMismatch) {
      return {
        kind: "miss",
        code: "wikipedia_identity_mismatch",
        reason:
          `${wikipediaLanguageLabel(identity.articleLanguage)} article does not ` +
          "confirm the stored Wikidata identity and name",
        sameEntityArticleForAuditedP18: article,
      };
    }
    return { kind: "article", article };
  }

  const hits = (await client.searchWikipediaArticles(
    name,
    row.lat,
    row.lng,
    preferredLanguage
  )).filter(
    (hit) =>
      localizedWikipediaNamesMatch(name, hit.title, hit.language) &&
      distanceMeters(row.lat!, row.lng!, hit.coordinates.lat, hit.coordinates.lng) <=
        LISTED_PHOTO_GEOSEARCH_RADIUS_METERS
  );
  const uniqueTitles = [
    ...new Map(hits.map((hit) => [`${hit.language}:${hit.title}`, hit])).values(),
  ];
  if (uniqueTitles.length !== 1) {
    return {
      kind: "miss",
      code: uniqueTitles.length === 0 ? "no_exact_article" : "ambiguous_article",
      reason:
        uniqueTitles.length === 0
          ? `no exact nearby ${wikipediaLanguageLabel(preferredLanguage)} Wikipedia article`
          : `${uniqueTitles.length} exact nearby ${wikipediaLanguageLabel(preferredLanguage)} ` +
            "Wikipedia articles",
    };
  }

  const article = await client.fetchWikipediaArticle(
    uniqueTitles[0].title,
    uniqueTitles[0].language
  );
  if (
    !article ||
    article.language !== uniqueTitles[0].language ||
    !/^Q\d+$/.test(article.wikidataId ?? "") ||
    !localizedWikipediaNamesMatch(name, article.title, article.language) ||
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

  const auditedP18ForRow = row.wikidata_id
    ? LISTED_PHOTO_AUDITED_WIKIDATA_P18_PHOTOS[row.wikidata_id]
    : undefined;
  const stable = await resolveStableArticle(row, client);
  if (
    stable.kind === "miss" &&
    (!auditedP18ForRow || !stable.sameEntityArticleForAuditedP18)
  ) return stable;
  const article = stable.kind === "article"
    ? stable.article
    : stable.sameEntityArticleForAuditedP18!;
  const matchedWikidataId = article.wikidataId!;
  const articleFileTitles = stable.kind === "article"
    ? rankedArticlePhotoTitles(article, row.name ?? "")
    : [];
  const auditedP18 =
    row.wikidata_id === matchedWikidataId &&
    auditedP18ForRow?.wikidataId === matchedWikidataId
      ? auditedP18ForRow
    : undefined;
  if (articleFileTitles.length === 0 && !auditedP18) {
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
    const historicalMetadata = await client.fetchImageMetadata(
      historicalFileTitles,
      article.language
    );
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
  const rejectedImages: string[] = [];

  const candidateFromTitles = async (
    fileTitles: string[],
    sourceDescription: (fileTitle: string) => string,
    frozenAudit?: Readonly<AuditedWikidataP18Photo>
  ): Promise<ListedPhotoCandidate | null> => {
    if (fileTitles.length === 0) return null;
    const metadata = await client.fetchImageMetadata(fileTitles, article.language);
    const metadataByTitle = new Map<string, WikimediaImageMetadata>();
    for (const image of metadata) {
      for (const title of [image.fileTitle, ...image.fileTitleAliases]) {
        metadataByTitle.set(normalizedWords(title), image);
      }
    }

    for (const fileTitle of fileTitles) {
      const image = metadataByTitle.get(normalizedWords(fileTitle));
      if (!image) {
        rejectedImages.push(`${fileTitle}: no image metadata`);
        continue;
      }
      const rejection = imageMetadataRejection(image) ?? (
        frozenAudit ? auditedWikidataP18MetadataRejection(image, frozenAudit) : null
      );
      if (rejection) {
        rejectedImages.push(`${fileTitle}: ${rejection}`);
        continue;
      }
      const sourceKey = sourcePageKey(image.sourcePageUrl!);
      const mediaSha1 = normalizedWikimediaSha1(image.mediaSha1);
      if (
        !sourceKey ||
        !mediaSha1 ||
        existingKeys.has(sourceKey) ||
        existingMediaSha1s.has(mediaSha1)
      ) {
        rejectedImages.push(`${fileTitle}: source already reviewed or pending`);
        continue;
      }

      const sourcePageUrl = image.sourcePageUrl!;
      return {
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
          `Identity checked against ${wikipediaLanguageLabel(article.language)} ` +
          `Wikipedia article ${article.title} ` +
          `(${matchedWikidataId}); ${sourceDescription(fileTitle)}. ` +
          "Framing requires human review.",
        matchedArticleTitle: article.title,
        matchedWikidataId,
        catalogWikidataId: row.wikidata_id,
        catalogCountryCode: row.country_code,
        catalogLat: row.lat!,
        catalogLng: row.lng!,
        mediaSha1,
        reviewHistoryFingerprint: listedPhotoReviewHistoryFingerprint(
          row.existing_source_page_urls,
          row.existing_media_sha1s
        ),
      };
    }
    return null;
  };

  const articleCandidate = await candidateFromTitles(
    articleFileTitles,
    (fileTitle) =>
      leadKey !== null && normalizedWords(fileTitle) === leadKey
        ? "article lead image"
        : "file title names the destination"
  );
  if (articleCandidate) {
    return { kind: "candidate", candidate: articleCandidate, rejectedImages };
  }

  if (auditedP18) {
    const leadImage = await client.fetchWikidataLeadImage(matchedWikidataId);
    if (
      !leadImage ||
      leadImage.wikidataId !== matchedWikidataId ||
      wikimediaFileTitleKey(leadImage.fileTitle) !==
        wikimediaFileTitleKey(auditedP18.fileTitle)
    ) {
      rejectedImages.push(
        `${auditedP18.fileTitle}: Wikidata ${matchedWikidataId} P18 no longer ` +
        "matches the human-audited file"
      );
    } else {
      const p18Candidate = await candidateFromTitles(
        [leadImage.fileTitle],
        () => "human-audited same-entity Wikidata P18 lead image",
        auditedP18
      );
      if (p18Candidate) {
        return { kind: "candidate", candidate: p18Candidate, rejectedImages };
      }
    }
  }

  return {
    kind: "miss",
    code: "no_usable_new_source",
    reason:
      "article photos and any audited P18 fallback were already reviewed or failed " +
      "source, credit, license, size, or frozen-audit checks",
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
            d.country_code,
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
  const currentCountryCode = nullableText(current.country_code)?.toUpperCase() ?? null;
  const currentWikidataId = nullableText(current.wikidata_id);
  const wikidataChanged = candidate.catalogWikidataId
    ? currentWikidataId !== candidate.catalogWikidataId
    : currentWikidataId !== null && currentWikidataId !== candidate.matchedWikidataId;
  if (
    wikidataChanged ||
    currentCountryCode !== candidate.catalogCountryCode ||
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
