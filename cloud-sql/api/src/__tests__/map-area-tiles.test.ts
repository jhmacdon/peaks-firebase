import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { app } from "../index";
import db from "../db";
import {
  AREA_TILE_CACHE_CONTROL, AREA_TILE_CONTENT_TYPE, buildAreaTileQuery, clearAreaTileCache, parseTileAddress,
} from "../routes/public-map-tiles";
import { appRequest } from "./helpers/app-request";

afterEach(() => { mock.restoreAll(); clearAreaTileCache(); });
const rainier = "/api/map/areas/12/662/1443.mvt";
const schemaProbe = (sql: string) => sql.includes("information_schema.columns");

function mockTiles(tile: Buffer | null, ready = true) {
  const queries: { text: string; values?: unknown[] }[] = [];
  mock.method(db, "query", async (text: string, values?: unknown[]) => {
    if (schemaProbe(text)) return ready ? { rows: [{ "?column?": 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    queries.push({ text, values });
    return { rows: [{ tile }], rowCount: 1 };
  });
  return queries;
}

test("tile addresses must be whole numbers inside the zoom's grid", () => {
  assert.deepEqual(parseTileAddress("12", "662", "1443.mvt"), { z: 12, x: 662, y: 1443 });
  assert.deepEqual(parseTileAddress("7", "20", "44.mvt"), { z: 7, x: 20, y: 44 });
  assert.deepEqual(parseTileAddress("14", "16383", "16383.mvt"), { z: 14, x: 16383, y: 16383 });
  for (const [z, x, file] of [
    ["15", "0", "0.mvt"], ["12", "4096", "0.mvt"], ["12", "0", "4096.mvt"], ["-1", "0", "0.mvt"],
    ["12", "1.5", "0.mvt"], ["12", "0", "0.pbf"], ["12", "0", "0"], ["12", "0x1", "0.mvt"],
    ["1e1", "0", "0.mvt"], ["", "0", "0.mvt"], ["12", "0", " 1.mvt"],
  ]) assert.equal(parseTileAddress(z, x, file), null, `${z}/${x}/${file}`);
});

test("the query reads stored 3857 shapes and never transforms or simplifies per request", () => {
  const detail = buildAreaTileQuery({ z: 12, x: 662, y: 1443 });
  assert.match(detail.text, /JOIN area_map_shapes s ON s\.shape && tile\.search/);
  assert.match(detail.text, /ST_Collect\(s\.shape\), 3\) AS shape/);
  assert.match(detail.text, /GROUP BY s\.area_id/);
  assert.match(detail.text, /ST_AsMVTGeom\(shapes\.shape, tile\.envelope, 4096, 64, true\)/);
  assert.match(detail.text, /ST_AsMVT\(f, 'areas', 4096, 'geom'\)/);
  assert.doesNotMatch(detail.text, /ST_Transform|ST_Simplify|geography|boundary/);
  assert.deepEqual(detail.values, [12, 662, 1443]);
  const low = buildAreaTileQuery({ z: 10, x: 165, y: 360 });
  assert.match(low.text, /s\.shape_low && tile\.search/);
  assert.match(low.text, /ST_Collect\(s\.shape_low\)/);
  assert.match(buildAreaTileQuery({ z: 11, x: 331, y: 721 }).text, /s\.shape && tile\.search/);
});

test("signed-out tiles are public, typed, and cached for a day", async () => {
  const logs = mock.method(console, "log", () => undefined);
  const queries = mockTiles(Buffer.from([0x1a, 0x02, 0x08, 0x02]));
  const response = await appRequest(app, "GET", rainier, { "X-Forwarded-For": "192.0.2.10" });
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], AREA_TILE_CONTENT_TYPE);
  assert.equal(response.headers["cache-control"], AREA_TILE_CACHE_CONTROL);
  assert.equal(response.headers["content-encoding"], undefined, "small tiles go uncompressed");
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].values, [12, 662, 1443]);
  assert.equal(logs.mock.callCount(), 0, "tiles do not log signed-out catalog events");
  // A bad token cannot block a tile: Mapbox sends none, and the gate never runs.
  assert.equal((await appRequest(app, "GET", rainier, { Authorization: "Bearer invalid" })).status, 200);
});

test("large tiles are gzipped for clients that accept it", async () => {
  mockTiles(Buffer.alloc(4096, 7));
  const plain = await appRequest(app, "GET", rainier);
  assert.equal(plain.headers["content-encoding"], undefined);
  const gzipped = await appRequest(app, "GET", rainier, { "Accept-Encoding": "gzip" });
  assert.equal(gzipped.status, 200);
  assert.equal(gzipped.headers["content-encoding"], "gzip");
  assert.match(String(gzipped.headers.vary), /Accept-Encoding/);
});

test("empty and below-range tiles answer 204, out-of-range ones 400", async () => {
  const queries = mockTiles(Buffer.alloc(0));
  const empty = await appRequest(app, "GET", rainier);
  assert.equal(empty.status, 204);
  assert.equal(empty.headers["cache-control"], AREA_TILE_CACHE_CONTROL);
  assert.equal(queries.length, 1);
  const low = await appRequest(app, "GET", "/api/map/areas/7/20/44.mvt");
  assert.equal(low.status, 204);
  assert.equal(queries.length, 1, "zooms below 8 never reach the database");
  for (const path of ["/api/map/areas/15/0/0.mvt", "/api/map/areas/12/4096/0.mvt", "/api/map/areas/12/x/1.mvt", "/api/map/areas/12/1/1.png"]) {
    assert.equal((await appRequest(app, "GET", path)).status, 400, path);
  }
  assert.equal(queries.length, 1);
});

test("each instance serves repeat and concurrent tile requests from one query", async () => {
  const queries = mockTiles(Buffer.from([0x1a, 0x02]));
  const [first, second] = await Promise.all([appRequest(app, "GET", rainier), appRequest(app, "GET", rainier)]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await appRequest(app, "GET", rainier)).status, 200);
  assert.equal(queries.length, 1);
  assert.equal((await appRequest(app, "GET", "/api/map/areas/12/662/1444.mvt")).status, 200);
  assert.equal(queries.length, 2, "another tile is its own query");
  // An hour later the tile is read again.
  const start = Date.now();
  mock.method(Date, "now", () => start + 61 * 60_000);
  assert.equal((await appRequest(app, "GET", rainier)).status, 200);
  assert.equal(queries.length, 3);
});

test("other methods and paths under /api/map/areas still require auth", async () => {
  const queries = mockTiles(Buffer.from([1]));
  for (const [method, path] of [
    ["POST", rainier], ["PUT", rainier], ["DELETE", rainier],
    ["GET", "/api/map/areas"], ["GET", "/api/map/areas/12/662"], ["GET", "/api/map/areas/12/662/1443.mvt/x"],
  ]) assert.equal((await appRequest(app, method, path)).status, 401, `${method} ${path}`);
  assert.equal(queries.length, 0);
});

test("before the migration, tiles answer 503 without caching", async () => {
  // hasColumn caches its answer for a minute; step past it both ways.
  const start = Date.now();
  mock.method(Date, "now", () => start + 3 * 60 * 60_000);
  const queries = mockTiles(Buffer.from([1]), false);
  const response = await appRequest(app, "GET", rainier);
  assert.equal(response.status, 503);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(queries.length, 0);
});
