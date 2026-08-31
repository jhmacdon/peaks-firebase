import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildDobihMajorityFourIdentityAnalysis,
  type DobihMajorityFourIdentityAnalysis,
} from "../build-dobih-majority-four-identity-analysis";

const repoRoot = path.resolve(__dirname, "../../../..");
const fixturesRoot = path.join(repoRoot, "docs/data-audits/fixtures");
const analysisPath = path.join(
  fixturesRoot,
  "keeper-list-dobih-majority-four-identity-analysis-2026-08-31.json"
);
const analysisText = readFileSync(analysisPath, "utf8");
const analysis = JSON.parse(analysisText) as DobihMajorityFourIdentityAnalysis;
const destinationKeys = [
  "countryCode",
  "elevationM",
  "id",
  "lat",
  "lng",
  "name",
  "osmNodeId",
  "stateCode",
];
const migratePackage = JSON.parse(readFileSync(path.join(
  repoRoot,
  "cloud-sql/migrate/package.json"
), "utf8")) as { scripts: Record<string, string> };

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("pins the deterministic fail-closed analysis command and checked report", () => {
  assert.equal(
    migratePackage.scripts["analyze:keeper-list-identities:dobih-majority-four"],
    "tsx src/build-dobih-majority-four-identity-analysis.ts --allow-incomplete"
  );
  assert.equal(migratePackage.scripts["import:keeper-lists:dobih-majority-four"], undefined);
  assert.equal(
    sha256(analysisText),
    "89fda806ed30ceaea4eaa3176ed0d2ccc913ef5ae5b78f0552118e6df3cdcdcf"
  );
  assert.equal(analysis.schemaVersion, 1);
  assert.equal(analysis.generatedAt, "2026-08-31");
  assert.equal(analysis.reviewedAt, "2026-08-31");
  assert.equal(analysis.identityReviewComplete, false);
  assert.equal(analysis.publicationReady, false);
  assert.equal(Object.prototype.hasOwnProperty.call(analysis, "routes"), false);
});

test("pins every input hash, source credit, and read-only catalog boundary", () => {
  const checkedInputs: Array<[string, string]> = [
    [
      "keeper-list-dobih-majority-four-candidates-2026-08-31.json",
      "de3b4025b66e5f7dde1decb2e7a48784044054e0280de46df2d81cc8c8de0eec",
    ],
    [
      "keeper-list-candidates-2026-08-30.json",
      "d29c543e4362c95a6ec6b4bd9b8bffe281a9e967096228a887aea158a5b53a7d",
    ],
    [
      "keeper-list-identity-resolutions-2026-08-30.json",
      "326d0c949af54a059768aab61c18171b7d43470a2c29d7add9f9b8ad103aca77",
    ],
    [
      "keeper-list-dobih-open-eight-candidates-2026-08-30.json",
      "3b778aae7ed3414183ea38cc137c412a7b3d4d12a67c7e7dead8d065e80645ae",
    ],
    [
      "keeper-list-dobih-open-eight-identity-resolutions-2026-08-30.json",
      "bca584753ca3eb8c3b321354cc4e6728f3dcd8d5f5293544fb4ca1efa7ceedb1",
    ],
  ];
  for (const [file, expected] of checkedInputs) {
    assert.equal(sha256(readFileSync(path.join(fixturesRoot, file))), expected, file);
    assert.equal(analysis.inputs[file], expected, file);
  }
  assert.equal(
    analysis.inputs["DoBIH_v18_5.csv"],
    "d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea"
  );
  assert.deepEqual(analysis.catalogSnapshot, {
    file: "/private/tmp/dobih-majority-four-catalog-2026-08-31.csv",
    sha256: "897feb3c3d0bf132694cfcb7455bb43a6b7ad7049f3fbd486bfd16244bfbe8aa",
    rows: 2_524,
    transaction: "REPEATABLE READ READ ONLY",
    selection:
      "Peaks-owned point summits with coordinates inside longitude -11..3 and latitude " +
      "49..61, ordered by destination ID; includes missing and non-GB country codes for " +
      "duplicate guards.",
  });
  assert.deepEqual(
    {
      name: analysis.sourceProvenance.name,
      version: analysis.sourceProvenance.version,
      releasedAt: analysis.sourceProvenance.releasedAt,
      url: analysis.sourceProvenance.url,
      license: analysis.sourceProvenance.license,
      archiveSha256: analysis.sourceProvenance.archiveSha256,
      csvSha256: analysis.sourceProvenance.csvSha256,
    },
    {
      name: "The Database of British and Irish Hills v18.5",
      version: "18.5",
      releasedAt: "2026-07-26",
      url: "https://www.hill-bagging.co.uk/dobih/downloads/",
      license: "CC BY 4.0",
      archiveSha256:
        "0c39e13ac59dd3fa172ac21dd56dd0f6fef19a14af47c7a5a444cce691e9f021",
      csvSha256:
        "d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea",
    }
  );
});

test("cross-checks all prior identities and leaves unsafe automatic reuse open", () => {
  assert.deepEqual(analysis.counts, {
    memberships: 1_627,
    identities: 1_015,
    reusedIdentities: 317,
    reusedExplicitIdentities: 120,
    reusedAutomaticIdentities: 196,
    reusedNeedsReview: 1,
    reusedAutomaticIdentityCollisions: 1,
    newIdentities: 698,
    newCatalogAutoMatches: 169,
    newNeedsReview: 529,
    newAutomaticIdentityCollisions: 3,
    sourceNeighborPairsWithin150M: 6,
    publicationAccessBlocks: 5,
    curatedDestinations: 0,
  });
  assert.equal(analysis.reusedIdentities.length, 317);
  assert.equal(new Set(analysis.reusedIdentities.map((row) => row.sourceMemberId)).size, 317);
  assert.equal(analysis.newIdentities.length, 698);
  assert.equal(new Set(analysis.newIdentities.map((row) => row.sourceMemberId)).size, 698);

  const unresolvedReuse = analysis.reusedIdentities.filter((row) =>
    row.status === "reused_needs_review"
  );
  assert.deepEqual(unresolvedReuse.map((row) => ({
    sourceMemberId: row.sourceMemberId,
    name: row.name,
    destination: row.destination,
    candidate: row.automaticCandidates[0]?.id,
    reasons: row.blockingReasons,
  })), [{
    sourceMemberId: "dobih:2483",
    name: "Armboth Fell",
    destination: null,
    candidate: "94473F8327C5FE57CFFF",
    reasons: [
      "automatic destination 94473F8327C5FE57CFFF is also assigned to dobih:3761",
    ],
  }]);
  const reviewedArmboth = analysis.reusedIdentities.find((row) =>
    row.sourceMemberId === "dobih:3761"
  );
  assert.equal(reviewedArmboth?.status, "reused_explicit");
  assert.equal(reviewedArmboth?.destination?.id, "94473F8327C5FE57CFFF");

  const distinctHighStile = analysis.reusedIdentities.find((row) =>
    row.sourceMemberId === "dobih:2381"
  );
  assert.deepEqual(
    distinctHighStile?.reviewedResolution?.distinctFromDestinationIds,
    ["9DA18880F7EF078569F3"]
  );
  assert.equal(
    distinctHighStile?.reviewedResolutionSha256,
    "6c9480d857162cf50fdeb8775a96950537b5bc033c53c3a2c667801b7261c6bc"
  );
});

test("accepts only unique core auto-matches and blocks cross-source collisions", () => {
  const autoMatches = analysis.newIdentities.filter((row) =>
    row.status === "catalog_auto_match"
  );
  const needsReview = analysis.newIdentities.filter((row) => row.status === "needs_review");
  assert.equal(autoMatches.length, 169);
  assert.equal(needsReview.length, 529);
  for (const row of autoMatches) {
    assert.ok(row.destination, row.sourceMemberId);
    assert.deepEqual(Object.keys(row.destination).sort(), destinationKeys, row.sourceMemberId);
    assert.equal(row.automaticCandidates.length, 1, row.sourceMemberId);
    assert.equal(row.destination.id, row.automaticCandidates[0].id, row.sourceMemberId);
    assert.deepEqual(row.blockingReasons, [], row.sourceMemberId);
  }
  for (const row of analysis.reusedIdentities.filter((candidate) =>
    candidate.status === "reused_automatic"
  )) {
    assert.ok(row.destination, row.sourceMemberId);
    assert.deepEqual(Object.keys(row.destination).sort(), destinationKeys, row.sourceMemberId);
  }
  for (const row of needsReview) {
    assert.equal(row.destination, null, row.sourceMemberId);
    assert.ok(row.blockingReasons.length > 0, row.sourceMemberId);
  }
  assert.deepEqual(
    needsReview.filter((row) => row.blockingReasons.some((reason) =>
      reason.includes("also assigned")
    )).map((row) => [
      row.sourceMemberId,
      row.automaticCandidates[0]?.id,
      row.blockingReasons[0],
    ]),
    [
      [
        "dobih:2667",
        "93DED9CD8B5ED4A78A6D",
        "catalog destination 93DED9CD8B5ED4A78A6D is also assigned to dobih:3863",
      ],
      [
        "dobih:7833",
        "E781623EB98AEDA7DC40",
        "catalog destination E781623EB98AEDA7DC40 is also assigned to dobih:2610",
      ],
      [
        "dobih:19414",
        "CEEC00BC4E0215900E25",
        "catalog destination CEEC00BC4E0215900E25 is also assigned to dobih:2582",
      ],
    ]
  );
});

test("pins every close source pair and every route publication block", () => {
  assert.deepEqual(analysis.sourceNeighborPairs, [
    {
      leftSourceMemberId: "dobih:2607",
      leftName: "Baystones",
      rightSourceMemberId: "dobih:3838",
      rightName: "Wansfell",
      distanceM: 138,
    },
    {
      leftSourceMemberId: "dobih:2610",
      leftName: "Gowbarrow Fell (Wainwright summit)",
      rightSourceMemberId: "dobih:7833",
      rightName: "Gowbarrow Fell",
      distanceM: 104,
    },
    {
      leftSourceMemberId: "dobih:2667",
      leftName: "Top o' Selside",
      rightSourceMemberId: "dobih:3863",
      rightName: "Top o' Selside (Wainwright summit)",
      distanceM: 135,
    },
    {
      leftSourceMemberId: "dobih:2777",
      leftName: "Crinkle Crags - Third Crinkle",
      rightSourceMemberId: "dobih:3724",
      rightName: "Crinkle Crags - Fourth Crinkle",
      distanceM: 86,
    },
    {
      leftSourceMemberId: "dobih:3724",
      leftName: "Crinkle Crags - Fourth Crinkle",
      rightSourceMemberId: "dobih:3725",
      rightName: "Crinkle Crags - Gunson Knott",
      distanceM: 80,
    },
    {
      leftSourceMemberId: "dobih:3876",
      leftName: "Hawk Rigg",
      rightSourceMemberId: "dobih:3883",
      rightName: "Haystacks (Tilberthwaite)",
      distanceM: 146,
    },
  ]);
  assert.deepEqual(
    analysis.accessBlocks.map(({ sourceMemberId, name, kind }) => [
      sourceMemberId,
      name,
      kind,
    ]),
    [
      ["dobih:2390", "Pillar Rock", "technical_climb_optional_member"],
      ["dobih:2711", "Mickle Fell", "controlled_firing_range_access"],
      ["dobih:2713", "Little Fell", "controlled_firing_range_access"],
      ["dobih:2735", "Murton Fell", "controlled_firing_range_access"],
      ["dobih:2877", "High Willhays", "controlled_firing_range_access"],
    ]
  );
  assert.match(analysis.accessBlocks[0].policy, /Do not publish a hiking route/);
  assert.deepEqual(
    analysis.requiredPriorAuxiliaryRepairs.map((repair) => repair.repairId),
    ["dobih:2489-graystones-main", "dobih:2496-grange-wainwright-wikidata"]
  );
});

test("rejects any input byte drift before it can emit an analysis", () => {
  const majorityBytes = readFileSync(path.join(
    fixturesRoot,
    "keeper-list-dobih-majority-four-candidates-2026-08-31.json"
  ));
  assert.throws(
    () => buildDobihMajorityFourIdentityAnalysis({
      majorityCandidateBytes: Buffer.concat([majorityBytes, Buffer.from(" ")]),
      baseCandidateBytes: Buffer.alloc(0),
      baseResolutionBytes: Buffer.alloc(0),
      openEightCandidateBytes: Buffer.alloc(0),
      openEightResolutionBytes: Buffer.alloc(0),
      dobihCsvBytes: Buffer.alloc(0),
      catalogBytes: Buffer.alloc(0),
    }),
    /Majority-four candidate fixture checksum .* does not match/
  );
});
