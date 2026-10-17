import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import db, { assertTestDatabaseUrl } from "../db";
import { buildRouteCoverageSql, buildRouteContainmentSql, processSession, upsertSessionRouteCoverage, writeSessionSegmentVisits } from "../processing";
import { buildSessionDetailQuery } from "../routes/sessions";
import { selectRouteMatches } from "../route-coverage";
import { dbSkipReason } from "./helpers/test-db";

const prefix = `segments-v2-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const user = `${prefix}-user`;
const id = (suffix: string) => `${prefix}-${suffix}`;
// Remote South Pacific; lengths are near metres, separate from other fixtures.
const lat = -48;
const lng = -137;
const point = (m: number) => `${lng} ${lat + m / 111320} 100`;
const line = (from: number, to: number) => `SRID=4326;LINESTRING Z (${point(from)},${point(to)})`;
async function clean() {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id = $1`, [user]);
  await db.query(`DELETE FROM session_attempt_groups WHERE user_id = $1`, [user]);
  await db.query(`DELETE FROM session_groups WHERE user_id = $1`, [user]);
  await db.query(`DELETE FROM routes WHERE owner = $1`, [user]);
  await db.query(`DELETE FROM segments WHERE id LIKE $1`, [`${prefix}-%`]);
  await db.query(`DELETE FROM destinations WHERE owner = $1`, [user]);
}
async function session(suffix: string, end: number, reverse = false) {
  const sid = id(suffix);
  await db.query(`INSERT INTO tracking_sessions (id, user_id, start_time, ended, path)
    VALUES ($1, $2, '2026-07-01T00:00:00Z', true, ST_GeogFromText($3))`, [sid, user, line(reverse ? end : 0, reverse ? 0 : end)]);
  await db.query(`INSERT INTO tracking_points (session_id, time, location)
    SELECT $1, 1800000000 + n * 60, ST_GeogFromText('SRID=4326;POINT Z (' || $2 || ' ' ||
      ($3::float8 + (CASE WHEN $5::boolean THEN $4::float8 * (1 - n / 20.0) ELSE $4::float8 * n / 20.0 END) / 111320) || ' 100)')
    FROM generate_series(0, 20) n`, [sid, lng, lat, end, reverse]);
  return sid;
}
async function route(suffix: string, path: string, kind = "destination", objective?: string) {
  await db.query(`INSERT INTO routes (id, name, owner, path, kind, objective_destination_id)
    VALUES ($1, $1, $2, ST_GeogFromText($3), $4, $5)`, [id(suffix), user, path, kind, objective ?? null]);
}
async function segment(suffix: string, from: number, to: number) {
  await db.query(`INSERT INTO segments (id, path, display_name, kind)
    VALUES ($1, ST_GeogFromText($2), $1, 'snowfield')`, [id(suffix), line(from, to)]);
}
async function measure(sid: string, routes: string[]) {
  const query = buildRouteCoverageSql(sid, routes.map(id));
  return db.query(query.text, query.values);
}

describe("segment model v2 database", { skip: dbSkipReason ?? undefined, concurrency: 1 }, () => {
  before(clean);
  after(clean);

  test("bulk catalog edits fire statement triggers with transition tables", async () => {
    const result=await db.query(`SELECT c.relname,t.tgtype,t.tgoldtable,t.tgnewtable FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE p.proname IN ('queue_rematch_on_route_link_change','queue_rematch_on_segment_path_change')
        AND NOT t.tgisinternal`);
    assert.equal(result.rowCount,7);
    for(const row of result.rows) {
      assert.equal(row.tgtype & 1,0,"queue triggers must run once per statement");
      assert.ok(row.tgoldtable || row.tgnewtable);
    }
  });

  test("columns, guards, primary uniqueness, touch trigger and cascades", async () => {
    const guards = await db.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'segments'::regclass AND NOT tgisinternal`);
    assert.ok(guards.rows.some((r) => r.tgname === "trg_guard_standard_route_factory_segment"));
    assert.ok(guards.rows.some((r) => r.tgname === "trg_guard_trail_catalog_reviewed_segment"));
    await segment("constraints", 0, 100);
    await assert.rejects(db.query(`UPDATE segments SET kind = 'invalid' WHERE id = $1`, [id("constraints")]), /segments_kind_check/);
    const sid = await session("constraints", 100);
    await route("constraints-a", line(0, 100));
    await route("constraints-b", line(0, 100));
    await db.query(`INSERT INTO session_routes (session_id, route_id, is_primary) VALUES ($1, $2, true)`, [sid, id("constraints-a")]);
    await assert.rejects(db.query(`INSERT INTO session_routes (session_id, route_id, is_primary) VALUES ($1, $2, true)`, [sid, id("constraints-b")]), /idx_session_routes_one_primary/);
    await db.query(`UPDATE tracking_sessions SET server_updated_at = '2000-01-01' WHERE id = $1`, [sid]);
    await db.query(`INSERT INTO session_segments (session_id, segment_id) VALUES ($1, $2)`, [sid, id("constraints")]);
    const touched = await db.query(`SELECT server_updated_at > '2000-01-01'::timestamptz AS touched FROM tracking_sessions WHERE id = $1`, [sid]);
    assert.equal(touched.rows[0].touched, true);
    await db.query(`DELETE FROM segments WHERE id = $1`, [id("constraints")]);
    assert.equal((await db.query(`SELECT 1 FROM session_segments WHERE session_id = $1`, [sid])).rowCount, 0);
  });

  test("rebuild chains ordinals, reverses edges, drops joint vertices and encodes polyline6", async () => {
    await route("rebuild", line(0, 1));
    await segment("first", 0, 100);
    await segment("second", 200, 100);
    await db.query(`INSERT INTO route_segments (route_id, segment_id, ordinal, direction)
      VALUES ($1, $2, 0, 'forward'), ($1, $3, 1, 'reverse')`, [id("rebuild"), id("first"), id("second")]);
    await db.query(`SELECT rebuild_route_path($1)`, [id("rebuild")]);
    const result = await db.query(`SELECT ST_NPoints(path::geometry) AS count,
      ST_Y(ST_EndPoint(path::geometry)) AS end_lat, distance, polyline6,
      ST_AsEncodedPolyline(ST_Force2D(path::geometry), 6) AS expected FROM routes WHERE id = $1`, [id("rebuild")]);
    assert.equal(result.rows[0].count, 3);
    assert.ok(Math.abs(result.rows[0].end_lat - (lat + 200 / 111320)) < 1e-10);
    assert.ok(result.rows[0].distance > 199 && result.rows[0].distance < 201);
    assert.equal(result.rows[0].polyline6, result.rows[0].expected);
    await route("empty", line(0, 1));
    await assert.rejects(db.query(`SELECT rebuild_route_path($1)`, [id("empty")]), /has no segments/);
  });

  test("coverage is stable for dense versus sparse vertices and fractions use metres", async () => {
    const dense = Array.from({ length: 901 }, (_, i) => point(i * 1000 / 900));
    await route("dense", `SRID=4326;LINESTRING Z (${dense.join(",")},${point(10000)})`);
    await route("sparse", line(0, 10000));
    const sid = await session("density", 1000);
    const measured = await measure(sid, ["dense", "sparse"]);
    assert.equal(measured.rows.length, 2);
    const fractions = measured.rows.map((r) => r.covered_m / r.length_m);
    assert.ok(Math.abs(fractions[0] - fractions[1]) < 0.002);
    assert.ok(fractions.every((f) => f > 0.10 && f < 0.11));
    assert.deepEqual(selectRouteMatches(measured.rows), []);
  });

  test("coverage divides horizontal metres by a horizontal length on a steep route", async () => {
    // 1 km north while climbing 1 km: ST_Length(geography) reads about 1,414 m.
    await route("steep", `SRID=4326;LINESTRING Z (${lng} ${lat - 0.05} 0,${lng} ${lat - 0.05 + 1000 / 111320} 1000)`);
    const sid = id("steep-walk");
    await db.query(`INSERT INTO tracking_sessions (id, user_id, start_time, ended, path)
      VALUES ($1, $2, '2026-07-01T00:00:00Z', true, ST_GeogFromText($3))`,
    [sid, user, `SRID=4326;LINESTRING Z (${lng} ${lat - 0.05} 0,${lng} ${lat - 0.05 + 1000 / 111320} 1000)`]);
    const [row] = (await measure(sid, ["steep"])).rows;
    assert.ok(Math.abs(row.length_m - 1000) < 5, `length ${row.length_m}`);
    assert.ok(row.covered_m / row.length_m > 0.999);
    assert.deepEqual(row.covered_intervals, [[0, 1]]);
  });

  test("Rainier shared approach, primary containment, segment times and rematch replace legacy echoes", async () => {
    for (const [name, m] of [["muir-objective", 8000], ["summit-objective", 16000]] as const) {
      await db.query(`INSERT INTO destinations (id, name, search_name, owner, features, location)
        VALUES ($1, $1, $1, $2, '{summit}', ST_GeogFromText($3))`,
      [id(name), user, `SRID=4326;POINT Z (${point(m)})`]);
    }
    await route("muir", line(0, 8000), "destination", id("muir-objective"));
    await route("dc", line(0, 16000), "summit", id("summit-objective"));
    await segment("lower", 0, 8000);
    await segment("upper", 8000, 16000);
    await db.query(`INSERT INTO route_segments (route_id, segment_id, ordinal) VALUES
      ($1, $3, 0), ($2, $3, 0), ($2, $4, 1)`, [id("muir"), id("dc"), id("lower"), id("upper")]);
    for (const [suffix, end, primary] of [["muir-day", 8000, "muir"], ["summit-day", 16000, "dc"]] as const) {
      const sid = await session(suffix, end);
      await db.query(`INSERT INTO session_routes (session_id, route_id, source) VALUES ($1, $2, 'manual')`, [sid, id("dc")]);
      await processSession(sid, user, { force: true });
      // Other fixtures at the same spot may qualify too; assert the Rainier pair.
      const rows = await db.query(`SELECT route_id, is_primary, covered_m, source, coverage FROM session_routes
        WHERE session_id = $1 AND route_id = ANY($2::text[])`, [sid, [id("muir"), id("dc")]]);
      assert.equal(rows.rowCount, 1);
      assert.equal(rows.rows[0].route_id, id(primary));
      assert.equal(rows.rows[0].is_primary, true);
      assert.equal(rows.rows[0].source, "auto");
      assert.ok(rows.rows[0].covered_m > end - 50);
      assert.equal(rows.rows[0].coverage, 1);
      const segments = await db.query(`SELECT segment_id, entered_at, exited_at, direction FROM session_segments WHERE session_id = $1 AND segment_id = ANY($2::text[]) AND covered_m > 50 ORDER BY entered_at`, [sid, [id("lower"), id("upper")]]);
      assert.equal(segments.rowCount, suffix === "muir-day" ? 1 : 2);
      assert.ok(segments.rows.every((r) => r.entered_at <= r.exited_at && r.direction === "forward"));
      await db.query(`INSERT INTO session_segments (session_id, segment_id, covered_m) VALUES ($1, $2, 1)
        ON CONFLICT (session_id, segment_id, pass_index) DO UPDATE SET covered_m = 1`, [sid, id("second")]);
      await processSession(sid, user, { force: true });
      const stale = await db.query(`SELECT covered_m FROM session_segments WHERE session_id = $1 AND segment_id = $2`, [sid, id("second")]);
      // This still-near segment is recomputed, not left at its injected value.
      assert.ok(stale.rows.length === 0 || stale.rows[0].covered_m !== 1);
    }
    const reverse = await session("reverse", 8000, true);
    await writeSessionSegmentVisits(db, reverse, [id("muir")]);
    const row = (await db.query(`SELECT * FROM session_segments WHERE session_id = $1 AND segment_id = $2`, [reverse, id("lower")])).rows[0];
    assert.equal(row.direction, "reverse");
    assert.equal(row.entered_at.toISOString(), new Date(1800000000 * 1000).toISOString());
    assert.equal(row.exited_at.toISOString(), new Date((1800000000 + 1200) * 1000).toISOString());
  });

  test("an out-and-back stores two passes in opposite directions", async () => {
    await route("outback-route",line(0,1000));
    await segment("outback-segment",0,1000);
    await db.query(`INSERT INTO route_segments (route_id,segment_id) VALUES ($1,$2)`,[id("outback-route"),id("outback-segment")]);
    const sid=id("outback-session");
    await db.query(`INSERT INTO tracking_sessions (id,user_id,start_time,ended,path)
      VALUES ($1,$2,'2026-10-15T10:00:00Z',true,ST_GeogFromText($3))`,[sid,user,line(0,1000)]);
    for (const [time,metres] of [["10:00",0],["12:00",1000],["13:00",1000],["15:00",0]] as const) {
      await db.query(`INSERT INTO tracking_points (session_id,time,location) VALUES ($1,$2,ST_GeogFromText($3))`,
        [sid,Date.parse(`2026-10-15T${time}:00Z`)/1000,`SRID=4326;POINT Z (${point(metres)})`]);
    }
    await writeSessionSegmentVisits(db,sid,[id("outback-route")]);
    const rows=(await db.query(`SELECT * FROM session_segments WHERE session_id=$1 ORDER BY pass_index`,[sid])).rows;
    assert.deepEqual(rows.map(r=>[r.pass_index,r.direction,r.entered_at.toISOString(),r.exited_at.toISOString()]),[
      // The hour at the far end is a stop: the outbound pass ends on arrival.
      [0,"forward","2026-10-15T10:00:00.000Z","2026-10-15T12:00:00.000Z"],
      [1,"reverse","2026-10-15T13:00:00.000Z","2026-10-15T15:00:00.000Z"]]);
    assert.ok(rows.every(r=>r.covered_m>990));
  });

  // East/north metres from the fixture origin; walked at 50 m a minute.
  const en = (east: number, north: number) =>
    `${lng + east / (111320 * Math.cos(lat * Math.PI / 180))} ${lat + north / 111320} 100`;
  const square = (north0: number): Array<[number, number]> =>
    [[0, north0], [0, north0 + 1000], [1000, north0 + 1000], [1000, north0], [0, north0]];
  const lineEN = (pts: Array<[number, number]>) => `SRID=4326;LINESTRING Z (${pts.map(([e, n]) => en(e, n)).join(",")})`;
  async function walkSession(suffix: string, corners: Array<[number, number]>) {
    const sid = id(suffix);
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < corners.length; i++) {
      const [[e0, n0], [e1, n1]] = [corners[i], corners[i + 1]];
      const steps = Math.ceil(Math.hypot(e1 - e0, n1 - n0) / 50);
      for (let k = 0; k < steps; k++) pts.push([e0 + (e1 - e0) * k / steps, n0 + (n1 - n0) * k / steps]);
    }
    pts.push(corners[corners.length - 1]);
    await db.query(`INSERT INTO tracking_sessions (id, user_id, start_time, ended, path)
      VALUES ($1, $2, '2026-07-01T00:00:00Z', true, ST_GeogFromText($3))`, [sid, user, lineEN(pts)]);
    await db.query(`INSERT INTO tracking_points (session_id, time, location)
      SELECT $1, 1800000000 + (ord - 1) * 60, ST_GeogFromText('SRID=4326;POINT Z (' || p || ')')
      FROM unnest($2::text[]) WITH ORDINALITY AS t(p, ord)`, [sid, pts.map(([e, n]) => en(e, n))]);
    return sid;
  }
  async function enSegment(suffix: string, pts: Array<[number, number]>) {
    await db.query(`INSERT INTO segments (id, path, display_name, kind) VALUES ($1, ST_GeogFromText($2), $1, 'trail')`,
      [id(suffix), lineEN(pts)]);
  }
  const passes = async (sid: string, segmentSuffix: string) => (await db.query(
    `SELECT pass_index, direction FROM session_segments WHERE session_id = $1 AND segment_id = $2 ORDER BY pass_index`,
    [sid, id(segmentSuffix)])).rows.map((r) => [r.pass_index, r.direction]);

  test("a loop walked once is one pass across the segment's join", async () => {
    await enSegment("loop-only", square(20000));
    await route("loop-route", lineEN(square(20000)), "loop");
    await db.query(`INSERT INTO route_segments (route_id, segment_id) VALUES ($1, $2)`, [id("loop-route"), id("loop-only")]);
    const sid = await walkSession("loop-walk", square(20000));
    await writeSessionSegmentVisits(db, sid, [id("loop-route")]);
    assert.deepEqual(await passes(sid, "loop-only"), [[0, "forward"]]);
  });

  test("a lollipop stores two stem passes, one loop pass, and the payload is primary-only", async () => {
    const stem: Array<[number, number]> = [[0, 29000], [0, 30000]];
    await enSegment("lolly-stem", stem);
    await enSegment("lolly-loop", square(30000));
    await enSegment("lolly-decoy", [[0, 29000], [0, 29600]]);
    await route("lollipop", lineEN([...stem, ...square(30000).slice(1), [0, 29000]]), "loop");
    await route("decoy", lineEN([[0, 29000], [0, 29600]]));
    await db.query(`INSERT INTO route_segments (route_id, segment_id, ordinal, direction) VALUES
      ($1, $2, 0, 'forward'), ($1, $3, 1, 'forward'), ($1, $2, 2, 'reverse'), ($4, $5, 0, 'forward')`,
    [id("lollipop"), id("lolly-stem"), id("lolly-loop"), id("decoy"), id("lolly-decoy")]);
    const sid = await walkSession("lolly-walk", [...stem, ...square(30000).slice(1), [0, 29000]]);
    await writeSessionSegmentVisits(db, sid, [id("lollipop"), id("decoy")]);
    assert.deepEqual(await passes(sid, "lolly-stem"), [[0, "forward"], [1, "reverse"]]);
    assert.deepEqual(await passes(sid, "lolly-loop"), [[0, "forward"]]);
    assert.equal((await passes(sid, "lolly-decoy")).length, 2, "visits of other routes stay stored");

    const payload = async () => (await db.query(buildSessionDetailQuery(sid, user).text, [sid, user])).rows[0].segments;
    assert.deepEqual(await payload(), [], "no primary route means no segment timeline");
    await db.query(`INSERT INTO session_routes (session_id, route_id, source, is_primary) VALUES
      ($1, $2, 'auto', true), ($1, $3, 'auto', false)`, [sid, id("lollipop"), id("decoy")]);
    const segments = await payload();
    assert.deepEqual(segments.map((s: { segment_id: string; pass_index: number; route_ordinal: number; direction: string }) =>
      [s.segment_id, s.pass_index, s.route_ordinal, s.direction]), [
      [id("lolly-stem"), 0, 0, "forward"], [id("lolly-loop"), 0, 1, "forward"], [id("lolly-stem"), 1, 2, "reverse"]]);
    const times = segments.map((s: { entered_at: string }) => Date.parse(s.entered_at));
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });

  test("containment uses geodesic sample geometry on a sparse long north-south line", async () => {
    const primaryPath="SRID=4326;LINESTRING Z (-140 -60 100,-140 40 100,-139 41 100)";
    const covered="SRID=4326;LINESTRING Z (-140 39.9 100,-140 40 100)";
    await route("north-south",primaryPath);
    await route("north-south-clip",covered);
    const sid=id("north-south-session");
    await db.query(`INSERT INTO tracking_sessions (id,user_id,start_time,ended,path)
      VALUES ($1,$2,'2026-10-15T10:00:00Z',true,ST_GeogFromText($3))`,[sid,user,covered]);
    const measured=await measure(sid,["north-south","north-south-clip"]);
    const primary=measured.rows.find(row=>row.route_id===id("north-south"));
    const secondary=measured.rows.find(row=>row.route_id===id("north-south-clip"));
    assert.ok(primary.covered_m>10000);
    const shift=await db.query(`SELECT ST_Distance(ST_StartPoint(ST_GeomFromEWKB(decode($1,'hex')))::geography,
      ST_StartPoint(ST_LineSubstring(ST_GeogFromText($2)::geometry,$3,$4))::geography) AS metres`,
      [primary.covered_geometry,primaryPath,...primary.covered_intervals[0]]);
    assert.ok(shift.rows[0].metres>50,"the fixture must expose the planar/geodesic fraction error");
    const matches=[primary,secondary].map((row,index)=>({route_id:row.route_id,coverage:row.covered_m/row.length_m,
      covered_m:row.covered_m,covered_intervals:row.covered_intervals,covered_geometry:row.covered_geometry,is_primary:index===0}));
    const contained=buildRouteContainmentSql(matches);
    assert.deepEqual((await db.query(contained.text,contained.values)).rows.map(row=>row.route_id),[id("north-south-clip")]);
  });

  test("the backfill writer removes stale rows when the current gate yields no routes", async () => {
    const sid=await session("zero-match-backfill",1000);
    await db.query(`INSERT INTO session_routes (session_id,route_id,source,coverage) VALUES
      ($1,$2,'auto',0.1),($1,$3,'manual',NULL)`,[sid,id("muir"),id("dc")]);
    await upsertSessionRouteCoverage(db,sid,[]);
    assert.equal((await db.query(`SELECT 1 FROM session_routes WHERE session_id=$1`,[sid])).rowCount,0);
  });

  test("link and segment edits queue nearby sessions", async () => {
    const sid = await session("queue", 8000);
    const clear = () => db.query(`DELETE FROM session_rematch_queue WHERE session_id = $1`, [sid]);
    const queued = async () => assert.equal((await db.query(`SELECT 1 FROM session_rematch_queue WHERE session_id = $1`, [sid])).rowCount, 1);
    await clear();
    await db.query(`INSERT INTO route_destinations (route_id, destination_id) VALUES ($1, $2)`, [id("muir"), id("muir-objective")]);
    await queued(); await clear();
    await db.query(`UPDATE route_destinations SET ordinal = 2 WHERE route_id = $1`, [id("muir")]);
    await queued(); await clear();
    await db.query(`DELETE FROM route_destinations WHERE route_id = $1`, [id("muir")]);
    await queued(); await clear();
    await db.query(`UPDATE route_segments SET direction = 'reverse' WHERE route_id = $1`, [id("muir")]);
    await queued(); await clear();
    await db.query(`UPDATE segments SET path = ST_GeogFromText($2) WHERE id = $1`, [id("lower"), line(0, 7999)]);
    await queued();
  });

  test("peaks.defer_rematch = on silences every rematch trigger for its transaction only", async () => {
    const sid = await session("defer", 2000);
    const rid = id("defer-route");
    const queued = async () => (await db.query(`SELECT reason FROM session_rematch_queue WHERE session_id = $1`, [sid])).rows;
    const clear = () => db.query(`DELETE FROM session_rematch_queue WHERE session_id = $1`, [sid]);
    await db.query(`INSERT INTO destinations (id, name, search_name, owner, features, location)
      VALUES ($1, $1, $1, $2, '{summit}', ST_GeogFromText($3))`, [id("defer-peak"), user, `SRID=4326;POINT Z (${point(2000)})`]);
    await segment("defer-segment", 0, 2000);
    await clear();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL peaks.defer_rematch = 'on'");
      await client.query(`INSERT INTO routes (id, name, owner, path, kind) VALUES ($1, $1, $2, ST_GeogFromText($3), 'destination')`,
        [rid, user, line(0, 2000)]);
      await client.query(`INSERT INTO route_segments (route_id, segment_id, ordinal) VALUES ($1, $2, 0)`, [rid, id("defer-segment")]);
      await client.query(`INSERT INTO route_destinations (route_id, destination_id) VALUES ($1, $2)`, [rid, id("defer-peak")]);
      await client.query(`UPDATE segments SET path = ST_GeogFromText($2) WHERE id = $1`, [id("defer-segment"), line(0, 1999)]);
      await client.query(`UPDATE routes SET path = ST_GeogFromText($2), objective_destination_id = $3 WHERE id = $1`,
        [rid, line(0, 1999), id("defer-peak")]);
      await client.query(`UPDATE routes SET status = 'superseded' WHERE id = $1`, [rid]);
      await client.query(`UPDATE routes SET status = 'active' WHERE id = $1`, [rid]);
      await client.query(`UPDATE destinations SET location = ST_GeogFromText($2) WHERE id = $1`,
        [id("defer-peak"), `SRID=4326;POINT Z (${point(1990)})`]);
      assert.deepEqual((await client.query(`SELECT 1 FROM session_rematch_queue WHERE session_id = $1`, [sid])).rows, []);
      // The writer owns enqueueing; the helpers ignore the setting.
      await client.query(`SELECT queue_matching_routes(ARRAY[$1], 'loader')`, [rid]);
      assert.equal((await client.query(`SELECT reason FROM session_rematch_queue WHERE session_id = $1`, [sid])).rows[0]?.reason, "loader");
      await client.query("COMMIT");
    } finally { client.release(); }
    await clear();
    // SET LOCAL ended with that transaction: the same edits queue again.
    await db.query(`UPDATE route_segments SET direction = 'reverse' WHERE route_id = $1`, [rid]);
    assert.equal((await queued()).length, 1); await clear();
    await db.query(`UPDATE segments SET path = ST_GeogFromText($2) WHERE id = $1`, [id("defer-segment"), line(0, 2000)]);
    assert.equal((await queued()).length, 1); await clear();
    await db.query(`UPDATE routes SET status = 'superseded' WHERE id = $1`, [rid]);
    assert.equal((await queued()).length, 1); await clear();
    await db.query(`UPDATE destinations SET location = ST_GeogFromText($2) WHERE id = $1`,
      [id("defer-peak"), `SRID=4326;POINT Z (${point(2000)})`]);
    assert.equal((await queued()).length, 1); await clear();
    const off = await db.connect();
    try {
      await off.query("BEGIN");
      await off.query("SET LOCAL peaks.defer_rematch = 'off'");
      await off.query(`UPDATE routes SET status = 'active' WHERE id = $1`, [rid]);
      assert.equal((await off.query(`SELECT 1 FROM session_rematch_queue WHERE session_id = $1`, [sid])).rowCount, 1);
      await off.query("COMMIT");
    } finally { off.release(); }
  });

  test("pending routes queue nothing until activation queues nearby sessions once", async () => {
    const sid = await session("pending-queue", 3000);
    const rid = id("pending-route");
    const rows = () => db.query(`SELECT reason FROM session_rematch_queue WHERE session_id = $1`, [sid]);
    await db.query(`DELETE FROM session_rematch_queue WHERE session_id = $1`, [sid]);
    await db.query(`INSERT INTO routes (id, name, owner, path, kind, objective_destination_id, status)
      VALUES ($1, $1, $2, ST_GeogFromText($3), 'destination', NULL, 'pending')`, [rid, user, line(0, 3000)]);
    await segment("pending-only", 0, 3000);
    await db.query(`INSERT INTO route_segments (route_id, segment_id, ordinal) VALUES ($1, $2, 0)`, [rid, id("pending-only")]);
    await db.query(`INSERT INTO route_destinations (route_id, destination_id) VALUES ($1, $2)`, [rid, id("muir-objective")]);
    await db.query(`UPDATE route_segments SET direction = 'reverse' WHERE route_id = $1`, [rid]);
    await db.query(`UPDATE segments SET path = ST_GeogFromText($2) WHERE id = $1`, [id("pending-only"), line(0, 2999)]);
    await db.query(`UPDATE routes SET objective_destination_id = $2 WHERE id = $1`, [rid, id("muir-objective")]);
    await db.query(`DELETE FROM route_destinations WHERE route_id = $1`, [rid]);
    assert.equal((await rows()).rowCount, 0, "links and edits of a pending route must not queue sessions");
    await db.query(`UPDATE routes SET status = 'active' WHERE id = $1`, [rid]);
    const queued = await rows();
    assert.equal(queued.rowCount, 1);
    assert.equal(queued.rows[0].reason, `route:${rid}`);
  });
});

// Only an explicitly supplied owner connection may replay DDL. Never infer it
// from DB_* or use the API test login for schema changes.
test("migration can be replayed twice", { skip: dbSkipReason ?? (!process.env.ADMIN_DATABASE_URL ? "No local test owner URL" : undefined) }, async () => {
  const url = process.env.ADMIN_DATABASE_URL!;
  assertTestDatabaseUrl(url);
  const admin = new URL(url);
  const runtime = new URL(process.env.TEST_DATABASE_URL!);
  assert.equal(admin.host, runtime.host);
  assert.equal(admin.pathname, runtime.pathname);
  const { Pool } = await import("pg");
  const owner = new Pool({ connectionString: url, max: 1 });
  try {
    const sql = readFileSync(resolve(__dirname, "../../../migrations/20261015_segment_model_v2.sql"), "utf8");
    await owner.query(sql);
    await owner.query(sql);
  } finally { await owner.end(); }
});
