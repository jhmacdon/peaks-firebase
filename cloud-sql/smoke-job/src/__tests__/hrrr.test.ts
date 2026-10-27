// Pure HRRR helpers: cycle discovery, S3 URLs, .idx byte ranges, grid
// indexing, IEEE GRIB2 reads, and cell snapping (golden vectors shared with
// cloud-sql/api/src/__tests__/air-quality-logic.test.ts).

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  snapToCell,
  candidateCycles,
  cycleTimeSec,
  gribUrl,
  idxUrl,
  findMassdenRange,
  rangeHeader,
  gridIndex,
  gridMatchesHrrr,
  readIeeeGrib2Values,
} from "../hrrr";

// GOLDEN VECTORS — identical assertions exist in
// cloud-sql/api/src/__tests__/air-quality-logic.test.ts. Change both or neither.
test("snapToCell golden vectors", () => {
  const a = snapToCell(44.2701, -71.3033);
  assert.equal(a.cellKey, "1476:-2377");
  assert.ok(Math.abs(a.lat - 44.28) < 1e-9);
  assert.ok(Math.abs(a.lng - -71.31) < 1e-9);

  const b = snapToCell(39.0, -120.0);
  assert.equal(b.cellKey, "1300:-4000");
  assert.ok(Math.abs(b.lat - 39.0) < 1e-9);
  assert.ok(Math.abs(b.lng - -120.0) < 1e-9);
});

// Indexes from ecCodes codes_grib_find_nearest on a real HRRR MASSDEN record.
test("gridIndex matches ecCodes nearest grid points", () => {
  assert.equal(gridIndex(32.43, -116.25), 655149);
  assert.equal(gridIndex(40.92, -120.81), 1261352);
  assert.equal(gridIndex(37.92, -103.8), 925401);
  assert.equal(gridIndex(25.5, -95.58), 80121);
});

test("gridIndex is null off the HRRR grid", () => {
  assert.equal(gridIndex(24.6, -69.84), null);
  assert.equal(gridIndex(60.0, -150.0), null);
  assert.equal(gridIndex(46.0, 7.0), null);
});

test("gridMatchesHrrr accepts grib_get's rounded metadata and rejects a changed grid", () => {
  assert.equal(gridMatchesHrrr("1799 1059 21.1381 237.28 262.5 38.5 38.5 3000 3000 64\n"), true);
  assert.equal(gridMatchesHrrr("1799 1059 21.1381 237.28 262.5 38.5 38.5 2500 2500 64"), false);
  assert.equal(gridMatchesHrrr("1799 1059"), false);
});

function ieeeMessage(values: number[], opts: { template?: number; bitmap?: number } = {}): Buffer {
  const section = (num: number, body: Buffer) => {
    const head = Buffer.alloc(5);
    head.writeUInt32BE(body.length + 5, 0);
    head[4] = num;
    return Buffer.concat([head, body]);
  };
  const s5 = Buffer.alloc(7);
  s5.writeUInt32BE(values.length, 0);
  s5.writeUInt16BE(opts.template ?? 4, 4);
  s5[6] = 1;
  const data = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => data.writeFloatBE(v, i * 4));
  const body = Buffer.concat([
    section(3, Buffer.alloc(9)),
    section(5, s5),
    section(6, Buffer.from([opts.bitmap ?? 255])),
    section(7, data),
    Buffer.from("7777"),
  ]);
  const s0 = Buffer.alloc(16);
  s0.write("GRIB", 0, "ascii");
  s0[7] = 2;
  s0.writeBigUInt64BE(BigInt(body.length + 16), 8);
  return Buffer.concat([s0, body]);
}

test("readIeeeGrib2Values reads float32 values by grid index", () => {
  const valueAt = readIeeeGrib2Values(ieeeMessage([0, 2.5e-9, 9999]));
  assert.ok(Math.abs(valueAt(1) - 2.5e-9) < 1e-15);
  assert.equal(valueAt(2), 9999);
  assert.throws(() => valueAt(3));
});

test("readIeeeGrib2Values rejects other packings and bitmaps", () => {
  assert.throws(() => readIeeeGrib2Values(ieeeMessage([1], { template: 3 })), /IEEE/);
  assert.throws(() => readIeeeGrib2Values(ieeeMessage([1], { bitmap: 0 })), /bitmap/);
  assert.throws(() => readIeeeGrib2Values(Buffer.from("not grib")), /GRIB2/);
});

test("candidateCycles returns newest-first synoptic cycles within 30 h", () => {
  // 2026-08-06T14:30Z → expect 12Z, 06Z, 00Z today, 18Z + 12Z yesterday
  const nowSec = Date.UTC(2026, 7, 6, 14, 30) / 1000;
  const cycles = candidateCycles(nowSec);
  assert.deepEqual(cycles.slice(0, 5), [
    { ymd: "20260806", hour: 12 },
    { ymd: "20260806", hour: 6 },
    { ymd: "20260806", hour: 0 },
    { ymd: "20260805", hour: 18 },
    { ymd: "20260805", hour: 12 },
  ]);
});

test("cycleTimeSec converts a cycle to unix seconds", () => {
  assert.equal(
    cycleTimeSec({ ymd: "20260806", hour: 12 }),
    Date.UTC(2026, 7, 6, 12) / 1000
  );
});

test("URLs point at the AWS Open Data bucket with zero-padded hours", () => {
  const c = { ymd: "20260806", hour: 6 };
  assert.equal(
    gribUrl(c, 3),
    "https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.20260806/conus/hrrr.t06z.wrfsfcf03.grib2"
  );
  assert.equal(idxUrl(c, 3), gribUrl(c, 3) + ".idx");
});

const IDX_FIXTURE = [
  "36:4552676:d=2026080612:CIMIXR:1 hybrid level:12 hour fcst:",
  "37:4964529:d=2026080612:MASSDEN:8 m above ground:12 hour fcst:",
  "38:5537841:d=2026080612:TMP:2 m above ground:12 hour fcst:",
].join("\n");

test("findMassdenRange finds the MASSDEN 8 m record byte range", () => {
  const r = findMassdenRange(IDX_FIXTURE)!;
  assert.equal(r.start, 4964529);
  assert.equal(r.end, 5537840);
  assert.equal(rangeHeader(r), "bytes=4964529-5537840");
});

test("findMassdenRange open-ended when MASSDEN is the last record", () => {
  const lastLine = "37:4964529:d=2026080612:MASSDEN:8 m above ground:12 hour fcst:";
  const r = findMassdenRange(lastLine)!;
  assert.equal(r.start, 4964529);
  assert.equal(r.end, null);
  assert.equal(rangeHeader(r), "bytes=4964529-");
});

test("findMassdenRange returns null when absent", () => {
  assert.equal(findMassdenRange("1:0:d=2026080612:TMP:2 m above ground:anl:"), null);
});