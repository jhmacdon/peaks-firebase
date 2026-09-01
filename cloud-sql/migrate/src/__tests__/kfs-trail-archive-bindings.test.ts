import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  KFS_TRAIL_ARCHIVE_SHA256,
  KFS_TRAIL_BINDINGS_COORDINATE_CROSSWALK_SHA256,
  KFS_TRAIL_BINDINGS_SHA256,
  KFS_TRAIL_BINDINGS_SOURCE_CROSSWALK_SHA256,
  KFS_TRAIL_VALIDATION_INPUT_SHA256,
  parseKfsTrailArchiveBindings,
} from "../kfs-trail-archive-bindings";

const fixtureDir = path.resolve(__dirname, "../../../../docs/data-audits/fixtures");
const bindingPath = path.join(
  fixtureDir,
  "keeper-list-kfs-100-famous-mountains-trail-archive-bindings-2026-08-31.json"
);
const coordinatePath = path.join(
  fixtureDir,
  "keeper-list-kfs-100-famous-mountains-coordinate-crosswalk-2026-08-30.json"
);
const sourcePath = path.join(
  fixtureDir,
  "keeper-list-kfs-100-famous-mountains-source-crosswalk-2026-08-30.json"
);

const bindingBytes = readFileSync(bindingPath);
const coordinateBytes = readFileSync(coordinatePath);
const sourceBytes = readFileSync(sourcePath);
const validationInputBytes = readFileSync(path.join(
  fixtureDir,
  "kfs-100-famous-mountains-trail-archive-validation-input-2026-08-31.json"
));
const bindings = parseKfsTrailArchiveBindings(bindingBytes);

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("pins the KFS trail archive and all 100 reviewed joins", () => {
  assert.equal(sha256(bindingBytes), KFS_TRAIL_BINDINGS_SHA256);
  assert.equal(bindings.schemaVersion, 1);
  assert.equal(bindings.reviewedAt, "2026-08-31");
  assert.equal(bindings.registryId, "kfs-100-famous-mountains");
  assert.equal(bindings.use, "validation_only");
  assert.equal(bindings.summitReachThresholdM, 250);
  assert.deepEqual(bindings.inputSha256, {
    coordinateCrosswalk: KFS_TRAIL_BINDINGS_COORDINATE_CROSSWALK_SHA256,
    sourceCrosswalk: KFS_TRAIL_BINDINGS_SOURCE_CROSSWALK_SHA256,
  });
  assert.equal(sha256(coordinateBytes),
    KFS_TRAIL_BINDINGS_COORDINATE_CROSSWALK_SHA256);
  assert.equal(sha256(sourceBytes), KFS_TRAIL_BINDINGS_SOURCE_CROSSWALK_SHA256);
  assert.deepEqual(bindings.archive, {
    sourceUrl:
      "https://www.forest.go.kr/kfsweb/opda/dataMng/fileDown.do?" +
      "dataType=/mount/mountain.zip",
    sha256: KFS_TRAIL_ARCHIVE_SHA256,
    sizeBytes: 265_601_808,
    outerEntryCount: 8_802,
    ignoredBackupEntryCount: 5,
    packageCount: 2_932,
    shapefilePackageCount: 2_932,
    geojsonPackageCount: 2_932,
    gpxPackageCount: 2_932,
    sourceDataDate: "2016-12-31",
    coordinateSystem: "WGS84 GPX",
  });
  assert.deepEqual(bindings.summary, {
    rowCount: 100,
    confirmed: 83,
    unresolved: 17,
    bindingCount: 90,
    archiveCatalogCount: 2_932,
    portalPublishedCount: 2_919,
    catalogCountDisagreement: 13,
  });
  assert.deepEqual(bindings.rows.map((row) => row.ordinal),
    Array.from({ length: 100 }, (_, index) => index + 1));
  assert.equal(new Set(bindings.rows.map((row) => row.sourceMemberId)).size, 100);
  assert.equal(new Set(bindings.rows.map((row) => row.mntnId)).size, 100);
  assert.equal(new Set(bindings.rows.map((row) => row.destinationId)).size, 100);
  assert.equal(new Set(bindings.rows.flatMap((row) =>
    row.bindings.map((binding) => binding.packageCode))).size, 90);
});

test("keeps every destination and summit tied to the checked KFS fixtures", () => {
  const coordinate = JSON.parse(coordinateBytes.toString("utf8")) as {
    rows: Array<{
      ordinal: number;
      sourceMemberId: string;
      mntnId: string;
      kfs: { name: string };
      reviewedSummitPoint: { lat: number; lng: number };
      destination: { destinationId: string };
    }>;
  };
  const source = JSON.parse(sourceBytes.toString("utf8")) as {
    rows: Array<{
      ordinal: number;
      sourceMemberId: string;
      mntnId: string;
      name: string;
    }>;
  };
  for (const [index, row] of bindings.rows.entries()) {
    const coordinateRow = coordinate.rows[index];
    const sourceRow = source.rows[index];
    assert.equal(row.ordinal, coordinateRow.ordinal);
    assert.equal(row.ordinal, sourceRow.ordinal);
    assert.equal(row.sourceMemberId, coordinateRow.sourceMemberId);
    assert.equal(row.sourceMemberId, sourceRow.sourceMemberId);
    assert.equal(row.mntnId, coordinateRow.mntnId);
    assert.equal(row.mntnId, sourceRow.mntnId);
    assert.equal(row.destinationId, coordinateRow.destination.destinationId);
    assert.equal(row.kfsName, coordinateRow.kfs.name);
    assert.equal(row.kfsName, sourceRow.name);
    assert.deepEqual(row.summit, {
      lat: coordinateRow.reviewedSummitPoint.lat,
      lng: coordinateRow.reviewedSummitPoint.lng,
    });
  }
});

test("keeps weak identity and off-summit geometry unresolved", () => {
  const unresolved = bindings.rows.filter((row) => row.status === "unresolved");
  assert.deepEqual(unresolved.map((row) => row.mntnId), [
    "20000004", "20000009", "20000040", "20000934", "20000108",
    "20000112", "20001321", "20000225", "20000276", "20000775",
    "20000455", "20000507", "20000628", "20000661", "20000679",
    "20000688", "20000699",
  ]);
  assert.ok(unresolved.every((row) => row.bindings.length === 0));
  assert.ok(unresolved.every((row) => row.unresolvedReason != null));
  assert.ok(unresolved.every((row) => row.nearestArchiveLine != null));

  const gari = unresolved.find((row) => row.mntnId === "20000004")!;
  assert.equal(gari.unresolvedReason, "identity_not_established");
  assert.equal(gari.nearestArchiveLine?.packageCode, "427207401");
  assert.equal(gari.nearestArchiveLine?.nearestLineDistanceM, 0);

  const hwaaksan = unresolved.find((row) => row.mntnId === "20000679")!;
  assert.equal(hwaaksan.unresolvedReason, "no_near_summit_geometry");
  assert.equal(hwaaksan.nearestArchiveLine?.packageCode, "418204301");
  assert.equal(hwaaksan.nearestArchiveLine?.nearestLineDistanceM, 301.5);
});

test("records only reviewed identity evidence inside the summit gate", () => {
  const confirmed = bindings.rows.filter((row) => row.status === "confirmed");
  assert.equal(confirmed.length, 83);
  for (const row of confirmed) {
    assert.ok(row.bindings.length > 0);
    assert.equal(row.unresolvedReason, null);
    assert.ok(row.bindings.every((binding) =>
      binding.nearestLineDistanceM <= bindings.summitReachThresholdM));
    assert.ok(row.bindings.every((binding) => binding.identityEvidence.length > 0));
  }
  const mayisan = confirmed.find((row) => row.mntnId === "20000176")!;
  assert.deepEqual(mayisan.bindings.map((row) => row.nearestLineDistanceM), [223.9]);
  const cheonseongsan = confirmed.find((row) => row.mntnId === "20000601")!;
  assert.deepEqual(cheonseongsan.bindings.map((row) => row.nearestLineDistanceM), [146.1]);
  const palgongsan = confirmed.find((row) => row.mntnId === "20000651")!;
  assert.deepEqual(palgongsan.bindings.map((row) => row.nearestLineDistanceM), [100.6]);

  const hwangaksan = confirmed.find((row) => row.mntnId === "20000687")!;
  assert.deepEqual(hwangaksan.bindings.map((row) => row.identityMatch),
    ["reviewed_spelling_variant"]);
  assert.deepEqual(hwangaksan.bindings.map((row) => row.packageCode), ["437403701"]);
});

test("emits the route adapter's exact minimal validation input", () => {
  assert.equal(sha256(validationInputBytes), KFS_TRAIL_VALIDATION_INPUT_SHA256);
  const input = JSON.parse(validationInputBytes.toString("utf8")) as {
    schemaVersion: number;
    sourceId: string;
    archiveSha256: string;
    bindings: Array<{ destinationId: string; packageId: string }>;
  };
  assert.deepEqual(Object.keys(input), [
    "schemaVersion", "sourceId", "archiveSha256", "bindings",
  ]);
  assert.equal(input.schemaVersion, 1);
  assert.equal(input.sourceId, "south-korea-kfs-hiking-trails-archive");
  assert.equal(input.archiveSha256, KFS_TRAIL_ARCHIVE_SHA256);
  assert.equal(input.bindings.length, 90);
  assert.ok(input.bindings.every((binding) =>
    Object.keys(binding).join(",") === "destinationId,packageId"));
  assert.deepEqual(input.bindings, bindings.rows.flatMap((row) =>
    row.status === "confirmed"
      ? row.bindings.map((binding) => ({
        destinationId: row.destinationId,
        packageId: binding.packageCode,
      }))
      : []));
});

test("rejects drift, extra fields, and unsafe status changes", () => {
  const raw = JSON.parse(bindingBytes.toString("utf8")) as Record<string, unknown>;
  assert.throws(
    () => parseKfsTrailArchiveBindings(Buffer.from(JSON.stringify({
      ...raw,
      unexpected: true,
    }))),
    /unexpected key/i
  );

  const changedHash = structuredClone(raw) as typeof raw & {
    inputSha256: { coordinateCrosswalk: string };
  };
  changedHash.inputSha256.coordinateCrosswalk = "0".repeat(64);
  assert.throws(
    () => parseKfsTrailArchiveBindings(Buffer.from(JSON.stringify(changedHash))),
    /coordinate crosswalk checksum/i
  );

  const changedStatus = structuredClone(raw) as typeof raw & {
    rows: Array<{ status: string }>;
  };
  changedStatus.rows[0].status = "confirmed";
  assert.throws(
    () => parseKfsTrailArchiveBindings(Buffer.from(JSON.stringify(changedStatus))),
    /confirmed row must have at least one binding/i
  );

  const changedDistance = structuredClone(raw) as typeof raw & {
    rows: Array<{ bindings: Array<{ nearestLineDistanceM: number }> }>;
  };
  const firstConfirmed = changedDistance.rows.find((row) => row.bindings.length > 0)!;
  firstConfirmed.bindings[0].nearestLineDistanceM = 250.1;
  assert.throws(
    () => parseKfsTrailArchiveBindings(Buffer.from(JSON.stringify(changedDistance))),
    /summit reach threshold/i
  );
});
