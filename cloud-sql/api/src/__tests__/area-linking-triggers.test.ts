// src/__tests__/area-linking-triggers.test.ts
//
// Integration tests for the protected-area auto-linking triggers added
// 2026-06-13:
//   - trg_destination_link_areas         (AFTER INSERT ON destinations)
//   - trg_session_destination_link_areas (AFTER INSERT ON session_destinations)
// Both link a SUMMIT to an area when it is ST_Covers-contained OR within 50 m of
// the boundary, and are wrapped so a failure never aborts the insert.
//
// Fully isolated: fixtures use a unique prefix and a remote South-Atlantic
// location (no real Peaks areas or tracking points there), so the triggers
// cannot touch production data. Requires $DATABASE_URL to run; skips otherwise.

import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import db from "../db";

const skipReason = process.env.DATABASE_URL
  ? null
  : "DATABASE_URL not set — skipping integration tests";

const runPrefix = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const areaId = `${runPrefix}-area`;
const insideId = `${runPrefix}-inside`;
const nearId = `${runPrefix}-near`;
const farId = `${runPrefix}-far`;
const sessionId = `${runPrefix}-session`;

// Remote ocean square (~2.2 km), far from any real area or tracking point.
const LAT = -40.0;
const LNG = -30.0;
const HALF = 0.01; // ~1.1 km in lat; lng compressed by cos(40°)≈0.766
const EAST_EDGE = LNG + HALF; // -29.99
// ~20 m east of the edge → within the 50 m tolerance (links)
const NEAR_LNG = EAST_EDGE + 20 / (111320 * Math.cos((LAT * Math.PI) / 180));
// ~400 m east of the edge → outside tolerance (must NOT link)
const FAR_LNG = EAST_EDGE + 400 / (111320 * Math.cos((LAT * Math.PI) / 180));

const SQUARE_WKT =
  `MULTIPOLYGON(((${LNG - HALF} ${LAT - HALF}, ${LNG + HALF} ${LAT - HALF}, ` +
  `${LNG + HALF} ${LAT + HALF}, ${LNG - HALF} ${LAT + HALF}, ${LNG - HALF} ${LAT - HALF})))`;

async function createArea(): Promise<void> {
  await db.query(
    `INSERT INTO areas (
       id, name, search_name, kind, source, source_id, source_version,
       boundary, centroid, bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng
     )
     SELECT $1, 'Test Wilderness', 'test wilderness', 'wilderness', 'test', $1, '0',
            g, ST_Centroid(g),
            ST_YMin(b), ST_YMax(b), ST_XMin(b), ST_XMax(b)
     FROM (SELECT ST_GeomFromText($2, 4326) AS g) s,
          LATERAL (SELECT Box2D(s.g) AS b) bb
     ON CONFLICT (source, source_id) DO NOTHING`,
    [areaId, SQUARE_WKT]
  );
}

async function createSummit(id: string, lng: number, lat: number): Promise<void> {
  await db.query(
    `INSERT INTO destinations (id, name, search_name, location, owner, features)
     VALUES ($1, $1, $1, ST_SetSRID(ST_MakePoint($2, $3, 1000), 4326)::geography, 'peaks', '{summit}')
     ON CONFLICT (id) DO NOTHING`,
    [id, lng, lat]
  );
}

async function areaLinkCount(destId: string): Promise<number> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM destination_areas WHERE destination_id = $1 AND area_id = $2`,
    [destId, areaId]
  );
  return res.rows[0].n;
}

async function cleanup(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM destinations WHERE id LIKE $1`, [`${runPrefix}-%`]); // cascades destination_areas
  await db.query(`DELETE FROM areas WHERE source = 'test' AND source_id LIKE $1`, [`${runPrefix}-%`]);
}

describe("protected-area auto-linking triggers", { skip: skipReason ?? undefined }, () => {
  before(async () => {
    await cleanup();
    await createArea();
  });
  after(cleanup);

  test("new summit inside an area is linked at creation", async () => {
    await createSummit(insideId, LNG, LAT);
    assert.equal(await areaLinkCount(insideId), 1);
  });

  test("new summit within 50 m of the boundary is linked (tolerance)", async () => {
    await createSummit(nearId, NEAR_LNG, LAT);
    assert.equal(await areaLinkCount(nearId), 1);
  });

  test("new summit well outside the boundary is NOT linked", async () => {
    await createSummit(farId, FAR_LNG, LAT);
    assert.equal(await areaLinkCount(farId), 0);
  });

  test("a recording reaching a summit re-links it (session trigger)", async () => {
    // remove the creation-trigger link, then prove the session trigger restores it
    await db.query(`DELETE FROM destination_areas WHERE destination_id = $1`, [insideId]);
    assert.equal(await areaLinkCount(insideId), 0);

    await db.query(
      `INSERT INTO tracking_sessions (id, user_id, start_time, ended, processing_state)
       VALUES ($1, $2, $3, true, 'completed')`,
      [sessionId, `${runPrefix}-user`, "2026-06-07T17:00:00Z"]
    );
    await db.query(
      `INSERT INTO session_destinations (session_id, destination_id, relation, source)
       VALUES ($1, $2, 'reached', 'auto')`,
      [sessionId, insideId]
    );
    assert.equal(await areaLinkCount(insideId), 1);
  });
});
