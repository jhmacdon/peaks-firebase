// src/__tests__/lake-boundary-match.test.ts
//
// Outlined destinations match on destination_boundary_match_radius(): 50 m for
// lakes, 10 m for other outlines. Production, 2026-10-10: a Lake Ingalls hike
// stopped 36-50 m from the mapped shore and did not log the lake.
//
// Checks both match paths: session processing (buildSessionDestinationMatchSql)
// and the destination-insert trigger (link_sessions_on_destination_insert).
//
// Fully isolated: fixtures use a unique prefix and a remote South-Atlantic
// location. Requires $TEST_DATABASE_URL; skips otherwise.

import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import db from "../db";
import {
  buildPlanDestinationMatchSql,
  buildSessionDestinationMatchSql,
  TRACK_PIECE_SEGMENTS,
} from "../processing";

import { dbSkipReason as skipReason } from "./helpers/test-db";

const runPrefix = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const userId = `${runPrefix}-user`;

const LAT = -41.0;
const M_PER_DEG_LNG = 111320 * Math.cos((LAT * Math.PI) / 180);
const HALF = 0.001; // ~110 m square

function squareWkt(lng: number): string {
  return (
    `POLYGON((${lng - HALF} ${LAT - HALF}, ${lng + HALF} ${LAT - HALF}, ` +
    `${lng + HALF} ${LAT + HALF}, ${lng - HALF} ${LAT + HALF}, ${lng - HALF} ${LAT - HALF}))`
  );
}

// A north-south track `metres` east of the square's east edge.
async function createSession(id: string, lng: number, metres: number): Promise<void> {
  const x = lng + HALF + metres / M_PER_DEG_LNG;
  await db.query(
    `INSERT INTO tracking_sessions (id, user_id, start_time, end_time, ended, path)
     VALUES ($1, $2, now() - interval '1 hour', now(), true,
             ST_SetSRID(ST_MakeLine(ST_MakePoint($3, $4, 1000), ST_MakePoint($3, $5, 1000)), 4326)::geography)`,
    [id, userId, x, LAT - HALF, LAT + HALF]
  );
  await db.query(
    `INSERT INTO tracking_points (session_id, time, location, elevation)
     VALUES ($1, 1, ST_SetSRID(ST_MakePoint($2, $3, 1000), 4326)::geography, 1000)`,
    [id, x, LAT]
  );
}

async function createOutlined(id: string, lng: number, features: string): Promise<void> {
  await db.query(
    `INSERT INTO destinations (id, name, search_name, location, boundary, owner, features)
     VALUES ($1, $1, $1, ST_SetSRID(ST_MakePoint($2, $3, 1000), 4326)::geography,
             ST_GeomFromText($4, 4326)::geography, 'peaks', $5::destination_feature[])`,
    [id, lng, LAT, squareWkt(lng), features]
  );
}

async function reached(sessionId: string, destinationId: string): Promise<boolean> {
  const res = await db.query(
    `SELECT 1 FROM session_destinations
     WHERE session_id = $1 AND destination_id = $2 AND relation = 'reached'`,
    [sessionId, destinationId]
  );
  return res.rowCount === 1;
}

async function cleanup(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM plans WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM destinations WHERE id LIKE $1`, [`${runPrefix}-%`]);
}

describe("lake boundary match distance", { skip: skipReason ?? undefined }, () => {
  before(cleanup);
  after(cleanup);

  test("session processing reaches a lake from 36 m but not another outline", async () => {
    const lake = `${runPrefix}-lake`;
    const camp = `${runPrefix}-camp`;
    await createOutlined(lake, -31.0, "{lake}");
    await createOutlined(camp, -31.1, "{campsite}");

    const nearLake = `${runPrefix}-s-lake36`;
    const farLake = `${runPrefix}-s-lake70`;
    const nearCamp = `${runPrefix}-s-camp36`;
    await createSession(nearLake, -31.0, 36);
    await createSession(farLake, -31.0, 70);
    await createSession(nearCamp, -31.1, 36);
    // The insert trigger ran before these sessions existed; clear anything it
    // could not have added so only processing writes the rows checked below.
    await db.query(`DELETE FROM session_destinations WHERE session_id LIKE $1`, [`${runPrefix}-%`]);

    for (const id of [nearLake, farLake, nearCamp]) {
      const { text, values } = buildSessionDestinationMatchSql(id);
      await db.query(text, values);
    }

    assert.equal(await reached(nearLake, lake), true, "36 m from a lake shore reaches it");
    assert.equal(await reached(farLake, lake), false, "70 m from a lake shore does not");
    assert.equal(await reached(nearCamp, camp), false, "other outlines keep 10 m");
  });

  // Matching splits the track into runs of TRACK_PIECE_SEGMENTS segments, each
  // sharing its last point with the next run. Only the segment that crosses
  // from the first run into the second passes the lake: the first run's points
  // lie well north of it and the rest well south, so the line between them
  // runs 36 m east of the shore.
  test("session processing sees the segment where two track pieces meet", async () => {
    const lake = `${runPrefix}-lake-seam`;
    const lng = -31.4;
    await createOutlined(lake, lng, "{lake}");
    const x = lng + HALF + 36 / M_PER_DEG_LNG;
    const points = [
      ...Array.from({ length: TRACK_PIECE_SEGMENTS }, (_, k) => `${x} ${LAT + 0.01 + k * 0.0001} 1000`),
      ...Array.from({ length: TRACK_PIECE_SEGMENTS + 1 }, (_, k) => `${x} ${LAT - 0.01 - k * 0.0001} 1000`),
    ];
    const session = `${runPrefix}-s-seam`;
    await db.query(
      `INSERT INTO tracking_sessions (id, user_id, start_time, end_time, ended, path)
       VALUES ($1, $2, now() - interval '1 hour', now(), true,
               ST_GeomFromText($3, 4326)::geography)`,
      [session, userId, `LINESTRING Z(${points.join(", ")})`]
    );
    const { text, values } = buildSessionDestinationMatchSql(session);
    await db.query(text, values);
    assert.equal(await reached(session, lake), true);
  });

  // A plan path can be a MultiLineString of disjoint routes. Here the lake
  // sits in the gap between them: a piece that joined the end of one route
  // to the start of the next would pass 36 m from it.
  test("plan matching never joins two separate lines", async () => {
    const lake = `${runPrefix}-lake-gap`;
    const lng = -31.5;
    await createOutlined(lake, lng, "{lake}");
    const x = lng + HALF + 36 / M_PER_DEG_LNG;
    const north = Array.from({ length: 40 }, (_, k) => `${x} ${LAT + 0.01 + k * 0.0001}`);
    const south = Array.from({ length: 40 }, (_, k) => `${x} ${LAT - 0.01 - k * 0.0001}`);
    const plan = `${runPrefix}-plan-gap`;
    await db.query(
      `INSERT INTO plans (id, user_id, name, path)
       VALUES ($1, $2, $1, ST_GeomFromText($3, 4326)::geography)`,
      [plan, userId, `MULTILINESTRING((${north.join(", ")}), (${south.join(", ")}))`]
    );
    const { text, values } = buildPlanDestinationMatchSql(plan);
    await db.query(text, values);
    const res = await db.query(
      `SELECT 1 FROM plan_reached_destinations WHERE plan_id = $1 AND destination_id = $2`,
      [plan, lake]
    );
    assert.equal(res.rowCount, 0);
  });

  // A GPS gap leaves one long segment. At 65° N a 100 km east-west segment
  // bows about 450 m north of the straight degree-space line between its ends.
  // This lake sits just south of that line's midpoint, 495 m from the track.
  // Cut points placed on the degree-space line (ST_Subdivide) put it 45 m
  // away and matched it.
  test("a long GPS-gap segment is measured along the geodesic", async () => {
    const lake = `${runPrefix}-lake-gap-geodesic`;
    const midLng = (10.00039 + 12.2) / 2;
    await db.query(
      `INSERT INTO destinations (id, name, search_name, location, boundary, owner, features)
       VALUES ($1, $1, $1, ST_SetSRID(ST_MakePoint($2, 64.9994, 1000), 4326)::geography,
               ST_Buffer(ST_SetSRID(ST_MakePoint($2, 64.9994), 4326), 0.0002)::geography,
               'peaks', '{lake}')`,
      [lake, midLng]
    );
    const dense = Array.from({ length: 40 }, (_, k) => `${10 + k * 0.00001} 65 1000`);
    const session = `${runPrefix}-s-gap`;
    await db.query(
      `INSERT INTO tracking_sessions (id, user_id, start_time, end_time, ended, path)
       VALUES ($1, $2, now() - interval '1 hour', now(), true,
               ST_GeomFromText($3, 4326)::geography)`,
      [session, userId, `LINESTRING Z(${dense.join(", ")}, 12.2 65 1000)`]
    );
    const { text, values } = buildSessionDestinationMatchSql(session);
    await db.query(text, values);
    assert.equal(await reached(session, lake), false);
  });

  test("a newly added lake links past sessions within 50 m", async () => {
    const session = `${runPrefix}-s-before`;
    const lake = `${runPrefix}-lake-new`;
    const camp = `${runPrefix}-camp-new`;
    await createSession(session, -31.2, 36);
    await createOutlined(lake, -31.2, "{lake}");
    assert.equal(await reached(session, lake), true);

    const campSession = `${runPrefix}-s-before-camp`;
    await createSession(campSession, -31.3, 36);
    await createOutlined(camp, -31.3, "{campsite}");
    assert.equal(await reached(campSession, camp), false);
  });
});
