import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildAreaDetailQuery, mapAreaDetailRow } from "../routes/areas";

test("area detail query returns a boundary and indexed, paged user sessions", () => {
  const query = buildAreaDetailQuery("mora", "user-1", 20, 40);

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
  // The query must use only the materialized display copy. Expanding or
  // simplifying an authoritative PAD-US boundary in a request can restart the
  // f1-micro database.
  assert.match(query.text, /ST_AsGeoJSON\(a\.boundary_display, 6\)/);
  assert.doesNotMatch(query.text, /ST_SimplifyPreserveTopology/);
  assert.doesNotMatch(query.text, /SELECT a\.\*/);
  assert.match(query.text, /FROM session_areas sa/);
  assert.match(query.text, /JOIN tracking_sessions s ON s\.id = sa\.session_id/);
  assert.match(query.text, /sa\.area_id = \$1/);
  assert.match(query.text, /s\.user_id = \$2/);
  assert.match(query.text, /LIMIT \$3/);
  assert.match(query.text, /OFFSET \$4/);
  assert.match(query.text, /'path_preview'/);
  assert.match(query.text, /ST_AsGeoJSON\(s\.path_preview, 6\)/);
  assert.doesNotMatch(query.text, /SELECT s\.\*/);
  assert.doesNotMatch(query.text, /ST_Simplify\(s\.path/);
  assert.doesNotMatch(query.text, /ST_Intersects/);
  assert.deepEqual(query.values, ["mora", "user-1", 20, 40]);
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
    sessions_has_more: true,
    sessions_next_offset: "25",
    destinations: null,
    routes: null,
    sessions: null,
  });

  assert.equal(mapped.destination_count, 12);
  assert.equal(mapped.route_count, 0);
  assert.equal(mapped.session_count, 2);
  assert.equal(mapped.sessions_has_more, true);
  assert.equal(mapped.sessions_next_offset, 25);
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
