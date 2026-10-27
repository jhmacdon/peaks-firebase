import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { Request, Response } from "express";
import { CamsData } from "../air-quality";
import { CamsFetcher } from "../open-meteo";
import { app } from "../index";
import db from "../db";
import { buildRouteAirQualityPointQuery, handleRouteAirQuality } from "../routes/routes";
import { appRequest } from "./helpers/app-request";

const NOW = () => Date.UTC(2026, 9, 27, 12) / 1000;
const CAMS: CamsData = {
  timezone: "America/Los_Angeles",
  utcOffsetSeconds: -25200,
  timesSec: [NOW(), NOW() + 3600],
  pm25: [4, 5],
  usAqi: [20, 22],
};

afterEach(() => mock.restoreAll());

function fakePool(pointRows: unknown[], smokeRows: unknown[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    async query(sql: string, params: unknown[]) {
      calls.push({ sql, params });
      return { rows: sql.includes("FROM smoke_forecasts") ? smokeRows : pointRows };
    },
  };
}

async function responseFor(pool: ReturnType<typeof fakePool>, cams: CamsFetcher = async () => CAMS) {
  let body: any;
  let status = 200;
  const response = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as Response;
  await handleRouteAirQuality({ params: { id: "route-1" }, uid: "member" } as unknown as Request<Record<string, string>>,
    response, pool, cams, NOW);
  return { status, body };
}

test("route forecast merges the same HRRR cell and CAMS data without a plan date", async () => {
  const pool = fakePool([{ lat: 46.85, lng: -121.76 }], [{
    valid_at: new Date(NOW() * 1000), run_at: new Date((NOW() - 3600) * 1000), smoke_ug_m3: 40,
  }]);
  const requested: number[][] = [];
  const { status, body } = await responseFor(pool, async (lat, lng) => {
    requested.push([lat, lng]);
    return CAMS;
  });
  assert.equal(status, 200);
  assert.equal(body.available, true);
  assert.equal(body.planDate, null);
  assert.equal(body.planDayBeyondHorizon, false);
  assert.deepEqual(body.point, { lat: 46.85, lng: -121.76 });
  assert.equal(body.days[0].isPlanDay, false);
  assert.equal(body.days[0].category, "unhealthy_sensitive");
  assert.deepEqual(body.days[0].hours.map((hour: any) => hour.source), ["hrrr_smoke", "cams"]);
  assert.deepEqual(pool.calls[0].params, ["route-1", "member"]);
  assert.deepEqual(pool.calls[1].params, ["1562:-4059"]);
  assert.deepEqual(requested, [[46.86, -121.77]]);
});

test("missing or inaccessible routes return 404 before requesting forecasts", async () => {
  const pool = fakePool([]);
  const { status } = await responseFor(pool, async () => { throw new Error("must not fetch"); });
  assert.equal(status, 404);
  assert.equal(pool.calls.length, 1);
});

test("a route without a usable point returns no_location before requesting forecasts", async () => {
  for (const point of [{ lat: null, lng: null }, { lat: Number.NaN, lng: 1 }, { lng: 1 }]) {
    const pool = fakePool([point]);
    const { status, body } = await responseFor(pool, async () => { throw new Error("must not fetch"); });
    assert.equal(status, 200);
    assert.deepEqual(body, { available: false, reason: "no_location" });
    assert.equal(pool.calls.length, 1);
  }
});

test("CAMS alone supplies a route forecast when the smoke job has no sampled cell", async () => {
  const { body } = await responseFor(fakePool([{ lat: 46.85, lng: -121.76 }]));
  assert.equal(body.available, true);
  assert.deepEqual(body.sources, { hrrrRun: null, cams: true });
});

test("empty upstreams return an unavailable forecast", async () => {
  const { body } = await responseFor(fakePool([{ lat: 46.85, lng: -121.76 }]), async () => null);
  assert.deepEqual(body, { available: false, reason: "upstream_unavailable" });
});

test("location SQL uses the route start, active route access, and visible ordered place fallback", () => {
  const signedOut = buildRouteAirQualityPointQuery("route-1", "");
  assert.match(signedOut.text, /ST_StartPoint\(r\.path::geometry\)/);
  assert.match(signedOut.text, /r\.status = 'active'/);
  assert.match(signedOut.text, /r\.owner = 'peaks'/);
  assert.match(signedOut.text, /\$2 <> '' AND r\.owner = \$2/);
  assert.match(signedOut.text, /FROM plan_party access_pp/);
  assert.doesNotMatch(signedOut.text, /access_p\.is_public/);
  assert.match(signedOut.text, /d\.owner = 'peaks'/);
  assert.match(signedOut.text, /ORDER BY rd\.ordinal, rd\.destination_id\s+LIMIT 1/);
  assert.deepEqual(signedOut.values, ["route-1", ""]);
  assert.doesNotMatch(buildRouteAirQualityPointQuery("route-1", "owner").text, /d\.owner = 'peaks'/);
});

test("route forecast is mounted for signed-out GET while writes still require auth", async () => {
  const queries: unknown[][] = [];
  mock.method(console, "log", () => undefined);
  mock.method(db, "query", async (_sql: string, params: unknown[]) => {
    queries.push(params);
    return { rows: [] };
  });
  assert.equal((await appRequest(app, "GET", "/api/routes/missing/air-quality")).status, 404);
  assert.deepEqual(queries, [["missing", ""]]);
  assert.equal((await appRequest(app, "POST", "/api/routes/missing/air-quality")).status, 401);
  assert.equal((await appRequest(app, "GET", "/api/routes/missing/air-quality", {
    Authorization: "Bearer invalid",
  })).status, 401);
  assert.equal(queries.length, 1);
});

test("route lookup failures reach the API error response", async () => {
  mock.method(console, "log", () => undefined);
  mock.method(console, "error", () => undefined);
  mock.method(db, "query", async () => { throw new Error("database unavailable"); });
  assert.equal((await appRequest(app, "GET", "/api/routes/missing/air-quality")).status, 500);
});
