import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import { Pool, type PoolClient } from "pg";

const skipReason = process.env.DATABASE_URL
  ? null
  : "DATABASE_URL not set - skipping PostGIS integration tests";

const runPrefix = `route-area-link-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const routeId = `${runPrefix}-route`;
const matchedAreaId = `${runPrefix}-matched-area`;
const manualAreaId = `${runPrefix}-manual-area`;

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

let client: PoolClient | null = null;

async function query(sql: string, params?: unknown[]) {
  if (!client) throw new Error("test client is not initialized");
  return client.query(sql, params);
}

describe("route area write invariant", { skip: skipReason ?? undefined }, () => {
  before(async () => {
    if (!pool) return;
    client = await pool.connect();
    await query("BEGIN");
    await query(
      `INSERT INTO areas (
         id, name, search_name, kind, designation, manager, owner,
         country_code, state_codes, source, source_id, source_version,
         boundary, centroid, bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng,
         metadata
       )
       VALUES
         (
           $1, 'Matched Fixture Park', 'matched fixture park', 'national_park',
           'National Park', 'Fixture Manager', 'Fixture Manager',
           'US', ARRAY['WA'], 'test', $1, 'test',
           ST_GeomFromText('SRID=4326;MULTIPOLYGON(((-122 46,-121 46,-121 47,-122 47,-122 46)))'),
           ST_GeomFromText('SRID=4326;POINT(-121.5 46.5)'),
           46, 47, -122, -121, '{}'::jsonb
         ),
         (
           $2, 'Manual Fixture Area', 'manual fixture area', 'wilderness',
           'Wilderness', 'Fixture Manager', 'Fixture Manager',
           'US', ARRAY['WA'], 'test', $2, 'test',
           ST_GeomFromText('SRID=4326;MULTIPOLYGON(((-120 46,-119 46,-119 47,-120 47,-120 46)))'),
           ST_GeomFromText('SRID=4326;POINT(-119.5 46.5)'),
           46, 47, -120, -119, '{}'::jsonb
         )`,
      [matchedAreaId, manualAreaId]
    );
  });

  after(async () => {
    if (client) {
      await client.query("ROLLBACK");
      client.release();
      client = null;
    }
    await pool?.end();
  });

  test("inserts, refreshes, and removes generated links while keeping manual links", async () => {
    await query(
      `INSERT INTO routes (id, name, path)
       VALUES (
         $1,
         'Fixture Route',
         ST_GeogFromText('SRID=4326;LINESTRING Z (-121.8 46.2 100,-121.2 46.8 200)')
       )`,
      [routeId]
    );

    const inserted = await query(
      `SELECT area_id, relation, source
       FROM route_areas
       WHERE route_id = $1`,
      [routeId]
    );
    assert.deepEqual(inserted.rows, [
      { area_id: matchedAreaId, relation: "contained_by", source: "postgis" },
    ]);

    await query(
      `INSERT INTO route_areas (route_id, area_id, relation, source)
       VALUES ($1, $2, 'intersects', 'manual')`,
      [routeId, manualAreaId]
    );

    await query(
      `UPDATE routes
       SET path = ST_GeogFromText('SRID=4326;LINESTRING Z (-122.2 46.5 100,-121.5 46.5 200)')
       WHERE id = $1`,
      [routeId]
    );

    const refreshed = await query(
      `SELECT area_id, relation, source
       FROM route_areas
       WHERE route_id = $1
       ORDER BY area_id`,
      [routeId]
    );
    assert.deepEqual(refreshed.rows, [
      { area_id: manualAreaId, relation: "intersects", source: "manual" },
      { area_id: matchedAreaId, relation: "intersects", source: "postgis" },
    ].sort((a, b) => a.area_id.localeCompare(b.area_id)));

    await query(
      `UPDATE routes
       SET path = ST_GeogFromText('SRID=4326;LINESTRING Z (-118.8 45.2 100,-118.2 45.8 200)')
       WHERE id = $1`,
      [routeId]
    );

    const movedOutside = await query(
      `SELECT area_id, relation, source
       FROM route_areas
       WHERE route_id = $1`,
      [routeId]
    );
    assert.deepEqual(movedOutside.rows, [
      { area_id: manualAreaId, relation: "intersects", source: "manual" },
    ]);
  });
});
