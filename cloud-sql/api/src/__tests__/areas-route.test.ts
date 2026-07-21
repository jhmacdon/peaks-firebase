import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildAreaDetailQuery, mapAreaDetailRow } from "../routes/areas";

test("area detail query returns a boundary and user-scoped sessions", () => {
  const query = buildAreaDetailQuery("mora", "user-1");

  assert.match(query.text, /FROM areas a/);
  assert.match(query.text, /destination_count/);
  assert.match(query.text, /route_count/);
  assert.match(query.text, /session_count/);
  assert.match(query.text, /json_agg\(destination_obj/);
  assert.match(query.text, /json_agg\(route_obj/);
  assert.match(query.text, /ST_SimplifyPreserveTopology/);
  assert.match(query.text, /s\.user_id = \$2/);
  assert.match(query.text, /ST_Intersects\(s\.path, a\.boundary_geography\)/);
  assert.deepEqual(query.values, ["mora", "user-1"]);
});

test("mapAreaDetailRow defaults related arrays and numeric counts", () => {
  const mapped = mapAreaDetailRow({
    id: "mora",
    name: "Mount Rainier National Park",
    kind: "national_park",
    manager: "NPS",
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
    "The National Park Service manages Mount Rainier National Park, a national park in Washington."
  );
});
