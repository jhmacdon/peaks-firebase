import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { app } from "../index";
import db from "../db";
import { buildMapGlaciersQuery, buildMapTrailsQuery, encodeMapBody, MAP_FEATURE_LIMIT, parseMapViewport } from "../routes/map";
import { appRequest } from "./helpers/app-request";

afterEach(() => mock.restoreAll());
const params = { minLat: "46.75", maxLat: "46.95", minLng: "-121.9", maxLng: "-121.6", zoom: "11" };
const path = (zoom = "11") => `/api/map/viewport?${new URLSearchParams({ ...params, zoom })}`;
const headers = { "X-Peaks-Capabilities": "glaciers-v1" };
const schemaProbe = (sql: string) => sql.includes("to_regprocedure") ? { rows: [{ ready: true }], rowCount: 1 }
  : sql.includes("information_schema.columns") ? { rows: [{ "?column?": 1 }], rowCount: 1 }
  : sql.includes("glacier_summary") ? { rows: [], rowCount: 0 } : null;

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
  assert.match(trails.text, /FROM route_map_paths m/);
  const glaciers = buildMapGlaciersQuery(view);
  assert.match(glaciers.text, /d.owner='peaks' AND pm.owner='peaks'/);
  // Match the outline, including a visible lobe whose centroid is outside the view.
  assert.match(glaciers.text, /ST_Intersects\(gf.map_outline, v.box\)/);
  assert.doesNotMatch(glaciers.text, /ST_Intersects\(d.location/);
  assert.deepEqual(glaciers.values, [-121.9, 46.75, -121.6, 46.95, MAP_FEATURE_LIMIT + 1]);
});

test("requests read stored display geometry, never full paths or outlines", () => {
  const view = parseMapViewport(params)!;
  const trails = buildMapTrailsQuery(view);
  // Geography tests and per-request simplification of ~8,000-point paths cost 12 s on prod.
  assert.doesNotMatch(trails.text, /r\.path|::geography|ST_Simplify/);
  assert.match(trails.text, /ST_Intersects\(m.path, v.box\)/);
  assert.match(trails.text, /ST_ClipByBox2D\(m.path, v.box\)/);
  const low = buildMapGlaciersQuery(view);
  assert.doesNotMatch(low.text, /gf\.outline|::geography|ST_Simplify/);
  assert.match(low.text, /ST_AsGeoJSON\(gf.map_outline_low, 5\)/);
  const detail = buildMapGlaciersQuery({ ...view, zoom: 14 });
  assert.match(detail.text, /ST_AsGeoJSON\(gf.map_outline, 5\)/);
});

test("before the migration, queries keep the full-geometry reads", () => {
  const view = parseMapViewport(params)!;
  assert.match(buildMapTrailsQuery(view, false).text, /ST_Intersects\(r.path, v.box::geography\)/);
  assert.match(buildMapGlaciersQuery(view, false).text, /ST_Intersects\(gf.outline, v.box::geography\)/);
});

test("signed-out browse starts glaciers at 11 and trails at 12, caps each result", async () => {
  mock.method(console, "log", () => {});
  const queries: string[] = [];
  mock.method(db, "query", async (sql: string) => {
    const probe = schemaProbe(sql);
    if (probe) return probe;
    queries.push(sql);
    return sql.includes("FROM route_map_paths m")
      ? { rows: Array.from({ length: 81 }, (_, id) => ({ id: String(id), name: "Trail", geometry: { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] } })), rowCount: 81 }
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
  assert.match(high.headers.vary, /Accept-Encoding/);
  assert.equal(high.headers["content-encoding"], undefined);
});

test("gzip only when the client accepts it and the body is worth it", async () => {
  const body = { trails: [], glaciers: [{ id: "ice", boundary: { type: "MultiPolygon", coordinates: [[[Array(400).fill([-121.7, 46.8])]]] } }], complete: true };
  const zipped = await encodeMapBody(body, true);
  assert.equal(zipped.encoding, "gzip");
  assert.deepEqual(JSON.parse(gunzipSync(zipped.data).toString()), body);
  assert.equal((await encodeMapBody(body, false)).encoding, undefined);
  assert.equal((await encodeMapBody({ trails: [], glaciers: [], complete: true }, true)).encoding, undefined);
});

test("invalid bounds do no database work and old clients never query glaciers", async () => {
  mock.method(console, "log", () => {});
  const queries: string[] = [];
  mock.method(db, "query", async (sql: string) => {
    const probe = schemaProbe(sql);
    if (probe) return probe;
    queries.push(sql);
    return { rows: [], rowCount: 0 };
  });
  assert.equal((await appRequest(app, "GET", path("10"))).status, 400);
  assert.equal(queries.length, 0);
  const old = await appRequest(app, "GET", path("12"));
  assert.equal(old.status, 200);
  assert.deepEqual(old.body.glaciers, []);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /FROM route_map_paths m/);
});
