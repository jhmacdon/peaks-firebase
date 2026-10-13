import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import db from "../db";
import { normalizeSearchName } from "../search-utils";
import { dbSkipReason as skipReason } from "./helpers/test-db";

const prefix = `trail-catalog-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const routeId = `${prefix}-route`;
const duplicateId = `${prefix}-duplicate`;
const lakeId = `${prefix}-lake`;
const trailheadId = `${prefix}-trailhead`;
const name = `Mt Test Lk Trl ${prefix}`;
const userId = `${prefix}-user`;

async function cleanup(): Promise<void> {
  await db.query("DELETE FROM trip_reports WHERE id LIKE $1", [`${prefix}%`]);
  await db.query("DELETE FROM tracking_sessions WHERE id LIKE $1", [`${prefix}%`]);
  await db.query("DELETE FROM routes WHERE id LIKE $1", [`${prefix}%`]);
  await db.query("DELETE FROM destinations WHERE id LIKE $1", [`${prefix}%`]);
}

describe("catalog trail SQL helpers and derivation", { skip: skipReason ?? undefined }, () => {
  before(cleanup);
  after(cleanup);

  test("SQL name normalization matches destination search normalization", async () => {
    const values = [
      "  Mt   Rainier NW Trl  ",
      "MT MTN PT ST FT LK PK CR CRK CYN JCT SPGS SPR FK BR BRG TRL HWY RD NE NW SE SW",
      "Mt. St. Helens", "São João 峰", "", " \t \n ",
    ];
    for (const value of values) {
      const result = await db.query("SELECT peaks_normalize_search_name($1) AS name", [value]);
      assert.equal(result.rows[0].name, normalizeSearchName(value), value);
    }
  });

  test("difficulty thresholds use trip effort and moving time uses round-trip ascent", async () => {
    const result = await db.query(`
      SELECT peaks_route_difficulty(distance, gain, loss, shape, completion) AS difficulty,
        peaks_route_est_moving_seconds(distance, gain, loss, shape, completion) AS seconds
      FROM (VALUES
        (7999::float8, 0::float8, 0::float8, 'point_to_point', 'none'),
        (8000, 0, 0, 'loop', 'straight'),
        (16000, 0, 0, 'lollipop', 'none'),
        (26000, 0, 0, 'point_to_point', 'none'),
        (3000, 200, 100, 'out_and_back', 'none'),
        (3000, 200, 100, 'point_to_point', 'reverse'),
        (3000, NULL, 100, 'out_and_back', 'straight'),
        (3000, NULL, NULL, 'out_and_back', 'none'),
        (NULL, 0, 0, 'loop', 'none'),
        (-1, 0, 0, 'loop', 'none'),
        ('NaN'::float8, 0, 0, 'loop', 'none')
      ) AS cases(distance, gain, loss, shape, completion)`);
    assert.deepEqual(result.rows, [
      { difficulty: "easy", seconds: 6399 },
      { difficulty: "moderate", seconds: 6400 },
      { difficulty: "hard", seconds: 12800 },
      { difficulty: "strenuous", seconds: 20800 },
      { difficulty: "moderate", seconds: 6600 },
      { difficulty: "easy", seconds: 3600 },
      { difficulty: "easy", seconds: 5400 },
      ...Array.from({ length: 4 }, () => ({ difficulty: null, seconds: null })),
    ]);
  });

  test("catalog stops, region, kind, estimates, and stable slugs stay fresh", async () => {
    await db.query(
      `INSERT INTO destinations (id, name, search_name, features, state_code, country_code)
       VALUES ($1, 'Test Trailhead', 'test trailhead', '{trailhead}', 'WA', 'US'),
              ($2, 'Test Lake', 'test lake', '{lake}', NULL, NULL)`,
      [trailheadId, lakeId]
    );
    await db.query(
      `INSERT INTO routes (id, name, owner, shape, distance, gain, gain_loss)
       VALUES ($1, $2, 'peaks', 'out_and_back', 3000, 200, 100)`, [routeId, name]
    );
    await db.query(
      `INSERT INTO route_destinations (route_id, destination_id, ordinal)
       VALUES ($1, $2, 0), ($1, $3, 1)`, [routeId, trailheadId, lakeId]
    );
    const first = (await db.query("SELECT * FROM routes WHERE id = $1", [routeId])).rows[0];
    assert.equal(first.kind, "destination");
    assert.equal(first.objective_destination_id, lakeId);
    assert.equal(first.trailhead_destination_id, trailheadId);
    assert.equal(first.state_code, "WA");
    assert.equal(first.country_code, "US");
    assert.equal(first.search_name, normalizeSearchName(name));
    assert.deepEqual(first.aliases, []);
    assert.equal(first.difficulty, "moderate");
    assert.equal(first.est_moving_seconds, 6600);

    await db.query("INSERT INTO routes (id, name, owner) VALUES ($1, $2, 'peaks')", [duplicateId, name]);
    await db.query(
      "INSERT INTO route_destinations (route_id, destination_id, ordinal) VALUES ($1, $2, 0), ($1, $3, 1)",
      [duplicateId, trailheadId, lakeId]
    );
    const duplicate = (await db.query("SELECT slug FROM routes WHERE id = $1", [duplicateId])).rows[0];
    assert.equal(duplicate.slug, `${first.slug}-2`);
    await db.query("UPDATE routes SET name = 'Renamed Trail', distance = 8000 WHERE id = $1", [routeId]);
    const renamed = (await db.query("SELECT slug, search_name, difficulty, est_moving_seconds FROM routes WHERE id = $1", [routeId])).rows[0];
    assert.equal(renamed.slug, first.slug);
    assert.equal(renamed.search_name, "renamed trail");
    assert.equal(renamed.difficulty, "hard");
    assert.equal(renamed.est_moving_seconds, 14600);

    await db.query("UPDATE destinations SET features = '{summit}', state_code = 'OR' WHERE id = $1", [lakeId]);
    const summit = (await db.query("SELECT kind, state_code FROM routes WHERE id = $1", [routeId])).rows[0];
    assert.deepEqual(summit, { kind: "summit", state_code: "OR" });
    await db.query("UPDATE routes SET shape = 'loop' WHERE id = $1", [routeId]);
    assert.equal((await db.query("SELECT kind FROM routes WHERE id = $1", [routeId])).rows[0].kind, "loop");
    await db.query("DELETE FROM destinations WHERE id = $1", [lakeId]);
    const afterDelete = (await db.query("SELECT objective_destination_id, state_code FROM routes WHERE id = $1", [routeId])).rows[0];
    assert.deepEqual(afterDelete, { objective_destination_id: trailheadId, state_code: "WA" });
  });

  test("popularity counts distinct done users, legacy links, and published reports", async () => {
    const popularityRoute = `${prefix}-popularity`;
    await db.query("INSERT INTO routes (id, name, owner) VALUES ($1, 'Popularity Trail', 'peaks')", [popularityRoute]);
    for (const [index, coverage] of [0.7, 1, null, 0.69].entries()) {
      const sessionId = `${prefix}-session-${index}`;
      await db.query(
        "INSERT INTO tracking_sessions (id, user_id, start_time) VALUES ($1, $2, now())",
        [sessionId, index < 2 ? userId : `${userId}-${index}`]
      );
      await db.query("INSERT INTO session_routes (session_id, route_id, coverage) VALUES ($1, $2, $3)",
        [sessionId, popularityRoute, coverage]);
    }
    for (const state of ["published", "hidden"]) {
      const reportId = `${prefix}-report-${state}`;
      await db.query(
        `INSERT INTO trip_reports (id, user_id, title, activity_date, moderation_state)
         VALUES ($1, $2, 'Test report', now(), $3)`, [reportId, userId, state]
      );
      await db.query("INSERT INTO trip_report_routes (report_id, route_id) VALUES ($1, $2)", [reportId, popularityRoute]);
    }
    await db.query("SELECT peaks_refresh_route_popularity()");
    const first = (await db.query("SELECT popularity, updated_at FROM routes WHERE id = $1", [popularityRoute])).rows[0];
    assert.equal(first.popularity, 2.1);
    await db.query("SELECT peaks_refresh_route_popularity()");
    const same = (await db.query("SELECT updated_at FROM routes WHERE id = $1", [popularityRoute])).rows[0];
    assert.equal(same.updated_at.getTime(), first.updated_at.getTime(), "unchanged scores do not churn route timestamps");
    await db.query("DELETE FROM tracking_sessions WHERE id LIKE $1", [`${prefix}-session-%`]);
    await db.query("DELETE FROM trip_reports WHERE id LIKE $1", [`${prefix}-report-%`]);
    await db.query("SELECT peaks_refresh_route_popularity()");
    assert.equal((await db.query("SELECT popularity FROM routes WHERE id = $1", [popularityRoute])).rows[0].popularity, 0);
  });
});
