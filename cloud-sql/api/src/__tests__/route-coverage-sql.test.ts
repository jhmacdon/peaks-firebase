import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildRouteContainmentSql, buildRouteCoverageSql, buildSessionSegmentCoverageSql, measureSessionRouteCoverage, upsertSessionRouteCoverage } from "../processing";

test("coverage SQL densifies nearby geography edges and sums lengths", () => {
  const { text, values } = buildRouteCoverageSql("sess1", ["route-a"]);
  assert.match(text, /ST_Segmentize\(e.geom::geography, 10\)/);
  assert.match(text, /sum\(c.sample_m\)/);
  assert.match(text, /ST_DWithin\(ST_LineInterpolatePoint\(p.geom, 0.5\)::geography, st.track, 30\)/);
  assert.match(text, /e.geom && st.track_bbox/);
  assert.match(text, /ST_Reverse\(seg.path::geometry\)/);
  assert.doesNotMatch(text, /containment|covered_paths|ST_Collect/);
  assert.deepEqual(values, ["sess1", ["route-a"]]);
});

test("the long-route path no longer trusts the vertex index for coverage", async () => {
  let query = 0;
  const q = { query: async () => query++ === 0
    ? { rows: [{ id: "triple-crown-pct" }] }
    : { rows: [{ route_id: "triple-crown-pct", length_m: 4000000, covered_m: 1000, covered_intervals: [[0, 0.00025]] }] } };
  assert.deepEqual(await measureSessionRouteCoverage(q as never, "sess1"), []);
});

test("segment SQL uses unix-second tracking points at the covered endpoints", () => {
  const { text } = buildSessionSegmentCoverageSql("s", ["r"]);
  assert.match(text, /FROM tracking_points tp/);
  assert.match(text, /ORDER BY ST_Distance\(tp.location, e.first_pt::geography\) FETCH FIRST 1 ROW WITH TIES/);
  assert.match(text, /ORDER BY ST_Distance\(tp.location, e.last_pt::geography\) FETCH FIRST 1 ROW WITH TIES/);
  assert.match(text, /to_timestamp\(LEAST\(first_time.time, last_time.time\)\)/);
  assert.match(text, /cs.covered_m >= 50 OR cs.covered_m \/ cs.length_m >= 0.5/);
  assert.match(text, /ON CONFLICT \(session_id, segment_id\) DO UPDATE/);
});

test("containment builds interval substrings and holds the primary constant for 50 m samples", () => {
  const matches = [
    { route_id: "dc", coverage: 1, covered_m: 16000, covered_intervals: [[0, 1]] as Array<[number, number]>, is_primary: true },
    { route_id: "muir", coverage: 1, covered_m: 8000, covered_intervals: [[0, 1]] as Array<[number, number]>, is_primary: false },
  ];
  const { text, values } = buildRouteContainmentSql(matches);
  assert.match(text, /ST_LineSubstring/);
  assert.match(text, /primary_covered AS MATERIALIZED/);
  assert.match(text, /ST_Multi\(ST_Collect\(geom\)\)::geography/);
  assert.match(text, /WHERE NOT is_primary/);
  assert.match(text, /ceil\(length_m \/ 50\)/);
  assert.match(text, /ST_DWithin\(pt, \(SELECT path FROM primary_covered\), 30\)/);
  assert.match(text, />= 0.9 \* sum\(sample_m\)/);
  assert.doesNotMatch(text, /ST_DumpPoints|covered_samples/);
  assert.deepEqual(values, [JSON.stringify(matches), ["dc", "muir"]]);
});

test("matching gates and picks primary before one containment query shared with processing", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const q = { query: async (text: string, values?: unknown[]) => {
    calls.push({ text, values });
    if (calls.length === 1) return { rows: [{ id: "dc" }, { id: "muir" }, { id: "clip" }] };
    if (calls.length === 2) return { rows: [
      { route_id: "muir", length_m: 8000, covered_m: 8000, covered_intervals: [[0, 0.999999999975]], objective_reached: true },
      { route_id: "dc", length_m: 16000, covered_m: 16000, covered_intervals: [[0, 1]], objective_reached: true },
      { route_id: "clip", length_m: 10000, covered_m: 500, covered_intervals: [[0, 0.05]], objective_reached: false },
    ] };
    return { rows: [{ route_id: "muir" }] };
  } };
  const matches = await measureSessionRouteCoverage(q as never, "s");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].values?.[1], ["dc", "muir"]);
  assert.deepEqual(JSON.parse(calls[2].values?.[0] as string).map((row: { route_id: string; is_primary: boolean }) =>
    [row.route_id, row.is_primary]), [["dc", true], ["muir", false]]);
  assert.deepEqual(matches.map((row) => [row.route_id, row.is_primary]), [["dc", true]]);
});

test("one written route needs no containment query", async () => {
  let count = 0;
  const q = { query: async () => ++count === 1 ? { rows: [{ id: "r" }] } : { rows: [
    { route_id: "r", length_m: 400, covered_m: 400, covered_intervals: [[0, 0.999999999975]] },
  ] } };
  const matches = await measureSessionRouteCoverage(q as never, "s");
  assert.equal(count, 2);
  assert.deepEqual(matches[0].covered_intervals, [[0, 1]]);
});

test("the shared coverage writer also normalizes incoming intervals", async () => {
  let written: Array<{ covered_intervals: Array<[number, number]> }> = [];
  const q = { query: async (text: string, values?: unknown[]) => {
    if (text.includes("INSERT INTO session_routes")) written = JSON.parse(values?.[1] as string);
    return { rows: [], rowCount: 1 };
  } };
  await upsertSessionRouteCoverage(q as never, "s", [{ route_id: "r", coverage: 1, covered_m: 400,
    covered_intervals: [[-0.0000001, 0.999999999975]], is_primary: true }]);
  assert.deepEqual(written[0].covered_intervals, [[0, 1]]);
});
