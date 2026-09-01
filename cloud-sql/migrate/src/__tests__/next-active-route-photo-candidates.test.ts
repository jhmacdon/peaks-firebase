import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  parseReviewedCommonsFileCategories,
  parseWikidataLeadImage,
  parseWikimediaImageMetadata,
} from "../backfill-listed-destination-photo-candidates";
import {
  ACTIVE_ROUTE_REVIEWED_COMMONS_FILES,
  LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES,
  NEXT_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES,
  type ReviewedRouteGapCommonsPhoto,
} from "../listed-active-route-photo-candidates";
import {
  LISTED_PHOTO_GAPS_SQL,
  LISTED_PHOTO_REVIEWED_COMMONS_FILES,
  listedPhotoReviewHistoryFingerprint,
  overlappingReviewedPhotoBindingIds,
  planListedPhotoCandidate,
  queueListedPhotoCandidate,
  reviewedRouteGapIdentityRejection,
  type ListedPhotoCandidate,
  type ListedPhotoClient,
  type ListedPhotoGapRow,
  type Queryable,
} from "../listed-destination-photo-candidates";

const EMPTY_REVIEW_HISTORY =
  '{"reviewCount":0,"sourcePageKeys":[],"mediaSha1s":[]}';

type ReplayResponse = {
  kind:
    | "commons_exact_file_metadata"
    | "wikidata_exact_p18"
    | "commons_exact_category_membership";
  destinationId: string;
  destinationName: string;
  fileTitle?: string;
  wikidataId?: string;
  requiredFileTitle?: string;
  requiredCategory?: string;
  responseFileName: string;
  request: { endpoint: string; params: Record<string, string> };
  byteLength: number;
  sha256: string;
  encoding: "base64";
  rawResponseBase64: string;
};

type ReplayFixture = {
  schemaVersion: number;
  kind: string;
  responseCount: number;
  responses: ReplayResponse[];
};

type ReviewDecision = {
  rank: number;
  destinationId: string;
  destinationName: string;
  uncoveredActiveRouteLinks: number;
  catalog: {
    id: string;
    name: string;
    countryCode: string | null;
    wikidataId: string | null;
    lat: number;
    lng: number;
  };
  coverState: { complete: boolean };
  coverFingerprint: string;
  listMemberships: Array<{ listId: string; listName: string }>;
  photoCandidateHistory: unknown[];
  reviewHistoryFingerprint: string;
  activeRouteBindings: Array<{ routeId: string; derivedCoverComplete: boolean }>;
  activeRouteFingerprint: string;
  disposition: string;
  candidateId: string;
  commons: {
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
    metadataResponse: { responseFileName: string; byteLength: number; sha256: string };
  };
  originalDownload: {
    byteLength: number;
    sha256: string;
    sha1: string;
    width: number;
    height: number;
    verifiedAgainstCommonsMetadata: boolean;
  };
  identity: {
    reviewedWikidataId: string;
    wikidataP18: boolean;
    commonsCategory: string | null;
    wikidataP18FileTitle?: string;
    wikidataP18Response?: { responseFileName: string; byteLength: number; sha256: string };
    commonsCategoryResponse?: { responseFileName: string; byteLength: number; sha256: string };
  };
  visualReview: {
    originalFullFrame: string;
    centeredWideTwoToOne: string;
    centeredSquareOneToOne: string;
    unsafeOrWrongIdentity: boolean;
  };
  queuePolicy: {
    status: string;
    applyUsed: boolean;
    heroUpdate: boolean;
    productionWrite: boolean;
  };
};

type ReviewFixture = {
  schemaVersion: number;
  kind: string;
  mode: string;
  sourceAudit: { path: string; byteLength: number; sha256: string };
  sourceQuery: { path: string; byteLength: number; sha256: string };
  exactReplay: { path: string; byteLength: number; sha256: string; responseCount: number };
  summary: Record<string, number | boolean>;
  decisions: ReviewDecision[];
};

type SourceAudit = {
  schemaVersion: number;
  kind: string;
  source: {
    defaultTransactionReadOnly: string;
    transactionReadOnly: string;
    routeCoverViewPresent: boolean;
    implementationBaseRef: string;
    writes: number;
  };
  summary: Record<string, number | boolean>;
  destinations: Array<{
    catalog: {
      id: string;
      name: string;
      countryCode: string | null;
      wikidataId: string | null;
      lat: number;
      lng: number;
    };
    coverState: { complete: boolean };
    listMemberships: Array<{ listId: string; listName: string }>;
    photoCandidateHistory: Array<{
      status: string;
      sourcePageUrl: string | null;
      mediaSha1: string | null;
    }>;
    activeRouteBindings: Array<{ routeId: string }>;
    activeRouteFingerprint: string;
    coverFingerprint: string;
    remainingUncoveredActiveRoutes: Array<{ routeId: string }>;
  }>;
};

const fixtureDirectory = path.resolve(
  __dirname,
  "../../../../docs/data-audits/fixtures"
);
const sourceAuditPath = path.join(
  fixtureDirectory,
  "next-active-route-cover-gap-audit-2026-09-01.json"
);
const sourceQueryPath = path.join(
  fixtureDirectory,
  "next-active-route-cover-gap-query-2026-09-01.sql"
);
const reviewPath = path.join(
  fixtureDirectory,
  "next-active-route-photo-priority-review-2026-09-01.json"
);
const replayPath = path.join(
  fixtureDirectory,
  "next-active-route-photo-priority-replay-2026-09-01.json"
);

async function fixtures(): Promise<{
  sourceBytes: Buffer;
  sourceQueryBytes: Buffer;
  reviewBytes: Buffer;
  replayBytes: Buffer;
  source: SourceAudit;
  review: ReviewFixture;
  replay: ReplayFixture;
}> {
  const [sourceBytes, sourceQueryBytes, reviewBytes, replayBytes] =
    await Promise.all([
      readFile(sourceAuditPath),
      readFile(sourceQueryPath),
      readFile(reviewPath),
      readFile(replayPath),
    ]);
  return {
    sourceBytes,
    sourceQueryBytes,
    reviewBytes,
    replayBytes,
    source: JSON.parse(sourceBytes.toString("utf8")) as SourceAudit,
    review: JSON.parse(reviewBytes.toString("utf8")) as ReviewFixture,
    replay: JSON.parse(replayBytes.toString("utf8")) as ReplayFixture,
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function rawResponse(response: ReplayResponse): Buffer {
  assert.equal(response.encoding, "base64");
  const raw = Buffer.from(response.rawResponseBase64, "base64");
  assert.equal(raw.byteLength, response.byteLength, response.responseFileName);
  assert.equal(sha256(raw), response.sha256, response.responseFileName);
  return raw;
}

function responseFor(
  replay: ReplayFixture,
  kind: ReplayResponse["kind"],
  destinationId: string
): ReplayResponse {
  const response = replay.responses.find(
    (candidate) =>
      candidate.kind === kind && candidate.destinationId === destinationId
  );
  assert.ok(response, `${destinationId} ${kind}`);
  return response;
}

function strictRowFromSource(
  source: SourceAudit,
  destinationId: string,
  overrides: Partial<ListedPhotoGapRow> = {}
): ListedPhotoGapRow {
  const packet = source.destinations.find(
    (destination) => destination.catalog.id === destinationId
  );
  assert.ok(packet, destinationId);
  const historyUrls = packet.photoCandidateHistory
    .map(({ sourcePageUrl }) => sourcePageUrl)
    .filter((value): value is string => value !== null);
  const historyUrlsWithoutSha = packet.photoCandidateHistory
    .filter(({ mediaSha1 }) => mediaSha1 === null)
    .map(({ sourcePageUrl }) => sourcePageUrl)
    .filter((value): value is string => value !== null);
  const historySha1s = packet.photoCandidateHistory
    .map(({ mediaSha1 }) => mediaSha1)
    .filter((value): value is string => value !== null);
  return {
    id: packet.catalog.id,
    name: packet.catalog.name,
    lat: packet.catalog.lat,
    lng: packet.catalog.lng,
    country_code: packet.catalog.countryCode,
    wikidata_id: packet.catalog.wikidataId,
    list_ids: packet.listMemberships.map(({ listId }) => listId).sort(),
    list_names: packet.listMemberships.map(({ listName }) => listName).sort(),
    existing_source_page_urls: historyUrls,
    existing_source_page_urls_without_sha: historyUrlsWithoutSha,
    existing_media_sha1s: historySha1s,
    has_pending_candidate: packet.photoCandidateHistory.some(
      ({ status }) => status === "pending"
    ),
    cover_fingerprint: packet.coverFingerprint,
    active_route_fingerprint: packet.activeRouteFingerprint,
    ...overrides,
  };
}

function closedClient(
  replay: ReplayFixture,
  audit: Readonly<ReviewedRouteGapCommonsPhoto>
): ListedPhotoClient {
  const metadata = responseFor(
    replay,
    "commons_exact_file_metadata",
    audit.destinationId
  );
  const image = parseWikimediaImageMetadata(
    JSON.parse(rawResponse(metadata).toString("utf8"))
  )[0];
  assert.ok(image);
  return {
    async resolveWikidataArticle() {
      assert.fail("closed reviewed files must not resolve an article");
    },
    async searchWikipediaArticles() {
      assert.fail("closed reviewed files must not search Wikipedia");
    },
    async fetchWikipediaArticle() {
      assert.fail("closed reviewed files must not fetch an article");
    },
    async fetchWikidataLeadImage(wikidataId) {
      const response = responseFor(replay, "wikidata_exact_p18", audit.destinationId);
      assert.equal(wikidataId, response.wikidataId);
      return parseWikidataLeadImage(
        JSON.parse(rawResponse(response).toString("utf8")),
        wikidataId
      );
    },
    async fetchReviewedCommonsFile(fileTitle) {
      assert.equal(fileTitle, audit.fileTitle);
      return image;
    },
    async fetchReviewedCommonsFileCategories(fileTitle) {
      assert.equal(fileTitle, audit.fileTitle);
      const response = responseFor(
        replay,
        "commons_exact_category_membership",
        audit.destinationId
      );
      return parseReviewedCommonsFileCategories(
        JSON.parse(rawResponse(response).toString("utf8")),
        fileTitle
      );
    },
    async fetchImageMetadata() {
      assert.fail("closed reviewed files must not scan article images");
    },
  };
}

async function plannedCandidate(
  replay: ReplayFixture,
  source: SourceAudit,
  audit: Readonly<ReviewedRouteGapCommonsPhoto>
): Promise<ListedPhotoCandidate> {
  const plan = await planListedPhotoCandidate(
    strictRowFromSource(source, audit.destinationId),
    closedClient(replay, audit)
  );
  assert.equal(plan.kind, "candidate", audit.destinationName);
  if (plan.kind !== "candidate") assert.fail(audit.destinationName);
  return plan.candidate;
}

test("the forced-read-only packet and all review fixtures are byte pinned", async () => {
  const {
    sourceBytes,
    sourceQueryBytes,
    reviewBytes,
    replayBytes,
    source,
    review,
    replay,
  } = await fixtures();

  assert.equal(sourceBytes.byteLength, 29_114);
  assert.equal(
    sha256(sourceBytes),
    "bfda0523c0e6dff797ce69983ec1b8ba6b6c2472159f6365aa8263d6091759bb"
  );
  assert.equal(sourceQueryBytes.byteLength, 9_903);
  assert.equal(
    sha256(sourceQueryBytes),
    "9d5b41887cc519c8d04fec7cb040f832688d99498ddeceabb7af35f642ad8537"
  );
  assert.equal(replayBytes.byteLength, 30_356);
  assert.equal(
    sha256(replayBytes),
    "33979c11c6bb78eab3207ff84e9a5bb030f20c6b6ad896d7493af538ab52193e"
  );
  assert.equal(reviewBytes.byteLength, 41_180);
  assert.equal(
    sha256(reviewBytes),
    "8b100c25a9ce0a98dffd654868893e267a7775c8ce522d4cc76ef10530d1d3a0"
  );
  assert.equal(review.sourceAudit.byteLength, sourceBytes.byteLength);
  assert.equal(review.sourceAudit.sha256, sha256(sourceBytes));
  assert.equal(review.sourceQuery.byteLength, sourceQueryBytes.byteLength);
  assert.equal(review.sourceQuery.sha256, sha256(sourceQueryBytes));
  assert.equal(review.exactReplay.byteLength, replayBytes.byteLength);
  assert.equal(review.exactReplay.sha256, sha256(replayBytes));
  assert.equal(review.exactReplay.responseCount, replay.responseCount);

  assert.equal(source.schemaVersion, 1);
  assert.equal(source.kind, "next_active_route_cover_gap_audit");
  assert.equal(source.source.defaultTransactionReadOnly, "on");
  assert.equal(source.source.transactionReadOnly, "on");
  assert.equal(source.source.routeCoverViewPresent, false);
  assert.equal(source.source.writes, 0);
  assert.match(source.source.implementationBaseRef, /@b3218423f8832ca2474be32038f9093ca03acb55$/u);
  assert.equal(source.summary.activePeaksRoutes, 260);
  assert.equal(source.summary.activePeaksRoutesWithDerivedCover, 194);
  assert.equal(source.summary.activePeaksRoutesMissingDerivedCoverBeforePriorBatches, 66);
  assert.equal(source.summary.activePeaksRoutesMissingDerivedCoverAfterPriorBatchesIfApproved, 57);
  assert.equal(source.summary.nextBatchUncoveredActiveRouteLinks, 10);
  assert.equal(source.summary.nextBatchDistinctRouteGapReductionIfApprovedLater, 10);
  assert.equal(source.summary.activePeaksRoutesMissingDerivedCoverAfterNextBatchIfApprovedLater, 47);
  assert.equal(source.destinations.length, 8);
  assert.equal(
    source.destinations.every((destination) =>
      !destination.coverState.complete &&
      destination.listMemberships.length === 0 &&
      destination.photoCandidateHistory.length === 0 &&
      destination.activeRouteBindings.length ===
        destination.remainingUncoveredActiveRoutes.length
    ),
    true
  );

  assert.equal(review.schemaVersion, 1);
  assert.equal(review.kind, "next_active_route_photo_priority_review");
  assert.equal(review.mode, "dry_run_only");
  assert.equal(review.decisions.length, 8);
  assert.equal(review.summary.acceptedNewPendingPlans, 8);
  assert.equal(review.summary.productionWrites, 0);
  assert.equal(review.summary.applyUsed, false);
  assert.equal(review.summary.globalActivePeaksRoutesMissingDerivedCoverAfterPriorBatchesIfApproved, 57);
  assert.equal(review.summary.globalActivePeaksRoutesMissingDerivedCoverAfterAllAcceptedLater, 47);
});

test("all 16 raw source replies decode, hash, and prove the exact files", async () => {
  const { replay, review } = await fixtures();
  assert.equal(replay.schemaVersion, 1);
  assert.equal(replay.kind, "next_active_route_photo_priority_replay");
  assert.equal(replay.responseCount, 16);
  assert.equal(replay.responses.length, 16);
  assert.equal(new Set(replay.responses.map(({ responseFileName }) => responseFileName)).size, 16);

  for (const response of replay.responses) rawResponse(response);

  for (const decision of review.decisions) {
    const audit = NEXT_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES[decision.destinationId];
    assert.ok(audit, decision.destinationName);
    const metadata = responseFor(
      replay,
      "commons_exact_file_metadata",
      decision.destinationId
    );
    const images = parseWikimediaImageMetadata(
      JSON.parse(rawResponse(metadata).toString("utf8"))
    );
    assert.equal(images.length, 1, decision.destinationName);
    const image = images[0];
    assert.equal(image.fileTitle, audit.fileTitle);
    assert.deepEqual(image.fileTitleAliases, []);
    assert.equal(image.sourcePageUrl, audit.sourcePageUrl);
    assert.equal(image.imageUrl, decision.commons.imageUrl);
    assert.equal(image.photographer, audit.photographer);
    assert.equal(image.licenseName, audit.licenseName);
    assert.equal(image.licenseUrl, audit.licenseUrl);
    assert.equal(image.width, audit.width);
    assert.equal(image.height, audit.height);
    assert.equal(image.mediaSha1, audit.mediaSha1);
    assert.deepEqual(image.coordinates, audit.fileCoordinates);
    assert.equal(image.coordinateCount, audit.fileCoordinateCount);
    assert.equal(metadata.sha256, audit.metadataSha256);
    assert.equal(decision.originalDownload.sha1, audit.mediaSha1);
    assert.equal(decision.originalDownload.width, audit.width);
    assert.equal(decision.originalDownload.height, audit.height);
    assert.equal(decision.originalDownload.verifiedAgainstCommonsMetadata, true);
    assert.ok(decision.originalDownload.byteLength > 0);
    assert.match(decision.originalDownload.sha256, /^[0-9a-f]{64}$/u);

    assert.equal(audit.identity.type, "exact_peak");
    if (audit.identity.type !== "exact_peak") assert.fail("expected exact identity");
    if (audit.identity.wikidataP18) {
      const p18 = responseFor(replay, "wikidata_exact_p18", decision.destinationId);
      const parsed = parseWikidataLeadImage(
        JSON.parse(rawResponse(p18).toString("utf8")),
        audit.identity.reviewedWikidataId
      );
      assert.deepEqual(parsed, {
        wikidataId: audit.identity.reviewedWikidataId,
        fileTitle: audit.fileTitle,
      });
      assert.equal(p18.sha256, audit.identity.wikidataP18ResponseSha256);
      assert.equal(audit.identity.commonsCategory, null);
      assert.equal(audit.identity.commonsCategoryResponseSha256, null);
    } else {
      const category = responseFor(
        replay,
        "commons_exact_category_membership",
        decision.destinationId
      );
      const json = JSON.parse(rawResponse(category).toString("utf8"));
      const page = json.query.pages[0];
      assert.equal(page.title, audit.fileTitle);
      assert.equal(
        page.categories.some(
          ({ title }: { title: string }) => title === audit.identity.commonsCategory
        ),
        true
      );
      assert.equal(category.requiredCategory, audit.identity.commonsCategory);
      assert.equal(category.sha256, audit.identity.commonsCategoryResponseSha256);
      assert.equal(audit.identity.wikidataP18ResponseSha256, null);
    }
  }
});

test("the new map is exact, disjoint, crop reviewed, and plans eight pending rows", async () => {
  const { source, review, replay } = await fixtures();
  const acceptedIds = review.decisions.map(({ destinationId }) => destinationId).sort();
  assert.deepEqual(
    Object.keys(NEXT_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES).sort(),
    acceptedIds
  );
  assert.equal(Object.keys(LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES).length, 6);
  assert.equal(Object.keys(ACTIVE_ROUTE_REVIEWED_COMMONS_FILES).length, 14);
  assert.deepEqual(overlappingReviewedPhotoBindingIds(), []);
  assert.equal(
    acceptedIds.some((destinationId) =>
      destinationId in LISTED_PHOTO_REVIEWED_COMMONS_FILES
    ),
    false
  );

  for (const decision of review.decisions) {
    const audit = NEXT_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES[decision.destinationId];
    assert.ok(audit);
    assert.equal(audit.destinationName, decision.destinationName);
    assert.deepEqual(audit.catalogListIds, []);
    assert.deepEqual(audit.catalogListNames, []);
    assert.equal(audit.catalogReviewHistoryFingerprint, EMPTY_REVIEW_HISTORY);
    assert.equal(audit.catalogCoverFingerprint, decision.coverFingerprint);
    assert.equal(audit.catalogActiveRouteFingerprint, decision.activeRouteFingerprint);
    assert.equal(reviewedRouteGapIdentityRejection(audit), null);
    assert.equal(decision.visualReview.originalFullFrame, "accepted");
    assert.equal(decision.visualReview.centeredWideTwoToOne, "accepted");
    assert.equal(decision.visualReview.centeredSquareOneToOne, "accepted");
    assert.equal(decision.visualReview.unsafeOrWrongIdentity, false);
    assert.deepEqual(decision.queuePolicy, {
      status: "pending_only",
      applyUsed: false,
      heroUpdate: false,
      productionWrite: false,
    });

    const independentRow = strictRowFromSource(source, decision.destinationId);
    assert.equal(audit.destinationId, independentRow.id);
    assert.equal(audit.destinationName, independentRow.name);
    assert.equal(audit.countryCode, independentRow.country_code);
    assert.equal(audit.catalogWikidataId, independentRow.wikidata_id);
    assert.deepEqual(audit.catalogCoordinates, {
      lat: independentRow.lat,
      lng: independentRow.lng,
    });
    assert.deepEqual(audit.catalogListIds, independentRow.list_ids);
    assert.deepEqual(audit.catalogListNames, independentRow.list_names);
    assert.deepEqual(independentRow.existing_source_page_urls, []);
    assert.deepEqual(independentRow.existing_source_page_urls_without_sha, []);
    assert.deepEqual(independentRow.existing_media_sha1s, []);
    assert.equal(independentRow.has_pending_candidate, false);
    assert.equal(
      audit.catalogReviewHistoryFingerprint,
      listedPhotoReviewHistoryFingerprint(
        independentRow.existing_source_page_urls,
        independentRow.existing_media_sha1s
      )
    );
    assert.equal(audit.catalogCoverFingerprint, independentRow.cover_fingerprint);
    assert.equal(
      audit.catalogActiveRouteFingerprint,
      independentRow.active_route_fingerprint
    );
    assert.equal(audit.imageUrl, decision.commons.imageUrl);

    const candidate = await plannedCandidate(replay, source, audit);
    assert.equal(candidate.id, decision.candidateId);
    assert.equal(candidate.destinationId, decision.destinationId);
    assert.equal(candidate.sourcePageUrl, audit.sourcePageUrl);
    assert.equal(candidate.mediaSha1, audit.mediaSha1);
    assert.equal(candidate.reviewHistoryFingerprint, EMPTY_REVIEW_HISTORY);
    assert.equal(candidate.evidence.type, "reviewed_active_route_commons_file");
    if (candidate.evidence.type !== "reviewed_active_route_commons_file") {
      assert.fail("expected reviewed route evidence");
    }
    assert.equal(
      candidate.evidence.catalogCoverFingerprint,
      audit.catalogCoverFingerprint
    );
    assert.equal(
      candidate.evidence.catalogActiveRouteFingerprint,
      audit.catalogActiveRouteFingerprint
    );
    assert.match(candidate.notes ?? "", new RegExp(audit.metadataSha256));
    const identityHash = audit.identity.type === "exact_peak"
      ? audit.identity.wikidataP18ResponseSha256 ??
        audit.identity.commonsCategoryResponseSha256
      : null;
    assert.ok(identityHash);
    assert.match(candidate.notes ?? "", new RegExp(identityHash));
  }
});

test("cover, route, list, history, P18, and category drift fail closed", async () => {
  const { source, replay } = await fixtures();
  const monadnock = NEXT_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES.YhxmMJE5KqAsa2jMYlrs;
  const driftCases: Array<[string, Partial<ListedPhotoGapRow>]> = [
    ["cover", { cover_fingerprint: "{}" }],
    ["route", { active_route_fingerprint: "[]" }],
    ["list", { list_ids: ["new-list"] }],
    ["history", {
      existing_source_page_urls: [
        "https://commons.wikimedia.org/wiki/File:Already_seen.jpg",
      ],
    }],
  ];
  for (const [label, overrides] of driftCases) {
    let fileFetches = 0;
    const client = closedClient(replay, monadnock);
    client.fetchReviewedCommonsFile = async () => {
      fileFetches += 1;
      return null;
    };
    const plan = await planListedPhotoCandidate(
      strictRowFromSource(source, monadnock.destinationId, overrides),
      client
    );
    assert.equal(plan.kind, "miss", label);
    if (plan.kind !== "miss") assert.fail(label);
    assert.equal(plan.code, "reviewed_active_route_catalog_changed", label);
    assert.equal(fileFetches, 0, label);
  }

  const wrongP18Client = closedClient(replay, monadnock);
  wrongP18Client.fetchWikidataLeadImage = async () => ({
    wikidataId: "Q289542",
    fileTitle: "File:Another Monadnock.jpg",
  });
  const wrongP18 = await planListedPhotoCandidate(
    strictRowFromSource(source, monadnock.destinationId),
    wrongP18Client
  );
  assert.equal(wrongP18.kind, "miss");
  if (wrongP18.kind !== "miss") assert.fail("expected P18 miss");
  assert.equal(wrongP18.code, "reviewed_active_route_identity_changed");

  const mailbox = NEXT_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES["5hVnUW4tmqj3A6YbU0oB"];
  assert.equal(mailbox.identity.type, "exact_peak");
  if (mailbox.identity.type !== "exact_peak") assert.fail("expected exact identity");
  assert.match(mailbox.identity.commonsCategoryResponseSha256 ?? "", /^[0-9a-f]{64}$/u);
  const badCategoryReplay: ReviewedRouteGapCommonsPhoto = {
    ...mailbox,
    identity: {
      ...mailbox.identity,
      commonsCategoryResponseSha256: "0".repeat(63),
    },
  };
  assert.match(
    reviewedRouteGapIdentityRejection(badCategoryReplay) ?? "",
    /category replay/u
  );

  const changedCategoryClient = closedClient(replay, mailbox);
  changedCategoryClient.fetchReviewedCommonsFileCategories = async () => [];
  const changedCategory = await planListedPhotoCandidate(
    strictRowFromSource(source, mailbox.destinationId),
    changedCategoryClient
  );
  assert.equal(changedCategory.kind, "miss");
  if (changedCategory.kind !== "miss") assert.fail("expected category miss");
  assert.equal(changedCategory.code, "reviewed_active_route_identity_changed");
});

test("the gap scan admits only exact reviewed non-list ids and keeps state fingerprints", () => {
  for (const destinationId of Object.keys(NEXT_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES)) {
    assert.match(LISTED_PHOTO_GAPS_SQL, new RegExp(`'${destinationId}'`, "u"));
  }
  for (const destinationId of Object.keys(LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES)) {
    assert.doesNotMatch(
      LISTED_PHOTO_GAPS_SQL,
      new RegExp(`'${destinationId}'`, "u")
    );
  }
  assert.match(LISTED_PHOTO_GAPS_SQL, /OR d\.id IN \(/u);
  assert.match(LISTED_PHOTO_GAPS_SQL, /cover_fingerprint/u);
  assert.match(LISTED_PHOTO_GAPS_SQL, /active_route_fingerprint/u);
  assert.match(LISTED_PHOTO_GAPS_SQL, /r\.owner = 'peaks'/u);
  assert.match(LISTED_PHOTO_GAPS_SQL, /r\.status = 'active'/u);
  assert.doesNotMatch(LISTED_PHOTO_GAPS_SQL, /d\.id IN \(SELECT/u);
});

test("queue permits one exact non-list route row and inserts pending review only", async () => {
  const { source, replay } = await fixtures();
  const audit = NEXT_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES.YhxmMJE5KqAsa2jMYlrs;
  const candidate = await plannedCandidate(replay, source, audit);
  const queries: string[] = [];
  const state = {
    name: audit.destinationName,
    lat: audit.catalogCoordinates.lat,
    lng: audit.catalogCoordinates.lng,
    country_code: audit.countryCode,
    wikidata_id: audit.catalogWikidataId,
    list_ids: [],
    list_names: [],
    cover_fingerprint: audit.catalogCoverFingerprint,
    active_route_fingerprint: audit.catalogActiveRouteFingerprint,
    has_usable_cover: false,
    has_pending_candidate: false,
  };
  const client: Queryable = {
    async query(text, values) {
      queries.push(text);
      if (text.includes("FOR UPDATE")) {
        assert.equal(values?.[1], true);
        return { rows: [state] };
      }
      if (text.includes("SELECT source_page_url, media_sha1")) return { rows: [] };
      if (text.includes("INSERT INTO destination_photo_candidates")) {
        return { rows: [{ id: candidate.id }], rowCount: 1 };
      }
      assert.fail(`unexpected SQL: ${text}`);
    },
  };
  assert.equal(await queueListedPhotoCandidate(client, candidate), "inserted");
  assert.equal(
    queries.some((sql) => /UPDATE\s+destinations/iu.test(sql)),
    false
  );
  const insert = queries.find((sql) =>
    sql.includes("INSERT INTO destination_photo_candidates")
  );
  assert.ok(insert);
  assert.doesNotMatch(insert, /status\s*,/u);
  assert.match(insert, /candidate_origin/u);

  const genericCandidate: ListedPhotoCandidate = {
    ...candidate,
    evidence: {
      type: "wikipedia_article",
      articleTitle: audit.destinationName,
      articleLanguage: "en",
      wikidataId: audit.catalogWikidataId!,
      discovery: "article_image",
    },
  };
  assert.equal(candidate.evidence.type, "reviewed_active_route_commons_file");
  if (candidate.evidence.type !== "reviewed_active_route_commons_file") {
    assert.fail("expected reviewed route evidence");
  }
  const staleRouteBindingCandidate: ListedPhotoCandidate = {
    ...candidate,
    evidence: {
      ...candidate.evidence,
      metadataSha256: "0".repeat(64),
    },
  };
  const tamperedImageUrlCandidate: ListedPhotoCandidate = {
    ...candidate,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/0/00/Wrong.jpg",
  };
  let genericInsertAttempted = false;
  const genericClient: Queryable = {
    async query(text, values) {
      if (text.includes("FOR UPDATE")) {
        assert.equal(values?.[1], false);
        return { rows: [] };
      }
      if (text.includes("INSERT INTO destination_photo_candidates")) {
        genericInsertAttempted = true;
      }
      assert.fail(`generic non-list candidate escaped scope: ${text}`);
    },
  };
  await assert.rejects(
    queueListedPhotoCandidate(genericClient, genericCandidate),
    /scoped Peaks destination disappeared/u
  );
  await assert.rejects(
    queueListedPhotoCandidate(genericClient, staleRouteBindingCandidate),
    /scoped Peaks destination disappeared/u
  );
  await assert.rejects(
    queueListedPhotoCandidate(genericClient, tamperedImageUrlCandidate),
    /scoped Peaks destination disappeared/u
  );
  assert.equal(genericInsertAttempted, false);

  const changedClient: Queryable = {
    async query(text) {
      assert.match(text, /FOR UPDATE/u);
      return { rows: [{ ...state, active_route_fingerprint: "[]" }] };
    },
  };
  assert.equal(
    await queueListedPhotoCandidate(changedClient, candidate),
    "identity_changed"
  );
});
