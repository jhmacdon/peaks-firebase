import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import { Pool, type PoolClient } from "pg";

const skipReason = process.env.DATABASE_URL
  ? null
  : "DATABASE_URL not set - skipping PostGIS integration tests";

const runPrefix = `area-link-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const areaId = `${runPrefix}-area`;
const insideId = `${runPrefix}-inside`;
const boundaryId = `${runPrefix}-boundary`;
const trailheadId = `${runPrefix}-trailhead`;

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

let client: PoolClient | null = null;

async function query(sql: string, params?: unknown[]) {
  if (!client) throw new Error("test client is not initialized");
  return client.query(sql, params);
}

describe("link_summit_destinations_to_areas PostGIS containment", { skip: skipReason ?? undefined }, () => {
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
       VALUES (
         $1, 'Fixture National Park', 'fixture national park', 'national_park',
         'National Park', 'National Park Service', 'National Park Service',
         'US', ARRAY['WA'], 'test', $1, 'test',
         ST_GeogFromText('SRID=4326;MULTIPOLYGON(((-122 46,-121 46,-121 47,-122 47,-122 46)))'),
         ST_GeogFromText('SRID=4326;POINT(-121.5 46.5)'),
         46, 47, -122, -121,
         '{}'::jsonb
       )`,
      [areaId]
    );
    await query(
      `INSERT INTO destinations (id, name, search_name, location, owner, features)
       VALUES
         ($1, 'Inside Fixture Summit', 'inside fixture summit', ST_MakePoint(-121.5, 46.5, 100)::geography, 'test', ARRAY['summit']::destination_feature[]),
         ($2, 'Boundary Fixture Summit', 'boundary fixture summit', ST_MakePoint(-122, 46.5, 100)::geography, 'test', ARRAY['summit']::destination_feature[]),
         ($3, 'Inside Fixture Trailhead', 'inside fixture trailhead', ST_MakePoint(-121.5, 46.5, 100)::geography, 'test', ARRAY['trailhead']::destination_feature[])`,
      [insideId, boundaryId, trailheadId]
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

  test("links inside and boundary summit points but ignores non-summits", async () => {
    const linked = await query("SELECT link_summit_destinations_to_areas(false) AS inserted_count");
    assert.equal(Number(linked.rows[0].inserted_count), 2);

    const rows = await query(
      `SELECT destination_id
       FROM destination_areas
       WHERE area_id = $1
       ORDER BY destination_id`,
      [areaId]
    );

    assert.deepEqual(
      rows.rows.map((row) => row.destination_id),
      [boundaryId, insideId].sort()
    );
  });
});
