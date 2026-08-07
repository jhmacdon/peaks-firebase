# Plan Air Quality & Wildfire Smoke Forecast — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a merged HRRR-Smoke + Open-Meteo/CAMS air-quality forecast on plans via `GET /api/plans/:id/air-quality`, with a web plan-detail card; a scheduled Cloud Run Job samples HRRR smoke at upcoming plan locations into Postgres.

**Architecture:** A new `smoke_forecasts` table holds HRRR near-surface smoke sampled 4×/day by a new Cloud Run Job (`cloud-sql/smoke-job/`, Node 20 + ecCodes). The API endpoint merges those rows (0–48 h) with an on-demand, cached Open-Meteo CAMS forecast (out to 7 days, global) into one per-hour/per-day series. The web card consumes the endpoint through a Next server action.

**Tech Stack:** TypeScript, Express, node:test (`node --test --import tsx`), pg, ecCodes (`grib_get` from Debian `libeccodes-tools`), Next.js 15 + Tailwind 4, GitHub Actions + `gcloud run jobs deploy`.

**Spec:** `docs/superpowers/specs/2026-08-06-plan-air-quality-design.md` (and the iOS handoff doc beside it).

## Global Constraints

- Node 20 everywhere (`engines.node: "20"`); Express 4; `firebase-functions` untouched.
- API tests run with `NODE_ENV=test node --test --import tsx src/__tests__/*.test.ts`; the smoke-job package mirrors this.
- Lint must pass with zero errors: `npm run lint` in each touched package; web needs `npm run build && npm run lint` clean.
- **Wire-type policy:** never `SELECT EXTRACT(EPOCH FROM …)` (returns NUMERIC → string on the wire). Select `TIMESTAMPTZ` columns raw (arrive as JS `Date`) and convert in JS. New table uses only TEXT / TIMESTAMPTZ / DOUBLE PRECISION — no BIGINT/NUMERIC.
- Migrations are applied manually as `postgres` (CI does not apply them); all schema objects owned by `postgres`; `peaks-api` gets DML grants only.
- Cloud Run env/secrets are pinned in full in `deploy.yml` commands; never `gcloud run services update --set-*` out-of-band.
- Web `useEffect` rules: no object/array deps, no self-retriggering state writes. This plan adds **no new effect** — the air-quality fetch rides the existing `loadPlan` callback.
- The constants `CELL_SIZE_DEG = 0.03`, CONUS bounds (lat 21–53, lng −134…−60), and the EPA 2024 PM2.5 breakpoints are duplicated between `cloud-sql/api/src/air-quality.ts` and `cloud-sql/smoke-job/src/hrrr.ts` (separate npm packages, no workspace). Both packages pin identical golden test vectors so drift fails tests.
- GCP: project `donner-a8608`, region `us-central1`, Cloud SQL `donner-a8608:us-central1:peaks-db`, API URL `https://peaks-api-qownl77soa-uc.a.run.app`.

---

### Task 1: `smoke_forecasts` migration

**Files:**
- Create: `cloud-sql/migrations/20260806_smoke_forecasts.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `smoke_forecasts(cell_key TEXT, valid_at TIMESTAMPTZ, run_at TIMESTAMPTZ, smoke_ug_m3 DOUBLE PRECISION, fetched_at TIMESTAMPTZ)` with PK `(cell_key, valid_at)` — Tasks 4 and 6 read/write it.

- [ ] **Step 1: Write the migration**

```sql
-- HRRR-Smoke point samples at upcoming plan locations.
-- Written by the peaks-smoke-job Cloud Run Job 4x/day; read by
-- GET /api/plans/:id/air-quality. Rows are keyed by ~3 km grid cell
-- (cell_key = "{round(lat/0.03)}:{round(lng/0.03)}") and forecast valid hour.
-- Design: docs/superpowers/specs/2026-08-06-plan-air-quality-design.md
--
-- Apply manually as postgres (CI does not run migrations):
--   psql -h 127.0.0.1 -U postgres -d peaks -f cloud-sql/migrations/20260806_smoke_forecasts.sql

BEGIN;

CREATE TABLE IF NOT EXISTS smoke_forecasts (
    cell_key     TEXT NOT NULL,
    valid_at     TIMESTAMPTZ NOT NULL,
    run_at       TIMESTAMPTZ NOT NULL,
    smoke_ug_m3  DOUBLE PRECISION NOT NULL,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (cell_key, valid_at)
);

CREATE INDEX IF NOT EXISTS idx_smoke_forecasts_valid_at
    ON smoke_forecasts (valid_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON smoke_forecasts TO "peaks-api";

COMMIT;
```

- [ ] **Step 2: Sanity-check the SQL locally (parse only)**

Run: `psql --version` — if a local psql exists, `psql -f cloud-sql/migrations/20260806_smoke_forecasts.sql --echo-all -d postgres -h 127.0.0.1 2>&1 | head -5` is NOT required (no local DB assumed). Instead verify by eye against `cloud-sql/migrations/20260611_protected_areas.sql` conventions: BEGIN/COMMIT wrapper, IF NOT EXISTS, no enum needed.
Expected: file matches the block above exactly.

- [ ] **Step 3: Commit**

```bash
git add cloud-sql/migrations/20260806_smoke_forecasts.sql
git commit -m "feat(db): smoke_forecasts table for HRRR-Smoke point samples"
```

---

### Task 2: API pure logic module `air-quality.ts`

**Files:**
- Create: `cloud-sql/api/src/air-quality.ts`
- Test: `cloud-sql/api/src/__tests__/air-quality-logic.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (Task 3 and 4 import these exactly):
  - `type AqCategory = "good" | "moderate" | "unhealthy_sensitive" | "unhealthy" | "very_unhealthy" | "hazardous"`
  - `pm25Category(pm25: number): AqCategory`
  - `CELL_SIZE_DEG: number` (0.03)
  - `interface Cell { cellKey: string; lat: number; lng: number }`
  - `snapToCell(lat: number, lng: number): Cell`
  - `isInHrrrConus(lat: number, lng: number): boolean`
  - `interface HrrrRow { validAtSec: number; smokeUgM3: number; runAtIso: string }`
  - `interface CamsData { timezone: string; utcOffsetSeconds: number; timesSec: number[]; pm25: (number | null)[]; usAqi: (number | null)[] }`
  - `buildAirQualityResponse(opts: { point: {lat: number; lng: number}; hrrrRows: HrrrRow[]; cams: CamsData | null; planDateSec: number | null; nowSec: number }): AirQualityResponse`

- [ ] **Step 1: Write the failing tests**

Create `cloud-sql/api/src/__tests__/air-quality-logic.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud-sql/api && NODE_ENV=test node --test --import tsx src/__tests__/air-quality-logic.test.ts`
Expected: FAIL — cannot find module `../air-quality`.

- [ ] **Step 3: Implement `cloud-sql/api/src/air-quality.ts`**

```ts
// Pure air-quality logic for GET /api/plans/:id/air-quality: EPA PM2.5
// categories, HRRR grid-cell snapping, and the HRRR-Smoke/CAMS hourly merge.
// No I/O — everything here is deterministic and unit-tested.
// Design: docs/superpowers/specs/2026-08-06-plan-air-quality-design.md

export type AqCategory =
  | "good"
  | "moderate"
  | "unhealthy_sensitive"
  | "unhealthy"
  | "very_unhealthy"
  | "hazardous";

// EPA 2024 PM2.5 breakpoints (µg/m³), applied per hour. The official index
// averages over 24 h (NowCast); per-hour application is the standard display
// simplification and slightly conservative during sharp smoke peaks.
export function pm25Category(pm25: number): AqCategory {
  if (pm25 <= 9.0) return "good";
  if (pm25 <= 35.4) return "moderate";
  if (pm25 <= 55.4) return "unhealthy_sensitive";
  if (pm25 <= 125.4) return "unhealthy";
  if (pm25 <= 225.4) return "very_unhealthy";
  return "hazardous";
}

// ~3 km grid cells so nearby plans share one HRRR sample. Keep in sync with
// cloud-sql/smoke-job/src/hrrr.ts (duplicated: separate npm packages; both
// sides pin identical golden test vectors).
export const CELL_SIZE_DEG = 0.03;

export interface Cell {
  cellKey: string;
  lat: number;
  lng: number;
}

export function snapToCell(lat: number, lng: number): Cell {
  const latIdx = Math.round(lat / CELL_SIZE_DEG);
  const lngIdx = Math.round(lng / CELL_SIZE_DEG);
  return {
    cellKey: `${latIdx}:${lngIdx}`,
    lat: latIdx * CELL_SIZE_DEG,
    lng: lngIdx * CELL_SIZE_DEG,
  };
}

// Approximate HRRR CONUS domain. Outside it the smoke job never samples, so
// the endpoint serves CAMS only.
export function isInHrrrConus(lat: number, lng: number): boolean {
  return lat >= 21 && lat <= 53 && lng >= -134 && lng <= -60;
}

export interface HrrrRow {
  validAtSec: number; // unix seconds, top of hour (UTC instant)
  smokeUgM3: number;
  runAtIso: string; // HRRR cycle time as ISO UTC
}

export interface CamsData {
  timezone: string;
  utcOffsetSeconds: number;
  timesSec: number[]; // unix seconds, top of hour
  pm25: (number | null)[];
  usAqi: (number | null)[];
}

export interface AqHour {
  time: string; // local ISO8601 with offset
  source: "hrrr_smoke" | "cams";
  pm25: number;
  category: AqCategory;
}

export interface AqDay {
  date: string; // local YYYY-MM-DD
  source: "hrrr_smoke" | "cams" | "mixed";
  pm25Max: number;
  usAqiMax: number | null;
  category: AqCategory;
  isPlanDay: boolean;
  hours: AqHour[];
}

export interface AirQualityResponse {
  available: boolean;
  reason?: string;
  point?: { lat: number; lng: number };
  timezone?: string;
  planDate?: string | null;
  planDayBeyondHorizon?: boolean;
  days?: AqDay[];
  sources?: { hrrrRun: string | null; cams: boolean };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function offsetSuffix(offsetSeconds: number): string {
  const sign = offsetSeconds < 0 ? "-" : "+";
  const abs = Math.abs(offsetSeconds);
  return `${sign}${pad2(Math.floor(abs / 3600))}:${pad2(Math.floor((abs % 3600) / 60))}`;
}

function localDate(sec: number, offsetSeconds: number): string {
  return new Date((sec + offsetSeconds) * 1000).toISOString().slice(0, 10);
}

function localIso(sec: number, offsetSeconds: number): string {
  return (
    new Date((sec + offsetSeconds) * 1000).toISOString().slice(0, 19) +
    offsetSuffix(offsetSeconds)
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function buildAirQualityResponse(opts: {
  point: { lat: number; lng: number };
  hrrrRows: HrrrRow[];
  cams: CamsData | null;
  planDateSec: number | null;
  nowSec: number;
}): AirQualityResponse {
  const { point, hrrrRows, cams, planDateSec, nowSec } = opts;

  // CAMS supplies the timezone; without it fall back to a crude
  // longitude-derived offset (degraded path, only when Open-Meteo is down).
  const offset = cams
    ? cams.utcOffsetSeconds
    : Math.round(point.lng / 15) * 3600;
  const timezone = cams
    ? cams.timezone
    : `UTC${offset >= 0 ? "+" : "-"}${Math.abs(offset / 3600)}`;

  // Hours from local midnight today onward. CAMS first, HRRR overwrites
  // (higher fidelity inside its 48 h window).
  const startOfToday = Math.floor((nowSec + offset) / 86400) * 86400 - offset;
  const hours = new Map<
    number,
    { source: "hrrr_smoke" | "cams"; pm25: number; usAqi: number | null }
  >();
  if (cams) {
    for (let i = 0; i < cams.timesSec.length; i++) {
      const t = cams.timesSec[i];
      const pm = cams.pm25[i];
      if (t < startOfToday || pm === null || pm === undefined) continue;
      hours.set(t, { source: "cams", pm25: pm, usAqi: cams.usAqi[i] ?? null });
    }
  }
  let hrrrRun: string | null = null;
  for (const row of hrrrRows) {
    if (row.validAtSec < startOfToday) continue;
    hours.set(row.validAtSec, {
      source: "hrrr_smoke",
      pm25: row.smokeUgM3,
      usAqi: null,
    });
    if (!hrrrRun || row.runAtIso > hrrrRun) hrrrRun = row.runAtIso;
  }

  if (hours.size === 0) {
    return { available: false, reason: "upstream_unavailable" };
  }

  const planDate = planDateSec === null ? null : localDate(planDateSec, offset);

  const dayMap = new Map<
    string,
    {
      hours: AqHour[];
      pm25Max: number;
      usAqiMax: number | null;
      sources: Set<"hrrr_smoke" | "cams">;
    }
  >();
  const sorted = [...hours.entries()].sort((a, b) => a[0] - b[0]);
  for (const [t, h] of sorted) {
    const date = localDate(t, offset);
    let day = dayMap.get(date);
    if (!day) {
      day = { hours: [], pm25Max: 0, usAqiMax: null, sources: new Set() };
      dayMap.set(date, day);
    }
    day.hours.push({
      time: localIso(t, offset),
      source: h.source,
      pm25: round1(h.pm25),
      category: pm25Category(h.pm25),
    });
    day.pm25Max = Math.max(day.pm25Max, h.pm25);
    if (h.usAqi !== null) {
      day.usAqiMax = day.usAqiMax === null ? h.usAqi : Math.max(day.usAqiMax, h.usAqi);
    }
    day.sources.add(h.source);
  }

  const days: AqDay[] = [...dayMap.entries()].map(([date, d]) => ({
    date,
    source:
      d.sources.size > 1
        ? "mixed"
        : d.sources.has("hrrr_smoke")
          ? "hrrr_smoke"
          : "cams",
    pm25Max: round1(d.pm25Max),
    usAqiMax: d.usAqiMax,
    category: pm25Category(d.pm25Max),
    isPlanDay: planDate !== null && date === planDate,
    hours: d.hours,
  }));

  const lastDate = days[days.length - 1].date;
  return {
    available: true,
    point,
    timezone,
    planDate,
    planDayBeyondHorizon: planDate !== null && planDate > lastDate,
    days,
    sources: { hrrrRun, cams: cams !== null },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud-sql/api && NODE_ENV=test node --test --import tsx src/__tests__/air-quality-logic.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Build + lint + full test suite**

Run: `cd cloud-sql/api && npm run build && npm run lint && npm test`
Expected: zero errors, all suites pass.

- [ ] **Step 6: Commit**

```bash
git add cloud-sql/api/src/air-quality.ts cloud-sql/api/src/__tests__/air-quality-logic.test.ts
git commit -m "feat(api): air-quality merge logic — EPA categories, cell snap, HRRR/CAMS merge"
```

---

### Task 3: API Open-Meteo client `open-meteo.ts`

**Files:**
- Create: `cloud-sql/api/src/open-meteo.ts`
- Test: `cloud-sql/api/src/__tests__/open-meteo.test.ts`

**Interfaces:**
- Consumes: `CamsData` from `./air-quality` (Task 2).
- Produces (Task 4 imports these):
  - `type CamsFetcher = (lat: number, lng: number) => Promise<CamsData | null>`
  - `fetchCams(lat, lng, fetchImpl?: typeof fetch, nowMs?: () => number): Promise<CamsData | null>`
  - `clearCamsCache(): void` (tests only)

- [ ] **Step 1: Write the failing tests**

Create `cloud-sql/api/src/__tests__/open-meteo.test.ts`:

```ts
// Open-Meteo CAMS client: URL shape, response mapping, TTL cache, and
// failure → null (the endpoint degrades, never throws upstream errors).

import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";
import { fetchCams, clearCamsCache } from "../open-meteo";

const BODY = {
  timezone: "America/New_York",
  utc_offset_seconds: -14400,
  hourly: { time: [1754452800], pm2_5: [5.2], us_aqi: [40] },
};

function fakeFetch(status = 200, body: unknown = BODY) {
  const calls: string[] = [];
  const fn = (async (url: any) => {
    calls.push(String(url));
    return {
      ok: status === 200,
      status,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return { fn, calls };
}

beforeEach(() => clearCamsCache());

test("fetchCams requests pm2_5+us_aqi unixtime for 7 days and maps the body", async () => {
  const { fn, calls } = fakeFetch();
  const data = await fetchCams(44.28, -71.31, fn);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /air-quality-api\.open-meteo\.com/);
  assert.match(calls[0], /hourly=pm2_5,us_aqi/);
  assert.match(calls[0], /forecast_days=7/);
  assert.match(calls[0], /timeformat=unixtime/);
  assert.match(calls[0], /timezone=auto/);
  assert.equal(data!.timezone, "America/New_York");
  assert.equal(data!.utcOffsetSeconds, -14400);
  assert.deepEqual(data!.timesSec, [1754452800]);
  assert.deepEqual(data!.pm25, [5.2]);
  assert.deepEqual(data!.usAqi, [40]);
});

test("fetchCams caches by location within the TTL", async () => {
  const { fn, calls } = fakeFetch();
  let now = 1_000_000;
  const clock = () => now;
  await fetchCams(44.28, -71.31, fn, clock);
  await fetchCams(44.28, -71.31, fn, clock);
  assert.equal(calls.length, 1, "second call must hit the cache");
  now += 61 * 60 * 1000; // past the 60 min TTL
  await fetchCams(44.28, -71.31, fn, clock);
  assert.equal(calls.length, 2, "expired entry must refetch");
});

test("fetchCams returns null on non-200 and does not cache failures", async () => {
  const { fn, calls } = fakeFetch(500);
  assert.equal(await fetchCams(44.28, -71.31, fn), null);
  assert.equal(await fetchCams(44.28, -71.31, fn), null);
  assert.equal(calls.length, 2, "failures are not cached");
});

test("fetchCams returns null on malformed body", async () => {
  const { fn } = fakeFetch(200, { nope: true });
  assert.equal(await fetchCams(44.28, -71.31, fn), null);
});

test("fetchCams returns null when fetch throws", async () => {
  const fn = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  assert.equal(await fetchCams(44.28, -71.31, fn), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud-sql/api && NODE_ENV=test node --test --import tsx src/__tests__/open-meteo.test.ts`
Expected: FAIL — cannot find module `../open-meteo`.

- [ ] **Step 3: Implement `cloud-sql/api/src/open-meteo.ts`**

```ts
// Open-Meteo air-quality client (CAMS model) with a small in-process TTL
// cache. Free and keyless; the CC BY 4.0 attribution requirement is met by
// the web/iOS card credit lines. Failures always resolve to null — the
// endpoint degrades to whatever HRRR rows exist rather than erroring.

import { CamsData } from "./air-quality";

const BASE_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const FETCH_TIMEOUT_MS = 5000;

export type CamsFetcher = (lat: number, lng: number) => Promise<CamsData | null>;

const cache = new Map<string, { at: number; data: CamsData }>();

export function clearCamsCache(): void {
  cache.clear();
}

export async function fetchCams(
  lat: number,
  lng: number,
  fetchImpl: typeof fetch = fetch,
  nowMs: () => number = Date.now
): Promise<CamsData | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && nowMs() - hit.at < TTL_MS) return hit.data;

  const url =
    `${BASE_URL}?latitude=${lat}&longitude=${lng}` +
    `&hourly=pm2_5,us_aqi&forecast_days=7&timezone=auto&timeformat=unixtime`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      timezone?: string;
      utc_offset_seconds?: number;
      hourly?: { time?: number[]; pm2_5?: (number | null)[]; us_aqi?: (number | null)[] };
    };
    if (!Array.isArray(body?.hourly?.time)) return null;
    const data: CamsData = {
      timezone: body.timezone ?? "UTC",
      utcOffsetSeconds: body.utc_offset_seconds ?? 0,
      timesSec: body.hourly!.time!,
      pm25: body.hourly!.pm2_5 ?? [],
      usAqi: body.hourly!.us_aqi ?? [],
    };
    if (cache.size >= MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { at: nowMs(), data });
    return data;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud-sql/api && NODE_ENV=test node --test --import tsx src/__tests__/open-meteo.test.ts`
Expected: PASS.

- [ ] **Step 5: Build + lint + full suite, then commit**

Run: `cd cloud-sql/api && npm run build && npm run lint && npm test`
Expected: clean.

```bash
git add cloud-sql/api/src/open-meteo.ts cloud-sql/api/src/__tests__/open-meteo.test.ts
git commit -m "feat(api): Open-Meteo CAMS client with in-process TTL cache"
```

---

### Task 4: API endpoint `GET /api/plans/:id/air-quality`

**Files:**
- Modify: `cloud-sql/api/src/routes/plans.ts` (add imports, one exported handler, one route registration — place after the `/:id/party` GET route)
- Test: `cloud-sql/api/src/__tests__/plan-air-quality-endpoint.test.ts`

**Interfaces:**
- Consumes: `buildAirQualityResponse`, `snapToCell`, `HrrrRow` from `../air-quality`; `fetchCams`, `CamsFetcher` from `../open-meteo`; existing `StatusQueryable`, `getUid`, `db`.
- Produces: `handlePlanAirQuality(req, res, pool?, cams?, nowSec?)` export (test seam) and the mounted route. Task 8's web action calls this route over HTTP.

- [ ] **Step 1: Write the failing tests**

Create `cloud-sql/api/src/__tests__/plan-air-quality-endpoint.test.ts`:

```ts
// Endpoint seam tests for GET /api/plans/:id/air-quality — fake pool keyed
// by SQL substring, fake CAMS fetcher, no live DB or network.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { handlePlanAirQuality } from "../routes/plans";
import { CamsData } from "../air-quality";

class FakeResponse {
  statusCode?: number;
  jsonBody?: any;
  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  json(body: unknown): this {
    this.jsonBody = body;
    return this;
  }
}

const CAMS: CamsData = {
  timezone: "America/New_York",
  utcOffsetSeconds: -14400,
  timesSec: [Date.UTC(2026, 7, 6, 12) / 1000],
  pm25: [5],
  usAqi: [40],
};
const cams = async () => CAMS;
const noCams = async () => null;
const NOW = () => Date.UTC(2026, 7, 6, 12) / 1000;

function makePool(handlers: Array<[RegExp, any[]]>) {
  const seen: string[] = [];
  return {
    seen,
    async query(sql: string, _params: unknown[]) {
      seen.push(sql);
      for (const [re, rows] of handlers) {
        if (re.test(sql)) return { rows };
      }
      return { rows: [] };
    },
  };
}

test("404 when plan is missing or caller is not owner/party", async () => {
  const pool = makePool([[/FROM plans p/, []]]);
  const req = { params: { id: "p1" }, uid: "u1" } as any;
  const res = new FakeResponse();
  await handlePlanAirQuality(req, res as any, pool, cams, NOW);
  assert.equal(res.statusCode, 404);
});

test("access query scopes to owner OR party member", async () => {
  const pool = makePool([[/FROM plans p/, []]]);
  const req = { params: { id: "p1" }, uid: "u1" } as any;
  await handlePlanAirQuality(req, new FakeResponse() as any, pool, cams, NOW);
  assert.match(pool.seen[0], /p\.user_id = \$2 OR pp\.user_id = \$2/);
});

test("available:false no_location when plan has no destinations and no path", async () => {
  const pool = makePool([
    [/FROM plans p/, [{ date: null }]],
    [/plan_destinations/, []],
    [/ST_PointOnSurface/, []],
  ]);
  const req = { params: { id: "p1" }, uid: "u1" } as any;
  const res = new FakeResponse();
  await handlePlanAirQuality(req, res as any, pool, cams, NOW);
  assert.equal(res.jsonBody.available, false);
  assert.equal(res.jsonBody.reason, "no_location");
});

test("happy path: first destination point, HRRR rows + CAMS merged", async () => {
  const validAt = new Date(Date.UTC(2026, 7, 6, 13));
  const pool = makePool([
    [/FROM plans p/, [{ date: new Date(Date.UTC(2026, 7, 6, 16)) }]],
    [/plan_destinations/, [{ lat: 44.2701, lng: -71.3033 }]],
    [/FROM smoke_forecasts/, [
      { valid_at: validAt, run_at: new Date(Date.UTC(2026, 7, 6, 6)), smoke_ug_m3: 22.4 },
    ]],
  ]);
  const req = { params: { id: "p1" }, uid: "u1" } as any;
  const res = new FakeResponse();
  await handlePlanAirQuality(req, res as any, pool, cams, NOW);
  const body = res.jsonBody;
  assert.equal(body.available, true);
  assert.equal(body.planDate, "2026-08-06");
  const hours = body.days.flatMap((d: any) => d.hours);
  assert.ok(hours.some((h: any) => h.source === "hrrr_smoke" && Math.abs(h.pm25 - 22.4) < 1e-9));
  assert.ok(hours.some((h: any) => h.source === "cams"));
  // smoke query must use the snapped cell key for the destination
  const smokeSql = pool.seen.find((s) => /smoke_forecasts/.test(s))!;
  assert.match(smokeSql, /cell_key = \$1/);
});

test("falls back to ST_PointOnSurface when there are no plan destinations", async () => {
  const pool = makePool([
    [/FROM plans p/, [{ date: null }]],
    [/plan_destinations/, []],
    [/ST_PointOnSurface/, [{ lat: 39.0, lng: -120.0 }]],
    [/FROM smoke_forecasts/, []],
  ]);
  const req = { params: { id: "p1" }, uid: "u1" } as any;
  const res = new FakeResponse();
  await handlePlanAirQuality(req, res as any, pool, cams, NOW);
  assert.equal(res.jsonBody.available, true);
});

test("both upstreams empty → available:false upstream_unavailable", async () => {
  const pool = makePool([
    [/FROM plans p/, [{ date: null }]],
    [/plan_destinations/, [{ lat: 44.2701, lng: -71.3033 }]],
    [/FROM smoke_forecasts/, []],
  ]);
  const req = { params: { id: "p1" }, uid: "u1" } as any;
  const res = new FakeResponse();
  await handlePlanAirQuality(req, res as any, pool, noCams, NOW);
  assert.equal(res.jsonBody.available, false);
  assert.equal(res.jsonBody.reason, "upstream_unavailable");
});

test("pool errors return 500, not a crash", async () => {
  const pool = {
    async query(): Promise<{ rows: unknown[] }> {
      throw new Error("db exploded");
    },
  };
  const req = { params: { id: "p1" }, uid: "u1" } as any;
  const res = new FakeResponse();
  await handlePlanAirQuality(req, res as any, pool, cams, NOW);
  assert.equal(res.statusCode, 500);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud-sql/api && NODE_ENV=test node --test --import tsx src/__tests__/plan-air-quality-endpoint.test.ts`
Expected: FAIL — `handlePlanAirQuality` is not exported.

- [ ] **Step 3: Implement the handler in `cloud-sql/api/src/routes/plans.ts`**

Add to the imports at the top:

```ts
import { buildAirQualityResponse, snapToCell, HrrrRow } from "../air-quality";
import { fetchCams, CamsFetcher } from "../open-meteo";
```

Add after the `GET /api/plans/:id/party` route:

```ts
// GET /api/plans/:id/air-quality — merged HRRR-Smoke (0–48 h, CONUS) +
// Open-Meteo/CAMS (7 days, global) forecast at the plan's location, with the
// plan's own day flagged. Same owner-or-party access rule as GET /:id.
// Upstream trouble degrades to { available: false } — the plan page must
// never break because a smoke feed hiccuped.
// Design: docs/superpowers/specs/2026-08-06-plan-air-quality-design.md
export async function handlePlanAirQuality(
  req: Request,
  res: Response,
  pool: StatusQueryable = db,
  cams: CamsFetcher = fetchCams,
  nowSec: () => number = () => Math.floor(Date.now() / 1000)
): Promise<void> {
  const uid = getUid(req);
  const { id } = req.params;
  try {
    const planResult = await pool.query(
      `SELECT p.date
       FROM plans p
       LEFT JOIN plan_party pp ON pp.plan_id = p.id AND pp.user_id = $2
       WHERE p.id = $1 AND (p.user_id = $2 OR pp.user_id = $2)`,
      [id, uid]
    );
    if (planResult.rows.length === 0) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    const planDate = (planResult.rows[0] as { date: Date | null }).date;

    const destResult = await pool.query(
      `SELECT lat, lng FROM (
         SELECT ST_Y(d.location::geometry) AS lat,
                ST_X(d.location::geometry) AS lng,
                pd.ordinal
         FROM plan_destinations pd
         JOIN destinations d ON d.id = pd.destination_id
         WHERE pd.plan_id = $1
         ORDER BY pd.ordinal
         LIMIT 1
       ) first_destination`,
      [id]
    );
    let point =
      destResult.rows.length > 0
        ? (destResult.rows[0] as { lat: number | null; lng: number | null })
        : null;
    if (!point) {
      const pathResult = await pool.query(
        `SELECT ST_Y(pt) AS lat, ST_X(pt) AS lng
         FROM (SELECT ST_PointOnSurface(path::geometry) AS pt
               FROM plans WHERE id = $1 AND path IS NOT NULL) s`,
        [id]
      );
      point =
        pathResult.rows.length > 0
          ? (pathResult.rows[0] as { lat: number | null; lng: number | null })
          : null;
    }
    if (!point || point.lat === null || point.lng === null) {
      res.json({ available: false, reason: "no_location" });
      return;
    }

    const cell = snapToCell(point.lat, point.lng);
    const smokeResult = await pool.query(
      `SELECT valid_at, run_at, smoke_ug_m3
       FROM smoke_forecasts
       WHERE cell_key = $1 AND valid_at >= now() - interval '1 hour'
       ORDER BY valid_at`,
      [cell.cellKey]
    );
    const hrrrRows: HrrrRow[] = (
      smokeResult.rows as { valid_at: Date; run_at: Date; smoke_ug_m3: number }[]
    ).map((r) => ({
      validAtSec: Math.floor(new Date(r.valid_at).getTime() / 1000),
      smokeUgM3: r.smoke_ug_m3,
      runAtIso: new Date(r.run_at).toISOString(),
    }));

    const camsData = await cams(cell.lat, cell.lng);
    res.json(
      buildAirQualityResponse({
        point: { lat: point.lat, lng: point.lng },
        hrrrRows,
        cams: camsData,
        planDateSec: planDate
          ? Math.floor(new Date(planDate).getTime() / 1000)
          : null,
        nowSec: nowSec(),
      })
    );
  } catch (err) {
    console.error("[air-quality] lookup failed:", err);
    res.status(500).json({ error: "air quality lookup failed" });
  }
}

router.get("/:id/air-quality", (req, res: Response) => handlePlanAirQuality(req, res));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud-sql/api && NODE_ENV=test node --test --import tsx src/__tests__/plan-air-quality-endpoint.test.ts`
Expected: PASS.

- [ ] **Step 5: Build + lint + full suite, then commit**

Run: `cd cloud-sql/api && npm run build && npm run lint && npm test`
Expected: clean, all existing suites still pass.

```bash
git add cloud-sql/api/src/routes/plans.ts cloud-sql/api/src/__tests__/plan-air-quality-endpoint.test.ts
git commit -m "feat(api): GET /api/plans/:id/air-quality — merged HRRR-Smoke + CAMS forecast"
```

---

### Task 5: smoke-job package scaffold + `hrrr.ts` helpers

**Files:**
- Create: `cloud-sql/smoke-job/package.json`
- Create: `cloud-sql/smoke-job/tsconfig.json` (copy `cloud-sql/api/tsconfig.json` verbatim)
- Create: `cloud-sql/smoke-job/eslint.config.js` (copy `cloud-sql/api/eslint.config.js` verbatim)
- Create: `cloud-sql/smoke-job/Dockerfile`
- Create: `cloud-sql/smoke-job/.dockerignore`
- Create: `cloud-sql/smoke-job/src/hrrr.ts`
- Test: `cloud-sql/smoke-job/src/__tests__/hrrr.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (Task 6 imports these):
  - `CELL_SIZE_DEG`, `interface Cell`, `snapToCell`, `isInHrrrConus` — identical to Task 2's
  - `interface HrrrCycle { ymd: string; hour: number }`
  - `candidateCycles(nowSec: number): HrrrCycle[]` (newest-first 00/06/12/18Z cycles in the last 30 h)
  - `cycleTimeSec(c: HrrrCycle): number`
  - `gribUrl(c: HrrrCycle, fh: number): string`, `idxUrl(c: HrrrCycle, fh: number): string`
  - `interface ByteRange { start: number; end: number | null }`
  - `findMassdenRange(idxText: string): ByteRange | null`
  - `rangeHeader(r: ByteRange): string`
  - `parseGribGetValue(stdout: string): number`
  - `KG_M3_TO_UG_M3` (1e9)

- [ ] **Step 1: Scaffold the package**

`cloud-sql/smoke-job/package.json`:

```json
{
  "name": "peaks-smoke-job",
  "version": "1.0.0",
  "description": "HRRR-Smoke ingestion — samples near-surface smoke at upcoming plan locations into smoke_forecasts",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "lint": "eslint src/",
    "test": "NODE_ENV=test node --test --import tsx src/__tests__/*.test.ts"
  },
  "engines": {
    "node": "20"
  },
  "dependencies": {
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/pg": "^8.11.0",
    "eslint": "^9.39.4",
    "tsx": "^4.19.0",
    "typescript": "^5.7.3",
    "typescript-eslint": "^8.57.2"
  },
  "private": true
}
```

Copy `cloud-sql/api/tsconfig.json` → `cloud-sql/smoke-job/tsconfig.json` and `cloud-sql/api/eslint.config.js` → `cloud-sql/smoke-job/eslint.config.js`, both unchanged.

`cloud-sql/smoke-job/Dockerfile`:

```dockerfile
# HRRR-Smoke ingestion job. ecCodes supplies grib_get (nearest-gridpoint
# extraction) — wgrib2 is not packaged in Debian bookworm.
FROM node:20-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends libeccodes-tools ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
```

`cloud-sql/smoke-job/.dockerignore`:

```
node_modules
dist
```

Run: `cd cloud-sql/smoke-job && npm install`
Expected: creates `package-lock.json` with no errors.

- [ ] **Step 2: Write the failing tests**

Create `cloud-sql/smoke-job/src/__tests__/hrrr.test.ts`:

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd cloud-sql/smoke-job && npm test`
Expected: FAIL — cannot find module `../hrrr`.

- [ ] **Step 4: Implement `cloud-sql/smoke-job/src/hrrr.ts`**

```ts
// Pure HRRR-Smoke helpers: cycle discovery, S3 URLs, .idx sidecar parsing,
// grib_get output parsing, and grid-cell snapping. No I/O here.
// Design: docs/superpowers/specs/2026-08-06-plan-air-quality-design.md

// ~3 km grid cells. Keep in sync with cloud-sql/api/src/air-quality.ts
// (duplicated: separate npm packages; both pin identical golden vectors).
export const CELL_SIZE_DEG = 0.03;

export interface Cell {
  cellKey: string;
  lat: number;
  lng: number;
}

export function snapToCell(lat: number, lng: number): Cell {
  const latIdx = Math.round(lat / CELL_SIZE_DEG);
  const lngIdx = Math.round(lng / CELL_SIZE_DEG);
  return {
    cellKey: `${latIdx}:${lngIdx}`,
    lat: latIdx * CELL_SIZE_DEG,
    lng: lngIdx * CELL_SIZE_DEG,
  };
}

// Approximate HRRR CONUS domain.
export function isInHrrrConus(lat: number, lng: number): boolean {
  return lat >= 21 && lat <= 53 && lng >= -134 && lng <= -60;
}

export interface HrrrCycle {
  ymd: string; // "20260806"
  hour: number; // 0 | 6 | 12 | 18
}

const BUCKET = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com";

export function gribUrl(c: HrrrCycle, fh: number): string {
  const hh = String(c.hour).padStart(2, "0");
  const ff = String(fh).padStart(2, "0");
  return `${BUCKET}/hrrr.${c.ymd}/conus/hrrr.t${hh}z.wrfsfcf${ff}.grib2`;
}

export function idxUrl(c: HrrrCycle, fh: number): string {
  return `${gribUrl(c, fh)}.idx`;
}

export function cycleTimeSec(c: HrrrCycle): number {
  return (
    Date.UTC(
      Number(c.ymd.slice(0, 4)),
      Number(c.ymd.slice(4, 6)) - 1,
      Number(c.ymd.slice(6, 8)),
      c.hour
    ) / 1000
  );
}

// 48-hour cycles run at 00/06/12/18 UTC and land on S3 roughly 2 h later.
// Newest-first candidates covering the last 30 h.
export function candidateCycles(nowSec: number): HrrrCycle[] {
  const out: HrrrCycle[] = [];
  for (let back = 0; back <= 30 * 3600; back += 3600) {
    const t = new Date((nowSec - back) * 1000);
    if (t.getUTCHours() % 6 !== 0) continue;
    out.push({
      ymd: t.toISOString().slice(0, 10).replace(/-/g, ""),
      hour: t.getUTCHours(),
    });
  }
  return out;
}

// .idx sidecar lines: "N:byteStart:d=YYYYMMDDHH:VAR:level:fcst:".
export interface ByteRange {
  start: number;
  end: number | null; // null → open-ended (last record in the file)
}

export function findMassdenRange(idxText: string): ByteRange | null {
  const lines = idxText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(":");
    if (parts[3] === "MASSDEN" && parts[4] === "8 m above ground") {
      const start = parseInt(parts[1], 10);
      const nextStart = lines[i + 1]?.split(":")[1];
      return { start, end: nextStart ? parseInt(nextStart, 10) - 1 : null };
    }
  }
  return null;
}

export function rangeHeader(r: ByteRange): string {
  return r.end === null ? `bytes=${r.start}-` : `bytes=${r.start}-${r.end}`;
}

// grib_get -l lat,lng,1 prints the nearest-gridpoint value as a bare number.
export function parseGribGetValue(stdout: string): number {
  const v = parseFloat(stdout.trim().split(/\s+/)[0]);
  if (!Number.isFinite(v)) {
    throw new Error(`unparseable grib_get output: ${stdout.slice(0, 120)}`);
  }
  return v;
}

// MASSDEN arrives in kg/m³; we store µg/m³.
export const KG_M3_TO_UG_M3 = 1e9;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd cloud-sql/smoke-job && npm test && npm run lint && npm run build`
Expected: all pass, zero lint errors, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add cloud-sql/smoke-job
git commit -m "feat(smoke-job): package scaffold + pure HRRR helpers (idx ranges, grib_get parse, cell snap)"
```

---

### Task 6: smoke-job orchestrator (`index.ts`, `db.ts`)

**Files:**
- Create: `cloud-sql/smoke-job/src/db.ts`
- Create: `cloud-sql/smoke-job/src/index.ts`
- Test: `cloud-sql/smoke-job/src/__tests__/orchestrator.test.ts`

**Interfaces:**
- Consumes: everything Task 5 exports.
- Produces: `collectSampleCells(db): Promise<Cell[]>`, `upsertSmokeRows(db, rows: SmokeRow[]): Promise<void>`, `interface SmokeRow { cellKey: string; validAtSec: number; runAtSec: number; smokeUgM3: number }` (exported for tests), plus the `main()` entrypoint the container runs.

- [ ] **Step 1: Write the failing tests**

Create `cloud-sql/smoke-job/src/__tests__/orchestrator.test.ts`:

```ts
// Orchestrator DB seams: sample-cell collection (dedupe, CONUS filter,
// null-location skip) and the upsert SQL (conflict clause, newer-run guard,
// chunking). Fake pool, no live DB.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { collectSampleCells, upsertSmokeRows, SmokeRow } from "../index";

function fakePool(rows: any[]) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  return {
    calls,
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

test("collectSampleCells dedupes to cells, skips nulls and non-CONUS", async () => {
  const pool = fakePool([
    { id: "p1", lat: 44.2701, lng: -71.3033 },
    { id: "p2", lat: 44.2703, lng: -71.3035 }, // same cell as p1
    { id: "p3", lat: null, lng: null },        // no destination, no path
    { id: "p4", lat: 60.0, lng: -150.0 },      // Alaska → out of domain
    { id: "p5", lat: 39.0, lng: -120.0 },
  ]);
  const cells = await collectSampleCells(pool);
  assert.deepEqual(
    cells.map((c) => c.cellKey).sort(),
    ["1300:-4000", "1476:-2377"]
  );
  // Date-window scoping and first-destination-then-path fallback in SQL:
  assert.match(pool.calls[0].sql, /p\.date BETWEEN now\(\) - interval '24 hours' AND now\(\) \+ interval '60 hours'/);
  assert.match(pool.calls[0].sql, /ST_PointOnSurface/);
  assert.match(pool.calls[0].sql, /ORDER BY pd\.ordinal/);
});

test("upsertSmokeRows writes conflict-guarded upserts in one chunk", async () => {
  const pool = fakePool([]);
  const rows: SmokeRow[] = [
    { cellKey: "1476:-2377", validAtSec: 1754481600, runAtSec: 1754460000, smokeUgM3: 12.5 },
    { cellKey: "1476:-2377", validAtSec: 1754485200, runAtSec: 1754460000, smokeUgM3: 14.1 },
  ];
  await upsertSmokeRows(pool, rows);
  assert.equal(pool.calls.length, 1);
  const { sql, params } = pool.calls[0];
  assert.match(sql, /INSERT INTO smoke_forecasts/);
  assert.match(sql, /ON CONFLICT \(cell_key, valid_at\) DO UPDATE/);
  assert.match(sql, /WHERE EXCLUDED\.run_at >= smoke_forecasts\.run_at/);
  assert.equal(params!.length, 8);
  assert.equal(params![0], "1476:-2377");
  assert.equal(params![3], 12.5);
});

test("upsertSmokeRows chunks big batches", async () => {
  const pool = fakePool([]);
  const rows: SmokeRow[] = Array.from({ length: 501 }, (_, i) => ({
    cellKey: "1:1",
    validAtSec: 1754481600 + i * 3600,
    runAtSec: 1754460000,
    smokeUgM3: 1,
  }));
  await upsertSmokeRows(pool, rows);
  assert.equal(pool.calls.length, 2);
});

test("upsertSmokeRows no-ops on empty input", async () => {
  const pool = fakePool([]);
  await upsertSmokeRows(pool, []);
  assert.equal(pool.calls.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud-sql/smoke-job && npm test`
Expected: hrrr tests pass; orchestrator tests FAIL — cannot find module `../index`.

- [ ] **Step 3: Implement `db.ts` and `index.ts`**

`cloud-sql/smoke-job/src/db.ts`:

```ts
// Postgres pool. Cloud Run: Unix socket at /cloudsql/<instance>.
// Local dev: TCP via Cloud SQL Auth Proxy (set DB_HOST=127.0.0.1).
import { Pool } from "pg";

const pool =
  process.env.INSTANCE_CONNECTION_NAME && !process.env.DB_HOST
    ? new Pool({
        host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
        database: process.env.DB_NAME || "peaks",
        user: process.env.DB_USER || "peaks-api",
        password: process.env.DB_PASS,
        max: 2,
      })
    : new Pool({
        host: process.env.DB_HOST || "127.0.0.1",
        port: parseInt(process.env.DB_PORT || "5432"),
        database: process.env.DB_NAME || "peaks",
        user: process.env.DB_USER || "peaks-api",
        password: process.env.DB_PASS,
        max: 2,
      });

export default pool;
```

`cloud-sql/smoke-job/src/index.ts`:

```ts
// HRRR-Smoke ingestion. Runs 4x/day via Cloud Scheduler → Cloud Run Job:
// samples near-surface smoke (MASSDEN, 8 m) at every upcoming plan's grid
// cell for forecast hours f00–f48 and upserts into smoke_forecasts.
// Steps: collect cells → newest complete cycle → byte-range MASSDEN records
// via .idx → grib_get nearest-point extraction → upsert → prune.
// Design: docs/superpowers/specs/2026-08-06-plan-air-quality-design.md

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pool from "./db";
import {
  Cell,
  HrrrCycle,
  KG_M3_TO_UG_M3,
  candidateCycles,
  cycleTimeSec,
  findMassdenRange,
  gribUrl,
  idxUrl,
  isInHrrrConus,
  parseGribGetValue,
  rangeHeader,
  snapToCell,
} from "./hrrr";

const run = promisify(execFile);

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

// One sample point per plan dated in the ingestion window: first destination
// by ordinal, else a point on the plan path. Deduped to ~3 km grid cells.
export async function collectSampleCells(db: Queryable): Promise<Cell[]> {
  const result = await db.query(
    `SELECT p.id,
            COALESCE(fd.lat, ST_Y(ST_PointOnSurface(p.path::geometry))) AS lat,
            COALESCE(fd.lng, ST_X(ST_PointOnSurface(p.path::geometry))) AS lng
     FROM plans p
     LEFT JOIN LATERAL (
       SELECT ST_Y(d.location::geometry) AS lat, ST_X(d.location::geometry) AS lng
       FROM plan_destinations pd
       JOIN destinations d ON d.id = pd.destination_id
       WHERE pd.plan_id = p.id
       ORDER BY pd.ordinal
       LIMIT 1
     ) fd ON true
     WHERE p.date BETWEEN now() - interval '24 hours' AND now() + interval '60 hours'`
  );
  const cells = new Map<string, Cell>();
  for (const row of result.rows) {
    if (row.lat == null || row.lng == null) continue;
    if (!isInHrrrConus(row.lat, row.lng)) continue;
    const cell = snapToCell(row.lat, row.lng);
    cells.set(cell.cellKey, cell);
  }
  return [...cells.values()];
}

export interface SmokeRow {
  cellKey: string;
  validAtSec: number;
  runAtSec: number;
  smokeUgM3: number;
}

// Conflict-guarded upsert: a newer HRRR run always wins, an older or rerun
// cycle never clobbers fresher data.
export async function upsertSmokeRows(db: Queryable, rows: SmokeRow[]): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      const base = j * 4;
      values.push(
        `($${base + 1}, to_timestamp($${base + 2}), to_timestamp($${base + 3}), $${base + 4})`
      );
      params.push(r.cellKey, r.validAtSec, r.runAtSec, r.smokeUgM3);
    });
    await db.query(
      `INSERT INTO smoke_forecasts (cell_key, valid_at, run_at, smoke_ug_m3)
       VALUES ${values.join(", ")}
       ON CONFLICT (cell_key, valid_at) DO UPDATE
         SET smoke_ug_m3 = EXCLUDED.smoke_ug_m3,
             run_at = EXCLUDED.run_at,
             fetched_at = now()
         WHERE EXCLUDED.run_at >= smoke_forecasts.run_at`,
      params
    );
  }
}

async function findLatestCycle(nowSec: number): Promise<HrrrCycle | null> {
  for (const c of candidateCycles(nowSec)) {
    const res = await fetch(idxUrl(c, 48));
    if (res.ok) {
      await res.text(); // drain
      return c;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const cells = await collectSampleCells(pool);
  if (cells.length === 0) {
    console.log("[smoke-job] no plans in the ingestion window; nothing to do");
    return;
  }
  const cycle = await findLatestCycle(nowSec);
  if (!cycle) throw new Error("no complete 48 h HRRR cycle found in the last 30 h");
  const runAtSec = cycleTimeSec(cycle);
  console.log(
    `[smoke-job] cycle ${cycle.ymd} t${String(cycle.hour).padStart(2, "0")}z, ${cells.length} cell(s)`
  );

  const rows: SmokeRow[] = [];
  const dir = await mkdtemp(join(tmpdir(), "hrrr-"));
  try {
    for (let fh = 0; fh <= 48; fh++) {
      const idxRes = await fetch(idxUrl(cycle, fh));
      if (!idxRes.ok) {
        console.warn(`[smoke-job] f${fh}: idx HTTP ${idxRes.status}, skipping hour`);
        continue;
      }
      const range = findMassdenRange(await idxRes.text());
      if (!range) {
        console.warn(`[smoke-job] f${fh}: no MASSDEN record, skipping hour`);
        continue;
      }
      const gribRes = await fetch(gribUrl(cycle, fh), {
        headers: { Range: rangeHeader(range) },
      });
      if (!gribRes.ok) {
        console.warn(`[smoke-job] f${fh}: grib HTTP ${gribRes.status}, skipping hour`);
        continue;
      }
      const file = join(dir, `massden_f${fh}.grib2`);
      await writeFile(file, Buffer.from(await gribRes.arrayBuffer()));
      for (const cell of cells) {
        const { stdout } = await run("grib_get", ["-l", `${cell.lat},${cell.lng},1`, file]);
        rows.push({
          cellKey: cell.cellKey,
          validAtSec: runAtSec + fh * 3600,
          runAtSec,
          smokeUgM3: parseGribGetValue(stdout) * KG_M3_TO_UG_M3,
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  if (rows.length === 0) throw new Error("no smoke values extracted");
  await upsertSmokeRows(pool, rows);
  await pool.query(`DELETE FROM smoke_forecasts WHERE valid_at < now() - interval '24 hours'`);
  console.log(`[smoke-job] upserted ${rows.length} rows for ${cells.length} cell(s)`);
}

if (process.env.NODE_ENV !== "test") {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[smoke-job] failed:", err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud-sql/smoke-job && npm test && npm run lint && npm run build`
Expected: all pass, clean lint and build.

- [ ] **Step 5: Commit**

```bash
git add cloud-sql/smoke-job/src/db.ts cloud-sql/smoke-job/src/index.ts cloud-sql/smoke-job/src/__tests__/orchestrator.test.ts
git commit -m "feat(smoke-job): ingestion orchestrator — cells, cycle discovery, grib_get sampling, guarded upsert"
```

---

### Task 7: CI deploy job + scheduler setup script

**Files:**
- Modify: `.github/workflows/deploy.yml` (append a `deploy-smoke-job` job after `deploy-api`)
- Create: `scripts/setup-smoke-scheduler.sh` (mode 755)

**Interfaces:**
- Consumes: the smoke-job package (Task 5/6) and its Dockerfile.
- Produces: Cloud Run Job `peaks-smoke-job` deployed on every main push; a one-time scheduler script for Task 9.

- [ ] **Step 1: Append to `.github/workflows/deploy.yml`**

```yaml
  deploy-smoke-job:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: cloud-sql/smoke-job/package-lock.json

      - name: Install dependencies
        run: npm ci
        working-directory: cloud-sql/smoke-job

      - name: Lint
        run: npm run lint
        working-directory: cloud-sql/smoke-job

      - name: Test
        run: npm test
        working-directory: cloud-sql/smoke-job

      - name: Build
        run: npm run build
        working-directory: cloud-sql/smoke-job

      - uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}

      # deploy-cloudrun's `job` input can't source-build, so use gcloud
      # directly. Like deploy-api, the FULL env/secret set is pinned here on
      # every deploy — never update it out-of-band.
      - name: Deploy Cloud Run job
        run: |
          gcloud run jobs deploy peaks-smoke-job \
            --source=cloud-sql/smoke-job \
            --region=us-central1 \
            --set-cloudsql-instances=donner-a8608:us-central1:peaks-db \
            --set-env-vars=INSTANCE_CONNECTION_NAME=donner-a8608:us-central1:peaks-db,DB_NAME=peaks,DB_USER=peaks-api \
            --set-secrets=DB_PASS=peaks-db-password:latest \
            --memory=512Mi \
            --task-timeout=900 \
            --max-retries=1 \
            --quiet
```

- [ ] **Step 2: Create `scripts/setup-smoke-scheduler.sh`**

```bash
#!/usr/bin/env bash
# One-time setup: Cloud Scheduler trigger for the peaks-smoke-job Cloud Run
# Job. Run once after the job's first deploy (CI creates/updates the job on
# every push to main; the scheduler only needs to exist once).
#
# Fires at 02:15, 08:15, 14:15, 20:15 UTC — ~2¼ h after each 48-hour HRRR
# cycle (00/06/12/18 UTC), when the f48 file is reliably on S3.
set -euo pipefail

PROJECT_ID="donner-a8608"
REGION="us-central1"
JOB="peaks-smoke-job"

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Scheduler authenticates as the default compute SA; it needs run.jobs.run.
gcloud run jobs add-iam-policy-binding "$JOB" \
  --project="$PROJECT_ID" --region="$REGION" \
  --member="serviceAccount:${SA}" --role="roles/run.invoker"

gcloud scheduler jobs create http "${JOB}-trigger" \
  --project="$PROJECT_ID" --location="$REGION" \
  --schedule="15 2,8,14,20 * * *" --time-zone="Etc/UTC" \
  --uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${JOB}:run" \
  --http-method=POST \
  --oauth-service-account-email="$SA"

echo "Scheduler ${JOB}-trigger created."
```

Run: `chmod +x scripts/setup-smoke-scheduler.sh && bash -n scripts/setup-smoke-scheduler.sh`
Expected: `bash -n` exits 0 (syntax only — do NOT execute the script here).

- [ ] **Step 3: Validate the workflow YAML parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml'))" && echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml scripts/setup-smoke-scheduler.sh
git commit -m "ci: deploy peaks-smoke-job Cloud Run job + one-time scheduler setup script"
```

---

### Task 8: Web — server action, card, page wiring, apphosting env

**Files:**
- Create: `web/src/lib/actions/air-quality.ts`
- Create: `web/src/components/plan-air-quality-card.tsx`
- Modify: `web/src/app/(authenticated)/plans/[id]/page.tsx`
- Modify: `web/apphosting.yaml` (add `PEAKS_API_URL`)

**Interfaces:**
- Consumes: the HTTP endpoint from Task 4; existing `useAuth().getIdToken()` and `loadPlan` flow in the page.
- Produces: `getPlanAirQuality(token: string, planId: string): Promise<PlanAirQuality | null>`; `<PlanAirQualityCard aq={PlanAirQuality} />`.

- [ ] **Step 1: Create `web/src/lib/actions/air-quality.ts`**

```ts
"use server";

// Thin proxy to the Cloud Run API's plan air-quality endpoint. The API owns
// all merge logic (HRRR-Smoke + CAMS); web and iOS consume the same contract.
// Contract: docs/superpowers/specs/2026-08-06-plan-air-quality-design.md

export interface AqHour {
  time: string;
  source: "hrrr_smoke" | "cams";
  pm25: number;
  category: string;
}

export interface AqDay {
  date: string;
  source: "hrrr_smoke" | "cams" | "mixed";
  pm25Max: number;
  usAqiMax: number | null;
  category: string;
  isPlanDay: boolean;
  hours: AqHour[];
}

export interface PlanAirQuality {
  available: boolean;
  reason?: string;
  timezone?: string;
  planDate?: string | null;
  planDayBeyondHorizon?: boolean;
  days?: AqDay[];
}

const API_URL =
  process.env.PEAKS_API_URL || "https://peaks-api-qownl77soa-uc.a.run.app";

export async function getPlanAirQuality(
  token: string,
  planId: string
): Promise<PlanAirQuality | null> {
  try {
    const res = await fetch(`${API_URL}/api/plans/${planId}/air-quality`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data: PlanAirQuality = await res.json();
    return data.available || data.planDayBeyondHorizon ? data : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Create `web/src/components/plan-air-quality-card.tsx`**

```tsx
"use client";

import type { AqDay, PlanAirQuality } from "../lib/actions/air-quality";

// Standard AQI palette.
const CATEGORY_COLORS: Record<string, string> = {
  good: "bg-green-500",
  moderate: "bg-yellow-400",
  unhealthy_sensitive: "bg-orange-500",
  unhealthy: "bg-red-500",
  very_unhealthy: "bg-purple-600",
  hazardous: "bg-rose-900",
};

const CATEGORY_LABELS: Record<string, string> = {
  good: "Good",
  moderate: "Moderate",
  unhealthy_sensitive: "Unhealthy for sensitive groups",
  unhealthy: "Unhealthy",
  very_unhealthy: "Very unhealthy",
  hazardous: "Hazardous",
};

function headline(aq: PlanAirQuality): { day: AqDay | null; text: string } {
  const days = aq.days ?? [];
  const planDay = days.find((d) => d.isPlanDay) ?? null;
  if (!planDay && aq.planDayBeyondHorizon) {
    return { day: days[0] ?? null, text: "Smoke forecast opens about a week before your hike" };
  }
  const day = planDay ?? days[0] ?? null;
  if (!day) return { day: null, text: "" };
  const label = CATEGORY_LABELS[day.category] ?? day.category;
  const kind = day.source === "cams" ? "PM2.5" : "smoke";
  const when = planDay
    ? new Date(day.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })
    : "today";
  return { day, text: `${label} — ${kind} up to ${day.pm25Max} µg/m³ ${when}` };
}

export default function PlanAirQualityCard({ aq }: { aq: PlanAirQuality }) {
  const days = aq.days ?? [];
  if (days.length === 0) return null;
  const { day, text } = headline(aq);

  return (
    <div className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Air quality
      </h2>
      <div className="font-medium">{text}</div>
      {day && (
        <div className="flex gap-0.5 mt-3">
          {day.hours.map((h) => (
            <div
              key={h.time}
              className={`h-6 flex-1 rounded-sm ${CATEGORY_COLORS[h.category] ?? "bg-gray-300"}`}
              title={`${h.time.slice(11, 16)} — ${h.pm25} µg/m³`}
            />
          ))}
        </div>
      )}
      {days.length > 1 && (
        <div className="flex gap-3 mt-3 text-xs text-gray-600 dark:text-gray-400">
          {days.map((d) => (
            <span key={d.date} className="flex items-center gap-1">
              <span
                className={`w-2.5 h-2.5 rounded-full ${CATEGORY_COLORS[d.category] ?? "bg-gray-300"}`}
              />
              {new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 text-xs text-gray-400">
        NOAA HRRR-Smoke · Open-Meteo (CAMS, CC BY 4.0)
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into `web/src/app/(authenticated)/plans/[id]/page.tsx`**

Add imports:

```ts
import { getPlanAirQuality, type PlanAirQuality } from "../../../../lib/actions/air-quality";
import PlanAirQualityCard from "../../../../components/plan-air-quality-card";
```

Add state next to the other `useState` calls:

```ts
const [airQuality, setAirQuality] = useState<PlanAirQuality | null>(null);
```

Inside the existing `loadPlan` callback, directly after `setPlan(data); setLoading(false);` add (fire-and-forget so the plan renders immediately; NO new useEffect — this rides the existing load flow, so there is no re-render loop risk):

```ts
if (data) {
  getPlanAirQuality(token, planId).then(setAirQuality);
}
```

In the JSX, render the card between the plan facts block and the Destinations section (read the file; place it directly above the destinations section container):

```tsx
{airQuality && <PlanAirQualityCard aq={airQuality} />}
```

Match the wrapper spacing of sibling sections (e.g. same `mt-*`/stack the page already uses between cards).

- [ ] **Step 4: Add `PEAKS_API_URL` to `web/apphosting.yaml`**

Append to the `env:` list:

```yaml
  - variable: PEAKS_API_URL
    value: https://peaks-api-qownl77soa-uc.a.run.app
```

- [ ] **Step 5: Build + lint**

Run: `cd web && npm run build && npm run lint`
Expected: zero errors (pre-existing warnings acceptable).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/actions/air-quality.ts web/src/components/plan-air-quality-card.tsx "web/src/app/(authenticated)/plans/[id]/page.tsx" web/apphosting.yaml
git commit -m "feat(web): air quality & smoke card on plan detail via API air-quality endpoint"
```

---

### Task 9: Ops runbook (post-merge)

No code. Execute after the branch merges to main and CI is green, in this order. These steps touch production — run them deliberately, one at a time.

- [ ] **Step 1: Apply the migration as `postgres`**

```bash
gcloud secrets versions access latest --secret=peaks-db-postgres-password
cloud-sql-proxy donner-a8608:us-central1:peaks-db &
PGPASSWORD='<from secret>' psql -h 127.0.0.1 -U postgres -d peaks \
  -f cloud-sql/migrations/20260806_smoke_forecasts.sql
```

Expected: `CREATE TABLE`, `CREATE INDEX`, `GRANT`, `COMMIT`.

- [ ] **Step 2: Merge → watch CI**

`gh run list --limit 1` then `gh run watch <id>` until `deploy-api` and `deploy-smoke-job` are green. The first `deploy-smoke-job` run builds the ecCodes image (a few minutes).

- [ ] **Step 3: Create the scheduler (one-time)**

```bash
bash scripts/setup-smoke-scheduler.sh
```

Expected: IAM binding + `Scheduler peaks-smoke-job-trigger created.`

- [ ] **Step 4: Execute the job once and verify rows**

```bash
gcloud run jobs execute peaks-smoke-job --region=us-central1 --wait
PGPASSWORD='<from secret>' psql -h 127.0.0.1 -U postgres -d peaks \
  -c "SELECT cell_key, count(*), max(run_at), max(smoke_ug_m3) FROM smoke_forecasts GROUP BY cell_key;"
```

Expected: exit 0. Row check: if no plans are dated within the next 60 h, zero rows is CORRECT ("no plans in the ingestion window" in the job log). To force a real end-to-end check, date a test plan within 48 h first.

- [ ] **Step 5: Verify the endpoint + card**

Open a plan (dated within a week, with a destination) on the web app; confirm the Air quality card renders, the network tab shows one call to the action (no request loop), and the credit line is present. `grib_get -l` sanity: values in the card should be plausible (0–50 µg/m³ on a clear day, not 1e9-scale — if they look like raw kg/m³ × wrong factor, check `KG_M3_TO_UG_M3` handling).

---

## Plan self-review notes

- Spec coverage: migration (T1), job (T5–T7), endpoint (T2–T4), web card (T8), iOS handoff (already committed with the spec), ops (T9). Future extensions intentionally unplanned.
- The `grib_get -l` Lambert-grid nearest lookup is the one externally unverifiable assumption before deploy; T9 Step 4/5 verifies it against real files, and the spec documents the `grib_get_data` fallback if it fails.
- Type names (`Cell`, `HrrrRow`, `CamsData`, `SmokeRow`, `PlanAirQuality`) are consistent across tasks; golden vectors pin the duplicated cell math.
