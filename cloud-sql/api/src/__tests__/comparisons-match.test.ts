// Integration tests for matchComparisons against a real PostGIS database.
// Requires DATABASE_URL (see session-groups.test.ts for the convention).
import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import db from "../db";
import { matchComparisons } from "../comparisons";
import * as P from "../comparison-params";

const skipReason = process.env.DATABASE_URL
  ? null
  : "DATABASE_URL not set — skipping integration tests";

const runPrefix = `cmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const user = `${runPrefix}-user`;
const DEG_25M = 25 / 111320;

/** Insert a session + points walking a straight/out-and-back line, then
 *  materialize its path the same way processSession Step 0 does. */
async function insertTrack(
  id: string,
  startISO: string,
  coords: Array<{ lat: number; lng: number }>,
  stepMs = 30_000
): Promise<void> {
  const startMs = new Date(startISO).getTime();
  await db.query(
    `INSERT INTO tracking_sessions (id, user_id, start_time, ended, distance)
     VALUES ($1, $2, $3, true, $4)`,
    [id, user, startISO, coords.length * 25]
  );
  const values: string[] = [];
  const params: unknown[] = [];
  coords.forEach((c, i) => {
    const base = params.length;
    values.push(
      `($${base + 1}, $${base + 2}, ST_GeomFromText($${base + 3}, 4326)::geography, $${base + 4}, 1.0)`
    );
    params.push(id, startMs + i * stepMs, `POINT Z(${c.lng} ${c.lat} 1000)`, 1000);
  });
  await db.query(
    `INSERT INTO tracking_points (session_id, time, location, elevation, speed)
     VALUES ${values.join(", ")}`,
    params
  );
  await db.query(
    `UPDATE tracking_sessions s SET path = (
       SELECT ST_MakeLine(tp.location::geometry ORDER BY tp.time)::geography
       FROM tracking_points tp WHERE tp.session_id = s.id
     ) WHERE s.id = $1`,
    [id]
  );
}

function line(n: number): Array<{ lat: number; lng: number }> {
  return Array.from({ length: n }, (_, i) => ({ lat: 45, lng: i * DEG_25M / Math.cos(45 * Math.PI / 180) }));
}

function outAndBack(n: number): Array<{ lat: number; lng: number }> {
  const out = line(n);
  return [...out, ...out.slice(0, -1).reverse()];
}

async function cleanup(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
}

describe("matchComparisons", { skip: skipReason ?? undefined }, () => {
  before(cleanup);
  after(cleanup);

  test("writes a canonical pair (earlier session as session_a) for a repeat", async () => {
    const s1 = `${runPrefix}-r1`;
    const s2 = `${runPrefix}-r2`;
    await insertTrack(s1, "2026-05-01T08:00:00Z", outAndBack(120));
    await insertTrack(s2, "2026-06-01T08:00:00Z", outAndBack(120));

    const written = await matchComparisons(db, s2, user);
    assert.ok(written >= 1, `wrote ${written}`);

    const { rows } = await db.query(
      `SELECT * FROM session_comparisons WHERE session_a = $1 AND session_b = $2`,
      [s1, s2]
    );
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.equal(r.scope, "full");
    assert.equal(r.a_out_and_back, true);
    assert.equal(r.matcher_version, P.MATCHER_VERSION);
    assert.ok(r.overlap_m >= P.MIN_OVERLAP_M, `overlap=${r.overlap_m}`);
    // full o&b vs o&b: elapsed ≈ whole recording (239 pts * 30s ≈ 7170s)
    assert.ok(Math.abs(r.a_elapsed_s - 7170) < 900, `a_elapsed=${r.a_elapsed_s}`);
    // BIGINT ms columns must come back as Numbers (wire-type policy)
    assert.equal(typeof r.a_enter_ms, "number");
  });

  test("does not pair disjoint or reversed tracks", async () => {
    const far = `${runPrefix}-far`;
    const rev = `${runPrefix}-rev`;
    await insertTrack(far, "2026-05-02T08:00:00Z",
      line(120).map((c) => ({ ...c, lat: c.lat + 1 })));
    await insertTrack(rev, "2026-06-02T08:00:00Z", line(120).slice().reverse());

    const s2 = `${runPrefix}-r2`; // from previous test
    await matchComparisons(db, far, user);
    await matchComparisons(db, rev, user);
    const { rows } = await db.query(
      `SELECT * FROM session_comparisons
       WHERE session_a IN ($1, $2) OR session_b IN ($1, $2)`,
      [far, rev]
    );
    assert.equal(rows.length, 0, `unexpected pairs: ${JSON.stringify(rows)}`);
    void s2;
  });

  test("skipExisting short-circuits an already-current pair", async () => {
    const s2 = `${runPrefix}-r2`;
    const again = await matchComparisons(db, s2, user, { skipExisting: true });
    assert.equal(again, 0);
  });
});
