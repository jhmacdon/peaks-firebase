// src/__tests__/destination-averages-recompute.test.ts
//
// destinations.averages used to be blind-incremented on every process, so
// re-processing a session double-counted it and a removed session_destinations
// row could never decrement it. It is now recomputed from
// session_destinations ⋈ tracking_sessions, which makes processing idempotent
// and makes rejection decrement for free.
//
// averages_offset (pre-migration Firestore history) is a separate column merged
// at read time and must never be written here.
//
// ---------------------------------------------------------------------------
// Why these integration tests run inside a rollback harness
// ---------------------------------------------------------------------------
// Every path under test reads session_destination_rejections — processSession's
// matcher anti-joins it (B2) and the destinations endpoint writes it (B3) — but
// the production DDL that creates that table is B5 and is gated on the user, so
// against the live database these tests would fail on `relation ... does not
// exist` and prove nothing.
//
// So the whole block runs on ONE borrowed connection with:
//   - a TEMP session_destination_rejections, created only when the permanent
//     table is absent. It is session-local (pg_temp precedes public on the
//     search path) and vanishes with the connection, so nothing is written to
//     the shared catalog and no production DDL runs;
//   - an outer transaction that is ALWAYS rolled back, so not one fixture row
//     is ever committed — safer than the suite's usual insert-then-delete; and
//   - the pool rebound to a savepoint-translating client, so the route handler's
//     own BEGIN/COMMIT/ROLLBACK nest as savepoints inside that transaction
//     instead of ending it. This is B3's route-level harness with the savepoint
//     translation added.
//
// When B5 lands, the temp table stops being created and the same tests run
// against the real one, unchanged.
//
// The one thing this shape cannot stage is the lost-update race the row lock
// exists to prevent: that needs two transactions that can both see each other's
// COMMITs, and everything here lives on one connection inside one transaction
// that is never committed. Making it stageable would mean committing fixtures to
// the shared database. So the lock is covered two other ways — a pure assertion
// on DESTINATION_AVERAGES_LOCK_SQL, and an integration test that the recompute
// issues it before the counting UPDATE.

import { strict as assert } from "node:assert";
import { test, describe, before, after, mock } from "node:test";
import type { PoolClient } from "pg";
import request from "supertest";
import { app } from "../index";
import db from "../db";
import {
  buildDestinationAveragesRecomputeSql,
  DESTINATION_AVERAGES_LOCK_SQL,
  processSession,
} from "../processing";

// Pure shape assertions — no DB needed, so these run in CI.
describe("buildDestinationAveragesRecomputeSql", () => {
  test("rebuilds both buckets from live rows", () => {
    const { text } = buildDestinationAveragesRecomputeSql();
    assert.match(text, /FROM session_destinations sd/);
    assert.match(text, /JOIN tracking_sessions ts ON ts\.id = sd\.session_id/);
    assert.match(text, /sd\.relation = 'reached'/);
    assert.match(text, /'months'/);
    assert.match(text, /'days'/);
    assert.doesNotMatch(text, /\+ 1/, "must be a recompute, never a blind increment");
    assert.doesNotMatch(text, /averages_offset/, "offsets are read-time only — never rewritten");
  });

  // A goal row says "I meant to climb this", not "I climbed it". B3 deliberately
  // spares the goal row when a reach is rejected, so a recompute that counted
  // goals would put the retracted ascent straight back into the histogram.
  test("counts reached rows only, never goals", () => {
    const { text } = buildDestinationAveragesRecomputeSql();
    assert.doesNotMatch(text, /'goal'/, "a goal is an intention, not an ascent");
    const relationPredicates = text.match(/sd\.relation = '[a-z]+'/g) ?? [];
    assert.deepEqual(
      [...new Set(relationPredicates)],
      ["sd.relation = 'reached'"],
      "one relation filter, and it is 'reached'"
    );
  });

  // The stored buckets and GET /api/destinations/averages must never disagree
  // about which bucket a session falls in, so both derive them in SQL from
  // start_time rather than in JS from the server's local clock.
  test("derives the buckets in SQL from start_time", () => {
    const { text } = buildDestinationAveragesRecomputeSql();
    assert.match(text, /EXTRACT\(MONTH FROM start_time\)/);
    assert.match(text, /EXTRACT\(ISODOW FROM start_time\)/);
  });

  // The day array and the EXTRACT that indexes it only agree by construction:
  // ISODOW is 1-based Monday-first, so the array must be too. Swapping in DOW
  // (0-based, Sunday-first) or reordering the array would file every session
  // one day out, silently, and no pure test that looked at them separately
  // would notice. Pinned together, and CI can run it without a database.
  test("the day array is Monday-first because ISODOW is", () => {
    const { text } = buildDestinationAveragesRecomputeSql();
    assert.match(
      text,
      /\(ARRAY\['mo','tu','we','th','fr','sa','su'\]\)\[EXTRACT\(ISODOW FROM start_time\)::int\]/,
      "Monday-first array indexed by ISODOW — change one and you must change the other"
    );
    assert.match(
      text,
      /\(ARRAY\['jan','feb','mar','apr','may','jun',\s*'jul','aug','sep','oct','nov','dec'\]\)\[EXTRACT\(MONTH FROM start_time\)::int\]/,
      "January-first array indexed by MONTH, which is already 1-based"
    );
  });

  // recency answers to the rows, not to the clock. Stamping now() would let the
  // write that REMOVES an ascent advertise the destination as freshly visited.
  test("recency is taken from the data, never from now()", () => {
    const { text } = buildDestinationAveragesRecomputeSql();
    assert.match(text, /recency = totals\.last_at/);
    assert.match(text, /MAX\(start_time\) AS last_at/);
    assert.doesNotMatch(text, /recency = now\(\)/i);
    assert.doesNotMatch(text, /now\(\)/i, "nothing here should read the clock at all");
  });
});

// The recompute reads its counts in a CTE and writes them to a row it does not
// hold yet — a lost update waiting to happen under READ COMMITTED. The lock is
// the whole fix, so its shape is pinned where CI can see it.
describe("DESTINATION_AVERAGES_LOCK_SQL", () => {
  test("locks the destination rows in a deterministic order", () => {
    assert.match(DESTINATION_AVERAGES_LOCK_SQL, /FROM destinations/);
    assert.match(DESTINATION_AVERAGES_LOCK_SQL, /FOR NO KEY UPDATE/);
    assert.match(
      DESTINATION_AVERAGES_LOCK_SQL,
      /ORDER BY id\s+FOR NO KEY UPDATE/,
      "ordered, so two concurrent multi-destination recomputes cannot deadlock"
    );
    assert.doesNotMatch(
      DESTINATION_AVERAGES_LOCK_SQL,
      /FOR UPDATE(?! )/,
      "FOR NO KEY UPDATE — a plain FOR UPDATE blocks the FKs that reference destinations(id)"
    );
  });
});

const skipReason = process.env.DATABASE_URL
  ? null
  : "DATABASE_URL not set — skipping integration tests";

const runPrefix = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const user = `${runPrefix}-user`;
// Empty South Atlantic, a degree off the other suites' fixtures. A summit's
// match radius is 30 m, so these destinations match the fixture tracks and
// nothing else.
const LAT = -48.0;
const LNG = -18.0;
const BASE_TIME = 1_600_000_000;
// 2026-07-06 is a Monday → months.jul and days.mo.
const START = "2026-07-06T17:00:00Z";

type Place = { lng: number; lat: number };
let placeCount = 0;

/**
 * A patch of ocean no other test in this file uses — ~37 km from its
 * neighbours, against a 30 m match radius.
 *
 * Counts, unlike the membership assertions the other suites make, are only
 * meaningful if a test's summit is reached by that test's sessions and no
 * others. Stacking every fixture on one coordinate would have each new session
 * link to every earlier summit (and the destination-insert trigger link each
 * new summit back to every earlier session), so the expected count would depend
 * on execution order.
 */
function newPlace(): Place {
  const place = { lng: LNG + placeCount * 0.5, lat: LAT };
  placeCount += 1;
  return place;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** The one real connection every query in this block runs on. */
let harness: PoolClient;

/** True when this run created the temp stand-in, so teardown knows to drop it. */
let createdTempRejections = false;

/** Every statement the harness has seen, for order-of-operations assertions. */
const statementLog: string[] = [];

/**
 * Wraps the harness connection so a caller's transaction verbs nest instead of
 * ending the outer transaction: BEGIN → SAVEPOINT, COMMIT → RELEASE,
 * ROLLBACK → ROLLBACK TO. Everything else passes straight through. release()
 * is a no-op because the connection outlives every caller here.
 */
function makeSavepointClient(client: PoolClient) {
  let depth = 0;
  return {
    async query(text: unknown, params?: unknown) {
      if (typeof text === "string") {
        statementLog.push(text);
        const verb = text.trim().toUpperCase();
        if (verb === "BEGIN") {
          depth += 1;
          return client.query(`SAVEPOINT harness_sp_${depth}`);
        }
        if (verb === "COMMIT") {
          const res = await client.query(`RELEASE SAVEPOINT harness_sp_${depth}`);
          depth -= 1;
          return res;
        }
        if (verb === "ROLLBACK") {
          const res = await client.query(`ROLLBACK TO SAVEPOINT harness_sp_${depth}`);
          await client.query(`RELEASE SAVEPOINT harness_sp_${depth}`);
          depth -= 1;
          return res;
        }
      }
      return client.query(text as string, params as unknown[]);
    },
    release() {
      /* the harness owns this connection */
    },
  };
}

/** Stands in for the pool: same connection for db.query and db.connect(). */
let pool: { query: (t: unknown, p?: unknown) => Promise<any>; connect: () => Promise<any> };

/** Fixture setup and assertions go through the harness connection too. */
function query(text: string, params?: unknown[]): Promise<any> {
  return harness.query(text, params as unknown[]);
}

async function setUpHarness(): Promise<void> {
  harness = await db.connect();

  const permanent = await harness.query(
    `SELECT to_regclass('public.session_destination_rejections') IS NOT NULL AS present`
  );
  if (!permanent.rows[0].present) {
    // Session-local stand-in for the B5 table. No FKs: a temp table may not
    // reference permanent ones, and no test here depends on the cascade.
    await harness.query(
      `CREATE TEMP TABLE session_destination_rejections (
         session_id      TEXT NOT NULL,
         destination_id  TEXT NOT NULL,
         rejected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
         PRIMARY KEY (session_id, destination_id)
       )`
    );
    createdTempRejections = true;
  }

  await harness.query("BEGIN");
  // The pool caps both at 30 s; processSession plus a supertest round trip can
  // idle longer than that inside one transaction. SET LOCAL dies with the
  // transaction, so the connection returns to the pool unchanged.
  await harness.query(`SET LOCAL idle_in_transaction_session_timeout = 0`);
  await harness.query(`SET LOCAL statement_timeout = 120000`);

  const savepointClient = makeSavepointClient(harness);
  pool = {
    query: (t: unknown, p?: unknown) => savepointClient.query(t, p),
    connect: async () => savepointClient,
  };
  // The route handlers reach for the module-level pool; processSession takes an
  // explicit one.
  mock.method(db, "query", pool.query);
  mock.method(db, "connect", pool.connect);
}

async function tearDownHarness(): Promise<void> {
  mock.restoreAll();
  await harness.query("ROLLBACK");
  // The temp table was created before the transaction, so the ROLLBACK does not
  // take it with it. Drop it explicitly rather than trusting that the pooled
  // connection is about to be closed — a recycled one carrying a stray
  // session_destination_rejections would shadow the real table for whatever ran
  // next once B5 lands.
  if (createdTempRejections) {
    await harness.query(`DROP TABLE IF EXISTS pg_temp.session_destination_rejections`);
  }
  harness.release();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createSessionWithTrack(id: string, at: Place): Promise<void> {
  await query(
    `INSERT INTO tracking_sessions (id, user_id, start_time, ended, processing_state)
     VALUES ($1, $2, $3, true, 'pending')`,
    [id, user, START]
  );
  for (let i = 0; i < 3; i++) {
    await query(
      `INSERT INTO tracking_points (session_id, time, segment_number, location, elevation)
       VALUES ($1, $2, 0, ST_SetSRID(ST_MakePoint($3, $4, 100), 4326)::geography, 100)`,
      [id, BASE_TIME + i * 60, at.lng + i * 0.00005, at.lat]
    );
  }
  await query(
    `UPDATE tracking_sessions s
     SET path = (SELECT ST_MakeLine(tp.location::geometry ORDER BY tp.time)::geography
                 FROM tracking_points tp WHERE tp.session_id = s.id)
     WHERE s.id = $1`,
    [id]
  );
}

async function createSummit(id: string, at: Place, averages?: string): Promise<void> {
  await query(
    `INSERT INTO destinations (id, name, search_name, location, owner, features, averages)
     VALUES ($1, $1, $1, ST_SetSRID(ST_MakePoint($2, $3, 100), 4326)::geography, 'peaks',
             '{summit}', $4::jsonb)`,
    [id, at.lng, at.lat, averages ?? null]
  );
}

async function averages(
  destId: string
): Promise<{ months: Record<string, number>; days: Record<string, number> }> {
  const res = await query(`SELECT averages FROM destinations WHERE id = $1`, [destId]);
  const a = res.rows[0].averages || {};
  return { months: a.months || {}, days: a.days || {} };
}

async function reachedIds(sessionId: string): Promise<string[]> {
  const res = await query(
    `SELECT destination_id FROM session_destinations
     WHERE session_id = $1 AND relation = 'reached' ORDER BY destination_id`,
    [sessionId]
  );
  return res.rows.map((r: { destination_id: string }) => r.destination_id);
}

function run(sessionId: string) {
  return processSession(sessionId, user, { force: true, pool: pool as never });
}

describe("destination averages recompute", { skip: skipReason ?? undefined }, () => {
  before(setUpHarness);
  after(tearDownHarness);

  test("processing the same session twice does not double-count", async () => {
    const at = newPlace();
    const sid = `${runPrefix}-s1`;
    const dest = `${runPrefix}-dest1`;
    await createSessionWithTrack(sid, at);
    await createSummit(dest, at);

    await run(sid);
    const first = await averages(dest);
    assert.equal(first.months.jul, 1);
    assert.equal(first.days.mo, 1);

    await run(sid);
    const second = await averages(dest);
    assert.deepEqual(second, first, "re-processing must be idempotent");

    await run(sid);
    assert.deepEqual(await averages(dest), first, "and stays idempotent on the third run");
  });

  // Two different sessions on the same summit DO both count — the recompute
  // must not collapse a real second ascent into the first.
  test("a second session on the same summit counts twice", async () => {
    const at = newPlace();
    const dest = `${runPrefix}-dest2`;
    await createSummit(dest, at);
    const a = `${runPrefix}-s2a`;
    const b = `${runPrefix}-s2b`;
    await createSessionWithTrack(a, at);
    await createSessionWithTrack(b, at);

    await run(a);
    assert.equal((await averages(dest)).months.jul, 1);

    await run(b);
    const both = await averages(dest);
    assert.equal(both.months.jul, 2, "two sessions, two ascents");
    assert.equal(both.days.mo, 2);
  });

  test("rejecting a destination decrements its buckets immediately", async () => {
    const at = newPlace();
    const sid = `${runPrefix}-s3`;
    const dest = `${runPrefix}-dest3`;
    await createSessionWithTrack(sid, at);
    await createSummit(dest, at);
    await run(sid);
    assert.equal((await averages(dest)).months.jul, 1);

    await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ rejected: [dest] })
      .expect(200);

    const after = await averages(dest);
    assert.equal(
      after.months.jul ?? 0,
      0,
      "the rejected destination's month bucket must drop — processSession never sees it again"
    );
    assert.equal(after.days.mo ?? 0, 0);
  });

  // The veto outlives re-processing (B2), so the bucket must stay at zero
  // rather than creeping back on the next run.
  test("a rejected destination stays out of the buckets across a re-process", async () => {
    const at = newPlace();
    const sid = `${runPrefix}-s4`;
    const dest = `${runPrefix}-dest4`;
    await createSessionWithTrack(sid, at);
    await createSummit(dest, at);
    await run(sid);

    await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ rejected: [dest] })
      .expect(200);

    await run(sid);

    assert.deepEqual(await reachedIds(sid), [], "precondition: the veto held");
    assert.equal((await averages(dest)).months.jul ?? 0, 0);
  });

  // Un-rejecting alone restores no reached row, so it must not restore a count
  // either — the recompute answers to the live rows and nothing else.
  test("un-rejecting alone does not put the count back", async () => {
    const at = newPlace();
    const sid = `${runPrefix}-s5`;
    const dest = `${runPrefix}-dest5`;
    await createSessionWithTrack(sid, at);
    await createSummit(dest, at);
    await run(sid);

    await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ rejected: [dest] })
      .expect(200);
    assert.equal((await averages(dest)).months.jul ?? 0, 0);

    await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ unreject: [dest] })
      .expect(200);

    assert.equal(
      (await averages(dest)).months.jul ?? 0,
      0,
      "the veto is gone but no reach came back, so neither does the count"
    );

    // Re-processing is what re-links the pair, and it recomputes as it goes.
    await run(sid);
    assert.deepEqual(await reachedIds(sid), [dest]);
    assert.equal((await averages(dest)).months.jul, 1, "the re-linked ascent counts once");
  });

  // A manual reach the client posts alongside the un-reject lands in the same
  // request, so the handler must recompute it there and then.
  test("un-rejecting and re-claiming in one request restores the count", async () => {
    const at = newPlace();
    const sid = `${runPrefix}-s6`;
    const dest = `${runPrefix}-dest6`;
    await createSessionWithTrack(sid, at);
    await createSummit(dest, at);
    await run(sid);

    await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ rejected: [dest] })
      .expect(200);
    assert.equal((await averages(dest)).months.jul ?? 0, 0);

    await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ unreject: [dest], reached: [dest] })
      .expect(200);

    assert.deepEqual(await reachedIds(sid), [dest], "precondition: the manual reach landed");
    assert.equal((await averages(dest)).months.jul, 1);
    assert.equal((await averages(dest)).days.mo, 1);
  });

  test("averages_offset is left alone", async () => {
    const at = newPlace();
    const sid = `${runPrefix}-s7`;
    const dest = `${runPrefix}-dest7`;
    await createSessionWithTrack(sid, at);
    await createSummit(dest, at);
    await query(
      `UPDATE destinations SET averages_offset = '{"months":{"jul":7},"days":{"mo":7}}'::jsonb
       WHERE id = $1`,
      [dest]
    );

    await run(sid);

    const res = await query(`SELECT averages_offset FROM destinations WHERE id = $1`, [dest]);
    assert.equal(res.rows[0].averages_offset.months.jul, 7);
    assert.equal((await averages(dest)).months.jul, 1, "live buckets count live rows only");
  });

  // Only `months` and `days` are the recompute's to own. A migrated
  // `lastUpdated` (or anything else Firestore left behind) must survive.
  test("unrelated keys already on averages survive the rebuild", async () => {
    const at = newPlace();
    const sid = `${runPrefix}-s8`;
    const dest = `${runPrefix}-dest8`;
    await createSessionWithTrack(sid, at);
    await createSummit(dest, at, '{"months":{"jan":99},"days":{"fr":99},"lastUpdated":"2020-01-01"}');

    await run(sid);

    const res = await query(`SELECT averages FROM destinations WHERE id = $1`, [dest]);
    assert.equal(res.rows[0].averages.lastUpdated, "2020-01-01", "foreign keys are preserved");
    assert.equal(res.rows[0].averages.months.jan, undefined, "stale buckets are replaced, not merged");
    assert.equal(res.rows[0].averages.months.jul, 1);
    assert.equal(res.rows[0].averages.days.mo, 1);
  });

  // The pre-B4 blind increment left double-counted buckets in production. The
  // first recompute of a destination has to correct them, not add to them.
  test("buckets inflated by the old blind increment are corrected", async () => {
    const at = newPlace();
    const sid = `${runPrefix}-s9`;
    const dest = `${runPrefix}-dest9`;
    await createSessionWithTrack(sid, at);
    await createSummit(dest, at, '{"months":{"jul":8},"days":{"mo":8}}');

    await run(sid);

    const a = await averages(dest);
    assert.equal(a.months.jul, 1, "the recompute answers to the live rows, not the old total");
    assert.equal(a.days.mo, 1);
  });

  // A goal row is not an ascent. B3 leaves it standing when a reach is
  // rejected, so counting goals would silently undo the rejection.
  test("a goal row is never counted", async () => {
    const at = newPlace();
    const sid = `${runPrefix}-s10`;
    const dest = `${runPrefix}-dest10`;
    await createSessionWithTrack(sid, at);
    await createSummit(dest, at);

    await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ goals: [dest], rejected: [dest] })
      .expect(200);

    const res = await query(
      `SELECT relation FROM session_destinations WHERE session_id = $1 AND destination_id = $2`,
      [sid, dest]
    );
    assert.deepEqual(
      res.rows.map((r: { relation: string }) => r.relation),
      ["goal"],
      "precondition: the goal stands and the reach is gone"
    );
    assert.equal((await averages(dest)).months.jul ?? 0, 0, "a goal is not an ascent");
  });

  // Rejection is not the only way a reached row disappears: reconcile replaces
  // the session's manual set wholesale, so dropping an id from `reached` deletes
  // its row too. That id is named by no list in the request that removes it, so
  // the handler has to recompute what the session reached BEFORE the write, not
  // just what the request mentions.
  test("dropping a destination from the reached list decrements its buckets", async () => {
    const at = newPlace();
    const sid = `${runPrefix}-s12`;
    const claimed = `${runPrefix}-dest12`;
    await createSessionWithTrack(sid, at);
    // Off the track, so only a manual row can ever link it.
    await createSummit(claimed, newPlace());

    await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ reached: [claimed] })
      .expect(200);
    assert.equal((await averages(claimed)).months.jul, 1, "precondition: the claim counted");

    await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ reached: [] })
      .expect(200);

    assert.deepEqual(await reachedIds(sid), [], "precondition: reconcile removed the row");
    assert.equal(
      (await averages(claimed)).months.jul ?? 0,
      0,
      "a retracted claim must drop out of the histogram like a rejection does"
    );
  });

  // PUT /api/sessions/:id is the client's ordinary manual edit, and it runs
  // reconcile too. It is the likeliest of all these paths to hit an already-
  // completed session, where auto-processing (which only fires on the
  // not-ended → ended transition) will never run again to clean up after it.
  test("PUT with a shorter reached list decrements the dropped destination", async () => {
    const at = newPlace();
    const sid = `${runPrefix}-s13`;
    const kept = `${runPrefix}-dest13-kept`;
    const dropped = `${runPrefix}-dest13-dropped`;
    await createSessionWithTrack(sid, at);
    // Both off the track, so only the client's list can link them.
    await createSummit(kept, newPlace());
    await createSummit(dropped, newPlace());

    await request(app)
      .put(`/api/sessions/${sid}`)
      .set("X-Test-User", user)
      .send({ destinations_reached: [kept, dropped] })
      .expect(200);
    assert.equal((await averages(kept)).months.jul, 1, "precondition: both counted");
    assert.equal((await averages(dropped)).months.jul, 1);

    await request(app)
      .put(`/api/sessions/${sid}`)
      .set("X-Test-User", user)
      .send({ destinations_reached: [kept] })
      .expect(200);

    assert.equal((await averages(kept)).months.jul, 1, "the surviving claim still counts once");
    assert.equal(
      (await averages(dropped)).months.jul ?? 0,
      0,
      "the dropped claim loses its row, so it must lose its count"
    );
  });

  // Deleting a session cascades its session_destinations rows away. That is the
  // most complete way a reached row can vanish, and after the DELETE nothing
  // remains to say which destinations to recompute.
  test("deleting a session removes its ascents from the buckets", async () => {
    const at = newPlace();
    const sid = `${runPrefix}-s14`;
    const dest = `${runPrefix}-dest14`;
    await createSessionWithTrack(sid, at);
    await createSummit(dest, at);
    await run(sid);
    assert.equal((await averages(dest)).months.jul, 1, "precondition: the ascent counted");

    await request(app)
      .delete(`/api/sessions/${sid}`)
      .set("X-Test-User", user)
      .expect(200);

    assert.equal(
      (await averages(dest)).months.jul ?? 0,
      0,
      "a deleted session takes its ascents out of the histogram with it"
    );
  });

  // The lost-update race needs two committed transactions and the harness holds
  // exactly one uncommitted connection, so the race itself cannot be staged
  // here (see the note at the top of this file). What IS assertable is that the
  // recompute takes the lock, and takes it BEFORE the UPDATE builds its CTE —
  // which is the whole of the fix. The lock's own semantics are Postgres's.
  test("the recompute locks the destination rows before it counts", async () => {
    const at = newPlace();
    const sid = `${runPrefix}-s15`;
    const dest = `${runPrefix}-dest15`;
    await createSessionWithTrack(sid, at);
    await createSummit(dest, at);

    statementLog.length = 0;
    await run(sid);

    const lockAt = statementLog.findIndex((s) => s.includes("FOR NO KEY UPDATE"));
    const updateAt = statementLog.findIndex((s) => s.includes("UPDATE destinations dst"));
    assert.ok(lockAt >= 0, "the recompute must take the row lock");
    assert.ok(updateAt >= 0, "precondition: the recompute ran");
    assert.ok(
      lockAt < updateAt,
      "the lock has to come first — after the CTE snapshot it is worthless"
    );
  });

  // recency answers to the rows. The write that removes the last ascent has to
  // move it down, not stamp it with the moment of the retraction.
  test("recency follows the counted sessions and clears when none are left", async () => {
    const at = newPlace();
    const sid = `${runPrefix}-s16`;
    const dest = `${runPrefix}-dest16`;
    await createSessionWithTrack(sid, at);
    await createSummit(dest, at);

    await run(sid);
    const withAscent = await query(`SELECT recency FROM destinations WHERE id = $1`, [dest]);
    assert.equal(
      new Date(withAscent.rows[0].recency).toISOString(),
      new Date(START).toISOString(),
      "recency is the session's start_time, not the time we processed it"
    );

    await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ rejected: [dest] })
      .expect(200);

    const retracted = await query(`SELECT recency FROM destinations WHERE id = $1`, [dest]);
    assert.equal(
      retracted.rows[0].recency,
      null,
      "no ascents left, so nothing to be recent about — a retraction must not look fresh"
    );
  });

  // A destination the request never names must not be recomputed out from
  // under a concurrent write — the UPDATE is scoped to the ids passed in.
  test("a destination the request never names is untouched", async () => {
    const at = newPlace();
    const sid = `${runPrefix}-s11`;
    const dest = `${runPrefix}-dest11`;
    const bystander = `${runPrefix}-dest11-bystander`;
    await createSessionWithTrack(sid, at);
    await createSummit(dest, at);
    // Its own patch of ocean — never auto-matched by this session's track, so
    // it keeps whatever buckets we give it unless something recomputes it.
    await createSummit(bystander, newPlace(), '{"months":{"jul":4},"days":{"mo":4}}');

    await run(sid);
    await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ rejected: [dest] })
      .expect(200);

    const untouched = await averages(bystander);
    assert.equal(untouched.months.jul, 4, "an unnamed destination keeps its buckets");
    assert.equal(untouched.days.mo, 4);
  });
});
