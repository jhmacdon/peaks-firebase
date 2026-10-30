import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import db from "../db";
import { buildAreaTileQuery, TileAddress } from "../routes/public-map-tiles";
import { dbSkipReason } from "./helpers/test-db";

after(async () => { await db.end(); });

function tileAt(lng: number, lat: number, z: number): TileAddress {
  const n = 2 ** z;
  const rad = lat * Math.PI / 180;
  return {
    z,
    x: Math.floor((lng + 180) / 360 * n),
    y: Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n),
  };
}

// area_map_shapes is the 3857 copy the tiles read. The area row's own trigger
// writes and reshapes it; the importer needs nothing extra.
test("an area's boundary reaches its map shape and yields non-empty tiles", {
  skip: dbSkipReason ?? undefined,
}, async () => {
  const client = await db.connect();
  const id = `tile-area-${randomUUID()}`;
  const box = (west: number) => `ST_Multi(ST_MakeEnvelope(${west},46.80,${west + 0.1},46.90,4326))`;
  const shape = async () => (await client.query(
    `SELECT ST_SRID(shape) AS srid, ST_IsValid(shape) AS valid, shape_low IS NOT NULL AS has_low,
            round(ST_XMin(ST_Transform(shape, 4326))::numeric, 4)::float8 AS west
       FROM area_map_shapes WHERE area_id=$1`, [id])).rows[0];
  const tile = async (address: TileAddress) => {
    const { text, values } = buildAreaTileQuery(address);
    return (await client.query(text, values)).rows[0].tile as Buffer;
  };
  await client.query("BEGIN");
  try {
    await client.query(`INSERT INTO areas
        (id, name, search_name, kind, source, source_id, source_version, parent_area_id,
         boundary, centroid, bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng)
      VALUES ($1, 'Tile Fixture Wilderness', 'tile fixture wilderness', 'wilderness', 'test', $1, 'test', NULL,
        ${box(-121.80)}, ST_SetSRID(ST_MakePoint(-121.75, 46.85), 4326), 46.80, 46.90, -121.80, -121.70)`, [id]);
    assert.deepEqual(await shape(), { srid: 3857, valid: true, has_low: true, west: -121.8 });

    for (const z of [8, 10, 12, 14]) {
      const bytes = await tile(tileAt(-121.75, 46.85, z));
      assert.ok(bytes.length > 0, `z${z} tile is empty`);
      assert.ok(bytes.includes(Buffer.from("areas")), `z${z} layer name`);
      assert.ok(bytes.includes(Buffer.from(id)), `z${z} feature id property`);
      assert.ok(bytes.includes(Buffer.from("wilderness")), `z${z} kind property`);
    }
    const far = await tile(tileAt(-110, 40, 12));
    assert.ok(!far.includes(Buffer.from(id)), "a distant tile leaves the area out");

    await client.query(`UPDATE areas SET boundary=${box(-121.60)}, bbox_min_lng=-121.60, bbox_max_lng=-121.50 WHERE id=$1`, [id]);
    assert.equal((await shape()).west, -121.6, "a reshaped boundary reshapes the map shape");
    assert.ok(!(await tile(tileAt(-121.75, 46.85, 14))).includes(Buffer.from(id)), "old footprint is gone");

    // Islands far apart are stored as separate pieces, each found by its own tiles.
    const islands = `${id}-islands`;
    await client.query(`INSERT INTO areas
        (id, name, search_name, kind, source, source_id, source_version,
         boundary, centroid, bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng)
      VALUES ($1, 'Tile Fixture Refuge', 'tile fixture refuge', 'wildlife_refuge', 'test', $1, 'test',
        ST_Multi(ST_Union(ST_MakeEnvelope(-134.5,58.2,-134.4,58.3,4326), ST_MakeEnvelope(-131.7,55.3,-131.6,55.4,4326))),
        ST_SetSRID(ST_MakePoint(-133, 56.8), 4326), 55.3, 58.3, -134.5, -131.6)`, [islands]);
    const pieces = (await client.query(
      "SELECT piece, ST_NumGeometries(shape) AS parts FROM area_map_shapes WHERE area_id=$1 ORDER BY piece", [islands])).rows;
    assert.deepEqual(pieces, [{ piece: 1, parts: 1 }, { piece: 2, parts: 1 }]);
    for (const [lng, lat] of [[-134.45, 58.25], [-131.65, 55.35]]) {
      assert.ok((await tile(tileAt(lng, lat, 12))).includes(Buffer.from(islands)), `island at ${lng},${lat}`);
    }

    await client.query("DELETE FROM areas WHERE id=$1", [id]);
    assert.equal(await shape(), undefined, "deleting the area deletes its shape");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
