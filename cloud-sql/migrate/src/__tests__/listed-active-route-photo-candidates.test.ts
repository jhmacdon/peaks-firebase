import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  parseWikidataLeadImage,
  parseWikimediaImageMetadata,
} from "../backfill-listed-destination-photo-candidates";
import {
  LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES,
  type ReviewedRouteGapCommonsPhoto,
  type ReviewedRouteGapPhotoIdentity,
} from "../listed-active-route-photo-candidates";
import {
  LISTED_PHOTO_REVIEWED_COMMONS_FILES,
  distanceMeters,
  listedPhotoReviewHistoryFingerprint,
  overlappingReviewedPhotoBindingIds,
  planListedPhotoCandidate,
  planReviewedRouteGapCommonsFileCandidate,
  queueListedPhotoCandidate,
  reviewedRouteGapIdentityRejection,
  type ListedPhotoClient,
  type ListedPhotoGapRow,
  type Queryable,
  type WikimediaImageMetadata,
} from "../listed-destination-photo-candidates";

const EMPTY_REVIEW_HISTORY =
  '{"reviewCount":0,"sourcePageKeys":[],"mediaSha1s":[]}';

type SourceAuditDestination = {
  catalog: {
    id: string;
    name: string;
    countryCode: string | null;
    stateCode: string | null;
    wikidataId: string | null;
    lat: number;
    lng: number;
  };
  coverState: { complete: boolean };
  listMemberships: Array<{ listId: string; listName: string }>;
  photoCandidateHistory: Array<{
    id: string;
    status: "pending" | "accepted" | "denied";
    sourcePageUrl: string;
  }>;
  uncoveredActiveRoutes: Array<{
    routeId: string;
    publishValid: boolean;
    derivedCoverComplete: boolean;
  }>;
};

type SourceAuditFixture = {
  schemaVersion: number;
  kind: string;
  generatedAt: string;
  source: {
    database: string;
    readMode: string;
    routeCoverViewPresent: boolean;
    routeCoverProjection: string;
    routeStackRef: string;
    photoBaseRef: string;
  };
  summary: Record<string, number>;
  destinations: SourceAuditDestination[];
};

type ReviewedCommonsBinding = {
  fileTitle: string;
  sourcePageUrl: string;
  imageUrl: string;
  photographer: string;
  licenseName: string;
  licenseUrl: string;
  width: number;
  height: number;
  mediaSha1: string;
  coordinates: { lat: number; lng: number } | null;
  coordinateCount: number;
  metadataResponse: {
    byteLength: number;
    sha256: string;
  };
  originalReview: {
    localPath: string;
    byteLength: number;
    sha256: string;
    visualReview: string;
  };
  identity:
    | {
        type: "camera_coordinate";
        summitDistanceMeters: number;
        review: string;
      }
    | {
        type: "exact_peak";
        reviewedWikidataId: string;
        wikidataP18: boolean;
        commonsCategory: string | null;
        wikidataP18FileTitle: string | null;
        wikidataP18ResponseSha256: string | null;
        review: string;
      };
};

type ReviewDecision = {
  destinationId: string;
  destinationName: string;
  catalog: {
    countryCode: string | null;
    stateCode: string | null;
    wikidataId: string | null;
    lat: number;
    lng: number;
  };
  coverComplete: boolean;
  listMemberships: Array<{ listId: string; listName: string }>;
  photoCandidateHistory: Array<{
    id: string;
    status: string;
    sourcePageUrl: string;
  }>;
  uncoveredActiveRoutes: Array<{
    routeId: string;
    publishValid: boolean;
    derivedCoverComplete: boolean;
  }>;
  disposition:
    | "accepted_new_pending_plan"
    | "rejected_no_strict_file"
    | "preserved_existing_pending";
  reviewHistoryFingerprint?: string;
  commons?: ReviewedCommonsBinding;
  search?: {
    request: {
      endpoint: string;
      params: Record<string, string>;
    };
    localPath: string;
    byteLength: number;
    sha256: string;
    resultCount: number;
    resultTitles: string[];
  };
  deniedRecordsRemainDenied?: string[];
  existingPendingCandidateId?: string;
  newCandidatePlanned?: boolean;
};

type ReviewFixture = {
  schemaVersion: number;
  kind: string;
  mode: string;
  sourceAudit: {
    path: string;
    byteLength: number;
    sha256: string;
    generatedAt: string;
    database: string;
    readMode: string;
    routeCoverViewPresent: boolean;
    routeCoverProjection: string;
    routeStackRef: string;
    photoBaseRef: string;
  };
  exactReplay: {
    path: string;
    byteLength: number;
    sha256: string;
    responseCount: number;
    encoding: "base64";
  };
  summary: Record<string, number | boolean>;
  decisions: ReviewDecision[];
};

type ExactReplayFixture = {
  schemaVersion: number;
  kind: string;
  reviewFixture: string;
  responseCount: number;
  responses: Array<{
    evidence: "accepted_metadata" | "rejection_geosearch" | "wikidata_p18";
    destinationId: string;
    destinationName: string;
    provenancePath: string;
    byteLength: number;
    sha256: string;
    encoding: "base64";
    rawResponseBase64: string;
  }>;
};

const fixtureDirectory = path.resolve(
  __dirname,
  "../../../../docs/data-audits/fixtures"
);
const sourceAuditPath = path.join(
  fixtureDirectory,
  "listed-active-route-cover-gap-audit-2026-09-01.json"
);
const reviewFixturePath = path.join(
  fixtureDirectory,
  "listed-active-route-photo-priority-review-2026-09-01.json"
);
const exactReplayPath = path.join(
  fixtureDirectory,
  "listed-active-route-photo-priority-replay-2026-09-01.json"
);

async function loadFixtures(): Promise<{
  sourceBytes: Buffer;
  source: SourceAuditFixture;
  review: ReviewFixture;
  replayBytes: Buffer;
  replay: ExactReplayFixture;
}> {
  const [sourceBytes, reviewBytes, replayBytes] = await Promise.all([
    readFile(sourceAuditPath),
    readFile(reviewFixturePath),
    readFile(exactReplayPath),
  ]);
  return {
    sourceBytes,
    source: JSON.parse(sourceBytes.toString("utf8")) as SourceAuditFixture,
    review: JSON.parse(reviewBytes.toString("utf8")) as ReviewFixture,
    replayBytes,
    replay: JSON.parse(replayBytes.toString("utf8")) as ExactReplayFixture,
  };
}

function acceptedDecisions(review: ReviewFixture): ReviewDecision[] {
  return review.decisions.filter(
    ({ disposition }) => disposition === "accepted_new_pending_plan"
  );
}

function routeGapRow(
  audit: Readonly<ReviewedRouteGapCommonsPhoto>,
  overrides: Partial<ListedPhotoGapRow> = {}
): ListedPhotoGapRow {
  return {
    id: audit.destinationId,
    name: audit.destinationName,
    lat: audit.catalogCoordinates.lat,
    lng: audit.catalogCoordinates.lng,
    country_code: audit.countryCode,
    wikidata_id: audit.catalogWikidataId,
    list_ids: [...audit.catalogListIds],
    list_names: [...audit.catalogListNames],
    existing_source_page_urls: [],
    existing_source_page_urls_without_sha: [],
    existing_media_sha1s: [],
    has_pending_candidate: false,
    ...overrides,
  };
}

function reviewedImage(
  audit: Readonly<ReviewedRouteGapCommonsPhoto>,
  binding: ReviewedCommonsBinding,
  overrides: Partial<WikimediaImageMetadata> = {}
): WikimediaImageMetadata {
  return {
    fileTitle: audit.fileTitle,
    fileTitleAliases: [],
    coordinates: audit.fileCoordinates,
    coordinateCount: audit.fileCoordinateCount,
    imageUrl: binding.imageUrl,
    sourcePageUrl: audit.sourcePageUrl,
    photographer: audit.photographer,
    licenseName: audit.licenseName,
    licenseUrl: audit.licenseUrl,
    width: audit.width,
    height: audit.height,
    mime: "image/jpeg",
    mediaType: "BITMAP",
    mediaSha1: audit.mediaSha1,
    ...overrides,
  };
}

function reviewedClient(
  image: WikimediaImageMetadata,
  expectedFileTitle = image.fileTitle,
  p18Proof?: { wikidataId: string; fileTitle: string }
): ListedPhotoClient {
  return {
    async resolveWikidataArticle() {
      assert.fail("closed reviewed bindings must not resolve an article");
    },
    async searchWikipediaArticles() {
      assert.fail("closed reviewed bindings must not search Wikipedia");
    },
    async fetchWikipediaArticle() {
      assert.fail("closed reviewed bindings must not fetch an article");
    },
    async fetchWikidataLeadImage(wikidataId) {
      assert.ok(p18Proof, "only a replayed exact P18 may be fetched");
      assert.equal(wikidataId, p18Proof.wikidataId);
      return p18Proof;
    },
    async fetchReviewedCommonsFile(fileTitle) {
      assert.equal(fileTitle, expectedFileTitle);
      return image;
    },
    async fetchImageMetadata() {
      assert.fail("closed reviewed bindings must not scan article images");
    },
  };
}

function replayedP18For(
  audit: Readonly<ReviewedRouteGapCommonsPhoto>
): { wikidataId: string; fileTitle: string } | undefined {
  if (
    audit.identity.type !== "exact_peak" ||
    audit.identity.commonsCategory !== null
  ) return undefined;
  assert.ok(audit.identity.wikidataP18FileTitle);
  return {
    wikidataId: audit.identity.reviewedWikidataId,
    fileTitle: audit.identity.wikidataP18FileTitle,
  };
}

type ExactRouteGapIdentity = Extract<
  ReviewedRouteGapPhotoIdentity,
  { type: "exact_peak" }
>;

function withExactIdentity(
  audit: Readonly<ReviewedRouteGapCommonsPhoto>,
  overrides: Partial<ExactRouteGapIdentity>
): ReviewedRouteGapCommonsPhoto {
  if (audit.identity.type !== "exact_peak") {
    assert.fail("expected exact-peak identity");
  }
  return {
    ...audit,
    identity: { ...audit.identity, ...overrides },
  };
}

test("the checked-in source audit preserves the exact read-only live packet", async () => {
  const { sourceBytes, source, review } = await loadFixtures();
  assert.equal(sourceBytes.byteLength, 26_118);
  assert.equal(
    createHash("sha256").update(sourceBytes).digest("hex"),
    "3fbc74c5416294771f03cc1d974974ed506a415052b230575aeb408b7c4a67b3"
  );
  assert.equal(source.schemaVersion, 1);
  assert.equal(source.kind, "listed_active_route_cover_gap_audit");
  assert.equal(source.destinations.length, 11);
  assert.equal(new Set(source.destinations.map(({ catalog }) => catalog.id)).size, 11);
  assert.equal(
    new Set(source.destinations.flatMap(({ uncoveredActiveRoutes }) =>
      uncoveredActiveRoutes.map(({ routeId }) => routeId)
    )).size,
    14
  );
  assert.equal(source.destinations.every(({ coverState }) => !coverState.complete), true);
  assert.deepEqual(
    source.destinations
      .flatMap(({ photoCandidateHistory }) => photoCandidateHistory)
      .map(({ status }) => status)
      .sort(),
    ["denied", "denied", "denied", "pending"]
  );
  assert.equal(source.summary.targetDestinations, 11);
  assert.equal(source.summary.targetUncoveredActiveRouteLinks, 14);
  assert.equal(source.summary.targetPublishValidRouteLinks, 6);
  assert.equal(source.summary.targetPublishInvalidRouteLinks, 8);
  assert.equal(source.summary.activePeaksRoutesMissingDerivedCover, 66);
  assert.deepEqual(review.sourceAudit, {
    path: "docs/data-audits/fixtures/listed-active-route-cover-gap-audit-2026-09-01.json",
    byteLength: sourceBytes.byteLength,
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
    generatedAt: source.generatedAt,
    database: source.source.database,
    readMode: source.source.readMode,
    routeCoverViewPresent: source.source.routeCoverViewPresent,
    routeCoverProjection: source.source.routeCoverProjection,
    routeStackRef: source.source.routeStackRef,
    photoBaseRef: source.source.photoBaseRef,
  });
});

test("the checked-in replay recomputes six metadata, four rejection, and one P18 hash", async () => {
  const { review, replayBytes, replay } = await loadFixtures();
  assert.equal(replay.schemaVersion, 1);
  assert.equal(replay.kind, "listed_active_route_photo_priority_exact_replay");
  assert.equal(replay.responseCount, 11);
  assert.equal(replay.responses.length, 11);
  assert.equal(new Set(replay.responses.map(({ destinationId }) => destinationId)).size, 10);
  assert.deepEqual(review.exactReplay, {
    path: "docs/data-audits/fixtures/listed-active-route-photo-priority-replay-2026-09-01.json",
    byteLength: replayBytes.byteLength,
    sha256: createHash("sha256").update(replayBytes).digest("hex"),
    responseCount: replay.responseCount,
    encoding: "base64",
  });

  for (const response of replay.responses) {
    assert.equal(response.encoding, "base64");
    if (response.evidence === "wikidata_p18") {
      assert.equal(
        response.provenancePath,
        "/private/tmp/wikidata-Q7548046-P18-wbgetclaims-20260901.json"
      );
    } else {
      assert.ok(response.provenancePath.startsWith(
        "/private/tmp/peaks-route-gap-commons-20260901/"
      ));
    }
    const raw = Buffer.from(response.rawResponseBase64, "base64");
    assert.equal(raw.byteLength, response.byteLength, response.destinationName);
    assert.equal(
      createHash("sha256").update(raw).digest("hex"),
      response.sha256,
      response.destinationName
    );
    const json = JSON.parse(raw.toString("utf8")) as {
      query?: {
        pages?: Array<{
          title?: string;
          coordinates?: unknown[];
          imageinfo?: Array<{
            width?: number;
            height?: number;
            sha1?: string;
            descriptionurl?: string;
            extmetadata?: Record<string, { value?: string }>;
          }>;
        }>;
        geosearch?: Array<{ title: string }>;
      };
    };
    const decision = review.decisions.find(
      ({ destinationId }) => destinationId === response.destinationId
    );
    assert.ok(decision, response.destinationName);

    if (response.evidence === "accepted_metadata") {
      assert.ok(decision.commons, response.destinationName);
      assert.equal(decision.commons.metadataResponse.byteLength, raw.byteLength);
      assert.equal(decision.commons.metadataResponse.sha256, response.sha256);
      const pages = json.query?.pages ?? [];
      assert.equal(pages.length, 1);
      const page = pages[0];
      const info = page.imageinfo?.[0];
      assert.ok(info);
      assert.equal(page.title, decision.commons.fileTitle);
      assert.equal(page.coordinates?.length ?? 0, decision.commons.coordinateCount);
      assert.equal(info.descriptionurl, decision.commons.sourcePageUrl);
      assert.equal(info.width, decision.commons.width);
      assert.equal(info.height, decision.commons.height);
      assert.equal(info.sha1, decision.commons.mediaSha1);
      assert.ok(info.extmetadata?.Artist?.value);
      assert.equal(
        info.extmetadata?.LicenseShortName?.value,
        decision.commons.licenseName
      );
      if (
        decision.commons.identity.type === "exact_peak" &&
        decision.commons.identity.commonsCategory !== null
      ) {
        const category = decision.commons.identity.commonsCategory.replace(
          /^Category:/,
          ""
        );
        assert.ok(
          info.extmetadata?.Categories?.value?.split("|").includes(category),
          `${response.destinationName} exact category`
        );
        assert.ok(info.extmetadata?.ImageDescription?.value);
      }
      const [parsed] = parseWikimediaImageMetadata(json);
      assert.ok(parsed, response.destinationName);
      assert.equal(parsed.fileTitle, decision.commons.fileTitle);
      assert.equal(parsed.fileTitleAliases.length, 0);
      assert.deepEqual(parsed.coordinates, decision.commons.coordinates);
      assert.equal(parsed.coordinateCount, decision.commons.coordinateCount);
      assert.equal(parsed.imageUrl, decision.commons.imageUrl);
      assert.equal(parsed.sourcePageUrl, decision.commons.sourcePageUrl);
      assert.equal(parsed.photographer, decision.commons.photographer);
      assert.equal(parsed.licenseName, decision.commons.licenseName);
      assert.equal(parsed.licenseUrl, decision.commons.licenseUrl);
      assert.equal(parsed.width, decision.commons.width);
      assert.equal(parsed.height, decision.commons.height);
      assert.equal(parsed.mediaSha1, decision.commons.mediaSha1);
    } else if (response.evidence === "rejection_geosearch") {
      assert.ok(decision.search, response.destinationName);
      assert.equal(decision.search.byteLength, raw.byteLength);
      assert.equal(decision.search.sha256, response.sha256);
      assert.deepEqual(
        (json.query?.geosearch ?? []).map(({ title }) => title),
        decision.search.resultTitles
      );
    } else {
      assert.equal(response.destinationId, "zntKOa5F6FjN6pzYadwv");
      assert.ok(decision.commons, response.destinationName);
      assert.equal(decision.commons.identity.type, "exact_peak");
      if (decision.commons.identity.type !== "exact_peak") {
        assert.fail("expected exact-peak identity");
      }
      assert.equal(
        decision.commons.identity.wikidataP18ResponseSha256,
        response.sha256
      );
      const p18 = parseWikidataLeadImage(
        json,
        decision.commons.identity.reviewedWikidataId
      );
      assert.deepEqual(p18, {
        wikidataId: decision.commons.identity.reviewedWikidataId,
        fileTitle: decision.commons.identity.wikidataP18FileTitle,
      });
      assert.equal(p18?.fileTitle, decision.commons.fileTitle);
      const wrongItem = structuredClone(json) as {
        claims?: { P18?: Array<{ id?: string }> };
      };
      assert.ok(wrongItem.claims?.P18?.[0]);
      wrongItem.claims.P18[0].id = "Q1$27C38ED3-BD91-4537-8BE7-9FF81CCE7A36";
      assert.equal(
        parseWikidataLeadImage(
          wrongItem,
          decision.commons.identity.reviewedWikidataId
        ),
        null
      );
    }
  }
});

test("the review fixture binds all 11 live rows and keeps the batch dry", async () => {
  const { source, review } = await loadFixtures();
  assert.equal(review.schemaVersion, 1);
  assert.equal(review.kind, "listed_active_route_photo_priority_review");
  assert.equal(review.mode, "dry_run_only");
  assert.equal(review.decisions.length, 11);
  assert.equal(new Set(review.decisions.map(({ destinationId }) => destinationId)).size, 11);
  assert.equal(acceptedDecisions(review).length, 6);
  assert.equal(
    review.decisions.filter(({ disposition }) =>
      disposition === "rejected_no_strict_file"
    ).length,
    4
  );
  assert.equal(
    review.decisions.filter(({ disposition }) =>
      disposition === "preserved_existing_pending"
    ).length,
    1
  );
  assert.equal(review.summary.productionWrites, 0);
  assert.equal(review.summary.applyUsed, false);
  assert.equal(review.summary.fixedMonthlyCostUsd, 0);
  assert.equal(review.summary.targetUncoveredActiveRouteLinksBefore, 14);
  assert.equal(review.summary.targetUncoveredActiveRouteLinksCoveredIfAllAcceptedLater, 9);
  assert.equal(review.summary.targetUncoveredActiveRouteLinksAfterIfAllAcceptedLater, 5);
  assert.equal(review.summary.globalActivePeaksRoutesMissingDerivedCoverBefore, 66);
  assert.equal(review.summary.globalActivePeaksRoutesMissingDerivedCoverAfterIfAllAcceptedLater, 57);

  for (const decision of review.decisions) {
    const live = source.destinations.find(
      ({ catalog }) => catalog.id === decision.destinationId
    );
    assert.ok(live, decision.destinationId);
    assert.equal(decision.destinationName, live.catalog.name);
    assert.deepEqual(decision.catalog, {
      countryCode: live.catalog.countryCode,
      stateCode: live.catalog.stateCode,
      wikidataId: live.catalog.wikidataId,
      lat: live.catalog.lat,
      lng: live.catalog.lng,
    });
    assert.equal(decision.coverComplete, live.coverState.complete);
    assert.deepEqual(decision.listMemberships, live.listMemberships.map((list) => ({
      listId: list.listId,
      listName: list.listName,
    })));
    assert.deepEqual(
      decision.photoCandidateHistory,
      live.photoCandidateHistory.map((candidate) => ({
        id: candidate.id,
        status: candidate.status,
        sourcePageUrl: candidate.sourcePageUrl,
      }))
    );
    assert.deepEqual(
      decision.uncoveredActiveRoutes.map(({ routeId }) => routeId),
      live.uncoveredActiveRoutes.map(({ routeId }) => routeId)
    );
  }
});

test("the generic route-gap allowlist contains only the six reviewed accepts", async () => {
  const { review } = await loadFixtures();
  const accepted = acceptedDecisions(review);
  const acceptedIds = accepted.map(({ destinationId }) => destinationId).sort();
  assert.deepEqual(
    Object.keys(LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES).sort(),
    acceptedIds
  );

  for (const decision of accepted) {
    const binding = decision.commons;
    assert.ok(binding, decision.destinationName);
    const audit = LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES[decision.destinationId];
    assert.ok(audit, decision.destinationName);
    assert.equal(audit.evidenceType, "reviewed_active_route_commons_file");
    assert.equal(audit.destinationName, decision.destinationName);
    assert.equal(audit.countryCode, decision.catalog.countryCode);
    assert.equal(audit.catalogWikidataId, decision.catalog.wikidataId);
    assert.deepEqual(audit.catalogCoordinates, {
      lat: decision.catalog.lat,
      lng: decision.catalog.lng,
    });
    assert.deepEqual(
      audit.catalogListIds,
      decision.listMemberships.map(({ listId }) => listId)
    );
    assert.deepEqual(
      audit.catalogListNames,
      decision.listMemberships.map(({ listName }) => listName)
    );
    assert.equal(audit.catalogReviewHistoryFingerprint, EMPTY_REVIEW_HISTORY);
    assert.equal(decision.reviewHistoryFingerprint, EMPTY_REVIEW_HISTORY);
    assert.equal(audit.fileTitle, binding.fileTitle);
    assert.equal(audit.sourcePageUrl, binding.sourcePageUrl);
    assert.equal(audit.photographer, binding.photographer);
    assert.equal(audit.licenseName, binding.licenseName);
    assert.equal(audit.licenseUrl, binding.licenseUrl);
    assert.equal(audit.width, binding.width);
    assert.equal(audit.height, binding.height);
    assert.equal(audit.mediaSha1, binding.mediaSha1);
    assert.equal(audit.metadataSha256, binding.metadataResponse.sha256);
    assert.deepEqual(audit.fileCoordinates, binding.coordinates);
    assert.equal(audit.fileCoordinateCount, binding.coordinateCount);
    assert.match(audit.mediaSha1, /^[0-9a-f]{40}$/);
    assert.match(audit.metadataSha256, /^[0-9a-f]{64}$/);
    assert.match(binding.originalReview.sha256, /^[0-9a-f]{64}$/);
    assert.ok(binding.metadataResponse.byteLength > 0);
    assert.ok(binding.originalReview.byteLength > 0);
    assert.ok(binding.originalReview.localPath.startsWith(
      "/private/tmp/peaks-route-gap-commons-20260901/originals/"
    ));
    assert.ok(binding.originalReview.visualReview.length > 0);
    assert.equal(reviewedRouteGapIdentityRejection(audit), null);

    if (audit.identity.type === "camera_coordinate") {
      assert.ok(audit.fileCoordinates);
      assert.ok(
        distanceMeters(
          audit.catalogCoordinates.lat,
          audit.catalogCoordinates.lng,
          audit.fileCoordinates.lat,
          audit.fileCoordinates.lng
        ) <= 1_500
      );
    } else {
      assert.equal(binding.identity.type, "exact_peak");
      if (binding.identity.type !== "exact_peak") {
        assert.fail("expected exact-peak review binding");
      }
      assert.ok(
        audit.identity.wikidataP18 || audit.identity.commonsCategory !== null,
        `${decision.destinationName} needs frozen exact-identity proof`
      );
      assert.equal(
        audit.identity.reviewedWikidataId,
        binding.identity.reviewedWikidataId
      );
      assert.equal(audit.identity.wikidataP18, binding.identity.wikidataP18);
      assert.equal(
        audit.identity.commonsCategory,
        binding.identity.commonsCategory
      );
      assert.equal(
        audit.identity.wikidataP18FileTitle,
        binding.identity.wikidataP18FileTitle
      );
      assert.equal(
        audit.identity.wikidataP18ResponseSha256,
        binding.identity.wikidataP18ResponseSha256
      );
    }
  }

  for (const rejected of review.decisions.filter(
    ({ disposition }) => disposition !== "accepted_new_pending_plan"
  )) {
    assert.equal(
      LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES[rejected.destinationId],
      undefined,
      rejected.destinationName
    );
  }
});

test("exact-peak identity rejects malformed or wrong Q-ids and noncanonical categories", () => {
  const snoqualmie =
    LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES.zntKOa5F6FjN6pzYadwv;
  const mountSi =
    LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES.nSf6z4vL0zjdG2sXibBM;
  const cases: Array<[string, ReviewedRouteGapCommonsPhoto]> = [
    ["missing Q prefix", withExactIdentity(snoqualmie, {
      reviewedWikidataId: "7548046",
    })],
    ["wrong catalog Q-id", withExactIdentity(snoqualmie, {
      reviewedWikidataId: "Q1",
    })],
    ["blank category", withExactIdentity(mountSi, {
      commonsCategory: "",
    })],
    ["empty Category title", withExactIdentity(mountSi, {
      commonsCategory: "Category:",
    })],
    ["missing Category prefix", withExactIdentity(mountSi, {
      commonsCategory: "Mount Si",
    })],
    ["underscored category", withExactIdentity(mountSi, {
      commonsCategory: "Category:Mount_Si",
    })],
  ];

  for (const [label, audit] of cases) {
    assert.ok(reviewedRouteGapIdentityRejection(audit), label);
  }
});

test("generic route bindings remain disjoint from the KFS-only contract", () => {
  assert.deepEqual(overlappingReviewedPhotoBindingIds(), []);
  assert.deepEqual(
    overlappingReviewedPhotoBindingIds(
      { routeOnly: {}, overlap: {} },
      { kfsOnly: {}, overlap: {} }
    ),
    ["overlap"]
  );
  assert.equal(
    Object.keys(LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES).some(
      (destinationId) => destinationId in LISTED_PHOTO_REVIEWED_COMMONS_FILES
    ),
    false
  );
});

test("all six reviewed files plan exact pending candidates without broad discovery", async () => {
  const { review } = await loadFixtures();
  for (const decision of acceptedDecisions(review)) {
    const binding = decision.commons;
    assert.ok(binding);
    const audit = LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES[decision.destinationId];
    const plan = await planListedPhotoCandidate(
      routeGapRow(audit),
      reviewedClient(
        reviewedImage(audit, binding),
        audit.fileTitle,
        replayedP18For(audit)
      )
    );
    assert.equal(plan.kind, "candidate", decision.destinationName);
    if (plan.kind !== "candidate") assert.fail("expected reviewed candidate");
    assert.equal(plan.candidate.sourcePageUrl, binding.sourcePageUrl);
    assert.equal(plan.candidate.imageUrl, binding.imageUrl);
    assert.equal(plan.candidate.mediaSha1, binding.mediaSha1);
    assert.equal(plan.candidate.matchedArticleTitle, null);
    assert.equal(plan.candidate.reviewHistoryFingerprint, EMPTY_REVIEW_HISTORY);
    assert.equal(plan.candidate.evidence.type, "reviewed_active_route_commons_file");
    if (plan.candidate.evidence.type !== "reviewed_active_route_commons_file") {
      assert.fail("expected route-gap evidence");
    }
    assert.deepEqual(plan.candidate.evidence.identity, audit.identity);
    assert.match(plan.candidate.notes ?? "", new RegExp(audit.metadataSha256));
    if (
      audit.identity.type === "exact_peak" &&
      audit.identity.wikidataP18ResponseSha256
    ) {
      assert.match(
        plan.candidate.notes ?? "",
        new RegExp(audit.identity.wikidataP18ResponseSha256)
      );
    }
    assert.match(plan.candidate.notes ?? "", /original full frame was reviewed/i);
    assert.match(plan.candidate.notes ?? "", /framing still requires human review/i);
  }
});

test("Snoqualmie's P18-only proof is rechecked against its pinned exact file", async () => {
  const { review } = await loadFixtures();
  const decision = review.decisions.find(
    ({ destinationId }) => destinationId === "zntKOa5F6FjN6pzYadwv"
  );
  assert.ok(decision?.commons);
  const audit = LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES[decision.destinationId];
  assert.equal(audit.identity.type, "exact_peak");
  if (audit.identity.type !== "exact_peak") assert.fail("expected exact proof");
  assert.equal(audit.identity.commonsCategory, null);
  assert.equal(audit.identity.wikidataP18FileTitle, audit.fileTitle);
  assert.match(audit.identity.wikidataP18ResponseSha256 ?? "", /^[0-9a-f]{64}$/u);

  const image = reviewedImage(audit, decision.commons);
  for (const [label, p18] of [
    ["wrong file", {
      wikidataId: audit.identity.reviewedWikidataId,
      fileTitle: "File:Another Snoqualmie Mountain.jpg",
    }],
    ["wrong item", {
      wikidataId: "Q1",
      fileTitle: audit.fileTitle,
    }],
  ] as const) {
    const client = reviewedClient(
      image,
      audit.fileTitle,
      replayedP18For(audit)
    );
    client.fetchWikidataLeadImage = async () => p18;
    const plan = await planListedPhotoCandidate(routeGapRow(audit), client);
    assert.equal(plan.kind, "miss", label);
    if (plan.kind !== "miss") assert.fail(label);
    assert.equal(plan.code, "reviewed_active_route_identity_changed", label);
  }
});

test("route-gap catalog, list, history, and coordinate drift fail before a file fetch", async () => {
  const audit = LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES["42aBrtB02YE3L8h4tTPo"];
  const cases: Array<[string, Partial<ListedPhotoGapRow>]> = [
    ["name", { name: "Another Granite Mountain" }],
    ["country", { country_code: "CA" }],
    ["Wikidata", { wikidata_id: "Q999" }],
    ["list id", { list_ids: ["other-list"] }],
    ["list name", { list_names: ["Other list"] }],
    ["history", {
      existing_source_page_urls: ["https://commons.wikimedia.org/wiki/File:Old.jpg"],
    }],
    ["coordinates", { lat: audit.catalogCoordinates.lat + 0.01 }],
  ];

  for (const [label, overrides] of cases) {
    let fetches = 0;
    const client = reviewedClient({} as WikimediaImageMetadata);
    client.fetchReviewedCommonsFile = async () => {
      fetches += 1;
      return null;
    };
    const plan = await planListedPhotoCandidate(routeGapRow(audit, overrides), client);
    assert.equal(plan.kind, "miss", label);
    if (plan.kind !== "miss") assert.fail(label);
    assert.equal(plan.code, "reviewed_active_route_catalog_changed", label);
    assert.equal(fetches, 0, label);
  }
});

test("reviewed Commons metadata and exact file identity are fail closed", async () => {
  const { review } = await loadFixtures();
  const decision = review.decisions.find(
    ({ destinationId }) => destinationId === "42aBrtB02YE3L8h4tTPo"
  );
  assert.ok(decision?.commons);
  const audit = LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES[decision.destinationId];
  const base = reviewedImage(audit, decision.commons);
  const cases: Array<[string, Partial<WikimediaImageMetadata>]> = [
    ["redirect", { fileTitleAliases: [audit.fileTitle] }],
    ["title", { fileTitle: "File:Other Granite Mountain.jpg" }],
    ["source page", {
      sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Other_Granite_Mountain.jpg",
    }],
    ["photographer", { photographer: "Someone else" }],
    ["license", { licenseName: "CC BY 4.0" }],
    ["dimensions", { width: audit.width + 1 }],
    ["SHA-1", { mediaSha1: "0".repeat(40) }],
    ["coordinate count", { coordinateCount: 2 }],
    ["coordinate drift", {
      coordinates: {
        lat: audit.fileCoordinates!.lat + 0.01,
        lng: audit.fileCoordinates!.lng,
      },
    }],
  ];

  for (const [label, overrides] of cases) {
    const plan = await planListedPhotoCandidate(
      routeGapRow(audit),
      reviewedClient({ ...base, ...overrides }, audit.fileTitle)
    );
    assert.equal(plan.kind, "miss", label);
    if (plan.kind !== "miss") assert.fail(label);
    assert.equal(plan.code, "reviewed_active_route_file_changed", label);
  }
});

test("SHA-less route history resolves durable media identity before reuse", async () => {
  const { review } = await loadFixtures();
  const decision = review.decisions.find(
    ({ destinationId }) => destinationId === "42aBrtB02YE3L8h4tTPo"
  );
  assert.ok(decision?.commons);
  const baseAudit = LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES[decision.destinationId];
  const oldSourcePageUrl =
    "https://commons.wikimedia.org/wiki/File:Former_Granite_Mountain_cover.jpg";
  const audit: ReviewedRouteGapCommonsPhoto = {
    ...baseAudit,
    catalogReviewHistoryFingerprint: listedPhotoReviewHistoryFingerprint(
      [oldSourcePageUrl],
      []
    ),
  };
  const row = routeGapRow(audit, {
    existing_source_page_urls: [oldSourcePageUrl],
    existing_source_page_urls_without_sha: [oldSourcePageUrl],
  });
  const currentImage = reviewedImage(audit, decision.commons);
  const fetchedTitles: string[] = [];
  const client = reviewedClient(currentImage, audit.fileTitle);
  client.fetchReviewedCommonsFile = async (fileTitle) => {
    fetchedTitles.push(fileTitle);
    if (fileTitle === "File:Former Granite Mountain cover.jpg") {
      return currentImage;
    }
    assert.equal(fileTitle, audit.fileTitle);
    return currentImage;
  };

  const plan = await planReviewedRouteGapCommonsFileCandidate(row, client, audit);
  assert.equal(plan.kind, "miss");
  if (plan.kind !== "miss") assert.fail("expected duplicate-media miss");
  assert.equal(plan.code, "no_usable_new_source");
  assert.deepEqual(fetchedTitles, [
    "File:Former Granite Mountain cover.jpg",
    audit.fileTitle,
  ]);

  const unresolvedClient = reviewedClient(currentImage, audit.fileTitle);
  unresolvedClient.fetchReviewedCommonsFile = async () => null;
  const unresolved = await planReviewedRouteGapCommonsFileCandidate(
    row,
    unresolvedClient,
    audit
  );
  assert.equal(unresolved.kind, "miss");
  if (unresolved.kind !== "miss") assert.fail("expected unresolved-history miss");
  assert.equal(unresolved.code, "historical_source_identity_unresolved");
});

test("Mount Si keeps zero coordinates and requires its frozen exact category", async () => {
  const { review } = await loadFixtures();
  const decision = review.decisions.find(
    ({ destinationId }) => destinationId === "nSf6z4vL0zjdG2sXibBM"
  );
  assert.ok(decision?.commons);
  const audit = LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES[decision.destinationId];
  assert.equal(
    audit.fileTitle,
    "File:Mount Si seen from Mill Pond Road in Washington state.jpg"
  );
  assert.notEqual(audit.fileTitle, "File:Mt. Si, Washington overcast sunset.jpg");
  assert.equal(audit.fileCoordinates, null);
  assert.equal(audit.fileCoordinateCount, 0);
  assert.equal(audit.identity.type, "exact_peak");
  if (audit.identity.type !== "exact_peak") assert.fail("expected exact proof");
  assert.equal(audit.identity.wikidataP18, false);
  assert.equal(audit.identity.commonsCategory, "Category:Mount Si");

  const changedCoordinates = await planListedPhotoCandidate(
    routeGapRow(audit),
    reviewedClient(reviewedImage(audit, decision.commons, {
      coordinates: { lat: audit.catalogCoordinates.lat, lng: audit.catalogCoordinates.lng },
      coordinateCount: 1,
    }))
  );
  assert.equal(changedCoordinates.kind, "miss");
  if (changedCoordinates.kind !== "miss") assert.fail("expected coordinate miss");
  assert.equal(changedCoordinates.code, "reviewed_active_route_file_changed");
});

test("the four rejects pin exact geosearches and old denials stay denied", async () => {
  const { review } = await loadFixtures();
  const rejected = review.decisions.filter(
    ({ disposition }) => disposition === "rejected_no_strict_file"
  );
  assert.equal(rejected.length, 4);
  assert.deepEqual(
    rejected.map(({ destinationName }) => destinationName).sort(),
    ["Cleveland Mountain", "Dirtybox Peak", "Mount Phelps", "Red Mountain"]
  );
  for (const decision of rejected) {
    assert.ok(decision.search, decision.destinationName);
    assert.equal(decision.search.request.endpoint, "https://commons.wikimedia.org/w/api.php");
    assert.equal(decision.search.request.params.gscoord,
      `${decision.catalog.lat}|${decision.catalog.lng}`);
    assert.equal(decision.search.request.params.gsradius, "1500");
    assert.equal(decision.search.request.params.gsnamespace, "6");
    assert.match(decision.search.sha256, /^[0-9a-f]{64}$/);
    assert.ok(decision.search.byteLength > 0);
    assert.equal(decision.search.resultTitles.length, decision.search.resultCount);
  }
  assert.deepEqual(
    rejected.flatMap(({ deniedRecordsRemainDenied = [] }) => deniedRecordsRemainDenied).sort(),
    ["DUTFUgC0P25j0dZXnoIl", "Hbq8yKWshglw8JDsZW0F", "V61GDpgp95UBsTrcRGkA"].sort()
  );
});

test("Damavand's live pending state suppresses all duplicate discovery", async () => {
  const { review } = await loadFixtures();
  const damavand = review.decisions.find(
    ({ destinationId }) => destinationId === "8RtxmvglalqMYeuCTLvS"
  );
  assert.ok(damavand);
  assert.equal(damavand.disposition, "preserved_existing_pending");
  assert.equal(damavand.existingPendingCandidateId, "ESlTsqMIbRL2SFATA_di");
  assert.equal(damavand.newCandidatePlanned, false);
  let calls = 0;
  const client = reviewedClient({} as WikimediaImageMetadata);
  client.fetchReviewedCommonsFile = async () => {
    calls += 1;
    return null;
  };
  const plan = await planListedPhotoCandidate({
    id: damavand.destinationId,
    name: damavand.destinationName,
    lat: damavand.catalog.lat,
    lng: damavand.catalog.lng,
    country_code: damavand.catalog.countryCode,
    wikidata_id: damavand.catalog.wikidataId,
    list_ids: damavand.listMemberships.map(({ listId }) => listId),
    list_names: damavand.listMemberships.map(({ listName }) => listName),
    existing_source_page_urls: damavand.photoCandidateHistory.map(
      ({ sourcePageUrl }) => sourcePageUrl
    ),
    existing_source_page_urls_without_sha: [],
    existing_media_sha1s: [],
    has_pending_candidate: true,
  }, client);
  assert.equal(plan.kind, "skip");
  if (plan.kind !== "skip") assert.fail("expected pending skip");
  assert.equal(plan.code, "pending_review");
  assert.equal(calls, 0);
});

class QueryStub implements Queryable {
  readonly calls: Array<{ text: string; values?: unknown[] }> = [];

  constructor(
    private readonly results: Array<{
      rows: Record<string, unknown>[];
      rowCount?: number;
    }>
  ) {}

  async query(text: string, values?: unknown[]) {
    this.calls.push({ text, values });
    const result = this.results.shift();
    if (!result) throw new Error("unexpected query");
    return result;
  }
}

test("queue rechecks the exact generic route-gap binding and inserts only review state", async () => {
  const { review } = await loadFixtures();
  const decision = review.decisions.find(
    ({ destinationId }) => destinationId === "42aBrtB02YE3L8h4tTPo"
  );
  assert.ok(decision?.commons);
  const audit = LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES[decision.destinationId];
  const plan = await planListedPhotoCandidate(
    routeGapRow(audit),
    reviewedClient(reviewedImage(audit, decision.commons))
  );
  if (plan.kind !== "candidate") assert.fail("expected reviewed candidate");
  const state = {
    name: audit.destinationName,
    lat: audit.catalogCoordinates.lat,
    lng: audit.catalogCoordinates.lng,
    country_code: audit.countryCode,
    wikidata_id: audit.catalogWikidataId,
    list_ids: [...audit.catalogListIds],
    list_names: [...audit.catalogListNames],
    has_usable_cover: false,
    has_pending_candidate: false,
  };
  const insert = new QueryStub([
    { rows: [state] },
    { rows: [] },
    { rows: [], rowCount: 1 },
  ]);
  assert.equal(await queueListedPhotoCandidate(insert, plan.candidate), "inserted");
  assert.match(insert.calls[0].text, /AS list_names/);
  assert.match(insert.calls[2].text, /INSERT INTO destination_photo_candidates/);
  assert.match(insert.calls[2].text, /'listed_photo_backfill'/);
  assert.doesNotMatch(insert.calls[2].text, /UPDATE destinations|hero_image\s*=/);
  assert.equal(insert.calls[2].values?.[12], plan.candidate.notes);

  for (const changed of [
    { ...state, list_ids: ["other-list"] },
    { ...state, list_names: ["Other list"] },
    { ...state, wikidata_id: "Q999" },
  ]) {
    const drifted = new QueryStub([{ rows: [changed] }]);
    assert.equal(
      await queueListedPhotoCandidate(drifted, plan.candidate),
      "identity_changed"
    );
    assert.equal(drifted.calls.length, 1);
  }
});
