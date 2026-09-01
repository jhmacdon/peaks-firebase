import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildListedPhotoAudit,
  mediaWikiApiErrorMessage,
  parseListedPhotoArgs,
  parseWikidataArticleIdentity,
  parseWikidataLeadImage,
  parseWikipediaArticle,
  parseWikipediaSearchHits,
  parseWikimediaImageMetadata,
  plainMetadataText,
  prepareAuditOutput,
  publishAuditOutput,
  reviewedCommonsFileApiUrl,
  stageAuditOutput,
} from "../backfill-listed-destination-photo-candidates";
import {
  LISTED_PHOTO_AUDITED_WIKIDATA_P18_PHOTOS,
  LISTED_PHOTO_GAPS_SQL,
  LISTED_PHOTO_REVIEWED_COMMONS_FILES,
  canonicalWikimediaLicenseUrl,
  distanceMeters,
  fileTitleNamesDestination,
  hasCompatibleLicenseRecord,
  imageMetadataRejection,
  listedPhotoReviewHistoryFingerprint,
  normalizedWikimediaSha1,
  planListedPhotoCandidate,
  queueListedPhotoCandidate,
  rankedArticlePhotoTitles,
  serializeListedPhotoGapRow,
  sourcePageKey,
  wikipediaLanguageForCountry,
  type ListedPhotoClient,
  type ListedPhotoGapRow,
  type Queryable,
  type ReviewedCommonsFilePhoto,
  type WikimediaImageMetadata,
  type WikipediaArticle,
} from "../listed-destination-photo-candidates";

const RAINIER_MEDIA_SHA1 = "7a1f2627e0f702e514290f1c06aa76e838dd845f";

function row(overrides: Partial<ListedPhotoGapRow> = {}): ListedPhotoGapRow {
  return {
    id: "dest-rainier",
    name: "Mount Rainier",
    lat: 46.8523,
    lng: -121.7603,
    country_code: "US",
    wikidata_id: "Q194057",
    list_ids: ["state-high-points"],
    list_names: ["US State High Points"],
    existing_source_page_urls: [],
    existing_source_page_urls_without_sha: [],
    existing_media_sha1s: [],
    has_pending_candidate: false,
    ...overrides,
  };
}

function article(overrides: Partial<WikipediaArticle> = {}): WikipediaArticle {
  return {
    title: "Mount Rainier",
    language: "en",
    wikidataId: "Q194057",
    coordinates: { lat: 46.8523, lng: -121.7603 },
    leadImageTitle: "File:Mount Rainier from Paradise.jpg",
    imageTitles: [
      "File:Mount Rainier from Paradise.jpg",
      "File:Mount Rainier northwest.jpg",
      "File:Washington locator map.png",
    ],
    ...overrides,
  };
}

function image(overrides: Partial<WikimediaImageMetadata> = {}): WikimediaImageMetadata {
  return {
    fileTitle: "File:Mount Rainier from Paradise.jpg",
    fileTitleAliases: [],
    coordinates: null,
    coordinateCount: 0,
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/a/aa/Mount_Rainier_from_Paradise.jpg",
    sourcePageUrl:
      "https://commons.wikimedia.org/wiki/File:Mount_Rainier_from_Paradise.jpg",
    photographer: "Jane Photographer",
    licenseName: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    width: 4_000,
    height: 2_600,
    mime: "image/jpeg",
    mediaType: "BITMAP",
    mediaSha1: RAINIER_MEDIA_SHA1,
    ...overrides,
  };
}

function client(overrides: Partial<ListedPhotoClient> = {}): ListedPhotoClient {
  return {
    async resolveWikidataArticle(wikidataId) {
      return {
        wikidataId,
        articleTitle: "Mount Rainier",
        articleLanguage: "en",
        coordinates: { lat: 46.8523, lng: -121.7603 },
      };
    },
    async searchWikipediaArticles() {
      return [{
        title: "Mount Rainier",
        language: "en",
        coordinates: { lat: 46.8523, lng: -121.7603 },
      }];
    },
    async fetchWikipediaArticle() {
      return article();
    },
    async fetchWikidataLeadImage() {
      return null;
    },
    async fetchReviewedCommonsFile(fileTitle) {
      return image({ fileTitle });
    },
    async fetchImageMetadata(titles) {
      return titles.map((fileTitle) => image({ fileTitle }));
    },
    ...overrides,
  };
}

function reviewedRow(
  audit: Readonly<ReviewedCommonsFilePhoto>,
  overrides: Partial<ListedPhotoGapRow> = {}
): ListedPhotoGapRow {
  return row({
    id: audit.destinationId,
    name: audit.destinationName,
    lat: audit.catalogCoordinates.lat,
    lng: audit.catalogCoordinates.lng,
    country_code: audit.countryCode,
    wikidata_id: audit.catalogWikidataId,
    list_ids: [audit.requiredListId],
    list_names: ["Korea Forest Service 100 Famous Mountains"],
    ...overrides,
  });
}

function reviewedImage(
  audit: Readonly<ReviewedCommonsFilePhoto>,
  overrides: Partial<WikimediaImageMetadata> = {}
): WikimediaImageMetadata {
  return image({
    fileTitle: audit.fileTitle,
    fileTitleAliases: [],
    coordinates: audit.fileCoordinates,
    coordinateCount: 1,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/a/aa/reviewed-file.jpg",
    sourcePageUrl:
      `https://commons.wikimedia.org/wiki/${encodeURIComponent(audit.fileTitle)}`,
    photographer: audit.photographer,
    licenseName: audit.licenseName,
    licenseUrl: audit.licenseUrl,
    width: audit.width,
    height: audit.height,
    mediaSha1: audit.mediaSha1,
    ...overrides,
  });
}

async function planCode(
  candidateRow: ListedPhotoGapRow,
  fakeClient: ListedPhotoClient
): Promise<string> {
  const plan = await planListedPhotoCandidate(candidateRow, fakeClient);
  if (plan.kind === "candidate") assert.fail("expected a skip or miss");
  return plan.code;
}

test("CLI is dry-run by default and requires an explicit, audited --apply", () => {
  assert.deepEqual(parseListedPhotoArgs([]), { apply: false, limit: null, auditOutput: null });
  assert.deepEqual(parseListedPhotoArgs([
    "--apply",
    "--limit=25",
    "--audit-output=/tmp/listed-photos.json",
  ]), {
    apply: true,
    limit: 25,
    auditOutput: "/tmp/listed-photos.json",
  });
  assert.throws(() => parseListedPhotoArgs(["--apply"]), /requires --audit-output/);
  assert.throws(() => parseListedPhotoArgs(["--apply", "--dry-run"]), /contradict/);
  assert.throws(() => parseListedPhotoArgs(["--limit=0"]), /positive whole number/);
  assert.throws(() => parseListedPhotoArgs(["--limit=ten"]), /positive whole number/);
  assert.throws(
    () => parseListedPhotoArgs(["--limit=999999999999999999999"]),
    /positive whole number/
  );
  assert.throws(() => parseListedPhotoArgs(["--all-lists"]), /Unknown argument/);
  assert.throws(() => parseListedPhotoArgs(["--audit-output="]), /non-empty path/);
});

test("HTTP-200 MediaWiki API errors remain request errors", () => {
  assert.equal(mediaWikiApiErrorMessage({ query: { pages: [] } }), null);
  assert.equal(
    mediaWikiApiErrorMessage({ error: { code: "maxlag", info: "Waiting for replicas" } }),
    "MediaWiki API maxlag: Waiting for replicas"
  );
});

test("gap query targets every Peaks-owned list member with incomplete cover credit", () => {
  assert.match(LISTED_PHOTO_GAPS_SQL, /JOIN lists l[\s\S]*l\.owner = 'peaks'/);
  assert.match(LISTED_PHOTO_GAPS_SQL, /d\.owner = 'peaks'/);
  assert.match(LISTED_PHOTO_GAPS_SQL, /NULLIF\(btrim\(d\.hero_image\), ''\) IS NULL/);
  assert.match(
    LISTED_PHOTO_GAPS_SQL,
    /NULLIF\(btrim\(d\.hero_image_attribution\), ''\) IS NULL/
  );
  assert.match(
    LISTED_PHOTO_GAPS_SQL,
    /NULLIF\(btrim\(d\.hero_image_attribution_url\), ''\) IS NULL/
  );
  assert.match(LISTED_PHOTO_GAPS_SQL, /existing_source_page_urls/);
  assert.match(LISTED_PHOTO_GAPS_SQL, /has_pending_candidate/);
  assert.match(LISTED_PHOTO_GAPS_SQL, /country_code/);
  assert.doesNotMatch(LISTED_PHOTO_GAPS_SQL, /LIMIT|list_id = \$/);
});

test("gap rows preserve full list and review history for the audit", () => {
  assert.deepEqual(
    serializeListedPhotoGapRow({
      id: "peak",
      name: "Peak",
      lat: "1.25",
      lng: "-2.5",
      country_code: "KR",
      wikidata_id: "Q1",
      list_ids: ["b", "a"],
      list_names: ["B", "A"],
      existing_source_page_urls: ["https://commons.wikimedia.org/wiki/File:X.jpg"],
      existing_source_page_urls_without_sha: [
        "https://commons.wikimedia.org/wiki/File:X.jpg",
      ],
      existing_media_sha1s: [RAINIER_MEDIA_SHA1],
      has_pending_candidate: true,
    }),
    {
      id: "peak",
      name: "Peak",
      lat: 1.25,
      lng: -2.5,
      country_code: "KR",
      wikidata_id: "Q1",
      list_ids: ["b", "a"],
      list_names: ["B", "A"],
      existing_source_page_urls: ["https://commons.wikimedia.org/wiki/File:X.jpg"],
      existing_source_page_urls_without_sha: [
        "https://commons.wikimedia.org/wiki/File:X.jpg",
      ],
      existing_media_sha1s: [RAINIER_MEDIA_SHA1],
      has_pending_candidate: true,
    }
  );
});

test("gap coordinates reject null, blanks, and booleans instead of becoming zero", () => {
  for (const invalid of [null, undefined, "", "   ", false, true]) {
    const serialized = serializeListedPhotoGapRow({ id: "peak", lat: invalid, lng: invalid });
    assert.equal(serialized.lat, null);
    assert.equal(serialized.lng, null);
  }
});

test("Wikidata parser prefers the country wiki, falls back to English, and reads P625", () => {
  const parsed = parseWikidataArticleIdentity({
    entities: {
      Q194057: {
        sitelinks: {
          enwiki: { title: "Mount Rainier" },
          kowiki: { title: "레이니어산" },
        },
        claims: {
          P625: [{
            rank: "normal",
            mainsnak: {
              snaktype: "value",
              datavalue: {
                value: {
                  latitude: 46.8523,
                  longitude: -121.7603,
                  globe: "http://www.wikidata.org/entity/Q2",
                },
              },
            },
          }],
        },
      },
    },
  }, "Q194057", "ko");
  assert.deepEqual(parsed, {
    wikidataId: "Q194057",
    articleTitle: "레이니어산",
    articleLanguage: "ko",
    coordinates: { lat: 46.8523, lng: -121.7603 },
  });
  assert.deepEqual(parseWikidataArticleIdentity({
    entities: {
      Q194057: {
        sitelinks: { enwiki: { title: "Mount Rainier" } },
        claims: {
          P625: [{
            rank: "normal",
            mainsnak: {
              snaktype: "value",
              datavalue: {
                value: {
                  latitude: 46.8523,
                  longitude: -121.7603,
                  globe: "https://www.wikidata.org/entity/Q2",
                },
              },
            },
          }],
        },
      },
    },
  }, "Q194057", "ko"), {
    wikidataId: "Q194057",
    articleTitle: "Mount Rainier",
    articleLanguage: "en",
    coordinates: { lat: 46.8523, lng: -121.7603 },
  });
  assert.equal(parseWikidataArticleIdentity({ entities: { Q194057: {} } }, "Q194057"), null);
});

test("Wikidata P625 parsing requires one ranked Earth coordinate", () => {
  const claim = (
    latitude: number,
    longitude: number,
    rank: "normal" | "preferred" | "deprecated" = "normal",
    globe = "http://www.wikidata.org/entity/Q2"
  ) => ({
    rank,
    mainsnak: {
      snaktype: "value",
      datavalue: { value: { latitude, longitude, globe } },
    },
  });
  const parse = (claims: unknown[]) => parseWikidataArticleIdentity({
    entities: {
      Q1: {
        sitelinks: { enwiki: { title: "Peak" } },
        claims: { P625: claims },
      },
    },
  }, "Q1")?.coordinates;

  assert.equal(parse([claim(1, 2, "deprecated")]), null);
  assert.equal(
    parse([claim(1, 2, "normal", "http://www.wikidata.org/entity/Q111")]),
    null
  );
  assert.equal(parse([claim(1, 2), claim(3, 4)]), null);
  assert.deepEqual(parse([claim(1, 2), claim(3, 4, "preferred")]), { lat: 3, lng: 4 });
  assert.equal(
    parse([
      claim(1, 2),
      claim(3, 4, "preferred", "http://www.wikidata.org/entity/Q111"),
    ]),
    null
  );
  assert.deepEqual(parse([claim(1, 2), claim(1, 2)]), { lat: 1, lng: 2 });
});

test("Wikidata P18 parsing requires one highest-rank Commons file on the exact item", () => {
  const claim = (
    value: string,
    rank: "normal" | "preferred" | "deprecated" = "normal",
    datatype = "commonsMedia"
  ) => ({
    rank,
    mainsnak: {
      snaktype: "value",
      property: "P18",
      datatype,
      datavalue: { value, type: "string" },
    },
  });
  const response = (id: string, claims: unknown[]) => ({
    entities: {
      Q5208179: {
        id,
        type: "item",
        claims: { P18: claims },
      },
    },
  });

  assert.deepEqual(
    parseWikidataLeadImage(
      response("Q5208179", [claim("Chilseongbong at Daedunsan.jpg")]),
      "Q5208179"
    ),
    {
      wikidataId: "Q5208179",
      fileTitle: "File:Chilseongbong at Daedunsan.jpg",
    }
  );
  assert.deepEqual(
    parseWikidataLeadImage(
      response("Q5208179", [
        claim("Old.jpg"),
        claim("Chilseongbong at Daedunsan.jpg", "preferred"),
      ]),
      "Q5208179"
    )?.fileTitle,
    "File:Chilseongbong at Daedunsan.jpg"
  );
  assert.equal(
    parseWikidataLeadImage(
      response("Q5208179", [claim("One.jpg"), claim("Two.jpg")]),
      "Q5208179"
    ),
    null
  );
  assert.equal(
    parseWikidataLeadImage(
      response("Q5208179", [claim("Old.jpg", "deprecated")]),
      "Q5208179"
    ),
    null
  );
  assert.equal(
    parseWikidataLeadImage(
      response("Q999", [claim("Chilseongbong at Daedunsan.jpg")]),
      "Q5208179"
    ),
    null
  );
  assert.equal(
    parseWikidataLeadImage(
      response("Q5208179", [claim("Chilseongbong at Daedunsan.jpg", "normal", "string")]),
      "Q5208179"
    ),
    null
  );
});

test("South Korean destinations use Korean Wikipedia while other countries keep English", () => {
  assert.equal(wikipediaLanguageForCountry("KR"), "ko");
  assert.equal(wikipediaLanguageForCountry("kr"), "ko");
  assert.equal(wikipediaLanguageForCountry("US"), "en");
  assert.equal(wikipediaLanguageForCountry(null), "en");
});

test("Wikipedia parsers retain exact title, Q-id, coordinates, lead image, and article images", () => {
  const hits = parseWikipediaSearchHits({
    query: {
      geosearch: [
        { title: "Mount Rainier", lat: 46.8523, lon: -121.7603 },
        { title: "Broken", lat: "46", lon: -121 },
      ],
    },
  }, "ko");
  assert.deepEqual(hits, [
    {
      title: "Mount Rainier",
      language: "ko",
      coordinates: { lat: 46.8523, lng: -121.7603 },
    },
  ]);

  const parsed = parseWikipediaArticle({
    query: {
      pages: [{
        pageid: 1,
        ns: 0,
        title: "Mount Rainier",
        pageprops: { wikibase_item: "Q194057" },
        coordinates: [{ lat: 46.8523, lon: -121.7603 }],
        pageimage: "Mount Rainier lead.jpg",
        images: [
          { title: "File:Mount Rainier lead.jpg" },
          { title: "File:Mount Rainier winter.jpg" },
        ],
      }],
    },
  }, "ko");
  assert.deepEqual(parsed, {
    title: "Mount Rainier",
    language: "ko",
    wikidataId: "Q194057",
    coordinates: { lat: 46.8523, lng: -121.7603 },
    leadImageTitle: "File:Mount Rainier lead.jpg",
    imageTitles: ["File:Mount Rainier lead.jpg", "File:Mount Rainier winter.jpg"],
  });
  assert.equal(parseWikipediaArticle({
    query: {
      pages: [{
        ns: 0,
        title: "Mount Rainier",
        pageprops: { wikibase_item: "Q194057", disambiguation: "" },
      }],
    },
  }), null);
});

test("Korean Wikipedia file namespaces normalize to canonical File titles", () => {
  const parsed = parseWikipediaArticle({
    query: {
      pages: [{
        ns: 0,
        title: "관악산",
        pageprops: { wikibase_item: "Q626275" },
        pageimage: "관악산.jpg",
        images: [
          { title: "파일:관악산.jpg" },
          { title: "파일:관악산 설경.jpg" },
        ],
      }],
    },
  }, "ko");
  assert.deepEqual(parsed, {
    title: "관악산",
    language: "ko",
    wikidataId: "Q626275",
    coordinates: null,
    leadImageTitle: "File:관악산.jpg",
    imageTitles: ["File:관악산.jpg", "File:관악산 설경.jpg"],
  });
});

test("imageinfo parser keeps exact URL, artist, license URL, dimensions, and format", () => {
  const parsed = parseWikimediaImageMetadata({
    query: {
      pages: [{
        ns: 6,
        title: "File:Mount Rainier.jpg",
        coordinates: [{ lat: 46.8523, lon: -121.7603 }],
        imageinfo: [{
          url: "https://upload.wikimedia.org/rainier.jpg?utm_source=en.wikipedia.org",
          descriptionurl: "https://commons.wikimedia.org/wiki/File:Mount_Rainier.jpg",
          width: 4_000,
          height: 2_600,
          mime: "image/jpeg",
          mediatype: "BITMAP",
          sha1: RAINIER_MEDIA_SHA1.toUpperCase(),
          extmetadata: {
            Artist: { value: '<a href="/wiki/User:Jane">Jane &amp; Joe</a>' },
            LicenseShortName: { value: "CC BY-SA 4.0" },
            LicenseUrl: { value: "http://creativecommons.org/licenses/by-sa/4.0/deed.en" },
          },
        }],
      }],
    },
  });
  assert.deepEqual(parsed, [{
    fileTitle: "File:Mount Rainier.jpg",
    fileTitleAliases: [],
    coordinates: { lat: 46.8523, lng: -121.7603 },
    coordinateCount: 1,
    imageUrl: "https://upload.wikimedia.org/rainier.jpg",
    sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Mount_Rainier.jpg",
    photographer: "Jane & Joe",
    licenseName: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    width: 4_000,
    height: 2_600,
    mime: "image/jpeg",
    mediaType: "BITMAP",
    mediaSha1: RAINIER_MEDIA_SHA1,
  }]);
  assert.equal(plainMetadataText({ value: "<b>Jane</b>&nbsp;Doe" }), "Jane Doe");
});

test("imageinfo parser maps normalized and redirected File aliases to canonical metadata", () => {
  const parsed = parseWikimediaImageMetadata({
    query: {
      normalized: [{
        from: "File:Old_Rainier_name.jpg",
        to: "File:Old Rainier name.jpg",
      }],
      redirects: [{
        from: "File:Old Rainier name.jpg",
        to: "File:Mount Rainier.jpg",
      }],
      pages: [{
        ns: 6,
        title: "File:Mount Rainier.jpg",
        imageinfo: [{
          url: "https://upload.wikimedia.org/rainier.jpg",
          descriptionurl: "https://commons.wikimedia.org/wiki/File:Mount_Rainier.jpg",
          width: 4_000,
          height: 2_600,
          mime: "image/jpeg",
          mediatype: "BITMAP",
          sha1: RAINIER_MEDIA_SHA1,
          extmetadata: {
            Artist: { value: "Jane" },
            LicenseShortName: { value: "CC BY-SA 4.0" },
            LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
          },
        }],
      }],
    },
  });
  assert.deepEqual(parsed[0].fileTitleAliases, [
    "File:Old_Rainier_name.jpg",
    "File:Old Rainier name.jpg",
  ]);
});

test("imageinfo parser and source identity canonicalize the Korean File namespace", () => {
  const parsed = parseWikimediaImageMetadata({
    query: {
      normalized: [{
        from: "File:관악산_옛이름.jpg",
        to: "파일:관악산 옛이름.jpg",
      }],
      redirects: [{
        from: "파일:관악산 옛이름.jpg",
        to: "파일:관악산.jpg",
      }],
      pages: [{
        ns: 6,
        title: "파일:관악산.jpg",
        imageinfo: [{
          url: "https://upload.wikimedia.org/wikipedia/ko/a/aa/Gwanaksan.jpg",
          descriptionurl: "https://ko.wikipedia.org/wiki/파일:관악산.jpg",
          width: 2_000,
          height: 1_500,
          mime: "image/jpeg",
          mediatype: "BITMAP",
          sha1: RAINIER_MEDIA_SHA1,
          extmetadata: {
            Artist: { value: "홍길동" },
            LicenseShortName: { value: "CC BY-SA 4.0" },
            LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
          },
        }],
      }],
    },
  });
  assert.equal(parsed[0].fileTitle, "File:관악산.jpg");
  assert.deepEqual(parsed[0].fileTitleAliases, [
    "File:관악산_옛이름.jpg",
    "File:관악산 옛이름.jpg",
  ]);
  assert.equal(imageMetadataRejection(parsed[0]), null);
  assert.equal(
    sourcePageKey("https://ko.wikipedia.org/wiki/%ED%8C%8C%EC%9D%BC:%EA%B4%80%EC%95%85%EC%82%B0.jpg"),
    sourcePageKey("https://commons.wikimedia.org/wiki/File:관악산.jpg")
  );
  assert.notEqual(
    sourcePageKey("https://ko.wikipedia.org/wiki/관악산"),
    sourcePageKey("https://commons.wikimedia.org/wiki/File:관악산")
  );
});

test("only internally consistent Creative Commons and public-domain records pass", () => {
  assert.equal(
    hasCompatibleLicenseRecord(
      "CC BY-SA 4.0",
      "https://creativecommons.org/licenses/by-sa/4.0/"
    ),
    true
  );
  assert.equal(
    hasCompatibleLicenseRecord("CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/"),
    true
  );
  assert.equal(
    hasCompatibleLicenseRecord(
      "Public domain",
      "https://creativecommons.org/publicdomain/mark/1.0/"
    ),
    true
  );
  assert.equal(
    hasCompatibleLicenseRecord("CC BY-SA 4.0", "https://creativecommons.org/licenses/by/4.0/"),
    false,
    "the label and URL must describe the same license"
  );
  assert.equal(
    hasCompatibleLicenseRecord(
      "CC BY-SA 2.0",
      "https://creativecommons.org/licenses/by-sa/4.0/"
    ),
    false,
    "the label and URL versions must match"
  );
  assert.equal(
    hasCompatibleLicenseRecord("CC BY 3.0", "https://creativecommons.org/licenses/by/4.0/"),
    false
  );
  assert.equal(
    hasCompatibleLicenseRecord(
      "CC BY-NC 4.0",
      "https://creativecommons.org/licenses/by/4.0/"
    ),
    false
  );
  assert.equal(
    hasCompatibleLicenseRecord(
      "CC BY 4.0",
      "http://creativecommons.org/licenses/by/4.0/deed.en"
    ),
    true,
    "Commons http deed URLs normalize to the same exact license and version"
  );
  assert.equal(
    canonicalWikimediaLicenseUrl("http://creativecommons.org/licenses/by/4.0/deed.en"),
    "https://creativecommons.org/licenses/by/4.0/"
  );
  assert.equal(hasCompatibleLicenseRecord("CC BY 4.0", "https://example.com/by/4.0"), false);
});

test("metadata validation fails closed on host, source, artist, license, size, and format", () => {
  assert.equal(imageMetadataRejection(image()), null);
  assert.match(imageMetadataRejection(image({ imageUrl: "https://example.com/a.jpg" }))!, /upload/);
  assert.match(imageMetadataRejection(image({ sourcePageUrl: "https://example.com/a" }))!, /File page/);
  assert.match(
    imageMetadataRejection(image({ sourcePageUrl: "https://commons.wikimedia.org/wiki/File:%ZZ" }))!,
    /File page/
  );
  assert.match(imageMetadataRejection(image({ photographer: "Unknown" }))!, /photographer/);
  for (const photographer of [
    "Unknown photographer",
    "Photographer not stated",
    "Not specified",
    "No photographer named",
    "No machine-readable author provided",
    "Not applicable",
    "See source",
    "Multiple authors",
    "Not given",
    "Uncredited",
    "The uploader",
    "Self-made",
    "No data available",
    "See above",
    "Original source",
    "Own work",
    "Uploader",
    "Unidentified artist",
    "Various authors",
    "미상",
    "알 수 없음",
    "촬영자 미상",
    "본인 촬영",
    "업로더",
  ]) {
    assert.match(imageMetadataRejection(image({ photographer }))!, /photographer/);
  }
  assert.match(imageMetadataRejection(image({ licenseUrl: null }))!, /license/);
  assert.match(imageMetadataRejection(image({ mediaSha1: null }))!, /SHA-1/);
  assert.match(imageMetadataRejection(image({ mediaSha1: "abcd" }))!, /SHA-1/);
  assert.match(imageMetadataRejection(image({ width: 1_599 }))!, /smaller/);
  assert.match(imageMetadataRejection(image({ mime: "image/svg+xml" }))!, /MIME/);
});

test("Wikimedia SHA-1 normalization accepts the API's 40-character hex form", () => {
  assert.equal(normalizedWikimediaSha1(RAINIER_MEDIA_SHA1.toUpperCase()), RAINIER_MEDIA_SHA1);
  assert.equal(normalizedWikimediaSha1("0123456789abcdefghijklmnopqrstu"), null);
  assert.equal(normalizedWikimediaSha1("abcd"), null);
  assert.equal(normalizedWikimediaSha1(null), null);
});

test("article photo order keeps the lead then exact named alternatives and drops maps", () => {
  assert.equal(fileTitleNamesDestination("Mount Rainier", "File:Rainier summit.jpg"), true);
  assert.equal(fileTitleNamesDestination("Mount Rainier", "File:Mount Adams.jpg"), false);
  assert.deepEqual(
    rankedArticlePhotoTitles(article({
      leadImageTitle: "File:Rainier lead.jpg",
      imageTitles: [
        "File:Mount Rainier winter.jpg",
        "File:Washington locator map.png",
        "File:Mount Adams.jpg",
      ],
    }), "Mount Rainier"),
    ["File:Rainier lead.jpg", "File:Mount Rainier winter.jpg"]
  );
  assert.deepEqual(
    rankedArticlePhotoTitles(article({
      title: "관악산",
      language: "ko",
      leadImageTitle: "파일:관악산.jpg",
      imageTitles: [
        "파일:관악산 설경.jpg",
        "파일:관악산 위치 지도.png",
        "파일:북한산.jpg",
      ],
    }), "관악산"),
    ["File:관악산.jpg", "File:관악산 설경.jpg"]
  );
});

test("the reviewed Commons allowlist contains only the sixteen accepted KFS files", () => {
  assert.deepEqual(Object.keys(LISTED_PHOTO_REVIEWED_COMMONS_FILES).sort(), [
    "0164CE419EF8A8BBB87B",
    "09DC0597070CF98C1FD9",
    "1CE83A8BF630D0A07E9A",
    "33463BA61321FCD7F079",
    "3BDE883C882EB9065D76",
    "4F5CA1B51FE2938C6E87",
    "75AF4150F340FE16701D",
    "862F189C5B9F1EB85918",
    "8E2DBAEC5DB4481221F2",
    "93A9A878F282DA759D1D",
    "958AD1411BC49B469BE1",
    "9676E99C140134852220",
    "9F7C04F02A37514A13AD",
    "A6B289B963FB542E24ED",
    "BAFDCE06CE474E7C0E10",
    "D319B2B83A218D9A2C81",
  ]);
  for (const [destinationId, audit] of Object.entries(
    LISTED_PHOTO_REVIEWED_COMMONS_FILES
  )) {
    assert.equal(audit.evidenceType, "reviewed_commons_file");
    assert.equal(audit.destinationId, destinationId);
    assert.equal(audit.requiredListId, "39F59B1A26E9B0818EBE");
    assert.equal(audit.countryCode, "KR");
    assert.ok(audit.fileTitle.startsWith("File:"));
    assert.match(audit.mediaSha1, /^[0-9a-f]{40}$/);
    assert.ok(
      distanceMeters(
        audit.catalogCoordinates.lat,
        audit.catalogCoordinates.lng,
        audit.fileCoordinates.lat,
        audit.fileCoordinates.lng
      ) <= 1_500,
      `${destinationId} reviewed file must stay within 1.5 km of its summit`
    );
  }
  for (const rejectedFile of [
    "File:삼악산 정상 3.jpg",
    "File:설악산 대청봉 정상석.jpg",
    "File:남이바위 축령산 2.jpg",
    "File:Maisan - panoramio.jpg",
    "File:Geumjeong Mountain - panoramio (1).jpg",
    "File:釜山-金井山-姑堂峰.jpg",
    "File:Mt.Taebaek Somunsubong.jpg",
    "File:Seoraksan, Inje-gun, South Korea (Unsplash).jpg",
    "File:Daecheongbong.jpg",
    "File:Seoraksan in the Fall 1- 설악산 단풍.jpg",
    "File:Janggunbong at Taebaeksan.jpg",
    "File:P20170829 135357766 CF79A71D-FBBE-4D67-992A-9044CDEA4E61.jpg",
    "File:Ulleungdo, Ulleung-gun, South Korea (11177344706).jpg",
    "File:Panoramic View of Pyeongnae, Hopyeong, and Onam (2025).jpg",
    "File:Soyosan.jpg",
    "File:Peak of Yumyeong Mountain.JPG",
    "File:Panoramic View at Peak of Yumyeong Mountain 20090110.jpg",
    "File:JM-tb1.jpg",
    "File:Geumjeong Fortress.jpg",
  ]) {
    assert.equal(
      Object.values(LISTED_PHOTO_REVIEWED_COMMONS_FILES)
        .some((audit) => audit.fileTitle === rejectedFile),
      false,
      rejectedFile
    );
  }
});

test("reviewed Commons requests use one exact title and no discovery mechanism", () => {
  const title = LISTED_PHOTO_REVIEWED_COMMONS_FILES["9F7C04F02A37514A13AD"].fileTitle;
  const url = reviewedCommonsFileApiUrl(title);
  assert.equal(url.hostname, "commons.wikimedia.org");
  assert.equal(url.searchParams.get("titles"), title);
  assert.equal(url.searchParams.get("prop"), "imageinfo|coordinates");
  for (const forbidden of [
    "redirects",
    "generator",
    "list",
    "gscoord",
    "gsradius",
    "gslimit",
    "clcategories",
    "clshow",
  ]) {
    assert.equal(url.searchParams.has(forbidden), false, forbidden);
  }
  assert.doesNotMatch(url.toString(), /P373|geosearch|categor/iu);
  assert.throws(
    () => reviewedCommonsFileApiUrl(title.replace("File:", "")),
    /not canonical/
  );
});

test("all sixteen exact reviewed Commons bindings yield pending-review evidence", async () => {
  for (const audit of Object.values(LISTED_PHOTO_REVIEWED_COMMONS_FILES)) {
    const calls: string[] = [];
    const unexpected = async (): Promise<never> => {
      assert.fail("a pinned reviewed Commons row must not enter article discovery");
    };
    const plan = await planListedPhotoCandidate(reviewedRow(audit), client({
      resolveWikidataArticle: unexpected,
      searchWikipediaArticles: unexpected,
      fetchWikipediaArticle: unexpected,
      fetchWikidataLeadImage: unexpected,
      async fetchReviewedCommonsFile(fileTitle) {
        calls.push(fileTitle);
        assert.equal(fileTitle, audit.fileTitle);
        return reviewedImage(audit);
      },
      fetchImageMetadata: unexpected,
    }));

    assert.equal(plan.kind, "candidate");
    if (plan.kind !== "candidate") assert.fail("expected reviewed Commons candidate");
    assert.deepEqual(calls, [audit.fileTitle]);
    assert.equal(plan.candidate.destinationId, audit.destinationId);
    assert.equal(plan.candidate.matchedArticleTitle, null);
    assert.equal(plan.candidate.matchedWikidataId, audit.catalogWikidataId);
    assert.equal(plan.candidate.catalogWikidataId, audit.catalogWikidataId);
    assert.equal(plan.candidate.mediaSha1, audit.mediaSha1);
    assert.equal(plan.candidate.sourceKind, "wikimedia_commons");
    assert.equal(plan.candidate.evidence.type, "reviewed_commons_file");
    if (plan.candidate.evidence.type !== "reviewed_commons_file") {
      assert.fail("expected reviewed Commons evidence");
    }
    assert.equal(plan.candidate.evidence.destinationId, audit.destinationId);
    assert.equal(plan.candidate.evidence.requiredListId, audit.requiredListId);
    assert.equal(plan.candidate.evidence.fileTitle, audit.fileTitle);
    assert.deepEqual(
      plan.candidate.evidence.catalogCoordinates,
      audit.catalogCoordinates
    );
    assert.match(plan.candidate.notes ?? "", /Human-reviewed exact Commons file/);
    assert.match(plan.candidate.notes ?? "", /Framing requires human review/);
    assert.equal("heroImage" in plan.candidate, false);
  }
});

test("reviewed Commons bindings fail closed when the frozen catalog identity changes", async () => {
  const audit = LISTED_PHOTO_REVIEWED_COMMONS_FILES["8E2DBAEC5DB4481221F2"];
  const cases: Array<[string, Partial<ListedPhotoGapRow>]> = [
    ["name", { name: "덕숭산" }],
    ["country", { country_code: "KP" }],
    ["list", { list_ids: ["another-list"] }],
    ["Wikidata", { wikidata_id: "Q123" }],
    ["catalog coordinate", { lat: audit.catalogCoordinates.lat + 0.001 }],
  ];

  for (const [label, override] of cases) {
    let calls = 0;
    const plan = await planListedPhotoCandidate(reviewedRow(audit, override), client({
      async fetchReviewedCommonsFile() {
        calls += 1;
        return reviewedImage(audit);
      },
    }));
    assert.equal(plan.kind, "miss", label);
    if (plan.kind !== "miss") assert.fail(`expected ${label} to fail`);
    assert.equal(plan.code, "reviewed_commons_catalog_changed", label);
    assert.equal(calls, 0, `${label} drift must fail before a Commons request`);
  }
});

test("reviewed Commons bindings reject every frozen file-metadata change", async () => {
  const audit = LISTED_PHOTO_REVIEWED_COMMONS_FILES["9F7C04F02A37514A13AD"];
  const cases: Array<[string, Partial<WikimediaImageMetadata>]> = [
    ["title", { fileTitle: "File:Different mountain.jpg" }],
    ["redirect", { fileTitleAliases: [audit.fileTitle] }],
    ["source", { sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Different.jpg" }],
    [
      "source title case",
      {
        sourcePageUrl:
          `https://commons.wikimedia.org/wiki/${encodeURIComponent(audit.fileTitle.toUpperCase())}`,
      },
    ],
    ["author", { photographer: "Another photographer" }],
    ["license", { licenseName: "CC BY-SA 3.0" }],
    ["width", { width: audit.width + 1 }],
    ["height", { height: audit.height + 1 }],
    ["SHA-1", { mediaSha1: "0123456789abcdef0123456789abcdef01234567" }],
    ["missing coordinate", { coordinates: null }],
    ["duplicate coordinate", { coordinateCount: 2 }],
    [
      "moved coordinate",
      { coordinates: { lat: audit.fileCoordinates.lat + 0.001, lng: audit.fileCoordinates.lng } },
    ],
  ];

  for (const [label, override] of cases) {
    const plan = await planListedPhotoCandidate(reviewedRow(audit), client({
      async fetchReviewedCommonsFile() {
        return reviewedImage(audit, override);
      },
    }));
    assert.equal(plan.kind, "miss", label);
    if (plan.kind !== "miss") assert.fail(`expected ${label} to fail`);
    assert.equal(plan.code, "reviewed_commons_file_changed", label);
    assert.equal(plan.rejectedImages?.length, 1, label);
  }
});

test("a pinned reviewed Commons row never falls through after an exact-file miss", async () => {
  const audit = LISTED_PHOTO_REVIEWED_COMMONS_FILES["9676E99C140134852220"];
  let articleCalls = 0;
  const unexpectedArticleCall = async (): Promise<never> => {
    articleCalls += 1;
    assert.fail("pinned rows must not fall through to article discovery");
  };
  const plan = await planListedPhotoCandidate(reviewedRow(audit), client({
    resolveWikidataArticle: unexpectedArticleCall,
    searchWikipediaArticles: unexpectedArticleCall,
    fetchWikipediaArticle: unexpectedArticleCall,
    fetchWikidataLeadImage: unexpectedArticleCall,
    async fetchReviewedCommonsFile() {
      return null;
    },
    fetchImageMetadata: unexpectedArticleCall,
  }));
  assert.equal(plan.kind, "miss");
  if (plan.kind !== "miss") assert.fail("expected exact-file miss");
  assert.equal(plan.code, "reviewed_commons_file_unresolved");
  assert.equal(articleCalls, 0);
});

test("a pinned row resolves SHA-less review history with exact Commons requests", async () => {
  const audit = LISTED_PHOTO_REVIEWED_COMMONS_FILES.D319B2B83A218D9A2C81;
  const historicalSource = "https://commons.wikimedia.org/wiki/File:Old_Hwangmaesan.jpg";
  const calls: string[] = [];
  const plan = await planListedPhotoCandidate(reviewedRow(audit, {
    existing_source_page_urls: [historicalSource],
    existing_source_page_urls_without_sha: [historicalSource],
  }), client({
    async fetchReviewedCommonsFile(fileTitle) {
      calls.push(fileTitle);
      return null;
    },
  }));
  assert.equal(plan.kind, "miss");
  if (plan.kind !== "miss") assert.fail("expected unresolved history miss");
  assert.equal(plan.code, "historical_source_identity_unresolved");
  assert.deepEqual(calls, ["File:Old Hwangmaesan.jpg"]);
});

test("stored Wikidata identity yields a pending candidate, never a hero-image write", async () => {
  const plan = await planListedPhotoCandidate(row(), client());
  assert.equal(plan.kind, "candidate");
  if (plan.kind !== "candidate") assert.fail("expected a candidate");
  assert.equal(plan.candidate.destinationId, "dest-rainier");
  assert.equal(plan.candidate.matchedWikidataId, "Q194057");
  assert.equal(plan.candidate.evidence.type, "wikipedia_article");
  assert.equal(plan.candidate.sourceKind, "wikimedia_commons");
  assert.equal(plan.candidate.imageWidth, 4_000);
  assert.equal(plan.candidate.mediaSha1, RAINIER_MEDIA_SHA1);
  assert.match(plan.candidate.notes ?? "", /Framing requires human review/);
  assert.equal("heroImage" in plan.candidate, false);
});

test("a stored Wikidata point anchors a matching Korean article without article coordinates", async () => {
  const calls: string[] = [];
  const koreanRow = row({
    id: "dest-gwanaksan",
    name: "관악산",
    country_code: "KR",
    lat: 37.4451398,
    lng: 126.9642379,
    wikidata_id: "Q626275",
  });
  const plan = await planListedPhotoCandidate(koreanRow, client({
    async resolveWikidataArticle(wikidataId, language) {
      calls.push(`identity:${language}`);
      return {
        wikidataId,
        articleTitle: "관악산",
        articleLanguage: "ko",
        coordinates: { lat: 37.4451398, lng: 126.9642379 },
      };
    },
    async fetchWikipediaArticle(title, language) {
      calls.push(`article:${language}:${title}`);
      return article({
        title: "관악산",
        language: "ko",
        wikidataId: "Q626275",
        coordinates: null,
        leadImageTitle: "File:Gwanaksan.jpg",
        imageTitles: ["File:Gwanaksan.jpg"],
      });
    },
    async fetchImageMetadata(titles, language) {
      calls.push(`images:${language}`);
      return titles.map((fileTitle) => image({ fileTitle }));
    },
  }));
  assert.equal(plan.kind, "candidate");
  if (plan.kind !== "candidate") assert.fail("expected Korean candidate");
  assert.deepEqual(calls, ["identity:ko", "article:ko:관악산", "images:ko"]);
  assert.match(plan.candidate.notes ?? "", /Korean Wikipedia article 관악산/);
});

test("a stored Korean Wikidata identity can fall back to its English sitelink", async () => {
  const plan = await planListedPhotoCandidate(row({
    id: "dest-korean-peak",
    name: "한국봉",
    country_code: "KR",
    lat: 37.0,
    lng: 127.0,
    wikidata_id: "Q123",
  }), client({
    async resolveWikidataArticle(wikidataId, language) {
      assert.equal(language, "ko");
      return {
        wikidataId,
        articleTitle: "Hangukbong",
        articleLanguage: "en",
        coordinates: { lat: 37.0, lng: 127.0 },
      };
    },
    async fetchWikipediaArticle(title, language) {
      assert.equal(title, "Hangukbong");
      assert.equal(language, "en");
      return article({
        title,
        language,
        wikidataId: "Q123",
        coordinates: null,
        leadImageTitle: "File:Hangukbong.jpg",
        imageTitles: ["File:Hangukbong.jpg"],
      });
    },
    async fetchImageMetadata(titles) {
      return titles.map((fileTitle) => image({
        fileTitle,
        sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Hangukbong.jpg",
      }));
    },
  }));
  assert.equal(plan.kind, "candidate");
  if (plan.kind !== "candidate") assert.fail("expected English fallback candidate");
  assert.match(plan.candidate.notes ?? "", /English Wikipedia article Hangukbong/);
});

test("only the two frozen Korean P18 audits can add pending candidates", async () => {
  assert.deepEqual(
    Object.keys(LISTED_PHOTO_AUDITED_WIKIDATA_P18_PHOTOS).sort(),
    ["Q5208179", "Q8533668"]
  );
  const cases = [
    {
      wikidataId: "Q5208179",
      destinationId: "dest-daedunsan",
      destinationName: "Daedunsan",
      articleTitle: "대둔산 (충남/전북)",
      articleLanguage: "ko" as const,
      lat: 36.124594,
      lng: 127.3204771,
      imageUrl:
        "https://upload.wikimedia.org/wikipedia/commons/a/a8/Chilseongbong_at_Daedunsan.jpg",
      sourcePageUrl:
        "https://commons.wikimedia.org/wiki/File:Chilseongbong_at_Daedunsan.jpg",
    },
    {
      wikidataId: "Q8533668",
      destinationId: "dest-minjujisan",
      destinationName: "민주지산",
      articleTitle: "민주지산",
      articleLanguage: "ko" as const,
      lat: 36.0397937,
      lng: 127.8492728,
      imageUrl:
        "https://upload.wikimedia.org/wikipedia/commons/3/35/Minjujisan_Muju.jpg",
      sourcePageUrl:
        "https://commons.wikimedia.org/wiki/File:Minjujisan_Muju.jpg",
    },
  ];

  for (const fixture of cases) {
    const audited = LISTED_PHOTO_AUDITED_WIKIDATA_P18_PHOTOS[fixture.wikidataId];
    const calls: string[] = [];
    const plan = await planListedPhotoCandidate(row({
      id: fixture.destinationId,
      name: fixture.destinationName,
      lat: fixture.lat,
      lng: fixture.lng,
      country_code: "KR",
      wikidata_id: fixture.wikidataId,
    }), client({
      async resolveWikidataArticle(wikidataId, language) {
        calls.push(`identity:${language}`);
        return {
          wikidataId,
          articleTitle: fixture.articleTitle,
          articleLanguage: fixture.articleLanguage,
          coordinates: { lat: fixture.lat, lng: fixture.lng },
        };
      },
      async fetchWikipediaArticle(title, language) {
        calls.push(`article:${language}:${title}`);
        return article({
          title,
          language,
          wikidataId: fixture.wikidataId,
          coordinates: null,
          leadImageTitle: null,
          imageTitles: [],
        });
      },
      async fetchWikidataLeadImage(wikidataId) {
        calls.push(`p18:${wikidataId}`);
        return { wikidataId, fileTitle: audited.fileTitle };
      },
      async fetchImageMetadata(titles, language) {
        calls.push(`images:${language}`);
        assert.deepEqual(titles, [audited.fileTitle]);
        return [image({
          fileTitle: audited.fileTitle,
          imageUrl: fixture.imageUrl,
          sourcePageUrl: fixture.sourcePageUrl,
          photographer: audited.photographer,
          licenseName: audited.licenseName,
          licenseUrl: audited.licenseUrl,
          width: audited.width,
          height: audited.height,
          mediaSha1: audited.mediaSha1,
        })];
      },
    }));

    assert.equal(plan.kind, "candidate");
    if (plan.kind !== "candidate") assert.fail("expected an audited P18 candidate");
    assert.equal(plan.candidate.destinationId, fixture.destinationId);
    assert.equal(plan.candidate.matchedWikidataId, fixture.wikidataId);
    assert.equal(plan.candidate.sourcePageUrl, fixture.sourcePageUrl);
    assert.equal(plan.candidate.photographer, audited.photographer);
    assert.equal(plan.candidate.licenseName, "CC BY-SA 3.0");
    assert.equal(plan.candidate.mediaSha1, audited.mediaSha1);
    assert.equal(plan.candidate.evidence.type, "wikipedia_article");
    if (plan.candidate.evidence.type !== "wikipedia_article") {
      assert.fail("expected article-anchored P18 evidence");
    }
    assert.equal(plan.candidate.evidence.discovery, "audited_wikidata_p18");
    assert.match(plan.candidate.notes ?? "", /human-audited same-entity Wikidata P18/);
    assert.match(plan.candidate.notes ?? "", /Framing requires human review/);
    assert.equal("heroImage" in plan.candidate, false);
    assert.deepEqual(calls, [
      "identity:ko",
      `article:${fixture.articleLanguage}:${fixture.articleTitle}`,
      `p18:${fixture.wikidataId}`,
      `images:${fixture.articleLanguage}`,
    ]);
  }
});

test("article images stay ahead of the audited Wikidata P18 fallback", async () => {
  let p18Called = false;
  const plan = await planListedPhotoCandidate(row({
    id: "dest-daedunsan",
    name: "Daedunsan",
    country_code: "KR",
    lat: 36.124594,
    lng: 127.3204771,
    wikidata_id: "Q5208179",
  }), client({
    async resolveWikidataArticle(wikidataId) {
      return {
        wikidataId,
        articleTitle: "Daedunsan",
        articleLanguage: "en",
        coordinates: { lat: 36.124594, lng: 127.3204771 },
      };
    },
    async fetchWikipediaArticle() {
      return article({
        title: "Daedunsan",
        language: "en",
        wikidataId: "Q5208179",
        coordinates: null,
        leadImageTitle: "File:Daedunsan autumn.jpg",
        imageTitles: ["File:Daedunsan autumn.jpg"],
      });
    },
    async fetchWikidataLeadImage() {
      p18Called = true;
      return null;
    },
    async fetchImageMetadata(titles) {
      return titles.map((fileTitle) => image({
        fileTitle,
        sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Daedunsan_autumn.jpg",
      }));
    },
  }));
  assert.equal(plan.kind, "candidate");
  if (plan.kind !== "candidate") assert.fail("expected the article image candidate");
  assert.equal(p18Called, false);
  assert.match(plan.candidate.notes ?? "", /article lead image/);
  assert.doesNotMatch(plan.candidate.notes ?? "", /Wikidata P18/);
});

test("P18 discovery stays closed to every Wikidata item outside the frozen audits", async () => {
  let p18Called = false;
  assert.equal(
    await planCode(row(), client({
      async fetchWikipediaArticle() {
        return article({ leadImageTitle: null, imageTitles: [] });
      },
      async fetchWikidataLeadImage() {
        p18Called = true;
        return {
          wikidataId: "Q194057",
          fileTitle: "File:Mount Rainier from Paradise.jpg",
        };
      },
    })),
    "no_named_article_photo"
  );
  assert.equal(p18Called, false);
});

test("an audited P18 file must keep its frozen image identity and credit", async () => {
  const audited = LISTED_PHOTO_AUDITED_WIKIDATA_P18_PHOTOS.Q5208179;
  const plan = await planListedPhotoCandidate(row({
    id: "dest-daedunsan",
    name: "Daedunsan",
    country_code: "KR",
    lat: 36.124594,
    lng: 127.3204771,
    wikidata_id: audited.wikidataId,
  }), client({
    async resolveWikidataArticle(wikidataId) {
      return {
        wikidataId,
        articleTitle: "Daedunsan",
        articleLanguage: "en",
        coordinates: { lat: 36.124594, lng: 127.3204771 },
      };
    },
    async fetchWikipediaArticle() {
      return article({
        title: "Daedunsan",
        language: "en",
        wikidataId: audited.wikidataId,
        coordinates: null,
        leadImageTitle: null,
        imageTitles: [],
      });
    },
    async fetchWikidataLeadImage(wikidataId) {
      return { wikidataId, fileTitle: audited.fileTitle };
    },
    async fetchImageMetadata() {
      return [image({
        fileTitle: audited.fileTitle,
        sourcePageUrl:
          "https://commons.wikimedia.org/wiki/File:Chilseongbong_at_Daedunsan.jpg",
        photographer: audited.photographer,
        licenseName: audited.licenseName,
        licenseUrl: audited.licenseUrl,
        width: audited.width,
        height: audited.height,
        mediaSha1: RAINIER_MEDIA_SHA1,
      })];
    },
  }));
  if (plan.kind !== "miss") assert.fail("changed media must not enter review");
  assert.equal(plan.code, "no_usable_new_source");
  assert.match(plan.rejectedImages?.[0] ?? "", /SHA-1 changed from the human-audited/);
});

test("stored Wikidata does not excuse conflicting Korean article coordinates", async () => {
  assert.equal(
    await planCode(row({
      name: "관악산",
      country_code: "KR",
      lat: 37.4451398,
      lng: 126.9642379,
      wikidata_id: "Q626275",
    }), client({
      async resolveWikidataArticle(wikidataId) {
        return {
          wikidataId,
          articleTitle: "관악산",
          articleLanguage: "ko",
          coordinates: { lat: 37.4451398, lng: 126.9642379 },
        };
      },
      async fetchWikipediaArticle() {
        return article({
          title: "관악산",
          language: "ko",
          wikidataId: "Q626275",
          coordinates: { lat: 35.0, lng: 129.0 },
        });
      },
    })),
    "wikipedia_identity_too_far"
  );
});

test("a redirected article File title keeps its canonical image metadata", async () => {
  const oldTitle = "File:Old Rainier lead.jpg";
  const plan = await planListedPhotoCandidate(row(), client({
    async fetchWikipediaArticle() {
      return article({ leadImageTitle: oldTitle, imageTitles: [oldTitle] });
    },
    async fetchImageMetadata() {
      return [image({
        fileTitle: "File:Mount Rainier from Paradise.jpg",
        fileTitleAliases: [oldTitle],
      })];
    },
  }));
  assert.equal(plan.kind, "candidate");
  if (plan.kind !== "candidate") assert.fail("expected redirected metadata candidate");
  assert.match(plan.candidate.sourcePageUrl, /Mount_Rainier_from_Paradise/);
});

test("a pending review skips every Wikimedia request", async () => {
  let called = false;
  const fake = client({
    async resolveWikidataArticle() {
      called = true;
      return null;
    },
  });
  const plan = await planListedPhotoCandidate(row({ has_pending_candidate: true }), fake);
  assert.equal(plan.kind, "skip");
  assert.equal(called, false);
});

test("identity checks reject bad IDs, distance, missing coordinates, mismatch, and ambiguity", async () => {
  assert.equal(
    await planCode(row({ wikidata_id: "rainier" }), client()),
    "wikidata_id_invalid"
  );
  assert.equal(
    await planCode(row(), client({
      async resolveWikidataArticle(wikidataId) {
        return {
          wikidataId,
          articleTitle: "Mount Rainier",
          articleLanguage: "en",
          coordinates: { lat: 40, lng: -105 },
        };
      },
    })),
    "wikidata_identity_too_far"
  );
  assert.equal(
    await planCode(row(), client({
      async resolveWikidataArticle(wikidataId) {
        return {
          wikidataId,
          articleTitle: "Mount Rainier",
          articleLanguage: "en",
          coordinates: null,
        };
      },
    })),
    "wikidata_identity_incomplete"
  );
  assert.equal(
    await planCode(row(), client({
      async fetchWikipediaArticle() {
        return article({ title: "Mount Adams" });
      },
    })),
    "wikipedia_identity_mismatch"
  );
  assert.equal(
    await planCode(row(), client({
      async fetchWikipediaArticle() {
        return article({ wikidataId: "Q999", coordinates: null });
      },
    })),
    "wikipedia_identity_mismatch"
  );
  assert.equal(
    await planCode(row({ wikidata_id: null }), client({
      async searchWikipediaArticles() {
        return [
          {
            title: "Mount Rainier",
            language: "en",
            coordinates: { lat: 46.8523, lng: -121.7603 },
          },
          {
            title: "Mount Rainier (duplicate)",
            language: "en",
            coordinates: { lat: 46.8524, lng: -121.7604 },
          },
        ];
      },
    })),
    "ambiguous_article"
  );
});

test("a destination without stored Wikidata still needs one unique exact anchored article", async () => {
  const plan = await planListedPhotoCandidate(row({ wikidata_id: null }), client());
  assert.equal(plan.kind, "candidate");
  assert.equal(
    await planCode(row({ wikidata_id: null }), client({
      async searchWikipediaArticles() {
        return [{
          title: "Mount Adams",
          language: "en",
          coordinates: { lat: 46.8523, lng: -121.7603 },
        }];
      },
    })),
    "no_exact_article"
  );
  assert.equal(
    await planCode(row({ wikidata_id: null }), client({
      async fetchWikipediaArticle() {
        return article({ coordinates: null });
      },
    })),
    "wikipedia_identity_incomplete"
  );
});

test("a denied image stays final across Wikimedia host variants and renamed File aliases", async () => {
  const denied = "https://en.wikipedia.org/wiki/File:Old_Rainier_name.jpg";
  const otherSha1 = "1123456789abcdef0123456789abcdef01234567";
  let metadataCalls = 0;
  const plan = await planListedPhotoCandidate(
    row({
      existing_source_page_urls: [denied],
      existing_source_page_urls_without_sha: [denied],
    }),
    client({
      async fetchImageMetadata(titles) {
        metadataCalls += 1;
        if (metadataCalls === 1) {
          assert.deepEqual(titles, ["File:Old Rainier name.jpg"]);
          return [image({
            fileTitle: "File:Mount Rainier from Paradise.jpg",
            fileTitleAliases: ["File:Old Rainier name.jpg"],
            sourcePageUrl:
              "https://commons.wikimedia.org/wiki/File:Mount_Rainier_from_Paradise.jpg",
            mediaSha1: RAINIER_MEDIA_SHA1,
          })];
        }
        return titles.map((fileTitle, index) =>
          index === 0
            ? image({
                fileTitle,
                sourcePageUrl:
                  "https://commons.wikimedia.org/wiki/File:Mount_Rainier_from_Paradise.jpg",
                mediaSha1: RAINIER_MEDIA_SHA1,
              })
            : image({
                fileTitle,
                imageUrl: "https://upload.wikimedia.org/wikipedia/commons/b/bb/Rainier_northwest.jpg",
                sourcePageUrl:
                  "https://commons.wikimedia.org/wiki/File:Mount_Rainier_northwest.jpg",
                mediaSha1: otherSha1,
              })
        );
      },
    })
  );
  assert.equal(plan.kind, "candidate");
  if (plan.kind !== "candidate") assert.fail("expected an alternative candidate");
  assert.match(plan.candidate.sourcePageUrl, /northwest/);
  assert.match(plan.rejectedImages[0], /already reviewed or pending/);
  assert.equal(plan.candidate.mediaSha1, otherSha1);
});

test("an unresolved legacy Wikimedia review blocks a renamed-image proposal", async () => {
  const denied = "https://commons.wikimedia.org/wiki/File:Deleted_Rainier.jpg";
  assert.equal(
    await planCode(
      row({
        existing_source_page_urls: [denied],
        existing_source_page_urls_without_sha: [denied],
      }),
      client({
        async fetchImageMetadata() {
          return [];
        },
      })
    ),
    "historical_source_identity_unresolved"
  );
});

test("source identity treats percent escapes, spaces, and underscores as the same File page", () => {
  assert.equal(
    sourcePageKey("https://commons.wikimedia.org/wiki/File:Mount_Rainier.jpg"),
    sourcePageKey("https://commons.wikimedia.org/wiki/File:Mount%20Rainier.jpg")
  );
  assert.equal(
    sourcePageKey("https://commons.wikimedia.org/wiki/File:Mount_Rainier.jpg"),
    sourcePageKey("https://en.wikipedia.org/wiki/File:Mount_Rainier.jpg")
  );
  assert.equal(
    sourcePageKey("https://commons.wikimedia.org/wiki/File:Mount_Rainier.jpg"),
    sourcePageKey("https://ko.wikipedia.org/wiki/File:Mount_Rainier.jpg")
  );
});

class QueryStub implements Queryable {
  readonly calls: Array<{ text: string; values?: unknown[] }> = [];

  constructor(private readonly results: Array<{ rows: Record<string, unknown>[]; rowCount?: number }>) {}

  async query(text: string, values?: unknown[]) {
    this.calls.push({ text, values });
    const result = this.results.shift();
    if (!result) throw new Error("unexpected query");
    return result;
  }
}

function currentState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Mount Rainier",
    lat: 46.8523,
    lng: -121.7603,
    country_code: "US",
    wikidata_id: "Q194057",
    list_ids: ["state-high-points"],
    has_usable_cover: false,
    has_pending_candidate: false,
    ...overrides,
  };
}

async function candidate() {
  const plan = await planListedPhotoCandidate(row(), client());
  if (plan.kind !== "candidate") assert.fail("expected candidate fixture");
  return plan.candidate;
}

test("queue inserts only a pending review row and never writes hero_image", async () => {
  const stub = new QueryStub([
    { rows: [currentState()] },
    { rows: [] },
    { rows: [], rowCount: 1 },
  ]);
  assert.equal(await queueListedPhotoCandidate(stub, await candidate()), "inserted");
  assert.match(stub.calls[0].text, /d\.owner = 'peaks'/);
  assert.match(stub.calls[0].text, /l\.owner = 'peaks'/);
  assert.match(stub.calls[2].text, /INSERT INTO destination_photo_candidates/);
  assert.match(stub.calls[2].text, /ON CONFLICT[\s\S]*DO NOTHING/);
  assert.match(stub.calls[2].text, /media_sha1/);
  assert.doesNotMatch(stub.calls[2].text, /UPDATE destinations|hero_image\s*=/);
});

test("queue rechecks current cover, pending state, and normalized source history", async () => {
  const cover = new QueryStub([{ rows: [currentState({ has_usable_cover: true })] }]);
  assert.equal(await queueListedPhotoCandidate(cover, await candidate()), "already_covered");

  const pending = new QueryStub([{ rows: [currentState({ has_pending_candidate: true })] }]);
  assert.equal(await queueListedPhotoCandidate(pending, await candidate()), "pending_review");

  const seen = new QueryStub([
    { rows: [currentState()] },
    { rows: [{ source_page_url: "https://commons.wikimedia.org/wiki/File:Mount%20Rainier_from_Paradise.jpg" }] },
  ]);
  assert.equal(await queueListedPhotoCandidate(seen, await candidate()), "history_changed");
  assert.equal(seen.calls.length, 2, "changed review history must never reach INSERT");

  const candidateWithSeenIdentity = {
    ...(await candidate()),
    reviewHistoryFingerprint: listedPhotoReviewHistoryFingerprint(
      ["https://commons.wikimedia.org/wiki/File:Renamed.jpg"],
      [RAINIER_MEDIA_SHA1]
    ),
  };
  const seenSha1 = new QueryStub([
    { rows: [currentState()] },
    { rows: [{
      source_page_url: "https://commons.wikimedia.org/wiki/File:Renamed.jpg",
      media_sha1: RAINIER_MEDIA_SHA1,
    }] },
  ]);
  assert.equal(await queueListedPhotoCandidate(seenSha1, candidateWithSeenIdentity), "source_seen");
  assert.equal(seenSha1.calls.length, 2, "a reviewed SHA-1 must never reach INSERT");
});

test("queue fails closed when review history changes after Wikimedia research", async () => {
  const planned = await candidate();
  const historyChanged = new QueryStub([
    { rows: [currentState()] },
    { rows: [{
      source_page_url: "https://en.wikipedia.org/wiki/File:Rainier_renamed_after_review.jpg",
      media_sha1: null,
    }] },
  ]);

  assert.equal(await queueListedPhotoCandidate(historyChanged, planned), "history_changed");
  assert.equal(historyChanged.calls.length, 2, "history drift must never reach INSERT");
});

test("a manual-first pending race suppresses the listed-photo backfill", async () => {
  const stub = new QueryStub([
    { rows: [currentState()] },
    { rows: [] },
    { rows: [], rowCount: 0 },
    { rows: [{
      has_usable_cover: false,
      has_pending_candidate: true,
      has_seen_source: false,
    }] },
  ]);
  assert.equal(await queueListedPhotoCandidate(stub, await candidate()), "pending_review");
  assert.match(stub.calls[2].text, /ON CONFLICT DO NOTHING/);
  assert.match(stub.calls[2].text, /'listed_photo_backfill'/);
  assert.match(stub.calls[3].text, /status = 'pending'/);
});

test("photo identity migration preserves manual alternatives and guards the automated writer", async () => {
  const migration = await readFile(
    path.resolve(__dirname, "../../../migrations/20260830_destination_photo_candidate_identity.sql"),
    "utf8"
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS media_sha1 TEXT/);
  assert.match(migration, /media_sha1 ~ '\^\[0-9a-f\]\{40\}\$'/);
  assert.match(migration, /candidate_origin TEXT NOT NULL DEFAULT 'manual'/);
  assert.match(
    migration,
    /UNIQUE INDEX IF NOT EXISTS uq_destination_photo_candidates_listed_backfill_pending[\s\S]*WHERE status = 'pending'[\s\S]*candidate_origin = 'listed_photo_backfill'/
  );
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS uq_destination_photo_candidates_media_sha1/);
  assert.match(
    migration,
    /PERFORM 1[\s\S]*FROM destinations[\s\S]*FOR UPDATE;[\s\S]*NEW\.candidate_origin = 'listed_photo_backfill'[\s\S]*existing\.status = 'pending'[\s\S]*RETURN NULL;/
  );
  assert.match(
    migration,
    /BEFORE INSERT OR UPDATE OF status, destination_id, candidate_origin/
  );

  const manifestImporter = await readFile(
    path.resolve(__dirname, "../import-destination-photo-candidates.ts"),
    "utf8"
  );
  assert.match(manifestImporter, /'manifest_import'/);
  assert.doesNotMatch(
    migration,
    /ON destination_photo_candidates \(destination_id\)\s*WHERE status = 'pending';/,
    "a later reviewed manual or manifest alternative must stay allowed"
  );
});

test("queue refuses a destination identity that changed after research", async () => {
  const moved = new QueryStub([{ rows: [currentState({ lat: 47 })] }]);
  assert.equal(await queueListedPhotoCandidate(moved, await candidate()), "identity_changed");
  assert.equal(moved.calls.length, 1);

  const relinked = new QueryStub([{ rows: [currentState({ wikidata_id: "Q999" })] }]);
  assert.equal(await queueListedPhotoCandidate(relinked, await candidate()), "identity_changed");
  assert.equal(relinked.calls.length, 1);

  const countryChanged = new QueryStub([{ rows: [currentState({ country_code: "CA" })] }]);
  assert.equal(await queueListedPhotoCandidate(countryChanged, await candidate()), "identity_changed");
  assert.equal(countryChanged.calls.length, 1);
});

test("queue rechecks the exact KFS list and nullable Wikidata binding", async () => {
  const audit = LISTED_PHOTO_REVIEWED_COMMONS_FILES["958AD1411BC49B469BE1"];
  const plan = await planListedPhotoCandidate(reviewedRow(audit), client({
    async fetchReviewedCommonsFile() {
      return reviewedImage(audit);
    },
  }));
  if (plan.kind !== "candidate") assert.fail("expected reviewed Commons candidate");
  const state = {
    name: audit.destinationName,
    lat: audit.catalogCoordinates.lat,
    lng: audit.catalogCoordinates.lng,
    country_code: audit.countryCode,
    wikidata_id: audit.catalogWikidataId,
    list_ids: [audit.requiredListId],
    has_usable_cover: false,
    has_pending_candidate: false,
  };

  const leftList = new QueryStub([{ rows: [{ ...state, list_ids: ["other-list"] }] }]);
  assert.equal(
    await queueListedPhotoCandidate(leftList, plan.candidate),
    "identity_changed"
  );
  assert.equal(leftList.calls.length, 1);
  assert.match(leftList.calls[0].text, /ARRAY\([\s\S]*list_destinations/);

  const gainedWikidata = new QueryStub([{ rows: [{ ...state, wikidata_id: "Q123" }] }]);
  assert.equal(
    await queueListedPhotoCandidate(gainedWikidata, plan.candidate),
    "identity_changed"
  );
  assert.equal(gainedWikidata.calls.length, 1);
});

test("audit reports the whole gap set, limit deferrals, pending review, and $0 fixed cost", async () => {
  const { audit, candidates } = await buildListedPhotoAudit(
    [
      row(),
      row({ id: "pending", has_pending_candidate: true }),
      row({ id: "deferred", name: "Mount Rainier" }),
    ],
    { apply: false, limit: 1, auditOutput: null },
    client()
  );
  assert.equal(audit.mode, "dry-run");
  assert.equal(audit.fixedMonthlyCostUsd, 0);
  assert.equal(audit.totals.coverGaps, 3);
  assert.equal(audit.totals.inspected, 1);
  assert.equal(audit.totals.pendingReview, 1);
  assert.equal(audit.totals.deferredByLimit, 1);
  assert.equal(audit.totals.candidatesFound, 1);
  assert.equal(candidates.length, 1);
});

test("request failures stay distinct and make an apply audit unsafe", async () => {
  const { audit } = await buildListedPhotoAudit(
    [row()],
    { apply: true, limit: null, auditOutput: null },
    client({
      async resolveWikidataArticle() {
        throw new Error("HTTP 429");
      },
    })
  );
  assert.equal(audit.totals.requestErrors, 1);
  assert.equal(audit.details[0].outcome, "request_error");
  assert.equal(audit.totals.candidatesFound, 0);
});

test("audit output is staged before publish and rejects a directory target", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "peaks-listed-photo-audit-"));
  try {
    const { audit } = await buildListedPhotoAudit(
      [row()],
      { apply: false, limit: null, auditOutput: null },
      client()
    );
    await assert.rejects(() => prepareAuditOutput(temporaryDirectory, audit), /is a directory/);

    const outputPath = path.join(temporaryDirectory, "audit.json");
    const prepared = await prepareAuditOutput(outputPath, audit);
    audit.totals.queued = 1;
    await stageAuditOutput(prepared, audit);
    await publishAuditOutput(prepared);
    const written = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(written.totals.queued, 1);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
