import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildDobihSmallerMajorityFourIdentityAnalysis,
  type DobihSmallerMajorityFourIdentityAnalysis,
} from "../build-dobih-smaller-majority-four-identity-analysis";

const repoRoot = path.resolve(__dirname, "../../../..");
const fixturesRoot = path.join(repoRoot, "docs/data-audits/fixtures");
const analysisPath = path.join(
  fixturesRoot,
  "keeper-list-dobih-smaller-majority-four-identity-analysis-2026-08-31.json"
);
const analysisText = readFileSync(analysisPath, "utf8");
const analysis = JSON.parse(analysisText) as DobihSmallerMajorityFourIdentityAnalysis;
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
    migratePackage.scripts["analyze:keeper-list-identities:dobih-smaller-majority-four"],
    "tsx src/build-dobih-smaller-majority-four-identity-analysis.ts --allow-incomplete"
  );
  assert.equal(migratePackage.scripts["import:keeper-lists:dobih-smaller-majority-four"], undefined);
  assert.equal(
    sha256(analysisText),
    "4862036f5fe1149c496af9f4c99af0ab213b02fbcf494307794dfe55fef940f3"
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
      "keeper-list-dobih-smaller-majority-four-candidates-2026-08-31.json",
      "4fdc18c1b92a3cc7a54d237b1f805dd54b85368b47679eb22be1af5287c1488b",
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
    file: "/private/tmp/small-majority-catalog-20260831.csv",
    sha256: "b53e49b3077203e57b657b2a53743cc58504d9ceabd35c22d1664d2b618f5fab",
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

test("cross-checks all 121 prior identities without weakening old decisions", () => {
  assert.deepEqual(analysis.counts, {
    memberships: 678,
    identities: 648,
    reusedIdentities: 121,
    reusedExplicitIdentities: 27,
    reusedAutomaticIdentities: 94,
    reusedNeedsReview: 0,
    reusedAutomaticIdentityCollisions: 0,
    newIdentities: 527,
    newCatalogAutoMatches: 168,
    newNeedsReview: 359,
    newAutomaticIdentityCollisions: 0,
    sourceNeighborPairsWithin150M: 0,
    publicationAccessBlocks: 4,
    curatedDestinations: 0,
  });
  assert.equal(analysis.reusedIdentities.length, 121);
  assert.equal(new Set(analysis.reusedIdentities.map((row) => row.sourceMemberId)).size, 121);
  assert.equal(analysis.newIdentities.length, 527);
  assert.equal(new Set(analysis.newIdentities.map((row) => row.sourceMemberId)).size, 527);
  const ownerCounts = (
    rows: Array<{ owners: string[] }>,
    sourceKey: string
  ) => rows.filter((row) => row.owners.includes(sourceKey)).length;
  assert.deepEqual(
    [
      "dobih-welsh-3000s",
      "dobih-great-britain-submarilyns",
      "dobih-donald-deweys",
      "dobih-england-wales-2000-foot-register",
    ].map((sourceKey) => [
      sourceKey,
      ownerCounts(analysis.reusedIdentities, sourceKey),
      ownerCounts(analysis.newIdentities, sourceKey),
    ]),
    [
      ["dobih-welsh-3000s", 15, 0],
      ["dobih-great-britain-submarilyns", 9, 91],
      ["dobih-donald-deweys", 1, 246],
      ["dobih-england-wales-2000-foot-register", 116, 200],
    ]
  );

  const unresolvedReuse = analysis.reusedIdentities.filter((row) =>
    row.status === "reused_needs_review"
  );
  assert.deepEqual(unresolvedReuse, []);
  assert.equal(
    new Set(analysis.reusedIdentities.map((row) => row.destination?.id)).size,
    121
  );
  assert.deepEqual(
    analysis.reusedIdentities
      .filter((row) => row.dobihNumber >= 1963 && row.dobihNumber <= 1977)
      .map((row) => row.dobihNumber),
    Array.from({ length: 15 }, (_, index) => 1963 + index)
  );
});

test("accepts only 168 unique core auto-matches and leaves 359 open", () => {
  const autoMatches = analysis.newIdentities.filter((row) =>
    row.status === "catalog_auto_match"
  );
  const needsReview = analysis.newIdentities.filter((row) => row.status === "needs_review");
  assert.equal(autoMatches.length, 168);
  assert.equal(needsReview.length, 359);
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
  assert.equal(
    new Set([
      ...analysis.reusedIdentities.map((row) => row.destination!.id),
      ...autoMatches.map((row) => row.destination!.id),
    ]).size,
    121 + 168
  );
  assert.deepEqual(
    needsReview.filter((row) => row.automaticCandidates.length > 0),
    []
  );
});

test("pins all four firing-range publication blocks", () => {
  assert.deepEqual(analysis.sourceNeighborPairs, []);
  assert.deepEqual(
    analysis.accessBlocks.map(({
      sourceMemberId,
      name,
      reason,
      routePublicationAllowed,
    }) => [
      sourceMemberId,
      name,
      reason,
      routePublicationAllowed,
    ]),
    [
      ["dobih:2711", "Mickle Fell", "live_firing_range", false],
      ["dobih:2713", "Little Fell", "live_firing_range", false],
      ["dobih:2735", "Murton Fell", "live_firing_range", false],
      ["dobih:2877", "High Willhays", "live_firing_range", false],
    ]
  );
  assert.deepEqual(analysis.requiredPriorAuxiliaryRepairs, []);
});

test("rejects any input byte drift before it can emit an analysis", () => {
  const majorityBytes = readFileSync(path.join(
    fixturesRoot,
    "keeper-list-dobih-smaller-majority-four-candidates-2026-08-31.json"
  ));
  assert.throws(
    () => buildDobihSmallerMajorityFourIdentityAnalysis({
      majorityCandidateBytes: Buffer.concat([majorityBytes, Buffer.from(" ")]),
      baseCandidateBytes: Buffer.alloc(0),
      baseResolutionBytes: Buffer.alloc(0),
      openEightCandidateBytes: Buffer.alloc(0),
      openEightResolutionBytes: Buffer.alloc(0),
      dobihCsvBytes: Buffer.alloc(0),
      catalogBytes: Buffer.alloc(0),
    }),
    /Smaller majority-four candidate fixture checksum .* does not match/
  );
});
