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
