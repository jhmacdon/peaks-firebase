import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { ZipFile } from "yazl";
import * as unzipper from "unzipper";

import {
  assertCheckedBindingsSha256,
  assertKfsTrailArchiveIdentity,
  assertKfsZipCentralDirectory,
  KFS_TRAIL_ARCHIVE_BYTES,
  KFS_TRAIL_ARCHIVE_CATALOG_URL,
  KFS_TRAIL_ARCHIVE_DOWNLOAD_URL,
  KFS_TRAIL_ARCHIVE_PACKAGE_COUNT,
  KFS_TRAIL_ARCHIVE_SHA256,
  KFS_TRAIL_LINE_FEATURE_COUNT,
  KFS_TRAIL_MAIN_POINT_COUNT,
  KFS_TRAIL_SAFETY_POINT_COUNT,
  KFS_TRAIL_SOURCE_ID,
  kfsTrailArchiveEvidence,
  parseKfsTrailArchiveStream,
  parseKfsTrailGeojsonPackageStream,
  parseKfsTrailBindings,
} from "../kfs-trail-archive";
import { parseKfsTrailFinderArgs } from "../find-kfs-trail-geometry";
import {
  validateRouteAccessSource,
  validateRouteIdentitySource,
} from "../standard-route-identity-source";

const PROJECTED_WKT =
  'PROJCS["PCS_ITRF2000_TM",GEOGCS["GCS_ITRF_2000",DATUM["D_ITRF_2000",' +
  'SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],' +
  'UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],' +
  'PARAMETER["False_Easting",200000.0],PARAMETER["False_Northing",600000.0],' +
  'PARAMETER["Central_Meridian",127.0],PARAMETER["Scale_Factor",1.0],' +
  'PARAMETER["Latitude_Of_Origin",38.0],UNIT["Meter",1.0]]';

const PROJECTED_WKT_NAME_VARIANT =
  'PROJCS["PCS_ITRF2000_TM(중부원점)",GEOGCS["GCS_ITRF_2000",DATUM["D_ITRF_2000",' +
  'SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],' +
  'UNIT["DEGREE",0.0174532925199]],PROJECTION["Transverse_Mercator"],' +
  'PARAMETER["false_easting",200000.0],PARAMETER["false_northing",600000.0],' +
  'PARAMETER["central_meridian",127.0],PARAMETER["standard_parallel_1",0.0],' +
  'PARAMETER["standard_parallel_2",0.0],PARAMETER["scale_factor",1.0],' +
  'PARAMETER["latitude_of_origin",38.0],UNIT["METER",1.0]]';

const LINE_FIELDS = [
  ["FID", "esriFieldTypeOID"],
  ["PMNTN_SN", "esriFieldTypeDouble"],
  ["MNTN_CODE", "esriFieldTypeString"],
  ["MNTN_NM", "esriFieldTypeString"],
  ["PMNTN_NM", "esriFieldTypeString"],
  ["PMNTN_MAIN", "esriFieldTypeString"],
  ["PMNTN_LT", "esriFieldTypeSingle"],
  ["PMNTN_DFFL", "esriFieldTypeString"],
  ["PMNTN_UPPL", "esriFieldTypeDouble"],
  ["PMNTN_GODN", "esriFieldTypeDouble"],
  ["PMNTN_MTRQ", "esriFieldTypeString"],
  ["PMNTN_CNRL", "esriFieldTypeString"],
  ["PMNTN_CLS_", "esriFieldTypeString"],
  ["PMNTN_RISK", "esriFieldTypeString"],
  ["PMNTN_RECO", "esriFieldTypeString"],
  ["DATA_STDR_", "esriFieldTypeString"],
  ["MNTN_ID", "esriFieldTypeString"],
] as const;

const POINT_FIELDS = [
  ["FID", "esriFieldTypeOID"],
  ["PMNTN_SPOT", "esriFieldTypeDouble"],
  ["MNTN_CODE", "esriFieldTypeString"],
  ["MANAGE_SP1", "esriFieldTypeString"],
  ["MANAGE_SP2", "esriFieldTypeString"],
  ["DETAIL_SPO", "esriFieldTypeString"],
  ["ETC_MATTER", "esriFieldTypeString"],
  ["MNTN_NM", "esriFieldTypeString"],
  ["PAST_SPOT_", "esriFieldTypeString"],
  ["MNTN_ID", "esriFieldTypeString"],
] as const;

function esriFields(fields: readonly (readonly [string, string])[]) {
  return fields.map(([name, type]) => ({ name, type, alias: name }));
}

function aliases(fields: readonly (readonly [string, string])[]) {
  return Object.fromEntries(fields.map(([name]) => [name, name]));
}

function lineAttributes(packageId: string, serial: number, name = "Test Peak") {
  return {
    FID: 0,
    PMNTN_SN: serial,
    MNTN_CODE: packageId,
    MNTN_NM: name,
    PMNTN_NM: "Test Trail",
    PMNTN_MAIN: " ",
    PMNTN_LT: 0.1,
    PMNTN_DFFL: "easy",
    PMNTN_UPPL: 1,
    PMNTN_GODN: 1,
    PMNTN_MTRQ: " ",
    PMNTN_CNRL: " ",
    PMNTN_CLS_: " ",
    PMNTN_RISK: " ",
    PMNTN_RECO: " ",
    DATA_STDR_: "2016-12-31",
    MNTN_ID: packageId,
  };
}

function pointAttributes(
  packageId: string,
  spot: number,
  manageCode: string,
  manageName: string
) {
  return {
    FID: spot,
    PMNTN_SPOT: spot,
    MNTN_CODE: packageId,
    MANAGE_SP1: manageCode,
    MANAGE_SP2: manageName,
    DETAIL_SPO: manageName,
    ETC_MATTER: " ",
    MNTN_NM: "Test Peak",
    PAST_SPOT_: `${packageId}${String(spot).padStart(4, "0")}`,
    MNTN_ID: packageId,
  };
}

function lineDocument(
  packageId: string,
  options: {
    wgs84?: boolean;
    serials?: number[];
    name?: string;
    fields?: Array<{ name: string; type: string; alias: string }>;
    code?: string;
    fids?: number[];
    wkt?: string;
  } = {}
) {
  const fields = options.fields ?? esriFields(LINE_FIELDS);
  const fieldNames = new Set(fields.map(({ name }) => name));
  const wgs84 = options.wgs84 ?? false;
  const coordinates = wgs84
    ? [[126.60, 33.30], [126.61, 33.31]]
    : [[197_053.29, 555_650.28], [197_061.76, 555_644.50]];
  return {
    displayFieldName: "",
    fieldAliases: Object.fromEntries(fields.map(({ name }) => [name, name])),
    geometryType: "esriGeometryPolyline",
    spatialReference: wgs84
      ? { wkid: 4326, latestWkid: 4326 }
      : { wkt: options.wkt ?? PROJECTED_WKT },
    fields,
    features: (options.serials ?? [26_719]).map((serial, index) => ({
      attributes: Object.fromEntries(
        Object.entries({
          ...lineAttributes(options.code ?? packageId, serial, options.name),
          FID: options.fids?.[index] ?? index,
        }).filter(([name]) => fieldNames.has(name))
      ),
      geometry: { paths: [coordinates] },
    })),
  };
}

function pointDocument(
  packageId: string,
  spotType: "esriFieldTypeDouble" | "esriFieldTypeInteger" = "esriFieldTypeDouble"
) {
  const fields = esriFields(POINT_FIELDS).map((field) =>
    field.name === "PMNTN_SPOT" ? { ...field, type: spotType } : field
  );
  return {
    displayFieldName: "",
    fieldAliases: aliases(POINT_FIELDS),
    geometryType: "esriGeometryPoint",
    spatialReference: { wkt: PROJECTED_WKT },
    fields,
    features: [
      {
        attributes: pointAttributes(packageId, 1, "01", "시종점"),
        geometry: { x: 196_565.32, y: 555_796.17 },
      },
      {
        attributes: pointAttributes(packageId, 2, "02", "분기점"),
        geometry: { x: 196_602.80, y: 555_793.41 },
      },
    ],
  };
}

function safetyPointDocument(packageId: string, serial: number) {
  const fields = esriFields([
    ["FID", "esriFieldTypeOID"],
    ["SAFE_SPOT1", "esriFieldTypeDouble"],
    ["SAFE_SPOT2", "esriFieldTypeString"],
    ["SAFE_SPOT3", "esriFieldTypeString"],
    ["MGC", "esriFieldTypeString"],
    ["ETC_MATTER", "esriFieldTypeString"],
    ["MNTN_NM", "esriFieldTypeString"],
  ] as const);
  return {
    displayFieldName: "",
    fieldAliases: Object.fromEntries(fields.map(({ name }) => [name, name])),
    geometryType: "esriGeometryPoint",
    spatialReference: { wkt: PROJECTED_WKT },
    fields,
    features: [
      {
        attributes: {
          FID: 0,
          SAFE_SPOT1: serial,
          SAFE_SPOT2: "marker",
          SAFE_SPOT3: "1-1",
          MGC: "agency",
          ETC_MATTER: " ",
          MNTN_NM: packageId,
        },
        geometry: { x: 196_565.32, y: 555_796.17 },
      },
    ],
  };
}

async function zipBuffer(
  entries: Array<{
    path: string;
    body?: Buffer;
    directory?: boolean;
    mode?: number;
  }>
): Promise<Buffer> {
  const archive = new ZipFile();
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.once("error", reject);
    archive.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
  });
  for (const entry of entries) {
    const options = entry.mode === undefined ? undefined : { mode: entry.mode };
    if (entry.directory) archive.addEmptyDirectory(entry.path, options);
    else archive.addBuffer(entry.body ?? Buffer.alloc(0), entry.path, options);
  }
  archive.end();
  return complete;
}

async function nestedGeojsonZip(
  packageId: string,
  line = lineDocument(packageId),
  points = pointDocument(packageId),
  extraEntries: Array<{ path: string; body?: Buffer; directory?: boolean }> = []
): Promise<Buffer> {
  return zipBuffer([
    { path: `PMNTN_Test_${packageId}.json`, body: Buffer.from(JSON.stringify(line)) },
    {
      path: `PMNTN_SPOT_Test_${packageId}.json`,
      body: Buffer.from(JSON.stringify(points)),
    },
    { path: "readme.txt", body: Buffer.from("official archive fixture") },
    ...extraEntries,
  ]);
}

async function outerArchive(
  packages: Array<{ packageId: string; nested: Buffer }>,
  extraEntries: Array<{ path: string; body?: Buffer; directory?: boolean }> = []
): Promise<Buffer> {
  return zipBuffer([
    { path: "mountain/", directory: true },
    ...packages.flatMap(({ packageId, nested }) => [
      { path: `mountain/${packageId}.zip`, body: Buffer.from("shapefile bundle") },
      { path: `mountain/${packageId}_geojson.zip`, body: nested },
      { path: `mountain/${packageId}_gpx.zip`, body: Buffer.from("gpx bundle") },
    ]),
    ...extraEntries,
  ]);
}

function replaceAllAscii(buffer: Buffer, from: string, to: string): Buffer {
  return replaceAllBytes(buffer, Buffer.from(from), Buffer.from(to));
}

function replaceAllBytes(buffer: Buffer, needle: Buffer, replacement: Buffer): Buffer {
  assert.equal(needle.length, replacement.length);
  const changed = Buffer.from(buffer);
  let offset = 0;
  let replacements = 0;
  while ((offset = changed.indexOf(needle, offset)) !== -1) {
    replacement.copy(changed, offset);
    offset += replacement.length;
    replacements++;
  }
  assert.ok(replacements >= 2);
  return changed;
}

async function parseFixture(
  archive: Buffer,
  packageIds: string[],
  expectedPackageCount = packageIds.length
) {
  return parseKfsTrailArchiveStream(Readable.from(archive), {
    expectedPackageCount,
    selectedPackageIds: packageIds,
    expectedLegacyEntries: [],
  });
}

test("production archive identity and stale-access facts are pinned", () => {
  assert.equal(KFS_TRAIL_ARCHIVE_BYTES, 265_601_808);
  assert.equal(
    KFS_TRAIL_ARCHIVE_SHA256,
    "e017b599947b4a14493771ed810d0c0221d5e9ab7e9dd5c5b1fc24a69ede0c72"
  );
  assert.equal(KFS_TRAIL_ARCHIVE_PACKAGE_COUNT, 2_932);
  assert.equal(KFS_TRAIL_LINE_FEATURE_COUNT, 57_070);
  assert.equal(KFS_TRAIL_MAIN_POINT_COUNT, 101_257);
  assert.equal(KFS_TRAIL_SAFETY_POINT_COUNT, 5_876);
  assert.deepEqual(kfsTrailArchiveEvidence(), {
    archiveUrl: KFS_TRAIL_ARCHIVE_DOWNLOAD_URL,
    catalogUrl: KFS_TRAIL_ARCHIVE_CATALOG_URL,
    dataCutoff: "2016-12-31",
    currentAccessSatisfied: false,
    publicationEligible: false,
  });
  assert.doesNotThrow(() =>
    assertKfsTrailArchiveIdentity({
      size: KFS_TRAIL_ARCHIVE_BYTES,
      sha256: KFS_TRAIL_ARCHIVE_SHA256,
    })
  );
  assert.throws(
    () =>
      assertKfsTrailArchiveIdentity({
        size: KFS_TRAIL_ARCHIVE_BYTES - 1,
        sha256: KFS_TRAIL_ARCHIVE_SHA256,
      }),
    /byte size/
  );
  assert.throws(
    () =>
      assertKfsTrailArchiveIdentity({
        size: KFS_TRAIL_ARCHIVE_BYTES,
        sha256: "0".repeat(64),
      }),
    /SHA-256/
  );
});

test("the old archive and catalog URLs can never prove current access", () => {
  for (const url of [
    KFS_TRAIL_ARCHIVE_DOWNLOAD_URL,
    KFS_TRAIL_ARCHIVE_CATALOG_URL,
  ]) {
    const identitySource = validateRouteIdentitySource(
      { type: KFS_TRAIL_SOURCE_ID, url },
      0
    );
    assert.throws(
      () => validateRouteAccessSource(url, [identitySource]),
      /cannot prove current access/
    );
  }

  for (const relabeledCatalog of [
    `${KFS_TRAIL_ARCHIVE_CATALOG_URL}?forged=1`,
    `${KFS_TRAIL_ARCHIVE_CATALOG_URL}/`,
    `${KFS_TRAIL_ARCHIVE_CATALOG_URL}/anything`,
    `${KFS_TRAIL_ARCHIVE_CATALOG_URL};jsessionid=stale`,
    `${KFS_TRAIL_ARCHIVE_CATALOG_URL}%5Canything`,
    "https://www.data.go.kr/data;jsessionid=stale/3034022/fileData.do",
    "https://www.data.go.kr/data/3034022;v=1/fileData.do",
    "https://www.data.go.kr/data/%33%30%33%34%30%32%32/fileData.do",
  ]) {
    assert.throws(
      () =>
        validateRouteIdentitySource(
          {
            type: "south-korea-mlit-hiking-roads",
            url: relabeledCatalog,
          },
          0
        ),
      /belongs to south-korea-kfs-hiking-trails-archive/
    );
    assert.throws(
      () =>
        validateRouteAccessSource(relabeledCatalog, [
          {
            type: "south-korea-mlit-hiking-roads",
            url: relabeledCatalog,
          },
        ]),
      /cannot prove current access/
    );
  }
});

test("streaming parser transforms EPSG:5186 and emits only start/end candidates", async () => {
  const packageId = "111100101";
  const archive = await outerArchive([
    { packageId, nested: await nestedGeojsonZip(packageId) },
  ]);
  const report = await parseFixture(archive, [packageId]);

  assert.equal(report.publicationEligible, false);
  assert.equal(report.currentAccessSatisfied, false);
  assert.equal(report.manifest.packageCount, 1);
  assert.equal(report.packages.length, 1);
  assert.equal(report.packages[0].lines.length, 1);
  assert.equal(report.packages[0].lines[0].id, "kfs:111100101:line:26719");
  assert.equal(report.packages[0].lines[0].sourceCrs, "EPSG:5186");
  const first = report.packages[0].lines[0].paths[0][0];
  assert.ok(first[0] > 126 && first[0] < 128);
  assert.ok(first[1] > 36 && first[1] < 39);
  assert.equal(report.packages[0].sourcePointCount, 2);
  assert.equal(report.packages[0].trailheadCandidates.length, 1);
  assert.equal(report.packages[0].trailheadCandidates[0].manageCode, "01");
  assert.equal(report.packages[0].trailheadCandidates[0].manageName, "시종점");
  assert.match(
    report.packages[0].trailheadCandidates[0].id,
    /^kfs:111100101:trailhead:[a-f0-9]{24}$/
  );
});

test("trailhead IDs exclude snapshot provenance and merge exact semantic duplicates", async () => {
  const packageId = "111100101";
  const points = pointDocument(packageId);
  const duplicate = structuredClone(points.features[0]);
  duplicate.attributes.FID = 101;
  duplicate.attributes.PAST_SPOT_ = "1111001019001";
  const changedMeaning = structuredClone(points.features[0]);
  changedMeaning.attributes.FID = 102;
  changedMeaning.attributes.PAST_SPOT_ = "1111001019002";
  changedMeaning.attributes.DETAIL_SPO = "different start";
  const changedCoordinate = structuredClone(points.features[0]);
  changedCoordinate.attributes.FID = 103;
  changedCoordinate.attributes.PAST_SPOT_ = "1111001019003";
  changedCoordinate.geometry.x += 1;
  points.features.push(duplicate, changedMeaning, changedCoordinate);

  const report = await parseFixture(
    await outerArchive([
      {
        packageId,
        nested: await nestedGeojsonZip(packageId, lineDocument(packageId), points),
      },
    ]),
    [packageId]
  );
  const candidates = report.packages[0].trailheadCandidates;
  assert.equal(candidates.length, 3);
  assert.equal(new Set(candidates.map(({ id }) => id)).size, 3);
  const merged = candidates.find(({ sourceFids }) => sourceFids.length === 2);
  assert.deepEqual(merged?.sourceFids, [1, 101]);
  assert.deepEqual(merged?.pastSpotIds, ["1111001010001", "1111001019001"]);
});

test("line IDs use outer package and serial, never a mountain name", async () => {
  const packageId = "111100101";
  const first = await parseFixture(
    await outerArchive([
      {
        packageId,
        nested: await nestedGeojsonZip(packageId, lineDocument(packageId, { name: "A" })),
      },
    ]),
    [packageId]
  );
  const second = await parseFixture(
    await outerArchive([
      {
        packageId,
        nested: await nestedGeojsonZip(packageId, lineDocument(packageId, { name: "B" })),
      },
    ]),
    [packageId]
  );
  assert.equal(first.packages[0].lines[0].id, second.packages[0].lines[0].id);
});

test("only package 491106604 may carry a WGS84 line document", async () => {
  const exceptionId = "491106604";
  const accepted = await parseFixture(
    await outerArchive([
      {
        packageId: exceptionId,
        nested: await nestedGeojsonZip(
          exceptionId,
          lineDocument(exceptionId, { wgs84: true }),
          pointDocument(exceptionId)
        ),
      },
    ]),
    [exceptionId]
  );
  assert.equal(accepted.packages[0].lines[0].sourceCrs, "EPSG:4326");

  const ordinaryId = "111100101";
  const ordinaryWgs84 = await outerArchive([
    {
      packageId: ordinaryId,
      nested: await nestedGeojsonZip(
        ordinaryId,
        lineDocument(ordinaryId, { wgs84: true })
      ),
    },
  ]);
  await assert.rejects(
    () => parseFixture(ordinaryWgs84, [ordinaryId]),
    /WGS84.*491106604/
  );
});

test("parser rejects unsafe outer entries and incomplete package triplets", async () => {
  const packageId = "111100101";
  const nested = await nestedGeojsonZip(packageId);
  const unsafeSeed = await outerArchive(
    [{ packageId, nested }],
    [{ path: "mountain/safe/escape.zip", body: Buffer.from("bad") }]
  );
  const unsafe = replaceAllAscii(
    unsafeSeed,
    "mountain/safe/escape.zip",
    "mountain/.././escape.zip"
  );
  await assert.rejects(() => parseFixture(unsafe, [packageId]), /unsafe|not allowed/);

  const incomplete = await zipBuffer([
    { path: "mountain/", directory: true },
    { path: `mountain/${packageId}_geojson.zip`, body: nested },
  ]);
  await assert.rejects(
    () => parseFixture(incomplete, [packageId]),
    /complete shapefile, GeoJSON, and GPX triplet/
  );

  const sourceFailureArchive = await outerArchive([{ packageId, nested }]);
  let sent = false;
  const failingSource = new Readable({
    read() {
      if (sent) return;
      sent = true;
      this.push(sourceFailureArchive);
      queueMicrotask(() => this.destroy(new Error("synthetic ZIP source failure")));
    },
  });
  await assert.rejects(
    () =>
      parseKfsTrailArchiveStream(failingSource, {
        expectedPackageCount: 1,
        selectedPackageIds: [packageId],
        expectedLegacyEntries: [],
      }),
    /synthetic ZIP source failure/
  );

  let nestedSent = false;
  const failingNestedSource = new Readable({
    read() {
      if (nestedSent) return;
      nestedSent = true;
      this.push(nested);
      queueMicrotask(() =>
        this.destroy(new Error("synthetic nested ZIP source failure"))
      );
    },
  });
  await assert.rejects(
    () => parseKfsTrailGeojsonPackageStream(failingNestedSource, packageId),
    /synthetic nested ZIP source failure/
  );
});

test("stream validation hashes the exact outer ZIP bytes it parses", async () => {
  const packageId = "111100101";
  const archive = await outerArchive([
    { packageId, nested: await nestedGeojsonZip(packageId) },
  ]);
  const expectedArchiveIdentity = {
    size: archive.length,
    sha256: createHash("sha256").update(archive).digest("hex"),
  };
  const centralDirectory = await unzipper.Open.buffer(archive);
  const expectedOuterEntryPathKeys = assertKfsZipCentralDirectory(
    centralDirectory.files
  );
  const options = {
    expectedPackageCount: 1,
    selectedPackageIds: [packageId],
    expectedLegacyEntries: [],
    expectedArchiveIdentity,
    expectedOuterEntryPathKeys,
  };
  await assert.doesNotReject(() =>
    parseKfsTrailArchiveStream(Readable.from(archive), options)
  );
  await assert.rejects(
    () =>
      parseKfsTrailArchiveStream(Readable.from(archive), {
        ...options,
        expectedArchiveIdentity: {
          ...expectedArchiveIdentity,
          sha256: "0".repeat(64),
        },
      }),
    /parsed KFS trail archive SHA-256/
  );
  await assert.rejects(
    () =>
      parseKfsTrailArchiveStream(Readable.from(archive), {
        ...options,
        expectedOuterEntryPathKeys: expectedOuterEntryPathKeys.slice(1),
      }),
    /central-directory paths\/count do not match/
  );
});

test("stream parsing completes at EOF while a shared file descriptor stays open", async (t) => {
  const packageId = "111100101";
  const archive = await outerArchive([
    { packageId, nested: await nestedGeojsonZip(packageId) },
  ]);
  const directory = await mkdtemp(join(tmpdir(), "kfs-held-fd-"));
  const archivePath = join(directory, "fixture.zip");
  await writeFile(archivePath, archive);
  const archiveFile = await open(archivePath, "r");
  t.after(async () => {
    await archiveFile.close();
    await rm(directory, { recursive: true, force: true });
  });

  const report = await parseKfsTrailArchiveStream(
    createReadStream(archivePath, {
      fd: archiveFile.fd,
      start: 0,
      autoClose: false,
      highWaterMark: 1,
    }),
    {
      expectedPackageCount: 1,
      selectedPackageIds: [packageId],
      expectedLegacyEntries: [],
      expectedArchiveIdentity: {
        size: archive.length,
        sha256: createHash("sha256").update(archive).digest("hex"),
      },
    }
  );

  assert.equal(report.packages[0].packageId, packageId);
  assert.equal((await archiveFile.stat()).size, archive.length);
});

test("central-directory preflight rejects Unix symbolic links", async () => {
  const symlinkArchive = await zipBuffer([
    {
      path: "mountain/link.zip",
      body: Buffer.from("target"),
      mode: 0o120777,
    },
  ]);
  const centralDirectory = await unzipper.Open.buffer(symlinkArchive);
  assert.throws(
    () => assertKfsZipCentralDirectory(centralDirectory.files),
    /symbolic link/
  );

  const fifoArchive = await zipBuffer([
    {
      path: "mountain/fifo.zip",
      body: Buffer.alloc(0),
      mode: 0o010644,
    },
  ]);
  const fifoCentralDirectory = await unzipper.Open.buffer(fifoArchive);
  assert.throws(
    () => assertKfsZipCentralDirectory(fifoCentralDirectory.files),
    /unsupported Unix file type/
  );
});

test("parser rejects changed schemas, package IDs, and duplicate serials", async () => {
  const packageId = "111100101";
  const missingField = lineDocument(packageId, {
    fields: esriFields(LINE_FIELDS).filter((field) => field.name !== "PMNTN_SN"),
  });
  const missingFieldArchive = await outerArchive([
    { packageId, nested: await nestedGeojsonZip(packageId, missingField) },
  ]);
  await assert.rejects(
    () => parseFixture(missingFieldArchive, [packageId]),
    /fieldAliases|line field schema/
  );

  const mismatchedCodeArchive = await outerArchive([
    {
      packageId,
      nested: await nestedGeojsonZip(
        packageId,
        lineDocument(packageId, { code: "222200202" })
      ),
    },
  ]);
  await assert.rejects(
    () => parseFixture(mismatchedCodeArchive, [packageId]),
    /MNTN_CODE.*outer package/
  );

  const duplicateSerialArchive = await outerArchive([
    {
      packageId,
      nested: await nestedGeojsonZip(
        packageId,
        lineDocument(packageId, { serials: [7, 7] })
      ),
    },
  ]);
  await assert.rejects(
    () => parseFixture(duplicateSerialArchive, [packageId]),
    /duplicate PMNTN_SN/
  );

  const duplicateFidArchive = await outerArchive([
    {
      packageId,
      nested: await nestedGeojsonZip(
        packageId,
        lineDocument(packageId, { serials: [7, 8], fids: [0, 0] })
      ),
    },
  ]);
  await assert.rejects(
    () => parseFixture(duplicateFidArchive, [packageId]),
    /duplicate FID/
  );

  const badLineValue = lineDocument(packageId);
  (badLineValue.features[0].attributes as Record<string, unknown>).PMNTN_MAIN = 1;
  const badLineValueArchive = await outerArchive([
    {
      packageId,
      nested: await nestedGeojsonZip(packageId, badLineValue),
    },
  ]);
  await assert.rejects(
    () => parseFixture(badLineValueArchive, [packageId]),
    /PMNTN_MAIN.*string/
  );

  const badUnemittedPointValue = pointDocument(packageId);
  (
    badUnemittedPointValue.features[1].attributes as Record<string, unknown>
  ).ETC_MATTER = null;
  const badUnemittedPointValueArchive = await outerArchive([
    {
      packageId,
      nested: await nestedGeojsonZip(
        packageId,
        lineDocument(packageId),
        badUnemittedPointValue
      ),
    },
  ]);
  await assert.rejects(
    () => parseFixture(badUnemittedPointValueArchive, [packageId]),
    /ETC_MATTER.*string/
  );
});

test("reviewed integer and missing-MNTN_ID schema variants are package-bound", async () => {
  const integerPackage = "422303301";
  const acceptedInteger = await parseFixture(
    await outerArchive([
      {
        packageId: integerPackage,
        nested: await nestedGeojsonZip(
          integerPackage,
          lineDocument(integerPackage, { wkt: PROJECTED_WKT_NAME_VARIANT }),
          pointDocument(integerPackage, "esriFieldTypeInteger")
        ),
      },
    ]),
    [integerPackage]
  );
  assert.equal(acceptedInteger.packages[0].sourcePointCount, 2);

  const unreviewedCrs = PROJECTED_WKT.replace(
    'UNIT["Meter",1.0]]',
    'PARAMETER["Azimuth",0.0],UNIT["Meter",1.0]]'
  );
  const badCrsArchive = await outerArchive([
    {
      packageId: integerPackage,
      nested: await nestedGeojsonZip(
        integerPackage,
        lineDocument(integerPackage, { wkt: unreviewedCrs }),
        pointDocument(integerPackage, "esriFieldTypeInteger")
      ),
    },
  ]);
  await assert.rejects(
    () => parseFixture(badCrsArchive, [integerPackage]),
    /unreviewed EPSG:5186 parameters/
  );

  const ordinaryPackage = "111100101";
  const unreviewedInteger = await outerArchive([
    {
      packageId: ordinaryPackage,
      nested: await nestedGeojsonZip(
        ordinaryPackage,
        lineDocument(ordinaryPackage),
        pointDocument(ordinaryPackage, "esriFieldTypeInteger")
      ),
    },
  ]);
  await assert.rejects(
    () => parseFixture(unreviewedInteger, [ordinaryPackage]),
    /main-point field schema/
  );

  const missingIdPackage = "437501801";
  const fieldsWithoutMountainId = esriFields(LINE_FIELDS).filter(
    ({ name }) => name !== "MNTN_ID"
  );
  const acceptedMissingId = await parseFixture(
    await outerArchive([
      {
        packageId: missingIdPackage,
        nested: await nestedGeojsonZip(
          missingIdPackage,
          lineDocument(missingIdPackage, { fields: fieldsWithoutMountainId })
        ),
      },
    ]),
    [missingIdPackage]
  );
  assert.equal(acceptedMissingId.packages[0].lines[0].sourceMountainId, null);

  const unreviewedMissingId = await outerArchive([
    {
      packageId: ordinaryPackage,
      nested: await nestedGeojsonZip(
        ordinaryPackage,
        lineDocument(ordinaryPackage, { fields: fieldsWithoutMountainId })
      ),
    },
  ]);
  await assert.rejects(
    () => parseFixture(unreviewedMissingId, [ordinaryPackage]),
    /line field schema/
  );
});

test("safety-point documents are schema-checked but never emitted", async () => {
  const packageId = "448301101";
  const safetyEntries = await Promise.all(
    [1, 2, 3, 4].map(async (serial) => ({
      path: `PMNTN_SAFE_SPOT_${serial}_${packageId}.json`,
      body: Buffer.from(JSON.stringify(safetyPointDocument(packageId, serial))),
    }))
  );
  const accepted = await parseFixture(
    await outerArchive([
      {
        packageId,
        nested: await nestedGeojsonZip(
          packageId,
          lineDocument(packageId),
          pointDocument(packageId),
          safetyEntries
        ),
      },
    ]),
    [packageId]
  );
  assert.equal(accepted.packages[0].safetyPointCount, 4);
  assert.equal(accepted.packages[0].trailheadCandidates.length, 1);
  assert.equal("safetyPoints" in accepted.packages[0], false);

  const badSafety = safetyPointDocument(packageId, 1);
  badSafety.fields[1].type = "esriFieldTypeString";
  const rejected = await outerArchive([
    {
      packageId,
      nested: await nestedGeojsonZip(packageId, lineDocument(packageId), pointDocument(packageId), [
        {
          path: `PMNTN_SAFE_SPOT_1_${packageId}.json`,
          body: Buffer.from(JSON.stringify(badSafety)),
        },
      ]),
    },
  ]);
  await assert.rejects(
    () => parseFixture(rejected, [packageId]),
    /safety-point field schema/
  );

  let legacyEncodedNested = await nestedGeojsonZip(
    packageId,
    lineDocument(packageId),
    pointDocument(packageId),
    [
      {
        path: `PMNTN_SAFE_SPOT_AAAAAA_${packageId}.json`,
        body: Buffer.from(JSON.stringify(safetyPointDocument(packageId, 1))),
      },
      {
        path: `PMNTN_SAFE_SPOT_BBBBBB_${packageId}.json`,
        body: Buffer.from(JSON.stringify(safetyPointDocument(packageId, 2))),
      },
    ]
  );
  legacyEncodedNested = replaceAllBytes(
    legacyEncodedNested,
    Buffer.from("AAAAAA"),
    Buffer.from("b1b8b4f6bbea", "hex")
  );
  legacyEncodedNested = replaceAllBytes(
    legacyEncodedNested,
    Buffer.from("BBBBBB"),
    Buffer.from("b1b8bac0bbea", "hex")
  );
  const legacyEncoded = await parseFixture(
    await outerArchive([{ packageId, nested: legacyEncodedNested }]),
    [packageId]
  );
  assert.equal(legacyEncoded.packages[0].safetyPointCount, 2);
});

test("bindings require checked package IDs and have no name-match path", () => {
  const input = {
    schemaVersion: 1,
    sourceId: KFS_TRAIL_SOURCE_ID,
    archiveSha256: KFS_TRAIL_ARCHIVE_SHA256,
    bindings: [
      {
        destinationId: "ABCDEFGHIJKLMNOPQRST",
        packageId: "111100101",
      },
    ],
  };
  assert.deepEqual(parseKfsTrailBindings(input).bindings, input.bindings);
  const oneDestinationTwoPackages = {
    ...input,
    bindings: [
      input.bindings[0],
      { ...input.bindings[0], packageId: "111100102" },
    ],
  };
  assert.deepEqual(
    parseKfsTrailBindings(oneDestinationTwoPackages).bindings,
    oneDestinationTwoPackages.bindings
  );
  assert.throws(
    () =>
      parseKfsTrailBindings({
        ...input,
        bindings: [
          input.bindings[0],
          {
            destinationId: "12345678901234567890",
            packageId: input.bindings[0].packageId,
          },
        ],
      }),
    /package IDs must be unique/
  );

  assert.throws(
    () =>
      parseKfsTrailBindings({
        ...input,
        bindings: [
          {
            destinationId: "ABCDEFGHIJKLMNOPQRST",
            mountainName: "Test Peak",
          },
        ],
      }),
    /packageId|required|mountainName.*not allowed/
  );
  assert.throws(
    () =>
      parseKfsTrailBindings({
        ...input,
        bindings: [{ ...input.bindings[0], mountainName: "Test Peak" }],
      }),
    /mountainName.*not allowed/
  );
  assert.throws(
    () =>
      parseKfsTrailBindings({
        ...input,
        evidence: { reviewedBy: "human" },
      }),
    /evidence.*not allowed/
  );
  assert.throws(
    () =>
      parseKfsTrailBindings({
        ...input,
        bindings: [{ ...input.bindings[0], reviewStatus: "unresolved" }],
      }),
    /reviewStatus.*not allowed/
  );
  assert.throws(
    () => parseKfsTrailBindings({ ...input, archiveSha256: "0".repeat(64) }),
    /archiveSha256/
  );

  const checkedBytes = Buffer.from(JSON.stringify(input));
  const checkedHash = createHash("sha256").update(checkedBytes).digest("hex");
  assert.doesNotThrow(() => assertCheckedBindingsSha256(checkedBytes, checkedHash));
  assert.throws(
    () => assertCheckedBindingsSha256(checkedBytes, "0".repeat(64)),
    /bindings SHA-256/
  );
});

test("finder accepts only offline checked bindings or explicit packages", () => {
  assert.deepEqual(
    parseKfsTrailFinderArgs([
      "--archive=/tmp/kfs.zip",
      "--package-id=111100101",
    ]),
    {
      archivePath: "/tmp/kfs.zip",
      packageIds: ["111100101"],
      bindingsPath: null,
      expectedBindingsSha256: null,
    }
  );
  assert.throws(
    () =>
      parseKfsTrailFinderArgs([
        "--archive=/tmp/kfs.zip",
        "--package-id=111100101",
        "--apply",
      ]),
    /read-only.*--apply/i
  );
  assert.throws(
    () =>
      parseKfsTrailFinderArgs([
        "--archive=/tmp/kfs.zip",
        "--bindings=/tmp/bindings.json",
      ]),
    /expected-bindings-sha256/
  );
  assert.throws(
    () =>
      parseKfsTrailFinderArgs([
        "--archive=/tmp/kfs.zip",
        "--package-id=111100101",
        `--current-access-url=${KFS_TRAIL_ARCHIVE_CATALOG_URL}`,
      ]),
    /unknown option/
  );
});
