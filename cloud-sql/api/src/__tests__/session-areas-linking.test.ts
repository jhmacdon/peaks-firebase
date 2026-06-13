import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildLinkReachedSummitsToAreasSql } from "../processing";

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
