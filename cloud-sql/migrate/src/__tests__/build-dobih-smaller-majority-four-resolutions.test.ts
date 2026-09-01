import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  DOBIH_SMALLER_MAJORITY_FOUR_NEAR_EXACT_REVIEWS,
  DOBIH_SMALLER_MAJORITY_FOUR_SEMANTIC_DISTINCT_REVIEWS,
  buildDobihSmallerMajorityFourResolutions,
} from "../build-dobih-smaller-majority-four-resolutions";
import {
  DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS,
  DOBIH_SMALLER_MAJORITY_FOUR_PUBLICATION_READY,
  DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS,
} from "../keeper-list-import/bundles/dobih-smaller-majority-four";
import {
  deterministicKeeperDestinationId,
  type KeeperImportFixture,
  type KeeperResolutionFixture,
  type KeeperResolutionRow,
  validateKeeperCrossListConsistency,
  validateKeeperResolutionFixture,
} from "../keeper-list-import/core";

const repoRoot = path.resolve(__dirname, "../../../..");
const fixturesRoot = path.join(repoRoot, "docs/data-audits/fixtures");
const resolutionPath = path.join(
  fixturesRoot,
  "keeper-list-dobih-smaller-majority-four-identity-resolutions-2026-08-31.json"
);
const resolutionText = readFileSync(resolutionPath, "utf8");
const fixture = JSON.parse(readFileSync(path.join(
  fixturesRoot,
  "keeper-list-dobih-smaller-majority-four-candidates-2026-08-31.json"
), "utf8")) as KeeperImportFixture;
const resolutions = JSON.parse(resolutionText) as KeeperResolutionFixture;
const analysis = JSON.parse(readFileSync(path.join(
  fixturesRoot,
  "keeper-list-dobih-smaller-majority-four-identity-analysis-2026-08-31.json"
), "utf8")) as {
  identityReviewComplete: boolean;
  publicationReady: boolean;
  sourceNeighborPairs: unknown[];
  accessBlocks: unknown[];
  reusedIdentities: Array<{ sourceMemberId: string }>;
  newIdentities: Array<{
    sourceMemberId: string;
    status: string;
    closeCatalogNeighbors: unknown[];
  }>;
};
const migratePackage = JSON.parse(readFileSync(
  path.join(repoRoot, "cloud-sql/migrate/package.json"),
  "utf8"
)) as { scripts: Record<string, string> };

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function haversineMeters(
  left: { destinationLat: number; destinationLng: number },
  right: { destinationLat: number; destinationLng: number }
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const leftLat = radians(left.destinationLat);
  const rightLat = radians(right.destinationLat);
  const latDelta = rightLat - leftLat;
  const lngDelta = radians(right.destinationLng - left.destinationLng);
  const a = Math.sin(latDelta / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(lngDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function uniqueRows(): KeeperResolutionRow[] {
  const indexed = new Map<string, KeeperResolutionRow>();
  for (const list of Object.values(resolutions.lists)) {
    for (const row of list.rows) {
      const prior = indexed.get(row.sourceMemberId);
      if (prior == null || row.resolution === "catalog_repair") indexed.set(row.sourceMemberId, row);
    }
  }
  return [...indexed.values()];
}

function outcomeCounts(rows: KeeperResolutionRow[]): Record<string, number> {
  return rows.reduce((counts, row) => {
    counts[row.resolution] = (counts[row.resolution] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
}

test("pins the full checked resolution command and keeps all write paths absent", () => {
  assert.equal(
    migratePackage.scripts["build:keeper-list-resolutions:dobih-smaller-majority-four"],
    "tsx src/build-dobih-smaller-majority-four-resolutions.ts"
  );
  assert.equal(migratePackage.scripts["import:keeper-lists:dobih-smaller-majority-four"], undefined);
  assert.equal(migratePackage.scripts["apply:keeper-lists:dobih-smaller-majority-four"], undefined);
  assert.equal(
    sha256(resolutionText),
    "d979dc4b98cdfcc85f7a18a5621bba389fda6f8e37d27036affa06d571f017a9"
  );
  assert.deepEqual(Object.keys(resolutions).sort(), [
    "catalogRepairs",
    "catalogSnapshotSha256",
    "catalogSnapshots",
    "lists",
    "reviewedAt",
    "schemaVersion",
  ]);
  assert.equal(resolutions.schemaVersion, 1);
  assert.equal(resolutions.reviewedAt, "2026-08-31");
  assert.deepEqual(resolutions.catalogRepairs, []);
});

test("pins every source, snapshot, and evidence hash", () => {
  const expected = {
    "keeper-list-dobih-smaller-majority-four-candidates-2026-08-31.json":
      "4fdc18c1b92a3cc7a54d237b1f805dd54b85368b47679eb22be1af5287c1488b",
    "keeper-list-dobih-smaller-majority-four-identity-analysis-2026-08-31.json":
      "4862036f5fe1149c496af9f4c99af0ab213b02fbcf494307794dfe55fef940f3",
    "DoBIH_v18_5.csv":
      "d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea",
    "small-majority-catalog-20260831.csv":
      "b53e49b3077203e57b657b2a53743cc58504d9ceabd35c22d1664d2b618f5fab",
    "dobih-smaller-majority-four-cruim-leacainn-osm-evidence-2026-08-31.json":
      "ddc8e187ae032bc6da89dea02b2ecb8e87940d2d890550eb59c4d2cf5912fd59",
  };
  assert.equal(
    resolutions.catalogSnapshotSha256,
    expected["small-majority-catalog-20260831.csv"]
  );
  assert.deepEqual(resolutions.catalogSnapshots, expected);
  for (const name of [
    "keeper-list-dobih-smaller-majority-four-candidates-2026-08-31.json",
    "keeper-list-dobih-smaller-majority-four-identity-analysis-2026-08-31.json",
    "dobih-smaller-majority-four-cruim-leacainn-osm-evidence-2026-08-31.json",
  ]) {
    assert.equal(sha256(readFileSync(path.join(fixturesRoot, name))), expected[name], name);
  }
});

test("resolves all 648 identities and all 678 memberships with exact decision counts", () => {
  const membershipRows = Object.values(resolutions.lists).flatMap((list) => list.rows);
  const unique = uniqueRows();
  assert.equal(membershipRows.length, 678);
  assert.equal(unique.length, 648);
  assert.equal(new Set(unique.map((row) => row.sourceMemberId)).size, 648);
  assert.equal(new Set(unique.map((row) => row.destinationId)).size, 648);
  assert.deepEqual(outcomeCounts(unique), {
    catalog_repair: 3,
    curated_destination: 355,
    existing_destination: 290,
  });
  assert.deepEqual(
    Object.entries(resolutions.lists).map(([sourceKey, list]) => [sourceKey, list.rows.length]),
    [
      ["dobih-welsh-3000s", 15],
      ["dobih-great-britain-submarilyns", 100],
      ["dobih-donald-deweys", 247],
      ["dobih-england-wales-2000-foot-register", 316],
    ]
  );
  validateKeeperResolutionFixture(fixture, resolutions, DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS);
  validateKeeperCrossListConsistency(fixture, resolutions, DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS);
});

test("closes exactly the 359-row review gap without changing the 121 prior overlaps", () => {
  const openIds = new Set(analysis.newIdentities.filter((row) =>
    row.status === "needs_review"
  ).map((row) => row.sourceMemberId));
  const rowsBySource = new Map(uniqueRows().map((row) => [row.sourceMemberId, row]));
  const openRows = [...openIds].map((sourceMemberId) => rowsBySource.get(sourceMemberId)!);
  assert.equal(openIds.size, 359);
  assert.equal(openRows.every(Boolean), true);
  assert.deepEqual(outcomeCounts(openRows), {
    catalog_repair: 2,
    curated_destination: 347,
    existing_destination: 10,
  });
  assert.equal(analysis.reusedIdentities.length, 121);
  assert.equal(new Set(analysis.reusedIdentities.map((row) =>
    rowsBySource.get(row.sourceMemberId)?.destinationId
  )).size, 121);
  assert.equal(analysis.identityReviewComplete, false);
  assert.equal(analysis.publicationReady, false);
  assert.deepEqual(analysis.sourceNeighborPairs, []);
});

test("pins all eleven near-exact cases and uses a country-only repair for Yockenthwaite", () => {
  const rowsBySource = new Map(uniqueRows().map((row) => [row.sourceMemberId, row]));
  assert.equal(Object.keys(DOBIH_SMALLER_MAJORITY_FOUR_NEAR_EXACT_REVIEWS).length, 11);
  for (const [sourceMemberId, review] of Object.entries(
    DOBIH_SMALLER_MAJORITY_FOUR_NEAR_EXACT_REVIEWS
  )) {
    const row = rowsBySource.get(sourceMemberId)!;
    assert.equal(row.destinationId, review.destinationId, sourceMemberId);
    assert.equal(row.destinationName, review.destinationName, sourceMemberId);
    assert.equal(
      row.resolution,
      sourceMemberId === "dobih:2791" ? "catalog_repair" : "existing_destination",
      sourceMemberId
    );
    assert.ok(row.evidence.some((line) => line.includes(`${review.distanceM} m`)), sourceMemberId);
  }
  const yockenthwaite = rowsBySource.get("dobih:2791")!;
  assert.deepEqual(yockenthwaite.catalogBefore, {
    name: "Yockenthwaite Moor",
    elevationM: 643,
    lat: 54.225506,
    lng: -2.140927,
    osmNodeId: null,
    countryCode: null,
    stateCode: null,
    externalIds: {},
  });
  assert.deepEqual(
    {
      name: yockenthwaite.destinationName,
      elevationM: yockenthwaite.destinationElevationM,
      lat: yockenthwaite.destinationLat,
      lng: yockenthwaite.destinationLng,
      osmNodeId: yockenthwaite.destinationOsmNodeId,
      countryCode: yockenthwaite.destinationCountryCode,
      stateCode: yockenthwaite.destinationStateCode,
    },
    {
      name: "Yockenthwaite Moor",
      elevationM: 643,
      lat: 54.225506,
      lng: -2.140927,
      osmNodeId: null,
      countryCode: "GB",
      stateCode: null,
    }
  );
  assert.equal(yockenthwaite.catalogExternalIdAdditions, undefined);
  assert.equal(yockenthwaite.catalogExternalIdRemovals, undefined);
});

test("pins Cruim Leacainn's surveyed repair and sole OSM ownership", () => {
  const cruim = uniqueRows().find((row) => row.sourceMemberId === "dobih:344")!;
  assert.equal(cruim.resolution, "catalog_repair");
  assert.deepEqual(cruim.catalogBefore, {
    name: "Cruim Leacainn",
    elevationM: 232,
    lat: 56.8795609,
    lng: -5.0137955,
    osmNodeId: "2781920981",
    countryCode: "GB",
    stateCode: null,
    externalIds: { osm: "2781920981" },
  });
  assert.deepEqual(
    {
      name: cruim.destinationName,
      elevationM: cruim.destinationElevationM,
      lat: cruim.destinationLat,
      lng: cruim.destinationLng,
      osmNodeId: cruim.destinationOsmNodeId,
      countryCode: cruim.destinationCountryCode,
      stateCode: cruim.destinationStateCode,
    },
    {
      name: "Cruim Leacainn",
      elevationM: 231.1,
      lat: 56.88175,
      lng: -5.010484,
      osmNodeId: null,
      countryCode: "GB",
      stateCode: null,
    }
  );
  assert.equal(cruim.catalogExternalIdAdditions, undefined);
  assert.deepEqual(cruim.catalogExternalIdRemovals, { osm: "2781920981" });
  assert.ok(cruim.evidence.some((line) => line.includes("316 m")));
  assert.ok(cruim.evidence.some((line) => line.includes("0.9 m")));
  assert.ok(cruim.evidence.some((line) => line.includes("sole catalog reference")));
  assert.ok(cruim.evidence.some((line) => line.includes("coordinate-bound OSM ID")));
  const repairRows = uniqueRows().filter((row) => row.resolution === "catalog_repair");
  assert.deepEqual(repairRows.map((row) => row.sourceMemberId).sort(), [
    "dobih:2528",
    "dobih:2791",
    "dobih:344",
  ]);
});

test("keeps the five reviewed semantic neighbors as distinct source-backed summits", () => {
  const rowsBySource = new Map(uniqueRows().map((row) => [row.sourceMemberId, row]));
  assert.equal(Object.keys(DOBIH_SMALLER_MAJORITY_FOUR_SEMANTIC_DISTINCT_REVIEWS).length, 5);
  for (const [sourceMemberId, review] of Object.entries(
    DOBIH_SMALLER_MAJORITY_FOUR_SEMANTIC_DISTINCT_REVIEWS
  )) {
    const row = rowsBySource.get(sourceMemberId)!;
    assert.equal(row.resolution, "curated_destination", sourceMemberId);
    assert.equal(row.destinationId, deterministicKeeperDestinationId(sourceMemberId), sourceMemberId);
    assert.equal(row.destinationName, review.destinationName, sourceMemberId);
    assert.deepEqual(
      row.distinctFromDestinationIds,
      review.distinct.map((candidate) => candidate.destinationId).sort(),
      sourceMemberId
    );
    for (const candidate of review.distinct) {
      assert.ok(
        row.evidence.some((line) => line.includes(
          `${candidate.destinationId}:${candidate.name}, ${candidate.distanceM} m`
        )),
        `${sourceMemberId}/${candidate.destinationId}`
      );
    }
    for (const support of review.supportDobihNumbers) {
      assert.ok(row.evidence.some((line) => line.includes(`DoBIH ${support} lists`)));
    }
  }
  assert.equal(rowsBySource.get("dobih:2415")!.destinationName, "Whiteside East Top");
  assert.equal(
    rowsBySource.get("dobih:2446")!.destinationName,
    "Seathwaite Fell (Great Slack summit)"
  );
});

test("collision-checks every curated row against all accepted destinations", () => {
  const rows = uniqueRows();
  const curated = rows.filter((row) => row.resolution === "curated_destination");
  assert.equal(curated.length, 355);
  for (const row of curated) {
    const analysisRow = analysis.newIdentities.find((candidate) =>
      candidate.sourceMemberId === row.sourceMemberId
    );
    if (analysisRow?.status === "needs_review") {
      assert.equal(row.destinationId, deterministicKeeperDestinationId(row.sourceMemberId));
      assert.equal(row.destinationOsmNodeId, null);
      assert.deepEqual(row.destinationExternalIds, {});
      assert.deepEqual(analysisRow.closeCatalogNeighbors, [], row.sourceMemberId);
    }
    const guards = new Set(row.distinctFromDestinationIds ?? []);
    for (const other of rows) {
      if (other.sourceMemberId === row.sourceMemberId) continue;
      const distanceM = haversineMeters(row, other);
      if (distanceM <= 150) {
        assert.ok(guards.has(other.destinationId), `${row.sourceMemberId}/${other.sourceMemberId}`);
      }
    }
  }
});

test("pins GB bounds, source credit, cross-list identity, and all access blocks", () => {
  const rows = uniqueRows();
  for (const row of rows) {
    assert.equal(row.destinationCountryCode, "GB", row.sourceMemberId);
    assert.equal(row.destinationStateCode, null, row.sourceMemberId);
    assert.ok(row.destinationElevationM >= 0 && row.destinationElevationM <= 1_500, row.sourceMemberId);
    assert.ok(row.destinationLat >= 49 && row.destinationLat <= 61, row.sourceMemberId);
    assert.ok(row.destinationLng >= -11 && row.destinationLng <= 3, row.sourceMemberId);
    assert.ok(row.evidence.length > 0, row.sourceMemberId);
  }
  assert.equal(DOBIH_SMALLER_MAJORITY_FOUR_PUBLICATION_READY, false);
  assert.deepEqual(DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS.map((block) => [
    block.sourceMemberId,
    block.name,
    block.reason,
    block.routePublicationAllowed,
    block.accessUrl,
    rows.find((row) => row.sourceMemberId === block.sourceMemberId)?.destinationId,
  ]), [
    [
      "dobih:2711", "Mickle Fell", "live_firing_range", false,
      "https://www.gov.uk/government/publications/warcop-firing-times",
      "B809DFD0EEF01F50F412",
    ],
    [
      "dobih:2713", "Little Fell", "live_firing_range", false,
      "https://www.gov.uk/government/publications/warcop-firing-times",
      deterministicKeeperDestinationId("dobih:2713"),
    ],
    [
      "dobih:2735", "Murton Fell", "live_firing_range", false,
      "https://www.gov.uk/government/publications/warcop-firing-times",
      deterministicKeeperDestinationId("dobih:2735"),
    ],
    [
      "dobih:2877", "High Willhays", "live_firing_range", false,
      "https://www.gov.uk/government/publications/dartmoor-guaranteed-public-access",
      "F0ED9939484E003F7E5C",
    ],
  ]);
  assert.deepEqual(analysis.accessBlocks, DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS);
});

test("fails closed on any pinned input byte drift", () => {
  const candidateBytes = readFileSync(path.join(
    fixturesRoot,
    "keeper-list-dobih-smaller-majority-four-candidates-2026-08-31.json"
  ));
  assert.throws(
    () => buildDobihSmallerMajorityFourResolutions({
      candidateBytes: Buffer.concat([candidateBytes, Buffer.from(" ")]),
      analysisBytes: Buffer.alloc(0),
      dobihCsvBytes: Buffer.alloc(0),
      catalogBytes: Buffer.alloc(0),
      cruimOsmEvidenceBytes: Buffer.alloc(0),
    }),
    /Candidate fixture checksum .* does not match/
  );
});
