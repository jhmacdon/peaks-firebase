import assert from "node:assert/strict";
import test from "node:test";
import {
  buildListedPhotoAudit,
  parseListedPhotoArgs,
  parseWikidataArticleIdentity,
  parseWikipediaArticle,
  parseWikipediaSearchHits,
  parseWikimediaImageMetadata,
  plainMetadataText,
} from "../backfill-listed-destination-photo-candidates";
import {
  LISTED_PHOTO_GAPS_SQL,
  canonicalWikimediaLicenseUrl,
  fileTitleNamesDestination,
  hasCompatibleLicenseRecord,
  imageMetadataRejection,
  planListedPhotoCandidate,
  queueListedPhotoCandidate,
  rankedArticlePhotoTitles,
  serializeListedPhotoGapRow,
  sourcePageKey,
  type ListedPhotoClient,
  type ListedPhotoGapRow,
  type Queryable,
  type WikimediaImageMetadata,
  type WikipediaArticle,
} from "../listed-destination-photo-candidates";

function row(overrides: Partial<ListedPhotoGapRow> = {}): ListedPhotoGapRow {
  return {
    id: "dest-rainier",
    name: "Mount Rainier",
    lat: 46.8523,
    lng: -121.7603,
    wikidata_id: "Q194057",
    list_ids: ["state-high-points"],
    list_names: ["US State High Points"],
    existing_source_page_urls: [],
    has_pending_candidate: false,
    ...overrides,
  };
}

function article(overrides: Partial<WikipediaArticle> = {}): WikipediaArticle {
  return {
    title: "Mount Rainier",
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
    ...overrides,
  };
}

function client(overrides: Partial<ListedPhotoClient> = {}): ListedPhotoClient {
  return {
    async resolveWikidataArticle(wikidataId) {
      return {
        wikidataId,
        articleTitle: "Mount Rainier",
        coordinates: { lat: 46.8523, lng: -121.7603 },
      };
    },
    async searchWikipediaArticles() {
      return [{ title: "Mount Rainier", coordinates: { lat: 46.8523, lng: -121.7603 } }];
    },
    async fetchWikipediaArticle() {
      return article();
    },
    async fetchImageMetadata(titles) {
      return titles.map((fileTitle) => image({ fileTitle }));
    },
    ...overrides,
  };
}

async function planCode(
  candidateRow: ListedPhotoGapRow,
  fakeClient: ListedPhotoClient
): Promise<string> {
  const plan = await planListedPhotoCandidate(candidateRow, fakeClient);
  if (plan.kind === "candidate") assert.fail("expected a skip or miss");
  return plan.code;
}

test("CLI is dry-run by default and requires an explicit, unambiguous --apply", () => {
  assert.deepEqual(parseListedPhotoArgs([]), { apply: false, limit: null, auditOutput: null });
  assert.deepEqual(parseListedPhotoArgs(["--apply", "--limit=25"]), {
    apply: true,
    limit: 25,
    auditOutput: null,
  });
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
  assert.doesNotMatch(LISTED_PHOTO_GAPS_SQL, /LIMIT|list_id = \$/);
});

test("gap rows preserve full list and review history for the audit", () => {
  assert.deepEqual(
    serializeListedPhotoGapRow({
      id: "peak",
      name: "Peak",
      lat: "1.25",
      lng: "-2.5",
      wikidata_id: "Q1",
      list_ids: ["b", "a"],
      list_names: ["B", "A"],
      existing_source_page_urls: ["https://commons.wikimedia.org/wiki/File:X.jpg"],
      has_pending_candidate: true,
    }),
    {
      id: "peak",
      name: "Peak",
      lat: 1.25,
      lng: -2.5,
      wikidata_id: "Q1",
      list_ids: ["b", "a"],
      list_names: ["B", "A"],
      existing_source_page_urls: ["https://commons.wikimedia.org/wiki/File:X.jpg"],
      has_pending_candidate: true,
    }
  );
});

test("Wikidata parser requires an English sitelink and reads P625 coordinates", () => {
  const parsed = parseWikidataArticleIdentity({
    entities: {
      Q194057: {
        sitelinks: { enwiki: { title: "Mount Rainier" } },
        claims: {
          P625: [{ mainsnak: { datavalue: { value: { latitude: 46.8523, longitude: -121.7603 } } } }],
        },
      },
    },
  }, "Q194057");
  assert.deepEqual(parsed, {
    wikidataId: "Q194057",
    articleTitle: "Mount Rainier",
    coordinates: { lat: 46.8523, lng: -121.7603 },
  });
  assert.equal(parseWikidataArticleIdentity({ entities: { Q194057: {} } }, "Q194057"), null);
});

test("Wikipedia parsers retain exact title, Q-id, coordinates, lead image, and article images", () => {
  const hits = parseWikipediaSearchHits({
    query: {
      geosearch: [
        { title: "Mount Rainier", lat: 46.8523, lon: -121.7603 },
        { title: "Broken", lat: "46", lon: -121 },
      ],
    },
  });
  assert.deepEqual(hits, [
    { title: "Mount Rainier", coordinates: { lat: 46.8523, lng: -121.7603 } },
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
  });
  assert.deepEqual(parsed, {
    title: "Mount Rainier",
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

test("imageinfo parser keeps exact URL, artist, license URL, dimensions, and format", () => {
  const parsed = parseWikimediaImageMetadata({
    query: {
      pages: [{
        ns: 6,
        title: "File:Mount Rainier.jpg",
        imageinfo: [{
          url: "https://upload.wikimedia.org/rainier.jpg?utm_source=en.wikipedia.org",
          descriptionurl: "https://commons.wikimedia.org/wiki/File:Mount_Rainier.jpg",
          width: 4_000,
          height: 2_600,
          mime: "image/jpeg",
          mediatype: "BITMAP",
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
    imageUrl: "https://upload.wikimedia.org/rainier.jpg",
    sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Mount_Rainier.jpg",
    photographer: "Jane & Joe",
    licenseName: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    width: 4_000,
    height: 2_600,
    mime: "image/jpeg",
    mediaType: "BITMAP",
  }]);
  assert.equal(plainMetadataText({ value: "<b>Jane</b>&nbsp;Doe" }), "Jane Doe");
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
  assert.match(imageMetadataRejection(image({ licenseUrl: null }))!, /license/);
  assert.match(imageMetadataRejection(image({ width: 1_599 }))!, /smaller/);
  assert.match(imageMetadataRejection(image({ mime: "image/svg+xml" }))!, /MIME/);
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
});

test("stored Wikidata identity yields a pending candidate, never a hero-image write", async () => {
  const plan = await planListedPhotoCandidate(row(), client());
  assert.equal(plan.kind, "candidate");
  if (plan.kind !== "candidate") assert.fail("expected a candidate");
  assert.equal(plan.candidate.destinationId, "dest-rainier");
  assert.equal(plan.candidate.matchedWikidataId, "Q194057");
  assert.equal(plan.candidate.sourceKind, "wikimedia_commons");
  assert.equal(plan.candidate.imageWidth, 4_000);
  assert.match(plan.candidate.notes ?? "", /Framing requires human review/);
  assert.equal("heroImage" in plan.candidate, false);
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
        return { wikidataId, articleTitle: "Mount Rainier", coordinates: { lat: 40, lng: -105 } };
      },
    })),
    "wikidata_identity_too_far"
  );
  assert.equal(
    await planCode(row(), client({
      async resolveWikidataArticle(wikidataId) {
        return { wikidataId, articleTitle: "Mount Rainier", coordinates: null };
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
    await planCode(row({ wikidata_id: null }), client({
      async searchWikipediaArticles() {
        return [
          { title: "Mount Rainier", coordinates: { lat: 46.8523, lng: -121.7603 } },
          { title: "Mount Rainier (duplicate)", coordinates: { lat: 46.8524, lng: -121.7604 } },
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
        return [{ title: "Mount Adams", coordinates: { lat: 46.8523, lng: -121.7603 } }];
      },
    })),
    "no_exact_article"
  );
});

test("a denied source stays final and the planner may choose a different exact article photo", async () => {
  const denied = "https://commons.wikimedia.org/wiki/File:Mount_Rainier_from_Paradise.jpg";
  const plan = await planListedPhotoCandidate(
    row({ existing_source_page_urls: [denied] }),
    client({
      async fetchImageMetadata(titles) {
        return titles.map((fileTitle, index) =>
          index === 0
            ? image({ fileTitle, sourcePageUrl: denied })
            : image({
                fileTitle,
                imageUrl: "https://upload.wikimedia.org/wikipedia/commons/b/bb/Rainier_northwest.jpg",
                sourcePageUrl:
                  "https://commons.wikimedia.org/wiki/File:Mount_Rainier_northwest.jpg",
              })
        );
      },
    })
  );
  assert.equal(plan.kind, "candidate");
  if (plan.kind !== "candidate") assert.fail("expected an alternative candidate");
  assert.match(plan.candidate.sourcePageUrl, /northwest/);
  assert.match(plan.rejectedImages[0], /already reviewed or pending/);
});

test("source identity treats percent escapes, spaces, and underscores as the same File page", () => {
  assert.equal(
    sourcePageKey("https://commons.wikimedia.org/wiki/File:Mount_Rainier.jpg"),
    sourcePageKey("https://commons.wikimedia.org/wiki/File:Mount%20Rainier.jpg")
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
    wikidata_id: "Q194057",
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
  assert.equal(await queueListedPhotoCandidate(seen, await candidate()), "source_seen");
  assert.equal(seen.calls.length, 2, "a reviewed source must never reach INSERT");
});

test("queue refuses a destination identity that changed after research", async () => {
  const moved = new QueryStub([{ rows: [currentState({ lat: 47 })] }]);
  assert.equal(await queueListedPhotoCandidate(moved, await candidate()), "identity_changed");
  assert.equal(moved.calls.length, 1);

  const relinked = new QueryStub([{ rows: [currentState({ wikidata_id: "Q999" })] }]);
  assert.equal(await queueListedPhotoCandidate(relinked, await candidate()), "identity_changed");
  assert.equal(relinked.calls.length, 1);
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
