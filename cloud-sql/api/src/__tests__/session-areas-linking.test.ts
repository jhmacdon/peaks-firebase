import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildLinkReachedSummitsToAreasSql,
  buildLinkSessionsToAreasSql,
  linkSessionsToAreas,
} from "../processing";

test("session-area SQL tags the saved path, not reached destinations", () => {
  const q = buildLinkSessionsToAreasSql(["sess-1"]);

  assert.match(q.text, /INSERT INTO session_areas/);
  assert.match(q.text, /FROM tracking_sessions/);
  assert.match(q.text, /ST_Force2D\(path::geometry\)/);
  assert.match(q.text, /FROM area_boundary_parts parts/);
  assert.match(q.text, /parts\.boundary_part && s\.geom/);
  assert.match(q.text, /ST_Intersects\(parts\.boundary_part, s\.geom\)/);
  assert.doesNotMatch(q.text, /session_destinations/);
  assert.deepEqual(q.values, [["sess-1"]]);
});

test("session-area SQL handles a bounded batch and keeps existing manual tags", () => {
  const q = buildLinkSessionsToAreasSql(["sess-1", "sess-2"]);

  assert.match(q.text, /id = ANY\(\$1::text\[\]\)/);
  assert.match(q.text, /ON CONFLICT \(session_id, area_id\) DO NOTHING/);
  assert.deepEqual(q.values, [["sess-1", "sess-2"]]);
});

test("session-area linking clears stale PostGIS rows before inserting", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const q = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rowCount: calls.length === 2 ? 3 : 1 };
    },
  };

  const count = await linkSessionsToAreas(q, ["sess-1"]);

  assert.equal(calls.length, 2);
  assert.match(calls[0].text, /DELETE FROM session_areas/);
  assert.match(calls[0].text, /source = 'postgis'/);
  assert.match(calls[1].text, /INSERT INTO session_areas/);
  assert.deepEqual(calls[0].values, [["sess-1"]]);
  assert.equal(count, 3);
});

test("link-reached-summits SQL scopes to the session's reached summits", () => {
  const q = buildLinkReachedSummitsToAreasSql("sess-1");

  assert.match(q.text, /INSERT INTO destination_areas/);
  assert.match(q.text, /FROM session_destinations sd/);
  assert.match(q.text, /sd\.relation = 'reached'/);
  assert.match(q.text, /'summit'::destination_feature = ANY\(d\.features\)/);
  // session id is parameterized, not interpolated
  assert.match(q.text, /sd\.session_id = \$1/);
  assert.equal(q.values[0], "sess-1");
});

test("link-reached-summits SQL uses planar gate + exact geography tolerance", () => {
  const q = buildLinkReachedSummitsToAreasSql("sess-1", 50);

  // planar ST_DWithin gate (degrees, uses the GIST index on areas.boundary)
  assert.match(q.text, /ST_DWithin\(a\.boundary, ST_Force2D\(d\.location::geometry\), \$2\)/);
  // exact predicate: contained OR within tolerance meters of the boundary
  assert.match(q.text, /ST_Covers\(a\.boundary, ST_Force2D\(d\.location::geometry\)\)/);
  assert.match(q.text, /ST_DWithin\(a\.boundary::geography, d\.location, \$3\)/);
  assert.match(q.text, /ON CONFLICT \(destination_id, area_id\) DO NOTHING/);

  // gate degrees = max(tol/30000, 0.0002); exact tolerance in meters passed through
  assert.equal(q.values[1], 50 / 30000);
  assert.equal(q.values[2], 50);
});

test("link-reached-summits gate has a floor for tiny tolerances", () => {
  const q = buildLinkReachedSummitsToAreasSql("sess-1", 1);
  // 1/30000 < 0.0002, so the floor applies
  assert.equal(q.values[1], 0.0002);
  assert.equal(q.values[2], 1);
});
