import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildAreaDetailQuery, mapAreaDetailRow } from "../routes/areas";

test("area detail query returns a boundary and user-scoped sessions", () => {
  const query = buildAreaDetailQuery("mora", "user-1");

  assert.match(query.text, /FROM areas a/);
  assert.match(query.text, /destination_count/);
  assert.match(query.text, /route_count/);
  assert.match(query.text, /session_count/);
  assert.match(query.text, /description_source_url/);
  // Sub-area detail exposes its containing national park.
  assert.match(query.text, /a\.parent_area_id AS parent_id/);
  assert.match(query.text, /parent\.name AS parent_name/);
  assert.match(query.text, /LEFT JOIN areas parent ON parent\.id = a\.parent_area_id/);
  assert.match(query.text, /json_agg\(destination_obj/);
  assert.match(query.text, /json_agg\(route_obj/);
  // Boundary comes from the materialized display copy, with a live simplify
  // fallback for rows whose backfill hasn't run.
  assert.match(query.text, /COALESCE\(\s*a\.boundary_display,\s*ST_SimplifyPreserveTopology/);
  assert.match(query.text, /s\.user_id = \$2/);
  // Session membership must use planar intersects: the geography form ran for
  // minutes on large coastal parks (Olympic NP) and blew the statement timeout.
  assert.match(query.text, /ST_Intersects\(s\.path::geometry, a\.boundary\)/);
  assert.doesNotMatch(query.text, /ST_Intersects\(s\.path, a\.boundary_geography\)/);
  assert.deepEqual(query.values, ["mora", "user-1"]);
});

test("mapAreaDetailRow defaults related arrays and numeric counts", () => {
  const mapped = mapAreaDetailRow({
    id: "mora",
    name: "Mount Rainier National Park",
    kind: "national_park",
    manager: "NPS",
    description_source_name: "Wikipedia",
    description_source_url: "https://en.wikipedia.org/wiki/Mount_Rainier_National_Park",
    description_source_license: "CC BY-SA 4.0",
    state_codes: ["WA"],
    destination_count: "12",
    route_count: null,
    session_count: "2",
    destinations: null,
    routes: null,
    sessions: null,
  });

  assert.equal(mapped.destination_count, 12);
  assert.equal(mapped.route_count, 0);
  assert.equal(mapped.session_count, 2);
  assert.deepEqual(mapped.destinations, []);
  assert.deepEqual(mapped.routes, []);
  assert.deepEqual(mapped.sessions, []);
  assert.equal(
    mapped.description,
    "Mount Rainier National Park protects a nationally important landscape in Washington."
  );
  assert.equal(mapped.description_source_name, "Wikipedia");
  assert.equal(mapped.description_source_license, "CC BY-SA 4.0");
});
