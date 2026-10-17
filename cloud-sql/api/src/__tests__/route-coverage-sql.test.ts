import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildRouteContainmentSql, buildRouteCoverageSql, SESSION_SEGMENT_INSERT_SQL, writeSessionSegmentVisits,
  buildSessionSegmentCoverageSelectSql, measureSessionRouteCoverage, upsertSessionRouteCoverage,
  TRIPLE_CROWN_INDEXED_ROUTE_IDS,
} from "../processing";

test("coverage uses nearby indexed neighbours for long trails and bounded parts for ordinary lines", () => {
  const { text, values } = buildRouteCoverageSql("s", ["r", "triple-crown-pct"]);
  assert.match(text, /indexed_near AS MATERIALIZED/);
  assert.match(text, /rp.pt && st.track_bbox/);
  assert.match(text, /b.idx = a.idx \+ 1/);
  assert.match(text, /ORDER BY idx DESC LIMIT 1/);
  assert.match(text, /NOT \(r.id = ANY\(\$3::text\[\]\)\)/);
  assert.match(text, /power\(2, ceil\(ln\(e.edge_m \/ 10\) \/ ln\(2\)\)\)::integer ELSE 1 END AS pieces/);
  assert.match(text, /generate_series\(0, e.pieces - 1\) AS k/);
  assert.match(text, /ST_DWithin\(ST_LineInterpolatePoint\(e.geom_m, \(k \+ 0.5\)::float8 \/ e.pieces\), st.track_m, 30\)/);
  assert.match(text, /ST_Transform\(ST_Force2D\(t.track::geometry\), t.srid\) AS track_m/);
  assert.match(text, /THEN 32700 ELSE 32600 END/);
  assert.match(text, /ST_Force2D\(path::geometry\) AS geom FROM source_lines/);
  assert.match(text, /ST_Length\(geom::geography, false\) AS length_m/);
  assert.doesNotMatch(text, /ST_Length\(path, false\)/);
  assert.doesNotMatch(text, /::geography, st.track, 30\)|ST_Segmentize\(e.geom/);
  assert.match(text, /ST_Subdivide\(l.geom, 512\)/);
  assert.match(text, /ST_Intersection\(piece.geom,st.track_bbox\)/);
  assert.ok(text.indexOf("bounded_parts AS MATERIALIZED") < text.indexOf("ST_DumpPoints(l.geom)"));
  assert.match(text, /ST_Length\(ST_LineSubstring/);
  assert.match(text, /ST_LineMerge\(ST_Collect\(geom\)\)/);
  assert.match(text, /LEAST\(1000.0, GREATEST\(100.0, ls.length_m \* 0.02\)\)/);
  assert.deepEqual(values, ["s", ["r", "triple-crown-pct"], TRIPLE_CROWN_INDEXED_ROUTE_IDS]);
});

test("a missing long-trail index fails instead of erasing its route facts", async () => {
  let count = 0;
  const q = { query: async () => ++count === 1 ? { rows: [{ id: "triple-crown-pct" }] } : { rows: [] } };
  await assert.rejects(() => measureSessionRouteCoverage(q as never, "s"), /triple_crown_route_points_missing/);
});

test("segment SELECT spans all nearby session points and excludes the whole imported segments", () => {
  const select = buildSessionSegmentCoverageSelectSql("s", ["r"]);
  assert.doesNotMatch(select.text, /INSERT|UPDATE|DELETE/);
  assert.match(select.text, /session_points AS MATERIALIZED/);
  assert.match(select.text, /WHERE tp.session_id = \$1 AND tp.location IS NOT NULL/);
  assert.match(select.text, /ST_Transform\(ST_Force2D\(tp.location::geometry\), st.srid\) AS pt_m/);
  assert.match(select.text, /row_number\(\) OVER \(ORDER BY tp.time\) AS seq/);
  assert.match(select.text, /ST_Transform\(ST_Force2D\(ST_Collect\(bp.geom\)\), st.srid\) AS geom_m/);
  assert.match(select.text, /tp.pt_m && shape.box_m AND ST_DWithin\(tp.pt_m, shape.geom_m, 30\)/);
  assert.match(select.text, /ST_LineLocatePoint\(shape.line_m, tp.pt_m\) \* shape.along_length_m, tp.seq,\s+round\(ST_X\(tp.pt_m\)::numeric, 1\), round\(ST_Y\(tp.pt_m\)::numeric, 1\)\) ORDER BY tp.time\) AS points/);
  assert.match(select.text, /json_build_array\(start_m, end_m\) ORDER BY start_m\) AS runs/);
  assert.match(select.text, /NOT \(rs.route_id = ANY\(\$3::text\[\]\)\)/);
  assert.match(SESSION_SEGMENT_INSERT_SQL, /INSERT INTO session_segments/);
  assert.match(SESSION_SEGMENT_INSERT_SQL, /ON CONFLICT \(session_id, segment_id, pass_index\)/);
});

test("visit writer reads the corridor once, then inserts every pass", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const q = { query: async (text: string, values?: unknown[]) => {
    calls.push({ text, values });
    if (text.startsWith("WITH")) return { rows: [{ session_id: "s", segment_id: "seg", length_m: 1000, covered_m: 1000,
      runs: [[0, 1000]], closed: false, points: [[0, 0, 1], [3600, 1000, 2], [7200, 0, 3]] }], rowCount: 1 };
    return { rows: [], rowCount: 2 };
  } };
  assert.equal(await writeSessionSegmentVisits(q as never, "s", ["r"]), 2);
  assert.equal(calls.length, 3);
  assert.match(calls[0].text, /DELETE FROM session_segments WHERE session_id = \$1/);
  const passes = JSON.parse(calls[2].values?.[0] as string);
  assert.deepEqual(passes.map((p: { pass_index: number; direction: string }) => [p.pass_index, p.direction]), [[0, "forward"], [1, "reverse"]]);
});

test("containment uses actual samples as EWKB, never route substrings or whole trail paths", () => {
  const matches = [{ route_id: "r", coverage: 1, covered_m: 8000, covered_intervals: [[0, 1]] as Array<[number, number]>,
    is_primary: true, covered_geometry: "012345" }];
  const { text, values } = buildRouteContainmentSql(matches);
  assert.match(text, /ST_GeomFromEWKB\(decode\(covered_geometry, 'hex'\)\)/);
  assert.match(text, /ST_DWithin\(pt, \(SELECT path FROM primary_covered_m\), 30\)/);
  assert.match(text, /ST_Transform\(ST_Force2D\(geom\), srid\) AS path/);
  assert.match(text, /sample_counts AS MATERIALIZED/);
  assert.match(text, /ceil\(length_m \/ 50\)/);
  assert.doesNotMatch(text, /ST_LineSubstring|FROM routes|route_segments|ST_DumpPoints/);
  assert.deepEqual(JSON.parse(values[0] as string), [{ route_id: "r", is_primary: true, covered_geometry: "012345" }]);
});

test("the shared matcher gates first, ranks covered metres before coverage, then contains once", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const q = { query: async (text: string, values?: unknown[]) => {
    calls.push({ text, values });
    if (calls.length === 1) return { rows: [{ id: "dc" }, { id: "muir" }, { id: "clip" }] };
    if (calls.length === 2) return { rows: [
      { route_id: "muir", length_m: 6504, covered_m: 5925, covered_intervals: [[0, 0.911]], objective_reached: true, covered_geometry: "01" },
      { route_id: "dc", length_m: 11529, covered_m: 9615, covered_intervals: [[0, 0.834]], objective_reached: true, covered_geometry: "02" },
      { route_id: "clip", length_m: 10000, covered_m: 500, covered_intervals: [[0, 0.05]], objective_reached: false },
    ] };
    return { rows: [{ route_id: "muir" }] };
  } };
  const matches = await measureSessionRouteCoverage(q as never, "s");
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[2].values?.[0] as string).map((r: {route_id: string; is_primary: boolean}) => [r.route_id,r.is_primary]),
    [["dc", true], ["muir", false]]);
  assert.deepEqual(matches.map((r) => [r.route_id,r.is_primary]), [["dc",true]]);
});

test("backfill writer removes stale auto and legacy manual rows atomically, even with no new matches", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const q = { query: async (text: string, values?: unknown[]) => { calls.push({ text, values }); return { rows: [], rowCount: 0 }; } };
  await upsertSessionRouteCoverage(q as never, "s", []);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /FOR UPDATE/);
  assert.match(calls[0].text, /DELETE FROM session_routes/);
  assert.match(calls[0].text, /SELECT count\(\*\) AS n FROM removed/);
  assert.doesNotMatch(calls[0].text, /source = 'auto'|source = 'manual'/);
  assert.deepEqual(JSON.parse(calls[0].values?.[1] as string), []);
});
