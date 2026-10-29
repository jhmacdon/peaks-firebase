import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { app } from "../index";
import db from "../db";
import { buildMapGlaciersQuery, buildMapTrailsQuery, MAP_FEATURE_LIMIT, parseMapViewport } from "../routes/map";
import { appRequest } from "./helpers/app-request";

afterEach(() => mock.restoreAll());
const params = { minLat: "46.75", maxLat: "46.95", minLng: "-121.9", maxLng: "-121.6", zoom: "11" };
const path = (zoom = "11") => `/api/map/viewport?${new URLSearchParams({ ...params, zoom })}`;
const headers = { "X-Peaks-Capabilities": "glaciers-v1" };

test("viewport rejects missing, malformed, reversed, wrapped, and oversized bounds", () => {
  assert.ok(parseMapViewport(params));
  for (const invalid of [
    { zoom: "10.99" }, { zoom: "23" }, { minLat: "" }, { minLat: "46.75junk" },
    { minLat: "NaN" }, { maxLat: "Infinity" }, { minLat: "86" }, { minLng: "-181" },
    { minLng: "-121.5" }, { minLng: "179.9", maxLng: "-179.9" },
    { maxLat: "48" }, { maxLng: "-120" }, { minLat: ["46.75"] },
  ]) assert.equal(parseMapViewport({ ...params, ...invalid }), null, JSON.stringify(invalid));
});

test("spatial queries show only active catalog trails and public glacier outlines", () => {
  const view = parseMapViewport(params)!;
  const trails = buildMapTrailsQuery(view);
  assert.match(trails.text, /r.owner='peaks' AND r.status='active'/);
  assert.match(trails.text, /ST_Intersects\(r.path, v.box::geography\)/);
  assert.match(trails.text, /ST_Intersection/);
  const glaciers = buildMapGlaciersQuery(view);
  assert.match(glaciers.text, /d.owner='peaks' AND pm.owner='peaks'/);
  // Match the outline, including a visible lobe whose centroid is outside the view.
  assert.match(glaciers.text, /ST_Intersects\(gf.outline, v.box::geography\)/);
  assert.doesNotMatch(glaciers.text, /ST_Intersects\(d.location/);
  assert.deepEqual(glaciers.values, [-121.9, 46.75, -121.6, 46.95, MAP_FEATURE_LIMIT + 1]);
});

test("signed-out browse starts glaciers at 11 and trails at 12, caps each result", async () => {
  mock.method(console, "log", () => {});
  const queries: string[] = [];
  mock.method(db, "query", async (sql: string) => {
    if (sql.includes("to_regprocedure")) return { rows: [{ ready: true }], rowCount: 1 };
    if (sql.includes("glacier_summary")) return { rows: [], rowCount: 0 };
    queries.push(sql);
    return sql.includes("FROM routes r")
      ? { rows: Array.from({ length: 81 }, (_, id) => ({ id: String(id), name: "Trail", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } })), rowCount: 81 }
      : { rows: [{ id: "ice", name: "Ice", boundary: { type: "MultiPolygon", coordinates: [] } }], rowCount: 1 };
  });
  const low = await appRequest(app, "GET", path(), headers);
  assert.equal(low.status, 200);
  assert.equal(low.body.glaciers.length, 1);
  assert.equal(low.body.trails.length, 0);
  assert.equal(queries.length, 1);
  const high = await appRequest(app, "GET", path("12"), headers);
  assert.equal(high.status, 200);
  assert.equal(high.body.trails.length, 80);
  assert.equal(high.body.complete, false);
  assert.match(high.headers["cache-control"], /max-age=300/);
});

test("invalid bounds do no database work and old clients never query glaciers", async () => {
  mock.method(console, "log", () => {});
  const queries: string[] = [];
  mock.method(db, "query", async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 0 }; });
  assert.equal((await appRequest(app, "GET", path("10"))).status, 400);
  assert.equal(queries.length, 0);
  const old = await appRequest(app, "GET", path("12"));
  assert.equal(old.status, 200);
  assert.deepEqual(old.body.glaciers, []);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /FROM routes r/);
});
