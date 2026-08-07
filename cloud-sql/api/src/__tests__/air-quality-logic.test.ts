// Pure logic for the plan air-quality endpoint: EPA categories, cell
// snapping (golden vectors shared with cloud-sql/smoke-job), and the
// HRRR/CAMS merge. No I/O.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  pm25Category,
  snapToCell,
  isInHrrrConus,
  buildAirQualityResponse,
  CamsData,
  HrrrRow,
} from "../air-quality";

test("pm25Category matches EPA 2024 breakpoints at every edge", () => {
  assert.equal(pm25Category(0), "good");
  assert.equal(pm25Category(9.0), "good");
  assert.equal(pm25Category(9.1), "moderate");
  assert.equal(pm25Category(35.4), "moderate");
  assert.equal(pm25Category(35.5), "unhealthy_sensitive");
  assert.equal(pm25Category(55.4), "unhealthy_sensitive");
  assert.equal(pm25Category(55.5), "unhealthy");
  assert.equal(pm25Category(125.4), "unhealthy");
  assert.equal(pm25Category(125.5), "very_unhealthy");
  assert.equal(pm25Category(225.4), "very_unhealthy");
  assert.equal(pm25Category(225.5), "hazardous");
});

// GOLDEN VECTORS — identical assertions exist in
// cloud-sql/smoke-job/src/__tests__/hrrr.test.ts. If you change one, change both.
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
  assert.equal(isInHrrrConus(44.27, -71.3), true);   // White Mountains
  assert.equal(isInHrrrConus(39.0, -120.0), true);   // Sierra
  assert.equal(isInHrrrConus(60.0, -150.0), false);  // Alaska
  assert.equal(isInHrrrConus(46.0, 7.0), false);     // Alps
});

// ---- merge fixtures ------------------------------------------------------

const OFFSET = -4 * 3600; // EDT
const sec = (y: number, mo: number, d: number, h: number) =>
  Date.UTC(y, mo - 1, d, h) / 1000;

// 7 local days of CAMS hours starting local midnight 2026-08-06 EDT
// (04:00 UTC), pm2_5 = 5 everywhere, us_aqi = 40 everywhere.
function makeCams(): CamsData {
  const start = sec(2026, 8, 6, 4);
  const timesSec: number[] = [];
  const pm25: (number | null)[] = [];
  const usAqi: (number | null)[] = [];
  for (let i = 0; i < 7 * 24; i++) {
    timesSec.push(start + i * 3600);
    pm25.push(5);
    usAqi.push(40);
  }
  return { timezone: "America/New_York", utcOffsetSeconds: OFFSET, timesSec, pm25, usAqi };
}

// HRRR rows 2026-08-06T12Z .. 2026-08-08T12Z at 20 µg/m³, with a 60 µg/m³
// spike at 2026-08-07T20:00Z (16:00 EDT on local day 1).
function makeHrrr(): HrrrRow[] {
  const rows: HrrrRow[] = [];
  const start = sec(2026, 8, 6, 12);
  for (let i = 0; i <= 48; i++) {
    const t = start + i * 3600;
    rows.push({
      validAtSec: t,
      smokeUgM3: t === sec(2026, 8, 7, 20) ? 60 : 20,
      runAtIso: "2026-08-06T12:00:00.000Z",
    });
  }
  return rows;
}

const NOW = sec(2026, 8, 6, 12); // 2026-08-06T12:00Z = 08:00 EDT
const POINT = { lat: 44.28, lng: -71.31 };

test("merge: HRRR overlays CAMS inside 48 h; CAMS fills beyond", () => {
  const resp = buildAirQualityResponse({
    point: POINT,
    hrrrRows: makeHrrr(),
    cams: makeCams(),
    planDateSec: sec(2026, 8, 8, 16), // plan on 2026-08-08 local
    nowSec: NOW,
  });
  assert.equal(resp.available, true);
  assert.equal(resp.timezone, "America/New_York");
  assert.equal(resp.planDate, "2026-08-08");
  assert.equal(resp.planDayBeyondHorizon, false);
  const days = resp.days!;
  assert.equal(days.length, 7);

  // Day 0: local hours 00:00–07:00 are CAMS (before first HRRR row at
  // 08:00 EDT), rest HRRR → mixed.
  assert.equal(days[0].date, "2026-08-06");
  assert.equal(days[0].source, "mixed");
  assert.ok(Math.abs(days[0].pm25Max - 20) < 1e-9);

  // Day 1 (2026-08-07): fully inside HRRR window → hrrr_smoke, spike wins.
  assert.equal(days[1].date, "2026-08-07");
  assert.equal(days[1].source, "hrrr_smoke");
  assert.ok(Math.abs(days[1].pm25Max - 60) < 1e-9);
  assert.equal(days[1].category, "unhealthy");
  assert.equal(days[1].usAqiMax, null);

  // Plan day (2026-08-08): HRRR through 08:00 EDT then CAMS → mixed.
  assert.equal(days[2].isPlanDay, true);
  assert.equal(days[2].source, "mixed");

  // Day 4: pure CAMS.
  assert.equal(days[4].source, "cams");
  assert.equal(days[4].usAqiMax, 40);
  assert.equal(days[4].category, "good");

  // Hour ISO strings carry the local offset.
  assert.match(days[0].hours[0].time, /-04:00$/);
  assert.equal(resp.sources!.hrrrRun, "2026-08-06T12:00:00.000Z");
  assert.equal(resp.sources!.cams, true);
});

test("merge: plan beyond horizon flags planDayBeyondHorizon", () => {
  const resp = buildAirQualityResponse({
    point: POINT,
    hrrrRows: makeHrrr(),
    cams: makeCams(),
    planDateSec: sec(2026, 8, 20, 16),
    nowSec: NOW,
  });
  assert.equal(resp.planDate, "2026-08-20");
  assert.equal(resp.planDayBeyondHorizon, true);
  assert.equal(resp.days!.some((d) => d.isPlanDay), false);
});

// The web stores plan dates as bare YYYY-MM-DD, which Postgres casts to
// midnight UTC. Shifting that by a negative US offset would land on the
// previous day, so exactly-midnight-UTC timestamps count as calendar dates.
test("merge: midnight-UTC plan date is a calendar date, not an instant", () => {
  const resp = buildAirQualityResponse({
    point: POINT,
    hrrrRows: makeHrrr(),
    cams: makeCams(),
    planDateSec: sec(2026, 8, 8, 0), // web: bare date → 2026-08-08T00:00Z
    nowSec: NOW,
  });
  assert.equal(resp.planDate, "2026-08-08");
  const planDay = resp.days!.find((d) => d.date === "2026-08-08");
  assert.equal(planDay!.isPlanDay, true);
});

test("merge: non-midnight plan instant still localizes to the plan timezone", () => {
  const resp = buildAirQualityResponse({
    point: POINT,
    hrrrRows: makeHrrr(),
    cams: makeCams(),
    planDateSec: sec(2026, 8, 9, 1), // iOS: 01:00 UTC = 21:00 EDT on Aug 8
    nowSec: NOW,
  });
  assert.equal(resp.planDate, "2026-08-08");
});

test("merge: undated plan → planDate null, no plan day", () => {
  const resp = buildAirQualityResponse({
    point: POINT,
    hrrrRows: [],
    cams: makeCams(),
    planDateSec: null,
    nowSec: NOW,
  });
  assert.equal(resp.planDate, null);
  assert.equal(resp.planDayBeyondHorizon, false);
  assert.equal(resp.days!.every((d) => !d.isPlanDay), true);
  assert.equal(resp.sources!.hrrrRun, null);
});

test("merge: HRRR only (CAMS down) still serves with crude offset", () => {
  const resp = buildAirQualityResponse({
    point: POINT,
    hrrrRows: makeHrrr(),
    cams: null,
    planDateSec: null,
    nowSec: NOW,
  });
  assert.equal(resp.available, true);
  // lng -71.31 → round(-71.31/15) = -5 → UTC-5
  assert.equal(resp.timezone, "UTC-5");
  assert.equal(resp.days!.every((d) => d.source === "hrrr_smoke"), true);
});

test("merge: nothing at all → available:false", () => {
  const resp = buildAirQualityResponse({
    point: POINT,
    hrrrRows: [],
    cams: null,
    planDateSec: null,
    nowSec: NOW,
  });
  assert.equal(resp.available, false);
  assert.equal(resp.reason, "upstream_unavailable");
});

test("merge: null CAMS pm2_5 hours are skipped, not zeroed", () => {
  const cams = makeCams();
  cams.pm25[30] = null; // one missing hour
  const resp = buildAirQualityResponse({
    point: POINT, hrrrRows: [], cams, planDateSec: null, nowSec: NOW,
  });
  const allHours = resp.days!.flatMap((d) => d.hours);
  assert.equal(allHours.length, 7 * 24 - 1);
});
