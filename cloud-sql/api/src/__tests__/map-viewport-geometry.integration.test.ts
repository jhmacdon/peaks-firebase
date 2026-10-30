import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import db from "../db";
import { buildMapTrailsQuery, parseMapViewport } from "../routes/map";
import { dbSkipReason } from "./helpers/test-db";

after(async () => { await db.end(); });

// route_map_paths is the simplified copy the map reads. The route row's own
// trigger adds, reshapes and removes it; nothing else writes it.
test("route_map_paths follows route activation, reshape and retirement", {
  skip: dbSkipReason ?? undefined,
}, async () => {
  const client = await db.connect();
  const id = `map-path-${randomUUID()}`;
  const line = (lng: number) => `SRID=4326;LINESTRING Z(${lng} 46.80 1000, ${lng} 46.85 1100, ${lng} 46.90 1200)`;
  const stored = async () => (await client.query(
    "SELECT ST_AsText(path) AS path FROM route_map_paths WHERE route_id=$1", [id])).rows[0]?.path;
  const view = parseMapViewport({ minLat: "46.84", maxLat: "46.86", minLng: "-121.80", maxLng: "-121.70", zoom: "12" })!;
  await client.query("BEGIN");
  try {
    await client.query(`INSERT INTO routes(id,name,owner,status,path) VALUES($1,'Fixture Trail','peaks','pending',$2::geography)`, [id, line(-121.75)]);
    assert.equal(await stored(), undefined, "pending routes stay off the map");

    await client.query("UPDATE routes SET status='active' WHERE id=$1", [id]);
    assert.equal(await stored(), "MULTILINESTRING((-121.75 46.8,-121.75 46.9))", "2D and simplified");

    const { text, values } = buildMapTrailsQuery(view);
    const rows = (await client.query(text, values)).rows.filter((row) => row.id === id);
    assert.deepEqual(rows[0]?.geometry, { type: "MultiLineString", coordinates: [[[-121.75, 46.84], [-121.75, 46.86]]] }, "clipped to the view");

    await client.query("UPDATE routes SET path=$2::geography WHERE id=$1", [id, line(-121.74)]);
    assert.equal(await stored(), "MULTILINESTRING((-121.74 46.8,-121.74 46.9))");

    await client.query("UPDATE routes SET status='superseded' WHERE id=$1", [id]);
    assert.equal(await stored(), undefined, "retired routes leave the map");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
