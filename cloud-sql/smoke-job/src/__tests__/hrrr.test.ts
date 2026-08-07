// Pure HRRR helpers: cycle discovery, S3 URLs, .idx byte ranges, grib_get
// stdout parsing, and cell snapping (golden vectors shared with
// cloud-sql/api/src/__tests__/air-quality-logic.test.ts).

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  snapToCell,
  isInHrrrConus,
  candidateCycles,
  cycleTimeSec,
  gribUrl,
  idxUrl,
  findMassdenRange,
  rangeHeader,
  parseGribGetValue,
  KG_M3_TO_UG_M3,
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

test("isInHrrrConus golden vectors", () => {
  assert.equal(isInHrrrConus(44.27, -71.3), true);
  assert.equal(isInHrrrConus(39.0, -120.0), true);
  assert.equal(isInHrrrConus(60.0, -150.0), false);
  assert.equal(isInHrrrConus(46.0, 7.0), false);
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

test("parseGribGetValue parses grib_get stdout and rejects garbage", () => {
  assert.equal(parseGribGetValue("1.234e-08\n"), 1.234e-8);
  assert.equal(parseGribGetValue("  0  "), 0);
  assert.ok(Math.abs(parseGribGetValue("2.5e-09") * KG_M3_TO_UG_M3 - 2.5) < 1e-9);
  assert.throws(() => parseGribGetValue("ECCODES ERROR: unreadable"));
});
